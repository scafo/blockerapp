// Stato logico di una run: nessuna dipendenza da Phaser.
import { BALANCE, type WorkDef, type AbilityType, type CampaignId, type CivId, type Resource, type UnitType, type WorkId } from '../config/balance';
import { addBag, emptyBag, scaleBag, type Bag } from './resources';
import { neighbors, hexDistance } from '../map/hexGrid';
import { UNIT_TYPES, findPath, isNaval, rps, type Stance, type Unit } from './units';
import { isCoast, seaRoute, type Boat } from './boats';
import { DEFAULT_OPTIONS, type RunOptions } from './camp';
import { EVENTS, type EventChoice, type EventEffects, type GameEvent } from './events';
import { createRng, type Rng } from '../map/rng';
import { FACTION_INFO } from './factions';
import type { FactionKind, RunMap, Tile } from '../map/generate';

const RESOURCE_KEYS: Resource[] = ['metallo', 'benzina', 'cibo'];
export const NEUTRAL = -1;
/** Costruzioni che si possono fare (Nico: ospedale, aeroporto e contraerea tolti; restano nell'elenco sotto solo per l'ordine). */
export const BUILDABLE: WorkId[] = ['fabbrica', 'bunker', 'caserma', 'radar', 'porto', 'rifornimenti', 'ferrovia'];
export const WORKS: WorkId[] = ['fabbrica', 'bunker', 'caserma', 'ospedale', 'radar', 'porto', 'aeroporto', 'rifornimenti', 'ferrovia', 'contraerea', 'raffineria', 'fattoria'];
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
  kind: FactionKind; // giocatore, impero o milizia provinciale
  workers: number; // quota di lavoratori (0..1)
  lootAcc: Record<Resource, number>; // frazioni di risorse prodotte dai lavoratori
}

/** Assalto a una provincia di qualcuno: truppe già pagate, si risolve a `endMs`. Con `unit` è l'assedio di una pedina. */
export interface Battle { id: number; p: number; by: number; from: number; troops: number; def0: number; startMs: number; endMs: number; unit?: number }

export type RunEvent =
  | { type: 'conquer'; by: number; from: number; p: number; i: number; cost: number; loot: number; lootType: Resource; unit?: number }
  | { type: 'timer'; phase: 'warn' }
  | { type: 'work'; by: number; p: number; work: WorkId; phase: 'start' | 'done' }
  | { type: 'event'; event: GameEvent }
  | { type: 'focus'; p: number }
  | { type: 'flowEnd'; reason: 'reached' | 'blocked' | 'budget' }
  | { type: 'boat'; phase: 'landed' | 'lost'; boat: Boat }
  | { type: 'province'; by: number; province: number; count: number; capital: boolean; nation: string; bonus: number }
  | { type: 'unitDied'; unit: Unit }
  | { type: 'ability'; ability: AbilityType; tile: number; phase: 'launch' | 'impact'; hits?: number; by: number; blocked?: boolean }
  | { type: 'coalition'; phase: 'form' | 'end'; members: number[] }
  | { type: 'provinceDone'; by: number; province: number; nation: string; troops: number; loot: Bag }
  | { type: 'offensive'; faction: number; phase: 'warn' | 'start' | 'end'; lost?: number }
  | { type: 'eliminated'; faction: number; by: number; loot: Bag }
  | { type: 'diplomacy'; faction: number; what: DiploWhat; byPlayer: boolean; amount?: number }
  | { type: 'encircled'; by: number; from: number; provinces: number[] }
  | { type: 'battle'; phase: 'start' | 'won' | 'lost' | 'off'; battle: Battle }
  | { type: 'capital'; faction: number; p: number }
  | { type: 'hit'; from: number; to: number; fromTile: number; toTile: number; dmg: number; owner: number };

export type Outcome = 'eliminated' | 'victory' | 'retreat' | 'timeout';
/** Rapporto di una fazione col giocatore. */
export type Relation = 'guerra' | 'pace' | 'alleanza';
export type DiploWhat = 'war' | 'peace' | 'alliance' | 'broken' | 'refused' | 'tribute' | 'gift';
export type VictoryReason = 'map' | 'time' | 'tutorial';

export interface RunSummary {
  seed: string;
  outcome: Outcome;
  reason?: VictoryReason;
  timeMs: number;
  maxTiles: number;
  maxProvinces: number;
  backpack: Bag; // zaino a fine run
  kept: Bag; // portato a casa dopo perdite/bonus
  stake: Bag; // puntata messa in gioco
  gainMult: number; // moltiplicatore del guadagno oltre la puntata (puntata × fronte × durata)
  feePct: number; // % dello zaino persa (ritirata, eliminazione)
  stakeLossPct: number; // % della puntata persa (fine campagna senza vincere)
  tutorial: boolean;
  civ: CivId;
  campaign: CampaignId;
  front: number; // indice del fronte
  world?: { core: number[]; fallen: number[]; rivals: { id: number; relation: Relation; opinion: number }[] }; // eredità per la prossima campagna
}

