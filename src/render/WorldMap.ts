// Carta a puntini come OpenFront (Nico: "disegna le mappe per le varie dimensioni e zoomi quelle, senza riscrivere tutto"):
// il mondo intero è disegnato una volta sola in immagini fisse a tre densità di puntini (da lontano, medio, vicino). Spostarsi
// e zoomare le muove e le ingrandisce e basta (lo fa la scheda grafica). Sopra c'è uno strato dei territori delle potenze,
// che si ridisegna solo nelle province che cambiano. Le immagini sono divise in riquadri: si aggiorna solo il riquadro toccato.
//
// Base: terra libera nei toni del rilievo (sfumati e sgranati), mare in tre colori dai fondali veri (Natural Earth:
// piattaforma < 200 m, scarpata, oceano > 3000 m) sfumati allo stesso modo, e da vicino le linee tenui tra province.
import Phaser from 'phaser';
import type { MapShapes } from '../map/provinceShapes';
import { WORLD_H, WORLD_W } from '../map/hexGrid';
import { BATHY } from '../data/bathy';
import { TERM_FONT, type TermFrame } from './TerminalMap';
import { UI } from '../ui/screen';

// densità dei puntini (per pixel-mondo) e da che zoom (punti CSS per pixel-mondo) si usa ognuna: il passo sullo schermo
// resta tra ~2 e ~5 punti, poi da vicino i puntini crescono
const LEVELS = [
  { d: 0.375, upTo: 1.9 },
  { d: 0.75, upTo: 3.75 },
  { d: 1.45, upTo: 7 },
  // da vicino (Nico: "i bordi da vicino sono scrausi"): puntini fitti, preparati a riquadri solo dove si guarda
  { d: 3.0, upTo: Infinity, sparse: true },
];
const SPARSE_MAX = 96; // riquadri tenuti in memoria nel livello da vicino (i più lontani si buttano)
const TILE = 512;

const ELEV = [0, 1.15, 2.4, 0.55]; // pianura, colline, montagne, deserto
const LAND_SHADES = ['#1b2331', '#1f283a', '#253046', '#2c3953', '#354463', '#405176', '#4d6089'];
// mare (Nico: "tre colori, contrasto decente, profondità reale, sfumato come il terreno")
const SEA_SHADES = ['#d0d8e1', '#b5c0cc', '#9aa7b7'];
const PROV_LINE = '#3a4352'; // linee tenui tra province della terra libera (solo da vicino)
const FORT = '#f2f2f2';
const GAP = 0x05070a; // tra un puntino e l'altro

interface Level {
  sparse: boolean; // riquadri preparati solo dove si guarda
  built: Set<number>;
  d: number; W: number; H: number; tx: number; ty: number;
  prov: Int16Array; // provincia di ogni puntino (−1 mare)
  ready: boolean;
  base: Phaser.GameObjects.Image[];
  ovl: Phaser.GameObjects.Image[];
  ovlTex: Phaser.Textures.CanvasTexture[];
  ovlBuf: Uint32Array[]; // un buffer per riquadro (TILE × TILE)
  dirtyTiles: Set<number>;
  dirtyProv: Set<number>; // province da ridisegnare
  paintTiles: Set<number>; // riquadri interi da ridisegnare
  full: boolean; // tutto lo strato dei territori da rifare
  gaps: Phaser.GameObjects.TileSprite;
}

export class WorldMap {
  private levels: Level[] = [];
  private cur = -1;
  private colInt = new Map<string, number>();
  private building: Generator<void, void> | null = null;
  private tileJob: Generator<void, void> | null = null; // riquadro del livello da vicino in preparazione
  private tileQueue: number[] = [];
  private shapeBox: Float32Array | null = null;
  private terrain: ArrayLike<number> = [];
  // stato dei territori (dall'ultimo frame)
  private pal: string[] = [];
  private palIdx = new Map<string, number>();
  private provCol = new Int16Array(0); // indice nella tavolozza (−1 = terra libera)
  private provFort = new Uint8Array(0);
  private provStripe = new Uint8Array(0);
  private cfgKey = '';
  private grp: number[] = [];
  private edgeOf: number[] = [];
  private ownT: boolean[] = [];
  private warT: boolean[] = [];
  private nearFront: boolean[] = [];
  private fillInt: number[] = [];
  private frontA = 0;
  private frontB = 0;
  private ownLines = false;
  private ownLine = 0;
  private rails: { pts: ArrayLike<number>; color: string; dash?: boolean }[] = [];
  private labels: Phaser.GameObjects.Text[] = [];
  private labelKey = '';
  private labelZoom = -1;
  private labelData: TermFrame['labels'] = [];
  private labelCache = new Map<string, Phaser.GameObjects.Text>();

