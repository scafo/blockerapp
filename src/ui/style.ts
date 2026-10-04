import { PALETTE, hex } from '../config/palette';
import { DPR } from './screen';

// Font da terminale (dati) e condensato militare (titoli e numeri grandi), incorporati nel gioco (main.ts).
export const FONT = '"JetBrains Mono", "Courier New", monospace';
/** Leggibilità: nessun testo sotto 11 punti e tutto un po' più grande dei valori scritti nel codice. */
export const textSize = (size: number) => Math.round(Math.max(11, size * 1.12));
export const FONT_TITLE = 'Oswald, "Arial Narrow", sans-serif';

export const textStyle = (size: number, color: number = PALETTE.carta, bold = true): Phaser.Types.GameObjects.Text.TextStyle => ({
  // dati in mono (500, grassetto 700); i titoli grandi in condensato militare
  fontFamily: bold && size >= 15 ? FONT_TITLE : FONT,
  fontSize: `${textSize(size)}px`,
  fontStyle: bold ? (size >= 15 ? '600' : 'bold') : 'normal',
  color: hex(color),
  resolution: DPR, // testi nitidi sugli schermi ad alta densità
});
