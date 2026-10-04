// Albero della ricerca (Laboratorio + Arsenale): ricerche a tempo, una alla volta, con prerequisiti; archivio della Caduta.
import { BALANCE, type TechDef } from '../config/balance';
import techText from '../data/tech.json';
import type { Profile } from '../save/storage';
import type { Mods } from './mods';
import { RESOURCES, type Bag } from './resources';

export type TechId = string;
export const TECH_IDS = Object.keys(BALANCE.tech) as TechId[];
export const BRANCHES = techText.branches as Record<string, string>;

export interface TechInfo extends Omit<TechDef, 'cost'> {
  id: TechId;
  cost: Bag;
  timeSec: number;
  name: string;
  desc: string;
  lore?: string;
}

const TEXT = techText as unknown as Record<TechId, { name: string; desc: string; lore?: string }>;
export const techInfo = (id: TechId): TechInfo => {
  const b = BALANCE.tech[id];
  return { id, ...b, cost: b.cost as Bag, ...TEXT[id] };
};

export type ResearchBlock = 'done' | 'nolab' | 'lab' | 'arsenale' | 'prev' | 'busy' | 'cost';

/**
 * Perché non si può ricercare (null = si può). Servono le ricerche precedenti (req); gli Armamenti dipendono dal livello
 * dell'Arsenale, gli altri rami dal Laboratorio (che limita il grado).
 */
export function researchBlock(p: Profile, id: TechId): ResearchBlock | null {
  const t = techInfo(id);
  if (p.techs.includes(id)) return 'done';
  if (t.arsenale !== undefined) {
    if (p.buildings.arsenale < t.arsenale) return 'arsenale';
  } else {
    const lab = p.buildings.laboratorio;
    if (lab <= 0) return 'nolab';
    if (lab < Math.min(t.tier ?? 1, 3)) return 'lab';
  }
  if (t.req.some((r) => !p.techs.includes(r))) return 'prev';
  if (p.research) return 'busy';
  if (!RESOURCES.every((r) => p.stash[r] >= t.cost[r])) return 'cost';
  return null;
}

/** Ricerche disponibili adesso (prerequisiti fatti, non ancora completate). */
export function availableTechs(p: Profile): TechId[] {
  return TECH_IDS.filter((id) => !p.techs.includes(id) && BALANCE.tech[id].req.every((r) => p.techs.includes(r)));
}

export function startResearch(p: Profile, id: TechId, now: number): boolean {
  if (researchBlock(p, id)) return false;
  const t = techInfo(id);
  RESOURCES.forEach((r) => (p.stash[r] -= t.cost[r]));
  p.research = { id, until: now + (p.test ? 0 : t.timeSec * 1000) };
  return true;
}

/** Chiude la ricerca se il tempo è passato; ritorna quella completata. */
export function settleResearch(p: Profile, now: number): TechId | null {
  if (!p.research || p.research.until > now) return null;
  const id = p.research.id as TechId;
  if (!p.techs.includes(id)) p.techs.push(id);
  p.research = null;
  return id;
}

export const techMods = (p: Profile): Partial<Mods>[] => p.techs.filter((id) => BALANCE.tech[id]?.mods).map((id) => BALANCE.tech[id].mods as Partial<Mods>);

/** Frammenti dell'archivio della Caduta sbloccati dalle ricerche. */
export const loreFragments = (p: Profile) => TECH_IDS.filter((id) => TEXT[id].lore && p.techs.includes(id)).map((id) => ({ name: TEXT[id].name, lore: TEXT[id].lore! }));
export const loreTotal = TECH_IDS.filter((id) => TEXT[id].lore).length;
