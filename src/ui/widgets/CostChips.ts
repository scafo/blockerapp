import Phaser from 'phaser';
import { PALETTE } from '../../config/palette';
import { textStyle } from '../style';
import { drawResourceIcon } from '../resourceIcons';
import type { Resource } from '../../config/balance';
import type { Bag } from '../../game/resources';

/** Riga di chip "serve/hai" per risorsa: icona + numero, bordo chiaro se basta, rosso se manca. */
export function costChips(scene: Phaser.Scene, x: number, y: number, cost: Partial<Bag>, have: Bag, chipW = 64, chipH = 24): Phaser.GameObjects.GameObject[] {
  const items: Phaser.GameObjects.GameObject[] = [];
  (Object.keys(cost) as Resource[]).forEach((r, i) => {
    const cx = x + i * (chipW + 6), need = cost[r] ?? 0, ok = (have[r] ?? 0) >= need;
    const g = scene.add.graphics();
    g.fillStyle(PALETTE.pannello, 1).fillRoundedRect(cx, y, chipW, chipH, 4)
      .lineStyle(1, ok ? PALETTE.linea : PALETTE.ko, 1).strokeRoundedRect(cx, y, chipW, chipH, 4);
    drawResourceIcon(g, r, cx + 14, y + chipH / 2, 7);
    items.push(g, scene.add.text(cx + 26, y + chipH / 2, String(need), textStyle(12, ok ? PALETTE.carta : PALETTE.ko)).setOrigin(0, 0.5));
  });
  return items;
}
