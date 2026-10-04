// Terra e territorio disegnati vettoriali in una texture grande quanto lo schermo (più un margine): bordi netti a ogni
// zoom, niente sagome ingrandite e sgranate. Si ridisegna solo quando cambia il territorio (al massimo ~8 volte al secondo)
// o quando l'inquadratura esce dal margine / cambia molto lo zoom. Ordine: `before` (mare), strato 0 = terra (colori delle
// nazioni), `mid` (il rilievo), strato 1 = territorio delle potenze e velo del fronte.
import Phaser from 'phaser';
import type { RegionShape } from '../map/provinceShapes';

export interface TerritoryFill { p: number; color: number; alpha: number; layer: 0 | 1 }

/** Disegna altro nella texture: riquadro coperto in pixel-mondo (x0, y0, w, h) e pixel di texture per pixel-mondo (z). */
export type LayerHook = (rt: Phaser.GameObjects.RenderTexture, x0: number, y0: number, w: number, h: number, z: number) => void;

const MARGIN = 0.15; // margine attorno all'inquadratura (frazione per lato)
const MIN_GAP_MS = 120; // tra due ridisegni dovuti al territorio

/** Riempie la sagoma (parti esterne) di una provincia nella grafica; step > 1 salta punti da lontano. */
export function fillProvince(g: Phaser.GameObjects.Graphics, s: RegionShape, step = 1) {
  for (const part of s.parts) {
    const r = part.outer, n = r.length / 2;
    if (n < 3) continue;
    const st = n / step >= 4 ? step : 1;
    g.beginPath();
    g.moveTo(r[0], r[1]);
    for (let j = 2 * st; j < r.length; j += 2 * st) g.lineTo(r[j], r[j + 1]);
    g.closePath();
    g.fillPath();
  }
}

export class TerritoryLayer {
  private rt: Phaser.GameObjects.RenderTexture;
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly holes: Phaser.GameObjects.Graphics;
  private cover = { x: 0, y: 0, w: 0, h: 0, zoom: 0 };
  private dirty = true;
  private lastDraw = -1e9;
  private readonly holed: Uint8Array; // provincia con buchi (enclavi, laghi)

  /** res: pixel di texture per pixel dello schermo (sotto 1 sugli schermi molto densi, per la memoria). */
  constructor(private scene: Phaser.Scene, private shapes: RegionShape[], private depth: number, private res = 1) {
    this.rt = scene.add.renderTexture(0, 0, 8, 8).setOrigin(0).setDepth(depth);
    this.g = scene.make.graphics({}, false);
    this.holes = scene.make.graphics({}, false);
    this.holed = Uint8Array.from(shapes, (sh) => (sh.parts.some((pt) => pt.holes.length) ? 1 : 0));
  }

  /** Il territorio è cambiato: ridisegna appena possibile. */
  invalidate() {
    this.dirty = true;
  }

  /**
   * Da chiamare a ogni fotogramma: ridisegna se serve. `fills` elenca cosa colorare (proprietari, velo del fronte),
   * `step` riduce i punti delle sagome da lontano.
   */
  update(time: number, step: number, fills: (x0: number, y0: number, x1: number, y1: number) => TerritoryFill[],
    hooks: { before?: LayerHook; mid?: LayerHook } = {}) {
    const cam = this.scene.cameras.main, v = cam.worldView, c = this.cover;
    const inside = v.x >= c.x && v.y >= c.y && v.right <= c.x + c.w && v.bottom <= c.y + c.h;
    const zoomOk = c.zoom > 0 && Math.abs(cam.zoom / c.zoom - 1) < 0.12;
    if (inside && zoomOk && (!this.dirty || time - this.lastDraw < MIN_GAP_MS)) return;
    this.dirty = false;
    this.lastDraw = time;
    const z = cam.zoom * this.res;
    c.w = v.width * (1 + 2 * MARGIN);
    c.h = v.height * (1 + 2 * MARGIN);
    c.x = v.x - v.width * MARGIN;
    c.y = v.y - v.height * MARGIN;
    c.zoom = cam.zoom;
    const W = Math.min(4096, Math.ceil(c.w * z)), H = Math.min(4096, Math.ceil(c.h * z));
    if (W < 2 || H < 2) return void (this.dirty = true); // camera non ancora pronta
    if (this.rt.width !== W || this.rt.height !== H) {
      // nuova texture invece di resize(): in Phaser una RenderTexture ridimensionata smette di ricevere disegni
      this.rt.destroy();
      this.rt = this.scene.add.renderTexture(0, 0, W, H).setOrigin(0).setDepth(this.depth);
    }
    this.rt.setPosition(c.x, c.y).setScale(1 / z).clear();
    const g = this.g.clear().setPosition(-c.x * z, -c.y * z).setScale(z);
    const holes = this.holes.clear().setPosition(-c.x * z, -c.y * z).setScale(z);
    const list = fills(c.x, c.y, c.x + c.w, c.y + c.h);
    hooks.before?.(this.rt, c.x, c.y, c.w, c.h, z);
    this.pass(list.filter((f) => f.layer === 0), step, g, holes);
    hooks.mid?.(this.rt, c.x, c.y, c.w, c.h, z);
    this.pass(list.filter((f) => f.layer === 1), step, g, holes);
  }

  /** Prima le province con buchi (poi si svuotano i buchi), sopra le altre: le enclavi restano visibili. */
  private pass(list: TerritoryFill[], step: number, g: Phaser.GameObjects.Graphics, holes: Phaser.GameObjects.Graphics) {
    const withHoles = list.filter((f) => this.holed[f.p]);
    if (withHoles.length) {
      holes.fillStyle(0xffffff, 1);
      for (const f of withHoles) {
        g.fillStyle(f.color, f.alpha);
        fillProvince(g, this.shapes[f.p], step);
        for (const part of this.shapes[f.p].parts) {
          for (const h of part.holes) {
            holes.beginPath();
            holes.moveTo(h[0], h[1]);
            for (let j = 2; j < h.length; j += 2) holes.lineTo(h[j], h[j + 1]);
            holes.closePath();
            holes.fillPath();
          }
        }
      }
      this.rt.draw(g);
      this.rt.erase(holes);
      g.clear();
      holes.clear();
    }
    for (const f of list) {
      if (this.holed[f.p]) continue;
      g.fillStyle(f.color, f.alpha);
      fillProvince(g, this.shapes[f.p], step);
    }
    this.rt.draw(g);
    g.clear();
  }

  destroy() {
    this.rt.destroy();
    this.g.destroy();
    this.holes.destroy();
  }
}
