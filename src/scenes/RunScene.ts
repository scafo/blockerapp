import Phaser from 'phaser';
import { BALANCE, type AbilityType, type Resource, type UnitType } from '../config/balance';
import buildingText from '../data/buildings.json';
import { RESOURCES, RESOURCE_INFO } from '../game/resources';
import { recoverStake, runOptions, settle, type RunOptions } from '../game/camp';
import { loadPrefs, loadProfile, saveProfile } from '../save/storage';
import { analytics } from '../analytics/analytics';
import { PALETTE } from '../config/palette';
import { generateMap, type RunMap } from '../map/generate';
import { neighbors, HEX_W, WORLD_H, WORLD_W, center, pixelToIndex } from '../map/hexGrid';
import { buildShapes, provinceAtPoint, type MapShapes } from '../map/provinceShapes';
import { loadWorld } from '../map/worldAsset';
import { TerritoryLayer, fillProvince, type TerritoryFill } from '../render/TerritoryLayer';
import { NEUTRAL, PLAYER, RunState, WORKS } from '../game/RunState';
import { WORK_NAME, drawWorkIcon } from '../ui/workIcons';
import { FACTION_INFO, setupFactions } from '../game/factions';
import { textStyle } from '../ui/style';
import { DPR, LOW_END, UI } from '../ui/screen';
import type { FactionTag, NationLabel, WorldLabel } from '../render/MapLabels';
import { buzz } from '../ui/haptics';
import { drawAbilityIcon } from '../ui/unitIcons';
import { drawUnitHp, drawUnitSymbol } from '../ui/unitSymbols';
import { isNaval, unitInfo, type Unit } from '../game/units';
import type { Boat } from '../game/boats';
import type { HudScene } from './HudScene';

const S = BALANCE.map.hexSize;
// profondità dei livelli della mappa
const D = { owned: 1, borders: 2, fog: 2.5, front: 3, marks: 4, path: 7, units: 8, fx: 9 };
const CAM = BALANCE.camera;


export class RunScene extends Phaser.Scene {
  state!: RunState;
  map!: RunMap;
  /** forme smussate delle province (bordi, sagome) */
  shapes!: MapShapes;
  private territory!: TerritoryLayer;
  private landLayer!: TerritoryLayer; // da vicino: terra, mare e rilievo (si ridisegna solo spostando la vista)
  private frontOk = new Map<number, boolean>(); // province attaccabili → abbordabili
  private landColor = new Int32Array(0); // tono di ogni provincia sulla carta
  private relief!: Phaser.GameObjects.Image;
  private glow!: Phaser.GameObjects.RenderTexture; // acque basse a bassa risoluzione (resta per lo strato vettoriale)
  private seaGfx!: Phaser.GameObjects.Graphics;
  private landMode = false; // da vicino la terra la disegna lo strato vettoriale (nitida), da lontano basta la carta cotta
  private borderGfx!: Phaser.GameObjects.Graphics;
  private borderKey = '';
  private chainBox: Float32Array = new Float32Array(0);
  private ruinTiles: number[] = [];
  private workTimer = 0;
  private planImgs = new Map<number, Phaser.GameObjects.Graphics>();
  /** Etichette per l'interfaccia (spazio schermo, sempre nitide). */
  nationLabels: NationLabel[] = [];
  frontLabels: WorldLabel[] = [];
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
  private unitSprites = new Map<number, { c: Phaser.GameObjects.Container; hp: Phaser.GameObjects.Graphics; tile: number; hpShown: number; pop: { k: number } }>();
  private pathGfx!: Phaser.GameObjects.Graphics;
  private selRing!: Phaser.GameObjects.Graphics;
  // input
  private down: { x: number; y: number } | null = null;
  private last = { x: 0, y: 0 };
  private dragging = false;
  private pinchDist = 0;

  constructor() {
    super('Run');
  }

