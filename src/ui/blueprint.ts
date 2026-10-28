// Pianta della postazione (riferimento di Nico: mappa di un impianto): un nucleo grande in alto con il nome della postazione,
// un corridoio centrale e una stanza per ogni livello o voce, con codice, nome e stato. Fatta = stanza bianca piena,
// in corso = filo ambra, prossima = filo bianco, da fare = filo tratteggiato. Legenda in basso.
import Phaser from 'phaser';
import { PALETTE, hex } from '../config/palette';
import { FONT, FONT_TITLE, textSize } from './style';
import { UI } from './screen';
import { label } from './ops';
import { dashedBox, dots } from './schematic';

export const BP_BLUE = 0x1b2b33;
export const BP_CYAN = 0x6fc4c9;
const PAPER = 0xf2f0e6;

export type ModuleState = 'done' | 'active' | 'next' | 'todo';
export interface Module { code: string; name: string; sub?: string; state: ModuleState }

const italic = (size: number, color: number) => ({ fontFamily: FONT, fontSize: `${textSize(size)}px`, fontStyle: 'italic', color: hex(color), resolution: UI(), padding: { right: 3 } });

export function drawBlueprint(scene: Phaser.Scene, x: number, y: number, w: number, h: number, title: string, core: string, mods: Module[]): Phaser.GameObjects.GameObject[] {
  const out: Phaser.GameObjects.GameObject[] = [];
  const g = scene.add.graphics();
  out.push(g);
  // carta: blu ardesia, polvere di puntini, bordo a puntini
  g.fillStyle(BP_BLUE, 0.96).fillRect(x, y, w, h);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < Math.round(w * h / 2400); i++) g.fillStyle(0xffffff, 0.12 + rnd() * 0.3).fillRect(x + rnd() * w, y + rnd() * h, 1.2, 1.2);
  dots(dots(dots(dots(g, x, y, x + w, y, 0xffffff, 0.5), x, y + h, x + w, y + h, 0xffffff, 0.5), x, y, x, y + h, 0xffffff, 0.5), x + w, y, x + w, y + h, 0xffffff, 0.5);
  out.push(label(scene, x + 14, y + 12, `pianta · ${title}`, BP_CYAN, 9));

  // nucleo: la postazione stessa, grande e piena
  const pad = 18, coreW = Math.min(w - 2 * pad, 280), coreH = Math.max(48, Math.min(72, h * 0.13));
  const legendH = 34, rows = Math.max(1, Math.ceil(mods.length / 2)), gapY = 16;
  // misura delle stanze, poi tutto il disegno centrato in altezza nello spazio libero
  const room = Math.min(92, (h - 36 - legendH - 12 - coreH - 26 - (rows - 1) * gapY) / rows);
  const blockH = coreH + 26 + rows * room + (rows - 1) * gapY;
  const cx = x + w / 2, coreY = y + 36 + Math.max(0, (h - 36 - legendH - 12 - blockH) / 2);
  g.fillStyle(PAPER, 1).fillRect(cx - coreW / 2, coreY, coreW, coreH);
  out.push(label(scene, cx - coreW / 2 + 8, coreY + 6, 'nucleo', BP_BLUE, 8));
  out.push(scene.add.text(cx, coreY + coreH / 2 + 4, core.toUpperCase(), { fontFamily: FONT_TITLE, fontStyle: '600', fontSize: `${Math.round(Math.min(22, coreH * 0.42))}px`, color: hex(BP_BLUE), resolution: UI() }).setOrigin(0.5));

  // stanze: due colonne ai lati del corridoio centrale
  const top = coreY + coreH + 26, rh = room;
  const colGap = 40, mw = Math.min(250, (w - 2 * pad - colGap) / 2);
  const lastDone = mods.reduce((k, m, i) => (m.state === 'done' || m.state === 'active' ? i : k), -1);
  const spineEnd = top + Math.floor(Math.max(0, mods.length - 1) / 2) * (rh + gapY) + rh / 2;
  const builtEnd = lastDone >= 0 ? top + Math.floor(lastDone / 2) * (rh + gapY) + rh / 2 : coreY + coreH;
  // corridoio: pieno fin dove si è costruito, a puntini oltre
  g.lineStyle(2, 0xffffff, 0.9).lineBetween(cx, coreY + coreH, cx, builtEnd);
  if (spineEnd > builtEnd) dots(g, cx, builtEnd, cx, spineEnd, 0xffffff, 0.6);
  g.fillStyle(0xffffff, 1).fillCircle(cx, coreY + coreH, 3);
  mods.forEach((m, i) => {
    const left = i % 2 === 0, r = Math.floor(i / 2);
    const my = top + r * (rh + gapY), mx = left ? cx - colGap / 2 - mw : cx + colGap / 2;
    const door = left ? mx + mw : mx, cy = my + rh / 2;
    // passaggio dal corridoio alla stanza, con i pallini d'aggancio
    if (m.state === 'done' || m.state === 'active') g.lineStyle(1.5, 0xffffff, 0.9).lineBetween(cx, cy, door, cy);
    else dots(g, cx, cy, door, cy, 0xffffff, 0.6);
    g.fillStyle(0xffffff, 1).fillCircle(cx, cy, 2.6).fillCircle(door, cy, 2.6);
    // stanza
    const ink = m.state === 'done' ? BP_BLUE : m.state === 'todo' ? 0x8fa3ab : 0xffffff;
    if (m.state === 'done') g.fillStyle(PAPER, 1).fillRect(mx, my, mw, rh);
    else if (m.state === 'todo') dashedBox(g, mx, my, mw, rh, 0xffffff, 0.5);
    else g.lineStyle(m.state === 'active' ? 2 : 1.5, m.state === 'active' ? PALETTE.allerta : 0xffffff, 1).strokeRect(mx, my, mw, rh);
    out.push(label(scene, mx + 8, my + 6, m.code, ink, 8));
    const big = rh >= 46;
    const name = scene.add.text(mx + 8, my + (big ? rh / 2 - 2 : rh / 2), m.name.toUpperCase(), {
      fontFamily: FONT_TITLE, fontStyle: '600', fontSize: `${Math.round(Math.min(17, rh * 0.26))}px`, color: hex(ink), resolution: UI(),
    }).setOrigin(0, 0.5);
    name.setScale(Math.min(1, (mw - 16) / Math.max(1, name.width))); // nomi lunghi: più piccoli, mai tagliati
    out.push(name);
    if (m.sub && big) out.push(scene.add.text(mx + 8, my + rh - 6, m.sub, italic(10, m.state === 'active' ? PALETTE.allerta : m.state === 'done' ? 0x41606b : BP_CYAN)).setOrigin(0, 1)
      .setWordWrapWidth(mw - 16).setMaxLines(1));
  });

  // legenda
  const ly = y + h - legendH + 6, keys: [string, (gx: number, gy: number) => void][] = [
    ['fatto', (gx, gy) => g.fillStyle(PAPER, 1).fillRect(gx, gy, 18, 10)],
    ['in corso', (gx, gy) => g.lineStyle(1.5, PALETTE.allerta, 1).strokeRect(gx, gy, 18, 10)],
    ['prossimo', (gx, gy) => g.lineStyle(1.5, 0xffffff, 1).strokeRect(gx, gy, 18, 10)],
    ['da fare', (gx, gy) => dashedBox(g, gx, gy, 18, 10, 0xffffff, 0.6)],
  ];
  dots(g, x + 10, ly - 6, x + w - 10, ly - 6, 0xffffff, 0.35);
  let kx = x + 14;
  for (const [t, draw] of keys) {
    draw(kx, ly + 4);
    const tt = label(scene, kx + 24, ly + 9, t, 0xffffff, 8).setOrigin(0, 0.5);
    out.push(tt);
    kx += 24 + tt.width + 18;
  }
  return out;
}
