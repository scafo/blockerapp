import { WorldMap } from '../render/WorldMap';
import { sfx } from '../audio/sfx';
import { music } from '../audio/music';
import { DEV, applyResume, clearResume, saveResume, type ResumeData } from '../save/devResume';
import Phaser from 'phaser';
import { BALANCE, type AbilityType, type Resource, type UnitType, type WorkId } from '../config/balance';
import buildingText from '../data/buildings.json';
import { RESOURCES, RESOURCE_INFO } from '../game/resources';
import { recoverStake, runOptions, settle, type RunOptions } from '../game/camp';
import { loadProfile, saveProfile } from '../save/storage';
import { analytics } from '../analytics/analytics';
import { PALETTE, TERRAIN_VIEW, WORK_VIEW, hex } from '../config/palette';
import { TERM, TERM_FONT, type TermFrame } from '../render/TerminalMap';
import { generateMap, type RunMap } from '../map/generate';
import { neighbors, HEX_W, WORLD_H, WORLD_W, center, hexDistance, pixelToIndex } from '../map/hexGrid';
import { buildShapes, provinceAtPoint, type MapShapes } from '../map/provinceShapes';
import { loadWorld } from '../map/worldAsset';
import { latToV, lonToU, uToLon, vToLat } from '../map/projection';
import { REGIONS, region, setRegion } from '../map/region';
import { TerritoryLayer, fillProvince, type TerritoryFill } from '../render/TerritoryLayer';
import { NEUTRAL, PLAYER, RunState, WORKS } from '../game/RunState';
import { WORK_NAME, workDesc } from '../ui/workIcons';
import { GridPen } from '../render/GridPen';
import { FACTION_INFO, setupFactions } from '../game/factions';
import { enterWorld, fallenToBots, keepRivalNames } from '../game/world';
import { textStyle } from '../ui/style';
import { DPR, LOW_END, UI } from '../ui/screen';
import type { FactionTag, NationLabel, PlaceLabel, WorldLabel } from '../render/MapLabels';
import places from '../data/places.json';
import { buzz } from '../ui/haptics';
import { drawAbilityIcon } from '../ui/unitIcons';
import { drawUnitHp, drawUnitSymbol } from '../ui/unitSymbols';
import { brackets, rectOutline } from '../render/termMarks';
import { isNaval, unitInfo, type Unit } from '../game/units';
import { isCoast, type Boat } from '../game/boats';
import type { HudScene } from './HudScene';

import { setupCamera, zoomAt } from './run/CameraControl';

const S = BALANCE.map.hexSize;
// profondità dei livelli della mappa
const BUNKER = WORKS.indexOf('bunker');
// vista logistica: sfumatura continua rosso → giallo → verde (a gradini fitti, così i vicini si fondono)
const LOGI_STEPS = 16;
const LOGI_COLS = Array.from({ length: LOGI_STEPS + 1 }, (_, k) => {
  const t = k / LOGI_STEPS, C = Phaser.Display.Color;
  const [a, b, u] = t < 0.5 ? [0xe0473a, 0xe1e496, t * 2] : [0xe1e496, 0x9fe0a8, (t - 0.5) * 2];
  const c = C.Interpolate.ColorWithColor(C.ValueToColor(a), C.ValueToColor(b), 100, Math.round(u * 100));
  return '#' + C.GetColor(c.r, c.g, c.b).toString(16).padStart(6, '0');
});
/** Vista terreno: le tue province nel colore del terreno schiarito verso il bianco. */
const OWN_TERRAIN: Record<string, string> = Object.fromEntries(Object.entries(TERRAIN_VIEW).map(([k, v]) => {
  const c = Phaser.Display.Color.Interpolate.ColorWithColor(Phaser.Display.Color.HexStringToColor(v.col), Phaser.Display.Color.ValueToColor(0xffffff), 100, 35);
  return [k, `#${Phaser.Display.Color.GetColor(c.r, c.g, c.b).toString(16).padStart(6, '0')}`];
}));
const PLAYER_EDGE = '#3d6bff'; // confine del tuo territorio: blu scuro acceso, si vede sul nero e si stacca dal riempimento
const TERRAIN_IDX: Record<string, number> = { pianura: 0, colline: 1, montagne: 2, deserto: 3 }; // trama della carta da terminale
const D = { owned: 1, borders: 2, fog: 2.5, front: 3, marks: 4, path: 7, units: 8, fx: 9 };
const CAM = BALANCE.camera;
// segni sulla carta chiara: inchiostro per scritte e simboli, cobalto scuro per selezioni e ordini
const MAP_INK = 0xf2f2f2;
const NET_DARK = 0x0a0f16; // rete delle strade sul tuo territorio
const MAP_SEL = 0x8fd6ff;
const CITY_COL = 0x9fd0f5; // città e capitali: azzurro come i nomi della carta
/** Colore a metà strada fra due '#rrggbb' (t = quota del secondo). */
const mixHex = (a: string, b: string, t: number): string => {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
};


/** Linea d'attacco: il tratto disegnato, le pedine che la tengono, i nemici che fronteggia e i tratti di confine veri. */
const ROMAN_N = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
/** Offensiva di una linea: direzione (u) e lato (n), fascia laterale e fin dove spingere, posto in fila di ogni pedina. */
type FrontPush = { ux: number; uy: number; nx: number; ny: number; lat0: number; lat1: number; start: number; end: number; slot: Map<number, number>; at: number };
// `coast`: i capi della linea attaccati alla costa (restano sulla costa quando il confine si sposta, come in HOI4); `n`:
// reparti vivi l'ultima volta che si è disposta (uno caduto = buco da riempire); `regroup`: fine dell'avanzata, si rifà la fila
type AttackLine = { pts: { x: number; y: number }[]; ids: number[]; enemies: Set<number>; chains: number[]; key: string; push?: FrontPush; color: number; manual?: boolean;
  coast?: [boolean, boolean]; n?: number; regroup?: boolean };
// colori delle linee (Nico, 25 novembre 2026: "le linee sono di più colori, le truppe assegnate diventano di quel gruppo"); niente arancio
const LINE_COLORS = [0x9fd0f5, 0x6cc7c2, 0xe6d678, 0xb57ad6, 0xe58fb4, 0xe9ebe6];

export class RunScene extends Phaser.Scene {
  state!: RunState;
  map!: RunMap;
  /** forme smussate delle province (bordi, sagome) */
  shapes!: MapShapes;
  private territory!: TerritoryLayer;
  private mapLayer!: Phaser.GameObjects.Layer;
  private term!: WorldMap;
  private pen!: GridPen; // segni sulla carta dentro la griglia di puntini (percorsi, frecce, collegamenti, costruzioni)
  private previewPts: { x: number; y: number }[] | null = null; // anteprima del percorso sotto il mouse
  private termZoomKey = NaN;
  private termDirty = true;
  private ownedAt = 0;
  /** Vista logistica (tasto LOGISTICA o L): rifornimento delle tue province sulla carta. */
  logistics = false;
  private logiTimer = 0;
  private panKeys?: Record<string, Phaser.Input.Keyboard.Key>;
  termNations: NationLabel[] = [];
  termPlaces: PlaceLabel[] = []; // carta, rilievo, terra, territorio e nebbia: passano insieme nel filtro a celle
  private landLayer!: TerritoryLayer; // da vicino: terra, mare e rilievo (si ridisegna solo spostando la vista)
  private frontOk = new Map<number, boolean>(); // province attaccabili → abbordabili
  private landColor = new Int32Array(0); // tono di ogni provincia sulla carta
  private relief!: Phaser.GameObjects.Image;
  private landMode = false; // da vicino la terra la disegna lo strato vettoriale (nitida), da lontano basta la carta cotta
  private borderGfx!: Phaser.GameObjects.Graphics;
  private borderKey = '';
  private lastBorderRedrawAt = 0;
  private chainBox: Float32Array = new Float32Array(0);
  private ruinTiles: number[] = [];
  private workTimer = 0;
  private worksSig = 0; // impronta delle costruzioni finite: cambia → la carta (muri, ferrovie) si ridisegna
  private planImgs = new Map<number, Phaser.GameObjects.Graphics>();
  /** Etichette per l'interfaccia (spazio schermo, sempre nitide). */
  nationLabels: NationLabel[] = [];
  placeLabels: PlaceLabel[] = [];
  frontLabels: WorldLabel[] = [];
  private buildPeek = false; // menu COSTRUISCI aperto
  private workCardP = -1; // provincia della scheda in basso: le sue costruzioni si vedono sulla carta
  factionTags: FactionTag[] = [];
  private labelTimer = 0;
  private lastAffordable = '';
  private ownedDirty = false;
  private nameTimer = 0;
  private lastHitFx = 0;
  private fogTex: Phaser.Textures.CanvasTexture | null = null; // un pixel per casella, ingrandito e sfumato
  private fogNoise = new Float32Array(0);
  private fogVersion = -1;
  private sightShown = -1;
  private sightAt = 0;
  private boatSprites = new Map<number, Phaser.GameObjects.Container>();
  private nationNames: Phaser.GameObjects.Text[] = [];
  private namesShown = true;
  private flowMarker!: Phaser.GameObjects.Graphics;
  private markerPulse = { k: 1 };
  private pressTimer: Phaser.Time.TimerEvent | null = null;
  private deployRepeat: Phaser.Time.TimerEvent | null = null; // schieramento a raffica tenendo premuto su una città
  private longPressed = false; // pulsazione di anello di selezione e bersaglio dell'avanzata
  private nextMilestone = 0;
  private tapFxTile = -1;
  private unitsHintShown = false; // spiegazione "si prendono con i reparti": una volta per campagna
  private dragMode: 'pan' | 'paint' = 'pan';
  private lastMid: { x: number; y: number } | null = null;
  private lastPainted = -1;
  /** quante volte si usa ogni controllo (va in analytics a fine run) */
  private usage = { tocchi: 0, avanzate: 0, pittura: 0, pedine: 0, navi: 0 };
  private ending = false;
  private fxCheckAt = 0;
  // pedine
  selectedCard: UnitType | null = null;
  private recruitImgs: Phaser.GameObjects.Graphics[] = [];
  private buildImg: Phaser.GameObjects.Graphics | null = null; // COSTRUISCI: le province dove si può costruire
  private buildSig = '';
  selectedAbility: AbilityType | null = null;
  private selectedUnit: number | null = null;
  /** Selezione alla HOI4: più pedine insieme (riquadro con Maiusc + trascina, Maiusc + clic per aggiungere). */
  private selection = new Set<number>();
  /** Pedine selezionate (la barra dei gruppi accende + GRUPPO). */
  get selectedCount(): number {
    return this.selection.size;
  }
  private box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private boxGfx!: Phaser.GameObjects.Graphics;
  private flashes = new Map<number, Phaser.GameObjects.Graphics>(); // lampo in corso per provincia
  private unitSprites = new Map<number, { c: Phaser.GameObjects.Container; hp: Phaser.GameObjects.Graphics; badge: Phaser.GameObjects.Graphics; badgeKey: string | number; tile: number; hpShown: number; neg?: boolean; legA?: { x: number; y: number }; legTo?: number; walked?: number; culled?: boolean; pathRef?: number[]; pathLen?: number; ni?: number; stackN?: number; stackBig?: boolean; vf?: boolean; rPath?: number[]; rLen?: number; rFrom?: { x: number; y: number }; rSel?: boolean; rPts?: { x: number; y: number }[]; rKey?: string; sea?: boolean; stackTag?: Phaser.GameObjects.Text; pop: { k: number }; tag?: Phaser.GameObjects.Text; fuel?: Phaser.GameObjects.Image }>();
  /** Gruppi salvati (Ctrl o Maiusc + numero salva, numero richiama), come in HOI4. */
  private groups = new Map<number, number[]>();
  private lastGroupKey = { n: -1, at: 0 };
  /** Muro: trascinando sulle tue province si mettono in coda i bunker (tasto MURO o B). */
  wallMode = false;
  private buildWork: WorkId | null = null;
  /** Vista della carta (tasto MAPPA): politica, terreno (senza nomi, colori del terreno), logistica (rifornimento). */
  mapMode: 'politica' | 'terreno' | 'logistica' | 'strutture' = 'politica';
  private wallProvs: number[] = [];
  private walling = false;
  private wallGfx!: Phaser.GameObjects.Graphics;
  /** Assegnazione al fronte: dopo FRONTE (o F) il prossimo tocco su una provincia nemica sceglie il confine. */
  frontPick = false;
  private nationAttack = false; // il fronte scelto va attaccato fino alla caduta
  private nationImgs: Phaser.GameObjects.Graphics | null = null;
  /** Linea d'attacco alla HOI4: tasto Linea (o G), poi si trascina sulla carta; le pedine si dispongono lungo il tratto. */
  linePick = false;
  private lining = false;
  arrowPick = false; // offensiva (freccia alla HOI4): si traccia dalle pedine verso la meta (in beta: nessun tasto la apre)
  zonePick = false; // regioni (Nico, 27 novembre 2026): si trascina sulle province da prendere, le pedine scelte se le dividono
  private zoning = false;
  private zoneProvs = new Set<number>();
  private arrowing = false;
  private arrowPts: { x: number; y: number }[] = [];
  /** Offensive in corso: `all` = pedine partite, `goals` = la casella d'arrivo di ognuna (vuoto: avanzata di una linea). */
  private glowKey = '';
  private glowChains: number[] = [];
  private offensives: { pts: { x: number; y: number }[]; ids: number[]; all: number[]; goals: Map<number, number>; half?: number }[] = [];

  /** Mezza larghezza della freccia d'offensiva in pixel-mondo: più pedine, freccia più larga (fino a 6 corsie da due caselle
   *  per lato). Quello che copre è dove vanno (Nico, 27 novembre 2026: "la freccia più spessa, quello che copre è dove vanno"). */
  private arrowHalf(n: number): number {
    return HEX_W * 2 * Phaser.Math.Clamp(n, 1, 6);
  }
  private linePts: { x: number; y: number }[] = [];
  private lineGfx!: Phaser.GameObjects.Graphics;
  private attackLines: AttackLine[] = [];
  private lineTags: Phaser.GameObjects.Text[] = []; // numero del gruppo su linee e frecce
  /** Anteprima del percorso delle pedine selezionate verso il punto sotto il mouse. */
  private hoverTile = -1;
  private hoverAt = 0;
  private previewGfx!: Phaser.GameObjects.Graphics;
  private pathGfx!: Phaser.GameObjects.Graphics;
  private battleGfx!: Phaser.GameObjects.Graphics; // assalti in corso (anello che si riempie) e capitale
  private lastDefendToast = -1e9;
  // input
  private down: { x: number; y: number } | null = null;
  private last = { x: 0, y: 0 };
  private dragging = false;
  private pinchDist = 0;

  private runSeed = '';
  private musicAt = 0;
  private resumeSaveAt = 0; // sviluppo: ultimo salvataggio per riprendere dopo un ricaricamento di Vite

  constructor() {
    super('Run');
  }