  constructor(private scene: Phaser.Scene, private shapes: MapShapes, private depth: number) {
    const tm = scene.textures;
    // trama dei puntini: 3 × 3 texel, puntino 2 × 2 in alto a sinistra, il resto fessura scura (un po' trasparente: sul mare
    // resta un alone del suo colore, come prima)
    if (tm.exists('wm-gap')) tm.remove('wm-gap');
    {
      const c = tm.createCanvas('wm-gap', 3, 3)!, ctx = c.getContext();
      ctx.fillStyle = `rgba(${(GAP >> 16) & 255},${(GAP >> 8) & 255},${GAP & 255},0.86)`;
      ctx.fillRect(0, 0, 3, 3);
      ctx.clearRect(0, 0, 2, 2);
      c.refresh();
      c.setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
  }

  /** Terreno di ogni provincia (0 pianura, 1 colline, 2 montagne, 3 deserto). Prepara i livelli: il primo subito. */
  setTerrain(t: ArrayLike<number>) {
    this.terrain = t;
    const n = this.shapes.provinces.length;
    this.provCol = new Int16Array(n).fill(-1);
    this.provFort = new Uint8Array(n);
    this.provStripe = new Uint8Array(n);
    for (const L of this.levels) this.destroyLevel(L);
    this.levels = LEVELS.map((s) => this.makeLevel(s.d, !!(s as { sparse?: boolean }).sparse));
    // il livello da lontano subito (piccolo), gli altri a pezzi durante il gioco
    const g = this.buildLevel(this.levels[0]);
    while (!g.next().done) { /* tutto ora */ }
    this.building = this.buildAll();
  }

  private makeLevel(d: number, sparse = false): Level {
    const W = Math.ceil(WORLD_W * d), H = Math.ceil(WORLD_H * d);
    const tx = Math.ceil(W / TILE), ty = Math.ceil(H / TILE);
    const gaps = this.scene.add.tileSprite(0, 0, WORLD_W, WORLD_H, 'wm-gap').setOrigin(0).setDepth(this.depth + 0.02).setVisible(false);
    gaps.setTileScale(1 / (3 * d), 1 / (3 * d)); // un motivo (3 texel) = un puntino
    return { sparse, built: new Set(), d, W, H, tx, ty, prov: new Int16Array(W * H).fill(-1), ready: sparse, base: [], ovl: [], ovlTex: [], ovlBuf: [], dirtyTiles: new Set(), dirtyProv: new Set(), paintTiles: new Set(), full: true, gaps };
  }

  private destroyLevel(L: Level) {
    for (const o of [...L.base, ...L.ovl]) { if (!o) continue; const k = o.texture.key; o.destroy(); if (this.scene.textures.exists(k)) this.scene.textures.remove(k); }
    L.gaps.destroy();
  }

  private *buildAll(): Generator<void, void> {
    for (let i = 1; i < this.levels.length; i++) if (!this.levels[i].sparse) yield* this.buildLevel(this.levels[i]);
  }

  /** Avanza la preparazione dei livelli per al più `budgetMs` (a ogni fotogramma). */
  work(budgetMs: number) {
    const t0 = performance.now();
    while (this.building) {
      if (this.building.next().done) this.building = null;
      if (performance.now() - t0 >= budgetMs) return;
    }
    // livello da vicino: i riquadri che si guardano, uno alla volta, a pezzi
    const S = this.levels.find((l) => l.sparse);
    while (S && (this.tileJob || this.tileQueue.length)) {
      if (!this.tileJob) {
        const ti = this.tileQueue.shift()!;
        if (S.built.has(ti)) continue;
        this.tileJob = this.buildTile(S, ti);
      }
      if (this.tileJob.next().done) this.tileJob = null;
      if (performance.now() - t0 >= budgetMs) return;
    }
    // territori: prima il livello in uso, poi gli altri (così cambiando zoom sono già pronti)
    const order = [this.cur, ...this.levels.map((_, i) => i).filter((i) => i !== this.cur)];
    for (const i of order) {
      const L = this.levels[i], left = budgetMs - (performance.now() - t0);
      if (!L?.ready || left <= 0.5) continue;
      this.flushOverlay(L, i === this.cur ? Math.max(2, left) : left);
    }
  }

  private rgba(color: string): number {
    let v = this.colInt.get(color);
    if (v === undefined) {
      const n = Phaser.Display.Color.HexStringToColor(color);
      v = ((255 << 24) | (n.blue << 16) | (n.green << 8) | n.red) >>> 0;
      this.colInt.set(color, v);
    }
    return v;
  }

  /** Riempie a righe la sagoma della provincia (regola del centro del puntino), in puntini del livello. */
  private raster(id: number, d: number, W: number, H: number, span: (Y: number, xa: number, xb: number) => void, yMin = 0, yMax = H - 1) {
    const sh = this.shapes.provinces[id];
    if (!sh?.parts.length) return;
    const ya = Math.max(yMin, Math.ceil(sh.y0 * d - 0.5)), yb = Math.min(yMax, Math.floor(sh.y1 * d - 0.5));
    if (yb < ya) return;
    const rows: number[][] = [];
    for (let Y = ya; Y <= yb; Y++) rows.push([]);
    for (const part of sh.parts) {
      const r = part.outer, n = r.length;
      for (let j = 0; j < n; j += 2) {
        const k = j + 2 < n ? j + 2 : 0, y1 = r[j + 1], y2 = r[k + 1];
        if (y1 === y2) continue;
        const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
        const Y0 = Math.max(ya, Math.ceil(lo * d - 0.5)), Y1 = Math.min(yb, Math.ceil(hi * d - 0.5) - 1);
        if (Y1 < Y0) continue;
        const x1 = r[j], dxdy = (r[k] - x1) / (y2 - y1);
        for (let Y = Y0; Y <= Y1; Y++) rows[Y - ya].push(x1 + ((Y + 0.5) / d - y1) * dxdy);
      }
    }
    for (let Y = ya; Y <= yb; Y++) {
      const xs = rows[Y - ya];
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const xa = Math.max(0, Math.ceil(xs[i] * d - 0.5)), xb = Math.min(W - 1, Math.ceil(xs[i + 1] * d - 0.5) - 1);
        if (xb >= xa) span(Y, xa, xb);
      }
    }
  }

