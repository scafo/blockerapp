// Genera la mappa di una run a partire dal seed: deserti, rovine, zone tossiche, partenza.
import { BALANCE, type Resource, type TileType } from '../config/balance';
import { createRng, randInt, type Rng } from './rng';
import { NEIGHBORS, center, hexDistance, lonLat } from './hexGrid';
import type { CountryMap } from './countries';

export interface Tile {
  i: number;
  type: TileType;
  defense: number;
  loot: number;
  lootType: Resource;
  country: number; // nazione reale (−1 se sconosciuta)
  province: number; // provincia (−1 se nessuna)
  city: boolean;
  capital: boolean;
}

export interface Province {
  country: number;
  city: number; // casella della città (−1 se la provincia non ne ha)
  tiles: number[];
}

export interface Nation {
  id: number; // indice nella CountryMap
  name: string;
  capital: number; // casella della capitale (−1 se nessuna)
  size: number;
  label: number; // casella dove scrivere il nome
}

export interface RunMap {
  seed: string;
  tiles: (Tile | null)[]; // null = mare
  land: number[]; // indici delle caselle di terra
  starts: number[]; // [giocatore, ...IA]
  regionSize: number; // caselle attraversabili raggiungibili dalla partenza del giocatore
  anomalies: number[];
  stormCenter: number;
  provinces: Province[];
  nations: Nation[];
}

const M = BALANCE.map;

export function generateMap(seed: string, landMask: Uint8Array, aiCount: number = BALANCE.ai.count, countries: CountryMap | null = null): RunMap {
  const rng = createRng(seed);
  const tiles: (Tile | null)[] = new Array(landMask.length).fill(null);
  const land: number[] = [];

  for (let i = 0; i < landMask.length; i++) {
    if (!landMask[i]) continue;
    const absLat = Math.abs(lonLat(i)[1]);
    const inBand = absLat >= M.desertLatBand[0] && absLat <= M.desertLatBand[1];
    const desert = rng() < (inBand ? M.desertChance : M.desertSprinkle);
    tiles[i] = {
      i, type: desert ? 'deserto' : 'terra', defense: 0, loot: 0, lootType: 'rottami',
      country: countries ? countries.country[i] : -1, province: -1, city: false, capital: false,
    };
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
    if (t.type === 'rovine') {
      t.lootType = pickWeighted(rng, BALANCE.loot.weights);
      t.loot = randInt(rng, BALANCE.loot[t.lootType][0], BALANCE.loot[t.lootType][1]);
    }
  }

  const starts = pickStarts(rng, tiles, land, aiCount);
  const dist = bfs(tiles, starts[0]);
  const region = land.filter((i) => dist[i] >= 0);
  const anomalies = placeAnomalies(rng, tiles, region, dist, starts);
  const { provinces, nations } = countries ? buildProvinces(rng, tiles, land, starts, countries) : { provinces: [], nations: [] };
  return { seed, tiles, land, starts, regionSize: region.length, anomalies, stormCenter: pickStormCenter(rng, region), provinces, nations };
}

/**
 * Province alla Call of War: ogni nazione è divisa in province di circa `size` caselle attorno a città scelte lontane
 * tra loro (cambiano con il seed). La città più vicina al cuore della nazione è la capitale.
 */