  create(data: { seed: string; opts?: RunOptions }) {
    // sviluppo: Vite ha ricaricato la pagina → si riprende la partita salvata (stessa carta, stesso stato), senza toccare il profilo
    const resume = this.registry.get('resume') as ResumeData | undefined;
    if (resume) {
      this.registry.remove('resume');
      data = { seed: resume.seed, opts: resume.opts };
    }
    this.runSeed = data.seed;
    // l'accampamento decide cosa è sbloccato in questa run
    const profile = loadProfile();
    if (!resume && settle(profile, Date.now())) saveProfile(profile);
    const opts = data.opts ?? runOptions(profile);
    // la puntata esce dal Deposito adesso: è in gioco (e resta segnata finché la campagna non si chiude)
    if (!resume) recoverStake(profile);
    if (!resume && !opts.tutorial && RESOURCES.some((r) => opts.stake[r] > 0)) {
      for (const r of RESOURCES) profile.stash[r] = Math.max(0, profile.stash[r] - opts.stake[r]);
      profile.activeStake = { bag: { ...opts.stake }, fee: opts.exitFee };
    }
    if (!resume && !opts.tutorial && profile.supplies?.length) profile.supplies = []; // i rifornimenti del Mercato partono con questa campagna
    // impero persistente: sullo stesso fronte si torna nello stesso mondo (stessa mappa, nucleo, rivali che ricordano)
    const world = !data.opts && !opts.tutorial ? enterWorld(profile, opts, data.seed) : null;
    const seed = world?.seed ?? data.seed;
    // carta della sandbox (Europa, America): griglia e proiezione sue; imperi e milizie in proporzione alle sue province
    setRegion(opts.sandbox?.map ?? 'world');
    const fill = region().provinces / REGIONS.world.provinces;
    this.map = generateMap(seed, loadWorld(), opts.tutorial ? BALANCE.tutorial.aiCount : opts.sandbox ? Math.round(BALANCE.ai.sandboxCount * fill) : BALANCE.ai.count,
      opts.tutorial ? 0 : opts.sandbox ? Math.round(BALANCE.bots.sandboxCount * fill) : BALANCE.bots.count, opts.front.aiDistance, !!opts.sandbox);
    if (world) fallenToBots(this.map, world);
    if (resume) resume.kinds.forEach((k, i) => { this.map.kinds[i] = k; });
    setupFactions(this.map.kinds, opts.civ, opts.playerName, seed); // tu, imperi con nomi casuali, milizie provinciali
    if (world) keepRivalNames(world, opts.civ);
    if (!resume) saveProfile(profile);
    this.runSeed = seed;
    this.state = new RunState(this.map, opts);
    this.state.initFog();
    // città vere della carta: le loro province valgono di più (Nico)
    this.state.setCities(places.cities.map(([, lon, lat]) => this.state.provOf(pixelToIndex(this.lonX(lon as number), this.latY(lat as number)))));
    if (resume) applyResume(this.state, resume);
    if (this.state.placing) {
      this.state.exec({ k: 'clearStart' });
      this.time.delayedCall(300, () => { this.hud?.setHint(null); this.hud?.centerPrompt('CHOOSE YOUR STARTING PROVINCE', 'Click any free province on the map: your army starts there'); });
    }
    analytics.runStart(opts.tutorial, seed);
    this.usage = { tocchi: 0, avanzate: 0, pittura: 0, pedine: 0, navi: 0 };
    this.nextMilestone = 0;
    this.tapFxTile = -1;
    this.unitsHintShown = false;
    this.frontLabels = [];
    this.factionTags = this.state.factions.map(() => ({ x: 0, y: 0, visible: false, scale: 1, angle: 0, len: 0, wid: 0, bend: 0 }));
    this.lastAffordable = '';
    this.cameras.main.setBackgroundColor(PALETTE.mappa.fondo);
    this.cameras.main.postFX.clear();
    this.fxCheckAt = this.time.now + 2000; // primo controllo dopo l'avvio
    if (!LOW_END && BALANCE.fx.bloom) this.cameras.main.postFX.addBloom(0xffffff, 1, 1, BALANCE.fx.bloom.blur, BALANCE.fx.bloom.strength, BALANCE.fx.bloom.steps);

    // carta politica: forme smussate delle province, disegnate una volta sola
    this.shapes = buildShapes(loadWorld());
    this.ruinTiles = this.map.land.filter((i) => this.map.tiles[i]!.type === 'rovine');
    this.chainBox = new Float32Array(this.shapes.chains.length * 4);
    this.shapes.chains.forEach((c, k) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let j = 0; j < c.pts.length; j += 2) {
        x0 = Math.min(x0, c.pts[j]); x1 = Math.max(x1, c.pts[j]);
        y0 = Math.min(y0, c.pts[j + 1]); y1 = Math.max(y1, c.pts[j + 1]);
      }
      this.chainBox.set([x0, y0, x1, y1], k * 4);
    });
    // carta a celle: tutto ciò che è campitura finisce in un layer filtrato dallo shader; confini, segni e pedine restano sopra, netti
    this.mapLayer = this.add.layer().setDepth(D.owned);
    // retro come la carta da terminale: tutta la mappa su una griglia grossa di pixel (l'interfaccia resta nitida, è un'altra scena)
    const before = this.children.list.length;
    this.drawSea();
    this.drawLand();
    this.bakeStatic(this.children.list.slice(before));
    this.drawRelief();
    this.territory?.destroy();
    this.landLayer?.destroy();
    // due strati: la terra (ferma, forme intere: niente fessure tra province) e il territorio delle potenze (cambia spesso)
    this.landLayer = new TerritoryLayer(this, this.shapes.provinces, D.owned - 0.01, Math.min(1, 2 / DPR), this.mapLayer);
    this.landLayer.setVisible(false);
    this.territory = new TerritoryLayer(this, this.shapes.provinces, D.owned, Math.min(1, 2 / DPR), this.mapLayer);
    this.frontOk = new Map();
    // carta da terminale (MapSCII): disegnata a caratteri braille; la carta a campiture resta sotto, nascosta
    this.term?.destroy();
    this.term = new WorldMap(this, this.shapes, D.owned + 0.5);
    this.pen = new GridPen(this.add.graphics().setDepth(this.term.gridDepth));
    this.previewPts = null;
    this.term.setTerrain(Uint8Array.from(this.map.provinces, (p) => TERRAIN_IDX[p.terrain] ?? 0)); // per la base fissa (terra e rilievo)
    // allineata ai pixel a fine fotogramma, dopo ogni spostamento della camera (anche WASD, che arriva dopo il ridisegno):
    // a metà pixel spariva una colonna di puntini, una linea verticale su tutta la carta (Nico)
    // la camera scorre a pixel interi dello schermo: carta (agganciata ai pixel), confini, pedine e nomi si spostano insieme.
    // Prima la carta saltava di pixel interi e il resto no: spostando la mappa sembrava tremare tutto (Nico)
    const align = () => {
      const c = this.cameras.main, z = c.zoom;
      c.scrollX = Math.round(c.scrollX * z) / z;
      c.scrollY = Math.round(c.scrollY * z) / z;
      this.term.align();
    };
    this.events.on('postupdate', align);
    this.events.once('shutdown', () => this.events.off('postupdate', align));
    this.mapLayer.setVisible(false);
    this.borderGfx = this.add.graphics().setDepth(D.borders);
    this.borderKey = '';
    this.planImgs = new Map();
    // nebbia sopra i colori delle fazioni ma sotto pedine e segni
    this.fogVersion = -1;
    this.sightShown = -1;
    this.sightAt = 0;
    this.sightImg = undefined;
    this.sightPrev = undefined;
    this.seaOf = undefined;
    this.seaProv = undefined;
    this.seaLitShown = [];
    this.namesShown = true;
    this.makeFog(!opts.tutorial); // velo nero fuori dalla zona in vista
    this.boatSprites = new Map();
    this.drawNationNames();
    this.flowMarker = this.add.graphics().setDepth(D.units).setVisible(false);
    brackets(this.flowMarker, 0, 0, 12, 2.2, 0xffffff, 1).fillStyle(0xffffff, 0.9).fillRect(-2.5, -2.5, 5, 5); // mirino del bersaglio dell'avanzata
    this.markerPulse = { k: 1 };
    this.tweens.add({ targets: this.markerPulse, k: { from: 0.85, to: 1.2 }, duration: 420, yoyo: true, repeat: -1 });
    this.ending = false;

    this.nameTimer = 0;

    this.selectedCard = null;
    this.selectedUnit = null;
    this.unitSprites = new Map();
    this.flashes = new Map();
    this.pathGfx = this.add.graphics().setDepth(D.path);
    this.battleGfx = this.add.graphics().setDepth(D.marks);
    this.selection = new Set();
    this.box = null;
    this.logistics = false;
    this.boxGfx = this.add.graphics().setDepth(D.fx);
    this.wallGfx = this.add.graphics().setDepth(D.front);
    this.previewGfx = this.add.graphics().setDepth(D.path);
    this.wallMode = false;
    this.buildImg = null;
    this.buildSig = '';
    this.buildWork = null;
    this.mapMode = 'politica';
    this.wallProvs = [];
    this.frontPick = false;
    this.linePick = false;
    this.lining = false;
    this.linePts = [];
    this.attackLines = [];
    this.arrowPick = false; this.zonePick = false;
    this.arrowing = false;
    this.arrowPts = [];
    this.offensives = [];
    this.lineGfx = this.add.graphics().setDepth(this.ovlDepth);
    this.lineTags = [];
    this.groups = new Map();
    this.hoverTile = -1;

    this.redrawOwned();
    this.redrawFrontier(true);
    setupCamera(this);
    if (resume) { this.cameras.main.setZoom(resume.cam.zoom); this.cameras.main.setScroll(resume.cam.x, resume.cam.y); this.syncUnits(); }
    this.resumeSaveAt = 0;
    this.setupInput();

    this.scene.launch('Hud');
    this.scene.bringToTop('Hud');
    music.setMode('run');
    this.musicAt = 0;
  }

  update(time: number, delta: number) {
    this.pen.begin(this.term.dotDensity, this.cameras.main.worldView); // i segni nella griglia si ridisegnano a ogni fotogramma
    if (!this.selectedCard && this.recruitImgs.length) this.syncRecruit(); // carta lasciata da altrove: via le città evidenziate
    // qualità adattiva: se il bagliore rallenta troppo il dispositivo, si spegne (la leggibilità viene prima)
    if (this.cameras.main.postFX.list.length && time - this.fxCheckAt > 3000) {
      this.fxCheckAt = time;
      if (this.game.loop.actualFps < 40) this.cameras.main.postFX.clear();
    }
    const ticks = this.state.update(delta);
    let pops = 0;
    let byId: Map<number, Unit> | null = null; // pedine per id, fatte solo se servono (prima ogni colpo scorreva tutte le pedine)
    const unitById = (id: number) => (byId ??= new Map(this.state.units.map((u) => [u.id, u]))).get(id);
    for (const e of this.state.drainEvents()) {
      if (e.type === 'conquer') {
        this.ownedDirty = true;
        if (e.by === PLAYER) {
          if (e.p !== this.tapFxTile && pops++ < 8) this.popFx(e.p);
          sfx('conquer', 0.8);
          this.hud.tutorialSignal('conquer');
        }
        if (e.from === PLAYER && e.by !== NEUTRAL) {
          // avviso nei COMMS: province perse, raccolte ogni 10 s (Nico: "non escono più le robe che ti stanno attaccando")
          this.lostCount++;
          this.lostBy = e.by;
          if (time - this.lostAt > 10_000) { this.lostAt = time; this.hud.onProvinceLost(this.lostBy, this.lostCount); this.lostCount = 0; }
          if (time - this.lastHitFx > 250) {
            this.lastHitFx = time;
            this.lostFx(e.p, e.by);
            sfx('lost');
          }
        }
      } else if (e.type === 'upkeep') {
        this.hud.onUpkeep(e.res);
      } else if (e.type === 'unitDied') {
        // solo le tue o quelle nella tua zona di vista (Nico: esplosioni dall'altra parte del mondo)
        if (e.unit.owner === PLAYER || this.state.inSight(this.state.provOf(e.unit.tile))) this.unitDeathFx(e.unit);
      } else if (e.type === 'province') {
        this.hud.onProvince(e.by, e.capital, e.nation, e.bonus);
        if (e.by === PLAYER) sfx('reward');
      } else if (e.type === 'boat') {
        this.boatLandFx(e.boat, e.phase);
      } else if (e.type === 'flowEnd') {
        if (e.reason === 'budget' && this.flowMarker.visible) this.floatText(this.flowMarker.x, this.flowMarker.y - 8, 'force spent', MAP_INK);
        this.flowMarker.setVisible(false);
      } else if (e.type === 'event') {
        this.hud.onReport(); // nel tasto RADAR, senza fermare il gioco né togliere la selezione
        sfx('event');
      } else if (e.type === 'timer') {
        this.hud.onTimer();
      } else if (e.type === 'ability') {
        this.abilityFx(e.ability, e.tile, e.phase, e.hits ?? 0, e.by, !!e.blocked);
      } else if (e.type === 'coalition') {
        this.hud.onCoalition(e.phase, e.members);
        this.ownedDirty = true;
      } else if (e.type === 'provinceDone') {
        if (e.by === PLAYER) {
          const { x, y } = center(this.map.provinces[e.province].anchor);
          this.floatText(x, y + 6, `+${e.troops} troops`, MAP_SEL, 120);
        }
      } else if (e.type === 'offensive') {
        this.hud.onOffensive(e.faction, e.phase, e.lost);
        if (e.phase === 'warn' || e.phase === 'start') sfx('alert');
      } else if (e.type === 'work') {
        this.borderKey = ''; // icone delle costruzioni da ridisegnare
        if (e.by === PLAYER) {
          const { x, y } = center(this.map.provinces[e.p].anchor);
          const name = WORK_NAME[e.work];
          if (e.phase === 'done') {
            this.flashProvince(e.p, PALETTE.ocra, 0.55, 700);
            this.floatText(x, y - 6, `${name} ready`, PALETTE.ocra);
            buzz(20);
            sfx('built');
          } else {
            this.floatText(x, y - 6, `building: ${name.toLowerCase()}`, PALETTE.allerta);
            sfx('build');
          }
        }
        this.hud.refreshProvince();
      } else if (e.type === 'diplomacy') {
        this.ownedDirty = true; // il fronte attaccabile cambia con la guerra e la pace
        this.hud.onDiplomacy(e.faction, e.what, e.byPlayer, e.amount ?? 0);
        if (e.what === 'war') sfx('war');
        else if (e.what === 'peace' || e.what === 'alliance') sfx('peace');
      } else if (e.type === 'encircled') {
        if (e.by === PLAYER || e.from === PLAYER) {
          for (const p of e.provinces.slice(0, 12)) this.flashProvince(p, e.by === PLAYER ? MAP_SEL : PALETTE.ko, 0.6, 700);
          this.hud.onEncircled(e.by, e.from, e.provinces.length);
          if (e.by === PLAYER) buzz([20, 30, 20]);
          sfx(e.by === PLAYER ? 'reward' : 'lost', 1, false);
        }
      } else if (e.type === 'battle') {
        this.ownedDirty = true; // il fronte attaccabile cambia
        const b = e.battle, { x, y } = center(this.map.provinces[b.p].anchor);
        if (e.phase === 'start' && b.from === PLAYER) {
          this.flashProvince(b.p, PALETTE.ko, 0.5, 600);
          sfx('battle');
          if (time - this.lastDefendToast > 8000) { this.lastDefendToast = time; this.hud.onDefending(b.by); }
        } else if (e.phase === 'lost' && b.by === PLAYER) {
          this.failFx(x, y, 'repelled!');
          sfx('repelled');
        } else if (e.phase === 'lost' && b.from === PLAYER) {
          this.floatText(x, y - 4, 'held!', MAP_SEL);
          sfx('held');
        }
      } else if (e.type === 'hit') {
        // colpi tra pedine delle IA lontane da te: niente (Nico: "togliere tutti quegli effettini")
        const toOwner = unitById(e.to)?.owner;
        // solo i colpi sullo schermo: fuori erano centinaia di grafiche e animazioni al secondo che nessuno vedeva (cali)
        const onScreen = this.cameras.main.worldView.contains(center(e.toTile).x, center(e.toTile).y);
        if (onScreen && (e.owner === PLAYER || toOwner === PLAYER || this.state.inSight(this.state.provOf(e.toTile)))) this.hitFx(e.from, e.to, e.fromTile, e.toTile, e.dmg, e.owner, unitById);
        if (onScreen) {
          // il suono dell'arma di chi spara: fucile, mitra per i ricognitori, cannone per artiglieria, carri e cannoniere
          const ty = unitById(e.from)?.type;
          sfx(ty === 'ricognitori' ? 'shotSmg' : ty === 'artiglieria' || ty === 'corazzati' || ty === 'cannoniera' ? 'shotCannon' : 'shot', 0.7);
        }
      } else if (e.type === 'capital') {
        if (e.faction === PLAYER) {
          this.flashProvince(e.p, PALETTE.ocra, 0.6, 900);
          this.hud.onCapital();
          sfx('alert');
        }
      } else if (e.type === 'focus') {
        // rapporto del radar: la carta va sulla provincia segnalata
        const { x, y } = center(this.map.provinces[e.p].anchor);
        this.cameras.main.pan(x, y, 450, 'Sine.easeInOut');
        sfx('ping');
        this.flashProvince(e.p, PALETTE.allerta, 0.6, 900);
      } else if (e.type === 'objective') {
        this.hud.onObjective(e.phase, e.objective);
        if (e.phase === 'done') sfx('alert');
      } else {
        this.hud.onEliminated(e.faction, e.by, e.loot);
      }
    }
    this.drawBattles(time);
    this.syncUnits();
    this.syncBoats();
    this.scaleMarkers();
    if (this.state.opts.fog && this.state.fogVersion !== this.fogVersion) this.redrawFog();
    if (!this.state.opts.tutorial && this.state.sightVersion !== this.sightShown && time - this.sightAt > 300) this.redrawSight(time);
    this.tapFxTile = -1;
    // nomi delle nazioni solo nella vista strategica: da vicino si combatte, non si legge l'atlante
    const showNames = this.cameras.main.zoom < BALANCE.provinces.namesMaxZoom * UI();
    if (showNames !== this.namesShown) {
      this.namesShown = showNames;
      this.tweens.add({ targets: this.nationNames, alpha: showNames ? 0.5 : 0, duration: 200 });
    }
    const ms = BALANCE.milestones;
    while (this.nextMilestone < ms.length && this.state.player.provinces >= ms[this.nextMilestone]) {
      this.hud.onMilestone(ms[this.nextMilestone++]);
    }
    if (this.state.over && !this.ending) this.finish();
    // musica: calma in pace, battito se sei in guerra con qualcuno, tesa durante un'offensiva contro di te
    if (time - this.musicAt > 2000) {
      this.musicAt = time;
      const st = this.state;
      const war = st.factions.some((f, i) => i !== PLAYER && f.alive && f.kind === 'empire' && st.atWar(PLAYER, i));
      const hot = st.offensive?.phase === 'on' || st.battles.some((b) => b.from === PLAYER);
      music.setIntensity(this.ending ? 0 : hot ? 2 : war ? 1 : 0);
    }
    if (DEV && !this.state.over && time - this.resumeSaveAt > 10_000) {
      this.resumeSaveAt = time;
      const c = this.cameras.main;
      void saveResume(this.state, this.runSeed, this.map.kinds, { x: c.scrollX, y: c.scrollY, zoom: c.zoom });
    }
    // territori ridisegnati al massimo 4 volte al secondo: con 150 milizie qualcuno conquista a ogni tick e la carta,
    // i confini e le città si rifacevano a ogni fotogramma (scatti)
    if (this.ownedDirty && time - this.ownedAt >= 250) {
      this.ownedAt = time;
      this.ownedDirty = false;
      this.redrawOwned();
      this.redrawFrontier(true);
    } else if (ticks > 0) {
      this.redrawFrontier();
    }
    this.workTimer -= delta;
    if (this.workTimer <= 0) {
      this.workTimer = 400;
      let sig = 0;
      for (let p = 0; p < this.state.provWork.length; p++) if (this.state.provWork[p] >= 0 && this.state.provWorkAt[p] === 0) sig = (sig * 31 + p * 13 + this.state.provWork[p]) | 0;
      if (sig !== this.worksSig) { this.worksSig = sig; this.termDirty = true; }
      if (this.state.provWorkAt.some((t) => t > 0)) this.borderKey = ''; // avanzamento dei cantieri
    }
    const cardP = this.hud.cardProvince;
    if (cardP !== this.workCardP) { this.workCardP = cardP; this.termDirty = true; this.borderKey = ''; } // costruzioni della provincia toccata
    this.redrawBorders(time);
    this.term.work(6); // livelli della carta in preparazione e territori cambiati: qualche millisecondo per fotogramma
    this.redrawTerminal();
    this.drawGrid();
    const zc = this.cameras.main.zoom / UI();
    const landMode = zc >= 2.2; // da qui in su la carta cotta si vedrebbe sgranata
    if (landMode !== this.landMode) {
      this.landMode = landMode;
      this.landLayer.setVisible(landMode);
      this.landLayer.invalidate();
      this.territory.invalidate();
    }
    // forme intere da vicino: semplificate ognuna per conto suo lasciavano fessure scure negli angoli tra le province
    // (la carta a campiture è nascosta sotto quella da terminale: se non si vede, non si ridisegna)
    if (this.mapLayer.visible) {
      if (landMode) {
        this.landLayer.update(time, 1, (a, b, c, d) => this.landFills(a, b, c, d),
          {});
      }
      this.territory.update(time, landMode ? 1 : 4, (a, b, c, d) => this.territoryFills(a, b, c, d));
    }
    this.syncPlan();
    this.drawAttackLines();
    this.syncNationHover();
    this.syncToolCursor();
    this.nameTimer -= delta;
    if (this.nameTimer <= 0) {
      this.nameTimer = 2000;
      // solo se il territorio è cambiato (Nico: cali a fine partita; costava ~12 ms con 18 000 province)
      if (this.state.ownVersion !== this.nameVersion) { this.nameVersion = this.state.ownVersion; this.placeNameTags(); }
    }
    this.keyPan(delta);
    this.updateHover(time);
    this.labelTimer -= delta;
    if (this.labelTimer <= 0) {
      this.labelTimer = 200;
      this.updateLabels();
      if (this.logistics && (this.logiTimer -= 200) <= 0) { this.logiTimer = 1000; this.termDirty = true; } // il rifornimento cambia col tempo
      if (this.buildWork) this.syncBuildable();
    }
  }

  private get hud() {
    return this.scene.get('Hud') as HudScene;
  }

  get selectedUnitId(): number | null {
    return this.selectedUnit;
  }

  setSpeed(s: number) {
    this.state.speed = s;
  }

  // ---------- disegno ----------



  /**
   * Mare, reticolo, celle e confini non cambiano mai: li disegniamo una volta in texture a tasselli ad alta risoluzione
   * (nitide anche con lo zoom) invece di ridisegnare migliaia di forme a ogni fotogramma.
   */
  private bakeStatic(objs: Phaser.GameObjects.GameObject[]) {
    const M = 12;
    const renderer = this.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    const maxTex = Math.min(4096, typeof renderer.getMaxTextureSize === 'function' ? renderer.getMaxTextureSize() : 4096);
    const f = LOW_END ? 1.2 : 1.6; // pixel di texture per pixel-mondo (solo campiture: i bordi sono vettoriali)
    const fullW = (WORLD_W + 2 * M) * f, fullH = (WORLD_H + 2 * M) * f;
    const f2 = Math.min(f, (maxTex - 8) / (WORLD_H + 2 * M)); // l'altezza deve stare in una texture
    const tiles = Math.ceil(((WORLD_W + 2 * M) * f2) / (maxTex - 8));
    const tileW = (WORLD_W + 2 * M) / tiles; // in pixel-mondo
    const holder = this.add.container(0, 0, objs).setScale(f2);
    for (let t = 0; t < tiles; t++) {
      const rt = this.add.renderTexture(-M + t * tileW, -M, Math.ceil(tileW * f2) + 2, Math.ceil((WORLD_H + 2 * M) * f2))
        .setOrigin(0).setScale(1 / f2).setDepth(-1);
      holder.setPosition((M - t * tileW) * f2, M * f2);
      rt.draw(holder);
      this.mapLayer.add(rt);
    }
    void fullW; void fullH;
    holder.destroy(true);
  }

  /** y-mondo di una latitudine (stessa formula delle righe della griglia). */
  private latY(lat: number) {
    return 1.5 * S * (latToV(lat) * BALANCE.map.rows - 0.5) + S;
  }

  /** Pixel-mondo → [lon, lat] (inverso di lonX / latY), per la barra di stato. */
  worldToLonLat(x: number, y: number): [number, number] {
    const { rows } = BALANCE.map;
    const r = (y - S) / (1.5 * S) + 0.5;
    return [uToLon(x / WORLD_W), vToLat(r / rows)];
  }

  private lonX(lon: number) {
    return lonToU(lon) * WORLD_W;
  }

  /** Mare: fondo blu notte, acque basse lungo le coste, meridiani e paralleli discreti ogni 15°. */
  private drawSea() {
    const g = this.add.graphics();
    const MP = PALETTE.mappa;
    void g; void MP; // mare trasparente: sotto c'è il motivo a pixel della carta da terminale (seaPattern)
  }


  /** Linea a pixel lungo un tratto: un punto ogni `gap` pixel-mondo (coste e confini come la mappa del terminale). */
  private dotChain(g: Phaser.GameObjects.Graphics, pts: ArrayLike<number>, w: number, color: number) {
    const out: Phaser.Types.Math.Vector2Like[] = [];
    for (let j = 0; j < pts.length; j += 2) out.push({ x: pts[j], y: pts[j + 1] });
    if (out.length > 1) g.lineStyle(w, color, 1).strokePoints(out, false);
  }


  /**
   * Carta politica alla Call of War: ogni nazione ha un suo tono smorzato (vicine sempre diverse), le province sono
   * sagome smussate con bordi sottili, le nazioni hanno confini chiari. Province corrotte scure e tratteggiate.
   */
  private drawLand() {
    const g = this.add.graphics();
    const MP = PALETTE.mappa, provs = this.map.provinces, tiles = this.map.tiles;
    this.landColor = new Int32Array(provs.length).fill(MP.fondo);
    // colori delle nazioni: greedy sul grafo dei confini
    const tone = new Map<number, number>();
    const nb = new Map<number, Set<number>>();
    provs.forEach((p) => {
      for (const q of p.neighbors) {
        const c = provs[q].country;
        if (c !== p.country) (nb.get(p.country) ?? nb.set(p.country, new Set()).get(p.country)!).add(c);
      }
    });
    const nations = [...new Set(provs.map((p) => p.country))].sort((a, b) => (nb.get(b)?.size ?? 0) - (nb.get(a)?.size ?? 0));
    for (const c of nations) {
      const taken = new Set([...(nb.get(c) ?? [])].map((n) => tone.get(n)));
      let k = ((c * 2654435761) >>> 0) % MP.nazioni.length;
      for (let t = 0; t < MP.nazioni.length && taken.has(k); t++) k = (k + 1) % MP.nazioni.length;
      tone.set(c, k);
    }
    const mix = (a: number, b: number, t: number) => {
      const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t) << s;
      return ch(16) | ch(8) | ch(0);
    };
    const pts = (r: ArrayLike<number>) => {
      const out: Phaser.Types.Math.Vector2Like[] = [];
      for (let j = 0; j < r.length; j += 2) out.push({ x: r[j], y: r[j + 1] });
      return out;
    };
    // dalla più grande: le enclavi finiscono sopra chi le contiene
    const regions = this.shapes.provinces.filter((r) => r.parts.length).sort((a, b) => b.area - a.area);
    for (const r of regions) {
      let color: number = MP.fondo;
      if (r.id >= 0) {
        const p = provs[r.id];
        const frac = (t: string) => p.tiles.filter((i) => tiles[i]!.terrain === t).length / p.tiles.length;
        const jitter = ((((r.id * 40503) >>> 0) % 7) - 3) * 0.012; // province appena distinguibili
        // il terreno tinge la provincia: sabbia nei deserti, roccia in montagna, verde oliva sulle colline
        // carta da terminale: terra piena quasi uniforme, il deserto appena più caldo
        color = mix(MP.nazioni[tone.get(p.country) ?? 0], MP.deserto, frac('deserto') * 0.6);
        void jitter;
      }
      if (r.id >= 0) this.landColor[r.id] = color;
      for (const part of r.parts) {
        g.fillStyle(color, 1).lineStyle(1, color, 1).fillPoints(pts(part.outer), true).strokePoints(pts(part.outer), true, true); // niente fessure tra vicine
        for (const h of part.holes) g.fillStyle(MP.fondo, 1).fillPoints(pts(h), true); // le enclavi arrivano dopo, sopra
      }
    }
    // i confini li disegna redrawBorders, vettoriali e nitidi a ogni zoom
  }

  /**
   * Rilievo morbido (luce da nord-ovest, ombra a sud-est) in una texture a bassa risoluzione: ingrandita, sfuma da sola.
   * Sotto i colori delle fazioni: sopra il territorio parlano i simboli del terreno.
   */
  private drawRelief() {
    // terreno come texture a retino, niente simboli né ombre: montagne a scacchiera fitta, colline a punti radi, deserto a
    // granelli caldi. Tre pixel per casella, ingranditi senza sfumare (retro, come la carta da terminale).
    const { cols, rows } = BALANCE.map, key = 'relief', tiles = this.map.tiles, K = 3;
    if (this.textures.exists(key)) this.textures.remove(key);
    const tex = this.textures.createCanvas(key, cols * K, rows * K)!;
    const ctx = tex.getContext(), img = ctx.createImageData(cols * K, rows * K), d = img.data, W = cols * K;
    const put = (x: number, y: number, r: number, g: number, b: number, a: number) => {
      const k = (y * W + x) * 4;
      d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = a;
    };
    for (const i of this.map.land) {
      const t = tiles[i]!.terrain, c = i % cols, r = Math.floor(i / cols);
      for (let dy = 0; dy < K; dy++) for (let dx = 0; dx < K; dx++) {
        const x = c * K + dx, y = r * K + dy;
        if (t === 'montagne' && (x + y) % 2 === 0) put(x, y, 60, 52, 44, 16);
        else if (t === 'colline' && x % 3 === 0 && y % 3 === 1) put(x, y, 60, 52, 44, 12);
        else if (t === 'deserto' && (x * 7 + y * 3) % 5 === 0) put(x, y, 176, 132, 60, 18);
      }
    }
    ctx.putImageData(img, 0, 0);
    tex.refresh();
    tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    // sopra la terra (anche quella vettoriale da vicino), sotto i colori delle potenze
    this.relief = this.add.image(0, 0.25 * S, key).setOrigin(0).setScale(HEX_W / K, (1.5 * S) / K).setDepth(D.owned - 0.005);
    this.mapLayer.add(this.relief);
    this.relief.setVisible(false); // la carta del terminale non ha terreno
  }



  /** Territorio: un solo colore pieno per potenza (sagome tinte); i nemici nella nebbia non si vedono. */
  /** Colore pieno di ogni fazione sulla carta (un po' smorzato verso il blu notte, come inchiostro sulla mappa). */
  private get ownTone(): number[] {
    return FACTION_INFO.map((f) => f.fill);
  }

  /** Passi dalla capitale lungo il proprio territorio (per provincia), ricalcolati quando cambia la carta. */
  private capDist = new Int16Array(0);
  private capitalSteps(): Int16Array {
    const own = this.state.provOwner, provs = this.map.provinces;
    if (this.capDist.length !== own.length) this.capDist = new Int16Array(own.length);
    const d = this.capDist.fill(-1), queue: number[] = [];
    this.state.capitalProv.forEach((p, f) => { if (p >= 0 && own[p] === f) { d[p] = 0; queue.push(p); } });
    for (let h = 0; h < queue.length; h++) {
      const c = queue[h];
      for (const q of provs[c].neighbors) if (d[q] < 0 && own[q] === own[c]) { d[q] = d[c] + 1; queue.push(q); }
    }
    return d;
  }

  private redrawOwned() {
    this.territory.invalidate();
    this.termDirty = true;
    this.borderKey = ''; // confini da ridisegnare
  }

  /** Terra da vicino: il colore della nazione di ogni provincia inquadrata. */
  private landFills(x0: number, y0: number, x1: number, y1: number): TerritoryFill[] {
    const shapes = this.shapes.provinces, out: TerritoryFill[] = [];
    for (let p = 0; p < shapes.length; p++) {
      const s = shapes[p];
      if (!s.parts.length || s.x1 < x0 || s.x0 > x1 || s.y1 < y0 || s.y0 > y1) continue;
      out.push({ p, color: this.landColor[p], alpha: 1, layer: 0 });
    }
    return out;
  }

  /** Cosa colorare nel riquadro: territorio delle potenze (i nemici nella nebbia no) e velo chiaro sul fronte. */
  private territoryFills(x0: number, y0: number, x1: number, y1: number): TerritoryFill[] {
    const own = this.state.provOwner, tone = this.ownTone, shapes = this.shapes.provinces, out: TerritoryFill[] = [];
    const dist = this.capitalSteps();
    const mixC = (a: number, b: number, t: number) => {
      const ch = (sh: number) => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t) << sh;
      return ch(16) | ch(8) | ch(0);
    };
    // da molto vicino il territorio lascia trasparire terreno, rilievo e grana: colore pieno solo da lontano
    const zc = this.cameras.main.zoom / UI(), ta = zc >= 5 ? Phaser.Math.Linear(1, 0.8, Math.min(1, (zc - 5) / 4)) : 1;
    for (let p = 0; p < own.length; p++) {
      const s = shapes[p];
      if (!s.parts.length || s.x1 < x0 || s.x0 > x1 || s.y1 < y0 || s.y0 > y1) continue;
      const o = own[p];
      if (o === NEUTRAL || (o !== PLAYER && !this.state.seesProv(p))) continue;
      // carta statistica: il colore si accende verso la capitale e si spegne dove il rifornimento cala (sacche tagliate fuori)
      const near = dist[p] >= 0 ? Math.max(0, 1 - dist[p] / 7) : 0, sup = this.state.supply[p];
      let color = mixC(tone[o], 0xffffff, near * near * 0.12); // più chiaro verso la capitale (sotto la soglia dei confini)
      if (sup < 0.98) color = mixC(color, 0x1c1814, (1 - sup) * 0.5);
      out.push({ p, color, alpha: ta, layer: 1 });
    }
    for (const [p, ok] of this.frontOk) {
      const s = shapes[p];
      if (s.x1 < x0 || s.x0 > x1 || s.y1 < y0 || s.y0 > y1) continue;
      out.push({ p, color: 0xffffff, alpha: ok ? 0.14 : 0.05, layer: 1 });
    }
    return out;
  }

  /**
   * Confini tra potenze: linee nitide di spessore costante sullo schermo, solo per i tratti inquadrati
   * (si ridisegnano quando cambia la mappa o ci si sposta).
   */
  private redrawBorders(time = 0) {
    const cam = this.cameras.main, v = cam.worldView;
    const key = `${Math.round(v.x / 20)}:${Math.round(v.y / 20)}:${cam.zoom.toFixed(2)}`;
    if (key === this.borderKey) return;
    // mentre si trascina la mappa la vista cambia ad ogni frame: i confini non devono ridisegnarsi così spesso (lag)
    if (this.dragging && time - this.lastBorderRedrawAt < 90) return;
    this.lastBorderRedrawAt = time;
    this.borderKey = key;
    const g = this.borderGfx.clear();
    const own = this.state.provOwner, provs = this.map.provinces, MP = PALETTE.mappa;
    const seen = (p: number) => (p < 0 ? NEUTRAL : own[p] !== PLAYER && !this.state.seesProv(p) ? NEUTRAL : own[p]);
    const z = cam.zoom / UI(); // zoom in punti CSS
    const px = 1 / z; // un punto sullo schermo, in pixel-mondo
    const step = z < 2.8 ? 4 : z < 5.2 ? 2 : 1; // da lontano meno punti
    const box = this.chainBox, m = 4;
    const inView = (k: number) => !(box[k * 4 + 2] < v.x - m || box[k * 4] > v.right + m || box[k * 4 + 3] < v.y - m || box[k * 4 + 1] > v.bottom + m);
    if (this.term) return this.drawCities(g, v, px); // città e capitali anche sulla carta da terminale (erano sparite)
    // reticolo a matita ogni 15°, sotto i confini
    const { latMax, latMin } = BALANCE.map;
    g.lineStyle(1 * px, MP.reticolo, 0); // reticolo spento (il terminale non lo ha)
    const gy0 = Math.max(v.y, 0), gy1 = Math.min(v.bottom, WORLD_H), gx0 = Math.max(v.x, 0), gx1 = Math.min(v.right, WORLD_W);
    for (let lon = -180; lon <= 180; lon += 15) { const x = this.lonX(lon); if (x >= gx0 && x <= gx1) g.lineBetween(x, gy0, x, gy1); }
    for (let lat = -45; lat <= 75; lat += 15) {
      if (lat > latMax || lat < latMin) continue;
      const y = this.latY(lat);
      if (y >= gy0 && y <= gy1) g.lineBetween(gx0, y, gx1, y);
    }
    // atlante: province a filo sottile (solo da vicino), nazioni a inchiostro, coste appena accennate (le celle fanno il resto)
    this.shapes.chains.forEach((c, k) => {
      if (!inView(k)) return;
      const pa = c.a >= 0 ? provs[c.a] : null, pb = c.b >= 0 ? provs[c.b] : null;
      if (pa && pb && pa.country === pb.country) {
        if (z < 6.5) return; // confini di provincia solo da vicino: da medio zoom erano un tappeto di puntini
        return; // il terminale mostra solo i confini nazionali
      } else if (pa && pb) this.dotChain(g, c.pts, 1.1 * px, MP.confine);
    });
    this.drawCities(g, v, px);
    // confini tra potenze, sopra
    const w = 2 * px;
    const edges: { k: number; o: number }[] = [];
    this.shapes.chains.forEach((c, k) => {
      const oa = seen(c.a), ob = seen(c.b);
      if (oa === ob || !inView(k)) return;
      edges.push({ k, o: oa === PLAYER || ob === PLAYER ? PLAYER : oa !== NEUTRAL ? oa : ob });
    });
    // una sola linea d'inchiostro della potenza, niente ombre né aloni (Nico: il bagliore del fronte era inutile)
    for (const { k, o } of edges) {
      this.dotChain(g, this.shapes.chains[k].pts, 1.2 * px, FACTION_INFO[o].border);
    }
    void w; void step;
  }

  /** Segni nella griglia di puntini, a ogni fotogramma: collegamenti, costruzioni, rifornimento, anteprima del percorso. */
  private drawGrid() {
    const cam = this.cameras.main, v = cam.worldView, zc = cam.zoom / UI(), provs = this.map.provinces, m = 30;
    const inV = (p: { x: number; y: number }) => p.x > v.x - m && p.x < v.right + m && p.y > v.y - m && p.y < v.bottom + m;
    // zoom massimo (alla Call of War): centro di ogni provincia e collegamenti con le vicine
    if (zc >= BALANCE.camera.linksZoom) {
      for (let p = 0; p < provs.length; p++) {
        const pr = provs[p];
        if (pr.anchor < 0) continue;
        const c = center(pr.anchor);
        if (!inV(c)) continue;
        // più contrasto (Nico): più piena, e scura sul tuo territorio chiaro (bianco su azzurro non si vedeva); ogni metà del
        // collegamento prende il colore della provincia in cui sta
        const ink = (o: number) => (o === PLAYER ? NET_DARK : MAP_INK);
        for (const q of pr.neighbors) {
          if (provs[q].anchor < 0 || (q < p && inV(center(provs[q].anchor)))) continue; // una volta per coppia
          const b = center(provs[q].anchor), mx = (c.x + b.x) / 2, my = (c.y + b.y) / 2;
          this.pen.line(c.x, c.y, mx, my, ink(this.state.provOwner[p]), 0.8, 1);
          this.pen.line(mx, my, b.x, b.y, ink(this.state.provOwner[q]), 0.8, 1);
        }
        this.pen.block(c.x, c.y, 3, ink(this.state.provOwner[p]), 1);
      }
    }
    if (this.previewPts) this.corridor(this.pathGfx, this.previewPts, MAP_SEL, false);
    this.drawSupplyLines();
  }

  /** Costruzioni sulla carta (le tue e quelle che vedi), nella griglia: riquadro nero, cornice e icona a celle. */
  /**
   * Fonti del rifornimento nelle mappe terreno e logistica: un riquadro sulla capitale e su ogni deposito. Le linee dalla
   * capitale ai depositi e dai reparti alla fonte sono tolte (Nico, 26 novembre 2026: "un po' too much").
   */
  private drawSupplyLines() {
    if (this.mapMode === 'politica') return;
    const st = this.state, provs = this.map.provinces;
    const cap = st.capitalProv[PLAYER];
    if (cap < 0) return;
    const sources = [cap];
    for (let p = 0; p < st.provOwner.length; p++) if (p !== cap && st.provOwner[p] === PLAYER && st.workOf(p) === 'rifornimenti') sources.push(p);
    // capitale: cornice bianca; depositi: cubetti neri con il bordo bianco (Nico)
    const n = this.cameras.main.zoom / UI() < 3 ? 3 : 5; // da lontano più piccoli (Nico: "dalla mappa grande sono veramente grandi")
    for (const p of sources) {
      const c = center(provs[p].anchor);
      if (p !== cap) this.pen.block(c.x, c.y, n, 0x000000, 1);
      this.pen.frame(c.x, c.y, n, 0xe9ebe6, 0.95);
    }
  }

  /** Carta da terminale: si ridisegna quando si sposta la vista o cambia il territorio. */
  private redrawTerminal() {
    const cam = this.cameras.main, zv = cam.zoom / UI();
    // la carta è disegnata una volta (immagini fisse, come OpenFront): spostarsi e zoomare non ridisegna niente. Qui si passano
    // solo i territori quando cambiano (e i nomi delle nazioni, che dipendono da quanto è grande il paese sullo schermo)
    const zKey = Math.round(Math.log2(zv) * 6);
    if (!this.termDirty && zKey === this.termZoomKey) return;
    this.termDirty = false;
    this.termZoomKey = zKey;
    const own = this.state.provOwner, provs = this.map.provinces, shapes = this.shapes.provinces;
    const terrain = this.mapMode === 'terreno'; // vista del terreno: niente potenze né nomi, ogni provincia nel colore del suo terreno
    const works = this.mapMode === 'strutture' || !!this.buildWork || this.buildPeek;
    const seen = (p: number) => (p < 0 || terrain ? NEUTRAL : own[p] !== PLAYER && !this.state.seesProv(p) ? NEUTRAL : own[p]);
    const frame: TermFrame = { view: new Phaser.Geom.Rectangle(0, 0, WORLD_W, WORLD_H), provinces: [], borders: [], labels: [], status: '' };
    for (let p = 0; p < shapes.length; p++) {
      if (!shapes[p].parts.length) continue;
      const o = seen(p);
      // vista logistica: le tue province colorate dal rifornimento
      // sfumata: metà la sua, metà la media delle tue province accanto (passaggi morbidi, Nico); le altre potenze sbiadite
      let sup = -1;
      if (this.logistics && o === PLAYER) {
        let sum = 0, n = 0;
        for (const q of provs[p].neighbors) if (own[q] === PLAYER) { sum += this.state.supply[q]; n++; }
        sup = n ? (this.state.supply[p] + sum / n) / 2 : this.state.supply[p];
      }
      // vista strutture (anche in COSTRUISCI): la costruzione a colori/righe, il resto sbiadito
      const work = works && o !== NEUTRAL ? (this.state.provWork[p] >= 0 ? WORKS[this.state.provWork[p]] : this.state.isCity(p) ? 'citta' : null) : null;
      const wv = work ? WORK_VIEW[work] : undefined;
      // COSTRUISCI trasparente (Nico, 26 novembre 2026: "se sono in logistica o terreno e poi in build devo fare avanti e
      // indietro; con la build al 50% capisco dove mettere depositi, radar e fabbriche"): sotto resta la vista scelta
      // (politica, terreno, logistica), le costruzioni sopra a metà. Prima tutto il resto sbiadito
      const base = terrain ? (own[p] === PLAYER ? OWN_TERRAIN[provs[p].terrain] : TERRAIN_VIEW[provs[p].terrain]?.col) ?? null
        : sup >= 0 ? LOGI_COLS[Math.round(Phaser.Math.Clamp((sup - 0.3) / 0.65, 0, 1) * LOGI_STEPS)]
        : o === NEUTRAL ? null : this.logistics ? this.fadedFill(o) : hex(FACTION_INFO[o].fill);
      const color = wv ? (base ? mixHex(base, wv.col, BALANCE.ui.buildMix) : wv.col) : base;
      // muro: le province con un bunker finito hanno il confine fortificato
      const fort = o !== NEUTRAL && this.state.provWork[p] === BUNKER && this.state.provWorkAt[p] === 0 && this.showWork(p);
      frame.provinces.push({ id: p, color, terrain: TERRAIN_IDX[provs[p].terrain] ?? 0, fort, stripe: wv ? wv.stripe : terrain && own[p] !== PLAYER ? TERRAIN_VIEW[provs[p].terrain]?.stripe ?? 0 : 0 }); // le tue: piene, col confine
    }
    frame.ownLines = !!(this.buildWork || this.buildPeek) && !terrain; // COSTRUISCI: le tue province una per una (Nico)
    // bordi delle province dentro i territori: politica (Nico) e, leggerissimi, logistica (si vede come cala il rifornimento)
    frame.provLines = this.mapMode === 'politica' || this.logistics;
    frame.provLineK = this.logistics ? 0.85 : 0.6;
    // (binari delle ferrovie tolti, Nico: "brutti da vedere, non hanno un vero uso")
    // COSTRUISCI: il tuo confine di terra come nella vista politica (Nico): blu col vicino, rosso con chi sei in guerra;
    // niente costa
    if (works) this.shapes.chains.forEach((c) => {
      if (c.a < 0 || c.b < 0) return;
      const ma = own[c.a] === PLAYER, mb = own[c.b] === PLAYER;
      if (ma === mb) return;
      const other = ma ? own[c.b] : own[c.a];
      frame.borders.push({ pts: Array.from(c.pts), color: other !== NEUTRAL && this.state.atWar(PLAYER, other) ? '#e0473a' : PLAYER_EDGE, dash: false });
    });
    // logistica: la catena dei depositi, ognuno legato al più vicino verso la capitale
    if (this.logistics) for (const [p, q] of this.state.depotLinks) {
      const a = center(provs[p].anchor), b = center(provs[q].anchor);
      frame.borders.push({ pts: [a.x, a.y, b.x, b.y], color: '#000000', dash: false }); // solo nera, un puntino (Nico: bianca col bordo sembrava spessa)
    }
    // confine di ogni territorio: l'ultimo puntino del riempimento, nel colore di confine della potenza (il tuo: blu)
    frame.edges = {};
    frame.coasts = {};
    // potenze IA: il colore del confine schiarito verso il bianco, se no sul riempimento dello stesso colore non si vedeva (Nico)
    const bright = (c: number) => Phaser.Display.Color.Interpolate.ColorWithColor(Phaser.Display.Color.ValueToColor(c), Phaser.Display.Color.ValueToColor(0xffffff), 100, 55);
    for (let f = 0; f < FACTION_INFO.length; f++) {
      const b = bright(FACTION_INFO[f].border);
      frame.edges[hex(FACTION_INFO[f].fill)] = f === PLAYER ? PLAYER_EDGE : hex(Phaser.Display.Color.GetColor(b.r, b.g, b.b));
      // costa: il riempimento della potenza scurito (il bordo chiaro sul mare chiaro non si vedeva: Nico, "non accerchia")
      const dk = Phaser.Display.Color.Interpolate.ColorWithColor(Phaser.Display.Color.ValueToColor(FACTION_INFO[f].fill), Phaser.Display.Color.ValueToColor(0x000000), 100, 50);
      frame.coasts[hex(FACTION_INFO[f].fill)] = f === PLAYER ? PLAYER_EDGE : hex(Phaser.Display.Color.GetColor(dk.r, dk.g, dk.b)); // riempimento scurito
    }
    if (this.logistics) for (const c of LOGI_COLS) frame.edges[c] = PLAYER_EDGE;
    // vista terreno: il tuo territorio resta riconoscibile (terreno schiarito e il tuo confine attorno, Nico)
    if (terrain) { for (const c of Object.values(OWN_TERRAIN)) frame.edges[c] = PLAYER_EDGE; frame.same = Object.values(OWN_TERRAIN); }
    if (this.logistics) frame.same = LOGI_COLS; // le sfumature del tuo territorio: un confine solo attorno, niente linee dentro
    const warF = FACTION_INFO.map((_, f) => f).filter((f) => f !== PLAYER && this.state.atWar(PLAYER, f));
    const war = warF.map((f) => (this.logistics ? this.fadedFill(f) : hex(FACTION_INFO[f].fill)));
    frame.front = { own: [hex(FACTION_INFO[PLAYER].fill), ...(this.logistics ? LOGI_COLS : [])], war, color: '#e0473a' };
    const zpx = cam.zoom / DPR; // punti CSS per pixel-mondo
    if (!terrain) for (const n of this.termNations) if (n.width * zpx >= n.name.length * 9 * 1.1) frame.labels.push({ x: n.x, y: n.y, text: n.name, color: TERM.country, priority: 0 });
    if (!terrain) for (const l of this.termPlaces) frame.labels.push({ x: l.x, y: l.y, text: l.name, color: l.kind === 'city' ? TERM.city : TERM.sea, priority: l.kind === 'city' ? 1 : 2, small: l.kind === 'city' });
    this.term.render(frame);
  }

  /** Simbolo + nome di ogni fazione nel punto più interno del suo territorio, più grande se l'impero cresce. */
  private nameVersion = -1;
  private lostAt = -Infinity; // ultimo avviso di province perse
  private lostCount = 0;
  private lostBy = -1;

  private placeNameTags() {
    // nome della potenza dentro il suo territorio, alla HOI4: al centro delle sue province (che vedi), lungo l'asse più lungo
    // del territorio (componenti principali dei centri delle province, pesati per grandezza)
    const own = this.state.provOwner, provs = this.map.provinces, F = this.state.factions.length;
    const sw = new Float64Array(F), sx = new Float64Array(F), sy = new Float64Array(F);
    const pts: { x: number; y: number; w: number; p: number }[][] = this.state.factions.map(() => []);
    // solo il pezzo di territorio più grande (Nico: il nome finiva sopra le terre degli altri quando l'impero era a pezzi)
    const vis = (p: number) => own[p] !== NEUTRAL && (own[p] === PLAYER || this.state.seesProv(p)); // niente nomi nella nebbia
    const comp = new Int32Array(own.length).fill(-1), best = new Map<number, { id: number; w: number }>();
    let nc = 0;
    for (let p = 0; p < own.length; p++) {
      if (comp[p] >= 0 || !vis(p)) continue;
      const o = own[p], q = [p];
      comp[p] = nc;
      let w = 0;
      for (let h = 0; h < q.length; h++) {
        w += provs[q[h]].tiles.length;
        for (const n of provs[q[h]].neighbors) if (comp[n] < 0 && own[n] === o && vis(n)) { comp[n] = nc; q.push(n); }
      }
      if (w > (best.get(o)?.w ?? 0)) best.set(o, { id: nc, w });
      nc++;
    }
    for (let p = 0; p < own.length; p++) {
      const o = own[p];
      if (comp[p] < 0 || best.get(o)?.id !== comp[p]) continue;
      const { x, y } = center(provs[p].anchor), w = provs[p].tiles.length;
      sw[o] += w; sx[o] += x * w; sy[o] += y * w;
      pts[o].push({ x, y, w, p });
    }
    this.state.factions.forEach((f, k) => {
      const tag = this.factionTags[k];
      if (!f.alive || !sw[k]) return void (tag.visible = false);
      const mx = sx[k] / sw[k], my = sy[k] / sw[k];
      let xx = 0, xy = 0, yy = 0;
      for (const q of pts[k]) { const dx = q.x - mx, dy = q.y - my; xx += dx * dx * q.w; xy += dx * dy * q.w; yy += dy * dy * q.w; }
      let ang = 0.5 * Math.atan2(2 * xy, xx - yy);
      if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
      ang = Phaser.Math.Clamp(ang, -0.6, 0.6); // scritte quasi orizzontali, come sulle carte
      const ux = Math.cos(ang), uy = Math.sin(ang);
      let lo = Infinity, hi = -Infinity, wlo = Infinity, whi = -Infinity;
      for (const q of pts[k]) {
        const along = (q.x - mx) * ux + (q.y - my) * uy, across = -(q.x - mx) * uy + (q.y - my) * ux, r = Math.sqrt(q.w) * S * 0.9;
        lo = Math.min(lo, along - r); hi = Math.max(hi, along + r); wlo = Math.min(wlo, across - r); whi = Math.max(whi, across + r);
      }
      const mid = (lo + hi) / 2;
      let x = mx + ux * mid, y = my + uy * mid;
      // il centro cade fuori dal territorio (forma a C): sul centro della sua provincia più vicina
      const at = this.state.provOf(pixelToIndex(x, y));
      if (at < 0 || own[at] !== k) {
        const q = pts[k].reduce((a, b) => (Math.hypot(b.x - x, b.y - y) < Math.hypot(a.x - x, a.y - y) ? b : a));
        x = q.x; y = q.y;
      }
      // curva del nome (HOI4, Nico): parabola across = a·along² sui centri delle province rispetto al punto del nome, pesata
      // per grandezza; piegatura al massimo un quarto della lunghezza
      let s4 = 0, s2 = 0, sy2 = 0, sw2 = 0;
      for (const q of pts[k]) {
        const t = (q.x - x) * ux + (q.y - y) * uy, c = -(q.x - x) * uy + (q.y - y) * ux;
        s4 += q.w * t ** 4; s2 += q.w * t * t; sy2 += q.w * c * t * t; sw2 += q.w;
      }
      const m2 = s2 / Math.max(1e-6, sw2), vt = s4 / Math.max(1e-6, sw2) - m2 * m2;
      let bend = vt > 1e-6 ? (sy2 / Math.max(1e-6, sw2) - m2 * (pts[k].reduce((a2, q) => a2 + q.w * (-(q.x - x) * uy + (q.y - y) * ux), 0) / Math.max(1e-6, sw2))) / vt : 0;
      const half = (hi - lo) / 2, maxBow = (hi - lo) * 0.25;
      if (half > 0) bend = Phaser.Math.Clamp(bend, -maxBow / (half * half), maxBow / (half * half));
      Object.assign(tag, { x, y, angle: ang, len: hi - lo, wid: whi - wlo, visible: true, scale: 1, bend });
    });
  }

  /** Evidenzia le province attaccabili: velo chiaro se abbordabili, appena accennato se no. */
  private redrawFrontier(force = false) {
    const front = this.state.frontier();
    const troops = this.state.troops;
    // con le truppe: il vuoto e le milizie (assalto a tempo); gli imperi con le pedine
    const ok = front.map((p) => this.state.provOwner[p] === NEUTRAL && troops > this.state.provCost(PLAYER, p)); // di qualcuno: con le pedine
    const key = ok.map((v) => (v ? 1 : 0)).join('') + front.join(',');
    if (!force && key === this.lastAffordable) return;
    this.lastAffordable = key;
    this.frontOk = new Map(front.map((p, k) => [p, ok[k]]));
    this.territory.invalidate();
    this.updateLabels();
  }

  /** Costo delle province del fronte: lo disegna l'interfaccia, nitido (vedi MapLabels). */
  private updateLabels() {
    this.frontLabels.length = 0;
    if (this.cameras.main.zoom < CAM.labelMinZoom * UI()) return;
    const view = this.cameras.main.worldView;
    if (this.buildWork || this.buildPeek) {
      // COSTRUISCI (Nico): su ogni tua provincia quanto rende al minuto (tutte e tre le risorse), nel colore della risorsa
      // principale; scritte che si toccherebbero sullo schermo: solo la prima
      const provs = this.map.provinces, z = this.cameras.main.zoom / UI(), placed: { x: number; y: number }[] = [];
      for (let p = 0; p < provs.length; p++) {
        if (this.state.provOwner[p] !== PLAYER) continue;
        // spostata sullo schermo, sotto la pedina che sta sul centro; con un cantiere in corso sopra (sotto c'è la sua barra)
        const busy = !!this.state.workInProgress(p) || this.state.upgradeInProgress(p) !== null;
        const c = center(provs[p].anchor), x = c.x, y = c.y, dy = busy ? -30 : 30;
        if (x < view.x - S || x > view.right + S || y < view.y - S || y > view.bottom + S) continue;
        if (placed.some((q) => Math.abs(q.x - x) * z < 44 && Math.abs(q.y - y) * z < 18)) continue;
        placed.push({ x, y });
        const res = BALANCE.terrain[provs[p].terrain].res, b = this.state.provBag(p);
        this.frontLabels.push({ x, y, dy, text: `+${(b.metallo + b.benzina + b.cibo).toFixed(1)}`, color: RESOURCE_INFO[res].color, icon: `ic-res-${res}` });
      }
      return;
    }
    if (!this.state.opts.tutorial) return; // prezzi solo nella run guidata: altrove la terra si prende con gli eserciti
    for (const p of this.state.frontier()) {
      const { x, y } = center(this.map.provinces[p].anchor);
      if (x < view.x - S || x > view.right + S || y < view.y - S || y > view.bottom + S) continue;
      const def = this.state.provCost(PLAYER, p);
      if (this.state.provOwner[p] !== NEUTRAL) continue; // province di qualcuno (imperi e milizie): con le pedine, niente prezzo
      // bianco = la compri, ambra = assalto a una milizia, grigio = non bastano le truppe (prima bianco e grigio quasi uguali)
      const can = this.state.troops > def, militia = this.state.provOwner[p] !== NEUTRAL;
      this.frontLabels.push({ x, y, text: String(def), color: !can ? 0x7d858c : militia ? PALETTE.allerta : MAP_INK });
    }
  }

  /** Piano della pausa strategica: le province in coda, numerate. */
  private syncPlan() {
    const plan = this.state.plan;
    const keep = new Set(plan);
    for (const [p, img] of this.planImgs) if (!keep.has(p)) { img.destroy(); this.planImgs.delete(p); }
    for (const p of plan) {
      if (this.planImgs.has(p)) continue;
      const img = this.add.graphics().setDepth(this.ovlDepth).setAlpha(0.42).fillStyle(MAP_SEL, 1);
      fillProvince(img, this.shapes.provinces[p]);
      this.tweens.add({ targets: img, alpha: 0.18, duration: 700, yoyo: true, repeat: -1 });
      this.planImgs.set(p, img);
    }
  }

  // ---------- conquista ----------

  /** Seleziona/deseleziona una carta; ritorna il motivo se non si può usare. */
  /** Abilità: si sceglie la carta, poi si tocca la mappa (anche il mare). */
  toggleAbility(a: AbilityType): ReturnType<RunState['abilityBlock']> {
    if (this.selectedAbility === a) {
      this.selectedAbility = null;
      this.hud.setHint(null);
      return null;
    }
    const block = this.state.abilityBlock(a);
    if (block) return block;
    this.selectedCard = null;
    this.selectUnit(null);
    this.selectedAbility = a;
    const info = (buildingText as unknown as { abilita: Record<AbilityType, { name: string; desc: string }> }).abilita[a];
    this.hud.setHint(`${info.name.toUpperCase()}: ${info.desc}\nTap the map to choose the target.`);
    return null;
  }

  toggleCard(t: UnitType): ReturnType<RunState['deployBlock']> {
    this.selectedAbility = null;
    if (this.selectedCard === t) {
      this.selectedCard = null;
      this.hud.setHint(null);
      return null;
    }
    const block = this.state.deployBlock(PLAYER, t);
    if (block) return block;
    this.selectUnit(null);
    this.selectedCard = t;
    this.deployHint(t);
    this.syncRecruit();
    return null;
  }

  /** Schieramento multiplo (Nico: "clicchi tante volte dove le vuoi mettere"): la carta resta scelta, ogni clic su una tua
   *  città schiera un reparto; ESC o clic destro per finire. */
  private deployHint(t: UnitType) {
    const c = this.state.unitCost(PLAYER, t), r = this.state.unitRes(t);
    this.hud.setHint(`DEPLOY ${unitInfo(t).name.toUpperCase()}, ${c} troops${r.n ? ` + ${r.n} ${RESOURCE_INFO[r.res].name.toLowerCase()}` : ''} each\nClick your highlighted ${isNaval(t) ? 'coastal cities, the ship sets out on the nearest sea' : 'cities'} to deploy, ESC or right-click to finish`);
  }

  /** Esce dallo schieramento. */
  private endDeploy() {
    if (!this.selectedCard) return;
    this.selectedCard = null;
    this.hud.setHint(null);
    this.syncRecruit();
  }

  /** Mentre si schiera: le province dove si arruola (capitale, città, caserme) lampeggiano piano. */
  private syncRecruit() {
    for (const g of this.recruitImgs) g.destroy();
    this.recruitImgs = [];
    if (!this.selectedCard) return;
    const naval = isNaval(this.selectedCard); // navi: solo le città sul mare (Nico: "non si capisce dove si può posizionare")
    this.map.provinces.forEach((_pr, p) => {
      if (!this.state.canRecruitAt(p) || naval && !this.state.provCoastal[p]) return;
      const img = this.add.graphics().setDepth(this.ovlDepth).setAlpha(0.45).fillStyle(PALETTE.radioattivo, 1);
      fillProvince(img, this.shapes.provinces[p]);
      this.tweens.add({ targets: img, alpha: 0.15, duration: 650, yoyo: true, repeat: -1 });
      this.recruitImgs.push(img);
    });
  }

  /** Tocco su una provincia dalla tabella in basso (ATTACCA, AVANZATA): come toccarne il centro sulla mappa. */
  tapProvince(p: number) {
    const a = this.map.provinces[p]?.anchor ?? -1;
    if (a >= 0) this.tapTile(a);
  }

  /** Seleziona una pedina (add = la aggiunge o la toglie dal gruppo, come Maiusc + clic in HOI4); null = deseleziona tutto. */
  private selectUnit(id: number | null, add = false) {
    // una pila si prende intera: tutte le tue pedine sullo stesso centro
    const u = id === null ? undefined : this.state.units.find((v) => v.id === id);
    // da vicino le pile si aprono (Nico: "quando zoomo non posso più dividerle"): si prende la pedina toccata, da lontano la pila
    const pile = !u ? [] : this.pilesOpen() ? [u.id] : this.state.units.filter((v) => v.owner === u.owner && v.tile === u.tile).map((v) => v.id);
    if (id === null) this.selection.clear();
    else if (add) { if (this.selection.has(id)) pile.forEach((k) => this.selection.delete(k)); else pile.forEach((k) => this.selection.add(k)); }
    else this.selection = new Set(pile);
    this.applySelection();
  }

  private applySelection() {
    const ids = [...this.selection];
    if (ids.length) sfx('select');
    this.selectedUnit = ids.length ? ids[ids.length - 1] : null; // la principale: scheda in basso e mirino pieno
    if (this.selectedUnit !== null) this.hud.showUnit(this.selectedUnit); // tabella in basso: vita, attacco, stato
    // niente riquadro d'aiuto sulla selezione (Nico: tolto)
    if (!ids.length) {
      this.linePick = false; // niente pedine: niente linea da tracciare
      this.arrowPick = false; this.zonePick = false;
      this.hud.hideUnit(); // nessuna pedina scelta: via la sua scheda
      if (!this.selectedCard) this.hud.setHint(null);
    }
  }

  /** Pedina tua vicina al punto dello schermo (area di tocco ampia, non solo la casella esatta). */
  private unitNear(sx: number, sy: number): Unit | undefined {
    const cam = this.cameras.main, wv = cam.worldView, R = 28 * UI();
    let best: Unit | undefined, bestD = R * R;
    for (const u of this.state.unitsOf(PLAYER)) {
      const sp = this.unitSprites.get(u.id);
      if (!sp || !sp.c.visible) continue;
      const dx = (sp.c.x - wv.x) * cam.zoom - sx, dy = (sp.c.y - wv.y) * cam.zoom - sy, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  }

  /** Pedina nemica (in guerra, visibile) sotto il punto dello schermo, per l'attacco diretto. */
  private enemyNear(sx: number, sy: number): Unit | undefined {
    const cam = this.cameras.main, wv = cam.worldView, R = 24 * UI();
    let best: Unit | undefined, bestD = R * R;
    for (const u of this.state.units) {
      if (u.owner === PLAYER || !this.state.atWar(PLAYER, u.owner)) continue;
      const sp = this.unitSprites.get(u.id);
      if (!sp || !sp.c.visible) continue;
      const dx = (sp.c.x - wv.x) * cam.zoom - sx, dy = (sp.c.y - wv.y) * cam.zoom - sy, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  }

  /** Attacco diretto (Nico, 27 novembre 2026): con pedine scelte, il clic su una pedina nemica la fa inseguire (linea rossa). */
  private chaseAt(sx: number, sy: number): boolean {
    if (!this.selection.size) return false;
    const t = this.enemyNear(sx, sy);
    if (!t) return false;
    const ids = this.selectedUnits().filter((u) => !isNaval(u.type)).map((u) => u.id);
    const { x, y } = center(t.tile);
    if (!ids.length || !this.state.exec({ k: 'chase', units: ids, target: t.id })) { this.failFx(x, y, 'unreachable'); return true; }
    for (const l of this.attackLines) l.ids = l.ids.filter((id) => !ids.includes(id)); // escono dalle linee
    this.flashProvince(this.state.provOf(t.tile), PALETTE.ko, 0.45, 500);
    sfx('order');
    buzz(10);
    this.selectUnit(null);
    return true;
  }

  /** Manda tutte le pedine selezionate verso la casella i; true se almeno una è partita. */
  private orderSelection(i: number): boolean {
    if (i < 0 || !this.selection.size) return false;
    const { x, y } = center(i);
    const ids = [...this.selection].filter((id) => { const u = this.state.units.find((v) => v.id === id); return u && (this.map.tiles[i] || isNaval(u.type)); });
    const sent = ids.length ? this.state.exec({ k: 'move', units: ids, to: i }) : 0;
    if (!sent) {
      // perché (Nico: "dice irraggiungibile e non so come fare"): meta di qualcuno con cui sei in pace
      const o = this.state.provOwner[this.state.provOf(i)];
      const peace = o !== NEUTRAL && o !== PLAYER && !this.state.atWar(PLAYER, o);
      this.failFx(x, y, peace ? `at peace with ${FACTION_INFO[o]?.short ?? 'them'}: declare war first` : 'unreachable');
      // in pace: si apre la scheda dei rapporti, da lì si dichiara guerra (Nico, 28 novembre 2026: "a volte non puoi
      // cliccarlo, non puoi andarci in guerra")
      if (peace) this.hud.showProfile(o);
      return false;
    }
    this.floatText(x, y - 4, sent > 1 ? `forward! ×${sent}` : 'forward!', MAP_SEL);
    sfx('order');
    // segnale d'arrivo: la provincia della meta si accende (niente mirino ad angoli, Nico: "togli tutti i riquadri")
    this.flashProvince(this.state.provOf(i), MAP_SEL, 0.45, 500);
    buzz(10);
    this.selectUnit(null);
    this.hud.tutorialSignal('order');
    return true;
  }

  /** Pedine selezionate ancora vive (la principale per ultima). */
  selectedUnits(): Unit[] {
    return [...this.selection].map((id) => this.state.units.find((u) => u.id === id)).filter((u): u is Unit => !!u);
  }

  /** Comandi delle pedine dalla scheda in basso o da tastiera: comportamento, fronte, unisci, dividi, ritirata. */
  unitAction(kind: 'stance' | 'front' | 'merge' | 'split' | 'retreat' | 'line' | 'push' | 'nation' | 'zone') {
    const units = this.selectedUnits(), st = this.state, main = units[units.length - 1];
    if (!main && kind === 'line') { // la linea si può tracciare anche senza reparti: si assegnano dopo
      this.linePick = true;
      this.arrowPick = false; this.zonePick = false;
      this.frontPick = false;
      this.hud.setHint('LINE: drag from A to B along your border.\nThen select units and click the line to assign them.');
      return;
    }
    if (!main) return this.hud.notify('select a unit first', PALETTE.ko);
    const { x, y } = center(main.tile);
    if (kind === 'stance') {
      const next = units.every((u) => u.stance === 'attacca') ? 'tieni' : 'attacca';
      st.exec({ k: 'stance', units: units.map((u) => u.id), stance: next });
      this.floatText(x, y - 8, next === 'attacca' ? 'attacks on its own' : 'holds position', MAP_SEL);
    } else if (kind === 'zone') {
      this.zonePick = true;
      this.zoneProvs.clear();
      this.arrowPick = false;
      this.linePick = false;
      this.frontPick = false;
      this.hud.setHint('REGIONS: drag over the provinces to take.\nThe selected units share them out like in attack nation, then hold where they won.');
      return;
    } else if (kind === 'push') {
      this.arrowPick = true;
      this.linePick = false;
      this.frontPick = false;
      this.hud.setHint('OFFENSIVE: drag an arrow from the units to the destination.\nThey advance together in line, besiege the enemy provinces they meet and hold the new line.');
      return;
    } else if (kind === 'line') {
      this.linePick = true;
      this.arrowPick = false; this.zonePick = false;
      this.frontPick = false;
      this.hud.setHint('ATTACK LINE: drag on the map where to deploy them.\nThe units spread along the line, conquer their way there and hold it.');
      return;
    } else if (kind === 'nation') {
      // attacca nazione (Nico): le altre potenze si evidenziano; clic su una e il gruppo la attacca lungo tutto il confine finché cade
      this.frontPick = true;
      this.nationAttack = true;
      this.linePick = false;
      this.arrowPick = false; this.zonePick = false;
      this.syncNations();
      this.hud.setHint('ATTACK NATION: click a highlighted nation.\nThe selected units attack along its whole border until it falls.');
      return;
    } else if (kind === 'front') {
      this.nationAttack = false;
      this.frontPick = true;
      this.hud.setHint('FRONT: tap a province of the power to face.\nThe units spread along the border (if they attack on their own they push it).');
      return;
    } else if (kind === 'merge') {
      const r = st.exec({ k: 'merge', units: (units.length > 1 ? [main, ...units.slice(0, -1)] : units).map((u) => u.id) });
      const why = { few: 'select at least two units', type: 'only units of the same type can merge', far: `bring them closer: within ${BALANCE.unitOps.mergeRange} tiles`, max: `maximum ${BALANCE.unitOps.mergeMax} units per stack` } as const;
      if (typeof r === 'string') return this.failFx(x, y, why[r]);
      this.selection = new Set([main.id]);
      this.applySelection();
      this.burstAt(x, y, 10, MAP_SEL);
      this.floatText(x, y - 8, `merged ×${main.size}`, MAP_SEL);
    } else if (kind === 'split') {
      const r = st.exec({ k: 'split', unit: main.id });
      if (r === 'single') return this.failFx(x, y, 'single unit: cannot split');
      if (r === 'room') return this.failFx(x, y, 'no free tile nearby');
      this.syncUnits();
      this.selection = new Set([main.id, r.id]);
      this.applySelection();
      this.floatText(x, y - 8, `split ×${main.size} + ×${r.size}`, MAP_SEL);
    } else {
      const n = st.exec({ k: 'retreatUnits', units: units.map((u) => u.id) });
      if (!n) return this.failFx(x, y, 'no safe province');
      this.floatText(x, y - 8, n > 1 ? `retreat ×${n}` : 'ritirata', MAP_SEL);
    }
    buzz(10);
    this.hud.refreshProvince();
  }

  /** Coordinate schermo → mondo. */
  private worldAt(sx: number, sy: number) {
    const cam = this.cameras.main, w = cam.width / 2, h = cam.height / 2;
    return { x: cam.scrollX + w + (sx - w) / cam.zoom, y: cam.scrollY + h + (sy - h) / cam.zoom };
  }

  /** Linea tracciata col dito: un punto ogni pochi pixel sullo schermo. */
  private lineAlong(sx: number, sy: number) {
    // un tratto solo, dritto da A a B (Nico: "la linea deve partire da un punto A a un punto B, niente tappe")
    const q = this.worldAt(sx, sy);
    this.linePts = this.linePts.length ? [this.linePts[0], q] : [q];
    this.drawAttackLines();
  }

  /** Regioni: la provincia sotto il dito entra nella scelta (le tue no). */
  private zoneAlong(sx: number, sy: number) {
    const p = this.state.provOf(this.tileAt(sx, sy));
    if (p < 0 || this.zoneProvs.has(p) || this.state.provOwner[p] === PLAYER || !this.state.provPassable(p)) return;
    this.zoneProvs.add(p);
    this.drawAttackLines();
  }

  /** Regioni scelte: le pedine selezionate partono e se le dividono come in attacca nazione. */
  private finishZone() {
    const provs = [...this.zoneProvs];
    this.zoneProvs.clear();
    this.zonePick = false;
    this.hud.setHint(null);
    this.drawAttackLines();
    const units = this.selectedUnits().filter((u) => !isNaval(u.type));
    if (!provs.length) return;
    const { x, y } = center(this.map.provinces[provs[0]].anchor);
    if (!units.length) return this.failFx(x, y, 'select units first');
    const sent = this.state.exec({ k: 'zone', units: units.map((u) => u.id), provs });
    if (!sent) {
      const o = this.state.provOwner[provs[0]];
      return this.failFx(x, y, o !== NEUTRAL && !this.state.atWar(PLAYER, o) ? `at peace with ${FACTION_INFO[o]?.short ?? 'them'}: declare war first` : 'nothing to take there');
    }
    const ids = units.map((u) => u.id);
    for (const l of this.attackLines) l.ids = l.ids.filter((id) => !ids.includes(id)); // escono dalle linee
    for (const o of this.offensives) { o.ids = o.ids.filter((id) => !ids.includes(id)); o.all = o.all.filter((id) => !ids.includes(id)); }
    sfx('order');
    buzz(12);
    this.selectUnit(null);
  }

  /** Freccia d'offensiva tracciata col dito: un punto ogni pochi pixel sullo schermo. */
  private arrowAlong(sx: number, sy: number) {
    const q = this.worldAt(sx, sy), last = this.arrowPts[this.arrowPts.length - 1], z = this.cameras.main.zoom;
    if (last && Math.hypot((q.x - last.x) * z, (q.y - last.y) * z) < 6) return;
    this.arrowPts.push(q);
    this.drawAttackLines();
  }

  /**
   * Freccia finita: le pedine si mettono in fila attorno alla punta (perpendicolari alla freccia, nell'ordine in cui stanno,
   * così non si incrociano) e ci avanzano assediando quello che incontrano.
   */
  private finishArrow() {
    const pts = this.arrowPts;
    this.arrowPts = [];
    this.arrowPick = false; this.zonePick = false;
    this.hud.setHint(null);
    const units = this.selectedUnits().filter((u) => !isNaval(u.type));
    this.drawAttackLines();
    if (!pts.length) return;
    if (!units.length) return this.failFx(pts[0].x, pts[0].y, 'select units first');
    const a = pts[0], b = pts[pts.length - 1], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (pts.length < 2 || len < 1) return this.failFx(a.x, a.y, 'drag an arrow');
    // offensiva che segue la linea (Nico): le pedine di una linea avanzano tutte insieme nella direzione della freccia,
    // in formazione (ognuna dal suo posto sul bordo, spostata di quanto è lunga la freccia); arrivate, la linea si
    // rimette sul nuovo confine e le ridistribuisce.
    const lines = this.attackLines.filter((l) => l.ids.some((id) => units.some((u) => u.id === id)));
    if (lines.length) {
      // l'attacco ha la precedenza (Nico, 27 novembre 2026): le pedine scelte che non stanno in queste linee (mandate a mano
      // altrove, o uscite) entrano nella linea più vicina e partono con le altre; prima restavano fuori e non avanzavano
      for (const u of units) {
        if (lines.some((l) => l.ids.includes(u.id))) continue;
        const c = center(u.tile), d = (l: AttackLine) => Math.min(...l.pts.map((q) => Math.hypot(q.x - c.x, q.y - c.y)));
        const near = lines.reduce((m, l) => (d(l) < d(m) ? l : m));
        for (const l of this.attackLines) l.ids = l.ids.filter((id) => id !== u.id);
        near.ids.push(u.id);
      }
      // il fronte avanza a passi (HOI4): ogni pedina tiene il suo posto nella fila e prende la provincia di confine davanti
      // a sé dentro la fascia della linea; quando la fascia è presa fino alla lunghezza della freccia, la linea si riaggancia
      const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, nx = -uy, ny = ux;
      for (const l of lines) {
        const pts = l.chains.flatMap((k) => this.chainToward(k));
        if (!pts.length) continue;
        const lats = pts.map((p) => p.x * nx + p.y * ny), alongs = pts.map((p) => p.x * ux + p.y * uy);
        const lat0 = Math.min(...lats) - HEX_W, lat1 = Math.max(...lats) + HEX_W;
        const front = alongs.reduce((s0, v) => s0 + v, 0) / alongs.length;
        const us = l.ids.map((id) => this.state.units.find((u) => u.id === id)).filter((u): u is Unit => !!u && !isNaval(u.type));
        const lat = (u: Unit) => { const c = center(u.tile); return c.x * nx + c.y * ny; };
        us.sort((p, q) => lat(p) - lat(q));
        const slot = new Map(us.map((u, k) => [u.id, lat0 + ((lat1 - lat0) * (k + 0.5)) / us.length]));
        l.push = { ux, uy, nx, ny, lat0, lat1, start: Math.min(...alongs), end: front + len, slot, at: 0 };
        this.state.exec({ k: 'release', units: us.map((u) => u.id) });
      }
      // niente da prendere davanti (in pace con chi sta oltre, o mare): lo si dice e la linea resta com'era
      const going = lines.filter((l) => { l.key = ''; if (this.pushTick(l)) return true; l.push = undefined; l.key = ''; return false; });
      if (!going.length) return this.failFx(b.x, b.y, 'nothing to attack there (at peace?)');
      const ids = going.flatMap((l) => l.ids);
      for (const o of this.offensives) { o.ids = o.ids.filter((id) => !ids.includes(id)); o.all = o.all.filter((id) => !ids.includes(id)); }
      this.offensives.push({ pts, ids, all: [...ids], goals: new Map() });
      this.floatText(b.x, b.y - 6, 'the front advances', MAP_SEL);
      sfx('order');
      buzz(12);
      this.selectUnit(null);
      return;
    }
    // freccia larga (Nico, 27 novembre 2026: "la freccia più spessa, quello che copre è dove vanno"): la freccia è una fascia
    // divisa in corsie; le pedine, in ordine da un lato all'altro, prendono una corsia ciascuna (più pedine per corsia se sono
    // tante) e la percorrono dalla coda alla punta. Prima ognuna rifaceva la freccia spostata di quanto era lontana dalla
    // coda: un gruppo sparso andava ognuno per una strada diversa, spesso fuori dalla freccia
    const st = this.state, gap = HEX_W * 2; // un campione ogni due caselle: nessuna provincia saltata
    const half = this.arrowHalf(units.length), lanes = Math.min(units.length, 6);
    const marks: { x: number; y: number; nx: number; ny: number }[] = [];
    let acc = 0;
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k - 1], q = pts[k], d = Math.hypot(q.x - p.x, q.y - p.y);
      if (!d) continue;
      const nx = -(q.y - p.y) / d, ny = (q.x - p.x) / d;
      for (let t = gap - acc; t < d; t += gap) marks.push({ x: p.x + ((q.x - p.x) * t) / d, y: p.y + ((q.y - p.y) * t) / d, nx, ny });
      acc = (acc + d) % gap;
    }
    { const m = marks[marks.length - 1] ?? { nx: -(b.y - a.y) / len, ny: (b.x - a.x) / len }; marks.push({ x: b.x, y: b.y, nx: m.nx, ny: m.ny }); }
    // da un lato all'altro della freccia, rispetto alla direzione generale
    const gx = -(b.y - a.y) / len, gy = (b.x - a.x) / len, side = (u: Unit) => { const c = center(u.tile); return c.x * gx + c.y * gy; };
    const sorted = [...units].sort((p, q) => side(p) - side(q) || p.id - q.id);
    const goals: number[] = [], vias: number[][] = [];
    const walk = (off: number) => {
      const out: number[] = [];
      let goal = -1;
      for (const m of marks) {
        const i = pixelToIndex(m.x + m.nx * off, m.y + m.ny * off);
        if (i < 0 || !this.map.tiles[i]) continue; // mare: si passa (sbarco), conta la terra dopo
        const pr = st.provOf(i), o = pr >= 0 ? st.provOwner[pr] : NEUTRAL;
        if (pr < 0 || this.map.provinces[pr].anchor < 0 || o !== PLAYER && (!st.atWar(PLAYER, o) || !st.provPassable(pr))) break; // in pace o invalicabile: ci si ferma prima
        const at = this.map.provinces[pr].anchor;
        if (out[out.length - 1] !== at) out.push(at); // tappe: i centri delle province lungo il tracciato, in ordine
        goal = at;
      }
      out.pop(); // l'ultima tappa è la meta
      return { goal, out };
    };
    sorted.forEach((_u, j) => {
      const lane = Math.floor((j * lanes) / sorted.length), off = -half + (2 * half * (lane + 0.5)) / lanes;
      // corsia che parte su una terra in pace (o invalicabile): la pedina prende il centro della freccia invece di restare ferma
      let w = walk(off);
      if (w.goal < 0 && off !== 0) w = walk(0);
      goals.push(w.goal);
      vias.push(w.out);
    });
    const sent = this.state.exec({ k: 'push', units: sorted.map((u) => u.id), goals, vias });
    if (!sent) return this.failFx(b.x, b.y, 'irraggiungibile');
    if (sent < sorted.length) this.failFx(a.x, a.y, `${sorted.length - sent} of ${sorted.length} cannot get there`);
    const ids = sorted.map((u) => u.id);
    for (const l of this.attackLines) l.ids = l.ids.filter((id) => !ids.includes(id)); // escono dalle linee vecchie
    for (const o of this.offensives) { o.ids = o.ids.filter((id) => !ids.includes(id)); o.all = o.all.filter((id) => !ids.includes(id)); }
    this.offensives.push({ pts, ids, all: [...ids], goals: new Map(sorted.map((u, k) => [u.id, goals[k]])), half });
    this.floatText(b.x, b.y - 6, sent > 1 ? `offensive ×${sent}` : 'offensiva', MAP_SEL);
    sfx('order');
    buzz(12);
    this.selectUnit(null);
  }

  /**
   * Confine vero vicino al tratto (Nico: la linea segue il bordo, come il fronte di HOI4): i tratti di confine della carta
   * (gli stessi disegnati) tra una tua provincia e una non tua, con almeno un punto entro `radius` dal tratto.
   * `enemies`: solo il confine con questi padroni (la linea resta sul fronte con chi fronteggiava).
   */
  private frontChains(pts: { x: number; y: number }[], radius: number, enemies?: Set<number>): number[] {
    const st = this.state, own = st.provOwner, box = this.chainBox, out: number[] = [];
    let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
    for (const p of pts) { sx0 = Math.min(sx0, p.x); sy0 = Math.min(sy0, p.y); sx1 = Math.max(sx1, p.x); sy1 = Math.max(sy1, p.y); }
    const near = (x: number, y: number) => {
      for (let k = 1; k < pts.length; k++) {
        const ax = pts[k - 1].x, ay = pts[k - 1].y, vx = pts[k].x - ax, vy = pts[k].y - ay, l2 = vx * vx + vy * vy || 1;
        const t = Phaser.Math.Clamp(((x - ax) * vx + (y - ay) * vy) / l2, 0, 1);
        if (Math.hypot(ax + vx * t - x, ay + vy * t - y) <= radius) return true;
      }
      return false;
    };
    this.shapes.chains.forEach((c, k) => {
      if (c.b < 0 || c.a < 0) return; // costa: niente fronte sul mare
      const oa = own[c.a], ob = own[c.b];
      if ((oa === PLAYER) === (ob === PLAYER)) return; // confine interno (o tra due altri)
      const other = oa === PLAYER ? ob : oa;
      if (enemies && !enemies.has(other)) return;
      if (box[k * 4 + 2] < sx0 - radius || box[k * 4] > sx1 + radius || box[k * 4 + 3] < sy0 - radius || box[k * 4 + 1] > sy1 + radius) return;
      for (let j = 0; j < c.pts.length; j += 2) if (near(c.pts[j], c.pts[j + 1])) { out.push(k); return; }
    });
    return out;
  }

  /** Punti di un tratto di confine girati in modo che il lato dei denti (−uy, ux) guardi verso lo straniero. */
  private towardCache = new Map<number, { mine: number; pts: { x: number; y: number }[] }>();

  private chainToward(k: number): { x: number; y: number }[] {
    // si ricalcola solo se cambia quale lato è tuo (prima a ogni fotogramma, per ogni tratto di ogni linea)
    const c0 = this.shapes.chains[k], side = this.state.provOwner[c0.a] === PLAYER ? c0.a : c0.b, hit = this.towardCache.get(k);
    if (hit && hit.mine === side) return hit.pts;
    const pts = this.chainTowardRaw(k);
    if (this.towardCache.size > 4000) this.towardCache.clear();
    this.towardCache.set(k, { mine: side, pts });
    return pts;
  }

  private chainTowardRaw(k: number): { x: number; y: number }[] {
    const c = this.shapes.chains[k], pts: { x: number; y: number }[] = [];
    for (let j = 0; j < c.pts.length; j += 2) pts.push({ x: c.pts[j], y: c.pts[j + 1] });
    const mine = this.state.provOwner[c.a] === PLAYER ? c.a : c.b, sh = this.shapes.provinces[mine];
    if (!sh || pts.length < 2) return pts;
    const a = pts[0], b = pts[pts.length - 1], m = pts[pts.length >> 1];
    const ox = (sh.x0 + sh.x1) / 2 - m.x, oy = (sh.y0 + sh.y1) / 2 - m.y; // verso la tua provincia
    return ox * -(b.y - a.y) + oy * (b.x - a.x) > 0 ? pts.reverse() : pts;
  }

  /** Tratti di confine già tenuti dalle altre linee (una linea non passa mai sul tratto di un'altra). */
  private takenChains(except?: AttackLine): Set<number> {
    const out = new Set<number>();
    for (const o of this.attackLines) if (o !== except) for (const k of o.chains) out.add(k);
    return out;
  }

  /**
   * Linea alla HOI4: il tratto del tuo confine che va dal punto più vicino ad `a` al punto più vicino a `b`, un pezzo unico
   * senza buchi (percorso più corto sul grafo dei confini). Il confine con chi non fronteggia la linea costa di più, così
   * la linea resta sul suo fronte; i tratti di `skip` (altre linee) non si attraversano. Torna i tratti in ordine da a a b
   * e i due estremi agganciati al confine; vuoto se fra i due punti non c'è un confine continuo.
   */
  private borderPath(a: { x: number; y: number }, b: { x: number; y: number }, enemies: Set<number>, skip: Set<number>, guide: { x: number; y: number }[] = [], coast: [boolean, boolean] = [false, false]) {
    const own = this.state.provOwner, chains = this.shapes.chains;
    // guida: il tratto disegnato (o la linea di prima): il confine lontano dalla guida costa di più, così la linea va dove
    // l'hai tracciata e non "dall'altra parte" del territorio quando la strada è più corta
    const gs = guide.length > 120 ? guide.filter((_, j) => j % Math.ceil(guide.length / 120) === 0) : guide, R = HEX_W * 4;
    const far = (x: number, y: number) => {
      if (!gs.length) return 1;
      let d2 = Infinity;
      for (const q of gs) d2 = Math.min(d2, (q.x - x) ** 2 + (q.y - y) ** 2);
      return 1 + d2 / (R * R);
    };
    const nodes = new Map<string, number>(), xy: number[] = [], adj: { k: number; to: number; w: number }[][] = [];
    const node = (x: number, y: number) => {
      const key = `${x},${y}`;
      let n = nodes.get(key);
      if (n === undefined) { n = adj.length; nodes.set(key, n); adj.push([]); xy.push(x, y); }
      return n;
    };
    // punti dove il tuo confine tocca il mare: un capo attaccato alla costa resta su uno di questi
    const shore = new Set<string>();
    chains.forEach((c) => {
      if ((c.a < 0) === (c.b < 0) || own[c.a < 0 ? c.b : c.a] !== PLAYER) return;
      const n = c.pts.length;
      shore.add(`${c.pts[0]},${c.pts[1]}`).add(`${c.pts[n - 2]},${c.pts[n - 1]}`);
    });
    chains.forEach((c, k) => {
      if (c.a < 0 || c.b < 0 || skip.has(k)) return; // costa: niente fronte sul mare
      const oa = own[c.a], ob = own[c.b];
      if ((oa === PLAYER) === (ob === PLAYER)) return;
      const other = oa === PLAYER ? ob : oa, n = c.pts.length;
      let len = 0;
      for (let j = 2; j < n; j += 2) len += Math.hypot(c.pts[j] - c.pts[j - 2], c.pts[j + 1] - c.pts[j - 1]);
      const m = (n >> 2) << 1;
      const w = len * (enemies.has(other) ? 1 : 8) * far(c.pts[m], c.pts[m + 1]);
      const u = node(c.pts[0], c.pts[1]), v = node(c.pts[n - 2], c.pts[n - 1]);
      adj[u].push({ k, to: v, w });
      adj[v].push({ k, to: u, w });
    });
    // estremo: il nodo di confine più vicino al vecchio estremo, ma a pari distanza quello più lontano dall'altro capo. Se il
    // vecchio estremo finisce dentro una provincia appena presa, la linea gira attorno al nuovo bordo invece di accorciarsi
    const onShore = (n: number) => shore.has(`${xy[2 * n]},${xy[2 * n + 1]}`);
    const near = (p: { x: number; y: number }, other: { x: number; y: number }, sea: boolean) => {
      let best = -1, bd = Infinity;
      const any = sea && adj.some((_, n) => onShore(n)); // capo sulla costa: il punto di costa più vicino (se ce n'è ancora)
      for (let n = 0; n < adj.length; n++) {
        if (any && !onShore(n)) continue;
        const x = xy[2 * n], y = xy[2 * n + 1], d = Math.hypot(x - p.x, y - p.y) - 0.5 * Math.hypot(x - other.x, y - other.y);
        if (d < bd) { bd = d; best = n; }
      }
      return best;
    };
    const s0 = near(a, b, coast[0]), t0 = near(b, a, coast[1]);
    if (s0 < 0 || t0 < 0) return { chains: [] as number[], a, b, coast: [false, false] as [boolean, boolean] };
    // Dijkstra con una coda a heap (un impero grande ha migliaia di nodi di confine)
    const dist = new Float64Array(adj.length).fill(Infinity), via = new Int32Array(adj.length).fill(-1), from = new Int32Array(adj.length).fill(-1);
    const heap: number[] = [], up = (i: number) => { while (i > 0) { const p = (i - 1) >> 1; if (dist[heap[p]] <= dist[heap[i]]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && dist[heap[l]] < dist[heap[m]]) m = l;
          if (r < heap.length && dist[heap[r]] < dist[heap[m]]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    dist[s0] = 0;
    heap.push(s0);
    while (heap.length) {
      const n = pop();
      if (n === t0) break;
      for (const e of adj[n]) if (dist[n] + e.w < dist[e.to]) { dist[e.to] = dist[n] + e.w; via[e.to] = e.k; from[e.to] = n; heap.push(e.to); up(heap.length - 1); }
    }
    // l'altro capo non si raggiunge più (il confine si è spezzato: costa, terre perse, un'altra linea in mezzo): la linea
    // arriva fin dove il confine continua, verso quel capo. Mai tratti vecchi che non sono più confine
    let t1 = t0;
    if (dist[t0] === Infinity) {
      let bd = Infinity;
      for (let n = 0; n < adj.length; n++) {
        if (dist[n] === Infinity || n === s0) continue;
        const d = Math.hypot(xy[2 * n] - b.x, xy[2 * n + 1] - b.y);
        if (d < bd) { bd = d; t1 = n; }
      }
    }
    const out: number[] = [];
    for (let n = t1; n !== s0 && via[n] >= 0; n = from[n]) out.push(via[n]);
    if (s0 !== t1 && !out.length) return { chains: [] as number[], a, b, coast: [false, false] as [boolean, boolean] };
    if (s0 === t0) { const e = adj[s0][0]; if (e) out.push(e.k); } // estremi nello stesso punto: almeno il tratto lì
    return { chains: out.reverse(), a: { x: xy[2 * s0], y: xy[2 * s0 + 1] }, b: dist[t0] === Infinity ? b : { x: xy[2 * t0], y: xy[2 * t0 + 1] },
      coast: [onShore(s0), dist[t0] !== Infinity && onShore(t0)] as [boolean, boolean] };
  }

  /**
   * Posti per `n` pedine: gli stop della rete (Nico: "ogni truppa si fermi agli stop dei bordi", per bloccare i nemici che
   * camminano da centro a centro), cioè i centri delle tue province sul confine della linea, in ordine lungo la linea.
   * Meno pedine che province: sparse lungo la linea; di più: in pila sui centri.
   */
  /** Province tue lungo la linea, in ordine (i tratti arrivano già in ordine lungo la linea, borderPath). */
  private lineStops(chains: number[]): number[] {
    const st = this.state, provs = this.map.provinces, stops: number[] = [];
    for (const k of chains) {
      const c = this.shapes.chains[k];
      if (!c) continue;
      const p = st.provOwner[c.a] === PLAYER ? c.a : st.provOwner[c.b] === PLAYER ? c.b : -1;
      if (p >= 0 && provs[p].anchor >= 0 && !stops.includes(p)) stops.push(p);
    }
    return stops;
  }

  private linePosts(chains: number[], n: number, dir: { x: number; y: number }, units: Unit[] = []): number[] {
    const provs = this.map.provinces;
    void dir;
    const stops = this.lineStops(chains);
    if (!stops.length) return new Array(n).fill(-1);
    const out: number[] = [];
    if (n <= stops.length || units.length !== n) {
      for (let k = 0; k < n; k++) {
        const p = n <= stops.length ? stops[Math.floor(((k + 0.5) * stops.length) / n)] : stops[Math.floor((k * stops.length) / n)];
        out.push(provs[p].anchor);
      }
      return out;
    }
    // più pedine che province: ognuna va dove cade il suo centro contando i reparti lungo la linea, così ogni provincia
    // ne ha quasi lo stesso numero (prima si contavano le pedine, piccole o grosse uguali)
    const sizes = units.map((u) => this.state.bandSize(u)), total = sizes.reduce((a, b) => a + b, 0) || 1;
    let cum = 0;
    for (const sz of sizes) {
      const k = Math.min(stops.length - 1, Math.floor(((cum + sz / 2) * stops.length) / total));
      out.push(provs[stops[k]].anchor);
      cum += sz;
    }
    return out;
  }

  /**
   * Un passo dell'offensiva di una linea (ogni mezzo secondo): le pedine libere prendono ognuna la provincia non tua sul
   * confine più vicina al loro posto nella fila, dentro la fascia e non oltre la punta della freccia. Così il confine avanza
   * intero, senza corridoi. False quando non resta niente da prendere (o nessuna pedina).
   */
  private pushTick(l: AttackLine): boolean {
    const P = l.push!, st = this.state, now = this.time.now;
    const us = l.ids.map((id) => st.units.find((u) => u.id === id)).filter((u): u is Unit => !!u);
    if (!us.length) return false;
    // bordo da disegnare: i tuoi confini dentro la fascia
    const key = `${st.player.tiles}|${st.player.provinces}`;
    if (l.key !== key) {
      l.key = key;
      const own = st.provOwner, out: number[] = [];
      this.shapes.chains.forEach((c, k) => {
        if (c.a < 0 || c.b < 0 || (own[c.a] === PLAYER) === (own[c.b] === PLAYER)) return;
        const m = c.pts.length >> 2 << 1, lat = c.pts[m] * P.nx + c.pts[m + 1] * P.ny;
        const al = c.pts[m] * P.ux + c.pts[m + 1] * P.uy;
        if (lat >= P.lat0 && lat <= P.lat1 && al <= P.end + HEX_W * 3 && al >= P.start) out.push(k);
      });
      // anche mentre avanza la linea resta un pezzo unico: dal capo più a sinistra a quello più a destra della fascia,
      // lungo il confine nuovo (prima si disegnavano i tratti sparsi della fascia e sembrava sfaldarsi)
      const pts = out.flatMap((k) => this.chainToward(k));
      if (pts.length) {
        const lat = (q: { x: number; y: number }) => q.x * P.nx + q.y * P.ny;
        const a = pts.reduce((m, q) => (lat(q) < lat(m) ? q : m)), b = pts.reduce((m, q) => (lat(q) > lat(m) ? q : m));
        const path = this.borderPath(a, b, new Set([...l.enemies, NEUTRAL]), this.takenChains(l), pts, l.coast);
        l.chains = path.chains.length ? path.chains : out;
        if (path.chains.length) l.pts = [path.a, path.b];
      } else l.chains = out;
    }
    if (now < P.at) return true;
    P.at = now + 500;
    const provs = this.map.provinces, mid = (p: number) => { const sh = this.shapes.provinces[p]; return sh ? { x: (sh.x0 + sh.x1) / 2, y: (sh.y0 + sh.y1) / 2 } : center(provs[p].anchor); };
    // province da prendere: confinano col tuo territorio, sono nella fascia, prima della punta, contro chi si può combattere
    const cand: { p: number; lat: number; along: number }[] = [];
    for (const p of st.frontier(PLAYER)) {
      const c = mid(p), lat = c.x * P.nx + c.y * P.ny, along = c.x * P.ux + c.y * P.uy;
      if (lat < P.lat0 || lat > P.lat1 || along > P.end || along < P.start) continue; // solo davanti alla linea di partenza
      const o = st.provOwner[p];
      if (o !== NEUTRAL && !l.enemies.has(o)) continue; // solo contro chi fronteggia la linea (e la terra libera)
      cand.push({ p, lat, along });
    }
    if (!cand.length && us.every((u) => u.goal < 0 && !u.path.length)) return false;
    const taken = new Set<number>();
    for (const u of us) if (u.goal >= 0) taken.add(st.provOf(u.goal));
    for (const u of us) {
      if (u.goal >= 0 || u.path.length || st.battles.some((b) => b.unit === u.id)) continue;
      const slot = P.slot.get(u.id) ?? (P.lat0 + P.lat1) / 2;
      let best = -1, bs = Infinity;
      for (const c of cand) {
        if (taken.has(c.p)) continue;
        const score = Math.abs(c.lat - slot) + Math.max(0, c.along - Math.min(...cand.map((q) => q.along))) * 0.6; // il proprio tratto, prima le più indietro
        if (score < bs) { bs = score; best = c.p; }
      }
      if (best < 0) continue;
      taken.add(best);
      if (!st.exec({ k: 'push', units: [u.id], goals: [provs[best].anchor], vias: [] })) taken.delete(best);
    }
    return true;
  }

  /**
   * Il confine si è spostato (conquiste, perdite): la linea si ricalcola sul nuovo bordo con gli stessi nemici e le pedine
   * si ridistribuiscono sui nuovi posti (HOI4: il fronte segue il confine).
   */
  private refreshLine(l: AttackLine) {
    if (l.push) {
      if (this.pushTick(l)) return;
      // spinta finita: la linea resta dov'è arrivato il fronte (i capi li ha già seguiti durante l'avanzata) e tutti i reparti
      // tornano in fila sul confine nuovo (Nico: "altre restano a metà campo ferme")
      l.push = undefined;
      l.key = '';
      l.regroup = true;
    }
    const st = this.state, key = `${st.player.tiles}|${st.player.provinces}`;
    let changed = false;
    if (l.key !== key) {
      l.key = key;
      // la linea si riaggancia fra i suoi due estremi sul confine nuovo: si allunga o si accorcia, ma resta un pezzo unico
      // guida: la linea di prima (il confine nuovo è lì vicino)
      const guide = l.chains.flatMap((k) => this.chainToward(k));
      let path = this.borderPath(l.pts[0], l.pts[l.pts.length - 1], l.enemies, this.takenChains(l), guide, l.coast);
      if (!path.chains.length) {
        // il nemico davanti non c'è più (preso o caduto): la linea si aggancia al confine nuovo con chiunque ci sia ora,
        // invece di restare senza tratti e sparire (Nico, 27 novembre 2026: "le linee spariscono a caso")
        const any = new Set<number>([NEUTRAL, ...st.factions.filter((f) => f.id !== PLAYER && f.alive).map((f) => f.id)]);
        const alt = this.borderPath(l.pts[0], l.pts[l.pts.length - 1], any, this.takenChains(l), guide, l.coast);
        if (alt.chains.length) {
          path = alt;
          l.enemies = new Set(alt.chains.flatMap((k) => { const c = this.shapes.chains[k]; return [st.provOwner[c.a], st.provOwner[c.b]]; }).filter((o) => o !== PLAYER));
        }
      }
      if (path.chains.length && path.chains.join() !== l.chains.join()) {
        l.chains = path.chains;
        l.pts = [path.a, path.b]; // gli estremi seguono il confine
        changed = true;
      }
      // nessun confine fra i due capi (accerchiata, terre perse): la linea resta intera dov'era (prima restavano solo i
      // tratti ancora di confine e la linea si spezzava o spariva)
    }
    if (!l.chains.length) return;
    // tutte le pedine della linea tornano in fila (anche dopo l'offensiva o un assedio finito), tranne chi sta assediando
    // un gruppetto prende un posto solo (il capo)
    const units = l.ids.map((id) => st.units.find((u) => u.id === id)).filter((u): u is Unit => !!u && !isNaval(u.type) && u.goal < 0 && st.bandLeader(u) === u && !st.battles.some((b) => b.unit === u.id));
    const idle = units.some((u) => u.post < 0 && !u.path.length); // rimasta senza posto: la fila si rifà
    // un reparto della linea è caduto: il suo posto si riempie con quelli in più (Nico: "quel buco deve essere riempito")
    const alive = l.ids.filter((id) => st.units.some((u) => u.id === id)).length, lost = l.n !== undefined && alive !== l.n;
    l.n = alive;
    if (!changed && !idle && !lost && !l.regroup) return;
    l.regroup = false;
    const a = l.pts[0], b = l.pts[l.pts.length - 1], L = Math.hypot(b.x - a.x, b.y - a.y) || 1, dir = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
    const proj = (u: Unit) => { const c = center(u.tile); return c.x * dir.x + c.y * dir.y; };
    const sorted = units.sort((u, v) => proj(u) - proj(v)), posts = this.linePosts(l.chains, sorted.length, dir, sorted);
    // chi è già su un posto che serve resta lì; gli altri vanno ai posti rimasti liberi, ognuno al più vicino (prima si
    // rimescolava tutta la fila e i reparti si incrociavano)
    const need = new Map<number, number>();
    for (const i of posts) if (i >= 0) need.set(i, (need.get(i) ?? 0) + 1);
    const movers: Unit[] = [];
    for (const u of sorted) {
      const c = need.get(u.post) ?? 0;
      if (u.post >= 0 && c > 0) need.set(u.post, c - 1);
      else movers.push(u);
    }
    const free = [...need].flatMap(([i, c]) => new Array<number>(c).fill(i));
    const pairs: { u: Unit; i: number }[] = [];
    for (const u of movers) {
      if (!free.length) break;
      let k = 0;
      for (let j = 1; j < free.length; j++) if (hexDistance(u.tile, free[j]) < hexDistance(u.tile, free[k])) k = j;
      pairs.push({ u, i: free.splice(k, 1)[0] });
    }
    if (pairs.length) st.exec({ k: 'hold', units: pairs.map((x) => x.u.id), posts: pairs.map((x) => x.i) });
  }

  /**
   * Tratto disegnato → linea sul confine: nemici dal confine vicino al tratto, poi il pezzo unico fra i due estremi.
   * Sopra un'altra linea non si può (Nico): se metà del confine vicino è già di un'altra linea, niente.
   */
  private lineOnBorder(pts: { x: number; y: number }[]): { chains: number[]; enemies: Set<number>; a: { x: number; y: number }; b: { x: number; y: number }; coast: [boolean, boolean] } | string {
    const px = UI() / this.cameras.main.zoom, near = this.frontChains(pts, Math.max(HEX_W * 2.5, 24 * px));
    if (!near.length) return 'draw the line on the border';
    const taken = this.takenChains();
    if (near.filter((k) => taken.has(k)).length * 2 >= near.length) return 'a line is already there';
    const own = this.state.provOwner, enemies = new Set(near.map((k) => { const c = this.shapes.chains[k]; return own[c.a] === PLAYER ? own[c.b] : own[c.a]; }));
    const path = this.borderPath(pts[0], pts[pts.length - 1], enemies, taken, pts);
    if (!path.chains.length) return 'draw the line on the border';
    return { chains: path.chains, enemies, a: path.a, b: path.b, coast: path.coast };
  }

  /**
   * Linea finita: tante caselle quante pedine, alla stessa distanza lungo il tratto; le pedine prese nell'ordine in cui
   * stanno lungo la linea (così non si incrociano), ognuna verso il suo posto.
   */
  private finishLine() {
    const pts = this.linePts;
    this.linePts = [];
    this.linePick = false;
    this.hud.setHint(null);
    const units0 = this.selectedUnits().filter((u) => !isNaval(u.type));
    this.drawAttackLines();
    if (!pts.length) return;
    if (pts.length < 2) return this.failFx(pts[0].x, pts[0].y, 'drag a line');
    const color = LINE_COLORS.find((c) => !this.attackLines.some((l) => l.color === c));
    if (color === undefined) return this.failFx(pts[0].x, pts[0].y, `maximum ${LINE_COLORS.length} lines`);
    if (!units0.length) {
      // linea senza reparti: resta sulla carta, poi ci si mandano i reparti (selezionati + clic sulla linea)
      const ln = this.lineOnBorder(pts);
      if (typeof ln === 'string') return this.failFx(pts[0].x, pts[0].y, ln);
      this.attackLines.push({ pts: [ln.a, ln.b], ids: [], enemies: ln.enemies, chains: ln.chains, key: `${this.state.player.tiles}|${this.state.player.provinces}`, color, manual: true, coast: ln.coast });
      this.hud.notify('Line drawn, select units, then click the line to assign them', PALETTE.allerta);
      this.drawAttackLines();
      return;
    }
    const seg: number[] = [0];
    for (let k = 1; k < pts.length; k++) seg.push(seg[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
    const L = seg[seg.length - 1];
    const at = (d: number) => {
      let k = 1;
      while (k < pts.length - 1 && seg[k] < d) k++;
      const t = seg[k] > seg[k - 1] ? (d - seg[k - 1]) / (seg[k] - seg[k - 1]) : 0;
      return { x: pts[k - 1].x + (pts[k].x - pts[k - 1].x) * t, y: pts[k - 1].y + (pts[k].y - pts[k - 1].y) * t };
    };
    // la linea sta sul confine vero: i tratti di confine vicini al tratto disegnato
    const ln = this.lineOnBorder(pts);
    if (typeof ln === 'string') { this.drawAttackLines(); return this.failFx(pts[0].x, pts[0].y, ln); }
    const { chains, enemies } = ln;
    // ordine lungo la linea: proiezione di ogni pedina sulla direzione dal primo all'ultimo punto
    const a = pts[0], b = pts[pts.length - 1], dx = b.x - a.x, dy = b.y - a.y;
    const proj = (u: Unit) => { const c = center(u.tile); return (c.x - a.x) * dx + (c.y - a.y) * dy; };
    const units = this.divideForLine(units0, chains, proj), n = units.length;
    const sorted = [...units].sort((u, v) => proj(u) - proj(v));
    const a0 = pts[0], b0 = pts[pts.length - 1], L0 = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1;
    const posts = this.linePosts(chains, n, { x: (b0.x - a0.x) / L0, y: (b0.y - a0.y) / L0 }, sorted);
    const pairs = sorted.map((u, k) => ({ u, i: posts[k] })).filter((x) => x.i >= 0);
    const sent = this.state.exec({ k: 'hold', units: pairs.map((x) => x.u.id), posts: pairs.map((x) => x.i) });
    if (!sent) { this.drawAttackLines(); return this.failFx(a.x, a.y, 'irraggiungibile'); }
    const ids = pairs.map((x) => x.u.id);
    // una pedina sta su una linea sola: quelle riassegnate escono dalle linee vecchie
    for (const l of this.attackLines) l.ids = l.ids.filter((id) => !ids.includes(id));
    this.attackLines.push({ pts: [ln.a, ln.b], ids, enemies, chains, key: `${this.state.player.tiles}|${this.state.player.provinces}`, color, manual: true, coast: ln.coast });
    const m = at(L / 2);
    this.floatText(m.x, m.y - 6, sent > 1 ? `in line ×${sent}` : 'in line', MAP_SEL);
    sfx('order');
    buzz(12);
    this.selectUnit(null);
    this.hud.tutorialSignal('order');
  }

  /**
   * Linea alla HOI4 (Nico, 27 novembre 2026): i reparti si spalmano su tutte le province della linea. Meno reparti che
   * province: un pezzo da 1 ogni tanto (una sì, una no); di più: pezzi da reparti / province, così ogni provincia ne ha
   * quasi lo stesso numero. Prima c'era un minimo di 3 reparti a pezzo e la linea restava a pile da 2–3 con buchi.
   */
  private divideForLine(units0: Unit[], chains: number[], proj: (u: Unit) => number): Unit[] {
    // un gruppetto conta come una pedina sola (il capo), con tutti i suoi reparti: prima ogni sua pedina prendeva un posto,
    // poi i posti delle altre sparivano e restavano province scoperte
    const units = [...new Set(units0.map((u) => this.state.bandLeader(u)))].sort((u, v) => proj(u) - proj(v));
    const S = this.lineStops(chains).length, total = units.reduce((n, u) => n + this.state.bandSize(u), 0);
    let ids: number[];
    if (total <= S) {
      if (units.every((u) => u.size <= 1 || (u.band ?? -1) >= 0)) return units;
      ids = this.state.exec({ k: 'divide', units: units.map((u) => u.id), size: 1 });
    } else {
      // reparti in più che province: quote quasi uguali (10 su 4: 3, 2, 3, 2), i pezzi le riempiono in ordine lungo la linea
      const quotas: number[] = [];
      for (let i = 0; i < S; i++) quotas.push(Math.floor(((i + 1) * total) / S) - Math.floor((i * total) / S));
      ids = this.state.exec({ k: 'divide', units: units.map((u) => u.id), size: 1, quotas });
    }
    const byId = new Map(this.state.units.map((u) => [u.id, u]));
    return ids.map((id) => byId.get(id)).filter((u): u is Unit => !!u);
  }

  /** Linea vicina a un punto della carta (entro una quindicina di punti sullo schermo), o undefined. */
  private lineNear(q: { x: number; y: number }): AttackLine | undefined {
    const r = 15 * UI() / this.cameras.main.zoom;
    let best: AttackLine | undefined, bd = r;
    for (const l of this.attackLines) for (const k of l.chains) {
      const pts = this.chainToward(k);
      for (let j = 1; j < pts.length; j++) {
        const a = pts[j - 1], b = pts[j], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
        const t = Phaser.Math.Clamp(((q.x - a.x) * dx + (q.y - a.y) * dy) / L2, 0, 1);
        const d = Math.hypot(q.x - (a.x + dx * t), q.y - (a.y + dy * t));
        if (d < bd) { bd = d; best = l; }
      }
    }
    return best;
  }

  /** Manda dei reparti su una linea: escono dalle altre, la linea ridistribuisce tutti i suoi lungo il confine. */
  private assignToLine(l: AttackLine, units: Unit[]) {
    if (!units.length) return;
    const ids = units.map((u) => u.id);
    for (const o of this.attackLines) if (o !== l) o.ids = o.ids.filter((id) => !ids.includes(id));
    l.ids = [...new Set([...l.ids, ...ids])];
    l.push = undefined;
    if (!l.chains.length) { l.key = ''; this.refreshLine(l); }
    const a = l.pts[0], b = l.pts[l.pts.length - 1], L = Math.hypot(b.x - a.x, b.y - a.y) || 1, dir = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
    const proj = (u: Unit) => { const c = center(u.tile); return c.x * dir.x + c.y * dir.y; };
    const all = this.divideForLine(l.ids.map((id) => this.state.units.find((u) => u.id === id)).filter((u): u is Unit => !!u && !isNaval(u.type)), l.chains, proj);
    l.ids = all.map((u) => u.id);
    const sorted = all.sort((u, v) => proj(u) - proj(v)), posts = this.linePosts(l.chains, sorted.length, dir, sorted);
    const pairs = sorted.map((u, k) => ({ u, i: posts[k] })).filter((x) => x.i >= 0);
    this.state.exec({ k: 'hold', units: pairs.map((x) => x.u.id), posts: pairs.map((x) => x.i) });
    const m = center(units[0].tile);
    this.floatText(m.x, m.y - 8, `${l.ids.length} units on line ${LINE_COLORS.indexOf(l.color) + 1}`, l.color);
    sfx('order');
    this.selectUnit(null);
    for (const sp of this.unitSprites.values()) sp.badgeKey = '';
    this.drawAttackLines();
  }

  /** Toglie una linea: i suoi reparti restano dove sono, senza posto da tenere. */
  private removeLine(l: AttackLine) {
    this.state.exec({ k: 'unpost', units: l.ids });
    this.attackLines = this.attackLines.filter((o) => o !== l);
    for (const sp of this.unitSprites.values()) sp.badgeKey = '';
    this.hud.notify('Line removed', PALETTE.allerta);
    this.drawAttackLines();
  }

  /** Strumento attivo dei reparti (per accendere il suo tasto nella scheda), null se nessuno. */
  get activeTool(): 'line' | 'zone' | 'nation' | null {
    return this.zonePick ? 'zone' : this.frontPick && this.nationAttack ? 'nation' : this.linePick ? 'line' : null;
  }

  /** Attacca nazione, potenza sotto il mouse: tutto il suo territorio acceso pieno (rifatto solo quando cambia potenza). */
  private nationHover = -1;
  private nationHoverImg: Phaser.GameObjects.Graphics | null = null;
  private syncNationHover() {
    const p = this.frontPick && this.nationAttack && this.hoverTile >= 0 ? this.state.provOf(this.hoverTile) : -1;
    const o = p >= 0 ? this.state.provOwner[p] : -1, f = o > PLAYER && this.state.provVisible[p] ? o : -1;
    if (f === this.nationHover) return;
    this.nationHover = f;
    this.nationHoverImg?.destroy();
    this.nationHoverImg = null;
    if (f < 0) return;
    const g = this.add.graphics().setDepth(this.ovlDepth).setAlpha(0.55).fillStyle(this.state.atWar(PLAYER, f) ? PALETTE.ko : MAP_SEL, 1);
    for (const q of this.state.ownedProvinces(f)) fillProvince(g, this.shapes.provinces[q]);
    this.nationHoverImg = g;
  }

  /** Mirino al posto della freccia mentre uno strumento aspetta il clic sulla carta. */
  private toolCursor = false;
  private syncToolCursor() {
    const on = !!this.activeTool || this.arrowPick || this.frontPick;
    if (on === this.toolCursor) return;
    this.toolCursor = on;
    this.input.setDefaultCursor(on ? 'crosshair' : 'default');
  }

  /** Attacca nazione: le altre potenze (non le terre libere) si accendono del loro colore finché si sceglie. */
  private syncNations() {
    this.nationImgs?.destroy();
    this.nationImgs = null;
    if (!this.frontPick || !this.nationAttack) return;
    const g = this.add.graphics().setDepth(this.ovlDepth).setAlpha(0.4);
    this.map.provinces.forEach((_pr, p) => {
      const o = this.state.provOwner[p];
      if (o === NEUTRAL || o === PLAYER || !this.state.provVisible[p]) return;
      g.fillStyle(this.state.atWar(PLAYER, o) ? PALETTE.ko : 0x9aa3a8, 1);
      fillProvince(g, this.shapes.provinces[p]);
    });
    this.tweens.add({ targets: g, alpha: 0.2, duration: 650, yoyo: true, repeat: -1 });
    this.nationImgs = g;
  }

  /** Colore della linea a cui appartiene un reparto, o -1. */
  private lineColorOf(id: number): number {
    // indice pedina → colore della linea, una volta per fotogramma (prima ogni pedina scorreva tutte le linee)
    const now = this.game.getFrame();
    if (this.lineIdxFrame !== now) {
      this.lineIdxFrame = now;
      this.lineIdx.clear();
      for (const l of this.attackLines) for (const u of l.ids) if (!this.lineIdx.has(u)) this.lineIdx.set(u, l.color);
    }
    return this.lineIdx.get(id) ?? -1;
  }
  private lineIdx = new Map<number, number>();
  private lineIdxFrame = -1;

  /** Linee d'attacco attive (e quella che si sta tracciando): tratto pieno con freccia in avanti ogni tanto. */
  private arrowCache = new WeakMap<object, { k: string; v: { left: { x: number; y: number }[]; right: { x: number; y: number }[]; outline: { x: number; y: number }[] } | null }>();
  private drawAttackLines() {
    const g = this.lineGfx.clear(), px = UI() / this.cameras.main.zoom;
    const byId = new Map(this.state.units.map((u) => [u.id, u])); // una passata sola (prima ogni id scorreva tutte le pedine)
    // la linea resta la linea qualsiasi cosa succeda ai reparti (Nico, 28 novembre 2026: "appena perde una truppa si
    // distrugge, le truppe la devono solo supportare"): un reparto esce dalla linea solo se muore o se gli dai un altro
    // ordine (quelli lo tolgono già), non più quando perde il posto per un assedio o una spinta
    this.attackLines = this.attackLines.filter((l) => (l.ids = l.ids.filter((id) => byId.has(id))).length > 0 || l.manual);
    // cammina lungo un tracciato a passi regolari (ricampionamento della freccia)
    const walk = (pts: { x: number; y: number }[], step: number, at: (x: number, y: number, ux: number, uy: number, d: number) => void) => {
      let acc = 0, dist = 0;
      for (let k = 1; k < pts.length; k++) {
        const ax = pts[k - 1].x, ay = pts[k - 1].y, d = Math.hypot(pts[k].x - ax, pts[k].y - ay);
        if (!d) continue;
        const ux = (pts[k].x - ax) / d, uy = (pts[k].y - ay) / d;
        for (let t = acc; t < d; t += step) at(ax + ux * t, ay + uy * t, ux, uy, dist + t);
        acc = (acc + Math.ceil((d - acc) / step) * step) - d;
        dist += d;
      }
    };
    // linea d'attacco: la grafica di prima (Nico): tratto pieno con ombra e denti sul lato d'attacco, come il fronte di HOI4
    const stroke = (pts: { x: number; y: number }[], alpha: number, col: number = MAP_SEL) => {
      if (pts.length < 2) return;
      g.lineStyle(5 * px, 0x000000, 0.35 * alpha).beginPath().moveTo(pts[0].x, pts[0].y);
      for (const p of pts) g.lineTo(p.x, p.y);
      g.strokePath();
      g.lineStyle(2.4 * px, col, alpha).beginPath().moveTo(pts[0].x, pts[0].y);
      for (const p of pts) g.lineTo(p.x, p.y);
      g.strokePath();
      let acc = 0;
      for (let k = 1; k < pts.length; k++) {
        const ax = pts[k - 1].x, ay = pts[k - 1].y, bx = pts[k].x, by = pts[k].y, d = Math.hypot(bx - ax, by - ay);
        if (!d) continue;
        const ux = (bx - ax) / d, uy = (by - ay) / d, step = 14 * px;
        for (let t = step - acc; t < d; t += step) {
          const cx = ax + ux * t, cy = ay + uy * t, h = 4 * px;
          g.fillStyle(col, alpha).fillTriangle(cx - ux * h, cy - uy * h, cx + ux * h, cy + uy * h, cx - uy * h * 1.3, cy + ux * h * 1.3);
        }
        acc = (acc + d) % step;
      }
    };
    // linea sul confine vero: ogni tratto di confine col tratto pieno e i denti verso lo straniero
    // numero del gruppo (armata) accanto a linee e frecce, a grandezza costante sullo schermo
    let tags = 0;
    // colore e fondo solo se cambiano: in Phaser ognuno ridisegna il testo e lo ricarica sulla scheda video
    const paint = (t: Phaser.GameObjects.Text, txt: string, col: string, bg: string) => {
      t.setText(txt);
      if (t.style.color !== col) t.setColor(col);
      if (t.style.backgroundColor !== bg) t.setBackgroundColor(bg);
      return t;
    };
    const tag = (x: number, y: number, ids: number[], line?: AttackLine) => {
      const n = ids.map((id) => this.groupOf(id)).find((k) => k > 0);
      if (line) { // linea: il suo numero nel suo colore e quanti reparti la tengono
        let t = this.lineTags[tags];
        if (!t) this.lineTags.push((t = this.add.text(0, 0, '', { fontFamily: TERM_FONT, fontSize: '11px', color: '#f2f2f2', backgroundColor: '#000000', padding: { x: 3, y: 1 }, resolution: 4 }).setOrigin(0.5).setDepth(D.path + 0.1)));
        tags++;
        // niente puntini fra le parole (Nico): il nome nel colore della linea, accanto il numero dei reparti su fondo del colore
        paint(t, `LINE ${LINE_COLORS.indexOf(line.color) + 1}`, hex(line.color), '#000000').setScale(px).setVisible(true);
        let c = this.lineTags[tags];
        if (!c) this.lineTags.push((c = this.add.text(0, 0, '', { fontFamily: TERM_FONT, fontSize: '11px', color: '#000000', backgroundColor: '#000000', padding: { x: 3, y: 1 }, resolution: 4 }).setOrigin(0.5).setDepth(D.path + 0.1)));
        tags++;
        paint(c, String(ids.length), '#000000', hex(line.color)).setScale(px).setVisible(true);
        const w = (t.width + c.width) * px;
        t.setPosition(x - w / 2 + (t.width * px) / 2, y);
        c.setPosition(x + w / 2 - (c.width * px) / 2, y);
        return;
      }
      if (!n) return;
      let t = this.lineTags[tags];
      if (!t) this.lineTags.push((t = this.add.text(0, 0, '', { fontFamily: TERM_FONT, fontSize: '11px', color: '#f2f2f2', backgroundColor: '#000000', padding: { x: 3, y: 1 }, resolution: 4 }).setOrigin(0.5).setDepth(D.path + 0.1)));
      tags++;
      paint(t, `${ROMAN_N[n]} ARMY`, '#f2f2f2', '#000000').setPosition(x, y).setScale(px).setVisible(true);
    };
    for (const l of this.attackLines) {
      this.refreshLine(l);
      for (const k of l.chains) stroke(this.chainToward(k), 0.85, l.color);
      if (l.chains.length) { const c = this.chainToward(l.chains[l.chains.length >> 1]), m = c[c.length >> 1]; tag(m.x, m.y - 14 * px, l.ids, l); }
    }
    // LINEA da tracciare (Nico: "ti mostra il bordo, fluorescente, che vibra"): il tuo confine libero (non già di un'altra
    // linea) pulsa nel colore che avrà la linea nuova
    if (this.linePick) {
      const st = this.state, key = `${st.player.tiles}|${st.player.provinces}|${this.attackLines.length}`;
      if (key !== this.glowKey) {
        this.glowKey = key;
        const own = st.provOwner, taken = this.takenChains();
        this.glowChains = [];
        this.shapes.chains.forEach((c, k) => { if (c.a >= 0 && c.b >= 0 && !taken.has(k) && (own[c.a] === PLAYER) !== (own[c.b] === PLAYER)) this.glowChains.push(k); });
      }
      const col = LINE_COLORS.find((c) => !this.attackLines.some((l) => l.color === c)) ?? MAP_SEL;
      const a = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(this.time.now / 170)), v = this.cameras.main.worldView;
      // anima chiara che pulsa fra il colore della linea e il bianco: si stacca anche sul tuo territorio blu
      const C = Phaser.Display.Color, mix = C.Interpolate.ColorWithColor(C.ValueToColor(col), C.ValueToColor(0xffffff), 100, Math.round(a * 100));
      const core = C.GetColor(mix.r, mix.g, mix.b);
      for (const k of this.glowChains) {
        const b = this.chainBox;
        if (b[k * 4 + 2] < v.x || b[k * 4] > v.right || b[k * 4 + 3] < v.y || b[k * 4 + 1] > v.bottom) continue;
        const c = this.shapes.chains[k].pts;
        g.lineStyle(11 * px, col, a * 0.45).beginPath().moveTo(c[0], c[1]);
        for (let j = 2; j < c.length; j += 2) g.lineTo(c[j], c[j + 1]);
        g.strokePath();
        g.lineStyle(3 * px, core, 0.6 + 0.4 * a).beginPath().moveTo(c[0], c[1]);
        for (let j = 2; j < c.length; j += 2) g.lineTo(c[j], c[j + 1]);
        g.strokePath();
      }
    }
    // regioni scelte mentre si trascina: velate e contornate
    for (const p of this.zoneProvs) this.fillProvince(g, p, MAP_SEL, 0.3, 1.6 * px);
    // REGIONI scelte dal tasto (Nico, 26 novembre 2026: "quando lo selezioni non cambia molto, deve essere più visivo"): la
    // provincia sotto il mouse si accende se si può prendere, così si vede subito cosa fa il trascinamento
    if (this.zonePick && this.hoverTile >= 0) {
      const hp = this.state.provOf(this.hoverTile), ho = hp >= 0 ? this.state.provOwner[hp] : PLAYER;
      if (hp >= 0 && ho !== PLAYER && !this.zoneProvs.has(hp) && this.state.provPassable(hp) && (ho === NEUTRAL || this.state.atWar(PLAYER, ho))) this.fillProvince(g, hp, MAP_SEL, 0.45, 2.2 * px);
    }
    // regioni in corso: quelle ancora da prendere restano segnate finché non sono tue (Nico: "si deve vedere dove vanno")
    for (const id of this.state.zones.keys()) {
      if (!this.state.units.some((u) => u.zone === id)) continue;
      for (const p of this.state.zoneTargets(id)) this.fillProvince(g, p, MAP_SEL, 0.12, 1.2 * px); // solo quelle che vanno ancora prese
    }
    // mentre si traccia: il confine che verrà preso
    if (this.linePts.length > 1) { // anteprima: il pezzo di confine che la linea prenderà davvero
      const ln = this.lineOnBorder(this.linePts);
      const next = LINE_COLORS.find((c) => !this.attackLines.some((l) => l.color === c)) ?? MAP_SEL; // il colore che avrà (Nico)
      if (typeof ln !== 'string') for (const k of ln.chains) stroke(this.chainToward(k), 1, next);
    }
    // offensive: freccia larga con la punta, finché qualche pedina è ancora in marcia
    this.offensives = this.offensives.filter((o) => {
      o.ids = o.ids.filter((id) => { const u = byId.get(id); return !!u && (u.goal >= 0 || this.attackLines.some((l) => l.push && l.ids.includes(id))); });
      if (o.ids.length) return true;
      this.offensiveDone(o);
      return false;
    });
    // offensiva alla HOI4: freccia liscia che si allarga verso la punta, ombra scura e contorno come la linea d'attacco;
    // dentro si riempie man mano che le pedine avanzano (vuota = appena ordinata, piena = arrivate)
    const arrow = (raw: { x: number; y: number }[], alpha: number, done: number, halfW = 0) => {
      if (raw.length < 2) return;
      // forma della freccia rifatta solo se cambia il tracciato, lo zoom o la larghezza (prima tre ammorbidimenti a ogni fotogramma)
      const ck = `${raw.length}|${px}|${halfW}`, hit = this.arrowCache.get(raw);
      const shape = hit && hit.k === ck ? hit.v : (() => {
        // ricampiona ogni pochi pixel e ammorbidisce il tratto del dito
        const step = 6 * px, rs: { x: number; y: number }[] = [raw[0]];
        walk(raw, step, (x, y) => rs.push({ x, y }));
        rs.push(raw[raw.length - 1]);
        let pts = rs;
        for (let it = 0; it < 3; it++) pts = pts.map((p, k) => (k === 0 || k === pts.length - 1 ? p : { x: (pts[k - 1].x + p.x * 2 + pts[k + 1].x) / 4, y: (pts[k - 1].y + p.y * 2 + pts[k + 1].y) / 4 }));
        const len: number[] = [0];
        for (let k = 1; k < pts.length; k++) len.push(len[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
        const L = len[len.length - 1];
        if (L < 4 * px) return null;
        // larga (offensiva di pedine): corpo largo quanto la fascia che le pedine percorrono, punta un po' più larga
        const head = Math.min(Math.max(26 * px, halfW * 1.2), L * 0.45), headW = Math.max(17 * px, halfW * 1.5), body = L - head;
        // bordi del corpo (si allarga da 5 a 9 px per lato) fino alla base della punta
        const left: { x: number; y: number }[] = [], right: { x: number; y: number }[] = [];
        let base = { x: 0, y: 0, ux: 1, uy: 0 };
        for (let k = 0; k < pts.length; k++) {
          const p = pts[k], q = pts[Math.min(pts.length - 1, k + 1)], o = pts[Math.max(0, k - 1)];
          const dx = q.x - o.x, dy = q.y - o.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
          if (len[k] > body) {
            const t = (body - len[k - 1]) / Math.max(1e-6, len[k] - len[k - 1]), pp = pts[k - 1];
            base = { x: pp.x + (p.x - pp.x) * t, y: pp.y + (p.y - pp.y) * t, ux, uy };
            const w = halfW ? Math.max(halfW, 5 * px) : 9 * px;
            left.push({ x: base.x - uy * w, y: base.y + ux * w });
            right.push({ x: base.x + uy * w, y: base.y - ux * w });
            break;
          }
          const w = halfW ? Math.max(halfW, 5 * px) : (5 + 4 * (len[k] / Math.max(1, body))) * px;
          left.push({ x: p.x - uy * w, y: p.y + ux * w });
          right.push({ x: p.x + uy * w, y: p.y - ux * w });
        }
        const tip = pts[pts.length - 1];
        const outline = [...left, { x: base.x - base.uy * headW, y: base.y + base.ux * headW }, tip,
          { x: base.x + base.uy * headW, y: base.y - base.ux * headW }, ...right.reverse()];
        return { left, right, outline };
      })();
      if (!hit || hit.k !== ck) this.arrowCache.set(raw, { k: ck, v: shape });
      if (!shape) return;
      const { left, right, outline } = shape;
      g.fillStyle(0x000000, 0.35 * alpha).fillPoints(outline.map((p) => ({ x: p.x + 1.5 * px, y: p.y + 1.5 * px })), true);
      g.fillStyle(MAP_SEL, 0.22 * alpha).fillPoints(outline, true);
      // parte già percorsa: piena
      if (done > 0) {
        const n = Math.max(2, Math.round(left.length * Math.min(1, done)));
        const filled = done >= 0.999 ? outline : [...left.slice(0, n), ...right.slice(right.length - n)];
        g.fillStyle(MAP_SEL, 0.85 * alpha).fillPoints(filled, true);
      }
      g.lineStyle(1.6 * px, MAP_SEL, alpha).strokePoints(outline, true);
    };
    // avanzamento di un'offensiva: quanto le sue pedine hanno percorso della freccia, in media
    const progress = (o: { pts: { x: number; y: number }[]; ids: number[] }) => {
      const a = o.pts[0], b = o.pts[o.pts.length - 1], L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const us = o.ids.map((id) => byId.get(id)).filter((u): u is Unit => !!u);
      if (!us.length) return 0;
      return us.reduce((s0, u) => { const c = center(u.tile); return s0 + Phaser.Math.Clamp(((c.x - a.x) * (b.x - a.x) + (c.y - a.y) * (b.y - a.y)) / (L * L), 0, 1); }, 0) / us.length;
    };
    for (const o of this.offensives) { arrow(o.pts, 0.9, progress(o), o.half); const m = o.pts[o.pts.length >> 1]; tag(m.x, m.y - 18 * px, o.ids); }
    for (let k = tags; k < this.lineTags.length; k++) this.lineTags[k].setVisible(false);
    // mentre si traccia: larga quanto la fascia che le pedine scelte percorreranno (stretta se sono in una linea: lì avanza il fronte)
    const arrowSel = this.arrowPts.length || this.arrowPick ? this.selectedUnits().filter((u) => !isNaval(u.type)) : [];
    const selHalf = arrowSel.length && !this.attackLines.some((l) => l.ids.some((id) => arrowSel.some((u) => u.id === id))) ? this.arrowHalf(arrowSel.length) : 0;
    if (this.arrowPts.length) arrow(this.arrowPts, 1, 0, selHalf);
    else if (this.arrowPick) {
      // OFFENSIVA scelta, freccia non ancora tracciata: una freccia trasparente dalle pedine al mouse fa vedere cosa succederà
      const us = this.selectedUnits().filter((u) => !isNaval(u.type)), ptr = this.input.activePointer;
      if (us.length && !this.hud.hitUi(ptr.x / UI(), ptr.y / UI(), true)) {
        const c = us.reduce((m, u) => { const q = center(u.tile); return { x: m.x + q.x / us.length, y: m.y + q.y / us.length }; }, { x: 0, y: 0 });
        const m = this.worldAt(ptr.x, ptr.y);
        if (Math.hypot(m.x - c.x, m.y - c.y) > 20 * px) arrow([c, { x: (c.x + m.x) / 2, y: (c.y + m.y) / 2 }, m], 0.35, 0, selHalf);
      }
    }
  }

  /**
   * Offensiva finita (Nico: "qualcosa deve dirti se non sei riuscito"): arrivata, fermata a metà o persa, con quante pedine
   * sono cadute; la punta lampeggia del colore dell'esito.
   */
  private offensiveDone(o: { pts: { x: number; y: number }[]; all: number[]; goals: Map<number, number> }) {
    const st = this.state, alive = o.all.map((id) => st.units.find((u) => u.id === id)).filter((u): u is Unit => !!u);
    const lost = o.all.length - alive.length, tip = o.pts[o.pts.length - 1];
    const reached = o.goals.size ? alive.filter((u) => { const g = o.goals.get(u.id) ?? -1; return g >= 0 && st.provOf(u.tile) === st.provOf(g); }).length : alive.length; // arrivata nella provincia della meta
    const lostTxt = lost ? `, ${lost} unit${lost > 1 ? 's' : ''} lost` : '';
    let msg: string, col: number;
    if (!alive.length) { msg = 'OFFENSIVE FAILED: all units lost'; col = PALETTE.ko; }
    else if (reached) { msg = `OFFENSIVE COMPLETE${lostTxt}`; col = lost ? PALETTE.allerta : PALETTE.ok; }
    else { msg = `OFFENSIVE STOPPED: could not reach the arrow tip${lostTxt}`; col = PALETTE.allerta; }
    this.hud.notify(msg, col);
    this.floatText(tip.x, tip.y - 6, reached && alive.length ? 'objective reached' : alive.length ? 'stopped' : 'failed', col);
    this.burstAt(tip.x, tip.y, 10, col);
  }

  /** Fronte scelto: le pedine selezionate vanno sul confine con il padrone della provincia toccata. */
  private pickFront(i: number) {
    this.hud.setHint(null);
    const attack = this.nationAttack;
    this.nationAttack = false;
    this.syncNations();
    const p = this.state.provOf(i), o = p >= 0 ? this.state.provOwner[p] : NEUTRAL;
    const { x, y } = center(i);
    if (o === NEUTRAL || o === PLAYER) return this.failFx(x, y, 'tap a province of another power');
    if (attack && !this.state.atWar(PLAYER, o)) return this.failFx(x, y, 'at peace: declare war first');
    const units = this.selectedUnits();
    if (!this.state.exec({ k: 'front', units: units.map((u) => u.id), faction: o, ...(attack ? { attack: true } : {}) })) return this.failFx(x, y, `no border with ${FACTION_INFO[o].short}`);
    if (attack) {
      this.state.exec({ k: 'stance', units: units.filter((u) => !isNaval(u.type)).map((u) => u.id), stance: 'attacca' });
      for (const l of this.attackLines) l.ids = l.ids.filter((id) => !units.some((u) => u.id === id)); // escono dalle linee
      this.floatText(x, y - 6, `attack: ${FACTION_INFO[o].short}`, PALETTE.ko);
      this.selectUnit(null);
      buzz(12);
      return;
    }
    this.floatText(x, y - 6, `front: ${FACTION_INFO[o].short}`, MAP_SEL);
    buzz(12);
    this.hud.refreshProvince();
  }

  /**
   * Costruzione a trascinamento (tasto COSTRUISCI o B), come il vecchio muro ma per ogni edificio: scelto l'edificio, trascini
   * sulle tue province e ne mette uno su ognuna. null = spento.
   */
  /** Menu COSTRUISCI aperto: già si vedono le tue province una per una e cosa rendono. */
  /** COSTRUISCI aperto (anche solo il pannello): le etichette tolgono i nomi delle potenze. */
  get buildView(): boolean {
    return !!this.buildWork || this.buildPeek;
  }

  get buildWorkId(): WorkId | null {
    return this.buildWork;
  }

  setBuildPeek(on: boolean) {
    if (this.buildPeek === on) return;
    this.buildPeek = on;
    this.termDirty = true;
    this.borderKey = '';
    this.updateLabels();
  }

  setBuildMode(w: WorkId | null) {
    this.buildWork = w;
    this.wallMode = !!w;
    this.wallProvs = [];
    this.wallGfx.clear();
    if (w) { this.selectedCard = null; this.selectedAbility = null; this.selectUnit(null); }
    const cost = w ? this.state.workCost(w) : null;
    const up = w && BALANCE.works[w].maxLevel ? ', click one you already have to level it up' : '';
    this.hud.setHint(w && cost ? `BUILD ${WORK_NAME[w].toUpperCase()}, ${workDesc(w, '')}, ${[this.state.workPrice(w) ? `${this.state.workPrice(w)} troops` : '', ...RESOURCES.map((r) => (cost[r] ? `${cost[r]} ${RESOURCE_INFO[r].name.toLowerCase()}` : ''))].filter(Boolean).join(' + ') || 'free'} each\nClick a province of yours${up}, Shift + drag for many, drag to move the map, ESC or right-click to finish` : null);
    this.hud.setBuildOn(w);
    this.syncBuildable();
    this.termDirty = true; // confini tra le tue province (solo in COSTRUISCI)
    this.borderKey = '';
    this.updateLabels();
  }

  /** Mappa delle costruzioni (Nico): con un edificio scelto si accendono le tue province dove lo puoi mettere (o
   *  migliorare); si aggiorna quando cambia qualcosa (truppe, cantieri, territorio). */
  private syncBuildable() {
    const w = this.buildWork;
    const ok: number[] = [];
    if (w) for (let p = 0; p < this.state.provOwner.length; p++) {
      if (this.state.provOwner[p] !== PLAYER) continue;
      const why = this.state.workBlock(p, w);
      if (!why || why === 'troops' || why === 'resources') ok.push(p); // mancano solo truppe o risorse: il posto c'è
    }
    const sig = `${w}|${ok.join(',')}`;
    if (sig === this.buildSig) return;
    this.buildSig = sig;
    this.buildImg?.destroy();
    this.buildImg = null;
    if (!ok.length) return;
    const g = this.add.graphics().setDepth(this.ovlDepth).fillStyle(MAP_SEL, 0.22);
    for (const p of ok) fillProvince(g, this.shapes.provinces[p]);
    this.buildImg = g;
  }

  /** Aggiunge al muro le tue province sotto il tratto trascinato e le evidenzia. */
  private wallAlong(x0: number, y0: number, x1: number, y1: number) {
    const steps = Math.max(1, Math.ceil(Phaser.Math.Distance.Between(x0, y0, x1, y1) / (6 * DPR)));
    let changed = false;
    for (let k = 0; k <= steps; k++) {
      const p = this.state.provOf(this.tileAt(x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps));
      if (p < 0 || this.state.provOwner[p] !== PLAYER || this.wallProvs.includes(p)) continue;
      const why = this.buildWork ? this.state.workBlock(p, this.buildWork) : null;
      if (why === 'tech' || why === 'coast' || why === 'busy') continue; // qui non si può: niente evidenza
      this.wallProvs.push(p);
      changed = true;
    }
    if (!changed) return;
    const g = this.wallGfx.clear().fillStyle(MAP_SEL, 0.35);
    for (const p of this.wallProvs) fillProvince(g, this.shapes.provinces[p]);
  }

  private finishWall() {
    const provs = this.wallProvs;
    this.wallProvs = [];
    this.wallGfx.clear();
    if (!provs.length) return;
    const w = this.buildWork ?? 'bunker';
    const r = this.state.exec({ k: 'wall', provs, work: w });
    const { x, y } = center(this.map.provinces[provs[0]].anchor);
    if (!r.built) return this.failFx(x, y, r.stop === 'resources' ? 'not enough resources' : r.stop === 'troops' ? 'not enough troops' : 'cannot build here');
    for (const p of provs.slice(0, r.built)) this.flashProvince(p, PALETTE.allerta, 0.5, 500);
    const left = provs.length - r.built - r.skipped;
    this.hud.notify(`${WORK_NAME[w].toUpperCase()}, ${r.built} being built${left > 0 ? `, ${left} left out (${r.stop === 'resources' ? 'resources' : 'troops'})` : ''}`, PALETTE.allerta);
    buzz(15);
    // la modalità resta aperta (Nico): si continua a costruire finché ESC o clic destro
  }

  /** Gruppi alla HOI4: Ctrl (o Maiusc) + numero salva la selezione, il numero la richiama (due volte: ci va la carta). */
  private groupKey(e: KeyboardEvent) {
    const m = /^Digit([1-9])$/.exec(e.code);
    if (!m) return;
    const n = Number(m[1]);
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
      if (!this.selection.size) return this.hud.notify('select units, then Ctrl (or Shift) + number', PALETTE.ko);
      this.setGroup(n, [...this.selection]);
      return;
    }
    this.selectGroup(n);
  }

  /** Mette le pedine nel gruppo `n` (una pedina sta in un gruppo solo: esce dagli altri). */
  private setGroup(n: number, ids: number[]) {
    // il gruppo è un gruppetto compatto (Nico, 27 novembre 2026): le pedine si raccolgono e vanno come un blocco
    this.state.exec({ k: 'unband', units: [...(this.groups.get(n) ?? []), ...ids] });
    for (const [k, v] of this.groups) { const rest = v.filter((id) => !ids.includes(id)); if (rest.length) this.groups.set(k, rest); else this.groups.delete(k); }
    for (const [, v] of this.groups) this.state.exec({ k: 'band', units: v }); // gruppi che hanno perso pedine: si rifanno
    this.groups.set(n, ids);
    this.groupIdxFrame = -1;
    this.state.exec({ k: 'band', units: ids });
    this.hud.notify(`${ROMAN_N[n]} ARMY, ${ids.length} ${ids.length === 1 ? 'unit' : 'units'}, moving together`, PALETTE.radioattivo);
    for (const sp of this.unitSprites.values()) sp.badgeKey = ''; // numero del gruppo sulle pedine da ridisegnare
  }

  /** Nuovo gruppo dalla selezione: il primo numero libero (o quello del gruppo se la selezione è già tutta di uno). */
  makeGroup() {
    const ids = [...this.selection].filter((id) => this.state.units.some((u) => u.id === id && u.owner === PLAYER));
    if (!ids.length) return this.hud.notify('select units, then + GROUP', PALETTE.ko);
    const same = this.groupOf(ids[0]);
    // tutto il gruppo scelto e niente altro: lo si scioglie (le pedine tornano libere)
    if (same && ids.every((id) => this.groupOf(id) === same) && this.groupIds(same).length === ids.length) {
      this.state.exec({ k: 'unband', units: ids });
      this.groups.delete(same);
      this.groupIdxFrame = -1;
      for (const sp of this.unitSprites.values()) sp.badgeKey = '';
      return this.hud.notify(`${ROMAN_N[same]} ARMY dissolved`, PALETTE.allerta);
    }
    let n = same && ids.every((id) => this.groupOf(id) === same) ? same : 0;
    for (let k = 1; k <= 9 && !n; k++) if (!this.groupIds(k).length) n = k;
    if (!n) return this.hud.notify('maximum 9 groups', PALETTE.ko);
    this.setGroup(n, ids);
  }

  /** La selezione è esattamente un gruppo (il tasto diventa UNGROUP). */
  selectionIsGroup(): boolean {
    const ids = [...this.selection], g = ids.length ? this.groupOf(ids[0]) : 0;
    return !!g && ids.every((id) => this.groupOf(id) === g) && this.groupIds(g).length === ids.length;
  }

  /** Pedine vive del gruppo. */
  groupIds(n: number): number[] {
    return (this.groups.get(n) ?? []).filter((id) => this.state.units.some((u) => u.id === id));
  }

  /** Gruppo della pedina (0 = nessuno). */
  groupOf(id: number): number {
    // indice pedina → gruppo una volta per fotogramma (prima ogni pedina scorreva tutti i gruppi a ogni fotogramma)
    const now = this.game.getFrame();
    if (this.groupIdxFrame !== now) {
      this.groupIdxFrame = now;
      this.groupIdx.clear();
      for (const [k, v] of this.groups) for (const u of v) this.groupIdx.set(u, k);
    }
    return this.groupIdx.get(id) ?? 0;
  }
  private groupIdx = new Map<number, number>();
  private groupIdxFrame = -1;

  /** Gruppi per la barra in alto: numero, pedine e cosa stanno facendo. */
  groupList(): { n: number; count: number; state: 'offensiva' | 'in line' | 'fronte' | 'combatte' | 'marching' | 'fermo'; selected: boolean }[] {
    const out: ReturnType<RunScene['groupList']> = [];
    for (const n of [...this.groups.keys()].sort((a, b) => a - b)) {
      const us = this.groupIds(n).map((id) => this.state.units.find((u) => u.id === id)!);
      if (!us.length) { this.groups.delete(n); continue; }
      const state = us.some((u) => u.inCombat) ? 'combatte' : us.some((u) => u.goal >= 0) ? 'offensiva' : us.some((u) => u.post >= 0) ? 'in line'
        : us.some((u) => u.front >= 0) ? 'fronte' : us.some((u) => u.path.length) ? 'marching' : 'fermo';
      out.push({ n, count: us.length, state, selected: us.every((u) => this.selection.has(u.id)) && this.selection.size === us.length });
    }
    return out;
  }

  /** Seleziona il gruppo; due volte di fila: la carta si centra su di lui. */
  /** Linee per il pannello LINES dell'HUD: colore, reparti, contro chi. */
  lineList(): { n: number; color: number; count: number; vs: string }[] {
    return this.attackLines.map((l) => ({
      n: LINE_COLORS.indexOf(l.color) + 1, color: l.color, count: l.ids.length,
      vs: [...l.enemies].map((f) => (f === NEUTRAL ? 'free land' : FACTION_INFO[f]?.short ?? '')).filter(Boolean).join(', '),
    }));
  }

  /** Attacchi a una nazione in corso (Nico: un gruppo nel pannello LINES che dice chi sta attaccando chi, da fermare). */
  nationAttacks(): { f: number; name: string; color: number; count: number }[] {
    const by = new Map<number, number>();
    for (const u of this.state.unitsOf(PLAYER)) if (u.front >= 0 && u.stance === 'attacca') by.set(u.front, (by.get(u.front) ?? 0) + 1);
    return [...by].map(([f, count]) => ({ f, name: FACTION_INFO[f]?.short ?? '?', color: FACTION_INFO[f]?.fill ?? MAP_SEL, count }));
  }

  /** Regioni in corso per il pannello LINES: reparti e province ancora da prendere. */
  zoneList(): { id: number; color: number; count: number; left: number }[] {
    const st = this.state, out: ReturnType<RunScene['zoneList']> = [];
    for (const id of st.zones.keys()) {
      const count = st.unitsOf(PLAYER).filter((u) => u.zone === id).length;
      if (!count) continue;
      out.push({ id, color: MAP_SEL, count, left: st.zoneTargets(id).length });
    }
    return out;
  }

  /** Seleziona i reparti delle regioni o le ferma: si fermano dove sono e tengono. */
  zoneAction(id: number, kind: 'select' | 'stop') {
    const us = this.state.unitsOf(PLAYER).filter((u) => u.zone === id);
    if (!us.length) return;
    if (kind === 'select') { this.selection = new Set(us.map((u) => u.id)); this.applySelection(); return; }
    const ids = us.map((u) => u.id);
    this.state.exec({ k: 'release', units: ids });
    this.state.exec({ k: 'hold', units: ids, posts: us.map((u) => { const h = this.state.nearestOwnAnchor(u.tile); return h >= 0 ? h : this.state.stopOf(u.tile); }) });
    this.hud.notify('Regions attack stopped', PALETTE.allerta);
  }

  /** Seleziona i reparti dell'attacco o lo ferma: si fermano dove sono e tengono. */
  attackAction(f: number, kind: 'select' | 'stop') {
    const us = this.state.unitsOf(PLAYER).filter((u) => u.front === f && u.stance === 'attacca');
    if (!us.length) return;
    if (kind === 'select') { this.selection = new Set(us.map((u) => u.id)); this.applySelection(); return; }
    const ids = us.map((u) => u.id);
    this.state.exec({ k: 'stance', units: ids, stance: 'tieni' });
    // posto da tenere: il centro della tua provincia più vicina (prima il centro di quella dove stava, anche se nemica: ci
    // andava e la assediava, Nico: "continuano ad attaccare all'infinito")
    this.state.exec({ k: 'hold', units: ids, posts: us.map((u) => { const h = this.state.nearestOwnAnchor(u.tile); return h >= 0 ? h : this.state.stopOf(u.tile); }) });
    this.hud.notify(`Attack on ${FACTION_INFO[f]?.name ?? '?'} stopped`, PALETTE.allerta);
  }

  /** Comandi del pannello LINES: seleziona i reparti, aggiungi i selezionati, offensiva, ridisegna, togli. */
  lineAction(n: number, kind: 'select' | 'add' | 'attack' | 'redraw' | 'delete') {
    const l = this.attackLines.find((o) => LINE_COLORS.indexOf(o.color) + 1 === n);
    if (!l) return;
    if (kind === 'add') {
      const units = this.selectedUnits().filter((u) => u.owner === PLAYER && !isNaval(u.type));
      if (!units.length) return this.hud.notify('select units first', PALETTE.ko);
      return this.assignToLine(l, units);
    }
    if (kind === 'delete') return this.removeLine(l);
    const ids = l.ids.filter((id) => this.state.units.some((u) => u.id === id));
    if (kind === 'redraw') {
      this.removeLine(l);
      this.selection = new Set(ids);
      this.applySelection();
      return this.unitAction('line');
    }
    if (!ids.length) return this.hud.notify('no units on this line', PALETTE.ko);
    this.selection = new Set(ids);
    this.applySelection();
    if (kind === 'attack') this.unitAction('push');
  }

  selectGroup(n: number) {
    const ids = this.groupIds(n);
    if (!ids.length) return;
    this.selection = new Set(ids);
    this.applySelection();
    const now = this.time.now;
    if (this.lastGroupKey.n === n && now - this.lastGroupKey.at < 400) { // doppio: centra la carta sul gruppo
      const u = this.state.units.find((v) => v.id === ids[ids.length - 1]);
      if (u) this.centerOn(u.tile);
    }
    this.lastGroupKey = { n, at: now };
  }

  /** Percorso sullo schermo lungo la rete: dalla pedina ai centri toccati, in linea dritta fra uno e l'altro (non casella
   *  per casella, che da vicino fa zig-zag). */
  private netPts(u: Unit, path: number[], from?: { x: number; y: number }): { x: number; y: number }[] {
    const P = this.map.provinces, sp = this.unitSprites.get(u.id);
    const stops = path.filter((i, k) => P[this.state.provOf(i)]?.anchor === i || k === path.length - 1);
    return [from ?? (sp ? { x: sp.c.x, y: sp.c.y } : center(u.tile)), ...stops.map(center)];
  }

  /** Mouse fermo su una casella: anteprima del percorso (pedine scelte) o previsione dell'assalto (provincia di confine). */
  private updateHover(time: number) {
    if (time - this.hoverAt < 120) return;
    this.hoverAt = time;
    const i = this.hoverTile;
    this.previewGfx.clear();
    this.previewPts = null;
    const main = this.selectedUnit !== null ? this.state.units.find((u) => u.id === this.selectedUnit) : undefined;
    if (i < 0 || this.dragging) return this.hud.hideForecast();
    if (main) {
      this.hud.hideForecast();
      const path = this.state.previewPath(main, i);
      this.previewPts = path.length ? this.netPts(main, path) : null;
      return;
    }
    if (this.selectedCard || this.selectedAbility || this.wallMode || this.frontPick || this.linePick || !this.state.isFrontier(i) || this.state.owner[i] !== NEUTRAL) return this.hud.hideForecast();
    const t = this.tileToScreen(i);
    this.hud.showForecast(this.state.provOf(i), t.x, t.y);
  }

  /**
   * Corridoio di marcia (Nico: "in Call of War se zoomi vedi il corridoio in cui va la truppa"): una fascia larga e tenue, la linea
   * al centro e frecce lungo la strada ogni tanto, la meta segnata da un anello. Spessori a misura di schermo, a ogni zoom.
   */
  private corridor(_g: Phaser.GameObjects.Graphics, pts: { x: number; y: number }[], color: number, strong: boolean) {
    // percorso nella griglia della carta (Nico): celle accese fino alla meta, cornice di celle sull'arrivo
    if (pts.length < 2) return;
    const a = strong ? 1 : 0.7;
    // come prima (tratto sottile), solo un po' più scuro: sul tuo territorio azzurro si vedeva poco (Nico)
    const C = Phaser.Display.Color.ValueToColor(color);
    this.pen.path(pts, Phaser.Display.Color.GetColor(C.red * 0.72, C.green * 0.72, C.blue * 0.72), a);
  }

  private tapTile(i: number) {
    this.hud.hideProvince();
    if (i < 0) return;
    const { x, y } = center(i);
    if (this.selectedAbility) {
      const a = this.selectedAbility;
      this.selectedAbility = null;
      this.hud.setHint(null);
      if (this.state.exec({ k: 'ability', a, tile: i })) analytics.design(['abilita', a]);
      return;
    }
    if (this.frontPick) {
      this.frontPick = false;
      this.pickFront(i);
      return;
    }
    // sul mare si possono solo mandare le navi
    if (!this.map.tiles[i]) {
      if (this.selection.size) this.orderSelection(i);
      return;
    }

    if (this.selectedCard) {
      const t = this.selectedCard;
      // nella provincia toccata va bene qualsiasi casella libera (prima bisognava centrare una casella vuota)
      const spot = isNaval(t) ? i : this.state.freeTileIn(this.state.provOf(i)) ?? i;
      const u = this.state.exec({ k: 'deploy', type: t, tile: spot });
      if (!u) {
        const why = this.state.deployBlock(PLAYER, t, spot);
        return this.failFx(x, y, isNaval(t) ? (why === 'city' ? 'ships come out of your coastal cities' : 'needs one of your cities on the sea') : why === 'city' ? 'raise armies in your cities' : this.state.owner[i] === PLAYER ? 'no free room here' : 'only in your territory');
      }
      // la carta resta scelta: si schiera ancora finché bastano le truppe (poi si esce da soli)
      if (this.state.deployBlock(PLAYER, t)) { this.endDeploy(); this.hud.notify('Not enough to deploy more', PALETTE.allerta); }
      this.syncUnits();
      sfx('deploy');
      this.conquestFx(x, y, this.state.unitCost(PLAYER, t), 0);
      this.selectUnit(null); // schierata e basta: niente selezione attiva (Nico)
      this.hud.tutorialSignal('deploy');
      this.usage.pedine++;
      analytics.design(['pedina', t]);
      return;
    }
    const mine = this.state.unitAt(i);
    if (mine && mine.owner === PLAYER) return this.selectUnit(this.selection.size === 1 && this.selection.has(mine.id) ? null : mine.id);
    if (this.selection.size) {
      // clic su una linea: i reparti scelti entrano nel suo gruppo (prendono il suo colore e si dispongono lungo di essa)
      const l = this.lineNear(center(i));
      if (l) { this.assignToLine(l, this.selectedUnits().filter((u) => !isNaval(u.type))); return; }
      this.orderSelection(i);
      return;
    }

    // pausa strategica: i tocchi sulla mappa preparano il piano, che parte quando il tempo riprende
    const p = this.state.provOf(i);
    // sandbox: il primo tocco su terra libera sceglie dove calarsi; finché non si sceglie il tempo è fermo
    if (this.state.placing) {
      if (this.state.exec({ k: 'place', p })) {
        this.territory.invalidate();
        this.redrawFrontier(true);
        this.flashProvince(p, PALETTE.radioattivo, 0.7, 700);
        this.hud.centerPrompt(null);
        buzz(20);
      } else this.failFx(x, y, 'choose free land');
      return;
    }
    const holder = p >= 0 ? this.state.provOwner[p] : NEUTRAL;
    if (holder !== NEUTRAL && holder !== PLAYER && !this.state.atWar(PLAYER, holder) && this.state.sees(i)) {
      this.hud.showProfile(holder); // in pace (o alleati): non si attacca, si tratta
      return;
    }
    if (this.state.paused && !this.state.over) {
      if (!this.state.provPassable(p) || this.state.provOwner[p] !== NEUTRAL) return; // il piano compra solo il vuoto
      const added = this.state.exec({ k: 'plan', p });
      this.floatText(x, y - 4, added ? `plan ${this.state.plan.length}` : 'removed from the plan', MAP_SEL);
      this.syncPlan();
      buzz(8);
      return;
    }

    if (!this.state.isFrontier(i)) {
      if (this.state.owner[i] === PLAYER) return this.hud.showProvince(p); // scheda della provincia: terreno, produzione, costruzioni
      // lontano dal fronte: niente avanzata automatica (tolta); oltre il mare si sbarca con una nave, altrimenti si vede la scheda
      if (this.state.passable(i) && isCoast(this.map.tiles, i)) {
        const why = this.state.exec({ k: 'boat', tile: i });
        if (!why) {
          this.floatText(x, y - 6, 'ship under way!', MAP_INK);
          buzz(15);
          this.usage.navi++;
          return;
        }
        // la nave non parte: si dice perché (Nico: "le isole sono irraggiungibili, o non so come si fa")
        const msg: Record<string, string> = { units: 'occupied: send units, they cross the sea', far: 'too far by sea', max: 'too many ships at sea', troops: 'not enough troops', peace: 'at peace' };
        if (typeof why === 'string' && msg[why]) return this.failFx(x, y, msg[why]);
      }
      if (p >= 0) this.hud.showProvince(p, false);
      return;
    }

    // provincia di frontiera: si compra col tocco (come prima), senza trascinare
    const res = this.state.exec({ k: 'conquer', tile: i });
    if (!this.state.opts.tutorial) this.hud.showProvince(p, false); // tabella in basso alla Call of War
    if (res.ok && res.battle) {
      // provincia di qualcuno: parte l'assalto (le truppe sono già in marcia)
      this.usage.tocchi++;
      buzz(15);
      this.floatText(x, y - 6, `assault ${Math.ceil((res.battle.endMs - res.battle.startMs) / 1000)} s`, PALETTE.allerta);
      this.redrawFrontier(true);
      this.hud.onConquest(0);
    } else if (res.ok) {
      this.usage.tocchi++;
      this.tapFxTile = p;
      this.redrawOwned();
      this.redrawFrontier(true);
      this.conquestFx(x, y, res.cost, res.loot, res.lootType, p);
      this.hud.onConquest(res.loot);
    } else if (res.reason === 'troops') {
      this.failFx(x, y, `needs ${res.need! + 1}`);
    } else if (res.reason === 'battle') {
      this.failFx(x, y, 'assault under way');
    } else if (res.reason === 'units') {
      this.failFx(x, y, 'needs a unit');
      // la prima volta si spiega come: le province di imperi e milizie non si comprano, si prendono con le pedine
      if (!this.unitsHintShown) {
        this.unitsHintShown = true;
        // nel riquadro grande dei suggerimenti, col tasto che lo fa (Nico: niente scritta piccola)
        this.hud.tip('Take it with units', 'Enemy and militia provinces are taken with units: deploy one in a city of yours, then send it there.',
          'DEPLOY INFANTRY', () => { this.toggleCard('fanteria'); });
      }
    } else if (res.reason === 'not-adjacent') {
      this.failFx(x, y, 'too far');
    } else if (res.reason === 'impassable') {
      this.failFx(x, y, 'irraggiungibile');
    }
  }

  /** Fine run: un attimo per vedere cos'è successo, poi la schermata finale. */
  private finish() {
    void clearResume(); // partita chiusa: al prossimo ricaricamento niente da riprendere
    this.ending = true;
    this.selectedCard = null;
    this.selectUnit(null);
    this.hud.showEnd(this.state.over!, this.state.victoryReason);
    sfx(this.state.over === 'victory' ? 'victory' : 'defeat'); // con la vibrazione di prima (in sfx)
    for (const [k, v] of Object.entries(this.usage)) analytics.design(['controlli', k], v);
    analytics.design(['controlli', 'lavoro_finale'], Math.round(this.state.player.workers * 100));
    analytics.design(['controlli', 'attacco_finale'], Math.round(this.state.attackRatio * 100));
    this.time.delayedCall(BALANCE.end.resultDelayMs, () => {
      this.scene.stop('Hud');
      // replay di fine partita: resta in memoria finché non se ne apre un altro (non nel profilo: è grosso)
      const data = this.state.replayData();
      this.registry.set('replay', data ? { data, map: this.map } : null);
      this.scene.start('Result', this.state.summary());
    });
  }

  /** WASD o frecce: spostano la carta (col mouse il trascinamento sinistro seleziona le pedine, come in HOI4). */
  private keyPan(delta: number) {
    const k = this.input.keyboard;
    if (!k) return;
    this.panKeys ??= k.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT', false) as Record<string, Phaser.Input.Keyboard.Key>;
    const K = this.panKeys, cam = this.cameras.main, v = (900 * UI() * delta) / 1000 / cam.zoom;
    const dx = (K.D.isDown || K.RIGHT.isDown ? 1 : 0) - (K.A.isDown || K.LEFT.isDown ? 1 : 0);
    const dy = (K.S.isDown || K.DOWN.isDown ? 1 : 0) - (K.W.isDown || K.UP.isDown ? 1 : 0);
    if (!dx && !dy) return;
    cam.scrollX += dx * v;
    cam.scrollY += dy * v;
    this.labelTimer = Math.min(this.labelTimer, 60);
  }

  /** Accende/spegne la vista logistica; ritorna lo stato nuovo. */
  /** Cambia la vista della carta. */
  setMapMode(m: 'politica' | 'terreno' | 'logistica' | 'strutture') {
    this.mapMode = m;
    this.logistics = m === 'logistica';
    this.termDirty = true;
  }

  toggleLogistics(): boolean {
    this.logistics = !this.logistics;
    this.mapMode = this.logistics ? 'logistica' : 'politica';
    this.termDirty = true;
    return this.logistics;
  }

  ritirata() {
    this.state.exec({ k: 'retreat' });
  }

  // ---------- nomi ----------

  /** Nomi delle nazioni: li disegna l'interfaccia in giallo terminale (vedi MapLabels). */
  private drawNationNames() {
    // larghezza della nazione sulla carta (dalle sagome delle province): il nome si adatta e non esce dai confini
    const box = new Map<number, [number, number]>();
    this.map.provinces.forEach((p, k) => {
      const s = this.shapes.provinces[k];
      if (!s?.parts.length) return;
      const b = box.get(p.country);
      box.set(p.country, b ? [Math.min(b[0], s.x0), Math.max(b[1], s.x1)] : [s.x0, s.x1]);
    });
    // solo i nomi dentro la carta (Europa, America: il resto del mondo non c'è)
    const M = BALANCE.map, inMap = (lon: number, lat: number) => lon >= M.lonMin && lon <= M.lonMax && lat >= M.latMin && lat <= M.latMax;
    this.termPlaces = [
      ...places.cities.filter(([, lon, lat]) => inMap(lon as number, lat as number)).map(([name, lon, lat]) => ({ x: this.lonX(lon as number), y: this.latY(lat as number), name: name as string, kind: 'city' as const })),
      ...places.seas.filter(([, lon, lat]) => inMap(lon as number, lat as number)).map(([name, lon, lat]) => ({ x: this.lonX(lon as number), y: this.latY(lat as number), name: name as string, kind: 'sea' as const })),
    ];
    this.placeLabels = [];
    this.termNations = this.map.nations.filter((n) => n.size >= BALANCE.provinces.nameMinTiles).sort((a, b) => b.size - a.size).map((n) => {
      const { x, y } = center(n.label), b = box.get(n.id) ?? [x - 10, x + 10];
      return { x, y, name: n.name, size: 0, width: b[1] - b[0], tile: n.label };
    });
  }


  /** Logistica: le altre potenze sbiadite verso il grigio della terra, il tuo territorio resta in primo piano. */
  private fadedFill(o: number): string {
    const C = Phaser.Display.Color, c = C.Interpolate.ColorWithColor(C.ValueToColor(FACTION_INFO[o].fill), C.ValueToColor(0x2a2f36), 100, 72);
    return '#' + C.GetColor(c.r, c.g, c.b).toString(16).padStart(6, '0');
  }

  /** Costruzioni visibili solo in COSTRUISCI o sulla provincia toccata (Nico: sulla carta erano troppe). */
  private showWork(p: number): boolean {
    return !!this.buildWork || this.buildPeek || p === this.workCardP || this.mapMode !== 'politica'; // nelle mappe terreno e logistica sempre
  }

  /** Città (punto), capitali (stella dorata) e insediamenti (rombo) inquadrati: dimensione costante sullo schermo. */
  private drawCities(g: Phaser.GameObjects.Graphics, v: Phaser.Geom.Rectangle, px: number) {
    const MP = PALETTE.mappa, z = 1 / px;
    const inV = (x: number, y: number) => x > v.x - 8 && x < v.right + 8 && y > v.y - 8 && y < v.bottom + 8;
    if (z >= 5.9 && !this.term) { // rovine: non sulla carta da terminale (solo città e capitali)
      g.fillStyle(MP.segno, 0.55);
      for (const i of this.ruinTiles) {
        const { x, y } = center(i);
        if (!inV(x, y)) continue;
        const r = 2.2 * px;
        g.fillPoints([{ x, y: y - r }, { x: x + r, y }, { x, y: y + r }, { x: x - r, y }], true);
      }
    }
    this.map.provinces.forEach((p, idx) => {
      if (!this.state.isCity(idx)) return; // solo le città che valgono di più (Nico: niente punto in ogni provincia)
      const ct = p.city >= 0 ? p.city : p.anchor; // città costruite in una provincia senza città sulla carta: al centro
      if (ct < 0) return;
      const c0 = center(ct);
      // agganciato ai pixel dello schermo: niente bordi sfocati o lati di misura diversa
      const x = v.x + Math.round((c0.x - v.x) / px) * px, y = v.y + Math.round((c0.y - v.y) / px) * px;
      if (!inV(x, y)) return;
      if (this.map.tiles[ct]!.capital) {
        // capitale: una stella (Nico), azzurra come i nomi della carta; solo da vicino, sempre della stessa misura sullo schermo
        if (z < 2.2) return;
        const r = 5 * px, pts: Phaser.Types.Math.Vector2Like[] = []; // da lontano più piccole
        for (let k = 0; k < 10; k++) {
          const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.45 : r;
          pts.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr });
        }
        g.fillStyle(CITY_COL, 1).fillPoints(pts, true).lineStyle(1.4 * px, 0x000000, 1).strokePoints(pts, true);
      } else if (z >= 2.2) {
        // città: un quadrato con bordo nero, solo da vicino (Nico: "non ci devono essere nella mappa da fuori"),
        // sempre della stessa misura sullo schermo (prima cambiava con lo zoom)
        const r = 3 * px; // misure intere in pixel dello schermo: 6 di lato più 1 di bordo
        g.fillStyle(0x000000, 1).fillRect(x - r - px, y - r - px, 2 * r + 2 * px, 2 * r + 2 * px).fillStyle(CITY_COL, 1).fillRect(x - r, y - r, 2 * r, 2 * r);
      }
    });
  }

  /** Lampo su tutta la sagoma della provincia. */
  /**
   * Lampo sulla provincia in stile terminale: invece di una macchia piena, quadratini che si accendono e si spengono
   * sparsi dentro la sagoma (come caratteri che lampeggiano), poi il contorno che si dissolve.
   */
  private flashProvince(p: number, color: number, from: number, ms: number) {
    const sh = this.shapes.provinces[p];
    if (!sh || !sh.parts.length) return;
    // la sagoma intera si accende e sfuma (Nico: via i quadratini sparsi, "togli tutti i riquadri"); una sola per provincia:
    // se ne arriva un'altra sulla stessa, la vecchia sparisce subito (prima si sovrapponevano)
    // meno "macchia bianca che svanisce" (Nico, 28 novembre 2026: effetti che sembrano fatti in fretta): velo leggero che
    // sale in un attimo e si spegne piano, contorno netto che resta un po' di più
    const px = UI() / this.cameras.main.zoom;
    this.flashes.get(p)?.destroy();
    const g = this.add.graphics().setDepth(this.ovlDepth).setAlpha(0);
    this.fillProvince(g, p, color, 0.32, 1.2 * px);
    this.flashes.set(p, g);
    const done = () => { if (this.flashes.get(p) === g) this.flashes.delete(p); g.destroy(); };
    this.tweens.chain({ targets: g, tweens: [
      { alpha: from, duration: 90, ease: 'Sine.easeOut' },
      { alpha: 0, duration: ms * 1.4, ease: 'Sine.easeInOut' },
    ], onComplete: done });
  }

  /** Profondità dei segni sulla carta (lampi, linee, regioni, nazioni): sotto la trama delle fessure, così diventano puntini
   *  come i territori (Nico, 28 novembre 2026: "sembrano altri elementi, molto meno pixelati: riciclali"). */
  private get ovlDepth(): number {
    return this.term.gridDepth - 0.002;
  }

  /** Sagoma della provincia piena (velo) e contornata, nella grafica data. */
  private fillProvince(g: Phaser.GameObjects.Graphics, p: number, color: number, alpha: number, line: number) {
    const sh = this.shapes.provinces[p];
    if (!sh) return;
    for (const part of sh.parts) {
      const pts = Array.from({ length: part.outer.length / 2 }, (_, j) => ({ x: part.outer[2 * j], y: part.outer[2 * j + 1] }));
      g.fillStyle(color, alpha).fillPoints(pts, true);
      g.lineStyle(line, color, 1).strokePoints(pts, true);
    }
  }

  /** Ricognizione: aereo che attraversa e anello che si apre; bombardamento: mirino, poi esplosioni. */
  private abilityFx(a: AbilityType, tile: number, phase: 'launch' | 'impact', hits: number, by = PLAYER, blocked = false) {
    const { x, y } = center(tile);
    if (blocked) {
      // contraerea: il colpo si spegne in aria
      this.burstAt(x, y - 10, 10, MAP_INK);
      this.floatText(x, y - 8, 'intercepted by anti-aircraft', MAP_SEL);
      return;
    }
    if (by !== PLAYER && phase === 'launch') this.hud.onEnemyStrike(by);
    const R = S * 1.7;
    if (a === 'ricognizione') {
      const plane = this.add.graphics({ x: x - 160, y: y + 60 }).setDepth(12);
      drawAbilityIcon(plane, 'ricognizione', 0, 0, 7, MAP_SEL);
      plane.setRotation(Math.atan2(-60, 160) + Math.PI / 2);
      this.tweens.add({ targets: plane, x: x + 160, y: y - 60, duration: 1400, ease: 'Sine.easeInOut', onComplete: () => plane.destroy() });
      const rr = R * BALANCE.abilities.ricognizione.radius * 0.6;
      const ring = this.add.circle(x, y, rr).setStrokeStyle(1.5, MAP_SEL).setDepth(11); // area sorvolata (niente riquadro, Nico)
      this.tweens.add({ targets: ring, scale: { from: 0.1, to: 1 }, alpha: { from: 1, to: 0 }, duration: 1200, onComplete: () => ring.destroy() });
      buzz(20);
      sfx('ping');
      return;
    }
    if (phase === 'launch') {
      const mark = this.add.graphics({ x, y }).setDepth(12);
      drawAbilityIcon(mark, 'bombardamento', 0, 0, R, PALETTE.ko);
      this.tweens.add({ targets: mark, scale: { from: 1.6, to: 1 }, alpha: { from: 1, to: 0.6 }, duration: BALANCE.abilities.bombardamento.delayMs, onComplete: () => mark.destroy() });
      return;
    }
    // esplosioni in sequenza come onde (stesso colpo delle battaglie), non palloni pieni che si gonfiano
    for (let k = 0; k < 5; k++) {
      const ox = (Math.random() - 0.5) * R * 2, oy = (Math.random() - 0.5) * R * 2;
      this.time.delayedCall(k * 110, () => this.burstAt(x + ox, y + oy, 22, MAP_INK));
    }
    buzz([40, 30, 60]);
    sfx('boom', 1, false);
    this.ownedDirty = true;
    this.floatText(x, y - 8, hits ? `${hits} hit` : 'no target', hits ? MAP_INK : MAP_INK);
  }

  private conquestFx(x: number, y: number, cost: number, loot: number, lootType: Resource = 'metallo', p = -1) {
    if (p >= 0) this.flashProvince(p, 0xffffff, 0.75, 480);
    if (cost > 0) this.floatText(x, y - 4, `-${cost}`, MAP_INK); // provincia vuota (costo 0): niente "-0" (Nico)
    if (loot) {
      this.floatText(x, y + 8, `+${loot} ${RESOURCE_INFO[lootType].name.toLowerCase()}`, RESOURCE_INFO[lootType].color, 160);
    }
  }

  // ---------- pedine: disegno ----------

  private makeUnitSprite(u: Unit) {
    const f = FACTION_INFO[u.owner], mine = u.owner === PLAYER;
    const g = this.add.graphics();
    drawUnitSymbol(g, u.type, mine, mine ? MAP_INK : f.fill);
    const hp = this.add.graphics(), badge = this.add.graphics();
    const { x, y } = center(u.tile);
    const c = this.add.container(x, y, [g, hp, badge]).setDepth(D.units).setData('sym', g);
    const pop = { k: 0.6 };
    this.tweens.add({ targets: pop, k: 1, duration: 320, ease: 'Cubic.easeOut' }); // compare senza rimbalzo da cartone
    return { c, hp, badge, badgeKey: '', tile: u.tile, hpShown: -1, pop };
  }

  /** Assalti visibili: anello che si riempie col tempo e due sciabole incrociate; la tua capitale con un doppio anello d'oro. */
  private drawBattles(time: number) {
    // da lontano il riquadro dell'assalto rimpicciolisce come le pedine (Nico: "enorme per nessun motivo")
    const zFar = Phaser.Math.Clamp(this.cameras.main.zoom / UI() / 6, 0.3, 1);
    const g = this.battleGfx.clear(), st = this.state, s0 = UI() / this.cameras.main.zoom, s = s0 * zFar;
    const sieges: { p: number; color: number; t: number }[] = [];
    for (const b of st.battles) {
      if (b.by !== PLAYER && b.from !== PLAYER && !st.inSight(b.p)) continue; // assalti degli altri: solo nella zona in vista
      let { x, y } = center(this.map.provinces[b.p].anchor);
      const t = Phaser.Math.Clamp((st.clockMs - b.startMs) / Math.max(1, b.endMs - b.startMs), 0, 1);
      const col = FACTION_INFO[b.by]?.fill ?? MAP_INK;
      const danger = b.from === PLAYER;
      // assalto (Nico: via il riquadro nero e il mirino): sciabole incrociate sul centro; contro di te pulsano in rosso.
      // Avanzamento (Nico, 27 novembre 2026: la barra sottile stava sotto le pedine e non si vedeva): la provincia si riempie
      // dal basso verso l'alto del colore di chi attacca
      sieges.push({ p: b.p, color: col, t }); // la provincia si riempie coi suoi puntini, dal basso (WorldMap)
      // sopra la pedina, non sotto (Nico: "informazioni coperte dalle pedine"); sulla capitale accanto alla stella
      const k = 6 * s, capHere = st.capitalProv.some((cp) => cp === b.p);
      x += capHere ? 20 * s0 : 0; y -= 26 * s0;
      g.lineStyle(2 * s, danger ? PALETTE.ko : 0xf2efe6, danger ? 0.55 + 0.45 * Math.sin(time / 120) : 1)
        .lineBetween(x - k, y - k, x + k, y + k).lineBetween(x + k, y - k, x - k, y + k);
    }
    this.term.setSieges(sieges);
    // cantieri (Nico: "serve un caricamento che mostri che stanno venendo costruite"): barra sotto il centro della tua
    // provincia che si riempie fino alla fine dei lavori (costruzione nuova o livello in più)
    for (const p of st.ownedProvinces(PLAYER)) {
      const job = st.workInProgress(p), up = job ? null : st.upgradeInProgress(p);
      if (!job && up === null) continue;
      const w = job ? job.work : WORKS[st.provWork[p]], left = job ? job.leftMs : up!;
      const total = job ? BALANCE.works[w].timeMs : BALANCE.works[w].timeMs * (1 + st.provLevel[p] * 0.5);
      const t = Phaser.Math.Clamp(1 - left / total, 0, 1);
      // grande quasi uguale a ogni zoom (da lontano le altre cose rimpiccioliscono fino al 30%: la barra non si vedeva)
      const k = s0 * Phaser.Math.Clamp(this.cameras.main.zoom / UI() / 6, 0.8, 1);
      const { x, y } = center(this.map.provinces[p].anchor), bw = 40 * k, bh = 6 * k, by = y + 26 * k; // sotto la vita della pedina
      const wc = Phaser.Display.Color.HexStringToColor(WORK_VIEW[w]?.col ?? '#e6d678').color;
      g.fillStyle(0x000000, 0.85).fillRect(x - bw / 2 - 2 * k, by - 2 * k, bw + 4 * k, bh + 4 * k);
      g.fillStyle(wc, 1).fillRect(x - bw / 2, by, bw * t, bh);
      // quadratino a puntini del colore della costruzione accanto alla barra (Nico: "così si capisce cos'è")
      const q = 10 * k, qx = x - bw / 2 - 4 * k - q, qy = by + bh / 2 - q / 2;
      g.fillStyle(0x000000, 0.9).fillRect(qx - k, qy - k, q + 2 * k, q + 2 * k).fillStyle(wc, 1);
      for (let Y = 0; Y < 3; Y++) for (let X = 0; X < 3; X++) g.fillRect(qx + X * q / 3 + k * 0.5, qy + Y * q / 3 + k * 0.5, q / 3 - k, q / 3 - k);
      g.lineStyle(1 * k, 0xe9ebe6, 0.7).strokeRect(x - bw / 2, by, bw, bh);
    }
    // rapporti del radar: freccia rossa dall'armata nemica alla tua provincia
    for (const a of st.alerts) {
      const A = center(a.from), B = center(a.to), dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      const pulse = 0.55 + 0.45 * Math.sin(time / 160), w = 2.5 * s0, h = 12 * s0;
      g.lineStyle(w, PALETTE.ko, pulse);
      for (let t = 0; t < L - h; t += 14 * s0) g.lineBetween(A.x + ux * t, A.y + uy * t, A.x + ux * Math.min(t + 8 * s0, L - h), A.y + uy * Math.min(t + 8 * s0, L - h));
      g.fillStyle(PALETTE.ko, pulse).fillTriangle(B.x, B.y, B.x - ux * h - uy * h * 0.6, B.y - uy * h + ux * h * 0.6, B.x - ux * h + uy * h * 0.6, B.y - uy * h - ux * h * 0.6);
    }
    // capitale di ogni impero (tua compresa): una stella (Nico: non si vedeva la capitale degli altri)
    const far = Phaser.Math.Clamp(this.cameras.main.zoom / UI() / 6, 0.45, 1);
    st.capitalProv.forEach((p, f) => {
      const fac = st.factions[f];
      if (p < 0 || !fac?.alive || fac.kind === 'bot' || st.provOwner[p] !== f) return;
      const c = center(this.map.provinces[p].anchor), x = c.x, y = c.y - 26 * s0, R = 10 * s0 * far, pts: Phaser.Types.Math.Vector2Like[] = []; // sopra la pedina
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? R * 0.45 : R;
        pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
      }
      g.fillStyle(0xf2f2f2, 1).fillPoints(pts, true).lineStyle(2 * s0 * far, 0x000000, 1).strokePoints(pts, true); // bianca: si vede su ogni colore
    });
  }

  /**
   * Pedine, navi e segnalini a grandezza costante sullo schermo (come i contatti su un radar); allontanando la carta però
   * rimpiccioliscono, se no coprono tutta la mappa (Nico): piene fino allo zoom 6, poi in proporzione, fino al 35%.
   */
  private scaleMarkers() {
    const zv = this.cameras.main.zoom / UI(), far = Phaser.Math.Clamp(zv / 6, 0.35, 1);
    const s = UI() / this.cameras.main.zoom;
    // da zoom medio un po' più grandi (Nico, 27 novembre: "leggermente più grandi"): prima scendevano fino al 35%, ora al 50%
    const farU = Phaser.Math.Clamp(zv / 4.5, 0.5, 1);
    for (const sp of this.unitSprites.values()) sp.c.setScale(s * sp.pop.k * 1.2 * farU); // pedine un po' più grandi: si toccano meglio
    for (const b of this.boatSprites.values()) b.setScale(s * 0.9 * far);
    this.flowMarker.setScale(s * this.markerPulse.k);
  }

  /**
   * Pile (Nico): da lontano le pedine dello stesso padrone nella stessa provincia sono un quadrato solo, col numero in alto a
   * destra; da vicino (o selezionate) tornano singole.
   */
  /** Da vicino le pile si aprono: ogni pedina si vede e si tocca da sola (per dividerle). */
  private pilesOpen(): boolean {
    return this.cameras.main.zoom / UI() >= 14; // pile chiuse più a lungo (Nico: "più tendenti a schiacciarsi insieme"; prima 6)
  }

  /** Stile dei numeri sulle pile, con le misure del font prese una volta sola: Phaser le rimisura per ogni testo nuovo
   *  leggendo i pixel di un canvas, e centinaia di numeri insieme bloccavano il gioco per secondi. */
  private stackMetrics: Record<string, Phaser.Types.GameObjects.Text.TextMetrics> = {};
  private stackStyle(big: boolean): Phaser.Types.GameObjects.Text.TextStyle {
    const st: Phaser.Types.GameObjects.Text.TextStyle = { fontFamily: TERM_FONT, fontSize: big ? '26px' : '11px', color: '#000000', backgroundColor: '#e9ebe6', padding: { x: big ? 4 : 2, y: 0 }, resolution: 4 };
    const k = big ? 'big' : 'small';
    if (!this.stackMetrics[k]) { const t = this.add.text(0, 0, '0', st); this.stackMetrics[k] = t.style.getTextMetrics(); t.destroy(); }
    return { ...st, metrics: this.stackMetrics[k] };
  }

  // mappe e liste riusate a ogni fotogramma (prima nuove per ~500 pedine a fotogramma: spazzatura per la memoria)
  private stackGroups = new Map<number, Unit[]>();
  private stackPool: Unit[][] = [];
  private stackShown = new Map<number, number>();
  private stackById = new Map<number, Unit>();
  private stackPush(key: number, u: Unit) {
    const g = this.stackGroups.get(key);
    if (g) g.push(u);
    else { const a = this.stackPool.pop() ?? []; a.push(u); this.stackGroups.set(key, a); }
  }
  private stackUnits() {
    const far = !this.pilesOpen(), groups = this.stackGroups;
    for (const g of groups.values()) { g.length = 0; this.stackPool.push(g); }
    groups.clear();
    // carta intera (Nico: "da lontano non ha senso"): pile per zona dello schermo, poche e col numero grande
    // solo a carta quasi intera (Nico: "a zoom medio le pedine restano come prima"): sotto 1,5 resta solo il numero
    const zv = this.cameras.main.zoom / UI(), veryFar = zv < 1.5, cs = (90 * UI()) / this.cameras.main.zoom;
    // da lontano una per provincia, col numero; da vicino nessuna pila: le pedine dello stesso centro si dispongono a
    // grappolo (Nico: "se due truppe sono assieme, è finita")
    if (far) for (const u of this.state.units) {
      const sp = this.unitSprites.get(u.id);
      if (!sp?.c.visible) continue; // anche le selezionate restano in pila (Nico: selezionando la pila cambiava numero e icona)
      const c = veryFar ? center(u.tile) : null;
      // in mare non c'è provincia: pila per casella (prima tutte le pedine in mare del mondo erano una pila sola, mostrata
      // sopra una nave a caso, e le altre non si vedevano. Nico, 28 novembre 2026: "truppe che non si renderizzano")
      const pr = this.state.provOf(u.tile);
      const zone = c ? Math.floor(c.y / cs) * 100_000 + Math.floor(c.x / cs) : pr >= 0 ? pr : -2 - u.tile;
      this.stackPush((zone * 256 + (u.owner & 255)) * 2 + (this.selection.has(u.id) ? 1 : 0), u);
    }
    // da vicino: le pedine in marcia sulla stessa casella verso la stessa meta sono un gruppo solo, una pedina col numero
    // (Nico, 27 novembre 2026: "dovrebbero fare un gruppo e seguire la linea"; aperte a ventaglio saltavano a ogni casella)
    if (!far) for (const u of this.state.units) {
      if (!u.path.length) continue;
      const sp = this.unitSprites.get(u.id);
      if (!sp?.c.visible) continue;
      this.stackPush((u.tile * 512 + (u.path[u.path.length - 1] % 512)) * 512 + (u.owner & 255) * 2 + (this.selection.has(u.id) ? 1 : 0), u);
    }
    // numero in alto a destra = reparti che la pedina rappresenta (Nico: al posto delle tacche): una pila conta i reparti di
    // tutte le sue pedine, una pedina da sola quelli uniti in lei
    const shown = this.stackShown, byId = this.stackById;
    shown.clear(); byId.clear();
    for (const u of this.state.units) { byId.set(u.id, u); if (u.size > 1 || veryFar) shown.set(u.id, u.size); }
    for (const g of groups.values()) if (g.length > 1) {
      let n = 0;
      for (const u of g) n += u.size;
      shown.set(g[0].id, n);
      for (let k = 1; k < g.length; k++) this.unitSprites.get(g[k].id)!.c.setVisible(false);
    }
    for (const [id, sp] of this.unitSprites) {
      // carta intera: niente simbolo, vita né segni, solo il numero (anche 1). Le nascoste solo quando cambia lo zoom
      if (sp.c.visible || sp.vf !== veryFar) {
        sp.vf = veryFar;
        (sp.c.getData('sym') as Phaser.GameObjects.Graphics | undefined)?.setVisible(!veryFar);
        sp.hp?.setVisible(!veryFar); sp.badge?.setVisible(!veryFar); sp.tag?.setVisible(!veryFar);
      }
      if (sp.fuel) { const u = byId.get(id); sp.fuel.setVisible(!veryFar && !!u && u.supply < BALANCE.unitOps.attritionBelow); }
      const n = shown.get(id) ?? 0, big = veryFar && n > 0;
      // il numero si fa solo per le pedine sullo schermo, e lo stesso testo si riscrive (Nico, 27 novembre 2026: blocchi di
      // secondi. Ogni numero è una texture: centinaia rifatte in un colpo, anche per pedine dall'altra parte del mondo)
      if (!sp.c.visible || n === (sp.stackN ?? 0) && big === !!sp.stackBig && (!sp.stackTag || sp.stackTag.getData('big') === big)) continue;
      sp.stackN = n;
      sp.stackBig = big;
      if (n > 1 || big) {
        // carta intera: il numero al posto della pedina, grande per restare leggibile. La grandezza si legge dal testo stesso
        // (Nico, 27 novembre 2026: a volte restava il numero grande al posto della pedina anche da vicino)
        if (!sp.stackTag) {
          sp.stackTag = this.add.text(big ? 0 : 15, big ? 0 : -12, String(n), this.stackStyle(big)).setOrigin(0.5).setData('big', big);
          sp.c.add(sp.stackTag);
        } else if (sp.stackTag.getData('big') !== big) sp.stackTag.setPosition(big ? 0 : 15, big ? 0 : -12).setStyle(this.stackStyle(big)).setData('big', big);
        if (sp.stackTag.text !== String(n)) sp.stackTag.setText(String(n));
        sp.stackTag.setVisible(true);
      } else sp.stackTag?.setVisible(false);
    }
  }

  /** Allinea gli sprite delle pedine allo stato (creazione, movimento, vita). */
  private syncAlive = new Set<number>();
  private syncFan = new Map<number, { k: number; n: number }>();
  private syncUnits() {
    const alive = this.syncAlive;
    alive.clear();
    // pile aperte da vicino: posto di ogni pedina nel grappolo attorno al centro (stesso padrone, stessa casella)
    const fan = this.syncFan;
    fan.clear();
    if (this.pilesOpen()) {
      const byTile = new Map<number, Unit[]>();
      for (const u of this.state.units) {
        if (u.path.length) continue; // in marcia: niente ventaglio (rifatto a ogni casella faceva saltare le pedine, Nico)
        const key = u.tile * 256 + (u.owner & 255), g = byTile.get(key);
        if (g) g.push(u); else byTile.set(key, [u]);
      }
      for (const g of byTile.values()) if (g.length > 1) g.sort((p, q) => p.id - q.id).forEach((u, k) => fan.set(u.id, { k, n: g.length }));
    }
    const gapW = 40 * UI() / this.cameras.main.zoom;
    // fuori dallo schermo (con un margine) o nascoste: niente conti a ogni fotogramma (Nico, 27 novembre 2026: "molto più
    // efficiente"; prima tutte le 600 pedine del mondo, anche dall'altra parte della carta). Tornano al posto giusto di colpo
    const v = this.cameras.main.worldView, mg = (80 * UI()) / this.cameras.main.zoom;
    const x0 = v.x - mg, x1 = v.right + mg, y0 = v.y - mg, y1 = v.bottom + mg;
    for (const u of this.state.units) {
      alive.add(u.id);
      let sp = this.unitSprites.get(u.id);
      if (!sp) this.unitSprites.set(u.id, (sp = this.makeUnitSprite(u)));
      const c0 = center(u.tile);
      const vis = c0.x >= x0 && c0.x <= x1 && c0.y >= y0 && c0.y <= y1 && this.state.seesUnit(u); // pedine nemiche: nascoste nella nebbia
      sp.c.setVisible(vis);
      if (!vis) { sp.culled = true; sp.tile = u.tile; continue; }
      if (sp.culled) { sp.culled = false; sp.legTo = undefined; sp.walked = 0; sp.pathRef = undefined; sp.c.setPosition(c0.x, c0.y); }
      sp.c.setAlpha(this.buildWork || this.buildPeek ? 0.3 : 1); // COSTRUISCI: pedine in trasparenza, si leggono costruzioni e rese
      // scivola fra la sua casella e la prossima man mano che il passo matura nel motore (niente scatti né tween che si
      // rincorrono): la posizione sullo schermo è sempre quella vera
      const moved = sp.tile !== u.tile;
      sp.tile = u.tile;
      // selezionata: la pedina in negativo (colori scambiati), niente mirino sopra
      const neg = this.selection.has(u.id), sea = !isNaval(u.type) && !this.map.tiles[u.tile]; // in mare: imbarcata
      if (neg !== !!sp.neg || sea !== !!sp.sea) {
        sp.neg = neg;
        sp.sea = sea;
        const sym = (sp.c.getData('sym') as Phaser.GameObjects.Graphics).clear(), mine = u.owner === PLAYER, col = mine ? MAP_INK : FACTION_INFO[u.owner].fill;
        if (neg) drawUnitSymbol(sym, u.type, mine, PALETTE.inchiostro, col, sea);
        else drawUnitSymbol(sym, u.type, mine, col, undefined, sea);
      }
      const a = center(u.tile), k = this.state.stepProgress(u);
      let tx = a.x, ty = a.y;
      if (k > 0) {
        const b = center(u.path[0]);
        tx += (b.x - a.x) * k;
        ty += (b.y - a.y) * k;
      }
      // sulla strada della rete, a passo uniforme (Nico: "a scatti, spastiche"): il motore va di casella in casella e i passi
      // sulle caselle esagonali lungo una linea storta sono ora lunghi ora corti, la pedina accelerava e frenava. Sullo
      // schermo scorre dritta dal centro di partenza a quello d'arrivo, alla stessa velocità: avanzamento = caselle fatte
      // (più la frazione del passo in corso) sul totale del tratto
      if (!isNaval(u.type)) {
        const P = this.map.provinces, isStop = (i: number) => P[this.state.provOf(i)]?.anchor === i;
        // prossimo centro sulla strada: cercato solo quando la strada cambia (il motore toglie un passo alla volta dalla testa)
        let ni: number;
        const gone = sp.pathRef === u.path ? (sp.pathLen ?? 0) - u.path.length : -1;
        if (gone >= 0 && (sp.ni ?? -1) - gone >= 0) ni = sp.ni! - gone;
        else ni = u.path.findIndex(isStop);
        sp.pathRef = u.path; sp.pathLen = u.path.length; sp.ni = ni;
        const next = ni >= 0 ? u.path[ni] : u.path[u.path.length - 1];
        if (next === undefined) { sp.legTo = undefined; sp.walked = 0; }
        else {
          if (next !== sp.legTo) {
            // tratto nuovo: parte dal centro dove sta, o da dove la si vede (ordine cambiato a metà strada)
            sp.legTo = next;
            sp.legA = isStop(u.tile) ? center(u.tile) : { x: sp.c.x, y: sp.c.y };
            sp.walked = 0;
          } else if (moved) sp.walked = (sp.walked ?? 0) + 1;
          const left = ni >= 0 ? ni + 1 : u.path.length, done = (sp.walked ?? 0) + k;
          const A = sp.legA!, B = center(next), t = Math.min(1, done / ((sp.walked ?? 0) + left));
          tx = A.x + (B.x - A.x) * t;
          ty = A.y + (B.y - A.y) * t;
        }
      }
      const f = fan.get(u.id);
      if (f) {
        const cols = Math.ceil(Math.sqrt(f.n)), rows = Math.ceil(f.n / cols);
        tx += ((f.k % cols) - (cols - 1) / 2) * gapW;
        ty += (Math.floor(f.k / cols) - (rows - 1) / 2) * gapW * 0.8;
      }
      // un filo di inseguimento: un cambio d'ordine o una sosta diventano una curva, mai un salto
      if (Math.abs(sp.c.x - tx) + Math.abs(sp.c.y - ty) > 0.01) sp.c.setPosition(sp.c.x + (tx - sp.c.x) * 0.35, sp.c.y + (ty - sp.c.y) * 0.35);
      const hpPct = Math.round((u.hp / u.maxHp) * 10);
      if (hpPct !== sp.hpShown) {
        sp.hpShown = hpPct;
        drawUnitHp(sp.hp, hpPct / 10, u.owner === PLAYER);
      }
      // segni sulla pedina: reparti uniti (tacche), attacca da sola (freccia), fronte assegnato, senza rifornimento (rosso)
      const low = u.supply < BALANCE.unitOps.attritionBelow;
      const grp = u.owner === PLAYER ? this.groupOf(u.id) : 0;
      const lc = u.owner === PLAYER && !neg ? this.lineColorOf(u.id) : -1; // selezionata è già in negativo: niente cornice della linea
      // impronta in un numero (prima una stringa nuova per pedina a ogni fotogramma)
      const key = ((((u.size * 2 + (u.owner === PLAYER && u.stance === 'attacca' ? 1 : 0)) * 2 + (u.owner === PLAYER && u.front >= 0 ? 1 : 0)) * 2 + (low ? 1 : 0)) * 16 + (grp & 15)) * 0x2000000 + (lc + 1);
      if (key !== sp.badgeKey) {
        sp.badgeKey = key;
        const b = sp.badge.clear(), mine = u.owner === PLAYER, top = mine ? -14 : -19;
        if (lc >= 0) b.lineStyle(2.5, lc, 1).strokeRect(-17, -13, 34, 26); // il colore della sua linea
        b.fillStyle(MAP_INK, 1);
        // reparti uniti: col numero in alto a destra (stackUnits); freccia e angolino degli ordini tolti (Nico)
        void top;
        // senza rifornimento: tanica rossa accanto alla pedina (Nico: al posto del quadratino rosso)
        if (low && !sp.fuel) { sp.fuel = this.add.image(-24, 0, 'ic-res-benzina').setDisplaySize(12, 12).setTint(PALETTE.ko); sp.c.add(sp.fuel); }
        sp.fuel?.setVisible(low);
        // gruppo (armata): numero romano in un riquadrino nero sotto la pedina
        sp.tag?.destroy();
        sp.tag = undefined;
        if (grp) {
          sp.tag = this.add.text(0, 17, ROMAN_N[grp], { fontFamily: TERM_FONT, fontSize: '10px', color: '#f2f2f2', backgroundColor: '#000000', padding: { x: 2, y: 0 }, resolution: 4 }).setOrigin(0.5, 0);
          sp.c.add(sp.tag);
        }
      }
    }
    this.stackUnits();
    for (const [id, sp] of this.unitSprites) {
      if (alive.has(id)) continue;
      sp.c.destroy();
      this.unitSprites.delete(id);
    }
    let lost = false;
    for (const id of this.selection) if (!alive.has(id)) { this.selection.delete(id); lost = true; }
    if (lost) this.applySelection();

    // percorsi delle nostre pedine + anello di selezione
    const g = this.pathGfx.clear(), px = UI() / this.cameras.main.zoom, marked = new Set<number>(); // un punto sullo schermo, in pixel-mondo
    const routes = new Set<string>(); // strade già disegnate: una linea sola per tutte le pedine che la fanno
    for (const u of this.state.unitsOf(PLAYER)) {
      if (!u.path.length) continue;
      const sel = this.selection.has(u.id);
      const sp = this.unitSprites.get(u.id);
      // sulla rete: dal centro da cui è partita per questo tratto, non dalla pedina (da vicino è spostata di lato e la linea
      // non stava sulla strada, Nico)
      // punti e impronta della strada rifatti solo quando la strada cambia (prima a ogni fotogramma per ogni pedina in marcia)
      let pts: { x: number; y: number }[], rk: string;
      if (!isNaval(u.type) && sp && sp.rPath === u.path && sp.rLen === u.path.length && sp.rFrom === sp.legA && sp.rSel === sel && sp.rPts && sp.rKey) { pts = sp.rPts; rk = sp.rKey; }
      else {
        pts = isNaval(u.type) ? [sp ? { x: sp.c.x, y: sp.c.y } : center(u.tile), ...u.path.map(center)] : this.netPts(u, u.path, sp?.legA);
        rk = `${sel ? 1 : 0}|${pts.map((q) => `${Math.round(q.x)},${Math.round(q.y)}`).join(';')}`;
        if (sp?.legA && !isNaval(u.type)) { sp.rPath = u.path; sp.rLen = u.path.length; sp.rFrom = sp.legA; sp.rSel = sel; sp.rPts = pts; sp.rKey = rk; }
      }
      if (routes.has(rk)) continue;
      routes.add(rk);
      const chasing = (u.chase ?? -1) >= 0;
      this.corridor(g, pts, chasing ? PALETTE.ko : MAP_SEL, sel); // corridoio fino alla meta, alla Call of War; rosso se insegue
      // meta ben visibile (Nico): la provincia d'arrivo velata e contornata, più forte per le pedine scelte
      const dest = this.state.provOf(u.path[u.path.length - 1]);
      if (dest >= 0 && !marked.has(dest)) { marked.add(dest); this.fillProvince(g, dest, chasing ? PALETTE.ko : MAP_SEL, sel ? 0.28 : 0.14, sel ? 2 * px : 1.2 * px); }
    }
    this.drawRanges(g, px);
  }

  /** Province a tiro (Nico, 27 novembre 2026: artiglieria e navi): per le pedine selezionate che sparano da lontano, le
   *  province che toccano con la gittata, in rosso. Niente esagoni (Nico: "mai più un esagono nel mio gioco"). */
  private drawRanges(g: Phaser.GameObjects.Graphics, px: number) {
    const st = this.state, provs = new Set<number>();
    for (const id of this.selection) {
      const u = st.units.find((v) => v.id === id);
      if (!u || BALANCE.units[u.type].range <= 1) continue;
      let ring = [u.tile];
      const seen = new Set(ring);
      for (let k = 0; k < BALANCE.units[u.type].range; k++) {
        const next: number[] = [];
        for (const t of ring) for (const n of neighbors(t)) if (n >= 0 && !seen.has(n)) { seen.add(n); next.push(n); }
        ring = next;
      }
      for (const t of seen) { const p = st.provOf(t); if (p >= 0 && st.provOwner[p] !== PLAYER) provs.add(p); }
    }
    for (const p of provs) this.fillProvince(g, p, PALETTE.ko, 0.22, 1.5 * px);
  }

  // ---------- nebbia e navi ----------

  /** Nebbia in una texture a mezza risoluzione (bordi morbidi, costa poco): si ridisegna solo quando la vista cambia. */
  /** Nebbia: una texture con un pixel per casella (alpha = mai visto / esplorato / in vista), ingrandita e sfumata. */
  /** Zona in vista (Nico): fuori, caselle nere al 50% sopra la carta; dentro niente velo. Il filtro della carta le fa a puntini.
   *  Si aggiornano solo le province che entrano o escono dalla zona (tutta la carta costava 17 ms: un fotogramma saltato). */
  private sightImg?: ImageData;
  private sightPrev?: Uint8Array;
  private seaOf?: number[][]; // per provincia: il mare vicino alla sua costa (entro 8 caselle), chiaro se lei è in vista
  private seaProv?: Int32Array; // per casella di mare: la provincia della costa a cui appartiene (−1 se mare aperto)
  private seaLitShown: number[] = []; // mare acceso dalle navi nell'ultimo disegno
  private redrawSight(time: number) {
    const st = this.state, tex = this.fogTex;
    this.sightShown = st.sightVersion;
    this.sightAt = time;
    this.ownedDirty = true; // pedine e assalti nemici compaiono o spariscono
    if (!tex) return;
    const ctx = tex.getContext(), { cols, rows } = BALANCE.map, n = cols * rows, tp = this.map.tiles, P = this.map.provinces;
    const a = Math.round(BALANCE.sight.shadeAlpha * 255);
    if (!this.seaOf) {
      // mare più vicino a ogni provincia costiera, una volta per partita
      const owner = new Int32Array(n).fill(-1), q: number[] = [];
      for (let i = 0; i < n; i++) {
        const t = tp[i];
        if (!t) continue;
        for (const m of neighbors(i)) if (m >= 0 && !tp[m] && owner[m] < 0) { owner[m] = t.province; q.push(m); }
      }
      for (let h = 0, r = 0, end = q.length; h < q.length && r < 7; h++) {
        if (h === end) { r++; end = q.length; }
        for (const m of neighbors(q[h])) if (m >= 0 && !tp[m] && owner[m] < 0) { owner[m] = owner[q[h]]; q.push(m); }
      }
      this.seaOf = P.map(() => []);
      for (let i = 0; i < n; i++) if (owner[i] >= 0) this.seaOf[owner[i]].push(i);
      this.seaProv = owner;
    }
    const sea = this.seaOf;
    if (!this.sightImg || !this.sightPrev) {
      this.sightImg = ctx.createImageData(cols, rows);
      const d = this.sightImg.data;
      for (let i = 0; i < n; i++) d[i * 4 + 3] = a; // tutto velato, poi si aprono le province in vista
      this.sightPrev = new Uint8Array(P.length);
    }
    const d = this.sightImg.data, prev = this.sightPrev;
    for (let p = 0; p < P.length; p++) {
      const on = st.sight[p] === 1 ? 1 : 0;
      if (on === prev[p]) continue;
      prev[p] = on;
      const v = on ? 0 : a;
      for (const i of P[p].tiles) d[i * 4 + 3] = v;
      for (const i of sea[p]) d[i * 4 + 3] = v;
    }
    // mare attorno alle tue navi: chiaro come la zona in vista; quello lasciato torna velato (se la sua costa non è in vista)
    const sp = this.seaProv!;
    for (const i of this.seaLitShown) { const o = sp[i]; d[i * 4 + 3] = o >= 0 && st.sight[o] === 1 ? 0 : a; }
    for (const i of st.seaLit) d[i * 4 + 3] = 0;
    this.seaLitShown = [...st.seaLit];
    ctx.putImageData(this.sightImg, 0, 0);
    tex.refresh();
  }

  private makeFog(on: boolean) {
    const { cols, rows } = BALANCE.map, key = 'fog';
    if (this.textures.exists(key)) this.textures.remove(key);
    this.fogTex = this.textures.createCanvas(key, cols, rows);
    const fog = this.add.image(0, 0.25 * S, key).setOrigin(0).setScale(HEX_W, 1.5 * S).setDepth(D.fog).setVisible(on);
    // sopra i territori della carta, sotto i segni e la trama delle fessure: diventa a puntini come la carta (il vecchio strato
    // della mappa è spento, lì dentro non si vedeva)
    fog.setDepth(this.term.gridDepth - 0.003);
    // nuvole: rumore morbido a due scale, fisso per la partita
    const hash = (x: number, y: number) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
    const vnoise = (x: number, y: number, c: number) => {
      const gx = x / c, gy = y / c, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = hash(ix, iy), b = hash(ix + 1, iy), d = hash(ix, iy + 1), e = hash(ix + 1, iy + 1);
      return a + (b - a) * sx + (d - a) * sy + (a - b - d + e) * sx * sy;
    };
    this.fogNoise = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) this.fogNoise[r * cols + c] = 0.65 * vnoise(c, r, 14) + 0.35 * vnoise(c + 99, r, 5);
  }

  private redrawFog() {
    const st = this.state, F = BALANCE.fog;
    this.fogVersion = st.fogVersion;
    this.ownedDirty = true; // i nemici compaiono/spariscono con la vista
    for (const l of this.nationLabels) l.known = !!st.seen[l.tile];
    const tex = this.fogTex;
    if (!F.shade || !tex) return;
    const ctx = tex.getContext(), { cols, rows } = BALANCE.map, n = cols * rows;
    // opacità di base per casella, poi sfocata (due passate di media mobile): il bordo della nebbia sfuma su più caselle
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = st.visible[i] ? 0 : st.seen[i] ? F.seenAlpha : F.unseenAlpha;
    const R = F.blur, tmp = new Float32Array(n);
    for (let pass = 0; pass < 2; pass++) {
      for (let r = 0; r < rows; r++) { // orizzontale
        let sum = 0;
        const row = r * cols;
        for (let c = -R; c <= R; c++) sum += a[row + Math.min(cols - 1, Math.max(0, c))];
        for (let c = 0; c < cols; c++) {
          tmp[row + c] = sum / (2 * R + 1);
          sum += a[row + Math.min(cols - 1, c + R + 1)] - a[row + Math.max(0, c - R)];
        }
      }
      for (let c = 0; c < cols; c++) { // verticale
        let sum = 0;
        for (let r = -R; r <= R; r++) sum += tmp[Math.min(rows - 1, Math.max(0, r)) * cols + c];
        for (let r = 0; r < rows; r++) {
          a[r * cols + c] = sum / (2 * R + 1);
          sum += tmp[Math.min(rows - 1, r + R + 1) * cols + c] - tmp[Math.max(0, r - R) * cols + c];
        }
      }
    }
    const img = ctx.createImageData(cols, rows), d = img.data;
    const cr = (F.color >> 16) & 255, cg = (F.color >> 8) & 255, cb = F.color & 255;
    for (let i = 0; i < n; i++) {
      if (a[i] < 0.01) continue;
      const nz = this.fogNoise[i], k = i * 4, lift = Math.round(nz * 16 * a[i]); // nuvole appena più chiare dove è fitta
      d[k] = cr + lift; d[k + 1] = cg + lift; d[k + 2] = cb + lift;
      d[k + 3] = Math.min(255, Math.round(a[i] * (0.88 + 0.24 * nz) * 255));
    }
    ctx.putImageData(img, 0, 0);
    tex.refresh();
  }

  private makeBoat(b: Boat) {
    const f = FACTION_INFO[b.owner];
    const g = this.add.graphics();
    g.fillStyle(f.fill, 1).fillPoints([{ x: -9, y: -2 }, { x: 9, y: -2 }, { x: 6, y: 4 }, { x: -6, y: 4 }], true);
    g.lineStyle(1.4, MAP_INK, 1).strokePoints([{ x: -9, y: -2 }, { x: 9, y: -2 }, { x: 6, y: 4 }, { x: -6, y: 4 }], true);
    g.fillStyle(MAP_INK, 1).fillRect(-3, -7, 6, 5); // cabina
    const lbl = this.add.text(0, -14, String(b.troops), textStyle(9, MAP_INK)).setOrigin(0.5).setResolution(3);
    const { x, y } = center(b.from);
    const c = this.add.container(x, y, [g, lbl]).setDepth(D.units); // grandezza costante: vedi scaleMarkers
    this.tweens.add({ targets: g, y: 1.2, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }); // rollio
    return c;
  }

  /** Allinea gli sprite delle navi: scivolano di casella in casella lasciando una scia. */
  private syncBoats() {
    const live = new Set<number>();
    for (const b of this.state.boats) {
      live.add(b.id);
      let sp = this.boatSprites.get(b.id);
      if (!sp) this.boatSprites.set(b.id, (sp = this.makeBoat(b)));
      const { x, y } = center(b.path[Math.min(b.pos, b.path.length - 1)]);
      if (sp.getData('pos') !== b.pos) {
        sp.setData('pos', b.pos);
        this.tweens.add({ targets: sp, x, y, duration: BALANCE.boats.stepMs / this.state.speed, ease: 'Linear' });
        const wake = this.add.rectangle(sp.x, sp.y + 3, 4, 4, MAP_INK, 0.5).setDepth(7);
        this.tweens.add({ targets: wake, scale: 2.2, alpha: 0, duration: 700, onComplete: () => wake.destroy() });
      }
    }
    for (const [id, sp] of this.boatSprites) {
      if (live.has(id)) continue;
      sp.destroy();
      this.boatSprites.delete(id);
    }
  }

  private boatLandFx(b: Boat, phase: 'landed' | 'lost') {
    const { x, y } = center(b.path[b.path.length - 1]);
    if (phase === 'landed') {
      this.conquestFx(x, y, 0, 0);
      this.floatText(x, y - 8, 'landing!', MAP_INK);
    } else {
      this.failFx(x, y, 'landing repelled');
      buzz([20, 40, 20]);
    }
  }

  /** Scontro tra pedine: traccia del colpo, scintille sul bersaglio, sobbalzo e danno che sale. */
  private hitFx(from: number, to: number, fromTile: number, toTile: number, dmg: number, owner: number, unitById: (id: number) => Unit | undefined) {
    // pedine nascoste (nebbia o spionaggio): niente traccia che ne riveli la posizione
    const shooter = unitById(from), target = unitById(to);
    if (!(shooter && this.state.seesUnit(shooter)) || !(target && this.state.seesUnit(target))) return;
    void fromTile;
    const a = this.unitSprites.get(from), b = this.unitSprites.get(to);
    const p0 = a ? { x: a.c.x, y: a.c.y } : center(fromTile), p1 = b ? { x: b.c.x, y: b.c.y } : center(toTile);
    const s = UI() / this.cameras.main.zoom, col = owner === PLAYER ? MAP_SEL : FACTION_INFO[owner]?.fill ?? PALETTE.ko;
    const g = this.add.graphics().setDepth(D.fx);
    // traccia del colpo a quadratini (come la carta), vampa quadrata alla partenza
    const L = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1, z = 2.4 * s;
    for (let t = 0; t <= L; t += 5 * s) {
      const x = p0.x + ((p1.x - p0.x) * t) / L, y = p0.y + ((p1.y - p0.y) * t) / L;
      g.fillStyle(0x000000, 0.5).fillRect(x - z / 2 - s, y - z / 2 - s, z + 2 * s, z + 2 * s).fillStyle(col, 0.95).fillRect(x - z / 2, y - z / 2, z, z);
    }
    g.fillStyle(0xfff3c4, 1).fillRect(p0.x - 3 * s, p0.y - 3 * s, 6 * s, 6 * s); // vampa alla partenza
    this.tweens.add({ targets: g, alpha: 0, duration: 220, onComplete: () => g.destroy() });
    this.burstAt(p1.x, p1.y, 4, 0xffd9a0);
    if (b) {
      b.pop.k = 1.08; // colpo incassato: un sussulto, non un salto
      this.tweens.add({ targets: b.pop, k: 1, duration: 240, ease: 'Sine.easeOut' });
    }
    const mineHit = target.owner === PLAYER;
    if (owner === PLAYER || mineHit) this.floatText(p1.x, p1.y - 8 * s, `−${Math.round(dmg)}`, mineHit ? PALETTE.ko : 0xffe2a8);
  }

  private unitDeathFx(u: Unit) {
    const sp = this.unitSprites.get(u.id);
    const { x, y } = sp ? { x: sp.c.x, y: sp.c.y } : center(u.tile);
    this.burstAt(x, y, 22, FACTION_INFO[u.owner].fill);
    this.burstAt(x, y, 10, 0xffd9a0);
    if (u.owner === PLAYER) {
      this.floatText(x, y - 6, `${unitInfo(u.type).short} down`, PALETTE.ko);
      sfx('death', 1, false); // (Nico) niente scossa né vibrazione a ogni morte
    } else if (this.state.seesUnit(u)) {
      this.floatText(x, y - 6, `${unitInfo(u.type).short} destroyed`, MAP_SEL);
      sfx('death', 0.7, false);
    }
  }

  /** Colpo sulla carta a misura di schermo: un'onda sottile che si apre e un nucleo che si spegne (Nico, 28 novembre 2026:
   *  i coriandoli di puntini sembravano fatti in fretta). `n` dà la forza: 4 un colpo, 10 un evento, 20+ una distruzione. */
  private burstAt(x: number, y: number, n: number, tint: number) {
    const s = UI() / this.cameras.main.zoom, R = (10 + Math.min(n, 30) * 1.1) * s;
    const g = this.add.graphics({ x, y }).setDepth(D.fx + 1), st = { t: 0 };
    this.tweens.add({
      targets: st, t: 1, duration: 380 + n * 12, ease: 'Cubic.easeOut',
      onUpdate: () => {
        const t = st.t;
        g.clear();
        g.lineStyle(1.4 * s, tint, (1 - t) * 0.9).strokeCircle(0, 0, R * (0.25 + 0.75 * t));
        if (n >= 10) g.lineStyle(0.8 * s, tint, (1 - t) * 0.5).strokeCircle(0, 0, R * 0.6 * (0.25 + 0.75 * t));
        g.fillStyle(tint, Math.max(0, 0.55 - t * 1.4)).fillCircle(0, 0, R * 0.18 * (1 - t * 0.5));
      },
      onComplete: () => g.destroy(),
    });
  }

  /** Provincia appena presa (avanzata, pittura, pedine): lampo leggero sulla sagoma. */
  private popFx(p: number) {
    this.flashProvince(p, 0xffffff, 0.8, 800); // più forte e più lungo (Nico: "la conquista non si vede bene")
  }

  /** Una nostra provincia è caduta: lampo rosso. */
  private lostFx(p: number, by: number) {
    this.flashProvince(p, PALETTE.ko, 0.7, 600); // (Nico) niente scossa a ogni provincia persa
    void by;
  }

  private failFx(x: number, y: number, msg: string) {
    this.hud.floatAt(x, y - 4, msg, PALETTE.ko); // resta solo il perché di un tuo comando che non parte
    sfx('error');
  }

  /** Scritte che salivano dalla mappa (+truppe, provincia presa, ordini): tolte (Nico, 26 novembre 2026: "non se le guarda
   *  nessuno"). La chiamata resta per non toccare i punti che la usano. */
  private floatText(_x: number, _y: number, _msg: string, _color: number, _delay = 0) {
    // niente
  }

  // ---------- camera & input ----------

  /** Usata da run/CameraControl.ts dopo uno zoom: le etichette del fronte si ridisegnano subito. */
  resetLabelTimer(): void {
    this.labelTimer = 0;
  }

  /** Centra la telecamera su una casella (per future schermate: "vai a..."). Nessun cambio di zoom. */
  centerOn(tile: number): void {
    const { x, y } = center(tile);
    this.cameras.main.centerOn(x, y);
  }

  /**
   * Evidenzia un insieme di caselle con uno stile (placeholder: non disegna ancora nulla).
   * Implementazione vera in arrivo con gli strati vettoriali (R0b); la firma esiste già per C2/C3.
   */
  highlight(tiles: number[], style: string): void {
    void tiles; void style;
  }

  /** Coordinate schermo → casella (−1 se fuori). */
  private tileAt(sx: number, sy: number): number {
    const cam = this.cameras.main;
    const w = cam.width / 2, h = cam.height / 2;
    const x = cam.scrollX + w + (sx - w) / cam.zoom, y = cam.scrollY + h + (sy - h) / cam.zoom;
    const i = pixelToIndex(x, y);
    if (i < 0) return i;
    // la griglia è solo approssimata: decide la sagoma vera della provincia toccata
    const near = [i, ...neighbors(i).filter((n) => n >= 0)];
    const cand = [...new Set(near.map((n) => this.state.provOf(n)).filter((p) => p >= 0))];
    const p = provinceAtPoint(this.shapes, cand, x, y);
    if (p < 0 || this.state.provOf(i) === p) return i;
    return near.filter((n) => this.state.provOf(n) === p)
      .reduce((a, b) => (Math.hypot(center(b).x - x, center(b).y - y) < Math.hypot(center(a).x - x, center(a).y - y) ? b : a));
  }

  /** Scheda di chi possiede la casella: la tua provincia, oppure il profilo di un impero o di una milizia. */
  private openOwnerCard(i: number) {
    const p = this.state.provOf(i);
    if (p < 0) return;
    const o = this.state.provOwner[p];
    if (o === PLAYER) this.hud.showProvince(p);
    else if (o !== NEUTRAL && (this.state.sees(i) || this.state.relation[o] !== 'guerra')) this.hud.showProfile(o);
    else return;
    buzz(12);
  }

  /** Casella → coordinate schermo in punti CSS (per frecce e guida nell'HUD). */
  tileToScreen(i: number): { x: number; y: number } {
    const cam = this.cameras.main;
    const w = cam.width / 2, h = cam.height / 2;
    const c = center(i);
    return { x: ((c.x - cam.scrollX - w) * cam.zoom + w) / UI(), y: ((c.y - cam.scrollY - h) * cam.zoom + h) / UI() };
  }

  /**
   * Un dito: tocco = attacco / avanzata / pedine; trascinamento che parte dal tuo territorio = dipingi la frontiera,
   * altrove = sposta la mappa. Due dita: zoom e spostamento.
   */
  private setupInput() {
    this.input.mouse?.disableContextMenu(); // clic destro = ordine alle pedine selezionate
    // tastiera: gruppi (Ctrl/Maiusc + numero), comandi delle pedine, muro
    const kb = this.input.keyboard;
    kb?.on('keydown', (e: KeyboardEvent) => this.groupKey(e));
    kb?.on('keydown-ESC', () => { // annulla: schieramento, linea, nazione da attaccare
      const picking = !!this.selectedCard || this.wallMode || this.frontPick || this.linePick || this.zonePick;
      if (this.zonePick) { this.zonePick = false; this.zoning = false; this.zoneProvs.clear(); this.hud.setHint(null); this.drawAttackLines(); }
      this.endDeploy();
      if (this.wallMode) this.setBuildMode(null);
      if (this.frontPick || this.linePick) { this.frontPick = false; this.linePick = false; this.nationAttack = false; this.syncNations(); this.hud.setHint(null); }
      if (!picking && this.selection.size) this.selectUnit(null); // niente da annullare: ESC toglie la selezione
    });
    kb?.on('keydown-G', () => this.unitAction('line'));
    kb?.on('keydown-O', () => this.unitAction('zone'));
    kb?.on('keydown-N', () => this.unitAction('nation'));
    kb?.on('keydown-B', () => this.hud.toggleBuildMenu());
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.hud.hitUi(p.x / UI(), p.y / UI())) return;
      if (this.activePointers().length === 1) {
        // tenere premuto apre la scheda di chi possiede la provincia (impero, milizia o la tua)
        this.pressTimer?.remove();
        this.longPressed = false;
        this.pressTimer = this.time.delayedCall(450, () => {
          if (!this.down || this.dragging || this.activePointers().length !== 1) return;
          this.longPressed = true;
          // carta di un reparto scelta: tenendo premuto su una tua città le pedine escono a raffica (Nico), finché tieni o
          // finiscono le truppe (allora la carta si chiude da sola)
          if (this.selectedCard) {
            const at = this.tileAt(p.x, p.y), before = this.state.troops;
            this.tapTile(at);
            if (this.state.troops === before) return; // non è una tua città (o niente truppe): niente raffica di errori
            this.deployRepeat = this.time.addEvent({ delay: 110, loop: true, callback: () => {
              const t0 = this.state.troops;
              if (this.selectedCard && this.down && !this.dragging) this.tapTile(at);
              if (!this.selectedCard || !this.down || this.dragging || this.state.troops === t0) { this.deployRepeat?.remove(); this.deployRepeat = null; }
            } });
            return;
          }
          this.openOwnerCard(this.tileAt(p.x, p.y));
        });
        this.down = { x: p.x, y: p.y };
        this.last = { x: p.x, y: p.y };
        this.dragging = false;
        this.lastPainted = -1;
        this.dragMode = 'pan'; // trascinare sposta la carta: niente territorio dipinto col dito
        // mouse come in HOI4: trascinare col sinistro = riquadro di selezione delle pedine; col destro (o WASD) si sposta la carta.
        // Sul telefono trascinare sposta la carta.
        this.box = !p.wasTouch && p.leftButtonDown() && !this.selectedCard && !this.selectedAbility && !this.wallMode && !this.linePick && !this.arrowPick && !this.zonePick ? { x0: p.x, y0: p.y, x1: p.x, y1: p.y } : null;
        // regioni: col dito o col sinistro si dipingono le province (col destro si sposta ancora la carta)
        this.zoning = this.zonePick && (p.wasTouch || p.leftButtonDown());
        if (this.zoning) this.zoneAlong(p.x, p.y);
        // muro: col dito o col sinistro si trascina sulle province da fortificare (col destro si sposta ancora la carta)
        this.walling = this.wallMode && (p.wasTouch || p.leftButtonDown());
        if (this.walling) this.wallAlong(p.x, p.y, p.x, p.y);
        // linea d'attacco: col dito o col sinistro si traccia (col destro si sposta ancora la carta)
        this.lining = this.linePick && (p.wasTouch || p.leftButtonDown());
        if (this.lining) { this.linePts = []; this.lineAlong(p.x, p.y); }
        // offensiva: stessa cosa, ma si traccia una freccia
        this.arrowing = this.arrowPick && (p.wasTouch || p.leftButtonDown());
        if (this.arrowing) { this.arrowPts = []; this.arrowAlong(p.x, p.y); }
      }
      this.pinchDist = 0;
      this.lastMid = null;
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const pts = this.activePointers();
      const cam = this.cameras.main;
      if (pts.length >= 2) {
        const [a, b] = pts;
        const d = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (this.pinchDist > 0) zoomAt(this, mid.x, mid.y, cam.zoom * (d / this.pinchDist));
        if (this.lastMid) {
          cam.scrollX -= (mid.x - this.lastMid.x) / cam.zoom;
          cam.scrollY -= (mid.y - this.lastMid.y) / cam.zoom;
        }
        this.pinchDist = d;
        this.lastMid = mid;
        this.dragging = true;
        return;
      }
      if (!p.isDown) this.hoverTile = p.wasTouch || this.hud.hitUi(p.x / UI(), p.y / UI(), true) ? -1 : this.tileAt(p.x, p.y);
      if (!this.down || !p.isDown) return;
      if (!this.dragging && Phaser.Math.Distance.Between(p.x, p.y, this.down.x, this.down.y) > CAM.dragThreshold * DPR) {
        this.dragging = true;
        this.pressTimer?.remove();
        this.deployRepeat?.remove();
        this.deployRepeat = null;
      }
      if (this.dragging) {
        // COSTRUISCI: col mouse il sinistro trascinato costruisce su più province (Nico, 26 novembre 2026: "non si può più
        // trascinare"); la carta si sposta col destro o WASD. Col dito trascinare sposta la carta (Maiusc non c'è)
        if (this.walling && p.wasTouch && !(p.event as MouseEvent | undefined)?.shiftKey) {
          this.walling = false;
          this.wallProvs = [];
          this.wallGfx.clear();
        }
        if (this.walling) {
          this.wallAlong(this.last.x, this.last.y, p.x, p.y);
        } else if (this.lining) {
          this.lineAlong(p.x, p.y);
        } else if (this.arrowing) {
          this.arrowAlong(p.x, p.y);
        } else if (this.zoning) {
          this.zoneAlong(p.x, p.y);
        } else if (this.box) {
          this.box.x1 = p.x;
          this.box.y1 = p.y;
          this.drawBox();
        } else if (this.dragMode === 'paint') {
          this.paintAlong(this.last.x, this.last.y, p.x, p.y);
        } else {
          cam.scrollX -= (p.x - this.last.x) / cam.zoom;
          cam.scrollY -= (p.y - this.last.y) / cam.zoom;
          this.labelTimer = Math.min(this.labelTimer, 60);
        }
      }
      this.last = { x: p.x, y: p.y };
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      this.pressTimer?.remove();
      this.deployRepeat?.remove();
      this.deployRepeat = null;
      const ev = p.event as MouseEvent | undefined;
      const boxed = !!this.box && this.dragging;
      if (boxed) this.selectInBox(ev?.shiftKey ?? false); // Maiusc: si aggiunge alla selezione
      this.box = null;
      this.boxGfx.clear();
      if (this.arrowing) {
        this.arrowing = false;
        this.finishArrow();
      } else if (this.zoning) {
        this.zoning = false;
        this.finishZone();
      } else if (this.lining) {
        this.lining = false;
        this.finishLine();
      } else if (this.walling) {
        this.walling = false;
        this.finishWall(); // muro: bunker sulle province trascinate (anche una sola, con un tocco)
      } else if (boxed) {
        // riquadro fatto: niente tocco
      } else if (this.longPressed) {
        this.longPressed = false; // tenuto premuto: la scheda è già aperta
      } else if (this.down && !this.dragging && this.activePointers().length === 0) {
        const right = p.rightButtonReleased();
        const near = !this.selectedCard && !this.selectedAbility && !right ? this.unitNear(p.x, p.y) : undefined;
        const tag = this.hud.tagAt(p.x / UI(), p.y / UI());
        if (right && this.selectedCard) this.endDeploy(); // clic destro: fine dello schieramento
        else if (right && this.wallMode) this.setBuildMode(null); // clic destro: fine della costruzione
        else if (right && !this.selection.size && this.lineNear(this.worldAt(p.x, p.y))) this.removeLine(this.lineNear(this.worldAt(p.x, p.y))!); // clic destro su una linea: la toglie
        else if (right && this.chaseAt(p.x, p.y)) { /* clic destro su una pedina nemica: la si insegue */ }
        else if (right) this.orderSelection(this.tileAt(p.x, p.y)); // clic destro: ordine al gruppo (HOI4)
        else if (near) this.selectUnit(near.id, ev?.shiftKey ?? false); // area di tocco ampia attorno alla pedina
        else if (!this.selectedCard && !this.selectedAbility && this.chaseAt(p.x, p.y)) { /* tocco su una pedina nemica con le tue scelte */ }
        else if (tag > 0 && !this.selectedCard && this.selectedUnit === null && !this.selectedAbility) this.hud.showProfile(tag);
        else this.tapTile(this.tileAt(p.x, p.y));
      }
      if (this.activePointers().length === 0) this.down = null;
      this.pinchDist = 0;
      this.lastMid = null;
    });

    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      // proporzionale alla rotella (trackpad: tanti passi piccoli; rotella: scatti da ~100) e più ampio di prima, che era lento
      // soprattutto ad allontanarsi (Nico): uno scatto di rotella ≈ ×0,75 / ×1,33
      const k = Math.exp(-Phaser.Math.Clamp(dy, -250, 250) * 0.0029);
      zoomAt(this, p.x, p.y, this.cameras.main.zoom * k);
    });
  }

  /** Riquadro di selezione (coordinate schermo): filo tratteggiato come sulla carta. */
  private drawBox() {
    const b = this.box, cam = this.cameras.main;
    if (!b) return;
    const w0 = cam.getWorldPoint(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1)), w1 = cam.getWorldPoint(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
    const px = UI() / cam.zoom;
    this.boxGfx.clear().fillStyle(MAP_SEL, 0.08).fillRect(w0.x, w0.y, w1.x - w0.x, w1.y - w0.y);
    rectOutline(this.boxGfx, w0.x, w0.y, w1.x - w0.x, w1.y - w0.y, 1.2 * px, MAP_SEL, 0.9);
  }

  /** Seleziona le tue pedine dentro il riquadro (add = si aggiungono a quelle già scelte). */
  private selectInBox(add: boolean) {
    const b = this.box, cam = this.cameras.main;
    if (!b) return;
    const w0 = cam.getWorldPoint(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1)), w1 = cam.getWorldPoint(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
    if (!add) this.selection.clear();
    for (const u of this.state.unitsOf(PLAYER)) {
      const sp = this.unitSprites.get(u.id);
      if (sp && sp.c.x >= w0.x && sp.c.x <= w1.x && sp.c.y >= w0.y && sp.c.y <= w1.y) this.selection.add(u.id);
    }
    this.applySelection();
    if (this.selection.size) buzz(8);
  }

  /** Dipingi: conquista le caselle di frontiera sotto il dito lungo il tratto percorso. */
  private paintAlong(x0: number, y0: number, x1: number, y1: number) {
    const steps = Math.max(1, Math.ceil(Phaser.Math.Distance.Between(x0, y0, x1, y1) / (6 * DPR)));
    for (let k = 1; k <= steps; k++) {
      const i = this.tileAt(x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps);
      const p = this.state.provOf(i);
      if (p < 0 || p === this.lastPainted) continue;
      this.lastPainted = p;
      if (this.state.paused) {
        // in pausa il trascinamento disegna il piano
        if (this.state.provPassable(p) && this.state.provOwner[p] === NEUTRAL && !this.state.plan.includes(p)) this.state.exec({ k: 'plan', p });
        continue;
      }
      if (!this.state.isFrontier(i) || this.state.troops <= this.state.provCost(PLAYER, p)) continue;
      const res = this.state.exec({ k: 'conquer', tile: i });
      if (res.ok) {
        this.usage.pittura++;
        this.hud.onConquest(res.loot);
        this.hud.tutorialSignal('paint');
        if (res.loot) this.floatText(center(i).x, center(i).y, `+${res.loot} ${RESOURCE_INFO[res.lootType].name.toLowerCase()}`, RESOURCE_INFO[res.lootType].color);
      }
    }
  }

  private activePointers(): Phaser.Input.Pointer[] {
    return this.input.manager.pointers.filter((q) => q.isDown);
  }
}
