// Archivio della Caduta (Nico, 25 novembre 2026: "il 3D per il radar e per scoprire la lore piano piano"): i frammenti della
// lore si trovano con le ricerche della Caduta e con gli eventi rari delle campagne. Nella Sala Radar ogni frammento trovato
// accende una parte del cubo 3D e il suo testo si legge accanto.
import { EVENTS } from './events';
import { techInfo } from './tech';
import type { Profile } from '../save/storage';

export interface Fragment {
  id: string;
  title: string;
  text: string;
  found: boolean;
  hint: string; // dove si trova, finché manca
}

const EVENT_TITLE: Record<string, string> = { frequenza: 'A frequency', archivio: 'The archive of the Concord', cartografo: 'The cartographer' };
const LORE_TECHS = ['segnale', 'frammenti', 'prototipo', 'caduta'];

/** Tutti i frammenti, nell'ordine dell'Archivio: prima le ricerche della Caduta, poi gli eventi rari. */
export function fragments(p: Profile): Fragment[] {
  const seen = new Set(p.loreSeen ?? []);
  return [
    ...LORE_TECHS.map((id) => ({ id, title: techInfo(id).name, text: techInfo(id).lore ?? '', found: p.techs.includes(id), hint: 'Research of the Fall' })),
    ...EVENTS.filter((e) => e.rare).map((e) => ({ id: e.id, title: EVENT_TITLE[e.id] ?? e.id, text: e.text, found: seen.has(e.id), hint: 'Rare campaign event' })),
  ];
}

// il cubo si riempie dal fondo alla cima: ogni passo accende le ricerche del gruppo (i pezzi del cubo sono legati a quelle)
const STEPS = [['trincee'], ['radar', 'fortezze'], ['strade', 'rifornimenti', 'ferrovie'], ['estrazione', 'industria', 'pianificazione'],
  ['addestramento', 'elite'], ['assalto', 'segnale'], ['frammenti', 'prototipo', 'caduta']];

/** Pezzi del cubo da accendere con `found` frammenti su `total`. */
export function archiveCubeTechs(found: number, total: number): string[] {
  const n = total ? Math.round((found / total) * STEPS.length) : 0;
  return STEPS.slice(0, n).flat();
}
