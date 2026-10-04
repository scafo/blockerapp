// Carta delle province già pronta (generata da scripts/build-map.ts): confini veri, province, caselle → provincia.
import data from '../data/worldmap.json';
import { BALANCE } from '../config/balance';

export interface WorldChain {
  pts: number[]; // [x0,y0,x1,y1,...] in pixel-mondo
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
  const d = data as unknown as {
    scale: number; cols: number; rows: number; names: string[];
    provinces: { c: number; r: number[][] }[]; chains: { a: number; b: number; z: number; d: number[] }[]; tiles: number[]; terrain: number[];
  };
  const { cols, rows } = BALANCE.map;
  if (d.cols !== cols || d.rows !== rows) throw new Error('worldmap.json non corrisponde alla griglia: npx vite-node scripts/build-map.ts');
  const chains = d.chains.map((c) => {
    const pts = new Array<number>(c.d.length);
    let x = 0, y = 0;
    for (let k = 0; k < c.d.length; k += 2) {
      x += c.d[k];
      y += c.d[k + 1];
      pts[k] = x / d.scale;
      pts[k + 1] = y / d.scale;
    }
    return { pts, a: c.a, b: c.b, closed: c.z === 1 };
  });
  const tileProv = new Int16Array(cols * rows);
  for (let k = 0, i = 0; k < d.tiles.length; k += 2) tileProv.fill(d.tiles[k], i, (i += d.tiles[k + 1]));
  const tileTerrain = new Int8Array(cols * rows);
  for (let k = 0, i = 0; k < d.terrain.length; k += 2) tileTerrain.fill(d.terrain[k], i, (i += d.terrain[k + 1]));
  cache = {
    names: d.names,
    provCountry: Int16Array.from(d.provinces.map((p) => p.c)),
    provRings: d.provinces.map((p) => p.r),
    chains,
    tileProv,
    tileTerrain,
  };
  return cache;
}