  /** Base del livello: province, rilievo, fondali; poi i riquadri (immagini) e lo strato dei territori vuoto. */
  private *buildLevel(L: Level): Generator<void, void> {
    const { d, W, H } = L, n = W * H, prov = L.prov;
    const P = this.shapes.provinces;
    for (let id = 0; id < P.length; id++) {
      if (id % 1000 === 999) yield;
      this.raster(id, d, W, H, (Y, xa, xb) => prov.fill(id, Y * W + xa, Y * W + xb + 1));
    }
    // buchi di un puntino tra due province (gli incroci dei lati condivisi non coincidono al centesimo)
    for (let Y = 0; Y < H; Y++) {
      if (Y % 400 === 399) yield;
      for (let X = 1; X < W - 1; X++) {
        const k = Y * W + X;
        if (prov[k] >= 0) continue;
        if (prov[k - 1] >= 0 && prov[k + 1] >= 0) prov[k] = prov[k - 1];
        else if (Y > 0 && Y < H - 1 && prov[k - W] >= 0 && prov[k + W] >= 0) prov[k] = prov[k - W];
      }
    }
    yield;
    // rilievo della terra e profondità del mare, sfumati con una media mobile (separabile) come prima
    const val = new Float32Array(n), wt = new Float32Array(n), tmp = new Float32Array(n);
    const bw = BATHY.w, bh = BATHY.h, bcls = decodeBathy();
    for (let Y = 0, k = 0; Y < H; Y++) {
      const by = Math.min(bh - 1, Math.floor(((Y + 0.5) / d / WORLD_H) * bh));
      for (let X = 0; X < W; X++, k++) {
        const p = prov[k];
        if (p >= 0) { val[k] = ELEV[Math.min(3, Math.max(0, this.terrain[p] ?? 0))]; wt[k] = 1; }
        else val[k] = bcls[by * bw + Math.min(bw - 1, Math.floor(((X + 0.5) / d / WORLD_W) * bw))];
      }
    }
    yield;
    const rad = Math.max(1, Math.round(6 * d)); // ~6 pixel-mondo
    const sea = new Float32Array(n);
    for (let k = 0; k < n; k++) sea[k] = 1 - wt[k];
    // terra: media dei soli puntini di terra; mare: dei soli puntini di mare (le coste restano nette)
    const landV = new Float32Array(n), seaV = new Float32Array(n);
    for (let k = 0; k < n; k++) { landV[k] = val[k] * wt[k]; seaV[k] = val[k] * sea[k]; }
    for (const a of [landV, wt, seaV, sea]) { yield* blur(a, tmp, W, H, rad, true); yield* blur(tmp, a, W, H, rad, false); }
    const landInt = LAND_SHADES.map((c) => this.rgba(c)), seaInt = SEA_SHADES.map((c) => this.rgba(c));
    const lineInt = this.rgba(PROV_LINE), lines = d >= 1.4; // linee tra province solo da vicino
    // riquadri della base
    const tm = this.scene.textures;
    for (let ty = 0; ty < L.ty; ty++) for (let tx = 0; tx < L.tx; tx++) {
      yield;
      const x0 = tx * TILE, y0 = ty * TILE, w = Math.min(TILE, W - x0), h = Math.min(TILE, H - y0);
      const buf = new Uint32Array(w * h);
      for (let y = 0; y < h; y++) {
        const Y = y0 + y;
        for (let x = 0; x < w; x++) {
          const X = x0 + x, k = Y * W + X, p = prov[k];
          // grana fissa al mondo (non sfarfalla), come prima
          let hh = (X * 374761393 + Y * 668265263) | 0;
          hh = Math.imul(hh ^ (hh >>> 13), 1274126177);
          const noise = (((hh ^ (hh >>> 16)) & 1023) / 1023 - 0.5) * 0.6;
          if (p >= 0) {
            if (lines && ((X + 1 < W && prov[k + 1] >= 0 && prov[k + 1] !== p) || (Y + 1 < H && prov[k + W] >= 0 && prov[k + W] !== p))) { buf[y * w + x] = lineInt; continue; }
            const e = (wt[k] > 0 ? landV[k] / wt[k] : 0) / 2.4 * (LAND_SHADES.length - 1) + noise;
            buf[y * w + x] = landInt[Math.max(0, Math.min(LAND_SHADES.length - 1, Math.round(e)))];
          } else {
            const e = (sea[k] > 0 ? seaV[k] / sea[k] : 2) + noise * 1.4;
            buf[y * w + x] = seaInt[Math.max(0, Math.min(2, Math.round(e)))];
          }
        }
      }
      const key = `wm-b${d}-${tx}-${ty}`, okey = `wm-o${d}-${tx}-${ty}`;
      for (const k of [key, okey]) if (tm.exists(k)) tm.remove(k);
      const ct = tm.createCanvas(key, w, h)!;
      ct.getContext().putImageData(new ImageData(new Uint8ClampedArray(buf.buffer as ArrayBuffer), w, h), 0, 0);
      ct.refresh();
      ct.setFilter(Phaser.Textures.FilterMode.NEAREST);
      L.base.push(this.scene.add.image(x0 / d, y0 / d, key).setOrigin(0).setScale(1 / d).setDepth(this.depth).setVisible(false));
      const ot = tm.createCanvas(okey, w, h)!;
      ot.setFilter(Phaser.Textures.FilterMode.NEAREST);
      L.ovlTex.push(ot);
      L.ovlBuf.push(new Uint32Array(w * h));
      L.ovl.push(this.scene.add.image(x0 / d, y0 / d, okey).setOrigin(0).setScale(1 / d).setDepth(this.depth + 0.01).setVisible(false));
    }
    L.ready = true;
    L.full = true;
  }