function buildProvinces(rng: Rng, tiles: (Tile | null)[], land: number[], starts: number[], cm: CountryMap) {
  const P = BALANCE.provinces;
  const provinces: Province[] = [];
  const nations: Nation[] = [];
  const nearStart = (i: number) => starts.some((s) => hexDistance(s, i) <= 1);
  const byCountry = new Map<number, number[]>();
  for (const i of land) {
    const c = tiles[i]!.country;
    if (c >= 0) (byCountry.get(c) ?? byCountry.set(c, []).get(c)!).push(i);
  }
  for (const [c, all] of byCountry) {
    // componenti connesse della nazione (isole, enclavi): ognuna ha le sue province
    const comp = new Map<number, number>();
    const comps: number[][] = [];
    for (const i of all) {
      if (comp.has(i)) continue;
      const list = [i];
      comp.set(i, comps.length);
      for (let h = 0; h < list.length; h++) {
        for (const n of NEIGHBORS[list[h]]) {
          if (n >= 0 && tiles[n]?.country === c && !comp.has(n)) {
            comp.set(n, comps.length);
            list.push(n);
          }
        }
      }
      comps.push(list);
    }
    let capital = -1, bestCap = Infinity;
    const main = comps.reduce((a, b) => (b.length > a.length ? b : a));
    for (const part of comps) {
      if (part.length < P.minTilesForCity) continue; // isolette e staterelli: niente città
      const candidates = part.filter((i) => {
        const t = tiles[i]!;
        return (t.type === 'terra' || t.type === 'deserto') && !nearStart(i);
      });
      if (!candidates.length) continue;
      // città lontane tra loro (campionamento del punto più lontano)
      const k = Math.max(1, Math.round(part.length / P.size));
      const cities = [candidates[Math.floor(rng() * candidates.length)]];
      while (cities.length < k) {
        let best = -1, bestD = -1;
        for (const i of candidates) {
          const d = Math.min(...cities.map((s) => hexDistance(s, i))) + rng() * 0.5;
          if (d > bestD) {
            bestD = d;
            best = i;
          }
        }
        if (bestD < 2) break;
        cities.push(best);
      }
      // ogni casella va alla città più vicina (BFS dentro la nazione)
      const first = provinces.length;
      const queue: number[] = [];
      cities.forEach((s, j) => {
        provinces.push({ country: c, city: s, tiles: [] });
        tiles[s]!.province = first + j;
        tiles[s]!.city = true;
        queue.push(s);
      });
      for (let h = 0; h < queue.length; h++) {
        const cur = queue[h];
        provinces[tiles[cur]!.province].tiles.push(cur);
        for (const n of NEIGHBORS[cur]) {
          const t = n >= 0 ? tiles[n] : null;
          if (t && t.country === c && t.province < 0 && comp.get(n) === comp.get(cur)) {
            t.province = tiles[cur]!.province;
            queue.push(n);
          }
        }
      }
      if (part === main) {
        // capitale: la città più vicina al baricentro della parte principale
        let sx = 0, sy = 0;
        for (const i of part) {
          const p = center(i);
          sx += p.x;
          sy += p.y;
        }
        sx /= part.length;
        sy /= part.length;
        for (const s of cities) {
          const p = center(s), d = Math.hypot(p.x - sx, p.y - sy);
          if (d < bestCap) {
            bestCap = d;
            capital = s;
          }
        }
      }
    }
    // dove scrivere il nome: la casella della parte principale più vicina al suo baricentro
    let lx = 0, ly = 0;
    for (const i of main) {
      const p = center(i);
      lx += p.x;
      ly += p.y;
    }
    lx /= main.length;
    ly /= main.length;
    const label = main.reduce((a, b) => {
      const pa = center(a), pb = center(b);
      return Math.hypot(pb.x - lx, pb.y - ly) < Math.hypot(pa.x - lx, pa.y - ly) ? b : a;
    });
    if (capital >= 0) tiles[capital]!.capital = true;
    nations.push({ id: c, name: cm.names[c], capital, size: all.length, label });
  }
  // città e capitali più difese
  for (const p of provinces) {
    const t = tiles[p.city]!;
    t.defense = Math.round(t.defense * P.cityDefenseMult) + P.cityDefenseBonus + (t.capital ? P.capitalDefenseBonus : 0);
  }
  return { provinces, nations };
}

function pickWeighted<K extends string>(rng: Rng, weights: Record<K, number>): K {
  const keys = Object.keys(weights) as K[];
  let r = rng() * keys.reduce((a, k) => a + weights[k], 0);
  for (const k of keys) if ((r -= weights[k]) <= 0) return k;
  return keys[0];
}

/** Anomalie nella regione del giocatore: né troppo vicine né irraggiungibili, distanziate tra loro. */
function placeAnomalies(rng: Rng, tiles: (Tile | null)[], region: number[], dist: Int32Array, starts: number[]): number[] {
  const A = BALANCE.anomalies;
  const nearStart = (i: number) => starts.some((s) => hexDistance(s, i) <= 3);
  const band = region.filter((i) => dist[i] >= A.distance[0] && dist[i] <= A.distance[1] && !nearStart(i));
  const out: number[] = [];
  for (let k = 0; k < A.count; k++) {
    const apart = band.filter((i) => out.every((a) => hexDistance(a, i) >= A.minApart));
    const pool = apart.length ? apart : band.filter((i) => !out.includes(i));
    if (!pool.length) break;
    const i = pool[Math.floor(rng() * pool.length)];
    const t = tiles[i]!;
    t.type = 'anomalia';
    t.defense = rollDefense(rng, 'anomalia');
    t.loot = 0;
    out.push(i);
  }
  return out;
}

/** Occhio della tempesta: vicino al baricentro della regione, con un po' di caso. */
function pickStormCenter(rng: Rng, region: number[]): number {
  let sx = 0, sy = 0;
  for (const i of region) {
    const c = center(i);
    sx += c.x;
    sy += c.y;
  }
  sx /= region.length;
  sy /= region.length;
  const byDist = [...region].sort((a, b) => {
    const ca = center(a), cb = center(b);
    return Math.hypot(ca.x - sx, ca.y - sy) - Math.hypot(cb.x - sx, cb.y - sy);
  });
  const near = byDist.slice(0, Math.max(1, Math.min(25, byDist.length)));
  return near[Math.floor(rng() * near.length)];
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
function pickStarts(rng: Rng, tiles: (Tile | null)[], land: number[], count: number): number[] {
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

  const { startDistance: [dMin, dMax], minDistanceBetween } = BALANCE.ai;
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
