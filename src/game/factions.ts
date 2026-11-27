// Fazioni di una campagna. Indice 0 = giocatore, poi gli imperi (IA forti che si espandono), poi le milizie provinciali
// (bot deboli che difendono la loro zona). La potenza (Imperium, Republica...) è solo una caratteristica dell'impero,
// come la dottrina in Call of War: il nome è casuale. Colore + simbolo per riconoscerle (anche per i daltonici).
import { PALETTE } from '../config/palette';
import type { SymbolKind } from '../ui/symbols';
import type { CivId } from '../config/balance';
import type { FactionKind } from '../map/generate';
import { createRng } from '../map/rng';
import civText from '../data/civs.json';
import names from '../data/names.json';

export interface FactionInfo {
  name: string; // nome completo (profilo, rapporti)
  short: string; // nome breve (mappa, elenco)
  symbol: SymbolKind;
  civ: CivId | null; // potenza (null per le milizie)
  kind: FactionKind;
  fill: number;
  border: number;
}

/** Colore e simbolo fissi per potenza (riconoscibili in ogni campagna). */
export const CIV_STYLE: Record<CivId, { symbol: SymbolKind; fill: number; border: number }> = {
  republica: { symbol: 'stella', ...PALETTE.factions[0] },
  imperium: { symbol: 'triangolo', ...PALETTE.factions[1] },
  aristocrazia: { symbol: 'rombo', ...PALETTE.factions[2] },
  cabal: { symbol: 'quadrato', ...PALETTE.factions[3] },
};

// imperi oltre i tre della campagna (sandbox: 25): colori pieni e diversi, niente arancio né il ciano del giocatore
const EMPIRE_COLORS = [0x5bbf5b, 0xd9529e, 0x4a6fe0, 0xa8d14a, 0xf08cb0, 0x3fb89a, 0xb8324a, 0x6a5acd, 0xd4c04a, 0x8a9a3a, 0x9a6a4a,
  0x9a8ae0, 0xd07a8a, 0x2e9e5e, 0x8e4a8e, 0x7a8ab0, 0xe8e070, 0x7a2a3a, 0x9ae0b0, 0x34489a, 0xc8b48a, 0x5a7a3a];

/** Colore dell'impero n oltre la lista fissa: tinte sparse con l'angolo aureo, saltando arancio (20–50°) e ciano del
 *  giocatore (175–200°), luminosità alternate per staccare i vicini di tinta. */
function empireColor(n: number): number {
  if (n < EMPIRE_COLORS.length) return EMPIRE_COLORS[n];
  let h = (n * 137.508) % 360;
  if (h >= 20 && h < 50) h += 35;
  if (h >= 175 && h < 200) h += 30;
  const l = [0.45, 0.6, 0.35][n % 3], s = 0.55;
  // HSL → RGB a mano: il motore resta senza Phaser (gira anche nelle simulazioni)
  const k = (m: number) => (m + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const ch = (m: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(m) - 3, 9 - k(m), 1))));
  return (ch(0) << 16) | (ch(8) << 8) | ch(4);
}

// milizie: toni smorzati, ben distinti dai colori forti degli imperi
const BOT_COLORS = [0x7d9a7a, 0x9a8f6a, 0x6f8f98, 0x9a7a6e, 0x8a7d9c, 0x6f9a8c, 0xa08a5c, 0x7a8aa6, 0x9c7f8c, 0x86996a, 0x6e8a7e, 0xa38770];
const lighten = (c: number, t: number) => {
  const ch = (s: number) => Math.round(((c >> s) & 255) + (255 - ((c >> s) & 255)) * t) << s;
  return ch(16) | ch(8) | ch(0);
};

/** Le fazioni della campagna in corso (riempite da setupFactions). */
export const FACTION_INFO: FactionInfo[] = [];

/** Quante fazioni hanno una riga nell'elenco (giocatore + imperi: vengono prima delle milizie). */
export const majorCount = () => FACTION_INFO.filter((f) => f.kind !== 'bot').length;

/** Indici delle fazioni nell'elenco (un impero caduto in una campagna precedente è diventato milizia: non sono per forza i primi). */
export const majorIds = () => FACTION_INFO.flatMap((f, id) => (f.kind !== 'bot' ? [id] : []));

/** A inizio campagna: tu con la tua potenza e il tuo nome, imperi con potenze diverse e nomi casuali, milizie. */
export function setupFactions(kinds: FactionKind[], player: CivId, playerName: string, seed: string) {
  const rng = createRng(seed + ':nomi');
  const pick = <T>(a: T[]) => a[Math.floor(rng() * a.length)];
  const places = [...names.places];
  const takePlace = () => places.splice(Math.floor(rng() * places.length), 1)[0] ?? pick(names.places);
  const others = (['imperium', 'aristocrazia', 'cabal', 'republica'] as CivId[]).filter((c) => c !== player);
  FACTION_INFO.length = 0;
  let e = 0, b = 0;
  const surnames = [...names.surnames];
  for (const kind of kinds) {
    if (kind === 'player') {
      const st = CIV_STYLE[player];
      const civName = (civText as Record<CivId, { name: string }>)[player].name;
      FACTION_INFO.push({ name: playerName || civName, short: playerName ? playerName.toUpperCase() : 'TU', symbol: st.symbol, civ: player, kind, fill: st.fill, border: st.border });
    } else if (kind === 'empire') {
      const k = e++, civ = others[k % others.length], st = CIV_STYLE[civ], place = takePlace();
      const name = pick((names.forms as Record<CivId, string[]>)[civ]).replace('{P}', place);
      const fill = k < others.length ? st.fill : empireColor(k - others.length);
      FACTION_INFO.push({ name, short: place.toUpperCase(), symbol: st.symbol, civ, kind, fill, border: k < others.length ? st.border : lighten(fill, 0.55) });
    } else {
      const color = BOT_COLORS[b++ % BOT_COLORS.length];
      const surname = surnames.length ? surnames.splice(Math.floor(rng() * surnames.length), 1)[0] : pick(names.surnames);
      const form = pick(names.botForms);
      const place = form.includes('{P}') ? takePlace() : '';
      const name = form.replace('{S}', surname).replace('{P}', place);
      FACTION_INFO.push({ name, short: (place || surname).toUpperCase(), symbol: 'cerchio', civ: null, kind, fill: color, border: lighten(color, 0.55) });
    }
  }
}
