// Icone delle risorse, disegnate in vettoriale con due toni e un filo scuro (leggibili anche piccole):
// lingotti impilati (metallo), tanica con la croce stampata (benzina), scatoletta da razione con fascetta (cibo).
import { PALETTE } from '../config/palette';
import Phaser from 'phaser';
import type { Resource } from '../config/balance';
import { RESOURCE_INFO } from '../game/resources';

const shade = (c: number, k: number) => {
  const o = Phaser.Display.Color.IntegerToColor(c);
  const f = (v: number) => Phaser.Math.Clamp(Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k)), 0, 255);
  return Phaser.Display.Color.GetColor(f(o.red), f(o.green), f(o.blue));
};

/** Icona centrata in (x, y), grande circa 2s × 2s. */
export function drawResourceIcon(g: Phaser.GameObjects.Graphics, r: Resource, x: number, y: number, s: number) {
  const c = RESOURCE_INFO[r].color, hi = shade(c, 0.35), lo = shade(c, -0.35), ink = PALETTE.inchiostro;
  const lw = Math.max(1, s * 0.12);
  if (r === 'metallo') {
    // due lingotti sotto, uno sopra: faccia chiara in alto, fianco scuro
    const bar = (cx: number, cy: number, w: number) => {
      const h = s * 0.42, t = w * 0.18;
      const top = [{ x: cx - w / 2 + t, y: cy - h / 2 }, { x: cx + w / 2 - t, y: cy - h / 2 }, { x: cx + w / 2, y: cy + h / 2 }, { x: cx - w / 2, y: cy + h / 2 }];
      g.fillStyle(c, 1).fillPoints(top, true);
      g.fillStyle(hi, 1).fillRect(cx - w / 2 + t, cy - h / 2, w - 2 * t, h * 0.28);
      g.fillStyle(lo, 1).fillRect(cx - w / 2, cy + h / 2 - h * 0.22, w, h * 0.22);
      g.lineStyle(lw, ink, 0.8).strokePoints(top, true, true);
    };
    bar(x - s * 0.45, y + s * 0.45, s * 0.95);
    bar(x + s * 0.5, y + s * 0.45, s * 0.95);
    bar(x, y - s * 0.05, s * 0.95);
  } else if (r === 'benzina') {
    // tanica: corpo con spigolo smussato, croce stampata, maniglia e tappo
    const w = s * 1.4, h = s * 1.6, x0 = x - w / 2, y0 = y - h / 2 + s * 0.2;
    g.fillStyle(c, 1).fillRoundedRect(x0, y0, w, h, s * 0.18);
    g.fillStyle(lo, 1).fillRect(x0 + w * 0.78, y0 + s * 0.1, w * 0.22 - s * 0.05, h - s * 0.2);
    g.lineStyle(Math.max(1, s * 0.16), lo, 1).lineBetween(x0 + w * 0.2, y0 + h * 0.25, x0 + w * 0.68, y0 + h * 0.8).lineBetween(x0 + w * 0.68, y0 + h * 0.25, x0 + w * 0.2, y0 + h * 0.8);
    g.fillStyle(hi, 1).fillRect(x0 + w * 0.08, y0 - s * 0.32, w * 0.42, s * 0.32); // maniglia
    g.fillStyle(ink, 1).fillRect(x0 + w * 0.16, y0 - s * 0.24, w * 0.26, s * 0.16);
    g.fillStyle(hi, 1).fillRect(x0 + w * 0.66, y0 - s * 0.36, w * 0.2, s * 0.36); // tappo
    g.lineStyle(lw, ink, 0.8).strokeRoundedRect(x0, y0, w, h, s * 0.18);
  } else {
    // scatoletta da razione: cilindro con coperchio ellittico e fascetta scura
    const w = s * 1.5, h = s * 1.45, x0 = x - w / 2, y0 = y - h / 2 + s * 0.15;
    g.fillStyle(c, 1).fillRect(x0, y0, w, h);
    g.fillStyle(lo, 1).fillEllipse(x, y0 + h, w, s * 0.5);
    g.fillStyle(c, 1).fillRect(x0, y0, w, h);
    g.fillStyle(ink, 0.55).fillRect(x0, y0 + h * 0.36, w, h * 0.3);
    g.fillStyle(hi, 1).fillRect(x0 + w * 0.12, y0 + h * 0.44, w * 0.18, h * 0.14);
    g.fillStyle(hi, 1).fillEllipse(x, y0, w, s * 0.5);
    g.lineStyle(lw, lo, 1).strokeEllipse(x, y0, w * 0.7, s * 0.3);
    g.lineStyle(lw, ink, 0.7).strokeEllipse(x, y0, w, s * 0.5);
  }
}
