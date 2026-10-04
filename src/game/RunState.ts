// Stato logico di una run: nessuna dipendenza da Phaser.
import { BALANCE, type AbilityType, type CampaignId, type CivId, type Resource, type UnitType, type WorkId } from '../config/balance';
import { addBag, emptyBag, scaleBag, type Bag } from './resources';
import { NEIGHBORS, hexDistance } from '../map/hexGrid';
import { UNIT_TYPES, findPath, isNaval, rps, type Unit } from './units';
import { isCoast, seaRoute, type Boat } from './boats';
import { DEFAULT_OPTIONS, type RunOptions } from './camp';
import { EVENTS, type EventChoice, type EventEffects, type GameEvent } from './events';
import { createRng, type Rng } from '../map/rng';
import type { RunMap, Tile } from '../map/generate';

export const NEUTRAL = -1;
export const WORKS: WorkId[] = ['fabbrica', 'bunker', 'caserma'];
export const PLAYER = 0;

export interface Faction {
  id: number;
  troops: number;
  tiles: number;
  maxTiles: number;
  loot: Bag; // per il giocatore è lo zaino della run
  alive: boolean;
  settlements: number; // rovine possedute
  provinces: number; // province possedute
  maxProvinces: number;
  workers: number; // quota di lavoratori (0..1)
  lootAcc: Record<Resource, number>; // frazioni di risorse prodotte dai lavoratori
}

export type RunEvent =
  | { type: 'conquer'; by: number; from: number; p: number; i: number; cost: number; loot: number; lootType: Resource; unit?: number }
  | { type: 'timer'; phase: 'warn' }
  | { type: 'work'; by: number; p: number; work: WorkId; phase: 'start' | 'done' }
  | { type: 'event'; event: GameEvent }
  | { type: 'flowEnd'; reason: 'reached' | 'blocked' | 'budget' }
  | { type: 'boat'; phase: 'landed' | 'lost'; boat: Boat }
  | { type: 'province'; by: number; province: number; count: number; capital: boolean; nation: string; bonus: number }
  | { type: 'unitDied'; unit: Unit }
  | { type: 'ability'; ability: AbilityType; tile: number; phase: 'launch' | 'impact'; hits?: number }
  | { type: 'provinceDone'; by: number; province: number; nation: string; troops: number; loot: Bag }
  | { type: 'offensive'; faction: number; phase: 'warn' | 'start' | 'end'; lost?: number }
  | { type: 'eliminated'; faction: number; by: number; loot: Bag };

export type Outcome = 'eliminated' | 'victory' | 'retreat' | 'timeout';
export type VictoryReason = 'map' | 'anomalies' | 'time' | 'tutorial';

export interface RunSummary {
  seed: string;
  outcome: Outcome;
  reason?: VictoryReason;
  timeMs: number;
  maxTiles: number;
  maxProvinces: number;
  anomalies: number;
  backpack: Bag; // zaino a fine run
  kept: Bag; // portato a casa dopo perdite/bonus
  tutorial: boolean;
  civ: CivId;
  campaign: CampaignId;
  front: number; // indice del fronte
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
  /** tempo in più guadagnato con gli eventi */
  private bonusTimeMs = 0;
  private timerWarned = false;
  // eventi
  pendingEvent: GameEvent | null = null;
  private nextEventAt: number = BALANCE.events.firstMs;
  private seenEvents = new Set<string>();
  private evRng: Rng;
  private growthBoost = { mult: 1, until: 0 };
  // avanzata automatica del giocatore
  flowTarget: number | null = null;
  /** Pausa strategica (alla HOI4): il tempo si ferma, gli ordini si possono dare lo stesso. */
  paused = false;
  /** Piano preparato in pausa: province da prendere in quest'ordine appena il tempo riparte. */
  plan: number[] = [];
  /** Offensiva nemica in corso o annunciata. */
  offensive: { faction: number; phase: 'warn' | 'on'; until: number; lostAtStart: number } | null = null;
  private nextOffensiveAt: number;
  /** Costruzioni nelle province: indice in WORKS (−1 = niente) e tempo di gioco in cui è pronta. */
  readonly provWork: Int8Array;
  readonly provWorkAt: Float64Array;
  private nextAiBunkerAt: number[] = [];
  /** per provincia: peso di crescita (caselle × terreno), risorsa e quantità prodotta a ogni tick */
  private provGrowthW: Float32Array;
  private provYield: Float32Array;
  /** crescita (caselle pesate) di ogni fazione, ricalcolata a ogni tick */
  private gw: number[] = [];
  /** risorse guadagnate nell'ultimo tick per fazione (province + lavoratori) */
  private incomeTick: Bag[] = [];
  private provincesDone = new Set<string>(); // "fazione:provincia" già premiate
  /** Proprietario di ogni provincia (tutte le sue caselle attraversabili hanno lo stesso). */
  readonly provOwner: Int8Array;
  /** Provincia visibile al giocatore (almeno una casella in vista). */
  readonly provVisible: Uint8Array;
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
  private flowSteps = 0;
  /** provincia → contiene un'anomalia */
  readonly provAnomaly: Uint8Array;
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
  /** fazione → province attaccabili (confinanti, non sue) */
  private frontierCache = new Map<number, number[]>();
  private aiRng: Rng;
  private capitalsTaken = new Set<number>();
  private ruins: number[];

