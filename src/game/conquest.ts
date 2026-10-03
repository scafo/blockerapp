// Conquista: pool di truppe che cresce col territorio + ondate che avanzano casella per casella dal confine.
// L'ondata è una Dijkstra a tempo: ogni casella arriva dopo stepMs / velocità del terreno, più lenta se si allontana dal bersaglio.
import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { COLS, N, NB, colOf, rowOf } from '../map/grid';
import { cellSpeed, passable, terrainStats, type Province, type World } from '../map/world';

/** Coda di priorità minima su (tempo, casella). */
class Heap {
  private t: number[] = [];
  private c: number[] = [];
  get size() { return this.t.length; }
  peekT() { return this.t[0]; }
  push(t: number, c: number) {
    const a = this.t, b = this.c;
    let i = a.length;
    a.push(t); b.push(c);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p] <= t) break;
      a[i] = a[p]; b[i] = b[p]; i = p;
    }
    a[i] = t; b[i] = c;
  }
  pop(): number {
    const a = this.t, b = this.c, top = b[0];
    const lt = a.pop()!, lc = b.pop()!;
    if (a.length) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i, mt = lt;
        if (l < a.length && a[l] < mt) { m = l; mt = a[l]; }
        if (r < a.length && a[r] < mt) { m = r; mt = a[r]; }
        if (m === i) break;
        a[i] = a[m]; b[i] = b[m]; i = m;
      }
      a[i] = lt; b[i] = lc;
    }
    return top;
  }
}

interface Wave { owner: number; budget: number; clock: number; tx: number; ty: number; heap: Heap; seen: Uint8Array }

export interface Captured { cell: number; owner: number }

export class Conquest extends Phaser.Events.EventEmitter {
  troops: number = BALANCE.troops.start;
  cells = 0;
  cities = 0;
  growthCells = 0; // caselle che fanno crescere le truppe (il deserto no)
  provincesOwned = 0;
  loot = 0;
  ratio: number = BALANCE.wave.ratios[BALANCE.wave.defaultRatio];
  private waves: Wave[] = [];
  private tickAcc = 0;
  private provOwned: Int32Array;
  /** Caselle prese in questo frame (le legge il renderer). */
  readonly captured: Captured[] = [];

  constructor(readonly w: World, readonly player: number) {
    super();
    this.provOwned = new Int32Array(w.provinces.length);
  }

