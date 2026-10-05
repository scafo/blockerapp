// Salvataggio locale del profilo. localStorage può mancare o lanciare: mai far crashare il gioco.
import { emptyBag, type Bag } from '../game/resources';
import type { CampaignId, CivId, UnitType } from '../config/balance';

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
  front?: number; // fronte scelto (difficoltà)
  frontMax?: number; // ultimo fronte sbloccato (si sblocca vincendo il precedente)
  techs: string[]; // ricerche completate
  deck: UnitType[]; // mazzo scelto (max 4 truppe)
  research: { id: string; until: number } | null;
  history: CampaignRecord[]; // registro della Sala Radar (più recenti per prime)
  test?: boolean; // modalità test: tutto sbloccato, timer istantanei
  stake?: number; // ultima puntata scelta (indice di stake.options)
  supplies?: string[]; // rifornimenti comprati al Mercato per la prossima campagna (chiavi di shop.supplies)
  activeStake?: { bag: Bag; fee: number } | null; // puntata della campagna in corso: se l'app si chiude a metà, rientra con la tassa
  name?: string; // nome del comandante (sulla mappa al posto di "TU")
  nameAsked?: boolean; // il nome è già stato chiesto una volta
  tree?: number; // 1 = armamenti già convertiti in ricerche (albero della ricerca)

  // — campi nuovi (piano schermate/retention), tutti opzionali e retrocompatibili —
  firstSeen?: number; // epoch ms della primissima apertura
  lastSeen?: number; // epoch ms dell'ultima apertura (per il rapporto del mattino / premio di rientro)
  sessions?: number; // numero di aperture del gioco
  daysPlayed?: number; // giorni di calendario distinti in cui si è giocato (streak non si azzera mai)
  lastDay?: string; // ultimo giorno (YYYY-MM-DD, ora locale) già contato in daysPlayed
  xp?: number; // merito accumulato (grado del comandante)
  rank?: number; // grado attuale (indice in merit.tiers)
  orders?: { day: string; ids: string[]; done: string[]; rerolled: boolean } | null; // ordini del giorno attivi
  stars?: Record<number, number>; // stelle ottenute per fronte (bitmask: 1 vittoria, 2 capitale mai persa, 4 vittoria veloce)
  medals?: string[]; // onorificenze ottenute (chiavi)
  patch?: string; // toppa di reparto scelta (decorativa)
  loreSeen?: string[]; // documenti dell'archivio della Caduta già letti
  eventSeen?: string[]; // eventi di carta già visti in questa run (si azzera a ogni campagna da chi gestisce la run)
  records?: Record<string, number>; // record personali (es. province massime per fronte)
  renditaAt?: number; // epoch ms dell'ultimo ritiro della rendita del Centro di Comando
  daily?: Record<string, number>; // contatori giornalieri generici (chiave = id + giorno)
  weekly?: Record<string, number>; // contatori settimanali generici (riservato all'operazione della settimana)
  bestProvinces?: number; // record di province in una run (sostituisce bestTiles, che resta solo nello storico)
}

export interface CampaignRecord {
  at: number; // epoch ms
  civ: CivId;
  campaign: CampaignId;
  outcome: string;
  tiles: number;
  timeMs: number;
  provinces?: number; // province massime raggiunte (sostituisce tiles per le run nuove)
  front?: number; // fronte giocato
  kept?: number; // bottino totale portato a casa
  stake?: number; // puntata totale messa in gioco
}

const REAL_KEY = 'ashen-atlas:profile';
let ACTIVE_KEY = REAL_KEY;

/**
 * Sposta dove si legge/scrive il profilo (solo per i profili di prova di devProfiles.ts: ?profile=...).
 * Da chiamare una sola volta, molto presto, prima di ogni loadProfile/saveProfile/hasLocalProfile.
 */
export function setActiveProfileKey(key: string): void {
  ACTIVE_KEY = key;
}

/** True se un profilo di prova (?profile=...) è attivo: il ripristino da IndexedDB e il backup lo rispettano. */
export const isDevProfile = (): boolean => ACTIVE_KEY !== REAL_KEY;

/** True se c'è già un profilo in localStorage (per capire se vale la pena tentare un ripristino da IndexedDB). */
export function hasLocalProfile(): boolean {
  try {
    return !!localStorage.getItem(ACTIVE_KEY);
  } catch {
    return false;
  }
}

export const freshProfile = (): Profile => ({
  v: 1, stash: emptyBag(), runs: 0, wins: 0, bestTiles: 0,
  buildings: { arsenale: 0, comando: 0, deposito: 0, laboratorio: 0, radar: 0 }, construction: null, expedition: null, expeditionsDone: 0,
  civ: 'republica', campaign: 'standard', techs: [], deck: [], research: null, history: [], tree: 1,
  firstSeen: Date.now(), lastSeen: Date.now(), sessions: 0, daysPlayed: 0, xp: 0, rank: 0, bestProvinces: 0,
  orders: null, stars: {}, medals: [], loreSeen: [], eventSeen: [], records: {}, daily: {}, weekly: {},
});

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
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
  // prima dell'albero l'Arsenale sbloccava le armi da solo: chi le aveva le tiene come ricerche fatte
  if (!p.tree) {
    const lvl = p.buildings?.arsenale ?? 0;
    const byLevel = [[], ['ricognitori'], ['artiglieria'], ['corazzati', 'genio'], ['cannoniera'], ['munizioni', 'ricognizione', 'bombardamento'], ['unica']];
    const techs = new Set<string>(p.techs ?? []);
    for (let l = 1; l <= Math.min(lvl, 6); l++) for (const id of byLevel[l]) techs.add(id);
    p.techs = [...techs];
    p.tree = 1;
  }
  return p;
}

/** Profilo nuovo, da zero (anche per uscire dalla modalità test). */
export function resetProfile(): Profile {
  const p = freshProfile();
  saveProfile(p);
  return p;
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(p));
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
