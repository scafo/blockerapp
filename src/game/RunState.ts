// Stato logico di una run: nessuna dipendenza da Phaser.
import { BALANCE, type AbilityType, type CampaignId, type CivId, type Resource, type UnitType } from '../config/balance';
import { addBag, emptyBag, scaleBag, type Bag } from './resources';
import { NEIGHBORS, hexDistance } from '../map/hexGrid';
import { UNIT_TYPES, findPath, isNaval, rps, type Unit } from './units';
import { isCoast, seaRoute, type Boat } from './boats';
import { DEFAULT_OPTIONS, type RunOptions } from './camp';
import { EVENTS, type EventChoice, type EventEffects, type GameEvent } from './events';
import { createRng, type Rng } from '../map/rng';
import type { RunMap, Tile } from '../map/generate';

export const NEUTRAL = -1;
export const PLAYER = 0;

export interface Faction {
  id: number;
  troops: number;
  tiles: number;
  maxTiles: number;
  loot: Bag; // per il giocatore è lo zaino della run
  alive: boolean;
  settlements: number; // rovine possedute
  workers: number; // quota di lavoratori (0..1)
  lootAcc: Record<Resource, number>; // frazioni di risorse prodotte dai lavoratori
}

export type RunEvent =
  | { type: 'conquer'; by: number; from: number; i: number; cost: number; loot: number; lootType: Resource; unit?: number }
  | { type: 'storm'; phase: 'warn' | 'start' }
  | { type: 'event'; event: GameEvent }
  | { type: 'flowEnd'; reason: 'reached' | 'blocked' | 'budget' }
  | { type: 'boat'; phase: 'landed' | 'lost'; boat: Boat }
  | { type: 'province'; by: number; province: number; count: number; capital: boolean; nation: string; bonus: number }
  | { type: 'unitDied'; unit: Unit }
  | { type: 'ability'; ability: AbilityType; tile: number; phase: 'launch' | 'impact'; hits?: number }
  | { type: 'eliminated'; faction: number; by: number; loot: Bag };

export type Outcome = 'eliminated' | 'victory' | 'retreat' | 'storm';
export type VictoryReason = 'map' | 'anomalies' | 'storm' | 'tutorial';

export interface RunSummary {
  seed: string;
  outcome: Outcome;
  reason?: VictoryReason;
  timeMs: number;
  maxTiles: number;
  anomalies: number;
  backpack: Bag; // zaino a fine run
  kept: Bag; // portato a casa dopo perdite/bonus
  tutorial: boolean;
  civ: CivId;
  campaign: CampaignId;
}

export type ConquerResult =
  | { ok: true; tile: Tile; cost: number; loot: number; lootType: Resource }
  | { ok: false; reason: 'not-adjacent' | 'impassable' | 'owned' | 'troops'; need?: number };

export class RunState {
  readonly owner: Int8Array;
  readonly factions: Faction[];
  gameTimeMs = 0;
  speed = 1;
  over: null | Outcome = null;
  victoryReason?: VictoryReason;
  /** casella → 1 se già inghiottita dalla tempesta */
  readonly stormed: Uint8Array;
  private stormDist: Int16Array;
  private stormMaxR = 0;
  private stormPhase: 'none' | 'warn' | 'active' = 'none';
  private stormDelayMs = 0;
  // eventi
  pendingEvent: GameEvent | null = null;
  private nextEventAt: number = BALANCE.events.firstMs;
  private seenEvents = new Set<string>();
  private evRng: Rng;
  private growthBoost = { mult: 1, until: 0 };
  // avanzata automatica del giocatore
  flowTarget: number | null = null;
  private flowAcc = 0;
  private flowBudget = 0;
  // navi in viaggio
  boats: Boat[] = [];
  private nextBoatId = 1;
  // nebbia di guerra: 1 = visibile ora / già esplorato
  readonly visible: Uint8Array;
  readonly seen: Uint8Array;
  /** cambia quando cambia ciò che il giocatore vede (per ridisegnare la nebbia solo se serve) */
  fogVersion = 0;
  /** quota delle truppe che un'avanzata può spendere */
  attackRatio: number = BALANCE.attack.default;
  private flowBestD = Infinity;
  private anomalyDefMult = 1;
  /** Genio: caselle fortificate (proprietario della fortificazione, −1 = nessuna). */
  private fortBy: Int8Array;
  /** Cannoniera: caselle di costa coperte dal fuoco (fazione che ne approfitta, −1 = nessuna). */
  private supportBy: Int8Array;
  /** Abilità: pronte da (tempo di gioco), ricognizioni in volo, bombardamenti in arrivo. */
  abilityReadyAt: Record<AbilityType, number> = { ricognizione: 0, bombardamento: 0 };
  private recons: { tile: number; until: number }[] = [];
  private strikes: { tile: number; at: number }[] = [];
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
  private capitalsTaken = new Set<number>();
  private ruins: number[];

