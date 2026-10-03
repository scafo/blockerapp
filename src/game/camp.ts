// Accampamento: edifici, cantiere, spedizioni e ciò che cambiano nelle run. Niente Phaser.
import { BALANCE, type UnitType } from '../config/balance';
import type { BuildingId, ExpeditionKind, Profile } from '../save/storage';
import { RESOURCES, type Bag } from './resources';

export const BUILDINGS: BuildingId[] = ['fucina', 'radio', 'magazzino'];
export const EXPEDITIONS: ExpeditionKind[] = ['breve', 'media', 'lunga'];
const C = BALANCE.camp;

/** Opzioni di una run decise dall'accampamento. */
export interface RunOptions {
  units: UnitType[];
  unitHpMult: number;
  events: number; // 0 nessuno, 1 comuni, 2 anche rari
  warnBonusMs: number;
  eliminatedLoss: number;
  retreatBonus: number;
  tutorial: boolean; // prima run guidata
  fog: boolean; // nebbia di guerra
}

/** Tutto sbloccato, niente eventi: usato dal simulatore e come ripiego. */
export const DEFAULT_OPTIONS: RunOptions = {
  units: ['fanteria', 'raider', 'artiglieria'], unitHpMult: 1, events: 0, warnBonusMs: 0,
  eliminatedLoss: BALANCE.end.eliminatedLoss, retreatBonus: 0, tutorial: false, fog: false,
};

export function runOptions(p: Profile): RunOptions {
  const { fucina, radio, magazzino } = p.buildings;
  return {
    units: [...C.fucinaUnits[fucina]] as UnitType[],
    unitHpMult: C.fucinaHpMult[fucina],
    events: C.radioEvents[radio],
    warnBonusMs: C.radioWarnBonusMs[radio],
    eliminatedLoss: C.magazzinoLoss[magazzino],
    retreatBonus: C.magazzinoRetreatBonus[magazzino],
    tutorial: p.runs === 0,
    fog: p.runs > 0, // niente nebbia nella run guidata: un sistema nuovo alla volta
  };
}

export const nextLevel = (p: Profile, id: BuildingId) => C.buildings[id][p.buildings[id]] ?? null;

export const canAfford = (stash: Bag, cost: Bag) => RESOURCES.every((r) => stash[r] >= cost[r]);

const pay = (stash: Bag, cost: Bag) => RESOURCES.forEach((r) => (stash[r] -= cost[r]));

export type BuildBlock = 'max' | 'busy' | 'cost';

export function buildBlock(p: Profile, id: BuildingId): BuildBlock | null {
  const lvl = nextLevel(p, id);
  if (!lvl) return 'max';
  if (p.construction) return 'busy';
  if (!canAfford(p.stash, lvl.cost)) return 'cost';
  return null;
}

export function startBuild(p: Profile, id: BuildingId, now: number): boolean {
  if (buildBlock(p, id)) return false;
  const lvl = nextLevel(p, id)!;
  pay(p.stash, lvl.cost);
  p.construction = { id, until: now + lvl.timeSec * 1000 };
  return true;
}

/** Chiude il cantiere se il tempo è passato; ritorna l'edificio completato. */
export function settle(p: Profile, now: number): BuildingId | null {
  if (!p.construction || p.construction.until > now) return null;
  const id = p.construction.id;
  p.buildings[id]++;
  p.construction = null;
  return id;
}

export const expeditionCost = (kind: ExpeditionKind) => C.expeditions[kind].cost;

export function startExpedition(p: Profile, kind: ExpeditionKind, now: number, rnd: () => number = Math.random): boolean {
  const E = C.expeditions[kind];
  if (p.expedition || p.stash.viveri < E.cost) return false;
  p.stash.viveri -= E.cost;
  const roll = (r: readonly [number, number]) => r[0] + Math.floor(rnd() * (r[1] - r[0] + 1));
  p.expedition = { kind, until: now + E.timeSec * 1000, reward: { rottami: roll(E.rottami), carburante: roll(E.carburante), viveri: roll(E.viveri) } };
  return true;
}

export function collectExpedition(p: Profile, now: number): Bag | null {
  if (!p.expedition || p.expedition.until > now) return null;
  const r = p.expedition.reward;
  RESOURCES.forEach((k) => (p.stash[k] += r[k]));
  p.expedition = null;
  p.expeditionsDone++;
  return r;
}

export const tents = (p: Profile) => Math.min(C.tentsMax, C.tentsBase + Math.floor(p.runs / 2));

export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(sec).padStart(2, '0')}`;
}
