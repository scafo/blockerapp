// Icone piatte delle unità: scudo (fanteria), doppia freccia (ricognitori), cannone (artiglieria).
import Phaser from 'phaser';
import type { UnitType } from '../config/balance';

export function drawUnitIcon(g: Phaser.GameObjects.Graphics, type: UnitType, x: number, y: number, r: number, color: number) {
  g.fillStyle(color, 1);
  if (type === 'legionari' || type === 'guardia') {
    // scudo della fanteria con segno della civiltà: barra (legione) o anello (guardia)
    drawUnitIcon(g, 'fanteria', x, y, r, color);
    g.fillStyle(0x07110f, 1);
    if (type === 'legionari') g.fillRect(x - r * 0.12, y - r * 0.7, r * 0.24, r * 1.2);
    else g.lineStyle(r * 0.16, 0x07110f, 1).strokeCircle(x, y - r * 0.15, r * 0.38);
    return;
  }
  if (type === 'prototipo') {
    drawUnitIcon(g, 'artiglieria', x, y, r, color);
    g.lineStyle(r * 0.14, color, 1).strokeCircle(x + r * 0.85, y - r * 0.75, r * 0.22); // scintilla
    return;
  }
  if (type === 'infiltrati') {
    g.fillPoints([{ x: x - r * 0.5, y: y - r * 0.8 }, { x: x + r * 0.5, y }, { x: x - r * 0.5, y: y + r * 0.8 }, { x: x - r * 0.15, y }], true);
    g.fillCircle(x + r * 0.7, y, r * 0.18);
    return;
  }
  if (type === 'fanteria') {
    g.fillPoints([
      { x: x - r * 0.8, y: y - r * 0.8 }, { x: x + r * 0.8, y: y - r * 0.8 }, { x: x + r * 0.8, y: y + r * 0.1 },
      { x, y: y + r }, { x: x - r * 0.8, y: y + r * 0.1 },
    ], true);
  } else if (type === 'ricognitori') {
    for (const dx of [-0.55, 0.25]) {
      const cx = x + dx * r;
      g.fillPoints([
        { x: cx - r * 0.35, y: y - r * 0.8 }, { x: cx + r * 0.45, y }, { x: cx - r * 0.35, y: y + r * 0.8 },
        { x: cx - r * 0.05, y }, 
      ], true);
    }
  } else {
    g.fillCircle(x - r * 0.25, y + r * 0.35, r * 0.5);
    g.lineStyle(r * 0.38, color, 1).lineBetween(x - r * 0.25, y + r * 0.35, x + r * 0.8, y - r * 0.6);
    g.fillRect(x - r * 0.9, y + r * 0.72, r * 1.3, r * 0.22);
  }
}
