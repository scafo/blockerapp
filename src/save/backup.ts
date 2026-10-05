// Difesa del salvataggio: localStorage può sparire (Safari/ITP lo cancella dopo ~7 giorni di inattività, "pulizia
// spazio" del telefono, cambio browser). La difesa VERA è il codice esportabile che il giocatore può copiare altrove
// (sezione Impostazioni, milestone S7): la copia in IndexedDB qui sotto aiuta solo nei casi più comuni (chiusura
// imprevista, aggiornamento dell'app) e NON va considerata affidabile da sola.
import { loadProfile, saveProfile, hasLocalProfile, isDevProfile, type Profile } from './storage';

const DB_NAME = 'ashen-atlas';
const STORE = 'backup';
const KEY = 'profile';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Chiede al browser di non svuotare lo storage senza avviso (non garantito, ma aiuta). */
export async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* non disponibile: pazienza */
  }
}

/** Copia il profilo in IndexedDB. Da chiamare dopo ogni saveProfile. Mai bloccante. Ignora i profili di prova. */
export async function backupProfile(p: Profile): Promise<void> {
  if (isDevProfile()) return;
  try {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(p, KEY);
    await new Promise((res) => { tx.oncomplete = res; tx.onerror = res; });
    db.close();
  } catch {
    /* backup best-effort */
  }
}

/** Legge l'ultimo profilo salvato in IndexedDB, se c'è (per ripristinare se localStorage è vuoto). */
export async function restoreFromBackup(): Promise<Profile | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(KEY);
    const result = await new Promise<Profile | null>((res) => {
      req.onsuccess = () => res((req.result as Profile) ?? null);
      req.onerror = () => res(null);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

/**
 * Se localStorage è vuoto (prima apertura vera o storage cancellato), prova a ripristinare da IndexedDB
 * prima che il gioco decida "prima run mai fatta". Da chiamare una sola volta, in BootScene, prima di loadProfile().
 */
export async function restoreIfEmpty(): Promise<void> {
  if (isDevProfile() || hasLocalProfile()) return;
  const p = await restoreFromBackup();
  if (p) saveProfile(p);
}

/** Codice di backup esportabile: il profilo intero in base64, da copiare e incollare altrove (Impostazioni, S7). */
export function exportBackupCode(p: Profile = loadProfile()): string {
  return btoa(encodeURIComponent(JSON.stringify(p)));
}

export function importBackupCode(code: string): Profile | null {
  try {
    return JSON.parse(decodeURIComponent(atob(code.trim()))) as Profile;
  } catch {
    return null;
  }
}
