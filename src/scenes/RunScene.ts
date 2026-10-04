import Phaser from 'phaser';
import { BALANCE, type AbilityType, type Resource, type UnitType } from '../config/balance';
import buildingText from '../data/buildings.json';
import { RESOURCE_INFO } from '../game/resources';
import { runOptions, settle, type RunOptions } from '../game/camp';
import { loadPrefs, loadProfile, saveProfile } from '../save/storage';
import { analytics } from '../analytics/analytics';
import { PALETTE } from '../config/palette';
import { generateMap, type RunMap } from '../map/generate';
import { NEIGHBORS, WORLD_H, WORLD_W, center, corners, pixelToIndex } from '../map/hexGrid';
import { buildShapes, provinceAtPoint, type MapShapes } from '../map/provinceShapes';
import { loadWorld } from '../map/worldAsset';
import { ProvinceLayer } from '../render/ProvinceLayer';
import { NEUTRAL, PLAYER, RunState, WORKS } from '../game/RunState';
import { WORK_NAME, drawWorkIcon } from '../ui/workIcons';
import { FACTION_INFO, assignFactions } from '../game/factions';
import { textStyle } from '../ui/style';
import { drawSymbol } from '../ui/symbols';
import { DPR, LOW_END, UI } from '../ui/screen';
import type { FactionTag, NationLabel, WorldLabel } from '../render/MapLabels';
import { buzz } from '../ui/haptics';
import { drawAbilityIcon, drawUnitIcon } from '../ui/unitIcons';
import { isNaval, unitInfo, type Unit } from '../game/units';
import type { Boat } from '../game/boats';
import type { HudScene } from './HudScene';

const S = BALANCE.map.hexSize;
// profondità dei livelli della mappa
const D = { owned: 1, borders: 2, front: 3, marks: 4, path: 7, units: 8, fx: 9 };
const FOG_RES = 0.5; // la nebbia non ha bisogno di dettaglio: mezza risoluzione, bordi morbidi
const CAM = BALANCE.camera;


export class RunScene extends Phaser.Scene {
  state!: RunState;
  map!: RunMap;
  /** forme smussate delle province (bordi, sagome) */
  shapes!: MapShapes;
  private ownLayer!: ProvinceLayer;
  private borderGfx!: Phaser.GameObjects.Graphics;
  private borderKey = '';
  private chainBox: Float32Array = new Float32Array(0);
  private ruinTiles: number[] = [];
  private workTimer = 0;
  private frontImgs = new Map<number, Phaser.GameObjects.Image>();
  private planImgs = new Map<number, Phaser.GameObjects.Image>();
  /** Etichette per l'interfaccia (spazio schermo, sempre nitide). */
  nationLabels: NationLabel[] = [];
  frontLabels: WorldLabel[] = [];
  factionTags: FactionTag[] = [];
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;
  private labelTimer = 0;
  private lastAffordable = '';
  private ownedDirty = false;
  private nameTimer = 0;
  private lastHitFx = 0;
  private fogRT!: Phaser.GameObjects.RenderTexture;
  private fogBrush!: Phaser.GameObjects.Graphics;
  private fogVersion = -1;
  private boatSprites = new Map<number, Phaser.GameObjects.Container>();
  private nationNames: Phaser.GameObjects.Text[] = [];
  private namesShown = true;
  private flowMarker!: Phaser.GameObjects.Graphics;
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
  private unitSprites = new Map<number, { c: Phaser.GameObjects.Container; hp: Phaser.GameObjects.Graphics; tile: number; hpShown: number }>();
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
    this.map = generateMap(data.seed, loadWorld(), opts.tutorial ? BALANCE.tutorial.aiCount : BALANCE.ai.count);
    assignFactions(opts.civ); // fazione 0 = civiltà scelta, le IA sono le altre potenze
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
    this.drawLand();
    this.bakeStatic(this.children.list.slice(before));
    this.drawRelief();
    this.ownLayer?.destroy(this);
    this.ownLayer = new ProvinceLayer(this, this.shapes.provinces, LOW_END ? 1.2 : 1.8, D.owned);
    this.borderGfx = this.add.graphics().setDepth(D.borders);
    this.borderKey = '';
    this.frontImgs = new Map();
    this.planImgs = new Map();
    // nebbia sopra i colori delle fazioni ma sotto anomalie, tempesta e pedine
    this.fogVersion = -1;
    this.namesShown = true;
    this.fogRT = this.add.renderTexture(0, 0, Math.ceil(WORLD_W * FOG_RES), Math.ceil(WORLD_H * FOG_RES)).setOrigin(0).setScale(1 / FOG_RES)
      .setVisible(opts.fog);
    this.fogBrush = this.make.graphics({}, false);
    this.boatSprites = new Map();
    this.drawAnomalies();
    this.flowMarker = this.add.graphics().setDepth(D.units).setVisible(false);
    this.flowMarker.lineStyle(2.5, 0xffffff, 1).strokeCircle(0, 0, S * 0.9).lineStyle(1.5, 0xffffff, 0.8).strokeCircle(0, 0, S * 0.45);
    this.tweens.add({ targets: this.flowMarker, scale: { from: 0.8, to: 1.25 }, duration: 380, yoyo: true, repeat: -1 });
    this.ending = false;
    this.burst = this.add.particles(0, 0, 'dot', {
      speed: { min: 40, max: 140 },
      lifespan: 450,
      scale: { start: 0.9, end: 0 },
      alpha: { start: 1, end: 0 },
      emitting: false,
    }).setDepth(D.fx + 1);

