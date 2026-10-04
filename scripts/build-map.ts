// Genera UNA VOLTA la carta delle province (src/data/worldmap.json): mappa del mondo vera (Natural Earth 1:50M)
// con dentro le province, celle di Voronoi rilassate e ritagliate sulle nazioni. A runtime niente calcoli pesanti.
// Uso: npx vite-node scripts/build-map.ts   (da rifare se cambia la griglia in balance.ts)
import { writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import { presimplify, simplify } from 'topojson-simplify';
import type { Topology, GeometryObject } from 'topojson-specification';
import type { Polygon, MultiPolygon } from 'geojson';
import { Delaunay } from 'd3-delaunay';
import pc from 'polygon-clipping';
import world from 'world-atlas/countries-50m.json';
import namesIt from '../src/data/countries-it.json';
import terrainSrc from './data/ne-terrain.json'; // Natural Earth 1:10M, regioni fisiche: catene, altopiani, deserti (pubblico dominio)
import { BALANCE } from '../src/config/balance';
import { NEIGHBORS, WORLD_W, center, lonLat } from '../src/map/hexGrid';
import { createRng } from '../src/map/rng';

const TARGET = 2900; // province circa
const SCALE = 8; // coordinate salvate in 1/8 di pixel-mondo
const { latMax, latMin, rows, cols, hexSize: S } = BALANCE.map;
const rng = createRng('ashen-atlas-province');

type Pt = [number, number];
type Ring = Pt[];
type Poly = Ring[]; // [esterno, buchi...]

const X = (lon: number) => ((lon + 180) / 360) * WORLD_W;
const Y = (lat: number) => 1.5 * S * (((latMax - lat) / (latMax - latMin)) * rows - 0.5) + S;

const area = (r: Ring) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return a / 2;
};
const polyArea = (p: Poly) => Math.abs(area(p[0])) - p.slice(1).reduce((s, h) => s + Math.abs(area(h)), 0);
function centroid(mp: Poly[]): Pt {
  let cx = 0, cy = 0, A = 0;
  for (const p of mp) for (const [k, r] of p.entries()) {
    const sgn = k === 0 ? 1 : -1;
    let a = 0, x = 0, y = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
      a += f; x += (r[j][0] + r[i][0]) * f; y += (r[j][1] + r[i][1]) * f;
    }
    if (Math.abs(a) < 1e-9) continue;
    const w = Math.abs(a / 2) * sgn;
    cx += (x / (3 * a)) * w; cy += (y / (3 * a)) * w; A += w;
  }
  return A ? [cx / A, cy / A] : mp[0][0][0];
}
function inRing(r: Ring, x: number, y: number) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPoly = (p: Poly, x: number, y: number) => p.reduce((s, r) => (inRing(r, x, y) ? !s : s), false);
const bbox = (rings: Ring[]) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const [x, y] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
};

// 1. nazioni semplificate sulla topologia (i confini condivisi restano identici), proiettate, senza Antartide
const topo0 = world as unknown as Topology<{ countries: GeometryObject<{ name: string }> }>;
const topo = simplify(presimplify(topo0 as never), 0.0015) as typeof topo0;
const fc = feature(topo, topo.objects.countries);
const feats = ('features' in fc ? fc.features : [fc]).filter((f) => f.geometry && f.properties?.name !== 'Antarctica');
const it = namesIt as Record<string, string>;
const names = feats.map((f) => { const en = f.properties?.name ?? '?'; return it[en] ?? en; });
const worldBox: Poly = [[[-180, latMin], [180, latMin], [180, latMax], [-180, latMax], [-180, latMin]]];
const countryParts: Poly[][] = feats.map((f) => {
  const g = f.geometry as Polygon | MultiPolygon;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const out: Poly[] = [];
  for (const poly of polys) {
    // longitudini continue (anelli a cavallo dell'antimeridiano), poi taglio sul riquadro del mondo e copie spostate
    const un = poly.map((r) => {
      const o: Pt[] = [[r[0][0], r[0][1]]];
      for (let k = 1; k < r.length; k++) {
        let d = r[k][0] - r[k - 1][0];
        if (d > 180) d -= 360; else if (d < -180) d += 360;
        o.push([o[k - 1][0] + d, r[k][1]]);
      }
      return o;
    });
    for (const shift of [-360, 0, 360]) {
      const moved = un.map((r) => r.map(([x, y]) => [x + shift, y] as Pt));
      for (const piece of pc.intersection(moved as never, worldBox as never)) {
        out.push(piece.map((r) => r.map(([lon, lat]) => [X(lon), Y(lat)] as Pt)));
      }
    }
  }
  return out.filter((p) => polyArea(p) > 0.05);
});

