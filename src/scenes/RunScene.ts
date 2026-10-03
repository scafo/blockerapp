import Phaser from 'phaser';
import { BALANCE, type Resource, type UnitType } from '../config/balance';
import { RESOURCE_INFO } from '../game/resources';
import { runOptions, settle, type RunOptions } from '../game/camp';
import { loadPrefs, loadProfile, saveProfile } from '../save/storage';
import { analytics } from '../analytics/analytics';
import { PALETTE } from '../config/palette';
import { generateMap, type RunMap } from '../map/generate';
import { NEIGHBORS, WORLD_H, WORLD_W, center, corners, hexDistance, pixelToIndex } from '../map/hexGrid';
import { NEUTRAL, PLAYER, RunState } from '../game/RunState';
import { FACTION_INFO } from '../game/factions';
import { textStyle } from '../ui/style';
import { drawSymbol } from '../ui/symbols';
import { DPR } from '../ui/screen';
import { buzz } from '../ui/haptics';
import { drawUnitIcon } from '../ui/unitIcons';
import { unitInfo, type Unit } from '../game/units';
import type { Boat } from '../game/boats';
import type { HudScene } from './HudScene';

const S = BALANCE.map.hexSize;
const FOG_RES = 0.5; // la nebbia non ha bisogno di dettaglio: mezza risoluzione, bordi morbidi
const CAM = BALANCE.camera;

/** Schiarisce (>1) o scurisce (<1) un colore 0xRRGGBB. */
function shade(c: number, f: number): number {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return (ch((c >> 16) & 255) << 16) | (ch((c >> 8) & 255) << 8) | ch(c & 255);
}

const TERRAIN_COLOR = {
  terra: PALETTE.terra,
  deserto: PALETTE.ocra,
  rovine: PALETTE.rovine,
  tossica: PALETTE.radioattivo,
  anomalia: 0x14302b,
} as const;

export class RunScene extends Phaser.Scene {
  state!: RunState;
  map!: RunMap;
  private ownedGfx!: Phaser.GameObjects.Graphics;
  private frontierGfx!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;
  private labelTimer = 0;
  private lastAffordable = '';
  private ownedDirty = false;
  private nameTags: Phaser.GameObjects.Container[] = [];
  private nameTimer = 0;
  private lastHitFx = 0;
  private stormGfx!: Phaser.GameObjects.Graphics;
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
  // pedine
  selectedCard: UnitType | null = null;
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
    this.map = generateMap(data.seed, this.registry.get('landMask'), opts.tutorial ? BALANCE.tutorial.aiCount : BALANCE.ai.count,
      this.registry.get('countries'));
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
    this.labels = [];
    this.lastAffordable = '';
    this.cameras.main.setBackgroundColor(PALETTE.oceano);

    const before = this.children.list.length;
    this.drawGraticule();
    this.drawTerrain();
    this.bakeStatic(this.children.list.slice(before));
    this.ownedGfx = this.add.graphics();
    // nebbia sopra i colori delle fazioni ma sotto anomalie, tempesta e pedine
    this.fogVersion = -1;
    this.namesShown = true;
    this.fogRT = this.add.renderTexture(0, 0, Math.ceil(WORLD_W * FOG_RES), Math.ceil(WORLD_H * FOG_RES)).setOrigin(0).setScale(1 / FOG_RES)
      .setVisible(opts.fog);
    this.fogBrush = this.make.graphics({}, false);
    this.boatSprites = new Map();
    this.drawAnomalies();
    this.stormGfx = this.add.graphics();
    this.frontierGfx = this.add.graphics();
    this.flowMarker = this.add.graphics().setDepth(8).setVisible(false);
    this.flowMarker.lineStyle(2.5, 0xffffff, 1).strokeCircle(0, 0, S * 0.9).lineStyle(1.5, 0xffffff, 0.8).strokeCircle(0, 0, S * 0.45);
    this.tweens.add({ targets: this.flowMarker, scale: { from: 0.8, to: 1.25 }, duration: 380, yoyo: true, repeat: -1 });
    this.ending = false;
    this.burst = this.add.particles(0, 0, 'dot', {
      speed: { min: 40, max: 140 },
      lifespan: 450,
      scale: { start: 0.9, end: 0 },
      alpha: { start: 1, end: 0 },
      emitting: false,
    }).setDepth(10);

