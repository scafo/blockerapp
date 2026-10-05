import Phaser from 'phaser';
import { PALETTE } from '../../config/palette';
import { textStyle } from '../style';

export interface TableRow {
  k: string;
  v: string;
  c?: number; // colore del valore, se diverso dal testo normale
}

/** Tabella chiave/valore su due colonne, come la scheda provincia/unità. */
export function drawTable(scene: Phaser.Scene, x: number, y: number, w: number, rows: TableRow[], rowH = 22): Phaser.GameObjects.GameObject[] {
  const items: Phaser.GameObjects.GameObject[] = [];
  rows.forEach((row, i) => {
    const ry = y + i * rowH;
    items.push(
      scene.add.text(x, ry, row.k, textStyle(10, PALETTE.tenue, false)).setOrigin(0, 0.5),
      scene.add.text(x + w, ry, row.v, textStyle(12, row.c ?? PALETTE.carta)).setOrigin(1, 0.5),
    );
  });
  return items;
}