  constructor(readonly map: RunMap, readonly opts: RunOptions = DEFAULT_OPTIONS) {
    this.owner = new Int8Array(map.tiles.length).fill(NEUTRAL);
    this.fortBy = new Int8Array(map.tiles.length).fill(-1);
    this.supportBy = new Int8Array(map.tiles.length).fill(-1);
    this.aiRng = createRng(map.seed + ':ia');
    this.ruins = map.land.filter((i) => map.tiles[i]!.type === 'rovine');
    this.evRng = createRng(map.seed + ':eventi');
    this.factions = map.starts.map((_, id) => ({
      id,
      troops: id === PLAYER ? BALANCE.start.troops + opts.mods.startTroops : BALANCE.ai.startTroops,
      tiles: 0,
      maxTiles: 0,
      loot: emptyBag(),
      alive: true,
      settlements: 0,
      workers: id === PLAYER ? (opts.tutorial ? 0 : BALANCE.workers.default) : BALANCE.ai.workers,
      lootAcc: emptyBag(),
    }));
    this.stormed = new Uint8Array(map.tiles.length);
    this.visible = new Uint8Array(map.tiles.length);
    this.seen = new Uint8Array(map.tiles.length);
    for (const a of map.anomalies) this.seen[a] = 1; // il segnale si sente da lontano
    this.stormDist = new Int16Array(map.tiles.length);
    for (let i = 0; i < map.tiles.length; i++) this.stormDist[i] = hexDistance(i, map.stormCenter);
    // raggio iniziale: copre tutta la regione raggiungibile dal giocatore
    const seen = new Uint8Array(map.tiles.length);
    const queue = [map.starts[0]];
    seen[map.starts[0]] = 1;
    for (let h = 0; h < queue.length; h++) {
      const c = queue[h];
      this.stormMaxR = Math.max(this.stormMaxR, this.stormDist[c]);
      for (const n of NEIGHBORS[c]) {
        if (n >= 0 && !seen[n] && this.passable(n)) {
          seen[n] = 1;
          queue.push(n);
        }
      }
    }
    this.cooldowns = this.factions.map(() => Object.fromEntries(UNIT_TYPES.map((t) => [t, 0])) as Record<UnitType, number>);
    this.anomalyDefMult = opts.mods.anomalyDefenseMult;
    this.aiSpawnAt = this.factions.map(() => BALANCE.ai.graceMs + this.aiRng() * BALANCE.aiUnits.spawnJitterMs);
    map.starts.forEach((s, f) => {
      this.claim(f, s);
      // anelli attorno alla partenza (start.radius)
      let ring = [s];
      for (let r = 0; r < BALANCE.start.radius; r++) {
        const next: number[] = [];
        for (const c of ring) for (const n of NEIGHBORS[c]) {
          if (n >= 0 && this.passable(n) && this.owner[n] === NEUTRAL) { this.claim(f, n); next.push(n); }
        }
        ring = next;
      }
    });
  }

  /** Da chiamare dopo il costruttore (la scena lo fa): nebbia pronta dal primo fotogramma. */
  initFog() {
    this.updateFog();
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
    return (this.growth(this.player) * (1 - this.player.workers) * 1000) / BALANCE.tick.ms;
  }

  /** Risorse al secondo prodotte dai lavoratori del giocatore. */
  get workLootPerSecond(): number {
    return (this.growth(this.player) * this.player.workers * BALANCE.workers.lootPerWorker * 1000) / BALANCE.tick.ms;
  }

  setWorkers(ratio: number) {
    this.player.workers = Math.max(0, Math.min(0.9, ratio));
  }

  /** Insediamenti (rovine possedute) per fazione, in una passata sulla mappa. */
  private countSettlements() {
    this.factions.forEach((f) => (f.settlements = 0));
    for (const i of this.ruins) {
      const o = this.owner[i];
      if (o !== NEUTRAL) this.factions[o].settlements++;
    }
  }

  drainEvents(): RunEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Avanza il tempo; ritorna quanti tick sono scattati. */
  update(deltaMs: number): number {
    if (this.over || this.pendingEvent) return 0; // con una carta evento aperta la run è in pausa
    const dt = deltaMs * this.speed;
    this.gameTimeMs += dt;
    this.tickAcc += dt;
    let ticks = 0;
    while (this.tickAcc >= BALANCE.tick.ms && !this.over) {
      this.tickAcc -= BALANCE.tick.ms;
      this.tick();
      ticks++;
    }
    this.moveBoats(dt);
    this.abilitiesTick();
    if (this.flowTarget !== null) {
      this.flowAcc += dt;
      const stepMs = BALANCE.flow.stepMs / this.opts.mods.flowSpeedMult;
      while (this.flowAcc >= stepMs && this.flowTarget !== null && !this.over) {
        this.flowAcc -= stepMs;
        this.flowStep();
      }
    }
    return ticks;
  }

