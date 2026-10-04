// Forme delle province dalla carta pronta (src/data/worldmap.ts, generata da scripts/build-map.ts):
// coste e confini veri (Natural Earth 1:50M), province come anelli di tratti di confine condivisi tra vicine.
import type { WorldAsset, WorldChain } from './worldAsset';

/** Tratto di confine tra due province (b = −1: mare), punti piatti [x0,y0,x1,y1,...]. */
export type Chain = WorldChain;

export interface ShapePart {
  outer: Float32Array; // anello esterno (punti piatti)
  holes: Float32Array[];
}

export interface RegionShape {
  id: number;
  parts: ShapePart[]; // isole e pezzi staccati
  area: number; // area della parte più grande
  x0: number; y0: number; x1: number; y1: number; // riquadro
}

export interface MapShapes {
  chains: Chain[];
  provinces: RegionShape[];
  /** catene che toccano ogni provincia */
  chainsOf: number[][];
}

const ringArea = (p: ArrayLike<number>) => {
  let a = 0;
  for (let k = 0, n = p.length / 2; k < n; k++) {
    const j = (k + 1) % n;
    a += p[2 * k] * p[2 * j + 1] - p[2 * j] * p[2 * k + 1];
  }
  return Math.abs(a / 2);
};

function inRing(r: ArrayLike<number>, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

let cache: { world: WorldAsset; shapes: MapShapes } | null = null;

export function buildShapes(world: WorldAsset): MapShapes {
  if (cache?.world === world) return cache.shapes;
  const { chains } = world;
  const ringPts = (ring: number[]) => {
    const out: number[] = [];
    for (const r of ring) {
      const p = chains[r < 0 ? ~r : r].pts;
      const n = p.length / 2;
      for (let k = out.length ? 1 : 0; k < n; k++) {
        const j = r < 0 ? n - 1 - k : k;
        out.push(p[2 * j], p[2 * j + 1]);
      }
    }
    if (out.length > 4 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.length -= 2;
    return Float32Array.from(out);
  };
  const provinces = world.provRings.map((rings, id): RegionShape => {
    const rs = rings.map(ringPts).filter((r) => r.length >= 6).map((r) => ({ r, a: ringArea(r) })).sort((u, v) => v.a - u.a);
    // un anello dentro un anello più grande della stessa provincia è un buco
    const parts: ShapePart[] = [];
    for (const { r } of rs) {
      const host = parts.find((p) => inRing(p.outer, r[0], r[1]));
      if (host) host.holes.push(r);
      else parts.push({ outer: r, holes: [] });
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of parts) for (let j = 0; j < p.outer.length; j += 2) {
      x0 = Math.min(x0, p.outer[j]); x1 = Math.max(x1, p.outer[j]);
      y0 = Math.min(y0, p.outer[j + 1]); y1 = Math.max(y1, p.outer[j + 1]);
    }
    return { id, parts, area: rs[0]?.a ?? 0, x0, y0, x1, y1 };
  });
  const chainsOf = provinces.map(() => [] as number[]);
  chains.forEach((c, k) => {
    chainsOf[c.a]?.push(k);
    if (c.b >= 0) chainsOf[c.b]?.push(k);
  });
  const shapes = { chains, provinces, chainsOf };
  cache = { world, shapes };
  return shapes;
}

/** La provincia (tra i candidati) che contiene davvero il punto, −1 se nessuna. */
export function provinceAtPoint(shapes: MapShapes, candidates: number[], x: number, y: number): number {
  for (const p of candidates) {
    const s = shapes.provinces[p];
    if (!s || x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1) continue;
    for (const part of s.parts) {
      if (inRing(part.outer, x, y) && !part.holes.some((h) => inRing(h, x, y))) return p;
    }
  }
  return -1;
}
