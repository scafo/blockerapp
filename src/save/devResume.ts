// Solo sviluppo: la partita in corso si salva ogni pochi secondi (IndexedDB) e, quando Vite ricarica la pagina per una
// modifica al codice, riprende da lì invece di ripartire dalla schermata iniziale (Nico: ogni modifica azzerava la partita).
// Un ricaricamento fatto a mano riparte da capo come sempre: si riprende solo dopo un ricaricamento di Vite.
import { FACTION_INFO } from '../game/factions';
import type { RunState } from '../game/RunState';
import type { RunOptions } from '../game/camp';
import type { FactionKind } from '../map/generate';

const DB = 'ashen-dev', STORE = 'resume', FLAG = 'aa-hmr-reload';
// una partita salvata per scheda: due schede aperte (o una di prova) non si sovrascrivono a vicenda
const KEY = (() => {
  try {
    let id = sessionStorage.getItem('aa-tab');
    if (!id) { id = Math.random().toString(36).slice(2); sessionStorage.setItem('aa-tab', id); }
    return `run-${id}`;
  } catch { return 'run'; }
})();

export interface ResumeData {
  seed: string;
  opts: RunOptions;
  kinds: FactionKind[];
  factions: Record<string, unknown>[];
  state: Record<string, unknown>;
  cam: { x: number; y: number; zoom: number };
  at: number;
}

export const DEV = import.meta.env.DEV;

// Vite sta per ricaricare la pagina (modifica al codice): segna che al prossimo avvio si riprende
if (import.meta.hot) import.meta.hot.on('vite:beforeFullReload', () => { try { sessionStorage.setItem(FLAG, '1'); } catch { /* niente */ } });

function db(): Promise<IDBDatabase> {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}

/** Campi della partita da copiare: tutto tranne la carta (si rigenera dal seme), le opzioni e le funzioni (generatori casuali). */
function snapshot(st: RunState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(st)) {
    if (k === 'map' || k === 'opts' || typeof v === 'function') continue;
    out[k] = v;
  }
  return out;
}

let busy = false;
export async function saveResume(st: RunState, seed: string, kinds: FactionKind[], cam: { x: number; y: number; zoom: number }) {
  if (!DEV || busy) return;
  busy = true;
  try {
    const data: ResumeData = { seed, opts: st.opts, kinds: [...kinds], factions: FACTION_INFO.map((f) => ({ ...f })), state: snapshot(st), cam, at: Date.now() };
    const d = await db();
    await new Promise<void>((ok, ko) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data, KEY); // copia strutturata: array tipizzati, Set e Map passano così come sono
      tx.oncomplete = () => ok();
      tx.onerror = () => ko(tx.error);
    });
    d.close();
  } catch {
    /* salvataggio di sviluppo: se non riesce, pazienza */
  } finally {
    busy = false;
  }
}

/** All'avvio: la partita salvata, solo se la pagina l'ha ricaricata Vite (e non è troppo vecchia). */
export async function takeResume(): Promise<ResumeData | null> {
  if (!DEV) return null;
  let flag = false;
  try { flag = sessionStorage.getItem(FLAG) === '1'; sessionStorage.removeItem(FLAG); } catch { /* niente */ }
  if (!flag || new URLSearchParams(location.search).has('fresh')) return null;
  try {
    const d = await db();
    const data = await new Promise<ResumeData | undefined>((ok, ko) => {
      const r = d.transaction(STORE).objectStore(STORE).get(KEY);
      r.onsuccess = () => ok(r.result as ResumeData | undefined);
      r.onerror = () => ko(r.error);
    });
    d.close();
    return data && Date.now() - data.at < 30 * 60_000 ? data : null;
  } catch {
    return null;
  }
}

/** Partita finita o abbandonata: niente da riprendere. */
export async function clearResume() {
  if (!DEV) return;
  try {
    const d = await db();
    d.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY);
    d.close();
  } catch { /* niente */ }
}

/** Rimette i campi salvati nella partita appena creata (stessa carta, stesse dimensioni). */
export function applyResume(st: RunState, data: ResumeData) {
  data.factions.forEach((f, i) => { if (FACTION_INFO[i]) Object.assign(FACTION_INFO[i], f); });
  const s = st as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(data.state)) {
    const cur = s[k];
    if (ArrayBuffer.isView(cur) && ArrayBuffer.isView(v) && (cur as Uint8Array).length === (v as Uint8Array).length && cur.constructor === v.constructor) {
      (cur as Uint8Array).set(v as Uint8Array);
    } else if (cur instanceof Set && v instanceof Set) {
      cur.clear();
      for (const x of v) cur.add(x);
    } else if (cur instanceof Map && v instanceof Map) {
      cur.clear();
      for (const [a, b] of v) cur.set(a, b);
    } else {
      try { s[k] = v; } catch { /* campo di sola lettura: resta quello nuovo */ }
    }
  }
}
