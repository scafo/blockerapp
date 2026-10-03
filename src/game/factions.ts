// Nomi e colori delle fazioni. Indice 0 = giocatore.
import { PALETTE } from '../config/palette';

import type { SymbolKind } from '../ui/symbols';
import type { CivId } from '../config/balance';
import civText from '../data/civs.json';

// Ogni fazione ha colore + simbolo (leggibile anche per i daltonici).
export const FACTION_INFO = [
  // le potenze dopo la Caduta (sistemi politici, non nazioni): il giocatore guida la Republica
  { name: 'Republica', short: 'TU', symbol: 'stella' as SymbolKind, civ: 'republica' as CivId },
  { name: 'Imperium', short: 'IMPERIUM', symbol: 'triangolo' as SymbolKind, civ: 'imperium' as CivId },
  { name: 'Aristocrazia', short: 'ARISTOCR.', symbol: 'rombo' as SymbolKind, civ: 'aristocrazia' as CivId },
  { name: 'Cabal', short: 'CABAL', symbol: 'quadrato' as SymbolKind, civ: 'cabal' as CivId },
].map((f, k) => ({ ...f, ...PALETTE.factions[k] }) as { name: string; short: string; symbol: SymbolKind; civ: CivId; fill: number; border: number });

/** Colore e simbolo fissi per civiltà (riconoscibili in ogni campagna). */
export const CIV_STYLE = Object.fromEntries(FACTION_INFO.map((f) => [f.civ, { ...f }])) as Record<CivId, (typeof FACTION_INFO)[number]>;

/** A inizio campagna: fazione 0 = la civiltà del giocatore, le IA sono le altre tre potenze. */
export function assignFactions(player: CivId) {
  const order = [player, ...(['republica', 'imperium', 'aristocrazia', 'cabal'] as CivId[]).filter((c) => c !== player)];
  order.forEach((civ, k) => {
    const st = CIV_STYLE[civ];
    const name = (civText as Record<CivId, { name: string }>)[civ].name;
    Object.assign(FACTION_INFO[k], { ...st, name, short: k === 0 ? 'TU' : st.short === 'TU' ? name.toUpperCase() : st.short });
  });
}
