// Segni sulla carta dentro la griglia di puntini (Nico, 25 novembre 2026: "c'è una griglia, lavora dentro il framework"):
// invece di linee vettoriali sopra la mappa si accendono le celle del livello di puntini in vista. La trama delle fessure
// della carta (WorldMap) sta sopra, quindi ogni cella diventa un puntino identico a quelli dei territori.
import type Phaser from 'phaser';

export class GridPen {
  private d = 1;
  // riquadro in vista, in celle: le righe fuori schermo non si disegnano (Nico, 27 novembre 2026: blocchi di 5 s. Da vicino
  // la strada lunga di una pedina erano milioni di celle a ogni fotogramma, quasi tutte fuori dallo schermo)
  private vx0 = -Infinity;
  private vy0 = -Infinity;
  private vx1 = Infinity;
  private vy1 = Infinity;
  private lastCol = -1;
  private lastAlpha = -1;

  constructor(readonly g: Phaser.GameObjects.Graphics) {}

  /** Nuovo disegno alla densità del livello in vista (puntini per pixel-mondo). */
  begin(d: number, view?: { x: number; y: number; right: number; bottom: number }): this {
    this.d = d;
    this.g.clear();
    this.lastCol = -1;
    // margine di un decimo dello schermo: la vista della camera è quella del fotogramma prima
    if (view) { const m = (view.right - view.x) * 0.1 * d; this.vx0 = view.x * d - m; this.vy0 = view.y * d - m; this.vx1 = view.right * d + m; this.vy1 = view.bottom * d + m; }
    else { this.vx0 = this.vy0 = -Infinity; this.vx1 = this.vy1 = Infinity; }
    return this;
  }

  /** Lato di una cella in pixel-mondo. */
  get cell(): number {
    return 1 / this.d;
  }

  /** Accende la cella della griglia (X, Y). */
  dot(X: number, Y: number, color: number, alpha = 1) {
    const c = 1 / this.d;
    if (color !== this.lastCol || alpha !== this.lastAlpha) { this.lastCol = color; this.lastAlpha = alpha; this.g.fillStyle(color, alpha); } // stesso colore: niente comando in più
    this.g.fillRect(X * c, Y * c, c, c);
  }

  /** Cella che contiene il punto del mondo (x, y). */
  at(x: number, y: number): [number, number] {
    return [Math.floor(x * this.d), Math.floor(y * this.d)];
  }

  /** Riga di celle tra due punti del mondo; `dash` = celle accese e spente a turno (0 = piena); `w` = celle di spessore. */
  line(ax: number, ay: number, bx: number, by: number, color: number, alpha = 1, dash = 0, w = 1, from = 0): number {
    const full = Math.max(Math.abs(Math.floor(bx * this.d) - Math.floor(ax * this.d)), Math.abs(Math.floor(by * this.d) - Math.floor(ay * this.d))) + 1;
    // taglio al riquadro in vista (Liang-Barsky, in celle); il tratteggio conta anche le celle saltate
    const X0 = ax * this.d, Y0 = ay * this.d, DX = bx * this.d - X0, DY = by * this.d - Y0;
    let t0 = 0, t1 = 1;
    for (const [p, q] of [[-DX, X0 - this.vx0], [DX, this.vx1 - X0], [-DY, Y0 - this.vy0], [DY, this.vy1 - Y0]]) {
      if (p === 0) { if (q < 0) return from + full; continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) return from + full; if (r > t0) t0 = r; }
      else { if (r < t0) return from + full; if (r < t1) t1 = r; }
    }
    this.raster(ax + (bx - ax) * t0, ay + (by - ay) * t0, ax + (bx - ax) * t1, ay + (by - ay) * t1, color, alpha, dash, w, from + Math.floor(full * t0));
    return from + full;
  }

  private raster(ax: number, ay: number, bx: number, by: number, color: number, alpha: number, dash: number, w: number, from: number) {
    let [x0, y0] = this.at(ax, ay);
    const [x1, y1] = this.at(bx, by);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, k = from;
    const wide = dx > -dy; // riga più orizzontale: lo spessore va in verticale
    for (let guard = 0; guard < 20000; guard++) {
      if (!dash || k % (2 * dash) < dash) for (let j = 0; j < w; j++) this.dot(wide ? x0 : x0 + j, wide ? y0 + j : y0, color, alpha);
      k++;
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /** Spezzata di celle (il tratteggio continua da un tratto all'altro). */
  path(pts: { x: number; y: number }[], color: number, alpha = 1, dash = 0, w = 1) {
    let k = 0;
    for (let i = 1; i < pts.length; i++) k = this.line(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, color, alpha, dash, w, k);
  }

  /** Quadrato pieno di n × n celle centrato sul punto. */
  block(x: number, y: number, n: number, color: number, alpha = 1) {
    const [X, Y] = this.at(x, y), h = Math.floor(n / 2);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) this.dot(X - h + i, Y - h + j, color, alpha);
  }

  /** Cornice di n × n celle centrata sul punto. */
  frame(x: number, y: number, n: number, color: number, alpha = 1) {
    const [X, Y] = this.at(x, y), h = Math.floor(n / 2);
    for (let i = 0; i < n; i++) {
      this.dot(X - h + i, Y - h, color, alpha); this.dot(X - h + i, Y - h + n - 1, color, alpha);
      this.dot(X - h, Y - h + i, color, alpha); this.dot(X - h + n - 1, Y - h + i, color, alpha);
    }
  }

  /** Icona su griglia N × N (1 = acceso), una cella per puntino, centrata sul punto. */
  icon(grid: Uint8Array, N: number, x: number, y: number, color: number, alpha = 1) {
    const [X, Y] = this.at(x, y), h = Math.floor(N / 2);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (grid[r * N + c]) this.dot(X - h + c, Y - h + r, color, alpha);
  }
}
