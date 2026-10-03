// Disegno della mappa: base statica (canvas, una volta), territorio su RenderTexture aggiornata solo nelle caselle cambiate,
// alone a bassa risoluzione (1 texel per casella, filtrato) in additivo, animazioni di conquista in pool.
import Phaser from 'phaser';
import { BALANCE, T } from '../config/balance';
import { FACTIONS, FONT_TITLE, THEME, hex } from '../config/theme';
import { CELL, COLS, N, NB, ROWS, WORLD_H, WORLD_W, cellX, cellY, colOf, rowOf } from '../map/grid';
import type { Province, World } from '../map/world';
import { DPR } from '../ui/screen';

const GAP = BALANCE.grid.gapPx;
const S = CELL - GAP; // lato del quadrato visibile
const F = BALANCE.fx.frontPx;
const lerpColor = (a: number, b: number, t: number) => {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t) << s;
  return ch(16) | ch(8) | ch(0);
};

interface Anim { img: Phaser.GameObjects.Image; cell: number; owner: number; t0: number }

export class MapRenderer {
  private baseTex: Phaser.Textures.CanvasTexture;
  private owner: Phaser.GameObjects.RenderTexture;
  private glow: Phaser.GameObjects.RenderTexture;
  private animLayer: Phaser.GameObjects.Layer;
  private pool: Phaser.GameObjects.Image[] = [];
  private anims: Anim[] = [];
  private dirty = new Set<number>();
  private names: Phaser.GameObjects.Text[] = [];
  private lastView = '';
  terrainMode = false;

  constructor(private scene: Phaser.Scene, private w: World) {
    const tx = scene.textures;
    const mk = (key: string, wd: number, ht: number) => {
      if (tx.exists(key)) return;
      const c = tx.createCanvas(key, wd, ht)!;
      c.context.fillStyle = '#fff';
      c.context.fillRect(0, 0, wd, ht);
      c.refresh();
    };
    mk('sq', S, S); mk('eh', S, F); mk('ev', F, S); mk('dot', 1, 1);

    this.baseTex = tx.exists('mapBase') ? (tx.get('mapBase') as Phaser.Textures.CanvasTexture) : tx.createCanvas('mapBase', WORLD_W, WORLD_H)!;
    this.drawBase();
    this.baseTex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    scene.add.image(0, 0, 'mapBase').setOrigin(0);

    // alone sotto il territorio: 1 texel per casella, allargato con filtro lineare = sfumatura gratis
    this.glow = scene.add.renderTexture(0, 0, COLS, ROWS).setOrigin(0).setScale(CELL).setBlendMode(Phaser.BlendModes.ADD).setAlpha(BALANCE.fx.glowAlpha);
    this.glow.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    // sopra l'alone: i quadrati pieni; l'alone resta visibile nei gap e fuori dal confine
    this.owner = scene.add.renderTexture(0, 0, WORLD_W, WORLD_H).setOrigin(0);
    this.owner.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.animLayer = scene.add.layer();

    // territorio iniziale
    for (let i = 0; i < N; i++) if (w.owner[i] >= 0) this.dirty.add(i);
    this.flush();
  }

