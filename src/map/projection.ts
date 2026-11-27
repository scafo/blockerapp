// Proiezione della carta: Mercatore (come la carta da terminale di riferimento: il nord si allunga). Tutto ciò che passa
// da latitudine a riga della griglia (generazione della carta, caselle, disegno) usa queste due funzioni.
// Le latitudini del riquadro cambiano con la carta scelta (src/map/region.ts → setProjection).
import { BALANCE } from '../config/balance';

const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
let M0 = merc(BALANCE.map.latMax), M1 = merc(BALANCE.map.latMin);

/** Nuovo riquadro di latitudini (carta della sandbox). */
export function setProjection(latMin: number, latMax: number) {
  M0 = merc(latMax);
  M1 = merc(latMin);
}

/** Latitudine → frazione verticale della carta (0 = bordo nord, 1 = bordo sud). */
export const latToV = (lat: number) => (M0 - merc(lat)) / (M0 - M1);

/** Frazione verticale (0 nord, 1 sud) → latitudine. */
export function vToLat(v: number): number {
  const m = M0 - v * (M0 - M1);
  return ((2 * Math.atan(Math.exp(m)) - Math.PI / 2) * 180) / Math.PI;
}

/** Longitudine → frazione orizzontale della carta (0 = bordo ovest, 1 = bordo est). */
export const lonToU = (lon: number) => (lon - BALANCE.map.lonMin) / (BALANCE.map.lonMax - BALANCE.map.lonMin);

/** Frazione orizzontale → longitudine. */
export const uToLon = (u: number) => BALANCE.map.lonMin + u * (BALANCE.map.lonMax - BALANCE.map.lonMin);
