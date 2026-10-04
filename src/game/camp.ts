// Accampamento: edifici, cantiere, spedizioni e ciò che cambiano nelle run. Niente Phaser.
import { BALANCE, type AbilityType, type Resource, type CampaignId, type CivId, type FrontDef, type UnitType } from '../config/balance';
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
  stake: Bag; // risorse messe in gioco (già tolte dal Deposito all'avvio)
  stakeMult: number; // moltiplicatore del guadagno oltre la puntata
  exitFee: number; // ritirata: quota dello zaino persa
  playerName: string; // nome del comandante ('' = TU)
  units: UnitType[];
  unitHpMult: number;
  events: number; // 0 nessuno, 1 comuni, 2 anche rari
  eliminatedLoss: number;
  retreatBonus: number;
  tutorial: boolean; // prima run guidata
  fog: boolean; // nebbia di guerra
  civ: CivId; // civiltà del giocatore
  campaign: CampaignId;
  endMs: number; // durata della campagna (Centro di Comando: un po' di tempo in più)
  front: FrontDef; // difficoltà: forza delle IA
  frontIndex: number;
  techs: string[]; // ricerche fatte (sbloccano costruzioni)
  campaignLootMult: number; // campagne lunghe = più risorse a casa
  mods: Mods;
  abilities: AbilityType[]; // abilità a ricarica sbloccate
  maxUnitsBonus: number;
  abilityCdMult: number;
}

/** Tutto sbloccato, niente eventi: usato dal simulatore e come ripiego. */
export const DEFAULT_OPTIONS: RunOptions = {
  units: ['fanteria', 'ricognitori', 'artiglieria'], unitHpMult: 1, events: 0,
  eliminatedLoss: BALANCE.end.eliminatedLoss, retreatBonus: 0, tutorial: false, fog: false,
  civ: 'republica', campaign: 'standard', playerName: '', stake: { metallo: 0, benzina: 0, cibo: 0 }, stakeMult: 1, exitFee: 0, endMs: BALANCE.campaigns.standard.durationMs, campaignLootMult: 1, mods: BASE_MODS,
  front: BALANCE.fronts[0], frontIndex: 0, techs: [],
  abilities: [], maxUnitsBonus: 0, abilityCdMult: 1,
};

/** Truppe sbloccate dall'albero della ricerca (ramo Armamenti): Fanteria sempre, il resto si ricerca. */
export function unlockedUnits(p: Profile, civ: CivId = activeCiv(p)): UnitType[] {
  const units: UnitType[] = ['fanteria'];
  for (const id of p.techs) {
    const t = BALANCE.tech[id];
    if (t?.unit) units.push(t.unit);
    if (t?.unique) units.push(civInfo(civ).unit);
  }
  return units;
}

/** Abilità ricercate (Ricognizione aerea, Bombardamento). */
export const unlockedAbilities = (p: Profile): AbilityType[] =>
  p.techs.map((id) => BALANCE.tech[id]?.ability).filter((a): a is AbilityType => !!a);

/** Mazzo della campagna: le scelte del giocatore ancora valide, completate con le sbloccate fino a 4. */
export function deckOf(p: Profile, civ: CivId = activeCiv(p)): UnitType[] {
  const open = unlockedUnits(p, civ);
  const deck = (p.deck ?? []).filter((t) => open.includes(t)).slice(0, BALANCE.units.deckSize);
  for (const t of open) if (deck.length < BALANCE.units.deckSize && !deck.includes(t)) deck.push(t);
  return deck;
}

/** Civiltà e durata davvero disponibili (le scelte si sbloccano con le campagne giocate). */
export const civChoice = (p: Profile) => p.runs >= BALANCE.progression.civChoiceAfterRuns;
export const campaignChoice = (p: Profile) => p.runs >= BALANCE.progression.campaignChoiceAfterRuns;
export const activeCiv = (p: Profile): CivId => (civChoice(p) && civUnlocked(p, p.civ) ? p.civ : 'republica');
export const activeCampaign = (p: Profile): CampaignId => (campaignChoice(p) ? p.campaign : 'standard');
/** Fronte scelto (mai oltre l'ultimo sbloccato). */
export const activeFront = (p: Profile): number => Math.max(0, Math.min(p.front ?? 0, p.frontMax ?? 0, BALANCE.fronts.length - 1));

