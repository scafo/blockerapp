// Forme delle province alla Call of War: i bordi tra regioni (province, mare, laghi) seguono i lati degli esagoni
// e vengono smussati (Chaikin). Ogni tratto di confine è condiviso dalle due regioni: niente fessure tra province.
import { BALANCE } from '../config/balance';
import { NEIGHBORS, center } from './hexGrid';
import type { RunMap } from './generate';

const S = BALANCE.map.hexSize;
const LAPLACE = 3; // passate di levigatura (tolgono il dente di sega degli esagoni)
const NOISE = { amp: 0.42 * S, cell: 3.2 * S }; // ondulazione naturale dei confini

/** Tratto di confine tra due regioni (≥0 provincia, −1 oceano, ≤−2 lago), punti piatti [x0,y0,x1,y1,...]. */
export interface Chain {
  pts: number[];
  a: number;
  b: number;
  closed: boolean;
}

export interface RegionShape {
  id: number; // provincia (≥0) o lago (≤−2)
  outer: number[]; // anello esterno (punti piatti)
  holes: number[][];
  area: number; // area dell'anello esterno
  x0: number; y0: number; x1: number; y1: number; // riquadro
}

export interface MapShapes {
  chains: Chain[];
  /** province (indice = id provincia) */
  provinces: RegionShape[];
  /** laghi: si disegnano col colore del mare dopo la terra */
  lakes: RegionShape[];
  /** catene che toccano ogni provincia */
  chainsOf: number[][];
}

const vkey = (x: number, y: number) => Math.round(x * 16) * 1e6 + Math.round(y * 16);

