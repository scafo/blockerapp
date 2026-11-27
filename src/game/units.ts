// Pedine: dati, sasso-carta-forbice, percorsi.
import { BALANCE, type UnitType } from '../config/balance';
import unitData from '../data/units.json';
import { CELLS, HEX_W, center, hexDistance, neighbors, pixelToIndex } from '../map/hexGrid';

export interface UnitInfo {
  id: UnitType;
  name: string;
  short: string;
  cls: UnitType; // classe nel sasso-carta-forbice (le unità uniche usano quella della base)
  beats: UnitType[]; // classi che batte
  naval?: boolean; // si muove solo sul mare
  desc: string;
}

export const UNITS = unitData as UnitInfo[];
export const isNaval = (t: UnitType) => !!unitInfo(t).naval;
export const UNIT_TYPES = UNITS.map((u) => u.id);
export const unitInfo = (t: UnitType) => UNITS.find((u) => u.id === t)!;

export interface Unit {
  id: number;
  type: UnitType;
  owner: number;
  tile: number;
  hp: number;
  maxHp: number;
  path: number[]; // prossime caselle (esclusa quella attuale)
  moveAcc: number;
  inCombat: boolean;
  lastOrderMs: number;
  size: number; // reparti uniti nella pedina (attacco e vita si sommano)
  stance: Stance; // tieni la posizione / attacca da sola
  front: number; // fazione del fronte assegnato (−1 = nessuno): la pedina tiene (o spinge) quel confine
  supply: number; // rifornimento attuale (0–1): sotto la soglia si logora
  post: number; // casella sulla linea d'attacco disegnata (−1 = nessuna): la pedina ci va e la tiene
  via?: number[]; // offensiva: tappe lungo la freccia prima della casella d'arrivo (la pedina segue il tracciato)
  goal: number; // offensiva (freccia alla HOI4): casella d'arrivo, la pedina avanza assediando ciò che incontra (−1 = nessuna)
  fresh?: boolean; // appena schierato dal giocatore: avanza da solo verso il nemico finché non riceve un ordine (Nico)
  resting?: boolean; // in attacco ma ferita: si cura nel tuo territorio, poi riprende l'attacco (Nico)
  restHp?: number; // a riposo: vita all'ultima cura (se non sale da 30 s cerca un altro posto)
  restAt?: number; // a riposo: quando la vita è salita l'ultima volta (ms di gioco)
  orderHp?: number; // vita quando hai dato la freccia: si ritira solo se ne perde altra da lì (una freccia tua non la manda a casa)
  chase?: number; // attacco diretto (Nico, 27 novembre 2026): id della pedina nemica da inseguire, −1/assente = nessuna
  band?: number; // gruppetto compatto (Nico, 27 novembre 2026): id del gruppo, −1/assente = nessuno. Va come un blocco
  zone?: number; // regioni scelte (Nico, 27 novembre 2026): id della zona da conquistare, −1/assente = nessuna
  squad?: number; // attacca nazione: provincia bersaglio della sua squadretta (stessa velocità, entrano insieme), −1/assente = nessuna
  waitMs?: number; // da quanto aspetta le compagne di squadra sul confine
}

export type Stance = 'tieni' | 'attacca';

/** Moltiplicatore di danno di `a` contro `b`. */
export function rps(a: UnitType, b: UnitType): number {
  const A = unitInfo(a), B = unitInfo(b);
  if (A.beats.includes(B.cls)) return BALANCE.units.strong;
  if (B.beats.includes(A.cls)) return BALANCE.units.weak;
  return 1;
}

/** Percorso più breve sulle caselle attraversabili (vuoto se irraggiungibile). */
// tabelle riusate tra una ricerca e l'altra (i percorsi da centro a centro ne fanno tante): `seen` col numero della ricerca
let prevBuf: Int32Array | null = null, seenBuf: Uint32Array | null = null, stamp = 0;

/**
 * Percorso dritto da `from` a `to` lungo il segmento fra i due centri (Nico: la rete delle strade mostrata a zoom massimo è
 * dritta, le pedine facevano scalini a lato). Se una casella del segmento non è attraversabile, il percorso più corto.
 */
