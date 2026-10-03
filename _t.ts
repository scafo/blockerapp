import { BALANCE } from './src/config/balance';
import { buildLandMask } from './src/map/landMask';
import { buildCountryMap } from './src/map/countries';
import { generateMap } from './src/map/generate';
let t = performance.now();
const m = buildLandMask(); const t1 = performance.now() - t; t = performance.now();
const c = buildCountryMap(m); const t2 = performance.now() - t; t = performance.now();
const r = generateMap('demo', m, 3, c); const t3 = performance.now() - t;
console.log(BALANCE.map.cols, 'land', r.land.length, 'prov', r.provinces.length, 'nazioni', r.nations.length, 'region', r.regionSize, 'ms mask/country/gen', Math.round(t1), Math.round(t2), Math.round(t3));
