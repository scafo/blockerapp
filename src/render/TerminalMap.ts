// Carta da terminale (riferimento di Nico: MapSCII, la mappa del mondo che gira in un terminale). Non è un filtro su
// un'immagine: come MapSCII lo schermo è una griglia di caratteri e ogni cella è un carattere braille (2 × 4 puntini)
// disegnato col font del terminale. I puntini vengono dai dati della carta (mare acceso, terra vuota, territorio delle
// potenze del suo colore); i confini sono tracciati puntino per puntino (Bresenham); ogni cella ha un solo colore, come
// in un terminale vero; i nomi prendono il posto dei caratteri sotto (da qui il fondo nero attorno alle scritte).
import Phaser from 'phaser';
import type { MapShapes } from '../map/provinceShapes';

/** Font e cella del terminale (misurati sull'immagine di riferimento: 9 × 19 punti con DejaVu Sans Mono 15). */
export const TERM_FONT = '"DejaVu Sans Mono", Menlo, monospace';
const FONT_PT = 15;
const CELL_W = 9;
const CELL_H = 19;

export const TERM = {
  water: '#98a1d6', // puntini del mare: profondità media
  shallow: '#aab2e2', // acque basse lungo le coste
  deep: '#8891cc', // mare aperto profondo (differenza leggera)
  border: '#d8dadc', // confini
  country: '#e1e496', // nomi delle nazioni
  city: '#c0302a', // città
  sea: '#a5adb1', // mari
  status: '#f2f2f2', // barra in basso
};

// trama della terra libera per terreno, come si disegnano i terreni sulle carte: pianura a puntini radi, colline a onde,
// montagne a creste (/\/\), deserto a granelli sparsi. C, R = colonna e riga del carattere fissate al mondo (la trama non
// sfarfalla scorrendo la carta).
const LAND_COL = ['#30363d', '#3d444d', '#5f6670', '#544a37'];
function landMask(t: number, C: number, R: number): number {
  switch (t) {
    case 0: return (C + R) % 2 === 0 ? 0x04 : 0; // pianura
    case 1: return R % 2 === 0 ? (C % 2 === 0 ? 0x04 | 0x20 : 0x02 | 0x10) : 0; // colline: onda
    case 2: return R % 2 === 0 ? (C % 2 === 0 ? 0x40 | 0x10 : 0x02 | 0x80) : (C % 4 === 1 ? 0x08 : 0); // montagne: creste
    default: { const h = (Math.imul(C, 73856093) ^ Math.imul(R, 19349663)) >>> 0; return h % 5 === 0 ? 0x01 : h % 5 === 2 ? 0x80 : 0; } // deserto
  }
}

export interface TermLabel { x: number; y: number; text: string; color: string; priority: number; small?: boolean }
export interface TermBorder { pts: ArrayLike<number>; color: string; dash?: boolean } // dash = linea del fronte, tratteggiata

/** Quello che la scena passa a ogni ridisegno: tutto in coordinate mondo. */
export interface TermFrame {
  view: Phaser.Geom.Rectangle; // riquadro inquadrato (pixel-mondo)
  provinces: { id: number; color: string | null; terrain?: number }[]; // colore del territorio (null = terra libera); terreno 0..3
  borders: TermBorder[];
  labels: TermLabel[];
  status: string;
  /** colore del puntino tenue in ogni carattere di terra libera (da vicino: la terra non resta nera); assente = niente */
  landDots?: string;
  /** colore di riempimento → colore del confine: la linea va sull'ultimo puntino del territorio */
  edges?: Record<string, string>;
  /** linea del fronte: il bordo di `front.own` che tocca uno dei colori `front.war` diventa tratteggiato in `front.color` */
  front?: { own: string[]; war: string[]; color: string };
}

export class TerminalMap {
  readonly image: Phaser.GameObjects.Image;
  private tex: Phaser.Textures.CanvasTexture;
  private mask: HTMLCanvasElement; // terra e territorio a un pixel per puntino
  private glyphs = new Map<string, HTMLCanvasElement>(); // 256 glifi braille già disegnati, uno per colore
  private cols = 0;
  private rows = 0;
  private cw = CELL_W;
  private ch = CELL_H;