  /** Base statica: caselle con gap, luminosità e trama del terreno, costa e confini di provincia nel gap. */
  drawBase() {
    const w = this.w, ctx = this.baseTex.context, tm = this.terrainMode;
    const pal = tm ? THEME.colore : THEME.lum;
    ctx.fillStyle = hex(THEME.sfondo);
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    const tname = ['mare', 'pianura', 'foresta', 'deserto', 'montagna', 'caduta'] as const;
    const shade = (c: number, k: number) => hex(lerpColor(c, k > 0 ? 0xffffff : 0x000000, Math.abs(k)));
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) {
      const x = cellX(i), y = cellY(i), t = w.terrain[i];
      if (t === T.mare) { ctx.fillStyle = hex(THEME.mare); ctx.fillRect(x, y, S, S); continue; }
      const base = pal[tname[t] as keyof typeof pal];
      ctx.fillStyle = hex(base);
      ctx.fillRect(x, y, S, S);
      // trama
      if (t === T.foresta) {
        ctx.fillStyle = shade(base, 0.18);
        ctx.fillRect(x + 1, y + 1, 2, 2); ctx.fillRect(x + 4, y + 4, 2, 2);
      } else if (t === T.montagna) {
        ctx.fillStyle = shade(base, 0.3);
        ctx.fillRect(x + 3, y + 1, 1, 1); ctx.fillRect(x + 2, y + 2, 3, 1); ctx.fillRect(x + 1, y + 3, 5, 1);
      } else if (t === T.deserto) {
        ctx.fillStyle = shade(base, 0.12);
        ctx.fillRect(x + ((i * 7) % 5) + 1, y + ((i * 3) % 5) + 1, 1, 1);
      } else if (t === T.caduta) {
        // glitch statico: righe spezzate chiare/scure
        for (let k = 0; k < 3; k++) {
          ctx.fillStyle = rnd() < 0.5 ? shade(tm ? base : 0x3a2a40, 0.2) : '#000';
          ctx.fillRect(x + Math.floor(rnd() * 3), y + Math.floor(rnd() * S), 2 + Math.floor(rnd() * 5), 1);
        }
      }
    }
    // fiumi: linee che uniscono i centri, anche attraverso il gap
    ctx.fillStyle = hex(pal.fiume);
    for (let i = 0; i < N; i++) {
      if (!w.river[i]) continue;
      const x = cellX(i), y = cellY(i);
      ctx.fillRect(x + 2, y + 2, 3, 3);
      const r = NB[i * 4 + 1], d = NB[i * 4 + 2];
      if (r >= 0 && w.river[r]) ctx.fillRect(x + 4, y + 2, CELL, 3);
      if (d >= 0 && w.river[d]) ctx.fillRect(x + 2, y + 4, 3, CELL);
    }
    // gap: costa e confini di provincia
    for (let i = 0; i < N; i++) {
      const x = cellX(i), y = cellY(i);
      const land = w.terrain[i] !== T.mare;
      for (const [k, gx, gy, gw, gh] of [[1, x + S, y, GAP, CELL], [2, x, y + S, CELL, GAP]] as const) {
        const n = NB[i * 4 + k];
        if (n < 0) continue;
        const nland = w.terrain[n] !== T.mare;
        if (land !== nland) ctx.fillStyle = hex(THEME.costa);
        else if (land && w.province[i] !== w.province[n]) ctx.fillStyle = hex(THEME.confineProvincia);
        else continue;
        ctx.fillRect(gx, gy, gw, gh);
      }
    }
    // città: quadratino chiaro con cornice
    for (const p of w.provinces) {
      const x = cellX(p.city), y = cellY(p.city);
      ctx.fillStyle = hex(pal.citta);
      ctx.fillRect(x + 1, y + 1, S - 2, S - 2);
      ctx.fillStyle = hex(tm ? 0x000000 : THEME.sfondo);
      ctx.fillRect(x + 2, y + 2, S - 4, S - 4);
      ctx.fillStyle = hex(pal.citta);
      ctx.fillRect(x + 3, y + 3, 1, 1);
    }
    this.baseTex.refresh();
  }

  setTerrainMode(on: boolean) {
    this.terrainMode = on;
    this.drawBase();
    this.owner.setAlpha(on ? 0.35 : 1);
    this.glow.setVisible(!on);
  }

  /** Nuove caselle prese: animazione fade + scala, poi timbro nella texture. */
  capture(cell: number, owner: number, now: number) {
    const img = this.pool.pop() ?? this.scene.make.image({ key: 'sq', add: false });
    img.setPosition(cellX(cell) + S / 2, cellY(cell) + S / 2).setVisible(true);
    this.animLayer.add(img);
    this.anims.push({ img, cell, owner, t0: now });
  }

  /** Da lontano i gap di 1 pixel farebbero moiré: filtro lineare sotto 1 pixel schermo per texel. */
  private nearest = true;
  setZoom(zoom: number) {
    const nearest = zoom >= 1;
    if (nearest === this.nearest) return;
    this.nearest = nearest;
    const mode = nearest ? Phaser.Textures.FilterMode.NEAREST : Phaser.Textures.FilterMode.LINEAR;
    this.baseTex.setFilter(mode);
    this.owner.texture.setFilter(mode);
  }

  update(now: number) {
    const fx = BALANCE.fx;
    for (let k = this.anims.length - 1; k >= 0; k--) {
      const a = this.anims[k];
      const p = Math.min(1, (now - a.t0) / fx.captureMs);
      const e = 1 - (1 - p) * (1 - p);
      const f = FACTIONS[a.owner];
      a.img.setScale(fx.captureFromScale + (1 - fx.captureFromScale) * e).setAlpha(0.4 + 0.6 * p).setTint(lerpColor(f.glow, f.fill, e));
      if (p >= 1) {
        this.dirty.add(a.cell);
        for (let j = 0; j < 4; j++) { const n = NB[a.cell * 4 + j]; if (n >= 0 && this.w.owner[n] >= 0) this.dirty.add(n); }
        this.animLayer.remove(a.img);
        a.img.setVisible(false);
        this.pool.push(a.img);
        this.anims[k] = this.anims[this.anims.length - 1];
        this.anims.pop();
      }
    }
    if (this.dirty.size) this.flush();
  }

  /** Ridisegna solo le caselle cambiate (in un unico batch). */
  private flush() {
    const w = this.w;
    // un batch alla volta: due beginDraw annidati scriverebbero nella texture sbagliata
    this.owner.beginDraw();
    for (const i of this.dirty) {
      const o = w.owner[i];
      if (o < 0) continue;
      const f = FACTIONS[o], x = cellX(i), y = cellY(i);
      this.owner.batchDrawFrame('sq', undefined, x, y, 1, f.fill);
      // confine di fazione spesso e luminoso sui lati verso chi non è mio
      const up = NB[i * 4], rt = NB[i * 4 + 1], dn = NB[i * 4 + 2], lf = NB[i * 4 + 3];
      const g = f.glow;
      if (up < 0 || w.owner[up] !== o) this.owner.batchDrawFrame('eh', undefined, x, y, 1, g);
      if (dn < 0 || w.owner[dn] !== o) this.owner.batchDrawFrame('eh', undefined, x, y + S - F, 1, g);
      if (lf < 0 || w.owner[lf] !== o) this.owner.batchDrawFrame('ev', undefined, x, y, 1, g);
      if (rt < 0 || w.owner[rt] !== o) this.owner.batchDrawFrame('ev', undefined, x + S - F, y, 1, g);
    }
    this.owner.endDraw();
    this.glow.beginDraw();
    for (const i of this.dirty) if (w.owner[i] >= 0) this.glow.batchDrawFrame('dot', undefined, colOf(i), rowOf(i), 1, FACTIONS[w.owner[i]].glow);
    this.glow.endDraw();
    this.dirty.clear();
  }

  /** Lampo sulle caselle della provincia appena completata. */
  flashProvince(p: Province) {
    const g = this.scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    g.fillStyle(0xffffff, 1);
    for (const i of p.cells) g.fillRect(cellX(i), cellY(i), S, S);
    this.scene.tweens.add({ targets: g, alpha: { from: 0.85, to: 0 }, duration: BALANCE.fx.provinceFlashMs, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
  }

  /** Anello sulla città presa. */
  pulse(cell: number, color: number, scale = 1) {
    const r = this.scene.add.circle(cellX(cell) + S / 2, cellY(cell) + S / 2, CELL * 1.5, color, 0).setStrokeStyle(2, color).setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({ targets: r, scale: { from: 0.3, to: 2.5 * scale }, alpha: { from: 1, to: 0 }, duration: BALANCE.fx.cityPulseMs, onComplete: () => r.destroy() });
  }

  /** Nomi delle province visibili, a dimensione costante sullo schermo (pool di testi). */
  updateNames(cam: Phaser.Cameras.Scene2D.Camera, owned: (p: number) => number) {
    const zoom = cam.zoom / DPR;
    const v = cam.worldView;
    const key = `${Math.round(v.x)},${Math.round(v.y)},${zoom.toFixed(2)}`;
    if (key === this.lastView) return;
    this.lastView = key;
    const show = zoom >= BALANCE.camera.namesZoom;
    const vis: Province[] = [];
    if (show) for (const p of this.w.provinces) {
      const x = (p.cx + 0.5) * CELL, y = (p.cy + 0.5) * CELL;
      if (x > v.x && x < v.right && y > v.y && y < v.bottom) vis.push(p);
    }
    vis.sort((a, b) => b.cells.length - a.cells.length);
    // niente nomi sovrapposti: scarta quelli troppo vicini (in punti schermo) a uno già messo
    const placed: [number, number, number][] = [];
    const kept: Province[] = [];
    for (const p of vis) {
      const sx = (p.cx + 0.5) * CELL * zoom, sy = (p.cy + 0.5) * CELL * zoom, hw = p.name.length * 3.6 + 6;
      if (placed.some(([x, y, w]) => Math.abs(x - sx) < w + hw && Math.abs(y - sy) < 16)) continue;
      placed.push([sx, sy, hw]);
      kept.push(p);
    }
    vis.length = 0;
    vis.push(...kept);
    const max = 40;
    while (this.names.length < Math.min(max, vis.length)) {
      this.names.push(this.scene.add.text(0, 0, '', { fontFamily: FONT_TITLE, fontSize: '11px', color: hex(THEME.testoDebole), resolution: DPR }).setOrigin(0.5).setDepth(5));
    }
    this.names.forEach((t, k) => {
      const p = vis[k];
      if (!p || k >= max) { t.setVisible(false); return; }
      const mine = owned(p.id) === p.cells.length;
      t.setVisible(true).setText(p.name.toUpperCase()).setPosition((p.cx + 0.5) * CELL, (p.cy + 0.5) * CELL - CELL)
        .setScale(DPR / cam.zoom).setColor(hex(mine ? THEME.testo : THEME.testoDebole)).setAlpha(mine ? 0.95 : 0.7);
    });
  }

  refreshNames() { this.lastView = ''; }
}