    this.nameTags = FACTION_INFO.map((f) => {
      const g = this.add.graphics();
      drawSymbol(g, f.symbol, 0, -9, 7, PALETTE.carta, PALETTE.inchiostro);
      const t = this.add.text(0, 5, f.short, textStyle(11, PALETTE.carta)).setOrigin(0.5).setResolution(3).setStroke('#2b2118', 3);
      return this.add.container(0, 0, [g, t]).setDepth(6).setAlpha(0.95);
    });
    this.nameTimer = 0;

    this.selectedCard = null;
    this.selectedUnit = null;
    this.unitSprites = new Map();
    this.pathGfx = this.add.graphics().setDepth(7);
    this.selRing = this.add.graphics().setDepth(8).setVisible(false);
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
    const ticks = this.state.update(delta);
    let pops = 0;
    for (const e of this.state.drainEvents()) {
      if (e.type === 'conquer') {
        this.ownedDirty = true;
        if (e.by === PLAYER) {
          if (e.i !== this.tapFxTile && pops++ < 8) this.popFx(e.i);
          this.hud.tutorialSignal('conquer');
        }
        if (this.map.tiles[e.i]!.type === 'anomalia' && (e.by === PLAYER || e.from === PLAYER)) {
          if (e.by === PLAYER) this.anomalyFx(e.i);
          this.hud.onAnomaly(this.state.anomaliesOwned(), e.by === PLAYER);
        }
        if (e.from === PLAYER && e.by !== NEUTRAL && time - this.lastHitFx > 250) {
          this.lastHitFx = time;
          this.lostFx(e.i, e.by);
        }
      } else if (e.type === 'unitDied') {
        this.unitDeathFx(e.unit);
      } else if (e.type === 'province') {
        this.hud.onProvince(e.by, e.count, e.capital, e.nation, e.bonus);
      } else if (e.type === 'boat') {
        this.boatLandFx(e.boat, e.phase);
      } else if (e.type === 'flowEnd') {
        if (e.reason === 'budget' && this.flowMarker.visible) this.floatText(this.flowMarker.x, this.flowMarker.y - 8, 'forza esaurita', PALETTE.carta);
        this.flowMarker.setVisible(false);
      } else if (e.type === 'event') {
        this.selectedCard = null;
        this.selectUnit(null);
        this.hud.showEvent(e.event);
      } else if (e.type === 'storm') {
        this.hud.onStorm(e.phase);
      } else {
        this.hud.onEliminated(e.faction, e.by, e.loot);
      }
    }
    this.syncUnits();
    this.syncBoats();
    if (this.state.opts.fog && this.state.fogVersion !== this.fogVersion) this.redrawFog();
    this.tapFxTile = -1;
    // nomi delle nazioni solo nella vista strategica: da vicino si combatte, non si legge l'atlante
    const showNames = this.cameras.main.zoom < BALANCE.provinces.namesMaxZoom * DPR;
    if (showNames !== this.namesShown) {
      this.namesShown = showNames;
      this.tweens.add({ targets: this.nationNames, alpha: showNames ? 0.5 : 0, duration: 200 });
    }
    const ms = BALANCE.milestones;
    while (this.nextMilestone < ms.length && this.state.maxTiles >= ms[this.nextMilestone]) {
      this.hud.onMilestone(ms[this.nextMilestone++]);
    }
    if (ticks > 0 && this.state.stormIn <= BALANCE.storm.warnMs) this.redrawStorm();
    if (this.state.over && !this.ending) this.finish();
    if (this.ownedDirty) {
      this.ownedDirty = false;
      this.redrawOwned();
      this.redrawFrontier(true);
    } else if (ticks > 0) {
      this.redrawFrontier();
    }
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

  private hexPath(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number) {
    g.fillPoints(corners(x, y, size), true);
  }

