// Costruzioni nelle province: nomi e icone semplici (fabbrica, bunker, caserma).
import type Phaser from 'phaser';
import type { WorkId } from '../config/balance';

export const WORK_NAME: Record<WorkId, string> = { fabbrica: 'Fabbrica', bunker: 'Bunker', caserma: 'Caserma' };
export const WORK_DESC: Record<WorkId, string> = {
  fabbrica: 'produzione ×2,5',
  bunker: 'difesa ×1,7',
  caserma: 'truppe +10 caselle',
};

export function drawWorkIcon(g: Phaser.GameObjects.Graphics, w: WorkId, x: number, y: number, r: number, color: number) {
  g.fillStyle(color, 1);
  if (w === 'fabbrica') {
    // capannone a denti di sega con ciminiera
    g.fillPoints([
      { x: x - r, y: y + r * 0.8 }, { x: x - r, y: y - r * 0.1 }, { x: x - r * 0.4, y: y - r * 0.5 }, { x: x - r * 0.4, y: y - r * 0.1 },
      { x: x + r * 0.2, y: y - r * 0.5 }, { x: x + r * 0.2, y: y - r * 0.1 }, { x: x + r * 0.45, y: y - r * 0.1 }, { x: x + r * 0.45, y: y - r },
      { x: x + r, y: y - r }, { x: x + r, y: y + r * 0.8 },
    ], true);
  } else if (w === 'bunker') {
    // scudo
    g.fillPoints([{ x: x - r, y: y - r * 0.8 }, { x: x + r, y: y - r * 0.8 }, { x: x + r * 0.85, y: y + r * 0.2 }, { x, y: y + r }, { x: x - r * 0.85, y: y + r * 0.2 }], true);
  } else {
    // tenda con bandiera
    g.fillTriangle(x - r, y + r * 0.8, x + r, y + r * 0.8, x, y - r * 0.3);
    g.fillRect(x - r * 0.06, y - r, r * 0.12, r * 0.8).fillTriangle(x, y - r, x + r * 0.6, y - r * 0.8, x, y - r * 0.6);
  }
}
