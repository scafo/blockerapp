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
// puntini a passo costante di 3 punti in orizzontale e in verticale, anche tra un carattere e l'altro (Nico: ogni tanto si vedeva
// una riga vuota, e voleva molti più puntini): celle 6 × 12, quasi il doppio dei puntini delle 9 × 19 del riferimento
const CELL_W = 6;
const CELL_H = 12;
const STATUS_H = 19; // barra in basso: alta come prima (il testo resta a 15 punti)

export const TERM = {
  water: '#c3ccd6', // puntini del mare: profondità media (Nico: meno blu, più bianco; poi: troppo rosa, ora grigio-azzurro)
  shallow: '#d3dae2', // acque basse lungo le coste
  deep: '#b3bdc9', // mare aperto profondo (differenza leggera)
  border: '#d8dadc', // confini
  country: '#9fd0f5', // nomi delle nazioni: azzurro (Nico: tema azzurrino, niente giallo)
  city: '#4f8fd6', // città: blu (niente rosso)
  sea: '#a5adb1', // mari
  status: '#f2f2f2', // barra in basso
};

// Terra libera (Nico: "togli ste cunette e sassolini, falle più fluide e variegate come il mare"): puntini pieni come il mare,
// in toni di blu che salgono con l'altitudine (pianura, deserto, colline, montagne) sfumati tra un terreno e l'altro, più una
// leggera grana fissa al mondo per variare.
const ELEV = [0, 1.15, 2.4, 0.55]; // pianura, colline, montagne, deserto
const LAND_SHADES = ['#1b2331', '#1f283a', '#253046', '#2c3953', '#354463', '#405176', '#4d6089'];
const FORT = '#f2f2f2'; // muro: seconda fila del confine

export interface TermLabel { x: number; y: number; text: string; color: string; priority: number; small?: boolean }
export interface TermBorder { pts: ArrayLike<number>; color: string; dash?: boolean } // dash = linea del fronte, tratteggiata

/** Quello che la scena passa a ogni ridisegno: tutto in coordinate mondo. */
export interface TermFrame {
  view: Phaser.Geom.Rectangle; // riquadro inquadrato (pixel-mondo)
  provinces: { id: number; color: string | null; terrain?: number; fort?: boolean; stripe?: number }[]; // stripe: 1 righe /, 2 righe \\ // colore del territorio (null = terra libera); terreno 0..3; fort = muro (bunker)
  borders: TermBorder[];
  labels: TermLabel[];
  status: string;
  /** passo dei puntini in punti CSS (3 = celle 6 × 12) */
  pitch?: number;
  /** colore del puntino tenue in ogni carattere di terra libera (da vicino: la terra non resta nera); assente = niente */
  landDots?: string;
  /** colore di riempimento → colore del confine: la linea va sull'ultimo puntino del territorio */
  edges?: Record<string, string>;
  /** linea del fronte: il bordo di `front.own` che tocca uno dei colori `front.war` diventa tratteggiato in `front.color` */
  front?: { own: string[]; war: string[]; color: string };
  /** colori che per il confine contano come un territorio solo (logistica: le sfumature del tuo, senza linee in mezzo) */
  same?: string[];
}

export class TerminalMap {
  // prestazioni (Nico: lento a ridisegnare scorrendo e zoomando): niente più un glifo per carattere. Un'immagine con un pixel per
  // puntino (il suo colore) si ingrandisce sulla griglia, poi una trama di fori a forma di puntino lascia vedere solo i puntini.
  // Sotto, uno strato con l'alone blu notte attorno ai puntini del mare. Tutto sulla GPU, la CPU scrive solo un pixel per puntino.
  private rt: Phaser.GameObjects.RenderTexture; // puntini e nomi (trasparente fuori dai puntini)
  private rtHalo: Phaser.GameObjects.RenderTexture; // fondo nero e aloni del mare
  private dotTex: Phaser.Textures.CanvasTexture;
  private haloTex: Phaser.Textures.CanvasTexture;
  private dotImg: Phaser.GameObjects.Image;
  private haloImg: Phaser.GameObjects.Image;
  private holes: Phaser.GameObjects.TileSprite; // opaco tranne i puntini: cancella dal livello dei puntini tutto il resto
  private rings: Phaser.GameObjects.TileSprite; // nero tranne l'anello dell'alone
  private colInt = new Map<string, number>();
  private bufs = new Map<string, unknown>();
  private rowsX?: number[][]; // memoria riusata tra un ridisegno e l'altro (niente spazzatura)
  private labelTexts = new Map<string, Phaser.GameObjects.Text>();
  private statusImg: Phaser.GameObjects.Image; // barra in basso: a parte, così spostare la carta non ridisegna tutto
  private statusTex: Phaser.Textures.CanvasTexture;
  private statusText = '';
  private cols = 0;
  private rows = 0;
  private cw = CELL_W;
  private ch = CELL_H;
  private origin?: { x: number; y: number };
  private drawnZoom = 0;
  private smooth = false;
  private pitch = 3; // passo dei puntini in punti CSS (cella = 2 × 4 puntini)