// 2. semi delle province: numero proporzionale all'area, rilassamento di Lloyd dentro ogni parte di nazione
const total = countryParts.flat().reduce((s, p) => s + polyArea(p), 0);
const A0 = total / TARGET;
interface Prov { country: number; parts: Poly[] }
const provs: Prov[] = [];
const tiny: { c: number; p: Poly }[] = [];
function cells(part: Poly, k: number): Poly[][] {
  const [x0, y0, x1, y1] = bbox(part);
  let seeds: Pt[] = [];
  for (let t = 0; seeds.length < k && t < k * 400; t++) {
    const x = x0 + rng() * (x1 - x0), y = y0 + rng() * (y1 - y0);
    if (inPoly(part, x, y)) seeds.push([x, y]);
  }
  if (!seeds.length) return [[part]];
  let out: Poly[][] = [];
  for (let it = 0; it < 6; it++) {
    const vor = Delaunay.from(seeds).voronoi([x0 - 1, y0 - 1, x1 + 1, y1 + 1]);
    out = seeds.map((_, i) => {
      const cell = vor.cellPolygon(i);
      return cell ? (pc.intersection([cell as Pt[]] as never, part as never) as unknown as Poly[]) : [];
    });
    if (it < 5) seeds = out.map((mp, i) => (mp.length ? centroid(mp) : seeds[i]));
  }
  return out.filter((mp) => mp.length);
}
countryParts.forEach((parts, c) => {
  for (const part of parts) {
    const a = polyArea(part);
    if (a < 0.1 * A0) { tiny.push({ c, p: part }); continue; }
    const k = Math.max(1, Math.round(a / A0));
    for (const mp of cells(part, k)) provs.push({ country: c, parts: mp });
  }
});
// isolette: alla provincia più vicina della stessa nazione (o una provincia tutta loro)
for (const { c, p } of tiny) {
  const [cx, cy] = centroid([p]);
  let best = -1, bd = Infinity;
  provs.forEach((q, k) => {
    if (q.country !== c) return;
    const [qx, qy] = centroid(q.parts);
    const d = Math.hypot(qx - cx, qy - cy);
    if (d < bd) { bd = d; best = k; }
  });
  if (best >= 0 && bd < Math.sqrt(A0) * 2.5) provs[best].parts.push(p);
  else if (polyArea(p) > 0.6) provs.push({ country: c, parts: [p] });
}

// 3. punti agganciati alla griglia e inseriti anche sul lato vicino: i confini condivisi diventano identici
const snap = (v: number) => Math.round(v * SCALE) / SCALE;
const key = (x: number, y: number) => Math.round(x * SCALE) * 1e6 + Math.round(y * SCALE);
const rings: { p: number; r: Pt[] }[] = [];
provs.forEach((pr, p) => pr.parts.forEach((poly) => poly.forEach((r) => {
  const o: Pt[] = [];
  for (const [x, y] of r) {
    const q: Pt = [snap(x), snap(y)];
    if (!o.length || key(...o[o.length - 1]) !== key(...q)) o.push(q);
  }
  if (o.length > 1 && key(...o[0]) === key(...o[o.length - 1])) o.pop();
  if (o.length >= 3) rings.push({ p, r: o });
})));
const grid = new Map<number, Pt[]>();
const G = 2;
const gk = (x: number, y: number) => Math.floor(x / G) * 100000 + Math.floor(y / G);
for (const { r } of rings) for (const v of r) { const k = gk(v[0], v[1]); (grid.get(k) ?? grid.set(k, []).get(k)!).push(v); }
let inserted = 0;
for (const ring of rings) {
  const out: Pt[] = [];
  const r = ring.r;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    out.push(a);
    const extra: { t: number; v: Pt }[] = [];
    const [x0, y0, x1, y1] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    if (L2 === 0) continue;
    for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++) for (let gy = Math.floor(y0 / G); gy <= Math.floor(y1 / G); gy++) {
      for (const v of grid.get(gx * 100000 + gy) ?? []) {
        const t = ((v[0] - a[0]) * dx + (v[1] - a[1]) * dy) / L2;
        if (t <= 1e-6 || t >= 1 - 1e-6) continue;
        const ex = a[0] + t * dx - v[0], ey = a[1] + t * dy - v[1];
        if (ex * ex + ey * ey < 0.02) extra.push({ t, v });
      }
    }
    extra.sort((u, w) => u.t - w.t);
    for (const e of extra) if (key(...out[out.length - 1]) !== key(...e.v)) { out.push(e.v); inserted++; }
  }
  ring.r = out;
}

