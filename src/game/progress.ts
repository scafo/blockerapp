// Cosa succede al profilo a fine campagna: registro, sblocco del fronte successivo, record, e il gancio per
// far reagire le meccaniche future (grado, ordini del giorno, ecc.) senza che tocchino questo file o camp.ts.
import { BALANCE } from '../config/balance';
import { RESOURCES } from './resources';
import { addToStash } from './camp';
import type { RunSummary } from './RunState';
import type { Profile } from '../save/storage';

export interface RunResult {
  lostCap: number; // bottino perso perché il Deposito era pieno
  unlocked: number; // -1 = nessun fronte nuovo sbloccato, altrimenti il suo indice
}

type RunHook = (p: Profile, sum: RunSummary, result: RunResult) => void;
const hooks: RunHook[] = [];

/** Agganciati qui per reagire a ogni fine campagna, senza toccare camp.ts o questo file (es. E3, E4, E8, E9). */
export function registerRunHook(fn: RunHook): void {
  hooks.push(fn);
}

/** Documenti/eventi di carta già visti: evita ripetizioni, usato da C1 (HUD) senza che tocchi camp.ts/progress.ts. */
export function getEventSeen(p: Profile): string[] {
  return p.eventSeen ?? [];
}

export function markEventSeen(p: Profile, id: string): void {
  p.eventSeen = [...getEventSeen(p), id];
}

/** Applica a `p` il risultato di una campagna finita (bottino, registro, sblocco fronte, record). Non salva da sola. */
export function applyRunResult(p: Profile, sum: RunSummary, now: number): RunResult {
  const lostCap = addToStash(p, sum.kept);
  p.activeStake = null; // la puntata è stata giocata fino in fondo
  p.runs++;
  p.history = [
    { at: now, civ: sum.civ, campaign: sum.campaign, outcome: sum.outcome, tiles: sum.maxTiles, timeMs: sum.timeMs,
      provinces: sum.maxProvinces, front: sum.front, kept: Object.values(sum.kept).reduce((a, b) => a + b, 0),
      stake: Object.values(sum.stake).reduce((a, b) => a + b, 0) },
    ...(p.history ?? []),
  ].slice(0, 20);
  if (sum.outcome === 'victory') p.wins++;

  // vittoria sull'ultimo fronte sbloccato: si apre il successivo (e diventa quello scelto)
  let unlocked = -1;
  if (sum.outcome === 'victory' && !sum.tutorial && sum.front >= (p.frontMax ?? 0) && sum.front < BALANCE.fronts.length - 1) {
    unlocked = p.frontMax = sum.front + 1;
    p.front = unlocked;
  }

  p.bestTiles = Math.max(p.bestTiles, sum.maxTiles);
  p.bestProvinces = Math.max(p.bestProvinces ?? 0, sum.maxProvinces);

  // la run guidata deve sempre bastare per il primo miglioramento del Centro di Comando, qualunque sia andata
  if (sum.tutorial) {
    const need = BALANCE.camp.buildings.comando[0].cost;
    for (const r of RESOURCES) if (p.stash[r] < need[r]) p.stash[r] = need[r];
  }

  const result: RunResult = { lostCap, unlocked };
  for (const hook of hooks) hook(p, sum, result);
  return result;
}
