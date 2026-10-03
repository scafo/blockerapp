// Colori e font (Stile visivo in CLAUDE.md). Il colore è riservato alle fazioni: il terreno usa solo luminosità e trama.
export const THEME = {
  sfondo: 0x07090c,
  griglia: 0x1b2530,
  testo: 0xc9d6df,
  testoDebole: 0x6c7a86,
  attivo: 0x4fe3c1,
  allerta: 0xffb547,
  pericolo: 0xff4d4d,
  pannello: 0x0d1218,
  mare: 0x0b1015, // caselle di mare: appena sopra lo sfondo
  costa: 0x34495c, // linea di costa nel gap
  confineProvincia: 0x26333f, // confini di provincia sottili nel gap
  // luminosità del terreno (scala di grigi freddi attorno al colore della griglia)
  lum: { pianura: 0x1b2530, foresta: 0x151d26, deserto: 0x2a3540, montagna: 0x3a4754, caduta: 0x0e0f14, fiume: 0x4a5a6a, citta: 0x8fa3b3 },
  // modalità terreno: qui (e solo qui) il terreno ha colore
  colore: { pianura: 0x5e7347, foresta: 0x2d5a3a, deserto: 0xc2a568, montagna: 0x8a7e72, caduta: 0x6a2f6e, fiume: 0x4f8fc4, citta: 0xe8e2d0 },
};

export interface Faction { name: string; fill: number; glow: number; symbol: string }
const glowOf = (c: number) => {
  const mix = (v: number) => Math.round(v + (255 - v) * 0.5);
  return (mix((c >> 16) & 255) << 16) | (mix((c >> 8) & 255) << 8) | mix(c & 255);
};
export const FACTIONS: Faction[] = [
  { name: 'Empirium', fill: 0xe5484d, glow: glowOf(0xe5484d), symbol: '▲' },
  { name: 'Republica', fill: 0x3e8bff, glow: glowOf(0x3e8bff), symbol: '■' },
  { name: 'Aristocrazia', fill: 0xb56bff, glow: glowOf(0xb56bff), symbol: '◆' },
  { name: 'Elite', fill: 0xf2c14e, glow: glowOf(0xf2c14e), symbol: '●' },
];
/** Fazione del giocatore nella M1 (una sola civiltà nell'MVP). */
export const PLAYER = 1;

export const FONT_DATA = '"Courier New", Courier, monospace';
export const FONT_TITLE = '"sans-serif-condensed", "Roboto Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';

export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