    this.nameTimer = 0;

    this.selectedCard = null;
    this.selectedUnit = null;
    this.unitSprites = new Map();
    this.pathGfx = this.add.graphics().setDepth(D.path);
    this.selRing = this.add.graphics().setDepth(D.units).setVisible(false);
    this.selRing.lineStyle(2.5, PALETTE.radioattivo, 1).strokeCircle(0, 0, S * 0.95);
    this.tweens.add({ targets: this.selRing, scale: 1.15, duration: 450, yoyo: true, repeat: -1 });

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
        if (this.state.provAnomaly[e.p] && e.by !== NEUTRAL && (e.by === PLAYER || e.from === PLAYER)) {
          if (e.by === PLAYER) this.anomalyFx(this.map.anomalies.find((a) => this.map.tiles[a]!.province === e.p) ?? e.i);
          this.hud.onAnomaly(this.state.anomaliesOwned(), e.by === PLAYER);
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
      } else {
        this.hud.onEliminated(e.faction, e.by, e.loot);
      }
    }
    this.syncUnits();
    this.syncBoats();
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
    // acque basse: alone largo e morbido lungo le coste
    for (const [w, a] of [[7, 0.16], [3.5, 0.3]] as const) {
      g.lineStyle(w, MP.mareCosta, a);
      for (const c of this.shapes.chains) if (c.a < 0 || c.b < 0) this.strokeChain(g, c.pts, c.closed);
    }
  }

  private strokeChain(g: Phaser.GameObjects.Graphics, pts: number[], closed: boolean, step = 1) {
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
    const pts = (r: number[]) => {
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
    const R = 0.5; // pixel di texture per pixel-mondo
    const rt = this.add.renderTexture(0, 0, Math.ceil(WORLD_W * R), Math.ceil(WORLD_H * R)).setOrigin(0).setScale(1 / R).setDepth(0.5);
    const g = this.make.graphics({}, false);
    for (const i of this.map.land) {
      const t = this.map.tiles[i]!.terrain;
      if (t === 'pianura') continue;
      const { x, y } = center(i);
      // macchie larghe e tenui: si sovrappongono tra caselle vicine e sfumano invece di fare un mosaico
      if (t === 'deserto') {
        g.fillStyle(0xe8cf95, 0.045).fillCircle(x * R, y * R, S * 2.2 * R);
        continue;
      }
      const k = t === 'montagne' ? 1 : 0.45;
      g.fillStyle(0xe4ebf2, 0.05 * k).fillCircle((x - S * 0.6) * R, (y - S * 0.65) * R, S * 2.4 * R);
      g.fillStyle(0x000000, 0.065 * k).fillCircle((x + S * 0.65) * R, (y + S * 0.7) * R, S * 2.2 * R);
    }
    rt.draw(g);
    g.destroy();
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
    const own = this.state.provOwner, tone = this.ownTone;
    for (let p = 0; p < own.length; p++) {
      const o = own[p];
      const hidden = o !== PLAYER && !this.state.seesProv(p);
      this.ownLayer.set(p, o === NEUTRAL || hidden ? null : tone[o], 1);
    }
    this.borderKey = ''; // confini da ridisegnare
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
    const step = z < 1.6 ? 4 : z < 3 ? 2 : 1; // da lontano meno punti
    const box = this.chainBox, m = 4;
    const inView = (k: number) => !(box[k * 4 + 2] < v.x - m || box[k * 4] > v.right + m || box[k * 4 + 3] < v.y - m || box[k * 4 + 1] > v.bottom + m);
    // carta politica: province sottili (solo da vicino), nazioni chiare, coste nette
    this.shapes.chains.forEach((c, k) => {
      if (!inView(k)) return;
      const pa = c.a >= 0 ? provs[c.a] : null, pb = c.b >= 0 ? provs[c.b] : null;
      if (pa && pb && pa.country === pb.country) {
        if (z < 2.1) return;
        g.lineStyle(1.1 * px, MP.provincia, 0.7);
      } else if (pa && pb) g.lineStyle(1.6 * px, MP.confine, 0.55);
      else g.lineStyle(1.3 * px, MP.costa, 0.7);
      this.strokeChain(g, c.pts, c.closed, step);
    });
    this.drawTerrainGlyphs(g, v, px, z);
    this.drawCities(g, v, px);
    this.drawWorks(g, v, px);
    // confini tra potenze, sopra
    const w = 2.2 * px;
    this.shapes.chains.forEach((c, k) => {
      const oa = seen(c.a), ob = seen(c.b);
      if (oa === ob || !inView(k)) return;
      const o = oa === PLAYER || ob === PLAYER ? PLAYER : oa !== NEUTRAL ? oa : ob;
      g.lineStyle(o === PLAYER ? w * 1.25 : w, FACTION_INFO[o].border, 1);
      this.strokeChain(g, c.pts, c.closed, step);
    });
  }

  /** Simbolo + nome di ogni fazione nel punto più interno del suo territorio, più grande se l'impero cresce. */
  private placeNameTags() {
    const own = this.state.owner;
    const dist = new Int16Array(own.length).fill(-1);
    const queue: number[] = [];
    for (let i = 0; i < own.length; i++) {
      if (own[i] === NEUTRAL) continue;
      if (NEIGHBORS[i].some((n) => n < 0 || own[n] !== own[i])) {
        dist[i] = 0;
        queue.push(i);
      }
    }
    for (let h = 0; h < queue.length; h++) {
      const c = queue[h];
      for (const n of NEIGHBORS[c]) {
        if (n >= 0 && dist[n] < 0 && own[n] === own[c]) {
          dist[n] = dist[c] + 1;
          queue.push(n);
        }
      }
    }
    const best = this.state.factions.map(() => -1);
    for (let i = 0; i < own.length; i++) {
      const o = own[i];
      if (o !== NEUTRAL && (best[o] < 0 || dist[i] > dist[best[o]])) best[o] = i;
    }
    this.state.factions.forEach((f, k) => {
      const tag = this.factionTags[k];
      if (!f.alive || best[k] < 0 || !this.state.sees(best[k])) return void (tag.visible = false); // niente nomi nella nebbia
      const { x, y } = center(best[k]);
      const scale = Phaser.Math.Clamp(0.8 + Math.sqrt(f.tiles) * 0.03, 0.9, 1.6);
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
    const keep = new Set(front);
    for (const [p, img] of this.frontImgs) if (!keep.has(p)) { img.destroy(); this.frontImgs.delete(p); }
    front.forEach((p, k) => {
      let img = this.frontImgs.get(p);
      if (!img) {
        const g = this.ownLayer.ghost(this, p, 0xffffff, 0, D.front);
        if (!g) return;
        this.frontImgs.set(p, (img = g));
      }
      img.setAlpha(ok[k] ? 0.2 : 0.06);
    });
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
      const img = this.ownLayer.ghost(this, p, PALETTE.radioattivo, 0.42, D.front);
      if (!img) continue;
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
          const msg = { locked: 'irraggiungibile', notCoast: 'sbarca su una costa', far: 'troppo mare', max: 'troppe navi in mare', troops: 'servono più truppe' }[why];
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
      this.failFx(x, y, 'tossico');
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

  // ---------- anomalie e tempesta ----------

  /** Anomalie: anelli di segnale che pulsano, sopra il colore del proprietario. */
  /** Nomi delle nazioni: li disegna l'interfaccia in giallo terminale (vedi MapLabels). */
  private drawNationNames() {
    this.nationLabels = this.map.nations.filter((n) => n.size >= BALANCE.provinces.nameMinTiles).map((n) => {
      const { x, y } = center(n.label);
      return { x, y, name: n.name.toUpperCase(), size: Phaser.Math.Clamp(8 + Math.sqrt(n.size) * 0.45, 9, 16) };
    });
  }

  /** Simboli del terreno da vicino: picchi sulle montagne, archi sulle colline (a scacchiera, per non affollare). */
  private drawTerrainGlyphs(g: Phaser.GameObjects.Graphics, v: Phaser.Geom.Rectangle, px: number, z: number) {
    if (z < 2.9) return;
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
    if (z >= 3.4) {
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
          const a = -Math.PI / 2 + (k * Math.PI) / 5, r = (k % 2 ? 2.6 : 6.2) * px;
          star.push({ x: x + r * Math.cos(a), y: y + r * Math.sin(a) });
        }
        g.fillStyle(MP.capitale, 1).fillPoints(star, true).lineStyle(1 * px, 0x000000, 0.6).strokePoints(star, true, true);
      } else if (z >= 2.4) {
        g.fillStyle(0x000000, 0.5).fillCircle(x, y, 3 * px).fillStyle(MP.segno, 0.95).fillCircle(x, y, 2 * px);
      }
    }
  }

  /** Anomalie: frammenti della Caduta, anelli di luce fredda che pulsano sopra il colore del proprietario. */
  private drawAnomalies() {
    this.drawNationNames();
    const g = this.add.graphics().setDepth(D.marks);
    for (const i of this.map.anomalies) {
      const { x, y } = center(i);
      g.lineStyle(0.9, PALETTE.mappa.segnale, 1).strokeCircle(x, y, S * 0.45).strokeCircle(x, y, S * 0.85);
      g.fillStyle(0xffffff, 1).fillCircle(x, y, 1.1);
      const pulse = this.add.graphics({ x, y }).setDepth(D.marks);
      pulse.lineStyle(1, PALETTE.mappa.segnale, 1).strokeCircle(0, 0, S * 0.8);
      this.tweens.add({ targets: pulse, scale: { from: 0.6, to: 2.4 }, alpha: { from: 0.9, to: 0 }, duration: 1800, repeat: -1 });
    }
  }

  /** Lampo su tutta la sagoma della provincia. */
  private flashProvince(p: number, color: number, from: number, ms: number) {
    const g = this.ownLayer.ghost(this, p, color, from, D.fx);
    if (!g) return;
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
    this.burst.setParticleTint(loot ? RESOURCE_INFO[lootType].color : PALETTE.carta);
    this.burst.explode(loot ? 18 : 10, x, y);
    this.floatText(x, y - 4, `-${cost}`, PALETTE.carta);
    if (loot) {
      this.floatText(x, y + 8, `+${loot} ${RESOURCE_INFO[lootType].name.toLowerCase()}`, RESOURCE_INFO[lootType].color, 160);
      this.cameras.main.shake(120, 0.003);
    }
  }

  // ---------- pedine: disegno ----------

  private makeUnitSprite(u: Unit) {
    const f = FACTION_INFO[u.owner];
    const g = this.add.graphics();
    g.fillStyle(f.fill, 1).fillCircle(0, 0, S * 0.72);
    g.lineStyle(1.8, u.owner === PLAYER ? PALETTE.carta : f.border, 1).strokeCircle(0, 0, S * 0.72);
    drawUnitIcon(g, u.type, 0, 0, S * 0.42, PALETTE.carta);
    drawSymbol(g, f.symbol, S * 0.62, -S * 0.62, S * 0.26, f.fill, PALETTE.carta);
    const hp = this.add.graphics();
    const { x, y } = center(u.tile);
    const c = this.add.container(x, y, [g, hp]).setDepth(8);
    c.setScale(0.2);
    this.tweens.add({ targets: c, scale: 1.4, duration: 260, ease: 'Back.easeOut' }); // pedine leggibili sopra le province
    return { c, hp, tile: u.tile, hpShown: -1 };
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
        sp.hp.clear().fillStyle(PALETTE.inchiostro, 0.9).fillRect(-S * 0.7, S * 0.82, S * 1.4, 2.6);
        sp.hp.fillStyle(hpPct > 4 ? PALETTE.radioattivo : PALETTE.ko, 1).fillRect(-S * 0.7, S * 0.82, S * 1.4 * (hpPct / 10), 2.6);
      }
    }
    for (const [id, sp] of this.unitSprites) {
      if (alive.has(id)) continue;
      sp.c.destroy();
      this.unitSprites.delete(id);
    }
    if (this.selectedUnit !== null && !alive.has(this.selectedUnit)) this.selectUnit(null);

    // percorsi delle nostre pedine + anello di selezione
    const g = this.pathGfx.clear();
    for (const u of this.state.unitsOf(PLAYER)) {
      if (!u.path.length) continue;
      const sel = u.id === this.selectedUnit;
      g.lineStyle(sel ? 2 : 1.4, PALETTE.radioattivo, sel ? 0.9 : 0.45);
      const pts = [u.tile, ...u.path].map(center);
      g.strokePoints(pts, false);
      const end = pts[pts.length - 1];
      g.fillStyle(PALETTE.radioattivo, sel ? 0.9 : 0.5).fillCircle(end.x, end.y, 2.5);
    }
    if (this.selectedUnit !== null) {
      const sp = this.unitSprites.get(this.selectedUnit);
      if (sp) this.selRing.setPosition(sp.c.x, sp.c.y);
    }
  }

  // ---------- nebbia e navi ----------

  /** Nebbia in una texture a mezza risoluzione (bordi morbidi, costa poco): si ridisegna solo quando la vista cambia. */
  private redrawFog() {
    const st = this.state, F = BALANCE.fog;
    this.fogVersion = st.fogVersion;
    this.ownedDirty = true; // i nemici compaiono/spariscono con la vista
    if (!F.shade) return; // niente velo scuro: l'ignoto si vede, ma senza nemici
    const g = this.fogBrush.clear().setScale(FOG_RES);
    for (const i of this.map.land) {
      if (st.visible[i]) continue;
      const { x, y } = center(i);
      g.fillStyle(PALETTE.oceano, st.seen[i] ? F.seenAlpha : F.unseenAlpha);
      g.fillPoints(corners(x, y, S + 0.6), true);
    }
    this.fogRT.clear();
    this.fogRT.draw(g);
  }

  private makeBoat(b: Boat) {
    const f = FACTION_INFO[b.owner];
    const g = this.add.graphics();
    g.fillStyle(f.fill, 1).fillPoints([{ x: -9, y: -2 }, { x: 9, y: -2 }, { x: 6, y: 4 }, { x: -6, y: 4 }], true);
    g.lineStyle(1.4, PALETTE.carta, 1).strokePoints([{ x: -9, y: -2 }, { x: 9, y: -2 }, { x: 6, y: 4 }, { x: -6, y: 4 }], true);
    g.fillStyle(PALETTE.carta, 1).fillRect(-3, -7, 6, 5); // cabina
    const lbl = this.add.text(0, -14, String(b.troops), textStyle(9, PALETTE.carta)).setOrigin(0.5).setResolution(3);
    const { x, y } = center(b.from);
    const c = this.add.container(x, y, [g, lbl]).setDepth(8).setScale(0.6); // esagoni piccoli: nave in scala
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
    this.burst.setParticleTint(FACTION_INFO[u.owner].fill);
    this.burst.explode(14, x, y);
    if (u.owner === PLAYER) {
      this.floatText(x, y - 6, `${unitInfo(u.type).short} caduta`, PALETTE.ko);
      buzz(40);
    }
  }

  /** Provincia appena presa (avanzata, pittura, pedine): lampo leggero sulla sagoma. */
  private popFx(p: number) {
    this.flashProvince(p, 0xffffff, 0.5, 360);
  }

  /** Anomalia presa: onda del segnale, scossone, particelle radioattive. */
  private anomalyFx(i: number) {
    const { x, y } = center(i);
    for (let k = 0; k < 3; k++) {
      const ring = this.add.graphics({ x, y }).setDepth(9);
      ring.lineStyle(3, PALETTE.mappa.segnale, 1).strokeCircle(0, 0, S);
      this.tweens.add({ targets: ring, scale: 6, alpha: 0, delay: k * 140, duration: 900, ease: 'Quad.easeOut', onComplete: () => ring.destroy() });
    }
    this.burst.setParticleTint(PALETTE.mappa.segnale);
    this.burst.explode(30, x, y);
    this.cameras.main.shake(260, 0.006);
    buzz([30, 40, 60]);
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
    const near = [i, ...NEIGHBORS[i].filter((n) => n >= 0)];
    const cand = [...new Set(near.map((n) => this.state.provOf(n)).filter((p) => p >= 0))];
    const p = provinceAtPoint(this.shapes, cand, x, y);
    if (p < 0 || this.state.provOf(i) === p) return i;
    return near.filter((n) => this.state.provOf(n) === p)
      .reduce((a, b) => (Math.hypot(center(b).x - x, center(b).y - y) < Math.hypot(center(a).x - x, center(a).y - y) ? b : a));
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
      if (this.down && !this.dragging && this.activePointers().length === 0) this.tapTile(this.tileAt(p.x, p.y));
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