export function straightPath(from: number, to: number, passable: (i: number) => boolean): number[] {
  if (from === to) return [];
  const a = center(from), b = center(to), steps = Math.ceil((Math.hypot(b.x - a.x, b.y - a.y) / HEX_W) * 3);
  const path: number[] = [];
  let last = from;
  for (let k = 1; k <= steps; k++) {
    const i = k === steps ? to : pixelToIndex(a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps);
    if (i === last) continue;
    if (i < 0 || !passable(i) || !neighbors(last).includes(i)) return findPath(from, to, passable, 4000); // fra due centri vicini: ricerca corta
    path.push(i);
    last = i;
  }
  return path;
}

/**
 * Percorso più breve con A* (stima: distanza esagonale): per le traversate lunghe (Nico: New York → Spagna "irraggiungibile",
 * la ricerca a tappeto esplorava tutto l'oceano prima di arrivare). `limit` = caselle esaminate al massimo.
 */
let gBuf: Float32Array | null = null, aPrev: Int32Array | null = null, aSeen: Uint32Array | null = null, aStamp = 0;
export function findPathAStar(from: number, to: number, passable: (i: number) => boolean, limit = Infinity): number[] {
  if (from === to || !passable(to)) return [];
  if (gBuf?.length !== CELLS) { gBuf = new Float32Array(CELLS); aPrev = new Int32Array(CELLS); aSeen = new Uint32Array(CELLS); aStamp = 0; } // carta cambiata: griglia diversa
  const gs = gBuf, prev = aPrev!, seen = aSeen!;
  if (++aStamp === 0xffffffff) { seen.fill(0); aStamp = 1; }
  const heap: number[] = [], fval: number[] = [];
  const push = (i: number, f: number) => {
    heap.push(i); fval.push(f);
    for (let k = heap.length - 1; k > 0;) { const p = (k - 1) >> 1; if (fval[p] <= fval[k]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; [fval[p], fval[k]] = [fval[k], fval[p]]; k = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!, lf = fval.pop()!;
    if (heap.length) {
      heap[0] = last; fval[0] = lf;
      for (let k = 0; ;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && fval[l] < fval[m]) m = l;
        if (r < heap.length && fval[r] < fval[m]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]]; [fval[m], fval[k]] = [fval[k], fval[m]]; k = m;
      }
    }
    return top;
  };
  seen[from] = aStamp; gs[from] = 0; prev[from] = from;
  push(from, hexDistance(from, to));
  let n = 0;
  while (heap.length && n++ < limit) {
    const c = pop();
    if (c === to) break;
    for (const nb of neighbors(c)) {
      if (nb < 0 || !passable(nb)) continue;
      const g = gs[c] + 1;
      if (seen[nb] === aStamp && gs[nb] <= g) continue;
      seen[nb] = aStamp; gs[nb] = g; prev[nb] = c;
      push(nb, g + hexDistance(nb, to));
    }
  }
  if (seen[to] !== aStamp) return [];
  const path: number[] = [];
  for (let c = to; c !== from; c = prev[c]) path.push(c);
  return path.reverse();
}

export function findPath(from: number, to: number, passable: (i: number) => boolean, limit = Infinity): number[] {
  if (from === to || !passable(to)) return [];
  if (prevBuf?.length !== CELLS) { prevBuf = new Int32Array(CELLS); seenBuf = new Uint32Array(CELLS); stamp = 0; } // carta cambiata: griglia diversa
  const prev = prevBuf, seen = seenBuf!;
  if (++stamp === 0xffffffff) { seen.fill(0); stamp = 1; }
  prev[from] = from;
  seen[from] = stamp;
  const queue = [from];
  for (let h = 0; h < queue.length && h < limit; h++) {
    const c = queue[h];
    if (c === to) break;
    for (const n of neighbors(c)) {
      if (n >= 0 && seen[n] !== stamp && passable(n)) {
        seen[n] = stamp;
        prev[n] = c;
        queue.push(n);
      }
    }
  }
  if (seen[to] !== stamp) return [];
  const path: number[] = [];
  for (let c = to; c !== from; c = prev[c]) path.push(c);
  return path.reverse();
}
