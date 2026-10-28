// Fondali veri del mare (Natural Earth 1:10M, batimetria, pubblico dominio) → griglia di profondità per la carta.
// Classe per cella: 0 piattaforma (< 200 m), 1 scarpata (200–3000 m), 2 oceano profondo (> 3000 m).
// Uso: npx vite-node scripts/build-bathy.ts (i file .shp scaricati sono in scripts/data/bathy/).
import { readFileSync, writeFileSync } from 'node:fs';
import { latToV } from '../src/map/projection';

export const BW = 1440, BH = 640; // celle della griglia (sulla carta in Mercatore, come il resto)

/** Lettore minimo di shapefile: solo poligoni (tipo 5), anelli in [lon, lat]. */
function readShp(path: string): number[][][] {
  const b = readFileSync(path), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const rings: number[][][] = [];
  let o = 100;
  while (o + 8 <= b.length) {
    const len = dv.getInt32(o + 4, false) * 2;
    const r = o + 8, type = dv.getInt32(r, true);
    if (type === 5) {
      const nParts = dv.getInt32(r + 36, true), nPts = dv.getInt32(r + 40, true);
      const parts: number[] = [];
      for (let i = 0; i < nParts; i++) parts.push(dv.getInt32(r + 44 + i * 4, true));
      const p0 = r + 44 + nParts * 4;
      for (let i = 0; i < nParts; i++) {
        const a = parts[i], z = i + 1 < nParts ? parts[i + 1] : nPts, ring: number[] = [];
        for (let k = a; k < z; k++) ring.push(dv.getFloat64(p0 + k * 16, true), dv.getFloat64(p0 + k * 16 + 8, true));
        rings.push(ring);
      }
    }
    o = r + len;
  }
  return rings;
}

const cls = new Uint8Array(BW * BH); // 0 = piattaforma
const layers: [string, number][] = [['K_200', 1], ['H_3000', 2]];
for (const [name, c] of layers) {
  const rings = readShp(`scripts/data/bathy/${name}/ne_10m_bathymetry_${name}.shp`);
  // lati in coordinate della griglia
  const ex: number[] = [];
  for (const ring of rings) for (let j = 0; j + 3 < ring.length + 2; j += 2) {
    const k = (j + 2) % ring.length;
    if (j >= ring.length) break;
    const x1 = ((ring[j] + 180) / 360) * BW, y1 = latToV(Math.max(-85, Math.min(85, ring[j + 1]))) * BH;
    const x2 = ((ring[k] + 180) / 360) * BW, y2 = latToV(Math.max(-85, Math.min(85, ring[k + 1]))) * BH;
    if (y1 !== y2) ex.push(x1, y1, x2, y2);
  }
  // pari-dispari riga per riga (i buchi sono anelli anche loro)
  const rows: number[][] = Array.from({ length: BH }, () => []);
  for (let e = 0; e < ex.length; e += 4) {
    const [x1, y1, x2, y2] = [ex[e], ex[e + 1], ex[e + 2], ex[e + 3]];
    const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
    for (let Y = Math.max(0, Math.ceil(lo - 0.5)); Y <= Math.min(BH - 1, Math.ceil(hi - 0.5) - 1); Y++) {
      const yc = Y + 0.5;
      rows[Y].push(x1 + ((yc - y1) * (x2 - x1)) / (y2 - y1));
    }
  }
  for (let Y = 0; Y < BH; Y++) {
    const xs = rows[Y].sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let X = Math.max(0, Math.ceil(xs[i] - 0.5)); X <= Math.min(BW - 1, Math.ceil(xs[i + 1] - 0.5) - 1); X++) cls[Y * BW + X] = Math.max(cls[Y * BW + X], c);
    }
  }
  console.log(name, rings.length, 'anelli');
}
// a corse (valore, lunghezza) in base64: piccolo
const runs: number[] = [];
for (let i = 0; i < cls.length;) {
  let n = 1;
  while (i + n < cls.length && cls[i + n] === cls[i] && n < 255) n++;
  runs.push(cls[i], n);
  i += n;
}
const b64 = Buffer.from(Uint8Array.from(runs)).toString('base64');
writeFileSync('src/data/bathy.ts', `// Generato da scripts/build-bathy.ts (Natural Earth 1:10M, batimetria): non modificare a mano.\n// Classe per cella ${BW}×${BH} (Mercatore): 0 piattaforma < 200 m, 1 scarpata 200–3000 m, 2 oceano > 3000 m. Corse [valore, lunghezza].\nexport const BATHY = { w: ${BW}, h: ${BH}, runs: '${b64}' };\n`);
const cnt = [0, 0, 0];
for (const v of cls) cnt[v]++;
console.log('celle', cnt, 'kB', Math.round(b64.length / 1024));
