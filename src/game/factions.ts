// Nomi e colori delle fazioni. Indice 0 = giocatore.
import { PALETTE } from '../config/palette';

import type { SymbolKind } from '../ui/symbols';

// Ogni fazione ha colore + simbolo (leggibile anche per i daltonici).
export const FACTION_INFO = [
  // le potenze dopo la Caduta (sistemi politici, non nazioni): il giocatore guida la Republica
  { name: 'Republica', short: 'TU', symbol: 'stella' as SymbolKind },
  { name: 'Imperium', short: 'IMPERIUM', symbol: 'triangolo' as SymbolKind },
  { name: 'Aristocrazia', short: 'ARISTOCR.', symbol: 'rombo' as SymbolKind },
  { name: 'Cabal', short: 'CABAL', symbol: 'quadrato' as SymbolKind },
].map((f, k) => ({ ...f, ...PALETTE.factions[k] }));