  /**
   * Mare, griglia, terreno e coste non cambiano mai: li disegniamo una volta in una texture invece di ridisegnare
   * migliaia di esagoni a ogni fotogramma (fondamentale sui telefoni economici).
   */
  private bakeStatic(objs: Phaser.GameObjects.GameObject[]) {
    const M = 12;
    const renderer = this.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    const maxTex = typeof renderer.getMaxTextureSize === 'function' ? renderer.getMaxTextureSize() : 4096;
    const f = Math.max(0.5, Math.min(1.6, (maxTex - 16) / (WORLD_W + 2 * M), (maxTex - 16) / (WORLD_H + 2 * M)));
    const holder = this.add.container(M * f, M * f, objs).setScale(f);
    const rt = this.add.renderTexture(-M, -M, Math.ceil((WORLD_W + 2 * M) * f), Math.ceil((WORLD_H + 2 * M) * f))
      .setOrigin(0).setScale(1 / f);
    rt.draw(holder);
    holder.destroy(true);
    this.children.sendToBack(rt);
  }

  private drawGraticule() {
    const g = this.add.graphics().lineStyle(1, PALETTE.graticola, 1);
    const { latMax, latMin, rows } = BALANCE.map;
    for (let lon = -180; lon <= 180; lon += 30) {
      const x = ((lon + 180) / 360) * WORLD_W;
      g.lineBetween(x, 0, x, WORLD_H);
    }
    for (let lat = -60; lat <= 90; lat += 30) {
      if (lat > latMax || lat < latMin) continue;
      const r = ((latMax - lat) / (latMax - latMin)) * rows - 0.5;
      const y = 1.5 * S * r + S;
      g.lineBetween(0, y, WORLD_W, y);
    }
    g.lineStyle(3, PALETTE.ocra, 0.6).strokeRect(-6, -6, WORLD_W + 12, WORLD_H + 12);
    // tratteggio del mare, da carta militare
    g.lineStyle(1, PALETTE.graticola, 0.35);
    for (let d = -WORLD_H; d < WORLD_W; d += 16) g.lineBetween(Math.max(0, d), Math.max(0, -d), Math.min(WORLD_W, d + WORLD_H), Math.min(WORLD_H, WORLD_W - d));
    this.drawCompass(140, WORLD_H - 150, 70);
  }

