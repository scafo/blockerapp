// Stato logico di una run: nessuna dipendenza da Phaser.
import { BALANCE } from '../config/balance';
import { NEIGHBORS } from '../map/hexGrid';
import type { RunMap, Tile } from '../map/generate';

export const NEUTRAL = -1;
export const PLAYER = 0;

export type ConquerResult =
  | { ok: true; tile: Tile; cost: number; loot: number }
  | { ok: false; reason: 'not-adjacent' | 'impassable' | 'owned' | 'troops'; need?: number };

export class RunState {
  readonly owner: Int8Array;
  troops: number = BALANCE.start.troops;
  tilesOwned = 0;
  maxTiles = 0;
  backpack = 0;
  gameTimeMs = 0;
  speed = 1;
  private tickAcc = 0;
  private frontierCache: number[] | null = null;

  constructor(readonly map: RunMap) {
    this.owner = new Int8Array(map.tiles.length).fill(NEUTRAL);
    this.claim(map.start);
    for (const n of NEIGHBORS[map.start]) {
      const t = n >= 0 ? map.tiles[n] : null;
      if (BALANCE.start.radius >= 1 && t && t.type !== 'tossica') this.claim(n);
    }
  }

  /** Avanza il tempo; ritorna quanti tick sono scattati. */
  update(deltaMs: number): number {
    const dt = deltaMs * this.speed;
    this.gameTimeMs += dt;
    this.tickAcc += dt;
    let ticks = 0;
    while (this.tickAcc >= BALANCE.tick.ms) {
      this.tickAcc -= BALANCE.tick.ms;
      this.troops += this.tilesOwned * BALANCE.tick.troopsPerTile;
      ticks++;
    }
    return ticks;
  }

  get troopsPerSecond(): number {
    return (this.tilesOwned * BALANCE.tick.troopsPerTile * 1000) / BALANCE.tick.ms;
  }

  isFrontier(i: number): boolean {
    const t = this.map.tiles[i];
    if (!t || t.type === 'tossica' || this.owner[i] === PLAYER) return false;
    return NEIGHBORS[i].some((n) => n >= 0 && this.owner[n] === PLAYER);
  }

  /** Caselle conquistabili adiacenti al territorio del giocatore. */
  frontier(): number[] {
    if (this.frontierCache) return this.frontierCache;
    const set = new Set<number>();
    for (let i = 0; i < this.owner.length; i++) {
      if (this.owner[i] !== PLAYER) continue;
      for (const n of NEIGHBORS[i]) if (n >= 0 && this.isFrontier(n)) set.add(n);
    }
    return (this.frontierCache = [...set]);
  }

  tryConquer(i: number): ConquerResult {
    const tile = this.map.tiles[i];
    if (!tile || tile.type === 'tossica') return { ok: false, reason: 'impassable' };
    if (this.owner[i] === PLAYER) return { ok: false, reason: 'owned' };
    if (!this.isFrontier(i)) return { ok: false, reason: 'not-adjacent' };
    if (this.troops <= tile.defense) return { ok: false, reason: 'troops', need: tile.defense };

    this.troops -= tile.defense;
    const cost = tile.defense;
    const loot = tile.loot;
    this.backpack += loot;
    tile.loot = 0;
    this.claim(i);
    return { ok: true, tile, cost, loot };
  }

  private claim(i: number) {
    this.owner[i] = PLAYER;
    this.tilesOwned++;
    this.maxTiles = Math.max(this.maxTiles, this.tilesOwned);
    this.frontierCache = null;
  }
}
