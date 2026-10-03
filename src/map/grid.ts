// Griglia quadrata equirettangolare sul mondo: indice = riga * cols + colonna.
import { BALANCE } from '../config/balance';

export const { cols: COLS, rows: ROWS, cellPx: CELL } = BALANCE.grid;
export const N = COLS * ROWS;
export const WORLD_W = COLS * CELL;
export const WORLD_H = ROWS * CELL;

export const idx = (c: number, r: number) => r * COLS + c;
export const colOf = (i: number) => i % COLS;
export const rowOf = (i: number) => (i / COLS) | 0;

/** Centro della casella in gradi [lon, lat]. */
export function lonLat(i: number): [number, number] {
  const { latMax, latMin } = BALANCE.grid;
  return [-180 + ((colOf(i) + 0.5) / COLS) * 360, latMax - ((rowOf(i) + 0.5) / ROWS) * (latMax - latMin)];
}

/** I 4 vicini [su, destra, giù, sinistra]; −1 fuori griglia (niente giro attorno al mondo). */
export function neighbors4(i: number): [number, number, number, number] {
  const c = colOf(i), r = rowOf(i);
  return [r > 0 ? i - COLS : -1, c < COLS - 1 ? i + 1 : -1, r < ROWS - 1 ? i + COLS : -1, c > 0 ? i - 1 : -1];
}

/** Tabella dei vicini precalcolata (4 per casella) per i cicli caldi. */
export const NB = new Int32Array(N * 4);
for (let i = 0; i < N; i++) NB.set(neighbors4(i), i * 4);

/** Pixel-mondo → casella (−1 fuori). */
export function cellAt(x: number, y: number): number {
  const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
  return c < 0 || c >= COLS || r < 0 || r >= ROWS ? -1 : idx(c, r);
}

export const cellX = (i: number) => colOf(i) * CELL;
export const cellY = (i: number) => rowOf(i) * CELL;