  /**
   * Un riquadro del livello da vicino: province, rilievo e fondali della sua zona (con un margine per la media), immagine
   * della base e strato dei territori. Come il resto della carta, ma solo dove si guarda.
   */
  private *buildTile(L: Level, ti: number): Generator<void, void> {
    const { d, W, H, prov } = L, tx = ti % L.tx, ty = Math.floor(ti / L.tx);
    const rad = Math.max(1, Math.round(6 * d)), M = rad + 6;
    const x0 = tx * TILE, y0 = ty * TILE, w = Math.min(TILE, W - x0), h = Math.min(TILE, H - y0);
    const rx0 = Math.max(0, x0 - M), ry0 = Math.max(0, y0 - M), rx1 = Math.min(W, x0 + w + M), ry1 = Math.min(H, y0 + h + M);
    const rw = rx1 - rx0, rh = ry1 - ry0, n = rw * rh;
    // province della zona (righe e colonne ritagliate)
    const P = this.shapes.provinces;
    if (!this.shapeBox) {
      this.shapeBox = new Float32Array(P.length * 4);
      P.forEach((sh, i) => this.shapeBox!.set(sh?.parts.length ? [sh.x0, sh.y0, sh.x1, sh.y1] : [1e9, 1e9, -1e9, -1e9], i * 4));
    }
    const B = this.shapeBox, wx0 = rx0 / d, wy0 = ry0 / d, wx1 = rx1 / d, wy1 = ry1 / d;
    for (let Y = ry0; Y < ry1; Y++) prov.fill(-1, Y * W + rx0, Y * W + rx1);
    for (let id = 0; id < P.length; id++) {
      if (B[id * 4 + 2] < wx0 || B[id * 4] > wx1 || B[id * 4 + 3] < wy0 || B[id * 4 + 1] > wy1) continue;
      this.raster(id, d, W, H, (Y, xa, xb) => {
        const a = Math.max(xa, rx0), b = Math.min(xb, rx1 - 1);
        if (b >= a) prov.fill(id, Y * W + a, Y * W + b + 1);
      }, ry0, ry1 - 1);
    }
    for (let Y = ry0; Y < ry1; Y++) for (let X = Math.max(1, rx0); X < Math.min(W - 1, rx1); X++) {
      const k = Y * W + X;
      if (prov[k] >= 0) continue;
      if (prov[k - 1] >= 0 && prov[k + 1] >= 0) prov[k] = prov[k - 1];
      else if (Y > 0 && Y < H - 1 && prov[k - W] >= 0 && prov[k + W] >= 0) prov[k] = prov[k - W];
    }
    yield;
    // rilievo e fondali della zona, sfumati
    const landV = new Float32Array(n), wt = new Float32Array(n), seaV = new Float32Array(n), sea = new Float32Array(n), tmp = new Float32Array(n);
    const bw = BATHY.w, bh = BATHY.h, bcls = decodeBathy();
    for (let y = 0, k = 0; y < rh; y++) {
      const Y = ry0 + y, by = Math.min(bh - 1, Math.floor(((Y + 0.5) / d / WORLD_H) * bh));
      for (let x = 0; x < rw; x++, k++) {
        const X = rx0 + x, p = prov[Y * W + X];
        if (p >= 0) { landV[k] = ELEV[Math.min(3, Math.max(0, this.terrain[p] ?? 0))]; wt[k] = 1; }
        else { seaV[k] = bcls[by * bw + Math.min(bw - 1, Math.floor(((X + 0.5) / d / WORLD_W) * bw))]; sea[k] = 1; }
      }
    }
    for (const a of [landV, wt, seaV, sea]) { yield* blur(a, tmp, rw, rh, rad, true); yield* blur(tmp, a, rw, rh, rad, false); }
    const landInt = LAND_SHADES.map((c) => this.rgba(c)), seaInt = SEA_SHADES.map((c) => this.rgba(c)), lineInt = this.rgba(PROV_LINE);
    const buf = new Uint32Array(w * h);
    for (let y = 0; y < h; y++) {
      const Y = y0 + y;
      for (let x = 0; x < w; x++) {
        const X = x0 + x, k = Y * W + X, p = prov[k], lk = (Y - ry0) * rw + (X - rx0);
        let hh = (X * 374761393 + Y * 668265263) | 0;
        hh = Math.imul(hh ^ (hh >>> 13), 1274126177);
        const noise = (((hh ^ (hh >>> 16)) & 1023) / 1023 - 0.5) * 0.6;
        if (p >= 0) {
          if ((X + 1 < W && prov[k + 1] >= 0 && prov[k + 1] !== p) || (Y + 1 < H && prov[k + W] >= 0 && prov[k + W] !== p)) { buf[y * w + x] = lineInt; continue; }
          const e = (wt[lk] > 0 ? landV[lk] / wt[lk] : 0) / 2.4 * (LAND_SHADES.length - 1) + noise;
          buf[y * w + x] = landInt[Math.max(0, Math.min(LAND_SHADES.length - 1, Math.round(e)))];
        } else {
          const e = (sea[lk] > 0 ? seaV[lk] / sea[lk] : 2) + noise * 1.4;
          buf[y * w + x] = seaInt[Math.max(0, Math.min(2, Math.round(e)))];
        }
      }
    }
    yield;
    const tm = this.scene.textures, key = `wm-b${d}-${tx}-${ty}`, okey = `wm-o${d}-${tx}-${ty}`;
    for (const k of [key, okey]) if (tm.exists(k)) tm.remove(k);
    const ct = tm.createCanvas(key, w, h)!;
    ct.getContext().putImageData(new ImageData(new Uint8ClampedArray(buf.buffer as ArrayBuffer), w, h), 0, 0);
    ct.refresh();
    ct.setFilter(Phaser.Textures.FilterMode.NEAREST);
    const vis = this.levels[this.cur] === L;
    L.base[ti] = this.scene.add.image(x0 / d, y0 / d, key).setOrigin(0).setScale(1 / d).setDepth(this.depth + 0.012).setVisible(vis);
    const ot = tm.createCanvas(okey, w, h)!;
    ot.setFilter(Phaser.Textures.FilterMode.NEAREST);
    L.ovlTex[ti] = ot;
    L.ovlBuf[ti] = new Uint32Array(w * h);
    L.ovl[ti] = this.scene.add.image(x0 / d, y0 / d, okey).setOrigin(0).setScale(1 / d).setDepth(this.depth + 0.014).setVisible(vis);
    L.built.add(ti);
    // territori del riquadro, e i bordi dei riquadri accanto già pronti (i confini a cavallo cambiano)
    this.paintRect(L, x0 - 4, y0 - 4, x0 + w + 4, y0 + h + 4);
    this.flushTiles(L);
    this.evict(L);
  }

