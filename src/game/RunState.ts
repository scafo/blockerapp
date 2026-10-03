// Stato logico di una run: nessuna dipendenza da Phaser.
import { BALANCE, type UnitType } from '../config/balance';
import { NEIGHBORS, hexDistance } from '../map/hexGrid';
import { findPath, rps, type Unit } from './units';
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
  | { type: 'conquer'; by: number; from: number; i: number; cost: number; loot: number; unit?: number }
  | { type: 'unitDied'; unit: Unit }
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
  units: Unit[] = [];
  /** fazione → tipo → tempo di gioco in cui la carta torna disponibile */
  readonly cooldowns: Record<UnitType, number>[];
  private nextUnitId = 1;
  private aiSpawnAt: number[];
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
    this.cooldowns = this.factions.map(() => ({ fanteria: 0, raider: 0, artiglieria: 0 }));
    this.aiSpawnAt = this.factions.map(() => BALANCE.ai.graceMs + this.aiRng() * BALANCE.aiUnits.spawnJitterMs);
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
      if (f.id === PLAYER || !f.alive) continue;
      if (this.aiRng() <= BALANCE.ai.actChance) {
        for (let a = 0; a < BALANCE.ai.attacksPerAct; a++) if (!this.aiAttack(f)) break;
      }
      this.aiUnits(f);
    }
    this.unitsTick();
  }

  // ---------- pedine ----------

  unitAt(i: number): Unit | undefined {
    return this.units.find((u) => u.tile === i);
  }

  unitsOf(f: number): Unit[] {
    return this.units.filter((u) => u.owner === f);
  }

  /** Perché non si può schierare (null = si può). */
  deployBlock(f: number, type: UnitType, i?: number): null | 'cooldown' | 'troops' | 'cap' | 'tile' {
    if (this.gameTimeMs < this.cooldowns[f][type]) return 'cooldown';
    if (this.unitsOf(f).length >= BALANCE.units.maxPerFaction) return 'cap';
    if (this.factions[f].troops < BALANCE.units[type].cost) return 'troops';
    if (i !== undefined && (this.owner[i] !== f || this.unitAt(i))) return 'tile';
    return null;
  }

  deploy(f: number, type: UnitType, i: number): Unit | null {
    if (this.deployBlock(f, type, i)) return null;
    this.factions[f].troops -= BALANCE.units[type].cost;
    this.cooldowns[f][type] = this.gameTimeMs + BALANCE.units.cooldownMs;
    const u: Unit = {
      id: this.nextUnitId++, type, owner: f, tile: i, hp: BALANCE.units[type].hp,
      path: [], moveAcc: 0, inCombat: false, lastOrderMs: this.gameTimeMs,
    };
    this.units.push(u);
    return u;
  }

  /** Ordina alla pedina di andare verso `to`; false se irraggiungibile. */
  order(u: Unit, to: number): boolean {
    const path = findPath(u.tile, to, (i) => this.passable(i));
    u.path = path;
    u.lastOrderMs = this.gameTimeMs;
    return path.length > 0;
  }

  private unitsTick() {
    const U = BALANCE.units;
    // 1. combattimento simultaneo: ognuno colpisce il nemico più conveniente a portata
    const dmg = new Map<Unit, number>();
    for (const u of this.units) {
      let target: Unit | null = null, best = -1;
      for (const v of this.units) {
        if (v.owner === u.owner || hexDistance(u.tile, v.tile) > U[u.type].range) continue;
        const m = rps(u.type, v.type);
        if (m > best) {
          best = m;
          target = v;
        }
      }
      u.inCombat = !!target || this.units.some((v) => v.owner !== u.owner && hexDistance(u.tile, v.tile) <= U[v.type].range);
      if (target) dmg.set(target, (dmg.get(target) ?? 0) + U[u.type].attack * best);
    }
    for (const [v, d] of dmg) v.hp -= d;
    this.removeDead();

    // 2. movimento, conquista di ciò che si calpesta, cura in casa
    for (const u of [...this.units]) {
      if (u.hp <= 0) continue;
      const stats = U[u.type];
      if (!u.inCombat && u.path.length) {
        u.moveAcc += BALANCE.tick.ms;
        if (u.moveAcc >= stats.moveMs) {
          const next = u.path[0];
          if (!this.unitAt(next)) {
            u.moveAcc = 0;
            u.tile = next;
            u.path.shift();
          }
        }
      }
      if (this.owner[u.tile] !== u.owner) {
        u.hp -= this.defenseOf(u.tile) * stats.captureCost;
        if (u.hp > 0) this.transfer(u.owner, u.tile, 0, u.id);
      } else if (!u.inCombat) {
        u.hp = Math.min(stats.hp, u.hp + U.healPerTick);
      }
    }
    this.removeDead();
  }

  private removeDead() {
    for (const u of this.units) if (u.hp <= 0) this.events.push({ type: 'unitDied', unit: u });
    this.units = this.units.filter((u) => u.hp > 0);
  }

  /** IA: ogni tanto schiera la sua unità preferita e la manda verso il nemico più vicino (te, di preferenza). */
  private aiUnits(f: Faction) {
    const A = BALANCE.aiUnits;
    for (const u of this.unitsOf(f.id)) {
      if (!u.path.length || this.gameTimeMs - u.lastOrderMs > A.repathMs) {
        const target = this.nearestEnemyTile(f.id, u.tile);
        if (target >= 0) this.order(u, target);
      }
    }
    if (this.gameTimeMs < this.aiSpawnAt[f.id] || this.unitsOf(f.id).length >= A.maxUnits) return;
    this.aiSpawnAt[f.id] = this.gameTimeMs + A.spawnEveryMs + (this.aiRng() * 2 - 1) * A.spawnJitterMs;
    const dominant = A.dominant[f.id] as UnitType;
    const types: UnitType[] = ['fanteria', 'raider', 'artiglieria'];
    const type = this.aiRng() < A.dominantChance ? dominant : types[Math.floor(this.aiRng() * 3)];
    if (f.troops < BALANCE.units[type].cost * A.reserve) return;
    const anchor = this.map.starts[f.id];
    const target = this.nearestEnemyTile(f.id, anchor);
    if (target < 0) return;
    let spawn = -1, bestD = Infinity;
    for (let i = 0; i < this.owner.length; i++) {
      if (this.owner[i] !== f.id || this.unitAt(i)) continue;
      const d = hexDistance(i, target);
      if (d < bestD) {
        bestD = d;
        spawn = i;
      }
    }
    if (spawn < 0) return;
    const u = this.deploy(f.id, type, spawn);
    if (u) this.order(u, target);
  }

  private nearestEnemyTile(f: number, from: number): number {
    let best = -1, bestD = Infinity;
    const playerReady = this.gameTimeMs >= BALANCE.ai.graceMs;
    for (let i = 0; i < this.owner.length; i++) {
      const o = this.owner[i];
      if (o === NEUTRAL || o === f || (o === PLAYER && !playerReady)) continue;
      const d = hexDistance(from, i) * (o === PLAYER ? BALANCE.aiUnits.playerBias : 1);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
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
    const loot = this.transfer(by, i, cost);
    return { ok: true, tile, cost, loot };
  }

  /** Passa la casella a `by` (il costo è già stato pagato); ritorna il bottino raccolto. */
  private transfer(by: number, i: number, cost: number, unit?: number): number {
    const tile = this.map.tiles[i]!;
    const from = this.owner[i];
    if (from !== NEUTRAL) {
      const def = this.factions[from];
      const garrison = this.defenseOf(i) - tile.defense * BALANCE.owned.defenseMult;
      def.troops = Math.max(0, def.troops - garrison); // perde il presidio
      def.tiles--;
    }
    const loot = tile.loot;
    this.factions[by].loot += loot;
    tile.loot = 0;
    this.claim(by, i);
    this.events.push({ type: 'conquer', by, from, i, cost, loot, unit });
    if (from !== NEUTRAL && this.factions[from].tiles <= 0) this.eliminate(from, by);
    return loot;
  }

  private eliminate(f: number, by: number) {
    const dead = this.factions[f];
    dead.alive = false;
    dead.troops = 0;
    for (const u of this.unitsOf(f)) u.hp = 0;
    this.removeDead();
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
