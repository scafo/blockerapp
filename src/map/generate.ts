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
  country: number; // nazione reale (−1 se nessuna)
  city: number; // casella della città (−1 se la provincia non ne ha)
  tiles: number[];
  /** province confinanti via terra */
  neighbors: number[];
  /** casella di riferimento: la città, o la casella più interna */
  anchor: number;
  /** corrotta dalla Caduta: non si attraversa né si conquista */
  toxic: boolean;
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

/**
 * Mappa alla Call of War: ogni casella di terra appartiene a una provincia (unità di conquista) dentro la sua nazione reale.
 * La griglia esagonale resta sotto, invisibile: serve per le forme, le pedine e le navi.
 */
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
      i, type: desert ? 'deserto' : 'terra', defense: 0, loot: 0, lootType: 'metallo',
      country: countries ? countries.country[i] : -1, province: -1, city: false, capital: false,
    };
    land.push(i);
  }

  const { provinces, nations } = buildProvinces(rng, tiles, land, countries);

  // Zone corrotte: province intere che la Caduta ha reso inabitabili.
  const candidates = provinces.filter((p) => p.tiles.length >= 6);
  for (let k = 0; k < M.toxicProvinces && candidates.length; k++) {
    const p = candidates.splice(Math.floor(rng() * candidates.length), 1)[0];
    p.toxic = true;
    for (const i of p.tiles) Object.assign(tiles[i]!, { type: 'tossica', city: false, capital: false });
    p.city = -1;
  }

  // Rovine sparse (insediamenti).
  for (let k = 0; k < M.ruinsCount; k++) {
    const t = tiles[land[Math.floor(rng() * land.length)]]!;
    if (t.type !== 'tossica' && !t.city) t.type = 'rovine';
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

  const starts = pickStarts(rng, tiles, land, aiCount, provinces);
  const dist = bfs(tiles, starts[0]);
  const region = land.filter((i) => dist[i] >= 0);
  const anomalies = placeAnomalies(rng, tiles, region, dist, starts);
  // città e capitali più difese
  const P = BALANCE.provinces;
  for (const p of provinces) {
    if (p.city < 0) continue;
    const t = tiles[p.city]!;
    t.defense = Math.round(t.defense * P.cityDefenseMult) + P.cityDefenseBonus + (t.capital ? P.capitalDefenseBonus : 0);
  }
  return { seed, tiles, land, starts, regionSize: region.length, anomalies, stormCenter: pickStormCenter(rng, region), provinces, nations };
}

/**
 * Province alla Call of War: ogni nazione è divisa in province di circa `size` caselle attorno a città scelte lontane
 * tra loro (cambiano con il seed). La città più vicina al cuore della nazione è la capitale.
 * Tutta la terra è coperta: isolette e staterelli diventano una provincia sola senza città.
 */