  /** Rosa dei venti a 8 punte con la N. */
  private drawCompass(x: number, y: number, r: number) {
    const g = this.add.graphics();
    g.lineStyle(1.5, PALETTE.ocra, 0.7).strokeCircle(x, y, r * 0.78).strokeCircle(x, y, r * 0.7);
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 - Math.PI / 2, long = k % 2 === 0, len = long ? r : r * 0.55, w = long ? r * 0.13 : r * 0.09;
      const tip = { x: x + Math.cos(a) * len, y: y + Math.sin(a) * len };
      const l = { x: x + Math.cos(a - Math.PI / 2) * w, y: y + Math.sin(a - Math.PI / 2) * w };
      const rr = { x: x + Math.cos(a + Math.PI / 2) * w, y: y + Math.sin(a + Math.PI / 2) * w };
      g.fillStyle(PALETTE.ocra, 0.85).fillTriangle(x, y, tip.x, tip.y, l.x, l.y);
      g.fillStyle(PALETTE.carta, 0.85).fillTriangle(x, y, tip.x, tip.y, rr.x, rr.y);
    }
    this.add.text(x, y - r - 14, 'N', textStyle(18, PALETTE.ocra)).setOrigin(0.5).setResolution(2);
  }

  private drawTerrain() {
    const g = this.add.graphics();
    for (const i of this.map.land) {
      const t = this.map.tiles[i]!;
      const { x, y } = center(i);
      // leggera variazione di tinta: carta stampata, non piastrelle
      const jitter = t.type === 'terra' || t.type === 'deserto' ? (((i * 2654435761) >>> 0) % 7 - 3) * 0.018 : 0;
      g.fillStyle(shade(TERRAIN_COLOR[t.type], 1 + jitter), 1);
      this.hexPath(g, x, y, S + 0.4);
    }
    g.lineStyle(0.6, PALETTE.inchiostro, 0.25);
    for (const i of this.map.land) {
      const { x, y } = center(i);
      g.strokePoints(corners(x, y, S), true);
    }
    // carta politica: linee sottili tra province, confini nazionali tratteggiati (alla Call of War)
    const tiles = this.map.tiles;
    for (const i of this.map.land) {
      const t = tiles[i]!;
      const { x, y } = center(i);
      const c = corners(x, y, S);
      NEIGHBORS[i].forEach((n, k) => {
        const u = n >= 0 ? tiles[n] : null;
        if (!u || n < i) return; // ogni lato una volta sola
        const a = c[k], b = c[(k + 1) % 6];
        if (u.country !== t.country) {
          g.lineStyle(1.8, PALETTE.inchiostro, 0.8);
          g.lineBetween(a.x, a.y, a.x + (b.x - a.x) / 3, a.y + (b.y - a.y) / 3);
          g.lineBetween(a.x + ((b.x - a.x) * 2) / 3, a.y + ((b.y - a.y) * 2) / 3, b.x, b.y);
        } else if (u.province !== t.province) {
          g.lineStyle(0.9, PALETTE.inchiostro, 0.3).lineBetween(a.x, a.y, b.x, b.y);
        }
      });
    }
    // coste nette (leggibilità prima di tutto)
    g.lineStyle(1.6, PALETTE.inchiostro, 0.85);
    for (const i of this.map.land) {
      const { x, y } = center(i);
      const c = corners(x, y, S);
      NEIGHBORS[i].forEach((n, k) => {
        if (n < 0 || !this.map.tiles[n]) g.lineBetween(c[k].x, c[k].y, c[(k + 1) % 6].x, c[(k + 1) % 6].y);
      });
    }
    // segni: rovine (quadrato scuro), zone tossiche (pallino)
    for (const i of this.map.land) {
      const t = this.map.tiles[i]!;
      const { x, y } = center(i);
      if (t.type === 'rovine') {
        g.fillStyle(PALETTE.inchiostro, 0.85).fillRect(x - 3, y - 3, 6, 6);
        g.fillStyle(PALETTE.ocra, 1).fillRect(x - 1.2, y - 1.2, 2.4, 2.4);
      } else if (t.type === 'tossica') {
        g.fillStyle(PALETTE.inchiostro, 0.55).fillCircle(x, y, 2.6);
      }
    }
  }

  private redrawOwned() {
    const g = this.ownedGfx.clear();
    const own = this.state.owner;
    for (let i = 0; i < own.length; i++) {
      if (own[i] === NEUTRAL) continue;
      const { x, y } = center(i);
      g.fillStyle(FACTION_INFO[own[i]].fill, 0.92);
      this.hexPath(g, x, y, S + 0.4);
    }
    // insediamenti (rovine possedute): casetta in carta, alzano il tetto di popolazione
    for (let i = 0; i < own.length; i++) {
      if (own[i] === NEUTRAL || this.map.tiles[i]!.type !== 'rovine') continue;
      const { x, y } = center(i);
      const w = S * 0.32;
      g.fillStyle(PALETTE.carta, 1).fillRect(x - w, y - w * 0.3, w * 2, w * 1.3);
      g.fillTriangle(x - w * 1.25, y - w * 0.3, x + w * 1.25, y - w * 0.3, x, y - w * 1.4);
      g.fillStyle(FACTION_INFO[own[i]].border, 1).fillRect(x - w * 0.3, y + w * 0.25, w * 0.6, w * 0.75);
    }
    // confini netti: solo i lati verso caselle di altri
    for (let i = 0; i < own.length; i++) {
      const o = own[i];
      if (o === NEUTRAL) continue;
      g.lineStyle(o === PLAYER ? 2.4 : 1.8, FACTION_INFO[o].border, 1);
      const { x, y } = center(i);
      const c = corners(x, y, S);
      NEIGHBORS[i].forEach((n, k) => {
        if (n < 0 || own[n] !== o) g.lineBetween(c[k].x, c[k].y, c[(k + 1) % 6].x, c[(k + 1) % 6].y);
      });
    }
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
      const tag = this.nameTags[k];
      if (!f.alive || best[k] < 0 || !this.state.sees(best[k])) return void tag.setVisible(false); // niente nomi nella nebbia
      const { x, y } = center(best[k]);
      const scale = Phaser.Math.Clamp(0.6 + Math.sqrt(f.tiles) * 0.09, 0.7, 2.6);
      if (!tag.visible || tag.x === 0) tag.setPosition(x, y).setScale(scale).setVisible(true);
      else this.tweens.add({ targets: tag, x, y, scale, duration: 450, ease: 'Sine.easeInOut' });
    });
  }

  /** Evidenzia le caselle attaccabili: piene se abbordabili, solo contorno se no. */
  private redrawFrontier(force = false) {
    const front = this.state.frontier();
    const troops = this.state.troops;
    const key = front.map((i) => (troops > this.state.defenseOf(i) ? 1 : 0)).join('') + front.length;
    if (!force && key === this.lastAffordable) return;
    this.lastAffordable = key;

    const g = this.frontierGfx.clear();
    for (const i of front) {
      const { x, y } = center(i);
      const ok = troops > this.state.defenseOf(i);
      if (ok) {
        g.fillStyle(PALETTE.ok, 0.35);
        this.hexPath(g, x, y, S * 0.82);
        g.lineStyle(1.6, PALETTE.ok, 0.95);
      } else {
        g.lineStyle(1, PALETTE.inchiostro, 0.55);
      }
      g.strokePoints(corners(x, y, S * 0.82), true);
    }
    this.updateLabels();
  }

  private updateLabels() {
    const cam = this.cameras.main;
    const show = cam.zoom >= CAM.labelMinZoom * DPR;
    let used = 0;
    if (show) {
      const view = cam.worldView;
      for (const i of this.state.frontier()) {
        const { x, y } = center(i);
        if (x < view.x - S || x > view.right + S || y < view.y - S || y > view.bottom + S) continue;
        const t = this.map.tiles[i]!;
        let label = this.labels[used];
        if (!label) {
          label = this.add.text(0, 0, '', textStyle(9, PALETTE.inchiostro)).setOrigin(0.5).setResolution(3).setDepth(5);
          this.labels.push(label);
        }
        const def = this.state.defenseOf(i);
        const enemy = this.state.owner[i] !== NEUTRAL;
        const txt = String(def);
        if (label.text !== txt) label.setText(txt);
        label.setColor(enemy ? '#efe3c8' : this.state.troops > def ? '#2b2118' : '#8b3a1e');
        label.setPosition(x, y + (t.type === 'rovine' ? 5 : 0)).setVisible(true);
        used++;
      }
    }
    for (let k = used; k < this.labels.length; k++) this.labels[k].setVisible(false);
  }

  // ---------- conquista ----------

  /** Seleziona/deseleziona una carta; ritorna il motivo se non si può usare. */
  toggleCard(t: UnitType): ReturnType<RunState['deployBlock']> {
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
    if (i < 0 || !this.map.tiles[i]) return;
    const { x, y } = center(i);

    if (this.selectedCard) {
      const t = this.selectedCard;
      const u = this.state.deploy(PLAYER, t, i);
      if (!u) return this.failFx(x, y, this.state.owner[i] === PLAYER ? 'casella occupata' : 'solo nel tuo territorio');
      this.selectedCard = null;
      this.syncUnits();
      this.conquestFx(x, y, BALANCE.units[t].cost, 0);
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

    if (!this.state.isFrontier(i)) {
      if (this.state.owner[i] === PLAYER) {
        if (this.state.flowTarget !== null) {
          this.state.stopFlow();
          this.floatText(x, y - 4, 'alt!', PALETTE.carta);
        }
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
      this.tapFxTile = i;
      this.redrawOwned();
      this.redrawFrontier(true);
      this.conquestFx(x, y, res.cost, res.loot, res.lootType);
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
  /** Nomi delle nazioni più grandi, sopra i colori delle fazioni: si legge sempre una carta politica. */
  private drawNationNames() {
    this.nationNames = [];
    for (const n of this.map.nations) {
      if (n.size < BALANCE.provinces.nameMinTiles) continue;
      const { x, y } = center(n.label);
      const size = Phaser.Math.Clamp(7 + Math.sqrt(n.size) * 1.2, 9, 30);
      this.nationNames.push(this.add.text(x, y, n.name.toUpperCase(), textStyle(size, PALETTE.inchiostro)).setOrigin(0.5).setResolution(3)
        .setLetterSpacing(size * 0.25).setStroke('#efe3c8', 2).setAlpha(0.5).setDepth(4));
    }
  }

  /** Città (quadratino) e capitali (stella): luoghi noti dalle vecchie carte, sempre visibili. */
  private drawCities() {
    const g = this.add.graphics();
    for (const p of this.map.provinces) {
      if (p.city < 0) continue;
      const t = this.map.tiles[p.city]!;
      const { x, y } = center(p.city);
      if (t.capital) drawSymbol(g, 'stella', x, y, 5, PALETTE.carta, PALETTE.inchiostro);
      else g.fillStyle(PALETTE.carta, 1).fillRect(x - 2.6, y - 2.6, 5.2, 5.2).lineStyle(1.2, PALETTE.inchiostro, 1).strokeRect(x - 2.6, y - 2.6, 5.2, 5.2);
    }
  }

  private drawAnomalies() {
    this.drawCities();
    this.drawNationNames();
    const g = this.add.graphics();
    for (const i of this.map.anomalies) {
      const { x, y } = center(i);
      g.lineStyle(1.4, PALETTE.radioattivo, 1).strokeCircle(x, y, S * 0.35).strokeCircle(x, y, S * 0.65);
      g.fillStyle(PALETTE.radioattivo, 1).fillCircle(x, y, 1.6);
      const pulse = this.add.graphics({ x, y });
      pulse.lineStyle(1.2, PALETTE.radioattivo, 1).strokeCircle(0, 0, S * 0.6);
      this.tweens.add({ targets: pulse, scale: { from: 0.6, to: 2.2 }, alpha: { from: 0.9, to: 0 }, duration: 1600, repeat: -1 });
    }
  }

  /** Cenere sulle caselle inghiottite + confine della zona sicura (o di quella finale, durante l'avviso). */
  private redrawStorm() {
    const st = this.state;
    const g = this.stormGfx.clear();
    g.fillStyle(0x3a3530, 0.88);
    for (let i = 0; i < st.stormed.length; i++) {
      if (!st.stormed[i]) continue;
      const { x, y } = center(i);
      this.hexPath(g, x, y, S + 0.4);
    }
    const r = st.stormIn > 0 ? BALANCE.storm.finalRadius : st.stormRadius;
    const dist = (i: number) => this.stormDistOf(i);
    g.lineStyle(st.stormIn > 0 ? 3.2 : 2.4, st.stormIn > 0 ? 0xffffff : PALETTE.ko, 1);
    for (let i = 0; i < st.stormed.length; i++) {
      if (!this.map.tiles[i] || dist(i) > r) continue;
      const { x, y } = center(i);
      const c = corners(x, y, S);
      NEIGHBORS[i].forEach((n, k) => {
        if (n < 0 || dist(n) > r) g.lineBetween(c[k].x, c[k].y, c[(k + 1) % 6].x, c[(k + 1) % 6].y);
      });
    }
  }

  private stormDistOf(i: number): number {
    return hexDistance(i, this.map.stormCenter);
  }

  private conquestFx(x: number, y: number, cost: number, loot: number, lootType: Resource = 'rottami') {
    const flash = this.add.graphics({ x, y }).setDepth(9);
    flash.fillStyle(0xffffff, 1).fillPoints(corners(0, 0, S), true);
    this.tweens.add({ targets: flash, scale: 1.8, alpha: 0, duration: 380, ease: 'Cubic.easeOut', onComplete: () => flash.destroy() });
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
    this.tweens.add({ targets: c, scale: 1, duration: 260, ease: 'Back.easeOut' });
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
    const g = this.fogBrush.clear().setScale(FOG_RES);
    for (const i of this.map.land) {
      if (st.visible[i]) continue;
      const { x, y } = center(i);
      g.fillStyle(0x15110c, st.seen[i] ? F.seenAlpha : F.unseenAlpha);
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
    const lbl = this.add.text(0, -14, String(b.troops), textStyle(9, PALETTE.carta)).setOrigin(0.5).setResolution(3).setStroke('#2b2118', 3);
    const { x, y } = center(b.from);
    const c = this.add.container(x, y, [g, lbl]).setDepth(8);
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

  /** Casella appena presa (avanzata, pittura, pedine): un lampo piccolo, per non coprire la mappa. */
  private popFx(i: number) {
    const { x, y } = center(i);
    const g = this.add.graphics({ x, y }).setDepth(9);
    g.fillStyle(0xffffff, 0.75).fillPoints(corners(0, 0, S), true);
    this.tweens.add({ targets: g, scale: { from: 0.5, to: 1.15 }, alpha: 0, duration: 260, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
  }

  /** Anomalia presa: onda del segnale, scossone, particelle radioattive. */
  private anomalyFx(i: number) {
    const { x, y } = center(i);
    for (let k = 0; k < 3; k++) {
      const ring = this.add.graphics({ x, y }).setDepth(9);
      ring.lineStyle(3, PALETTE.radioattivo, 1).strokeCircle(0, 0, S);
      this.tweens.add({ targets: ring, scale: 6, alpha: 0, delay: k * 140, duration: 900, ease: 'Quad.easeOut', onComplete: () => ring.destroy() });
    }
    this.burst.setParticleTint(PALETTE.radioattivo);
    this.burst.explode(30, x, y);
    this.cameras.main.shake(260, 0.006);
    buzz([30, 40, 60]);
  }

  /** Una nostra casella è caduta: lampo nel colore del nemico. */
  private lostFx(i: number, by: number) {
    const { x, y } = center(i);
    const flash = this.add.graphics({ x, y }).setDepth(9);
    flash.lineStyle(3, PALETTE.ko, 1).strokePoints(corners(0, 0, S), true);
    flash.fillStyle(FACTION_INFO[by].fill, 0.6).fillPoints(corners(0, 0, S), true);
    this.tweens.add({ targets: flash, scale: 1.6, alpha: 0, duration: 500, onComplete: () => flash.destroy() });
    const v = this.cameras.main.worldView;
    if (v.contains(x, y)) this.cameras.main.shake(90, 0.002);
  }

  private failFx(x: number, y: number, msg: string) {
    const ring = this.add.graphics({ x, y }).setDepth(9);
    ring.lineStyle(2, PALETTE.ko, 1).strokePoints(corners(0, 0, S), true);
    this.tweens.add({ targets: ring, alpha: 0, duration: 500, onComplete: () => ring.destroy() });
    this.tweens.add({ targets: ring, x: { from: x - 2, to: x }, duration: 60, repeat: 3, yoyo: true });
    this.floatText(x, y - 4, msg, PALETTE.ko);
  }

  private floatText(x: number, y: number, msg: string, color: number, delay = 0) {
    const t = this.add.text(x, y, msg, textStyle(10, color)).setOrigin(0.5).setResolution(3).setDepth(11)
      .setStroke('#2b2118', 3).setAlpha(0);
    this.tweens.add({
      targets: t, y: y - 18, alpha: { from: 1, to: 0 }, delay, duration: 900, ease: 'Quad.easeOut',
      onComplete: () => t.destroy(),
    });
  }

  // ---------- camera & input ----------

  private setupCamera() {
    const cam = this.cameras.main;
    const m = 400;
    cam.setBounds(-m, -m, WORLD_W + 2 * m, WORLD_H + 2 * m);
    cam.setZoom(CAM.startZoom * DPR); // lo zoom della camera conta i pixel reali dello schermo
    const { x, y } = center(this.map.starts[0]);
    cam.centerOn(x, y);
  }

  private zoomAt(sx: number, sy: number, z: number) {
    const cam = this.cameras.main;
    const nz = Phaser.Math.Clamp(z, CAM.minZoom * DPR, CAM.maxZoom * DPR);
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
    return pixelToIndex(cam.scrollX + w + (sx - w) / cam.zoom, cam.scrollY + h + (sy - h) / cam.zoom);
  }

  /** Casella → coordinate schermo in punti CSS (per frecce e guida nell'HUD). */
  tileToScreen(i: number): { x: number; y: number } {
    const cam = this.cameras.main;
    const w = cam.width / 2, h = cam.height / 2;
    const c = center(i);
    return { x: ((c.x - cam.scrollX - w) * cam.zoom + w) / DPR, y: ((c.y - cam.scrollY - h) * cam.zoom + h) / DPR };
  }

  /**
   * Un dito: tocco = attacco / avanzata / pedine; trascinamento che parte dal tuo territorio = dipingi la frontiera,
   * altrove = sposta la mappa. Due dita: zoom e spostamento.
   */
  private setupInput() {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.hud.hitUi(p.x / DPR, p.y / DPR)) return;
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
      if (i < 0 || i === this.lastPainted) continue;
      this.lastPainted = i;
      if (!this.state.isFrontier(i) || this.state.troops <= this.state.defenseOf(i)) continue;
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