/** Rumore a valori morbido e deterministico: sposta i vertici in modo coerente (stesso punto → stesso spostamento). */
function hash(ix: number, iy: number, k: number) {
  let h = (ix * 374761393 + iy * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295 - 0.5;
}
function noise(x: number, y: number, k: number) {
  const gx = x / NOISE.cell, gy = y / NOISE.cell;
  const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, k), b = hash(ix + 1, iy, k), c = hash(ix, iy + 1, k), d = hash(ix + 1, iy + 1, k);
  return (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * 2;
}

/** Levigatura [¼ ½ ¼]: gli estremi delle catene aperte restano fermi (sono condivisi con le altre). */
function laplace(p: number[], closed: boolean): number[] {
  const n = p.length / 2;
  if (n < 3) return p;
  const out = [...p];
  for (let k = closed ? 0 : 1; k < (closed ? n : n - 1); k++) {
    const a = (k - 1 + n) % n, b = (k + 1) % n;
    out[2 * k] = 0.25 * p[2 * a] + 0.5 * p[2 * k] + 0.25 * p[2 * b];
    out[2 * k + 1] = 0.25 * p[2 * a + 1] + 0.5 * p[2 * k + 1] + 0.25 * p[2 * b + 1];
  }
  return out;
}

function corner(i: number, k: number): [number, number] {
  const { x, y } = center(i);
  const a = (Math.PI / 180) * (30 + 60 * k);
  return [x + S * Math.cos(a), y + S * Math.sin(a)];
}

/** Regione di ogni casella: provincia, oppure componente di mare (−1 oceano aperto, ≤−2 laghi chiusi). */
function regionsOf(map: RunMap): Int32Array {
  const n = map.tiles.length;
  const reg = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (map.tiles[i]) reg[i] = map.tiles[i]!.province;
  const seen = new Uint8Array(n);
  let lake = -2;
  for (let i = 0; i < n; i++) {
    if (map.tiles[i] || seen[i]) continue;
    const comp = [i];
    seen[i] = 1;
    let border = false;
    for (let h = 0; h < comp.length; h++) {
      for (const m of NEIGHBORS[comp[h]]) {
        if (m < 0) { border = true; continue; }
        if (!map.tiles[m] && !seen[m]) {
          seen[m] = 1;
          comp.push(m);
        }
      }
    }
    // tocca il bordo della mappa o è grande: oceano; altrimenti lago
    const id = border || comp.length > 400 ? -1 : lake--;
    for (const c of comp) reg[c] = id;
  }
  return reg;
}

function chaikin(p: number[], closed: boolean): number[] {
  const n = p.length / 2;
  if (n < 3 && !closed) return p;
  const out: number[] = [];
  if (!closed) out.push(p[0], p[1]);
  const segs = closed ? n : n - 1;
  for (let k = 0; k < segs; k++) {
    const ax = p[2 * k], ay = p[2 * k + 1];
    const j = (k + 1) % n;
    const bx = p[2 * j], by = p[2 * j + 1];
    if (closed || k > 0) out.push(0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by);
    if (closed || k < segs - 1) out.push(0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by);
  }
  if (!closed) out.push(p[2 * n - 2], p[2 * n - 1]);
  return out;
}

const ringArea = (p: number[]) => {
  let a = 0;
  for (let k = 0, n = p.length / 2; k < n; k++) {
    const j = (k + 1) % n;
    a += p[2 * k] * p[2 * j + 1] - p[2 * j] * p[2 * k + 1];
  }
  return a / 2;
};

export function buildShapes(map: RunMap): MapShapes {
  const reg = regionsOf(map);
  // 1. lati di confine tra regioni diverse
  const ea: number[] = [], eb: number[] = []; // vertici (chiave)
  const el: number[] = [], er: number[] = []; // regioni ai due lati
  const pos = new Map<number, [number, number]>();
  const key = (i: number, k: number) => {
    const [x, y] = corner(i, k);
    const kk = vkey(x, y);
    if (!pos.has(kk)) pos.set(kk, [x + noise(x, y, 1) * NOISE.amp, y + noise(x, y, 2) * NOISE.amp]);
    return kk;
  };
  for (let i = 0; i < map.tiles.length; i++) {
    const ri = reg[i];
    NEIGHBORS[i].forEach((n, k) => {
      const rn = n >= 0 ? reg[n] : -1;
      if (rn === ri) return;
      if (n >= 0 && i > n) return; // ogni lato una volta sola
      if (n < 0 && ri === -1) return; // oceano contro il bordo della mappa
      ea.push(key(i, k));
      eb.push(key(i, (k + 1) % 6));
      el.push(ri);
      er.push(rn);
    });
  }
  const at = new Map<number, number[]>();
  for (let e = 0; e < ea.length; e++) {
    for (const v of [ea[e], eb[e]]) (at.get(v) ?? at.set(v, []).get(v)!).push(e);
  }
  // 2. catene tra due incroci (vertici dove si incontrano 3 regioni)
  const used = new Uint8Array(ea.length);
  const chainsRaw: { keys: number[]; a: number; b: number; closed: boolean }[] = [];
  const walk = (start: number, e0: number) => {
    const keys = [start];
    let v = start, e = e0;
    for (;;) {
      used[e] = 1;
      v = ea[e] === v ? eb[e] : ea[e];
      keys.push(v);
      const inc = at.get(v)!;
      if (inc.length !== 2 || v === start) break;
      const next = inc[0] === e ? inc[1] : inc[0];
      if (used[next]) break;
      e = next;
    }
    const closed = keys[keys.length - 1] === start && keys.length > 2;
    if (closed) keys.pop();
    chainsRaw.push({ keys, a: el[e0], b: er[e0], closed });
  };
  for (const [v, inc] of at) {
    if (inc.length === 2) continue;
    for (const e of inc) if (!used[e]) walk(v, e);
  }
  for (let e = 0; e < ea.length; e++) if (!used[e]) walk(ea[e], e); // anelli senza incroci (isole, enclavi)

  const chains: Chain[] = chainsRaw.map((c) => {
    let pts: number[] = [];
    for (const k of c.keys) pts.push(...pos.get(k)!);
    for (let s = 0; s < LAPLACE; s++) pts = laplace(pts, c.closed);
    pts = chaikin(pts, c.closed);
    return { pts, a: c.a, b: c.b, closed: c.closed };
  });

  // 3. anelli di ogni regione (province e laghi) unendo le sue catene per gli estremi
  const byRegion = new Map<number, number[]>();
  chainsRaw.forEach((c, k) => {
    for (const r of [c.a, c.b]) if (r !== -1) (byRegion.get(r) ?? byRegion.set(r, []).get(r)!).push(k);
  });
  const shapeOf = (id: number, list: number[]): RegionShape => {
    const rings: number[][] = [];
    const left = new Set(list);
    while (left.size) {
      const first = left.values().next().value as number;
      left.delete(first);
      const c0 = chainsRaw[first];
      const ring = [...chains[first].pts];
      if (!c0.closed) {
        const startKey = c0.keys[0];
        let endKey = c0.keys[c0.keys.length - 1];
        let guard = 0;
        while (endKey !== startKey && guard++ < 10000) {
          let found = -1, rev = false;
          for (const k of left) {
            const c = chainsRaw[k];
            if (c.closed) continue;
            if (c.keys[0] === endKey) { found = k; rev = false; break; }
            if (c.keys[c.keys.length - 1] === endKey) { found = k; rev = true; break; }
          }
          if (found < 0) break;
          left.delete(found);
          const p = chains[found].pts;
          if (!rev) {
            for (let j = 2; j < p.length; j += 2) ring.push(p[j], p[j + 1]);
            endKey = chainsRaw[found].keys[chainsRaw[found].keys.length - 1];
          } else {
            for (let j = p.length - 4; j >= 0; j -= 2) ring.push(p[j], p[j + 1]);
            endKey = chainsRaw[found].keys[0];
          }
        }
        ring.length -= 2; // l'ultimo punto coincide col primo
      }
      rings.push(ring);
    }
    rings.sort((r1, r2) => Math.abs(ringArea(r2)) - Math.abs(ringArea(r1)));
    const outer = rings[0] ?? [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let j = 0; j < outer.length; j += 2) {
      x0 = Math.min(x0, outer[j]); x1 = Math.max(x1, outer[j]);
      y0 = Math.min(y0, outer[j + 1]); y1 = Math.max(y1, outer[j + 1]);
    }
    return { id, outer, holes: rings.slice(1), area: Math.abs(ringArea(outer)), x0, y0, x1, y1 };
  };
  const provinces = map.provinces.map((_, p) => shapeOf(p, byRegion.get(p) ?? []));
  const lakes: RegionShape[] = [];
  for (const [id, list] of byRegion) if (id <= -2) lakes.push(shapeOf(id, list));
  const chainsOf = map.provinces.map((_, p) => byRegion.get(p) ?? []);
  return { chains, provinces, lakes, chainsOf };
}