function buildProvinces(rng: Rng, tiles: (Tile | null)[], land: number[], cm: CountryMap | null) {
  const P = BALANCE.provinces;
  const provinces: Province[] = [];
  const nations: Nation[] = [];
  const byCountry = new Map<number, number[]>();
  for (const i of land) {
    const c = tiles[i]!.country;
    (byCountry.get(c) ?? byCountry.set(c, []).get(c)!).push(i);
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
      const withCity = c >= 0 && part.length >= P.minTilesForCity;
      // città lontane tra loro (campionamento del punto più lontano)
      const k = withCity ? Math.max(1, Math.round(part.length / P.size)) : 1;
      const seeds = [part[Math.floor(rng() * part.length)]];
      const near = part.map((i) => hexDistance(seeds[0], i)); // distanza dalla città più vicina
      while (seeds.length < k) {
        let best = -1, bestD = -1;
        part.forEach((_, j) => {
          const d = near[j] + rng() * 0.5;
          if (d > bestD) {
            bestD = d;
            best = j;
          }
        });
        if (bestD < 2) break;
        seeds.push(part[best]);
        part.forEach((i, j) => (near[j] = Math.min(near[j], hexDistance(part[best], i))));
      }
      // ogni casella va alla città più vicina (BFS dentro la nazione)
      const first = provinces.length;
      const queue: number[] = [];
      seeds.forEach((s, j) => {
        provinces.push({ country: c, city: withCity ? s : -1, tiles: [], neighbors: [], anchor: s, toxic: false });
        tiles[s]!.province = first + j;
        if (withCity) tiles[s]!.city = true;
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
      if (part === main && withCity) {
        // capitale: la città più vicina al baricentro della parte principale
        const m = centroid(part);
        for (const s of seeds) {
          const p = center(s), d = Math.hypot(p.x - m.x, p.y - m.y);
          if (d < bestCap) {
            bestCap = d;
            capital = s;
          }
        }
      }
    }
    if (c < 0 || !cm) continue;
    // dove scrivere il nome: la casella della parte principale più vicina al suo baricentro
    const m = centroid(main);
    const label = main.reduce((a, b) => {
      const pa = center(a), pb = center(b);
      return Math.hypot(pb.x - m.x, pb.y - m.y) < Math.hypot(pa.x - m.x, pa.y - m.y) ? b : a;
    });
    if (capital >= 0) tiles[capital]!.capital = true;
    nations.push({ id: c, name: cm.names[c], capital, size: all.length, label });
  }
  // confini tra province e casella di riferimento (senza città: la più interna)
  const nb = provinces.map(() => new Set<number>());
  for (const i of land) {
    const p = tiles[i]!.province;
    for (const n of NEIGHBORS[i]) {
      const q = n >= 0 ? tiles[n]?.province ?? -1 : -1;
      if (q >= 0 && q !== p) nb[p].add(q);
    }
  }
  provinces.forEach((p, k) => {
    p.neighbors = [...nb[k]];
    if (p.city < 0) {
      const m = centroid(p.tiles);
      p.anchor = p.tiles.reduce((a, b) => {
        const pa = center(a), pb = center(b);
        return Math.hypot(pb.x - m.x, pb.y - m.y) < Math.hypot(pa.x - m.x, pa.y - m.y) ? b : a;
      });
    }
  });
  return { provinces, nations };
}

function centroid(list: number[]): { x: number; y: number } {
  let x = 0, y = 0;
  for (const i of list) {
    const p = center(i);
    x += p.x;
    y += p.y;
  }
  return { x: x / list.length, y: y / list.length };
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
  // una per provincia, mai nella provincia di partenza di qualcuno né sulla città
  const used = new Set(starts.map((s) => tiles[s]!.province));
  const band = region.filter((i) => dist[i] >= A.distance[0] && dist[i] <= A.distance[1] && !tiles[i]!.city);
  const out: number[] = [];
  for (let k = 0; k < A.count; k++) {
    const free = band.filter((i) => !used.has(tiles[i]!.province));
    const apart = free.filter((i) => out.every((a) => hexDistance(a, i) >= A.minApart));
    const pool = apart.length ? apart : free;
    if (!pool.length) break;
    const i = pool[Math.floor(rng() * pool.length)];
    const t = tiles[i]!;
    t.type = 'anomalia';
    t.defense = rollDefense(rng, 'anomalia');
    t.loot = 0;
    used.add(t.province);
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
function pickStarts(rng: Rng, tiles: (Tile | null)[], land: number[], count: number, provinces: Province[]): number[] {
  const pick = <T>(a: T[]) => a[Math.floor(rng() * a.length)];
  // provincia di partenza abbastanza grande e con più vie d'uscita
  const roomy = (i: number) => {
    const p = provinces[tiles[i]!.province];
    return !p || (p.tiles.length >= 12 && p.neighbors.filter((q) => !provinces[q].toxic).length >= 3);
  };
  const all = land.filter((i) => goodStart(tiles, i));
  const ok = all.filter(roomy).length > 50 ? all.filter(roomy) : all;
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
  const reachable = ok.filter((i) => dist[i] > 6);
  const starts = [player];
  const aiDist: Int32Array[] = [];
  const prov = (i: number) => tiles[i]!.province;
  for (let k = 0; k < count; k++) {
    const apart = (i: number) => aiDist.every((d) => d[i] >= minDistanceBetween);
    const band = reachable.filter((i) => dist[i] >= dMin && dist[i] <= dMax && !starts.some((s) => prov(s) === prov(i)));
    const tries = [band.filter(apart), band, reachable.filter((i) => !starts.includes(i))];
    const pool = tries.find((t) => t.length);
    if (!pool) break;
    starts.push(pick(pool));
    aiDist.push(bfs(tiles, starts[starts.length - 1]));
  }
  return starts;
}
