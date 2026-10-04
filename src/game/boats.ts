// Navi da sbarco: viaggiano sulle caselle di mare (null nella mappa) e sbarcano su una costa.
import { neighbors } from '../map/hexGrid';
import type { Tile } from '../map/generate';

export interface Boat {
  id: number;
  owner: number;
  from: number; // casella di costa da cui parte
  path: number[]; // caselle di mare, l'ultima è la casella di sbarco
  pos: number; // indice nel percorso
  troops: number;
  acc: number;
}

const isSea = (tiles: (Tile | null)[], i: number) => i >= 0 && !tiles[i];

/** Una casella di terra che tocca il mare. */
export const isCoast = (tiles: (Tile | null)[], i: number) => !!tiles[i] && neighbors(i).some((n) => isSea(tiles, n));

/**
 * Rotta più breve dal mare vicino alle coste `owned` fino al mare vicino a `target`.
 * Ritorna { from, path } con path = [mare..., target], oppure null se oltre maxSea.
 */
export function seaRoute(tiles: (Tile | null)[], owned: (i: number) => boolean, target: number, maxSea: number) {
  const prev = new Int32Array(tiles.length).fill(-2); // -2 non visitato, -1 sorgente
  const origin = new Int32Array(tiles.length).fill(-1);
  const dist = new Int16Array(tiles.length);
  const queue: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (!tiles[i] || !owned(i)) continue;
    for (const n of neighbors(i)) {
      if (isSea(tiles, n) && prev[n] === -2) {
        prev[n] = -1;
        origin[n] = i;
        dist[n] = 1;
        queue.push(n);
      }
    }
  }
  const goal = new Set(neighbors(target).filter((n) => isSea(tiles, n)));
  for (let h = 0; h < queue.length; h++) {
    const c = queue[h];
    if (goal.has(c)) {
      const path: number[] = [];
      let k = c;
      while (k >= 0) {
        path.push(k);
        k = prev[k];
      }
      // risale fino alla sorgente per sapere da quale costa si parte
      let s = c;
      while (prev[s] >= 0) s = prev[s];
      return { from: origin[s], path: [...path.reverse(), target] };
    }
    if (dist[c] >= maxSea) continue;
    for (const n of neighbors(c)) {
      if (isSea(tiles, n) && prev[n] === -2) {
        prev[n] = c;
        dist[n] = dist[c] + 1;
        queue.push(n);
      }
    }
  }
  return null;
}
