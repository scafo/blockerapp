// Icone piatte delle unità: scudo (fanteria), doppia freccia (ricognitori), cannone (artiglieria).
import Phaser from 'phaser';
import type { AbilityType, UnitType } from '../config/balance';

export function drawUnitIcon(g: Phaser.GameObjects.Graphics, type: UnitType, x: number, y: number, r: number, color: number) {
  g.fillStyle(color, 1);
  if (type === 'corazzati') {
    // carro: scafo, torretta, cannone
    g.fillRect(x - r * 0.95, y + r * 0.05, r * 1.9, r * 0.55);
    g.fillRect(x - r * 0.45, y - r * 0.4, r * 0.9, r * 0.45);
    g.fillRect(x + r * 0.4, y - r * 0.27, r * 0.65, r * 0.18);
    g.fillStyle(0x07110f, 1);
    for (const dx of [-0.6, -0.2, 0.2, 0.6]) g.fillCircle(x + dx * r, y + r * 0.35, r * 0.12);
    return;
  }
  if (type === 'genio') {
    // pala e piccone incrociati
    g.lineStyle(r * 0.2, color, 1).lineBetween(x - r * 0.75, y + r * 0.75, x + r * 0.6, y - r * 0.6).lineBetween(x + r * 0.75, y + r * 0.75, x - r * 0.6, y - r * 0.6);
    g.fillRect(x + r * 0.35, y - r * 0.95, r * 0.6, r * 0.35);
    g.fillTriangle(x - r * 0.95, y - r * 0.85, x - r * 0.2, y - r * 0.85, x - r * 0.6, y - r * 0.4);
    return;
  }
  if (type === 'cannoniera') {
    // scafo con cannone
    g.fillPoints([{ x: x - r, y: y + r * 0.1 }, { x: x + r, y: y + r * 0.1 }, { x: x + r * 0.7, y: y + r * 0.6 }, { x: x - r * 0.7, y: y + r * 0.6 }], true);
    g.fillRect(x - r * 0.35, y - r * 0.3, r * 0.6, r * 0.4);
    g.lineStyle(r * 0.16, color, 1).lineBetween(x + r * 0.2, y - r * 0.15, x + r * 0.9, y - r * 0.55);
    return;
  }
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

/** Icone delle abilità: aereo (ricognizione), bomba con mirino (bombardamento). */
export function drawAbilityIcon(g: Phaser.GameObjects.Graphics, a: AbilityType, x: number, y: number, r: number, color: number) {
  g.fillStyle(color, 1);
  if (a === 'ricognizione') {
    g.fillRect(x - r * 0.12, y - r * 0.9, r * 0.24, r * 1.8); // fusoliera
    g.fillTriangle(x - r, y + r * 0.1, x + r, y + r * 0.1, x, y - r * 0.35); // ali
    g.fillTriangle(x - r * 0.45, y + r * 0.9, x + r * 0.45, y + r * 0.9, x, y + r * 0.55); // coda
  } else {
    g.lineStyle(r * 0.12, color, 1).strokeCircle(x, y, r * 0.85);
    g.lineBetween(x - r, y, x - r * 0.45, y).lineBetween(x + r * 0.45, y, x + r, y).lineBetween(x, y - r, x, y - r * 0.45).lineBetween(x, y + r * 0.45, x, y + r);
    g.fillCircle(x, y, r * 0.28);
  }
}
