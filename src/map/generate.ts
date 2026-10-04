// Genera la mappa di una run a partire dal seed: rovine, partenze (terreno e province vengono dalla carta pronta).
import { BALANCE, type Resource, type Terrain, type TileType } from '../config/balance';
import { createRng, randInt, type Rng } from './rng';
import { neighbors, center } from './hexGrid';
import type { WorldAsset } from './worldAsset';

export interface Tile {
  i: number;
  type: TileType;
  terrain: Terrain;
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
  /** terreno prevalente (dà la risorsa prodotta) */
  terrain: Terrain;
}

export const TERRAINS: Terrain[] = ['pianura', 'colline', 'montagne', 'deserto'];

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
  provinces: Province[];
  nations: Nation[];
}

const M = BALANCE.map;

/**
 * Mappa alla Call of War: ogni casella di terra appartiene a una provincia (unità di conquista) dentro la sua nazione reale.
 * La griglia esagonale resta sotto, invisibile: serve per le forme, le pedine e le navi.
 */
export function generateMap(seed: string, world: WorldAsset, aiCount: number = BALANCE.ai.count): RunMap {
  const rng = createRng(seed);
  const tp = world.tileProv;
  const tiles: (Tile | null)[] = new Array(tp.length).fill(null);
  const land: number[] = [];

  for (let i = 0; i < tp.length; i++) {
    if (tp[i] < 0) continue;
    tiles[i] = {
      i, type: 'terra', terrain: TERRAINS[Math.max(0, world.tileTerrain[i])], defense: 0, loot: 0, lootType: 'metallo',
      country: world.provCountry[tp[i]], province: tp[i], city: false, capital: false,
    };
    land.push(i);
  }

  const { provinces, nations } = buildProvinces(tiles, land, world);

  // Rovine sparse (insediamenti).
  for (let k = 0; k < M.ruinsCount; k++) {
    const t = tiles[land[Math.floor(rng() * land.length)]]!;
    if (!t.city) t.type = 'rovine';
  }

  for (const i of land) {
    const t = tiles[i]!;
    t.defense = Math.max(1, Math.round(rollDefense(rng, t.type) * BALANCE.terrain[t.terrain].defense)); // colline e montagne si difendono meglio
    if (t.type === 'rovine') {
      t.lootType = pickWeighted(rng, BALANCE.loot.weights);
      t.loot = randInt(rng, BALANCE.loot[t.lootType][0], BALANCE.loot[t.lootType][1]);
    }
  }

  const starts = pickStarts(rng, tiles, land, aiCount, provinces);
  const dist = bfs(tiles, starts[0]);
  const region = land.filter((i) => dist[i] >= 0);
  // città e capitali più difese
  const P = BALANCE.provinces;
  for (const p of provinces) {
    if (p.city < 0) continue;
    const t = tiles[p.city]!;
    t.defense = Math.round(t.defense * P.cityDefenseMult) + P.cityDefenseBonus + (t.capital ? P.capitalDefenseBonus : 0);
  }
  return { seed, tiles, land, starts, regionSize: region.length, provinces, nations };
}

/**
 * Province fisse della carta (scripts/build-map.ts): città nella casella più centrale di ogni provincia, capitale = la città
 * più vicina al cuore della nazione, confini tra province dalle caselle vicine.
 */
