// Linguaggio visivo delle schermate fuori dalla mappa (Figma di Nico, riferimenti "GIS", "Interzone", "Obsidian"):
// pannelli neri con filo grigio sottile, etichette in mono maiuscolo grigio, valori grandi bianchi, crocini agli angoli,
// un solo colore per significato (verde = guadagno, rosso = perdita, accento = azione principale).
import Phaser from 'phaser';
import { PALETTE, hex } from '../config/palette';
import { FONT, FONT_MONO, FONT_TITLE, textSize } from './style';
import { UI } from './screen';

export const OPS = {
  panel: 0x0a0d10, // fondo dei pannelli
  edge: 0x5c656c, // filo dei pannelli
  label: 0x8a949a, // etichette (mono maiuscolo)
  text: 0xe9ebe6, // valori e testo principale
  body: 0xb9c0c2, // testo di lettura
  gain: 0x6fd08a, // guadagni, stati positivi
  loss: 0xe0523f, // perdite, stati negativi
  accent: PALETTE.ocra, // azione principale
};

/** Etichetta tecnica: mono maiuscolo spaziato, grigio. */
export function label(scene: Phaser.Scene, x: number, y: number, text: string, color: number = OPS.label, size = 10) {
  return scene.add.text(x, y, text.toUpperCase(), {
    fontFamily: FONT_MONO, fontSize: `${textSize(size)}px`, color: hex(color), resolution: UI(),
  }).setLetterSpacing(1.5);
}

/** Valore grande (titoli, numeri). */
export function value(scene: Phaser.Scene, x: number, y: number, text: string, size: number, color: number = OPS.text) {
  return scene.add.text(x, y, text, { fontFamily: FONT_TITLE, fontSize: `${Math.round(size)}px`, fontStyle: '600', color: hex(color), resolution: UI() });
}

/** Testo di lettura. */
export function body(scene: Phaser.Scene, x: number, y: number, text: string, size = 13, color: number = OPS.body, wrap = 0) {
  const t = scene.add.text(x, y, text, { fontFamily: FONT, fontSize: `${textSize(size)}px`, color: hex(color), resolution: UI(), lineSpacing: 3 });
  if (wrap) t.setWordWrapWidth(wrap);
  return t;
}

/** Pannello nero con filo sottile. */
export function panel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, alpha = 0.86) {
  g.fillStyle(OPS.panel, alpha).fillRect(x, y, w, h);
  g.lineStyle(1, OPS.edge, 0.55).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/** Riga divisoria interna. */
export function rule(g: Phaser.GameObjects.Graphics, x0: number, x1: number, y: number, alpha = 0.35) {
  g.lineStyle(1, OPS.edge, alpha).lineBetween(x0, Math.round(y) + 0.5, x1, Math.round(y) + 0.5);
}

/** Crocini agli angoli della cornice e trattini a metà dei lati (mirino da sala operativa). */
export function frameMarks(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, len = 16, alpha = 0.5) {
  g.lineStyle(1, OPS.text, alpha);
  for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    g.lineBetween(cx - sx * len * 0.6, cy, cx + sx * len, cy);
    g.lineBetween(cx, cy - sy * len * 0.6, cx, cy + sy * len);
  }
  g.lineBetween(x + w / 2 - 6, y, x + w / 2 + 6, y).lineBetween(x + w / 2 - 6, y + h, x + w / 2 + 6, y + h);
}

/** Puntino di stato (es. ● RITIRATA). */
export function dot(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number, r = 3) {
  g.fillStyle(color, 1).fillRect(x - r, y - r, r * 2, r * 2);
}

/** Etichetta in un riquadro sottile (chip: potenza, fronte, durata). */
export function chip(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics, x: number, y: number, text: string): number {
  const t = label(scene, x + 8, y + 5, text, OPS.text, 9);
  const w = t.width + 16, h = t.height + 10;
  g.lineStyle(1, OPS.edge, 0.7).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  return w;
}
