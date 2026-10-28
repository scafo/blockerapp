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
import { drawRoom, type RoomId, type RoomState } from '../ui/roomArt';

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
// posto nello schema: [colonna, fila]
const GRID: Record<MapSpot, [number, number]> = {
  laboratorio: [0, 0], comando: [0, 1], arsenale: [0, 2], radar: [1, 0], deposito: [1, 1], mercato: [1, 2], archivio: [2, 0], spedizione: [2, 1], alloggi: [2, 2],
};
const CAMPAIGNS: CampaignId[] = ['breve', 'standard', 'lunga'];
const CAMPAIGN_NAME: Record<CampaignId, string> = { breve: 'BREVE', standard: 'STANDARD', lunga: 'LUNGA' };
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
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
  private plan = { x: 0, y: 0, w: 0, h: 0 }; // area della planimetria
  private spotPos = {} as Record<MapSpot, { x: number; y: number }>;
  private clock: Phaser.GameObjects.Text | null = null;
  private portrait = false;
  private safe = { top: 0, right: 0, bottom: 0, left: 0 }; // notch e barra dei gesti (punti)
  private spots = new Map<Spot, { x: number; y: number; g: Phaser.GameObjects.Graphics; deco: Phaser.GameObjects.GameObject[]; label: Phaser.GameObjects.Text }>();
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
    this.panelSpot = null;
    const { width, height } = view(this);
    // verticale: edifici su due file (dietro sull'orizzonte, davanti in basso), campo al centro
    this.portrait = height > width;

    // schema ad albero: tre colonne e tre file di targhette tra il titolo e i tasti
    this.safe = safeInsets();
    const st = this.safe.top, sb = this.safe.bottom, P = this.portrait;
    this.plan = P ? { x: PAD + 8, y: 150 + st, w: width - 2 * PAD - 16, h: height - 150 - 150 - st - sb }
      : { x: PAD + 30, y: 120 + st, w: width - 2 * PAD - 30 - 290, h: height - 120 - 80 - st - sb };
    const cx = P ? [0.17, 0.5, 0.83] : [0.12, 0.5, 0.88], ry = [0.14, 0.5, 0.86];
    this.spotPos = Object.fromEntries(Object.entries(GRID).map(([id, [c, r]]) => [id, { x: this.plan.x + this.plan.w * cx[c], y: this.plan.y + this.plan.h * ry[r] }])) as typeof this.spotPos;
    this.drawBackdrop();
    this.drawCenter();
    const nodes = (Object.keys(GRID) as MapSpot[]).filter((id) => id !== 'mercato' || this.profile.runs > 0);
    for (const id of nodes) this.makeSpot(id, this.spotPos[id].x, this.spotPos[id].y);
    this.burst = this.add.particles(0, 0, 'dot', {
      speed: { min: 60, max: 180 }, lifespan: 600, scale: { start: 1, end: 0 }, emitting: false,
    }).setDepth(30);

    this.drawHud();
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
    const c = this.profile.construction;
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
  // Stile del Figma di Nico ("Headquarters"): foto fredda a tutto schermo sotto un velo blu notte, titolo centrato con un
  // filetto, scorte in tre riquadri inclinati, le stanze come targhette avorio collegate da fili sottili in uno schema ad
  // albero. Gerarchia: pieno avorio = si tocca (stanze, azione principale); filo = informazione o azione secondaria.

  /** Fondo: foto della base sul ghiaccio, velata di blu notte e più scura in basso. */
  private drawBackdrop() {
    const { width, height } = view(this);
    this.cameras.main.setBackgroundColor(0x0d1420);
    coverImage(this, 'load-ghiaccio', 0, 0, width, height, 0.55).setTint(0xa9bcd4);
    this.add.rectangle(0, 0, width, height, 0x0e1a2e, 0.62).setOrigin(0);
    fade(this, 0, height * 0.5, width, height * 0.5, 0x0a121e, 0, 0.85);
  }

  /** Fili dello schema: una colonna per gruppo di stanze, la fila centrale che le unisce. */
  private drawCenter() {
    const g = this.add.graphics(), S = this.spotPos;
    const line = (a: { x: number; y: number }, b: { x: number; y: number }) => g.lineStyle(1.2, INK, 0.7).lineBetween(a.x, a.y, b.x, b.y);
    line(S.laboratorio, S.arsenale);
    line(S.radar, this.profile.runs > 0 ? S.mercato : S.deposito);
    line(S.archivio, S.alloggi);
    line(S.comando, S.spedizione);
    this.clock = null;
  }

  /** Ingombro di una targhetta (punti). */
  private footprint(_id: MapSpot) {
    return { w: this.portrait ? Math.min(112, this.plan.w / 3 - 12) : 132, h: this.portrait ? 30 : 32 };
  }

  private makeSpot(id: MapSpot, x: number, y: number) {
    const { w, h } = this.footprint(id);
    const g = this.add.graphics();
    const label = this.add.text(x, y, '', textStyle(13, PALETTE.inchiostro)).setOrigin(0.5).setDepth(6);
    const timer = this.add.text(x, y + h / 2 + 7, '', textStyle(10, PALETTE.allerta)).setOrigin(0.5, 0).setDepth(6);
    this.timerTexts.set(id, timer);
    this.spots.set(id, { x, y, g, deco: [], label });
    const hit = this.add.rectangle(x, y, w + 16, h + 16, 0xffffff, 0.001).setInteractive({ useHandCursor: true }).setDepth(7);
    let pressed = false; // apre solo se il tocco è iniziato qui
    hit.on('pointerdown', () => { pressed = true; this.tapRing(id, PALETTE.ocra, 1); buzz(8); });
    hit.on('pointerover', () => this.tweens.add({ targets: [g, label], scale: 1.04, duration: 90 }));
    hit.on('pointerout', () => { pressed = false; this.tweens.add({ targets: [g, label], scale: 1, duration: 90 }); });
    hit.on('pointerup', () => {
      if (!pressed) return;
      pressed = false;
      this.openPanel(id);
    });
  }

  /**
   * Targhetta della stanza: avorio pieno se costruita (si tocca), solo filo se ancora da costruire, filo ambra se in cantiere.
   * Nome breve al centro, livello piccolo a destra, rombi d'aggancio ai fili sui lati; ▲ verde acqua se migliorabile adesso.
   */
  private redrawSpot(id: MapSpot) {
    const spot = this.spots.get(id);
    if (!spot) return;
    spot.deco.forEach((d) => d.destroy());
    spot.deco = [];
    const { w, h } = this.footprint(id), x = spot.x, y = spot.y;
    const isB = (BUILDINGS as string[]).includes(id), lvl = isB ? this.profile.buildings[id as BuildingId] : 1, max = isB ? maxLvl(id as BuildingId) : 0;
    const building = isB && this.profile.construction?.id === id, built = lvl > 0;
    // la grafica e la scritta si disegnano attorno al centro (così si ingrandiscono dal centro al passaggio del mouse)
    const g = spot.g.clear().setPosition(x, y), l = -w / 2, t = -h / 2;
    g.fillStyle(built ? INK : 0x0e1a2e, built ? 1 : 0.85).fillRect(l, t, w, h);
    g.lineStyle(building ? 2 : 1.2, building ? PALETTE.allerta : INK, built && !building ? 0 : 1).strokeRect(l, t, w, h);
    for (const sx of [l, l + w]) g.fillStyle(built ? INK : 0x0e1a2e, 1).fillTriangle(sx, -6, sx + (sx === l ? -6 : 6), 0, sx, 6).lineStyle(1.2, building ? PALETTE.allerta : INK, 1)
      .strokeTriangle(sx, -6, sx + (sx === l ? -6 : 6), 0, sx, 6);
    const name = SHORT[id];
    spot.label.setText(name).setStyle(textStyle(this.portrait ? 11 : 13, built ? PALETTE.inchiostro : INK)).setPosition(x - (max ? 8 : 0), y).setAlpha(1);
    spot.label.setScale(Math.min(1, (w - (max ? 34 : 16)) / Math.max(1, spot.label.width)));
    if (max) spot.deco.push(this.add.text(x + w / 2 - 8, y, `${lvl}/${max}`, textStyle(10, built ? 0x55606a : PALETTE.tenue, false)).setOrigin(1, 0.5).setDepth(6));
    if (isB && lvl < max && !building && !buildBlock(this.profile, id as BuildingId)) {
      const up = this.add.text(x + w / 2 + 4, y - h / 2 - 2, '▲', textStyle(11, PALETTE.radioattivo)).setOrigin(0, 1).setDepth(6);
      this.tweens.add({ targets: up, y: up.y - 3, alpha: 0.4, duration: 600, yoyo: true, repeat: -1 });
      spot.deco.push(up);
    }
    if (id === 'spedizione') this.drawConvoy(spot, x, y, w, h);
  }

  /** Squadre di estrazione: puntino che corre sul filo se sono fuori, ! che lampeggia se sono tornate. */
  private drawConvoy(spot: { deco: Phaser.GameObjects.GameObject[] }, x: number, y: number, w: number, h: number) {
    const e = this.profile.expedition, away = e && e.until > Date.now(), ready = e && e.until <= Date.now();
    if (away) {
      const dot = this.add.rectangle(x, y + h / 2 + 4, 5, 5, PALETTE.allerta).setDepth(5);
      this.tweens.add({ targets: dot, y: this.spotPos.alloggi.y - h / 2 - 4, alpha: 0.2, duration: 2600, repeat: -1 });
      spot.deco.push(dot);
    }
    if (ready) {
      const bang = this.add.text(x + w / 2 + 10, y, '!', textStyle(20, PALETTE.allerta)).setOrigin(0, 0.5).setDepth(6);
      this.tweens.add({ targets: bang, alpha: 0.2, duration: 400, yoyo: true, repeat: -1 });
      spot.deco.push(bang);
    }
  }

  // ---------- interfaccia ----------

  private drawHud() {
    const { width, height } = view(this);
    const P = this.portrait;
    const T = PAD + this.safe.top, B = PAD + this.safe.bottom;
    const p = this.profile;
    // titolo centrato con il filetto che sfuma ai lati (nome del comandante sotto, si tocca per cambiarlo)
    const title = this.add.text(width / 2, T + (P ? 34 : 14), 'Quartier Generale', {
      fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif', fontStyle: '500', fontSize: `${P ? 26 : 34}px`, color: '#ffffff',
      shadow: { offsetX: 0, offsetY: -1, color: '#000000', blur: 18, fill: true },
    }).setOrigin(0.5, 0);
    // 5 tocchi sul titolo = contatore FPS nelle run (test sui telefoni)
    let taps = 0;
    title.setInteractive().on('pointerup', () => {
      if (++taps < 5) return;
      taps = 0;
      const on = !fpsEnabled();
      try { localStorage.setItem(FPS_KEY, on ? '1' : '0'); } catch { /* niente storage */ }
      this.toast(on ? 'Contatore FPS attivo nelle run' : 'Contatore FPS spento', PALETTE.carta);
    });
    const ly = title.y + title.height + 8, lw = title.width + 160, lg = this.add.graphics();
    lg.fillGradientStyle(INK, INK, INK, INK, 0, 0.7, 0, 0.7).fillRect(width / 2 - lw / 2, ly, lw / 2, 1);
    lg.fillGradientStyle(INK, INK, INK, INK, 0.7, 0, 0.7, 0).fillRect(width / 2, ly, lw / 2, 1);
    this.add.text(width / 2, ly + 8, `${p.name || 'Comandante'} ✎`, textStyle(11, PALETTE.tenue, false)).setOrigin(0.5, 0)
      .setInteractive({ useHandCursor: true }).on('pointerup', () => this.editName());
    // scorte: tre riquadri inclinati col filo (informazione, non tasti): icona e quantità; rosso se il Deposito è pieno
    const segW = P ? (width - 2 * PAD - 16) / 3 : 112, segH = 30, skew = 9;
    const sx0 = P ? PAD + 4 : width - PAD - 3 * segW - 2 * 6, sy = P ? T : T + 10;
    const sg = this.add.graphics();
    this.stashBars = [];
    this.stashTexts = RESOURCES.map((r, i) => {
      const x = sx0 + i * (segW + 6);
      sg.fillStyle(0x0e1a2e, 0.7).fillPoints([{ x: x + skew, y: sy }, { x: x + segW, y: sy }, { x: x + segW - skew, y: sy + segH }, { x, y: sy + segH }], true);
      sg.lineStyle(1.2, INK, 0.85).strokePoints([{ x: x + skew, y: sy }, { x: x + segW, y: sy }, { x: x + segW - skew, y: sy + segH }, { x, y: sy + segH }], true);
      drawResourceIcon(sg, r, x + skew + 14, sy + segH / 2, 7);
      return this.add.text(x + segW - skew - 8, sy + segH / 2, '0', textStyle(15, INK)).setOrigin(1, 0.5);
    });
    this.capText = null;
    this.statusText = null;
    // tasto TEST solo in sviluppo o con ?test=1 nell'indirizzo
    const testOk = import.meta.env.DEV || p.test || new URLSearchParams(location.search).has('test');
    if (testOk) this.add.text(PAD, P ? T + 96 : T + 4, p.test ? '[ TEST ATTIVO ]' : '[ TEST ]', textStyle(11, PALETTE.allerta))
      .setInteractive({ useHandCursor: true }).on('pointerup', () => this.openPanel('test'));
    // azione principale: AVVIA CAMPAGNA, in fondo alla fila centrale dello schema (in verticale in basso, larga)
    const bw = P ? width - 2 * PAD : 210, bh = 50;
    const play = new Button(this, 'AVVIA CAMPAGNA  ▶', bw, bh, () => this.onPlay(), 16).setPrimary();
    const S = this.spotPos.spedizione, fw = this.footprint('spedizione').w;
    const px = P ? PAD : width - PAD - bw, py = P ? height - B - bh : S.y - bh / 2;
    play.setPosition(px, py).setDepth(20);
    if (!P) this.add.graphics().lineStyle(1.2, INK, 0.7).lineBetween(S.x + fw / 2 + 6, S.y, px, S.y).fillStyle(PALETTE.ruggine, 1).fillCircle(px - 10, S.y, 4);
    // sotto l'azione principale, piccolo: dove si va
    const fi = activeFront(p), F = BALANCE.fronts[fi], weak = playerPower(p) < F.power;
    this.add.text(px + bw / 2, P ? py - 8 : py + bh + 8, `fronte ${ROMAN[fi]} · ${F.name.toLowerCase()}${weak ? ' · nemici più forti' : ''}`, textStyle(10, weak ? PALETTE.ko : PALETTE.tenue, false))
      .setOrigin(0.5, P ? 1 : 0).setInteractive({ useHandCursor: true }).on('pointerup', () => { if (p.runs > 0) this.openPanel('gioca', 'fronti'); });
    // azioni secondarie (solo filo): cantiere e ricerca
    const sw = 120, sh = 34, sx = P ? PAD : PAD, syy = P ? py - 30 - sh : height - B - sh;
    const sec: [string, () => void][] = [['CANTIERE', () => this.openPanel('cantiere')], ['RICERCA', () => this.openPanel('ricerca')],
      ['AUDIO', () => this.toggleAudio(sx + 2 * (sw + 8), syy)]]; // impostazioni audio (Nico)
    sec.forEach(([lbl, run], i) => new Button(this, lbl, sw, sh, run, 12).setPosition(sx + i * (sw + 8), syy).setDepth(20));
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
    const { w, h } = this.footprint(id);
    const g = this.add.graphics({ x: spot.x, y: spot.y }).setDepth(8);
    g.lineStyle(2, color, 0.9).strokeRect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12);
    g.setScale(0.97 * size);
    this.tweens.add({ targets: g, scale: 1.07 * size, alpha: 0, duration: size > 1 ? 650 : 280, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
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
      // fondo: la stessa foto della base (la parabola per la Sala Radar), più velata perché sopra si legge
      const objs: Phaser.GameObjects.GameObject[] = [
        this.add.rectangle(0, 0, width, height, 0x0d1420, 1).setOrigin(0).setInteractive(), // la base sotto non riceve i tocchi
        coverImage(this, spot === 'radar' ? 'load-radar' : 'load-ghiaccio', 0, 0, width, height, 0.5).setTint(0xa9bcd4),
        this.add.rectangle(0, 0, width, height, 0x0e1a2e, 0.74).setOrigin(0),
      ];
      // testata: ‹ BASE (solo filo: azione secondaria), titolo centrato col filetto, livelli disegnati sotto, scorte
      const back = new Button(this, '‹ BASE', 92, 36, () => this.closePanel(), 13);
      back.setPosition(PAD, T + 4);
      const isB = (BUILDINGS as string[]).includes(spot), lvl = isB ? p.buildings[spot as BuildingId] : 0, max = isB ? maxLvl(spot as BuildingId) : 0;
      const title = this.add.text(width / 2, T + (P ? 46 : 6), info.name, {
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif', fontStyle: '500', fontSize: `${P ? 24 : 30}px`, color: '#ffffff',
        shadow: { offsetX: 0, offsetY: -1, color: '#000000', blur: 16, fill: true },
      }).setOrigin(0.5, 0);
      const hg = this.add.graphics();
      const ly = title.y + title.height + 6, lw = title.width + 140;
      hg.fillGradientStyle(INK, INK, INK, INK, 0, 0.7, 0, 0.7).fillRect(width / 2 - lw / 2, ly, lw / 2, 1);
      hg.fillGradientStyle(INK, INK, INK, INK, 0.7, 0, 0.7, 0).fillRect(width / 2, ly, lw / 2, 1);
      objs.push(back, title, hg);
      if (isB) { // livelli: celle sotto il titolo (piena = fatto, ambra = in cantiere)
        const cw = 22, gap = 5, cx = width / 2 - (max * cw + (max - 1) * gap) / 2;
        for (let i = 0; i < max; i++) {
          const bx = cx + i * (cw + gap), done = i < lvl, now = st.building && i === lvl;
          hg.fillStyle(done ? INK : 0x0e1a2e, done ? 1 : 0.6).fillRect(bx, ly + 10, cw, 8).lineStyle(1.2, now ? PALETTE.allerta : INK, done || now ? 1 : 0.5).strokeRect(bx, ly + 10, cw, 8);
        }
      }
      // scorte: tre riquadri inclinati (informazione), come nella base
      const segW = P ? (width - 2 * PAD - 116) / 3 : 104, segH = 28, skew = 8, sy = T + 6;
      const sx0 = width - PAD - 3 * segW - 2 * 5;
      RESOURCES.forEach((r, i) => {
        const x = sx0 + i * (segW + 5);
        const pts = [{ x: x + skew, y: sy }, { x: x + segW, y: sy }, { x: x + segW - skew, y: sy + segH }, { x, y: sy + segH }];
        hg.fillStyle(0x0e1a2e, 0.7).fillPoints(pts, true).lineStyle(1.1, INK, 0.8).strokePoints(pts, true);
        drawResourceIcon(hg, r, x + skew + 12, sy + segH / 2, 6);
        objs.push(this.add.text(x + segW - skew - 7, sy + segH / 2, String(p.stash[r]), textStyle(13, INK)).setOrigin(1, 0.5));
      });
      if (art) {
        const ag = this.add.graphics();
        ag.fillStyle(0x0b1524, 0.82).fillRect(art.x, art.y, art.w, art.h).lineStyle(1, INK, 0.35).strokeRect(art.x, art.y, art.w, art.h);
        objs.push(ag, ...drawRoom(this, info.room!, art.x, art.y, art.w, art.h, st));
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
    fg.fillStyle(0x0b1524, 0.82).fillRect(x0, y0, W, H).lineStyle(1, INK, 0.35).strokeRect(x0, y0, W, H);
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
      const desc = this.add.text(x0 + 18, y0 + 18, T.desc, textStyle(11, PALETTE.tenue, false)).setWordWrapWidth(W - 36).setLineSpacing(3);
      items.push(desc);
      let ty = desc.y + desc.height + 16;
      // Laboratorio e Arsenale: all'albero della ricerca; Radar: al registro
      const links: [string, () => void][] = [];
      if (spot === 'radar' && lvl > 0) links.push(['registro ›', () => this.openPanel(spot, '')]);
      if (spot === 'arsenale') links.push(['armamenti ›', () => this.openTree('armamenti')]);
      if (spot === 'laboratorio') links.push(['albero della ricerca ›', () => this.openTree('esercito')], [`archivio ${loreFragments(this.profile).length}/${loreTotal} ›`, () => this.openPanel('archivio')]);
      let lx = x0 + 18;
      for (const [lbl, run] of links) { const t = this.link(lbl, lx, ty, run, 0); items.push(t); lx += t.width + 18; }
      if (links.length) ty += 30;
      const tg = this.add.graphics(), step = 30;
      items.push(tg);
      T.levels.forEach((txt, i) => {
        const ly = ty + i * step, done = i < lvl, now = i === lvl;
        if (now) tg.fillStyle(INK, 0.08).fillRect(x0 + 12, ly - 4, W - 24, step - 4);
        tg.fillStyle(done ? INK : 0x0e1a2e, 1).fillRect(x0 + 18, ly + 2, 16, 14).lineStyle(1.2, now && building ? PALETTE.allerta : INK, done || now ? 1 : 0.4).strokeRect(x0 + 18, ly + 2, 16, 14);
        items.push(this.add.text(x0 + 26, ly + 9, String(i + 1), textStyle(9, done ? PALETTE.inchiostro : now ? INK : PALETTE.tenue)).setOrigin(0.5),
          this.add.text(x0 + 46, ly + 9, txt.replace(/^Armamenti: /, ''), textStyle(11, done || now ? INK : PALETTE.tenue, now)).setOrigin(0, 0.5)
            .setWordWrapWidth(W - 70).setMaxLines(1).setAlpha(done ? 0.75 : 1));
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
        items.push(this.add.text(x0 + 16, y0 + H - 44, 'Livello massimo. Il resto lo fa la fantasia.', textStyle(12, PALETTE.ocra)));
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
    const row = (y: number, h: number, label: string, onClick: (() => void) | null, warn = false) => {
      const r = this.add.rectangle(x0 + 16, y, W - 32, h, PALETTE.inchiostro).setOrigin(0).setStrokeStyle(1.2, warn ? PALETTE.ko : INK, warn ? 1 : onClick ? 0.75 : 0.3);
      if (onClick) r.setInteractive({ useHandCursor: true }).on('pointerup', onClick).on('pointerover', () => r.setFillStyle(PALETTE.pannelloAlto)).on('pointerout', () => r.setFillStyle(PALETTE.inchiostro));
      items.push(r, this.add.text(x0 + 24, y + 5, label, italic(11, warn ? PALETTE.ko : TEAL)));
      if (onClick) items.push(this.add.text(x0 + W - 24, y + h / 2, '›', textStyle(18, PALETTE.ocra)).setOrigin(1, 0.5));
    };
    let y = y0 + bh + 8;
    // fronte: difficoltà e potenza consigliata (alla Clash)
    const fi = activeFront(p), F = BALANCE.fronts[fi], power = playerPower(p), weak = power < F.power;
    row(y, 52, `FRONTE ${ROMAN[fi]} · ${'★'.repeat(fi + 1)}${'☆'.repeat(BALANCE.fronts.length - fi - 1)}${weak ? ' · NEMICI PIÙ FORTI DI TE' : ''}`, () => this.openPanel('gioca', 'fronti'), weak);
    items.push(this.add.text(x0 + 24, y + 24, `${F.name} · potenza consigliata ${F.power} (tua ${power}) · bottino ×${F.lootMult}`,
      textStyle(10, weak ? PALETTE.ko : PALETTE.carta, false)).setWordWrapWidth(W - 70));
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
    items.push(this.add.text(x0 + 16, y + 2, 'ARMI NEMICHE', textStyle(9, PALETTE.tenue)));
    F.aiUnits.forEach((t, k) => drawUnitIcon(eg, t, x0 + 112 + k * 28, y + 10, 7, mine.includes(t) ? PALETTE.tenue : PALETTE.ko));
    items.push(eg);
    // puntata (alla poker): risorse del Deposito in gioco; più punti, più rende il guadagno; uscire prima costa
    y += 22;
    const K = stakeIndex(p), SK = BALANCE.stake, fee = Math.round(runOptions(p).exitFee * 100);
    // rischi della puntata (in verticale senza la ritirata, che la chiede comunque il tasto ESCI)
    const risks = [`non vinci −${Math.round(SK.lossShare * 100)}%`, ...(this.portrait ? [] : [`ritirata −${fee}%`]), `eliminato −${Math.round(runOptions(p).eliminatedLoss * 100)}%`];
    row(y, 52, `PUNTATA ×${String(SK.mult[K]).replace('.', ',')} · ${risks.join(' · ')}`, null);
    const cw = Math.min(70, (W - 64) / SK.options.length - 6);
    SK.options.forEach((v, k) => {
      const ok = canStake(p, k), cx = x0 + 24 + k * (cw + 6), cy = y + 22;
      const chip = this.add.rectangle(cx, cy, cw, 24, k === K ? PALETTE.ocra : PALETTE.pannello).setOrigin(0)
        .setStrokeStyle(1, ok ? PALETTE.ocra : PALETTE.linea);
      if (ok) chip.setInteractive({ useHandCursor: true }).on('pointerup', () => { p.stake = k; saveProfile(p); this.openPanel('gioca', ''); });
      items.push(chip, this.add.text(cx + cw / 2, cy + 12, v ? String(v) : 'NIENTE', textStyle(11, k === K ? PALETTE.inchiostro : ok ? PALETTE.carta : PALETTE.tenue)).setOrigin(0.5));
    });
    y += 36;
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
    items.push(this.add.text(x0 + 16, y0 + 10, 'FRONTI', textStyle(16, INK)),
      this.add.text(x0 + 110, y0 + 16, `la tua potenza: ${power}`, textStyle(11, PALETTE.ocra)),
      this.link('‹ indietro', x0 + W - 40, y0 + 12, () => this.openPanel('gioca', '')));
    const rh = Math.min(46, (H - 52) / BALANCE.fronts.length - 4);
    BALANCE.fronts.forEach((F, k) => {
      const y = y0 + 44 + k * (rh + 4), open = k <= max, weak = power < F.power;
      const r = this.add.rectangle(x0 + 16, y, W - 32, rh, k === sel ? PALETTE.pannelloAlto : PALETTE.inchiostro).setOrigin(0)
        .setStrokeStyle(k === sel ? 2 : 1, k === sel ? PALETTE.ocra : PALETTE.linea).setAlpha(open ? 1 : 0.5).setInteractive({ useHandCursor: open });
      r.on('pointerup', () => {
        if (!open) return this.toast(`Vinci il fronte ${ROMAN[k - 1]} per sbloccarlo`, PALETTE.carta);
        p.front = k;
        saveProfile(p);
        this.openPanel('gioca', '');
      });
      items.push(r,
        this.add.text(x0 + 30, y + rh / 2, ROMAN[k], textStyle(18, open ? PALETTE.ocra : PALETTE.tenue)).setOrigin(0.5),
        this.add.text(x0 + 52, y + 5, `${F.name.toUpperCase()}  ${'★'.repeat(k + 1)}`, textStyle(11, open ? PALETTE.carta : PALETTE.tenue)),
        this.add.text(x0 + 52, y + rh - 5, open ? `potenza ${F.power}${weak ? ' · troppo forti per te' : ''} · bottino ×${F.lootMult}` : '🔒 vinci il fronte precedente',
          textStyle(9, open && weak ? PALETTE.ko : PALETTE.tenue, false)).setOrigin(0, 1));
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
