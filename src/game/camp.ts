// Accampamento: edifici, cantiere, spedizioni e ciò che cambiano nelle run. Niente Phaser.
import { BALANCE, type CampaignId, type CivId, type UnitType } from '../config/balance';
import { civMods, civUnlocked, civInfo } from './civs';
import { BASE_MODS, combine, type Mods } from './mods';
import { techMods } from './tech';
import type { BuildingId, ExpeditionKind, Profile } from '../save/storage';
import { RESOURCES, type Bag } from './resources';

export const BUILDINGS: BuildingId[] = ['arsenale', 'laboratorio', 'comando', 'radar', 'deposito'];
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
  civ: CivId; // civiltà del giocatore
  campaign: CampaignId;
  stormStartMs: number; // la durata della campagna sposta la tempesta
  campaignLootMult: number; // campagne lunghe = più risorse a casa
  mods: Mods;
}

/** Tutto sbloccato, niente eventi: usato dal simulatore e come ripiego. */
export const DEFAULT_OPTIONS: RunOptions = {
  units: ['fanteria', 'ricognitori', 'artiglieria'], unitHpMult: 1, events: 0, warnBonusMs: 0,
  eliminatedLoss: BALANCE.end.eliminatedLoss, retreatBonus: 0, tutorial: false, fog: false,
  civ: 'republica', campaign: 'standard', stormStartMs: BALANCE.campaigns.standard.stormMs, campaignLootMult: 1, mods: BASE_MODS,
};

/** Civiltà e durata davvero disponibili (le scelte si sbloccano con le campagne giocate). */
export const civChoice = (p: Profile) => p.runs >= BALANCE.progression.civChoiceAfterRuns;
export const campaignChoice = (p: Profile) => p.runs >= BALANCE.progression.campaignChoiceAfterRuns;
export const activeCiv = (p: Profile): CivId => (civChoice(p) && civUnlocked(p, p.civ) ? p.civ : 'republica');
export const activeCampaign = (p: Profile): CampaignId => (campaignChoice(p) ? p.campaign : 'standard');

export function runOptions(p: Profile): RunOptions {
  const { arsenale, comando, deposito, radar } = p.buildings;
  const tutorial = p.runs === 0;
  const civ = activeCiv(p), campaign = activeCampaign(p);
  // la run guidata resta semplice: niente bonus
  const mods = tutorial ? BASE_MODS : combine(...civMods(civ), ...techMods(p), { fogBonus: C.radarFogBonus[radar] });
  const units = [...C.arsenaleUnits[arsenale]] as UnitType[];
  if (arsenale >= C.arsenaleUnique) units.push(civInfo(civ).unit);
  return {
    civ, campaign, mods,
    stormStartMs: BALANCE.campaigns[campaign].stormMs,
    campaignLootMult: BALANCE.campaigns[campaign].lootMult,
    units,
    unitHpMult: C.arsenaleHpMult[arsenale] * mods.unitHpMult,
    events: C.comandoEvents[comando],
    warnBonusMs: C.comandoWarnBonusMs[comando],
    eliminatedLoss: C.depositoLoss[deposito],
    retreatBonus: C.depositoRetreatBonus[deposito],
    tutorial,
    fog: p.runs > 0, // niente nebbia nella run guidata: un sistema nuovo alla volta
  };
}

export const nextLevel = (p: Profile, id: BuildingId) => C.buildings[id][p.buildings[id]] ?? null;

export const canAfford = (stash: Bag, cost: Bag) => RESOURCES.every((r) => stash[r] >= cost[r]);

const pay = (stash: Bag, cost: Bag) => RESOURCES.forEach((r) => (stash[r] -= cost[r]));

export type BuildBlock = 'max' | 'busy' | 'cost' | 'comando';

export function buildBlock(p: Profile, id: BuildingId): BuildBlock | null {
  const lvl = nextLevel(p, id);
  if (!lvl) return 'max';
  if (id !== 'comando' && p.buildings[id] >= p.buildings.comando + 1) return 'comando'; // il Centro di Comando sblocca tutto
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
/** Durata di una spedizione (la ricerca Estrazione+ la accorcia). */
export const expeditionTimeSec = (p: Profile, kind: ExpeditionKind) => Math.round(C.expeditions[kind].timeSec * combine(...techMods(p)).expeditionTimeMult);

export function startExpedition(p: Profile, kind: ExpeditionKind, now: number, rnd: () => number = Math.random): boolean {
  const E = C.expeditions[kind];
  if (p.expedition || p.stash.cibo < E.cost) return false;
  p.stash.cibo -= E.cost;
  const roll = (r: readonly [number, number]) => r[0] + Math.floor(rnd() * (r[1] - r[0] + 1));
  p.expedition = { kind, until: now + expeditionTimeSec(p, kind) * 1000, reward: { metallo: roll(E.metallo), benzina: roll(E.benzina), cibo: roll(E.cibo) } };
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
