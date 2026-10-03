import { PALETTE, hex } from '../config/palette';
import { DPR } from './screen';

export const FONT = '"Courier New", Courier, monospace';

export const textStyle = (size: number, color: number = PALETTE.carta, bold = true): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: FONT,
  fontSize: `${size}px`,
  fontStyle: bold ? 'bold' : 'normal',
  color: hex(color),
  resolution: DPR, // testi nitidi sugli schermi ad alta densità
});