  /** Crescita lorda per tick (truppe + lavoratori): caselle × 0,1, gli insediamenti valgono qualche casella in più. */
  private growth(f: Faction): number {
    const boost = this.gameTimeMs < this.growthBoost.until ? this.growthBoost.mult : 1;
    const mult = f.id === PLAYER ? boost * this.opts.mods.growthMult : this.opts.tutorial ? BALANCE.tutorial.aiGrowthMult : BALANCE.ai.growthMult;
    const perSettlement = BALANCE.settlements.growthTiles + (f.id === PLAYER ? this.opts.mods.settlementGrowth : 0);
    const tiles = f.tiles + f.settlements * perSettlement;
    return tiles * BALANCE.tick.troopsPerTile * mult;
  }

  /** Un tick di crescita: soldati nel pool, lavoratori in risorse nello zaino. */
  private grow(f: Faction) {
    const W = BALANCE.workers;
    const g = this.growth(f);
    f.troops += g * (1 - f.workers);
    const made = g * f.workers * W.lootPerWorker;
    // edificio unico della Cabal: gli insediamenti producono metallo e benzina
    const market = f.id === PLAYER ? f.settlements * this.opts.mods.settlementLoot : 0;
    if (market) { f.lootAcc.metallo += market / 2; f.lootAcc.benzina += market / 2; }
    for (const r of Object.keys(W.mix) as Resource[]) {
      f.lootAcc[r] += made * W.mix[r];
      const whole = Math.floor(f.lootAcc[r]);
      if (whole > 0) {
        f.loot[r] += whole;
        f.lootAcc[r] -= whole;
      }
    }
  }

  // ---------- tempesta ----------

  get stormStartMs(): number {
    if (this.opts.tutorial) return Infinity; // niente tempesta nella prima run
    return this.opts.stormStartMs + this.stormDelayMs;
  }

  /** Raggio sicuro attuale attorno all'occhio (Infinity prima dell'arrivo). */
  get stormRadius(): number {
    const S = BALANCE.storm;
    if (this.gameTimeMs < this.stormStartMs) return Infinity;
    const k = Math.min(1, (this.gameTimeMs - this.stormStartMs) / S.durationMs);
    return this.stormMaxR + (S.finalRadius - this.stormMaxR) * k;
  }

  /** ms di gioco all'arrivo della tempesta (negativo = già arrivata). */
  get stormIn(): number {
    return this.stormStartMs - this.gameTimeMs;
  }

  inStorm(i: number): boolean {
    return this.stormDist[i] > this.stormRadius;
  }

  private stormTick() {
    const S = BALANCE.storm;
    if (this.stormPhase === 'none' && this.stormIn <= S.warnMs + this.opts.warnBonusMs) {
      this.stormPhase = 'warn';
      this.events.push({ type: 'storm', phase: 'warn' });
    }
    if (this.stormPhase !== 'active' && this.stormIn <= 0) {
      this.stormPhase = 'active';
      this.events.push({ type: 'storm', phase: 'start' });
    }
    if (this.stormPhase !== 'active') return;
    const r = this.stormRadius;
    for (let i = 0; i < this.stormed.length; i++) {
      if (this.stormed[i] || !this.map.tiles[i] || this.stormDist[i] <= r) continue;
      this.stormed[i] = 1;
      const o = this.owner[i];
      if (o === NEUTRAL) continue;
      this.owner[i] = NEUTRAL;
      this.factions[o].tiles--;
      this.frontierCache.clear();
      this.events.push({ type: 'conquer', by: NEUTRAL, from: o, i, cost: 0, loot: 0, lootType: 'metallo' });
      if (this.factions[o].tiles <= 0 && this.factions[o].alive) this.eliminate(o, NEUTRAL);
    }
    for (const u of this.units) if (this.stormed[u.tile]) u.hp -= S.unitDamage;
    this.removeDead();
    if (this.over) return;
    if (this.gameTimeMs >= this.stormStartMs + S.durationMs) {
      // la tempesta è arrivata: vince chi ha più territorio
      const best = Math.max(...this.factions.filter((f) => f.alive).map((f) => f.tiles));
      this.end(this.player.tiles >= best ? 'victory' : 'storm', 'storm');
    }
  }

  // ---------- fine run ----------

  anomaliesOwned(f = PLAYER): number {
    return this.map.anomalies.filter((i) => this.owner[i] === f).length;
  }

  get mapShare(): number {
    return this.player.tiles / Math.max(1, this.map.regionSize);
  }

  private checkVictory() {
    if (this.over) return;
    if (this.opts.tutorial) {
      if (this.player.tiles >= BALANCE.tutorial.goalTiles) this.end('victory', 'tutorial');
      return;
    }
    if (this.mapShare >= BALANCE.victory.mapShare) this.end('victory', 'map');
    else if (this.anomaliesOwned() >= this.anomaliesToWin) this.end('victory', 'anomalies');
  }