  /** Livello da vicino: troppi riquadri in memoria → via i più lontani dalla vista. */
  private evict(L: Level) {
    if (L.built.size <= SPARSE_MAX) return;
    const cam = this.scene.cameras.main, cx = cam.midPoint.x * L.d / TILE, cy = cam.midPoint.y * L.d / TILE;
    const far = [...L.built].sort((a, b) => Math.hypot((b % L.tx) - cx, Math.floor(b / L.tx) - cy) - Math.hypot((a % L.tx) - cx, Math.floor(a / L.tx) - cy));
    for (const ti of far.slice(0, L.built.size - SPARSE_MAX)) {
      for (const o of [L.base[ti], L.ovl[ti]]) { const k = o.texture.key; o.destroy(); if (this.scene.textures.exists(k)) this.scene.textures.remove(k); }
      delete L.base[ti]; delete L.ovl[ti]; delete L.ovlTex[ti]; delete L.ovlBuf[ti];
      L.built.delete(ti);
    }
  }

  /** Carica sulla scheda grafica i riquadri dei territori toccati. */
  private flushTiles(L: Level) {
    for (const t of L.dirtyTiles) {
      const tex = L.ovlTex[t], buf = L.ovlBuf[t];
      if (!tex || !buf) continue;
      tex.getContext().putImageData(new ImageData(new Uint8ClampedArray(buf.buffer as ArrayBuffer), tex.width, tex.height), 0, 0);
      tex.refresh();
    }
    L.dirtyTiles.clear();
  }

