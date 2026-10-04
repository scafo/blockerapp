// Colore delle province possedute: ogni provincia è una sagoma bianca in un atlante (disegnata una volta),
// mostrata come immagine tinta col colore della fazione. Cambiare proprietario = cambiare tinta: costa nulla.
import Phaser from 'phaser';
import type { RegionShape } from '../map/provinceShapes';

const PAGE = 2048;
const PAD = 3; // pixel-mondo di margine attorno a ogni sagoma

interface Slot { page: number; x: number; y: number; w: number; h: number }

export class ProvinceLayer {
  readonly images: (Phaser.GameObjects.Image | null)[] = [];
  private keys: string[] = [];

  constructor(scene: Phaser.Scene, shapes: RegionShape[], k: number, depth: number, prefix = 'prov') {
    // impaginazione a scaffali, dalla più alta
    const order = shapes.map((_, i) => i).filter((i) => shapes[i].outer.length >= 6)
      .sort((a, b) => (shapes[b].y1 - shapes[b].y0) - (shapes[a].y1 - shapes[a].y0));
    const slots: (Slot | null)[] = shapes.map(() => null);
    let page = 0, x = 0, y = 0, rowH = 0;
    for (const i of order) {
      const s = shapes[i];
      const w = Math.ceil((s.x1 - s.x0 + 2 * PAD) * k), h = Math.ceil((s.y1 - s.y0 + 2 * PAD) * k);
      if (x + w > PAGE) { x = 0; y += rowH; rowH = 0; }
      if (y + h > PAGE) { page++; x = 0; y = 0; rowH = 0; }
      slots[i] = { page, x, y, w, h };
      x += w;
      rowH = Math.max(rowH, h);
    }
    const pages = order.length ? page + 1 : 0;
    for (let p = 0; p < pages; p++) {
      const key = `${prefix}-${p}`;
      if (scene.textures.exists(key)) scene.textures.remove(key);
      const usedH = p < page ? PAGE : Math.min(PAGE, y + rowH + 2);
      const dt = scene.textures.addDynamicTexture(key, PAGE, Math.max(8, usedH))!;
      const g = scene.make.graphics({}, false);
      const holes = scene.make.graphics({}, false);
      g.fillStyle(0xffffff, 1).lineStyle(1.4 * k, 0xffffff, 1); // contorno: sagome appena dilatate, niente fessure tra vicine
      holes.fillStyle(0xffffff, 1);
      shapes.forEach((s, i) => {
        const sl = slots[i];
        if (!sl || sl.page !== p) return;
        const tx = (vx: number) => sl.x + (vx - s.x0 + PAD) * k, ty = (vy: number) => sl.y + (vy - s.y0 + PAD) * k;
        const pts = (r: number[]) => {
          const out: Phaser.Types.Math.Vector2Like[] = [];
          for (let j = 0; j < r.length; j += 2) out.push({ x: tx(r[j]), y: ty(r[j + 1]) });
          return out;
        };
        g.fillPoints(pts(s.outer), true).strokePoints(pts(s.outer), true, true);
        for (const h of s.holes) holes.fillPoints(pts(h), true);
      });
      dt.draw(g);
      dt.erase(holes);
      g.destroy();
      holes.destroy();
      this.keys.push(key);
      slots.forEach((sl, i) => {
        if (sl && sl.page === p) dt.add(String(i), 0, sl.x, sl.y, sl.w, sl.h);
      });
    }
    shapes.forEach((s, i) => {
      const sl = slots[i];
      if (!sl) return void this.images.push(null);
      const img = scene.add.image(s.x0 - PAD, s.y0 - PAD, this.keys[sl.page], String(i))
        .setOrigin(0).setScale(1 / k).setDepth(depth).setVisible(false);
      this.images.push(img);
    });
  }

  set(i: number, color: number | null, alpha = 0.62) {
    const img = this.images[i];
    if (!img) return;
    if (color === null) return void img.setVisible(false);
    img.setVisible(true).setTint(color).setAlpha(alpha);
  }

  /** Sagoma usa-e-getta (lampi, evidenziazioni) nella stessa posizione della provincia. */
  ghost(scene: Phaser.Scene, i: number, color: number, alpha: number, depth: number): Phaser.GameObjects.Image | null {
    const img = this.images[i];
    if (!img) return null;
    return scene.add.image(img.x, img.y, img.texture.key, img.frame.name).setOrigin(0).setScale(img.scaleX)
      .setTint(color).setAlpha(alpha).setDepth(depth);
  }

  destroy(scene: Phaser.Scene) {
    for (const img of this.images) img?.destroy();
    for (const k of this.keys) if (scene.textures.exists(k)) scene.textures.remove(k);
  }
}
