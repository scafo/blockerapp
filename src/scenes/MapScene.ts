// Run sulla mappa (M1): mondo da seed, conquista a tap, camera con pan / pinch / doppio tap.
import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { FACTIONS, PLAYER, THEME } from '../config/theme';
import { Conquest } from '../game/conquest';
import { CELL, WORLD_H, WORLD_W, cellAt } from '../map/grid';
import { loadLandMask } from '../map/landmask';
import { randomSeed } from '../map/rng';
import { generateWorld, type Province, type World } from '../map/world';
import { MapRenderer } from '../render/MapRenderer';
import { buzz } from '../ui/haptics';
import { DPR } from '../ui/screen';
import { titleStyle } from '../ui/style';

let MASK: Uint8Array | null = null;

export class MapScene extends Phaser.Scene {
  world!: World;
  conquest!: Conquest;
  renderer_!: MapRenderer;
  seed = '';
  private down: { x: number; y: number; sx: number; sy: number; drag: boolean } | null = null;
  private pinch: { d: number; zoom: number; mx: number; my: number } | null = null;
  private lastTap = 0;

  constructor() {
    super('map');
  }

  create(data: { seed?: string }) {
    this.seed = data.seed ?? new URLSearchParams(location.search).get('seed') ?? randomSeed();
    MASK ??= loadLandMask();
    this.world = generateWorld(this.seed, MASK);
    this.conquest = new Conquest(this.world, PLAYER);
    this.conquest.placeStart();
    this.cameras.main.setBackgroundColor(THEME.sfondo);
    this.renderer_ = new MapRenderer(this, this.world);

    const cam = this.cameras.main;
    cam.setBounds(-WORLD_W * 0.04, -WORLD_H * 0.04, WORLD_W * 1.08, WORLD_H * 1.08);
    cam.setZoom(BALANCE.camera.startZoom * DPR);
    this.centerOnTerritory(false);

    this.conquest.on('provinceCaptured', (p: Province) => this.onProvince(p));
    this.conquest.on('cityCaptured', (i: number) => this.renderer_.pulse(i, FACTIONS[PLAYER].glow));
    this.setupInput();
    this.scale.on('resize', () => this.clampZoom());
    this.scene.launch('hud');
    this.registry.set('map', this);
  }

  /** Zoom minimo = mondo intero a schermo. */
  private minZoom() {
    return Math.min(this.scale.width / WORLD_W, this.scale.height / WORLD_H);
  }