  /** Anomalie da tenere per vincere (la ricerca sulla Caduta ne toglie una). */
  get anomaliesToWin(): number {
    return Math.max(1, BALANCE.victory.anomalies + this.opts.mods.anomaliesNeeded);
  }

  retreat() {
    if (!this.over) this.end('retreat');
  }

  private end(outcome: Outcome, reason?: VictoryReason) {
    this.over = outcome;
    this.victoryReason = outcome === 'victory' ? reason : undefined;
  }

  summary(): RunSummary {
    const outcome = this.over ?? 'retreat';
    const bag = this.player.loot;
    const k = outcome === 'victory' ? 1 + BALANCE.victory.bonus
      : outcome === 'retreat' ? 1 + this.opts.retreatBonus : 1 - this.opts.eliminatedLoss;
    return {
      seed: this.map.seed, outcome, reason: this.victoryReason, timeMs: this.gameTimeMs,
      maxTiles: this.player.maxTiles, anomalies: this.anomaliesOwned(), backpack: { ...bag }, kept: scaleBag(bag, k * this.opts.campaignLootMult),
      tutorial: this.opts.tutorial, civ: this.opts.civ, campaign: this.opts.campaign,
    };
  }

  private tick() {
    this.countSettlements();
    for (const f of this.factions) if (f.alive) this.grow(f);
    for (const f of this.factions) {
      if (f.id === PLAYER || !f.alive) continue;
      if (this.aiRng() <= BALANCE.ai.actChance) {
        for (let a = 0; a < BALANCE.ai.attacksPerAct; a++) if (!this.aiAttack(f)) break;
      }
      this.aiUnits(f);
    }
    this.unitsTick();
    this.stormTick();
    this.checkVictory();
    this.eventTick();
    this.updateFog();
  }

  // ---------- navi ----------

  /** Nave verso una costa: parte dalla tua costa più vicina con la forza d'attacco. */
  launchBoat(target: number): null | 'locked' | 'notCoast' | 'far' | 'max' | 'troops' {
    const B = BALANCE.boats;
    if (this.opts.tutorial) return 'locked';
    if (!this.passable(target) || this.owner[target] === PLAYER || !isCoast(this.map.tiles, target)) return 'notCoast';
    if (this.boats.filter((b) => b.owner === PLAYER).length >= B.maxInFlight) return 'max';
    const troops = Math.floor(this.troops * this.attackRatio);
    if (troops < B.minTroops) return 'troops';
    const route = seaRoute(this.map.tiles, (i) => this.owner[i] === PLAYER, target, B.maxSea);
    if (!route) return 'far';
    this.troops -= troops;
    this.boats.push({ id: this.nextBoatId++, owner: PLAYER, from: route.from, path: route.path, pos: 0, troops, acc: 0 });
    return null;
  }

  private moveBoats(dt: number) {
    for (const b of [...this.boats]) {
      b.acc += dt;
      while (b.acc >= BALANCE.boats.stepMs && this.boats.includes(b)) {
        b.acc -= BALANCE.boats.stepMs;
        b.pos++;
        if (b.pos >= b.path.length - 1) this.land(b);
      }
    }
  }

  /** Sbarco: se le truppe superano la difesa prendi la costa e chi resta torna nel pool. */
  private land(b: Boat) {
    this.boats = this.boats.filter((x) => x !== b);
    const t = b.path[b.path.length - 1];
    const f = this.factions[b.owner];
    if (this.owner[t] === b.owner) {
      f.troops += b.troops;
      this.events.push({ type: 'boat', phase: 'landed', boat: b });
      return;
    }
    const cost = this.passable(t) ? this.defenseOf(t) : Infinity;
    if (!f.alive || b.troops <= cost) {
      this.events.push({ type: 'boat', phase: 'lost', boat: b });
      return;
    }
    this.transfer(b.owner, t, cost);
    f.troops += b.troops - cost;
    this.events.push({ type: 'boat', phase: 'landed', boat: b });
  }

  // ---------- nebbia ----------

  /** Ricalcola cosa vede il giocatore: anelli attorno a territorio, pedine e navi. */
  private updateFog() {
    if (!this.opts.fog) return;
    const F = BALANCE.fog;
    const vis = new Uint8Array(this.visible.length);
    const dist = new Int8Array(this.visible.length).fill(-1);
    const queue: number[] = [];
    const seed = (i: number, r: number) => {
      if (i < 0 || dist[i] >= r) return;
      dist[i] = r;
      queue.push(i);
    };
    for (let i = 0; i < this.owner.length; i++) if (this.owner[i] === PLAYER) seed(i, F.territory + this.opts.mods.fogBonus);
    for (const u of this.unitsOf(PLAYER)) seed(u.tile, F.unit);
    for (const b of this.boats) if (b.owner === PLAYER) seed(b.path[b.pos], F.boat);
    for (const r of this.recons) seed(r.tile, BALANCE.abilities.ricognizione.radius);
    for (let h = 0; h < queue.length; h++) {
      const c = queue[h];
      vis[c] = 1;
      if (dist[c] <= 0) continue;
      for (const n of NEIGHBORS[c]) if (n >= 0 && dist[n] < dist[c] - 1) {
        dist[n] = dist[c] - 1;
        queue.push(n);
      }
    }
    let changed = false;
    for (let i = 0; i < vis.length; i++) {
      if (vis[i] !== this.visible[i]) {
        this.visible[i] = vis[i];
        changed = true;
      }
      if (vis[i]) this.seen[i] = 1;
    }
    if (changed) this.fogVersion++;
  }

