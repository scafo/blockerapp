// Simboli piatti per fazione, disegnati (niente font: sempre identici su ogni telefono).
import Phaser from 'phaser';

export type SymbolKind = 'stella' | 'triangolo' | 'rombo' | 'quadrato';

export function drawSymbol(g: Phaser.GameObjects.Graphics, kind: SymbolKind, x: number, y: number, r: number, fill: number, stroke?: number) {
  const pts: { x: number; y: number }[] = [];
  if (kind === 'stella') {
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.45 : r;
      pts.push({ x: x + rr * Math.cos(a), y: y + rr * Math.sin(a) });
    }
  } else if (kind === 'triangolo') {
    for (let k = 0; k < 3; k++) {
      const a = -Math.PI / 2 + (k * 2 * Math.PI) / 3;
      pts.push({ x: x + r * Math.cos(a), y: y + r * 1.05 * Math.sin(a) + r * 0.15 });
    }
  } else if (kind === 'rombo') {
    pts.push({ x, y: y - r }, { x: x + r * 0.8, y }, { x, y: y + r }, { x: x - r * 0.8, y });
  } else {
    const s = r * 0.8;
    pts.push({ x: x - s, y: y - s }, { x: x + s, y: y - s }, { x: x + s, y: y + s }, { x: x - s, y: y + s });
  }
  g.fillStyle(fill, 1).fillPoints(pts, true);
  if (stroke !== undefined) g.lineStyle(Math.max(1, r * 0.18), stroke, 1).strokePoints(pts, true);
}
