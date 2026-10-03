// Nazioni reali (Natural Earth 110m): a quale paese appartiene ogni casella di terra. Calcolato una volta all'avvio.
import { feature } from 'topojson-client';
import type { Topology, GeometryObject } from 'topojson-specification';
import type { Polygon, MultiPolygon } from 'geojson';
import countries110 from 'world-atlas/countries-110m.json';
import namesIt from '../data/countries-it.json';
import { NEIGHBORS, lonLat } from './hexGrid';
import { contains, polygonsOf } from './landMask';

export interface CountryMap {
  /** casella → indice nazione (−1 = mare) */
  country: Int16Array;
  names: string[]; // nome italiano (o inglese se manca la traduzione)
}

export function buildCountryMap(landMask: Uint8Array): CountryMap {
  const topo = countries110 as unknown as Topology<{ countries: GeometryObject<{ name: string }> }>;
  const fc = feature(topo, topo.objects.countries);
  const feats = 'features' in fc ? fc.features : [fc];
  const polys = feats.map((f) => (f.geometry ? polygonsOf([f.geometry as Polygon | MultiPolygon]) : []));
  const it = namesIt as Record<string, string>;
  const names = feats.map((f) => {
    const en = (f.properties as { name?: string } | null)?.name ?? '?';
    return it[en] ?? en;
  });

  const country = new Int16Array(landMask.length).fill(-1);
  for (let i = 0; i < landMask.length; i++) {
    if (!landMask[i]) continue;
    const [lon, lat] = lonLat(i);
    for (let k = 0; k < polys.length; k++) {
      if (polys[k].length && contains(polys[k], lon, lat)) {
        country[i] = k;
        break;
      }
    }
  }
  // caselle di terra fuori da ogni confine (coste e approssimazioni): prendono il paese del vicino
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < landMask.length; i++) {
      if (!landMask[i] || country[i] >= 0) continue;
      const n = NEIGHBORS[i].find((j) => j >= 0 && country[j] >= 0);
      if (n !== undefined) country[i] = country[n];
    }
  }
  return { country, names };
}
