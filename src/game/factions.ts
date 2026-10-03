// Nomi e colori delle fazioni. Indice 0 = giocatore.
import { PALETTE } from '../config/palette';

export const FACTION_INFO = [
  { name: 'TU', short: 'TU' },
  { name: 'Corvi della Ruggine', short: 'CORVI' },
  { name: 'Chiesa del Neon', short: 'NEON' },
  { name: 'Lega del Sale', short: 'SALE' },
].map((f, k) => ({ ...f, ...PALETTE.factions[k] }));
