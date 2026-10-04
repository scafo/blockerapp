// Eventi stile Reigns: testo + 2 scelte con effetti. Contenuti in src/data/events.json.
import type { Resource, UnitType } from '../config/balance';
import data from '../data/events.json';

export interface EventEffects {
  troops?: number;
  loot?: Partial<Record<Resource, number>>;
  unit?: UnitType; // pedina gratuita
  growth?: { mult: number; durationMs: number }; // crescita truppe temporanea
  anomalyDefense?: number; // moltiplicatore difesa anomalie per il resto della run
  timeBonusMs?: number; // tempo in più per la campagna
}

export interface EventChoice {
  label: string;
  effects: EventEffects;
  result: string;
  chance?: number; // probabilità di `effects`; altrimenti `fail`
  fail?: EventEffects;
  failResult?: string;
}

export interface GameEvent {
  id: string;
  rare: boolean;
  text: string;
  left: EventChoice;
  right: EventChoice;
}

export const EVENTS = data as GameEvent[];
