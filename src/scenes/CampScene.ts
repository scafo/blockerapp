import { openAudioPanel } from '../ui/audioPanel';
import { music } from '../audio/music';
import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { PALETTE, hex } from '../config/palette';
import buildingText from '../data/buildings.json';
import {
  BUILDINGS, EXPEDITIONS, activeCiv, buildBlock, campaignChoice, canAfford, civChoice, collectExpedition, deckOf, expeditionCost, unlockedUnits,
  activeFront, enableTestMode, expeditionTimeSec, fmtTime, nextLevel, playerPower, settle, startBuild, startExpedition, stashCap, tents,
  SUPPLIES, buySupply, rush, rushCost, trade,
} from '../game/camp';
import shopText from '../data/shop.json';
import { CIV_IDS, civInfo, civUnlocked } from '../game/civs';
import { CIV_STYLE } from '../game/factions';
import { BRANCHES, TECH_IDS, loreFragments, loreTotal, settleResearch, techInfo } from '../game/tech';
import { unitInfo } from '../game/units';
import type { CampaignId } from '../config/balance';
import { RESOURCES, RESOURCE_INFO, type Bag } from '../game/resources';
import { randomSeed } from '../map/rng';
import { loadProfile, resetProfile, saveProfile, type BuildingId, type ExpeditionKind, type Profile } from '../save/storage';
import { analytics } from '../analytics/analytics';
import { FPS_KEY, fpsEnabled } from '../ui/debug';
import { askName } from '../ui/nameInput';
import { canStake, recoverStake, runOptions, stakeIndex } from '../game/camp';
import { Button } from '../ui/Button';
import { buzz } from '../ui/haptics';
import { drawResourceIcon } from '../ui/resourceIcons';
import { textStyle } from '../ui/style';
import { safeInsets, uiCamera, view } from '../ui/screen';
import { drawPatch } from '../ui/symbols';
import { drawUnitIcon } from '../ui/unitIcons';
import { civImage, coverImage, fade } from '../ui/images';
import { box, dashedBox, note, notch } from '../ui/schematic';
import { OPS, body, dot, frameMarks, label, panel, rule, value } from '../ui/ops';
import { audioSettings, onAudioChange } from '../audio/engine';
import { type RoomId, type RoomState } from '../ui/roomArt';
import { drawBlueprint, type Module } from '../ui/blueprint';

const PAD = 12;
// pianta della base (riferimento di Nico: planimetria tecnica su ardesia)
const TEAL = PALETTE.ocra; // etichette in corsivo verde acqua
const italic = (size: number, color: number = TEAL): Phaser.Types.GameObjects.Text.TextStyle => ({ ...textStyle(size, color, false), fontStyle: 'italic', padding: { right: 3 } });
// risorse mostrate l'ultima volta che la base era aperta: al rientro da una campagna i numeri scorrono fino ai nuovi
let shownStash: number[] | null = null;
const maxLvl = (id: BuildingId) => BALANCE.camp.buildings[id].length;
const INK = PALETTE.carta; // testi chiari sul fondo scuro

// 'gioca' = preparazione della campagna (sala operazioni), 'test' = modalità test; alloggi, archivio, cantiere e ricerca hanno la loro pagina
type Spot = BuildingId | 'spedizione' | 'gioca' | 'test' | 'mercato' | 'alloggi' | 'archivio' | 'cantiere' | 'ricerca';
type MapSpot = BuildingId | 'spedizione' | 'alloggi' | 'archivio' | 'mercato'; // le targhette dello schema
// nome breve sulle targhette
const SHORT: Record<MapSpot, string> = {
  comando: 'COMANDO', laboratorio: 'LABORATORIO', radar: 'RADAR', arsenale: 'ARSENALE', deposito: 'DEPOSITO',
  spedizione: 'ESTRAZIONE', alloggi: 'ALLOGGI', archivio: 'ARCHIVIO', mercato: 'MERCATO',
};
// home divisa per cosa serve (Nico): ogni voce apre la sua pagina a tutto schermo
const GROUPS: { title: string; sub: string; ids: MapSpot[] }[] = [
  { title: 'Base', sub: 'gestione', ids: ['comando', 'deposito', 'spedizione', 'alloggi'] },
  { title: 'Sviluppo', sub: 'truppe e ricerca', ids: ['arsenale', 'laboratorio', 'radar'] },
  { title: 'Scambi', sub: 'mercato e archivio', ids: ['mercato', 'archivio'] },
];
// riga sotto il nome: a cosa serve la pagina
const ROLE: Record<MapSpot, string> = {
  comando: 'livello della base', deposito: 'scorte e capienza', spedizione: 'missioni a tempo', alloggi: 'posti branda',
  arsenale: 'truppe e armamenti', laboratorio: 'ricerche', radar: 'registro e vista', mercato: 'scambi e rifornimenti', archivio: 'frammenti della Caduta',
};
const CAMPAIGNS: CampaignId[] = ['breve', 'standard', 'lunga'];
const CAMPAIGN_NAME: Record<CampaignId, string> = { breve: 'BREVE', standard: 'STANDARD', lunga: 'LUNGA' };
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
/** Testo di un livello → [nome, effetto]: "Rapporti dal campo: eventi…" → ["Rapporti dal campo", "eventi…"]. */
const levelParts = (txt: string): [string, string] => {
  const t = txt.replace(/^Armamenti: /, ''), c = t.indexOf(':'), d = t.indexOf(' · ');
  if (c > 0) return [t.slice(0, c), t.slice(c + 1).trim()];
  if (d > 0) return [t.slice(0, d), t.slice(d + 3)];
  return [t, ''];
};
// pagine delle stanze: titolo e pianta da disegnare
const PAGE: Record<Spot, { name: string; room: RoomId | null }> = {
  comando: { name: 'Centro di Comando', room: 'comando' },
  laboratorio: { name: 'Laboratorio', room: 'laboratorio' },
  radar: { name: 'Sala Radar', room: 'radar' },
  arsenale: { name: 'Arsenale', room: 'arsenale' },
  deposito: { name: 'Deposito', room: 'deposito' },
  spedizione: { name: 'Squadre di Estrazione', room: 'spedizione' },
  alloggi: { name: 'Alloggi', room: 'alloggi' },
  archivio: { name: 'Archivio della Caduta', room: 'archivio' },
  mercato: { name: 'Mercato', room: 'mercato' },
  gioca: { name: 'Sala Operazioni', room: 'fronte' },
  cantiere: { name: 'Cantiere', room: 'cantiere' },
  ricerca: { name: 'Ricerca', room: 'ricerca' },
  test: { name: 'Modalità test', room: null },
};

/** Accampamento (home): piccolo all'inizio, cresce con edifici, tende e spedizioni. */
export class CampScene extends Phaser.Scene {
  profile!: Profile; // condiviso con l'albero della ricerca (TreeScene)
  private rowW = 300; // larghezza delle righe delle voci
  private stripTexts: { cantiere?: Phaser.GameObjects.Text; ricerca?: Phaser.GameObjects.Text; audio?: Phaser.GameObjects.Text } = {};
  private clock: Phaser.GameObjects.Text | null = null;
  private portrait = false;
  private safe = { top: 0, right: 0, bottom: 0, left: 0 }; // notch e barra dei gesti (punti)
  private spots = new Map<Spot, { x: number; y: number; g: Phaser.GameObjects.Graphics; deco: Phaser.GameObjects.GameObject[]; label: Phaser.GameObjects.Text; w: number; h: number; left: number; top: number }>();
  private stashTexts: Phaser.GameObjects.Text[] = [];
  private stashBars: Phaser.GameObjects.Rectangle[] = [];
  private counting: boolean[] = [];
  private stashBarW = 0;
  private capText: Phaser.GameObjects.Text | null = null;
  private statusText: Phaser.GameObjects.Text | null = null;
  private timerTexts = new Map<Spot, Phaser.GameObjects.Text>();
  private panel: Phaser.GameObjects.Container | null = null;
  private page: Phaser.GameObjects.Container | null = null; // pagina a tutto schermo della stanza (testata e pianta)
  private pageKey = '';
  private panelSpot: Spot | null = null;
  private panelMode = ''; // laboratorio: '' ricerche · 'archivio' · 'build'; radar: '' registro · 'build'
  private refreshAcc = 0;
  private panelKey = '';
  private lastToast: Phaser.GameObjects.Container | null = null;
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;
  private navBtns: { btn: { setOn: (on: boolean) => void; setVisible: (v: boolean) => void }; on: () => boolean }[] = [];

  constructor() {
    super('Camp');
  }

  create() {
    uiCamera(this);
    this.audioPanel = null;
    music.setMode('hq'); // musica della base: calma
    this.profile = loadProfile();
    // campagna lasciata a metà (app chiusa): la puntata rientra come in una ritirata
    const back = recoverStake(this.profile);
    if (back) {
      saveProfile(this.profile);
      this.time.delayedCall(900, () => this.toast(`CAMPAGNA INTERROTTA · la puntata rientra: +${back} risorse (tassa di ritirata)`, PALETTE.allerta));
    }
    // dopo la run guidata: il nome del comandante (una volta sola, si cambia toccandolo)
    if (this.profile.runs >= 1 && !this.profile.name && !this.profile.nameAsked) this.time.delayedCall(600, () => this.editName(true));
    this.spots = new Map();
    this.timerTexts = new Map();
    this.panel = null;
    this.page = null;
    this.pageKey = ''; // la scena riparte (es. finestra ridimensionata): la pagina va ridisegnata
    this.panelSpot = null;
    const { width, height } = view(this);
    // verticale: edifici su due file (dietro sull'orizzonte, davanti in basso), campo al centro
    this.portrait = height > width;

    this.safe = safeInsets();
    this.drawBackdrop();
    this.drawHud();
    this.burst = this.add.particles(0, 0, 'dot', {
      speed: { min: 60, max: 180 }, lifespan: 600, scale: { start: 1, end: 0 }, emitting: false,
    }).setDepth(30);

    this.settleAll(true);
    this.introSpots();
    // tastiera (PC): INVIO = GIOCA, ESC = chiude la scheda aperta
    this.input.keyboard?.on('keydown-ENTER', () => { if (!this.panel && !document.getElementById('name-ask')) this.onPlay(); });
    this.input.keyboard?.on('keydown-ESC', () => this.closePanel());
    this.scale.once('resize', () => this.scene.restart());
    // alcune WebView (app iOS) al primissimo avvio leggono il notch come 0: un ricontrollo rapido corregge il layout
    this.time.delayedCall(300, () => { if (safeInsets().top !== this.safe.top) this.scene.restart(); });
  }

  update(_t: number, delta: number) {
    this.refreshAcc -= delta;
    if (this.refreshAcc > 0) return;
    this.refreshAcc = 250;
    this.settleAll(false);
    const now = Date.now();
    const d = new Date(now);
    this.clock?.setText(`HQ // ${civInfo(activeCiv(this.profile)).name.toUpperCase()} · SETTORE 07 · ${d.toTimeString().slice(0, 8)}`);
    this.updateBoard();
    const c = this.profile.construction, rs = this.profile.research;
    // barra di stato: quadratino ambra se il lavoro è in corso, grigio se fermo
    this.stripTexts.cantiere?.setText(c ? `■ CANTIERE  ${buildingText[c.id].name.toUpperCase()} · ${fmtTime(c.until - now)}` : '□ CANTIERE  LIBERO')
      .setColor(hex(c ? PALETTE.allerta : OPS.label));
    this.stripTexts.ricerca?.setText(rs ? `■ RICERCA  ${techInfo(rs.id).name.toUpperCase()} · ${fmtTime(rs.until - now)}` : '□ RICERCA  FERMA')
      .setColor(hex(rs ? PALETTE.allerta : OPS.label));
    for (const [spot, t] of this.timerTexts) {
      if (spot === 'spedizione') {
        const e = this.profile.expedition;
        t.setText(!e ? '' : e.until <= now ? 'DI RITORNO!' : `torna tra ${fmtTime(e.until - now)}`);
      } else {
        const r = this.profile.research;
        t.setText(c && c.id === spot ? `cantiere ${fmtTime(c.until - now)}` : spot === 'laboratorio' && r ? `ricerca ${fmtTime(r.until - now)}` : '');
      }
    }
    if (this.panelSpot) {
      // il pannello si ridisegna solo se mostra un timer o se lo stato è cambiato (non ruba i tocchi)
      const key = this.panelState(this.panelSpot, now);
      if (key !== this.panelKey || key.endsWith(':timer')) this.openPanel(this.panelSpot);
    }
  }

