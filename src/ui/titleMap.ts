// Sfondo della schermata d'entrata (Nico, 23 novembre 2026: "la mappa con la nebbia e le nuvole in movimento", poi "più
// centrata sull'Europa, con lo stile della nostra mappa, che tremoli di meno"): la carta nello stile della campagna (terra nera,
// mare a puntini pervinca, confini a puntini chiari, Mercatore) senza nomi, con il rilievo a puntini della carta di gioco
// (Nico: "togli i nomi, metti le montagne, quelle nostre"), poco più grande dello schermo perché segua il mouse, e due strati di nuvole ripetibili che scorrono sopra (TitleScene).
// I dati delle nazioni si caricano a parte, non nel pacchetto principale.
import Phaser from 'phaser';
import { feature } from 'topojson-client';
import type { Topology, GeometryObject } from 'topojson-specification';
import type { FeatureCollection, Position } from 'geojson';
import { PALETTE } from '../config/palette';
import { latToV } from '../map/projection';
import { BALANCE } from '../config/balance';
import { pixelToIndex, WORLD_W } from '../map/hexGrid';
import { ELEV } from '../render/WorldMap';

const LAND = '#0e1219'; // terra
import { loadWorld } from '../map/worldAsset';
import { setRegion } from '../map/region';

const css = (c: number, a = 1) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

/** Inquadratura: quanti gradi di longitudine stanno nello schermo e dove cade il centro dell'Europa. */
const VIEW = { lonSpan: 104, lon: 16, lat: 49, atX: 0.6, atY: 0.5 };

/** Anello con longitudini continue (chi attraversa l'antimeridiano non taglia la carta con una riga). */
function unwrap(ring: Position[]): Position[] {
  const out: Position[] = [ring[0]];
  for (let k = 1; k < ring.length; k++) {
    let d = ring[k][0] - ring[k - 1][0];
    if (d > 180) d -= 360;
    else if (d < -180) d += 360;
    out.push([out[k - 1][0] + d, ring[k][1]]);
  }
  return out;
}

/** Carta in un canvas di `w`×`h` pixel veri (`px` = pixel per punto dello schermo); `pad` pixel di bordo in più per lato
 *  (la carta segue il mouse e non deve scoprire i lati). */
async function drawMap(w: number, h: number, px: number, pad: number): Promise<HTMLCanvasElement> {
  setRegion('world'); // la home usa sempre la carta del mondo (dopo una partita della sandbox su un'altra carta)
  const topo = (await import('world-atlas/countries-50m.json')).default as unknown as Topology<{ countries: GeometryObject }>;
  // proiezione: Mercatore della campagna, ingrandito sull'Europa (l'inquadratura vale per lo schermo, senza il bordo)
  const iw = w - 2 * pad, ih = h - 2 * pad;
  const full = (iw * 360) / VIEW.lonSpan, fullH = full * 0.6375; // stesse proporzioni della griglia della campagna
  const ox = pad + VIEW.atX * iw - ((VIEW.lon + 180) / 360) * full, oy = pad + VIEW.atY * ih - latToV(VIEW.lat) * fullH;
  const P = (lon: number, lat: number): [number, number] =>
    [ox + ((lon + 180) / 360) * full, oy + latToV(Math.max(-80, Math.min(84, lat))) * fullH];
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#131c2c'; // mare un filo più chiaro e blu della terra: le coste si leggono
  g.fillRect(0, 0, w, h);
  // mare a puntini pervinca, come la carta da terminale
  const step = Math.round(5 * px), dot = Math.max(1, Math.round(1.1 * px));
  g.fillStyle = css(PALETTE.mappa.fondo, 0.7);
  for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) g.fillRect(Math.round(x), Math.round(y), dot, dot);
  const shapes: Position[][] = [];
  for (const f of (feature(topo, topo.objects.countries) as FeatureCollection).features) {
    const geo = f.geometry;
    if (!geo) continue;
    const polys = geo.type === 'Polygon' ? [geo.coordinates] : geo.type === 'MultiPolygon' ? geo.coordinates : [];
    for (const p of polys) for (const r of p) shapes.push(unwrap(r));
  }
  const ring = (r: Position[]) => r.forEach(([lon, lat], k) => {
    const [x, y] = P(lon, lat);
    if (k) g.lineTo(x, y);
    else g.moveTo(x, y);
  });
  const path = (r: Position[]) => { g.beginPath(); ring(r); g.closePath(); };
  // terra: quasi nera, come la carta che piace a Nico
  g.fillStyle = LAND;
  for (const r of shapes) { path(r); g.fill(); }
  // rilievo del terreno vero della campagna a puntini, sulla stessa griglia e della stessa misura dei puntini del mare (Nico:
  // "come il mare, più leggeri"; l'ombreggiatura di prima faceva strisce bianche): pianura quasi spenta, montagne più chiare
  const pix = g.getImageData(0, 0, w, h).data, terrain = loadWorld().tileTerrain;
  const nx = Math.ceil(w / step), ny = Math.ceil(h / step), n = nx * ny;
  const land = new Uint8Array(n), val = new Float32Array(n);
  const S = BALANCE.map.hexSize;
  const [lr, lg, lb] = [0x0e, 0x12, 0x19];
  for (let j = 0, k = 0; j < ny; j++) for (let i = 0; i < nx; i++, k++) {
    const x = Math.min(w - 1, Math.round(i * step + step / 2)), y = Math.min(h - 1, Math.round(j * step + step / 2)), o = (y * w + x) * 4;
    if (Math.abs(pix[o] - lr) + Math.abs(pix[o + 1] - lg) + Math.abs(pix[o + 2] - lb) > 6) continue;
    land[k] = 1;
    const u = (x - ox) / full, v = (y - oy) / fullH;
    val[k] = ELEV[Math.max(0, Math.min(3, terrain[pixelToIndex(u * WORLD_W, 1.5 * S * (v * BALANCE.map.rows - 0.5) + S)] ?? 0))];
  }
  const R = 2; // media su 5×5 puntini: catene compatte, niente puntini isolati
  for (let j = 0, k = 0; j < ny; j++) for (let i = 0; i < nx; i++, k++) {
    if (!land[k]) continue;
    let sum = 0, c = 0;
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny || !land[jj * nx + ii]) continue;
      sum += val[jj * nx + ii];
      c++;
    }
    const e = Math.min(1, sum / c / 2.4); // 0 pianura … 1 montagna
    // grigio neutro e tenue (Nico: "montagne troppo forti, non si riconosce il mare"): il pervinca resta solo al mare,
    // la terra si legge per contrasto; pianura spenta, montagne appena più chiare, stessa misura dei puntini del mare
    g.fillStyle = css(0xb9c0c2, 0.03 + e * e * 0.38);
    g.fillRect(Math.round(i * step + (step - dot) / 2), Math.round(j * step + (step - dot) / 2), dot, dot);
  }
  // confini e coste a puntini chiari
  g.strokeStyle = css(PALETTE.mappa.confine, 0.55);
  g.lineWidth = Math.max(1, px);
  g.setLineDash([Math.max(1, px), 2.4 * px]);
  for (const r of shapes) { path(r); g.stroke(); }
  g.setLineDash([]);
  project = (lon: number, lat: number) => { const [x, y] = P(lon, lat); return [(x - pad) / px, (y - pad) / px]; };
  return cv;
}

