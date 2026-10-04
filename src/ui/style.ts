import { PALETTE, hex } from '../config/palette';
import { DPR } from './screen';

// Font da terminale (dati) e condensato militare (titoli e numeri grandi), incorporati nel gioco (main.ts).
export const FONT = '"Share Tech Mono", "Courier New", monospace';
export const FONT_TITLE = 'Oswald, "Arial Narrow", sans-serif';

export const textStyle = (size: number, color: number = PALETTE.carta, bold = true): Phaser.Types.GameObjects.Text.TextStyle => ({
  // il font da terminale ha un solo peso: il grassetto finto sbava, quindi i "bold" grandi passano al titolo condensato
  fontFamily: bold && size >= 15 ? FONT_TITLE : FONT,
  fontSize: `${size}px`,
  fontStyle: bold && size >= 15 ? '600' : 'normal',
  color: hex(color),
  resolution: DPR, // testi nitidi sugli schermi ad alta densità
});