  /** La casella è visibile al giocatore? (senza nebbia: sempre) */
  sees(i: number): boolean {
    return !this.opts.fog || this.visible[i] === 1;
  }

  // ---------- avanzata ----------

  /** Avanzata verso `target`: il confine conquista da solo le caselle più vicine al bersaglio. */
  startFlow(target: number): boolean {
    if (!this.passable(target) || this.owner[target] === PLAYER) return false;
    let own = -1;
    for (let i = 0; i < this.owner.length && own < 0; i++) if (this.owner[i] === PLAYER) own = i;
    if (own < 0 || !findPath(own, target, (i) => this.passable(i)).length) return false;
    this.flowTarget = target;
    this.flowAcc = BALANCE.flow.stepMs; // primo passo subito
    this.flowBestD = Infinity;
    this.flowBudget = this.troops * (this.opts.tutorial ? 1 : this.attackRatio); // forza d'attacco
    return true;
  }

  stopFlow(reason: 'reached' | 'blocked' | 'budget' = 'blocked') {
    if (this.flowTarget === null) return;
    this.flowTarget = null;
    this.events.push({ type: 'flowEnd', reason });
  }

  private flowStep() {
    const t = this.flowTarget!;
    if (this.owner[t] === PLAYER) return this.stopFlow('reached');
    if (!this.passable(t)) return this.stopFlow('blocked');
    let best = -1, bestD = Infinity, bestDef = Infinity;
    for (const i of this.frontier(PLAYER)) {
      const d = hexDistance(i, t), def = this.costFor(PLAYER, i);
      if (d < bestD || (d === bestD && def < bestDef)) {
        best = i;
        bestD = d;
        bestDef = def;
      }
    }
    if (best < 0 || bestD > this.flowBestD + BALANCE.flow.giveUpSteps) return this.stopFlow('blocked');
    if (bestDef > this.flowBudget) return this.stopFlow('budget'); // forza d'attacco esaurita
    if (this.troops - bestDef <= BALANCE.flow.reserve) return; // aspetta rinforzi, il bersaglio resta
    this.flowBestD = Math.min(this.flowBestD, bestD);
    if (this.attack(PLAYER, best).ok) this.flowBudget -= bestDef;
  }

  // ---------- eventi ----------

  private eventTick() {
    if (this.over || this.opts.events <= 0 || this.opts.tutorial || this.gameTimeMs < this.nextEventAt) return;
    const E = BALANCE.events;
    this.nextEventAt = this.gameTimeMs + E.everyMs + (this.evRng() * 2 - 1) * E.jitterMs;
    const pool = EVENTS.filter((e) => !this.seenEvents.has(e.id) && (!e.rare || this.opts.events >= 2));
    if (!pool.length) return;
    // i rari, quando ammessi, escono un po' più spesso: è la Radio che li cerca
    const rare = pool.filter((e) => e.rare);
    const ev = rare.length && this.evRng() < 0.35 ? rare[Math.floor(this.evRng() * rare.length)] : pool[Math.floor(this.evRng() * pool.length)];
    this.seenEvents.add(ev.id);
    this.pendingEvent = ev;
    this.events.push({ type: 'event', event: ev });
  }

  /** La scelta è possibile? (costi in truppe o risorse coperti) */
  canChoose(c: EventChoice): boolean {
    const fx = c.effects;
    if (fx.troops && fx.troops < 0 && this.troops <= -fx.troops) return false;
    if (fx.loot) for (const [r, v] of Object.entries(fx.loot)) if (v < 0 && this.backpack[r as Resource] < -v) return false;
    return true;
  }

  /** Applica la scelta dell'evento aperto e riprende la run; ritorna il testo del risultato. */
  choose(side: 'left' | 'right'): string {
    const ev = this.pendingEvent;
    if (!ev) return '';
    const c = ev[side];
    if (!this.canChoose(c)) return '';
    const success = c.chance === undefined || this.evRng() < c.chance;
    this.applyEffects(success ? c.effects : c.fail ?? {});
    this.pendingEvent = null;
    return success ? c.result : c.failResult ?? c.result;
  }