  constructor(private scene: Phaser.Scene, private shapes: MapShapes, private dpr: number, private depth: number) {
    const key = 'terminale', tm = scene.textures;
    // grande quanto la vista col margine di movimento (1,7 volte lo schermo): rifarla durante lo zoom bloccava per centinaia di ms
    const rw = Math.ceil(scene.cameras.main.width * 1.75), rh = Math.ceil(scene.cameras.main.height * 1.75);
    this.rtHalo = scene.add.renderTexture(0, 0, rw, rh).setOrigin(0).setDepth(depth - 0.001);
    this.rt = scene.add.renderTexture(0, 0, rw, rh).setOrigin(0).setDepth(depth);
    for (const r of [this.rt, this.rtHalo]) r.texture.setFilter(Phaser.Textures.FilterMode.NEAREST); // puntini netti: senza, a zoom non intero si impastavano in righe
    for (const k of [key + '-punti', key + '-aloni', key + '-fori', key + '-anelli', key + '-stato']) if (tm.exists(k)) tm.remove(k);
    this.dotTex = tm.createCanvas(key + '-punti', 8, 8)!;
    this.haloTex = tm.createCanvas(key + '-aloni', 8, 8)!;
    this.dotImg = scene.add.image(0, 0, key + '-punti').setOrigin(0).setVisible(false);
    this.haloImg = scene.add.image(0, 0, key + '-aloni').setOrigin(0).setVisible(false);
    this.buildPatterns(key);
    this.holes = scene.add.tileSprite(0, 0, 8, 8, key + '-fori').setOrigin(0).setVisible(false);
    this.rings = scene.add.tileSprite(0, 0, 8, 8, key + '-anelli').setOrigin(0).setVisible(false);
    this.statusTex = tm.createCanvas(key + '-stato', 8, 8)!;
    this.statusImg = scene.add.image(0, 0, key + '-stato').setOrigin(0, 1).setDepth(depth + 0.01);
  }

