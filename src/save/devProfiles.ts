// Profili sintetici per il controllo visivo (?profile=nuovo|dopo1|medio|max): vivono su una chiave separata,
// mai sulla chiave vera 'ashen-atlas:profile' (vedi setActiveProfileKey in storage.ts). Da chiamare una sola
// volta, molto presto (main.ts), prima che qualunque scena chiami loadProfile().
import { BALANCE } from '../config/balance';
import { freshProfile, setActiveProfileKey, type Profile } from './storage';

export type DevProfileId = 'nuovo' | 'dopo1' | 'medio' | 'max';
const IDS: DevProfileId[] = ['nuovo', 'dopo1', 'medio', 'max'];

function dopo1(): Profile {
  const p = freshProfile();
  p.runs = 1;
  p.wins = 1;
  p.buildings.comando = 1;
  p.stash = { metallo: 60, benzina: 20, cibo: 40 };
  return p;
}

function medio(): Profile {
  const p = freshProfile();
  p.runs = 8;
  p.wins = 5;
  p.frontMax = 2;
  p.front = 2;
  p.buildings = { arsenale: 3, comando: 3, laboratorio: 2, radar: 1, deposito: 2 };
  p.techs = ['ricognitori', 'artiglieria', 'corazzati'];
  p.stash = { metallo: 420, benzina: 180, cibo: 260 };
  return p;
}

function max(): Profile {
  const p = freshProfile();
  const T = BALANCE.test;
  p.runs = 30;
  p.wins = 22;
  p.frontMax = BALANCE.fronts.length - 1;
  p.front = p.frontMax;
  for (const id of ['arsenale', 'comando', 'laboratorio', 'radar', 'deposito'] as const) p.buildings[id] = BALANCE.camp.buildings[id].length;
  p.techs = Object.keys(BALANCE.tech);
  p.stash = { metallo: T.stash, benzina: T.stash, cibo: T.stash };
  return p;
}

const BUILD: Record<DevProfileId, () => Profile> = { nuovo: freshProfile, dopo1, medio, max };

/**
 * Se l'URL ha ?profile=<id> valido, sposta il salvataggio su una chiave dedicata e, se è vuota, la riempie col
 * profilo sintetico corrispondente. Da chiamare una sola volta, prima di ogni loadProfile(). Senza effetto altrimenti.
 */
export function initDevProfile(): void {
  const id = new URLSearchParams(location.search).get('profile') as DevProfileId | null;
  if (!id || !IDS.includes(id)) return;
  const key = `ashen-atlas:profile:dev:${id}`;
  setActiveProfileKey(key);
  try {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(BUILD[id]()));
  } catch {
    /* si gioca lo stesso, solo in memoria per questa sessione */
  }
}
