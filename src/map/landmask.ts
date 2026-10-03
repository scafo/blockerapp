// Maschera terra/mare precalcolata con d3-geo geoContains (scripts/gen-landmask.ts): niente attese all'avvio.
import data from '../data/landmask.json';
import { BALANCE } from '../config/balance';
import { N } from './grid';

export function loadLandMask(): Uint8Array {
  const g = BALANCE.grid;
  if (data.cols !== g.cols || data.rows !== g.rows || data.latMax !== g.latMax || data.latMin !== g.latMin) {
    throw new Error('landmask.json non corrisponde alla griglia in balance.ts: lancia "npm run gen:land"');
  }
  const bin = atob(data.data);
  const mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) mask[i] = (bin.charCodeAt(i >> 3) >> (i & 7)) & 1;
  return mask;
}
