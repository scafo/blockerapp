// Civiltà (Figma): sistemi politici. Ognuna: bonus, unità unica, edificio unico (sugli insediamenti), sblocco.
import { BALANCE, type CivId, type UnitType } from '../config/balance';
import civText from '../data/civs.json';
import type { Profile } from '../save/storage';
import type { Mods } from './mods';

export const CIV_IDS: CivId[] = ['republica', 'imperium', 'aristocrazia', 'cabal'];

export interface CivInfo {
  id: CivId;
  name: string;
  motto: string;
  bonus: string;
  building: string;
  buildingText: string;
  unlock: string;
  unit: UnitType;
}

export const civInfo = (id: CivId): CivInfo => ({ id, ...(civText as Record<CivId, Omit<CivInfo, 'id' | 'unit'>>)[id], unit: BALANCE.civs[id].unit as UnitType });

export function civUnlocked(p: Profile, id: CivId): boolean {
  const u = BALANCE.civs[id].unlock as { wins?: number; expeditions?: number } | null;
  if (!u) return true;
  if (u.wins !== undefined && p.wins < u.wins) return false;
  if (u.expeditions !== undefined && p.expeditionsDone < u.expeditions) return false;
  return true;
}

/** Bonus della civiltà + effetto del suo edificio unico. */
export const civMods = (id: CivId): Partial<Mods>[] => [BALANCE.civs[id].bonus as Partial<Mods>, BALANCE.civs[id].building as Partial<Mods>];
