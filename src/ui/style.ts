import { PALETTE, hex } from '../config/palette';

export const FONT = '"Courier New", Courier, monospace';

export const textStyle = (size: number, color: number = PALETTE.carta, bold = true): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: FONT,
  fontSize: `${size}px`,
  fontStyle: bold ? 'bold' : 'normal',
  color: hex(color),
});
