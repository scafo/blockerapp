// Ordini del giocatore come dati: tutto quello che un giocatore fa al mondo passa da qui (multiplayer a lockstep).
// Solo numeri e stringhe, niente oggetti del motore: un comando si può spedire all'altro computer o salvare e rigiocare.
import type { AbilityType, UnitType, WorkId } from '../config/balance';
import type { Stance } from './units';

export type Cmd =
  | { k: 'conquer'; tile: number }
  | { k: 'plan'; p: number }
  | { k: 'boat'; tile: number }
  | { k: 'deploy'; type: UnitType; tile: number }
  | { k: 'ability'; a: AbilityType; tile: number }
  | { k: 'move'; units: number[]; to: number }
  | { k: 'stance'; units: number[]; stance: Stance }
  | { k: 'front'; units: number[]; faction: number; attack?: boolean }
  | { k: 'hold'; units: number[]; posts: number[] }
  | { k: 'push'; units: number[]; goals: number[]; vias: number[][] }
  | { k: 'release'; units: number[] }
  | { k: 'divide'; units: number[]; size: number; quotas?: number[] }
  | { k: 'zone'; units: number[]; provs: number[] }
  | { k: 'chase'; units: number[]; target: number }
  | { k: 'unpost'; units: number[] }
  | { k: 'band'; units: number[] }
  | { k: 'unband'; units: number[] }
  | { k: 'merge'; units: number[] }
  | { k: 'split'; unit: number }
  | { k: 'retreatUnits'; units: number[] }
  | { k: 'wall'; provs: number[]; work: WorkId }
  | { k: 'war'; f: number }
  | { k: 'peace'; f: number }
  | { k: 'alliance'; f: number }
  | { k: 'breakAlliance'; f: number }
  | { k: 'giveTroops'; f: number }
  | { k: 'giveLoot'; f: number }
  | { k: 'tribute'; f: number }
  | { k: 'event'; side: 'left' | 'right'; i: number }
  | { k: 'place'; p: number }
  | { k: 'clearStart' }
  | { k: 'pause'; on: boolean }
  | { k: 'retreat' };

/** Comando eseguito: chi l'ha dato e a che tempo di gioco (ms). Il registro basta a rigiocare la partita. */
export interface CmdEntry { t: number; by: number; c: Cmd }
