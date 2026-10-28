import { DEV, applyResume, clearResume, saveResume, type ResumeData } from '../save/devResume';
import Phaser from 'phaser';
import { BALANCE, type AbilityType, type Resource, type UnitType, type WorkId } from '../config/balance';
import buildingText from '../data/buildings.json';
import { RESOURCES, RESOURCE_INFO } from '../game/resources';
import { recoverStake, runOptions, settle, type RunOptions } from '../game/camp';
import { loadProfile, saveProfile } from '../save/storage';
import { analytics } from '../analytics/analytics';
import { PALETTE, TERRAIN_VIEW, hex } from '../config/palette';
import { TerminalMap, TERM, type TermBorder, type TermFrame } from '../render/TerminalMap';
import { generateMap, type RunMap } from '../map/generate';
import { neighbors, HEX_W, WORLD_H, WORLD_W, center, pixelToIndex } from '../map/hexGrid';
import { buildShapes, provinceAtPoint, type MapShapes } from '../map/provinceShapes';
import { loadWorld } from '../map/worldAsset';
import { latToV, vToLat } from '../map/projection';
import { TerritoryLayer, fillProvince, type TerritoryFill } from '../render/TerritoryLayer';
import { NEUTRAL, PLAYER, RunState, WORKS } from '../game/RunState';
import { WORK_NAME, drawWorkIcon } from '../ui/workIcons';
import { FACTION_INFO, setupFactions } from '../game/factions';
import { enterWorld, fallenToBots, keepRivalNames } from '../game/world';
import { textStyle } from '../ui/style';
import { DPR, LOW_END, UI } from '../ui/screen';
import type { FactionTag, NationLabel, PlaceLabel, WorldLabel } from '../render/MapLabels';
import places from '../data/places.json';
import { buzz } from '../ui/haptics';
import { drawAbilityIcon } from '../ui/unitIcons';
import { drawUnitHp, drawUnitSymbol } from '../ui/unitSymbols';
import { brackets, rectOutline, squareProgress } from '../render/termMarks';
import { isNaval, unitInfo, type Unit } from '../game/units';
import { isCoast, type Boat } from '../game/boats';
import type { HudScene } from './HudScene';
import { setupCamera, zoomAt } from './run/CameraControl';

const S = BALANCE.map.hexSize;
// profondità dei livelli della mappa
const BUNKER = WORKS.indexOf('bunker'), RAIL = WORKS.indexOf('ferrovia');
// vista logistica: sfumatura continua rosso → giallo → verde (a gradini fitti, così i vicini si fondono)
const LOGI_STEPS = 16;
const LOGI_COLS = Array.from({ length: LOGI_STEPS + 1 }, (_, k) => {
  const t = k / LOGI_STEPS, C = Phaser.Display.Color;
  const [a, b, u] = t < 0.5 ? [0xe0473a, 0xe1e496, t * 2] : [0xe1e496, 0x9fe0a8, (t - 0.5) * 2];
  const c = C.Interpolate.ColorWithColor(C.ValueToColor(a), C.ValueToColor(b), 100, Math.round(u * 100));
  return '#' + C.GetColor(c.r, c.g, c.b).toString(16).padStart(6, '0');
});
const RAIL_COL = '#14161a'; // binari: tratteggio scuro, si stacca dal colore del territorio
const PLAYER_EDGE = '#3d6bff'; // confine del tuo territorio: blu scuro acceso, si vede sul nero e si stacca dal riempimento
const TERRAIN_IDX: Record<string, number> = { pianura: 0, colline: 1, montagne: 2, deserto: 3 }; // trama della carta da terminale
const D = { owned: 1, borders: 2, fog: 2.5, front: 3, marks: 4, path: 7, units: 8, fx: 9 };
const CAM = BALANCE.camera;
// segni sulla carta chiara: inchiostro per scritte e simboli, cobalto scuro per selezioni e ordini
const MAP_INK = 0xf2f2f2;
const MAP_SEL = 0x8fd6ff;
const CITY_COL = 0x9fd0f5; // città e capitali: azzurro come i nomi della carta


export class RunScene extends Phaser.Scene {
  state!: RunState;
  map!: RunMap;
  /** forme smussate delle province (bordi, sagome) */
  shapes!: MapShapes;
  private territory!: TerritoryLayer;
  private mapLayer!: Phaser.GameObjects.Layer;
  private term!: TerminalMap;
  private termDirty = true;
  private termRect: Phaser.Geom.Rectangle | null = null; // zona già disegnata (con margine mentre si sposta la carta)
  private termZoom = 0;
  private termAt = 0;
  private termMovedAt = 0;
  private termLastView = '';
  private camZoomPrev = 0; // zoom del fotogramma prima: per capire quando lo zoom si ferma
  private zoomAt = 0;
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
  private boatSprites = new Map<number, Phaser.GameObjects.Container>();
  private nationNames: Phaser.GameObjects.Text[] = [];
  private namesShown = true;
  private flowMarker!: Phaser.GameObjects.Graphics;
  private markerPulse = { k: 1 };
  private pressTimer: Phaser.Time.TimerEvent | null = null;
  private longPressed = false; // pulsazione di anello di selezione e bersaglio dell'avanzata
  private nextMilestone = 0;
  private tapFxTile = -1;
  private dragMode: 'pan' | 'paint' = 'pan';
  private lastMid: { x: number; y: number } | null = null;
  private lastPainted = -1;
  /** quante volte si usa ogni controllo (va in analytics a fine run) */
  private usage = { tocchi: 0, avanzate: 0, pittura: 0, pedine: 0, navi: 0 };
  private ending = false;
  private fxCheckAt = 0;
  // pedine
  selectedCard: UnitType | null = null;
  selectedAbility: AbilityType | null = null;
  private selectedUnit: number | null = null;
  /** Selezione alla HOI4: più pedine insieme (riquadro con Maiusc + trascina, Maiusc + clic per aggiungere). */
  private selection = new Set<number>();
  private box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private boxGfx!: Phaser.GameObjects.Graphics;
  private unitSprites = new Map<number, { c: Phaser.GameObjects.Container; hp: Phaser.GameObjects.Graphics; badge: Phaser.GameObjects.Graphics; badgeKey: string; tile: number; hpShown: number; pop: { k: number } }>();
  /** Gruppi salvati (Ctrl o Maiusc + numero salva, numero richiama), come in HOI4. */
  private groups = new Map<number, number[]>();
  private lastGroupKey = { n: -1, at: 0 };
  /** Muro: trascinando sulle tue province si mettono in coda i bunker (tasto MURO o B). */
  wallMode = false;
  private buildWork: WorkId | null = null;
  /** Vista della carta (tasto MAPPA): politica, terreno (senza nomi, colori del terreno), logistica (rifornimento). */
  mapMode: 'politica' | 'terreno' | 'logistica' = 'politica';
  private wallProvs: number[] = [];
  private walling = false;
  private wallGfx!: Phaser.GameObjects.Graphics;
  /** Assegnazione al fronte: dopo FRONTE (o F) il prossimo tocco su una provincia nemica sceglie il confine. */
  frontPick = false;
  /** Linea d'attacco alla HOI4: tasto Linea (o G), poi si trascina sulla carta; le pedine si dispongono lungo il tratto. */
  linePick = false;
  private lining = false;
  private linePts: { x: number; y: number }[] = [];
  private lineGfx!: Phaser.GameObjects.Graphics;
  private attackLines: { pts: { x: number; y: number }[]; ids: number[] }[] = [];
  /** Anteprima del percorso delle pedine selezionate verso il punto sotto il mouse. */
  private hoverTile = -1;
  private hoverAt = 0;
  private previewGfx!: Phaser.GameObjects.Graphics;
  private pathGfx!: Phaser.GameObjects.Graphics;
  private selRing!: Phaser.GameObjects.Graphics;
  private battleGfx!: Phaser.GameObjects.Graphics; // assalti in corso (anello che si riempie) e capitale
  private lastDefendToast = -1e9;
  // input
  private down: { x: number; y: number } | null = null;
  private last = { x: 0, y: 0 };
  private dragging = false;
  private pinchDist = 0;

  private runSeed = '';
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
    this.map = generateMap(seed, loadWorld(), opts.tutorial ? BALANCE.tutorial.aiCount : BALANCE.ai.count, opts.tutorial ? 0 : BALANCE.bots.count,
      opts.front.aiDistance);
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
    analytics.runStart(opts.tutorial, seed);
    this.usage = { tocchi: 0, avanzate: 0, pittura: 0, pedine: 0, navi: 0 };
    this.nextMilestone = 0;
    this.tapFxTile = -1;
    this.frontLabels = [];
    this.factionTags = this.state.factions.map(() => ({ x: 0, y: 0, visible: false, scale: 1, angle: 0, len: 0, wid: 0 }));
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
    this.term = new TerminalMap(this, this.shapes, DPR, D.owned + 0.5);
    // allineata ai pixel a fine fotogramma, dopo ogni spostamento della camera (anche WASD, che arriva dopo il ridisegno):
    // a metà pixel spariva una colonna di puntini, una linea verticale su tutta la carta (Nico)
    const align = () => this.term.align();
    this.events.on('postupdate', align);
    this.events.once('shutdown', () => this.events.off('postupdate', align));
    this.termRect = null;
    this.termZoom = 0;
    this.mapLayer.setVisible(false);
    this.borderGfx = this.add.graphics().setDepth(D.borders);
    this.borderKey = '';
    this.planImgs = new Map();
    // nebbia sopra i colori delle fazioni ma sotto pedine e segni
    this.fogVersion = -1;
    this.namesShown = true;
    this.makeFog(opts.fog);
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
    this.pathGfx = this.add.graphics().setDepth(D.path);
    this.battleGfx = this.add.graphics().setDepth(D.marks);
    this.selRing = this.add.graphics().setDepth(D.units).setVisible(false);
    this.selection = new Set();
    this.box = null;
    this.logistics = false;
    this.boxGfx = this.add.graphics().setDepth(D.fx);
    this.wallGfx = this.add.graphics().setDepth(D.front);
    this.previewGfx = this.add.graphics().setDepth(D.path);
    this.wallMode = false;
    this.buildWork = null;
    this.mapMode = 'politica';
    this.wallProvs = [];
    this.frontPick = false;
    this.linePick = false;
    this.lining = false;
    this.linePts = [];
    this.attackLines = [];
    this.lineGfx = this.add.graphics().setDepth(D.path);
    this.groups = new Map();
    this.hoverTile = -1;
    brackets(this.selRing, 0, 0, 19, 2, MAP_SEL, 1); // mirino sulla pedina scelta