/** Potenza del giocatore: livelli delle postazioni e ricerche fatte (si confronta con quella consigliata del fronte). */
export function playerPower(p: Profile): number {
  const W = BALANCE.power;
  const b = p.buildings;
  return b.arsenale * W.arsenale + b.comando * W.comando + b.laboratorio * W.laboratorio + b.deposito * W.deposito + b.radar * W.radar
    + p.techs.filter((id) => id in BALANCE.tech).length * W.tech;
}

const emptyStake = (): Bag => ({ metallo: 0, benzina: 0, cibo: 0 });

/** Puntata scelta, ridotta a quella che il Deposito può coprire. */
export function stakeIndex(p: Profile): number {
  let k = Math.min(p.stake ?? 0, BALANCE.stake.options.length - 1);
  while (k > 0 && !canStake(p, k)) k--;
  return k;
}

/** Risorse di una puntata: divise in parti uguali tra le tre risorse. */
export function stakeOf(k: number): Bag {
  const n = Math.floor(BALANCE.stake.options[k] / 3);
  return { metallo: n, benzina: n, cibo: n };
}

export const canStake = (p: Profile, k: number) => canAfford(p.stash, stakeOf(k));

export const stakeBag = (p: Profile): Bag => stakeOf(stakeIndex(p));

export function runOptions(p: Profile): RunOptions {
  const { arsenale, comando, deposito, radar } = p.buildings;
  const tutorial = p.runs === 0;
  const civ = activeCiv(p), campaign = activeCampaign(p), front = tutorial ? 0 : activeFront(p);
  // la run guidata resta semplice: niente bonus
  const mods = tutorial ? { ...BASE_MODS } : combine(...civMods(civ), ...techMods(p), { fogBonus: C.radarFogBonus[radar], fogIntel: C.radarIntel[radar] },
    ...supplyMods(p));
  const units = deckOf(p, civ);
  if (p.test) Object.assign(mods, { startTroops: mods.startTroops + BALANCE.test.startTroops });
  if (!tutorial) mods.growthMult *= C.comandoGrowthMult[comando]; // il Centro di Comando organizza la leva
  return {
    abilities: tutorial ? [] : unlockedAbilities(p),
    maxUnitsBonus: C.comandoMaxUnitsBonus[comando],
    abilityCdMult: C.comandoAbilityCdMult[comando] * (p.test ? BALANCE.test.abilityCdMult : 1),
    civ, campaign, mods, playerName: p.name ?? '',
    stake: tutorial ? emptyStake() : stakeBag(p), stakeMult: tutorial ? 1 : BALANCE.stake.mult[stakeIndex(p)],
    exitFee: tutorial ? 0 : Math.max(0, BALANCE.stake.exitFee - C.depositoRetreatBonus[deposito]),
    endMs: BALANCE.campaigns[campaign].durationMs + C.comandoTimeBonusMs[comando],
    campaignLootMult: BALANCE.campaigns[campaign].lootMult * BALANCE.fronts[front].lootMult,
    front: BALANCE.fronts[front],
    frontIndex: front,
    techs: tutorial ? [] : [...p.techs],
    units,
    unitHpMult: C.arsenaleHpMult[arsenale] * mods.unitHpMult,
    events: C.comandoEvents[comando],
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
  p.construction = { id, until: now + (p.test ? 0 : lvl.timeSec * 1000) };
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
  p.expedition = { kind, until: now + (p.test ? 0 : expeditionTimeSec(p, kind) * 1000), reward: { metallo: roll(E.metallo), benzina: roll(E.benzina), cibo: roll(E.cibo) } };
  return true;
}

/** Capienza del Deposito per risorsa (modalità test: senza limite). */
export const stashCap = (p: Profile): number => (p.test ? Infinity : C.depositoCap[p.buildings.deposito] ?? C.depositoCap[0]);

/** Aggiunge alla scorta fino alla capienza; ritorna quanto va perso perché il Deposito è pieno. */
export function addToStash(p: Profile, bag: Bag): number {
  const cap = stashCap(p);
  let lost = 0;
  for (const r of RESOURCES) {
    const v = p.stash[r] + bag[r];
    lost += Math.max(0, v - Math.max(cap, p.stash[r]));
    p.stash[r] = Math.min(v, Math.max(cap, p.stash[r]));
  }
  return lost;
}

// ---------- mercato ----------

export type SupplyId = keyof typeof BALANCE.shop.supplies;
export const SUPPLIES = Object.keys(BALANCE.shop.supplies) as SupplyId[];
const supplyMods = (p: Profile): Partial<Mods>[] =>
  (p.supplies ?? []).filter((k): k is SupplyId => k in BALANCE.shop.supplies).map((k) => BALANCE.shop.supplies[k].mods as Partial<Mods>);

/** Scambio al Mercato: dai `give` di una risorsa, ricevi `get` di un'altra. */
export function trade(p: Profile, from: Resource, to: Resource): boolean {
  const T = BALANCE.shop.trade;
  if (from === to || p.stash[from] < T.give) return false;
  p.stash[from] -= T.give;
  addToStash(p, { metallo: 0, benzina: 0, cibo: 0, [to]: T.get });
  return true;
}

/** Rifornimento per la prossima campagna (uno per tipo). */
export function buySupply(p: Profile, k: SupplyId): boolean {
  const cost = BALANCE.shop.supplies[k].cost;
  if ((p.supplies ?? []).includes(k) || !canAfford(p.stash, cost)) return false;
  pay(p.stash, cost);
  p.supplies = [...(p.supplies ?? []), k];
  return true;
}

/** Metallo per finire subito un lavoro che finisce a `until`. */
export const rushCost = (until: number, now: number) => Math.max(1, Math.ceil((until - now) / 60_000)) * BALANCE.shop.rushPerMin;

/** Finisce subito il cantiere o la ricerca pagando metallo (poi settle/settleResearch li chiudono). */
export function rush(p: Profile, what: 'construction' | 'research', now: number): boolean {
  const job = p[what];
  if (!job || job.until <= now) return false;
  const cost = rushCost(job.until, now);
  if (p.stash.metallo < cost) return false;
  p.stash.metallo -= cost;
  job.until = now;
  return true;
}

/** Campagna lasciata a metà (app chiusa): la puntata rientra come in una ritirata. Ritorna quanto è rientrato (0 = niente). */
export function recoverStake(p: Profile): number {
  const a = p.activeStake;
  if (!a) return 0;
  p.activeStake = null;
  const back = Object.fromEntries(RESOURCES.map((r) => [r, Math.floor(a.bag[r] * (1 - a.fee))])) as Bag;
  addToStash(p, back);
  return RESOURCES.reduce((n, r) => n + back[r], 0);
}

export function collectExpedition(p: Profile, now: number): Bag | null {
  if (!p.expedition || p.expedition.until > now) return null;
  const r = p.expedition.reward;
  addToStash(p, r);
  p.expedition = null;
  p.expeditionsDone++;
  return r;
}

/** Modalità test: tutte le postazioni al massimo, tutte le ricerche, risorse piene, civiltà sbloccate, timer istantanei. */
export function enableTestMode(p: Profile) {
  const T = BALANCE.test;
  p.test = true;
  for (const id of BUILDINGS) p.buildings[id] = C.buildings[id].length;
  p.techs = Object.keys(BALANCE.tech);
  p.stash = { metallo: T.stash, benzina: T.stash, cibo: T.stash };
  p.runs = Math.max(p.runs, T.runs);
  p.wins = Math.max(p.wins, T.wins);
  p.expeditionsDone = Math.max(p.expeditionsDone, T.expeditions);
  p.construction = null;
  p.research = null;
  if (p.expedition) p.expedition.until = 0;
}

export const tents = (p: Profile) => Math.min(C.tentsMax, C.tentsBase + Math.floor(p.runs / 2));

export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(sec).padStart(2, '0')}`;
}
