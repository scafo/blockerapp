// Stile "planimetria tecnica" (riferimento di Nico): fondo ardesia, filo avorio, etichette in corsivo verde acqua
// incastrate nel bordo, tratteggi per ciò che non esiste ancora. Usato da schede, riquadri e carte di tutto il gioco.
import Phaser from 'phaser';
import { PALETTE, hex } from '../config/palette';
import { textStyle } from './style';

export const EDGE = PALETTE.carta; // filo dei riquadri
export const FILL = PALETTE.inchiostro; // fondo ardesia
export const TEAL = PALETTE.ocra; // etichette

/** Testo in corsivo (etichette, note a margine). */
export const italic = (size: number, color: number = TEAL): Phaser.Types.GameObjects.Text.TextStyle => ({ ...textStyle(size, color, false), fontStyle: 'italic', padding: { right: 3 } });

/** Riquadro della pianta: fondo ardesia e filo avorio. */
export function box(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, alpha = 0.96, edge = 0.85) {
  return g.fillStyle(FILL, alpha).fillRect(x, y, w, h).lineStyle(1.2, EDGE, edge).strokeRect(x, y, w, h);
}

/** Etichetta in corsivo incastrata nel bordo superiore di un riquadro, come "Piani della base" nella pianta. */
export function notch(scene: Phaser.Scene, x: number, y: number, label: string, color: number = TEAL) {
  return scene.add.text(x + 8, y, ` ${label} `, italic(11, color)).setOrigin(0, 0.5).setBackgroundColor(hex(FILL));
}

/** Linea a puntini (condotte, separatori). */
export function dots(g: Phaser.GameObjects.Graphics, x0: number, y0: number, x1: number, y1: number, color: number = EDGE, alpha = 0.5) {
  const n = Math.max(1, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 5));
  for (let i = 0; i <= n; i += 2) g.fillStyle(color, alpha).fillRect(x0 + ((x1 - x0) * i) / n - 0.75, y0 + ((y1 - y0) * i) / n - 0.75, 1.5, 1.5);
  return g;
}

/** Riquadro tratteggiato (ciò che non è ancora costruito, la legenda). */
export function dashedBox(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: number = EDGE, alpha = 0.6) {
  for (let i = 0; i < (w + h) * 2; i += 7) {
    const q = i < w ? [x + i, y] : i < w + h ? [x + w, y + i - w] : i < 2 * w + h ? [x + w - (i - w - h), y + h] : [x, y + h - (i - 2 * w - h)];
    g.fillStyle(color, alpha).fillRect(q[0] - 1, q[1] - 1, 3, 1.5);
  }
  return g;
}

/**
 * Scheda completa: fondo ardesia, filo avorio, titolo incastrato nel bordo e ✕ in alto a destra.
 * Restituisce gli oggetti da mettere nel contenitore della scheda (nell'ordine di disegno).
 */
export function sheet(scene: Phaser.Scene, x: number, y: number, w: number, h: number, title: string, onClose?: () => void) {
  const bg = scene.add.rectangle(x, y, w, h, FILL, 0.98).setOrigin(0).setStrokeStyle(1.5, EDGE, 0.9).setInteractive();
  const items: Phaser.GameObjects.GameObject[] = [bg];
  if (title) items.push(notch(scene, x + 6, y, title));
  if (onClose) {
    // ✕ con area di tocco ampia (≈44 punti), non solo il segno
    const close = scene.add.text(x + w - 4, y + 2, '✕', textStyle(16, EDGE)).setOrigin(1, 0).setPadding(12, 8, 10, 12).setInteractive({ useHandCursor: true });
    close.on('pointerup', onClose);
    items.push(close);
  }
  return items;
}

/**
 * Bigliettino di comunicazione: riquadro incorniciato con l'etichetta sul bordo ("Allarme" in rosso, "Avviso" in ambra,
 * "Comunicazione" in verde acqua) e il messaggio dentro. `ox` = 0 ancora a sinistra, 0.5 al centro, 1 a destra.
 */
export function note(scene: Phaser.Scene, x: number, y: number, w: number, msg: string, color: number, ox = 0.5) {
  const label = color === PALETTE.ko ? 'Allarme' : color === PALETTE.allerta ? 'Avviso' : 'Comunicazione';
  const lc = color === PALETTE.ko ? PALETTE.ko : color === PALETTE.allerta ? PALETTE.allerta : TEAL;
  const t = scene.add.text(12, 14, msg, textStyle(13, color === PALETTE.ko || color === PALETTE.allerta ? EDGE : color)).setWordWrapWidth(w - 24).setLineSpacing(2);
  const h = t.height + 26;
  const g = scene.add.graphics();
  box(g, 0, 0, w, h, 0.97, 0.9);
  g.fillStyle(lc, 1).fillRect(0, 0, 3, h); // bordo sinistro nel colore dell'etichetta
  const c = scene.add.container(x - w * ox, y, [g, t, notch(scene, 0, 0, label, lc)]);
  c.setSize(w, h);
  return c;
}