  private clampZoom() {
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom, this.minZoom(), BALANCE.camera.maxZoom * DPR));
  }

  centerOnTerritory(animate = true) {
    const [c, r] = this.conquest.centroid();
    const x = (c + 0.5) * CELL, y = (r + 0.5) * CELL;
    if (animate) this.cameras.main.pan(x, y, 350, 'Sine.easeInOut');
    else this.cameras.main.centerOn(x, y);
  }

  setTerrainMode(on: boolean) {
    this.renderer_.setTerrainMode(on);
  }

  setRatio(r: number) {
    this.conquest.ratio = r;
  }

  private setupInput() {
    const cam = this.cameras.main;
    this.input.addPointer(1);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const pts = this.activePointers();
      if (pts.length >= 2) {
        const [a, b] = pts;
        this.pinch = { d: Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y), zoom: cam.zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        if (this.down) this.down.drag = true; // niente tap dopo un pinch
        return;
      }
      this.down = { x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY, drag: false };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const pts = this.activePointers();
      if (this.pinch && pts.length >= 2) {
        const [a, b] = pts;
        const d = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        this.zoomAt(this.pinch.zoom * (d / this.pinch.d), mx, my);
        cam.scrollX -= (mx - this.pinch.mx) / cam.zoom;
        cam.scrollY -= (my - this.pinch.my) / cam.zoom;
        this.pinch.mx = mx; this.pinch.my = my;
        return;
      }
      if (!this.down || !p.isDown) return;
      const dx = p.x - this.down.x, dy = p.y - this.down.y;
      if (!this.down.drag && Math.hypot(dx, dy) > BALANCE.camera.dragThreshold * DPR) this.down.drag = true;
      if (this.down.drag) cam.setScroll(this.down.sx - dx / cam.zoom, this.down.sy - dy / cam.zoom);
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.pinch) {
        if (this.activePointers().length < 2) this.pinch = null;
        return;
      }
      const d = this.down;
      this.down = null;
      if (!d || d.drag) return;
      this.tap(p.worldX, p.worldY);
    });
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.zoomAt(cam.zoom * (dy > 0 ? 0.88 : 1.14), p.x, p.y);
    });
  }

  private activePointers() {
    return [this.input.pointer1, this.input.pointer2].filter((p) => p?.isDown);
  }

  /** Zoom mantenendo fermo il punto (sx, sy) dello schermo. */
  private zoomAt(z: number, sx: number, sy: number) {
    const cam = this.cameras.main;
    const before = cam.getWorldPoint(sx, sy);
    cam.setZoom(Phaser.Math.Clamp(z, this.minZoom(), BALANCE.camera.maxZoom * DPR));
    cam.preRender();
    const after = cam.getWorldPoint(sx, sy);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
  }

  private tap(x: number, y: number) {
    const now = this.time.now;
    const double = now - this.lastTap < BALANCE.camera.doubleTapMs;
    this.lastTap = double ? 0 : now;
    if (double) { this.centerOnTerritory(); return; }
    const i = cellAt(x, y);
    if (i < 0 || this.world.owner[i] === PLAYER) return; // tocco sul mio territorio: niente (doppio tocco = centra)
    if (this.conquest.launch(i)) {
      this.ping(x, y, THEME.attivo);
      buzz(BALANCE.fx.hapticCapture);
    } else {
      this.ping(x, y, THEME.pericolo, true);
    }
  }

  /** Segnale del tocco: anello (ondata partita) o croce (troppo lontano / non valido). */
  private ping(x: number, y: number, color: number, cross = false) {
    const s = DPR / this.cameras.main.zoom;
    if (cross) {
      const g = this.add.graphics().setPosition(x, y).setScale(s).setDepth(10);
      g.lineStyle(2, color, 1).lineBetween(-6, -6, 6, 6).lineBetween(-6, 6, 6, -6);
      this.tweens.add({ targets: g, alpha: 0, duration: 450, delay: 150, onComplete: () => g.destroy() });
      return;
    }
    const r = this.add.circle(x, y, 14, color, 0).setStrokeStyle(2, color).setScale(s).setDepth(10);
    this.tweens.add({ targets: r, scale: s * 2.2, alpha: 0, duration: 420, ease: 'Quad.easeOut', onComplete: () => r.destroy() });
  }

  private onProvince(p: Province) {
    this.renderer_.flashProvince(p);
    this.renderer_.pulse(p.city, FACTIONS[PLAYER].glow, 2);
    buzz([BALANCE.fx.hapticProvince, 40, BALANCE.fx.hapticProvince]);
    // numero del bottino che salta fuori dal centro della provincia
    const s = DPR / this.cameras.main.zoom;
    const x = (p.cx + 0.5) * CELL, y = (p.cy + 0.5) * CELL;
    const t = this.add.text(x, y, `+${p.value}`, titleStyle(22, THEME.allerta)).setOrigin(0.5).setScale(s * 0.4).setDepth(11);
    this.tweens.add({ targets: t, scale: s, y: y - 26 * s, duration: 260, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, y: y - 46 * s, delay: BALANCE.fx.lootPopMs - 400, duration: 400, onComplete: () => t.destroy() });
    this.game.events.emit('provinceCaptured', p);
  }

  update(_t: number, dt: number) {
    const now = this.time.now;
    this.conquest.update(dt);
    for (const c of this.conquest.captured) this.renderer_.capture(c.cell, c.owner, now);
    this.renderer_.setZoom(this.cameras.main.zoom);
    this.renderer_.update(now);
    this.renderer_.updateNames(this.cameras.main, (p) => this.conquest.provinceProgress(p));
  }
}

