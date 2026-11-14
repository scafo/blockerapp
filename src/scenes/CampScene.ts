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
import { dashedBox, note } from '../ui/schematic';
import { OPS, backBox, body, dot, glass, label, panel, rule, value } from '../ui/ops';
import { audioSettings, onAudioChange } from '../audio/engine';
import { type RoomId, type RoomState } from '../ui/roomArt';

const PAD = 12;
/** Testo lungo: rimpicciolito per stare nella larghezza (mai tagliato). */
const fit = <T extends Phaser.GameObjects.Text>(t: T, w: number): T => t.setScale(Math.min(1, w / Math.max(1, t.width)));
// pianta della base (riferimento di Nico: planimetria tecnica su ardesia)
// risorse mostrate l'ultima volta che la base era aperta: al rientro da una campagna i numeri scorrono fino ai nuovi
let shownStash: number[] | null = null;
const maxLvl = (id: BuildingId) => BALANCE.camp.buildings[id].length;
const INK = PALETTE.carta; // testi chiari sul fondo scuro

// 'gioca' = preparazione della campagna (sala operazioni), 'test' = modalità test; alloggi, archivio, cantiere e ricerca hanno la loro pagina
type Spot = BuildingId | 'spedizione' | 'gioca' | 'test' | 'mercato' | 'alloggi' | 'archivio' | 'cantiere' | 'ricerca';
type MapSpot = BuildingId | 'spedizione' | 'alloggi' | 'archivio' | 'mercato'; // le targhette dello schema
// base in sezione: tre piani di stanze, il Comando al centro del piano alto
const FLOORS: MapSpot[][] = [
  ['radar', 'comando', 'laboratorio'],
  ['arsenale', 'deposito', 'spedizione'],
  ['alloggi', 'archivio', 'mercato'],
];
// nome sulla targa della stanza nella base (le pagine usano il nome intero)
const CELL: Record<MapSpot, string> = {
  comando: 'Centro di Comando', laboratorio: 'Laboratorio', radar: 'Sala Radar', arsenale: 'Arsenale', deposito: 'Deposito',
  spedizione: 'Estrazione', alloggi: 'Alloggi', archivio: 'Archivio', mercato: 'Mercato',
};
// foto di ogni stanza (generate in locale con Draw Things): nella base e come fondo della sua pagina
const ROOM_IMG: Record<Spot, string> = {
  comando: 'room-comando', laboratorio: 'room-laboratorio', radar: 'room-radar', arsenale: 'room-arsenale', deposito: 'room-deposito',
  spedizione: 'room-spedizione', alloggi: 'room-alloggi', archivio: 'room-archivio', mercato: 'room-mercato',
  gioca: 'room-fronte', cantiere: 'room-vuota', ricerca: 'room-laboratorio', test: 'room-comando',
};
// riga sotto il nome: a cosa serve la pagina
const ROLE: Record<MapSpot, string> = {
  comando: 'Livello della base', deposito: 'Scorte e capienza', spedizione: 'Missioni a tempo', alloggi: 'Posti branda',
  arsenale: 'Truppe e armamenti', laboratorio: 'Ricerche', radar: 'Registro e vista', mercato: 'Scambi e rifornimenti', archivio: 'Frammenti della Caduta',
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
  private stripTexts: { cantiere?: Phaser.GameObjects.Text; ricerca?: Phaser.GameObjects.Text; estrazione?: Phaser.GameObjects.Text; audio?: Phaser.GameObjects.Text } = {};
  private clock: Phaser.GameObjects.Text | null = null;
  private portrait = false;
  private safe = { top: 0, right: 0, bottom: 0, left: 0 }; // notch e barra dei gesti (punti)
  private spots = new Map<Spot, { x: number; y: number; g: Phaser.GameObjects.Graphics; deco: Phaser.GameObjects.GameObject[]; label: Phaser.GameObjects.Text; w: number; h: number; left: number; top: number; img?: Phaser.GameObjects.Image }>();
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
  private expKind: ExpeditionKind = 'breve'; // missione scelta nell'Estrazione
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
    // lavori in corso: ambra se attivi, grigio se fermi, verde se c'è qualcosa da ritirare
    const e = this.profile.expedition;
    this.stripTexts.cantiere?.setText(c ? `${buildingText[c.id].name} → liv ${this.profile.buildings[c.id] + 1} · ${fmtTime(c.until - now)}` : 'Libero · tocca una stanza')
      .setColor(hex(c ? PALETTE.allerta : OPS.label));
    this.stripTexts.ricerca?.setText(rs ? `${techInfo(rs.id).name} · ${fmtTime(rs.until - now)}` : this.profile.buildings.laboratorio ? 'Ferma · scegli un progetto' : 'Serve il Laboratorio')
      .setColor(hex(rs ? PALETTE.allerta : OPS.label));
    this.stripTexts.estrazione?.setText(!e ? 'Squadre pronte a partire' : e.until <= now ? 'Di ritorno · ritira il bottino' : `${buildingText.spedizione.kinds[e.kind]} · ${fmtTime(e.until - now)}`)
      .setColor(hex(!e ? OPS.label : e.until <= now ? OPS.gain : PALETTE.allerta));
    for (const [spot, t] of this.timerTexts) {
      if (spot === 'spedizione') t.setText(!e ? '' : e.until <= now ? 'Di ritorno!' : `Torna tra ${fmtTime(e.until - now)}`);
      else {
        const r = this.profile.research;
        t.setText(c && c.id === spot ? `Cantiere ${fmtTime(c.until - now)}` : spot === 'laboratorio' && r ? `Ricerca ${fmtTime(r.until - now)}` : '');
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
  // Base vista in sezione, alla XCOM 2 (scelta di Nico): la montagna di notte, dentro tre piani di stanze illustrate; ogni stanza
  // è una postazione che si tocca. Barra sottile in alto (comandante, scorte, audio), a destra i lavori in corso e in fondo
  // la prossima operazione con l'azione principale. In verticale le stanze vanno su due colonne e la colonna di destra va sotto.

  /** Fondo scuro sotto tutto; la montagna la mette drawHud, che sa dove iniziano le stanze. */
  private drawBackdrop() {
    this.cameras.main.setBackgroundColor(0x05080d);
  }

  /**
   * La montagna della base di notte (vetta con il radar): a tutta larghezza, con la parabola appena sotto la barra in alto;
   * la roccia tagliata continua dietro le stanze.
   */
  private placeMountain(skyTop: number, rockY: number) {
    const { width, height } = view(this);
    const img = this.add.image(0, 0, 'base-esterno').setOrigin(0.5, 0).setDepth(-1).setTint(0xc4d0dc);
    const DISH = 0.22; // dove sta la cima della parabola nell'immagine (in altezza)
    const s = Math.max(width / img.width, height / img.height);
    img.setScale(s).setPosition(width / 2, Math.max(height - img.height * s, Math.min(0, skyTop - DISH * img.height * s)));
    fade(this, 0, rockY, width, height - rockY, 0x05080d, 0.2, 0.7).setDepth(-1);
  }

  /** Immagine della stanza: illustrata se costruita, cantiere vuoto se no. */
  private roomKey(id: MapSpot): string {
    const isB = (BUILDINGS as string[]).includes(id), lvl = isB ? this.profile.buildings[id as BuildingId] : 1;
    const locked = id === 'mercato' && this.profile.runs === 0;
    return lvl > 0 && !locked ? ROOM_IMG[id] : 'room-vuota';
  }

  /** Stanza della base: foto ritagliata nella cella, targa in basso con nome e stato, tutta la cella si tocca. */
  private makeSpot(id: MapSpot, x: number, y: number, w: number, h: number) {
    const g = this.add.graphics().setDepth(3);
    const ph = Math.min(46, Math.max(40, h * 0.3)); // altezza della targa
    const name = label(this, x + 10, y + h - ph + 5, CELL[id], OPS.text, 11).setDepth(6);
    this.spots.set(id, { x: x + w / 2, y: y + h / 2, g, deco: [], label: name, w, h, left: x, top: y });
    const timer = label(this, x + w - 10, y + 8, '', PALETTE.allerta, 9).setOrigin(1, 0).setDepth(6);
    this.timerTexts.set(id, timer);
    const hit = this.add.rectangle(x, y, w, h, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true }).setDepth(7);
    let pressed = false; // apre solo se il tocco è iniziato qui
    hit.on('pointerdown', () => { pressed = true; buzz(8); });
    hit.on('pointerover', () => this.paintRow(id, true));
    hit.on('pointerout', () => { pressed = false; this.paintRow(id, false); });
    hit.on('pointerup', () => {
      if (!pressed) return;
      pressed = false;
      if (id === 'mercato' && this.profile.runs === 0) { this.toast('Il Mercato apre dopo la prima campagna', PALETTE.carta); return; }
      this.tapRing(id, OPS.text, 1);
      this.openPanel(id);
    });
  }

  /** Cornice e targa della stanza; sotto il mouse la foto si accende e la cornice diventa bianca. */
  private paintRow(id: MapSpot, hover: boolean) {
    const r = this.spots.get(id);
    if (!r) return;
    const built = this.roomKey(id) !== 'room-vuota', ph = Math.min(46, Math.max(40, r.h * 0.3));
    r.img?.setTint(hover ? 0xffffff : built ? 0xc9d2da : 0x56606a);
    r.g.clear();
    r.g.fillGradientStyle(0x05080d, 0x05080d, 0x05080d, 0x05080d, 0, 0, 0.88, 0.88).fillRect(r.left, r.top + r.h - ph * 1.8, r.w, ph * 0.8);
    r.g.fillStyle(0x05080d, 0.88).fillRect(r.left, r.top + r.h - ph, r.w, ph);
    r.g.lineStyle(hover ? 2 : 1, hover ? 0xffffff : OPS.edge, hover ? 0.95 : 0.45).strokeRect(r.left + 0.5, r.top + 0.5, r.w - 1, r.h - 1);
  }

  /** Stato della stanza: foto, livello a tacche, migliorabile, da costruire; i timer li scrive update(). */
  private redrawSpot(id: MapSpot) {
    const spot = this.spots.get(id);
    if (!spot) return;
    spot.deco.forEach((d) => d.destroy());
    spot.deco = [];
    const { left: x, top: y, w, h } = spot;
    spot.img = coverImage(this, this.roomKey(id), x, y, w, h, 0.5).setDepth(2);
    spot.deco.push(spot.img);
    this.paintRow(id, false);
    const isB = (BUILDINGS as string[]).includes(id), lvl = isB ? this.profile.buildings[id as BuildingId] : 1, max = isB ? maxLvl(id as BuildingId) : 0;
    const building = isB && this.profile.construction?.id === id, locked = id === 'mercato' && this.profile.runs === 0, built = lvl > 0 && !locked;
    spot.label.setColor(hex(built ? OPS.text : OPS.body));
    const sub = locked ? 'Dopo la prima campagna' : !built ? (building ? 'In costruzione' : 'Da costruire') : ROLE[id];
    spot.deco.push(label(this, x + 10, y + h - 6, sub, built ? OPS.label : building ? PALETTE.allerta : OPS.label, 8).setOrigin(0, 1).setDepth(6));
    // tacche del livello a destra della targa (piene = fatte, ambra = in cantiere)
    if (max) {
      const tw = 7, gap = 3, tx = x + w - 10 - max * (tw + gap) + gap, ty = spot.label.y + spot.label.height / 2 - 4, pg = this.add.graphics().setDepth(6);
      for (let i = 0; i < max; i++) {
        const cur = building && i === lvl;
        pg.fillStyle(cur ? PALETTE.allerta : OPS.text, i < lvl || cur ? 0.9 : 0).fillRect(tx + i * (tw + gap), ty, tw, 8);
        pg.lineStyle(1, OPS.text, i < lvl || cur ? 0 : 0.35).strokeRect(tx + i * (tw + gap) + 0.5, ty + 0.5, tw - 1, 7);
      }
      spot.deco.push(pg);
      // migliorabile adesso: puntino verde accanto al nome
      if (lvl < max && !buildBlock(this.profile, id as BuildingId)) {
        const d = this.add.rectangle(x + 10 + spot.label.width + 10, spot.label.y + spot.label.height / 2, 6, 6, OPS.gain).setDepth(6);
        this.tweens.add({ targets: d, alpha: 0.3, duration: 700, yoyo: true, repeat: -1 });
        spot.deco.push(d);
      }
    }
    if (id === 'spedizione') {
      const e = this.profile.expedition;
      if (e && e.until <= Date.now()) {
        const d = this.add.rectangle(x + 10 + spot.label.width + 10, spot.label.y + spot.label.height / 2, 6, 6, PALETTE.allerta).setDepth(6);
        this.tweens.add({ targets: d, alpha: 0.2, duration: 400, yoyo: true, repeat: -1 });
        spot.deco.push(d);
      }
    }
  }

  // ---------- interfaccia ----------

  private drawHud() {
    const { width, height } = view(this);
    const P = this.portrait, p = this.profile;
    const M = P ? 10 : 18, T = M + this.safe.top, B = M + this.safe.bottom;
    const g = this.add.graphics().setDepth(1);

    // barra in alto: nome del gioco, comandante (si tocca per cambiarlo), scorte, audio
    const barH = P ? 62 : 46, barY = T, L = M, R = width - M;
    glass(g, L, barY, R - L, barH);
    const title = value(this, L + 14, barY + (P ? 6 : barH / 2), 'ARCHEON', P ? 20 : 22).setOrigin(0, P ? 0 : 0.5).setDepth(2);
    // 5 tocchi sul titolo = contatore FPS nelle run (test sui telefoni)
    let taps = 0;
    title.setInteractive().on('pointerup', () => {
      if (++taps < 5) return;
      taps = 0;
      const on = !fpsEnabled();
      try { localStorage.setItem(FPS_KEY, on ? '1' : '0'); } catch { /* niente storage */ }
      this.toast(on ? 'Contatore FPS attivo nelle run' : 'Contatore FPS spento', PALETTE.carta);
    });
    const hx = P ? L + 2 : title.x + title.width + 20;
    label(this, hx, P ? barY + barH + 6 : barY + barH / 2, `Quartier generale · ${p.name || 'Comandante'} ✎`, OPS.label, 9)
      .setOrigin(0, P ? 0 : 0.5).setDepth(2).setInteractive({ useHandCursor: true }).on('pointerup', () => this.editName());
    // audio all'estremo destro, scorte prima (rosso se il Deposito è pieno)
    const audio = label(this, R - 14, barY + (P ? 14 : barH / 2), '', OPS.text, 9).setOrigin(1, 0.5).setDepth(2)
      .setInteractive({ useHandCursor: true }).on('pointerup', () => this.toggleAudio(R - 236, barY));
    this.stripTexts.audio = audio;
    const paintAudio = () => audio.setText(`Audio ${audioSettings().muted ? 'off' : 'on'}`);
    paintAudio();
    const off = onAudioChange(paintAudio);
    this.events.once('shutdown', off);
    this.stashBars = [];
    const sy = P ? barY + barH - 16 : barY + barH / 2, step = P ? (R - L - 28) / 3 : 96;
    let sx = P ? R - 14 : R - 14 - 92;
    this.stashTexts = [...RESOURCES].reverse().map((r) => {
      const t = label(this, sx, sy, '0', OPS.text, 12).setOrigin(1, 0.5).setDepth(2);
      drawResourceIcon(g, r, sx - 58, sy, 6);
      sx -= step;
      return t;
    }).reverse();
    this.capText = null;
    this.statusText = null;
    // tasto TEST solo in sviluppo o con ?test=1 nell'indirizzo
    const testOk = import.meta.env.DEV || p.test || new URLSearchParams(location.search).has('test');
    if (testOk) label(this, P ? R - 2 : L + 2, barY + barH + 6, p.test ? '[ test attivo ]' : '[ test ]', PALETTE.allerta, 8).setOrigin(P ? 1 : 0, 0).setDepth(2)
      .setInteractive({ useHandCursor: true }).on('pointerup', () => this.openPanel('test'));

    // colonna di destra (in verticale: fascia in fondo): lavori in corso e prossima operazione
    const top = barY + barH + (P ? 28 : 14), bottom = height - B;
    const sideW = P ? R - L : Phaser.Math.Clamp(width * 0.25, 250, 330);
    const footH = P ? 198 : 0;
    const side = P ? { x: L, y: bottom - footH, w: sideW, h: footH } : { x: R - sideW, y: top, w: sideW, h: bottom - top };
    this.drawOps(g, side.x, side.y, side.w, side.h, P);

    // stanze: tre piani nella roccia sotto la vetta (in verticale il Comando largo in cima, poi due colonne)
    const gap = P ? 6 : 8;
    const area = P ? { x: L, y: top, w: R - L, h: side.y - 10 - top } : { x: L, y: top, w: side.x - 14 - L, h: bottom - top };
    const surface = P ? 0 : Math.min(170, area.h * 0.2); // in orizzontale si vede la vetta con il radar sopra le stanze
    const rows: MapSpot[][] = P
      ? [['comando'], ['radar', 'laboratorio'], ['arsenale', 'deposito'], ['spedizione', 'alloggi'], ['archivio', 'mercato']]
      : FLOORS;
    const ry0 = area.y + surface, rh = (area.h - surface - gap * (rows.length - 1)) / rows.length;
    this.placeMountain(barY + barH + 4, ry0);
    // roccia scura dietro le stanze, come la sezione della montagna
    g.fillStyle(0x070a0e, 0.72).fillRect(area.x - 4, ry0 - 4, area.w + 8, area.h - surface + 8);
    rows.forEach((row, r) => {
      const cw = (area.w - gap * (row.length - 1)) / row.length;
      row.forEach((id, c) => this.makeSpot(id, area.x + c * (cw + gap), ry0 + r * (rh + gap), cw, rh));
    });
  }

  /**
   * Lavori in corso (cantiere, ricerca, estrazione: righe che si toccano) e prossima operazione con AVVIA CAMPAGNA in fondo,
   * come la coda degli eventi e il tasto della mappa in XCOM 2.
   */
  private drawOps(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, P: boolean) {
    const p = this.profile;
    const rowH = P ? 26 : 46, rows: ['cantiere' | 'ricerca' | 'estrazione', string, Spot][] = [
      ['cantiere', 'Cantiere', 'cantiere'], ['ricerca', 'Ricerca', 'ricerca'], ['estrazione', 'Estrazione', 'spedizione'],
    ];
    let yy = y;
    if (!P) {
      glass(g, x, y, w, 30);
      label(this, x + 12, y + 15, 'In corso', OPS.text, 10).setOrigin(0, 0.5).setDepth(2);
      yy += 36;
    }
    for (const [key, name, spot] of rows) {
      const r = this.add.rectangle(x, yy, w, rowH, OPS.row, 0.62).setOrigin(0).setStrokeStyle(1, OPS.edge, 0.32).setDepth(1)
        .setInteractive({ useHandCursor: true }).on('pointerup', () => this.openPanel(spot))
        .on('pointerover', () => r.setFillStyle(OPS.row, 0.92)).on('pointerout', () => r.setFillStyle(OPS.row, 0.62));
      if (P) {
        label(this, x + 10, yy + rowH / 2, name, OPS.label, 8).setOrigin(0, 0.5).setDepth(2);
        this.stripTexts[key] = label(this, x + w - 10, yy + rowH / 2, '', OPS.text, 9).setOrigin(1, 0.5).setDepth(2);
      } else {
        label(this, x + 12, yy + 8, name, OPS.label, 8).setDepth(2);
        this.stripTexts[key] = label(this, x + 12, yy + 24, '', OPS.text, 10).setDepth(2);
      }
      yy += rowH + (P ? 4 : 6);
    }
    // prossima operazione: fronte, potenza contro consigliata, AVVIA CAMPAGNA (ruggine) nell'angolo in basso a destra
    const fi = activeFront(p), F = BALANCE.fronts[fi], yours = playerPower(p), weak = yours < F.power;
    const bh = P ? 50 : 56, by = y + h - bh;
    const play = new Button(this, 'AVVIA CAMPAGNA', w, bh, () => this.onPlay(), 17).setPrimary();
    play.setPosition(x, by).setDepth(20);
    if (P) {
      label(this, x, by - 8, `Fronte ${ROMAN[fi]} · ${F.name} · potenza ${yours}/${F.power}`, weak ? OPS.loss : OPS.text, 9).setOrigin(0, 1).setDepth(2);
      if (p.runs > 0) label(this, x + w, by - 8, 'cambia ›', OPS.label, 9).setOrigin(1, 1).setDepth(2)
        .setInteractive({ useHandCursor: true }).on('pointerup', () => this.openPanel('gioca', 'fronti'));
      return;
    }
    const oy = by - (weak ? 168 : 136);
    dot(g, x + 3, oy + 7, OPS.accent);
    label(this, x + 14, oy, 'Prossima operazione', OPS.accent, 9).setDepth(2);
    const big = value(this, x - 1, oy + 16, `Fronte ${ROMAN[fi]}`, 38).setDepth(2);
    body(this, x + 1, big.y + big.height, F.name, 13, OPS.text).setDepth(2);
    if (p.runs > 0) label(this, x + w, big.y + big.height + 2, 'Cambia fronte ›', OPS.label, 9).setOrigin(1, 0).setDepth(2)
      .setInteractive({ useHandCursor: true }).on('pointerup', () => this.openPanel('gioca', 'fronti'));
    const pw = big.y + big.height + 26;
    label(this, x, pw, 'Potenza', OPS.label, 8).setDepth(2);
    value(this, x, pw + 13, `${yours}`, 18, weak ? OPS.loss : OPS.text).setDepth(2);
    label(this, x + 84, pw, 'Consigliata', OPS.label, 8).setDepth(2);
    value(this, x + 84, pw + 13, `${F.power}`, 18).setDepth(2);
    g.lineStyle(1, OPS.edge, 0.5).lineBetween(x + 70, pw + 2, x + 70, pw + 36);
    if (weak) body(this, x, pw + 44, 'Nemici più forti: potenzia la base prima di partire.', 11, OPS.loss, w).setDepth(2);
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

  /**
   * Pagina a tutto schermo della stanza: testata (titolo, livello, scorte, Back) sopra la foto della stanza, fascicolo a destra
   * (in verticale sotto). Si ridisegna solo quando cambia la stanza o il suo stato, così le luci animate non ripartono a ogni
   * timer. Restituisce il riquadro del fascicolo (a destra o sotto), dove va il contenuto della stanza.
   */
  private drawPage(spot: Spot) {
    const { width, height } = view(this);
    const P = this.portrait, T = PAD + this.safe.top, Bm = PAD + this.safe.bottom, head = P ? 110 : 92, info = PAGE[spot], p = this.profile;
    const top = T + head;
    // la stanza si vede a sinistra (in verticale sopra), il fascicolo sta a destra (sotto), come le stanze di XCOM 2
    let x0: number, y0: number, W: number, H: number;
    if (spot === 'spedizione') { x0 = 0; y0 = 0; W = width; H = height; }
    else if (!info.room) { x0 = PAD; y0 = top; W = width - 2 * PAD; H = height - top - Bm; }
    else if (P) {
      const ah = Math.min(height * 0.2, width * 0.6);
      x0 = PAD; y0 = top + ah + 10; W = width - 2 * PAD; H = height - y0 - Bm;
    } else {
      const aw = Math.min(width * 0.56, (height - top - Bm) * 1.45);
      x0 = PAD + aw + 12; y0 = top; W = width - x0 - PAD; H = height - top - Bm;
    }
    const st = this.roomState(spot);
    const key = `${spot}|${JSON.stringify(st)}|${RESOURCES.map((r) => p.stash[r]).join(',')}|${width}x${height}`;
    if (key !== this.pageKey) {
      const fresh = !this.page;
      this.page?.destroy();
      this.pageKey = key;
      // fondo: la foto della stanza a tutto schermo (l'elicottero per l'Estrazione, come nel Figma), velata solo dietro
      // al titolo e al fascicolo
      const ext = spot === 'spedizione';
      const objs: Phaser.GameObjects.GameObject[] = [
        this.add.rectangle(0, 0, width, height, 0x07090c, 1).setOrigin(0).setInteractive(), // la base sotto non riceve i tocchi
        ext ? coverImage(this, 'bg-estrazione', 0, 0, width, height, 0.5)
          : coverImage(this, ROOM_IMG[spot], 0, 0, width, height, 0.5).setTint(0xd4dce4),
      ];
      if (!ext) {
        objs.push(fade(this, 0, 0, width, T + 120, 0x05080d, 0.8, 0));
        if (!info.room) objs.push(this.add.rectangle(0, 0, width, height, 0x05080d, 0.55).setOrigin(0));
        else if (P) objs.push(fade(this, 0, y0 - 60, width, height - y0 + 60, 0x05080d, 0, 0.85));
        else objs.push(fade(this, x0 - 80, 0, width - x0 + 80, height, 0x05080d, 0, 0.85, 'h'));
      }
      // testata: titolo grande a sinistra, Back a destra (Figma di Nico)
      const hg = this.add.graphics();
      const barY = T - 4, barH = P ? 84 : 52, titleY = barY + (P ? 16 : barH / 2);
      const isB = (BUILDINGS as string[]).includes(spot), lvl = isB ? p.buildings[spot as BuildingId] : 0, max = isB ? maxLvl(spot as BuildingId) : 0;
      const em = ext && !P ? width * 0.05 : PAD, ty = ext && !P ? Math.max(titleY, height * 0.1) : titleY; // l'Estrazione ha i margini larghi del Figma
      const title = value(this, em + (ext ? 0 : 4), ty, ext ? 'Extraction squads' : info.name, Phaser.Math.Clamp(width * 0.032, P ? 24 : 28, 56)).setOrigin(0, 0.5);
      objs.push(hg, title, ...backBox(this, width - em, ty - 18, () => this.closePanel()));
      if (isB) { // livello: tacche dopo il titolo (piena = fatto, ambra = in cantiere)
        const tw = 9, gap = 3, tx = title.x + title.width + 18;
        objs.push(label(this, tx, barY + (P ? 16 : barH / 2) - 16, `Liv ${lvl}/${max}`, OPS.label, 8));
        for (let i = 0; i < max; i++) {
          const bx = tx + i * (tw + gap), done = i < lvl, now = st.building && i === lvl;
          hg.fillStyle(now ? PALETTE.allerta : OPS.text, done || now ? 0.9 : 0).fillRect(bx, barY + (P ? 16 : barH / 2) + 2, tw, 8);
          hg.lineStyle(1, OPS.text, done || now ? 0 : 0.35).strokeRect(bx + 0.5, barY + (P ? 16 : barH / 2) + 2.5, tw - 1, 7);
        }
      }
      // scorte: icona e numero in mono, a destra della barra (in verticale sotto il titolo)
      let sx = P ? width - PAD - 16 : width - PAD - 104 - 24;
      const sy = barY + (P ? barH - 18 : barH / 2);
      if (!ext) [...RESOURCES].reverse().forEach((r) => {
        const t = label(this, sx, sy, String(p.stash[r]), OPS.text, 12).setOrigin(1, 0.5);
        drawResourceIcon(hg, r, sx - Math.max(48, t.width) - 12, sy, 6);
        objs.push(t);
        sx -= Math.max(48, t.width) + 40;
      });
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
    const p = this.profile, n = tents(p), max = BALANCE.camp.tentsMax, L = x0 + 18, w = W - 36;
    let y = this.head(items, L, y0 + 44, w, 'a cosa serve');
    const d = body(this, L, y, 'Le squadre che tornano dal fronte dormono qui. Un posto branda in più ogni due campagne combattute.', 13, OPS.text, w);
    items.push(d);
    y = this.head(items, L, d.y + d.height + 18, w, 'brande', `${n}/${max}`);
    const g = this.add.graphics();
    items.push(g);
    for (let i = 0; i < max; i++) {
      const ry = y + i * 34, on = i < n, wait = (i - n) * 2 + 2 - (p.runs % 2);
      if (on) g.fillStyle(OPS.text, 1).fillRect(L + 2, ry + 7, 14, 14); else dashedBox(g, L + 2, ry + 7, 14, 14, OPS.text, 0.45);
      items.push(value(this, L + 28, ry + 14, `BRANDA ${i + 1}`, 15, on ? OPS.text : OPS.label).setOrigin(0, 0.5),
        label(this, L + w, ry + 14, on ? 'occupata' : `libera · tra ${wait} ${wait === 1 ? 'campagna' : 'campagne'}`, on ? OPS.gain : OPS.label, 9).setOrigin(1, 0.5));
    }
  }

  /** Titoletto di sezione: etichetta mono (e un valore a destra), riga sotto. Restituisce dove inizia il contenuto. */
  private head(items: Phaser.GameObjects.GameObject[], x: number, y: number, w: number, text: string, right = '', rightColor: number = OPS.label): number {
    items.push(label(this, x, y, text, OPS.label, 9));
    if (right) items.push(label(this, x + w, y, right, rightColor, 9).setOrigin(1, 0));
    const g = this.add.graphics();
    rule(g, x, x + w, y + 18);
    items.push(g);
    return y + 28;
  }

  /** Riga traslucida come nella home; si schiarisce sotto il mouse se si tocca; barretta a sinistra se evidenziata. */
  private rowBox(items: Phaser.GameObjects.GameObject[], x: number, y: number, w: number, h: number, onClick?: () => void, accent?: number, dim = false) {
    const r = this.add.rectangle(x, y, w, h, OPS.row, 0.62).setOrigin(0).setStrokeStyle(1, OPS.edge, 0.32).setAlpha(dim ? 0.5 : 1);
    if (onClick) r.setInteractive({ useHandCursor: true }).on('pointerup', onClick)
      .on('pointerover', () => r.setFillStyle(OPS.row, 0.92)).on('pointerout', () => r.setFillStyle(OPS.row, 0.62));
    items.push(r);
    if (accent !== undefined) items.push(this.add.rectangle(x, y, 2, h, accent).setOrigin(0));
    return r;
  }

  /** Barra d'avanzamento piatta. */
  private bar(items: Phaser.GameObjects.GameObject[], x: number, y: number, w: number, pct: number, color: number) {
    const g = this.add.graphics();
    g.fillStyle(OPS.edge, 0.4).fillRect(x, y, w, 4).fillStyle(color, 1).fillRect(x, y, w * Phaser.Math.Clamp(pct, 0, 1), 4);
    items.push(g);
  }

  /** Cantiere: tutte le stanze con livello e stato; si tocca una riga per aprirne la pagina. */
  private fillWorks(items: Phaser.GameObjects.GameObject[], x0: number, y0: number, W: number, H: number) {
    const p = this.profile, now = Date.now(), c = p.construction, L = x0 + 18, w = W - 36;
    let y = this.head(items, L, y0 + 44, w, 'cantiere', c ? 'aperto' : 'libero', c ? PALETTE.allerta : OPS.gain);
    const d = body(this, L, y, c ? `${buildingText[c.id].name} verso il livello ${p.buildings[c.id] + 1}. Una postazione alla volta.` : 'Tocca una postazione per vederne il prossimo livello.', 13, c ? PALETTE.allerta : OPS.text, w);
    items.push(d);
    y = this.head(items, L, d.y + d.height + 18, w, 'postazioni');
    const why = { busy: 'cantiere occupato', cost: 'risorse insufficienti', comando: 'serve il centro di comando', max: 'livello massimo' } as const;
    const rowH = 50;
    BUILDINGS.forEach((id, i) => {
      const ry = y + i * (rowH + 6), lvl = p.buildings[id], max = maxLvl(id), here = c?.id === id, block = buildBlock(p, id);
      this.rowBox(items, L, ry, w, rowH, () => this.openPanel(id), here ? PALETTE.allerta : undefined);
      const g = this.add.graphics();
      for (let k = 0; k < max; k++) {
        const bx = L + 14 + k * 12, done = k < lvl, cur = here && k === lvl;
        g.fillStyle(cur ? PALETTE.allerta : OPS.text, done || cur ? 0.9 : 0).fillRect(bx, ry + 32, 8, 7);
        g.lineStyle(1, OPS.text, done || cur ? 0 : 0.35).strokeRect(bx + 0.5, ry + 32.5, 7, 6);
      }
      const state = here ? `in cantiere · ${fmtTime(c!.until - now)}` : lvl >= max ? 'livello massimo' : block ? why[block] : `migliorabile · ${fmtTime((nextLevel(p, id)?.timeSec ?? 0) * 1000)}`;
      items.push(g, value(this, L + 14, ry + 7, buildingText[id].name, 15),
        label(this, L + w - 30, ry + rowH / 2, state, here ? PALETTE.allerta : !block && lvl < max ? OPS.gain : OPS.label, 9).setOrigin(1, 0.5),
        label(this, L + w - 12, ry + rowH / 2, '›', OPS.text, 14).setOrigin(1, 0.5));
    });
    if (c) {
      const total = BALANCE.camp.buildings[c.id][p.buildings[c.id]].timeSec * 1000, cost = rushCost(c.until, now), ok = p.stash.metallo >= cost;
      this.bar(items, L, y0 + H - 70, w, 1 - (c.until - now) / total, PALETTE.allerta);
      items.push(this.btn(`FINISCI ORA · ${cost} METALLO`, L, y0 + H - 56, w, ok, () => {
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
    const p = this.profile, now = Date.now(), r = p.research, L = x0 + 18, w = W - 36;
    if (!p.buildings.laboratorio) {
      const y = this.head(items, L, y0 + 44, w, 'ricerca');
      items.push(body(this, L, y, 'Senza Laboratorio non si studia niente. Costruiscilo per aprire l\'albero della ricerca.', 13, OPS.text, w));
      items.push(this.btn('VAI AL LABORATORIO ›', L, y0 + H - 56, w, true, () => this.openPanel('laboratorio'), 14, true));
      return;
    }
    // progetto in corso
    let y = this.head(items, L, y0 + 44, w, 'in corso', r ? `finisce tra ${fmtTime(r.until - now)}` : 'fermo', r ? PALETTE.allerta : OPS.label);
    if (r) {
      const t = techInfo(r.id), total = (BALANCE.tech[r.id]?.timeSec ?? 1) * 1000;
      this.rowBox(items, L, y, w, 70, undefined, PALETTE.allerta);
      items.push(value(this, L + 14, y + 8, t.name, 17), body(this, L + 14, y + 32, t.desc, 11, OPS.body).setWordWrapWidth(w - 28).setMaxLines(1));
      this.bar(items, L + 14, y + 56, w - 28, 1 - (r.until - now) / total, PALETTE.allerta);
      y += 82;
    } else {
      const t = body(this, L, y, 'Nessun progetto in corso: scegline uno dall\'albero.', 13, OPS.text, w);
      items.push(t);
      y += t.height + 14;
    }
    // rami: quanti progetti completati su quanti (si toccano per aprire l'albero lì)
    y = this.head(items, L, y + 6, w, 'rami della ricerca');
    Object.entries(BRANCHES).forEach(([k, name], i) => {
      const ids = TECH_IDS.filter((id) => BALANCE.tech[id].branch === k), done = ids.filter((id) => p.techs.includes(id)).length, ry = y + i * 40, full = done === ids.length;
      this.rowBox(items, L, ry, w, 34, () => this.openTree(k));
      items.push(value(this, L + 14, ry + 17, name, 14).setOrigin(0, 0.5),
        label(this, L + w - 12, ry + 17, `${done}/${ids.length}`, full ? OPS.gain : OPS.label, 10).setOrigin(1, 0.5));
      this.bar(items, L + w * 0.45, ry + 15, w * 0.4, ids.length ? done / ids.length : 0, full ? OPS.gain : OPS.text);
    });
    items.push(this.btn('APRI L\'ALBERO DELLA RICERCA ›', L, y0 + H - 56, w, true, () => this.openTree(r ? BALANCE.tech[r.id].branch : 'esercito'), 14, true));
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
    if (spot !== 'spedizione') panel(fg, x0, y0, W, H);
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
      this.fillExtraction(items, W, H);
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
          fit(value(this, x0 + 48, ly + 1, nm, 15, done ? OPS.text : now ? 0xffffff : OPS.label).setAlpha(done ? 0.8 : 1), W - 130));
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

  /**
   * Squadre di Estrazione (Figma di Nico): le missioni in righe di vetro a destra, nome e durata; la riga toccata è la scelta,
   * SEND SQUAD in basso la fa partire. Costo e bottino atteso della scelta stanno sopra il tasto.
   */
  private fillExtraction(items: Phaser.GameObjects.GameObject[], W: number, H: number) {
    const p = this.profile, now = Date.now(), T = buildingText.spedizione, e = p.expedition, P = this.portrait;
    const away = !!e && e.until > now, back = !!e && !away;
    const kindNow: ExpeditionKind = e?.kind ?? this.expKind;
    const m = P ? PAD : W * 0.05, rw = P ? W - 2 * m : Math.max(280, W * 0.268), rx = W - m - rw;
    const rh = Math.max(50, H * 0.092), gap = P ? 10 : Math.max(10, H * 0.035), ctaH = Math.max(52, H * 0.092), ctaY = H - Math.max(H * 0.092, PAD + this.safe.bottom) - ctaH;
    const y0 = P ? ctaY - 76 - 3 * rh - 2 * gap : Math.max(H * 0.216, 110); // in verticale le righe stanno appena sopra costo e tasto
    const px = Phaser.Math.Clamp(W * 0.0078, 10.5, 15); // misura per label(), che la riporta in punti
    const dur = (s: number) => (s >= 3600 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 60)} min`);
    const g = this.add.graphics();
    items.push(g);
    EXPEDITIONS.forEach((kind: ExpeditionKind, i) => {
      const y = y0 + i * (rh + gap), on = kind === kindNow, dim = (away || back) && !on;
      glass(g, rx, y, rw, rh, on);
      const right = on && away ? fmtTime(e!.until - now) : on && back ? 'di ritorno' : dur(expeditionTimeSec(p, kind));
      items.push(label(this, rx + 18, y + rh / 2, T.kinds[kind], OPS.text, px).setOrigin(0, 0.5).setAlpha(dim ? 0.45 : 1),
        label(this, rx + rw - 18, y + rh / 2, right, on && away ? PALETTE.allerta : OPS.label, px).setOrigin(1, 0.5).setAlpha(dim ? 0.45 : 1));
      if (!away && !back) items.push(this.add.rectangle(rx, y, rw, rh, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true }).on('pointerup', () => {
        this.expKind = kind;
        this.openPanel('spedizione');
      }));
    });
    // azione: in basso a destra, ruggine
    const bw = P ? rw : Math.max(220, W * 0.193), bh = ctaH, bx = W - m - bw, by = ctaY;
    const E = BALANCE.camp.expeditions[kindNow], cost = expeditionCost(kindNow), ok = p.stash.cibo >= cost;
    const go = () => {
      if (back) {
        const got = collectExpedition(p, Date.now());
        if (!got) return;
        analytics.design(['spedizione', 'ritira', kindNow]); // % che torna a ritirare
        analytics.resources('source', got, 'spedizione', kindNow);
        saveProfile(p);
        this.closePanel();
        this.redrawSpot('spedizione');
        this.updateStash();
        const s = this.spots.get('spedizione')!;
        this.burst.setParticleTint(PALETTE.ocra);
        this.burst.explode(30, s.x, s.y);
        this.toast(`+${got.metallo} metallo · +${got.benzina} benzina · +${got.cibo} cibo`, PALETTE.radioattivo);
        return;
      }
      if (!startExpedition(p, kindNow, Date.now())) return;
      analytics.design(['spedizione', 'parti', kindNow]);
      saveProfile(p);
      this.closePanel();
      this.redrawSpot('spedizione');
      this.updateStash();
      this.toast('Le squadre partono. Torneranno con quello che trovano.', PALETTE.carta);
    };
    const can = back || (!away && ok);
    const b = new Button(this, back ? 'COLLECT' : away ? 'ON MISSION' : 'SEND SQUAD', bw, bh, () => can && go(), Math.round(px * 1.15));
    b.setPosition(bx, by).setAlpha(can ? 1 : 0.5);
    if (can) b.setPrimary();
    items.push(b);
    // costo e bottino della scelta, sopra il tasto
    const loot = back ? `${e!.reward.metallo} metallo · ${e!.reward.benzina} benzina · ${e!.reward.cibo} cibo`
      : `${E.metallo[0]}–${E.metallo[1]} metallo · ${E.benzina[0]}–${E.benzina[1]} benzina · ${E.cibo[0]}–${E.cibo[1]} cibo`;
    items.push(label(this, W - m, by - 12, loot, OPS.text, P ? 8 : 9).setOrigin(1, 1).setWordWrapWidth(rw).setAlign('right'));
    if (!away && !back) items.push(label(this, W - m, by - (P ? 50 : 32), cost ? `Costo ${cost} cibo · ne hai ${p.stash.cibo}` : 'Gratis', ok ? OPS.label : OPS.loss, 9).setOrigin(1, 1));
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
    const L = x0 + 18, w = W - 36;
    let y = this.head(items, L, y0 + 44, w, 'a cosa serve');
    const desc = body(this, L, y, shopText.desc, 12, OPS.text, w);
    items.push(desc);
    const g = this.add.graphics(); // icone: aggiunte in fondo, sopra le schede
    const tile = (x: number, ty: number, tw: number, th: number, ok: boolean, on: boolean, run: () => void) =>
      this.rowBox(items, x, ty, tw, th, ok ? run : undefined, on ? OPS.gain : undefined, !ok && !on);
    // scambio: 50 di una → 30 di un'altra
    y = this.head(items, L, desc.y + desc.height + 16, w, shopText.trade);
    const pairs = RESOURCES.flatMap((a) => RESOURCES.filter((b) => b !== a).map((b) => [a, b] as const));
    const cols = P ? 2 : 3, tw = (w - (cols - 1) * 6) / cols, th = 36;
    pairs.forEach(([a, b], k) => {
      const x = L + (k % cols) * (tw + 6), ty = y + Math.floor(k / cols) * (th + 6);
      const ok = p.stash[a] >= S.trade.give;
      tile(x, ty, tw, th, ok, false, () => { if (trade(p, a, b)) done(`SCAMBIO · −${S.trade.give} ${RESOURCE_INFO[a].name.toLowerCase()} · +${S.trade.get} ${RESOURCE_INFO[b].name.toLowerCase()}`); });
      drawResourceIcon(g, a, x + 16, ty + th / 2, 7);
      items.push(label(this, x + 28, ty + th / 2, String(S.trade.give), ok ? OPS.text : OPS.label, 12).setOrigin(0, 0.5),
        label(this, x + tw / 2, ty + th / 2, '→', OPS.label, 12).setOrigin(0.5));
      drawResourceIcon(g, b, x + tw - 42, ty + th / 2, 7);
      items.push(label(this, x + tw - 30, ty + th / 2, String(S.trade.get), ok ? OPS.gain : OPS.label, 12).setOrigin(0, 0.5));
    });
    y += Math.ceil(pairs.length / cols) * (th + 6) + 12;
    // rifornimenti: uno per tipo, valgono per la prossima campagna
    y = this.head(items, L, y, w, shopText.supplies);
    const scols = P ? 1 : 3, sw = (w - (scols - 1) * 6) / scols, sh = P ? 48 : 70;
    SUPPLIES.forEach((k, i) => {
      const T = shopText.items[k], D = S.supplies[k], own = (p.supplies ?? []).includes(k), ok = !own && canAfford(p.stash, D.cost);
      const x = L + (i % scols) * (sw + 6), ty = y + Math.floor(i / scols) * (sh + 6);
      tile(x, ty, sw, sh, ok, own, () => { if (buySupply(p, k)) done(`${T.name.toUpperCase()} · pronti per la prossima campagna`); });
      items.push(value(this, x + 12, ty + 6, T.name, 14, own ? OPS.gain : OPS.text),
        body(this, x + 12, ty + 26, T.desc, 10, OPS.body).setWordWrapWidth(sw - 24).setMaxLines(1));
      if (own) items.push(label(this, x + sw - 10, ty + (P ? sh / 2 : sh - 12), 'pronto', OPS.gain, 9).setOrigin(1, 0.5));
      else this.costRow(g, items, D.cost, P ? x + sw - 150 : x + 12, P ? ty + sh / 2 : ty + sh - 12, p.stash);
    });
    y += Math.ceil(SUPPLIES.length / scols) * (sh + 6) + 12;
    // lavori in corso: finiti subito pagando metallo
    y = this.head(items, L, y, w, shopText.rush);
    const jobs = [
      { what: 'construction' as const, job: p.construction, name: p.construction ? `${buildingText[p.construction.id].name} liv. ${p.buildings[p.construction.id] + 1}` : '' },
      { what: 'research' as const, job: p.research, name: p.research ? techInfo(p.research.id).name : '' },
    ].filter((j) => j.job && j.job.until > now);
    if (!jobs.length) items.push(label(this, L, y + 2, 'nessun cantiere o ricerca in corso', OPS.label, 9));
    jobs.forEach((j, i) => {
      const cost = rushCost(j.job!.until, now), ok = p.stash.metallo >= cost;
      items.push(this.btn(`FINISCI ORA: ${j.name.toUpperCase()} · ${cost} METALLO`, L, y + i * 46, w, ok, () => {
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
    const have = this.profile.stash, rs = RESOURCES.filter((r) => cost[r] > 0), n = rs.length + 1, cw = (w - (n - 1) * 6) / n, ch = 50;
    items.push(label(this, x, y - 18, 'costo del prossimo livello', OPS.label, 9));
    const g = this.add.graphics();
    items.push(g);
    rs.forEach((r, i) => {
      const cx = x + i * (cw + 6), ok = have[r] >= cost[r];
      g.fillStyle(0x2b333b, 0.55).fillRect(cx, y, cw, ch);
      if (!ok) g.fillStyle(OPS.loss, 1).fillRect(cx, y, 2, ch);
      drawResourceIcon(g, r, cx + 16, y + 17, 7);
      g.fillStyle(OPS.edge, 0.4).fillRect(cx + 10, y + ch - 9, cw - 20, 3);
      g.fillStyle(ok ? OPS.gain : OPS.loss, 1).fillRect(cx + 10, y + ch - 9, (cw - 20) * Math.min(1, have[r] / cost[r]), 3);
      items.push(value(this, cx + 30, y + 17, String(cost[r]), 17, ok ? OPS.text : OPS.loss).setOrigin(0, 0.5),
        label(this, cx + cw - 8, y + 30, `hai ${have[r]}`, OPS.label, 8).setOrigin(1, 0.5));
    });
    const tx = x + rs.length * (cw + 6);
    g.fillStyle(0x2b333b, 0.3).fillRect(tx, y, cw, ch);
    items.push(label(this, tx + cw / 2, y + 12, 'tempo', OPS.label, 8).setOrigin(0.5),
      value(this, tx + cw / 2, y + 31, fmtTime(timeSec * 1000), 16).setOrigin(0.5));
  }

  /** Costo in fila: icona, quanto serve (rosso se non basta). */
  private costRow(g: Phaser.GameObjects.Graphics, items: Phaser.GameObjects.GameObject[], cost: Bag, x: number, y: number, have: Bag) {
    let cx = x;
    for (const r of RESOURCES) {
      if (!cost[r]) continue;
      drawResourceIcon(g, r, cx + 6, y, 6);
      const t = label(this, cx + 15, y, String(cost[r]), have[r] < cost[r] ? OPS.loss : OPS.text, 10).setOrigin(0, 0.5);
      items.push(t);
      cx += t.width + 26;
    }
  }

  /** Modalità test: sblocca tutto per provare armi, civiltà e ricerche senza aspettare; si torna indietro azzerando il profilo. */
  private fillTest(items: Phaser.GameObjects.GameObject[], x0: number, y0: number, W: number, H: number) {
    const p = this.profile;
    const L = x0 + 18, w = W - 36;
    const y = this.head(items, L, y0 + 16, w, 'modalità test', p.test ? 'attiva' : 'spenta', p.test ? PALETTE.allerta : OPS.label);
    const txt = p.test
      ? 'Postazioni al massimo, tutte le ricerche, risorse piene, civiltà sbloccate, cantieri e spedizioni istantanei, +1000 truppe a inizio campagna, abilità con ricarica ridotta.'
      : 'Sblocca subito tutto: postazioni al massimo (tutte le armi e le abilità), tutte le ricerche, risorse piene, civiltà sbloccate, cantieri e spedizioni istantanei, +1000 truppe a inizio campagna.\n\nServe solo per provare il gioco: i progressi veri si perdono.';
    items.push(body(this, L, y, txt, 13, OPS.text, w));
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
  private link(text: string, x: number, y: number, onClick: () => void, origin = 1) {
    return label(this, x, y, text, OPS.accent, 10).setOrigin(origin, 0).setInteractive({ useHandCursor: true }).on('pointerup', onClick);
  }

  /** Preparazione della campagna: vista principale (potenza, mazzo, durata, avvia) e due sotto-viste. Max 6 scelte per vista. */
  private fillPrep(items: Phaser.GameObjects.GameObject[], x0: number, y0: number, W: number, H: number) {
    const p = this.profile;
    const civ = activeCiv(p);
    const back = () => items.push(this.link('‹ indietro', x0 + W - 40, y0 + 12, () => this.openPanel('gioca', '')));
    if (this.panelMode === 'civ') {
      this.head(items, x0 + 18, y0 + 14, W - 110, 'scegli la potenza');
      back();
      // quattro sistemi politici: immagine (Figma), insegna, nome e forma di governo
      const P = this.portrait, cols = P ? 2 : 4, gap = 8;
      const cw = (W - 32 - (cols - 1) * gap) / cols, ch = P ? 150 : 190, y = y0 + 42;
      CIV_IDS.forEach((id, k) => {
        const st = CIV_STYLE[id], info = civInfo(id), open = civUnlocked(p, id), sel = id === civ;
        const cx = x0 + 16 + (k % cols) * (cw + gap), cy = y + Math.floor(k / cols) * (ch + gap);
        const img = coverImage(this, civImage(id), cx, cy, cw, ch, 0.4).setTint(open ? 0xffffff : 0x555a66).setAlpha(open ? 1 : 0.6);
        const shade = fade(this, cx, cy + ch * 0.35, cw, ch * 0.65, PALETTE.inchiostro, 0, 0.95);
        const frame = this.add.rectangle(cx, cy, cw, ch).setOrigin(0).setStrokeStyle(sel ? 2 : 1, sel ? OPS.text : OPS.edge, sel ? 1 : 0.6)
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
          value(this, cx + 10, cy + ch - 44, info.name, 18, open ? OPS.text : OPS.label),
          label(this, cx + 10, cy + ch - 18, open ? info.regime : `bloccata · ${info.unlock}`, open ? OPS.body : OPS.label, 8).setWordWrapWidth(cw - 20).setMaxLines(1));
        if (sel) items.push(this.add.rectangle(cx, cy, cw, 3, OPS.text).setOrigin(0));
      });
      // scheda della potenza scelta: classe dirigente, dottrina, storia, regole
      const info = civInfo(civ), unit = unitInfo(info.unit);
      const ty = y + (P ? 2 : 1) * (ch + gap) + 4;
      const doc = label(this, x0 + 18, ty + 16, `${info.dottrina} · «${info.motto}»`, OPS.label, 8).setWordWrapWidth(W - 36);
      items.push(label(this, x0 + 18, ty, info.classe, OPS.text, 9).setWordWrapWidth(W - 36), doc);
      const lore = body(this, x0 + 18, doc.y + doc.height + 8, info.lore, 12, OPS.body, W - 36);
      items.push(lore);
      // regole della potenza: bonus, unità, edificio (etichetta mono e testo)
      let ry = lore.y + lore.height + 12;
      for (const [k, v] of [['bonus', info.bonus], ['unità unica', `${unit.name} (Arsenale liv. ${BALANCE.camp.arsenaleUnique})`], ['edificio unico', `${info.building} — ${info.buildingText}`]]) {
        items.push(label(this, x0 + 18, ry + 2, k, OPS.label, 8));
        const t = body(this, x0 + 140, ry, v, 12, OPS.text, W - 158);
        items.push(t);
        ry += t.height + 6;
      }
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
    items.push(bp, value(this, x0 + 60, y0 + bh - 58, info.name, 26),
      body(this, x0 + 60, y0 + bh - 24, `${info.regime} · ${info.bonus}`, 10, OPS.body, W - 90));
    if (civChoice(p)) {
      const hit = this.add.rectangle(x0 + 1, y0 + 1, W - 2, bh, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true });
      hit.on('pointerup', () => this.openPanel('gioca', 'civ'));
      items.push(hit, label(this, x0 + W - 16, y0 + 12, 'cambia potenza ›', OPS.accent, 9).setOrigin(1, 0));
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
    const frags = loreFragments(this.profile), L = x0 + 18, w = W - 36;
    let y = this.head(items, L, y0 + 44, w, 'frammenti decifrati', `${frags.length}/${loreTotal}`);
    if (!frags.length) items.push(body(this, L, y, 'Nessun frammento. Le ricerche del ramo "La Caduta" riempiono questo archivio.', 13, OPS.text, w));
    frags.forEach((f, i) => {
      items.push(label(this, L, y, `frammento ${ROMAN[i] ?? i + 1}`, OPS.accent, 9), value(this, L, y + 14, f.name, 16));
      const t = body(this, L, y + 38, f.lore, 12, OPS.body, w);
      items.push(t);
      y = t.y + t.height + 18;
    });
    items.push(this.link('albero della ricerca ›', L, y0 + H - 26, () => this.openTree('caduta'), 0));
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
    const L = x0 + 18, w = W - 36;
    const best = p.history.reduce((m, r) => Math.max(m, r.tiles), p.bestTiles);
    // tre numeri grandi, poi le vittorie per potenza, poi il registro in tabella
    let y = this.head(items, L, y0 + 44, w, 'registro delle campagne');
    ([['campagne', p.runs], ['vittorie', p.wins], ['territorio max', best]] as [string, number][]).forEach(([k, v], i) => {
      const sx = L + i * (w / 3);
      items.push(label(this, sx, y, k, OPS.label, 8), value(this, sx, y + 14, String(v), 26));
    });
    y += 56;
    const byCiv = CIV_IDS.map((c) => {
      const h = p.history.filter((r) => r.civ === c);
      return h.length ? `${civInfo(c).name} ${h.filter((r) => r.outcome === 'victory').length}/${h.length}` : '';
    }).filter(Boolean).join(' · ');
    items.push(label(this, L, y, byCiv || 'nessuna campagna registrata', OPS.body, 9));
    y = this.head(items, L, y + 24, w, 'ultime campagne');
    const OUT: Record<string, [string, number]> = { victory: ['vittoria', OPS.gain], retreat: ['ritirata', PALETTE.allerta], eliminated: ['eliminato', OPS.loss], timeout: ['fine tempo', OPS.label] };
    p.history.slice(0, 7).forEach((r, i) => {
      const d = new Date(r.at), ry = y + i * 24;
      const when = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const [o, oc] = OUT[r.outcome] ?? [r.outcome, OPS.label];
      items.push(label(this, L, ry, when, OPS.label, 9), label(this, L + w * 0.24, ry, civInfo(r.civ).name, OPS.text, 9),
        label(this, L + w * 0.5, ry, o, oc, 9), label(this, L + w, ry, `${r.tiles} · ${fmtTime(r.timeMs)}`, OPS.body, 9).setOrigin(1, 0));
    });
    items.push(this.link('migliora la sala ›', L, y0 + _H - 26, () => this.openPanel('radar', 'build'), 0));
  }

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
