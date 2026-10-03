// Salvataggio locale del profilo. localStorage può mancare o lanciare: mai far crashare il gioco.
import { emptyBag, type Bag } from '../game/resources';

export interface Profile {
  v: 1;
  stash: Bag; // scorta dell'accampamento
  runs: number;
  wins: number;
  bestTiles: number;
}

const KEY = 'ashen-atlas:profile';

const fresh = (): Profile => ({ v: 1, stash: emptyBag(), runs: 0, wins: 0, bestTiles: 0 });

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const p = JSON.parse(raw) as Partial<Profile>;
    return { ...fresh(), ...p, stash: { ...emptyBag(), ...(p.stash ?? {}) } };
  } catch {
    return fresh();
  }
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage pieno o bloccato: si gioca lo stesso */
  }
}