function buildProvinces(tiles: (Tile | null)[], land: number[], world: WorldAsset) {
  const P = BALANCE.provinces;
  const provinces: Province[] = world.provRings.map((_, p) => ({ country: world.provCountry[p], city: -1, tiles: [], neighbors: [], anchor: -1, terrain: 'pianura' }));
  for (const i of land) provinces[tiles[i]!.province].tiles.push(i);
  for (const p of provinces) {
    // terreno prevalente della provincia
    const n: Record<Terrain, number> = { pianura: 0, colline: 0, montagne: 0, deserto: 0 };
    for (const i of p.tiles) n[tiles[i]!.terrain]++;
    p.terrain = TERRAINS.reduce((a, b) => (n[b] > n[a] ? b : a), 'pianura');
  }
  const nearest = (list: number[], m: { x: number; y: number }) => list.reduce((a, b) => {
    const pa = center(a), pb = center(b);
    return Math.hypot(pb.x - m.x, pb.y - m.y) < Math.hypot(pa.x - m.x, pa.y - m.y) ? b : a;
  });
  for (const p of provinces) {
    if (!p.tiles.length) continue;
    p.anchor = nearest(p.tiles, centroid(p.tiles));
    if (p.tiles.length >= P.minTilesForCity) {
      p.city = p.anchor;
      tiles[p.city]!.city = true;
    }
  }
  // nazioni: nome sul cuore della parte principale, capitale = la città più vicina
  const nations: Nation[] = [];
  const byCountry = new Map<number, number[]>();
  for (const i of land) {
    const c = tiles[i]!.country;
    (byCountry.get(c) ?? byCountry.set(c, []).get(c)!).push(i);
  }
  for (const [c, all] of byCountry) {
    const seen = new Set<number>();
    let main: number[] = [];
    for (const i of all) {
      if (seen.has(i)) continue;
      const list = [i];
      seen.add(i);
      for (let h = 0; h < list.length; h++) {
        for (const n of neighbors(list[h])) if (n >= 0 && tiles[n]?.country === c && !seen.has(n)) { seen.add(n); list.push(n); }
      }
      if (list.length > main.length) main = list;
    }
    const label = nearest(main, centroid(main));
    const cities = provinces.filter((p) => p.country === c && p.city >= 0).map((p) => p.city);
    const capital = cities.length ? nearest(cities, center(label)) : -1;
    if (capital >= 0) tiles[capital]!.capital = true;
    nations.push({ id: c, name: world.names[c], capital, size: all.length, label });
  }
  const nb = provinces.map(() => new Set<number>());
  for (const i of land) {
    const p = tiles[i]!.province;
    for (const n of neighbors(i)) {
      const q = n >= 0 ? tiles[n]?.province ?? -1 : -1;
      if (q >= 0 && q !== p) nb[p].add(q);
    }
  }
  provinces.forEach((p, k) => (p.neighbors = [...nb[k]]));
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

function rollDefense(rng: Rng, type: TileType): number {
  const base = BALANCE.defense[type];
  const v = BALANCE.defense.variance;
  return Math.max(1, Math.round(base * (1 - v + rng() * 2 * v)));
}

const passable = (t: Tile | null): t is Tile => !!t;

/** Distanze in passi esagonali da `from` sulle caselle attraversabili (−1 = irraggiungibile). */
function bfs(tiles: (Tile | null)[], from: number): Int32Array {
  const dist = new Int32Array(tiles.length).fill(-1);
  dist[from] = 0;
  const queue = [from];
  for (let h = 0; h < queue.length; h++) {
    const c = queue[h];
    for (const n of neighbors(c)) {
      if (n >= 0 && dist[n] < 0 && passable(tiles[n])) {
        dist[n] = dist[c] + 1;
        queue.push(n);
      }
    }
  }
  return dist;
}

const goodStart = (tiles: (Tile | null)[], i: number) =>
  tiles[i]!.type === 'terra' && neighbors(i).every((n) => passable(tiles[n] ?? null));

/**
 * Partenza del giocatore casuale in una regione grande (niente isolette);
 * le IA partono nella stessa regione, a distanza giusta per incontrarsi presto.
 */
function pickStarts(rng: Rng, tiles: (Tile | null)[], land: number[], count: number, provinces: Province[]): number[] {
  const pick = <T>(a: T[]) => a[Math.floor(rng() * a.length)];
  // provincia di partenza abbastanza grande e con più vie d'uscita
  const roomy = (i: number) => {
    const p = provinces[tiles[i]!.province];
    return !p || (p.tiles.length >= 8 && p.neighbors.length >= 3);
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
