import { PALETTE, hex } from '../config/palette';
import { UI } from './screen';

// Semi-condensato pulito per i dati e condensato militare per titoli e numeri grandi, incorporati nel gioco (main.ts).
export const FONT = '"Barlow Semi Condensed", "Arial Narrow", sans-serif';
/** Leggibilità: nessun testo sotto 12 punti e tutto un po' più grande dei valori scritti nel codice. */
export const textSize = (size: number) => Math.round(Math.max(12, size * 1.2));
export const FONT_TITLE = 'Oswald, "Arial Narrow", sans-serif';
/** Font da terminale (rapporti e archivio nei caricamenti). */
export const FONT_MONO = '"IBM Plex Mono", "Courier New", monospace';

export const textStyle = (size: number, color: number = PALETTE.carta, bold = true): Phaser.Types.GameObjects.Text.TextStyle => ({
  // dati in Barlow (500, grassetto 700); i titoli grandi in condensato militare
  fontFamily: bold && size >= 15 ? FONT_TITLE : FONT,
  fontSize: `${textSize(size)}px`,
  fontStyle: bold ? (size >= 15 ? '600' : 'bold') : 'normal',
  color: hex(color),
  resolution: UI(), // testi nitidi sugli schermi ad alta densità e ingranditi
});
