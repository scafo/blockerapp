// Stato logico di una run: nessuna dipendenza da Phaser.
import { BALANCE } from '../config/balance';
import { NEIGHBORS } from '../map/hexGrid';
import { createRng, type Rng } from '../map/rng';
import type { RunMap, Tile } from '../map/generate';

export const NEUTRAL = -1;
export const PLAYER = 0;

export interface Faction {
  id: number;
  troops: number;
  tiles: number;
  maxTiles: number;
  loot: number; // per il giocatore è lo zaino della run
  alive: boolean;
}

export type RunEvent =
  | { type: 'conquer'; by: number; from: number; i: number; cost: number; loot: number }
  | { type: 'eliminated'; faction: number; by: number; loot: number };

export type ConquerResult =
  | { ok: true; tile: Tile; cost: number; loot: number }
  | { ok: false; reason: 'not-adjacent' | 'impassable' | 'owned' | 'troops'; need?: number };

export class RunState {
  readonly owner: Int8Array;
  readonly factions: Faction[];
  gameTimeMs = 0;
  speed = 1;
  over: null | 'eliminated' = null;
  /** Eventi da mostrare; la scena li consuma con drainEvents(). */
  private events: RunEvent[] = [];
  private tickAcc = 0;
  private frontierCache = new Map<number, number[]>();
  private aiRng: Rng;

  constructor(readonly map: RunMap) {
    this.owner = new Int8Array(map.tiles.length).fill(NEUTRAL);
    this.aiRng = createRng(map.seed + ':ia');
    this.factions = map.starts.map((_, id) => ({
      id,
      troops: id === PLAYER ? BALANCE.start.troops : BALANCE.ai.startTroops,
      tiles: 0,
      maxTiles: 0,
      loot: 0,
      alive: true,
    }));
    map.starts.forEach((s, f) => {
      this.claim(f, s);
      if (BALANCE.start.radius < 1) return;
      for (const n of NEIGHBORS[s]) {
        if (n >= 0 && this.passable(n) && this.owner[n] === NEUTRAL) this.claim(f, n);
      }
    });
  }

  // --- accessi comodi per il giocatore ---
  get player() {
    return this.factions[PLAYER];
  }
  get troops() {
    return this.player.troops;
  }
  set troops(v: number) {
    this.player.troops = v;
  }
  get tilesOwned() {
    return this.player.tiles;
  }
  get maxTiles() {
    return this.player.maxTiles;
  }
  get backpack() {
    return this.player.loot;
  }
  get troopsPerSecond(): number {
    return (this.growth(this.player) * 1000) / BALANCE.tick.ms;
  }

  drainEvents(): RunEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Avanza il tempo; ritorna quanti tick sono scattati. */
  update(deltaMs: number): number {
    if (this.over) return 0;
    const dt = deltaMs * this.speed;
    this.gameTimeMs += dt;
    this.tickAcc += dt;
    let ticks = 0;
    while (this.tickAcc >= BALANCE.tick.ms && !this.over) {
      this.tickAcc -= BALANCE.tick.ms;
      this.tick();
      ticks++;
    }
    return ticks;
  }

  private growth(f: Faction): number {
    const mult = f.id === PLAYER ? 1 : BALANCE.ai.growthMult;
    return f.tiles * BALANCE.tick.troopsPerTile * mult;
  }

  private tick() {
    for (const f of this.factions) if (f.alive) f.troops += this.growth(f);
    for (const f of this.factions) {
      if (f.id === PLAYER || !f.alive || this.aiRng() > BALANCE.ai.actChance) continue;
      for (let a = 0; a < BALANCE.ai.attacksPerAct; a++) if (!this.aiAttack(f)) break;
    }
  }

