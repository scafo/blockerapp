// Punto unico (futuro) di lettura/scrittura del profilo, con un emettitore di eventi per chi vuole reagire ai cambi.
// Finché RunScene/CampScene continuano a chiamare loadProfile/saveProfile direttamente, get() rilegge sempre
// localStorage (nessuna cache che può disallinearsi): la cache si attiva solo quando una milestone futura fa
// diventare profileStore l'unico punto di lettura/scrittura (vedi piano, milestone B1).
import { loadProfile, saveProfile, type Profile } from './storage';
import { backupProfile } from './backup';

export type ProfileEvent = 'stash' | 'construction' | 'research' | 'expedition' | 'profile';

type Listener = (p: Profile) => void;
const listeners: Record<ProfileEvent, Set<Listener>> = {
  stash: new Set(), construction: new Set(), research: new Set(), expedition: new Set(), profile: new Set(),
};

export const profileStore = {
  /** Legge il profilo corrente (sempre da localStorage, per ora: vedi nota sopra). */
  get(): Profile {
    return loadProfile();
  },

  /** Salva il profilo e avvisa chi ascolta gli eventi indicati (default: solo 'profile'). */
  save(p: Profile, events: ProfileEvent[] = ['profile']): void {
    saveProfile(p);
    backupProfile(p); // copia in IndexedDB, non bloccante: non è la difesa principale (vedi backup.ts)
    for (const e of events) for (const fn of listeners[e]) fn(p);
  },

  /** Legge, applica `fn`, salva, avvisa. Comodo per un cambio puntuale senza ripetere get/save. */
  update(fn: (p: Profile) => void, events: ProfileEvent[] = ['profile']): Profile {
    const p = this.get();
    fn(p);
    this.save(p, events);
    return p;
  },

  /** Ascolta un evento (stash cambiato, cantiere, ricerca, spedizione, o profilo in generale). */
  on(event: ProfileEvent, fn: Listener): () => void {
    listeners[event].add(fn);
    return () => listeners[event].delete(fn);
  },
};