  constructor(private scene: Phaser.Scene, private shapes: MapShapes, private dpr: number, depth: number) {
    const key = 'terminale';
    if (scene.textures.exists(key)) scene.textures.remove(key);
    this.tex = scene.textures.createCanvas(key, 8, 8)!;
    this.image = scene.add.image(0, 0, key).setOrigin(0).setDepth(depth);
    this.mask = document.createElement('canvas');
  }

  /**
   * I 256 caratteri braille in un colore. Disegnati a mano con la geometria misurata sul riferimento (puntini 2 × 2 con un alone blu notte, colonne
   * a 1 e 5, righe a 1, 5, 9, 13 dentro la cella 9 × 19): con il glifo del font le quattro righe restavano schiacciate in alto.
   */
  private glyphSheet(color: string): HTMLCanvasElement {
    let g = this.glyphs.get(color);
    if (g) return g;
    const d = this.dpr, cw = Math.round(this.cw * d), ch = Math.round(this.ch * d);
    g = document.createElement('canvas');
    g.width = cw * 256; g.height = ch;
    const ctx = g.getContext('2d')!;
    ctx.fillStyle = color;
    const BITS: [number, number, number][] = [[0x01, 0, 0], [0x02, 0, 1], [0x04, 0, 2], [0x40, 0, 3], [0x08, 1, 0], [0x10, 1, 1], [0x20, 1, 2], [0x80, 1, 3]];
    const XS = [1, 5], YS = [1, 5, 9, 13], SW = 2, SH = 2;
    // alone scuro attorno a ogni puntino (nel terminale il blu sbava sul nero), poi il puntino
    const halo = color === TERM.water || color === TERM.shallow || color === TERM.deep ? '#151c4e' : null;
    for (let k = 1; k < 256; k++) {
      if (halo) {
        ctx.fillStyle = halo;
        for (const [bit, c, r] of BITS) if (k & bit) ctx.fillRect(k * cw + Math.round((XS[c] - 0.5) * d), Math.round((YS[r] - 0.5) * d), Math.round((SW + 1) * d), Math.round((SH + 1) * d));
        ctx.fillStyle = color;
      }
      for (const [bit, c, r] of BITS) {
        if (k & bit) ctx.fillRect(k * cw + Math.round(XS[c] * d), Math.round(YS[r] * d), Math.round(SW * d), Math.round(SH * d));
      }
    }
    this.glyphs.set(color, g);
    return g;
  }

