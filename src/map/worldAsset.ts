// Carta delle province già pronta (generata da scripts/build-map.ts): confini veri, province, caselle → provincia.
// Arriva come binario compatto in base64 (src/data/worldmap.ts) e si decodifica una volta in array tipizzati.
import { WORLD_DATA, WORLD_META } from '../data/worldmap';
import { BATHY } from '../data/bathy';
import { BALANCE } from '../config/balance';
import namesIt from '../data/countries-it.json';
import { region, type MapId } from './region';

/** Dati cotti di una carta: province e caselle, più i fondali del mare (scripts/build-map.ts, scripts/build-bathy.ts). */
interface Pack { meta: { scale: number; cols: number; rows: number; names: string[] }; data: string; bathy: { w: number; h: number; runs: string } }
const packs: Partial<Record<MapId, Pack>> = { world: { meta: WORLD_META, data: WORLD_DATA, bathy: BATHY } };
// carte della sandbox caricate solo quando servono (qualche MB ognuna)
const loaders: Partial<Record<MapId, () => Promise<{ WORLD_META: Pack['meta']; WORLD_DATA: string; BATHY: Pack['bathy'] }>>> = {
  europa: () => import('../data/worldmap-europa'),
  america: () => import('../data/worldmap-america'),
};

/** Carica i dati della carta (prima di setRegion e loadWorld). */
export async function preloadWorld(id: MapId): Promise<void> {
  if (packs[id]) return;
  const m = await loaders[id]!();
  packs[id] = { meta: m.WORLD_META, data: m.WORLD_DATA, bathy: m.BATHY };
}

/** Fondali della carta in uso (classi per cella, decodificate una volta). */
const bathyCache = new Map<MapId, Uint8Array>();
export function bathyOf(id: MapId = region().id): { w: number; h: number; cls: Uint8Array } {
  const B = packs[id]!.bathy;
  let out = bathyCache.get(id);
  if (!out) {
    const bin = atob(B.runs);
    out = new Uint8Array(B.w * B.h);
    let o = 0;
    for (let i = 0; i + 1 < bin.length; i += 2) { const v = bin.charCodeAt(i), n = bin.charCodeAt(i + 1); out.fill(v, o, o + n); o += n; }
    bathyCache.set(id, out);
  }
  return { w: B.w, h: B.h, cls: out };
}

// la carta è stata cotta coi nomi italiani delle nazioni: il gioco è in inglese, si torna al nome inglese di Natural Earth
const EN = Object.fromEntries(Object.entries(namesIt as Record<string, string>).map(([en, it]) => [it, en]));

export interface WorldChain {
  pts: Float32Array; // [x0,y0,x1,y1,...] in pixel-mondo
  a: number; // provincia da un lato
  b: number; // provincia dall'altro (−1 = mare)
  closed: boolean;
}

export interface WorldAsset {
  names: string[]; // nomi delle nazioni
  provCountry: Int16Array; // provincia → nazione
  provRings: number[][][]; // provincia → anelli → catene (~k = catena k al contrario)
  chains: WorldChain[];
  tileProv: Int16Array; // casella → provincia (−1 = mare)
  tileTerrain: Int8Array; // casella → terreno (0 pianura, 1 colline, 2 montagne, 3 deserto; −1 mare)
}

const caches = new Map<MapId, WorldAsset>();

/** Carta in uso (o quella indicata, già caricata con preloadWorld). */
export function loadWorld(id: MapId = region().id): WorldAsset {
  const hit = caches.get(id);
  if (hit) return hit;
  const pack = packs[id];
  if (!pack) throw new Error(`carta ${id} non caricata: preloadWorld`);
  const M = pack.meta, { cols, rows } = M;
  if (id === region().id && (cols !== BALANCE.map.cols || rows !== BALANCE.map.rows)) throw new Error('la carta non corrisponde alla griglia: npm run build:map');
  const bin = atob(pack.data);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  let p = 0;
  const u = () => {
    let n = 0, m = 1, b: number;
    do { b = buf[p++]; n += (b & 127) * m; m *= 128; } while (b & 128);
    return n;
  };
  const s = () => { const n = u(); return n % 2 ? -(n + 1) / 2 : n / 2; };
  const nProv = u();
  const provCountry = new Int16Array(nProv);
  const provRings: number[][][] = [];
  for (let k = 0; k < nProv; k++) {
    provCountry[k] = s();
    const rings: number[][] = [];
    for (let r = u(); r > 0; r--) {
      const ring: number[] = [];
      for (let n = u(); n > 0; n--) ring.push(s());
      rings.push(ring);
    }
    provRings.push(rings);
  }
  const chains: WorldChain[] = [];
  for (let k = u(); k > 0; k--) {
    const a = u(), b = s(), closed = u() === 1, n = u();
    const pts = new Float32Array(n * 2);
    let x = 0, y = 0;
    for (let j = 0; j < n; j++) {
      x += s();
      y += s();
      pts[2 * j] = x / M.scale;
      pts[2 * j + 1] = y / M.scale;
    }
    chains.push({ pts, a, b, closed });
  }
  const runs = <T extends Int16Array | Int8Array>(out: T) => {
    for (let k = u(), i = 0; k > 0; k--) {
      const v = s();
      out.fill(v, i, (i += u()));
    }
    return out;
  };
  const tileProv = runs(new Int16Array(cols * rows));
  const tileTerrain = runs(new Int8Array(cols * rows));
  const out = { names: M.names.map((n: string) => EN[n] ?? n), provCountry, provRings, chains, tileProv, tileTerrain };
  caches.set(id, out);
  return out;
}
