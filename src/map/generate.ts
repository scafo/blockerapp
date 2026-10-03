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
  starts: number[]; // [giocatore, ...IA]
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

  return { seed, tiles, land, starts: pickStarts(rng, tiles, land) };
}

function rollDefense(rng: Rng, type: Exclude<TileType, 'tossica'>): number {
  const base = BALANCE.defense[type];
  const v = BALANCE.defense.variance;
  return Math.max(1, Math.round(base * (1 - v + rng() * 2 * v)));
}

const passable = (t: Tile | null): t is Tile => !!t && t.type !== 'tossica';

/** Distanze in passi esagonali da `from` sulle caselle attraversabili (−1 = irraggiungibile). */
function bfs(tiles: (Tile | null)[], from: number): Int32Array {
  const dist = new Int32Array(tiles.length).fill(-1);
  dist[from] = 0;
  const queue = [from];
  for (let h = 0; h < queue.length; h++) {
    const c = queue[h];
    for (const n of NEIGHBORS[c]) {
      if (n >= 0 && dist[n] < 0 && passable(tiles[n])) {
        dist[n] = dist[c] + 1;
        queue.push(n);
      }
    }
  }
  return dist;
}

const goodStart = (tiles: (Tile | null)[], i: number) =>
  tiles[i]!.type === 'terra' && NEIGHBORS[i].every((n) => passable(tiles[n] ?? null));

/**
 * Partenza del giocatore casuale in una regione grande (niente isolette);
 * le IA partono nella stessa regione, a distanza giusta per incontrarsi presto.
 */
function pickStarts(rng: Rng, tiles: (Tile | null)[], land: number[]): number[] {
  const pick = <T>(a: T[]) => a[Math.floor(rng() * a.length)];
  const ok = land.filter((i) => goodStart(tiles, i));
  let player = -1;
  let dist: Int32Array = new Int32Array(0);
  for (let tries = 0; tries < 40; tries++) {
    player = pick(ok);
    dist = bfs(tiles, player);
    let size = 0;
    for (const d of dist) if (d >= 0) size++;
    if (size >= BALANCE.map.minStartRegion) break;
  }

  const { startDistance: [dMin, dMax], minDistanceBetween, count } = BALANCE.ai;
  const reachable = ok.filter((i) => dist[i] > 2 * BALANCE.start.radius + 1);
  const starts = [player];
  const aiDist: Int32Array[] = [];
  for (let k = 0; k < count; k++) {
    const apart = (i: number) => aiDist.every((d) => d[i] >= minDistanceBetween);
    const band = reachable.filter((i) => dist[i] >= dMin && dist[i] <= dMax && !starts.includes(i));
    const tries = [band.filter(apart), band, reachable.filter((i) => !starts.includes(i))];
    const pool = tries.find((t) => t.length);
    if (!pool) break;
    starts.push(pick(pool));
    aiDist.push(bfs(tiles, starts[starts.length - 1]));
  }
  return starts;
}
