// Icone piatte delle risorse: lamiera (rottami), tanica (carburante), scatoletta (viveri).
import Phaser from 'phaser';
import type { Resource } from '../config/balance';
import { RESOURCE_INFO } from '../game/resources';

export function drawResourceIcon(g: Phaser.GameObjects.Graphics, r: Resource, x: number, y: number, s: number) {
  const c = RESOURCE_INFO[r].color;
  g.fillStyle(c, 1);
  if (r === 'rottami') {
    g.fillPoints([{ x: x - s, y: y - s * 0.6 }, { x: x + s * 0.7, y: y - s }, { x: x + s, y: y + s * 0.5 }, { x: x - s * 0.5, y: y + s }], true);
  } else if (r === 'carburante') {
    g.fillRect(x - s * 0.75, y - s * 0.6, s * 1.5, s * 1.6);
    g.fillRect(x - s * 0.2, y - s, s * 0.6, s * 0.4);
  } else {
    g.fillRect(x - s * 0.8, y - s * 0.7, s * 1.6, s * 1.4);
    g.fillStyle(0x2b2118, 0.5).fillRect(x - s * 0.8, y - s * 0.15, s * 1.6, s * 0.3);
  }
}
