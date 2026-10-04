// Laboratorio: ricerche a tempo (una alla volta) e archivio della Caduta. Niente Phaser.
import { BALANCE } from '../config/balance';
import techText from '../data/tech.json';
import type { Profile } from '../save/storage';
import type { Mods } from './mods';
import { RESOURCES, type Bag } from './resources';

export type TechId = keyof typeof BALANCE.tech;
export const TECH_IDS = Object.keys(BALANCE.tech) as TechId[];
export const BRANCHES = techText.branches as Record<string, string>;

export interface TechInfo {
  id: TechId;
  branch: string;
  tier: number;
  cost: Bag;
  timeSec: number;
  name: string;
  desc: string;
  lore?: string;
}

const TEXT = techText as unknown as Record<TechId, { name: string; desc: string; lore?: string }>;
export const techInfo = (id: TechId): TechInfo => {
  const b = BALANCE.tech[id];
  return { id, branch: b.branch, tier: b.tier, cost: b.cost as Bag, timeSec: b.timeSec, ...TEXT[id] };
};

export type ResearchBlock = 'done' | 'nolab' | 'lab' | 'prev' | 'busy' | 'cost';

/** Perché non si può ricercare (null = si può). Dentro un ramo si va in ordine; il livello del Laboratorio limita il grado. */
export function researchBlock(p: Profile, id: TechId): ResearchBlock | null {
  const t = techInfo(id);
  if (p.techs.includes(id)) return 'done';
  const lab = p.buildings.laboratorio;
  if (lab <= 0) return 'nolab';
  if (lab < Math.min(t.tier, 3)) return 'lab';
  const prev = TECH_IDS.find((o) => BALANCE.tech[o].branch === t.branch && BALANCE.tech[o].tier === t.tier - 1);
  if (prev && !p.techs.includes(prev)) return 'prev';
  if (p.research) return 'busy';
  if (!RESOURCES.every((r) => p.stash[r] >= t.cost[r])) return 'cost';
  return null;
}

/** La prossima ricerca di ogni ramo (quella da fare in ordine). */
export function nextInBranches(p: Profile): TechId[] {
  const out: TechId[] = [];
  for (const branch of Object.keys(BRANCHES)) {
    const next = TECH_IDS.filter((id) => BALANCE.tech[id].branch === branch && !p.techs.includes(id))
      .sort((a, b) => BALANCE.tech[a].tier - BALANCE.tech[b].tier)[0];
    if (next) out.push(next);
  }
  return out;
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

export const techMods = (p: Profile): Partial<Mods>[] => p.techs.filter((id) => id in BALANCE.tech).map((id) => BALANCE.tech[id as TechId].mods as Partial<Mods>);

/** Frammenti dell'archivio della Caduta sbloccati dalle ricerche. */
export const loreFragments = (p: Profile) => TECH_IDS.filter((id) => TEXT[id].lore && p.techs.includes(id)).map((id) => ({ name: TEXT[id].name, lore: TEXT[id].lore! }));
export const loreTotal = TECH_IDS.filter((id) => TEXT[id].lore).length;
