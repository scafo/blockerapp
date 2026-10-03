import { FONT_DATA, FONT_TITLE, THEME, hex } from '../config/theme';
import { DPR } from './screen';

/** Dati (numeri, etichette): monospace. */
export const textStyle = (size: number, color: number = THEME.testo, bold = true): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: FONT_DATA,
  fontSize: `${size}px`,
  fontStyle: bold ? 'bold' : 'normal',
  color: hex(color),
  resolution: DPR, // testi nitidi sugli schermi ad alta densità
});

/** Titoli: sans condensato. */
export const titleStyle = (size: number, color: number = THEME.testo): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: FONT_TITLE,
  fontSize: `${size}px`,
  fontStyle: 'bold',
  color: hex(color),
  resolution: DPR,
});

/** Pannello piatto scuro con bordo 1px e angoli tagliati. */
export function panel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, cut = 6, border: number = THEME.griglia, fill: number = THEME.pannello, alpha = 0.92) {
  const pts = [
    new Phaser.Geom.Point(x + cut, y), new Phaser.Geom.Point(x + w, y), new Phaser.Geom.Point(x + w, y + h - cut),
    new Phaser.Geom.Point(x + w - cut, y + h), new Phaser.Geom.Point(x, y + h), new Phaser.Geom.Point(x, y + cut),
  ];
  g.fillStyle(fill, alpha).fillPoints(pts, true);
  g.lineStyle(1, border, 1).strokePoints(pts, true, true);
  return g;
}