export type ConquerResult =
  | { ok: true; tile: Tile; cost: number; loot: number; lootType: Resource; battle?: Battle }
  | { ok: false; reason: 'not-adjacent' | 'impassable' | 'owned' | 'troops' | 'battle' | 'units'; need?: number };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

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
  /** frecce dei rapporti radar sulla carta (caselle) */
  alerts: { from: number; to: number; until: number }[] = [];
  /** province nemiche segnalate come sguarnite: costo dimezzato fino a */
  weakUntil = new Map<number, number>();
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
  private worksBuilt: number[] = [];
  /** provincia sul mare (porto possibile) */
  provCoastal = new Uint8Array(0); // costruzioni avviate per fazione (fanno salire il prezzo)
  /** per provincia: peso di crescita (caselle × terreno), risorsa e quantità prodotta a ogni tick */
  private provGrowthW: Float32Array;
  private cityProv = new Set<number>(); // province che valgono di più (Nico: le città)
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
  attackRatio = 1; // leva ATTACCO tolta (Nico: complicava solo): le avanzate usano tutte le truppe
  private flowBestD = Infinity;
  private flowSteps = 0;
  /** Genio: caselle fortificate (proprietario della fortificazione, −1 = nessuna). */
  private fortBy: Int8Array;
  /** Cannoniera: caselle di costa coperte dal fuoco (fazione che ne approfitta, −1 = nessuna). */
  private supportBy: Int8Array;
  /** Abilità: pronte da (tempo di gioco), ricognizioni in volo, bombardamenti in arrivo. */
  abilityReadyAt: Record<AbilityType, number> = { ricognizione: 0, bombardamento: 0 };
  private recons: { tile: number; until: number }[] = [];
  private strikes: { tile: number; at: number; by: number }[] = [];
  /** Bombardamenti delle IA (dal Fronte III): prossimo per fazione. */
  private aiStrikeAt: number[] = [];
  /** Coalizione contro il giocatore: imperi che hanno smesso di farsi la guerra tra loro. */
  readonly coalition = new Set<number>();
  /** Ferrovie: per provincia, la fazione le cui pedine ci corrono (−1 = nessuna). Ricalcolato a ogni tick. */
  private railBy: Int8Array;
  /** Rancio: frazione di cibo mangiata dall'esercito e non ancora tolta dallo zaino. */
  private foodAcc = 0;
  units: Unit[] = [];
  battles: Battle[] = [];
  private nextBattleId = 1;
  /** Rifornimento di ogni provincia (0–1) per chi la possiede; capitale di ogni fazione (provincia, −1 = nessuna). */
  supply!: Float32Array;
  capitalProv: number[] = [];
  private supplyDirty = true;
  /** fazione → tipo → tempo di gioco in cui la carta torna disponibile */
  readonly cooldowns: Record<UnitType, number>[];
  private nextUnitId = 1;
  private aiSpawnAt: number[];
  /** Eventi da mostrare; la scena li consuma con drainEvents(). */
  private events: RunEvent[] = [];
  private tickAcc = 0;
  /** fazione → province attaccabili (confinanti, non sue) */
  private frontierCache = new Map<number, number[]>();
  // diplomazia (rapporti col giocatore)
  readonly relation: Relation[] = [];
  readonly opinion: number[] = [];
  private truceUntil: number[] = [];
  private askedAt: number[] = [];
  private warLosses: number[] = []; // province prese dal giocatore in questa guerra
  private diploAt = 0;
  private encircleAt = 0;
  private aiRng: Rng;
  private capitalsTaken = new Set<number>();
  private ruins: number[];

  constructor(readonly map: RunMap, readonly opts: RunOptions = DEFAULT_OPTIONS) {
    this.owner = new Int8Array(map.tiles.length).fill(NEUTRAL);
    this.provOwner = new Int8Array(map.provinces.length).fill(NEUTRAL);
    this.provVisible = new Uint8Array(map.provinces.length).fill(1);
    this.fortBy = new Int8Array(map.tiles.length).fill(-1);
    this.supportBy = new Int8Array(map.tiles.length).fill(-1);
    this.railBy = new Int8Array(map.provinces.length).fill(-1);
    // stesso mondo, campagna nuova: stessa mappa ma le IA e gli eventi non rifanno le stesse mosse
    const salt = opts.world?.campaign ? ':' + opts.world.campaign : '';
    this.aiRng = createRng(map.seed + ':ia' + salt);
    this.ruins = map.land.filter((i) => map.tiles[i]!.type === 'rovine');
    this.evRng = createRng(map.seed + ':eventi' + salt);
    const B = BALANCE.bots;
    this.factions = map.starts.map((_, id) => ({
      id,
      kind: map.kinds[id],
      troops: id === PLAYER ? BALANCE.start.troops + opts.mods.startTroops
        : map.kinds[id] === 'bot' ? B.startTroops[0] + Math.round(this.aiRng() * (B.startTroops[1] - B.startTroops[0])) : opts.front.aiStartTroops,
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
    // nello zaino la puntata e la scorta di guerra (si spendono per reparti ed edifici; la scorta non conta come bottino)
    const SS = opts.tutorial ? emptyBag() : BALANCE.economy.startStock;
    this.factions[PLAYER].loot = { metallo: opts.stake.metallo + SS.metallo, benzina: opts.stake.benzina + SS.benzina, cibo: opts.stake.cibo + SS.cibo };
    this.factions.forEach((f) => {
      this.relation.push(f.kind === 'bot' ? 'guerra' : 'pace'); // milizie ostili, imperi in pace finché non vi toccate
      this.opinion.push(f.kind === 'bot' ? -20 : 0);
      this.truceUntil.push(0);
      this.askedAt.push(-1e9);
      this.warLosses.push(0);
    });
    // i rivali si ricordano di te: gli alleati restano alleati, chi era in guerra riparte in pace ma col rancore
    for (const r of opts.world?.rivals ?? []) {
      if (map.kinds[r.id] !== 'empire') continue;
      this.relation[r.id] = r.relation === 'alleanza' ? 'alleanza' : 'pace';
      this.opinion[r.id] = r.relation === 'guerra' ? Math.min(r.opinion, BALANCE.world.grudge) : r.opinion;
    }
    this.diploAt = BALANCE.diplomacy.checkMs;
    this.visible = new Uint8Array(map.tiles.length);
    this.seen = new Uint8Array(map.tiles.length);
    if (opts.fog) {
      // zona già nota attorno alla partenza: si vede la carta ma non chi la occupa (la Sala Radar la allarga)
      const r0 = BALANCE.fog.intel + opts.mods.fogIntel, dist = new Map<number, number>([[map.starts[0], 0]]);
      const queue = [map.starts[0]];
      for (let h = 0; h < queue.length; h++) {
        const c = queue[h], d = dist.get(c)!;
        this.seen[c] = 1;
        if (d >= r0) continue;
        for (const n of neighbors(c)) if (n >= 0 && !dist.has(n)) { dist.set(n, d + 1); queue.push(n); }
      }
    }
    this.cooldowns = this.factions.map(() => Object.fromEntries(UNIT_TYPES.map((t) => [t, 0])) as Record<UnitType, number>);
    this.aiSpawnAt = this.factions.map(() => BALANCE.aiUnits.firstSpawnMs + this.aiRng() * BALANCE.aiUnits.spawnJitterMs);
    this.nextOffensiveAt = opts.front.offensiveFirstMs;
    this.aiStrikeAt = this.factions.map(() => BALANCE.aiStrike.firstMs + this.aiRng() * BALANCE.aiStrike.jitterMs);
    // economia per provincia: crescita pesata dal terreno, risorsa del terreno prevalente
    const T = BALANCE.terrain;
    this.provGrowthW = Float32Array.from(map.provinces, (p) => p.tiles.reduce((s, i) => s + T[map.tiles[i]!.terrain].growth, 0));
    // città: solo quelle della carta (`places.json`, sparse su tutto il mondo), le aggiunge la scena con setCities.
    // Prima valevano anche tutte le capitali delle nazioni: quasi tutte in Europa, che diventava la zona più ricca (Nico)
    this.worksBuilt = map.starts.map(() => 0);
    this.provWork = new Int8Array(map.provinces.length).fill(-1);
    this.provCoastal = Uint8Array.from(map.provinces, (pr) => (pr.tiles.some((i) => isCoast(map.tiles, i)) ? 1 : 0));
    this.provWorkAt = new Float64Array(map.provinces.length);
    this.gw = this.factions.map(() => 0);
    this.supply = new Float32Array(map.provinces.length).fill(1);
    this.capitalProv = map.starts.map((st) => this.provOf(st)); // si parte dalla propria capitale
    this.incomeTick = this.factions.map(() => emptyBag());
    // si parte con la provincia della propria partenza; le milizie con qualcuna attorno
    map.starts.forEach((s, f) => this.claimProvince(f, this.provOf(s)));
    // impero persistente: riprendi il nucleo della campagna precedente (prima delle milizie, dopo le partenze)
    // solo la parte del nucleo attaccata alla partenza: se la partenza è cambiata (ora si sceglie per nazione) il vecchio
    // nucleo resterebbe un'isola lontana
    const core = new Set((opts.world?.core ?? []).filter((p) => p >= 0 && p < map.provinces.length));
    const linked: number[] = [], seenCore = new Set<number>([this.provOf(map.starts[PLAYER])]), queue = [this.provOf(map.starts[PLAYER])];
    for (let h = 0; h < queue.length; h++) for (const q of map.provinces[queue[h]].neighbors) {
      if (!core.has(q) || seenCore.has(q)) continue;
      seenCore.add(q);
      queue.push(q);
      linked.push(q);
    }
    for (const p of linked) if (this.provOwner[p] === NEUTRAL && this.provPassable(p)) this.claimProvince(PLAYER, p);
    map.starts.forEach((s, f) => {
      if (map.kinds[f] !== 'bot') return;
      let extra = B.provinces[0] - 1 + Math.floor(this.aiRng() * (B.provinces[1] - B.provinces[0] + 1));
      for (const q of map.provinces[this.provOf(s)].neighbors) {
        if (extra <= 0) break;
        if (this.provOwner[q] === NEUTRAL && this.provPassable(q)) { this.claimProvince(f, q); extra--; }
      }
    });
    // fronti difficili: le IA partono con qualche bunker attorno alla capitale e ne costruiscono altri
    if (!opts.tutorial) {
      map.starts.forEach((s, f) => {
        if (map.kinds[f] !== 'empire') return;
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
    const mult = f.id === PLAYER ? boost * this.opts.mods.growthMult * this.foodMult : f.kind === 'bot' ? BALANCE.bots.growthMult
      : this.opts.tutorial ? BALANCE.tutorial.aiGrowthMult : this.opts.front.aiGrowthMult;
    const perSettlement = BALANCE.settlements.growthTiles + (f.id === PLAYER ? this.opts.mods.settlementGrowth : 0);
    const tiles = this.gw[f.id] + f.settlements * perSettlement; // caselle pesate dal terreno + caserme + insediamenti
    // freno della valanga sulla crescita (non sui costi, che restano fissi): oltre il ginocchio un impero più grande cresce
    // meno che in proporzione, così la campagna dura e i prezzi non cambiano mai
    const E = BALANCE.economy, eff = tiles <= E.growthKnee ? tiles : E.growthKnee * Math.pow(tiles / E.growthKnee, E.growthExp);
    return eff * BALANCE.tick.troopsPerTile * mult;
  }

  /** Rancio: l'esercito mangia il cibo dello zaino; con cibo cresce di più, senza cresce meno (run guidata: niente). */
  get foodMult(): number {
    if (this.opts.tutorial) return 1;
    return this.player.loot.cibo > 0 ? BALANCE.food.fedGrowth : BALANCE.food.hungryGrowth;
  }

  /** Cibo mangiato al minuto dall'esercito (province oltre le prime, gratis). */
  get foodPerMin(): number {
    if (this.opts.tutorial) return 0;
    return Math.max(0, this.player.provinces - BALANCE.food.freeProvinces) * BALANCE.food.perProvPerMin;
  }

  private eat() {
    this.foodAcc += (this.foodPerMin * BALANCE.tick.ms) / 60_000;
    const whole = Math.floor(this.foodAcc);
    if (whole <= 0) return;
    this.foodAcc -= whole;
    this.player.loot.cibo = Math.max(0, this.player.loot.cibo - whole);
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
    this.railBy.fill(-1);
    for (const b of this.incomeTick) b.metallo = b.benzina = b.cibo = 0;
    for (let p = 0; p < this.provOwner.length; p++) {
      const o = this.provOwner[p];
      const w = this.provWork[p];
      if (w >= 0 && this.provWorkAt[p] > 0 && this.provWorkAt[p] <= this.gameTimeMs) {
        this.provWorkAt[p] = 0; // pronta
        this.supplyDirty = true; // un deposito di rifornimento cambia la logistica
        this.events.push({ type: 'work', by: o, p, work: WORKS[w], phase: 'done' });
      }
      if (o === NEUTRAL) continue;
      const ready = w >= 0 && this.provWorkAt[p] === 0 ? W[WORKS[w]] : null;
      const sup = 0.5 + 0.5 * this.supply[p]; // logistica: lontano dalla capitale si cresce e si produce meno (al massimo la metà)
      this.gw[o] += this.provGrowthW[p] * sup + (ready?.growthTiles ?? 0);
      const f = this.factions[o];
      const k = (o === PLAYER ? this.opts.mods.lootMult * this.opts.mods.prodMult : 1) * sup;
      // tutte e tre le risorse da ogni provincia (Nico): quella del terreno di più; la fabbrica moltiplica tutto
      const bag = this.provMade(p, ready);
      for (const r of RESOURCE_KEYS) {
        const v = bag[r] * k * (BALANCE.tick.ms / 60_000);
        f.lootAcc[r] += v;
        this.incomeTick[o][r] += v;
      }
      // ferrovia: le pedine del padrone corrono qui e nelle sue province accanto
      if (ready?.railMult) {
        this.railBy[p] = o;
        for (const q of this.map.provinces[p].neighbors) if (this.provOwner[q] === o) this.railBy[q] = o;
      }
    }
  }

  /** Risorse al minuto della fazione (province, fabbriche, lavoratori). */
  incomePerMin(f = PLAYER): Bag {
    const k = 60_000 / BALANCE.tick.ms, b = this.incomeTick[f];
    return { metallo: b.metallo * k, benzina: b.benzina * k, cibo: b.cibo * k };
  }

  /** Risorse al minuto prodotte dalla provincia (terreno + fabbrica), come le conta economyTick. */
  provPerMin(p: number): number {
    const b = this.provBag(p);
    return b.metallo + b.benzina + b.cibo;
  }

  /** Risorse al minuto della provincia, una per una (senza la logistica). */
  provBag(p: number): Bag {
    const w = this.workOf(p), o = this.provOwner[p], k = o === PLAYER ? this.opts.mods.lootMult * this.opts.mods.prodMult : 1;
    const b = this.provMade(p, w ? BALANCE.works[w] : null);
    return { metallo: b.metallo * k, benzina: b.benzina * k, cibo: b.cibo * k };
  }

  /** Aggiunge le province delle città vere della carta (nomi in places.json). */
  setCities(provs: number[]) {
    for (const p of provs) if (p >= 0) this.cityProv.add(p);
  }

  /** Città: province con più valore (città vere della carta e capitali delle nazioni): producono di più e premiano di più. */
  isCity(p: number): boolean {
    return this.cityProv.has(p);
  }

  /** Produzione al minuto (60% risorsa del terreno, 20% ciascuna le altre; città × cityMult, fabbrica ×, raffineria/fattoria +). */
  private provMade(p: number, ready: WorkDef | null): Bag {
    const E = BALANCE.economy, prov = this.map.provinces[p], T = BALANCE.terrain[prov.terrain];
    const total = T.perMin * E.totalMult * (this.cityProv.has(p) ? E.cityMult : 1) * (ready?.prodMult ?? 1);
    const out: Bag = { metallo: 0, benzina: 0, cibo: 0 };
    for (const r of RESOURCE_KEYS) out[r] = total * (r === T.res ? E.mainShare : (1 - E.mainShare) / 2);
    if (ready?.res && ready.prodAdd) out[ready.res] += ready.prodAdd;
    return out;
  }

  /** Costruzioni pronte di quel tipo nel territorio della fazione. */
  worksOf(f: number, w: WorkId): number {
    const k = WORKS.indexOf(w);
    let n = 0;
    for (let p = 0; p < this.provOwner.length; p++) if (this.provOwner[p] === f && this.provWork[p] === k && this.provWorkAt[p] === 0) n++;
    return n;
  }

  /** Cura della pedina: ×3 con un tuo ospedale nella sua provincia o in una accanto. */
  private healMult(u: Unit): number {
    const k = WORKS.indexOf('ospedale'), p = this.provOf(u.tile);
    if (p < 0) return 1;
    const has = (q: number) => this.provOwner[q] === u.owner && this.provWork[q] === k && this.provWorkAt[q] === 0;
    return has(p) || this.map.provinces[p].neighbors.some(has) ? BALANCE.works.ospedale.heal ?? 1 : 1;
  }

  /** Costruzioni avviate dal giocatore in questa campagna. */
  get worksStarted(): number {
    return this.worksBuilt[PLAYER] ?? 0;
  }

  /** Truppe che costa una costruzione di quel tipo: prezzo fisso per tutta la partita (come in Call of War). */
  workPrice(w: WorkId, _by = PLAYER): number {
    return BALANCE.works[w].troops;
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
  workBlock(p: number, w: WorkId, techs: string[] = this.opts.techs): null | 'owner' | 'busy' | 'tech' | 'troops' | 'over' | 'coast' | 'metal' {
    const W = BALANCE.works[w];
    if (this.over) return 'over';
    if (this.provOwner[p] !== PLAYER) return 'owner';
    if (this.provWork[p] >= 0) return 'busy';
    if (W.tech && !techs.includes(W.tech)) return 'tech';
    if (W.coastal && !this.provCoastal[p]) return 'coast';
    if (this.troops <= this.workPrice(w)) return 'troops';
    if (this.backpack.metallo < this.workMetal(w)) return 'metal';
    return null;
  }

  /** Metallo dallo zaino per una costruzione del giocatore (le IA pagano solo in truppe). */
  workMetal(w: WorkId): number {
    return this.opts.tutorial ? 0 : BALANCE.works[w].metal;
  }

  /** Muro: bunker su tutte le province trascinate, in ordine, finché bastano truppe e metallo. */
  buildWall(provs: number[], w: WorkId = 'bunker'): { built: number; skipped: number; stop: ReturnType<RunState['workBlock']> } {
    let built = 0, skipped = 0, stop: ReturnType<RunState['workBlock']> = null;
    for (const p of provs) {
      const why = this.workBlock(p, w);
      if (why === 'troops' || why === 'metal' || why === 'over') { stop = why; break; }
      if (why) { skipped++; continue; }
      if (this.build(PLAYER, p, w)) built++;
    }
    return { built, skipped, stop };
  }

  /** Avvia una costruzione pagandola in truppe; pronta dopo timeMs di gioco. */
  build(by: number, p: number, w: WorkId): boolean {
    const W = BALANCE.works[w];
    if (by === PLAYER && this.workBlock(p, w)) return false;
    const f = this.factions[by];
    f.troops -= this.workPrice(w, by);
    if (by === PLAYER) f.loot.metallo -= this.workMetal(w);
    this.worksBuilt[by] = (this.worksBuilt[by] ?? 0) + 1;
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
    if (!mine.length || f.troops < this.workPrice('bunker', f.id) * 2) return;
    this.build(f.id, mine[Math.floor(this.aiRng() * mine.length)], 'bunker'); // contraerea tolta (Nico)
  }

  // ---------- diplomazia (alla HOI4) ----------

  /** Due fazioni si possono attaccare? Con la terra libera sempre; col giocatore solo in guerra; tra IA sempre. */
  atWar(a: number, b: number): boolean {
    if (a === b) return false;
    if (a === NEUTRAL || b === NEUTRAL) return true;
    if (a === PLAYER) return this.relation[b] === 'guerra';
    if (b === PLAYER) return this.relation[a] === 'guerra';
    if (this.coalition.has(a) && this.coalition.has(b)) return false; // coalizione: tra loro non si attaccano
    return true;
  }

  private setRelation(f: number, r: Relation, byPlayer: boolean, what: DiploWhat) {
    this.relation[f] = r;
    if (r !== 'guerra') this.warLosses[f] = 0;
    this.frontierCache.clear();
    if (this.flowTarget !== null && !this.atWar(PLAYER, this.provOwner[this.flowTarget])) this.stopFlow('blocked');
    this.events.push({ type: 'diplomacy', faction: f, what, byPlayer });
  }

  private bump(f: number, d: number) {
    this.opinion[f] = clamp(this.opinion[f] + d, -100, 100);
  }

  /** Perché non si può fare ora un'azione diplomatica (null = si può). */
  diploBlock(f: number): null | 'dead' | 'cooldown' | 'truce' {
    if (f === PLAYER || f < 0 || !this.factions[f]?.alive || this.over) return 'dead';
    if (this.gameTimeMs - this.askedAt[f] < BALANCE.diplomacy.askCooldownMs) return 'cooldown';
    return null;
  }

  declareWar(f: number): boolean {
    if (this.diploBlock(f) === 'dead' || this.relation[f] === 'guerra') return false;
    if (this.gameTimeMs < this.truceUntil[f]) return false;
    this.bump(f, -40);
    // chi rompe la pace si fa una brutta fama
    this.factions.forEach((o) => { if (o.kind === 'empire' && o.id !== f) this.bump(o.id, -6); });
    this.setRelation(f, 'guerra', true, 'war');
    return true;
  }

  /** Proposta di pace: accettano più volentieri se stanno perdendo, se sei più forte o se ti stimano. */
  proposePeace(f: number): 'ok' | 'refused' | 'cooldown' | 'dead' {
    const b = this.diploBlock(f);
    if (b === 'dead' || this.relation[f] !== 'guerra') return 'dead';
    if (b === 'cooldown') return 'cooldown';
    this.askedAt[f] = this.gameTimeMs;
    const D = BALANCE.diplomacy, them = this.factions[f];
    const ratio = clamp(this.player.troops / Math.max(1, them.troops), 0.2, 4);
    const chance = clamp(D.peaceBase + this.opinion[f] / 200 + (ratio - 1) * 0.15 + this.warLosses[f] * 0.04, 0.05, 0.95);
    if (this.aiRng() > chance) {
      this.bump(f, -4);
      this.events.push({ type: 'diplomacy', faction: f, what: 'refused', byPlayer: true });
      return 'refused';
    }
    this.bump(f, 10);
    this.truceUntil[f] = this.gameTimeMs + D.truceMs;
    this.setRelation(f, 'pace', true, 'peace');
    return 'ok';
  }

  proposeAlliance(f: number): 'ok' | 'refused' | 'cooldown' | 'dead' | 'opinion' {
    const b = this.diploBlock(f);
    if (b === 'dead' || this.relation[f] !== 'pace' || this.factions[f].kind !== 'empire') return 'dead';
    if (b === 'cooldown') return 'cooldown';
    if (this.opinion[f] < BALANCE.diplomacy.allyOpinion) return 'opinion';
    this.askedAt[f] = this.gameTimeMs;
    if (this.aiRng() > 0.35 + this.opinion[f] / 150) {
      this.events.push({ type: 'diplomacy', faction: f, what: 'refused', byPlayer: true });
      return 'refused';
    }
    this.setRelation(f, 'alleanza', true, 'alliance');
    return 'ok';
  }

  breakAlliance(f: number): boolean {
    if (this.relation[f] !== 'alleanza') return false;
    this.bump(f, -30);
    this.setRelation(f, 'pace', true, 'broken');
    return true;
  }

  /** Dona truppe: rinforzi per loro, opinione per te. Ritorna quante. */
  donateTroops(f: number): number {
    if (this.diploBlock(f) === 'dead') return 0;
    const D = BALANCE.diplomacy;
    const n = Math.floor(Math.max(D.donateMin, this.troops * D.donateShare));
    if (this.troops <= n + 1) return 0;
    this.troops -= n;
    this.factions[f].troops += n;
    this.bump(f, Math.min(25, n * D.opinionPerTroop));
    this.events.push({ type: 'diplomacy', faction: f, what: 'gift', byPlayer: true, amount: n });
    return n;
  }

  /** Dona risorse dallo zaino (la più abbondante). */
  donateLoot(f: number): Resource | null {
    if (this.diploBlock(f) === 'dead') return null;
    const D = BALANCE.diplomacy, bag = this.player.loot;
    const r = (Object.keys(bag) as Resource[]).reduce((a, c) => (bag[c] > bag[a] ? c : a));
    if (bag[r] < D.donateLoot) return null;
    bag[r] -= D.donateLoot;
    this.factions[f].loot[r] += D.donateLoot;
    this.bump(f, 12);
    this.events.push({ type: 'diplomacy', faction: f, what: 'gift', byPlayer: true, amount: D.donateLoot });
    return r;
  }

  /** Tributo da una milizia: paga se sei molto più forte, altrimenti si offende. */
  demandTribute(f: number): number {
    const b = this.diploBlock(f);
    if (b || this.factions[f].kind !== 'bot') return 0;
    this.askedAt[f] = this.gameTimeMs;
    const D = BALANCE.diplomacy, them = this.factions[f];
    if (this.troops < them.troops * D.tributeRatio) {
      this.bump(f, -15);
      this.events.push({ type: 'diplomacy', faction: f, what: 'refused', byPlayer: true });
      return 0;
    }
    const n = D.tribute;
    this.player.loot.metallo += Math.ceil(n / 2);
    this.player.loot.cibo += Math.floor(n / 2);
    this.bump(f, -10);
    this.events.push({ type: 'diplomacy', faction: f, what: 'tribute', byPlayer: true, amount: n });
    return n;
  }

  /** Ogni tanto: l'opinione torna verso lo zero; gli imperi in pace che ti toccano possono dichiararti guerra. */
  private diploTick() {
    if (this.opts.tutorial || this.over || this.gameTimeMs < this.diploAt) return;
    const D = BALANCE.diplomacy;
    this.diploAt = this.gameTimeMs + D.checkMs;
    for (const f of this.factions) {
      if (f.id === PLAYER || !f.alive) continue;
      this.opinion[f.id] *= 0.97; // i ricordi sbiadiscono
      if (f.kind !== 'empire' || this.relation[f.id] !== 'pace') continue;
      if (this.gameTimeMs < this.opts.front.graceMs || this.gameTimeMs < this.truceUntil[f.id]) continue;
      const borders = this.map.provinces.some((p, k) => this.provOwner[k] === f.id && p.neighbors.some((q) => this.provOwner[q] === PLAYER));
      if (!borders) continue;
      const strength = clamp(f.troops / Math.max(1, this.player.troops), 0.4, 2.5);
      const chance = D.warChance * (0.4 + 0.2 * this.opts.frontIndex) * strength * clamp(1 - this.opinion[f.id] / 60, 0, 1.6); // fronti duri: più guerre
      if (this.aiRng() < chance) this.setRelation(f.id, 'guerra', false, 'war');
    }
    this.coalitionTick();
  }

  /**
   * Coalizione: se hai molte più province dell'impero più grande, gli imperi rivali smettono di combattersi e ti dichiarano
   * guerra insieme (gli alleati restano alleati). Si scioglie quando il distacco cala.
   */
  private coalitionTick() {
    const C = BALANCE.coalition;
    const empires = this.factions.filter((f) => f.kind === 'empire' && f.alive);
    const top = Math.max(1, ...empires.map((f) => f.provinces));
    const me = this.player.provinces;
    if (!this.coalition.size) {
      if (me < C.minProvinces || me < top * C.ratio || empires.length < 2) return;
      for (const f of empires) if (this.relation[f.id] !== 'alleanza') this.coalition.add(f.id);
      if (this.coalition.size < 2) { this.coalition.clear(); return; }
      this.frontierCache.clear();
      this.events.push({ type: 'coalition', phase: 'form', members: [...this.coalition] });
    } else if (me < top * C.endRatio) {
      const members = [...this.coalition];
      this.coalition.clear();
      this.frontierCache.clear();
      this.events.push({ type: 'coalition', phase: 'end', members });
      return;
    }
    // i membri entrano in guerra con te appena finisce la tregua
    for (const id of this.coalition) {
      if (!this.factions[id].alive) { this.coalition.delete(id); continue; }
      if (this.relation[id] === 'pace' && this.gameTimeMs >= this.truceUntil[id]) {
        this.relation[id] = 'guerra';
        this.opinion[id] = Math.min(this.opinion[id], C.opinion);
        this.frontierCache.clear();
      }
    }
  }

  // ---------- accerchiamenti ----------

  /**
   * Sacche: un gruppo di province (libere o di una fazione) circondato via terra da una sola fazione in guerra con lui
   * passa a chi lo circonda. Una fazione non perde così il cuore del suo territorio (la capitale o più di metà delle province) se è grande.
   */
  private encircleTick() {
    if (this.opts.tutorial || this.over || this.gameTimeMs < this.encircleAt) return;
    this.encircleAt = this.gameTimeMs + 2000;
    const E = BALANCE.encircle, own = this.provOwner, provs = this.map.provinces;
    const seen = new Uint8Array(own.length);
    for (let p0 = 0; p0 < own.length; p0++) {
      if (seen[p0] || !this.provPassable(p0)) continue;
      const o = own[p0];
      const comp = [p0];
      seen[p0] = 1;
      let by = -2, open = false;
      for (let h = 0; h < comp.length; h++) {
        for (const q of provs[comp[h]].neighbors) {
          if (!this.provPassable(q)) continue;
          if (own[q] === o) {
            if (!seen[q]) { seen[q] = 1; comp.push(q); }
            continue;
          }
          if (by === -2) by = own[q];
          else if (by !== own[q]) open = true;
        }
      }
      if (open || by < 0 || !this.atWar(by, o)) continue;
      const max = o === NEUTRAL ? E.maxNeutral : E.maxPocket;
      // il cuore di una fazione (con la capitale o più di metà del suo territorio) non si arrende in blocco
      const core = o !== NEUTRAL && (comp.includes(this.provOf(this.map.starts[o])) || comp.length * 2 > this.factions[o].provinces);
      if (comp.length > max && (o === NEUTRAL || core)) continue;
      for (const p of comp) this.transferProvince(by, p, 0);
      this.events.push({ type: 'encircled', by, from: o, provinces: comp });
    }
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

  /** Ultimo minuto: avviso; allo scadere vince chi ha più province, altrimenti si rientra col bottino (e una parte della puntata è persa). */
  private timerTick() {
    if (!this.timerWarned && this.timeLeft <= BALANCE.campaign.warnMs) {
      this.timerWarned = true;
      this.events.push({ type: 'timer', phase: 'warn' });
    }
    if (this.timeLeft > 0) return;
    this.end(this.rank().pos === 1 ? 'victory' : 'timeout', 'time'); // vince chi ha più province
  }

  // ---------- fine run ----------

  private checkVictory() {
    if (this.over) return;
    if (this.opts.tutorial) {
      if (this.player.provinces >= BALANCE.tutorial.goalProvinces) this.end('victory', 'tutorial');
      return;
    }
    // vittoria in anticipo: i tre imperi rivali sono caduti (le milizie non contano)
    if (this.factions.every((f) => f.kind !== 'empire' || !f.alive)) this.end('victory', 'map');
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
    const bag = this.player.loot, S = this.opts.stake;
    const k = outcome === 'victory' ? 1 + BALANCE.victory.bonus
      : outcome === 'retreat' ? 1 - this.opts.exitFee : outcome === 'timeout' ? 1 : 1 - this.opts.eliminatedLoss;
    // la puntata torna com'è (se finisci senza vincere ne perdi una parte); il guadagno oltre la puntata rende di più
    const gain = this.opts.stakeMult * this.opts.campaignLootMult;
    const staked = S.metallo + S.benzina + S.cibo > 0;
    const stakeK = outcome === 'timeout' && staked ? 1 - BALANCE.stake.lossShare : 1;
    const kept = {} as Bag;
    const SS = this.opts.tutorial ? emptyBag() : BALANCE.economy.startStock; // la scorta di guerra torna al Comando, non è bottino
    for (const r of Object.keys(bag) as Resource[]) {
      const b = Math.max(0, bag[r] - SS[r]);
      kept[r] = Math.floor((Math.min(b, S[r]) * stakeK + Math.max(0, b - S[r]) * gain) * k);
    }
    return {
      seed: this.map.seed, outcome, reason: this.victoryReason, timeMs: this.gameTimeMs,
      maxTiles: this.player.maxTiles, maxProvinces: this.player.maxProvinces, backpack: { ...bag }, kept, stake: { ...S },
      gainMult: gain, feePct: Math.round((k < 1 ? 1 - k : 0) * 100), stakeLossPct: Math.round((1 - stakeK) * 100),
      tutorial: this.opts.tutorial, civ: this.opts.civ, campaign: this.opts.campaign, front: this.opts.frontIndex,
      world: this.worldOutcome(),
    };
  }

  /** Cosa resta al mondo dopo questa campagna: il nucleo attorno alla partenza, gli imperi caduti, i rapporti coi rivali. */
  private worldOutcome(): NonNullable<RunSummary['world']> {
    const start = this.provOf(this.map.starts[PLAYER]);
    const core: number[] = [];
    if (this.provOwner[start] === PLAYER) {
      // province tue collegate alla partenza, dalle più vicine (la partenza conta nel massimo)
      const seen = new Set([start]), queue = [start];
      for (let h = 0; h < queue.length && queue.length < BALANCE.world.coreMax; h++) {
        for (const q of this.map.provinces[queue[h]].neighbors) {
          if (seen.has(q) || this.provOwner[q] !== PLAYER || queue.length >= BALANCE.world.coreMax) continue;
          seen.add(q);
          queue.push(q);
        }
      }
      core.push(...queue.slice(1));
    }
    const empires = this.factions.filter((f) => f.kind === 'empire');
    return {
      core,
      fallen: empires.filter((f) => !f.alive).map((f) => f.id),
      rivals: empires.filter((f) => f.alive).map((f) => ({ id: f.id, relation: this.relation[f.id], opinion: Math.round(this.opinion[f.id]) })),
    };
  }

  /** Posizione per province tra le fazioni vive (1 = in testa) e distacco: dal secondo se sei primo, dal primo se no. */
  rank(): { pos: number; gap: number } {
    const me = this.player.provinces;
    const others = this.factions.filter((f) => f.id !== PLAYER && f.alive).map((f) => f.provinces).sort((a, b) => b - a);
    const pos = 1 + others.filter((n) => n > me).length;
    return { pos, gap: me - (others[0] ?? 0) };
  }

  private tick() {
    if (this.supplyDirty) this.recomputeSupply();
    this.countSettlements();
    this.economyTick();
    for (const f of this.factions) if (f.alive) this.grow(f);
    if (this.player.alive) this.eat();
    for (const f of this.factions) {
      if (f.id === PLAYER || !f.alive) continue;
      if (f.kind === 'bot') {
        // milizie: difendono e si allargano piano, solo su terra libera vicino a casa
        if (this.aiRng() <= BALANCE.bots.actChance) this.botExpand(f);
        this.aiUnits(f); // anche le milizie schierano pedine (Nico)
        continue;
      }
      const assault = this.offensive?.phase === 'on' && this.offensive.faction === f.id;
      this.aiBuild(f);
      this.aiStrike(f);
      if (assault || this.aiRng() <= (this.opts.tutorial ? 0.07 : this.opts.front.aiActChance)) {
        const n = assault ? BALANCE.offensive.attacksPerAct : BALANCE.ai.attacksPerAct;
        for (let a = 0; a < n; a++) if (!this.aiAttack(f)) break;
      }
      this.aiUnits(f);
    }
    this.playerUnitsAuto();
    this.unitsTick();
    this.battlesTick();
    this.diploTick();
    this.encircleTick();
    this.offensiveTick();
    this.timerTick();
    this.checkVictory();
    this.eventTick();
    this.updateFog();
  }

  // ---------- navi ----------

  /** Nave verso una costa: parte dalla tua costa più vicina con la forza d'attacco. */
  launchBoat(target: number): null | 'locked' | 'notCoast' | 'far' | 'max' | 'troops' | 'peace' | 'units' {
    const B = BALANCE.boats;
    if (this.opts.tutorial) return 'locked';
    if (!this.passable(target) || this.owner[target] === PLAYER || !isCoast(this.map.tiles, target)) return 'notCoast';
    if (!this.atWar(PLAYER, this.owner[target])) return 'peace';
    if (this.owner[target] !== NEUTRAL) return 'units'; // le navi sbarcano solo sul vuoto: il resto con le pedine
    const port = this.worksOf(PLAYER, 'porto') > 0;
    if (this.boats.filter((b) => b.owner === PLAYER).length >= B.maxInFlight + (port ? 1 : 0)) return 'max';
    const troops = Math.floor(this.troops * this.attackRatio);
    if (troops < B.minTroops) return 'troops';
    const route = seaRoute(this.map.tiles, (i) => this.owner[i] === PLAYER, target, Math.round(B.maxSea * (port ? BALANCE.works.porto.seaMult ?? 1 : 1)));
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
    if (this.owner[t] !== NEUTRAL) { // costa presa da qualcuno durante la traversata (o tua): si rientra, si sbarca solo sul vuoto
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
  private fogVis: Uint8Array | null = null;
  private fogDist: Int8Array | null = null;
  private fogQueue: number[] = [];
  private fogSig = 0;

  private updateFog() {
    if (!this.opts.fog) return;
    const F = BALANCE.fog;
    // niente da rifare se non è cambiato niente di quello che fa vedere (territorio, pedine, navi, ricognizioni, radar, alleati):
    // il calcolo passa tutte le 460.000 caselle, era metà del tempo di ogni tick
    let sig = this.player.tiles * 7919 + this.recons.length * 31 + this.boats.length * 131;
    for (const u of this.units) if (u.owner === PLAYER) sig = (sig * 31 + u.tile) | 0;
    for (const b of this.boats) if (b.owner === PLAYER) sig = (sig * 31 + b.path[b.pos]) | 0;
    for (const f of this.factions) if (this.relation[f.id] === 'alleanza' && f.alive) sig = (sig * 31 + f.id * 977 + f.provinces) | 0;
    for (let p = 0; p < this.provOwner.length; p++) {
      if (this.provOwner[p] !== PLAYER) continue;
      sig = (sig + p * 2654435761) | 0; // quali province hai (non solo quante)
      if (this.provWork[p] >= 0) sig = (sig * 31 + p * 13 + this.provWork[p] + (this.provWorkAt[p] === 0 ? 7 : 0)) | 0;
    }
    if (sig === this.fogSig && this.fogVis) return;
    this.fogSig = sig;
    // memoria riusata a ogni giro (prima due array da 460.000 caselle nuovi a ogni tick)
    const vis = (this.fogVis ??= new Uint8Array(this.visible.length)).fill(0);
    const dist = (this.fogDist ??= new Int8Array(this.visible.length)).fill(-1);
    const queue = this.fogQueue;
    queue.length = 0;
    const seed = (i: number, r: number) => {
      if (i < 0 || dist[i] >= r) return;
      dist[i] = r;
      queue.push(i);
    };
    // il tuo territorio si vede tutto; la vista oltre parte solo dalle caselle di confine (stesso risultato: ogni casella
    // fuori è più vicina al confine che all'interno). Prima la ricerca partiva da tutte le tue caselle: lento con l'impero grande
    const ownR = F.territory + this.opts.mods.fogBonus;
    for (let i = 0; i < this.owner.length; i++) {
      if (this.owner[i] !== PLAYER) continue;
      vis[i] = 1;
      if (neighbors(i).some((n) => n >= 0 && this.owner[n] !== PLAYER)) seed(i, ownR);
    }
    for (const u of this.unitsOf(PLAYER)) seed(u.tile, F.unit);
    for (const b of this.boats) if (b.owner === PLAYER) seed(b.path[b.pos], F.boat);
    for (const r of this.recons) seed(r.tile, BALANCE.abilities.ricognizione.radius);
    const radarVision = BALANCE.works.radar.vision ?? 0, radar = WORKS.indexOf('radar');
    for (let p = 0; p < this.provOwner.length; p++) {
      if (this.provOwner[p] === PLAYER && this.provWork[p] === radar && this.provWorkAt[p] === 0) seed(this.map.provinces[p].anchor, radarVision + F.territory);
    }
    // alleati: si vede quello che vedono loro
    for (const f of this.factions) {
      if (this.relation[f.id] !== 'alleanza' || !f.alive) continue;
      for (let p = 0; p < this.provOwner.length; p++) if (this.provOwner[p] === f.id) seed(this.map.provinces[p].anchor, 4);
    }
    for (let h = 0; h < queue.length; h++) {
      const c = queue[h];
      vis[c] = 1;
      if (dist[c] <= 0) continue;
      for (const n of neighbors(c)) if (n >= 0 && dist[n] < dist[c] - 1) {
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
    if (T < 0 || !this.provPassable(T) || this.provOwner[T] !== NEUTRAL) return false; // l'avanzata compra solo il vuoto
    if (!this.provReachable(T)) return false;
    this.flowTarget = T;
    this.flowAcc = BALANCE.flow.stepMs; // primo passo subito
    this.flowBestD = Infinity;
    this.flowSteps = 0;
    this.flowBudget = this.troops * (this.opts.tutorial ? 1 : this.attackRatio); // forza d'attacco
    return true;
  }

  /** Si arriva via terra alla provincia, dal proprio territorio? (ricerca sul grafo delle province) */
  provReachable(T: number): boolean {
    const own = this.provOwner, provs = this.map.provinces, seen = new Uint8Array(own.length);
    const queue: number[] = [];
    for (let p = 0; p < own.length; p++) if (own[p] === PLAYER) { seen[p] = 1; queue.push(p); }
    for (let h = 0; h < queue.length; h++) {
      for (const q of provs[queue[h]].neighbors) {
        if (seen[q] || !this.provPassable(q)) continue;
        if (q === T) return true;
        seen[q] = 1;
        queue.push(q);
      }
    }
    return false;
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
      if (this.provOwner[p] !== NEUTRAL || !this.provPassable(p)) { this.plan.shift(); continue; } // il piano compra solo il vuoto
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
    if (this.battleAt(T)?.by === PLAYER) return; // il bersaglio è sotto assalto: si aspetta l'esito
    for (const p of this.frontier(PLAYER)) {
      if (this.battleAt(p) || this.provOwner[p] !== NEUTRAL) continue; // si compra solo il vuoto
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
    this.alerts = this.alerts.filter((a) => a.until > this.gameTimeMs);
    // rapporti dal campo solo con una Sala Radar finita; più radar, più rapporti (Nico)
    const radars = this.worksOf(PLAYER, 'radar');
    if (this.over || this.opts.events <= 0 || this.opts.tutorial || !radars || this.gameTimeMs < this.nextEventAt) return;
    const E = BALANCE.events;
    this.nextEventAt = this.gameTimeMs + Math.max(E.minEveryMs, (E.everyMs + (this.evRng() * 2 - 1) * E.jitterMs) / radars);
    // prima i rapporti utili: armata in arrivo, scorta da recuperare, punto debole; ogni tanto un evento classico
    const intel = [this.reportAttack(radars), this.reportCache(radars)].filter((e): e is GameEvent => !!e);
    if (intel.length && this.evRng() < 0.75) {
      const ev = intel[Math.floor(this.evRng() * intel.length)];
      this.pendingEvent = ev;
      this.events.push({ type: 'event', event: ev });
      return;
    }
    const pool = EVENTS.filter((e) => !this.seenEvents.has(e.id) && (!e.rare || this.opts.events >= 2));
    if (!pool.length) return;
    // i rari, quando ammessi, escono un po' più spesso: è la Radio che li cerca
    const rare = pool.filter((e) => e.rare);
    const ev = rare.length && this.evRng() < 0.35 ? rare[Math.floor(this.evRng() * rare.length)] : pool[Math.floor(this.evRng() * pool.length)];
    this.seenEvents.add(ev.id);
    this.pendingEvent = boosted(ev);
    this.events.push({ type: 'event', event: this.pendingEvent });
  }

  private nationOf(p: number): string {
    const c = this.map.provinces[p].country;
    return this.map.nations.find((n) => n.id === c)?.name ?? 'una provincia di confine';
  }

  /** Radar: armata nemica (in guerra con te) che punta su una tua provincia. */
  private reportAttack(radars: number): GameEvent | null {
    let best: Unit | null = null, bestD = Infinity, to = -1;
    for (const u of this.units) {
      if (u.owner === PLAYER || u.hp <= 0 || !this.atWar(u.owner, PLAYER) || !u.path.length) continue;
      const end = u.path[u.path.length - 1], pe = this.provOf(end);
      if (pe < 0 || this.provOwner[pe] !== PLAYER) continue;
      const d = hexDistance(u.tile, end);
      if (d < bestD) { bestD = d; best = u; to = end; }
    }
    if (!best) return null;
    const n = this.unitsOf(best.owner).filter((u) => hexDistance(u.tile, best!.tile) < 12).length;
    const who = FACTION_INFO[best.owner]?.name ?? 'il nemico', where = this.nationOf(this.provOf(to));
    return {
      id: 'radar-attacco', rare: false,
      text: `RADAR: ${n} ${n === 1 ? 'reparto' : 'reparti'} di ${who} in marcia verso ${where}. ${radars > 1 ? 'Le stazioni concordano sulla rotta.' : 'Contatto debole, ma la rotta è chiara.'}`,
      left: { label: 'Ricevuto', effects: { alert: { from: best.tile, to } }, result: 'Rotta segnata sulla carta.' },
      right: { label: 'Mostra', effects: { alert: { from: best.tile, to }, focus: this.provOf(to) }, result: 'Rotta segnata sulla carta.' },
    };
  }

  /** Radar: deposito abbandonato vicino al confine: truppe e bottino gratis. */
  private reportCache(radars: number): GameEvent | null {
    const front = this.frontier(PLAYER);
    if (!front.length) return null;
    const p = front[Math.floor(this.evRng() * front.length)];
    const troops = Math.round((40 + 15 * radars) * (0.8 + this.evRng() * 0.4));
    const res = (['metallo', 'benzina', 'cibo'] as Resource[])[Math.floor(this.evRng() * 3)];
    const n = Math.round((10 + 4 * radars) * (0.8 + this.evRng() * 0.4));
    return {
      id: 'radar-scorta', rare: false,
      text: `RADAR: deposito della Concordia ancora intatto vicino a ${this.nationOf(p)}. Uomini sbandati e ${res} nei magazzini.`,
      left: { label: 'Lascia', effects: {}, result: 'Il deposito resta dov\'è.' },
      right: { label: 'Recupera', effects: { troops, loot: { [res]: n }, focus: p }, result: `+${troops} truppe, +${n} ${res}.` },
    };
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
    if (fx.timeBonusMs) this.bonusTimeMs += fx.timeBonusMs;
    if (fx.alert) this.alerts.push({ ...fx.alert, until: this.gameTimeMs + 20_000 });
    if (fx.weak !== undefined) { this.weakUntil.set(fx.weak, this.gameTimeMs + 60_000); this.frontierCache.clear(); }
    if (fx.focus !== undefined) this.events.push({ type: 'focus', p: fx.focus });
    if (fx.unit) {
      // pedina gratuita su una nostra casella di confine; se non c'è posto, valore in truppe
      const border = [];
      for (let i = 0; i < this.owner.length; i++) {
        if (this.owner[i] === PLAYER && !this.unitAt(i) && neighbors(i).some((n) => n >= 0 && this.owner[n] !== PLAYER)) border.push(i);
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
  deployBlock(f: number, type: UnitType, i?: number): null | 'locked' | 'cooldown' | 'troops' | 'cap' | 'tile' | 'res' {
    if (f === PLAYER && !this.opts.units.includes(type)) return 'locked';
    if (f !== PLAYER && this.gameTimeMs < this.cooldowns[f][type]) return 'cooldown'; // il giocatore non ha ricarica: si schiera subito
    if (f !== PLAYER && this.unitsOf(f).length >= BALANCE.units.maxPerFaction) return 'cap'; // il giocatore non ha un massimo di pedine
    if (this.factions[f].troops < this.unitCost(f, type)) return 'troops';
    if (f === PLAYER && this.backpack[this.unitRes(type).res] < this.unitRes(type).n) return 'res'; // la risorsa del reparto, dallo zaino
    if (i !== undefined && isNaval(type)) {
      if (this.owner[i] !== f || this.seaSpawn(i) < 0) return 'tile'; // nave: da una tua costa con mare libero accanto
    } else if (i !== undefined && (this.owner[i] !== f || this.unitAt(i))) return 'tile';
    return null;
  }

  /** Risorsa che il reparto costa oltre alle truppe (come Call of War; solo il giocatore; run guidata: niente). */
  unitRes(type: UnitType): { res: Resource; n: number } {
    const U = BALANCE.units[type];
    return { res: U.res, n: this.opts.tutorial ? 0 : U.resCost };
  }

  deploy(f: number, type: UnitType, i: number, free = false): Unit | null {
    if (!free && this.deployBlock(f, type, i)) return null;
    if (!free) {
      this.factions[f].troops -= this.unitCost(f, type);
      if (f === PLAYER) { const c = this.unitRes(type); this.backpack[c.res] -= c.n; }
      if (f !== PLAYER) this.cooldowns[f][type] = this.gameTimeMs + BALANCE.units.cooldownMs; // il giocatore: nessuna ricarica (neanche la barra sulla carta)
    }
    const maxHp = BALANCE.units[type].hp * (f === PLAYER ? this.opts.unitHpMult : this.opts.front.aiUnitHpMult);
    const tile = isNaval(type) ? this.seaSpawn(i) : i;
    if (tile < 0) return null;
    const u: Unit = {
      id: this.nextUnitId++, type, owner: f, tile, hp: maxHp, maxHp,
      path: [], moveAcc: 0, inCombat: false, lastOrderMs: this.gameTimeMs,
      size: 1, stance: 'tieni', front: -1, supply: 1, post: -1,
    };
    this.units.push(u);
    return u;
  }

  /** Casella di mare libera accanto a una costa (dove nasce una cannoniera), −1 se non c'è. */
  private seaSpawn(coast: number): number {
    return neighbors(coast).find((n) => n >= 0 && !this.map.tiles[n] && !this.unitAt(n)) ?? -1;
  }

  /** Ordina alla pedina di andare verso `to`; false se irraggiungibile. Le navi vanno sul mare accanto alla costa toccata. */
  order(u: Unit, to: number): boolean {
    if (isNaval(u.type)) {
      const sea = (i: number) => i >= 0 && !this.map.tiles[i];
      let dest = to;
      if (!sea(to)) {
        const opts = neighbors(to).filter(sea);
        if (!opts.length) return false;
        dest = opts.reduce((a, b) => (hexDistance(a, u.tile) <= hexDistance(b, u.tile) ? a : b));
      }
      const path = findPath(u.tile, dest, sea);
      u.path = path;
      u.lastOrderMs = this.gameTimeMs;
      return path.length > 0 || dest === u.tile;
    }
    const path = findPath(u.tile, to, (i) => this.passable(i) && this.atWar(u.owner, this.owner[i]) || this.owner[i] === u.owner);
    u.path = path;
    u.lastOrderMs = this.gameTimeMs;
    return path.length > 0;
  }

  /** Ordine del giocatore: la pedina lascia il fronte assegnato e va dove le dici. */
  command(u: Unit, to: number): boolean {
    u.front = -1;
    u.post = -1;
    return this.order(u, to);
  }

  /** Percorso che farebbe la pedina fino a `to` (anteprima sulla mappa), vuoto se irraggiungibile. */
  previewPath(u: Unit, to: number): number[] {
    if (isNaval(u.type)) return this.map.tiles[to] ? [] : findPath(u.tile, to, (i) => i >= 0 && !this.map.tiles[i]);
    return findPath(u.tile, to, (i) => this.passable(i) && this.atWar(u.owner, this.owner[i]) || this.owner[i] === u.owner);
  }

  /** Comportamento: tieni la posizione oppure attacca da sola i nemici vicini. */
  setStance(units: Unit[], stance: Stance) {
    for (const u of units) { u.stance = stance; u.lastOrderMs = this.gameTimeMs - BALANCE.unitOps.autoEveryMs; }
  }

  /** Assegna le pedine al confine con una fazione: si dispongono lungo la linea (e la spingono se attaccano da sole). */
  assignFront(units: Unit[], faction: number): boolean {
    if (faction < 0 || faction === PLAYER || !this.factions[faction]?.alive) return false;
    if (!this.frontLine(PLAYER, faction).length) return false;
    for (const u of units) if (!isNaval(u.type)) { u.front = faction; u.post = -1; u.lastOrderMs = this.gameTimeMs - BALANCE.unitOps.autoEveryMs; }
    return true;
  }

  /**
   * Linea d'attacco alla HOI4: le pedine si spartiscono le caselle `posts` (già in ordine lungo la linea, una a testa),
   * ci vanno conquistando la strada e poi la tengono. Ritorna quante sono partite.
   */
  holdLine(units: Unit[], posts: number[]): number {
    let n = 0;
    units.forEach((u, k) => {
      if (isNaval(u.type) || k >= posts.length) return;
      u.front = -1;
      u.post = posts[k];
      if (u.tile === u.post || this.order(u, u.post)) n++;
    });
    return n;
  }

  /** Province di `f` che confinano con `enemy` (la linea del fronte). */
  frontLine(f: number, enemy: number): number[] {
    const out: number[] = [];
    this.map.provinces.forEach((prov, p) => {
      if (this.provOwner[p] === f && prov.neighbors.some((q) => this.provOwner[q] === enemy)) out.push(p);
    });
    return out;
  }

  /** Unisce pedine uguali vicine nella prima: vita e attacco si sommano. Ritorna i reparti uniti o il motivo. */
  merge(units: Unit[]): number | 'type' | 'far' | 'max' | 'few' {
    const O = BALANCE.unitOps;
    const [head, ...rest] = units.filter((u) => u.owner === PLAYER && u.hp > 0);
    if (!head || !rest.length) return 'few';
    if (rest.some((u) => u.type !== head.type)) return 'type';
    const near = rest.filter((u) => hexDistance(u.tile, head.tile) <= O.mergeRange);
    if (!near.length) return 'far';
    let n = 0;
    for (const u of near) {
      if (head.size + u.size > O.mergeMax) continue;
      head.size += u.size;
      head.maxHp += u.maxHp;
      head.hp += u.hp;
      u.hp = 0; // assorbita: tolta subito, senza evento di morte
      n++;
    }
    this.units = this.units.filter((u) => u.hp > 0);
    return n ? n : 'max';
  }

  /** Divide una pedina in due: metà dei reparti su una casella libera accanto. */
  split(u: Unit): Unit | 'single' | 'room' {
    if (u.size < 2) return 'single';
    const free = neighbors(u.tile).find((n) => n >= 0 && !this.unitAt(n) && (isNaval(u.type) ? !this.map.tiles[n] : this.owner[n] === u.owner || (this.passable(n) && this.atWar(u.owner, this.owner[n]))));
    if (free === undefined) return 'room';
    const k = Math.floor(u.size / 2), share = k / u.size;
    const v: Unit = {
      id: this.nextUnitId++, type: u.type, owner: u.owner, tile: free, hp: u.hp * share, maxHp: u.maxHp * share,
      path: [], moveAcc: 0, inCombat: false, lastOrderMs: this.gameTimeMs, size: k, stance: u.stance, front: u.front, supply: u.supply, post: u.post,
    };
    u.size -= k;
    u.hp -= v.hp;
    u.maxHp -= v.maxHp;
    this.units.push(v);
    return v;
  }

  /** Ritirata: ogni pedina torna alla tua provincia sicura più vicina (rifornita, lontana dai nemici in guerra). */
  retreatUnits(units: Unit[]): number {
    const provs = this.map.provinces;
    const safe = provs.map((_, p) => p).filter((p) => this.provOwner[p] === PLAYER && this.supply[p] >= 0.95
      && !provs[p].neighbors.some((q) => { const o = this.provOwner[q]; return o !== PLAYER && o !== NEUTRAL && this.atWar(PLAYER, o); }));
    if (!safe.length) return 0;
    let n = 0;
    const taken = new Set<number>();
    for (const u of units) {
      if (isNaval(u.type)) continue;
      const p = safe.reduce((a, b) => (hexDistance(provs[a].anchor, u.tile) <= hexDistance(provs[b].anchor, u.tile) ? a : b));
      const tile = provs[p].tiles.find((i) => this.owner[i] === PLAYER && !taken.has(i) && (!this.unitAt(i) || this.unitAt(i) === u)) ?? provs[p].anchor;
      taken.add(tile);
      u.front = -1;
      u.post = -1;
      u.stance = 'tieni';
      if (tile === u.tile || this.order(u, tile)) n++;
    }
    return n;
  }

  /** Rifornimento della pedina: quello della provincia se è tua, poco fuori dal confine cala, lontano finisce. */
  private unitSupply(u: Unit): number {
    if (isNaval(u.type) || !this.map.tiles[u.tile]) return 1; // le navi si riforniscono in mare
    const O = BALANCE.unitOps, p = this.provOf(u.tile), provs = this.map.provinces;
    if (this.provOwner[p] === u.owner) return this.supply[p];
    let best = 0;
    for (const q of provs[p].neighbors) if (this.provOwner[q] === u.owner) best = Math.max(best, this.supply[q]);
    if (best) return best * O.outsideSupply;
    for (const q of provs[p].neighbors) for (const r of provs[q].neighbors) if (this.provOwner[r] === u.owner) best = Math.max(best, this.supply[r]);
    return best * O.farSupply;
  }

  /**
   * Pedine del giocatore senza ordini: quelle assegnate a un fronte si dispongono lungo la linea; quelle che "attaccano da
   * sole" cercano il nemico più vicino (pedina o provincia in guerra) e ci vanno.
   */
  private playerUnitsAuto() {
    const O = BALANCE.unitOps, provs = this.map.provinces;
    const lines = new Map<number, number[]>();
    const posts = new Map<number, Set<number>>(); // fronte → province già presidiate
    for (const u of this.unitsOf(PLAYER)) {
      if (isNaval(u.type) || u.path.length || this.gameTimeMs - u.lastOrderMs < O.autoEveryMs || this.battles.some((b) => b.unit === u.id)) continue;
      u.lastOrderMs = this.gameTimeMs;
      const attack = u.stance === 'attacca';
      if (u.post >= 0) {
        // linea d'attacco: torna al suo posto se ne è uscita (o se la strada si è aperta solo ora)
        if (u.tile !== u.post) this.order(u, u.post);
        continue;
      }
      if (u.front >= 0) {
        const enemy = u.front;
        if (!this.factions[enemy]?.alive) { u.front = -1; continue; }
        if (!lines.has(enemy)) { lines.set(enemy, this.frontLine(PLAYER, enemy)); posts.set(enemy, new Set()); }
        const line = lines.get(enemy)!, taken = posts.get(enemy)!;
        if (!line.length) continue;
        if (attack && this.atWar(PLAYER, enemy)) {
          // spingi il fronte: la provincia nemica sul confine più vicina
          let best = -1, bd = Infinity;
          for (const p of line) for (const q of provs[p].neighbors) {
            if (this.provOwner[q] !== enemy) continue;
            const d = hexDistance(provs[q].anchor, u.tile);
            if (d < bd) { bd = d; best = q; }
          }
          if (best >= 0) { this.order(u, provs[best].anchor); continue; }
        }
        // tieni la linea: la provincia di confine libera più vicina (una pedina per provincia finché bastano)
        const here = this.provOf(u.tile);
        if (line.includes(here) && !taken.has(here)) { taken.add(here); continue; }
        const free = line.filter((p) => !taken.has(p));
        const pool = free.length ? free : line;
        const p = pool.reduce((a, b) => (hexDistance(provs[a].anchor, u.tile) <= hexDistance(provs[b].anchor, u.tile) ? a : b));
        taken.add(p);
        const tile = provs[p].tiles.find((i) => this.owner[i] === PLAYER && !this.unitAt(i)) ?? -1;
        if (tile >= 0) this.order(u, tile);
        continue;
      }
      if (!attack) continue;
      // attacca da sola: prima le pedine nemiche vicine, poi le province in guerra più vicine
      let target = -1, bd = O.autoRadius + 1;
      for (const v of this.units) {
        if (v.owner === PLAYER || !this.atWar(PLAYER, v.owner) || (!this.sees(v.tile))) continue;
        const d = hexDistance(u.tile, v.tile);
        if (d < bd) { bd = d; target = v.tile; }
      }
      if (target < 0) {
        for (const p of this.frontier(PLAYER)) {
          if (this.provOwner[p] === NEUTRAL || this.battleAt(p)) continue;
          const d = hexDistance(provs[p].anchor, u.tile);
          if (d < bd) { bd = d; target = provs[p].anchor; }
        }
      }
      if (target >= 0) this.order(u, target);
    }
  }

  /** Previsione dell'assalto: costo, durata e probabile esito (crescita del difensore durante la battaglia). */
  forecast(p: number): { cost: number; can: boolean; ms: number; odds: 'sicura' | 'probabile' | 'incerta' | 'difficile' } {
    const cost = this.provCost(PLAYER, p), can = this.troops > cost;
    const o = this.provOwner[p];
    if (o === NEUTRAL) return { cost, can, ms: 0, odds: can ? 'sicura' : 'difficile' };
    const B = BALANCE.battle, prov = this.map.provinces[p];
    const ms = clamp((B.baseMs + cost * B.msPerCost) * (1 + (BALANCE.terrain[prov.terrain].move - 1) * 0.5), B.minMs, B.maxMs);
    // quanto si rinforza il difensore: le sue truppe crescono, il presidio per casella sale (fino al massimo)
    const f = this.factions[o];
    const grown = f.troops + this.growth(f) * (1 - f.workers) * (ms / BALANCE.tick.ms);
    const g0 = Math.min((f.troops / Math.max(1, f.tiles)) * BALANCE.owned.garrison, BALANCE.owned.garrisonMax);
    const g1 = Math.min((grown / Math.max(1, f.tiles)) * BALANCE.owned.garrison, BALANCE.owned.garrisonMax);
    const def0 = Math.max(1, this.provDefense(p)), n = prov.tiles.length;
    const ratio = (def0 + (g1 - g0) * n) / def0 * B.winRatio; // ≤ 1 = vinci
    const odds = !can ? 'difficile' : ratio <= 0.9 ? 'probabile' : ratio <= 1.02 ? 'incerta' : 'difficile';
    return { cost, can, ms, odds };
  }

  private unitsTick() {
    const U = BALANCE.units;
    // 1. combattimento simultaneo: ognuno colpisce il nemico più conveniente a portata
    const dmg = new Map<Unit, number>();
    for (const u of this.units) {
      let target: Unit | null = null, best = -1;
      for (const v of this.units) {
        if (v.owner === u.owner || !this.atWar(u.owner, v.owner) || hexDistance(u.tile, v.tile) > U[u.type].range) continue; // in pace non si spara
        const m = rps(u.type, v.type);
        if (m > best) {
          best = m;
          target = v;
        }
      }
      u.inCombat = !!target || this.units.some((v) => v.owner !== u.owner && this.atWar(u.owner, v.owner) && hexDistance(u.tile, v.tile) <= U[v.type].range);
      const atk = U[u.type].attack * u.size * (u.owner === PLAYER ? this.opts.mods.unitAttackMult : 1); // munizioni perforanti, reparti uniti
      if (target) {
        dmg.set(target, (dmg.get(target) ?? 0) + atk * best);
        this.events.push({ type: 'hit', from: u.id, to: target.id, fromTile: u.tile, toTile: target.tile, dmg: atk * best, owner: u.owner });
      }
    }
    for (const [v, d] of dmg) v.hp -= d;
    this.removeDead();

    // 2. movimento, conquista di ciò che si calpesta, cura in casa
    for (const u of [...this.units]) {
      if (u.hp <= 0) continue;
      const stats = U[u.type];
      if (!u.inCombat && u.path.length && !this.battles.some((b) => b.unit === u.id)) { // chi assedia resta fermo
        u.moveAcc += BALANCE.tick.ms;
        const next0 = this.map.tiles[u.path[0]];
        const rail = next0 && this.owner[u.path[0]] === u.owner && this.railBy[next0.province] === u.owner ? BALANCE.works.ferrovia.railMult ?? 1 : 1;
        if (u.moveAcc >= stats.moveMs * (next0 ? BALANCE.terrain[next0.terrain].move : 1) * rail) { // colline e montagne rallentano, la ferrovia accelera
          const next = u.path[0], there = this.unitAt(next);
          // si passa attraverso le pedine amiche (si ferma solo se la casella d'arrivo è occupata) mai attraverso le nemiche
          const blocked = !!there && (there.owner !== u.owner || u.path.length === 1);
          // la pace firmata durante la marcia chiude i confini: la pedina si ferma
          if (this.map.tiles[next] && this.owner[next] !== u.owner && !this.atWar(u.owner, this.owner[next])) u.path.length = 0;
          else if (blocked && u.path.length === 1 && there!.owner === u.owner) u.path.length = 0; // arrivo occupato da un'amica: si ferma accanto
          else if (!blocked) {
            u.moveAcc = 0;
            u.tile = next;
            u.path.shift();
          }
        }
      }
      // rifornimento: sotto la soglia la pedina si logora e non si cura
      const O = BALANCE.unitOps;
      u.supply = this.unitSupply(u);
      if (u.supply < O.attritionBelow) u.hp -= O.attritionPerTick * (1 - u.supply / O.attritionBelow) * u.size;
      const fed = u.supply >= O.healMinSupply;
      if (isNaval(u.type) || !this.map.tiles[u.tile]) {
        // le navi non conquistano: si riparano vicino a una tua costa
        if (!u.inCombat && neighbors(u.tile).some((n) => n >= 0 && this.owner[n] === u.owner)) u.hp = Math.min(u.maxHp, u.hp + U.healPerTick);
      } else if (this.owner[u.tile] !== u.owner && this.atWar(u.owner, this.owner[u.tile])) {
        // la pedina prende tutta la provincia in cui entra
        const p = this.provOf(u.tile);
        // in terra libera si avanza senza perdite; nel territorio di qualcuno la pedina si ferma e assedia la provincia
        if (this.provOwner[p] === NEUTRAL) this.transferProvince(u.owner, p, 0, u.id);
        else if (!this.battleAt(p)) this.startBattle(u.owner, p, 0, u.id);
      } else if (!u.inCombat && fed && this.owner[u.tile] === u.owner) {
        u.hp = Math.min(u.maxHp, u.hp + U.healPerTick * u.size * this.healMult(u));
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
        for (const i of [u.tile, ...neighbors(u.tile)]) if (i >= 0 && this.owner[i] === u.owner) this.fortBy[i] = u.owner;
      } else if (isNaval(u.type)) {
        const R = BALANCE.units.supportRange;
        const seen = new Set([u.tile]);
        let ring = [u.tile];
        for (let r = 0; r < R; r++) {
          const next: number[] = [];
          for (const c of ring) for (const n of neighbors(c)) if (n >= 0 && !seen.has(n)) { seen.add(n); next.push(n); }
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
    if (a === 'bombardamento' && !this.atWar(PLAYER, this.owner[tile])) return false; // non si bombarda chi è in pace
    const A = BALANCE.abilities[a];
    const air = this.worksOf(PLAYER, 'aeroporto') > 0 ? BALANCE.works.aeroporto.abilityCdMult ?? 1 : 1; // aeroporto: abilità più rapide
    this.abilityReadyAt[a] = this.gameTimeMs + A.cooldownMs * this.opts.abilityCdMult * air;
    if (a === 'ricognizione') {
      this.recons.push({ tile, until: this.gameTimeMs + BALANCE.abilities.ricognizione.durationMs });
      this.updateFog();
    } else {
      this.strikes.push({ tile, at: this.gameTimeMs + BALANCE.abilities.bombardamento.delayMs, by: PLAYER });
    }
    this.events.push({ type: 'ability', ability: a, tile, phase: 'launch', by: PLAYER });
    return true;
  }

  /** La provincia è coperta da una contraerea pronta di chi la possiede (qui o in una sua provincia accanto)? */
  private shielded(p: number): boolean {
    const o = this.provOwner[p];
    if (p < 0 || o === NEUTRAL) return false;
    const aa = (q: number) => this.provOwner[q] === o && this.workOf(q) === 'contraerea';
    return aa(p) || this.map.provinces[p].neighbors.some(aa);
  }

  /** IA dei fronti alti: ogni tanto bombarda una tua provincia sul confine (se è in guerra con te). */
  private aiStrike(f: Faction) {
    const A = BALANCE.aiStrike;
    if (this.opts.tutorial || this.opts.frontIndex < A.fromFront || this.relation[f.id] !== 'guerra') return;
    if (this.gameTimeMs < this.aiStrikeAt[f.id]) return;
    this.aiStrikeAt[f.id] = this.gameTimeMs + A.everyMs + (this.aiRng() * 2 - 1) * A.jitterMs;
    const line = this.frontLine(PLAYER, f.id);
    if (!line.length) return;
    const p = line[Math.floor(this.aiRng() * line.length)], tile = this.map.provinces[p].anchor;
    this.strikes.push({ tile, at: this.gameTimeMs + BALANCE.abilities.bombardamento.delayMs * 2, by: f.id }); // più preavviso: c'è tempo per spostarsi
    this.events.push({ type: 'ability', ability: 'bombardamento', tile, phase: 'launch', by: f.id });
  }

  private abilitiesTick() {
    const before = this.recons.length;
    this.recons = this.recons.filter((r) => r.until > this.gameTimeMs);
    if (this.recons.length !== before) this.updateFog();
    const B = BALANCE.abilities.bombardamento;
    for (const s of this.strikes.filter((x) => x.at <= this.gameTimeMs)) {
      let hits = 0;
      // la provincia nemica colpita torna neutrale, il nemico perde il presidio (la contraerea lo ferma)
      const p = this.provOf(s.tile);
      const o = p >= 0 ? this.provOwner[p] : NEUTRAL;
      if (this.shielded(p) && o !== s.by) {
        this.events.push({ type: 'ability', ability: 'bombardamento', tile: s.tile, phase: 'impact', hits: 0, by: s.by, blocked: true });
        continue;
      }
      if (o !== NEUTRAL && o !== s.by && this.atWar(s.by, o)) {
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
        this.supplyDirty = true;
        this.events.push({ type: 'conquer', by: NEUTRAL, from: o, p, i: this.map.provinces[p].anchor, cost: 0, loot: 0, lootType: 'metallo' });
        if (f.tiles <= 0) this.eliminate(o, s.by);
      }
      for (const u of this.units) if (u.owner !== s.by && this.atWar(s.by, u.owner) && hexDistance(u.tile, s.tile) <= B.unitRadius) { u.hp -= B.unitDamage; hits++; }
      this.removeDead();
      this.events.push({ type: 'ability', ability: 'bombardamento', tile: s.tile, phase: 'impact', hits, by: s.by });
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
      const idle = this.gameTimeMs - u.lastOrderMs;
      if ((!u.path.length && idle > 1000) || idle > A.repathMs) { // ferma: nuovo bersaglio al massimo una volta al secondo
        const target = this.unitTarget(f, u.tile);
        if (target >= 0) this.order(u, target);
        else u.lastOrderMs = this.gameTimeMs;
      }
    }
    const cap = f.kind === 'bot' ? BALANCE.bots.maxUnits : this.opts.front.maxAiUnits;
    if (this.gameTimeMs < this.aiSpawnAt[f.id] || this.unitsOf(f.id).length >= cap) return;
    this.aiSpawnAt[f.id] = this.gameTimeMs + A.spawnEveryMs + (this.aiRng() * 2 - 1) * A.spawnJitterMs;
    // le armi delle IA dipendono dal fronte: più avanti, armi che tu forse non hai ancora
    const types = this.opts.front.aiUnits;
    const dominant = A.dominant[f.id] as UnitType;
    const type = types.includes(dominant) && this.aiRng() < A.dominantChance ? dominant : types[Math.floor(this.aiRng() * types.length)];
    if (f.troops < BALANCE.units[type].cost * (f.kind === 'bot' ? 1.1 : A.reserve)) return; // le milizie spendono quasi tutto per difendersi
    const anchor = this.map.starts[f.id];
    const found = this.unitTarget(f, anchor);
    // nessun nemico in vista: la pedina si schiera lo stesso, ferma sul confine a difendere (Nico: truppe almeno per difendersi)
    const target = found >= 0 ? found : this.map.provinces[this.frontier(f.id)[0] ?? -1]?.anchor ?? -1;
    if (target < 0) return;
    let spawn = -1, bestD = Infinity;
    const provs = this.map.provinces;
    for (let p = 0; p < provs.length; p++) {
      if (this.provOwner[p] !== f.id) continue;
      for (const i of provs[p].tiles) {
        if (this.owner[i] !== f.id || this.unitAt(i)) continue;
        const d = hexDistance(i, target);
        if (d < bestD) {
          bestD = d;
          spawn = i;
        }
      }
    }
    if (spawn < 0) return;
    const u = this.deploy(f.id, type, spawn);
    if (u && found >= 0) this.order(u, target);
  }

  /** Bersaglio di una pedina IA: il nemico più vicino; le milizie solo entro un raggio da casa (difendono la loro zona). */
  private unitTarget(f: Faction, from: number): number {
    const t = this.nearestEnemyTile(f.id, from);
    if (f.kind !== 'bot' || t < 0) return t;
    return hexDistance(t, this.map.starts[f.id]) <= BALANCE.bots.unitRadius ? t : -1;
  }

  /** Centro della provincia nemica (in guerra) più vicina, −1 se nessuna: si cerca tra le province, non tra le caselle. */
  private nearestEnemyTile(f: number, from: number): number {
    let best = -1, bestD = Infinity;
    const playerReady = !this.opts.tutorial && this.gameTimeMs >= this.opts.front.graceMs;
    const provs = this.map.provinces;
    for (let p = 0; p < provs.length; p++) {
      const o = this.provOwner[p], a = provs[p].anchor;
      if (o === NEUTRAL || o === f || a < 0 || (o === PLAYER && !playerReady) || !this.atWar(f, o)) continue;
      const d = hexDistance(from, a) * (o === PLAYER ? BALANCE.aiUnits.playerBias : 1);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  /** Milizia: prende la provincia libera più economica vicino a casa, se se la può permettere. */
  private botExpand(f: Faction) {
    const home = this.map.starts[f.id];
    let best = -1, bestCost = Infinity;
    for (const p of this.frontier(f.id)) {
      if (this.provOwner[p] !== NEUTRAL || hexDistance(this.map.provinces[p].anchor, home) > BALANCE.bots.homeRadius) continue;
      const cost = this.provCost(f.id, p);
      if (cost < bestCost) { best = p; bestCost = cost; }
    }
    if (best >= 0 && f.troops > bestCost * BALANCE.ai.reserve) this.attackProvince(f.id, best);
  }

  /** IA: attacca la provincia vicina più debole, se se lo può permettere. */
  private aiAttack(f: Faction): boolean {
    let best = -1, bestScore = Infinity, bestCost = 0;
    for (const p of this.frontier(f.id)) {
      if (this.provOwner[p] !== NEUTRAL || this.battleAt(p)) continue; // con le truppe solo il vuoto: gli altri si attaccano con le pedine
      const prov = this.map.provinces[p];
      const capital = prov.city >= 0 && this.map.tiles[prov.city]!.capital ? BALANCE.provinces.aiCityAttraction : 1; // le capitali attirano
      const cost = this.provCost(f.id, p);
      const score = cost * capital;
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

  /** Truppe che `by` spende per prendere la provincia: la sua difesa (fissa: niente sovraestensione, Nico come in HOI4). */
  provCost(by: number, p: number): number {
    let d = 0;
    for (const i of this.map.provinces[p].tiles) if (this.passable(i)) d += this.costFor(by, i);
    if (by === PLAYER) d *= this.opts.mods.attackCostMult; // dottrina d'assalto
    if (by === PLAYER && (this.weakUntil.get(p) ?? 0) > this.gameTimeMs) d *= 0.5; // segnalata dal radar: sguarnita
    d *= 1 + (1 - this.supplyFrom(by, p)) * BALANCE.logistics.attackPenalty; // attaccare da province mal rifornite costa di più
    return Math.ceil(d);
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

  /** Difesa attuale. Provincia libera = prezzo in truppe della casella (Nico: il vuoto si compra con gli uomini).
   *  Posseduta = presidio del proprietario (× bunker) + caselle fortificate dal genio. */
  defenseOf(i: number): number {
    const t = this.map.tiles[i]!;
    const o = this.owner[i];
    if (o === NEUTRAL) return t.defense;
    const work = this.workOf(t.province);
    // bunker: chiunque tenga la provincia (le fortezze rinforzano i tuoi)
    const bunker = work ? 1 + (BALANCE.works[work].defenseMult - 1) * (o === PLAYER ? this.opts.mods.bunkerMult : 1) : 1;
    const f = this.factions[o];
    const garrison = Math.min((f.troops / Math.max(1, f.tiles)) * BALANCE.owned.garrison, BALANCE.owned.garrisonMax);
    const mine = o === PLAYER;
    const fort = this.fortBy[i] === o ? BALANCE.units.fortifyDefense : 0;
    const front = mine ? this.opts.mods.ownedDefenseMult : this.opts.tutorial ? 1 : this.opts.front.aiDefenseMult; // fronti difficili: IA trincerate
    if (this.supplyDirty) this.recomputeSupply();
    const L = BALANCE.logistics, sup = L.defenseMin + (1 - L.defenseMin) * this.supply[t.province]; // province mal rifornite cedono prima
    return Math.ceil((garrison * bunker + fort) * front * sup);
  }

  /** La casella sta in una provincia attaccabile da `f`? */
  isFrontier(i: number, f = PLAYER): boolean {
    return this.isFrontierProv(this.provOf(i), f);
  }

  isFrontierProv(p: number, f = PLAYER): boolean {
    if (!this.provPassable(p) || this.provOwner[p] === f || !this.atWar(f, this.provOwner[p])) return false;
    return this.map.provinces[p].neighbors.some((q) => this.provOwner[q] === f);
  }

  /** Province attaccabili: confinanti con il territorio della fazione. */
  frontier(f = PLAYER): number[] {
    const cached = this.frontierCache.get(f);
    if (cached) return cached;
    const set = new Set<number>();
    this.map.provinces.forEach((prov, p) => {
      if (this.provOwner[p] !== f) return;
      for (const q of prov.neighbors) if (this.provOwner[q] !== f && this.provPassable(q) && this.atWar(f, this.provOwner[q])) set.add(q);
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
    if (this.battleAt(p)) return { ok: false, reason: 'battle' };
    // Nico: con le truppe si compra solo il territorio vuoto; le province di imperi e milizie si prendono con le pedine (alla HOI4)
    if (this.provOwner[p] !== NEUTRAL) return { ok: false, reason: 'units' };
    const cost = this.provCost(by, p);
    const att = this.factions[by];
    if (att.troops <= cost) return { ok: false, reason: 'troops', need: cost };
    att.troops -= cost;
    const tile = this.map.tiles[this.map.provinces[p].anchor]!;
    // provincia di qualcuno: assalto a tempo (le truppe partono ora, l'esito alla fine)
    if (this.provOwner[p] !== NEUTRAL) return { ok: true, tile, cost, loot: 0, lootType: 'metallo', battle: this.startBattle(by, p, cost) };
    const { loot, lootType } = this.transferProvince(by, p, cost);
    return { ok: true, tile, cost, loot, lootType };
  }

  // ---------- assalti e assedi ----------

  battleAt(p: number): Battle | undefined {
    return this.battles.find((b) => b.p === p);
  }

  /** Inizia un assalto (o l'assedio di una pedina): dura di più se la provincia costa tanto o è in montagna. */
  private startBattle(by: number, p: number, troops: number, unit?: number): Battle {
    const B = BALANCE.battle, prov = this.map.provinces[p];
    const weight = unit !== undefined ? this.provDefense(p) : troops;
    const move = BALANCE.terrain[prov.terrain].move;
    const ms = clamp((B.baseMs + weight * B.msPerCost) * (1 + (move - 1) * 0.5), B.minMs, B.maxMs);
    const b: Battle = { id: this.nextBattleId++, p, by, from: this.provOwner[p], troops, def0: this.provDefense(p), startMs: this.gameTimeMs, endMs: this.gameTimeMs + ms, unit };
    this.battles.push(b);
    this.frontierCache.clear();
    this.events.push({ type: 'battle', phase: 'start', battle: b });
    return b;
  }

  /** Assalti che finiscono: vince chi ha ancora abbastanza truppe (o la pedina che resiste); gli altri si sciolgono. */
  private battlesTick() {
    const B = BALANCE.battle;
    for (const b of [...this.battles]) {
      const unit = b.unit !== undefined ? this.units.find((u) => u.id === b.unit && u.hp > 0) : undefined;
      const unitHere = !!unit && this.provOf(unit.tile) === b.p;
      const gone = this.provOwner[b.p] !== b.from || !this.factions[b.by].alive || !this.atWar(b.by, b.from) || (b.unit !== undefined && !unitHere);
      if (gone) {
        // la provincia è cambiata di mano, è arrivata la pace o la pedina se n'è andata: le truppe tornano
        this.battles = this.battles.filter((x) => x !== b);
        this.factions[b.by].troops += b.troops;
        this.frontierCache.clear();
        this.events.push({ type: 'battle', phase: 'off', battle: b });
        continue;
      }
      if (this.gameTimeMs < b.endMs) continue;
      this.battles = this.battles.filter((x) => x !== b);
      this.frontierCache.clear();
      let win: boolean;
      if (unit) {
        unit.hp -= this.provDefense(b.p) * BALANCE.units[unit.type].captureCost; // l'assedio costa vita alla pedina
        win = unit.hp > 0;
      } else {
        // conta solo quanto si è rinforzato il difensore (non la sovraestensione dell'attaccante, che intanto cresce altrove)
        const ratio = this.provDefense(b.p) / Math.max(1, b.def0);
        win = ratio * B.winRatio <= 1;
        if (win) this.factions[b.by].troops += Math.max(0, Math.floor(b.troops * (1 - ratio))); // difesa calata: truppe avanzate tornano
      }
      if (win) this.transferProvince(b.by, b.p, b.troops, b.unit);
      else {
        const def = this.factions[b.from];
        if (def) def.troops = Math.max(0, def.troops - b.troops * B.defenderLoss);
      }
      this.events.push({ type: 'battle', phase: win ? 'won' : 'lost', battle: b });
    }
  }

  // ---------- logistica ----------

  /** Rifornimento: visita del territorio a partire dalla capitale di ogni fazione (una volta per tick, se qualcosa è cambiato). */
  private recomputeSupply() {
    this.supplyDirty = false;
    const L = BALANCE.logistics, own = this.provOwner, provs = this.map.provinces;
    this.supply.fill(L.cutOff);
    const dist = new Int16Array(own.length).fill(-1);
    for (const f of this.factions) {
      if (!f.alive) continue;
      let c = this.capitalProv[f.id];
      if (c < 0 || own[c] !== f.id) {
        c = this.capitalProv[f.id] = this.newCapital(f.id, c);
        if (c >= 0) this.events.push({ type: 'capital', faction: f.id, p: c });
      }
      if (c < 0) continue;
      // depositi di rifornimento pronti: la logistica riparte anche da lì
      const q = [c];
      dist[c] = 0;
      for (let p = 0; p < own.length; p++) {
        if (own[p] === f.id && p !== c && this.provWorkAt[p] === 0 && this.provWork[p] === WORKS.indexOf('rifornimenti')) { dist[p] = 0; q.push(p); }
      }
      for (let h = 0; h < q.length; h++) {
        const p = q[h], d = dist[p];
        this.supply[p] = d <= L.range ? 1 : Math.max(L.min, 1 - (d - L.range) * L.decay);
        for (const n of provs[p].neighbors) if (dist[n] < 0 && own[n] === f.id) { dist[n] = d + 1; q.push(n); }
      }
    }
  }

  /** Capitale persa: la nuova è la provincia della fazione più vicina alla vecchia. */
  private newCapital(f: number, old: number): number {
    const provs = this.map.provinces, from = old >= 0 ? provs[old].anchor : this.map.starts[f];
    let best = -1, bd = Infinity;
    for (let p = 0; p < this.provOwner.length; p++) {
      if (this.provOwner[p] !== f || provs[p].anchor < 0) continue;
      const d = hexDistance(provs[p].anchor, from);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** Rifornimento migliore tra le province di `by` che confinano con `p` (da lì parte l'attacco). */
  private supplyFrom(by: number, p: number): number {
    if (this.supplyDirty) this.recomputeSupply(); // sempre aggiornato: le province appena prese contano subito
    let s = 0;
    for (const q of this.map.provinces[p].neighbors) if (this.provOwner[q] === by && this.supply[q] > s) s = this.supply[q];
    return s || 1;
  }

  /** Passa la provincia a `by` (il costo è già stato pagato): bottino delle rovine, premio, capitale. */
  private transferProvince(by: number, p: number, cost: number, unit?: number): { loot: number; lootType: Resource } {
    const prov = this.map.provinces[p];
    const from = this.provOwner[p];
    const f = this.factions[by];
    if (from !== NEUTRAL) {
      const def = this.factions[from];
      let garrison = 0;
      for (const i of prov.tiles) if (this.passable(i) && this.owner[i] === from) garrison += this.defenseOf(i);
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
    this.supplyDirty = true;
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
    const R = BALANCE.provinceReward, n = prov.tiles.length * (this.cityProv.has(p) ? 3 : 1); // città: premio ×3 (Nico)
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
    this.supplyDirty = true;
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
    const near = this.factions.filter((f) => f.kind === 'empire' && f.alive && this.relation[f.id] === 'guerra' && this.frontier(f.id).some((p) => this.provOwner[p] === PLAYER));
    if (!near.length) { this.nextOffensiveAt = this.gameTimeMs + 10_000; return; }
    const f = near[Math.floor(this.aiRng() * near.length)];
    // ogni Sala Radar avvisa 6 secondi prima (Nico: più radar, avvisi utili)
    this.offensive = { faction: f.id, phase: 'warn', until: this.gameTimeMs + O.warnMs + this.worksOf(PLAYER, 'radar') * 6000, lostAtStart: 0 };
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

/** Eventi classici col radar (Nico): premi più alti (truppe e bottino positivi × 1,5). */
function boosted(ev: GameEvent): GameEvent {
  const up = (fx: EventEffects): EventEffects => {
    const o: EventEffects = { ...fx };
    if (o.troops && o.troops > 0) o.troops = Math.round(o.troops * 1.5);
    if (o.loot) o.loot = Object.fromEntries(Object.entries(o.loot).map(([r, v]) => [r, v > 0 ? Math.round(v * 1.5) : v]));
    return o;
  };
  const side = (c: EventChoice): EventChoice => ({ ...c, effects: up(c.effects), fail: c.fail && up(c.fail) });
  return { ...ev, left: side(ev.left), right: side(ev.right) };
}