  render(frame: TermFrame) {
    const cam = this.scene.cameras.main, dpr = this.dpr;
    const W = cam.width, H = cam.height; // pixel reali
    const cwPx = this.cw * dpr, chPx = this.ch * dpr;
    // la griglia dei caratteri è fissata al mondo: scorre con la carta (si sposta di celle intere, non trema)
    const v0 = frame.view, ppw = W / v0.width; // pixel reali per pixel-mondo
    if (!(v0.width > 0) || !Number.isFinite(ppw) || W < 2 || H < 2) return; // camera non ancora pronta
    const ox = -((((v0.x * ppw) % cwPx) + cwPx) % cwPx), oy = -((((v0.y * ppw) % chPx) + chPx) % chPx);
    this.cols = Math.ceil((W - ox) / cwPx);
    this.rows = Math.ceil((H - oy) / chPx);
    const gx0 = v0.x + ox / ppw, gy0 = v0.y + oy / ppw; // angolo in alto a sinistra della griglia, in pixel-mondo
    const DW = this.cols * 2, DH = this.rows * 4; // griglia dei puntini
    if (this.tex.width !== W || this.tex.height !== H) this.tex.setSize(W, H);
    const v = frame.view;
    // mondo → puntini
    const sx = (2 * ppw) / cwPx, sy = (4 * ppw) / chPx;
    const toDot = (x: number, y: number): [number, number] => [(x - gx0) * sx, (y - gy0) * sy];

    // 1. terra e territorio rasterizzati a un pixel per puntino (mare = trasparente)
    const m = this.mask;
    if (m.width !== DW || m.height !== DH) { m.width = DW; m.height = DH; }
    const mc = m.getContext('2d', { willReadFrequently: true })!;
    mc.setTransform(1, 0, 0, 1, 0, 0);
    mc.clearRect(0, 0, DW, DH);
    mc.setTransform(sx, 0, 0, sy, -gx0 * sx, -gy0 * sy);
    for (const p of frame.provinces) {
      mc.fillStyle = p.color ?? `rgb(${1 + (p.terrain ?? 0)},0,0)`; // terra libera: quasi nero, il rosso porta il terreno
      mc.beginPath();
      for (const part of this.shapes.provinces[p.id].parts) {
        const r = part.outer;
        mc.moveTo(r[0], r[1]);
        for (let j = 2; j < r.length; j += 2) mc.lineTo(r[j], r[j + 1]);
        mc.closePath();
      }
      mc.fill();
    }
    const px = mc.getImageData(0, 0, DW, DH).data;

    // 2. confini puntino per puntino (Bresenham), un colore per puntino
    const border = new Array<string | null>(DW * DH).fill(null);
    for (const b of frame.borders) {
      const pts = b.pts;
      let [x0, y0] = toDot(pts[0], pts[1]), step = 0;
      for (let j = 2; j < pts.length; j += 2) {
        const [x1, y1] = toDot(pts[j], pts[j + 1]);
        let ax = Math.floor(x0), ay = Math.floor(y0);
        const bx = Math.floor(x1), by = Math.floor(y1);
        const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay), stx = ax < bx ? 1 : -1, sty = ay < by ? 1 : -1;
        let err = dx + dy, guard = 0;
        for (;;) {
          if (ax >= 0 && ay >= 0 && ax < DW && ay < DH && !(b.dash && step % 6 >= 3)) border[ay * DW + ax] = b.color;
          step++;
          if ((ax === bx && ay === by) || ++guard > 4000) break;
          const e2 = 2 * err;
          if (e2 >= dy) { err += dy; ax += stx; }
          if (e2 <= dx) { err += dx; ay += sty; }
        }
        x0 = x1; y0 = y1;
      }
    }