/** Nuvole: rumore frattale ripetibile (i bordi combaciano), bianco con trasparenza. */
function drawClouds(size: number, seed: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(size, size);
  const rnd = Phaser.Math.RND;
  rnd.sow([String(seed)]);
  const octaves = [4, 8, 16, 32].map((n) => ({ n, v: Array.from({ length: n * n }, () => rnd.frac()) }));
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 0.5, tot = 0;
      for (const o of octaves) {
        const fx = (x / size) * o.n, fy = (y / size) * o.n, x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = smooth(fx - x0), ty = smooth(fy - y0), at = (i: number, j: number) => o.v[((j % o.n) * o.n) + (i % o.n)];
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx, b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
        v += (a + (b - a) * ty) * amp;
        tot += amp;
        amp *= 0.5;
      }
      const d = Phaser.Math.Clamp(((v / tot) - 0.45) * 2.4, 0, 1); // solo i banchi più densi, il resto trasparente
      const k = (y * size + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(d * d * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

/** Texture delle nuvole (anche per la mappa di gioco: Nico, "le nuvole come nella home"). */
export function cloudTextures(scene: Phaser.Scene) {
  const T = scene.textures;
  if (!T.exists('title-clouds-a')) T.addCanvas('title-clouds-a', drawClouds(256, 7));
  if (!T.exists('title-clouds-b')) T.addCanvas('title-clouds-b', drawClouds(256, 21));
}

/** Dalla longitudine/latitudine ai punti dello schermo (senza il bordo), valida dopo `titleTextures`. */
export let project: (lon: number, lat: number) => [number, number] = () => [0, 0];

/** Bordo della carta oltre lo schermo, per lato (frazione della larghezza): quanto può spostarsi seguendo il mouse. */
export const MAP_PAD = 0.025;

/** Texture delle nuvole (una volta) e della carta alla misura dello schermo più il bordo (`W`×`H` punti, `px` pixel per punto). */
export async function titleTextures(scene: Phaser.Scene, W: number, H: number, px: number) {
  const T = scene.textures;
  cloudTextures(scene);
  const pad = Math.round(W * MAP_PAD * px), w = Math.round(W * px) + 2 * pad, h = Math.round(H * px) + 2 * pad;
  const old = T.exists('title-map') ? (T.get('title-map').getSourceImage() as HTMLCanvasElement) : null;
  if (old && old.width === w && old.height === h) return;
  const cv = await drawMap(w, h, px, pad);
  if (T.exists('title-map')) T.remove('title-map');
  T.addCanvas('title-map', cv);
}