// 4. lati condivisi → catene tra incroci (come i tratti di confine della carta), poi province come anelli di catene
const pos = new Map<number, Pt>();
const edges = new Map<string, { a: number; b: number; u: number; v: number }>();
for (const { p, r } of rings) for (let i = 0; i < r.length; i++) {
  const u = key(...r[i]), v = key(...r[(i + 1) % r.length]);
  if (u === v) continue;
  pos.set(u, r[i]); pos.set(v, r[(i + 1) % r.length]);
  const id = u < v ? `${u}_${v}` : `${v}_${u}`;
  const e = edges.get(id);
  if (!e) edges.set(id, { a: p, b: -1, u, v });
  else if (e.b === -1 && e.a !== p) e.b = p;
  else if (e.a === p) edges.delete(id); // lato interno alla stessa provincia (parti che si toccano)
}
const E = [...edges.values()];
const at = new Map<number, number[]>();
E.forEach((e, k) => { for (const v of [e.u, e.v]) (at.get(v) ?? at.set(v, []).get(v)!).push(k); });
const pair = (k: number) => { const e = E[k]; return e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`; };
const junction = (v: number) => { const inc = at.get(v)!; return inc.length !== 2 || pair(inc[0]) !== pair(inc[1]); };
const used = new Uint8Array(E.length);
const chains: { keys: number[]; a: number; b: number; closed: boolean }[] = [];
const walk = (start: number, e0: number) => {
  const keys = [start];
  let v = start, e = e0;
  for (;;) {
    used[e] = 1;
    v = E[e].u === v ? E[e].v : E[e].u;
    keys.push(v);
    if (v === start || junction(v)) break;
    const inc = at.get(v)!;
    const next = inc[0] === e ? inc[1] : inc[0];
    if (used[next]) break;
    e = next;
  }
  const closed = keys[keys.length - 1] === start && keys.length > 3;
  if (closed) keys.pop();
  chains.push({ keys, a: E[e0].a, b: E[e0].b, closed });
};
for (const [v, inc] of at) if (junction(v)) for (const e of inc) if (!used[e]) walk(v, e);
for (let e = 0; e < E.length; e++) if (!used[e]) walk(E[e].u, e);

// confini interni (Voronoi, dritti): ondulati con rumore morbido, estremi fermi, uguali per le due province
function hash(i: number, j: number) { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295 - 0.5; }
function noise(x: number, y: number) {
  const c = 7, gx = x / c, gy = y / c, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), d = hash(ix, iy + 1), e = hash(ix + 1, iy + 1);
  return (a + (b - a) * sx + (d - a) * sy + (a - b - d + e) * sx * sy) * 2;
}
const chainPts: Pt[][] = chains.map((c) => {
  const pts = c.keys.map((k) => pos.get(k)!);
  const pa = provs[c.a], pb = c.b >= 0 ? provs[c.b] : null;
  if (!pb || pa.country !== pb.country || c.closed) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(L / 1.6));
    for (let s = 1; s <= n; s++) out.push([ax + ((bx - ax) * s) / n, ay + ((by - ay) * s) / n]);
  }
  const [sx, sy] = out[0], [ex, ey] = out[out.length - 1], L = Math.hypot(ex - sx, ey - sy) || 1;
  const nx = -(ey - sy) / L, ny = (ex - sx) / L;
  return out.map(([x, y], i) => {
    if (i === 0 || i === out.length - 1) return [x, y] as Pt;
    const w = Math.min(1, i / 3, (out.length - 1 - i) / 3); // estremi fermi, ondulazione che cresce piano
    const d = noise(x, y) * 2.4 * w;
    return [x + nx * d, y + ny * d] as Pt;
  });
});

// anelli di ogni provincia come sequenze di catene (con verso), esterni e buchi
const byProv = provs.map(() => [] as number[]);
chains.forEach((c, k) => { byProv[c.a].push(k); if (c.b >= 0) byProv[c.b].push(k); });
const provRings: number[][][] = byProv.map((list) => {
  const left = new Set(list);
  const out: number[][] = [];
  while (left.size) {
    const first = left.values().next().value as number;
    left.delete(first);
    const ring = [first];
    if (!chains[first].closed) {
      const start = chains[first].keys[0];
      let end = chains[first].keys[chains[first].keys.length - 1], guard = 0;
      while (end !== start && guard++ < 5000) {
        let found = -1;
        for (const k of left) {
          const c = chains[k];
          if (c.closed) continue;
          if (c.keys[0] === end) { found = k; end = c.keys[c.keys.length - 1]; break; }
          if (c.keys[c.keys.length - 1] === end) { found = ~k; end = c.keys[0]; break; }
        }
        if (found === -1) break;
        left.delete(found < 0 ? ~found : found);
        ring.push(found);
      }
    }
    out.push(ring);
  }
  return out;
});
const ringPts = (ring: number[]): Pt[] => {
  const o: Pt[] = [];
  for (const r of ring) {
    const pts = r < 0 ? [...chainPts[~r]].reverse() : chainPts[r];
    for (let i = o.length ? 1 : 0; i < pts.length; i++) o.push(pts[i]);
  }
  return o;
};

// 5. caselle → provincia (centro dentro la sagoma); ogni provincia almeno una casella
const tileProv = new Int16Array(cols * rows).fill(-1);
const shapes = provRings.map((rs) => rs.map(ringPts));
const boxes = shapes.map((rs) => bbox(rs));
for (let i = 0; i < tileProv.length; i++) {
  const { x, y } = center(i);
  for (let p = 0; p < shapes.length; p++) {
    const b = boxes[p];
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
    if (shapes[p].reduce((s, r) => (inRing(r, x, y) ? !s : s), false)) { tileProv[i] = p; break; }
  }
}
const count = new Int32Array(provs.length);
for (const p of tileProv) if (p >= 0) count[p]++;
let forced = 0;
provs.forEach((pr, p) => {
  if (count[p]) return;
  const [cx, cy] = centroid(pr.parts);
  let best = -1, bd = Infinity;
  for (let i = 0; i < tileProv.length; i++) {
    const q = tileProv[i];
    if (q >= 0 && count[q] < 3) continue;
    const { x, y } = center(i), d = Math.hypot(x - cx, y - cy) * (q >= 0 ? 1.5 : 1);
    if (d < bd) { bd = d; best = i; }
  }
  if (best < 0) return;
  if (tileProv[best] >= 0) count[tileProv[best]]--;
  tileProv[best] = p; count[p]++; forced++;
});

// 5b. terreno vero: 0 pianura, 1 colline, 2 montagne, 3 deserto (regioni fisiche di Natural Earth) + colline ai piedi dei monti
const T_CODE: Record<string, number> = { colline: 1, montagne: 2, deserto: 3 };
const tpolys = (terrainSrc as { t: string; p: number[][][][] }[]).map((f) => ({ code: T_CODE[f.t], rings: f.p.flat() as Ring[], box: bbox(f.p.flat() as Ring[]) }));
const terrain = new Int8Array(cols * rows).fill(-1);
for (let i = 0; i < terrain.length; i++) {
  if (tileProv[i] < 0) continue;
  const [lon, lat] = lonLat(i);
  let code = 0;
  for (const tp of tpolys) {
    if (lon < tp.box[0] || lon > tp.box[2] || lat < tp.box[1] || lat > tp.box[3]) continue;
    // anelli di più poligoni insieme: pari/dispari per ogni poligono basta (buchi rari)
    if (tp.rings.reduce((s2, r) => (inRing(r, lon, lat) ? !s2 : s2), false)) {
      if (tp.code === 2) { code = 2; break; } // le montagne vincono su altopiani e deserti
      code = Math.max(code, tp.code === 3 && code === 1 ? 1 : tp.code);
    }
  }
  terrain[i] = code;
}
for (let pass = 0; pass < 1; pass++) { // una fascia di colline ai piedi delle montagne
  const ring: number[] = [];
  for (let i = 0; i < terrain.length; i++) {
    if (terrain[i] !== 0 && terrain[i] !== 3) continue;
    if (NEIGHBORS[i].some((n) => n >= 0 && terrain[n] === 2 - pass)) ring.push(i);
  }
  for (const i of ring) terrain[i] = 1;
}
const tc = [0, 0, 0, 0];
for (const t of terrain) if (t >= 0) tc[t]++;

// 6. salvataggio compatto: catene a delta interi, anelli come indici di catene, caselle in RLE
const enc = (pts: Pt[]) => {
  const o: number[] = [];
  let px = 0, py = 0;
  for (const [x, y] of pts) { const ix = Math.round(x * SCALE), iy = Math.round(y * SCALE); o.push(ix - px, iy - py); px = ix; py = iy; }
  return o;
};
const runs = (a: Int16Array | Int8Array) => {
  const o: number[] = [];
  for (let i = 0; i < a.length;) { let n = 1; while (i + n < a.length && a[i + n] === a[i]) n++; o.push(a[i], n); i += n; }
  return o;
};
const rle = runs(tileProv);
const out = {
  v: 1, scale: SCALE, cols, rows, names,
  provinces: provs.map((p, k) => ({ c: p.country, r: provRings[k] })),
  chains: chains.map((c, k) => ({ a: c.a, b: c.b, z: c.closed ? 1 : 0, d: enc(chainPts[k]) })),
  tiles: rle,
  terrain: runs(terrain),
};
writeFileSync('src/data/worldmap.json', JSON.stringify(out));
const land = [...tileProv].filter((p) => p >= 0).length;
console.log(`terreno: pianura ${tc[0]}, colline ${tc[1]}, montagne ${tc[2]}, deserto ${tc[3]}`);
console.log(`province ${provs.length}, catene ${chains.length} (coste ${chains.filter((c) => c.b < 0).length}), punti inseriti ${inserted}, caselle di terra ${land}, forzate ${forced}, senza caselle ${[...count].filter((n) => !n).length}`);
