// Proiezione della carta: Mercatore (come la carta da terminale di riferimento: il nord si allunga). Tutto ciò che passa
// da latitudine a riga della griglia (generazione della carta, caselle, disegno) usa queste due funzioni.
import { BALANCE } from '../config/balance';

const { latMax, latMin } = BALANCE.map;
const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const M0 = merc(latMax), M1 = merc(latMin);

/** Latitudine → frazione verticale della carta (0 = bordo nord, 1 = bordo sud). */
export const latToV = (lat: number) => (M0 - merc(lat)) / (M0 - M1);

/** Frazione verticale (0 nord, 1 sud) → latitudine. */
export function vToLat(v: number): number {
  const m = M0 - v * (M0 - M1);
  return ((2 * Math.atan(Math.exp(m)) - Math.PI / 2) * 180) / Math.PI;
}
