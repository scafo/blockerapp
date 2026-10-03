// Calcola una volta quali caselle cadono su terra (Natural Earth 110m).
// Point-in-polygon planare con bbox: stesso risultato di d3 geoContains sulla nostra
// griglia ma ~35× più veloce (5 s → 150 ms su mobile conta).
import { feature } from 'topojson-client';
import type { Topology, GeometryObject } from 'topojson-specification';
import type { Polygon, MultiPolygon, Position } from 'geojson';
import land110 from 'world-atlas/land-110m.json';
import { BALANCE } from '../config/balance';
import { lonLat } from './hexGrid';

export interface Poly {
  rings: Position[][];
  bb: [number, number, number, number];
}

/** Rende continue le longitudini degli anelli che attraversano l'antimeridiano. */
function unwrap(ring: Position[]): Position[] {
  const out: Position[] = [ring[0]];
  for (let k = 1; k < ring.length; k++) {
    const prev = out[k - 1][0];
    let d = ring[k][0] - ring[k - 1][0];
    if (d > 180) d -= 360;
    else if (d < -180) d += 360;
    out.push([prev + d, ring[k][1]]);
  }
  return out;
}

function inRing(r: Position[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function loadPolygons(): Poly[] {
  const topo = land110 as unknown as Topology<{ land: GeometryObject }>;
  const fc = feature(topo, topo.objects.land);
  return polygonsOf(('features' in fc ? fc.features : [fc]).map((f) => f.geometry as Polygon | MultiPolygon));
}

/** Poligoni (con antimeridiano sistemato e bbox) da geometrie GeoJSON. */
export function polygonsOf(geoms: (Polygon | MultiPolygon)[]): Poly[] {
  return geoms
    .flatMap((g) => (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]))
    .map((rings) => {
      const u = rings.map(unwrap);
      const xs = u[0].map((p) => p[0]), ys = u[0].map((p) => p[1]);
      return { rings: u, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
    });
}

export function contains(polys: Poly[], lon: number, lat: number): boolean {
  for (const p of polys) {
    if (lat < p.bb[1] || lat > p.bb[3]) continue;
    for (const x of [lon, lon - 360, lon + 360]) {
      if (x < p.bb[0] || x > p.bb[2]) continue;
      if (inRing(p.rings[0], x, lat) && !p.rings.slice(1).some((h) => inRing(h, x, lat))) return true;
    }
  }
  return false;
}

export function buildLandMask(): Uint8Array {
  const polys = loadPolygons();
  const n = BALANCE.map.cols * BALANCE.map.rows;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = contains(polys, ...lonLat(i)) ? 1 : 0;
  return mask;
}
