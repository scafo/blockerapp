import Phaser from 'phaser';
import { BALANCE, type UnitType } from '../config/balance';
import { PALETTE } from '../config/palette';
import { generateMap, type RunMap } from '../map/generate';
import { NEIGHBORS, WORLD_H, WORLD_W, center, corners, pixelToIndex } from '../map/hexGrid';
import { NEUTRAL, PLAYER, RunState } from '../game/RunState';
import { FACTION_INFO } from '../game/factions';
import { textStyle } from '../ui/style';
import { drawSymbol } from '../ui/symbols';
import { drawUnitIcon } from '../ui/unitIcons';
import { unitInfo, type Unit } from '../game/units';
import type { HudScene } from './HudScene';

const S = BALANCE.map.hexSize;
const CAM = BALANCE.camera;

const TERRAIN_COLOR = {
  terra: PALETTE.terra,
  deserto: PALETTE.ocra,
  rovine: PALETTE.rovine,
  tossica: PALETTE.radioattivo,
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

  create(data: { seed: string }) {
    this.map = generateMap(data.seed, this.registry.get('landMask'));
    this.state = new RunState(this.map);
    this.labels = [];
    this.lastAffordable = '';
    this.cameras.main.setBackgroundColor(PALETTE.oceano);

    this.drawGraticule();
    this.drawTerrain();
    this.ownedGfx = this.add.graphics();
    this.frontierGfx = this.add.graphics();
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
    for (const e of this.state.drainEvents()) {
      if (e.type === 'conquer') {
        this.ownedDirty = true;
        if (e.from === PLAYER && time - this.lastHitFx > 250) {
          this.lastHitFx = time;
          this.lostFx(e.i, e.by);
        }
      } else if (e.type === 'unitDied') {
        this.unitDeathFx(e.unit);
      } else {
        this.hud.onEliminated(e.faction, e.by, e.loot);
      }
    }
    this.syncUnits();
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

  setSpeed(s: number) {
    this.state.speed = s;
  }

  // ---------- disegno ----------

  private hexPath(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number) {
    g.fillPoints(corners(x, y, size), true);
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
  }

  private drawTerrain() {
    const g = this.add.graphics();
    for (const i of this.map.land) {
      const t = this.map.tiles[i]!;
      const { x, y } = center(i);
      g.fillStyle(TERRAIN_COLOR[t.type], 1);
      this.hexPath(g, x, y, S + 0.4);
    }
    g.lineStyle(0.6, PALETTE.inchiostro, 0.25);
    for (const i of this.map.land) {
      const { x, y } = center(i);
      g.strokePoints(corners(x, y, S), true);
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
      if (!f.alive || best[k] < 0) return void tag.setVisible(false);
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
    const show = cam.zoom >= CAM.labelMinZoom;
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
      return;
    }
    const mine = this.state.unitAt(i);
    if (mine && mine.owner === PLAYER) return this.selectUnit(this.selectedUnit === mine.id ? null : mine.id);
    if (this.selectedUnit !== null) {
      const u = this.state.units.find((v) => v.id === this.selectedUnit);
      if (u && this.state.order(u, i)) {
        this.floatText(x, y - 4, 'avanti!', PALETTE.radioattivo);
        this.selectUnit(null);
        return;
      }
      if (u) return this.failFx(x, y, 'irraggiungibile');
    }

    const res = this.state.tryConquer(i);
    if (res.ok) {
      this.redrawOwned();
      this.redrawFrontier(true);
      this.conquestFx(x, y, res.cost, res.loot);
      this.hud.onConquest(res.loot);
    } else if (res.reason === 'troops') {
      this.failFx(x, y, `servono ${res.need! + 1}`);
    } else if (res.reason === 'not-adjacent') {
      this.failFx(x, y, 'troppo lontano');
    } else if (res.reason === 'impassable') {
      this.failFx(x, y, 'tossico');
    }
  }

  private conquestFx(x: number, y: number, cost: number, loot: number) {
    const flash = this.add.graphics({ x, y }).setDepth(9);
    flash.fillStyle(0xffffff, 1).fillPoints(corners(0, 0, S), true);
    this.tweens.add({ targets: flash, scale: 1.8, alpha: 0, duration: 380, ease: 'Cubic.easeOut', onComplete: () => flash.destroy() });
    this.burst.setParticleTint(loot ? PALETTE.ocra : PALETTE.carta);
    this.burst.explode(loot ? 18 : 10, x, y);
    this.floatText(x, y - 4, `-${cost}`, PALETTE.carta);
    if (loot) {
      this.floatText(x, y + 8, `+${loot} rottami`, PALETTE.ocra, 160);
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
      if (sp.tile !== u.tile) {
        sp.tile = u.tile;
        const { x, y } = center(u.tile);
        const dur = Math.min(400, BALANCE.units[u.type].moveMs / this.state.speed);
        this.tweens.add({ targets: sp.c, x, y, duration: dur, ease: 'Sine.easeInOut' });
      }
      const hpPct = Math.round((u.hp / BALANCE.units[u.type].hp) * 10);
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

  private unitDeathFx(u: Unit) {
    const sp = this.unitSprites.get(u.id);
    const { x, y } = sp ? { x: sp.c.x, y: sp.c.y } : center(u.tile);
    this.burst.setParticleTint(FACTION_INFO[u.owner].fill);
    this.burst.explode(14, x, y);
    if (u.owner === PLAYER) this.floatText(x, y - 6, `${unitInfo(u.type).short} caduta`, PALETTE.ko);
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
    cam.setZoom(CAM.startZoom);
    const { x, y } = center(this.map.starts[0]);
    cam.centerOn(x, y);
  }

  private zoomAt(sx: number, sy: number, z: number) {
    const cam = this.cameras.main;
    const nz = Phaser.Math.Clamp(z, CAM.minZoom, CAM.maxZoom);
    const w = cam.width / 2, h = cam.height / 2;
    const wx = cam.scrollX + w + (sx - w) / cam.zoom;
    const wy = cam.scrollY + h + (sy - h) / cam.zoom;
    cam.setZoom(nz);
    cam.scrollX = wx - w - (sx - w) / nz;
    cam.scrollY = wy - h - (sy - h) / nz;
    this.labelTimer = 0;
  }

  private setupInput() {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.hud.hitUi(p.x, p.y)) return;
      if (this.activePointers().length === 1) {
        this.down = { x: p.x, y: p.y };
        this.last = { x: p.x, y: p.y };
        this.dragging = false;
      }
      this.pinchDist = 0;
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const pts = this.activePointers();
      if (pts.length >= 2) {
        const [a, b] = pts;
        const d = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
        if (this.pinchDist > 0) this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, this.cameras.main.zoom * (d / this.pinchDist));
        this.pinchDist = d;
        this.dragging = true;
        return;
      }
      if (!this.down || !p.isDown) return;
      if (!this.dragging && Phaser.Math.Distance.Between(p.x, p.y, this.down.x, this.down.y) > CAM.dragThreshold) {
        this.dragging = true;
      }
      if (this.dragging) {
        const cam = this.cameras.main;
        cam.scrollX -= (p.x - this.last.x) / cam.zoom;
        cam.scrollY -= (p.y - this.last.y) / cam.zoom;
        this.labelTimer = Math.min(this.labelTimer, 60);
      }
      this.last = { x: p.x, y: p.y };
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.down && !this.dragging && this.activePointers().length === 0) {
        const cam = this.cameras.main;
        const w = cam.width / 2, h = cam.height / 2;
        const wx = cam.scrollX + w + (p.x - w) / cam.zoom;
        const wy = cam.scrollY + h + (p.y - h) / cam.zoom;
        this.tapTile(pixelToIndex(wx, wy));
      }
      if (this.activePointers().length === 0) this.down = null;
      this.pinchDist = 0;
    });

    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.zoomAt(p.x, p.y, this.cameras.main.zoom * (dy > 0 ? 0.88 : 1.14));
    });
  }

  private activePointers(): Phaser.Input.Pointer[] {
    return this.input.manager.pointers.filter((q) => q.isDown);
  }
}