  /** Partenza: un disco di raggio start.radius attorno a w.start. */
  placeStart() {
    const R = BALANCE.start.radius, c0 = colOf(this.w.start), r0 = rowOf(this.w.start);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const c = c0 + dx, r = r0 + dy;
      if (c < 0 || c >= COLS || r < 0 || r * COLS >= N || Math.hypot(dx, dy) > R + 0.3) continue;
      const i = r * COLS + c;
      if (passable(this.w, i)) this.take(i, this.player, false);
    }
  }

  get rate() {
    const t = BALANCE.troops;
    return t.base + this.growthCells * t.perCell + this.cities * t.perCity;
  }

  get busy() { return this.waves.length; }

  update(dtMs: number) {
    this.captured.length = 0;
    this.tickAcc += dtMs;
    while (this.tickAcc >= BALANCE.troops.tickMs) {
      this.tickAcc -= BALANCE.troops.tickMs;
      this.troops += this.rate;
    }
    let budget = BALANCE.wave.maxCapturesPerFrame;
    for (let k = this.waves.length - 1; k >= 0; k--) {
      const wv = this.waves[k];
      wv.clock += dtMs;
      budget = this.advance(wv, budget);
      if (!wv.heap.size || wv.budget < BALANCE.baseDefense * BALANCE.terrain.deserto.defense) {
        this.troops += wv.budget; // le truppe non spese tornano nel pool
        this.waves.splice(k, 1);
        this.emit('waveEnd', wv);
      }
    }
  }

  /** Distanza (in caselle) dal mio confine più vicino, o Infinity. Restituisce anche le caselle di confine vicine. */
  private borderNear(tc: number, tr: number) {
    const R = BALANCE.wave.maxTapDistance + BALANCE.wave.seedSpread;
    const found: { i: number; d: number }[] = [];
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const c = tc + dx, r = tr + dy;
      if (c < 0 || c >= COLS || r < 0 || r * COLS >= N) continue;
      const i = r * COLS + c;
      if (this.w.owner[i] !== this.player) continue;
      let edge = false;
      for (let k = 0; k < 4; k++) { const n = NB[i * 4 + k]; if (n >= 0 && passable(this.w, n) && this.w.owner[n] !== this.player) edge = true; }
      if (edge) found.push({ i, d: Math.hypot(dx, dy) });
    }
    return found;
  }

  /** Tap sulla casella `target`: lancia un'ondata con ratio × truppe. Restituisce false se troppo lontano o non valido. */
  launch(target: number): boolean {
    const w = this.w;
    if (target < 0 || !passable(w, target) || w.owner[target] === this.player) return false;
    const tc = colOf(target), tr = rowOf(target);
    const border = this.borderNear(tc, tr);
    if (!border.length) return false;
    const dmin = Math.min(...border.map((b) => b.d));
    if (dmin > BALANCE.wave.maxTapDistance) return false;
    const budget = Math.floor(this.troops * this.ratio);
    if (budget < w.defense[target] && budget < BALANCE.baseDefense) return false;
    this.troops -= budget;
    const wv: Wave = { owner: this.player, budget, clock: 0, tx: tc, ty: tr, heap: new Heap(), seen: new Uint8Array(N) };
    // le caselle di confine più vicine al bersaglio partono per prime
    for (const b of border) {
      if (b.d > dmin + BALANCE.wave.seedSpread) continue;
      this.expand(wv, b.i, (b.d - dmin) * BALANCE.wave.stepMs * 0.5);
    }
    this.waves.push(wv);
    return true;
  }

  /** Accoda i vicini non miei di `from`, con il tempo d'arrivo. */
  private expand(wv: Wave, from: number, t: number) {
    const w = this.w, W = BALANCE.wave;
    const fc = colOf(from), fr = rowOf(from);
    let tx = wv.tx - fc, ty = wv.ty - fr;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    for (let k = 0; k < 4; k++) {
      const n = NB[from * 4 + k];
      if (n < 0 || wv.seen[n] || !passable(w, n) || w.owner[n] === wv.owner) continue;
      wv.seen[n] = 1;
      const dx = colOf(n) - fc, dy = rowOf(n) - fr;
      const dev = (1 - (dx * tx + dy * ty)) / 2; // 0 verso il bersaglio, 1 indietro
      wv.heap.push(t + (W.stepMs / cellSpeed(w, n)) * (1 + W.directionBias * dev), n);
    }
  }

  private advance(wv: Wave, frameBudget: number) {
    const w = this.w;
    while (frameBudget > 0 && wv.heap.size && wv.heap.peekT() <= wv.clock) {
      const t = wv.heap.peekT();
      const i = wv.heap.pop();
      if (w.owner[i] === wv.owner) continue;
      const cost = w.defense[i];
      if (cost > wv.budget) continue; // troppo cara: l'ondata scorre attorno
      wv.budget -= cost;
      this.take(i, wv.owner, true);
      frameBudget--;
      this.expand(wv, i, t);
    }
    return frameBudget;
  }

  private take(i: number, owner: number, animate: boolean) {
    const w = this.w;
    w.owner[i] = owner;
    if (owner === this.player) {
      this.cells++;
      if (terrainStats(w.terrain[i]).growth) this.growthCells++;
      if (w.city[i]) { this.cities++; this.emit('cityCaptured', i); }
      if (w.loot[i]) { this.loot += w.loot[i]; }
      const p = w.province[i];
      if (p >= 0 && ++this.provOwned[p] === w.provinces[p].cells.length) {
        this.provincesOwned++;
        if (animate) this.emit('provinceCaptured', w.provinces[p] as Province);
      }
    }
    if (animate) this.captured.push({ cell: i, owner });
  }

  /** Quante caselle di una provincia ho. */
  provinceProgress(p: number) { return this.provOwned[p]; }

  /** Baricentro del mio territorio (in caselle). */
  centroid(): [number, number] {
    let sx = 0, sy = 0, n = 0;
    const o = this.w.owner;
    for (let i = 0; i < N; i++) if (o[i] === this.player) { sx += colOf(i); sy += rowOf(i); n++; }
    return n ? [sx / n, sy / n] : [colOf(this.w.start), rowOf(this.w.start)];
  }
}

