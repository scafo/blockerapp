import { PALETTE, hex } from '../config/palette';
import { UI } from './screen';

// Semi-condensato pulito per i dati e condensato militare per titoli e numeri grandi, incorporati nel gioco (main.ts).
export const FONT = '"Barlow Semi Condensed", "Arial Narrow", sans-serif';
/** Leggibilità: nessun testo sotto 12 punti e tutto un po' più grande dei valori scritti nel codice. */
export const textSize = (size: number) => Math.round(Math.max(12, size * 1.2));
export const FONT_TITLE = 'Oswald, "Arial Narrow", sans-serif';
/** Font da terminale (archivio e flussi di dati nei caricamenti, come le scritte sull'immagine della nave). */
export const FONT_MONO = '"Share Tech Mono", "Courier New", monospace';

export const textStyle = (size: number, color: number = PALETTE.carta, bold = true): Phaser.Types.GameObjects.Text.TextStyle => ({
  // dati in Barlow (500, grassetto 700); i titoli grandi in condensato militare
  fontFamily: bold && size >= 15 ? FONT_TITLE : FONT,
  fontSize: `${textSize(size)}px`,
  fontStyle: bold ? (size >= 15 ? '600' : 'bold') : 'normal',
  color: hex(color),
  resolution: UI(), // testi nitidi sugli schermi ad alta densità e ingranditi
});

/** Numero in formato italiano (punto delle migliaia, virgola decimale): 12345 → "12.345", 3.5 → "3,5". */
export const fmtNum = (n: number, decimals = 0): string =>
  n.toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** Tasso con segno, come "+0,2/min" o "-1,5/s" (stessa convenzione già usata in giro nel codice). */
export const fmtRate = (perTime: number, unit: string, decimals = 1): string =>
  `${perTime >= 0 ? '+' : ''}${fmtNum(perTime, decimals)}/${unit}`;

/** Singolare/plurale italiano semplice: plural(1,'provincia','province') → "provincia". */
export const plural = (n: number, singular: string, pluralForm: string): string => (n === 1 ? singular : pluralForm);