  /**
   * Territori dal frame (tutte le province: colore o null, muro, righe della vista terreno, confini e fronte). Si
   * ridisegnano solo le province cambiate; se cambia la regola dei confini (guerre, logistica, COSTRUISCI) tutto lo strato.
   */
  render(frame: TermFrame): boolean {
    // regole dei confini
    const F = frame.front;
    const cfg = JSON.stringify([frame.edges ?? null, F ?? null, frame.same ?? null, frame.ownLines ?? false, frame.borders.map((b) => [b.color, b.dash, Array.from(b.pts)])]);
    for (const pr of frame.provinces) if (pr.color && !this.palIdx.has(pr.color)) { this.palIdx.set(pr.color, this.pal.length); this.pal.push(pr.color); }
    if (cfg !== this.cfgKey) {
      this.cfgKey = cfg;
      const pal = this.pal;
      this.fillInt = pal.map((c) => this.rgba(c));
      this.edgeOf = pal.map((c) => { const e = frame.edges?.[c]; return e ? this.rgba(e) : 0; });
      this.ownT = pal.map((c) => !!F?.own.includes(c));
      this.warT = pal.map((c) => !!F?.war.includes(c));
      const rgb = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
      this.nearFront = pal.map((c) => { if (!F || c.length !== 7) return false; const a = rgb(c), b = rgb(F.color); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 80; });
      this.frontA = F ? this.rgba(F.color) : 0;
      this.frontB = this.rgba('#f2f2f2');
      const one = frame.same?.length ? pal.findIndex((c) => frame.same!.includes(c)) : -1;
      this.grp = pal.map((c, i) => (one >= 0 && frame.same!.includes(c) ? one : i));
      this.ownLines = !!frame.ownLines;
      this.ownLine = this.rgba('#1d5a66');
      this.rails = frame.borders.filter((b) => b.dash);
      for (const L of this.levels) L.full = true;
    } else if (this.fillInt.length < this.pal.length) {
      // colori nuovi (stesse regole): solo gli indici in più
      for (let i = this.fillInt.length; i < this.pal.length; i++) {
        const c = this.pal[i];
        this.fillInt.push(this.rgba(c)); this.edgeOf.push(frame.edges?.[c] ? this.rgba(frame.edges[c]) : 0);
        this.ownT.push(!!F?.own.includes(c)); this.warT.push(!!F?.war.includes(c)); this.nearFront.push(false); this.grp.push(i);
      }
    }
    // province cambiate
    for (const pr of frame.provinces) {
      const c = pr.color ? this.palIdx.get(pr.color)! : -1, f = pr.fort ? 1 : 0, s = pr.stripe ?? 0, p = pr.id;
      if (this.provCol[p] === c && this.provFort[p] === f && this.provStripe[p] === s) continue;
      this.provCol[p] = c; this.provFort[p] = f; this.provStripe[p] = s;
      for (const L of this.levels) L.dirtyProv.add(p);
    }
    this.labelData = frame.labels;
    return true;
  }

  /**
   * Ridisegna nello strato dei territori le province segnate (e i loro dintorni: i confini cambiano anche ai vicini) e i
   * riquadri da rifare, entro `budgetMs`; il resto al prossimo fotogramma.
   */
  private flushOverlay(L: Level, budgetMs: number) {
    const t0 = performance.now();
    if (L.full) {
      // tutto da rifare (regole cambiate o livello appena pronto): riquadro per riquadro
      L.full = false;
      L.dirtyProv.clear();
      for (let i = 0; i < L.tx * L.ty; i++) if (L.ovlBuf[i]) L.paintTiles.add(i);
    }
    for (const p of L.dirtyProv) {
      if (performance.now() - t0 > budgetMs) break;
      L.dirtyProv.delete(p);
      const sh = this.shapes.provinces[p];
      if (!sh?.parts.length) continue;
      // da vicino: solo se tocca un riquadro già pronto
      if (L.sparse) {
        const ta = Math.floor((sh.x0 * L.d - 4) / TILE), tb = Math.floor((sh.x1 * L.d + 4) / TILE), tc = Math.floor((sh.y0 * L.d - 4) / TILE), td = Math.floor((sh.y1 * L.d + 4) / TILE);
        let any = false;
        for (let ty = tc; ty <= td && !any; ty++) for (let tx = ta; tx <= tb; tx++) if (L.built.has(ty * L.tx + tx)) { any = true; break; }
        if (!any) continue;
      }
      this.paintRect(L, Math.floor(sh.x0 * L.d) - 3, Math.floor(sh.y0 * L.d) - 3, Math.ceil(sh.x1 * L.d) + 3, Math.ceil(sh.y1 * L.d) + 3);
    }
    for (const t of L.paintTiles) {
      if (performance.now() - t0 > budgetMs) break;
      L.paintTiles.delete(t);
      const tx = t % L.tx, ty = Math.floor(t / L.tx);
      this.paintRect(L, tx * TILE, ty * TILE, (tx + 1) * TILE, (ty + 1) * TILE);
    }
    this.flushTiles(L); // carica sulla scheda grafica solo i riquadri toccati
  }