  /** IA: attacca la casella vicina più debole, se se lo può permettere. */
  private aiAttack(f: Faction): boolean {
    let best = -1, bestScore = Infinity;
    const grace = this.gameTimeMs < BALANCE.ai.graceMs;
    for (const i of this.frontier(f.id)) {
      if (grace && this.owner[i] === PLAYER) continue;
      const score = this.defenseOf(i) * (this.owner[i] === PLAYER ? BALANCE.ai.playerBias : 1);
      if (score < bestScore || (score === bestScore && this.aiRng() < 0.5)) {
        best = i;
        bestScore = score;
      }
    }
    if (best < 0 || f.troops <= this.defenseOf(best) * BALANCE.ai.reserve) return false;
    return this.attack(f.id, best).ok;
  }

  passable(i: number): boolean {
    const t = this.map.tiles[i];
    return !!t && t.type !== 'tossica';
  }

  /** Difesa attuale: neutrale = base; posseduta = base * mult + presidio del proprietario. */
  defenseOf(i: number): number {
    const t = this.map.tiles[i]!;
    const o = this.owner[i];
    if (o === NEUTRAL) return t.defense;
    const f = this.factions[o];
    const garrison = Math.min((f.troops / Math.max(1, f.tiles)) * BALANCE.owned.garrison, BALANCE.owned.garrisonMax);
    return Math.ceil(t.defense * BALANCE.owned.defenseMult + garrison);
  }

  isFrontier(i: number, f = PLAYER): boolean {
    if (!this.passable(i) || this.owner[i] === f) return false;
    return NEIGHBORS[i].some((n) => n >= 0 && this.owner[n] === f);
  }

  /** Caselle attaccabili adiacenti al territorio della fazione. */
  frontier(f = PLAYER): number[] {
    const cached = this.frontierCache.get(f);
    if (cached) return cached;
    const set = new Set<number>();
    for (let i = 0; i < this.owner.length; i++) {
      if (this.owner[i] !== f) continue;
      for (const n of NEIGHBORS[i]) if (n >= 0 && this.isFrontier(n, f)) set.add(n);
    }
    const out = [...set];
    this.frontierCache.set(f, out);
    return out;
  }

  tryConquer(i: number): ConquerResult {
    return this.attack(PLAYER, i);
  }

  attack(by: number, i: number): ConquerResult {
    const tile = this.map.tiles[i];
    if (!tile || tile.type === 'tossica') return { ok: false, reason: 'impassable' };
    if (this.owner[i] === by) return { ok: false, reason: 'owned' };
    if (!this.isFrontier(i, by)) return { ok: false, reason: 'not-adjacent' };
    const cost = this.defenseOf(i);
    const att = this.factions[by];
    if (att.troops <= cost) return { ok: false, reason: 'troops', need: cost };

    att.troops -= cost;
    const from = this.owner[i];
    if (from !== NEUTRAL) {
      const def = this.factions[from];
      def.troops = Math.max(0, def.troops - (cost - tile.defense * BALANCE.owned.defenseMult)); // perde il presidio
      def.tiles--;
    }
    const loot = tile.loot;
    att.loot += loot;
    tile.loot = 0;
    this.claim(by, i);
    this.events.push({ type: 'conquer', by, from, i, cost, loot });

    if (from !== NEUTRAL && this.factions[from].tiles <= 0) this.eliminate(from, by);
    return { ok: true, tile, cost, loot };
  }

  private eliminate(f: number, by: number) {
    const dead = this.factions[f];
    dead.alive = false;
    dead.troops = 0;
    const released = f === PLAYER ? 0 : Math.floor(dead.loot * BALANCE.ai.releaseLootShare);
    this.factions[by].loot += released;
    this.events.push({ type: 'eliminated', faction: f, by, loot: released });
    if (f === PLAYER) this.over = 'eliminated';
  }

  private claim(f: number, i: number) {
    this.owner[i] = f;
    const fac = this.factions[f];
    fac.tiles++;
    fac.maxTiles = Math.max(fac.maxTiles, fac.tiles);
    this.frontierCache.clear();
  }
}