  private applyEffects(fx: EventEffects) {
    const p = this.player;
    if (fx.troops) p.troops = Math.max(0, p.troops + fx.troops);
    if (fx.loot) for (const [r, v] of Object.entries(fx.loot)) p.loot[r as Resource] = Math.max(0, p.loot[r as Resource] + v);
    if (fx.growth) this.growthBoost = { mult: fx.growth.mult, until: this.gameTimeMs + fx.growth.durationMs };
    if (fx.anomalyDefense) this.anomalyDefMult *= fx.anomalyDefense;
    if (fx.stormDelayMs) this.stormDelayMs += fx.stormDelayMs;
    if (fx.unit) {
      // pedina gratuita su una nostra casella di confine; se non c'è posto, valore in truppe
      const border = [];
      for (let i = 0; i < this.owner.length; i++) {
        if (this.owner[i] === PLAYER && !this.unitAt(i) && NEIGHBORS[i].some((n) => n >= 0 && this.owner[n] !== PLAYER)) border.push(i);
      }
      if (border.length && this.unitsOf(PLAYER).length < BALANCE.units.maxPerFaction) {
        this.deploy(PLAYER, fx.unit, border[Math.floor(this.evRng() * border.length)], true);
      } else {
        p.troops += BALANCE.units[fx.unit].cost;
      }
    }
  }

  // ---------- pedine ----------

  unitAt(i: number): Unit | undefined {
    return this.units.find((u) => u.tile === i);
  }

  unitsOf(f: number): Unit[] {
    return this.units.filter((u) => u.owner === f);
  }

  /** Costo in truppe di un'unità (bonus del giocatore compresi). */
  unitCost(f: number, type: UnitType): number {
    return Math.round(BALANCE.units[type].cost * (f === PLAYER ? this.opts.mods.unitCostMult : 1));
  }

  /** Perché non si può schierare (null = si può). */
  deployBlock(f: number, type: UnitType, i?: number): null | 'locked' | 'cooldown' | 'troops' | 'cap' | 'tile' {
    if (f === PLAYER && !this.opts.units.includes(type)) return 'locked';
    if (this.gameTimeMs < this.cooldowns[f][type]) return 'cooldown';
    if (this.unitsOf(f).length >= BALANCE.units.maxPerFaction + (f === PLAYER ? this.opts.maxUnitsBonus : 0)) return 'cap';
    if (this.factions[f].troops < this.unitCost(f, type)) return 'troops';
    if (i !== undefined && isNaval(type)) {
      if (this.owner[i] !== f || this.seaSpawn(i) < 0) return 'tile'; // nave: da una tua costa con mare libero accanto
    } else if (i !== undefined && (this.owner[i] !== f || this.unitAt(i))) return 'tile';
    return null;
  }

  deploy(f: number, type: UnitType, i: number, free = false): Unit | null {
    if (!free && this.deployBlock(f, type, i)) return null;
    if (!free) {
      this.factions[f].troops -= this.unitCost(f, type);
      this.cooldowns[f][type] = this.gameTimeMs + BALANCE.units.cooldownMs;
    }
    const maxHp = BALANCE.units[type].hp * (f === PLAYER ? this.opts.unitHpMult : 1);
    const tile = isNaval(type) ? this.seaSpawn(i) : i;
    if (tile < 0) return null;
    const u: Unit = {
      id: this.nextUnitId++, type, owner: f, tile, hp: maxHp, maxHp,
      path: [], moveAcc: 0, inCombat: false, lastOrderMs: this.gameTimeMs,
    };
    this.units.push(u);
    return u;
  }

  /** Casella di mare libera accanto a una costa (dove nasce una cannoniera), −1 se non c'è. */
  private seaSpawn(coast: number): number {
    return NEIGHBORS[coast].find((n) => n >= 0 && !this.map.tiles[n] && !this.unitAt(n)) ?? -1;
  }