  /** Colore dei territori nei puntini del rettangolo [x0, x1) × [y0, y1) del livello. */
  private paintRect(L: Level, x0: number, y0: number, x1: number, y1: number) {
    const { W, H, prov } = L;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(H, y1);
    if (x1 <= x0 || y1 <= y0) return;
    const col = this.provCol, grp = this.grp, stripe = this.provStripe;
    // gruppo del puntino (−1 terra libera o mare); fessure di 1–3 puntini di mare dentro lo stesso territorio: territorio
    const g = (X: number, Y: number): number => {
      if (X < 0 || Y < 0 || X >= W || Y >= H) return -1;
      const p = prov[Y * W + X];
      if (p >= 0) { const c = col[p]; return c < 0 ? -1 : grp[c]; }
      return -2; // mare
    };
    const own = this.ownT, war = this.warT;
    const edgeAt = (X: number, Y: number, t: number): number => {
      // 0 = interno, 1 = confine, 2 = confine sul fronte
      let edge = false, front = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const n = g(X + dx, Y + dy);
        if (n === t) continue;
        // due potenze che si toccano: la linea la fa una sola (la tua, se no la prima)
        if (n >= 0 && (own[n] ? !own[t] : !own[t] && n < t)) continue;
        edge = true;
        if (n >= 0 && war[n]) front = true;
      }
      return !edge ? 0 : front && own[t] ? 2 : 1;
    };
    for (let Y = y0; Y < y1; Y++) for (let X = x0; X < x1; X++) {
      const k = Y * W + X, p = prov[k];
      let out = 0;
      let t = p >= 0 && col[p] >= 0 ? grp[col[p]] : -1;
      if (p < 0) {
        // fessura di mare tra due puntini dello stesso territorio (fino a 3): riempita
        for (const [ax, ay] of [[1, 0], [0, 1]]) {
          let a = -1, b = -1;
          for (let s = 1; s <= 3 && a === -1; s++) { const v = g(X - ax * s, Y - ay * s); if (v !== -2) a = v; }
          for (let s = 1; s <= 3 && b === -1; s++) { const v = g(X + ax * s, Y + ay * s); if (v !== -2) b = v; }
          if (a >= 0 && a === b) { t = a; break; }
        }
        if (t >= 0) out = this.fillInt[t];
      } else if (t >= 0) {
        const c = col[p], s = stripe[p];
        if (s && (s === 1 ? X + Y : X - Y + 4096) % 4 >= 2) out = 0; // vista terreno: a righe
        else {
          const e = this.edgeOf[c] ? edgeAt(X, Y, t) : 0;
          if (e === 2) out = this.nearFront[c] ? this.frontB : this.frontA;
          else if (e === 1) out = this.edgeOf[c];
          else {
            out = this.fillInt[c];
            // muro: seconda fila bianca dietro il confine
            if (this.provFort[p] && this.edgeOf[c]) {
              let near = false;
              for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
                if ((dx || dy) && g(X + dx, Y + dy) === t && edgeAt(X + dx, Y + dy, t)) { near = true; break; }
              }
              if (near) out = this.rgba(FORT);
            }
            // COSTRUISCI: le tue province una per una
            if (this.ownLines && own[t] && ((X + 1 < W && prov[k + 1] !== p && prov[k + 1] >= 0 && g(X + 1, Y) === t) || (Y + 1 < H && prov[k + W] !== p && prov[k + W] >= 0 && g(X, Y + 1) === t))) out = this.ownLine;
          }
        }
      }
      const tx = Math.floor(X / TILE), ty = Math.floor(Y / TILE), ti = ty * L.tx + tx, ob = L.ovlBuf[ti];
      if (ob) ob[(Y - ty * TILE) * L.ovlTex[ti].width + (X - tx * TILE)] = out;
    }
    // binari (ferrovie): tratteggio sopra
    for (const r of this.rails) this.line(L, r.pts, this.rgba(r.color), x0, y0, x1, y1);
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y1 - 1) / TILE); ty++) for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x1 - 1) / TILE); tx++) if (L.ovlBuf[ty * L.tx + tx]) L.dirtyTiles.add(ty * L.tx + tx);
  }

  private line(L: Level, pts: ArrayLike<number>, c: number, rx0: number, ry0: number, rx1: number, ry1: number) {
    let step = 0;
    for (let j = 2; j < pts.length; j += 2) {
      let ax = Math.floor(pts[j - 2] * L.d), ay = Math.floor(pts[j - 1] * L.d);
      const bx = Math.floor(pts[j] * L.d), by = Math.floor(pts[j + 1] * L.d);
      const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay), sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
      let err = dx + dy;
      for (let guard = 0; guard < 4000; guard++) {
        if (step++ % 6 < 3 && ax >= rx0 && ay >= ry0 && ax < rx1 && ay < ry1) {
          const tx = Math.floor(ax / TILE), ty = Math.floor(ay / TILE), ti = ty * L.tx + tx;
          if (L.ovlBuf[ti]) L.ovlBuf[ti][(ay - ty * TILE) * L.ovlTex[ti].width + (ax - tx * TILE)] = c;
        }
        if (ax === bx && ay === by) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; ax += sx; }
        if (e2 <= dx) { err += dx; ay += sy; }
      }
    }
  }

  /** A ogni fotogramma: livello giusto per lo zoom, nomi a misura costante sullo schermo. */
  align() {
    const cam = this.scene.cameras.main, zc = cam.zoom / UI();
    let want = LEVELS.findIndex((s) => zc < s.upTo);
    // livello non ancora pronto: il più vicino già pronto
    while (want > 0 && !this.levels[want]?.ready) want--;
    if (want !== this.cur && this.levels[want]?.ready) {
      for (const L of this.levels) for (const o of [...L.base, ...L.ovl, L.gaps]) o?.setVisible(false);
      this.cur = want;
      const L = this.levels[want];
      for (const o of [...L.base, ...L.ovl, L.gaps]) o?.setVisible(true);
      // da vicino: sotto resta il livello prima (dove i riquadri fitti non sono ancora pronti), senza la sua trama
      if (L.sparse) { const F = this.levels[want - 1]; for (const o of [...F.base, ...F.ovl]) o?.setVisible(true); }
      // province cambiate mentre il livello non era in uso: subito
      this.flushOverlay(L, 6);
    }
    // da vicino: riquadri fitti per quello che si vede (prima il centro)
    const L = this.levels[this.cur];
    if (L?.sparse) {
      const v = cam.worldView, d = L.d;
      const tx0 = Math.max(0, Math.floor((v.x * d) / TILE)), ty0 = Math.max(0, Math.floor((v.y * d) / TILE));
      const tx1 = Math.min(L.tx - 1, Math.floor((v.right * d) / TILE)), ty1 = Math.min(L.ty - 1, Math.floor((v.bottom * d) / TILE));
      const cx = (v.centerX * d) / TILE, cy = (v.centerY * d) / TILE, need: number[] = [];
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (!L.built.has(ty * L.tx + tx)) need.push(ty * L.tx + tx);
      need.sort((a, b) => Math.hypot((a % L.tx) + 0.5 - cx, Math.floor(a / L.tx) + 0.5 - cy) - Math.hypot((b % L.tx) + 0.5 - cx, Math.floor(b / L.tx) + 0.5 - cy));
      this.tileQueue = need;
    }
    this.placeLabels(cam);
  }

  /** Nomi (nazioni, città, mari) a misura costante sullo schermo, su fondo nero; quelli che si sovrappongono restano fuori. */
  private placeLabels(cam: Phaser.Cameras.Scene2D.Camera) {
    const data = this.labelData;
    const key = data.map((l) => l.text).join('|');
    const z = cam.zoom, u = UI();
    if (key !== this.labelKey) {
      // nomi riusati (crearli costa): si creano solo quelli nuovi, gli altri si nascondono
      this.labelKey = key;
      const used = new Set<string>();
      this.labels = [...data].sort((a, b) => a.priority - b.priority).map((l) => {
        const k = `${l.text}|${l.color}|${l.small ? 1 : 0}`;
        used.add(k);
        let t = this.labelCache.get(k);
        if (!t) {
          t = this.scene.add.text(l.x, l.y, l.text, { fontFamily: TERM_FONT, fontSize: `${l.small ? 9 : 11}px`, color: l.color, backgroundColor: '#000000', padding: { x: 2, y: 0 }, resolution: u })
            .setOrigin(0.5).setDepth(this.depth + 0.03);
          this.labelCache.set(k, t);
        }
        return t.setPosition(l.x, l.y);
      });
      for (const [k, t] of this.labelCache) if (!used.has(k)) t.setVisible(false);
      this.labelZoom = -1;
    }
    for (const t of this.labels) t.setScale(u / z);
    if (Math.abs(z - this.labelZoom) < 1e-6) return;
    this.labelZoom = z;
    // niente sovrapposizioni (in punti sullo schermo), prima i più importanti
    const placed: [number, number, number, number][] = [];
    for (const t of this.labels) {
      const w = t.width, h = t.height, x = (t.x * z) / u, y = (t.y * z) / u;
      const box: [number, number, number, number] = [x - w / 2 - 4, y - h / 2 - 2, x + w / 2 + 4, y + h / 2 + 2];
      const free = !placed.some((b) => b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1]);
      t.setVisible(free);
      if (free) placed.push(box);
    }
  }

  destroy() {
    for (const L of this.levels) this.destroyLevel(L);
    for (const t of this.labelCache.values()) t.destroy();
    this.levels = [];
    this.building = null;
  }
}

