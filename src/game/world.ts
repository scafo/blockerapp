// Impero persistente: sullo stesso fronte il mondo resta tra una campagna e l'altra. Stessa mappa e stessa partenza,
// riprendi il nucleo attorno alla capitale, i rivali hanno lo stesso nome e si ricordano di te, gli imperi caduti restano
// caduti (al loro posto nasce una milizia). Vincere il fronte chiude il mondo: la campagna dopo ne apre uno nuovo.
import type { CivId } from '../config/balance';
import type { RunMap } from '../map/generate';
import type { Profile, WorldSave } from '../save/storage';
import type { RunOptions } from './camp';
import { CIV_STYLE, FACTION_INFO } from './factions';
import type { RunSummary } from './RunState';

/** Il mondo in corso per questo fronte, o null se la prossima campagna ne apre uno nuovo. */
export const currentWorld = (p: Profile, front: number): WorldSave | null =>
  p.world && p.world.front === front ? p.world : null;

/** Prima di generare la mappa: apre (o riprende) il mondo, mette in `opts` l'eredità e dice con che seed generare. */
export function enterWorld(p: Profile, opts: RunOptions, seed: string): WorldSave {
  let w = currentWorld(p, opts.frontIndex);
  if (!w) w = p.world = { seed, front: opts.frontIndex, campaigns: 0, core: [], fallen: [], rivals: [] };
  opts.world = { campaign: w.campaigns, core: [...w.core], rivals: w.rivals.map(({ id, relation, opinion }) => ({ id, relation, opinion })) };
  return w;
}

/** Dopo generateMap, prima di setupFactions: gli imperi caduti diventano milizie. */
export function fallenToBots(map: RunMap, w: WorldSave) {
  for (const f of w.fallen) if (map.kinds[f] === 'empire') map.kinds[f] = 'bot';
}

/** Dopo setupFactions: i rivali tengono il nome della prima campagna (alla prima campagna lo si segna). */
export function keepRivalNames(w: WorldSave, player: CivId) {
  if (!w.rivals.length) {
    FACTION_INFO.forEach((f, id) => {
      if (f.kind === 'empire' && f.civ) w.rivals.push({ id, name: f.name, short: f.short, civ: f.civ, relation: 'pace', opinion: 0 });
    });
    return;
  }
  for (const r of w.rivals) {
    const f = FACTION_INFO[r.id];
    if (!f || f.kind !== 'empire' || r.civ === player) continue; // stessa potenza tua: tiene i colori nuovi per non confondersi
    Object.assign(f, { name: r.name, short: r.short, civ: r.civ, ...CIV_STYLE[r.civ] });
  }
}

/** A campagna chiusa: la vittoria chiude il mondo, altrimenti si segna cosa resta per la prossima. */
export function recordWorld(p: Profile, sum: RunSummary) {
  const w = p.world;
  if (sum.tutorial || !w || w.front !== sum.front || w.seed !== sum.seed || !sum.world) return;
  if (sum.outcome === 'victory') {
    p.world = null;
    return;
  }
  w.campaigns++;
  w.core = sum.world.core;
  w.fallen = [...new Set([...w.fallen, ...sum.world.fallen])];
  w.rivals = w.rivals.flatMap((r) => {
    const now = sum.world!.rivals.find((x) => x.id === r.id);
    return now ? [{ ...r, relation: now.relation, opinion: now.opinion }] : []; // chi è caduto esce dalla memoria
  });
}
