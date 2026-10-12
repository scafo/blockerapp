// Segni della carta da terminale: niente cerchi (stonano con la griglia di caratteri), solo forme ad angolo retto.
// Mirino a quattro angoli per selezioni e bersagli, riquadro che si riempie lungo il bordo per i tempi (assalti, cantieri).
import Phaser from 'phaser';

// Tutto disegnato a rettangoli pieni (non a linee): gli angoli restano vivi, senza gli arrotondamenti delle linee spesse.

/** Contorno di un rettangolo con angoli netti: quattro barre piene di spessore lw, verso l'interno. */
export function rectOutline(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, lw: number, color: number, alpha = 1) {
  g.fillStyle(color, alpha);
  g.fillRect(x, y, w, lw).fillRect(x, y + h - lw, w, lw).fillRect(x, y + lw, lw, h - 2 * lw).fillRect(x + w - lw, y + lw, lw, h - 2 * lw);
  return g;
}

/** Mirino: quattro angoli attorno a (x, y), semilato r, braccetti lunghi `arm` (frazione del lato). */
export function brackets(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, lw: number, color: number, alpha = 1, arm = 0.45) {
  const a = r * arm;
  g.fillStyle(color, alpha);
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const cx = sx < 0 ? x - r : x + r - lw, cy = sy < 0 ? y - r : y + r - lw;
    g.fillRect(sx < 0 ? cx : cx - a + lw, cy, a, lw); // braccio orizzontale
    g.fillRect(cx, sy < 0 ? cy : cy - a + lw, lw, a); // braccio verticale
  }
  return g;
}

/** Bordo di un quadrato percorso per la frazione t (0..1), in senso orario dall'angolo in alto a sinistra. */
export function squareProgress(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, t: number, lw: number, color: number, alpha = 1) {
  const side = 2 * r, total = 4 * side;
  let left = Phaser.Math.Clamp(t, 0, 1) * total;
  const pts = [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r], [x - r, y - r]];
  g.fillStyle(color, alpha);
  for (let i = 0; i < 4 && left > 0; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], k = Math.min(1, left / side);
    const ex = ax + (bx - ax) * k, ey = ay + (by - ay) * k;
    g.fillRect(Math.min(ax, ex) - lw / 2, Math.min(ay, ey) - lw / 2, Math.abs(ex - ax) + lw, Math.abs(ey - ay) + lw); // barra piena
    left -= side;
  }
  return g;
}
