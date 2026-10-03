// Genera la mappa di una run a partire dal seed: deserti, rovine, zone tossiche, partenza.
import { BALANCE, type TileType } from '../config/balance';
import { createRng, randInt, type Rng } from './rng';
import { NEIGHBORS, lonLat } from './hexGrid';

export interface Tile {
  i: number;
  type: TileType;
  defense: number;
  loot: number;
}

export interface RunMap {
  seed: string;
  tiles: (Tile | null)[]; // null = mare
  land: number[]; // indici delle caselle di terra
  start: number;
}

const M = BALANCE.map;

export function generateMap(seed: string, landMask: Uint8Array): RunMap {
  const rng = createRng(seed);
  const tiles: (Tile | null)[] = new Array(landMask.length).fill(null);
  const land: number[] = [];

  for (let i = 0; i < landMask.length; i++) {
    if (!landMask[i]) continue;
    const absLat = Math.abs(lonLat(i)[1]);
    const inBand = absLat >= M.desertLatBand[0] && absLat <= M.desertLatBand[1];
    const desert = rng() < (inBand ? M.desertChance : M.desertSprinkle);
    tiles[i] = { i, type: desert ? 'deserto' : 'terra', defense: 0, loot: 0 };
    land.push(i);
  }

  // Zone tossiche: macchie cresciute casualmente.
  for (let k = 0; k < M.toxicClusters; k++) {
    let cur = land[Math.floor(rng() * land.length)];
    const size = randInt(rng, M.toxicClusterSize[0], M.toxicClusterSize[1]);
    for (let s = 0; s < size; s++) {
      tiles[cur]!.type = 'tossica';
      const next = NEIGHBORS[cur].filter((n) => n >= 0 && tiles[n]);
      if (!next.length) break;
      cur = next[Math.floor(rng() * next.length)];
    }
  }

  // Rovine sparse.
  for (let k = 0; k < M.ruinsCount; k++) {
    const t = tiles[land[Math.floor(rng() * land.length)]]!;
    if (t.type !== 'tossica') t.type = 'rovine';
  }

  for (const i of land) {
    const t = tiles[i]!;
    if (t.type === 'tossica') continue;
    t.defense = rollDefense(rng, t.type);
    if (t.type === 'rovine') t.loot = randInt(rng, BALANCE.loot.rovine[0], BALANCE.loot.rovine[1]);
  }

  return { seed, tiles, land, start: pickStart(rng, tiles, land) };
}

function rollDefense(rng: Rng, type: Exclude<TileType, 'tossica'>): number {
  const base = BALANCE.defense[type];
  const v = BALANCE.defense.variance;
  return Math.max(1, Math.round(base * (1 - v + rng() * 2 * v)));
}

const passable = (t: Tile | null): t is Tile => !!t && t.type !== 'tossica';

/** Partenza casuale su terra, dentro una regione abbastanza grande (niente isolette). */
function pickStart(rng: Rng, tiles: (Tile | null)[], land: number[]): number {
  const region = new Int32Array(tiles.length).fill(-1);
  const sizes: number[] = [];
  for (const i of land) {
    if (region[i] >= 0 || !passable(tiles[i])) continue;
    const id = sizes.length;
    let count = 0;
    const stack = [i];
    region[i] = id;
    while (stack.length) {
      const c = stack.pop()!;
      count++;
      for (const n of NEIGHBORS[c]) {
        if (n >= 0 && region[n] < 0 && passable(tiles[n])) {
          region[n] = id;
          stack.push(n);
        }
      }
    }
    sizes.push(count);
  }
  const ok = land.filter(
    (i) => tiles[i]!.type === 'terra' && sizes[region[i]] >= BALANCE.map.minStartRegion &&
      NEIGHBORS[i].every((n) => passable(tiles[n] ?? null)),
  );
  const pool = ok.length ? ok : land.filter((i) => passable(tiles[i]));
  return pool[Math.floor(rng() * pool.length)];
}