    this.redrawOwned();
    this.redrawFrontier(true);
    setupCamera(this);
    if (resume) { this.cameras.main.setZoom(resume.cam.zoom); this.cameras.main.setScroll(resume.cam.x, resume.cam.y); this.syncUnits(); }
    this.resumeSaveAt = 0;
    this.setupInput();

    this.scene.launch('Hud');
    this.scene.bringToTop('Hud');
  }

  update(time: number, delta: number) {
    // qualità adattiva: se il bagliore rallenta troppo il dispositivo, si spegne (la leggibilità viene prima)
    if (this.cameras.main.postFX.list.length && time - this.fxCheckAt > 3000) {
      this.fxCheckAt = time;
      if (this.game.loop.actualFps < 40) this.cameras.main.postFX.clear();
    }
    const ticks = this.state.update(delta);
    let pops = 0;
    for (const e of this.state.drainEvents()) {
      if (e.type === 'conquer') {
        this.ownedDirty = true;
        if (e.by === PLAYER) {
          if (e.p !== this.tapFxTile && pops++ < 8) this.popFx(e.p);
          this.hud.tutorialSignal('conquer');
        }
        if (e.from === PLAYER && e.by !== NEUTRAL && time - this.lastHitFx > 250) {
          this.lastHitFx = time;
          this.lostFx(e.p, e.by);
        }
      } else if (e.type === 'unitDied') {
        this.unitDeathFx(e.unit);
      } else if (e.type === 'province') {
        this.hud.onProvince(e.by, e.capital, e.nation, e.bonus);
      } else if (e.type === 'boat') {
        this.boatLandFx(e.boat, e.phase);
      } else if (e.type === 'flowEnd') {
        if (e.reason === 'budget' && this.flowMarker.visible) this.floatText(this.flowMarker.x, this.flowMarker.y - 8, 'forza esaurita', MAP_INK);
        this.flowMarker.setVisible(false);
      } else if (e.type === 'event') {
        this.selectedCard = null;
        this.selectUnit(null);
        this.hud.showEvent(e.event);
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
          this.floatText(x, y + 6, `+${e.troops} truppe`, MAP_SEL, 120);
        }
      } else if (e.type === 'offensive') {
        this.hud.onOffensive(e.faction, e.phase, e.lost);
        if (e.phase === 'start') this.cameras.main.shake(220, 0.002);
      } else if (e.type === 'work') {
        this.borderKey = ''; // icone delle costruzioni da ridisegnare
        if (e.by === PLAYER) {
          const { x, y } = center(this.map.provinces[e.p].anchor);
          const name = WORK_NAME[e.work];
          if (e.phase === 'done') {
            this.flashProvince(e.p, PALETTE.ocra, 0.55, 700);
            this.floatText(x, y - 6, `${name} pronta`, PALETTE.ocra);
            buzz(20);
          } else this.floatText(x, y - 6, `cantiere: ${name.toLowerCase()}`, PALETTE.allerta);
        }
        this.hud.refreshProvince();
      } else if (e.type === 'diplomacy') {
        this.ownedDirty = true; // il fronte attaccabile cambia con la guerra e la pace
        this.hud.onDiplomacy(e.faction, e.what, e.byPlayer, e.amount ?? 0);
      } else if (e.type === 'encircled') {
        if (e.by === PLAYER || e.from === PLAYER) {
          for (const p of e.provinces.slice(0, 12)) this.flashProvince(p, e.by === PLAYER ? MAP_SEL : PALETTE.ko, 0.6, 700);
          this.hud.onEncircled(e.by, e.from, e.provinces.length);
          if (e.by === PLAYER) buzz([20, 30, 20]);
        }
      } else if (e.type === 'battle') {
        this.ownedDirty = true; // il fronte attaccabile cambia
        const b = e.battle, { x, y } = center(this.map.provinces[b.p].anchor);
        if (e.phase === 'start' && b.from === PLAYER) {
          this.flashProvince(b.p, PALETTE.ko, 0.5, 600);
          if (time - this.lastDefendToast > 8000) { this.lastDefendToast = time; this.hud.onDefending(b.by); }
        } else if (e.phase === 'lost' && b.by === PLAYER) {
          this.failFx(x, y, 'respinti!');
          this.cameras.main.shake(140, 0.002);
          buzz(30);
        } else if (e.phase === 'lost' && b.from === PLAYER) {
          this.floatText(x, y - 4, 'tenuta!', MAP_SEL);
        }
      } else if (e.type === 'hit') {
        this.hitFx(e.from, e.to, e.fromTile, e.toTile, e.dmg, e.owner);
      } else if (e.type === 'capital') {
        if (e.faction === PLAYER) {
          this.flashProvince(e.p, PALETTE.ocra, 0.6, 900);
          this.hud.onCapital();
        }
      } else if (e.type === 'focus') {
        // rapporto del radar: la carta va sulla provincia segnalata
        const { x, y } = center(this.map.provinces[e.p].anchor);
        this.cameras.main.pan(x, y, 450, 'Sine.easeInOut');
        this.flashProvince(e.p, PALETTE.allerta, 0.6, 900);
      } else {
        this.hud.onEliminated(e.faction, e.by, e.loot);
      }
    }
    this.drawBattles(time);
    this.syncUnits();
    this.syncBoats();
    this.scaleMarkers();
    if (this.state.opts.fog && this.state.fogVersion !== this.fogVersion) this.redrawFog();
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
    if (DEV && !this.state.over && time - this.resumeSaveAt > 3000) {
      this.resumeSaveAt = time;
      const c = this.cameras.main;
      void saveResume(this.state, this.runSeed, this.map.kinds, { x: c.scrollX, y: c.scrollY, zoom: c.zoom });
    }
    if (this.ownedDirty) {
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
    this.redrawTerminal();
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
    this.nameTimer -= delta;
    if (this.nameTimer <= 0) {
      this.nameTimer = 1000;
      this.placeNameTags();
    }
    this.keyPan(delta);
    this.updateHover(time);
    this.labelTimer -= delta;
    if (this.labelTimer <= 0) {
      this.labelTimer = 200;
      this.updateLabels();
      if (this.logistics && (this.logiTimer -= 200) <= 0) { this.logiTimer = 1000; this.termDirty = true; } // il rifornimento cambia col tempo
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
    return [(x / WORLD_W) * 360 - 180, vToLat(r / rows)];
  }

  private lonX(lon: number) {
    return ((lon + 180) / 360) * WORLD_W;
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
    this.drawWorks(g, v, px); // costruzioni: restano sopra la carta da terminale
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
    this.drawWorks(g, v, px);
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

  /** Carta da terminale: si ridisegna quando si sposta la vista o cambia il territorio. */
  private redrawTerminal() {
    const cam = this.cameras.main, now = this.time.now;
    // vista di questo fotogramma (worldView si aggiorna solo al disegno: un fotogramma in ritardo mentre si trascina)
    const vw = cam.width / cam.zoom, vh = cam.height / cam.zoom;
    const v0 = new Phaser.Geom.Rectangle(cam.scrollX + (cam.width - vw) / 2, cam.scrollY + (cam.height - vh) / 2, vw, vh);
    // barra di stato (coordinate e zoom): tolta (Nico: informazioni inutili)
    const viewKey = `${v0.x.toFixed(1)}:${v0.y.toFixed(1)}`;
    if (viewKey !== this.termLastView) { this.termLastView = viewKey; this.termMovedAt = now; }
    // prestazioni: la carta si ridisegna solo se cambia il territorio, lo zoom, o se la vista esce dalla zona già disegnata
    // (mentre si sposta la carta si disegna con un margine attorno, così trascinare non ridisegna a ogni fotogramma)
    const zoomed = cam.zoom !== this.termZoom, R0 = this.termRect;
    if (cam.zoom !== this.camZoomPrev) { this.camZoomPrev = cam.zoom; this.zoomAt = now; }
    const zooming = now - this.zoomAt < 180;
    const inside = !!R0 && v0.x >= R0.x && v0.y >= R0.y && v0.right <= R0.right && v0.bottom <= R0.bottom;
    // scorrendo si ridisegna un po' prima di arrivare al bordo della zona disegnata (a un terzo del margine): la carta nuova
    // è pronta prima che si veda il vuoto
    const ix = R0 ? Math.max(0, (R0.width - v0.width) / 6) : 0, iy = R0 ? Math.max(0, (R0.height - v0.height) / 6) : 0;
    const deep = !!R0 && v0.x >= R0.x + ix && v0.y >= R0.y + iy && v0.right <= R0.right - ix && v0.bottom <= R0.bottom - iy;
    if (!this.termDirty && !zoomed && deep) return;
    // zoom veloce (Nico: "un bordello"): mentre lo zoom va, la carta già disegnata si ingrandisce o rimpicciolisce da sola
    // (è nel mondo); si ridisegna solo quando lo zoom si ferma, o se la vista esce dalla zona disegnata o cambia troppo
    // (Nico: lag nello zoom: si ridisegnava quasi a ogni scatto della rotella, 50–120 ms ciascuno). Anche i cambi di territorio
    // aspettano la fine dello zoom
    if (zoomed && zooming && inside) return;
    // al massimo ~16 volte al secondo, ma solo se la carta disegnata copre ancora lo schermo: allontanandosi in fretta restava
    // un riquadro di carta in mezzo al vuoto finché non scattava il ridisegno
    if (zoomed && this.termZoom && inside && now - this.termAt < 60) return;
    this.termAt = now;
    this.termZoom = cam.zoom;
    this.termDirty = false;
    // trascinando: margine attorno, il prossimo passo è già disegnato. Zoomando no: con il margine l'area da calcolare
    // triplicava (fino a 120 ms a ridisegno, il lag nello zoom); allontanandosi si ridisegna solo la vista, ~20 ms
    const moving = !zooming && now - this.zoomAt > 300 && now - this.termMovedAt < 300;
    const maxW = 4096 / cam.zoom, maxH = 4096 / cam.zoom;
    const mx = moving ? Math.max(0, Math.min(v0.width * 0.35, (maxW - v0.width) / 2)) : 0;
    const my = moving ? Math.max(0, Math.min(v0.height * 0.35, (maxH - v0.height) / 2)) : 0;
    const v = new Phaser.Geom.Rectangle(v0.x - mx, v0.y - my, v0.width + 2 * mx, v0.height + 2 * my);
    this.termRect = v;
    const own = this.state.provOwner, provs = this.map.provinces, shapes = this.shapes.provinces, m = 8;
    const terrain = this.mapMode === 'terreno'; // vista del terreno: niente potenze né nomi, ogni provincia nel colore del suo terreno
    const seen = (p: number) => (p < 0 || terrain ? NEUTRAL : own[p] !== PLAYER && !this.state.seesProv(p) ? NEUTRAL : own[p]);
    const frame: TermFrame = { view: v, provinces: [], borders: [], labels: [], status: '' };
    for (let p = 0; p < shapes.length; p++) {
      const s = shapes[p];
      if (!s.parts.length || s.x1 < v.x - m || s.x0 > v.right + m || s.y1 < v.y - m || s.y0 > v.bottom + m) continue;
      const o = seen(p);
      // vista logistica: le tue province colorate dal rifornimento (pieno, in calo, tagliate fuori)
      // sfumata: metà la sua, metà la media delle tue province accanto (passaggi morbidi, Nico); le altre potenze sbiadite
      let sup = -1;
      if (this.logistics && o === PLAYER) {
        let sum = 0, n = 0;
        for (const q of provs[p].neighbors) if (own[q] === PLAYER) { sum += this.state.supply[q]; n++; }
        sup = n ? (this.state.supply[p] + sum / n) / 2 : this.state.supply[p];
      }
      const color = terrain ? TERRAIN_VIEW[provs[p].terrain]?.col ?? null
        : sup >= 0 ? LOGI_COLS[Math.round(Phaser.Math.Clamp((sup - 0.3) / 0.65, 0, 1) * LOGI_STEPS)]
        : o === NEUTRAL ? null : this.logistics ? this.fadedFill(o) : hex(FACTION_INFO[o].fill);
      // muro: le province con un bunker finito hanno il confine fortificato, disegnato sulla carta (non più l'icona)
      const fort = o !== NEUTRAL && this.state.provWork[p] === BUNKER && this.state.provWorkAt[p] === 0 && this.showWork(p);
      frame.provinces.push({ id: p, color, terrain: TERRAIN_IDX[provs[p].terrain] ?? 0, fort, stripe: terrain ? TERRAIN_VIEW[provs[p].terrain]?.stripe ?? 0 : 0 });
    }
    const box = this.chainBox, zv = cam.zoom / UI();
    // da lontano i confini tra nazioni diventano grigio scuro: in bianco si confondevano col mare
    // da vicino anche i confini tra province (grigio tenue), per distinguere i territori piccoli; disegnati per primi
    const dim: TermBorder[] = [];
    this.shapes.chains.forEach((c, k) => {
      if (box[k * 4 + 2] < v.x - m || box[k * 4] > v.right + m || box[k * 4 + 3] < v.y - m || box[k * 4 + 1] > v.bottom + m) return;
      const oa = seen(c.a), ob = seen(c.b);
      if (c.a >= 0 && c.b >= 0 && oa !== ob) {
        const o = oa === PLAYER || ob === PLAYER ? PLAYER : oa !== NEUTRAL ? oa : ob;
        const other = oa === PLAYER ? ob : oa;
        // linea del fronte: tuo confine con un nemico in guerra, tratteggiata in rosso
        void o; void other; // i confini dei territori (e la linea del fronte) li disegna la carta sul bordo esatto del riempimento
      // confini delle nazioni moderne tolti (Nico: inutili, i confini li fanno gli imperi che crescono durante la partita):
      // tra due province libere solo la linea tenue della provincia, anche dove prima passava una frontiera
      } else if (zv >= 3 && c.a >= 0 && c.b >= 0 && oa === NEUTRAL && ob === NEUTRAL) dim.push({ pts: c.pts, color: '#555c63' }); // solo terra libera: dentro un territorio niente divisioni
      else if ((this.buildWork || this.buildPeek) && !terrain && c.a >= 0 && c.b >= 0 && oa === PLAYER && ob === PLAYER) dim.push({ pts: c.pts, color: '#1d5a66' }); // COSTRUISCI: le tue province una per una (Nico)
    });
    frame.borders.unshift(...dim);
    // ferrovie: binari tratteggiati dal centro della provincia a quelli delle province accanto dello stesso padrone
    // (l'effetto vale "qui e accanto"), sopra la carta come una linea del terreno invece dell'icona
    const rails: TermBorder[] = [];
    for (const pr of frame.provinces) {
      const p = pr.id, o = own[p];
      if (this.state.provWork[p] !== RAIL || this.state.provWorkAt[p] !== 0 || (o !== PLAYER && !this.state.seesProv(p)) || !this.showWork(p)) continue;
      const a = center(provs[p].anchor);
      for (const q of provs[p].neighbors) {
        if (own[q] !== o) continue;
        if (this.state.provWork[q] === RAIL && this.state.provWorkAt[q] === 0 && q < p) continue; // tra due ferrovie un binario solo
        const b = center(provs[q].anchor);
        rails.push({ pts: [a.x, a.y, b.x, b.y], color: RAIL_COL, dash: true });
      }
    }
    frame.borders.push(...rails);
    // confine di ogni territorio: l'ultimo puntino del riempimento, nel colore di confine della potenza (il tuo: blu)
    frame.edges = {};
    // potenze IA: il colore del confine schiarito verso il bianco, se no sul riempimento dello stesso colore non si vedeva (Nico)
    const bright = (c: number) => Phaser.Display.Color.Interpolate.ColorWithColor(Phaser.Display.Color.ValueToColor(c), Phaser.Display.Color.ValueToColor(0xffffff), 100, 55);
    for (let f = 0; f < FACTION_INFO.length; f++) {
      const b = bright(FACTION_INFO[f].border);
      frame.edges[hex(FACTION_INFO[f].fill)] = f === PLAYER ? PLAYER_EDGE : hex(Phaser.Display.Color.GetColor(b.r, b.g, b.b));
    }
    if (this.logistics) for (const c of LOGI_COLS) frame.edges[c] = PLAYER_EDGE;
    if (this.logistics) frame.same = LOGI_COLS; // le sfumature del tuo territorio: un confine solo attorno, niente linee dentro
    const warF = FACTION_INFO.map((_, f) => f).filter((f) => f !== PLAYER && this.state.atWar(PLAYER, f));
    const war = warF.map((f) => (this.logistics ? this.fadedFill(f) : hex(FACTION_INFO[f].fill)));
    frame.front = { own: [hex(FACTION_INFO[PLAYER].fill), ...(this.logistics ? LOGI_COLS : [])], war, color: '#e0473a' };
    // passo dei puntini: una via di mezzo tra fisso sullo schermo e fisso sulla carta (3 punti a zoom 8, 2 da lontano, fino a 5 da vicino)
    frame.pitch = Phaser.Math.Clamp(Math.round(3 * Math.pow(zv / 8, 0.35)), 2, 5);
    frame.landDots = zv >= 2.5 ? '#2a2f36' : '#22262b'; // terra libera: un puntino per carattere, si vede la griglia
    const zpx = cam.zoom / DPR; // punti CSS per pixel-mondo
    if (!terrain) for (const n of this.termNations) if (n.width * zpx >= n.name.length * 9 * 1.1) frame.labels.push({ x: n.x, y: n.y, text: n.name, color: TERM.country, priority: 0 });
    // niente scritta CAPITALE: il nome della potenza sta dentro il suo territorio, alla HOI4
    if (!terrain) for (const l of this.termPlaces) frame.labels.push({ x: l.x, y: l.y, text: l.name, color: l.kind === 'city' ? TERM.city : TERM.sea, priority: l.kind === 'city' ? 1 : 2, small: l.kind === 'city' });
    this.term.render(frame);
  }

  /** Simbolo + nome di ogni fazione nel punto più interno del suo territorio, più grande se l'impero cresce. */
  private placeNameTags() {
    // nome della potenza dentro il suo territorio, alla HOI4: al centro delle sue province (che vedi), lungo l'asse più lungo
    // del territorio (componenti principali dei centri delle province, pesati per grandezza)
    const own = this.state.provOwner, provs = this.map.provinces, F = this.state.factions.length;
    const sw = new Float64Array(F), sx = new Float64Array(F), sy = new Float64Array(F);
    const pts: { x: number; y: number; w: number }[][] = this.state.factions.map(() => []);
    for (let p = 0; p < own.length; p++) {
      const o = own[p];
      if (o === NEUTRAL) continue;
      if (o !== PLAYER && !this.state.seesProv(p)) continue; // niente nomi nella nebbia
      const { x, y } = center(provs[p].anchor), w = provs[p].tiles.length;
      sw[o] += w; sx[o] += x * w; sy[o] += y * w;
      pts[o].push({ x, y, w });
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
      const mid = (lo + hi) / 2, x = mx + ux * mid, y = my + uy * mid;
      Object.assign(tag, { x, y, angle: ang, len: hi - lo, wid: whi - wlo, visible: true, scale: 1 });
    });
  }

  /** Evidenzia le province attaccabili: velo chiaro se abbordabili, appena accennato se no. */
  private redrawFrontier(force = false) {
    const front = this.state.frontier();
    const troops = this.state.troops;
    const ok = front.map((p) => troops > this.state.provCost(PLAYER, p));
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
        const c = center(provs[p].anchor), x = c.x, y = c.y + (this.state.provWork[p] >= 0 ? S * 0.9 : 0); // sotto l'icona dell'edificio
        if (x < view.x - S || x > view.right + S || y < view.y - S || y > view.bottom + S) continue;
        if (placed.some((q) => Math.abs(q.x - x) * z < 44 && Math.abs(q.y - y) * z < 18)) continue;
        placed.push({ x, y });
        const res = BALANCE.terrain[provs[p].terrain].res, b = this.state.provBag(p);
        this.frontLabels.push({ x, y, text: `+${(b.metallo + b.benzina + b.cibo).toFixed(1).replace('.', ',')}`, color: RESOURCE_INFO[res].color });
      }
      return;
    }
    for (const p of this.state.frontier()) {
      const { x, y } = center(this.map.provinces[p].anchor);
      if (x < view.x - S || x > view.right + S || y < view.y - S || y > view.bottom + S) continue;
      const def = this.state.provCost(PLAYER, p);
      if (!def) continue; // provincia vuota: si prende subito, niente numero
      const enemy = this.state.provOwner[p] !== NEUTRAL;
      this.frontLabels.push({ x, y, text: String(def), color: enemy ? PALETTE.ko : this.state.troops > def ? MAP_INK : PALETTE.mappa.segno });
    }
  }

  /** Piano della pausa strategica: le province in coda, numerate. */
  private syncPlan() {
    const plan = this.state.plan;
    const keep = new Set(plan);
    for (const [p, img] of this.planImgs) if (!keep.has(p)) { img.destroy(); this.planImgs.delete(p); }
    for (const p of plan) {
      if (this.planImgs.has(p)) continue;
      const img = this.add.graphics().setDepth(D.front).setAlpha(0.42).fillStyle(MAP_SEL, 1);
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
    this.hud.setHint(`${info.name.toUpperCase()}: ${info.desc}\nTocca la mappa per scegliere il bersaglio.`);
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
    this.hud.setHint(`${unitInfo(t).name.toUpperCase()}: ${unitInfo(t).desc}\nTocca un tuo territorio per schierarla.`);
    return null;
  }

  /** Tocco su una provincia dalla tabella in basso (ATTACCA, AVANZATA): come toccarne il centro sulla mappa. */
  tapProvince(p: number) {
    const a = this.map.provinces[p]?.anchor ?? -1;
    if (a >= 0) this.tapTile(a);
  }

  /** Seleziona una pedina (add = la aggiunge o la toglie dal gruppo, come Maiusc + clic in HOI4); null = deseleziona tutto. */
  private selectUnit(id: number | null, add = false) {
    if (id === null) this.selection.clear();
    else if (add) { if (this.selection.has(id)) this.selection.delete(id); else this.selection.add(id); }
    else this.selection = new Set([id]);
    this.applySelection();
  }

  private applySelection() {
    const ids = [...this.selection];
    this.selectedUnit = ids.length ? ids[ids.length - 1] : null; // la principale: scheda in basso e mirino pieno
    if (this.selectedUnit !== null) this.hud.showUnit(this.selectedUnit); // tabella in basso: vita, attacco, stato
    this.selRing.setVisible(this.selectedUnit !== null);
    if (ids.length > 1) this.hud.setHint(`${ids.length} pedine selezionate: tocca (o clic destro) la meta per mandarle tutte.\nCtrl o Maiusc + numero: salva il gruppo.`);
    else if (ids.length === 1) this.hud.setHint('Tocca una casella (o clic destro): la pedina ci va conquistando la strada.');
    else {
      this.linePick = false; // niente pedine: niente linea da tracciare
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

  /** Manda tutte le pedine selezionate verso la casella i; true se almeno una è partita. */
  private orderSelection(i: number): boolean {
    if (i < 0 || !this.selection.size) return false;
    const { x, y } = center(i);
    let sent = 0;
    for (const id of this.selection) {
      const u = this.state.units.find((v) => v.id === id);
      if (!u || (!this.map.tiles[i] && !isNaval(u.type))) continue;
      if (this.state.command(u, i)) sent++;
    }
    if (!sent) { this.failFx(x, y, 'irraggiungibile'); return false; }
    this.floatText(x, y - 4, sent > 1 ? `avanti! · ${sent}` : 'avanti!', MAP_SEL);
    // segnale d'arrivo: mirino che si stringe sul punto scelto
    const s = UI() / this.cameras.main.zoom, ring = this.add.graphics({ x, y }).setDepth(D.fx);
    brackets(ring, 0, 0, 16 * s, 2 * s, MAP_SEL, 1);
    this.tweens.add({ targets: ring, scale: { from: 1.6, to: 0.6 }, alpha: { from: 1, to: 0 }, duration: 380, ease: 'Quad.easeIn', onComplete: () => ring.destroy() });
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
  unitAction(kind: 'stance' | 'front' | 'merge' | 'split' | 'retreat' | 'line') {
    const units = this.selectedUnits(), st = this.state, main = units[units.length - 1];
    if (!main) return this.hud.notify('seleziona prima una pedina', PALETTE.ko);
    const { x, y } = center(main.tile);
    if (kind === 'stance') {
      const next = units.every((u) => u.stance === 'attacca') ? 'tieni' : 'attacca';
      st.setStance(units, next);
      this.floatText(x, y - 8, next === 'attacca' ? 'attacca da sola' : 'tiene la posizione', MAP_SEL);
    } else if (kind === 'line') {
      this.linePick = true;
      this.frontPick = false;
      this.hud.setHint('LINEA D\'ATTACCO · trascina sulla carta dove schierarle.\nLe pedine si dispongono lungo la linea, ci vanno conquistando la strada e la tengono.');
      return;
    } else if (kind === 'front') {
      this.frontPick = true;
      this.hud.setHint('FRONTE · tocca una provincia della potenza da fronteggiare.\nLe pedine si dispongono sul confine (se attaccano da sole lo spingono).');
      return;
    } else if (kind === 'merge') {
      const r = st.merge(units.length > 1 ? [main, ...units.slice(0, -1)] : units);
      const why = { few: 'seleziona almeno due pedine', type: 'si uniscono solo pedine dello stesso tipo', far: `avvicinale: entro ${BALANCE.unitOps.mergeRange} caselle`, max: `massimo ${BALANCE.unitOps.mergeMax} reparti per pedina` } as const;
      if (typeof r === 'string') return this.failFx(x, y, why[r]);
      this.selection = new Set([main.id]);
      this.applySelection();
      this.burstAt(x, y, 10, MAP_SEL);
      this.floatText(x, y - 8, `unite · ×${main.size}`, MAP_SEL);
    } else if (kind === 'split') {
      const r = st.split(main);
      if (r === 'single') return this.failFx(x, y, 'reparto singolo: non si divide');
      if (r === 'room') return this.failFx(x, y, 'nessuna casella libera accanto');
      this.syncUnits();
      this.selection = new Set([main.id, r.id]);
      this.applySelection();
      this.floatText(x, y - 8, `divisa · ×${main.size} + ×${r.size}`, MAP_SEL);
    } else {
      const n = st.retreatUnits(units);
      if (!n) return this.failFx(x, y, 'nessuna provincia sicura');
      this.floatText(x, y - 8, n > 1 ? `ritirata · ${n}` : 'ritirata', MAP_SEL);
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
    const q = this.worldAt(sx, sy), last = this.linePts[this.linePts.length - 1], z = this.cameras.main.zoom;
    if (last && Math.hypot((q.x - last.x) * z, (q.y - last.y) * z) < 6) return;
    this.linePts.push(q);
    this.drawAttackLines();
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
    const units = this.selectedUnits().filter((u) => !isNaval(u.type));
    this.drawAttackLines();
    if (!pts.length) return;
    if (!units.length) return this.failFx(pts[0].x, pts[0].y, 'seleziona prima le pedine');
    if (pts.length < 2) return this.failFx(pts[0].x, pts[0].y, 'trascina una linea');
    const seg: number[] = [0];
    for (let k = 1; k < pts.length; k++) seg.push(seg[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
    const L = seg[seg.length - 1], n = units.length;
    const at = (d: number) => {
      let k = 1;
      while (k < pts.length - 1 && seg[k] < d) k++;
      const t = seg[k] > seg[k - 1] ? (d - seg[k - 1]) / (seg[k] - seg[k - 1]) : 0;
      return { x: pts[k - 1].x + (pts[k].x - pts[k - 1].x) * t, y: pts[k - 1].y + (pts[k].y - pts[k - 1].y) * t };
    };
    const used = new Set<number>(), posts: number[] = [];
    for (let k = 0; k < n; k++) {
      const q = at(n === 1 ? L / 2 : (L * k) / (n - 1));
      let i = pixelToIndex(q.x, q.y);
      // sul mare o già preso: la casella di terra libera più vicina
      if (i < 0 || !this.map.tiles[i] || used.has(i)) {
        const ring = i >= 0 ? [...neighbors(i), ...neighbors(i).flatMap((m) => (m >= 0 ? neighbors(m) : []))] : [];
        i = ring.find((m) => m >= 0 && this.map.tiles[m] && !used.has(m)) ?? -1;
      }
      if (i >= 0) used.add(i);
      posts.push(i);
    }
    // ordine lungo la linea: proiezione di ogni pedina sulla direzione dal primo all'ultimo punto
    const a = pts[0], b = pts[pts.length - 1], dx = b.x - a.x, dy = b.y - a.y;
    const proj = (u: Unit) => { const c = center(u.tile); return (c.x - a.x) * dx + (c.y - a.y) * dy; };
    const sorted = [...units].sort((u, v) => proj(u) - proj(v));
    const pairs = sorted.map((u, k) => ({ u, i: posts[k] })).filter((x) => x.i >= 0);
    const sent = this.state.holdLine(pairs.map((x) => x.u), pairs.map((x) => x.i));
    if (!sent) { this.drawAttackLines(); return this.failFx(a.x, a.y, 'irraggiungibile'); }
    const ids = pairs.map((x) => x.u.id);
    // una pedina sta su una linea sola: quelle riassegnate escono dalle linee vecchie
    for (const l of this.attackLines) l.ids = l.ids.filter((id) => !ids.includes(id));
    this.attackLines.push({ pts, ids });
    const m = at(L / 2);
    this.floatText(m.x, m.y - 6, sent > 1 ? `in linea · ${sent}` : 'in linea', MAP_SEL);
    buzz(12);
    this.selectUnit(null);
    this.hud.tutorialSignal('order');
  }

  /** Linee d'attacco attive (e quella che si sta tracciando): tratto pieno con freccia in avanti ogni tanto. */
  private drawAttackLines() {
    const g = this.lineGfx.clear(), px = UI() / this.cameras.main.zoom;
    // via le linee senza più pedine che le tengono
    this.attackLines = this.attackLines.filter((l) => (l.ids = l.ids.filter((id) => this.state.units.some((u) => u.id === id && u.post >= 0))).length > 0);
    const stroke = (pts: { x: number; y: number }[], alpha: number) => {
      if (pts.length < 2) return;
      g.lineStyle(5 * px, 0x000000, 0.35 * alpha).beginPath().moveTo(pts[0].x, pts[0].y);
      for (const p of pts) g.lineTo(p.x, p.y);
      g.strokePath();
      g.lineStyle(2.4 * px, MAP_SEL, alpha).beginPath().moveTo(pts[0].x, pts[0].y);
      for (const p of pts) g.lineTo(p.x, p.y);
      g.strokePath();
      // denti sul lato d'attacco (a destra del verso di tracciamento), come la linea del fronte di HOI4
      let acc = 0;
      for (let k = 1; k < pts.length; k++) {
        const ax = pts[k - 1].x, ay = pts[k - 1].y, bx = pts[k].x, by = pts[k].y, d = Math.hypot(bx - ax, by - ay);
        if (!d) continue;
        const ux = (bx - ax) / d, uy = (by - ay) / d, step = 14 * px;
        for (let t = step - acc; t < d; t += step) {
          const cx = ax + ux * t, cy = ay + uy * t, h = 4 * px;
          g.fillStyle(MAP_SEL, alpha).fillTriangle(cx - ux * h, cy - uy * h, cx + ux * h, cy + uy * h, cx - uy * h * 1.3, cy + ux * h * 1.3);
        }
        acc = (acc + d) % step;
      }
    };
    for (const l of this.attackLines) stroke(l.pts, 0.8);
    if (this.linePts.length) stroke(this.linePts, 1);
  }

  /** Fronte scelto: le pedine selezionate vanno sul confine con il padrone della provincia toccata. */
  private pickFront(i: number) {
    this.hud.setHint(null);
    const p = this.state.provOf(i), o = p >= 0 ? this.state.provOwner[p] : NEUTRAL;
    const { x, y } = center(i);
    if (o === NEUTRAL || o === PLAYER) return this.failFx(x, y, 'tocca una provincia di un\'altra potenza');
    if (!this.state.assignFront(this.selectedUnits(), o)) return this.failFx(x, y, `nessun confine con ${FACTION_INFO[o].short}`);
    this.floatText(x, y - 6, `fronte: ${FACTION_INFO[o].short}`, MAP_SEL);
    buzz(12);
    this.hud.refreshProvince();
  }

  /**
   * Costruzione a trascinamento (tasto COSTRUISCI o B), come il vecchio muro ma per ogni edificio: scelto l'edificio, trascini
   * sulle tue province e ne mette uno su ognuna. null = spento.
   */
  /** Menu COSTRUISCI aperto: già si vedono le tue province una per una e cosa rendono. */
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
    this.hud.setHint(w ? `${WORK_NAME[w].toUpperCase()} · trascina sulle tue province: uno su ognuna (${this.state.workPrice(w)} truppe e ${this.state.workMetal(w)} metallo l'uno).` : null);
    this.hud.setBuildOn(w);
    this.termDirty = true; // confini tra le tue province (solo in COSTRUISCI)
    this.borderKey = '';
    this.updateLabels();
  }

  /** Aggiunge al muro le tue province sotto il tratto trascinato e le evidenzia. */
  private wallAlong(x0: number, y0: number, x1: number, y1: number) {
    const steps = Math.max(1, Math.ceil(Phaser.Math.Distance.Between(x0, y0, x1, y1) / (6 * DPR)));
    let changed = false;
    for (let k = 0; k <= steps; k++) {
      const p = this.state.provOf(this.tileAt(x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps));
      if (p < 0 || this.state.provOwner[p] !== PLAYER || this.state.provWork[p] >= 0 || this.wallProvs.includes(p)) continue;
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
    const r = this.state.buildWall(provs, w);
    const { x, y } = center(this.map.provinces[provs[0]].anchor);
    if (!r.built) return this.failFx(x, y, r.stop === 'metal' ? 'serve metallo nello zaino' : r.stop === 'troops' ? 'truppe insufficienti' : 'qui non si può costruire');
    for (const p of provs.slice(0, r.built)) this.flashProvince(p, PALETTE.allerta, 0.5, 500);
    const left = provs.length - r.built - r.skipped;
    this.hud.notify(`${WORK_NAME[w].toUpperCase()} · ${r.built} in costruzione${left > 0 ? ` · ${left} rimasti fuori (${r.stop === 'metal' ? 'metallo' : 'truppe'})` : ''}`, PALETTE.allerta);
    buzz(15);
    this.setBuildMode(null);
  }

  /** Gruppi alla HOI4: Ctrl (o Maiusc) + numero salva la selezione, il numero la richiama (due volte: ci va la carta). */
  private groupKey(e: KeyboardEvent) {
    const m = /^Digit([1-9])$/.exec(e.code);
    if (!m) return;
    const n = Number(m[1]);
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
      if (!this.selection.size) return this.hud.notify('seleziona le pedine, poi Ctrl (o Maiusc) + numero', PALETTE.ko);
      this.groups.set(n, [...this.selection]);
      this.hud.notify(`GRUPPO ${n} · ${this.selection.size} ${this.selection.size === 1 ? 'pedina' : 'pedine'}`, PALETTE.radioattivo);
      return;
    }
    const ids = (this.groups.get(n) ?? []).filter((id) => this.state.units.some((u) => u.id === id));
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

  /** Mouse fermo su una casella: anteprima del percorso (pedine scelte) o previsione dell'assalto (provincia di confine). */
  private updateHover(time: number) {
    if (time - this.hoverAt < 120) return;
    this.hoverAt = time;
    const i = this.hoverTile, g = this.previewGfx.clear();
    const main = this.selectedUnit !== null ? this.state.units.find((u) => u.id === this.selectedUnit) : undefined;
    if (i < 0 || this.dragging) return this.hud.hideForecast();
    if (main) {
      this.hud.hideForecast();
      const path = this.state.previewPath(main, i);
      if (!path.length) return;
      const px = UI() / this.cameras.main.zoom;
      this.dashedPath(g, [main.tile, ...path].map(center), 1.4 * px, MAP_SEL, 0.45);
      return;
    }
    if (this.selectedCard || this.selectedAbility || this.wallMode || this.frontPick || this.linePick || !this.state.isFrontier(i)) return this.hud.hideForecast();
    const t = this.tileToScreen(i);
    this.hud.showForecast(this.state.provOf(i), t.x, t.y);
  }

  /** Linea tratteggiata lungo i punti (trattini e spazi a misura di schermo). */
  private dashedPath(g: Phaser.GameObjects.Graphics, pts: { x: number; y: number }[], w: number, color: number, alpha: number) {
    const dash = 5 * w / 1.4, gap = 4 * w / 1.4;
    g.lineStyle(w, color, alpha);
    let on = true, left = dash;
    for (let k = 1; k < pts.length; k++) {
      let ax = pts[k - 1].x, ay = pts[k - 1].y;
      const bx = pts[k].x, by = pts[k].y;
      let seg = Math.hypot(bx - ax, by - ay);
      while (seg > 0) {
        const step = Math.min(left, seg), t = step / seg;
        const nx = ax + (bx - ax) * t, ny = ay + (by - ay) * t;
        if (on) g.lineBetween(ax, ay, nx, ny);
        ax = nx; ay = ny; seg -= step; left -= step;
        if (left <= 0) { on = !on; left = on ? dash : gap; }
      }
    }
  }

  private tapTile(i: number) {
    this.hud.hideProvince();
    if (i < 0) return;
    const { x, y } = center(i);
    if (this.selectedAbility) {
      const a = this.selectedAbility;
      this.selectedAbility = null;
      this.hud.setHint(null);
      if (this.state.useAbility(a, i)) analytics.design(['abilita', a]);
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
      const u = this.state.deploy(PLAYER, t, i);
      if (!u) return this.failFx(x, y, isNaval(t) ? 'serve una tua costa sul mare' : this.state.owner[i] === PLAYER ? 'casella occupata' : 'solo nel tuo territorio');
      this.selectedCard = null;
      this.syncUnits();
      this.conquestFx(x, y, this.state.unitCost(PLAYER, t), 0);
      this.selectUnit(u.id);
      this.hud.tutorialSignal('deploy');
      this.usage.pedine++;
      analytics.design(['pedina', t]);
      return;
    }
    const mine = this.state.unitAt(i);
    if (mine && mine.owner === PLAYER) return this.selectUnit(this.selection.size === 1 && this.selection.has(mine.id) ? null : mine.id);
    if (this.selection.size) {
      this.orderSelection(i);
      return;
    }

    // pausa strategica: i tocchi sulla mappa preparano il piano, che parte quando il tempo riprende
    const p = this.state.provOf(i);
    const holder = p >= 0 ? this.state.provOwner[p] : NEUTRAL;
    if (holder !== NEUTRAL && holder !== PLAYER && !this.state.atWar(PLAYER, holder) && this.state.sees(i)) {
      this.hud.showProfile(holder); // in pace (o alleati): non si attacca, si tratta
      return;
    }
    if (this.state.paused && !this.state.over) {
      if (!this.state.provPassable(p) || this.state.provOwner[p] === PLAYER) return;
      const added = this.state.togglePlan(p);
      this.floatText(x, y - 4, added ? `piano · ${this.state.plan.length}` : 'tolta dal piano', MAP_SEL);
      this.syncPlan();
      buzz(8);
      return;
    }

    if (!this.state.isFrontier(i)) {
      if (this.state.owner[i] === PLAYER) return this.hud.showProvince(p); // scheda della provincia: terreno, produzione, costruzioni
      // lontano dal fronte: niente avanzata automatica (tolta); oltre il mare si sbarca con una nave, altrimenti si vede la scheda
      if (this.state.passable(i) && isCoast(this.map.tiles, i)) {
        const why = this.state.launchBoat(i);
        if (!why) {
          this.floatText(x, y - 6, 'nave in rotta!', MAP_INK);
          buzz(15);
          this.usage.navi++;
          return;
        }
      }
      if (p >= 0) this.hud.showProvince(p, false);
      return;
    }

    // provincia di frontiera: si compra col tocco (come prima), senza trascinare
    const res = this.state.tryConquer(i);
    if (!this.state.opts.tutorial) this.hud.showProvince(p, false); // tabella in basso alla Call of War
    if (res.ok && res.battle) {
      // provincia di qualcuno: parte l'assalto (le truppe sono già in marcia)
      this.usage.tocchi++;
      buzz(15);
      this.floatText(x, y - 6, `assalto · ${Math.ceil((res.battle.endMs - res.battle.startMs) / 1000)} s`, PALETTE.allerta);
      this.redrawFrontier(true);
      this.hud.onConquest(0);
    } else if (res.ok) {
      this.usage.tocchi++;
      buzz(res.loot ? 25 : 8);
      this.tapFxTile = p;
      this.redrawOwned();
      this.redrawFrontier(true);
      this.conquestFx(x, y, res.cost, res.loot, res.lootType, p);
      this.hud.onConquest(res.loot);
    } else if (res.reason === 'troops') {
      this.failFx(x, y, `servono ${res.need! + 1}`);
    } else if (res.reason === 'battle') {
      this.failFx(x, y, 'assalto in corso');
    } else if (res.reason === 'not-adjacent') {
      this.failFx(x, y, 'troppo lontano');
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
    buzz(this.state.over === 'victory' ? [40, 60, 40, 60, 120] : 150);
    for (const [k, v] of Object.entries(this.usage)) analytics.design(['controlli', k], v);
    analytics.design(['controlli', 'lavoro_finale'], Math.round(this.state.player.workers * 100));
    analytics.design(['controlli', 'attacco_finale'], Math.round(this.state.attackRatio * 100));
    this.time.delayedCall(BALANCE.end.resultDelayMs, () => {
      this.scene.stop('Hud');
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
  setMapMode(m: 'politica' | 'terreno' | 'logistica') {
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
    this.state.retreat();
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
    this.termPlaces = [
      ...places.cities.map(([name, lon, lat]) => ({ x: this.lonX(lon as number), y: this.latY(lat as number), name: name as string, kind: 'city' as const })),
      ...places.seas.map(([name, lon, lat]) => ({ x: this.lonX(lon as number), y: this.latY(lat as number), name: name as string, kind: 'sea' as const })),
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
    return !!this.buildWork || this.buildPeek || p === this.workCardP;
  }

  /** Costruzioni nelle province inquadrate (le tue e quelle nemiche che vedi): icona e cantiere con l'avanzamento. */
  private drawWorks(g: Phaser.GameObjects.Graphics, v: Phaser.Geom.Rectangle, px: number) {
    const st = this.state;
    for (let p = 0; p < st.provWork.length; p++) {
      const w = st.provWork[p];
      if (w < 0 || !this.showWork(p)) continue;
      const o = st.provOwner[p];
      if (o !== PLAYER && !st.seesProv(p)) continue;
      // muro e ferrovia finiti si vedono sulla carta (confine fortificato, binari): niente icona; il cantiere sì
      if ((w === BUNKER || w === RAIL) && st.provWorkAt[p] === 0) continue;
      const a = this.map.provinces[p].anchor;
      const { x: cx, y: cy } = center(a);
      const x = cx + 11 * px, y = cy - 13 * px;
      if (x < v.x - 20 || x > v.right + 20 || y < v.y - 20 || y > v.bottom + 20) continue;
      // targhetta: ombra, fondo scuro con doppio filo nel colore della potenza e codino verso il centro della provincia
      // colore della potenza schiarito: sul fondo scuro il confine pieno si perdeva (icone nere)
      const C = Phaser.Display.Color, lc = o >= 0 ? C.Interpolate.ColorWithColor(C.ValueToColor(FACTION_INFO[o].fill), C.ValueToColor(0xffffff), 100, 45) : null;
      const r = 11 * px, col = lc ? C.GetColor(lc.r, lc.g, lc.b) : MAP_INK;
      g.fillStyle(0x000000, 0.35).fillRoundedRect(x - r + 1.5 * px, y - r + 1.5 * px, 2 * r, 2 * r, 2.5 * px);
      g.fillStyle(0x0b0d10, 0.96).fillRoundedRect(x - r, y - r, 2 * r, 2 * r, 2.5 * px);
      g.fillTriangle(x - 3 * px, y + r - 0.5 * px, x + 3 * px, y + r - 0.5 * px, cx, cy);
      g.lineStyle(1.4 * px, col, 1).strokeRoundedRect(x - r, y - r, 2 * r, 2 * r, 2.5 * px);
      g.lineStyle(0.8 * px, col, 0.4).strokeRect(x - r + 2.2 * px, y - r + 2.2 * px, 2 * r - 4.4 * px, 2 * r - 4.4 * px);
      g.fillStyle(col, 1).fillCircle(cx, cy, 1.6 * px);
      drawWorkIcon(g, WORKS[w], x, y + 0.5 * px, r * 0.58, col, 0x0b0d10);
      const prog = st.workInProgress(p);
      if (prog) squareProgress(g, x, y, r + 2.5 * px, 1 - prog.leftMs / BALANCE.works[prog.work].timeMs, 1.8 * px, PALETTE.allerta); // cantiere: il bordo si riempie
    }
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
      if (p.city < 0 || !this.state.isCity(idx)) return; // solo le città che valgono di più (Nico: niente punto in ogni provincia)
      const { x, y } = center(p.city);
      if (!inV(x, y)) return;
      if (this.map.tiles[p.city]!.capital) {
        // capitale: una stella (Nico), azzurra come i nomi della carta
        if (z < 2.2) return;
        const r = 5 * px * Phaser.Math.Clamp(z / 4, 0.7, 1), pts: Phaser.Types.Math.Vector2Like[] = []; // da lontano più piccole
        for (let k = 0; k < 10; k++) {
          const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.45 : r;
          pts.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr });
        }
        g.fillStyle(CITY_COL, 1).fillPoints(pts, true).lineStyle(1.4 * px, 0x000000, 1).strokePoints(pts, true);
      } else if (z >= 2.2) {
        // città: un quadrato con bordo nero
        const r = 3.2 * px * Phaser.Math.Clamp(z / 4, 0.7, 1);
        g.fillStyle(0x000000, 1).fillRect(x - r - 1.3 * px, y - r - 1.3 * px, 2 * r + 2.6 * px, 2 * r + 2.6 * px).fillStyle(CITY_COL, 1).fillRect(x - r, y - r, 2 * r, 2 * r);
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
    const px = UI() / this.cameras.main.zoom, cell = 6 * px; // un quadratino ≈ 6 punti sullo schermo
    const area = (sh.x1 - sh.x0) * (sh.y1 - sh.y0), n = Phaser.Math.Clamp(Math.round(area / (cell * cell * 6)), 8, 36);
    for (let k = 0; k < n; k++) {
      const x = Phaser.Math.FloatBetween(sh.x0, sh.x1), y = Phaser.Math.FloatBetween(sh.y0, sh.y1);
      if (this.state.provOf(pixelToIndex(x, y)) !== p) continue;
      const q = this.add.rectangle(Math.round(x / cell) * cell, Math.round(y / cell) * cell, cell * 0.7, cell * 0.7, color, from).setDepth(D.fx);
      this.tweens.add({ targets: q, alpha: 0, delay: Phaser.Math.Between(0, ms * 0.4), duration: ms * 0.6, ease: 'Stepped', easeParams: [3], onComplete: () => q.destroy() });
    }
    const g = this.add.graphics().setDepth(D.fx).setAlpha(from).lineStyle(1.5 * px, color, 1);
    for (const part of sh.parts) g.strokePoints(Array.from({ length: part.outer.length / 2 }, (_, j) => ({ x: part.outer[2 * j], y: part.outer[2 * j + 1] })), true);
    this.tweens.add({ targets: g, alpha: 0, duration: ms, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
  }

  /** Ricognizione: aereo che attraversa e anello che si apre; bombardamento: mirino, poi esplosioni. */
  private abilityFx(a: AbilityType, tile: number, phase: 'launch' | 'impact', hits: number, by = PLAYER, blocked = false) {
    const { x, y } = center(tile);
    if (blocked) {
      // contraerea: il colpo si spegne in aria
      this.burstAt(x, y - 10, 10, MAP_INK);
      this.floatText(x, y - 8, 'intercettato dalla contraerea', MAP_SEL);
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
      const ring = this.add.rectangle(x, y, 2 * rr, 2 * rr).setStrokeStyle(1.5, MAP_SEL).setDepth(11); // area sorvolata: riquadro
      this.tweens.add({ targets: ring, scale: { from: 0.1, to: 1 }, alpha: { from: 1, to: 0 }, duration: 1200, onComplete: () => ring.destroy() });
      buzz(20);
      return;
    }
    if (phase === 'launch') {
      const mark = this.add.graphics({ x, y }).setDepth(12);
      drawAbilityIcon(mark, 'bombardamento', 0, 0, R, PALETTE.ko);
      this.tweens.add({ targets: mark, scale: { from: 1.6, to: 1 }, alpha: { from: 1, to: 0.6 }, duration: BALANCE.abilities.bombardamento.delayMs, onComplete: () => mark.destroy() });
      return;
    }
    for (let k = 0; k < 5; k++) {
      const ox = (Math.random() - 0.5) * R * 2, oy = (Math.random() - 0.5) * R * 2;
      const boom = this.add.rectangle(x + ox, y + oy, R * 1.2, R * 1.2, 0xffb547, 0.9).setDepth(12).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: boom, scale: { from: 0.3, to: 2.2 }, alpha: 0, delay: k * 90, duration: 500, onComplete: () => boom.destroy() });
    }
    this.cameras.main.shake(200, 0.0025); // bombardamento: scossa leggera, non uno schiaffo
    buzz([40, 30, 60]);
    this.ownedDirty = true;
    this.floatText(x, y - 8, hits ? `colpiti ${hits}` : 'nessun bersaglio', hits ? MAP_INK : MAP_INK);
  }

  private conquestFx(x: number, y: number, cost: number, loot: number, lootType: Resource = 'metallo', p = -1) {
    if (p >= 0) this.flashProvince(p, 0xffffff, 0.75, 480);
    this.burstAt(x, y, loot ? 18 : 10, loot ? RESOURCE_INFO[lootType].color : MAP_INK);
    this.floatText(x, y - 4, `-${cost}`, MAP_INK);
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
    const c = this.add.container(x, y, [g, hp, badge]).setDepth(D.units);
    const pop = { k: 0.2 };
    this.tweens.add({ targets: pop, k: 1, duration: 260, ease: 'Back.easeOut' });
    return { c, hp, badge, badgeKey: '', tile: u.tile, hpShown: -1, pop };
  }

  /** Assalti visibili: anello che si riempie col tempo e due sciabole incrociate; la tua capitale con un doppio anello d'oro. */
  private drawBattles(time: number) {
    const g = this.battleGfx.clear(), st = this.state, s = UI() / this.cameras.main.zoom;
    for (const b of st.battles) {
      if (b.by !== PLAYER && b.from !== PLAYER && !st.seesProv(b.p)) continue;
      const { x, y } = center(this.map.provinces[b.p].anchor);
      const t = Phaser.Math.Clamp((st.gameTimeMs - b.startMs) / Math.max(1, b.endMs - b.startMs), 0, 1);
      const col = FACTION_INFO[b.by]?.fill ?? MAP_INK, r = 13 * s;
      const danger = b.from === PLAYER;
      // assalto: riquadro nero il cui bordo si riempie col tempo (niente anelli: la carta è a griglia)
      g.fillStyle(0x000000, 0.8).fillRect(x - r - 2 * s, y - r - 2 * s, 2 * r + 4 * s, 2 * r + 4 * s);
      rectOutline(g, x - r - 1.25 * s, y - r - 1.25 * s, 2 * r + 2.5 * s, 2 * r + 2.5 * s, 2.5 * s, 0x2a2f36);
      squareProgress(g, x, y, r, t, 2.5 * s, col);
      if (danger) brackets(g, x, y, r + 6 * s, 1.5 * s, PALETTE.ko, 0.5 + 0.5 * Math.sin(time / 120));
      const k = 6 * s; // sciabole incrociate
      g.lineStyle(2 * s, 0xf2efe6, 1).lineBetween(x - k, y - k, x + k, y + k).lineBetween(x + k, y - k, x - k, y + k);
    }
    // rapporti del radar: freccia rossa dall'armata nemica alla tua provincia
    for (const a of st.alerts) {
      const A = center(a.from), B = center(a.to), dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      const pulse = 0.55 + 0.45 * Math.sin(time / 160), w = 2.5 * s, h = 12 * s;
      g.lineStyle(w, PALETTE.ko, pulse);
      for (let t = 0; t < L - h; t += 14 * s) g.lineBetween(A.x + ux * t, A.y + uy * t, A.x + ux * Math.min(t + 8 * s, L - h), A.y + uy * Math.min(t + 8 * s, L - h));
      g.fillStyle(PALETTE.ko, pulse).fillTriangle(B.x, B.y, B.x - ux * h - uy * h * 0.6, B.y - uy * h + ux * h * 0.6, B.x - ux * h + uy * h * 0.6, B.y - uy * h - ux * h * 0.6);
    }
    // capitale di ogni impero (tua compresa): una stella (Nico: non si vedeva la capitale degli altri)
    const far = Phaser.Math.Clamp(this.cameras.main.zoom / UI() / 6, 0.45, 1);
    st.capitalProv.forEach((p, f) => {
      const fac = st.factions[f];
      if (p < 0 || !fac?.alive || fac.kind === 'bot' || st.provOwner[p] !== f) return;
      const { x, y } = center(this.map.provinces[p].anchor), R = 10 * s * far, pts: Phaser.Types.Math.Vector2Like[] = [];
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? R * 0.45 : R;
        pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
      }
      g.fillStyle(0xf2f2f2, 1).fillPoints(pts, true).lineStyle(2 * s * far, 0x000000, 1).strokePoints(pts, true); // bianca: si vede su ogni colore
    });
  }

  /**
   * Pedine, navi e segnalini a grandezza costante sullo schermo (come i contatti su un radar); allontanando la carta però
   * rimpiccioliscono, se no coprono tutta la mappa (Nico): piene fino allo zoom 6, poi in proporzione, fino al 35%.
   */
  private scaleMarkers() {
    const zv = this.cameras.main.zoom / UI(), far = Phaser.Math.Clamp(zv / 6, 0.35, 1);
    const s = UI() / this.cameras.main.zoom;
    for (const sp of this.unitSprites.values()) sp.c.setScale(s * sp.pop.k * 1.2 * far); // pedine un po' più grandi: si toccano meglio
    for (const b of this.boatSprites.values()) b.setScale(s * 0.9 * far);
    this.selRing.setScale(s * this.markerPulse.k);
    this.flowMarker.setScale(s * this.markerPulse.k);
  }

  /** Allinea gli sprite delle pedine allo stato (creazione, movimento, vita). */
  private syncUnits() {
    const alive = new Set<number>();
    for (const u of this.state.units) {
      alive.add(u.id);
      let sp = this.unitSprites.get(u.id);
      if (!sp) this.unitSprites.set(u.id, (sp = this.makeUnitSprite(u)));
      sp.c.setVisible(u.owner === PLAYER || this.state.sees(u.tile)); // pedine nemiche nascoste nella nebbia
      if (sp.tile !== u.tile) {
        sp.tile = u.tile;
        const { x, y } = center(u.tile);
        // scivola alla velocità vera (terreno compreso): niente scatti tra una casella e l'altra
        const t = this.map.tiles[u.tile], move = t ? BALANCE.terrain[t.terrain].move : 1;
        const dur = (BALANCE.units[u.type].moveMs * move) / Math.max(0.25, this.state.speed);
        this.tweens.killTweensOf(sp.c);
        this.tweens.add({ targets: sp.c, x, y, duration: Math.min(1200, dur), ease: 'Linear' });
      }
      const hpPct = Math.round((u.hp / u.maxHp) * 10);
      if (hpPct !== sp.hpShown) {
        sp.hpShown = hpPct;
        drawUnitHp(sp.hp, hpPct / 10, u.owner === PLAYER);
      }
      // segni sulla pedina: reparti uniti (tacche), attacca da sola (freccia), fronte assegnato, senza rifornimento (rosso)
      const low = u.supply < BALANCE.unitOps.attritionBelow;
      const key = `${u.size}|${u.owner === PLAYER ? u.stance : ''}|${u.owner === PLAYER && u.front >= 0 ? 1 : 0}|${low ? 1 : 0}`;
      if (key !== sp.badgeKey) {
        sp.badgeKey = key;
        const b = sp.badge.clear(), mine = u.owner === PLAYER, top = mine ? -14 : -19;
        b.fillStyle(MAP_INK, 1);
        for (let k = 0; k < u.size && u.size > 1; k++) b.fillRect(-((u.size - 1) * 5) / 2 + k * 5 - 1.6, top, 3.2, 3.2);
        if (mine && u.stance === 'attacca') b.fillStyle(MAP_SEL, 1).fillTriangle(15, -4.5, 15, 4.5, 22, 0); // freccia avanti: attacca da sola
        if (mine && u.front >= 0) b.fillStyle(MAP_SEL, 1).fillRect(-21, -9, 3, 8).fillRect(-21, -9, 7, 3);
        if (low) b.fillStyle(PALETTE.ko, 1).fillRect(-19, mine ? 11 : 16, 4, 4.5);
      }
    }
    for (const [id, sp] of this.unitSprites) {
      if (alive.has(id)) continue;
      sp.c.destroy();
      this.unitSprites.delete(id);
    }
    let lost = false;
    for (const id of this.selection) if (!alive.has(id)) { this.selection.delete(id); lost = true; }
    if (lost) this.applySelection();

    // percorsi delle nostre pedine + anello di selezione
    const g = this.pathGfx.clear(), px = UI() / this.cameras.main.zoom; // un punto sullo schermo, in pixel-mondo
    for (const u of this.state.unitsOf(PLAYER)) {
      if (!u.path.length) continue;
      const sel = this.selection.has(u.id);
      const sp = this.unitSprites.get(u.id);
      const pts = [sp ? { x: sp.c.x, y: sp.c.y } : center(u.tile), ...u.path.map(center)];
      this.dashedPath(g, pts, (sel ? 2 : 1.4) * px, MAP_SEL, sel ? 0.9 : 0.45); // percorso tratteggiato fino alla meta
      const end = pts[pts.length - 1];
      g.fillStyle(MAP_SEL, sel ? 0.9 : 0.5).fillRect(end.x - 3 * px, end.y - 3 * px, 6 * px, 6 * px);
      if (sel) brackets(g, end.x, end.y, 9 * px, 1.5 * px, MAP_SEL, 0.9);
    }
    if (this.selectedUnit !== null) {
      const sp = this.unitSprites.get(this.selectedUnit);
      if (sp) this.selRing.setPosition(sp.c.x, sp.c.y);
    }
    // le altre pedine del gruppo: mirino sottile
    for (const id of this.selection) {
      if (id === this.selectedUnit) continue;
      const sp = this.unitSprites.get(id);
      if (sp) brackets(g, sp.c.x, sp.c.y, 17 * px, 1.5 * px, MAP_SEL, 0.85);
    }
  }

  // ---------- nebbia e navi ----------

  /** Nebbia in una texture a mezza risoluzione (bordi morbidi, costa poco): si ridisegna solo quando la vista cambia. */
  /** Nebbia: una texture con un pixel per casella (alpha = mai visto / esplorato / in vista), ingrandita e sfumata. */
  private makeFog(on: boolean) {
    const { cols, rows } = BALANCE.map, key = 'fog';
    if (this.textures.exists(key)) this.textures.remove(key);
    this.fogTex = this.textures.createCanvas(key, cols, rows);
    const fog = this.add.image(0, 0.25 * S, key).setOrigin(0).setScale(HEX_W, 1.5 * S).setDepth(D.fog).setVisible(on && BALANCE.fog.shade);
    this.mapLayer.add(fog); // la nebbia è carta che copre: anche lei a celle
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
      this.floatText(x, y - 8, 'sbarco!', MAP_INK);
      buzz(30);
    } else {
      this.failFx(x, y, 'sbarco respinto');
      buzz([20, 40, 20]);
    }
  }

  /** Scontro tra pedine: traccia del colpo, scintille sul bersaglio, sobbalzo e danno che sale. */
  private hitFx(from: number, to: number, fromTile: number, toTile: number, dmg: number, owner: number) {
    if (!this.state.sees(fromTile) && !this.state.sees(toTile)) return;
    const a = this.unitSprites.get(from), b = this.unitSprites.get(to);
    const p0 = a ? { x: a.c.x, y: a.c.y } : center(fromTile), p1 = b ? { x: b.c.x, y: b.c.y } : center(toTile);
    const s = UI() / this.cameras.main.zoom, col = owner === PLAYER ? MAP_SEL : FACTION_INFO[owner]?.fill ?? PALETTE.ko;
    const g = this.add.graphics().setDepth(D.fx);
    g.lineStyle(2.2 * s, col, 0.95).lineBetween(p0.x, p0.y, p1.x, p1.y);
    g.fillStyle(0xfff3c4, 1).fillRect(p0.x - 3 * s, p0.y - 3 * s, 6 * s, 6 * s); // vampa alla partenza
    this.tweens.add({ targets: g, alpha: 0, duration: 220, onComplete: () => g.destroy() });
    this.burstAt(p1.x, p1.y, 4, 0xffd9a0);
    if (b) {
      b.pop.k = 1.25; // sobbalzo del bersaglio
      this.tweens.add({ targets: b.pop, k: 1, duration: 200, ease: 'Quad.easeOut' });
    }
    const mineHit = this.state.units.find((u) => u.id === to)?.owner === PLAYER;
    if (owner === PLAYER || mineHit) this.floatText(p1.x, p1.y - 8 * s, `−${Math.round(dmg)}`, mineHit ? PALETTE.ko : 0xffe2a8);
    if (mineHit && dmg >= 8) this.cameras.main.shake(90, 0.0015);
  }

  private unitDeathFx(u: Unit) {
    const sp = this.unitSprites.get(u.id);
    const { x, y } = sp ? { x: sp.c.x, y: sp.c.y } : center(u.tile);
    this.burstAt(x, y, 22, FACTION_INFO[u.owner].fill);
    this.burstAt(x, y, 10, 0xffd9a0);
    if (u.owner === PLAYER) {
      this.floatText(x, y - 6, `${unitInfo(u.type).short} caduta`, PALETTE.ko);
      this.cameras.main.shake(160, 0.003);
      buzz(40);
    } else if (this.state.sees(u.tile)) {
      this.floatText(x, y - 6, `${unitInfo(u.type).short} distrutta`, MAP_SEL);
      buzz(20);
    }
  }

  /** Scintille a misura di schermo (velocità e grandezza seguono lo zoom). */
  /** Scoppio in stile terminale: quadratini che schizzano via in otto direzioni e si spengono a scatti (niente tondi). */
  private burstAt(x: number, y: number, n: number, tint: number) {
    const s = UI() / this.cameras.main.zoom;
    for (let k = 0; k < n; k++) {
      const a = (Math.PI / 4) * Phaser.Math.Between(0, 7) + Phaser.Math.FloatBetween(-0.2, 0.2), d = Phaser.Math.FloatBetween(14, 40) * s, z = (k % 3 === 0 ? 4 : 2.6) * s;
      const q = this.add.rectangle(x, y, z, z, tint, 1).setDepth(D.fx + 1);
      this.tweens.add({ targets: q, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, alpha: 0, duration: Phaser.Math.Between(320, 520), ease: 'Cubic.easeOut', onComplete: () => q.destroy() });
    }
  }

  /** Provincia appena presa (avanzata, pittura, pedine): lampo leggero sulla sagoma. */
  private popFx(p: number) {
    this.flashProvince(p, 0xffffff, 0.5, 360);
  }

  /** Una nostra provincia è caduta: lampo rosso. */
  private lostFx(p: number, by: number) {
    const { x, y } = center(this.map.provinces[p].anchor);
    this.flashProvince(p, PALETTE.ko, 0.7, 600);
    void by;
    const v = this.cameras.main.worldView;
    if (v.contains(x, y)) this.cameras.main.shake(90, 0.002);
  }

  private failFx(x: number, y: number, msg: string) {
    const ring = this.add.graphics({ x, y }).setDepth(9);
    brackets(ring, 0, 0, S * 1.2, 1.5, PALETTE.ko, 1); // non si può: mirino rosso che trema
    this.tweens.add({ targets: ring, alpha: 0, duration: 500, onComplete: () => ring.destroy() });
    this.tweens.add({ targets: ring, x: { from: x - 2, to: x }, duration: 60, repeat: 3, yoyo: true });
    this.floatText(x, y - 4, msg, PALETTE.ko);
  }

  private floatText(x: number, y: number, msg: string, color: number, delay = 0) {
    this.hud.floatAt(x, y, msg, color, delay); // nitida: la disegna l'interfaccia
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
    kb?.on('keydown-T', () => this.unitAction('stance'));
    kb?.on('keydown-F', () => this.unitAction('front'));
    kb?.on('keydown-U', () => this.unitAction('merge'));
    kb?.on('keydown-I', () => this.unitAction('split'));
    kb?.on('keydown-R', () => this.unitAction('retreat'));
    kb?.on('keydown-G', () => this.unitAction('line'));
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
          this.openOwnerCard(this.tileAt(p.x, p.y));
        });
        this.down = { x: p.x, y: p.y };
        this.last = { x: p.x, y: p.y };
        this.dragging = false;
        this.lastPainted = -1;
        this.dragMode = 'pan'; // trascinare sposta la carta: niente territorio dipinto col dito
        // mouse come in HOI4: trascinare col sinistro = riquadro di selezione delle pedine; col destro (o WASD) si sposta la carta.
        // Sul telefono trascinare sposta la carta.
        this.box = !p.wasTouch && p.leftButtonDown() && !this.selectedCard && !this.selectedAbility && !this.wallMode && !this.linePick ? { x0: p.x, y0: p.y, x1: p.x, y1: p.y } : null;
        // muro: col dito o col sinistro si trascina sulle province da fortificare (col destro si sposta ancora la carta)
        this.walling = this.wallMode && (p.wasTouch || p.leftButtonDown());
        if (this.walling) this.wallAlong(p.x, p.y, p.x, p.y);
        // linea d'attacco: col dito o col sinistro si traccia (col destro si sposta ancora la carta)
        this.lining = this.linePick && (p.wasTouch || p.leftButtonDown());
        if (this.lining) { this.linePts = []; this.lineAlong(p.x, p.y); }
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
      }
      if (this.dragging) {
        if (this.walling) {
          this.wallAlong(this.last.x, this.last.y, p.x, p.y);
        } else if (this.lining) {
          this.lineAlong(p.x, p.y);
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
      const ev = p.event as MouseEvent | undefined;
      const boxed = !!this.box && this.dragging;
      if (boxed) this.selectInBox(ev?.shiftKey ?? false); // Maiusc: si aggiunge alla selezione
      this.box = null;
      this.boxGfx.clear();
      if (this.lining) {
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
        if (right) this.orderSelection(this.tileAt(p.x, p.y)); // clic destro: ordine al gruppo (HOI4)
        else if (near) this.selectUnit(near.id, ev?.shiftKey ?? false); // area di tocco ampia attorno alla pedina
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
        if (this.state.provPassable(p) && this.state.provOwner[p] !== PLAYER && !this.state.plan.includes(p)) this.state.togglePlan(p);
        continue;
      }
      if (!this.state.isFrontier(i) || this.state.troops <= this.state.provCost(PLAYER, p)) continue;
      const res = this.state.tryConquer(i);
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