  /**
   * Trame di un pezzo di griglia (tante celle quante servono per misure intere): fori dei puntini (geometria misurata sul
   * riferimento: puntini 1,6 punti a passo 3) e anelli dell'alone attorno a ogni puntino.
   */
  private buildPatterns(key: string) {
    const d = this.dpr, cwPx = this.cw * d, chPx = this.ch * d, q = this.pitch;
    const mult = (v: number) => { for (let m = 1; m <= 8; m++) if (Math.abs(v * m - Math.round(v * m)) < 1e-6) return m; return 1; };
    const mx = mult(cwPx), my = mult(chPx), pw = Math.round(cwPx * mx), ph = Math.round(chPx * my);
    // passo q costante dentro e tra le celle; puntino 0,53 del passo (a passo 3: colonne a 1 e 4, righe a 1, 4, 7, 10, puntino 1,6)
    const XS = [q / 3, (4 * q) / 3], YS = [q / 3, (4 * q) / 3, (7 * q) / 3, (10 * q) / 3], SW = 0.533 * q, SH = 0.533 * q;
    for (const k of [key + '-fori', key + '-anelli']) if (this.scene.textures.exists(k)) this.scene.textures.remove(k);
    const make = (name: string, draw: (ctx: CanvasRenderingContext2D, x: number, y: number) => void, bg: string) => {
      const c = document.createElement('canvas');
      c.width = pw; c.height = ph;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, pw, ph);
      for (let cy = 0; cy < my; cy++) for (let cx = 0; cx < mx; cx++) for (const xs of XS) for (const ys of YS) draw(ctx, cx * cwPx + xs * d, cy * chPx + ys * d);
      this.scene.textures.addCanvas(name, c);
    };
    // fori: opaco ovunque, trasparente sui puntini
    make(key + '-fori', (ctx, x, y) => ctx.clearRect(Math.round(x), Math.round(y), Math.round(SW * d), Math.round(SH * d)), '#ffffff');
    // anelli: nero ovunque, trasparente sull'alone (attorno al puntino, che resta nero)
    make(key + '-anelli', (ctx, x, y) => {
      const h = Math.max(0.5, q / 6); // alone attorno al puntino
      ctx.clearRect(Math.round(x - h * d), Math.round(y - h * d), Math.round((SW + 2 * h) * d), Math.round((SH + 2 * h) * d));
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(SW * d), Math.round(SH * d));
    }, '#000000');
  }

  /** Vettore riusato di n elementi (azzerato o riempito con `fill`). */
  private buf<T extends Uint8Array | Int16Array | Int32Array | Uint32Array | Float32Array>(name: string, C: { new (n: number): T }, n: number, fill = 0): T {
    let b = this.bufs.get(name) as T | undefined;
    if (!b || b.length < n) { b = new C(Math.ceil(n * 1.25)); this.bufs.set(name, b); }
    const v = b.subarray(0, n) as T;
    v.fill(fill);
    return v;
  }

  /** Colore CSS → pixel ABGR (ImageData su little-endian). */
  private rgba(color: string): number {
    let v = this.colInt.get(color);
    if (v === undefined) {
      const n = Phaser.Display.Color.HexStringToColor(color);
      v = ((255 << 24) | (n.blue << 16) | (n.green << 8) | n.red) >>> 0;
      this.colInt.set(color, v);
    }
    return v;
  }

  private base: { key: string; x0: number; y0: number; w: number; h: number; land: Uint8Array; ter: Uint8Array; dots: Uint32Array; halo: Uint32Array } | null = null;
  private terrainOf: ArrayLike<number> = [];

  /** Terreno di ogni provincia (0 pianura, 1 colline, 2 montagne, 3 deserto): serve alla base, che copre anche fuori vista. */
  setTerrain(t: ArrayLike<number>) {
    this.terrainOf = t;
    this.base = null;
  }

  /** Riempie a righe la sagoma della provincia `id` (regola del centro del puntino): `span(Y, xa, xb)` per ogni tratto. */
  private raster(id: number, gx0: number, gy0: number, sx: number, sy: number, DW: number, DH: number, span: (Y: number, xa: number, xb: number) => void) {
    const sh = this.shapes.provinces[id];
    const ya = Math.max(0, Math.ceil((sh.y0 - gy0) * sy - 0.5)), yb = Math.min(DH - 1, Math.floor((sh.y1 - gy0) * sy - 0.5));
    if (yb < ya) return;
    const rowsX: number[][] = (this.rowsX ??= []); // incroci per riga, riusati
    for (let Y = ya; Y <= yb; Y++) (rowsX[Y - ya] ??= []).length = 0;
    // ogni lato una volta sola: le righe che attraversa (centro della riga in [ymin, ymax)) ricevono il suo incrocio
    for (const part of sh.parts) {
      const r = part.outer, n = r.length;
      for (let j = 0; j < n; j += 2) {
        const k = j + 2 < n ? j + 2 : 0, y1 = r[j + 1], y2 = r[k + 1];
        if (y1 === y2) continue;
        const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
        const Y0 = Math.max(ya, Math.ceil((lo - gy0) * sy - 0.5)), Y1 = Math.min(yb, Math.ceil((hi - gy0) * sy - 0.5) - 1);
        if (Y1 < Y0) continue;
        const x1 = r[j], dxdy = (r[k] - x1) / (y2 - y1);
        for (let Y = Y0; Y <= Y1; Y++) rowsX[Y - ya].push(x1 + (gy0 + (Y + 0.5) / sy - y1) * dxdy);
      }
    }
    for (let Y = ya; Y <= yb; Y++) {
      const xs = rowsX[Y - ya];
      if (xs.length < 2) continue;
      if (xs.length === 2) { if (xs[0] > xs[1]) { const a = xs[0]; xs[0] = xs[1]; xs[1] = a; } } else xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const xa = Math.max(0, Math.ceil((xs[i] - gx0) * sx - 0.5)), xb = Math.min(DW - 1, Math.ceil((xs[i + 1] - gx0) * sx - 0.5) - 1);
        if (xb >= xa) span(Y, xa, xb);
      }
    }
  }

  /**
   * Base fissa della carta per una zona (in puntini del mondo, a questo zoom): terra, terreno, mare a tre fasce di profondità
   * (con l'alone) e rilievo della terra libera, sfumato e sgranato da lontano. Stessi conti di prima, fatti una volta sola.
   */
  private buildBase(key: string, x0: number, y0: number, w: number, h: number, sx: number, sy: number, landDots?: string) {
    const n = w * h, gx0 = x0 / sx, gy0 = y0 / sy;
    const land = new Uint8Array(n), ter = new Uint8Array(n), dots = new Uint32Array(n), halo = new Uint32Array(n);
    const v = { x0: gx0, y0: gy0, x1: gx0 + w / sx, y1: gy0 + h / sy };
    this.shapes.provinces.forEach((sh, id) => {
      if (!sh?.parts.length || sh.x1 < v.x0 || sh.x0 > v.x1 || sh.y1 < v.y0 || sh.y0 > v.y1) return;
      const tv = 1 + (this.terrainOf[id] ?? 0);
      this.raster(id, gx0, gy0, sx, sy, w, h, (Y, xa, xb) => { const a = Y * w + xa, b = Y * w + xb + 1; land.fill(1, a, b); ter.fill(tv, a, b); });
    });
    // buchi di un puntino tra due province vicine (gli incroci dei lati condivisi non sempre coincidono al centesimo): si
    // riempiono dal vicino, se no venivano letti come mare e attorno spuntava un bordo blu (Nico: "pixel a caso")
    for (let Y = 0; Y < h; Y++) for (let X = 0; X < w; X++) {
      const k = Y * w + X;
      if (land[k]) continue;
      if (X > 0 && X < w - 1 && land[k - 1] && land[k + 1]) { land[k] = 1; ter[k] = ter[k - 1]; continue; }
      if (Y > 0 && Y < h - 1 && land[k - w] && land[k + w]) { land[k] = 1; ter[k] = ter[k - w]; }
    }
    // profondità: distanza dalla terra in puntini (passi dritti e in diagonale √2: fasce tonde attorno alle isole, non a rombo)
    const dist = new Float32Array(n).fill(1e9);
    const shallowD = 30 * sx, midD = 110 * sx; // 30 e 110 pixel-mondo dalla costa (le fasce coprono tutto il mare)
    for (let k = 0; k < n; k++) if (land[k]) dist[k] = 0;
    for (let y = 0, k = 0; y < h; y++) for (let x = 0; x < w; x++, k++) {
      let d = dist[k];
      if (!d) continue;
      if (x > 0 && dist[k - 1] + 1 < d) d = dist[k - 1] + 1;
      if (y > 0 && dist[k - w] + 1 < d) d = dist[k - w] + 1;
      if (x > 0 && y > 0 && dist[k - w - 1] + 1.414 < d) d = dist[k - w - 1] + 1.414;
      if (x < w - 1 && y > 0 && dist[k - w + 1] + 1.414 < d) d = dist[k - w + 1] + 1.414;
      dist[k] = d;
    }
    for (let y = h - 1, k = n - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--, k--) {
      let d = dist[k];
      if (!d) continue;
      if (x < w - 1 && dist[k + 1] + 1 < d) d = dist[k + 1] + 1;
      if (y < h - 1 && dist[k + w] + 1 < d) d = dist[k + w] + 1;
      if (x < w - 1 && y < h - 1 && dist[k + w + 1] + 1.414 < d) d = dist[k + w + 1] + 1.414;
      if (x > 0 && y < h - 1 && dist[k + w - 1] + 1.414 < d) d = dist[k + w - 1] + 1.414;
      dist[k] = d;
    }
    // altitudine della terra libera sfumata (media su un quadrato di ~6 pixel-mondo, separabile): niente scalini tra terreni
    const HALO = this.rgba('#1a2430'); // alone del mare: grigio-blu (l'indaco di prima lo faceva sembrare rosa)
    const seaInt = [this.rgba(TERM.shallow), this.rgba(TERM.water), this.rgba(TERM.deep)];
    const shadeInt = LAND_SHADES.map((c) => this.rgba(c));
    const elev = new Float32Array(n), wt = new Float32Array(n);
    for (let k = 0; k < n; k++) if (land[k]) { elev[k] = ELEV[Math.min(3, Math.max(0, ter[k] - 1))]; wt[k] = 1; }
    // da vicino (Nico): ogni provincia di un tono solo, quello del suo terreno, niente sfumatura né grana; da lontano sfumato
    const near = sx > 1.5;
    const rad = Math.max(1, Math.min(8, Math.round(6 * sx)));
    const grain = 0.6;
    const tmp = new Float32Array(n);
    const blur = (src: Float32Array, dst: Float32Array, horiz: boolean) => {
      const len = horiz ? w : h, lines = horiz ? h : w, st = horiz ? 1 : w, ls = horiz ? w : 1;
      for (let l = 0; l < lines; l++) {
        const b0 = l * ls;
        let acc = 0;
        for (let i = -rad; i <= rad; i++) if (i >= 0 && i < len) acc += src[b0 + i * st];
        for (let i = 0; i < len; i++) {
          dst[b0 + i * st] = acc;
          const out = i - rad, inn = i + rad + 1;
          if (out >= 0) acc -= src[b0 + out * st];
          if (inn < len) acc += src[b0 + inn * st];
        }
      }
    };
    if (landDots && !near) { blur(elev, tmp, true); blur(tmp, elev, false); blur(wt, tmp, true); blur(tmp, wt, false); }
    for (let Y = 0; Y < h; Y++) for (let X = 0; X < w; X++) {
      const k = Y * w + X;
      if (!land[k]) { dots[k] = seaInt[dist[k] <= shallowD ? 0 : dist[k] <= midD ? 1 : 2]; halo[k] = HALO; continue; } // mare
      if (!landDots || wt[k] <= 0) continue;
      if (near) { dots[k] = shadeInt[Math.round((elev[k] / 2.4) * (LAND_SHADES.length - 1))]; continue; }
      // grana: rumore fisso al mondo (non sfarfalla scorrendo), al massimo ±0,3 di gradino
      let hh = ((X + x0) * 374761393 + (Y + y0) * 668265263) | 0;
      hh = Math.imul(hh ^ (hh >>> 13), 1274126177);
      const noise = (((hh ^ (hh >>> 16)) & 1023) / 1023 - 0.5) * grain;
      const e = elev[k] / wt[k] / 2.4 * (LAND_SHADES.length - 1) + noise;
      dots[k] = shadeInt[Math.max(0, Math.min(LAND_SHADES.length - 1, Math.round(e)))];
    }
    return { key, x0, y0, w, h, land, ter, dots, halo };
  }

  render(frame: TermFrame) {
    // passo dei puntini secondo lo zoom (Nico: da lontano erano troppo grossi, da vicino sparivano): nuove trame se cambia
    if (frame.pitch && frame.pitch !== this.pitch) {
      this.pitch = frame.pitch;
      this.cw = 2 * this.pitch;
      this.ch = 4 * this.pitch;
      this.buildPatterns('terminale');
      this.holes.setTexture('terminale-fori');
      this.rings.setTexture('terminale-anelli');
    }
    const cam = this.scene.cameras.main, dpr = this.dpr;
    const cwPx = this.cw * dpr, chPx = this.ch * dpr;
    // la griglia dei caratteri è fissata al mondo: scorre con la carta (si sposta di celle intere, non trema)
    const v0 = frame.view, ppw = cam.zoom; // pixel reali per pixel-mondo
    const W = Math.ceil(v0.width * ppw), H = Math.ceil(v0.height * ppw); // pixel reali della zona da disegnare
    if (!(v0.width > 0) || !Number.isFinite(ppw) || W < 2 || H < 2) return; // camera non ancora pronta
    const ox = -((((v0.x * ppw) % cwPx) + cwPx) % cwPx), oy = -((((v0.y * ppw) % chPx) + chPx) % chPx);
    this.cols = Math.ceil((W - ox) / cwPx);
    this.rows = Math.ceil((H - oy) / chPx);
    const gx0 = v0.x + ox / ppw, gy0 = v0.y + oy / ppw; // angolo in alto a sinistra della griglia, in pixel-mondo
    const DW = this.cols * 2, DH = this.rows * 4; // griglia dei puntini
    if (this.rt.width < W || this.rt.height < H) {
      // nuova texture invece di resize(): in Phaser una RenderTexture ridimensionata smette di ricevere disegni.
      // Solo se serve più grande (prestazioni: crearla costava fino a 90 ms, e con lo zoom la misura cambiava di continuo);
      // se avanza spazio si mostra solo la parte disegnata (setCrop sotto)
      const nw = Math.max(W, this.rt.width), nh = Math.max(H, this.rt.height);
      this.rt.destroy();
      this.rtHalo.destroy();
      this.rtHalo = this.scene.add.renderTexture(0, 0, nw, nh).setOrigin(0).setDepth(this.depth - 0.001);
      this.rt = this.scene.add.renderTexture(0, 0, nw, nh).setOrigin(0).setDepth(this.depth);
      for (const r of [this.rt, this.rtHalo]) r.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
      this.smooth = false;
    }
    const v = frame.view;
    // mondo → puntini
    const sx = (2 * ppw) / cwPx, sy = (4 * ppw) / chPx;
    const toDot = (x: number, y: number): [number, number] => [(x - gx0) * sx, (y - gy0) * sy];

    // 0. base fissa (terra, terreno, mare a fasce, rilievo sfumato): non cambia mai a parità di zoom, si calcola una volta per
    // una zona ampia attorno alla vista e poi si copia. Prima si rifaceva tutto (≈770.000 puntini) a ogni spostamento: 60–90 ms
    // per ridisegno da lontano, la carta scattava (Nico: "lentissimo")
    const gxi = Math.round(gx0 * sx), gyi = Math.round(gy0 * sy); // primo puntino della vista, in puntini del mondo
    const bkey = `${sx.toFixed(5)}|${sy.toFixed(5)}|${frame.landDots ?? ''}`;
    let B = this.base;
    if (!B || B.key !== bkey || gxi < B.x0 || gyi < B.y0 || gxi + DW > B.x0 + B.w || gyi + DH > B.y0 + B.h) {
      // margine attorno alla vista: spostarsi un po' non la ricalcola (fuori dal mondo è mare, costa poco)
      const mx = Math.ceil(DW * 0.4), my = Math.ceil(DH * 0.4);
      const x0 = gxi - mx, y0 = gyi - my, x1 = gxi + DW + mx, y1 = gyi + DH + my;
      B = this.base = this.buildBase(bkey, x0, y0, x1 - x0, y1 - y0, sx, sy, frame.landDots);
    }

    // 1. territori delle potenze sopra la base: solo le province colorate, riempite a righe (regola del centro del puntino)
    const terr = this.buf('terr', Int16Array, DW * DH, -1);
    const palCss: string[] = [];
    for (const pr of frame.provinces) if (pr.color && !palCss.includes(pr.color)) palCss.push(pr.color);
    const land = this.buf('land', Uint8Array, DW * DH), ter = this.buf('ter', Uint8Array, DW * DH); // terra (1) e terreno della terra libera (1…4)
    const fortAt = this.buf('fort', Uint8Array, DW * DH); // puntini di province col muro
    const bx = gxi - B.x0, by = gyi - B.y0;
    for (let Y = 0; Y < DH; Y++) {
      const src = (by + Y) * B.w + bx;
      land.set(B.land.subarray(src, src + DW), Y * DW);
      ter.set(B.ter.subarray(src, src + DW), Y * DW);
    }
    let tMinY = DH, tMaxY = -1;
    for (const pr of frame.provinces) {
      if (!pr.color) continue;
      const t = palCss.indexOf(pr.color), fort = pr.fort ? 1 : 0, stripe = pr.stripe ?? 0;
      this.raster(pr.id, gx0, gy0, sx, sy, DW, DH, (Y, xa, xb) => {
        if (Y < tMinY) tMinY = Y;
        if (Y > tMaxY) tMaxY = Y;
        const a = Y * DW + xa, b = Y * DW + xb + 1;
        land.fill(1, a, b);
        fortAt.fill(fort, a, b);
        if (!stripe) { terr.fill(t, a, b); return; } // a riempimenti interi: molto più veloce
        for (let X = xa, k = a; X <= xb; X++, k++) {
          if ((stripe === 1 ? X + Y : X - Y + 4096) % 4 >= 2) continue; // a righe in diagonale: terra senza puntino (e senza trama)
          terr[k] = t;
        }
      });
    }

    // fessure fino a 3 puntini dentro un territorio (stesso padrone ai due lati): si chiudono (Nico: macchie chiare col bordo
    // blu dentro le tue province). I buchi di un puntino tra terre qualsiasi li chiude già la base. Solo le righe coi territori
    const G = 3;
    const copy = (k: number, j: number) => { land[k] = 1; ter[k] = ter[j]; terr[k] = terr[j]; fortAt[k] = fortAt[j]; };
    for (let Y = Math.max(0, tMinY - 1); Y <= Math.min(DH - 1, tMaxY + G); Y++) for (let X = 0; X < DW; X++) {
      const k = Y * DW + X;
      if (land[k]) continue;
      if (X > 0 && land[k - 1] && terr[k - 1] >= 0) {
        const t = terr[k - 1];
        let hit = false;
        for (let d = 1; d <= G && X + d < DW; d++) if (land[k + d]) { hit = terr[k + d] === t; break; }
        if (hit) { copy(k, k - 1); continue; }
      }
      if (Y > 0 && land[k - DW] && terr[k - DW] >= 0) {
        const t = terr[k - DW];
        let hit = false;
        for (let d = 1; d <= G && Y + d < DH; d++) if (land[k + d * DW]) { hit = terr[k + d * DW] === t; break; }
        if (hit) copy(k, k - DW);
      }
    }

    // 2. confini puntino per puntino (Bresenham), un colore per puntino
    const border = this.buf('border', Uint32Array, DW * DH); // colore del puntino di confine (0 = niente)
    let bCol = 0, bDash = false, bStep = 0;
    const put = (X: number, Y: number) => { if (X >= 0 && Y >= 0 && X < DW && Y < DH && !(bDash && bStep % 6 >= 3)) border[Y * DW + X] = bCol; };
    for (const b of frame.borders) {
      const pts = b.pts;
      let x0 = (pts[0] - gx0) * sx, y0 = (pts[1] - gy0) * sy;
      bCol = this.rgba(b.color); bDash = !!b.dash; bStep = 0;
      for (let j = 2; j < pts.length; j += 2) {
        const x1 = (pts[j] - gx0) * sx, y1 = (pts[j + 1] - gy0) * sy;
        let ax = Math.floor(x0), ay = Math.floor(y0);
        const bx = Math.floor(x1), by = Math.floor(y1);
        if (ax === bx && ay === by && j < pts.length - 2) continue; // stesso puntino: avanti senza spostare l'inizio
        const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay), stx = ax < bx ? 1 : -1, sty = ay < by ? 1 : -1;
        let err = dx + dy, guard = 0;
        for (;;) {
          put(ax, ay);
          bStep++;
          if ((ax === bx && ay === by) || ++guard > 4000) break;
          const e2 = 2 * err;
          const mx = e2 >= dy, my = e2 <= dx;
          if (mx) { err += dy; ax += stx; }
          if (my) { err += dx; ay += sty; }
          // passo in diagonale: un puntino in più nell'angolo, così la linea resta sempre attaccata (niente puntini staccati)
          if (mx && my) put(ax, ay - sty);
        }
        x0 = x1; y0 = y1;
      }
    }

    // confine dei territori: i puntini del riempimento che toccano qualcos'altro (terra libera, mare, altra potenza).
    // Così la linea sta esattamente sul bordo del colore: niente buchi tra riempimento e confine, niente sbavature fuori.
    const F = frame.front;
    const edgeOf = palCss.map((c) => { const e = frame.edges?.[c]; return e ? this.rgba(e) : 0; });
    const ownT = palCss.map((c) => !!F?.own.includes(c)), warT = palCss.map((c) => !!F?.war.includes(c));
    // riempimento simile al rosso del fronte (Imperium, logistica tagliata): linea bianca, se no il confine spariva (Nico)
    const rgb = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    const nearFront = palCss.map((c) => {
      if (!F || c.length !== 7) return false;
      const a = rgb(c), b = rgb(F.color);
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 80;
    });
    const frontA = F ? this.rgba(F.color) : 0, frontB = this.rgba('#f2f2f2'), fortC = this.rgba(FORT);
    const edgeAt = this.buf('edge', Uint8Array, DW * DH); // puntini del confine di un territorio (non binari né linee nazionali)
    // logistica: tutte le sfumature del tuo territorio sono un territorio solo (niente linee blu tra una e l'altra)
    const one = frame.same?.length ? palCss.findIndex((c) => frame.same!.includes(c)) : -1;
    const grp = palCss.map((c, i) => (one >= 0 && frame.same!.includes(c) ? one : i));
    const grpOf = (n: number) => (n < 0 ? n : grp[n]);
    let tt = 0;
    const over = (n: number) => n >= 0 && n !== tt && (ownT[n] ? !ownT[tt] : !ownT[tt] && n < tt);
    if (frame.edges) for (let y = Math.max(0, tMinY - 1); y <= Math.min(DH - 1, tMaxY + G + 1); y++) for (let x = 0; x < DW; x++) {
      const k = y * DW + x, t0 = terr[k];
      if (t0 < 0 || border[k]) continue;
      const e = edgeOf[t0];
      if (!e) continue;
      const t = grpOf(t0);
      const n0 = x > 0 ? grpOf(terr[k - 1]) : t, n1 = x < DW - 1 ? grpOf(terr[k + 1]) : t, n2 = y > 0 ? grpOf(terr[k - DW]) : t, n3 = y < DH - 1 ? grpOf(terr[k + DW]) : t;
      // anche i vicini in diagonale: il confine fa gli angoli pieni e resta una linea continua di puntini
      const d0 = x > 0 && y > 0 ? grpOf(terr[k - DW - 1]) : t, d1 = x < DW - 1 && y > 0 ? grpOf(terr[k - DW + 1]) : t;
      const d2 = x > 0 && y < DH - 1 ? grpOf(terr[k + DW - 1]) : t, d3 = x < DW - 1 && y < DH - 1 ? grpOf(terr[k + DW + 1]) : t;
      if (n0 === t && n1 === t && n2 === t && n3 === t && d0 === t && d1 === t && d2 === t && d3 === t) continue;
      // due potenze che si toccano: la linea la fa una sola (la tua, se no la prima), l'altra arriva col riempimento fino alla linea.
      // Prima le due linee si appoggiavano una all'altra e sui colori simili non si capiva più dov'era il confine (Nico)
      tt = t;
      if (over(n0) || over(n1) || over(n2) || over(n3) || over(d0) || over(d1) || over(d2) || over(d3)) continue;
      border[k] = e;
      edgeAt[k] = 1;
      // fronte: linea piena rossa sul tuo bordo verso un nemico in guerra (Nico: il tratteggio rosso e bianco sembrava colorato male);
      // bianca se il tuo riempimento è già rosso (logistica tagliata fuori)
      const war = (n: number) => n >= 0 && warT[n]; // anche in diagonale: la linea del fronte è continua, senza puntini blu in mezzo
      if (F && ownT[t] && (war(n0) || war(n1) || war(n2) || war(n3) || war(d0) || war(d1) || war(d2) || war(d3))) border[k] = nearFront[t0] ? frontB : frontA;
    }
    // confine di un puntino, attaccato al territorio. Muro (bunker): dietro il confine una seconda fila bianca.
    const ring = this.buf('ring', Int32Array, DW * DH);
    let nr = 0;
    for (let y = Math.max(0, tMinY - 1); y <= Math.min(DH - 1, tMaxY + G + 1); y++) for (let x = 0; x < DW; x++) {
      const k = y * DW + x, t = terr[k];
      if (t < 0 || border[k] || !fortAt[k]) continue;
      // muro: tocca la prima fila anche solo in diagonale, così la fila bianca è continua
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= DH) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, j = yy * DW + xx;
          if ((dx || dy) && xx >= 0 && xx < DW && edgeAt[j] && terr[j] === t) { hit = true; break; }
        }
      }
      if (hit) ring[nr++] = k;
    }
    // dopo il giro: se no la fila si allargava a tutta la provincia
    for (let i = 0; i < nr; i++) border[ring[i]] = fortC;

    // 3. nomi agganciati alla griglia: prendono il posto dei caratteri (prima i più importanti, niente sovrapposizioni)
    const text = this.buf('text', Uint8Array, this.cols * this.rows);
    const labels = [...frame.labels].sort((a, b) => a.priority - b.priority);
    const draws: { x: number; y: number; text: string; color: string; px: number }[] = [];
    for (const l of labels) {
      const fpx = l.small ? 9 : 11, w = Math.ceil((l.text.length * 0.602 * fpx) / this.cw); // celle occupate (nomi più piccoli, Nico: 12 e 10, poi 11 e 9)
      const [dxp, dyp] = toDot(l.x, l.y);
      const row = Math.floor(dyp / 4), c0 = Math.round(dxp / 2 - w / 2);
      if (row < 0 || row >= this.rows || c0 < 0 || c0 + w > this.cols) continue;
      let free = true;
      for (let c = c0 - 1; c <= c0 + w && free; c++) for (let rr = row - 1; rr <= row + 1; rr++) {
        if (c >= 0 && c < this.cols && rr >= 0 && rr < this.rows && text[rr * this.cols + c]) { free = false; break; }
      }
      if (!free) continue;
      for (let i = 0; i < w; i++) text[row * this.cols + c0 + i] = 1;
      draws.push({ x: ox + c0 * cwPx, y: oy + row * chPx + chPx / 2, text: l.text, color: l.color, px: fpx * dpr });
    }

    // 4. un pixel per puntino: confine > territorio > base (mare a fasce, terra libera sfumata); niente sotto i nomi
    const dots = this.buf('dots', Uint32Array, DW * DH), halos = this.buf('halos', Uint32Array, DW * DH);
    const palInt = palCss.map((c) => this.rgba(c));
    for (let Y = 0; Y < DH; Y++) {
      const src = (by + Y) * B.w + bx;
      dots.set(B.dots.subarray(src, src + DW), Y * DW);
      halos.set(B.halo.subarray(src, src + DW), Y * DW);
    }
    for (let k = 0, n = DW * DH; k < n; k++) {
      const bc = border[k];
      if (bc) dots[k] = bc;
      else if (terr[k] >= 0) dots[k] = palInt[terr[k]]; // territorio di una potenza
    }
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      if (!text[r * this.cols + c]) continue;
      for (let dy = 0; dy < 4; dy++) { const k = (r * 4 + dy) * DW + c * 2; dots[k] = dots[k + 1] = halos[k] = halos[k + 1] = 0; }
    }

    // 5. disegno sulla GPU: immagini ingrandite (un blocco per puntino), poi le trame ritagliano puntini e aloni; poi le lettere
    const upload = (tex: Phaser.Textures.CanvasTexture, buf: Uint32Array) => {
      if (tex.width !== DW || tex.height !== DH) tex.setSize(DW, DH);
      tex.getContext().putImageData(new ImageData(new Uint8ClampedArray(buf.buffer as ArrayBuffer, buf.byteOffset, DW * DH * 4), DW, DH), 0, 0);
      tex.refresh();
      tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    };
    upload(this.dotTex, dots);
    upload(this.haloTex, halos);
    const gx = Math.round(ox), gy = Math.round(oy), step = cwPx / 2;
    for (const img of [this.dotImg, this.haloImg]) img.setSizeToFrame().updateDisplayOrigin().setScale(step, chPx / 4);
    for (const ts of [this.holes, this.rings]) ts.setSize(W, H).setTilePosition(-gx, -gy);
    this.rtHalo.clear().fill(0x000000, 1);
    this.rtHalo.draw(this.haloImg, gx, gy);
    this.rtHalo.draw(this.rings, 0, 0);
    this.rt.clear();
    this.rt.draw(this.dotImg, gx, gy);
    this.rt.erase(this.holes, 0, 0);
    for (const t of this.labelTexts.values()) t.setData('used', false);
    for (const d of draws) {
      const key = `${d.px}|${d.color}|${d.text}`;
      let t = this.labelTexts.get(key);
      if (!t) {
        t = this.scene.add.text(0, 0, d.text, { fontFamily: TERM_FONT, fontSize: `${d.px}px`, color: d.color }).setOrigin(0, 0.5).setVisible(false);
        this.labelTexts.set(key, t);
      }
      t.setData('used', true);
      this.rt.draw(t, Math.round(d.x), Math.round(d.y));
    }
    // nomi che non si vedono da un po': via (la cache non cresce all'infinito)
    if (this.labelTexts.size > 400) for (const [key, t] of this.labelTexts) if (!t.getData('used')) { t.destroy(); this.labelTexts.delete(key); }
    // le immagini coprono esattamente la zona disegnata, un pixel di texture per pixel dello schermo
    for (const r of [this.rtHalo, this.rt]) r.setScale(1 / ppw).setCrop(0, 0, W, H);
    this.origin = { x: v.x, y: v.y };
    this.drawnZoom = ppw;
    this.align();
  }

  /** Carta sui pixel interi dello schermo (a ogni fotogramma): a metà pixel il filtro saltava o doppiava colonne di puntini. */
  align() {
    if (!this.origin) return;
    const c = this.scene.cameras.main, z = c.zoom, ox = c.width * c.originX, oy = c.height * c.originY;
    const bx = Math.floor(c.x + ox + 0.5), by = Math.floor(c.y + oy + 0.5); // come la matrice della camera di Phaser
    // scorrimento come lo vedrà il disegno: Phaser lo riporta dentro i bordi della carta solo dopo (se no, contro il bordo, metà pixel)
    const scx = c.useBounds ? c.clampX(c.scrollX) : c.scrollX, scy = c.useBounds ? c.clampY(c.scrollY) : c.scrollY;
    const x = (Math.round(bx + z * (this.origin.x - scx - ox)) - bx) / z + scx + ox;
    const y = (Math.round(by + z * (this.origin.y - scy - oy)) - by) / z + scy + oy;
    for (const r of [this.rtHalo, this.rt]) r.setPosition(x, y);
    // durante lo zoom la carta già disegnata si ingrandisce finché non si ridisegna: lì sfumata (a puntini netti tremolava a
    // righe), a scala giusta di nuovo netta
    const smooth = Math.abs(z - this.drawnZoom) > 1e-6;
    if (smooth !== this.smooth) {
      this.smooth = smooth;
      const f = smooth ? Phaser.Textures.FilterMode.LINEAR : Phaser.Textures.FilterMode.NEAREST;
      for (const r of [this.rtHalo, this.rt]) r.texture.setFilter(f);
    }
  }

  /** Barra in basso come MapSCII, ferma sullo schermo: si ridisegna solo se cambia il testo. */
  status(text: string, view: Phaser.Geom.Rectangle) {
    const dpr = this.dpr, cwPx = this.cw * dpr, ppw = this.scene.cameras.main.zoom;
    if (text !== this.statusText) {
      this.statusText = text;
      const ctx = this.statusTex.getContext();
      ctx.font = `${FONT_PT * dpr}px ${TERM_FONT}`;
      const w = Math.ceil(ctx.measureText(text).width + cwPx), h = Math.ceil(STATUS_H * dpr);
      if (this.statusTex.width !== w || this.statusTex.height !== h) this.statusTex.setSize(w, h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);
      ctx.font = `${FONT_PT * dpr}px ${TERM_FONT}`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = TERM.status;
      ctx.fillText(text, 0, h / 2);
      this.statusTex.refresh();
      this.statusImg.setSizeToFrame().updateDisplayOrigin(); // misure e origine dell'immagine al nuovo formato della texture
    }
    this.statusImg.setPosition(view.x, view.bottom).setDisplaySize(this.statusTex.width / ppw, this.statusTex.height / ppw);
  }

  destroy() {
    this.rt.destroy();
    this.rtHalo.destroy();
    for (const o of [this.dotImg, this.haloImg, this.holes, this.rings]) o.destroy();
    for (const t of this.labelTexts.values()) t.destroy();
    this.statusImg.destroy();
  }
}
