// Salvataggio locale del profilo. localStorage può mancare o lanciare: mai far crashare il gioco.
import { emptyBag, type Bag } from '../game/resources';

export type BuildingId = 'fucina' | 'radio' | 'magazzino';
export type ExpeditionKind = 'breve' | 'media' | 'lunga';

export interface Profile {
  v: 1;
  stash: Bag; // scorta dell'accampamento
  runs: number;
  wins: number;
  bestTiles: number;
  buildings: Record<BuildingId, number>; // livello (0 = lotto vuoto)
  construction: { id: BuildingId; until: number } | null; // epoch ms
  expedition: { kind: ExpeditionKind; until: number; reward: Bag } | null;
  expeditionsDone: number;
}

const KEY = 'ashen-atlas:profile';

export const freshProfile = (): Profile => ({
  v: 1, stash: emptyBag(), runs: 0, wins: 0, bestTiles: 0,
  buildings: { fucina: 0, radio: 0, magazzino: 0 }, construction: null, expedition: null, expeditionsDone: 0,
});

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshProfile();
    const p = JSON.parse(raw) as Partial<Profile>;
    const f = freshProfile();
    return { ...f, ...p, stash: { ...f.stash, ...(p.stash ?? {}) }, buildings: { ...f.buildings, ...(p.buildings ?? {}) } };
  } catch {
    return freshProfile();
  }
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage pieno o bloccato: si gioca lo stesso */
  }
}