/** Media mobile separabile (a righe intere anche in verticale: memoria letta in ordine). */
function* blur(src: Float32Array, dst: Float32Array, w: number, h: number, rad: number, horiz: boolean): Generator<void, void> {
  if (horiz) {
    for (let l = 0; l < h; l++) {
      if (l % 300 === 299) yield;
      const b0 = l * w;
      let acc = 0;
      for (let i = 0; i <= rad && i < w; i++) acc += src[b0 + i];
      for (let i = 0; i < w; i++) {
        dst[b0 + i] = acc;
        const out = i - rad, inn = i + rad + 1;
        if (out >= 0) acc -= src[b0 + out];
        if (inn < w) acc += src[b0 + inn];
      }
    }
    return;
  }
  const acc = new Float32Array(w);
  for (let i = 0; i <= rad && i < h; i++) { const b0 = i * w; for (let x = 0; x < w; x++) acc[x] += src[b0 + x]; }
  for (let y = 0; y < h; y++) {
    if (y % 300 === 299) yield;
    const d0 = y * w;
    for (let x = 0; x < w; x++) dst[d0 + x] = acc[x];
    const out = y - rad, inn = y + rad + 1;
    if (out >= 0) { const o = out * w; for (let x = 0; x < w; x++) acc[x] -= src[o + x]; }
    if (inn < h) { const o = inn * w; for (let x = 0; x < w; x++) acc[x] += src[o + x]; }
  }
}

let bathyCache: Uint8Array | null = null;
function decodeBathy(): Uint8Array {
  if (bathyCache) return bathyCache;
  const bin = atob(BATHY.runs), out = new Uint8Array(BATHY.w * BATHY.h);
  let o = 0;
  for (let i = 0; i + 1 < bin.length; i += 2) { const v = bin.charCodeAt(i), n = bin.charCodeAt(i + 1); out.fill(v, o, o + n); o += n; }
  return (bathyCache = out);
}
