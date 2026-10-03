// Verifica che la maschera terra veloce coincida con d3 geoContains.
// Uso: npx vite-node scripts/check-land-mask.ts  (rilancia se cambi griglia in balance.ts)
import { geoContains } from 'd3-geo';
import { feature } from 'topojson-client';
import land110 from 'world-atlas/land-110m.json';
import { buildLandMask } from '../src/map/landMask';
import { lonLat } from '../src/map/hexGrid';

const topo = land110 as any;
const land = feature(topo, topo.objects.land);
let t = performance.now();
const fast = buildLandMask();
const fastMs = performance.now() - t;
t = performance.now();
let diff = 0;
for (let i = 0; i < fast.length; i++) if (+geoContains(land, lonLat(i)) !== fast[i]) diff++;
console.log(`maschera veloce ${fastMs.toFixed(0)} ms, geoContains ${(performance.now() - t).toFixed(0)} ms, differenze: ${diff}`);
// qualche casella costiera può differire (lati dritti vs archi di cerchio massimo)
process.exit(diff > fast.length * 0.002 ? 1 : 0);