  /** Ordina alla pedina di andare verso `to`; false se irraggiungibile. Le navi vanno sul mare accanto alla costa toccata. */
  order(u: Unit, to: number): boolean {
    if (isNaval(u.type)) {
      const sea = (i: number) => i >= 0 && !this.map.tiles[i];
      let dest = to;
      if (!sea(to)) {
        const opts = NEIGHBORS[to].filter(sea);
        if (!opts.length) return false;
        dest = opts.reduce((a, b) => (hexDistance(a, u.tile) <= hexDistance(b, u.tile) ? a : b));
      }
      const path = findPath(u.tile, dest, sea);
      u.path = path;
      u.lastOrderMs = this.gameTimeMs;
      return path.length > 0 || dest === u.tile;
    }
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
      if (isNaval(u.type) || !this.map.tiles[u.tile]) {
        // le navi non conquistano: si riparano vicino a una tua costa
        if (!u.inCombat && NEIGHBORS[u.tile].some((n) => n >= 0 && this.owner[n] === u.owner)) u.hp = Math.min(u.maxHp, u.hp + U.healPerTick);
      } else if (this.owner[u.tile] !== u.owner && !this.stormed[u.tile]) {
        u.hp -= this.defenseOf(u.tile) * stats.captureCost;
        if (u.hp > 0) this.transfer(u.owner, u.tile, 0, u.id);
      } else if (!u.inCombat) {
        u.hp = Math.min(u.maxHp, u.hp + U.healPerTick);
      }
    }
    this.removeDead();
    this.updateSupport();
  }

  /** Genio: fortifica la sua casella e quelle accanto; cannoniera: copre le coste vicine. */
  private updateSupport() {
    this.fortBy.fill(-1);
    this.supportBy.fill(-1);
    for (const u of this.units) {
      if (u.type === 'genio') {
        for (const i of [u.tile, ...NEIGHBORS[u.tile]]) if (i >= 0 && this.owner[i] === u.owner) this.fortBy[i] = u.owner;
      } else if (isNaval(u.type)) {
        const R = BALANCE.units.supportRange;
        const seen = new Set([u.tile]);
        let ring = [u.tile];
        for (let r = 0; r < R; r++) {
          const next: number[] = [];
          for (const c of ring) for (const n of NEIGHBORS[c]) if (n >= 0 && !seen.has(n)) { seen.add(n); next.push(n); }
          ring = next;
        }
        for (const i of seen) if (this.map.tiles[i]) this.supportBy[i] = u.owner;
      }
    }
  }

  // ---------- abilità a ricarica ----------

  /** Perché non si può usare (null = si può). */
  abilityBlock(a: AbilityType): null | 'locked' | 'cooldown' {
    if (!this.opts.abilities.includes(a)) return 'locked';
    if (this.gameTimeMs < this.abilityReadyAt[a]) return 'cooldown';
    return null;
  }

  useAbility(a: AbilityType, tile: number): boolean {
    if (this.abilityBlock(a) || tile < 0 || this.over) return false;
    const A = BALANCE.abilities[a];
    this.abilityReadyAt[a] = this.gameTimeMs + A.cooldownMs * this.opts.abilityCdMult;
    if (a === 'ricognizione') {
      this.recons.push({ tile, until: this.gameTimeMs + BALANCE.abilities.ricognizione.durationMs });
      this.updateFog();
    } else {
      this.strikes.push({ tile, at: this.gameTimeMs + BALANCE.abilities.bombardamento.delayMs });
    }
    this.events.push({ type: 'ability', ability: a, tile, phase: 'launch' });
    return true;
  }

  private abilitiesTick() {
    const before = this.recons.length;
    this.recons = this.recons.filter((r) => r.until > this.gameTimeMs);
    if (this.recons.length !== before) this.updateFog();
    const B = BALANCE.abilities.bombardamento;
    for (const s of this.strikes.filter((x) => x.at <= this.gameTimeMs)) {
      let hits = 0;
      for (let i = 0; i < this.owner.length; i++) {
        if (!this.map.tiles[i]) continue;
        const d = hexDistance(i, s.tile);
        const o = this.owner[i];
        if (d <= B.radius && o !== NEUTRAL && o !== PLAYER) {
          // la casella nemica torna neutrale, il nemico perde il presidio
          const f = this.factions[o];
          f.tiles--;
          f.troops = Math.max(0, f.troops - B.troopsPerTile);
          this.owner[i] = NEUTRAL;
          this.frontierCache.clear();
          hits++;
          if (f.tiles <= 0) this.eliminate(o, PLAYER);
        }
      }
      for (const u of this.units) if (u.owner !== PLAYER && hexDistance(u.tile, s.tile) <= B.unitRadius) { u.hp -= B.unitDamage; hits++; }
      this.removeDead();
      this.events.push({ type: 'ability', ability: 'bombardamento', tile: s.tile, phase: 'impact', hits });
    }
    this.strikes = this.strikes.filter((x) => x.at > this.gameTimeMs);
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
    // i nemici usano le truppe di terra che hai sbloccato tu (niente navi né unità uniche)
    const base: UnitType[] = ['fanteria', 'ricognitori', 'artiglieria', 'corazzati', 'genio'];
    const types = base.filter((t) => t === 'fanteria' || t === 'ricognitori' || t === 'artiglieria' || this.opts.units.includes(t));
    const type = this.aiRng() < A.dominantChance ? dominant : types[Math.floor(this.aiRng() * types.length)];
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
    const playerReady = !this.opts.tutorial && this.gameTimeMs >= BALANCE.ai.graceMs;
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
    const grace = this.opts.tutorial || this.gameTimeMs < BALANCE.ai.graceMs;
    for (const i of this.frontier(f.id)) {
      if (grace && this.owner[i] === PLAYER) continue;
      const city = this.map.tiles[i]!.city ? BALANCE.provinces.aiCityAttraction : 1; // le città valgono una provincia
      const score = this.defenseOf(i) * (this.owner[i] === PLAYER ? BALANCE.ai.playerBias : 1) * city;
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
    return !!t && t.type !== 'tossica' && !this.stormed[i];
  }

  /** Truppe che `by` spende per prendere la casella (l'Imperium paga meno le neutrali). */
  costFor(by: number, i: number): number {
    let d = this.defenseOf(i);
    if (this.supportBy[i] === by) d = Math.ceil(d * BALANCE.units.supportCostMult); // fuoco di copertura della cannoniera
    return by === PLAYER && this.owner[i] === NEUTRAL ? Math.ceil(d * this.opts.mods.neutralCostMult) : d;
  }

  /** Difesa attuale: neutrale = base; posseduta = base * mult + presidio del proprietario. */
  defenseOf(i: number): number {
    const t = this.map.tiles[i]!;
    const o = this.owner[i];
    const base = t.type === 'anomalia' ? Math.ceil(t.defense * this.anomalyDefMult) : t.defense;
    if (o === NEUTRAL) return base;
    const f = this.factions[o];
    const garrison = Math.min((f.troops / Math.max(1, f.tiles)) * BALANCE.owned.garrison, BALANCE.owned.garrisonMax);
    const mine = o === PLAYER;
    const fort = this.fortBy[i] === o ? BALANCE.units.fortifyDefense : 0;
    const settlement = t.type === 'rovine' ? BALANCE.owned.settlementDefense + (mine ? this.opts.mods.settlementDefense : 0) : 0;
    return Math.ceil((base * BALANCE.owned.defenseMult + garrison + settlement + fort) * (mine ? this.opts.mods.ownedDefenseMult : 1));
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
    if (!tile || !this.passable(i)) return { ok: false, reason: 'impassable' };
    if (this.owner[i] === by) return { ok: false, reason: 'owned' };
    if (!this.isFrontier(i, by)) return { ok: false, reason: 'not-adjacent' };
    const cost = this.costFor(by, i);
    const att = this.factions[by];
    if (att.troops <= cost) return { ok: false, reason: 'troops', need: cost };

    att.troops -= cost;
    const loot = this.transfer(by, i, cost);
    return { ok: true, tile, cost, loot, lootType: tile.lootType };
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
    const loot = this.lootFor(by, tile.loot);
    this.factions[by].loot[tile.lootType] += loot;
    tile.loot = 0;
    this.claim(by, i);
    this.events.push({ type: 'conquer', by, from, i, cost, loot, lootType: tile.lootType, unit });
    if (tile.city) this.surrender(by, tile);
    if (from !== NEUTRAL && this.factions[from].tiles <= 0) this.eliminate(from, by);
    return loot;
  }

  private lootFor(by: number, n: number): number {
    return by === PLAYER ? Math.round(n * this.opts.mods.lootMult) : n;
  }

  /** Città presa: le caselle neutrali della sua provincia si arrendono; la capitale (la prima volta) dà truppe. */
  private surrender(by: number, city: Tile) {
    const prov = this.map.provinces[city.province];
    if (!prov) return;
    const f = this.factions[by];
    let count = 0;
    for (const j of prov.tiles) {
      const t = this.map.tiles[j]!;
      // le anomalie non si arrendono: vanno prese a mano
      if (j === city.i || this.owner[j] !== NEUTRAL || !this.passable(j) || t.type === 'anomalia') continue;
      const loot = this.lootFor(by, t.loot);
      f.loot[t.lootType] += loot; // il bottino delle rovine della provincia va a chi la prende
      t.loot = 0;
      this.claim(by, j);
      this.events.push({ type: 'conquer', by, from: NEUTRAL, i: j, cost: 0, loot, lootType: t.lootType });
      count++;
    }
    let bonus = 0;
    if (city.capital && !this.capitalsTaken.has(city.i)) {
      this.capitalsTaken.add(city.i);
      bonus = Math.round(BALANCE.provinces.capitalTroops * (by === PLAYER ? this.opts.mods.capitalTroopsMult : 1));
      f.troops += bonus;
    }
    const nation = this.map.nations.find((n) => n.id === prov.country)?.name ?? '';
    this.events.push({ type: 'province', by, province: city.province, count, capital: city.capital, nation, bonus });
  }

  private eliminate(f: number, by: number) {
    const dead = this.factions[f];
    dead.alive = false;
    dead.troops = 0;
    for (const u of this.unitsOf(f)) u.hp = 0;
    this.removeDead();
    const released = f === PLAYER || by === NEUTRAL ? emptyBag() : scaleBag(dead.loot, BALANCE.ai.releaseLootShare);
    if (by !== NEUTRAL) this.factions[by].loot = addBag(this.factions[by].loot, released);
    this.events.push({ type: 'eliminated', faction: f, by, loot: released });
    if (f === PLAYER) this.end(by === NEUTRAL ? 'storm' : 'eliminated');
  }

  private claim(f: number, i: number) {
    this.owner[i] = f;
    const fac = this.factions[f];
    fac.tiles++;
    fac.maxTiles = Math.max(fac.maxTiles, fac.tiles);
    this.frontierCache.clear();
  }
}