  create(data: { seed: string; opts?: RunOptions }) {
    // l'accampamento decide cosa è sbloccato in questa run
    const profile = loadProfile();
    if (settle(profile, Date.now())) saveProfile(profile);
    const opts = data.opts ?? runOptions(profile);
    // la puntata esce dal Deposito adesso: è in gioco (e resta segnata finché la campagna non si chiude)
    recoverStake(profile);
    if (!opts.tutorial && RESOURCES.some((r) => opts.stake[r] > 0)) {
      for (const r of RESOURCES) profile.stash[r] = Math.max(0, profile.stash[r] - opts.stake[r]);
      profile.activeStake = { bag: { ...opts.stake }, fee: opts.exitFee };
    }
    if (!opts.tutorial && profile.supplies?.length) profile.supplies = []; // i rifornimenti del Mercato partono con questa campagna
    saveProfile(profile);
    this.map = generateMap(data.seed, loadWorld(), opts.tutorial ? BALANCE.tutorial.aiCount : BALANCE.ai.count, opts.tutorial ? 0 : BALANCE.bots.count,
      opts.front.aiDistance);
    setupFactions(this.map.kinds, opts.civ, opts.playerName, data.seed); // tu, imperi con nomi casuali, milizie provinciali
    this.state = new RunState(this.map, opts);
    this.state.initFog();
    analytics.runStart(opts.tutorial, data.seed);
    if (!opts.tutorial) {
      // forza d'attacco e lavoratori come li avevi lasciati
      const prefs = loadPrefs();
      if (prefs.attack !== undefined) this.state.attackRatio = prefs.attack;
      if (prefs.workers !== undefined) this.state.setWorkers(prefs.workers);
    }
    this.usage = { tocchi: 0, avanzate: 0, pittura: 0, pedine: 0, navi: 0 };
    this.nextMilestone = 0;
    this.tapFxTile = -1;
    this.frontLabels = [];
    this.factionTags = this.state.factions.map(() => ({ x: 0, y: 0, visible: false, scale: 1 }));
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
    const before = this.children.list.length;
    this.drawSea();
    this.drawCoastGlow();
    this.drawLand();
    this.bakeStatic(this.children.list.slice(before));
    this.drawRelief();
    this.seaGfx = this.make.graphics({}, false);
    this.territory?.destroy();
    this.landLayer?.destroy();
    // due strati: la terra (ferma, forme intere: niente fessure tra province) e il territorio delle potenze (cambia spesso)
    this.landLayer = new TerritoryLayer(this, this.shapes.provinces, D.owned - 0.01, Math.min(1, 2 / DPR));
    this.landLayer.setVisible(false);
    this.territory = new TerritoryLayer(this, this.shapes.provinces, D.owned, Math.min(1, 2 / DPR));
    this.frontOk = new Map();
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
    this.flowMarker.lineStyle(2.5, 0xffffff, 1).strokeCircle(0, 0, 12).lineStyle(1.5, 0xffffff, 0.8).strokeCircle(0, 0, 6);
    this.markerPulse = { k: 1 };
    this.tweens.add({ targets: this.markerPulse, k: { from: 0.85, to: 1.2 }, duration: 420, yoyo: true, repeat: -1 });
    this.ending = false;

    this.nameTimer = 0;

    this.selectedCard = null;
    this.selectedUnit = null;
    this.unitSprites = new Map();
    this.pathGfx = this.add.graphics().setDepth(D.path);
    this.selRing = this.add.graphics().setDepth(D.units).setVisible(false);
    this.selRing.lineStyle(2.2, PALETTE.radioattivo, 1).strokeCircle(0, 0, 20);

    this.redrawOwned();
    this.redrawFrontier(true);
    this.setupCamera();
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
        if (e.reason === 'budget' && this.flowMarker.visible) this.floatText(this.flowMarker.x, this.flowMarker.y - 8, 'forza esaurita', PALETTE.carta);
        this.flowMarker.setVisible(false);
      } else if (e.type === 'event') {
        this.selectedCard = null;
        this.selectUnit(null);
        this.hud.showEvent(e.event);
      } else if (e.type === 'timer') {
        this.hud.onTimer();
      } else if (e.type === 'ability') {
        this.abilityFx(e.ability, e.tile, e.phase, e.hits ?? 0);
      } else if (e.type === 'provinceDone') {
        if (e.by === PLAYER) {
          const { x, y } = center(this.map.provinces[e.province].anchor);
          this.floatText(x, y + 6, `+${e.troops} truppe`, PALETTE.radioattivo, 120);
        }
      } else if (e.type === 'offensive') {
        this.hud.onOffensive(e.faction, e.phase, e.lost);
        if (e.phase === 'start') this.cameras.main.shake(300, 0.004);
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
          for (const p of e.provinces.slice(0, 12)) this.flashProvince(p, e.by === PLAYER ? PALETTE.radioattivo : PALETTE.ko, 0.6, 700);
          this.hud.onEncircled(e.by, e.from, e.provinces.length);
          if (e.by === PLAYER) buzz([20, 30, 20]);
        }
      } else {
        this.hud.onEliminated(e.faction, e.by, e.loot);
      }
    }
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
      if (this.state.provWorkAt.some((t) => t > 0)) this.borderKey = ''; // avanzamento dei cantieri
    }
    this.redrawBorders();
    const zc = this.cameras.main.zoom / UI();
    const landMode = zc >= 2.2; // da qui in su la carta cotta si vedrebbe sgranata
    if (landMode !== this.landMode) {
      this.landMode = landMode;
      this.relief.setVisible(!landMode);
      this.landLayer.setVisible(landMode);
      this.landLayer.invalidate();
      this.territory.invalidate();
    }
    // forme intere da vicino: semplificate ognuna per conto suo lasciavano fessure scure negli angoli tra le province
    if (landMode) {
      this.landLayer.update(time, 1, (a, b, c, d) => this.landFills(a, b, c, d),
        { before: (...a) => this.drawSeaInto(...a), mid: (...a) => this.drawReliefInto(...a) });
    }
    this.territory.update(time, landMode ? 1 : 4, (a, b, c, d) => this.territoryFills(a, b, c, d));
    this.syncPlan();
    this.nameTimer -= delta;
    if (this.nameTimer <= 0) {
      this.nameTimer = 1000;
      this.placeNameTags();
    }
    this.labelTimer -= delta;
    if (this.labelTimer <= 0) {
      this.labelTimer = 200;
      this.updateLabels();
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
        .setOrigin(0).setScale(1 / f2);
      holder.setPosition((M - t * tileW) * f2, M * f2);
      rt.draw(holder);
      this.children.sendToBack(rt);
    }
    void fullW; void fullH;
    holder.destroy(true);
  }

  /** y-mondo di una latitudine (stessa formula delle righe della griglia). */
  private latY(lat: number) {
    const { latMax, latMin, rows } = BALANCE.map;
    return 1.5 * S * (((latMax - lat) / (latMax - latMin)) * rows - 0.5) + S;
  }

  /** Pixel-mondo → [lon, lat] (inverso di lonX / latY), per la barra di stato. */
  worldToLonLat(x: number, y: number): [number, number] {
    const { latMax, latMin, rows } = BALANCE.map;
    const r = (y - S) / (1.5 * S) + 0.5;
    return [(x / WORLD_W) * 360 - 180, latMax - (r / rows) * (latMax - latMin)];
  }

  private lonX(lon: number) {
    return ((lon + 180) / 360) * WORLD_W;
  }

  /** Mare: fondo blu notte, acque basse lungo le coste, meridiani e paralleli discreti ogni 15°. */
  private drawSea() {
    const g = this.add.graphics();
    const MP = PALETTE.mappa;
    g.fillStyle(MP.fondo, 1).fillRect(-12, -12, WORLD_W + 24, WORLD_H + 24);
    const { latMax, latMin } = BALANCE.map;
    g.lineStyle(0.35, MP.reticolo, 1);
    for (let lon = -180; lon <= 180; lon += 15) g.lineBetween(this.lonX(lon), 0, this.lonX(lon), WORLD_H);
    for (let lat = -45; lat <= 75; lat += 15) if (lat <= latMax && lat >= latMin) g.lineBetween(0, this.latY(lat), WORLD_W, this.latY(lat));
    g.lineStyle(0.6, MP.reticolo, 1).lineBetween(0, this.latY(0), WORLD_W, this.latY(0)); // equatore
  }

  /**
   * Acque basse: alone morbido lungo le coste, disegnato in una texture a bassa risoluzione e poi ingrandito (sfuma da
   * solo). Tratti larghi disegnati direttamente avrebbero il bordo esterno seghettato.
   */
  private drawCoastGlow() {
    const R = 0.4, MP = PALETTE.mappa;
    const mixC = (a: number, b: number, t: number) => {
      const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t) << s;
      return ch(16) | ch(8) | ch(0);
    };
    this.glow?.destroy();
    const rt = (this.glow = this.make.renderTexture({ x: 0, y: 0, width: Math.ceil(WORLD_W * R) + 2, height: Math.ceil(WORLD_H * R) + 2 }, false)
      .setOrigin(0).setScale(1 / R));
    const g = this.make.graphics({}, false).setScale(R);
    for (const [w, t] of [[9, 0.06], [6.5, 0.14], [4.2, 0.24], [2.2, 0.36]] as const) {
      g.lineStyle(w, mixC(MP.fondo, MP.mareCosta, t), 1);
      for (const c of this.shapes.chains) if (c.a < 0 || c.b < 0) this.strokeChain(g, c.pts, c.closed, 2);
    }
    rt.draw(g);
    g.destroy();
    this.add.image(0, 0, rt.texture).setOrigin(0).setScale(1 / R); // copia per la carta cotta (che poi la distrugge)
  }

  private strokeChain(g: Phaser.GameObjects.Graphics, pts: ArrayLike<number>, closed: boolean, step = 1) {
    const out: Phaser.Types.Math.Vector2Like[] = [];
    for (let j = 0; j < pts.length; j += 2 * step) out.push({ x: pts[j], y: pts[j + 1] });
    if (!closed && (pts.length / 2 - 1) % step) out.push({ x: pts[pts.length - 2], y: pts[pts.length - 1] });
    if (out.length > 1) g.strokePoints(out, closed, closed);
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
        color = mix(MP.nazioni[tone.get(p.country) ?? 0], MP.deserto, frac('deserto') * 0.6);
        color = mix(color, 0x8b939c, frac('montagne') * 0.32);
        color = mix(color, 0x66745a, frac('colline') * 0.16);
        color = jitter > 0 ? mix(color, 0xffffff, jitter) : mix(color, 0x000000, -jitter);
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
    // ombreggiatura del rilievo calcolata per casella (un pixel per casella), poi ingrandita e sfumata: costa pochissimo
    const { cols, rows } = BALANCE.map, key = 'relief', tiles = this.map.tiles;
    if (this.textures.exists(key)) this.textures.remove(key);
    const tex = this.textures.createCanvas(key, cols, rows)!;
    const ctx = tex.getContext(), img = ctx.createImageData(cols, rows), d = img.data;
    const h0 = new Float32Array(cols * rows);
    for (const i of this.map.land) { const t = tiles[i]!.terrain; h0[i] = t === 'montagne' ? 1 : t === 'colline' ? 0.45 : 0; }
    // quota ammorbidita con i vicini
    const h = new Float32Array(cols * rows);
    for (const i of this.map.land) {
      let sum = h0[i] * 2, n = 2;
      for (const q of neighbors(i)) if (q >= 0) { sum += h0[q]; n++; }
      h[i] = sum / n;
    }
    for (const i of this.map.land) {
      const nb = neighbors(i), nw = nb[3], se = nb[0];
      const shade = ((nw >= 0 ? h[nw] : h[i]) - (se >= 0 ? h[se] : h[i])) * 1.6 + h[i] * 0.12; // luce da nord-ovest
      const k = i * 4;
      if (tiles[i]!.terrain === 'deserto' && Math.abs(shade) < 0.05) {
        d[k] = 232; d[k + 1] = 207; d[k + 2] = 149; d[k + 3] = 18; // sabbia appena accennata
        continue;
      }
      const v = shade > 0 ? 228 : 0;
      d[k] = v; d[k + 1] = v + (shade > 0 ? 7 : 0); d[k + 2] = v + (shade > 0 ? 14 : 0);
      d[k + 3] = Math.min(255, Math.round(Math.abs(shade) * (shade > 0 ? 70 : 95)));
    }
    ctx.putImageData(img, 0, 0);
    tex.refresh();
    this.relief = this.add.image(0, 0.25 * S, key).setOrigin(0).setScale(HEX_W, 1.5 * S).setDepth(0.5);
  }


  /** Territorio: un solo colore pieno per potenza (sagome tinte); i nemici nella nebbia non si vedono. */
  /** Colore pieno di ogni fazione sulla carta (un po' smorzato verso il blu notte, come inchiostro sulla mappa). */
  private get ownTone(): number[] {
    const mix = (c: number, t: number) => {
      const d = 0x1a2433;
      const ch = (sh: number) => Math.round(((c >> sh) & 255) * (1 - t) + ((d >> sh) & 255) * t) << sh;
      return ch(16) | ch(8) | ch(0);
    };
    return FACTION_INFO.map((f, k) => mix(f.fill, k === PLAYER ? 0.12 : 0.22));
  }

  private redrawOwned() {
    this.territory.invalidate();
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
    for (let p = 0; p < own.length; p++) {
      const s = shapes[p];
      if (!s.parts.length || s.x1 < x0 || s.x0 > x1 || s.y1 < y0 || s.y0 > y1) continue;
      const o = own[p];
      if (o === NEUTRAL || (o !== PLAYER && !this.state.seesProv(p))) continue;
      out.push({ p, color: tone[o], alpha: 1, layer: 1 });
    }
    for (const [p, ok] of this.frontOk) {
      const s = shapes[p];
      if (s.x1 < x0 || s.x0 > x1 || s.y1 < y0 || s.y0 > y1) continue;
      out.push({ p, color: 0xffffff, alpha: ok ? 0.2 : 0.07, layer: 1 });
    }
    return out;
  }

  /** Da vicino il mare lo disegna lo strato vettoriale: copre la carta cotta, che ai bordi delle coste si vedrebbe sgranata. */
  private drawSeaInto(rt: Phaser.GameObjects.RenderTexture, x0: number, y0: number, w: number, h: number, z: number) {
    if (!this.landMode) return;
    const MP = PALETTE.mappa, g = this.seaGfx.clear().setPosition(-x0 * z, -y0 * z).setScale(z);
    g.fillStyle(MP.fondo, 1).fillRect(x0, y0, w, h);
    rt.draw(g);
    g.clear();
    const gl = this.glow, s = gl.scaleX;
    gl.setScale(s * z);
    rt.draw(gl, -x0 * z, -y0 * z);
    gl.setScale(s);
    // reticolo sottile (un pixel) sopra le acque basse
    const lw = 1.2 / z, { latMax, latMin } = BALANCE.map;
    g.lineStyle(lw, MP.reticolo, 1);
    for (let lon = -180; lon <= 180; lon += 15) { const x = this.lonX(lon); if (x >= x0 && x <= x0 + w) g.lineBetween(x, y0, x, y0 + h); }
    for (let lat = -45; lat <= 75; lat += 15) {
      if (lat > latMax || lat < latMin) continue;
      const y = this.latY(lat);
      if (y >= y0 && y <= y0 + h) g.lineStyle(lat === 0 ? lw * 1.7 : lw, MP.reticolo, 1).lineBetween(x0, y, x0 + w, y);
    }
    rt.draw(g);
    g.clear();
  }

  /** Il rilievo dentro lo strato vettoriale, tra la terra e il territorio. */
  private drawReliefInto(rt: Phaser.GameObjects.RenderTexture, x0: number, y0: number, _w: number, _h: number, z: number) {
    if (!this.landMode) return;
    const r = this.relief, sx = r.scaleX, sy = r.scaleY;
    r.setVisible(true).setScale(sx * z, sy * z);
    rt.draw(r, (r.x - x0) * z, (r.y - y0) * z);
    r.setScale(sx, sy).setVisible(false);
  }

  /**
   * Confini tra potenze: linee nitide di spessore costante sullo schermo, solo per i tratti inquadrati
   * (si ridisegnano quando cambia la mappa o ci si sposta).
   */
  private redrawBorders() {
    const cam = this.cameras.main, v = cam.worldView;
    const key = `${Math.round(v.x / 20)}:${Math.round(v.y / 20)}:${cam.zoom.toFixed(2)}`;
    if (key === this.borderKey) return;
    this.borderKey = key;
    const g = this.borderGfx.clear();
    const own = this.state.provOwner, provs = this.map.provinces, MP = PALETTE.mappa;
    const seen = (p: number) => (p < 0 ? NEUTRAL : own[p] !== PLAYER && !this.state.seesProv(p) ? NEUTRAL : own[p]);
    const z = cam.zoom / UI(); // zoom in punti CSS
    const px = 1 / z; // un punto sullo schermo, in pixel-mondo
    const step = z < 2.8 ? 4 : z < 5.2 ? 2 : 1; // da lontano meno punti
    const box = this.chainBox, m = 4;
    const inView = (k: number) => !(box[k * 4 + 2] < v.x - m || box[k * 4] > v.right + m || box[k * 4 + 3] < v.y - m || box[k * 4 + 1] > v.bottom + m);
    // carta politica: province sottili (solo da vicino), nazioni chiare, coste nette
    this.shapes.chains.forEach((c, k) => {
      if (!inView(k)) return;
      const pa = c.a >= 0 ? provs[c.a] : null, pb = c.b >= 0 ? provs[c.b] : null;
      if (pa && pb && pa.country === pb.country) {
        if (z < 3.6) return;
        g.lineStyle(1.1 * px, MP.provincia, 0.7);
      } else if (pa && pb) g.lineStyle(1.6 * px, MP.confine, 0.55);
      else g.lineStyle(1.3 * px, MP.costa, 0.7);
      this.strokeChain(g, c.pts, c.closed, step);
    });
    this.drawTerrainGlyphs(g, v, px, z);
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
    // prima un'ombra scura larga, poi la linea chiara: contorno netto e leggibile su mare, terra e altri colori
    for (const { k, o } of edges) {
      g.lineStyle((o === PLAYER ? 5 : 4) * px, 0x05090f, 0.55);
      this.strokeChain(g, this.shapes.chains[k].pts, this.shapes.chains[k].closed, step);
    }
    for (const { k, o } of edges) {
      g.lineStyle(o === PLAYER ? w * 1.3 : w, FACTION_INFO[o].border, 1);
      this.strokeChain(g, this.shapes.chains[k].pts, this.shapes.chains[k].closed, step);
    }
  }

  /** Simbolo + nome di ogni fazione nel punto più interno del suo territorio, più grande se l'impero cresce. */
  private placeNameTags() {
    // per province (non per caselle): la provincia più lontana dal confine di ogni fazione
    const own = this.state.provOwner, provs = this.map.provinces;
    const dist = new Int16Array(own.length).fill(-1);
    const queue: number[] = [];
    for (let p = 0; p < own.length; p++) {
      if (own[p] === NEUTRAL) continue;
      if (!provs[p].neighbors.length || provs[p].neighbors.some((q) => own[q] !== own[p])) {
        dist[p] = 0;
        queue.push(p);
      }
    }
    for (let h = 0; h < queue.length; h++) {
      const c = queue[h];
      for (const q of provs[c].neighbors) {
        if (dist[q] < 0 && own[q] === own[c]) {
          dist[q] = dist[c] + 1;
          queue.push(q);
        }
      }
    }
    const best = this.state.factions.map(() => -1);
    for (let p = 0; p < own.length; p++) {
      const o = own[p];
      if (o === NEUTRAL) continue;
      const b = best[o];
      if (b < 0 || dist[p] > dist[b] || (dist[p] === dist[b] && provs[p].tiles.length > provs[b].tiles.length)) best[o] = p;
    }
    this.state.factions.forEach((f, k) => {
      const tag = this.factionTags[k];
      const a = best[k] >= 0 ? provs[best[k]].anchor : -1;
      if (!f.alive || a < 0 || !this.state.sees(a)) return void (tag.visible = false); // niente nomi nella nebbia
      const { x, y } = center(a);
      const scale = f.kind === 'bot' ? 0.9 : Phaser.Math.Clamp(0.8 + Math.sqrt(f.tiles) * 0.03, 0.9, 1.6);
      if (!tag.visible) Object.assign(tag, { x, y, scale, visible: true });
      else this.tweens.add({ targets: tag, x, y, scale, duration: 450, ease: 'Sine.easeInOut' });
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
    for (const p of this.state.frontier()) {
      const { x, y } = center(this.map.provinces[p].anchor);
      if (x < view.x - S || x > view.right + S || y < view.y - S || y > view.bottom + S) continue;
      const def = this.state.provCost(PLAYER, p);
      const enemy = this.state.provOwner[p] !== NEUTRAL;
      this.frontLabels.push({ x, y, text: String(def), color: enemy ? PALETTE.ko : this.state.troops > def ? PALETTE.ok : PALETTE.mappa.segno });
    }
  }

  /** Piano della pausa strategica: le province in coda, numerate. */
  private syncPlan() {
    const plan = this.state.plan;
    const keep = new Set(plan);
    for (const [p, img] of this.planImgs) if (!keep.has(p)) { img.destroy(); this.planImgs.delete(p); }
    for (const p of plan) {
      if (this.planImgs.has(p)) continue;
      const img = this.add.graphics().setDepth(D.front).setAlpha(0.42).fillStyle(PALETTE.radioattivo, 1);
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

  private selectUnit(id: number | null) {
    this.selectedUnit = id;
    this.selRing.setVisible(id !== null);
    if (id !== null) this.hud.setHint('Tocca una casella: la pedina ci va conquistando la strada.');
    else if (!this.selectedCard) this.hud.setHint(null);
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
    // sul mare si possono solo mandare le navi
    if (!this.map.tiles[i]) {
      const u = this.selectedUnit !== null ? this.state.units.find((v) => v.id === this.selectedUnit) : undefined;
      if (u && isNaval(u.type) && this.state.order(u, i)) {
        this.floatText(x, y - 4, 'in rotta', PALETTE.radioattivo);
        this.selectUnit(null);
      }
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
    if (mine && mine.owner === PLAYER) return this.selectUnit(this.selectedUnit === mine.id ? null : mine.id);
    if (this.selectedUnit !== null) {
      const u = this.state.units.find((v) => v.id === this.selectedUnit);
      if (u && this.state.order(u, i)) {
        this.floatText(x, y - 4, 'avanti!', PALETTE.radioattivo);
        this.selectUnit(null);
        this.hud.tutorialSignal('order');
        return;
      }
      if (u) return this.failFx(x, y, 'irraggiungibile');
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
      this.floatText(x, y - 4, added ? `piano · ${this.state.plan.length}` : 'tolta dal piano', PALETTE.radioattivo);
      this.syncPlan();
      buzz(8);
      return;
    }

    if (!this.state.isFrontier(i)) {
      if (this.state.owner[i] === PLAYER) {
        if (this.state.flowTarget !== null || this.state.plan.length) {
          this.state.plan.length = 0; // alt: si ferma anche il piano
          this.state.stopFlow();
          this.floatText(x, y - 4, 'alt!', PALETTE.carta);
        } else this.hud.showProvince(p); // scheda della provincia: terreno, produzione, costruzioni
        return;
      }
      if (this.state.passable(i)) {
        if (!this.state.startFlow(i)) {
          // via terra non ci si arriva: si prova per mare
          const why = this.state.launchBoat(i);
          if (!why) {
            this.floatText(x, y - 6, 'nave in rotta!', PALETTE.carta);
            buzz(15);
            this.usage.navi++;
            return;
          }
          const msg = { locked: 'irraggiungibile', notCoast: 'sbarca su una costa', far: 'troppo mare', max: 'troppe navi in mare', troops: 'servono più truppe', peace: 'in pace: dichiara guerra prima' }[why];
          return this.failFx(x, y, msg);
        }
        this.flowMarker.setPosition(x, y).setVisible(true);
        this.floatText(x, y - 6, 'avanzata!', PALETTE.carta);
        this.hud.tutorialSignal('flow');
        this.usage.avanzate++;
        return;
      }
    }

    const res = this.state.tryConquer(i);
    if (res.ok) {
      this.usage.tocchi++;
      buzz(res.loot ? 25 : 8);
      this.tapFxTile = p;
      this.redrawOwned();
      this.redrawFrontier(true);
      this.conquestFx(x, y, res.cost, res.loot, res.lootType, p);
      this.hud.onConquest(res.loot);
    } else if (res.reason === 'troops') {
      this.failFx(x, y, `servono ${res.need! + 1}`);
    } else if (res.reason === 'not-adjacent') {
      this.failFx(x, y, 'troppo lontano');
    } else if (res.reason === 'impassable') {
      this.failFx(x, y, 'irraggiungibile');
    }
  }

  /** Fine run: un attimo per vedere cos'è successo, poi la schermata finale. */
  private finish() {
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
    this.nationLabels = this.map.nations.filter((n) => n.size >= BALANCE.provinces.nameMinTiles).sort((a, b) => b.size - a.size).map((n) => {
      const { x, y } = center(n.label), b = box.get(n.id) ?? [x - 10, x + 10];
      return { x, y, name: n.name.toUpperCase(), size: 0, width: b[1] - b[0], tile: n.label };
    });
  }

  /** Simboli del terreno da vicino: picchi sulle montagne, archi sulle colline (a scacchiera, per non affollare). */
  private drawTerrainGlyphs(g: Phaser.GameObjects.Graphics, v: Phaser.Geom.Rectangle, px: number, z: number) {
    if (z < 4.4) return;
    const { cols, rows } = BALANCE.map;
    const r0 = Math.max(0, Math.floor((v.y - 2 * S) / (1.5 * S))), r1 = Math.min(rows - 1, Math.ceil((v.bottom + 2 * S) / (1.5 * S)));
    const hw = Math.sqrt(3) * S;
    const c0 = Math.max(0, Math.floor(v.x / hw) - 1), c1 = Math.min(cols - 1, Math.ceil(v.right / hw) + 1);
    const tiles = this.map.tiles;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const i = r * cols + c, t = tiles[i];
      if (!t || t.terrain === 'pianura' || t.terrain === 'deserto') continue;
      const { x, y } = center(i);
      if (t.terrain === 'montagne') {
        if ((c + 2 * r) % 3) continue; // una su tre: catene leggibili, non un tappeto
        const h = S * 1.05;
        g.lineStyle(1.3 * px, 0xeef2f6, 0.45).strokePoints([{ x: x - h, y: y + h * 0.55 }, { x, y: y - h * 0.65 }, { x: x + h, y: y + h * 0.55 }], false);
        g.lineStyle(1 * px, 0xeef2f6, 0.35).lineBetween(x - h * 0.3, y - h * 0.25, x + h * 0.05, y + h * 0.05); // cresta innevata
      } else if ((2 * c + r) % 5 === 0) {
        g.lineStyle(1.1 * px, 0xdfe6ee, 0.3).beginPath().arc(x, y + S * 0.35, S * 0.65, Math.PI * 1.15, Math.PI * 1.85).strokePath();
      }
    }
  }

  /** Costruzioni nelle province inquadrate (le tue e quelle nemiche che vedi): icona e cantiere con l'avanzamento. */
  private drawWorks(g: Phaser.GameObjects.Graphics, v: Phaser.Geom.Rectangle, px: number) {
    const st = this.state;
    for (let p = 0; p < st.provWork.length; p++) {
      const w = st.provWork[p];
      if (w < 0) continue;
      const o = st.provOwner[p];
      if (o !== PLAYER && !st.seesProv(p)) continue;
      const a = this.map.provinces[p].anchor;
      const { x: cx, y: cy } = center(a);
      const x = cx + 9 * px, y = cy - 7 * px;
      if (x < v.x - 20 || x > v.right + 20 || y < v.y - 20 || y > v.bottom + 20) continue;
      const r = 7 * px, col = o >= 0 ? FACTION_INFO[o].border : PALETTE.carta;
      g.fillStyle(PALETTE.inchiostro, 0.88).fillCircle(x, y, r).lineStyle(1.4 * px, col, 1).strokeCircle(x, y, r);
      drawWorkIcon(g, WORKS[w], x, y, r * 0.62, col);
      const prog = st.workInProgress(p);
      if (prog) {
        const k = 1 - prog.leftMs / BALANCE.works[prog.work].timeMs;
        g.lineStyle(2 * px, PALETTE.allerta, 1).beginPath().arc(x, y, r + 2.5 * px, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k).strokePath();
      }
    }
  }

  /** Città (punto), capitali (stella dorata) e insediamenti (rombo) inquadrati: dimensione costante sullo schermo. */
  private drawCities(g: Phaser.GameObjects.Graphics, v: Phaser.Geom.Rectangle, px: number) {
    const MP = PALETTE.mappa, z = 1 / px;
    const inV = (x: number, y: number) => x > v.x - 8 && x < v.right + 8 && y > v.y - 8 && y < v.bottom + 8;
    if (z >= 5.9) {
      g.fillStyle(MP.segno, 0.55);
      for (const i of this.ruinTiles) {
        const { x, y } = center(i);
        if (!inV(x, y)) continue;
        const r = 2.2 * px;
        g.fillPoints([{ x, y: y - r }, { x: x + r, y }, { x, y: y + r }, { x: x - r, y }], true);
      }
    }
    for (const p of this.map.provinces) {
      if (p.city < 0) continue;
      const { x, y } = center(p.city);
      if (!inV(x, y)) continue;
      if (this.map.tiles[p.city]!.capital) {
        const star: Phaser.Types.Math.Vector2Like[] = [];
        for (let k = 0; k < 10; k++) {
          const a = -Math.PI / 2 + (k * Math.PI) / 5, r = (k % 2 ? 2.6 : 6.2) * px * Phaser.Math.Clamp(z / 4, 0.6, 1); // da lontano più piccole
          star.push({ x: x + r * Math.cos(a), y: y + r * Math.sin(a) });
        }
        g.fillStyle(MP.capitale, 1).fillPoints(star, true).lineStyle(1 * px, 0x000000, 0.6).strokePoints(star, true, true);
      } else if (z >= 4.2) {
        g.fillStyle(0x000000, 0.5).fillCircle(x, y, 3 * px).fillStyle(MP.segno, 0.95).fillCircle(x, y, 2 * px);
      }
    }
  }

  /** Lampo su tutta la sagoma della provincia. */
  private flashProvince(p: number, color: number, from: number, ms: number) {
    const g = this.add.graphics().setDepth(D.fx).setAlpha(from).fillStyle(color, 1);
    fillProvince(g, this.shapes.provinces[p]);
    this.tweens.add({ targets: g, alpha: 0, duration: ms, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
  }

  /** Ricognizione: aereo che attraversa e anello che si apre; bombardamento: mirino, poi esplosioni. */
  private abilityFx(a: AbilityType, tile: number, phase: 'launch' | 'impact', hits: number) {
    const { x, y } = center(tile);
    const R = S * 1.7;
    if (a === 'ricognizione') {
      const plane = this.add.graphics({ x: x - 160, y: y + 60 }).setDepth(12);
      drawAbilityIcon(plane, 'ricognizione', 0, 0, 7, PALETTE.radioattivo);
      plane.setRotation(Math.atan2(-60, 160) + Math.PI / 2);
      this.tweens.add({ targets: plane, x: x + 160, y: y - 60, duration: 1400, ease: 'Sine.easeInOut', onComplete: () => plane.destroy() });
      const ring = this.add.circle(x, y, R * BALANCE.abilities.ricognizione.radius * 0.6).setStrokeStyle(1.5, PALETTE.radioattivo).setDepth(11);
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
      const boom = this.add.circle(x + ox, y + oy, R * 0.6, 0xffb547, 0.9).setDepth(12).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: boom, scale: { from: 0.3, to: 2.2 }, alpha: 0, delay: k * 90, duration: 500, onComplete: () => boom.destroy() });
    }
    this.cameras.main.shake(260, 0.006);
    buzz([40, 30, 60]);
    this.ownedDirty = true;
    this.floatText(x, y - 8, hits ? `colpiti ${hits}` : 'nessun bersaglio', hits ? PALETTE.ok : PALETTE.carta);
  }

  private conquestFx(x: number, y: number, cost: number, loot: number, lootType: Resource = 'metallo', p = -1) {
    if (p >= 0) this.flashProvince(p, 0xffffff, 0.75, 480);
    this.burstAt(x, y, loot ? 18 : 10, loot ? RESOURCE_INFO[lootType].color : PALETTE.carta);
    this.floatText(x, y - 4, `-${cost}`, PALETTE.carta);
    if (loot) {
      this.floatText(x, y + 8, `+${loot} ${RESOURCE_INFO[lootType].name.toLowerCase()}`, RESOURCE_INFO[lootType].color, 160);
      this.cameras.main.shake(120, 0.003);
    }
  }

  // ---------- pedine: disegno ----------

  private makeUnitSprite(u: Unit) {
    const f = FACTION_INFO[u.owner], mine = u.owner === PLAYER;
    const g = this.add.graphics();
    drawUnitSymbol(g, u.type, mine, mine ? PALETTE.radioattivo : f.fill);
    const hp = this.add.graphics();
    const { x, y } = center(u.tile);
    const c = this.add.container(x, y, [g, hp]).setDepth(D.units);
    const pop = { k: 0.2 };
    this.tweens.add({ targets: pop, k: 1, duration: 260, ease: 'Back.easeOut' });
    return { c, hp, tile: u.tile, hpShown: -1, pop };
  }

  /** Pedine, navi e segnalini a grandezza costante sullo schermo (come i contatti su un radar). */
  private scaleMarkers() {
    const s = UI() / this.cameras.main.zoom;
    for (const sp of this.unitSprites.values()) sp.c.setScale(s * sp.pop.k);
    for (const b of this.boatSprites.values()) b.setScale(s * 0.9);
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
        const dur = Math.min(400, BALANCE.units[u.type].moveMs / this.state.speed);
        this.tweens.add({ targets: sp.c, x, y, duration: dur, ease: 'Sine.easeInOut' });
      }
      const hpPct = Math.round((u.hp / u.maxHp) * 10);
      if (hpPct !== sp.hpShown) {
        sp.hpShown = hpPct;
        drawUnitHp(sp.hp, hpPct / 10, u.owner === PLAYER);
      }
    }
    for (const [id, sp] of this.unitSprites) {
      if (alive.has(id)) continue;
      sp.c.destroy();
      this.unitSprites.delete(id);
    }
    if (this.selectedUnit !== null && !alive.has(this.selectedUnit)) this.selectUnit(null);

    // percorsi delle nostre pedine + anello di selezione
    const g = this.pathGfx.clear(), px = UI() / this.cameras.main.zoom; // un punto sullo schermo, in pixel-mondo
    for (const u of this.state.unitsOf(PLAYER)) {
      if (!u.path.length) continue;
      const sel = u.id === this.selectedUnit;
      g.lineStyle((sel ? 2 : 1.4) * px, PALETTE.radioattivo, sel ? 0.9 : 0.45);
      const pts = [u.tile, ...u.path].map(center);
      g.strokePoints(pts, false);
      const end = pts[pts.length - 1];
      g.fillStyle(PALETTE.radioattivo, sel ? 0.9 : 0.5).fillCircle(end.x, end.y, 3.5 * px);
    }
    if (this.selectedUnit !== null) {
      const sp = this.unitSprites.get(this.selectedUnit);
      if (sp) this.selRing.setPosition(sp.c.x, sp.c.y);
    }
  }

  // ---------- nebbia e navi ----------

  /** Nebbia in una texture a mezza risoluzione (bordi morbidi, costa poco): si ridisegna solo quando la vista cambia. */
  /** Nebbia: una texture con un pixel per casella (alpha = mai visto / esplorato / in vista), ingrandita e sfumata. */
  private makeFog(on: boolean) {
    const { cols, rows } = BALANCE.map, key = 'fog';
    if (this.textures.exists(key)) this.textures.remove(key);
    this.fogTex = this.textures.createCanvas(key, cols, rows);
    this.add.image(0, 0.25 * S, key).setOrigin(0).setScale(HEX_W, 1.5 * S).setDepth(D.fog).setVisible(on && BALANCE.fog.shade);
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
    g.lineStyle(1.4, PALETTE.carta, 1).strokePoints([{ x: -9, y: -2 }, { x: 9, y: -2 }, { x: 6, y: 4 }, { x: -6, y: 4 }], true);
    g.fillStyle(PALETTE.carta, 1).fillRect(-3, -7, 6, 5); // cabina
    const lbl = this.add.text(0, -14, String(b.troops), textStyle(9, PALETTE.carta)).setOrigin(0.5).setResolution(3);
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
        const wake = this.add.circle(sp.x, sp.y + 3, 3, PALETTE.carta, 0.5).setDepth(7);
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
      this.floatText(x, y - 8, 'sbarco!', PALETTE.carta);
      buzz(30);
    } else {
      this.failFx(x, y, 'sbarco respinto');
      buzz([20, 40, 20]);
    }
  }

  private unitDeathFx(u: Unit) {
    const sp = this.unitSprites.get(u.id);
    const { x, y } = sp ? { x: sp.c.x, y: sp.c.y } : center(u.tile);
    this.burstAt(x, y, 14, FACTION_INFO[u.owner].fill);
    if (u.owner === PLAYER) {
      this.floatText(x, y - 6, `${unitInfo(u.type).short} caduta`, PALETTE.ko);
      buzz(40);
    }
  }

  /** Scintille a misura di schermo (velocità e grandezza seguono lo zoom). */
  private burstAt(x: number, y: number, n: number, tint: number) {
    const s = UI() / this.cameras.main.zoom;
    const e = this.add.particles(x, y, 'dot', {
      speed: { min: 30 * s, max: 95 * s }, lifespan: 450, scale: { start: 1.1 * s, end: 0 }, alpha: { start: 1, end: 0 }, tint, emitting: false,
    }).setDepth(D.fx + 1);
    e.explode(n);
    this.time.delayedCall(600, () => e.destroy());
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
    ring.lineStyle(1.5, PALETTE.ko, 1).strokeCircle(0, 0, S * 1.2);
    this.tweens.add({ targets: ring, alpha: 0, duration: 500, onComplete: () => ring.destroy() });
    this.tweens.add({ targets: ring, x: { from: x - 2, to: x }, duration: 60, repeat: 3, yoyo: true });
    this.floatText(x, y - 4, msg, PALETTE.ko);
  }

  private floatText(x: number, y: number, msg: string, color: number, delay = 0) {
    this.hud.floatAt(x, y, msg, color, delay); // nitida: la disegna l'interfaccia
  }

  // ---------- camera & input ----------

  private setupCamera() {
    const cam = this.cameras.main;
    const m = 400;
    cam.setBounds(-m, -m, WORLD_W + 2 * m, WORLD_H + 2 * m);
    cam.setZoom(CAM.startZoom * UI()); // lo zoom della camera conta i pixel reali dello schermo
    const { x, y } = center(this.map.starts[0]);
    cam.centerOn(x, y);
  }

  private zoomAt(sx: number, sy: number, z: number) {
    const cam = this.cameras.main;
    const nz = Phaser.Math.Clamp(z, CAM.minZoom * UI(), CAM.maxZoom * UI());
    const w = cam.width / 2, h = cam.height / 2;
    const wx = cam.scrollX + w + (sx - w) / cam.zoom;
    const wy = cam.scrollY + h + (sy - h) / cam.zoom;
    cam.setZoom(nz);
    cam.scrollX = wx - w - (sx - w) / nz;
    cam.scrollY = wy - h - (sy - h) / nz;
    this.labelTimer = 0;
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
        const i = this.tileAt(p.x, p.y);
        const mine = i >= 0 && (this.state.owner[i] === PLAYER || this.state.isFrontier(i));
        this.dragMode = mine && !this.selectedCard && this.selectedUnit === null && !this.state.over ? 'paint' : 'pan';
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
        if (this.pinchDist > 0) this.zoomAt(mid.x, mid.y, cam.zoom * (d / this.pinchDist));
        if (this.lastMid) {
          cam.scrollX -= (mid.x - this.lastMid.x) / cam.zoom;
          cam.scrollY -= (mid.y - this.lastMid.y) / cam.zoom;
        }
        this.pinchDist = d;
        this.lastMid = mid;
        this.dragging = true;
        return;
      }
      if (!this.down || !p.isDown) return;
      if (!this.dragging && Phaser.Math.Distance.Between(p.x, p.y, this.down.x, this.down.y) > CAM.dragThreshold * DPR) {
        this.dragging = true;
        this.pressTimer?.remove();
      }
      if (this.dragging) {
        if (this.dragMode === 'paint') {
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
      if (this.longPressed) {
        this.longPressed = false; // tenuto premuto: la scheda è già aperta
      } else if (this.down && !this.dragging && this.activePointers().length === 0) {
        const tag = this.hud.tagAt(p.x / UI(), p.y / UI());
        if (tag > 0 && !this.selectedCard && this.selectedUnit === null && !this.selectedAbility) this.hud.showProfile(tag);
        else this.tapTile(this.tileAt(p.x, p.y));
      }
      if (this.activePointers().length === 0) this.down = null;
      this.pinchDist = 0;
      this.lastMid = null;
    });

    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.zoomAt(p.x, p.y, this.cameras.main.zoom * (dy > 0 ? 0.88 : 1.14));
    });
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
