// Icone a puntini (Nico, 25 novembre 2026: "come la carta a puntini"): le icone bianche delle costruzioni campionate su una
// griglia di quadratini, così sulla carta e nel menu COSTRUISCI hanno la stessa grana della mappa.
import type Phaser from 'phaser';

const GRIDS = new Map<string, Uint8Array>();
export const DOT_N = 11; // quadratini per lato

/** Griglia DOT_N × DOT_N dell'icona (1 = pieno), dall'alfa della texture; null se la texture non c'è. */
export function dotGrid(scene: Phaser.Scene, key: string): Uint8Array | null {
  const cached = GRIDS.get(key);
  if (cached) return cached;
  if (!scene.textures.exists(key)) return null;
  const src = scene.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const c = document.createElement('canvas');
  c.width = c.height = DOT_N * 4;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const data = ctx.getImageData(0, 0, c.width, c.height).data, out = new Uint8Array(DOT_N * DOT_N);
  for (let y = 0; y < DOT_N; y++) for (let x = 0; x < DOT_N; x++) {
    let a = 0;
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) a += data[((y * 4 + dy) * c.width + x * 4 + dx) * 4 + 3];
    out[y * DOT_N + x] = a / 16 > 110 ? 1 : 0;
  }
  GRIDS.set(key, out);
  return out;
}

/** Disegna l'icona a quadratini centrata in (x, y), larga `size`. */
export function drawDotIcon(g: Phaser.GameObjects.Graphics, grid: Uint8Array, x: number, y: number, size: number, color: number, alpha = 1) {
  const cell = size / DOT_N, dot = cell * 0.78, x0 = x - size / 2, y0 = y - size / 2;
  g.fillStyle(color, alpha);
  for (let r = 0; r < DOT_N; r++) for (let c = 0; c < DOT_N; c++) if (grid[r * DOT_N + c]) g.fillRect(x0 + c * cell, y0 + r * cell, dot, dot);
}

/** Texture dell'icona a puntini (per le immagini dell'interfaccia): `dot-<nome>`, bianca, da tingere. */
export function dotTexture(scene: Phaser.Scene, key: string): string {
  const out = `dot-${key}`;
  if (scene.textures.exists(out)) return out;
  const grid = dotGrid(scene, key);
  if (!grid) return key;
  const S = 4, ct = scene.textures.createCanvas(out, DOT_N * S, DOT_N * S)!, ctx = ct.getContext();
  ctx.fillStyle = '#ffffff';
  for (let r = 0; r < DOT_N; r++) for (let c = 0; c < DOT_N; c++) if (grid[r * DOT_N + c]) ctx.fillRect(c * S, r * S, 3, 3);
  ct.refresh();
  return out;
}
