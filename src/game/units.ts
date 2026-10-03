// Pedine: dati, sasso-carta-forbice, percorsi.
import { BALANCE, type UnitType } from '../config/balance';
import unitData from '../data/units.json';
import { NEIGHBORS } from '../map/hexGrid';

export interface UnitInfo {
  id: UnitType;
  name: string;
  short: string;
  cls: UnitType; // classe nel sasso-carta-forbice (le unità uniche usano quella della base)
  beats: UnitType;
  desc: string;
}

export const UNITS = unitData as UnitInfo[];
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
}

/** Moltiplicatore di danno di `a` contro `b`. */
export function rps(a: UnitType, b: UnitType): number {
  const A = unitInfo(a), B = unitInfo(b);
  if (A.beats === B.cls) return BALANCE.units.strong;
  if (B.beats === A.cls) return BALANCE.units.weak;
  return 1;
}

/** Percorso più breve sulle caselle attraversabili (vuoto se irraggiungibile). */
export function findPath(from: number, to: number, passable: (i: number) => boolean): number[] {
  if (from === to || !passable(to)) return [];
  const prev = new Int32Array(NEIGHBORS.length).fill(-1);
  prev[from] = from;
  const queue = [from];
  for (let h = 0; h < queue.length; h++) {
    const c = queue[h];
    if (c === to) break;
    for (const n of NEIGHBORS[c]) {
      if (n >= 0 && prev[n] < 0 && passable(n)) {
        prev[n] = c;
        queue.push(n);
      }
    }
  }
  if (prev[to] < 0) return [];
  const path: number[] = [];
  for (let c = to; c !== from; c = prev[c]) path.push(c);
  return path.reverse();
}
