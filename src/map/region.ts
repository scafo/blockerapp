// Carte della sandbox (Nico, 26 novembre 2026: "mappe più specifiche nel sandbox, tipo Europa o i continenti, che puoi giocare
// solo quelli"): ogni carta è un riquadro di longitudini e latitudini con la sua griglia. La griglia ha più o meno le stesse
// caselle del mondo intero (~590.000), così pedine, nebbia e prestazioni restano uguali, ma su una zona più piccola: le
// province sono molto più fitte. La carta si sceglie prima della partita (setRegion) e vale finché non se ne sceglie un'altra.
import { BALANCE } from '../config/balance';
import { setGrid } from './hexGrid';
import { setProjection } from './projection';

export type MapId = 'world' | 'europa' | 'america';

export interface RegionDef {
  id: MapId;
  name: string;
  lonMin: number; lonMax: number; latMin: number; latMax: number;
  cols: number; rows: number; // proporzioni del riquadro in Mercatore (larghezza / altezza come la griglia)
  provinces: number; // province circa (scripts/build-map.ts)
  countries?: string[]; // nazioni della carta (nomi di Natural Earth); le altre restano mare
}

const W = BALANCE.map;

export const REGIONS: Record<MapId, RegionDef> = {
  world: { id: 'world', name: 'World', lonMin: -180, lonMax: 180, latMin: W.latMin, latMax: W.latMax, cols: W.cols, rows: W.rows, provinces: 17_700 },
  // Europa fino agli Urali, col Caucaso e la Turchia; il Nord Africa resta mare
  europa: {
    id: 'europa', name: 'Europe', lonMin: -25, lonMax: 60, latMin: 33, latMax: 71.5, cols: 792, rows: 742, provinces: 9000,
    countries: ['Albania', 'Andorra', 'Armenia', 'Austria', 'Azerbaijan', 'Belarus', 'Belgium', 'Bosnia and Herz.', 'Bulgaria', 'Croatia',
      'Cyprus', 'N. Cyprus', 'Czechia', 'Denmark', 'Estonia', 'Faeroe Is.', 'Finland', 'France', 'Georgia', 'Germany', 'Greece', 'Guernsey',
      'Hungary', 'Iceland', 'Ireland', 'Isle of Man', 'Italy', 'Jersey', 'Kosovo', 'Latvia', 'Liechtenstein', 'Lithuania', 'Luxembourg',
      'Macedonia', 'Malta', 'Moldova', 'Monaco', 'Montenegro', 'Netherlands', 'Norway', 'Poland', 'Portugal', 'Romania', 'Russia',
      'San Marino', 'Serbia', 'Slovakia', 'Slovenia', 'Spain', 'Sweden', 'Switzerland', 'Turkey', 'Ukraine', 'United Kingdom', 'Vatican', 'Åland'],
  },
  // America del Nord e centrale, Caraibi compresi (le due Americhe insieme sono troppo alte per una carta larga)
  america: {
    id: 'america', name: 'North America', lonMin: -170, lonMax: -50, latMin: 7, latMax: 72, cols: 787, rows: 746, provinces: 9000,
    countries: ['United States of America', 'Canada', 'Mexico', 'Guatemala', 'Belize', 'Honduras', 'El Salvador', 'Nicaragua', 'Costa Rica',
      'Panama', 'Cuba', 'Jamaica', 'Haiti', 'Dominican Rep.', 'Puerto Rico', 'Bahamas', 'Bermuda', 'Cayman Is.', 'Turks and Caicos Is.',
      'Trinidad and Tobago', 'Barbados', 'Grenada', 'St. Vin. and Gren.', 'Saint Lucia', 'Dominica', 'Antigua and Barb.', 'St. Kitts and Nevis',
      'Montserrat', 'Anguilla', 'British Virgin Is.', 'U.S. Virgin Is.', 'St-Martin', 'Sint Maarten', 'St-Barthélemy', 'Aruba', 'Curaçao',
      'St. Pierre and Miquelon'],
  },
};

let cur: RegionDef = REGIONS.world;

/** Carta in uso. */
export const region = (): RegionDef => cur;

/** Sceglie la carta: griglia, proiezione e confini del riquadro (BALANCE.map) cambiano insieme. */
export function setRegion(id: MapId) {
  const r = REGIONS[id] ?? REGIONS.world;
  cur = r;
  Object.assign(BALANCE.map, { cols: r.cols, rows: r.rows, latMin: r.latMin, latMax: r.latMax, lonMin: r.lonMin, lonMax: r.lonMax });
  setProjection(r.latMin, r.latMax);
  setGrid(r.cols, r.rows);
}
