// Salvataggio locale del profilo. localStorage può mancare o lanciare: mai far crashare il gioco.
import { emptyBag, type Bag } from '../game/resources';
import type { CampaignId, CivId } from '../config/balance';

export type BuildingId = 'arsenale' | 'comando' | 'deposito' | 'laboratorio' | 'radar';
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
  civ: CivId; // ultima civiltà scelta (la Rivincita la riusa)
  campaign: CampaignId; // ultima durata scelta
  techs: string[]; // ricerche completate
  research: { id: string; until: number } | null;
  history: CampaignRecord[]; // registro della Sala Radar (più recenti per prime)
}

export interface CampaignRecord {
  at: number; // epoch ms
  civ: CivId;
  campaign: CampaignId;
  outcome: string;
  tiles: number;
  timeMs: number;
}

const KEY = 'ashen-atlas:profile';

export const freshProfile = (): Profile => ({
  v: 1, stash: emptyBag(), runs: 0, wins: 0, bestTiles: 0,
  buildings: { arsenale: 0, comando: 0, deposito: 0, laboratorio: 0, radar: 0 }, construction: null, expedition: null, expeditionsDone: 0,
  civ: 'republica', campaign: 'standard', techs: [], research: null, history: [],
});

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshProfile();
    const p = migrate(JSON.parse(raw)) as Partial<Profile>;
    const f = freshProfile();
    return { ...f, ...p, stash: { ...f.stash, ...(p.stash ?? {}) }, buildings: { ...f.buildings, ...(p.buildings ?? {}) } };
  } catch {
    return freshProfile();
  }
}

/** Salvataggi di prima della lore della Caduta: rottami/carburante/viveri e fucina/radio/magazzino → nomi nuovi. */
function migrate(p: Record<string, any>): Record<string, any> {
  const ren = (o: Record<string, any> | undefined, map: Record<string, string>) => {
    if (!o) return;
    for (const [a, b] of Object.entries(map)) if (a in o) { o[b] = (o[b] ?? 0) + o[a]; delete o[a]; }
  };
  const res = { rottami: 'metallo', carburante: 'benzina', viveri: 'cibo' };
  ren(p.stash, res);
  ren(p.expedition?.reward, res);
  ren(p.buildings, { fucina: 'arsenale', radio: 'comando', magazzino: 'deposito' });
  if (p.construction) p.construction.id = ({ fucina: 'arsenale', radio: 'comando', magazzino: 'deposito' } as Record<string, string>)[p.construction.id] ?? p.construction.id;
  return p;
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage pieno o bloccato: si gioca lo stesso */
  }
}

/** Preferenze di gioco ricordate tra una run e l'altra (forza d'attacco, quota lavoratori). */
export interface Prefs {
  attack?: number;
  workers?: number;
}

const PREFS_KEY = 'ashen-atlas:prefs';

export function loadPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Prefs;
  } catch {
    return {};
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...p }));
  } catch {
    /* pazienza */
  }
}