  private panelState(spot: Spot, now: number): string {
    const p = this.profile;
    if (spot === 'spedizione') return !p.expedition ? 'none' : p.expedition.until > now ? 'away:timer' : 'ready';
    if (spot === 'test') return `test|${p.test ? 1 : 0}`;
    if (spot === 'mercato') {
      // si ridisegna quando cambiano risorse, acquisti o il prezzo per finire i lavori (a minuti)
      const mins = [p.construction, p.research].map((j) => (j && j.until > now ? Math.ceil((j.until - now) / 60_000) : 0)).join(',');
      return `mercato|${RESOURCES.map((r) => p.stash[r]).join(',')}|${(p.supplies ?? []).join(',')}|${mins}`;
    }
    if (spot === 'gioca') return `gioca|${this.panelMode}|${p.civ}|${p.campaign}|${(p.deck ?? []).join(',')}`;
    if (spot === 'alloggi') return `alloggi|${tents(p)}`;
    if (spot === 'archivio') return `archivio|${p.techs.length}`;
    if (spot === 'cantiere') return `cantiere|${BUILDINGS.map((b) => p.buildings[b]).join(',')}|${p.construction?.id ?? ''}|${RESOURCES.map((r) => p.stash[r]).join(',')}${p.construction ? ':timer' : ''}`;
    if (spot === 'ricerca') return `ricerca|${p.techs.length}|${p.research?.id ?? ''}${p.research ? ':timer' : ''}`;
    return `${p.buildings[spot]}|${p.construction?.id ?? ''}|${RESOURCES.map((r) => p.stash[r]).join(',')}${p.construction?.id === spot ? ':timer' : ''}`;
  }

  // ---------- stato ----------

  private settleAll(first: boolean) {
    const done = settle(this.profile, Date.now());
    if (done) {
      saveProfile(this.profile);
      this.redrawSpot(done);
      const spot = this.spots.get(done)!;
      this.cameras.main.flash(200, 77, 255, 154);
      this.cameras.main.shake(180, 0.003);
      this.tapRing(done, PALETTE.radioattivo, 1.15);
      buzz([30, 40, 30]);
      this.burst.setParticleTint(PALETTE.ocra);
      this.burst.explode(30, spot.x, spot.y);
      const lvl = this.profile.buildings[done];
      analytics.design(['accampamento', 'completato', done], lvl);
      this.toast(`${buildingText[done].name.toUpperCase()} LIV. ${lvl} COMPLETATA\n${buildingText[done].levels[lvl - 1]}`, PALETTE.radioattivo);
    }
    const tech = settleResearch(this.profile, Date.now());
    if (tech) {
      saveProfile(this.profile);
      const t = techInfo(tech);
      analytics.design(['laboratorio', 'ricerca', tech]);
      this.toast(`RICERCA COMPLETATA: ${t.name.toUpperCase()}\n${t.desc}${t.lore ? '\nNuovo frammento nell\'archivio della Caduta' : ''}`, PALETTE.radioattivo);
    }
    if (first) {
      for (const id of this.spots.keys()) this.redrawSpot(id as MapSpot);
    }
    this.updateStash();
  }

  private updateStash() {
    const p = this.profile, cap = stashCap(p), finite = Number.isFinite(cap);
    shownStash ??= RESOURCES.map((r) => p.stash[r]); // prima apertura: niente da far scorrere
    RESOURCES.forEach((r, i) => {
      const v = p.stash[r];
      const t = this.stashTexts[i];
      if (!t) return;
      t.setColor(hex(finite && v >= cap ? PALETTE.ko : INK));
      const from = shownStash?.[i];
      if (from !== undefined && from !== v && !this.counting[i]) this.countTo(i, from, v);
      else if (!this.counting[i]) t.setText(String(v));
      if (!this.counting[i] && shownStash) shownStash[i] = v;
      if (this.stashBars[i]) this.stashBars[i].width = this.stashBarW * (finite ? Math.min(1, v / cap) : 1);
    });
    this.capText?.setText(finite ? `DEPOSITO · capienza ${cap} per risorsa` : 'DEPOSITO · senza limite (test)');
    const now = Date.now(), c = p.construction, rs = p.research;
    const parts = [
      c ? `🔨 ${buildingText[c.id].name} liv. ${p.buildings[c.id] + 1} · ${fmtTime(c.until - now)}` : '',
      rs ? `⚗ ${techInfo(rs.id).name} · ${fmtTime(rs.until - now)}` : '',
    ].filter(Boolean);
    this.statusText?.setText(parts.join('   ')).setColor(hex(c || rs ? PALETTE.allerta : PALETTE.tenue));
  }

  // ---------- disegno ----------
  // Stile del Figma di Nico (riferimenti "Obsidian", "GIS", "Interzone"): foto scura a tutto schermo con crocini agli angoli,
  // barra traslucida in alto (nome del gioco, comandante, scorte), a sinistra la prossima operazione con l'azione principale,
  // a destra le voci divise per cosa servono (Base, Sviluppo, Scambi), in fondo la barra di stato (cantiere, ricerca, audio).

  /** Fondo: foto della base sul ghiaccio, scurita, con un velo più denso a sinistra dove si legge. */
  private drawBackdrop() {
    const { width, height } = view(this);
    this.cameras.main.setBackgroundColor(0x07090c);
    coverImage(this, 'load-ghiaccio', 0, 0, width, height, 0.55).setTint(0x9fb0c4).setAlpha(0.6);
    this.add.rectangle(0, 0, width, height, 0x05070a, 0.45).setOrigin(0);
    fade(this, 0, 0, width * 0.55, height, 0x05070a, 0.7, 0, 'h');
    fade(this, 0, height * 0.6, width, height * 0.4, 0x05070a, 0, 0.75);
  }