    // territori: ogni puntino prende il colore puro della sua potenza (i bordi sfumati del disegno davano toni più scuri)
    const pal: [number, number, number][] = [], palCss: string[] = [];
    for (const pr of frame.provinces) {
      if (!pr.color || palCss.includes(pr.color)) continue;
      const m2 = /^#?([0-9a-f]{6})$/i.exec(pr.color);
      if (!m2) continue;
      const n = parseInt(m2[1], 16);
      pal.push([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
      palCss.push(pr.color);
    }
    const terr = new Int16Array(DW * DH).fill(-1);
    if (pal.length) for (let k = 0; k < DW * DH; k++) {
      const R = px[k * 4], G = px[k * 4 + 1], B = px[k * 4 + 2];
      if (px[k * 4 + 3] < 128 || R + G + B <= 24) continue;
      let best = 0, bd = Infinity;
      for (let i = 0; i < pal.length; i++) {
        const d = (pal[i][0] - R) ** 2 + (pal[i][1] - G) ** 2 + (pal[i][2] - B) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      // pixel sfumato col nero ai bordi delle province (colore "sporco"): non si indovina la potenza dal colore più vicino
      // (da lì venivano i puntini arancioni nel tuo territorio), lo decide il vicinato qui sotto
      terr[k] = bd <= 2400 ? best : -2;
    }
    for (let pass = 0; pass < 3; pass++) for (let k = 0; k < DW * DH; k++) {
      if (terr[k] !== -2) continue;
      const x = k % DW;
      if (x > 0 && terr[k - 1] >= 0) terr[k] = terr[k - 1];
      else if (x < DW - 1 && terr[k + 1] >= 0) terr[k] = terr[k + 1];
      else if (k >= DW && terr[k - DW] >= 0) terr[k] = terr[k - DW];
      else if (k + DW < DW * DH && terr[k + DW] >= 0) terr[k] = terr[k + DW];
    }
    for (let k = 0; k < DW * DH; k++) if (terr[k] === -2) terr[k] = -1;
    // confine dei territori: i puntini del riempimento che toccano qualcos'altro (terra libera, mare, altra potenza).
    // Così la linea sta esattamente sul bordo del colore: niente buchi tra riempimento e confine, niente sbavature fuori.
    if (frame.edges) for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) {
      const k = y * DW + x, t = terr[k];
      if (t < 0 || border[k]) continue;
      const e = frame.edges[palCss[t]];
      if (!e) continue;
      const nb = [x > 0 ? terr[k - 1] : t, x < DW - 1 ? terr[k + 1] : t, y > 0 ? terr[k - DW] : t, y < DH - 1 ? terr[k + DW] : t];
      if (!nb.some((v) => v !== t)) continue;
      border[k] = e;
      // fronte: dove il tuo territorio tocca un nemico in guerra, tratteggio rosso sullo stesso bordo (niente linee sfasate)
      const F = frame.front;
      if (F && F.own.includes(palCss[t]) && nb.some((v) => v >= 0 && F.war.includes(palCss[v]))) border[k] = (x + y) % 6 < 3 ? F.color : null;
    }

    // profondità: distanza dalla terra in pixel-mondo, tre fasce di blu (basso, medio, profondo)
    const dist = new Float32Array(DW * DH).fill(1e9), q = new Int32Array(DW * DH);
    let qh = 0, qt = 0;
    for (let k = 0; k < DW * DH; k++) if (px[k * 4 + 3] >= 128) { dist[k] = 0; q[qt++] = k; }
    while (qh < qt) {
      const k = q[qh++], x = k % DW, y = (k - x) / DW, nd = dist[k] + 1;
      if (x > 0 && dist[k - 1] > nd) { dist[k - 1] = nd; q[qt++] = k - 1; }
      if (x < DW - 1 && dist[k + 1] > nd) { dist[k + 1] = nd; q[qt++] = k + 1; }
      if (y > 0 && dist[k - DW] > nd) { dist[k - DW] = nd; q[qt++] = k - DW; }
      if (y < DH - 1 && dist[k + DW] > nd) { dist[k + DW] = nd; q[qt++] = k + DW; }
    }
    const shallowD = 30 * sx, midD = 110 * sx; // in puntini: 30 e 110 pixel-mondo dalla costa (le fasce coprono tutto il mare)
    const seaColor = (k: number) => (dist[k] <= shallowD ? TERM.shallow : dist[k] <= midD ? TERM.water : TERM.deep);

    // 3. celle: maschera braille + un colore (confine > territorio > mare)
    const BIT = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]]; // [riga][colonna] dei puntini braille
    const colBase = Math.round((gx0 * ppw) / cwPx), rowBase = Math.round((gy0 * ppw) / chPx); // indice del carattere nel mondo
    const cellMask = new Uint8Array(this.cols * this.rows);
    const cellColor = new Array<string>(this.cols * this.rows).fill('');
    const edgeMask = new Uint8Array(this.cols * this.rows); // puntini del confine, disegnati sopra il riempimento
    const edgeColor = new Array<string>(this.cols * this.rows).fill('');
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      let mk = 0, col = '', rank = 0, bm = 0, bcol = '';
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) {
        const X = c * 2 + dx, Y = r * 4 + dy, k = Y * DW + X, bc = border[k];
        if (bc) { bm |= BIT[dy][dx]; if (!bcol) bcol = bc; continue; }
        if (terr[k] >= 0) { // territorio di una potenza (colore puro della sua tavolozza)
          mk |= BIT[dy][dx];
          if (rank < 2) { col = palCss[terr[k]]; rank = 2; }
          continue;
        }
        if (px[k * 4 + 3] < 128) { mk |= BIT[dy][dx]; if (rank < 1) { col = seaColor(k); rank = 1; } continue; } // mare
      }
      // confine: una linea sola di puntini nel suo colore; il resto del carattere tiene il riempimento (niente buchi al bordo)
      edgeMask[r * this.cols + c] = bm;
      edgeColor[r * this.cols + c] = bcol;
      // terra libera senza niente sopra: trama tenue diversa per terreno (pianura, colline, montagne, deserto)
      const lk = ((r * 4 + 1) * DW + c * 2) * 4;
      if (!mk && frame.landDots && px[lk + 3] >= 128) {
        const t = Math.min(3, Math.max(0, px[lk] - 1));
        mk = landMask(t, c + colBase, r + rowBase) & ~bm;
        col = LAND_COL[t];
      }
      cellMask[r * this.cols + c] = mk;
      cellColor[r * this.cols + c] = col;
    }

    // 4. nomi agganciati alla griglia: prendono il posto dei caratteri (prima i più importanti, niente sovrapposizioni)
    const text = new Array<string>(this.cols * this.rows).fill('');
    const textColor = new Array<string>(this.cols * this.rows).fill('');
    const used = new Uint8Array(this.cols * this.rows);
    const labels = [...frame.labels].sort((a, b) => a.priority - b.priority);
    const draws: { x: number; y: number; text: string; color: string; px: number }[] = [];
    for (const l of labels) {
      const fpx = l.small ? 12 : FONT_PT, w = Math.ceil((l.text.length * 0.602 * fpx) / this.cw); // celle occupate
      const [dxp, dyp] = toDot(l.x, l.y);
      const row = Math.floor(dyp / 4), c0 = Math.round(dxp / 2 - w / 2);
      if (row < 0 || row >= this.rows || c0 < 0 || c0 + w > this.cols) continue;
      let free = true;
      for (let c = c0 - 1; c <= c0 + w && free; c++) for (let rr = row - 1; rr <= row + 1; rr++) {
        if (c >= 0 && c < this.cols && rr >= 0 && rr < this.rows && used[rr * this.cols + c]) { free = false; break; }
      }
      if (!free) continue;
      for (let i = 0; i < w; i++) { const k = row * this.cols + c0 + i; text[k] = ' '; used[k] = 1; }
      draws.push({ x: ox + c0 * cwPx, y: oy + row * chPx + chPx / 2, text: l.text, color: l.color, px: fpx * dpr });
    }
    void textColor;

    // 5. disegno: fondo nero, glifi braille, poi le lettere
    const ctx = this.tex.getContext();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    const gcw = Math.round(cwPx), gch = Math.round(chPx);
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      const k = r * this.cols + c;
      if (text[k]) continue;
      const mk = cellMask[k], em = edgeMask[k], X = Math.round(ox + c * cwPx), Y = Math.round(oy + r * chPx);
      if (mk) ctx.drawImage(this.glyphSheet(cellColor[k]), mk * gcw, 0, gcw, gch, X, Y, gcw, gch);
      if (em) ctx.drawImage(this.glyphSheet(edgeColor[k]), em * gcw, 0, gcw, gch, X, Y, gcw, gch);
    }
    ctx.textBaseline = 'middle';
    for (const d of draws) {
      ctx.font = `${d.px}px ${TERM_FONT}`;
      ctx.fillStyle = d.color;
      ctx.fillText(d.text, Math.round(d.x), Math.round(d.y));
    }
    // barra in basso come MapSCII, ferma sullo schermo
    ctx.font = `${FONT_PT * dpr}px ${TERM_FONT}`;
    const sw = ctx.measureText(frame.status).width;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, H - chPx, sw + cwPx, chPx);
    ctx.fillStyle = TERM.status;
    ctx.fillText(frame.status, 0, H - chPx / 2);
    this.tex.refresh();
    // l'immagine copre esattamente l'inquadratura
    this.image.setPosition(v.x, v.y).setDisplaySize(v.width, v.height);
  }

  destroy() {
    this.image.destroy();
  }
}
