// Simboli piatti per fazione, disegnati (niente font: sempre identici su ogni telefono).
import Phaser from 'phaser';

export type SymbolKind = 'stella' | 'triangolo' | 'rombo' | 'quadrato' | 'cerchio';

export function drawSymbol(g: Phaser.GameObjects.Graphics, kind: SymbolKind, x: number, y: number, r: number, fill: number, stroke?: number) {
  const pts: { x: number; y: number }[] = [];
  if (kind === 'cerchio') {
    g.fillStyle(fill, 1).fillCircle(x, y, r * 0.75);
    if (stroke !== undefined) g.lineStyle(Math.max(1, r * 0.18), stroke, 1).strokeCircle(x, y, r * 0.75);
    return;
  }
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

/** Toppa di reparto (Figma, "Estetica"): disco scuro, doppio anello nel colore della potenza, simbolo e tacche. */
export function drawPatch(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, color: number, kind: SymbolKind) {
  g.fillStyle(0x05080a, 1).fillCircle(x, y, r);
  g.lineStyle(Math.max(1.5, r * 0.14), color, 1).strokeCircle(x, y, r);
  g.lineStyle(1, color, 0.7).strokeCircle(x, y, r * 0.72);
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    if (k % 6 === 0) continue; // tacche lungo il bordo, interrotte come una scritta circolare
    g.lineStyle(1, color, 0.55).lineBetween(x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78, x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9);
  }
  drawSymbol(g, kind, x, y - r * 0.05, r * 0.42, color);
  for (const dx of [-0.3, 0, 0.3]) drawSymbol(g, 'stella', x + dx * r, y + r * 0.5, r * 0.08, color);
}
