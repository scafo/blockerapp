// Genera src/data/landmask.json: per ogni casella della griglia, terra o mare con d3-geo geoContains (Natural Earth 110m).
// Lento (~30 s) ma si fa una volta: rilancialo se cambi grid.cols/rows/latMax/latMin in balance.ts.
// Uso: npm run gen:land
import { writeFileSync } from 'node:fs';
import { geoContains } from 'd3-geo';
import { feature } from 'topojson-client';
import land110 from 'world-atlas/land-110m.json';
import { BALANCE } from '../src/config/balance';
import { lonLat } from '../src/map/grid';

const { cols, rows, latMax, latMin } = BALANCE.grid;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const topo = land110 as any;
const land = feature(topo, topo.objects.land);
const bits = new Uint8Array(Math.ceil((cols * rows) / 8));
let count = 0;
const t0 = performance.now();
for (let i = 0; i < cols * rows; i++) {
  if (geoContains(land, lonLat(i))) {
    bits[i >> 3] |= 1 << (i & 7);
    count++;
  }
}
writeFileSync('src/data/landmask.json', JSON.stringify({ cols, rows, latMax, latMin, data: Buffer.from(bits).toString('base64') }) + '\n');
console.log(`landmask: ${count} caselle di terra su ${cols * rows} in ${Math.round(performance.now() - t0)} ms`);
