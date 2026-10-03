// Esagoni "pointy-top", coordinate offset odd-r (righe dispari spostate a destra).
import { BALANCE } from '../config/balance';

const { cols, rows, hexSize: S, latMax, latMin } = BALANCE.map;
const SQRT3 = Math.sqrt(3);

export const HEX_W = SQRT3 * S;
export const WORLD_W = HEX_W * (cols + 0.5);
export const WORLD_H = S * 1.5 * (rows - 1) + 2 * S;

export const idx = (col: number, row: number) => row * cols + col;
export const colOf = (i: number) => i % cols;
export const rowOf = (i: number) => Math.floor(i / cols);

export function center(i: number): { x: number; y: number } {
  const c = colOf(i), r = rowOf(i);
  return { x: HEX_W * (c + 0.5 * (r & 1)) + HEX_W / 2, y: S * 1.5 * r + S };
}

export function lonLat(i: number): [number, number] {
  const c = colOf(i), r = rowOf(i);
  const lon = -180 + ((c + 0.5 + 0.5 * (r & 1)) / (cols + 0.5)) * 360;
  const lat = latMax - ((r + 0.5) / rows) * (latMax - latMin);
  return [lon, lat];
}

// Ordine allineato ai lati: lato k sta tra l'angolo k e k+1 (angoli a 30°+60°k).
// [basso-dx, basso-sx, sx, alto-sx, alto-dx, dx]
const EVEN: [number, number][] = [[0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, 0]];
const ODD: [number, number][] = [[1, 1], [0, 1], [-1, 0], [0, -1], [1, -1], [1, 0]];

/** Vicini per lato (−1 se fuori griglia). */
export function neighborsBySide(i: number): number[] {
  const c = colOf(i), r = rowOf(i);
  return ((r & 1) ? ODD : EVEN).map(([dc, dr]) => {
    const nc = c + dc, nr = r + dr;
    return nc < 0 || nc >= cols || nr < 0 || nr >= rows ? -1 : idx(nc, nr);
  });
}

export const NEIGHBORS: number[][] = Array.from({ length: cols * rows }, (_, i) => neighborsBySide(i));

export function corners(x: number, y: number, size: number = S): { x: number; y: number }[] {
  const out = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (30 + 60 * k);
    out.push({ x: x + size * Math.cos(a), y: y + size * Math.sin(a) });
  }
  return out;
}

/** Pixel-mondo → indice casella (−1 se fuori). */
export function pixelToIndex(px: number, py: number): number {
  const x = px - HEX_W / 2, y = py - S;
  const q = ((SQRT3 / 3) * x - y / 3) / S;
  const r = ((2 / 3) * y) / S;
  // arrotondamento cubico
  let rx = Math.round(q), rz = Math.round(r);
  const ry = Math.round(-q - r);
  const dx = Math.abs(rx - q), dy = Math.abs(ry + q + r), dz = Math.abs(rz - r);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dz >= dy) rz = -rx - ry;
  const row = rz, col = rx + (rz - (rz & 1)) / 2;
  return col < 0 || col >= cols || row < 0 || row >= rows ? -1 : idx(col, row);
}

function toCube(i: number): [number, number, number] {
  const c = colOf(i), r = rowOf(i);
  const x = c - (r - (r & 1)) / 2;
  return [x, -x - r, r];
}

/** Distanza in passi esagonali (ignora ostacoli). */
export function hexDistance(a: number, b: number): number {
  const [ax, ay, az] = toCube(a), [bx, by, bz] = toCube(b);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz));
}
