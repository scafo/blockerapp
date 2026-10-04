// Carta delle province già pronta (generata da scripts/build-map.ts): confini veri, province, caselle → provincia.
// Arriva come binario compatto in base64 (src/data/worldmap.ts) e si decodifica una volta in array tipizzati.
import { WORLD_DATA, WORLD_META } from '../data/worldmap';
import { BALANCE } from '../config/balance';

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

let cache: WorldAsset | null = null;

export function loadWorld(): WorldAsset {
  if (cache) return cache;
  const { cols, rows } = BALANCE.map;
  const M = WORLD_META;
  if (M.cols !== cols || M.rows !== rows) throw new Error('la carta non corrisponde alla griglia: npm run build:map');
  const bin = atob(WORLD_DATA);
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
  cache = { names: M.names, provCountry, provRings, chains, tileProv, tileTerrain };
  return cache;
}