  constructor(readonly map: RunMap, readonly opts: RunOptions = DEFAULT_OPTIONS) {
    this.owner = new Int8Array(map.tiles.length).fill(NEUTRAL);
    this.provOwner = new Int8Array(map.provinces.length).fill(NEUTRAL);
    this.provVisible = new Uint8Array(map.provinces.length).fill(1);
    this.provAnomaly = new Uint8Array(map.provinces.length);
    for (const a of map.anomalies) this.provAnomaly[map.tiles[a]!.province] = 1;
    this.fortBy = new Int8Array(map.tiles.length).fill(-1);
    this.supportBy = new Int8Array(map.tiles.length).fill(-1);
    this.aiRng = createRng(map.seed + ':ia');
    this.ruins = map.land.filter((i) => map.tiles[i]!.type === 'rovine');
    this.evRng = createRng(map.seed + ':eventi');
    this.factions = map.starts.map((_, id) => ({
      id,
      troops: id === PLAYER ? BALANCE.start.troops + opts.mods.startTroops : opts.front.aiStartTroops,
      tiles: 0,
      maxTiles: 0,
      loot: emptyBag(),
      alive: true,
      settlements: 0,
      provinces: 0,
      maxProvinces: 0,
      workers: id === PLAYER ? (opts.tutorial ? 0 : BALANCE.workers.default) : BALANCE.ai.workers,
      lootAcc: emptyBag(),
    }));
    this.visible = new Uint8Array(map.tiles.length);
    this.seen = new Uint8Array(map.tiles.length);
    for (const a of map.anomalies) this.seen[a] = 1; // il segnale si sente da lontano
    this.cooldowns = this.factions.map(() => Object.fromEntries(UNIT_TYPES.map((t) => [t, 0])) as Record<UnitType, number>);
    this.anomalyDefMult = opts.mods.anomalyDefenseMult;
    this.aiSpawnAt = this.factions.map(() => opts.front.graceMs + this.aiRng() * BALANCE.aiUnits.spawnJitterMs);
    this.nextOffensiveAt = opts.front.offensiveFirstMs;
    // economia per provincia: crescita pesata dal terreno, risorsa del terreno prevalente
    const T = BALANCE.terrain;
    this.provGrowthW = Float32Array.from(map.provinces, (p) => p.tiles.reduce((s, i) => s + T[map.tiles[i]!.terrain].growth, 0));
    this.provYield = Float32Array.from(map.provinces, (p) => (T[p.terrain].perMin * BALANCE.tick.ms) / 60_000);
    this.provWork = new Int8Array(map.provinces.length).fill(-1);
    this.provWorkAt = new Float64Array(map.provinces.length);
    this.gw = this.factions.map(() => 0);
    this.incomeTick = this.factions.map(() => emptyBag());
    // si parte con la provincia della propria partenza
    map.starts.forEach((s, f) => this.claimProvince(f, this.provOf(s)));
    // fronti difficili: le IA partono con qualche bunker attorno alla capitale e ne costruiscono altri
    if (!opts.tutorial) {
      map.starts.forEach((s, f) => {
        if (f === PLAYER) return;
        let ring = [this.provOf(s)];
        const seen = new Set(ring);
        let left = opts.front.aiBunkers;
        while (left > 0 && ring.length) {
          const next: number[] = [];
          for (const p of ring) {
            if (left > 0) { this.provWork[p] = WORKS.indexOf('bunker'); left--; }
            for (const q of map.provinces[p].neighbors) if (!seen.has(q)) { seen.add(q); next.push(q); }
          }
          ring = next;
        }
      });
      this.nextAiBunkerAt = this.factions.map(() => opts.front.graceMs + this.aiRng() * 30_000);
    }
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
    if (this.over || this.pendingEvent || this.paused) return 0; // carta evento aperta o pausa: tempo fermo
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
    if (this.flowTarget === null && this.plan.length) this.nextPlan();
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
    const mult = f.id === PLAYER ? boost * this.opts.mods.growthMult : this.opts.tutorial ? BALANCE.tutorial.aiGrowthMult : this.opts.front.aiGrowthMult;
    const perSettlement = BALANCE.settlements.growthTiles + (f.id === PLAYER ? this.opts.mods.settlementGrowth : 0);
    const tiles = this.gw[f.id] + f.settlements * perSettlement; // caselle pesate dal terreno + caserme + insediamenti
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
      this.incomeTick[f.id][r] += made * W.mix[r];
      const whole = Math.floor(f.lootAcc[r]);
      if (whole > 0) {
        f.loot[r] += whole;
        f.lootAcc[r] -= whole;
      }
    }
  }

  // ---------- economia e costruzioni ----------

  /** Crescita pesata e produzione delle province (fabbriche ×, caserme +), costruzioni che finiscono. */
  private economyTick() {
    const W = BALANCE.works;
    this.gw.fill(0);
    for (const b of this.incomeTick) b.metallo = b.benzina = b.cibo = 0;
    for (let p = 0; p < this.provOwner.length; p++) {
      const o = this.provOwner[p];
      const w = this.provWork[p];
      if (w >= 0 && this.provWorkAt[p] > 0 && this.provWorkAt[p] <= this.gameTimeMs) {
        this.provWorkAt[p] = 0; // pronta
        this.events.push({ type: 'work', by: o, p, work: WORKS[w], phase: 'done' });
      }
      if (o === NEUTRAL) continue;
      const ready = w >= 0 && this.provWorkAt[p] === 0 ? W[WORKS[w]] : null;
      this.gw[o] += this.provGrowthW[p] + (ready?.growthTiles ?? 0);
      const f = this.factions[o];
      const res = BALANCE.terrain[this.map.provinces[p].terrain].res;
      const made = this.provYield[p] * (ready?.prodMult ?? 1) * (o === PLAYER ? this.opts.mods.lootMult * this.opts.mods.prodMult : 1);
      f.lootAcc[res] += made;
      this.incomeTick[o][res] += made;
    }
  }

  /** Risorse al minuto della fazione (province, fabbriche, lavoratori). */
  incomePerMin(f = PLAYER): Bag {
    const k = 60_000 / BALANCE.tick.ms, b = this.incomeTick[f];
    return { metallo: b.metallo * k, benzina: b.benzina * k, cibo: b.cibo * k };
  }

  /** Costruzione pronta in questa provincia (null se niente o ancora in cantiere). */
  workOf(p: number): WorkId | null {
    const w = this.provWork[p];
    return w >= 0 && this.provWorkAt[p] === 0 ? WORKS[w] : null;
  }

  /** Cantiere in corso: costruzione e ms che mancano. */
  workInProgress(p: number): { work: WorkId; leftMs: number } | null {
    const w = this.provWork[p];
    return w >= 0 && this.provWorkAt[p] > 0 ? { work: WORKS[w], leftMs: this.provWorkAt[p] - this.gameTimeMs } : null;
  }

  /** Perché il giocatore non può costruire qui (null = si può). */
  workBlock(p: number, w: WorkId, techs: string[] = this.opts.techs): null | 'owner' | 'busy' | 'tech' | 'troops' | 'loot' {
    const W = BALANCE.works[w];
    if (this.provOwner[p] !== PLAYER) return 'owner';
    if (this.provWork[p] >= 0) return 'busy';
    if (W.tech && !techs.includes(W.tech)) return 'tech';
    if (this.troops <= W.troops) return 'troops';
    if ((Object.keys(W.cost) as Resource[]).some((r) => this.backpack[r] < W.cost[r])) return 'loot';
    return null;
  }

  /** Avvia una costruzione (truppe + zaino); pronta dopo timeMs di gioco. */
  build(by: number, p: number, w: WorkId): boolean {
    const W = BALANCE.works[w];
    if (by === PLAYER && this.workBlock(p, w)) return false;
    const f = this.factions[by];
    f.troops -= W.troops;
    for (const r of Object.keys(W.cost) as Resource[]) f.loot[r] = Math.max(0, f.loot[r] - W.cost[r]);
    this.provWork[p] = WORKS.indexOf(w);
    this.provWorkAt[p] = this.gameTimeMs + W.timeMs;
    this.events.push({ type: 'work', by, p, work: w, phase: 'start' });
    return true;
  }

  /** IA dei fronti difficili: ogni tanto un bunker sulla provincia di confine più esposta verso di te. */
  private aiBuild(f: Faction) {
    const every = this.opts.front.aiBunkerEveryMs;
    if (this.opts.tutorial || !every || this.gameTimeMs < (this.nextAiBunkerAt[f.id] ?? Infinity)) return;
    this.nextAiBunkerAt[f.id] = this.gameTimeMs + every;
    const mine = this.frontier(PLAYER).filter((p) => this.provOwner[p] === f.id && this.provWork[p] < 0);
    if (!mine.length || f.troops < BALANCE.works.bunker.troops * 2) return;
    this.build(f.id, mine[Math.floor(this.aiRng() * mine.length)], 'bunker');
  }

  // ---------- durata della campagna ----------

  /** Tempo di gioco in cui la campagna finisce (la run guidata non ha limite). */
  get endMs(): number {
    if (this.opts.tutorial) return Infinity;
    return this.opts.endMs + this.bonusTimeMs;
  }

  /** ms alla fine della campagna. */
  get timeLeft(): number {
    return this.endMs - this.gameTimeMs;
  }

  /** Ultimo minuto: avviso; allo scadere vince chi ha più territorio, altrimenti si rientra col bottino. */
  private timerTick() {
    if (!this.timerWarned && this.timeLeft <= BALANCE.campaign.warnMs) {
      this.timerWarned = true;
      this.events.push({ type: 'timer', phase: 'warn' });
    }
    if (this.timeLeft > 0) return;
    const best = Math.max(...this.factions.filter((f) => f.alive).map((f) => f.tiles));
    this.end(this.player.tiles >= best ? 'victory' : 'timeout', 'time');
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
      if (this.player.provinces >= BALANCE.tutorial.goalProvinces) this.end('victory', 'tutorial');
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
      : outcome === 'retreat' ? 1 + this.opts.retreatBonus : outcome === 'timeout' ? 1 : 1 - this.opts.eliminatedLoss;
    return {
      seed: this.map.seed, outcome, reason: this.victoryReason, timeMs: this.gameTimeMs,
      maxTiles: this.player.maxTiles, maxProvinces: this.player.maxProvinces, anomalies: this.anomaliesOwned(), backpack: { ...bag }, kept: scaleBag(bag, k * this.opts.campaignLootMult),
      tutorial: this.opts.tutorial, civ: this.opts.civ, campaign: this.opts.campaign, front: this.opts.frontIndex,
    };
  }

  private tick() {
    this.countSettlements();
    this.economyTick();
    for (const f of this.factions) if (f.alive) this.grow(f);
    for (const f of this.factions) {
      if (f.id === PLAYER || !f.alive) continue;
      const assault = this.offensive?.phase === 'on' && this.offensive.faction === f.id;
      this.aiBuild(f);
      if (assault || this.aiRng() <= (this.opts.tutorial ? 0.07 : this.opts.front.aiActChance)) {
        const n = assault ? BALANCE.offensive.attacksPerAct : BALANCE.ai.attacksPerAct;
        for (let a = 0; a < n; a++) if (!this.aiAttack(f)) break;
      }
      this.aiUnits(f);
    }
    this.unitsTick();
    this.offensiveTick();
    this.timerTick();
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
    const p = this.provOf(t);
    const cost = this.passable(t) && this.provPassable(p) ? this.provCost(b.owner, p) : Infinity;
    if (!f.alive || b.troops <= cost) {
      this.events.push({ type: 'boat', phase: 'lost', boat: b });
      return;
    }
    this.transferProvince(b.owner, p, cost);
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
    if (!changed) return;
    // una provincia si vede se se ne vede almeno una casella
    this.provVisible.fill(0);
    for (const i of this.map.land) if (vis[i]) this.provVisible[this.provOf(i)] = 1;
    this.fogVersion++;
  }

  /** La casella è visibile al giocatore? (senza nebbia: sempre) */
  sees(i: number): boolean {
    return !this.opts.fog || this.visible[i] === 1;
  }

  seesProv(p: number): boolean {
    return !this.opts.fog || this.provVisible[p] === 1;
  }

  // ---------- avanzata ----------

  /** Avanzata verso la provincia di `target`: il fronte prende da solo una provincia alla volta, verso il bersaglio. */
  startFlow(target: number): boolean {
    const T = this.provOf(target);
    if (T < 0 || !this.provPassable(T) || this.provOwner[T] === PLAYER) return false;
    let own = -1;
    for (let i = 0; i < this.owner.length && own < 0; i++) if (this.owner[i] === PLAYER) own = i;
    if (own < 0 || !findPath(own, target, (i) => this.passable(i)).length) return false;
    this.flowTarget = T;
    this.flowAcc = BALANCE.flow.stepMs; // primo passo subito
    this.flowBestD = Infinity;
    this.flowSteps = 0;
    this.flowBudget = this.troops * (this.opts.tutorial ? 1 : this.attackRatio); // forza d'attacco
    return true;
  }

  /** Aggiunge o toglie una provincia dal piano; true se ora c'è. */
  togglePlan(p: number): boolean {
    const k = this.plan.indexOf(p);
    if (k >= 0) {
      this.plan.splice(k, 1);
      return false;
    }
    this.plan.push(p);
    return true;
  }

  /** Prossimo passo del piano: attacco diretto se confina, altrimenti avanzata verso la provincia. */
  private nextPlan() {
    while (this.plan.length) {
      const p = this.plan[0];
      if (this.provOwner[p] === PLAYER || !this.provPassable(p)) { this.plan.shift(); continue; }
      if (this.isFrontierProv(p) && this.troops > this.provCost(PLAYER, p)) {
        this.attackProvince(PLAYER, p);
        this.plan.shift();
        continue;
      }
      if (!this.startFlow(this.map.provinces[p].anchor)) { this.plan.shift(); continue; }
      return;
    }
  }

  stopFlow(reason: 'reached' | 'blocked' | 'budget' = 'blocked') {
    if (this.flowTarget === null) return;
    this.flowTarget = null;
    this.events.push({ type: 'flowEnd', reason });
  }

  private flowStep() {
    const T = this.flowTarget!;
    if (this.provOwner[T] === PLAYER) return this.stopFlow('reached');
    if (!this.provPassable(T)) return this.stopFlow('blocked');
    const tc = this.map.provinces[T].anchor;
    let best = -1, bestD = Infinity, bestCost = Infinity;
    for (const p of this.frontier(PLAYER)) {
      if (p !== T && this.provAnomaly[p]) continue; // l'avanzata non sbatte contro le anomalie per strada
      const d = p === T ? 0 : hexDistance(this.map.provinces[p].anchor, tc), cost = this.provCost(PLAYER, p);
      if (d < bestD || (d === bestD && cost < bestCost)) {
        best = p;
        bestD = d;
        bestCost = cost;
      }
    }
    if (best < 0 || (bestD > 0 && bestD > this.flowBestD + BALANCE.flow.giveUpSteps)) return this.stopFlow('blocked');
    if (this.flowSteps > 0 && bestCost > this.flowBudget) return this.stopFlow('budget'); // forza d'attacco esaurita
    if (this.troops - bestCost <= BALANCE.flow.reserve) return; // aspetta rinforzi, il bersaglio resta
    this.flowBestD = Math.min(this.flowBestD, bestD);
    if (this.attackProvince(PLAYER, best).ok) {
      this.flowBudget -= bestCost;
      this.flowSteps++;
      this.flowAcc -= BALANCE.flow.stepMs * (BALANCE.terrain[this.map.provinces[best].terrain].move - 1); // in montagna si avanza piano
    }
    if (this.provOwner[T] === PLAYER) this.stopFlow('reached');
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
    if (fx.timeBonusMs) this.bonusTimeMs += fx.timeBonusMs;
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
    const maxHp = BALANCE.units[type].hp * (f === PLAYER ? this.opts.unitHpMult : this.opts.front.aiUnitHpMult);
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
      const atk = U[u.type].attack * (u.owner === PLAYER ? this.opts.mods.unitAttackMult : 1); // munizioni perforanti
      if (target) dmg.set(target, (dmg.get(target) ?? 0) + atk * best);
    }
    for (const [v, d] of dmg) v.hp -= d;
    this.removeDead();

    // 2. movimento, conquista di ciò che si calpesta, cura in casa
    for (const u of [...this.units]) {
      if (u.hp <= 0) continue;
      const stats = U[u.type];
      if (!u.inCombat && u.path.length) {
        u.moveAcc += BALANCE.tick.ms;
        const next0 = this.map.tiles[u.path[0]];
        if (u.moveAcc >= stats.moveMs * (next0 ? BALANCE.terrain[next0.terrain].move : 1)) { // colline e montagne rallentano
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
      } else if (this.owner[u.tile] !== u.owner) {
        // la pedina prende tutta la provincia in cui entra
        const p = this.provOf(u.tile);
        u.hp -= this.provDefense(p) * stats.captureCost;
        if (u.hp > 0) this.transferProvince(u.owner, p, 0, u.id);
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
      // la provincia nemica colpita torna neutrale, il nemico perde il presidio
      const p = this.provOf(s.tile);
      const o = p >= 0 ? this.provOwner[p] : NEUTRAL;
      if (o !== NEUTRAL && o !== PLAYER) {
        const f = this.factions[o];
        for (const i of this.map.provinces[p].tiles) {
          if (this.owner[i] !== o) continue;
          this.owner[i] = NEUTRAL;
          f.tiles--;
          hits++;
        }
        f.troops = Math.max(0, f.troops - B.troopsPerTile * hits);
        f.provinces--;
        this.provOwner[p] = NEUTRAL;
        this.provWork[p] = -1; // le costruzioni saltano
        this.frontierCache.clear();
        this.events.push({ type: 'conquer', by: NEUTRAL, from: o, p, i: this.map.provinces[p].anchor, cost: 0, loot: 0, lootType: 'metallo' });
        if (f.tiles <= 0) this.eliminate(o, PLAYER);
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
    if (this.gameTimeMs < this.aiSpawnAt[f.id] || this.unitsOf(f.id).length >= this.opts.front.maxAiUnits) return;
    this.aiSpawnAt[f.id] = this.gameTimeMs + A.spawnEveryMs + (this.aiRng() * 2 - 1) * A.spawnJitterMs;
    // le armi delle IA dipendono dal fronte: più avanti, armi che tu forse non hai ancora
    const types = this.opts.front.aiUnits;
    const dominant = A.dominant[f.id] as UnitType;
    const type = types.includes(dominant) && this.aiRng() < A.dominantChance ? dominant : types[Math.floor(this.aiRng() * types.length)];
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
    const playerReady = !this.opts.tutorial && this.gameTimeMs >= this.opts.front.graceMs;
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

  /** IA: attacca la provincia vicina più debole, se se lo può permettere. */
  private aiAttack(f: Faction): boolean {
    let best = -1, bestScore = Infinity, bestCost = 0;
    const grace = this.opts.tutorial || this.gameTimeMs < this.opts.front.graceMs;
    const assault = this.offensive?.phase === 'on' && this.offensive.faction === f.id;
    for (const p of this.frontier(f.id)) {
      const o = this.provOwner[p];
      if (grace && o === PLAYER) continue;
      const prov = this.map.provinces[p];
      const capital = prov.city >= 0 && this.map.tiles[prov.city]!.capital ? BALANCE.provinces.aiCityAttraction : 1; // le capitali attirano
      const bias = o === PLAYER ? (assault ? BALANCE.offensive.playerBias : BALANCE.ai.playerBias) : 1;
      const cost = this.provCost(f.id, p);
      const score = cost * bias * capital;
      if (score < bestScore || (score === bestScore && this.aiRng() < 0.5)) {
        best = p;
        bestScore = score;
        bestCost = cost;
      }
    }
    if (best < 0 || f.troops <= bestCost * BALANCE.ai.reserve) return false;
    return this.attackProvince(f.id, best).ok;
  }

  /** Provincia di una casella (−1 = mare). */
  provOf(i: number): number {
    return i >= 0 ? this.map.tiles[i]?.province ?? -1 : -1;
  }

  /** Provincia vera (con caselle)? */
  provPassable(p: number): boolean {
    if (p < 0) return false;
    const prov = this.map.provinces[p];
    return !!prov && prov.tiles.length > 0;
  }

  /** Difesa della provincia: somma delle sue caselle (città, insediamenti, presidio compresi). */
  provDefense(p: number): number {
    let d = 0;
    for (const i of this.map.provinces[p].tiles) if (this.passable(i)) d += this.defenseOf(i);
    return d;
  }

  /** Truppe che `by` spende per prendere la provincia (più è grande l'impero, più costa: sovraestensione). */
  provCost(by: number, p: number): number {
    let d = 0;
    for (const i of this.map.provinces[p].tiles) if (this.passable(i)) d += this.costFor(by, i);
    if (by === PLAYER) d *= this.opts.mods.attackCostMult; // dottrina d'assalto
    if (this.provAnomaly[p]) return Math.ceil(d); // i Frammenti restano un obiettivo raggiungibile
    return Math.ceil(d * (1 + BALANCE.overextension * Math.max(0, this.factions[by].provinces - 1)));
  }

  passable(i: number): boolean {
    const t = this.map.tiles[i];
    return !!t;
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
    const work = this.workOf(t.province);
    // bunker: chiunque tenga la provincia (le fortezze rinforzano i tuoi)
    const bunker = work ? 1 + (BALANCE.works[work].defenseMult - 1) * (o === PLAYER ? this.opts.mods.bunkerMult : 1) : 1;
    const base = (t.type === 'anomalia' ? Math.ceil(t.defense * this.anomalyDefMult) : t.defense) * bunker;
    if (o === NEUTRAL) return Math.ceil(base);
    const f = this.factions[o];
    const garrison = Math.min((f.troops / Math.max(1, f.tiles)) * BALANCE.owned.garrison, BALANCE.owned.garrisonMax);
    const mine = o === PLAYER;
    const fort = this.fortBy[i] === o ? BALANCE.units.fortifyDefense : 0;
    const settlement = t.type === 'rovine' ? BALANCE.owned.settlementDefense + (mine ? this.opts.mods.settlementDefense : 0) : 0;
    const front = mine ? this.opts.mods.ownedDefenseMult : this.opts.tutorial ? 1 : this.opts.front.aiDefenseMult; // fronti difficili: IA trincerate
    return Math.ceil((base * BALANCE.owned.defenseMult + garrison + settlement + fort) * front);
  }

  /** La casella sta in una provincia attaccabile da `f`? */
  isFrontier(i: number, f = PLAYER): boolean {
    return this.isFrontierProv(this.provOf(i), f);
  }

  isFrontierProv(p: number, f = PLAYER): boolean {
    if (!this.provPassable(p) || this.provOwner[p] === f) return false;
    return this.map.provinces[p].neighbors.some((q) => this.provOwner[q] === f);
  }

  /** Province attaccabili: confinanti con il territorio della fazione. */
  frontier(f = PLAYER): number[] {
    const cached = this.frontierCache.get(f);
    if (cached) return cached;
    const set = new Set<number>();
    this.map.provinces.forEach((prov, p) => {
      if (this.provOwner[p] !== f) return;
      for (const q of prov.neighbors) if (this.provOwner[q] !== f && this.provPassable(q)) set.add(q);
    });
    const out = [...set];
    this.frontierCache.set(f, out);
    return out;
  }

  tryConquer(i: number): ConquerResult {
    return this.attackProvince(PLAYER, this.provOf(i));
  }

  attack(by: number, i: number): ConquerResult {
    return this.attackProvince(by, this.provOf(i));
  }

  attackProvince(by: number, p: number): ConquerResult {
    if (!this.provPassable(p)) return { ok: false, reason: 'impassable' };
    if (this.provOwner[p] === by) return { ok: false, reason: 'owned' };
    if (!this.isFrontierProv(p, by)) return { ok: false, reason: 'not-adjacent' };
    const cost = this.provCost(by, p);
    const att = this.factions[by];
    if (att.troops <= cost) return { ok: false, reason: 'troops', need: cost };
    att.troops -= cost;
    const { loot, lootType } = this.transferProvince(by, p, cost);
    return { ok: true, tile: this.map.tiles[this.map.provinces[p].anchor]!, cost, loot, lootType };
  }

  /** Passa la provincia a `by` (il costo è già stato pagato): bottino delle rovine, premio, capitale. */
  private transferProvince(by: number, p: number, cost: number, unit?: number): { loot: number; lootType: Resource } {
    const prov = this.map.provinces[p];
    const from = this.provOwner[p];
    const f = this.factions[by];
    if (from !== NEUTRAL) {
      const def = this.factions[from];
      let garrison = 0;
      for (const i of prov.tiles) if (this.passable(i) && this.owner[i] === from) garrison += this.defenseOf(i) - this.map.tiles[i]!.defense * BALANCE.owned.defenseMult;
      def.troops = Math.max(0, def.troops - garrison); // perde il presidio
      def.provinces--;
    }
    const bag = emptyBag();
    for (const i of prov.tiles) {
      if (!this.passable(i)) continue;
      const t = this.map.tiles[i]!;
      if (this.owner[i] !== NEUTRAL) this.factions[this.owner[i]].tiles--;
      if (t.loot) {
        bag[t.lootType] += this.lootFor(by, t.loot);
        t.loot = 0;
      }
      this.owner[i] = by;
      f.tiles++;
    }
    this.provOwner[p] = by;
    f.provinces++;
    f.maxProvinces = Math.max(f.maxProvinces, f.provinces);
    f.maxTiles = Math.max(f.maxTiles, f.tiles);
    this.frontierCache.clear();
    f.loot = addBag(f.loot, bag);
    const loot = bag.metallo + bag.benzina + bag.cibo;
    const lootType = (Object.keys(bag) as Resource[]).reduce((a, b) => (bag[b] > bag[a] ? b : a), 'metallo');
    this.events.push({ type: 'conquer', by, from, p, i: prov.anchor, cost, loot, lootType, unit });
    this.provinceReward(by, p);
    if (prov.city >= 0 && this.map.tiles[prov.city]!.capital && !this.capitalsTaken.has(prov.city)) {
      // capitale: truppe a chi la prende per primo
      this.capitalsTaken.add(prov.city);
      const bonus = Math.round(BALANCE.provinces.capitalTroops * (by === PLAYER ? this.opts.mods.capitalTroopsMult : 1));
      f.troops += bonus;
      const nation = this.map.nations.find((n) => n.id === prov.country)?.name ?? '';
      this.events.push({ type: 'province', by, province: p, count: prov.tiles.length, capital: true, nation, bonus });
    }
    if (from !== NEUTRAL && this.factions[from].tiles <= 0) this.eliminate(from, by);
    return { loot, lootType };
  }

  /** Prima volta che una fazione prende questa provincia: truppe e bottino (il "picco" alla Clash). */
  private provinceReward(by: number, p: number) {
    const prov = this.map.provinces[p];
    if (this.opts.tutorial) return;
    const key = `${by}:${p}`;
    if (this.provincesDone.has(key)) return;
    this.provincesDone.add(key);
    const R = BALANCE.provinceReward, n = prov.tiles.length;
    const f = this.factions[by];
    const troops = Math.round(n * R.troopsPerTile);
    f.troops += troops;
    const total = this.lootFor(by, Math.round(n * R.lootPerTile));
    const loot: Bag = { metallo: Math.ceil(total / 2), benzina: Math.floor(total / 4), cibo: Math.floor(total / 4) };
    for (const r of Object.keys(loot) as Resource[]) f.loot[r] += loot[r];
    const nation = this.map.nations.find((x) => x.id === prov.country)?.name ?? '';
    this.events.push({ type: 'provinceDone', by, province: p, nation, troops, loot });
  }

  /** Provincia assegnata senza combattere (partenza). */
  private claimProvince(f: number, p: number) {
    const fac = this.factions[f];
    for (const i of this.map.provinces[p].tiles) {
      if (!this.passable(i) || this.owner[i] !== NEUTRAL) continue;
      this.owner[i] = f;
      fac.tiles++;
    }
    this.provOwner[p] = f;
    fac.provinces++;
    fac.maxProvinces = Math.max(fac.maxProvinces, fac.provinces);
    fac.maxTiles = Math.max(fac.maxTiles, fac.tiles);
    this.frontierCache.clear();
  }

  // ---------- offensive nemiche ----------

  /** Ogni tanto un'IA confinante prepara un'offensiva: preavviso, poi attacchi concentrati su di te per un po'. */
  private offensiveTick() {
    const O = BALANCE.offensive;
    if (this.opts.tutorial || this.over) return;
    const o = this.offensive;
    if (o && this.gameTimeMs >= o.until) {
      if (o.phase === 'warn') {
        const f = this.factions[o.faction];
        if (!f.alive) { this.offensive = null; return; }
        f.troops += O.troopsBonus + f.tiles * O.troopsPerTile; // rinforzi per l'assalto
        this.offensive = { faction: o.faction, phase: 'on', until: this.gameTimeMs + O.durationMs, lostAtStart: this.player.tiles };
        this.events.push({ type: 'offensive', faction: o.faction, phase: 'start' });
      } else {
        this.events.push({ type: 'offensive', faction: o.faction, phase: 'end', lost: Math.max(0, o.lostAtStart - this.player.tiles) });
        this.offensive = null;
        this.nextOffensiveAt = this.gameTimeMs + this.opts.front.offensiveEveryMs + (this.aiRng() * 2 - 1) * O.jitterMs;
      }
      return;
    }
    if (o || this.gameTimeMs < this.nextOffensiveAt) return;
    // solo chi confina con te
    const near = this.factions.filter((f) => f.id !== PLAYER && f.alive && this.frontier(f.id).some((p) => this.provOwner[p] === PLAYER));
    if (!near.length) { this.nextOffensiveAt = this.gameTimeMs + 10_000; return; }
    const f = near[Math.floor(this.aiRng() * near.length)];
    this.offensive = { faction: f.id, phase: 'warn', until: this.gameTimeMs + O.warnMs, lostAtStart: 0 };
    this.events.push({ type: 'offensive', faction: f.id, phase: 'warn' });
  }

  private lootFor(by: number, n: number): number {
    return by === PLAYER ? Math.round(n * this.opts.mods.lootMult) : n;
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
    if (f === PLAYER) this.end('eliminated');
  }

}
