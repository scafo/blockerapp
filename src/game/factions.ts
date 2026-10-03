// Nomi e colori delle fazioni. Indice 0 = giocatore.
import { PALETTE } from '../config/palette';

import type { SymbolKind } from '../ui/symbols';

// Ogni fazione ha colore + simbolo (leggibile anche per i daltonici).
export const FACTION_INFO = [
  { name: 'TU', short: 'TU', symbol: 'stella' as SymbolKind },
  { name: 'Corvi della Ruggine', short: 'CORVI', symbol: 'triangolo' as SymbolKind },
  { name: 'Chiesa del Neon', short: 'NEON', symbol: 'rombo' as SymbolKind },
  { name: 'Lega del Sale', short: 'SALE', symbol: 'quadrato' as SymbolKind },
].map((f, k) => ({ ...f, ...PALETTE.factions[k] }));