  /** Riga di una voce: barra traslucida, nome in mono maiuscolo, a cosa serve sotto, stato a destra. */
  private makeSpot(id: MapSpot, x: number, y: number, w: number, h: number) {
    const g = this.add.graphics();
    const name = label(this, x + 14, y + 8, SHORT[id], OPS.text, 12).setDepth(6);
    this.spots.set(id, { x: x + w / 2, y: y + h / 2, g, deco: [], label: name, w, h, left: x, top: y });
    const timer = label(this, x + w - 14, y + h / 2, '', PALETTE.allerta, 10).setOrigin(1, 0.5).setDepth(6);
    this.timerTexts.set(id, timer);
    const hit = this.add.rectangle(x, y, w, h, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true }).setDepth(7);
    let pressed = false; // apre solo se il tocco è iniziato qui
    hit.on('pointerdown', () => { pressed = true; buzz(8); });
    hit.on('pointerover', () => this.paintRow(id, true));
    hit.on('pointerout', () => { pressed = false; this.paintRow(id, false); });
    hit.on('pointerup', () => {
      if (!pressed) return;
      pressed = false;
      this.openPanel(id);
    });
  }

  private paintRow(id: MapSpot, hover: boolean) {
    const r = this.spots.get(id);
    if (!r) return;
    const isB = (BUILDINGS as string[]).includes(id), built = !isB || this.profile.buildings[id as BuildingId] > 0;
    r.g.clear().fillStyle(0x2b333b, hover ? 0.85 : built ? 0.55 : 0.3).fillRect(r.left, r.top, r.w, r.h);
    if (hover) r.g.fillStyle(OPS.text, 1).fillRect(r.left, r.top, 2, r.h);
  }

  /** Stato della voce: livello a tacche, migliorabile, da costruire; i timer li scrive update(). */
  private redrawSpot(id: MapSpot) {
    const spot = this.spots.get(id);
    if (!spot) return;
    spot.deco.forEach((d) => d.destroy());
    spot.deco = [];
    this.paintRow(id, false);
    const { left: x, top: y, w, h } = spot;
    const isB = (BUILDINGS as string[]).includes(id), lvl = isB ? this.profile.buildings[id as BuildingId] : 1, max = isB ? maxLvl(id as BuildingId) : 0;
    const building = isB && this.profile.construction?.id === id, built = lvl > 0;
    spot.label.setColor(hex(built ? OPS.text : OPS.label));
    spot.deco.push(label(this, x + 14, y + h - 9, built ? ROLE[id] : 'da costruire', OPS.label, 9).setOrigin(0, 1).setDepth(6));
    // tacche del livello a destra (piene = fatte); il timer del cantiere le sostituisce
    if (max && !building) {
      const tw = 7, gap = 3, tx = x + w - 14 - max * (tw + gap) + gap, g = this.add.graphics().setDepth(6);
      for (let i = 0; i < max; i++) {
        g.fillStyle(OPS.text, i < lvl ? 0.9 : 0).fillRect(tx + i * (tw + gap), y + h / 2 - 4, tw, 8);
        g.lineStyle(1, OPS.text, i < lvl ? 0 : 0.35).strokeRect(tx + i * (tw + gap) + 0.5, y + h / 2 - 3.5, tw - 1, 7);
      }
      spot.deco.push(g);
      // migliorabile adesso: puntino verde accanto al nome
      if (lvl < max && !buildBlock(this.profile, id as BuildingId)) {
        const d = this.add.rectangle(x + 14 + spot.label.width + 10, y + 8 + spot.label.height / 2, 6, 6, OPS.gain).setDepth(6);
        this.tweens.add({ targets: d, alpha: 0.3, duration: 700, yoyo: true, repeat: -1 });
        spot.deco.push(d);
      }
    }
    if (id === 'spedizione') {
      const e = this.profile.expedition;
      if (e && e.until <= Date.now()) {
        const d = this.add.rectangle(x + 14 + spot.label.width + 10, y + 8 + spot.label.height / 2, 6, 6, PALETTE.allerta).setDepth(6);
        this.tweens.add({ targets: d, alpha: 0.2, duration: 400, yoyo: true, repeat: -1 });
        spot.deco.push(d);
      }
    }
  }

  // ---------- interfaccia ----------

  private drawHud() {
    const { width, height } = view(this);
    const P = this.portrait;
    const p = this.profile;
    const M = P ? 14 : 26, T = M + this.safe.top, B = M + this.safe.bottom;
    const fx = M, fy = T, fw = width - 2 * M, fh = height - T - B;
    const g = this.add.graphics();
    frameMarks(g, fx, fy, fw, fh);
    const pad = P ? 10 : 22, L = fx + pad, R = fx + fw - pad;

    // barra in alto: nome del gioco, comandante (si tocca per cambiarlo), scorte
    const barH = P ? 76 : 52, barY = fy + pad;
    g.fillStyle(0x2b333b, 0.55).fillRect(L, barY, R - L, barH);
    const title = value(this, L + 16, barY + (P ? 8 : barH / 2), 'ARCHEON', P ? 24 : 28).setOrigin(0, P ? 0 : 0.5);
    // 5 tocchi sul titolo = contatore FPS nelle run (test sui telefoni)
    let taps = 0;
    title.setInteractive().on('pointerup', () => {
      if (++taps < 5) return;
      taps = 0;
      const on = !fpsEnabled();
      try { localStorage.setItem(FPS_KEY, on ? '1' : '0'); } catch { /* niente storage */ }
      this.toast(on ? 'Contatore FPS attivo nelle run' : 'Contatore FPS spento', PALETTE.carta);
    });
    const hx = title.x + title.width + 22;
    label(this, hx, P ? barY + 12 : barY + barH / 2 - 15, 'quartier generale');
    label(this, hx, P ? barY + 28 : barY + barH / 2 + 2, `${p.name || 'Comandante'} ✎`, OPS.text, 10)
      .setInteractive({ useHandCursor: true }).on('pointerup', () => this.editName());
    // scorte: icona e numero in mono, rosso se il Deposito è pieno
    this.stashBars = [];
    const sy = P ? barY + barH - 16 : barY + barH / 2;
    let sx = R - 16;
    this.stashTexts = [...RESOURCES].reverse().map((r) => {
      const t = label(this, sx, sy, '0', OPS.text, 13).setOrigin(1, 0.5);
      drawResourceIcon(g, r, sx - 74, sy, 7);
      sx -= 104;
      return t;
    }).reverse();
    if (P) this.stashTexts.forEach((t, i) => t.setX(R - 16 - (2 - i) * 104));
    this.capText = null;
    this.statusText = null;
    // tasto TEST solo in sviluppo o con ?test=1 nell'indirizzo
    const testOk = import.meta.env.DEV || p.test || new URLSearchParams(location.search).has('test');
    if (testOk) label(this, L, barY + barH + 8, p.test ? '[ test attivo ]' : '[ test ]', PALETTE.allerta, 9)
      .setInteractive({ useHandCursor: true }).on('pointerup', () => this.openPanel('test'));

    // barra di stato in fondo: cantiere e ricerca (si toccano per aprire la pagina), audio a destra
    const stH = 40, stY = fy + fh - pad - stH;
    g.fillStyle(0x2b333b, 0.55).fillRect(L, stY, R - L, stH);
    const part = (x: number, key: 'cantiere' | 'ricerca', run: () => void) => {
      const t = label(this, x, stY + stH / 2, '', OPS.label, 11).setOrigin(0, 0.5).setInteractive({ useHandCursor: true }).on('pointerup', run);
      this.stripTexts[key] = t;
    };
    part(L + 16, 'cantiere', () => this.openPanel('cantiere'));
    part(L + 16 + (P ? (R - L) * 0.42 : 300), 'ricerca', () => this.openPanel('ricerca'));
    const audio = label(this, R - 16, stY + stH / 2, '', OPS.text, 11).setOrigin(1, 0.5).setInteractive({ useHandCursor: true })
      .on('pointerup', () => this.toggleAudio(R - 236, stY));
    this.stripTexts.audio = audio;
    const paintAudio = () => {
      const on = !audioSettings().muted;
      audio.setText(`audio ${on ? 'on' : 'off'}`.toUpperCase());
    };
    paintAudio();
    const off = onAudioChange(paintAudio);
    this.events.once('shutdown', off);

    // colonne: prossima operazione a sinistra, voci a destra (in verticale una sotto l'altra)
    const top = barY + barH + (P ? 22 : 34), bottom = stY - 16;
    const rowH = P ? 40 : 44, gap = 6, gh = 30;
    const groups = GROUPS.map((gr) => ({ ...gr, ids: gr.ids.filter((id) => id !== 'mercato' || p.runs > 0) }));
    const listH = groups.reduce((s, gr) => s + gh + gr.ids.length * (rowH + gap) + 10, 0);
    this.rowW = P ? R - L : Math.min(380, (R - L) * 0.42);
    const lx = P ? L : R - this.rowW;
    let ly = P ? bottom - listH : top;
    // operazione: in verticale sopra le voci, in orizzontale a sinistra
    const opY = top, opW = P ? R - L : Math.min(460, lx - L - 40);
    const fi = activeFront(p), F = BALANCE.fronts[fi], yours = playerPower(p), weak = yours < F.power;
    dot(g, L + 3, opY + 7, OPS.accent);
    label(this, L + 14, opY, 'prossima operazione', OPS.accent);
    const big = value(this, L - 2, opY + 18, `FRONTE ${ROMAN[fi]}`, P ? 36 : 60);
    const fname = body(this, L, big.y + big.height + 2, F.name, 15, OPS.text);
    // potenza: tua contro consigliata, con il colore che dice se basta
    const pw = fname.y + fname.height + 14;
    label(this, L, pw, 'potenza');
    value(this, L, pw + 14, `${yours}`, 22, weak ? OPS.loss : OPS.text);
    label(this, L + 90, pw, 'consigliata');
    value(this, L + 90, pw + 14, `${F.power}`, 22);
    g.lineStyle(1, OPS.edge, 0.5).lineBetween(L + 72, pw + 2, L + 72, pw + 40);
    if (weak) body(this, L, pw + 46, 'Nemici più forti di te: potenzia la base prima di partire.', 12, OPS.loss, opW);
    // azione principale
    const bw = P ? R - L : Math.min(300, opW), bh = 54;
    const playY = P ? Math.min(pw + 74, ly - bh - 16) : pw + (weak ? 74 : 60);
    const play = new Button(this, 'AVVIA CAMPAGNA', bw, bh, () => this.onPlay(), 18).setPrimary();
    play.setPosition(L, playY).setDepth(20);
    if (p.runs > 0) label(this, L, playY + bh + 10, 'cambia fronte ›', OPS.label, 10).setInteractive({ useHandCursor: true }).on('pointerup', () => this.openPanel('gioca', 'fronti'));
    if (P) ly = Math.max(ly, playY + bh + 34);

    // voci per gruppo: titolo del gruppo (mono) e a cosa serve, poi le righe
    for (const gr of groups) {
      label(this, lx, ly + 8, gr.title, OPS.text, 10);
      label(this, lx + this.rowW, ly + 8, gr.sub, OPS.label, 9).setOrigin(1, 0);
      g.lineStyle(1, OPS.edge, 0.5).lineBetween(lx, ly + gh - 6, lx + this.rowW, ly + gh - 6);
      ly += gh;
      for (const id of gr.ids) {
        this.makeSpot(id, lx, ly, this.rowW, rowH);
        ly += rowH + gap;
      }
      ly += 10;
    }
  }

  private audioPanel: Phaser.GameObjects.Container | null = null;

  /** Impostazioni audio sopra (o sotto) il tasto AUDIO. */
  private toggleAudio(x: number, y: number) {
    if (this.audioPanel?.active) { this.audioPanel.destroy(); this.audioPanel = null; return; }
    const H = 26 + 34 * 4 + 6, { width, height } = view(this);
    const px = Math.min(x, width - 236 - 8), py = y - H - 8 >= 8 ? y - H - 8 : Math.min(y + 42, height - H - 8);
    this.audioPanel = openAudioPanel(this, px, py, 'camp');
  }

  // (bacheca operativa tolta: le sue voci sono ora targhette, timer sotto le targhette e tasti secondari)
  private updateBoard() {}

  /** Navigazione: non serve più (il Mercato è una targhetta dello schema). */
  private refreshNav() {
    for (const { btn, on } of this.navBtns) btn.setOn(on());
  }

  /** GIOCA: la prima volta parte la run guidata, poi si apre la preparazione della campagna. */
  private onPlay() {
    if (this.profile.runs === 0) this.scene.start('Load', { next: 'Run', data: { seed: randomSeed() } });
    else this.openPanel('gioca');
  }

  /** Anello che si allarga e svanisce attorno a una targhetta: tocco (piccolo) o lavori finiti (grande). */
  private tapRing(id: MapSpot, color: number, size: number) {
    const spot = this.spots.get(id);
    if (!spot) return;
    const { w, h } = spot;
    const g = this.add.graphics({ x: spot.x, y: spot.y }).setDepth(8);
    g.lineStyle(2, color, 0.9).strokeRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8);
    g.setScale(0.98 * size);
    this.tweens.add({ targets: g, scale: 1.04 * size, alpha: 0, duration: size > 1 ? 650 : 280, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
  }

  /** Entrata: le targhette compaiono una dopo l'altra lungo i fili. */
  private introSpots() {
    this.cameras.main.fadeIn(300, 5, 9, 15);
    [...this.spots.values()].forEach((spot, k) => {
      const parts = [spot.g, spot.label, ...spot.deco.filter((d) => 'setAlpha' in d && !this.tweens.isTweening(d))] as unknown as Phaser.GameObjects.Components.Alpha[];
      for (const d of parts) d.setAlpha(0);
      this.tweens.add({ targets: parts, alpha: 1, duration: 260, delay: 80 + k * 60 });
    });
  }

  /** Il numero della risorsa scorre fino al nuovo valore (rientro da una campagna, spese); in salita, scintille del suo colore. */
  private countTo(i: number, from: number, to: number) {
    const t = this.stashTexts[i], r = RESOURCES[i], o = { v: from };
    this.counting[i] = true;
    this.tweens.add({
      targets: o, v: to, duration: Math.min(1200, 400 + Math.abs(to - from) * 2), delay: 350, ease: 'Quad.easeOut',
      onUpdate: () => t.setText(String(Math.round(o.v))),
      onComplete: () => {
        t.setText(String(to));
        this.counting[i] = false;
        if (shownStash) shownStash[i] = to;
        this.tweens.add({ targets: t, scale: { from: 1.25, to: 1 }, duration: 260, ease: 'Back.easeOut' });
        if (to > from) {
          this.burst.setParticleTint(RESOURCE_INFO[r].color);
          this.burst.explode(10, t.x + t.width / 2, t.y);
        }
      },
    });
  }

  private closePanel() {
    this.panel?.destroy();
    this.panel = null;
    this.page?.destroy();
    this.page = null;
    this.pageKey = '';
    this.panelSpot = null;
    for (const { btn } of this.navBtns) btn.setVisible(true);
    this.refreshNav();
  }

  /** Stato della stanza che la pianta disegna (livello, scorte, posti, frammenti, mezzi fuori, reparti). */
  private roomState(spot: Spot): RoomState {
    const p = this.profile, isB = (BUILDINGS as string[]).includes(spot), now = Date.now();
    const st: RoomState = { lvl: isB ? p.buildings[spot as BuildingId] : 1, building: isB && p.construction?.id === spot };
    if (spot === 'deposito' || spot === 'mercato') {
      const cap = stashCap(p);
      st.fill = Object.fromEntries(RESOURCES.map((r) => [r, Number.isFinite(cap) ? Math.round(Math.min(1, p.stash[r] / cap) * 20) / 20 : 1]));
    }
    if (spot === 'alloggi') st.count = tents(p);
    if (spot === 'archivio') st.count = loreFragments(p).length;
    if (spot === 'spedizione') st.count = p.expedition && p.expedition.until > now ? 1 : 0;
    if (spot === 'arsenale') st.units = unlockedUnits(p);
    return st;
  }

  /** Stanze della pianta: un livello (o una voce) per stanza, con il suo stato. */
  private roomModules(spot: Spot): Module[] {
    const p = this.profile, now = Date.now();
    const lv = (done: boolean, active: boolean, next: boolean): Module['state'] => (done ? 'done' : active ? 'active' : next ? 'next' : 'todo');
    if ((BUILDINGS as string[]).includes(spot)) {
      const id = spot as BuildingId, lvl = p.buildings[id], building = p.construction?.id === id;
      return buildingText[id].levels.map((txt, i) => {
        // nella pianta solo nome e stato: gli effetti sono scritti a destra
        const [name] = levelParts(txt), state = lv(i < lvl, building && i === lvl, i === lvl);
        return { code: `livello ${i + 1}`, name, state, sub: state === 'active' ? `in cantiere · ${fmtTime(p.construction!.until - now)}` : state === 'next' ? 'prossimo' : state === 'done' ? 'attivo' : 'da costruire' };
      });
    }
    switch (spot) {
      case 'spedizione': {
        const e = p.expedition;
        return EXPEDITIONS.map((k, i) => ({ code: `M${i + 1}`, name: buildingText.spedizione.kinds[k], state: e?.kind === k ? 'active' : 'done',
          sub: e?.kind === k ? (e.until > now ? `in missione · ${fmtTime(e.until - now)}` : 'di ritorno') : fmtTime(expeditionTimeSec(p, k) * 1000) }));
      }
      case 'alloggi': {
        const n = tents(p);
        return Array.from({ length: BALANCE.camp.tentsMax }, (_, i) => ({ code: `B${i + 1}`, name: `branda ${i + 1}`, state: lv(i < n, false, i === n), sub: i < n ? 'occupata' : i === n ? 'con la prossima campagna' : '' }));
      }
      case 'archivio': {
        const got = loreFragments(p).length;
        return Array.from({ length: loreTotal }, (_, i) => ({ code: `F${i + 1}`, name: `frammento ${ROMAN[i] ?? i + 1}`, state: lv(i < got, false, i === got), sub: i < got ? 'decifrato' : 'ramo La Caduta' }));
      }
      case 'mercato':
        return [['Banco scambi', 'risorse 50 → 30'], ['Rifornimenti', 'per la prossima campagna'], ['Lavori rapidi', 'finisci subito in metallo']]
          .map(([name, sub], i) => ({ code: `S${i + 1}`, name, sub, state: 'done' }));
      case 'gioca': {
        const max = p.frontMax ?? 0, sel = activeFront(p);
        return BALANCE.fronts.map((F, i) => ({ code: ROMAN[i], name: F.name, state: i === sel ? 'active' : lv(i <= max, false, i === max + 1), sub: i === sel ? 'scelto' : `potenza ${F.power}` }));
      }
      case 'cantiere':
        return BUILDINGS.map((b, i) => {
          const lvl = p.buildings[b], max = maxLvl(b), building = p.construction?.id === b;
          return { code: `C${i + 1}`, name: buildingText[b].name, state: building ? 'active' : lvl >= max ? 'done' : 'next', sub: building ? `in cantiere · ${fmtTime(p.construction!.until - now)}` : `livello ${lvl}/${max}` };
        });
      case 'ricerca':
        return Object.entries(BRANCHES).map(([b, name], i) => {
          const ids = TECH_IDS.filter((t) => BALANCE.tech[t].branch === b), done = ids.filter((t) => p.techs.includes(t)).length;
          const run = p.research && BALANCE.tech[p.research.id as keyof typeof BALANCE.tech]?.branch === b;
          return { code: `R${i + 1}`, name, state: run ? 'active' : done >= ids.length ? 'done' : done > 0 ? 'next' : 'todo', sub: `${done}/${ids.length} ricerche` };
        });
      default:
        return [];
    }
  }

  /**
   * Pagina a tutto schermo della stanza: testata (‹ BASE, nome, ala, livello, scorte) e pianta disegnata a sinistra
   * (in verticale sopra). Si ridisegna solo quando cambia la stanza o il suo stato, così le luci animate non ripartono a ogni
   * timer. Restituisce il riquadro del fascicolo (a destra o sotto), dove va il contenuto della stanza.
   */
  private drawPage(spot: Spot) {
    const { width, height } = view(this);
    const P = this.portrait, T = PAD + this.safe.top, Bm = PAD + this.safe.bottom, head = P ? 110 : 92, info = PAGE[spot], p = this.profile;
    const top = T + head;
    let art: { x: number; y: number; w: number; h: number } | null = null, x0: number, y0: number, W: number, H: number;
    if (!info.room) { x0 = PAD; y0 = top; W = width - 2 * PAD; H = height - top - Bm; }
    else if (P) {
      const ah = Math.min(height * 0.32, width * 0.9);
      art = { x: PAD, y: top, w: width - 2 * PAD, h: ah };
      x0 = PAD; y0 = top + ah + 10; W = width - 2 * PAD; H = height - y0 - Bm;
    } else {
      const aw = Math.min(width * 0.56, (height - top - Bm) * 1.45);
      art = { x: PAD, y: top, w: aw, h: height - top - Bm };
      x0 = PAD + aw + 12; y0 = top; W = width - x0 - PAD; H = height - top - Bm;
    }
    const st = this.roomState(spot);
    const key = `${spot}|${JSON.stringify(st)}|${RESOURCES.map((r) => p.stash[r]).join(',')}|${width}x${height}`;
    if (key !== this.pageKey) {
      const fresh = !this.page;
      this.page?.destroy();
      this.pageKey = key;
      // fondo: la stessa foto della base (la parabola per la Sala Radar), scurita come la home
      const objs: Phaser.GameObjects.GameObject[] = [
        this.add.rectangle(0, 0, width, height, 0x07090c, 1).setOrigin(0).setInteractive(), // la base sotto non riceve i tocchi
        coverImage(this, spot === 'radar' ? 'load-radar' : 'load-ghiaccio', 0, 0, width, height, 0.5).setTint(0x9fb0c4).setAlpha(0.45),
        this.add.rectangle(0, 0, width, height, 0x05070a, 0.55).setOrigin(0),
      ];
      // testata: barra traslucida con ‹ BASE, nome della pagina, livello a tacche e scorte
      const hg = this.add.graphics();
      const barY = T - 4, barH = P ? 84 : 52;
      hg.fillStyle(0x2b333b, 0.55).fillRect(PAD, barY, width - 2 * PAD, barH);
      const back = label(this, PAD + 14, barY + (P ? 16 : barH / 2), '‹ base', OPS.text, 11).setOrigin(0, 0.5).setInteractive({ useHandCursor: true })
        .on('pointerup', () => this.closePanel());
      const isB = (BUILDINGS as string[]).includes(spot), lvl = isB ? p.buildings[spot as BuildingId] : 0, max = isB ? maxLvl(spot as BuildingId) : 0;
      hg.lineStyle(1, OPS.edge, 0.6).lineBetween(back.x + back.width + 14, barY + 12, back.x + back.width + 14, barY + (P ? 30 : barH - 12));
      const title = value(this, back.x + back.width + 28, barY + (P ? 16 : barH / 2), info.name.toUpperCase(), P ? 20 : 24).setOrigin(0, 0.5);
      objs.push(back, title, hg);
      if (isB) { // livello: tacche dopo il titolo (piena = fatto, ambra = in cantiere)
        const tw = 9, gap = 3, tx = title.x + title.width + 16;
        objs.push(label(this, tx, barY + (P ? 16 : barH / 2) - 14, `liv ${lvl}/${max}`, OPS.label, 8));
        for (let i = 0; i < max; i++) {
          const bx = tx + i * (tw + gap), done = i < lvl, now = st.building && i === lvl;
          hg.fillStyle(now ? PALETTE.allerta : OPS.text, done || now ? 0.9 : 0).fillRect(bx, barY + (P ? 16 : barH / 2) + 2, tw, 8);
          hg.lineStyle(1, OPS.text, done || now ? 0 : 0.35).strokeRect(bx + 0.5, barY + (P ? 16 : barH / 2) + 2.5, tw - 1, 7);
        }
      }
      // scorte: icona e numero in mono, a destra della barra (in verticale sotto il titolo)
      let sx = width - PAD - 16;
      const sy = barY + (P ? barH - 18 : barH / 2);
      [...RESOURCES].reverse().forEach((r) => {
        const t = label(this, sx, sy, String(p.stash[r]), OPS.text, 12).setOrigin(1, 0.5);
        drawResourceIcon(hg, r, sx - Math.max(48, t.width) - 12, sy, 6);
        objs.push(t);
        sx -= Math.max(48, t.width) + 40;
      });
      if (art) {
        objs.push(...drawBlueprint(this, art.x, art.y, art.w, art.h, info.name, info.name, this.roomModules(spot)));
      }
      this.page = this.add.container(0, 0, objs).setDepth(39);
      if (fresh) {
        this.page.setAlpha(0);
        this.tweens.add({ targets: this.page, alpha: 1, duration: 200, ease: 'Quad.easeOut' });
      }
    }
    return { x0, y0, W, H };
  }

  /** Alloggi: i posti branda (crescono con le campagne). */
  private fillAlloggi(items: Phaser.GameObjects.GameObject[], x0: number, y0: number, W: number, _H: number) {
    const p = this.profile, n = tents(p), max = BALANCE.camp.tentsMax;
    items.push(this.add.text(x0 + 16, y0 + 44, 'Le squadre che tornano dal fronte dormono qui. Un posto branda in più ogni due campagne combattute.', textStyle(11, PALETTE.tenue, false)).setWordWrapWidth(W - 32));
    const g = this.add.graphics();
    items.push(g);
    const rowH = 26, ty = y0 + 92;
    for (let i = 0; i < max; i++) {
      const ry = ty + i * rowH, on = i < n;
      for (let dx = x0 + 16; dx < x0 + W - 16; dx += 5) g.fillStyle(INK, 0.2).fillRect(dx, ry + rowH - 2, 1.5, 1.5);
      if (on) g.fillStyle(INK, 1).fillRect(x0 + 18, ry + 7, 12, 10); else dashedBox(g, x0 + 18, ry + 7, 12, 10, INK, 0.5);
      const wait = (i - n) * 2 + 2 - (p.runs % 2);
      items.push(this.add.text(x0 + 40, ry + 12, `Branda ${i + 1}`, textStyle(12, on ? INK : PALETTE.tenue)).setOrigin(0, 0.5),
        this.add.text(x0 + W - 16, ry + 12, on ? 'occupata' : `libera · tra ${wait} ${wait === 1 ? 'campagna' : 'campagne'}`, italic(10, on ? TEAL : PALETTE.tenue)).setOrigin(1, 0.5));
    }
    const ly = ty + max * rowH + 14;
    void ly;
  }

  /** Cantiere: tutte le stanze con livello e stato; si tocca una riga per aprirne la pagina. */
  private fillWorks(items: Phaser.GameObjects.GameObject[], x0: number, y0: number, W: number, H: number) {
    const p = this.profile, now = Date.now(), c = p.construction;
    items.push(this.add.text(x0 + 16, y0 + 44, c ? `Cantiere aperto: ${buildingText[c.id].name} verso il livello ${p.buildings[c.id] + 1}. Una stanza alla volta.` : 'Cantiere libero. Tocca una stanza per vederne il prossimo livello.', textStyle(11, c ? PALETTE.allerta : PALETTE.tenue, false)).setWordWrapWidth(W - 32));
    const rowH = 54, ty = y0 + 84;
    const why = { busy: 'cantiere occupato', cost: 'risorse insufficienti', comando: 'serve il Centro di Comando', max: 'livello massimo' } as const;
    BUILDINGS.forEach((id, i) => {
      const ry = ty + i * (rowH + 6), lvl = p.buildings[id], max = maxLvl(id), here = c?.id === id, block = buildBlock(p, id);
      const r = this.add.rectangle(x0 + 16, ry, W - 32, rowH, PALETTE.inchiostro).setOrigin(0).setStrokeStyle(1.2, here ? PALETTE.allerta : INK, here ? 1 : 0.6)
        .setInteractive({ useHandCursor: true });
      r.on('pointerover', () => r.setFillStyle(PALETTE.pannelloAlto)).on('pointerout', () => r.setFillStyle(PALETTE.inchiostro)).on('pointerup', () => this.openPanel(id));
      const g = this.add.graphics();
      for (let k = 0; k < max; k++) {
        const bx = x0 + 28 + k * 22, done = k < lvl, cur = here && k === lvl;
        g.fillStyle(done ? INK : PALETTE.inchiostro, 1).fillRect(bx, ry + 32, 18, 9).lineStyle(1.1, cur ? PALETTE.allerta : INK, done || cur ? 1 : 0.45).strokeRect(bx, ry + 32, 18, 9);
      }
      const state = here ? `in cantiere · ${fmtTime(c!.until - now)}` : lvl >= max ? 'livello massimo' : block ? why[block] : `migliorabile · ${fmtTime((nextLevel(p, id)?.timeSec ?? 0) * 1000)}`;
      items.push(r, g, this.add.text(x0 + 28, ry + 8, buildingText[id].name.toUpperCase(), textStyle(13, INK)),
        this.add.text(x0 + W - 40, ry + rowH / 2, state, italic(10, here ? PALETTE.allerta : !block && lvl < max ? PALETTE.radioattivo : PALETTE.tenue)).setOrigin(1, 0.5),
        this.add.text(x0 + W - 24, ry + rowH / 2, '›', textStyle(18, TEAL)).setOrigin(1, 0.5));
    });
    if (c) {
      const total = BALANCE.camp.buildings[c.id][p.buildings[c.id]].timeSec * 1000, pct = Phaser.Math.Clamp(1 - (c.until - now) / total, 0, 1);
      const by = y0 + H - 70, cost = rushCost(c.until, now), ok = p.stash.metallo >= cost;
      items.push(this.add.rectangle(x0 + 16, by, W - 32, 10, PALETTE.inchiostro).setOrigin(0).setStrokeStyle(1, INK, 0.6),
        this.add.rectangle(x0 + 16, by, (W - 32) * pct, 10, PALETTE.allerta).setOrigin(0));
      items.push(this.btn(`FINISCI ORA · ${cost} METALLO`, x0 + 16, y0 + H - 54, W - 32, ok, () => {
        if (!rush(p, 'construction', Date.now())) return;
        analytics.design(['mercato', 'accelera', 'construction'], cost);
        saveProfile(p);
        this.closePanel();
        this.settleAll(false);
      }, 13));
    }
  }

  /** Ricerca: progetto in corso, avanzamento di ogni ramo, ingresso all'albero. */
  private fillResearch(items: Phaser.GameObjects.GameObject[], x0: number, y0: number, W: number, H: number) {
    const p = this.profile, now = Date.now(), r = p.research;
    if (!p.buildings.laboratorio) {
      items.push(this.add.text(x0 + 16, y0 + 48, 'Senza Laboratorio non si studia niente. Costruiscilo per aprire l\'albero della ricerca.', textStyle(12, PALETTE.tenue, false)).setWordWrapWidth(W - 32));
      items.push(this.btn('VAI AL LABORATORIO ›', x0 + 16, y0 + H - 56, W - 32, true, () => this.openPanel('laboratorio'), 14, true));
      return;
    }
    // progetto in corso
    const g = this.add.graphics();
    items.push(g);
    const cy = y0 + 48;
    box(g, x0 + 16, cy, W - 32, 74, 0.9, 0.6);
    items.push(notch(this, x0 + 20, cy, 'In corso'));
    if (r) {
      const t = techInfo(r.id), total = (BALANCE.tech[r.id]?.timeSec ?? 1) * 1000, pct = Phaser.Math.Clamp(1 - (r.until - now) / total, 0, 1);
      items.push(this.add.text(x0 + 28, cy + 12, t.name.toUpperCase(), textStyle(14, INK)),
        this.add.text(x0 + W - 28, cy + 12, `finisce tra ${fmtTime(r.until - now)}`, italic(10, PALETTE.allerta)).setOrigin(1, 0),
        this.add.text(x0 + 28, cy + 32, t.desc, textStyle(10, PALETTE.tenue, false)).setWordWrapWidth(W - 56).setMaxLines(1));
      g.fillStyle(PALETTE.inchiostro, 1).fillRect(x0 + 28, cy + 54, W - 56, 8).lineStyle(1, INK, 0.6).strokeRect(x0 + 28, cy + 54, W - 56, 8).fillStyle(PALETTE.allerta, 1).fillRect(x0 + 28, cy + 54, (W - 56) * pct, 8);
    } else items.push(this.add.text(x0 + 28, cy + 26, 'Nessun progetto in corso: scegline uno dall\'albero.', textStyle(12, PALETTE.tenue, false)));
    // rami: quanti progetti completati su quanti
    const ty = cy + 92, rowH = 30;
    items.push(this.add.text(x0 + 16, ty, 'rami della ricerca', italic(10)));
    Object.entries(BRANCHES).forEach(([k, name], i) => {
      const ids = TECH_IDS.filter((id) => BALANCE.tech[id].branch === k), done = ids.filter((id) => p.techs.includes(id)).length, ry = ty + 16 + i * rowH;
      const bw = W - 32 - 170;
      g.fillStyle(PALETTE.inchiostro, 1).fillRect(x0 + 150, ry + 8, bw, 6).lineStyle(1, INK, 0.5).strokeRect(x0 + 150, ry + 8, bw, 6)
        .fillStyle(done === ids.length ? PALETTE.radioattivo : INK, 1).fillRect(x0 + 150, ry + 8, ids.length ? (bw * done) / ids.length : 0, 6);
      const hit = this.add.text(x0 + 16, ry + 11, name.toUpperCase(), textStyle(11, INK)).setOrigin(0, 0.5).setInteractive({ useHandCursor: true }).on('pointerup', () => this.openTree(k));
      items.push(hit, this.add.text(x0 + W - 16, ry + 11, `${done}/${ids.length}`, textStyle(11, done === ids.length ? PALETTE.radioattivo : PALETTE.tenue)).setOrigin(1, 0.5));
    });
    items.push(this.btn('APRI L\'ALBERO DELLA RICERCA ›', x0 + 16, y0 + H - 56, W - 32, true, () => this.openTree(r ? BALANCE.tech[r.id].branch : 'esercito'), 14, true));
  }

  /** Scheda a destra con dettagli e azione (costruisci / migliora / spedisci / ritira). */
  private openPanel(spot: Spot, mode?: string) {
    const fresh = spot !== this.panelSpot; // scheda appena aperta (non un ridisegno per i timer): entra con una dissolvenza
    this.panel?.destroy();
    if (mode !== undefined || spot !== this.panelSpot) this.panelMode = mode ?? '';
    this.panelSpot = spot;
    this.refreshNav();
    this.panelKey = this.panelState(spot, Date.now());
    const { x0, y0, W, H } = this.drawPage(spot);
    // la cornice di navigazione (depth 50, sempre sopra) si nasconde finché la pagina è aperta
    for (const { btn } of this.navBtns) btn.setVisible(false);
    const items: Phaser.GameObjects.GameObject[] = [];
    // fascicolo: riquadro scuro velato sulla foto, filo sottile (niente etichette: il titolo è in testata)
    const fg = this.add.graphics();
    panel(fg, x0, y0, W, H, 0.86);
    items.push(fg);
    const now = Date.now();

    if (spot === 'test') {
      this.fillTest(items, x0, y0, W, H);
    } else if (spot === 'mercato') {
      this.fillShop(items, x0, y0 - 28, W, H + 28);
    } else if (spot === 'gioca') {
      this.fillPrep(items, x0, y0, W, H);
    } else if (spot === 'archivio') {
      this.fillLab(items, x0, y0 - 28, W, H + 28);
    } else if (spot === 'alloggi') {
      this.fillAlloggi(items, x0, y0 - 28, W, H + 28);
    } else if (spot === 'cantiere') {
      this.fillWorks(items, x0, y0 - 28, W, H + 28);
    } else if (spot === 'ricerca') {
      this.fillResearch(items, x0, y0 - 28, W, H + 28);
    } else if (spot === 'radar' && this.panelMode !== 'build' && this.profile.buildings.radar > 0) {
      this.fillRadar(items, x0, y0 - 28, W, H + 28);
    } else if (spot === 'spedizione') {
      const T = buildingText.spedizione;
      items.push(this.add.text(x0 + 18, y0 + 18, T.desc, textStyle(11, PALETTE.tenue, false)).setWordWrapWidth(W - 36));
      const e = this.profile.expedition;
      if (e && e.until > now) {
        items.push(this.add.text(x0 + 16, y0 + 72, `${T.kinds[e.kind]}\nIn viaggio: torna tra ${fmtTime(e.until - now)}`, textStyle(14, PALETTE.ruggine)));
      } else if (e) {
        items.push(this.add.text(x0 + 16, y0 + 72, 'Le squadre sono rientrate cariche!', textStyle(14, PALETTE.ocra)));
        items.push(this.bagRow(e.reward, x0 + 16, y0 + 104));
        items.push(this.btn('RITIRA IL BOTTINO', x0 + 16, y0 + H - 60, W - 32, true, () => {
          const kind = this.profile.expedition?.kind ?? 'breve';
          const got = collectExpedition(this.profile, Date.now());
          if (!got) return;
          analytics.design(['spedizione', 'ritira', kind]); // % che torna a ritirare
          analytics.resources('source', got, 'spedizione', kind);
          saveProfile(this.profile);
          this.closePanel();
          this.redrawSpot('spedizione');
          this.updateStash();
          const s = this.spots.get('spedizione')!;
          this.burst.setParticleTint(PALETTE.ocra);
          this.burst.explode(30, s.x, s.y);
          this.toast(`+${got.metallo} metallo · +${got.benzina} benzina · +${got.cibo} cibo`, PALETTE.radioattivo);
        }, 16, true));
      } else {
        // tabella delle missioni: tipo · durata · costo · bottino atteso; si tocca la riga per partire
        const cx = [x0 + 16, x0 + 16 + (W - 32) * 0.38, x0 + 16 + (W - 32) * 0.56, x0 + 16 + (W - 32) * 0.74], ty = y0 + 70;
        ['missione', 'durata', 'costo', 'bottino'].forEach((h, k) => items.push(this.add.text(cx[k] + 6, ty, h, italic(10))));
        EXPEDITIONS.forEach((kind: ExpeditionKind, i) => {
          const E = BALANCE.camp.expeditions[kind];
          const cost = expeditionCost(kind);
          const ok = this.profile.stash.cibo >= cost;
          const ry = ty + 18 + i * 46;
          const r = this.add.rectangle(x0 + 16, ry, W - 32, 40, PALETTE.inchiostro).setOrigin(0).setStrokeStyle(1.2, INK, ok ? 0.75 : 0.25);
          if (ok) {
            r.setInteractive({ useHandCursor: true }).on('pointerover', () => r.setFillStyle(PALETTE.pannelloAlto)).on('pointerout', () => r.setFillStyle(PALETTE.inchiostro));
            r.on('pointerup', () => {
              if (!startExpedition(this.profile, kind, Date.now())) return;
              analytics.design(['spedizione', 'parti', kind]);
              saveProfile(this.profile);
              this.closePanel();
              this.redrawSpot('spedizione');
              this.updateStash();
              this.toast('Le squadre partono. Torneranno con quello che trovano.', PALETTE.carta);
            });
          }
          items.push(r,
            this.add.text(cx[0] + 6, ry + 20, T.kinds[kind], textStyle(12, INK)).setOrigin(0, 0.5).setAlpha(ok ? 1 : 0.5),
            this.add.text(cx[1] + 6, ry + 20, fmtTime(expeditionTimeSec(this.profile, kind) * 1000), textStyle(12, INK)).setOrigin(0, 0.5),
            this.add.text(cx[2] + 6, ry + 20, cost ? `${cost} cibo` : 'gratis', textStyle(12, ok ? INK : PALETTE.ko)).setOrigin(0, 0.5),
            this.add.text(cx[3] + 6, ry + 20, `${E.metallo[0]}–${E.metallo[1]} met.\n${E.benzina[0]}–${E.benzina[1]} benz. · ${E.cibo[0]}–${E.cibo[1]} cibo`, textStyle(9, PALETTE.tenue, false)).setOrigin(0, 0.5));
        });
      }
    } else {
      const T = buildingText[spot];
      const lvl = this.profile.buildings[spot];
      // cosa fa la stanza (una frase), poi i livelli come celle: piena = fatto, ambra = in cantiere, filo = da fare
      const building = this.profile.construction?.id === spot;
      // a cosa serve (testo di lettura), poi i livelli: numero, nome grande, effetto sotto; il prossimo evidenziato
      items.push(label(this, x0 + 18, y0 + 16, 'a cosa serve', OPS.label, 9));
      const desc = body(this, x0 + 18, y0 + 32, T.desc, 13, OPS.text, W - 36);
      items.push(desc);
      let ty = desc.y + desc.height + 14;
      // Laboratorio e Arsenale: all'albero della ricerca; Radar: al registro
      const links: [string, () => void][] = [];
      if (spot === 'radar' && lvl > 0) links.push(['registro ›', () => this.openPanel(spot, '')]);
      if (spot === 'arsenale') links.push(['albero degli armamenti ›', () => this.openTree('armamenti')]);
      if (spot === 'laboratorio') links.push(['albero della ricerca ›', () => this.openTree('esercito')], [`archivio ${loreFragments(this.profile).length}/${loreTotal} ›`, () => this.openPanel('archivio')]);
      let lx = x0 + 18;
      for (const [lbl, run] of links) { const t = label(this, lx, ty, lbl, OPS.accent, 10).setInteractive({ useHandCursor: true }).on('pointerup', run); items.push(t); lx += t.width + 22; }
      if (links.length) ty += 26;
      const tg = this.add.graphics();
      items.push(tg);
      items.push(label(this, x0 + 18, ty, `livelli · ${lvl}/${T.levels.length}`, OPS.label, 9));
      rule(tg, x0 + 18, x0 + W - 18, ty + 18);
      ty += 28;
      const step = Math.min(48, (y0 + H - 130 - ty) / T.levels.length);
      T.levels.forEach((txt, i) => {
        const ly = ty + i * step, done = i < lvl, now = i === lvl, [nm, eff] = levelParts(txt);
        if (now) tg.fillStyle(0x2b333b, 0.7).fillRect(x0 + 12, ly - 4, W - 24, step - 4).fillStyle(building ? PALETTE.allerta : OPS.text, 1).fillRect(x0 + 12, ly - 4, 2, step - 4);
        // numero: pieno se fatto, filo se prossimo, tenue se da fare
        tg.fillStyle(OPS.text, done ? 1 : 0).fillRect(x0 + 20, ly + 2, 18, 18).lineStyle(1, OPS.text, done ? 0 : now ? 1 : 0.35).strokeRect(x0 + 20.5, ly + 2.5, 17, 17);
        items.push(label(this, x0 + 29, ly + 11, String(i + 1), done ? 0x0a0d10 : now ? OPS.text : OPS.label, 9).setOrigin(0.5),
          value(this, x0 + 48, ly + 1, nm.toUpperCase(), 15, done ? OPS.text : now ? 0xffffff : OPS.label).setAlpha(done ? 0.8 : 1));
        if (eff && step >= 36) items.push(body(this, x0 + 48, ly + 21, eff, 11, done || now ? OPS.body : OPS.label).setWordWrapWidth(W - 70).setMaxLines(1));
        if (done) items.push(label(this, x0 + W - 22, ly + 11, 'fatto', OPS.gain, 8).setOrigin(1, 0.5));
        else if (now) items.push(label(this, x0 + W - 22, ly + 11, building ? 'in cantiere' : 'prossimo', building ? PALETTE.allerta : OPS.text, 8).setOrigin(1, 0.5));
      });
      const c = this.profile.construction;
      const next = nextLevel(this.profile, spot);
      if (c && c.id === spot) {
        const total = BALANCE.camp.buildings[spot][lvl].timeSec * 1000;
        const pct = 1 - (c.until - now) / total;
        items.push(this.add.rectangle(x0 + 16, y0 + H - 70, W - 32, 10, PALETTE.inchiostro).setOrigin(0).setStrokeStyle(1, INK, 0.6));
        items.push(this.add.rectangle(x0 + 16, y0 + H - 70, (W - 32) * Phaser.Math.Clamp(pct, 0, 1), 10, PALETTE.allerta).setOrigin(0));
        // accanto al tempo: finisci subito pagando metallo (come al Mercato)
        const half = (W - 32 - 8) / 2, cost = rushCost(c.until, now), ok = this.profile.stash.metallo >= cost;
        items.push(this.btn(`IN COSTRUZIONE · ${fmtTime(c.until - now)}`, x0 + 16, y0 + H - 54, half, false, () => {}, 12));
        items.push(this.btn(`FINISCI ORA · ${cost} METALLO`, x0 + 24 + half, y0 + H - 54, half, ok, () => {
          if (!rush(this.profile, 'construction', Date.now())) return;
          analytics.design(['mercato', 'accelera', 'construction'], cost);
          saveProfile(this.profile);
          this.closePanel();
          this.settleAll(false);
        }, 12));
      } else if (next) {
        this.costChips(items, next.cost, next.timeSec, x0 + 16, y0 + H - 110, W - 32);
        const block = buildBlock(this.profile, spot);
        const why = { busy: 'cantiere occupato', cost: 'risorse insufficienti', comando: `serve il centro di comando liv. ${lvl}`, max: '' } as const;
        const lbl = block ? why[block] : `${lvl ? 'MIGLIORA' : 'COSTRUISCI'} · ${fmtTime(next.timeSec * 1000)}`;
        items.push(this.btn(lbl.toUpperCase(), x0 + 16, y0 + H - 54, W - 32, !block, () => {
          if (!startBuild(this.profile, spot, Date.now())) return;
          analytics.design(['accampamento', 'costruisci', spot], lvl + 1);
          analytics.resources('sink', next.cost, 'edificio', spot);
          saveProfile(this.profile);
          this.closePanel();
          this.redrawSpot(spot as BuildingId);
          this.updateStash();
          this.toast(`Cantiere aperto: ${T.name}`, PALETTE.carta);
        }, 16, true));
      } else {
        items.push(label(this, x0 + 18, y0 + H - 36, 'livello massimo raggiunto', OPS.gain, 10));
      }
    }
    this.panel = this.add.container(0, 0, items).setDepth(40);
    if (fresh) {
      this.panel.setAlpha(0).setY(8);
      this.tweens.add({ targets: this.panel, alpha: 1, y: 0, duration: 170, ease: 'Quad.easeOut' });
    }
  }

  /** Mercato: scambi tra risorse, rifornimenti per la prossima campagna, lavori finiti subito. Solo risorse di gioco. */
  private fillShop(items: Phaser.GameObjects.GameObject[], x0: number, y0: number, W: number, _H: number) {
    const p = this.profile, P = this.portrait, S = BALANCE.shop, now = Date.now();
    const done = (msg: string) => {
      saveProfile(p);
      this.updateStash();
      buzz(12);
      this.toast(msg, PALETTE.radioattivo);
      this.openPanel('mercato');
    };
    const desc = this.add.text(x0 + 16, y0 + 44, shopText.desc, textStyle(10, PALETTE.tenue, false)).setWordWrapWidth(W - 32);
    items.push(desc);
    const g = this.add.graphics(); // icone: aggiunte in fondo, sopra le schede
    const tile = (x: number, y: number, w: number, h: number, ok: boolean, on: boolean, run: () => void) => {
      const r = this.add.rectangle(x, y, w, h, on ? PALETTE.pannelloAlto : PALETTE.inchiostro).setOrigin(0).setStrokeStyle(1, on ? PALETTE.ocra : INK, on ? 1 : ok ? 0.7 : 0.25)
        .setAlpha(ok || on ? 1 : 0.55);
      if (ok) r.setInteractive({ useHandCursor: true }).on('pointerup', run);
      items.push(r);
    };
    // scambio: 50 di una → 30 di un'altra
    let y = Math.max(y0 + (P ? 82 : 70), desc.y + desc.height + 8); // descrizione su più righe (colonna stretta)
    items.push(this.add.text(x0 + 16, y, shopText.trade, textStyle(10, PALETTE.ocra)));
    y += 18;
    const pairs = RESOURCES.flatMap((a) => RESOURCES.filter((b) => b !== a).map((b) => [a, b] as const));
    const cols = P ? 2 : 3, tw = (W - 32 - (cols - 1) * 6) / cols, th = 36;
    pairs.forEach(([a, b], k) => {
      const x = x0 + 16 + (k % cols) * (tw + 6), ty = y + Math.floor(k / cols) * (th + 6);
      const ok = p.stash[a] >= S.trade.give;
      tile(x, ty, tw, th, ok, false, () => { if (trade(p, a, b)) done(`SCAMBIO · −${S.trade.give} ${RESOURCE_INFO[a].name.toLowerCase()} · +${S.trade.get} ${RESOURCE_INFO[b].name.toLowerCase()}`); });
      drawResourceIcon(g, a, x + 18, ty + th / 2, 7);
      items.push(this.add.text(x + 30, ty + th / 2, String(S.trade.give), textStyle(13, ok ? INK : PALETTE.tenue)).setOrigin(0, 0.5),
        this.add.text(x + tw / 2, ty + th / 2, '→', textStyle(13, PALETTE.ocra)).setOrigin(0.5));
      drawResourceIcon(g, b, x + tw - 44, ty + th / 2, 7);
      items.push(this.add.text(x + tw - 32, ty + th / 2, String(S.trade.get), textStyle(13, ok ? PALETTE.ok : PALETTE.tenue)).setOrigin(0, 0.5));
    });
    y += Math.ceil(pairs.length / cols) * (th + 6) + 10;
    // rifornimenti: uno per tipo, valgono per la prossima campagna
    items.push(this.add.text(x0 + 16, y, shopText.supplies, textStyle(10, PALETTE.ocra)));
    y += 18;
    const scols = P ? 1 : 3, sw = (W - 32 - (scols - 1) * 6) / scols, sh = P ? 44 : 64;
    SUPPLIES.forEach((k, i) => {
      const T = shopText.items[k], D = S.supplies[k], own = (p.supplies ?? []).includes(k), ok = !own && canAfford(p.stash, D.cost);
      const x = x0 + 16 + (i % scols) * (sw + 6), ty = y + Math.floor(i / scols) * (sh + 6);
      tile(x, ty, sw, sh, ok, own, () => { if (buySupply(p, k)) done(`${T.name.toUpperCase()} · pronti per la prossima campagna`); });
      items.push(this.add.text(x + 10, ty + 6, T.name.toUpperCase(), textStyle(11, own ? PALETTE.ocra : INK)),
        this.add.text(x + 10, ty + 22, T.desc, textStyle(9, PALETTE.tenue, false)));
      if (own) items.push(this.add.text(x + sw - 10, ty + (P ? sh / 2 : sh - 12), '✓ PRONTO', textStyle(10, PALETTE.ocra)).setOrigin(1, 0.5));
      else this.costRow(g, items, D.cost, P ? x + sw - 150 : x + 10, P ? ty + sh / 2 : ty + sh - 12, p.stash);
    });
    y += Math.ceil(SUPPLIES.length / scols) * (sh + 6) + 10;
    // lavori in corso: finiti subito pagando metallo
    items.push(this.add.text(x0 + 16, y, shopText.rush, textStyle(10, PALETTE.ocra)));
    y += 18;
    const jobs = [
      { what: 'construction' as const, job: p.construction, name: p.construction ? `${buildingText[p.construction.id].name} liv. ${p.buildings[p.construction.id] + 1}` : '' },
      { what: 'research' as const, job: p.research, name: p.research ? techInfo(p.research.id).name : '' },
    ].filter((j) => j.job && j.job.until > now);
    if (!jobs.length) items.push(this.add.text(x0 + 16, y + 4, 'Nessun cantiere o ricerca in corso.', textStyle(11, PALETTE.tenue, false)));
    jobs.forEach((j, i) => {
      const cost = rushCost(j.job!.until, now), ok = p.stash.metallo >= cost;
      items.push(this.btn(`FINISCI ORA: ${j.name.toUpperCase()} · ${cost} METALLO`, x0 + 16, y + i * 46, W - 32, ok, () => {
        if (!rush(p, j.what, Date.now())) return;
        analytics.design(['mercato', 'accelera', j.what], cost);
        saveProfile(p);
        this.closePanel();
        this.settleAll(false);
      }, 12));
    });
    items.push(g);
  }

  /** Costo del prossimo livello a schede: icona, quanto serve, quanto hai (barra verde se basta, rossa se no) e tempo. */
  private costChips(items: Phaser.GameObjects.GameObject[], cost: Bag, timeSec: number, x: number, y: number, w: number) {
    const have = this.profile.stash, rs = RESOURCES.filter((r) => cost[r] > 0), n = rs.length + 1, cw = (w - (n - 1) * 6) / n, ch = 48;
    const g = this.add.graphics();
    items.push(g);
    rs.forEach((r, i) => {
      const cx = x + i * (cw + 6), ok = have[r] >= cost[r];
      g.fillStyle(PALETTE.inchiostro, 1).fillRect(cx, y, cw, ch).lineStyle(1.2, ok ? INK : PALETTE.ko, ok ? 0.7 : 1).strokeRect(cx, y, cw, ch);
      drawResourceIcon(g, r, cx + 16, y + 18, 8);
      g.fillStyle(PALETTE.linea, 1).fillRect(cx + 8, y + ch - 9, cw - 16, 4);
      g.fillStyle(ok ? PALETTE.radioattivo : PALETTE.ko, 1).fillRect(cx + 8, y + ch - 9, (cw - 16) * Math.min(1, have[r] / cost[r]), 4);
      // scheda stretta (pagina della stanza): "hai" va sotto il numero invece che accanto
      const narrow = cw < 110;
      items.push(this.add.text(cx + 30, y + (narrow ? 14 : 18), String(cost[r]), textStyle(15, ok ? INK : PALETTE.ko)).setOrigin(0, 0.5),
        this.add.text(narrow ? cx + 30 : cx + cw - 8, narrow ? y + 30 : y + 18, `hai ${have[r]}`, textStyle(9, PALETTE.tenue, false)).setOrigin(narrow ? 0 : 1, 0.5));
    });
    const tx = x + rs.length * (cw + 6);
    dashedBox(g, tx, y, cw, ch, INK, 0.7);
    items.push(this.add.text(tx + cw / 2, y + 14, 'tempo', italic(10)).setOrigin(0.5),
      this.add.text(tx + cw / 2, y + 31, fmtTime(timeSec * 1000), textStyle(14, INK)).setOrigin(0.5));
  }

  /** Costo in fila: icona, quanto serve (rosso se non basta). */
  private costRow(g: Phaser.GameObjects.Graphics, items: Phaser.GameObjects.GameObject[], cost: Bag, x: number, y: number, have: Bag) {
    let cx = x;
    for (const r of RESOURCES) {
      if (!cost[r]) continue;
      drawResourceIcon(g, r, cx + 6, y, 6);
      const t = this.add.text(cx + 15, y, String(cost[r]), textStyle(11, have[r] < cost[r] ? PALETTE.ko : INK)).setOrigin(0, 0.5);
      items.push(t);
      cx += t.width + 26;
    }
  }

  /** Modalità test: sblocca tutto per provare armi, civiltà e ricerche senza aspettare; si torna indietro azzerando il profilo. */
  private fillTest(items: Phaser.GameObjects.GameObject[], x0: number, y0: number, W: number, H: number) {
    const p = this.profile;
    items.push(this.add.text(x0 + 16, y0 + 10, 'MODALITÀ TEST', textStyle(16, PALETTE.allerta)));
    const txt = p.test
      ? 'ATTIVA. Postazioni al massimo, tutte le ricerche, risorse piene, civiltà sbloccate, cantieri e spedizioni istantanei, +1000 truppe a inizio campagna, abilità con ricarica ridotta.'
      : 'Sblocca subito tutto: postazioni al massimo (tutte le armi e le abilità), tutte le ricerche, risorse piene, civiltà sbloccate, cantieri e spedizioni istantanei, +1000 truppe a inizio campagna.\n\nServe solo per provare il gioco: i progressi veri si perdono.';
    items.push(this.add.text(x0 + 16, y0 + 46, txt, textStyle(11, PALETTE.carta, false)).setWordWrapWidth(W - 32).setLineSpacing(4));
    const restart = () => this.scene.restart();
    if (!p.test) {
      items.push(this.btn('ATTIVA LA MODALITÀ TEST', x0 + 16, y0 + H - 104, W - 32, true, () => {
        enableTestMode(p);
        saveProfile(p);
        analytics.design(['test', 'attiva']);
        restart();
      }, 13));
    }
    items.push(this.btn(p.test ? 'ESCI: AZZERA IL PROFILO' : 'AZZERA IL PROFILO', x0 + 16, y0 + H - 56, W - 32, true, () => {
      this.profile = resetProfile();
      restart();
    }, 13));
  }

  /** Testo cliccabile piccolo (link nei pannelli). */
  private link(label: string, x: number, y: number, onClick: () => void, origin = 1) {
    return this.add.text(x, y, label, textStyle(11, PALETTE.ocra)).setOrigin(origin, 0).setInteractive({ useHandCursor: true }).on('pointerup', onClick);
  }

  /** Preparazione della campagna: vista principale (potenza, mazzo, durata, avvia) e due sotto-viste. Max 6 scelte per vista. */
  private fillPrep(items: Phaser.GameObjects.GameObject[], x0: number, y0: number, W: number, H: number) {
    const p = this.profile;
    const civ = activeCiv(p);
    const back = () => items.push(this.link('‹ indietro', x0 + W - 40, y0 + 12, () => this.openPanel('gioca', '')));
    if (this.panelMode === 'civ') {
      items.push(this.add.text(x0 + 16, y0 + 10, 'SCEGLI LA POTENZA', textStyle(16, INK)));
      back();
      // quattro sistemi politici: immagine (Figma), insegna, nome e forma di governo
      const P = this.portrait, cols = P ? 2 : 4, gap = 8;
      const cw = (W - 32 - (cols - 1) * gap) / cols, ch = P ? 150 : 190, y = y0 + 42;
      CIV_IDS.forEach((id, k) => {
        const st = CIV_STYLE[id], info = civInfo(id), open = civUnlocked(p, id), sel = id === civ;
        const cx = x0 + 16 + (k % cols) * (cw + gap), cy = y + Math.floor(k / cols) * (ch + gap);
        const img = coverImage(this, civImage(id), cx, cy, cw, ch, 0.4).setTint(open ? 0xffffff : 0x555a66).setAlpha(open ? 1 : 0.6);
        const shade = fade(this, cx, cy + ch * 0.35, cw, ch * 0.65, PALETTE.inchiostro, 0, 0.95);
        const frame = this.add.rectangle(cx, cy, cw, ch).setOrigin(0).setStrokeStyle(sel ? 2 : 1, sel ? PALETTE.ocra : PALETTE.linea)
          .setInteractive({ useHandCursor: open });
        frame.on('pointerup', () => {
          if (!open) return this.toast(`${info.name}: ${info.unlock}`, PALETTE.carta);
          p.civ = id;
          saveProfile(p);
          this.openPanel('gioca', 'civ');
        });
        const g = this.add.graphics();
        drawPatch(g, cx + 20, cy + 20, 13, st.fill, st.symbol);
        items.push(img, shade, frame, g,
          this.add.text(cx + 10, cy + ch - 38, info.name.toUpperCase(), textStyle(16, open ? PALETTE.carta : PALETTE.tenue)),
          this.add.text(cx + 10, cy + ch - 16, open ? info.regime : `🔒 ${info.unlock}`, textStyle(9, open ? PALETTE.ocra : PALETTE.tenue, false)));
        if (sel) items.push(this.add.rectangle(cx, cy, cw, 3, PALETTE.ocra).setOrigin(0));
      });
      // scheda della potenza scelta: classe dirigente, dottrina, storia, regole
      const info = civInfo(civ), unit = unitInfo(info.unit);
      const ty = y + (P ? 2 : 1) * (ch + gap) + 4;
      items.push(this.add.text(x0 + 16, ty, info.classe.toUpperCase(), textStyle(11, PALETTE.ocra)).setWordWrapWidth(W - 32),
        this.add.text(x0 + W - 16, ty, `${info.dottrina.toUpperCase()} · «${info.motto}»`, textStyle(9, PALETTE.tenue, false)).setOrigin(1, 0)
          .setVisible(!P));
      items.push(this.add.text(x0 + 16, ty + 20, info.lore, textStyle(11, PALETTE.carta, false)).setWordWrapWidth(W - 32).setLineSpacing(3));
      items.push(this.add.text(x0 + 16, ty + (P ? 82 : 62), [`▸ ${info.bonus}`, `▸ Unità unica: ${unit.name} (Arsenale liv. ${BALANCE.camp.arsenaleUnique})`,
        `▸ Edificio unico: ${info.building} — ${info.buildingText}`].join('\n'), textStyle(10, PALETTE.tenue, false)).setWordWrapWidth(W - 32).setLineSpacing(3));
      return;
    }
    if (this.panelMode === 'fronti') return this.fillFronts(items, x0, y0, W, H);
    // vista principale: in testa la potenza scelta (tocca per cambiarla), poi fronte, mazzo, durata
    const info = civInfo(civ), st = CIV_STYLE[civ];
    const bh = this.portrait ? 120 : 104;
    const banner = coverImage(this, civImage(civ), x0 + 1, y0 + 1, W - 2, bh, 0.4).setTint(0xc8d6e6);
    items.push(banner, fade(this, x0 + 1, y0 + 1, W - 2, bh, PALETTE.inchiostro, 0.35, 0.97));
    const bp = this.add.graphics();
    drawPatch(bp, x0 + 34, y0 + bh - 34, 16, st.fill, st.symbol);
    items.push(bp, this.add.text(x0 + 60, y0 + bh - 56, info.name.toUpperCase(), textStyle(24, INK)),
      this.add.text(x0 + 60, y0 + bh - 22, `${info.regime} · ${info.bonus}`, textStyle(9, PALETTE.carta, false)).setWordWrapWidth(W - 90));
    if (civChoice(p)) {
      const hit = this.add.rectangle(x0 + 1, y0 + 1, W - 2, bh, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true });
      hit.on('pointerup', () => this.openPanel('gioca', 'civ'));
      items.push(hit, this.add.text(x0 + W - 16, y0 + 10, 'cambia potenza ›', textStyle(10, PALETTE.ocra)).setOrigin(1, 0));
    }
    const row = (y: number, h: number, text: string, onClick: (() => void) | null, warn = false) => {
      // riga traslucida come nella home; etichetta in mono, rossa se avverte di un pericolo
      const r = this.add.rectangle(x0 + 16, y, W - 32, h, 0x2b333b, 0.55).setOrigin(0);
      if (onClick) r.setInteractive({ useHandCursor: true }).on('pointerup', onClick).on('pointerover', () => r.setFillStyle(0x2b333b, 0.85)).on('pointerout', () => r.setFillStyle(0x2b333b, 0.55));
      items.push(r, label(this, x0 + 26, y + 7, text, warn ? OPS.loss : OPS.label, 9));
      if (warn) items.push(this.add.rectangle(x0 + 16, y, 2, h, OPS.loss).setOrigin(0));
      if (onClick) items.push(label(this, x0 + W - 26, y + h / 2, '›', OPS.text, 14).setOrigin(1, 0.5));
    };
    let y = y0 + bh + 8;
    // fronte: difficoltà e potenza consigliata (alla Clash)
    const fi = activeFront(p), F = BALANCE.fronts[fi], power = playerPower(p), weak = power < F.power;
    row(y, 52, `FRONTE ${ROMAN[fi]} · ${'★'.repeat(fi + 1)}${'☆'.repeat(BALANCE.fronts.length - fi - 1)}${weak ? ' · NEMICI PIÙ FORTI DI TE' : ''}`, () => this.openPanel('gioca', 'fronti'), weak);
    items.push(body(this, x0 + 26, y + 24, `${F.name} · potenza consigliata ${F.power} (tua ${power}) · bottino ×${F.lootMult}`, 11, weak ? OPS.loss : OPS.text, W - 70));
    y += 58;
    const deck = deckOf(p, civ);
    row(y, 52, `REPARTI · ${deck.length} ${deck.length === 1 ? 'sbloccato' : 'sbloccati'}, tutti in campagna`, null);
    const dg = this.add.graphics();
    const dx = Math.min(110, (W - 60) / Math.max(1, deck.length));
    deck.forEach((t, k) => drawUnitIcon(dg, t, x0 + 34 + k * dx, y + 34, 8, PALETTE.carta));
    items.push(dg);
    if (dx >= 100) deck.forEach((t, k) => items.push(this.add.text(x0 + 48 + k * dx, y + 34, unitInfo(t).name, textStyle(10, PALETTE.carta, false)).setOrigin(0, 0.5))); // tanti reparti: solo i simboli
    y += 58;
    // nemici del fronte: le loro armi (se ne hanno che tu non hai, servono potenziamenti)
    const eg = this.add.graphics();
    const mine = unlockedUnits(p, civ);
    items.push(label(this, x0 + 16, y + 4, 'armi nemiche', OPS.label, 9));
    F.aiUnits.forEach((t, k) => drawUnitIcon(eg, t, x0 + 140 + k * 28, y + 10, 7, mine.includes(t) ? PALETTE.tenue : PALETTE.ko));
    items.push(eg);
    // puntata (alla poker): risorse del Deposito in gioco; più punti, più rende il guadagno; uscire prima costa
    y += 22;
    const K = stakeIndex(p), SK = BALANCE.stake, fee = Math.round(runOptions(p).exitFee * 100);
    // rischi della puntata (in verticale senza la ritirata, che la chiede comunque il tasto ESCI)
    const risks = [`non vinci −${Math.round(SK.lossShare * 100)}%`, ...(this.portrait ? [] : [`ritirata −${fee}%`]), `eliminato −${Math.round(runOptions(p).eliminatedLoss * 100)}%`];
    row(y, 66, `puntata ×${String(SK.mult[K]).replace('.', ',')}`, null);
    items.push(label(this, x0 + 26, y + 22, risks.join(' · '), OPS.label, 8));
    const cw = Math.min(70, (W - 64) / SK.options.length - 6);
    SK.options.forEach((v, k) => {
      const ok = canStake(p, k), cx = x0 + 24 + k * (cw + 6), cy = y + 36;
      const chip = this.add.rectangle(cx, cy, cw, 24, k === K ? OPS.text : 0x000000, k === K ? 1 : 0.3).setOrigin(0)
        .setStrokeStyle(1, ok ? OPS.text : OPS.edge, ok ? 0.7 : 0.4);
      if (ok) chip.setInteractive({ useHandCursor: true }).on('pointerup', () => { p.stake = k; saveProfile(p); this.openPanel('gioca', ''); });
      items.push(chip, label(this, cx + cw / 2, cy + 12, v ? String(v) : 'niente', k === K ? 0x0a0d10 : ok ? OPS.text : OPS.label, 10).setOrigin(0.5));
    });
    y += 50;
    // (briefing tolto dalla pagina: troppo testo; fronte, reparti, armi nemiche e puntata bastano per partire)
    // durata + avvia
    const stack = this.portrait;
    const bw = stack ? W - 32 : (W - 32 - 10) / 2, by = y0 + H - 56;
    if (campaignChoice(p)) {
      const C = BALANCE.campaigns[p.campaign];
      const lbl = `DURATA ${CAMPAIGN_NAME[p.campaign]} · ${Math.round(C.durationMs / 60000)} MIN · ×${C.lootMult} ▸`;
      items.push(this.btn(lbl, x0 + 16, stack ? by - 48 : by, bw, true, () => {
        p.campaign = CAMPAIGNS[(CAMPAIGNS.indexOf(p.campaign) + 1) % CAMPAIGNS.length];
        saveProfile(p);
        this.openPanel('gioca', '');
      }, 12));
    }
    items.push(this.btn('AVVIA LA CAMPAGNA ▶', stack ? x0 + 16 : x0 + 16 + bw + 10, by, bw, true, () => {
      analytics.design(['campagna', 'avvia', `${civ}:${p.campaign}:${fi}`]);
      this.scene.start('Load', { next: 'Run', data: { seed: randomSeed() } });
    }, 13, true));
  }

  /** Fronti: la scala della difficoltà (alla Clash). Si sblocca il successivo vincendo; potenza consigliata contro la tua. */
  private fillFronts(items: Phaser.GameObjects.GameObject[], x0: number, y0: number, W: number, H: number) {
    const p = this.profile;
    const power = playerPower(p), max = p.frontMax ?? 0, sel = activeFront(p);
    items.push(label(this, x0 + 16, y0 + 14, 'fronti', OPS.text, 11),
      label(this, x0 + 90, y0 + 14, `la tua potenza ${power}`, OPS.label, 10),
      this.link('‹ indietro', x0 + W - 40, y0 + 12, () => this.openPanel('gioca', '')));
    const rh = Math.min(46, (H - 52) / BALANCE.fronts.length - 4);
    BALANCE.fronts.forEach((F, k) => {
      const y = y0 + 44 + k * (rh + 4), open = k <= max, weak = power < F.power;
      const r = this.add.rectangle(x0 + 16, y, W - 32, rh, 0x2b333b, k === sel ? 0.9 : 0.5).setOrigin(0)
        .setAlpha(open ? 1 : 0.5).setInteractive({ useHandCursor: open });
      if (k === sel) items.push(this.add.rectangle(x0 + 16, y, 2, rh, OPS.text).setOrigin(0));
      r.on('pointerup', () => {
        if (!open) return this.toast(`Vinci il fronte ${ROMAN[k - 1]} per sbloccarlo`, PALETTE.carta);
        p.front = k;
        saveProfile(p);
        this.openPanel('gioca', '');
      });
      items.push(r,
        value(this, x0 + 34, y + rh / 2, ROMAN[k], 20, open ? OPS.text : OPS.label).setOrigin(0.5),
        label(this, x0 + 58, y + 6, `${F.name}  ${'★'.repeat(k + 1)}`, open ? OPS.text : OPS.label, 10),
        label(this, x0 + 58, y + rh - 6, open ? `potenza ${F.power}${weak ? ' · troppo forti per te' : ''} · bottino ×${F.lootMult}` : 'vinci il fronte precedente',
          open && weak ? OPS.loss : OPS.label, 8).setOrigin(0, 1));
    });
  }

  /** Archivio della Caduta: i frammenti di lore sbloccati dal ramo "La Caduta" dell'albero. */
  private fillLab(items: Phaser.GameObjects.GameObject[], x0: number, y0: number, W: number, H: number) {
    const frags = loreFragments(this.profile);
    const txt = frags.length ? frags.map((f, i) => `${i + 1}. ${f.name.toUpperCase()}\n${f.lore}`).join('\n\n')
      : 'Nessun frammento. Le ricerche del ramo "La Caduta" riempiono questo archivio.';
    const body = this.add.text(x0 + 16, y0 + 44, txt, textStyle(10, PALETTE.carta, false)).setWordWrapWidth(W - 32).setLineSpacing(3);
    items.push(body);
    items.push(this.link('albero della ricerca ›', x0 + 16, y0 + H - 26, () => this.openTree('caduta'), 0));
    const ly = body.y + body.height + 18; // pagina alta: registro di stanza sotto i fascicoli
    void ly;
  }

  /** Albero della ricerca a tutto schermo, sopra l'HQ. */
  openTree(focus: string) {
    this.closePanel();
    this.scene.launch('Tree', { focus });
    this.scene.bringToTop('Tree');
  }

  /** Nome del comandante: si vede sulla mappa, nell'elenco delle potenze e nei rapporti. */
  private editName(first = false) {
    const p = this.profile;
    askName(first ? 'COME TI CHIAMI, COMANDANTE?' : 'NOME DEL COMANDANTE', p.name ?? '', (name) => {
      p.nameAsked = true;
      if (name) p.name = name;
      saveProfile(p);
      if (name) this.scene.restart();
    });
  }

  /** Dall'albero: apre la scheda di una postazione (per migliorarla). */
  openBuilding(id: BuildingId) {
    this.openPanel(id, 'build');
  }

  /** Dopo l'albero: scorta e moduli aggiornati. */
  refreshAfterTree() {
    this.updateStash();
    for (const id of BUILDINGS) this.redrawSpot(id);
    this.refreshNav();
  }


  /** Sala Radar: registro delle campagne (record locali; la classifica online è fuori dall'MVP). */
  private fillRadar(items: Phaser.GameObjects.GameObject[], x0: number, y0: number, W: number, _H: number) {
    const p = this.profile;
    items.push(this.link('migliora la sala ›', x0 + 16, y0 + _H - 26, () => this.openPanel('radar', 'build'), 0));
    const byCiv = CIV_IDS.map((c) => {
      const h = p.history.filter((r) => r.civ === c);
      return h.length ? `${civInfo(c).name} ${h.filter((r) => r.outcome === 'victory').length}/${h.length}` : '';
    }).filter(Boolean).join(' · ');
    const best = p.history.reduce((m, r) => Math.max(m, r.tiles), p.bestTiles);
    items.push(this.add.text(x0 + 16, y0 + 40, `CAMPAGNE ${p.runs} · VITTORIE ${p.wins} · TERRITORIO MAX ${best}\n${byCiv || 'Nessuna campagna registrata.'}`,
      textStyle(11, PALETTE.carta)).setLineSpacing(4).setWordWrapWidth(W - 32));
    const OUT: Record<string, string> = { victory: 'VITTORIA', retreat: 'RITIRATA', eliminated: 'ELIMINATO', timeout: 'FINE TEMPO' };
    const rows = p.history.slice(0, 7).map((r) => {
      const d = new Date(r.at);
      const when = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return `${when}  ${civInfo(r.civ).name.toUpperCase().padEnd(12)} ${CAMPAIGN_NAME[r.campaign].padEnd(8)} ${(OUT[r.outcome] ?? r.outcome).padEnd(9)} ${String(r.tiles).padStart(4)} caselle  ${fmtTime(r.timeMs)}`;
    });
    const list = this.add.text(x0 + 16, y0 + 92, rows.length ? rows.join('\n') : '', textStyle(9, PALETTE.ocra, false)).setLineSpacing(5);
    items.push(list);
    // pagina alta: sotto il registro, il registro di stanza
    const ly = list.y + list.height + 18;
    void ly;
  }

  /** Riga di risorse (costo o bottino); in rosso quelle che non bastano. */
  private bagRow(bag: Bag, x: number, y: number, have?: Bag) {
    const c = this.add.container(0, 0);
    const g = this.add.graphics();
    c.add(g);
    let cx = x;
    for (const r of RESOURCES) {
      if (!bag[r]) continue;
      drawResourceIcon(g, r, cx + 6, y + 8, 6);
      const short = have && have[r] < bag[r];
      const t = this.add.text(cx + 16, y + 8, `${bag[r]} ${RESOURCE_INFO[r].name.toLowerCase()}`, textStyle(12, short ? PALETTE.ko : INK)).setOrigin(0, 0.5);
      c.add(t);
      cx += t.width + 30;
    }
    if (have && !canAfford(have, bag)) c.add(this.add.text(x, y + 20, 'servono altre run', textStyle(10, PALETTE.ko, false)));
    return c;
  }

  /** primary = azione principale della scheda: riquadro avorio pieno (una sola per scheda); le altre solo col filo. */
  private btn(label: string, x: number, y: number, w: number, enabled: boolean, onClick: () => void, size = 16, primary = false) {
    const b = new Button(this, label, w, 40, () => enabled && onClick(), size);
    b.setPosition(x, y).setAlpha(enabled ? 1 : 0.45);
    if (primary && enabled) b.setPrimary();
    return b;
  }

  private toast(msg: string, color: number) {
    const { width } = view(this);
    this.lastToast?.destroy();
    const ty = this.portrait ? 160 : 90;
    const t = (this.lastToast = note(this, width / 2, ty - 20, Math.min(420, width - 40), msg, color).setDepth(60).setAlpha(0));
    this.tweens.add({ targets: t, alpha: 1, y: ty - 10, duration: 220 });
    this.tweens.add({ targets: t, alpha: 0, delay: 2800, duration: 400, onComplete: () => t.destroy() });
  }
}
