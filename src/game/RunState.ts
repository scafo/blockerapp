// Stato logico di una run: nessuna dipendenza da Phaser.
import { BALANCE, type WorkDef, type AbilityType, type CampaignId, type CivId, type Resource, type UnitType, type WorkId } from '../config/balance';
import { RESOURCE_INFO, addBag, emptyBag, scaleBag, type Bag } from './resources';
import { colOf, neighbors, hexDistance, rowOf } from '../map/hexGrid';
import { UNIT_TYPES, findPath, findPathAStar, isNaval, rps, straightPath, type Stance, type Unit } from './units';
import { isCoast, seaRoute, type Boat } from './boats';
import { DEFAULT_OPTIONS, type RunOptions } from './camp';
import { EVENTS, type EventChoice, type EventEffects, type GameEvent } from './events';
import { createRng, type Rng } from '../map/rng';
import { FACTION_INFO } from './factions';
import type { FactionKind, RunMap, Tile } from '../map/generate';
import type { Cmd, CmdEntry } from './commands';

const RESOURCE_KEYS: Resource[] = ['metallo', 'benzina', 'cibo'];
export const NEUTRAL = -1;
/** Costruzioni che si possono fare (Nico: ospedale, aeroporto e contraerea tolti; restano nell'elenco sotto solo per l'ordine). */
// sei costruzioni (Nico, 26 novembre 2026: "togli quelle che non servono a molto"): via caserma e porto (le pedine passano
// il mare da sole); ospedale, aeroporto, contraerea, raffineria e fattoria erano già fuori dal menu
export const BUILDABLE: WorkId[] = ['citta', 'fabbrica', 'radar', 'rifornimenti']; // ferrovia tolta (Nico, 26 novembre 2026); fortificazione tolta (Nico, 26 novembre 2026)
export const WORKS: WorkId[] = ['fabbrica', 'bunker', 'caserma', 'ospedale', 'radar', 'porto', 'aeroporto', 'rifornimenti', 'ferrovia', 'contraerea', 'raffineria', 'fattoria', 'citta'];
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
  | { type: 'upkeep'; res: Resource }
  | { type: 'hit'; from: number; to: number; fromTile: number; toTile: number; dmg: number; owner: number }
  | { type: 'objective'; phase: 'new' | 'done' | 'failed'; objective: Objective };

export type Outcome = 'eliminated' | 'victory' | 'retreat' | 'timeout';
/** Rapporto di una fazione col giocatore. */
export type Relation = 'guerra' | 'pace' | 'alleanza';
export type DiploWhat = 'war' | 'peace' | 'alliance' | 'broken' | 'refused' | 'tribute' | 'gift';
/** Momento della cronologia (Nico, 27 novembre 2026: "una cronologia delle battaglie, così si può rivedere"). */
export interface ChronEntry { t: number; k: 'war' | 'peace' | 'alliance' | 'fall' | 'capital' | 'attack' | 'zone' | 'lost'; a: number; b: number; n?: number; byPlayer?: boolean }
/** Replay di fine partita: padroni delle province all'inizio e i cambi a fotogrammi di 2 s, più la cronologia. */
export interface ReplayData { own0: Int16Array; frames: { t: number; ch: number[] }[]; chronicle: ChronEntry[]; endMs: number }
export type VictoryReason = 'map' | 'time' | 'tutorial' | 'dominance' | 'share';

/** Obiettivo di campagna attivo (a catena da BALANCE.objectives.list, o la svolta del dominio). */
export interface Objective {
  id: string;
  kind: string;
  target: number;
  progress: number;
  deadline?: number; // tempo di gioco entro cui completarlo
  troops: number;
  loot: number;
  decisive?: boolean; // il dominio: completato chiude la campagna con la vittoria
  holdSince?: number; // dominio: da quando la condizione regge
}

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
  rareSeen?: string[]; // eventi rari visti: frammenti della Caduta per l'Archivio della Sala Radar
  sandbox?: boolean; // partita libera: non tocca il profilo
}

export type ConquerResult =
  | { ok: true; tile: Tile; cost: number; loot: number; lootType: Resource; battle?: Battle }
  | { ok: false; reason: 'not-adjacent' | 'impassable' | 'owned' | 'troops' | 'battle' | 'units'; need?: number };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Cosa ritorna ogni comando (per gli avvisi della scena; in rete arriva più tardi). */
export interface CmdResult {
  conquer: ConquerResult; plan: boolean; boat: ReturnType<RunState['launchBoat']>; deploy: Unit | null; ability: boolean;
  move: number; stance: void; front: boolean; hold: number; push: number; release: void; divide: number[]; zone: number; chase: number; unpost: void; band: number; unband: void; merge: ReturnType<RunState['merge']>;
  split: ReturnType<RunState['split']>; retreatUnits: number; wall: ReturnType<RunState['buildWall']>; war: boolean;
  peace: ReturnType<RunState['proposePeace']>; alliance: ReturnType<RunState['proposeAlliance']>; breakAlliance: boolean;
  giveTroops: number; giveLoot: Resource | null; tribute: number; event: string; place: boolean; clearStart: void;
  pause: void; retreat: void;
}

export class RunState {
  readonly owner: Int16Array;
  readonly factions: Faction[];
  gameTimeMs = 0;
  speed = 1;
  over: null | Outcome = null;
  victoryReason?: VictoryReason;
  /** tempo in più guadagnato con gli eventi */
  private bonusTimeMs = 0;
  private timerWarned = false;
  // eventi
  /** Rapporti arrivati e non ancora letti (Nico, 26 novembre 2026: non si aprono da soli, si leggono dal tasto RADAR). */
  eventInbox: GameEvent[] = [];
  private guardUntil = new Map<number, number>(); // provincia → fino a quando è rinforzata (rapporto del radar)
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
  /** Livello della costruzione (fabbrica 1–3) e tempo di gioco in cui finisce il miglioramento in corso (0 = nessuno). */
  readonly provLevel: Uint8Array;
  readonly provLevelAt: Float64Array;
  private nextAiBunkerAt: number[] = [];
  private worksBuilt: number[] = [];
  private builtCities: number[] = []; // città costruite per fazione (rincaro delle prossime)
  /** provincia sul mare (porto possibile) */
  provCoastal = new Uint8Array(0); // costruzioni avviate per fazione (fanno salire il prezzo)
  /** per provincia: peso di crescita (caselle × terreno), risorsa e quantità prodotta a ogni tick */
  private provGrowthW: Float32Array;
  private cityProv = new Set<number>(); // province che valgono di più (Nico: le città)
  private builtCity = new Set<number>(); // città costruite (non quelle della carta): nodi della rete dei depositi come la capitale
  /** crescita (caselle pesate) di ogni fazione, ricalcolata a ogni tick */
  private gw: number[] = [];
  /** risorse guadagnate nell'ultimo tick per fazione (province + lavoratori) */
  private incomeTick: Bag[] = [];
  private provincesDone = new Set<string>(); // "fazione:provincia" già premiate
  objectives: Objective[] = []; // obiettivi attivi, mostrati nell'HUD
  placing = false; // sandbox: si sceglie la partenza toccando la carta (tempo fermo finché non si sceglie)
  private objNext = 0; // prossimo della lista da attivare
  private objStats = { cities: new Set<number>(), capitals: 0, empireProv: 0, repelled: 0 };
  /** Proprietario di ogni provincia (tutte le sue caselle attraversabili hanno lo stesso). */
  readonly provOwner: Int16Array;
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
  /** Zona in vista, per provincia (1 = dentro): le pedine nemiche si vedono solo qui. Cambia `sightVersion`. */
  sight = new Uint8Array(0);
  /** Mare in vista, per casella: attorno alle tue pedine in mare (navi, reparti imbarcati) come un radar. */
  seaSight = new Uint8Array(0);
  seaLit: number[] = [];
  sightVersion = 0;
  private sightSig = NaN;
  /** quota delle truppe che un'avanzata può spendere */
  attackRatio = 1; // leva ATTACCO tolta (Nico: complicava solo): le avanzate usano tutte le truppe
  private flowBestD = Infinity;
  private flowSteps = 0;
  /** Genio: caselle fortificate (proprietario della fortificazione, −1 = nessuna). */
  private fortBy: Int16Array;
  /** Cannoniera: caselle di costa coperte dal fuoco (fazione che ne approfitta, −1 = nessuna). */
  private supportBy: Int16Array;
  /** Abilità: pronte da (tempo di gioco), ricognizioni in volo, bombardamenti in arrivo. */
  abilityReadyAt: Record<AbilityType, number> = { ricognizione: 0, bombardamento: 0 };
  private recons: { tile: number; until: number }[] = [];
  private strikes: { tile: number; at: number; by: number }[] = [];
  /** Bombardamenti delle IA (dal Fronte III): prossimo per fazione. */
  /** Coalizione contro il giocatore: imperi che hanno smesso di farsi la guerra tra loro. */
  readonly coalition = new Set<number>();
  /** Ferrovie: per provincia, la fazione le cui pedine ci corrono (−1 = nessuna). Ricalcolato a ogni tick. */
  private railBy: Int16Array;
  /** Rancio: frazione di cibo mangiata dall'esercito e non ancora tolta dallo zaino. */
  private foodAcc = 0;
  private upkeepAcc: Bag = { metallo: 0, benzina: 0, cibo: 0 };
  /** Risorse che mancano per mantenere le pedine (le pedine che le usano si logorano). */
  unpaid: Record<Resource, boolean> = { metallo: false, benzina: false, cibo: false };
  private provRich: Float32Array; // ricchezza della provincia (× produzione)
  private provDeposit: Int8Array; // giacimento: indice della risorsa in RESOURCE_KEYS, −1 = nessuno
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
    this.owner = new Int16Array(map.tiles.length).fill(NEUTRAL);
    this.provOwner = new Int16Array(map.provinces.length).fill(NEUTRAL);
    this.provVisible = new Uint8Array(map.provinces.length).fill(1);
    this.fortBy = new Int16Array(map.tiles.length).fill(-1);
    this.supportBy = new Int16Array(map.tiles.length).fill(-1);
    this.railBy = new Int16Array(map.provinces.length).fill(-1);
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
    // le IA partono con la stessa scorta di guerra: i primi reparti costano anche risorse
    for (const f of this.factions) if (f.id !== PLAYER) f.loot = { ...SS };
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
    this.aiSpawnAt = this.factions.map(() => (opts.sandbox ? BALANCE.sandboxWorld.firstSpawnMs : BALANCE.aiUnits.firstSpawnMs) + this.aiRng() * BALANCE.aiUnits.spawnJitterMs);
    this.nextOffensiveAt = opts.front.offensiveFirstMs;
    if (opts.sandbox) {
      // sandbox: truppe e risorse scelte, partenza da scegliere
      this.player.troops = opts.sandbox.troops;
      this.player.loot = { metallo: opts.sandbox.resources, benzina: opts.sandbox.resources, cibo: opts.sandbox.resources };
      this.placing = true;
      this.speed = opts.sandbox.speed ?? 1; // velocità di partenza scelta
    } else if (!opts.tutorial) {
      // mobilitazione: i primi secondi l'esercito cresce di più, così non si aspetta a vuoto (Nico: inizio più vivo)
      this.growthBoost = { mult: BALANCE.opening.growthMult, until: BALANCE.opening.durationMs };
      while (this.objectives.length < BALANCE.objectives.slots) if (!this.pullObjective()) break;
    }
    // economia per provincia: crescita pesata dal terreno, risorsa del terreno prevalente
    const T = BALANCE.terrain;
    this.provGrowthW = Float32Array.from(map.provinces, (p) => p.tiles.reduce((s, i) => s + T[map.tiles[i]!.terrain].growth, 0));
    // ricchezza e giacimenti: fissi per mappa (stesso seme = stesse province ricche)
    const PE = BALANCE.provinceEconomy, ecoRng = createRng(map.seed + ':economia');
    this.provRich = Float32Array.from(map.provinces, () => PE.rich[0] + ecoRng() * (PE.rich[1] - PE.rich[0]));
    this.provDeposit = Int8Array.from(map.provinces, (p) => (p.tiles.length && ecoRng() < PE.depositShare ? RESOURCE_KEYS.indexOf(T[p.terrain].res) : -1));
    // città: solo quelle della carta (`places.json`, sparse su tutto il mondo), le aggiunge la scena con setCities.
    // Prima valevano anche tutte le capitali delle nazioni: quasi tutte in Europa, che diventava la zona più ricca (Nico)
    this.worksBuilt = map.starts.map(() => 0);
    this.provWork = new Int8Array(map.provinces.length).fill(-1);
    this.provLevel = new Uint8Array(map.provinces.length).fill(1);
    this.provLevelAt = new Float64Array(map.provinces.length);
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
    if (!opts.tutorial && !opts.sandbox) this.starterArmy(); // dopo la partenza: la capitale c'è
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

  /** Millisecondi di gioco per il prossimo passo della pedina (terreno d'arrivo, ferrovia). */
  stepMs(u: Unit): number {
    const next = u.path[0], t = next !== undefined ? this.map.tiles[next] : undefined;
    const rail = t && this.owner[next] === u.owner && this.railBy[t.province] === u.owner ? BALANCE.works.ferrovia.railMult ?? 1 : 1;
    const armor = t && u.type === 'corazzati' ? BALANCE.units.armorMove[t.terrain] : 1; // i carri corrono in pianura
    // pedina di terra in traversata: in mare più lenta, e il primo passo dalla costa al mare è l'imbarco (Nico: "ci mette un po'")
    const embark = next !== undefined && !t && this.map.tiles[u.tile] && !isNaval(u.type) && !this.map.ford[next]; // il guado non è un imbarco
    const sea = next !== undefined && !t && !isNaval(u.type) ? BALANCE.units.seaMove * (embark ? BALANCE.units.embarkMult : 1) : 1;
    // squadra: tutte al passo della più lenta (Nico: "devono amalgamarsi a fare una media della velocità")
    let base = u.squad !== undefined && u.squad >= 0 ? Math.max(BALANCE.units[u.type].moveMs, this.squadPace.get(u.squad) ?? 0) : BALANCE.units[u.type].moveMs;
    // gruppetto: al passo del più lento. Chi lo sta raggiungendo va al suo passo (prima andava piano come il capo e non lo
    // raggiungeva mai)
    if ((u.band ?? -1) >= 0) { const L = this.bandLeader(u); if (L === u || hexDistance(u.tile, L.tile) <= 1) base = Math.max(base, this.bandSlow.get(u.band!) ?? 0); }
    const crowd = Math.min(BALANCE.upkeep.stackMaxSlow, 1 + BALANCE.upkeep.stackSlow * (this.stackOver(u) - 1)); // ammasso: va più piano
    return base * BALANCE.units.paceMult * (t ? BALANCE.terrain[t.terrain].move : 1) * armor * rail * sea * crowd;
  }

  /** Durata vera di un passo: il passo scatta al primo tick che arriva a `stepMs`, quindi dura un numero intero di tick. */
  stepTicksMs(u: Unit): number {
    return Math.ceil(this.stepMs(u) / BALANCE.tick.ms) * BALANCE.tick.ms;
  }

  /** Quanto manca al prossimo passo (0–1), per far scivolare la pedina sullo schermo fra una casella e l'altra. */
  stepProgress(u: Unit): number {
    // indici per il disegno (pedine per casella, chi assedia), rifatti una volta per tick: prima ogni pedina scorreva tutte
    // le altre a ogni fotogramma (con 400 pedine, 160 000 confronti)
    if (!this.viewIdx) {
      this.viewIdx = new Map();
      for (const v of this.units) if (!this.viewIdx.has(v.tile)) this.viewIdx.set(v.tile, v);
      this.viewSiege = new Set(this.battles.map((b) => b.unit ?? -1));
    }
    if (!u.path.length || u.inCombat || this.over || this.viewSiege.has(u.id)) return 0; // in pausa resta dov'era (prima tornava alla casella: sembrava fare passi indietro)
    const there = this.viewIdx.get(u.path[0]);
    if (there && there.owner !== u.owner) return 0; // casella di un nemico: aspetta ferma
    // sulla durata vera del passo (Nico: "scattano ancora"): prima sulla durata teorica, la pedina arrivava in anticipo alla
    // casella e restava ferma fino al tick del passo
    return Math.min(1, (u.moveAcc + this.tickAcc) / this.stepTicksMs(u));
  }

  /** Avanza il tempo; ritorna quanti tick sono scattati. */
  update(deltaMs: number): number {
    if (this.over || this.paused || this.placing) return 0; // pausa o partenza da scegliere: tempo fermo
    this.tickAcc += deltaMs * this.speed;
    let ticks = 0;
    while (this.tickAcc >= BALANCE.tick.ms && !this.over) {
      this.tickAcc -= BALANCE.tick.ms;
      this.step();
      ticks++;
    }
    return ticks;
  }

  /** Tempo di gioco per il disegno: scorre liscio tra un passo e l'altro. */
  get clockMs(): number {
    return this.gameTimeMs + this.tickAcc;
  }

  /** Un passo fisso del mondo. Tutto avanza a passi uguali, mai a fotogrammi:
   *  così due computer con lo stesso seme e gli stessi ordini restano identici (multiplayer a lockstep). */
  private viewIdx: Map<number, Unit> | null = null;
  private provCells: Map<number, number[]> | null = null; // province per riquadro di carta (raggio del radar sul mare)
  private squadPace = new Map<number, number>(); // squadra → passo base del reparto più lento (rifatto a ogni tick)
  private viewSiege = new Set<number>();

  step() {
    const dt = BALANCE.tick.ms;
    this.gameTimeMs += dt;
    this.viewIdx = null;
    this.tick();
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
  }

  /** Crescita lorda per tick (truppe + lavoratori): caselle × 0,1, gli insediamenti valgono qualche casella in più. */
  private growth(f: Faction): number {
    const boost = this.gameTimeMs < this.growthBoost.until ? this.growthBoost.mult : 1;
    const mult = f.id === PLAYER ? boost * this.opts.mods.growthMult * this.foodMult : f.kind === 'bot' ? BALANCE.bots.growthMult
      : this.opts.tutorial ? BALANCE.tutorial.aiGrowthMult : this.opts.front.aiGrowthMult * (this.isMega(f.id) ? BALANCE.sandboxWorld.megaGrowth : 1);
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
    this.payUpkeep();
  }

  /** Mantenimento delle pedine delle IA, come il tuo (Nico: stesse regole), dalla loro cassa una volta al secondo. Se manca la
   *  risorsa, quelle pedine hanno il rifornimento dimezzato. Per fazione e risorsa, 1 = non pagato. */
  private aiUnpaid = new Uint8Array(0);
  private aiNeed = new Float64Array(0);
  private aiUpkeep() {
    if (this.opts.tutorial || Math.round(this.gameTimeMs / BALANCE.tick.ms) % 10 !== 0) return;
    const nf = this.factions.length;
    if (this.aiUnpaid.length !== nf * 3) { this.aiUnpaid = new Uint8Array(nf * 3); this.aiNeed = new Float64Array(nf * 3); }
    const need = this.aiNeed.fill(0);
    for (const u of this.units) {
      if (u.owner === PLAYER) continue;
      const U = BALANCE.units[u.type];
      need[u.owner * 3 + RESOURCE_KEYS.indexOf(U.res)] += (U.resCost * BALANCE.upkeep.perResCost * u.size) / 60; // al secondo
    }
    for (let f = 1; f < nf; f++) {
      const loot = this.factions[f].loot;
      for (let r = 0; r < 3; r++) {
        const n = need[f * 3 + r];
        if (!n) { this.aiUnpaid[f * 3 + r] = 0; continue; }
        const k = RESOURCE_KEYS[r];
        this.aiUnpaid[f * 3 + r] = loot[k] < n ? 1 : 0;
        loot[k] = Math.max(0, loot[k] - n);
      }
    }
  }

  /** Le pedine consumano la loro risorsa dallo zaino; se manca, quelle pedine restano senza rifornimento pieno. */
  private payUpkeep() {
    const need = this.upkeepPerMin(), dt = BALANCE.tick.ms / 60_000;
    for (const r of RESOURCE_KEYS) {
      this.incomeTick[PLAYER][r] -= need[r] * dt; // l'HUD mostra l'entrata netta
      this.upkeepAcc[r] += need[r] * dt;
      const whole = Math.floor(this.upkeepAcc[r]);
      if (whole > 0) {
        this.upkeepAcc[r] -= whole;
        const short = this.player.loot[r] < whole;
        if (short && !this.unpaid[r]) this.events.push({ type: 'upkeep', res: r }); // avviso una volta, quando comincia a mancare
        if (short !== this.unpaid[r]) this.markSupply(PLAYER); // depositi a metà area (o di nuovo pieni)
        this.unpaid[r] = short;
        this.player.loot[r] = Math.max(0, this.player.loot[r] - whole);
      } else if (need[r] === 0) this.unpaid[r] = false;
    }
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
  private madeBuf: Bag = { metallo: 0, benzina: 0, cibo: 0 };
  /** Economia a quinti (Nico: pedine a scatti, "troppo calcolo"): ogni tick passa un quinto delle 18 000 province e vale
   *  per cinque; crescita, ferrovie ed entrate si aggiornano a giro finito (ogni mezzo secondo). Prima tutte a ogni tick:
   *  ~3 ms per passo, con punte che facevano saltare i fotogrammi. */
  private econGw: number[] = [];
  private econRail = new Int16Array(0);
  private econInc: Bag[] = [];
  private incProv: Bag[] = [];
  private economyTick() {
    const W = BALANCE.works, N = 5, slot = Math.round(this.gameTimeMs / BALANCE.tick.ms) % N;
    if (this.econRail.length !== this.provOwner.length) {
      this.econRail = new Int16Array(this.provOwner.length);
      this.econGw = this.factions.map(() => 0);
      this.econInc = this.factions.map(() => emptyBag());
      this.incProv = this.factions.map(() => emptyBag());
    }
    if (slot === 0) {
      this.econGw.fill(0);
      this.econRail.fill(-1);
      for (const b of this.econInc) b.metallo = b.benzina = b.cibo = 0;
    }
    for (let p = slot; p < this.provOwner.length; p += N) {
      const o = this.provOwner[p];
      const w = this.provWork[p];
      if (w >= 0 && this.provWorkAt[p] > 0 && this.provWorkAt[p] <= this.gameTimeMs) {
        this.provWorkAt[p] = 0; // pronta
        this.markSupply(o); // un deposito di rifornimento cambia la logistica
        this.events.push({ type: 'work', by: o, p, work: WORKS[w], phase: 'done' });
        if (W[WORKS[w]].makesCity) { this.cityProv.add(p); this.builtCity.add(p); this.provWork[p] = -1; } // ora è una città: il posto si libera
      }
      if (this.provLevelAt[p] > 0 && this.provLevelAt[p] <= this.gameTimeMs) {
        this.provLevelAt[p] = 0;
        this.provLevel[p]++;
        this.events.push({ type: 'work', by: o, p, work: WORKS[this.provWork[p]], phase: 'done' });
      }
      if (o === NEUTRAL) continue;
      const ready = w >= 0 && this.provWorkAt[p] === 0 ? W[WORKS[w]] : null;
      const sup = 0.5 + 0.5 * this.supply[p]; // logistica: lontano dalla capitale si cresce e si produce meno (al massimo la metà)
      this.econGw[o] += this.provGrowthW[p] * sup + (ready?.growthTiles ?? 0);
      const f = this.factions[o];
      const k = (o === PLAYER ? this.opts.mods.lootMult * this.opts.mods.prodMult : 1) * sup * this.adminEff(o);
      // tutte e tre le risorse da ogni provincia (Nico): quella del terreno di più; la fabbrica moltiplica tutto
      const bag = this.provMade(p, ready, this.madeBuf); // un sacco riusato: 10 000 oggetti a tick facevano lavorare il GC
      for (const r of RESOURCE_KEYS) {
        const v = bag[r] * k * (BALANCE.tick.ms / 60_000);
        f.lootAcc[r] += v * N; // la provincia passa una volta ogni N tick: vale per N
        this.econInc[o][r] += v;
      }
      // ferrovia: le pedine del padrone corrono qui e nelle sue province accanto
      if (ready?.railMult) {
        this.econRail[p] = o;
        for (const q of this.map.provinces[p].neighbors) if (this.provOwner[q] === o) this.econRail[q] = o;
      }
    }
    if (slot === N - 1) {
      for (let f = 0; f < this.gw.length; f++) this.gw[f] = this.econGw[f];
      this.railBy.set(this.econRail);
      for (let f = 0; f < this.incProv.length; f++) Object.assign(this.incProv[f], this.econInc[f]);
    }
    // entrate per tick mostrate dall'HUD: province (giro finito) + quello che aggiungono rancio e lavoratori in questo tick
    for (let f = 0; f < this.incomeTick.length; f++) Object.assign(this.incomeTick[f], this.incProv[f] ?? emptyBag());
  }

  /** Costo dell'impero (Nico): resa di ogni provincia quando la fazione ne ha tante. Piena fino a adminKnee, poi il totale
   *  cresce come province^adminExp: più grande conviene sempre, ma molto meno. */
  adminEff(f: number): number {
    const E = BALANCE.economy, n = this.owned[f]?.size ?? 0;
    return n <= E.adminKnee ? 1 : (E.adminKnee * Math.pow(n / E.adminKnee, E.adminExp)) / n;
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
    const w = this.workOf(p), o = this.provOwner[p], k = (o === PLAYER ? this.opts.mods.lootMult * this.opts.mods.prodMult : 1) * (o >= 0 ? this.adminEff(o) : 1);
    const b = this.provMade(p, w ? BALANCE.works[w] : null);
    return { metallo: b.metallo * k, benzina: b.benzina * k, cibo: b.cibo * k };
  }

  /** Aggiunge le province delle città vere della carta (nomi in places.json). */
  setCities(provs: number[]) {
    for (const p of provs) if (p >= 0) this.cityProv.add(p);
  }

  /** Giacimento della provincia (risorsa), null se non ce l'ha. */
  deposit(p: number): Resource | null {
    const d = this.provDeposit[p];
    return d >= 0 ? RESOURCE_KEYS[d] : null;
  }

  /** Mantenimento al minuto delle pedine del giocatore, per risorsa. */
  /** Spese al minuto divise (pannello ECONOMIA): reparti in campo e rete dei depositi (benzina). */
  upkeepSplit(): { units: Bag; depots: number } {
    const units: Bag = { metallo: 0, benzina: 0, cibo: 0 };
    for (const u of this.units) if (u.owner === PLAYER) { const U = BALANCE.units[u.type]; units[U.res] += U.resCost * BALANCE.upkeep.perResCost * u.size; }
    return { units, depots: this.opts.tutorial ? 0 : this.depotUpkeep() };
  }

  /**
   * Rete dei depositi (benzina al minuto): una quota della benzina che producono le tue province, nd / (nd + depotHalf)
   * (100 depositi = metà), almeno depotBase a deposito. Prima un costo fisso che cresceva col numero: con 164 depositi
   * 366 al minuto contro ~1400 prodotti e 148.000 in cassa, non si sentiva (Nico, 27 novembre 2026).
   */
  /** Manca una risorsa del mantenimento: i depositi coprono metà area. */
  private depotsUnpaid(): boolean {
    return this.unpaid.metallo || this.unpaid.benzina || this.unpaid.cibo;
  }

  depotUpkeep(): number {
    const K = BALANCE.upkeep, nd = this.depotLinks.length;
    if (!nd) return 0;
    const made = (this.incProv[PLAYER]?.benzina ?? 0) * (60_000 / BALANCE.tick.ms);
    return Math.max(nd * K.depotBase, made * (nd / (nd + K.depotHalf))) * K.depotMult;
  }

  upkeepPerMin(): Bag {
    const out: Bag = { metallo: 0, benzina: 0, cibo: 0 };
    if (this.opts.tutorial) return out;
    for (const u of this.units) {
      if (u.owner !== PLAYER) continue;
      const U = BALANCE.units[u.type];
      out[U.res] += U.resCost * BALANCE.upkeep.perResCost * u.size;
    }
    // i depositi costano di tutto (Nico, 26 novembre 2026; prima solo benzina), la benzina meno (depotSplit)
    const dep = this.depotUpkeep();
    for (const r of RESOURCE_KEYS) out[r] += dep * BALANCE.upkeep.depotSplit[r];
    return out;
  }

  /** Città: province con più valore (città vere della carta e capitali delle nazioni): producono di più e premiano di più. */
  isCity(p: number): boolean {
    return this.cityProv.has(p);
  }

  /** Produzione al minuto (60% risorsa del terreno, 20% ciascuna le altre; città × cityMult, fabbrica ×, raffineria/fattoria +). */
  private provMade(p: number, ready: WorkDef | null, out: Bag = { metallo: 0, benzina: 0, cibo: 0 }): Bag {
    const E = BALANCE.economy, prov = this.map.provinces[p], T = BALANCE.terrain[prov.terrain];
    const mult = ready?.levelProd?.[this.provLevel[p] - 1] ?? ready?.prodMult ?? 1; // la fabbrica rende di più a ogni livello
    const total = T.perMin * E.totalMult * (this.cityProv.has(p) ? E.cityMult : 1) * this.provRich[p] * mult;
    for (const r of RESOURCE_KEYS) out[r] = total * (r === T.res ? E.mainShare : (1 - E.mainShare) / 2);
    const dep = this.provDeposit[p];
    if (dep >= 0) out[RESOURCE_KEYS[dep]] += BALANCE.provinceEconomy.depositPerMin * mult; // giacimento
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
  workPrice(w: WorkId, _by = PLAYER, p = -1): number {
    if (!this.opts.tutorial) return 0; // fuori dalla run guidata si paga in metallo (workMetal)
    return Math.round(BALANCE.works[w].troops * this.upgradeMult(w, p));
  }

  /** La costruzione qui sarebbe un miglioramento (stessa costruzione pronta, sotto il livello massimo, niente in corso)? */
  canUpgrade(p: number, w: WorkId): boolean {
    const max = BALANCE.works[w].maxLevel ?? 1;
    return p >= 0 && this.workOf(p) === w && this.provLevel[p] < max && this.provLevelAt[p] === 0;
  }

  /** Prezzo del miglioramento: × levelCostMult per ogni livello già fatto. */
  private upgradeMult(w: WorkId, p: number): number {
    return this.canUpgrade(p, w) ? (BALANCE.works[w].levelCostMult ?? 1) ** this.provLevel[p] : 1;
  }

  /** Miglioramento in corso: ms che mancano (null se niente). */
  upgradeInProgress(p: number): number | null {
    return this.provLevelAt[p] > 0 ? this.provLevelAt[p] - this.gameTimeMs : null;
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
  workBlock(p: number, w: WorkId, techs: string[] = this.opts.techs): null | 'owner' | 'busy' | 'tech' | 'troops' | 'over' | 'coast' | 'resources' {
    const W = BALANCE.works[w];
    if (this.over) return 'over';
    if (this.provOwner[p] !== PLAYER) return 'owner';
    if (this.provWork[p] >= 0 && !this.canUpgrade(p, w)) return 'busy';
    if (W.makesCity && this.cityProv.has(p)) return 'busy'; // è già una città
    if (W.tech && !techs.includes(W.tech)) return 'tech';
    if (W.coastal && !this.provCoastal[p]) return 'coast';
    if (this.workPrice(w, PLAYER, p) > 0 && this.troops <= this.workPrice(w, PLAYER, p)) return 'troops';
    const cost = this.workCost(w, p);
    if (RESOURCE_KEYS.some((r) => this.backpack[r] < cost[r])) return 'resources';
    return null;
  }

  /** Risorse dallo zaino per una costruzione (le IA dalla loro cassa). Città, radar e depositi: ogni altro dello stesso tipo
   *  che `by` ha già (pronto o in cantiere) lo rende più caro di `countStep` (Nico, 26 novembre 2026). */
  workCost(w: WorkId, p = -1, by = PLAYER): Bag {
    const W = BALANCE.works[w], out: Bag = { metallo: 0, benzina: 0, cibo: 0 };
    if (this.opts.tutorial) return out;
    let k = this.upgradeMult(w, p);
    if (W.countStep && !this.canUpgrade(p, w)) k *= 1 + W.countStep * this.worksCount(by, w);
    for (const r of RESOURCE_KEYS) out[r] = Math.round(W.cost[r] * k);
    return out;
  }

  /** Costruzioni di quel tipo della fazione, anche in cantiere (le città fatte contano: sono città costruite). */
  private worksCount(f: number, w: WorkId): number {
    const k = WORKS.indexOf(w);
    let n = 0;
    if (w === 'citta') return this.builtCities[f] ?? 0;
    for (const p of this.owned[f] ?? []) if (this.provWork[p] === k) n++;
    return n;
  }

  /** Muro: bunker su tutte le province trascinate, in ordine, finché bastano truppe e metallo. */
  buildWall(provs: number[], w: WorkId = 'bunker'): { built: number; skipped: number; stop: ReturnType<RunState['workBlock']> } {
    let built = 0, skipped = 0, stop: ReturnType<RunState['workBlock']> = null;
    for (const p of provs) {
      const why = this.workBlock(p, w);
      if (why === 'troops' || why === 'resources' || why === 'over') { stop = why; break; }
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
    f.troops -= this.workPrice(w, by, p);
    const cost = this.workCost(w, p, by); // anche le IA (stesse regole)
    for (const r of RESOURCE_KEYS) f.loot[r] -= cost[r];
    if (W.makesCity) this.builtCities[by] = (this.builtCities[by] ?? 0) + 1;
    this.worksBuilt[by] = (this.worksBuilt[by] ?? 0) + 1;
    if (this.canUpgrade(p, w)) {
      // miglioramento: la costruzione lavora anche durante il cantiere
      this.provLevelAt[p] = this.gameTimeMs + W.timeMs * (1 + this.provLevel[p] * 0.5);
      this.events.push({ type: 'work', by, p, work: w, phase: 'start' });
      return true;
    }
    this.provWork[p] = WORKS.indexOf(w);
    this.provWorkAt[p] = this.gameTimeMs + W.timeMs;
    this.provLevel[p] = 1;
    this.provLevelAt[p] = 0;
    this.events.push({ type: 'work', by, p, work: w, phase: 'start' });
    return true;
  }

  /** IA dei fronti difficili: ogni tanto un bunker sulla provincia di confine più esposta verso di te. */
  private aiBuild(f: Faction) {
    return; // fortificazioni tolte (Nico, 26 novembre 2026): le IA non ne costruiscono più
    const every = this.opts.front.aiBunkerEveryMs;
    if (this.opts.tutorial || !every || this.gameTimeMs < (this.nextAiBunkerAt[f.id] ?? Infinity)) return;
    this.nextAiBunkerAt[f.id] = this.gameTimeMs + every;
    const mine = this.frontier(PLAYER).filter((p) => this.provOwner[p] === f.id && this.provWork[p] < 0);
    const cost = this.workCost('bunker', -1, f.id);
    if (!mine.length || f.troops < this.workPrice('bunker', f.id) * 2 || RESOURCE_KEYS.some((r) => f.loot[r] < cost[r] * 2)) return;
    this.build(f.id, mine[Math.floor(this.aiRng() * mine.length)], 'bunker'); // contraerea tolta (Nico)
  }

  // ---------- diplomazia (alla HOI4) ----------

  /** Due fazioni si possono attaccare? Con la terra libera sempre; col giocatore solo in guerra; tra IA sempre. */
  /** Alleati del giocatore: si passa sul loro territorio (e loro sul tuo). */
  allied(a: number, b: number): boolean {
    if (a === b || a < 0 || b < 0) return false;
    if (a === PLAYER) return this.relation[b] === 'alleanza';
    if (b === PLAYER) return this.relation[a] === 'alleanza';
    return false;
  }

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
    if (what === 'war' || what === 'peace' || what === 'alliance') this.chron({ k: what, a: f, b: PLAYER, byPlayer });
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

  /** Risorse di un dono a `f`: `donateLoot` più `donateLootPerProv` per ogni sua provincia. */
  lootGift(f: number): number {
    const D = BALANCE.diplomacy;
    return Math.round(D.donateLoot + D.donateLootPerProv * (this.factions[f]?.provinces ?? 0));
  }

  /** Dona risorse dallo zaino (la più abbondante). */
  donateLoot(f: number): Resource | null {
    if (this.diploBlock(f) === 'dead') return null;
    const bag = this.player.loot;
    const r = (Object.keys(bag) as Resource[]).reduce((a, c) => (bag[c] > bag[a] ? c : a));
    // dono in proporzione alla grandezza di chi lo riceve (Nico, 26 novembre 2026: "le truppe sono proporzionali, le risorse
    // date no"; prima sempre 20): un impero grande vuole un dono grande, e vale altrettanto in opinione
    const n = this.lootGift(f);
    if (bag[r] < n) return null;
    bag[r] -= n;
    this.factions[f].loot[r] += n;
    this.bump(f, 12);
    this.events.push({ type: 'diplomacy', faction: f, what: 'gift', byPlayer: true, amount: n });
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
      const borders = [...(this.owned[f.id] ?? [])].some((k) => this.map.provinces[k].neighbors.some((q) => this.provOwner[q] === PLAYER)); // solo le sue province
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
   * passa a chi lo circonda. La terra libera fino a `maxNeutral` province; una fazione solo se la sacca non tocca il mare e non ha sue pedine.
   */
  /** Accerchiamenti: giro a pezzi su tutte le province (al massimo ~2500 per tick), poi una pausa di 2 s. Tutto in un tick
   *  costava 15–30 ms e faceva scattare il gioco. */
  private encSeen: Uint8Array | null = null;
  private encCursor = 0;
  private provLand: Uint8Array | null = null;
  private encircleTick() {
    if (this.opts.tutorial || this.over || this.gameTimeMs < this.encircleAt) return;
    const E = BALANCE.encircle, own = this.provOwner, provs = this.map.provinces;
    const land = (this.provLand ??= Uint8Array.from(provs, (pr) => (pr.tiles.length > 0 ? 1 : 0)));
    if (!this.encSeen || this.encCursor === 0) this.encSeen = new Uint8Array(own.length);
    const seen = this.encSeen;
    let budget = 2500;
    for (; this.encCursor < own.length && budget > 0; this.encCursor++) {
      const p0 = this.encCursor;
      if (seen[p0] || !land[p0]) continue;
      const o = own[p0];
      const comp = [p0];
      seen[p0] = 1;
      let by = -2, open = false;
      for (let h = 0; h < comp.length; h++) {
        for (const q of provs[comp[h]].neighbors) {
          if (q < 0 || !land[q]) continue;
          if (own[q] === o) {
            if (!seen[q]) { seen[q] = 1; comp.push(q); }
            continue;
          }
          if (by === -2) by = own[q];
          else if (by !== own[q]) open = true;
        }
      }
      budget -= comp.length;
      if (open || by < 0 || !this.atWar(by, o)) continue;
      if (o === NEUTRAL) {
        if (comp.length > E.maxNeutral) continue;
      } else {
        // una fazione si arrende accerchiata solo se la sacca non tocca il mare e non ha sue pedine dentro, di qualunque
        // grandezza, anche tutta la nazione (Nico, 27 novembre 2026: prima le teste di sbarco passavano subito al nemico e
        // le pedine le riprendevano all'infinito)
        if (comp.some((p) => this.provCoastal[p])) continue;
        const inComp = new Set(comp);
        if (this.units.some((u) => u.owner === o && u.hp > 0 && inComp.has(this.provOf(u.tile)))) continue;
      }
      for (const p of comp) this.transferProvince(by, p, 0);
      this.events.push({ type: 'encircled', by, from: o, provinces: comp });
    }
    if (this.encCursor >= own.length) {
      this.encCursor = 0;
      this.encircleAt = this.gameTimeMs + 2000;
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

  private landProvs: number | null = null;
  private checkVictory() {
    if (this.over) return;
    if (this.opts.tutorial) {
      if (this.player.provinces >= BALANCE.tutorial.goalProvinces) this.end('victory', 'tutorial');
      return;
    }
    // vittoria in anticipo: i tre imperi rivali sono caduti (le milizie non contano)
    if (this.factions.every((f) => f.kind !== 'empire' || !f.alive)) this.end('victory', 'map');
    // o una quota della terra è tua (Nico, 27 novembre 2026: "quando arrivi all'80% del mondo vinci la partita", niente caccia alle isole)
    this.landProvs ??= this.map.provinces.reduce((n, p) => n + (p.tiles.length > 0 ? 1 : 0), 0);
    if (!this.over && this.player.provinces >= this.landProvs * BALANCE.victory.mapShare) this.end('victory', 'share');
  }

  retreat() {
    if (!this.over) this.end('retreat');
  }

  // ---------- comandi (multiplayer a lockstep) ----------

  /** Registro dei comandi eseguiti: con lo stesso seme basta a rigiocare la partita identica. */
  readonly cmdLog: CmdEntry[] = [];

  /** Esegue un ordine del giocatore. Ogni cosa che la scena fa al mondo passa da qui, così si può spedire o rigiocare. */
  exec<C extends Cmd>(c: C, by = PLAYER): CmdResult[C['k']] {
    this.cmdLog.push({ t: this.gameTimeMs, by, c });
    return this.run(c) as CmdResult[C['k']];
  }

  private run(c: Cmd): unknown {
    const all = (ids: number[]) => ids.map((id) => this.units.find((u) => u.id === id)).filter((u): u is Unit => !!u && u.hp > 0);
    // gruppetti: gli ordini vanno al capo, le altre lo seguono (una volta sola anche se il gruppo è tutto selezionato)
    const us = (ids: number[]) => [...new Set(all(ids).map((u) => this.bandLeader(u)))];
    switch (c.k) {
      case 'conquer': return this.tryConquer(c.tile);
      case 'plan': return this.togglePlan(c.p);
      case 'boat': return this.launchBoat(c.tile);
      case 'deploy': return this.deploy(PLAYER, c.type, c.tile);
      case 'ability': return this.useAbility(c.a, c.tile);
      case 'move': return us(c.units).filter((u) => this.command(u, c.to)).length;
      case 'stance': return this.setStance(us(c.units), c.stance);
      case 'front': return this.assignFront(us(c.units), c.faction, c.attack);
      case 'hold': {
        // posti allineati alle pedine: se una è morta nel frattempo il suo posto salta con lei (un gruppetto: un posto solo)
        const seen = new Set<Unit>();
        const live = c.units.map((id, k) => ({ u: us([id])[0], p: c.posts[k] })).filter((x) => x.u && !seen.has(x.u) && !!seen.add(x.u));
        return this.holdLine(live.map((x) => x.u!), live.map((x) => x.p));
      }
      case 'push': {
        const seen = new Set<Unit>();
        const live = c.units.map((id, k) => ({ u: us([id])[0], g: c.goals[k], v: c.vias[k] ?? [] })).filter((x) => x.u && !seen.has(x.u) && !!seen.add(x.u));
        return this.pushOffensive(live.map((x) => x.u!), live.map((x) => x.g), live.map((x) => x.v));
      }
      // freccia su una linea: l'attacco ha la precedenza su tutto quello che facevano (strada a mano, cure, posto)
      case 'release': for (const u of us(c.units)) { u.post = -1; u.goal = -1; u.front = -1; u.zone = -1; u.chase = -1; u.squad = -1; u.stance = 'tieni'; u.resting = false; u.orderHp = u.hp; this.setPath(u, []); } return;
      case 'divide': return c.quotas ? this.divideQuotas(us(c.units), c.quotas) : this.divide(us(c.units), c.size);
      case 'zone': return this.zoneAttack(us(c.units), c.provs);
      case 'chase': return this.chaseUnit(us(c.units), c.target);
      case 'unpost': for (const u of us(c.units)) u.post = -1; return;
      case 'band': return this.makeBand(all(c.units));
      case 'unband': for (const u of all(c.units)) u.band = -1; return;
      case 'merge': return this.merge(all(c.units));
      case 'split': { const u = all([c.unit])[0]; return u ? this.split(u) : 'single'; }
      case 'retreatUnits': return this.retreatUnits(us(c.units));
      case 'wall': return this.buildWall(c.provs, c.work);
      case 'war': return this.declareWar(c.f);
      case 'peace': return this.proposePeace(c.f);
      case 'alliance': return this.proposeAlliance(c.f);
      case 'breakAlliance': return this.breakAlliance(c.f);
      case 'giveTroops': return this.donateTroops(c.f);
      case 'giveLoot': return this.donateLoot(c.f);
      case 'tribute': return this.demandTribute(c.f);
      case 'event': return this.choose(c.side, c.i);
      case 'place': return this.placePlayer(c.p);
      case 'clearStart': return this.clearStart();
      case 'pause': this.paused = c.on; return;
      case 'retreat': return this.retreat();
    }
  }

  /** Impronta dello stato che conta: due computer in lockstep la confrontano per accorgersi se si sono separati. */
  hash(): number {
    let h = 2166136261;
    const mix = (v: number) => { h = Math.imul(h ^ (v | 0), 16777619); };
    mix(this.gameTimeMs / BALANCE.tick.ms);
    for (let p = 0; p < this.provOwner.length; p++) mix(this.provOwner[p]);
    for (const f of this.factions) { mix(Math.round(f.troops)); mix(f.provinces); }
    for (const u of this.units) { mix(u.id); mix(u.tile); mix(Math.round(u.hp * 10)); }
    for (const b of this.battles) { mix(b.p); mix(b.by); mix(b.endMs); }
    return h >>> 0;
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
    // puntata: in vittoria torna com'è, in ritirata paga la tassa come lo zaino, se non vinci (fine tempo o eliminato) si perde
    // tranne l'assicurazione del Deposito. Il guadagno oltre la puntata rende di più (moltiplicatore della puntata e bonus di vittoria).
    const gain = this.opts.stakeMult * this.opts.campaignLootMult;
    const staked = S.metallo + S.benzina + S.cibo > 0;
    const lost = outcome === 'timeout' || outcome === 'eliminated';
    const stakeK = !staked ? k : outcome === 'victory' ? 1 : lost ? 1 - BALANCE.stake.lossShare * (1 - this.opts.stakeInsurance) : k;
    const kept = {} as Bag;
    const SS = this.opts.tutorial ? emptyBag() : BALANCE.economy.startStock; // la scorta di guerra torna al Comando, non è bottino
    for (const r of Object.keys(bag) as Resource[]) {
      const b = Math.max(0, bag[r] - SS[r]);
      kept[r] = this.opts.sandbox ? 0 : Math.floor(Math.min(b, S[r]) * stakeK + Math.max(0, b - S[r]) * gain * k); // sandbox: niente a casa
    }
    return {
      seed: this.map.seed, outcome, reason: this.victoryReason, timeMs: this.gameTimeMs,
      maxTiles: this.player.maxTiles, maxProvinces: this.player.maxProvinces, backpack: { ...bag }, kept, stake: { ...S },
      gainMult: gain, feePct: Math.round((k < 1 ? 1 - k : 0) * 100), stakeLossPct: staked && lost ? Math.round((1 - stakeK) * 100) : 0,
      tutorial: this.opts.tutorial, civ: this.opts.civ, campaign: this.opts.campaign, front: this.opts.frontIndex,
      world: this.worldOutcome(),
      rareSeen: EVENTS.filter((e) => e.rare && this.seenEvents.has(e.id)).map((e) => e.id),
      sandbox: !!this.opts.sandbox,
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

  private supplyAt = -Infinity;

  private tick() {
    this.replayTick();
    // logistica rifatta al massimo ogni mezzo secondo di gioco: con tante milizie il territorio cambia a ogni tick
    if ((this.supplyDirty || this.supplyDirtyF.size) && this.gameTimeMs - this.supplyAt >= 500) { this.supplyAt = this.gameTimeMs; this.recomputeSupply(); }
    this.countSettlements();
    this.economyTick();
    for (const f of this.factions) if (f.alive) this.grow(f);
    if (this.player.alive) this.eat();
    const slot = Math.round(this.gameTimeMs / BALANCE.tick.ms) % 5;
    for (const f of this.factions) {
      if (f.id === PLAYER || !f.alive) continue;
      if (f.kind === 'bot') {
        // milizie: difendono e si allargano piano, solo su terra libera vicino a casa. Fuori dalla run guidata solo con le
        // pedine, come te (Nico, 27 novembre 2026: "devono giocare come noi"): prima compravano la terra con le truppe
        if (this.opts.tutorial && this.aiRng() <= BALANCE.bots.actChance) this.botExpand(f);
        // anche le milizie schierano pedine (Nico); a turno, un quinto per tick: tutte insieme 150 milizie
        // rubavano ~10 ms a ogni tick e le pedine andavano a scatti
        if (f.id % 5 === slot) this.aiUnits(f);
        continue;
      }
      const sandboxTurn = !this.opts.sandbox || f.id % 3 === slot % 3; // sandbox, 25 imperi: ordini alle pedine a turno, uno su tre
      const assault = this.offensive?.phase === 'on' && this.offensive.faction === f.id;
      this.aiBuild(f);
      // terra libera comprata con le truppe: solo nella run guidata; altrove gli imperi conquistano con le pedine come te
      if (this.opts.tutorial && (assault || this.aiRng() <= 0.07)) {
        const n = assault ? BALANCE.offensive.attacksPerAct : BALANCE.ai.attacksPerAct * (this.opts.sandbox ? BALANCE.sandboxWorld.actMult : 1);
        this.aiAttackMany(f, n);
      }
      if (sandboxTurn) this.aiUnits(f);
    }
    this.aiUpkeep();
    this.playerUnitsAuto();
    this.unitsTick();
    this.battlesTick();
    this.diploTick();
    this.encircleTick();
    this.offensiveTick();
    this.timerTick();
    this.objectivesTick();
    this.checkVictory();
    this.eventTick();
    this.updateFog();
    this.updateSight();
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
  /** La carta (confini, territori) si vede tutta (Nico); vale ancora per la casella in vista nella vecchia nebbia. */
  sees(i: number): boolean {
    void i;
    return true;
  }

  /** Pedina visibile? Nella zona che vedi, e se è di chi ha un'opinione bassa di te solo a contatto (spionaggio). */
  seesUnit(u: Unit): boolean {
    if (u.owner === PLAYER || this.relation[u.owner] === 'alleanza') return true;
    const p = this.provOf(u.tile);
    if (p >= 0) return this.inSight(p);
    if (this.seaSight[u.tile] === 1) return true; // in mare: nel raggio delle tue navi
    return neighbors(u.tile).some((n) => n >= 0 && this.provOf(n) >= 0 && this.inSight(this.provOf(n))); // in mare: vicino alla zona
  }

  /** Provincia nella zona in vista (attorno al tuo confine, alle tue pedine e ai radar). */
  inSight(p: number): boolean {
    return this.opts.tutorial || this.sight[p] === 1;
  }

  /** Confini e territori si vedono ovunque (Nico): la nebbia ora nasconde solo le pedine, fuori dalla zona in vista. */
  seesProv(p: number): boolean {
    void p;
    return true;
  }

  /** Zona in vista per province: dal tuo confine `depth` province, attorno alle pedine e molto di più attorno ai radar. */
  private sightDepth = new Int8Array(0);
  private updateSight() {
    const S = BALANCE.sight, P = this.map.provinces, radar = WORKS.indexOf('radar');
    const own = this.ownedProvinces(PLAYER);
    let sig = own.size * 7919 + this.recons.length * 31;
    for (const p of own) { sig = (sig + p * 2654435761) | 0; if (this.provWork[p] === radar && this.provWorkAt[p] === 0) sig = (sig * 31 + p) | 0; }
    // in mare conta la casella: la nave che si sposta sposta la sua vista
    for (const u of this.units) if (u.owner === PLAYER || this.relation[u.owner] === 'alleanza') { const p = this.provOf(u.tile); sig = (sig * 31 + (p >= 0 ? p : -1 - u.tile)) | 0; }
    for (const f of this.factions) if (this.relation[f.id] === 'alleanza' && f.alive) sig = (sig * 31 + f.id * 977 + f.provinces) | 0;
    if (sig === this.sightSig && this.sight.length) return;
    this.sightSig = sig;
    if (this.sight.length !== P.length) { this.sight = new Uint8Array(P.length); this.sightDepth = new Int8Array(P.length); }
    const d = this.sightDepth.fill(-1), queue: number[] = [];
    const seed = (p: number, r: number) => { if (p >= 0 && d[p] < r) { d[p] = r; queue.push(p); } };
    for (const p of own) seed(p, this.provWork[p] === radar && this.provWorkAt[p] === 0 ? S.depth + S.radarDepth : S.depth);
    // alleati (Nico, 26 novembre 2026: "l'alleanza deve darti il loro intel"): vedi quello che vedono loro, come se il loro
    // territorio, le loro pedine e i loro radar fossero tuoi (prima solo il loro territorio)
    for (const u of this.units) if (u.owner === PLAYER || this.relation[u.owner] === 'alleanza') seed(this.provOf(u.tile), S.unitDepth);
    for (const r of this.recons) seed(this.provOf(r.tile), S.reconDepth);
    for (const f of this.factions) {
      if (this.relation[f.id] !== 'alleanza' || !f.alive) continue;
      for (const p of this.ownedProvinces(f.id)) seed(p, this.provWork[p] === radar && this.provWorkAt[p] === 0 ? S.depth + S.radarDepth : S.depth);
    }
    for (let h = 0; h < queue.length; h++) {
      const c = queue[h];
      if (d[c] <= 0) continue;
      for (const n of P[c].neighbors) if (n >= 0 && d[n] < d[c] - 1) { d[n] = d[c] - 1; queue.push(n); }
    }
    // radar: il raggio passa anche sopra il mare (Nico): le province entro la distanza, non solo quelle collegate via terra
    const radars = [...own].filter((p) => this.provWork[p] === radar && this.provWorkAt[p] === 0).map((p) => P[p].anchor);
    if (radars.length) {
      const R = (S.depth + S.radarDepth) * S.radarHexPerStep;
      // province a riquadri di R caselle (una volta sola): ogni radar guarda solo i 9 riquadri attorno, non tutta la carta
      if (!this.provCells) {
        this.provCells = new Map();
        P.forEach((pr, p) => { if (pr.anchor < 0) return; const k = Math.floor(rowOf(pr.anchor) / R) * 4096 + Math.floor(colOf(pr.anchor) / R); const c = this.provCells!.get(k); if (c) c.push(p); else this.provCells!.set(k, [p]); });
      }
      for (const a of radars) {
        const cr = Math.floor(rowOf(a) / R), cc = Math.floor(colOf(a) / R);
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          for (const p of this.provCells.get((cr + dr) * 4096 + cc + dc) ?? []) if (d[p] < 0 && hexDistance(a, P[p].anchor) <= R) d[p] = 0;
        }
      }
    }
    // pedine in mare (Nico, 28 novembre 2026: "un vascello nell'acqua deve dare visione, non puoi metterlo nell'ombra, deve
    // essere come un radar"): vedono tutto entro `seaHex` caselle, mare e coste comprese
    const cols = BALANCE.map.cols, rows = BALANCE.map.rows, SR = S.seaHex;
    if (this.seaSight.length !== cols * rows) { this.seaSight = new Uint8Array(cols * rows); this.seaLit = []; }
    for (const i of this.seaLit) this.seaSight[i] = 0;
    this.seaLit = [];
    for (const u of this.units) {
      if (u.owner !== PLAYER && this.relation[u.owner] !== 'alleanza' || this.provOf(u.tile) >= 0) continue;
      const c0 = colOf(u.tile), r0 = rowOf(u.tile);
      for (let r = Math.max(0, r0 - SR); r <= Math.min(rows - 1, r0 + SR); r++) {
        for (let c = Math.max(0, c0 - SR - 1); c <= Math.min(cols - 1, c0 + SR + 1); c++) {
          const i = r * cols + c;
          if (hexDistance(u.tile, i) > SR) continue;
          const p = this.provOf(i);
          if (p >= 0) { if (d[p] < 0) d[p] = 0; } else if (!this.seaSight[i]) { this.seaSight[i] = 1; this.seaLit.push(i); }
        }
      }
    }
    for (let p = 0; p < P.length; p++) this.sight[p] = d[p] >= 0 ? 1 : 0;
    this.sightVersion++;
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
    // rapporti scaduti: via dal RADAR (Nico: "vai lì e non succede niente")
    const before = this.eventInbox.length;
    this.eventInbox = this.eventInbox.filter((e) => e.until === undefined || e.until > this.gameTimeMs);
    if (this.eventInbox.length !== before) this.events.push({ type: 'event', event: this.eventInbox[0] ?? null as unknown as GameEvent });
    // rapporti dal campo solo con una Sala Radar finita; più radar, più rapporti (Nico)
    const radars = this.worksOf(PLAYER, 'radar');
    if (this.over || this.opts.events <= 0 || this.opts.tutorial || !radars || this.gameTimeMs < this.nextEventAt) return;
    const E = BALANCE.events;
    this.nextEventAt = this.gameTimeMs + Math.max(E.minEveryMs, (E.everyMs + (this.evRng() * 2 - 1) * E.jitterMs) / radars);
    // prima i rapporti utili: armata in arrivo, scorta da recuperare, punto debole; ogni tanto un evento classico
    const intel = [this.reportAttack(radars), this.reportCache(radars)].filter((e): e is GameEvent => !!e);
    if (intel.length && this.evRng() < 0.75) {
      const ev = intel[Math.floor(this.evRng() * intel.length)];
      this.toInbox(ev);
      return;
    }
    const pool = EVENTS.filter((e) => !this.seenEvents.has(e.id) && (!e.rare || this.opts.events >= 2));
    if (!pool.length) return;
    // i rari, quando ammessi, escono un po' più spesso: è la Radio che li cerca
    const rare = pool.filter((e) => e.rare);
    const ev = rare.length && this.evRng() < 0.35 ? rare[Math.floor(this.evRng() * rare.length)] : pool[Math.floor(this.evRng() * pool.length)];
    this.seenEvents.add(ev.id);
    this.toInbox(this.scaled(boosted(ev)));
  }

  /** Sandbox: uno dei 5 imperi fortissimi (i primi imperi dell'elenco). */
  isMega(f: number): boolean {
    if (!this.opts.sandbox || this.factions[f]?.kind !== 'empire') return false;
    let k = 0;
    for (const g of this.factions) { if (g.kind !== 'empire') continue; if (g.id === f) return k < BALANCE.sandboxWorld.mega; k++; }
    return false;
  }

  /** Il rapporto aspetta nel RADAR (al massimo 5: i più vecchi scadono). */
  private toInbox(ev: GameEvent) {
    this.eventInbox.unshift(ev);
    if (this.eventInbox.length > 5) this.eventInbox.pop();
    this.events.push({ type: 'event', event: ev });
  }

  /** Quanto pesano truppe e risorse adesso (Nico: "30 di ferro quando ne ho 8.000"): premi e costi crescono con le entrate. */
  private evScale(): { t: number; r: number } {
    const inc = this.incomePerMin();
    return { t: Math.max(1, (this.troopsPerSecond * 60) / 600), r: Math.max(1, (inc.metallo + inc.benzina + inc.cibo) / 60) };
  }

  private scaled(ev: GameEvent): GameEvent {
    const k = this.evScale();
    const up = (fx: EventEffects): EventEffects => {
      const o: EventEffects = { ...fx };
      if (o.troops) o.troops = Math.round(o.troops * k.t);
      if (o.loot) o.loot = Object.fromEntries(Object.entries(o.loot).map(([r, v]) => [r, Math.round(v * k.r)]));
      return o;
    };
    const side = (c: EventChoice): EventChoice => ({ ...c, effects: up(c.effects), fail: c.fail && up(c.fail) });
    return { ...ev, left: side(ev.left), right: side(ev.right) };
  }

  private nationOf(p: number): string {
    const c = this.map.provinces[p].country;
    return this.map.nations.find((n) => n.id === c)?.name ?? 'a border province';
  }

  /** Radar: armata nemica (in guerra con te) che punta su una tua provincia. */
  private reportAttack(radars: number): GameEvent | null {
    // armata vera (Nico: "robe irrilevanti"): almeno `attackMinSize` reparti dello stesso nemico diretti sulla stessa tua provincia
    const groups = new Map<number, { size: number; lead: Unit; to: number }>();
    for (const u of this.units) {
      if (u.owner === PLAYER || u.hp <= 0 || !this.atWar(u.owner, PLAYER) || !u.path.length) continue;
      const end = u.path[u.path.length - 1], pe = this.provOf(end);
      if (pe < 0 || this.provOwner[pe] !== PLAYER) continue;
      const k = pe * 1024 + u.owner, g = groups.get(k);
      if (g) g.size += u.size; else groups.set(k, { size: u.size, lead: u, to: end });
    }
    let pick: { size: number; lead: Unit; to: number } | null = null;
    for (const g of groups.values()) if (g.size >= BALANCE.events.attackMinSize && (!pick || g.size > pick.size)) pick = g;
    if (!pick) return null;
    const best = pick.lead, to = pick.to, n = pick.size;
    const who = FACTION_INFO[best.owner]?.name ?? 'the enemy', where = this.nationOf(this.provOf(to));
    return {
      id: 'radar-attacco', rare: false, img: ['ev-radar-attacco', 'ev-radar-attacco-2', 'ev-frequenza'][Math.floor(this.evRng() * 3)], // foto diverse (Nico)
      text: `RADAR: ${n} ${n === 1 ? 'unit' : 'units'} of ${who} marching towards ${where}. ${radars > 1 ? 'The stations agree on the route.' : 'Weak contact, but the route is clear.'}`,
      left: { label: 'Received', effects: { alert: { from: best.tile, to } }, result: 'Route marked on the map.' },
      right: { label: 'Reinforce', effects: { alert: { from: best.tile, to }, focus: this.provOf(to), guard: this.provOf(to) }, result: `Garrison reinforced: defence ×${BALANCE.events.guardMult} for ${BALANCE.events.guardMs / 1000} s.` },
      until: this.gameTimeMs + BALANCE.events.reportTtlMs,
    };
  }

  /** Radar: deposito abbandonato vicino al confine: truppe e bottino gratis. */
  private reportCache(radars: number): GameEvent | null {
    const front = this.frontier(PLAYER);
    if (!front.length) return null;
    const p = front[Math.floor(this.evRng() * front.length)];
    const k = this.evScale();
    const troops = Math.round((40 + 15 * radars) * (0.8 + this.evRng() * 0.4) * k.t);
    const res = (['metallo', 'benzina', 'cibo'] as Resource[])[Math.floor(this.evRng() * 3)];
    const n = Math.round((10 + 4 * radars) * (0.8 + this.evRng() * 0.4) * k.r);
    return {
      id: 'radar-scorta', rare: false, img: ['ev-radar-scorta', 'ev-radar-scorta-2', 'ev-convoglio'][Math.floor(this.evRng() * 3)],
      text: `RADAR: a Concord depot still intact near ${this.nationOf(p)}. Stragglers and ${RESOURCE_INFO[res].name.toLowerCase()} in the stores.`,
      left: { label: 'Leave it', effects: {}, result: 'The depot stays where it is.' },
      right: { label: 'Recover', effects: { troops, loot: { [res]: n }, focus: p }, result: `+${troops} troops, +${n} ${RESOURCE_INFO[res].name.toLowerCase()}.` },
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
  choose(side: 'left' | 'right', i = 0): string {
    const ev = this.eventInbox[i];
    if (!ev) return '';
    const c = ev[side];
    if (!this.canChoose(c)) return '';
    const success = c.chance === undefined || this.evRng() < c.chance;
    this.applyEffects(success ? c.effects : c.fail ?? {});
    this.eventInbox.splice(i, 1);
    return success ? c.result : c.failResult ?? c.result;
  }

  private applyEffects(fx: EventEffects) {
    const p = this.player;
    if (fx.troops) p.troops = Math.max(0, p.troops + fx.troops);
    if (fx.loot) for (const [r, v] of Object.entries(fx.loot)) p.loot[r as Resource] = Math.max(0, p.loot[r as Resource] + v);
    if (fx.growth) this.growthBoost = { mult: fx.growth.mult, until: this.gameTimeMs + fx.growth.durationMs };
    if (fx.timeBonusMs) this.bonusTimeMs += fx.timeBonusMs;
    if (fx.alert) this.alerts.push({ ...fx.alert, until: this.gameTimeMs + 20_000 });
    if (fx.guard !== undefined) this.guardUntil.set(fx.guard, this.gameTimeMs + BALANCE.events.guardMs);
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
    // più reparti hai in campo, più costa il prossimo (Nico: "con un milione di truppe faccio 10 000 fanterie"); anche le IA
    const army = 1 + this.units.reduce((n, u) => n + (u.owner === f ? u.size : 0), 0) / BALANCE.upkeep.armyCostPer;
    return Math.round(BALANCE.units[type].cost * army * (f === PLAYER ? this.opts.mods.unitCostMult * (this.opts.unitBoost?.[type]?.cost ?? 1) : 1));
  }

  /** Perché non si può schierare (null = si può). */
  /** Una casella libera (tua, senza pedine) nella provincia, o null. */
  freeTileIn(p: number): number | null {
    if (p < 0) return null;
    // la casella libera più vicina al centro della provincia (prima la prima della lista: reparti sparsi a caso)
    const a = this.map.provinces[p].anchor;
    let best: number | null = null, bd = Infinity;
    for (const i of this.map.provinces[p].tiles) {
      if (!this.passable(i) || this.owner[i] !== PLAYER || this.unitAt(i)) continue;
      const d = a >= 0 ? hexDistance(i, a) : 0;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** Esercito di partenza: fanteria e (se c'è) ricognitori nella capitale, così si conquista subito senza comprare. */
  private starterArmy() {
    const C = this.capitalProv[PLAYER], types: UnitType[] = ['fanteria', 'fanteria', ...(this.opts.units.includes('ricognitori') ? ['ricognitori' as UnitType] : [])];
    for (const t of types) {
      const at = this.freeTileIn(C) ?? this.map.provinces[C].neighbors.map((q) => this.freeTileIn(q)).find((x) => x !== null && x !== undefined);
      if (at !== null && at !== undefined) this.deploy(PLAYER, t, at, true);
    }
  }

  /** Provincia dove si producono eserciti: la capitale, una città o una provincia con la caserma. */
  canRecruitAt(p: number, f = PLAYER): boolean {
    // milizie: solo città vere o caserme (Nico, 27 novembre 2026: "le pedine devono spuntare dalle città, non da regioni a
    // caso"); la loro "capitale" è una provincia qualunque. Tu e gli imperi anche dalla capitale
    if (p < 0 || this.provOwner[p] !== f) return false;
    if (this.isCity(p) || this.workOf(p) === 'caserma') return true;
    if (p !== this.capitalProv[f]) return false;
    // milizia senza città né caserma: arruola dalla sua capitale (Nico, 28 novembre 2026: "tutti, anche i più piccoli, devono
    // avere le loro truppine ed espandersi da subito"; prima quasi nessuna milizia aveva una città e non schierava mai)
    return this.factions[f]?.kind !== 'bot' || ![...(this.owned[f] ?? [])].some((q) => this.isCity(q) || this.workOf(q) === 'caserma');
  }

  deployBlock(f: number, type: UnitType, i?: number): null | 'locked' | 'cooldown' | 'troops' | 'cap' | 'tile' | 'res' | 'city' {
    if (f === PLAYER && !this.opts.units.includes(type)) return 'locked';
    if (f !== PLAYER && this.gameTimeMs < this.cooldowns[f][type]) return 'cooldown'; // il giocatore non ha ricarica: si schiera subito
    if (f !== PLAYER && this.unitsOf(f).length >= this.aiUnitCap(this.factions[f])) return 'cap'; // il giocatore non ha un massimo di pedine
    if (this.factions[f].troops < this.unitCost(f, type)) return 'troops';
    if (this.factions[f].loot[this.unitRes(type).res] < this.unitRes(type).n) return 'res'; // la risorsa del reparto, dallo zaino (le IA dalla loro cassa)
    if (i !== undefined && isNaval(type)) {
      // nave: da una tua città sul mare, toccata dove si vuole (Nico, 27 novembre 2026: "non si capisce dove si può
      // posizionare": prima bisognava centrare proprio una casella di costa); esce dal mare libero più vicino al tocco
      const p = this.provOf(i);
      if (p < 0 || this.provOwner[p] !== f || !this.provCoastal[p]) return 'tile';
      if (!this.opts.tutorial && !this.canRecruitAt(p, f)) return 'city';
      if (this.navalSpawn(p, i) < 0) return 'tile';
    } else if (i !== undefined && (this.owner[this.stopOf(i)] !== f || this.unitAt(this.stopOf(i))?.owner !== undefined && this.unitAt(this.stopOf(i))!.owner !== f)) return 'tile';
    // gli eserciti escono dalle città: capitale, città o provincia con la caserma (alla Call of War)
    // anche le IA (Nico, 27 novembre 2026: "l'IA non può giocare fuori dalle regole", niente 40 fanterie in mezzo al nulla)
    else if (i !== undefined && !this.opts.tutorial && !this.canRecruitAt(this.provOf(i), f)) return 'city';
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
      { const c = this.unitRes(type); this.factions[f].loot[c.res] -= c.n; }
      if (f !== PLAYER) this.cooldowns[f][type] = this.gameTimeMs + BALANCE.units.cooldownMs; // il giocatore: nessuna ricarica (neanche la barra sulla carta)
    }
    const maxHp = BALANCE.units[type].hp * (f === PLAYER ? this.opts.unitHpMult * (this.opts.unitBoost?.[type]?.hp ?? 1) : this.opts.front.aiUnitHpMult);
    const tile = isNaval(type) ? this.navalSpawn(this.provOf(i), i) : this.owner[this.stopOf(i)] === f ? this.stopOf(i) : i; // sul centro, in pila con le amiche
    if (tile < 0) return null;
    if (f === PLAYER && !isNaval(type) && this.units.reduce((n, v) => n + (v.owner === f ? 1 : 0), 0) >= BALANCE.unitOps.divisionAt) {
      const host = this.units.find((v) => v.owner === f && v.type === type && v.tile === tile && !v.path.length && v.size < BALANCE.unitOps.divisionMax);
      if (host) { host.size++; host.maxHp += maxHp; host.hp += maxHp; return host; } // la divisione cresce: meno pedine, più forti
    }
    const u: Unit = {
      id: this.nextUnitId++, type, owner: f, tile, hp: maxHp, maxHp,
      path: [], moveAcc: 0, inCombat: false, lastOrderMs: this.gameTimeMs,
      size: 1, stance: 'tieni', front: -1, supply: 1, post: -1, goal: -1,
    };
    // (prima avanzava da solo appena schierato: tolto, Nico 25 novembre 2026: "corrono a caso"): si muove solo dove lo mandi
    this.units.push(u);
    return u;
  }

  /** Mare libero accanto alla costa della provincia, il più vicino alla casella toccata (dove nasce una nave), −1 se non c'è. */
  navalSpawn(p: number, near: number): number {
    if (p < 0) return -1;
    let best = -1, bd = Infinity;
    for (const i of this.map.provinces[p].tiles) {
      if (this.owner[i] !== this.provOwner[p]) continue;
      const s = this.seaSpawn(i);
      if (s < 0) continue;
      const d = hexDistance(i, near);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /** Casella di mare libera accanto a una costa (dove nasce una cannoniera), −1 se non c'è. */
  private seaSpawn(coast: number): number {
    return neighbors(coast).find((n) => n >= 0 && !this.map.tiles[n] && !this.unitAt(n)) ?? -1;
  }

  /** Ordina alla pedina di andare verso `to`; false se irraggiungibile. Le navi vanno sul mare accanto alla costa toccata. */
  /** Nuovo percorso: se la prima casella cambia, il passo riparte da zero (sullo schermo la pedina non salta di lato). */
  private setPath(u: Unit, path: number[]) {
    if (path[0] !== u.path[0]) u.moveAcc = 0;
    u.path = path;
  }

  order(u: Unit, to: number, home = false): boolean {
    if (isNaval(u.type)) {
      const sea = (i: number) => i >= 0 && !this.map.tiles[i];
      let dest = to;
      if (!sea(to)) {
        const opts = neighbors(to).filter(sea);
        if (!opts.length) return false;
        dest = opts.reduce((a, b) => (hexDistance(a, u.tile) <= hexDistance(b, u.tile) ? a : b));
      }
      const path = findPath(u.tile, dest, sea);
      this.setPath(u, path);
      u.lastOrderMs = this.gameTimeMs;
      return path.length > 0 || dest === u.tile;
    }
    // riposizionamento (linea, cure, ritorno al posto): solo nel tuo territorio anche col giro largo; se da lì non si arriva,
    // la strada normale (Nico, 27 novembre 2026: "passino dentro il tuo territorio, così da non calpestare i nemici")
    let path = home ? this.landPath(u, this.stopOf(to), u.tile, true) : [];
    if (!path.length) path = this.landPath(u, this.stopOf(to));
    this.setPath(u, path);
    u.lastOrderMs = this.gameTimeMs;
    return path.length > 0;
  }

  /** Stop della rete (centro della provincia) per una casella di terra: le pedine stanno e arrivano solo lì (Nico: "della
   *  rete non gli frega niente"). Le navi e le caselle senza provincia restano come sono. */
  stopOf(i: number): number {
    const p = this.provOf(i), a = p >= 0 ? this.map.provinces[p].anchor : -1;
    return a >= 0 ? a : i;
  }

  /**
   * Percorso alla Call of War (Nico): da centro a centro delle province, lungo i collegamenti tra province vicine. La
   * provincia si prende arrivando al suo centro, non passando il confine. Alla fine si va alla casella chiesta (se non è
   * il centro). Se la catena di province non si trova, il percorso più corto sulle caselle.
   */
  private lpCost = new Float64Array(0);
  private lpPrev = new Int32Array(0);
  private lpSeen = new Int32Array(0);
  private lpDone = new Int32Array(0);
  private lpStamp = 0;
  pathBroken = 0; // catene rotte trovate da landPath (diagnosi)
  private seaFail = new Map<number, number>(); // traversate impossibili: partenza e meta → quando
  private landPath(u: Unit, to: number, start = u.tile, home = false): number[] {
    const ford = this.map.ford; // stretti brevi: si passano a piedi (province ai due lati collegate)
    // sul territorio degli alleati si passa (Nico, 26 novembre 2026), su quello di chi è in pace no
    const ok = (i: number) => this.passable(i) && (this.atWar(u.owner, this.owner[i]) || this.allied(u.owner, this.owner[i])) || this.owner[i] === u.owner || i >= 0 && ford[i] === 1;
    const sp = home ? this.provOf(start) : -1, tp = home ? this.provOf(to) : -1;
    // sbarco alla Call of War (Nico: "le isole sono irraggiungibili"): se la meta non si raggiunge via terra, le pedine del
    // giocatore vanno alla costa e attraversano il mare. Solo le sue: le IA non usano il mare (e cercare costa caro)
    const amph = u.owner === PLAYER && !isNaval(u.type);
    const okSea = (i: number) => ok(i) || i >= 0 && !this.map.tiles[i];
    const bySea = () => {
      if (!amph) return [];
      // una traversata impossibile non si ricerca a ogni secondo (linee e reparti che attaccano da soli riprovano spesso)
      const key = start * 524288 + to, failed = this.seaFail.get(key);
      if (failed !== undefined && this.gameTimeMs - failed < 5000) return [];
      const path = findPathAStar(start, to, okSea, 120000);
      if (!path.length) this.seaFail.set(key, this.gameTimeMs);
      if (this.seaFail.size > 500) this.seaFail.clear();
      return path;
    };
    const P = this.map.provinces, a = this.provOf(start), b = this.provOf(to);
    if (a < 0 || b < 0) return amph ? bySea() : findPath(start, to, ok);
    // home: solo province tue (più quella dove sta e quella dove va); vuoto se non c'è strada, chi chiama ritenta normale
    const okProv = (p: number) => P[p].anchor >= 0 && (this.provOwner[p] === u.owner || this.allied(u.owner, this.provOwner[p]) || !home && this.atWar(u.owner, this.provOwner[p]) || p === sp || p === tp);
    // le tue pedine girano attorno a chi non è il bersaglio (Nico, 26 novembre 2026: "mandi le truppe contro un territorio e
    // camminano sopra altri, così scoppiano guerre all'infinito; meglio che stiano per i cazzi loro, a meno che non li attacchi
    // tutti e due"): la terra di una terza fazione costa `thirdPartyMult` volte, ci passano solo se non c'è altra strada
    const aim = this.provOwner[b], third = (n: number) => {
      const o = this.provOwner[n];
      return u.owner === PLAYER && o !== u.owner && o !== NEUTRAL && o !== aim && !this.allied(u.owner, o) ? BALANCE.unitOps.thirdPartyMult : 1;
    };
    if (home && a < 0) return [];
    if (!okProv(b)) return []; // meta in pace o non attraversabile: prima cercava casella per casella su tutta la carta
    // province da centro a centro col percorso più rapido, non con meno passaggi: la ferrovia (tua) costa meno, montagne e
    // colline di più (Nico: le pedine non passavano sulle ferrovie costruite)
    // buffer riusati con un timbro: niente array nuovi da 18 000 a ogni ordine (le IA ne danno tanti)
    if (this.lpCost.length !== P.length) { this.lpCost = new Float64Array(P.length); this.lpPrev = new Int32Array(P.length); this.lpSeen = new Int32Array(P.length); this.lpDone = new Int32Array(P.length); }
    const stamp = ++this.lpStamp, cost = this.lpCost, prevA = this.lpPrev, seen = this.lpSeen, doneA = this.lpDone;
    const C = (n: number) => (seen[n] === stamp ? cost[n] : Infinity);
    const prev = { get: (n: number) => (seen[n] === stamp ? prevA[n] : -1) };
    const rail = BALANCE.works.ferrovia.railMult ?? 1;
    const hop = (from: number, n: number) => hexDistance(P[from].anchor, P[n].anchor) * BALANCE.terrain[P[n].terrain].move * third(n)
      * (this.railBy[n] === u.owner && this.railBy[from] === u.owner ? rail : 1);
    const heap: number[] = [a];
    const up = (i: number) => { while (i > 0) { const p = (i - 1) >> 1; if (C(heap[p]) <= C(heap[i])) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && C(heap[l]) < C(heap[m])) m = l;
          if (r < heap.length && C(heap[r]) < C(heap[m])) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    seen[a] = stamp; cost[a] = 0; prevA[a] = a;
    // tetto alla ricerca (Nico: scatti, "troppo calcolo"): una meta irraggiungibile faceva esplorare tutte le province,
    // a ogni secondo per ogni pedina delle IA. Oltre ~4 volte la distanza in linea d'aria la meta non si raggiunge
    const cap = 4 * hexDistance(P[a].anchor >= 0 ? P[a].anchor : start, P[b].anchor) + 60;
    while (heap.length) {
      const c = pop();
      if (doneA[c] === stamp) continue;
      doneA[c] = stamp;
      if (c === b || cost[c] > cap) break;
      for (const n of P[c].neighbors) {
        if (n < 0 || doneA[n] === stamp || !okProv(n)) continue;
        const v = cost[c] + hop(c, n);
        if (v < C(n)) { seen[n] = stamp; cost[n] = v; prevA[n] = c; heap.push(n); up(heap.length - 1); }
      }
    }
    if (prev.get(b) < 0) return home ? [] : bySea(); // niente strada sulla rete: per mare (o irraggiungibile)
    const chain: number[] = [];
    // catena rotta (passo senza provenienza o giro chiuso): niente strada. Prima il ciclo non finiva più, l'array cresceva
    // fino a esaurire la memoria e il gioco si bloccava (Nico, 27 novembre 2026: "frizzato, ho dovuto riavviarlo")
    for (let p = b; p !== a; p = prev.get(p)) {
      if (p < 0 || chain.length > P.length) { this.pathBroken++; return []; }
      chain.push(p);
    }
    chain.reverse();
    const stops = chain.map((p) => P[p].anchor);
    if (to !== stops[stops.length - 1]) stops.push(to);
    if (!chain.length && to === start) return [];
    // fuori rete (fra due centri o schierata prima): si rientra dal centro più vicino fra la sua provincia e la prossima,
    // poi solo strade da centro a centro
    if (start !== P[a].anchor && stops[0] !== P[a].anchor && hexDistance(start, P[a].anchor) < hexDistance(start, stops[0])) stops.unshift(P[a].anchor);
    const path: number[] = [];
    let from = start;
    for (const w of stops) {
      if (w === from) continue;
      const seg = straightPath(from, w, ok); // lungo la strada dritta fra i due centri, come la rete disegnata
      if (!seg.length) return findPath(start, to, ok, 8000);
      path.push(...seg);
      from = w;
    }
    return path;
  }

  /** Ordine del giocatore: la pedina lascia il fronte assegnato e va dove le dici. */
  command(u: Unit, to: number): boolean {
    if (u.fresh) u.fresh = false;
    // un ordine tuo chiude "attacca da sola" (Nico: dopo attacca nazione, anche fermate, continuavano ad attaccare)
    u.stance = 'tieni';
    u.squad = -1;
    u.front = -1;
    u.zone = -1; u.chase = -1;
    u.post = -1;
    u.goal = -1;
    return this.order(u, to);
  }

  /** Percorso che farebbe la pedina fino a `to` (anteprima sulla mappa), vuoto se irraggiungibile. */
  previewPath(u: Unit, to: number): number[] {
    if (isNaval(u.type)) return this.map.tiles[to] ? [] : findPath(u.tile, to, (i) => i >= 0 && !this.map.tiles[i]);
    return this.landPath(u, this.stopOf(to));
  }

  /** Comportamento: tieni la posizione oppure attacca da sola i nemici vicini. */
  setStance(units: Unit[], stance: Stance) {
    // via anche la squadra vecchia: prima chi passava a "tieni" faceva aspettare le compagne fino a 6 s
    for (const u of units) { u.stance = stance; u.fresh = false; if (stance === 'tieni') u.squad = -1; u.lastOrderMs = this.gameTimeMs - BALANCE.unitOps.autoEveryMs; }
  }

  /** Assegna le pedine al confine con una fazione: si dispongono lungo la linea (e la spingono se attaccano da sole). */
  assignFront(units: Unit[], faction: number, attack = false): boolean {
    if (faction < 0 || faction === PLAYER || !this.factions[faction]?.alive) return false;
    // attacca nazione anche senza confine via terra (isole, nazioni oltre il mare): ci si va con l'imbarco
    if (!attack && !this.frontLine(PLAYER, faction).length) return false;
    for (const u of units) if (!isNaval(u.type)) { u.front = faction; u.zone = -1; u.chase = -1; u.post = -1; u.goal = -1; u.lastOrderMs = this.gameTimeMs - BALANCE.unitOps.autoEveryMs; }
    if (units.length) this.chron({ k: 'attack', a: faction, b: PLAYER, n: units.reduce((n, u) => n + u.size, 0) });
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
      u.zone = -1; u.chase = -1;
      u.goal = -1;
      u.stance = 'tieni'; // in linea tiene il posto: niente più "attacca da sola" rimasto da un attacco a nazione
      u.squad = -1;
      u.post = posts[k];
      if (u.tile === u.post || this.order(u, u.post, true)) n++;
    });
    return n;
  }

  /**
   * Offensiva alla HOI4 (freccia): ogni pedina riceve la sua casella d'arrivo e ci avanza insieme alle altre, fermandosi ad
   * assediare le province nemiche che incontra; arrivata, tiene la nuova posizione. Ritorna quante sono partite.
   */
  pushOffensive(units: Unit[], goals: number[], vias: number[][] = []): number {
    let n = 0;
    units.forEach((u, k) => {
      if (isNaval(u.type) || k >= goals.length || goals[k] < 0) return;
      u.front = -1;
      u.zone = -1; u.chase = -1;
      u.post = -1;
      u.stance = 'tieni'; // arrivata in fondo alla freccia tiene, non riparte da sola
      u.squad = -1;
      u.goal = goals[k];
      u.via = [...(vias[k] ?? [])];
      u.resting = false; // freccia tua: parte anche se ferita (prima tornava subito a curarsi e sembrava non partire)
      u.orderHp = u.hp;
      if (this.orderVia(u, true)) n++;
      else { u.goal = -1; u.via = []; }
    });
    return n;
  }

  /**
   * Marcia d'offensiva lungo la freccia (Nico: "segua meglio la freccia"): il percorso passa dalle tappe rimaste, una dopo
   * l'altra, fino alla casella d'arrivo. Alla ripartenza (dopo un assedio) si saltano le tappe già superate: vicine, o più
   * lontane dalla successiva di quanto lo sia la pedina; una tappa irraggiungibile si salta.
   */
  private orderVia(u: Unit, first = false): boolean {
    const via = u.via ?? [];
    while (via.length && (hexDistance(u.tile, via[0]) <= 1 || !first && hexDistance(u.tile, via[1] ?? u.goal) < hexDistance(via[0], via[1] ?? u.goal))) via.shift();
    const ok = (i: number) => this.passable(i) && this.atWar(u.owner, this.owner[i]) || this.owner[i] === u.owner;
    const path: number[] = [];
    let from = u.tile;
    u.goal = this.stopOf(u.goal);
    for (const w of [...via, u.goal].map((x) => this.stopOf(x))) {
      const seg = this.landPath(u, w, from); // da centro a centro lungo la rete, anche fra una tappa e l'altra
      if (!seg.length) continue;
      path.push(...seg);
      from = w;
    }
    void ok;
    if (from !== u.goal) return this.order(u, u.goal); // l'arrivo non si raggiunge dalle tappe: strada più corta
    this.setPath(u, path);
    u.lastOrderMs = this.gameTimeMs;
    return path.length > 0;
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
  /** Un passo di attacca nazione (o delle regioni scelte) per una pedina: si divide in gruppetti da G, prende il bersaglio
   *  più vicino con posto e ci va. false se non c'è bersaglio. */
  private planFail = new Map<number, { n: number; at: number }>(); // provincia bersaglio → tentativi falliti di fila, ultimo
  /** Province della zona che le pedine vanno ancora a prendere (le stesse del loro piano): solo queste si disegnano. */
  zoneTargets(z: number): number[] {
    return (this.zones.get(z) ?? []).filter((p) => {
      const o = this.provOwner[p];
      return o !== PLAYER && this.provPassable(p) && (o === NEUTRAL || this.atWar(PLAYER, o)) && !this.unreachable(p);
    });
  }

  private unreachable(p: number): boolean {
    const f = this.planFail.get(p);
    if (!f) return false;
    if (this.gameTimeMs - f.at > BALANCE.aiUnits.badTargetMs) { this.planFail.delete(p); return false; }
    return f.n >= 3;
  }

  private planStep(u: Unit, pl: { targets: Set<number>; G: number; cnt: Map<number, number>; valid?: Set<number> }): boolean {
    const provs = this.map.provinces, G = pl.G;
    // pedina grossa (divisione da 70...): si divide in gruppetti da G reparti sulla sua casella, così si sparge sul
    // confine; con un confine stretto i gruppetti sono più grossi (Nico: "si divide nel modo più efficiente")
    if ((u.band ?? -1) < 0) while (u.size > G) this.splitOff(u, G); // un gruppetto resta intero
    // bersaglio: il più vicino con posto; le province nemiche entrate nel tuo territorio (circondate dalle tue) contano
    // come più vicine, così si chiudono prima gli sfondamenti; il bersaglio di adesso pesa meno (niente cambi a vuoto)
    const cur = (u.squad ?? -1) >= 0 && (pl.valid ?? pl.targets).has(u.squad!) ? u.squad! : -1;
    if (cur >= 0) pl.cnt.set(cur, (pl.cnt.get(cur) ?? 0) - u.size);
    let best = -1, bd = Infinity, least = -1, lc = Infinity, ld = Infinity, breach = -1, brd = Infinity;
    for (const q of pl.targets) {
      const nb = provs[q].neighbors, mine = nb.filter((r) => this.provOwner[r] === PLAYER).length / Math.max(1, nb.length);
      const raw = hexDistance(provs[q].anchor, u.tile), d = raw * (1 - 0.6 * mine), c = pl.cnt.get(q) ?? 0;
      if (c + u.size <= G && d < bd) { bd = d; best = q; }
      if (c < lc || c === lc && d < ld) { lc = c; ld = d; least = q; }
      if (mine >= 0.6 && c === 0 && raw < brd) { brd = raw; breach = q; } // sfondamento nel tuo territorio, scoperto
    }
    // bersaglio già valido: lo si tiene finché non è preso (Nico: "rimbalzano avanti e indietro": ricalcolando ogni 1,5 s
    // una pedina perdeva il posto e ne prendeva un altro, poi tornava). Si cambia solo per uno sfondamento molto più vicino
    const t = cur >= 0 ? (breach >= 0 && brd * 2 < hexDistance(provs[cur].anchor, u.tile) ? breach : cur) : best >= 0 ? best : least;
    if (t >= 0) {
      pl.cnt.set(t, (pl.cnt.get(t) ?? 0) + u.size);
      if (t !== cur || !u.path.length && this.provOf(u.tile) !== t) {
        // bersaglio che non si raggiunge: dopo 3 tentativi falliti esce dal piano per 30 s (prima si riprovava per sempre)
        if (this.order(u, provs[t].anchor)) this.planFail.delete(t);
        else { const f = this.planFail.get(t); this.planFail.set(t, { n: (f?.n ?? 0) + 1, at: this.gameTimeMs }); }
        u.squad = t; u.waitMs = 0;
      }
      return true;
    }
    return false;
  }

  /** Gruppetto compatto (Nico, 27 novembre 2026: "3 ingegneri, 2 carri, che posso mandare compatti"): le pedine si
   *  raccolgono sul capo (la più vecchia) e da lì vanno come un blocco, al passo della più lenta, sulla sua strada. Gli
   *  ordini li prende il capo. Ritorna l'id del gruppo, −1 se meno di due pedine di terra. */
  private nextBandId = 1;
  makeBand(units: Unit[]): number {
    const land = units.filter((u) => u.owner === PLAYER && !isNaval(u.type)).sort((a, b) => a.id - b.id);
    if (land.length < 2) { for (const u of land) u.band = -1; return -1; }
    const id = this.nextBandId++, lead = land[0];
    // le altre lasciano anche riposo e "attacca da sola": sciolto il gruppetto non partono a caccia per conto loro
    for (const u of land) { u.band = id; if (u !== lead) { u.front = -1; u.zone = -1; u.chase = -1; u.post = -1; u.goal = -1; u.squad = -1; u.resting = false; u.stance = 'tieni'; u.fresh = false; } }
    this.bandTick = -1;
    return id;
  }

  /** Capo del gruppetto della pedina (la più vecchia ancora viva), o la pedina stessa. */
  private bandLeads = new Map<number, Unit>();
  private bandSlow = new Map<number, number>(); // gruppetto → passo base del reparto più lento
  private bandTick = -1;
  private bandWait = new Map<number, { gap: number; idle: number }>(); // gruppetto → distanza della più lontana, ms da quando non si avvicina
  bandLeader(u: Unit): Unit {
    if ((u.band ?? -1) < 0) return u;
    if (this.bandTick !== this.gameTimeMs) {
      this.bandTick = this.gameTimeMs;
      this.bandLeads.clear();
      this.bandSlow.clear();
      for (const v of this.units) {
        const b = v.band ?? -1;
        if (b < 0 || v.hp <= 0) continue;
        const l = this.bandLeads.get(b);
        if (!l || v.id < l.id) this.bandLeads.set(b, v);
        this.bandSlow.set(b, Math.max(this.bandSlow.get(b) ?? 0, BALANCE.units[v.type].moveMs));
      }
    }
    return this.bandLeads.get(u.band!) ?? u;
  }

  /** Divide le pedine in pezzi da al massimo `size` reparti sulla loro casella (linea, Nico 27 novembre 2026: "le truppe si
   *  dividono come in attacca nazione"). Ritorna gli id di tutti i pezzi, le pedine di partenza comprese. */
  divide(units: Unit[], size: number): number[] {
    const G = Math.max(1, Math.floor(size)), out: number[] = [];
    for (const u of units) {
      out.push(u.id);
      if (isNaval(u.type) || (u.band ?? -1) >= 0) continue; // un gruppetto resta intero
      while (u.size > G) out.push(this.splitOff(u, G).id);
    }
    return out;
  }

  /** Reparti di una pedina, gruppetto intero se è il capo. */
  bandSize(u: Unit): number {
    if ((u.band ?? -1) < 0) return u.size;
    let n = 0;
    for (const v of this.units) if (v.band === u.band && v.hp > 0) n += v.size;
    return n;
  }

  /** Divide le pedine (in ordine lungo la linea) in pezzi che riempiono le quote una dopo l'altra: con 10 reparti e quote
   *  3, 2, 3, 2 si fanno proprio quei pezzi (prima pezzi tutti uguali da 2: uno in più finiva sulla prima provincia). Un
   *  gruppetto resta intero. Ritorna gli id dei pezzi nello stesso ordine. */
  divideQuotas(units: Unit[], quotas: number[]): number[] {
    const out: number[] = [];
    let q = 0, cum = 0, edge = quotas[0] ?? Infinity;
    const next = () => { while (q < quotas.length && cum >= edge) edge += quotas[++q] ?? Infinity; };
    for (const u of units) {
      if (!isNaval(u.type) && (u.band ?? -1) < 0) {
        while (u.size > edge - cum && edge - cum > 0) { const v = this.splitOff(u, edge - cum); out.push(v.id); cum += v.size; next(); }
      }
      out.push(u.id);
      cum += this.bandSize(u);
      next();
    }
    return out;
  }

  /** Stacca `n` reparti da una pedina, sulla stessa casella e con gli stessi ordini. */
  private splitOff(u: Unit, n: number): Unit {
    const share = n / u.size;
    const v: Unit = { ...u, id: this.nextUnitId++, path: [], moveAcc: 0, inCombat: false, size: n, hp: u.hp * share, maxHp: u.maxHp * share, via: [], squad: -1, waitMs: 0, band: -1 };
    u.size -= n; u.hp -= v.hp; u.maxHp -= v.maxHp;
    this.units.push(v);
    return v;
  }

  /** Regioni scelte (Nico, 27 novembre 2026, al posto della freccia): le pedine si dividono le province come in attacca
   *  nazione e le prendono, poi tengono dove hanno vinto. Ritorna quante pedine partono. */
  zones = new Map<number, number[]>();
  private nextZoneId = 1;
  zoneAttack(units: Unit[], provs: number[]): number {
    const land = units.filter((u) => !isNaval(u.type));
    const ok = provs.filter((p) => p >= 0 && this.map.provinces[p]?.anchor >= 0 && this.provPassable(p) && this.provOwner[p] !== PLAYER
      && (this.provOwner[p] === NEUTRAL || this.atWar(PLAYER, this.provOwner[p])));
    if (!land.length || !ok.length) return 0;
    const id = this.nextZoneId++;
    this.zones.set(id, [...new Set(ok)]);
    this.chron({ k: 'zone', a: PLAYER, b: -1, n: this.zones.get(id)!.length });
    for (const u of land) {
      u.zone = id; u.front = -1; u.post = -1; u.goal = -1; u.squad = -1; u.stance = 'tieni'; u.resting = false; u.fresh = false;
      u.orderHp = u.hp;
      this.setPath(u, []);
      u.lastOrderMs = this.gameTimeMs - BALANCE.unitOps.autoEveryMs;
    }
    return land.length;
  }

  /** Attacco diretto: le pedine inseguono una pedina nemica (in guerra) finché muore o sparisce, poi tengono dove sono. */
  chaseUnit(units: Unit[], target: number): number {
    const t = this.units.find((v) => v.id === target && v.hp > 0);
    if (!t || t.owner === PLAYER || !this.atWar(PLAYER, t.owner)) return 0;
    let n = 0;
    for (const u of units) {
      if (isNaval(u.type)) continue;
      u.front = -1; u.post = -1; u.goal = -1; u.zone = -1; u.squad = -1; u.stance = 'tieni'; u.resting = false; u.fresh = false;
      u.chase = target;
      u.orderHp = u.hp;
      if (this.order(u, t.tile)) n++;
    }
    return n;
  }

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
      path: [], moveAcc: 0, inCombat: false, lastOrderMs: this.gameTimeMs, size: k, stance: u.stance, front: u.front, supply: u.supply, post: u.post, goal: u.goal, via: u.via && [...u.via],
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
      u.zone = -1; u.chase = -1;
      u.post = -1;
      u.goal = -1;
      u.stance = 'tieni';
      u.squad = -1;
      if (tile === u.tile || this.order(u, tile, true)) n++;
    }
    return n;
  }

  /** Rifornimento della pedina: quello della provincia se è tua, poco fuori dal confine cala, lontano finisce. */
  private unitSupply(u: Unit): number {
    const r = BALANCE.units[u.type].res;
    const short = u.owner === PLAYER ? this.unpaid[r] : this.aiUnpaid[u.owner * 3 + RESOURCE_KEYS.indexOf(r)] === 1;
    const paid = short ? BALANCE.upkeep.unpaidSupply : 1; // mantenimento non pagato
    return this.baseUnitSupply(u) * paid;
  }

  /**
   * Ammasso fuori dal tuo territorio (Nico, 27 novembre 2026: in casa si ammassa per organizzarsi, niente calo): oltre il
   * limite della provincia il gruppo colpisce meno e va più piano, senza perdere vita. Ritorna quante volte il limite (≥ 1).
   */
  private stackOver(u: Unit): number {
    const p = this.provOf(u.tile);
    if (p < 0 || this.provOwner[p] === u.owner) return 1;
    const n = this.stackLoad.get(p * 1024 + u.owner) ?? 0;
    const cap = this.depotNear(p, u.owner) ? BALANCE.upkeep.stackCapDepot : BALANCE.upkeep.stackCap;
    return n > cap ? n / cap : 1;
  }

  /** Reparti per provincia e padrone (rifatto a ogni tick): per il limite degli ammassi. */
  private stackLoad = new Map<number, number>();

  /** Un deposito pronto di `f` in questa provincia o accanto. */
  private depotNear(p: number, f: number): boolean {
    const dep = WORKS.indexOf('rifornimenti'), ok = (q: number) => this.provOwner[q] === f && this.provWork[q] === dep && this.provWorkAt[q] === 0;
    return ok(p) || this.map.provinces[p].neighbors.some(ok);
  }

  private baseUnitSupply(u: Unit): number {
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
    // zone rimaste senza pedine (ordine cambiato): via (prima restavano per sempre)
    if (this.zones.size) {
      const live = new Set<number>();
      for (const u of this.units) if ((u.zone ?? -1) >= 0) live.add(u.zone!);
      for (const z of [...this.zones.keys()]) if (!live.has(z)) this.zones.delete(z);
      // province della zona già prese: escono per sempre (Nico, 26 novembre 2026: "a conquista finita certi territori già
      // tuoi restano azzurri e le truppe vanno avanti e indietro"; prima una provincia ripresa dal nemico alle spalle tornava
      // bersaglio e il gruppo tornava indietro)
      for (const [z, ps] of this.zones) if (ps.some((p) => this.provOwner[p] === PLAYER)) this.zones.set(z, ps.filter((p) => this.provOwner[p] !== PLAYER));
    }
    const lines = new Map<number, number[]>();
    const posts = new Map<number, Set<number>>(); // fronte → province già presidiate
    // attacca nazione, piano per nemico (rifatto a ogni passata, Nico: "si deve aggiornare continuamente, come la linea"):
    // province bersaglio = le sue che toccano il tuo territorio (anche quelle entrate dentro, che ti tagliano fuori), reparti
    // per bersaglio = tutti i reparti dell'attacco divisi sui bersagli (mai meno di `attackGroup`), quanti ce ne vanno già
    const plans = new Map<number, { targets: Set<number>; G: number; cnt: Map<number, number> }>();
    const planOf = (enemy: number) => {
      let pl = plans.get(enemy);
      if (pl) return pl;
      const targets = new Set<number>();
      for (const p of this.frontLine(PLAYER, enemy)) for (const q of provs[p].neighbors) if (this.provOwner[q] === enemy && !this.unreachable(q)) targets.add(q);
      // nessuna sua provincia attaccata alle tue (isole, terre oltre il mare, il resto dopo aver preso il continente): tutte
      // le sue province raggiungibili, ogni pedina va alla più vicina (Nico, 28 novembre 2026: "attacchi una nazione e
      // un'isola non la fa")
      if (!targets.size) for (const q of this.ownedProvinces(enemy)) if (this.provPassable(q) && !this.unreachable(q)) targets.add(q);
      const us = this.units.filter((v) => v.owner === PLAYER && v.front === enemy && v.stance === 'attacca' && !v.resting);
      const total = us.reduce((n, v) => n + v.size, 0), cnt = new Map<number, number>();
      for (const v of us) if ((v.squad ?? -1) >= 0 && targets.has(v.squad!)) cnt.set(v.squad!, (cnt.get(v.squad!) ?? 0) + v.size);
      pl = { targets, G: Math.max(O.attackGroup, Math.ceil(total / Math.max(1, targets.size))), cnt };
      plans.set(enemy, pl);
      return pl;
    };
    // regioni scelte: stesso piano, bersagli = le province della zona non ancora tue (si aggiornano a ogni passata)
    const zplans = new Map<number, { targets: Set<number>; G: number; cnt: Map<number, number>; valid?: Set<number> }>();
    const zoneOf = (z: number) => {
      let pl = zplans.get(z);
      if (pl) return pl;
      const targets = new Set<number>(), far: number[] = [], valid = new Set<number>();
      for (const p of this.zones.get(z) ?? []) {
        const o = this.provOwner[p];
        if (o === PLAYER || !this.provPassable(p) || o !== NEUTRAL && !this.atWar(PLAYER, o) || this.unreachable(p)) continue;
        valid.add(p);
        // terra vuota: si esplora dal tuo confine in fuori, prima le province attaccate alle tue (Nico, 27 novembre 2026:
        // "se fatto su province vuote, esplora quelle più vicine"); quelle più in là entrano quando le prime sono prese
        if (o === NEUTRAL && !provs[p].neighbors.some((q) => this.provOwner[q] === PLAYER)) far.push(p);
        else targets.add(p);
      }
      if (!targets.size) for (const p of far) targets.add(p); // niente attaccato al confine (zona oltre il mare): tutte
      const us = this.units.filter((v) => v.owner === PLAYER && v.zone === z && !v.resting);
      const total = us.reduce((n, v) => n + v.size, 0), cnt = new Map<number, number>();
      for (const v of us) if ((v.squad ?? -1) >= 0 && valid.has(v.squad!)) cnt.set(v.squad!, (cnt.get(v.squad!) ?? 0) + v.size);
      // terra vuota: nessuno da battere, basta poco per provincia. Senza il minimo da attacco le pedine si spargono su più
      // province insieme (Nico, 27 novembre 2026: "considerano la zona vuota come attacco e si spreadano bene")
      const empty = [...targets].every((p) => this.provOwner[p] === NEUTRAL);
      // `valid`: tutte le province della zona ancora da prendere. Una pedina tiene il suo bersaglio finché è fra queste, anche
      // se intanto le "vicine al confine" sono cambiate (Nico, 28 novembre 2026: "vanno avanti e indietro, sembrano indecise":
      // presa una provincia, le lontane uscivano dai bersagli e chi ci andava tornava indietro)
      pl = { targets, G: Math.max(empty ? 1 : O.attackGroup, Math.ceil(total / Math.max(1, targets.size))), cnt, valid };
      zplans.set(z, pl);
      return pl;
    };
    for (const u of this.unitsOf(PLAYER)) {
      if (this.bandLeader(u) !== u) continue; // nel gruppetto decide il capo, le altre lo seguono
      // l'offensiva riparte subito dopo un assedio (prima aspettava 1,5 s e sembrava fermarsi a metà freccia)
      const wait = u.goal >= 0 ? 0 : O.autoEveryMs;
      // chi attacca una nazione si ricontrolla anche mentre cammina: il fronte cambia (sfondamenti alle spalle, bersaglio già preso)
      const onFront = (u.front >= 0 && u.stance === 'attacca' || (u.zone ?? -1) >= 0 || (u.chase ?? -1) >= 0) && !u.resting;
      if (isNaval(u.type) || u.path.length && !onFront || this.gameTimeMs - u.lastOrderMs < wait || this.battles.some((b) => b.unit === u.id)) continue;
      u.lastOrderMs = this.gameTimeMs;
      // reparto appena schierato che ha ricevuto un fronte, una linea o un'offensiva: fa quello, non avanza più da solo
      if (u.fresh && (u.front >= 0 || u.post >= 0 || u.goal >= 0)) { u.fresh = false; u.stance = 'tieni'; }
      const attack = u.stance === 'attacca';
      // ferita in attacco: si ferma, torna nel tuo territorio più vicino e si cura; riprende quando la vita è risalita
      const attacking = u.goal >= 0 || u.front >= 0 && attack || (u.zone ?? -1) >= 0;
      // la vita di quando è partita conta anche per le regioni (prima una ferita mandata su una regione tornava subito indietro)
      if (attacking && !u.resting && u.hp < u.maxHp * O.restBelow && u.hp < (u.goal >= 0 || (u.zone ?? -1) >= 0 ? u.orderHp ?? Infinity : Infinity) * 0.7) {
        u.resting = true;
        u.squad = -1; // esce dalla squadra: le altre non la aspettano
        u.restHp = u.hp; u.restAt = this.gameTimeMs;
        const home = this.restHome(u.tile);
        if (home >= 0 && home !== u.tile) this.order(u, home, true);
        continue;
      }
      if (u.resting) {
        if (attacking && u.hp < u.maxHp * O.restUntil) {
          // non guarisce da 30 s (fronte, poco rifornimento): cerca un altro posto (prima restava ferma per sempre)
          if (u.hp > (u.restHp ?? 0) + 0.01) { u.restHp = u.hp; u.restAt = this.gameTimeMs; }
          else if (!u.path.length && this.gameTimeMs - (u.restAt ?? 0) > 30_000) {
            u.restAt = this.gameTimeMs;
            const home = this.restHome(u.tile);
            if (home >= 0 && home !== u.tile) this.order(u, home, true);
          }
          continue;
        }
        u.resting = false;
      }
      if ((u.chase ?? -1) >= 0) {
        // insegue: se la preda è morta o non si vede più, tiene dove è; altrimenti si rimette sulla sua strada
        const t = this.units.find((v) => v.id === u.chase && v.hp > 0);
        if (!t || !this.atWar(PLAYER, t.owner) || !this.seesUnit(t)) {
          u.chase = -1;
          u.post = this.provOwner[this.provOf(u.tile)] === PLAYER ? this.stopOf(u.tile) : -1;
          continue;
        }
        if (hexDistance(u.tile, t.tile) > BALANCE.units[u.type].range && (!u.path.length || u.path[u.path.length - 1] !== this.stopOf(t.tile))) this.order(u, t.tile);
        continue;
      }
      if ((u.zone ?? -1) >= 0) {
        const pl = zoneOf(u.zone!);
        if (!pl.targets.size) {
          // zona presa (o non più raggiungibile): tiene dove ha vinto
          const z = u.zone!;
          u.zone = -1; u.chase = -1; u.squad = -1; u.post = this.provOwner[this.provOf(u.tile)] === PLAYER ? this.stopOf(u.tile) : this.nearestOwnAnchor(u.tile);
          if (!this.units.some((v) => v.zone === z)) this.zones.delete(z);
          continue;
        }
        this.planStep(u, pl);
        continue;
      }
      if (u.goal >= 0) {
        // offensiva: arrivata, tiene la nuova posizione; altrimenti riprende la marcia (dopo un assedio o se bloccata)
        // il posto è il centro della provincia (le pedine stanno lì): prima era la casella, e la pedina andata al centro
        // ricercava la strada per tornarci ogni 1,5 s
        if (u.tile === u.goal || hexDistance(u.tile, u.goal) <= 1) { u.post = this.stopOf(u.tile); u.goal = -1; }
        else if (!this.orderVia(u)) { u.post = this.stopOf(u.tile); u.goal = -1; u.via = []; }
        continue;
      }
      if (u.post >= 0) {
        // linea d'attacco: torna al suo posto se ne è uscita (o se la strada si è aperta solo ora)
        if (u.tile !== u.post) this.order(u, u.post, true);
        continue;
      }
      if (u.front >= 0) {
        const enemy = u.front;
        // nazione caduta: operazione finita, la pedina si ferma dove sta e tiene (Nico: "quando finiscono impazziscono e
        // continuano ad attaccare": restava "attacca da sola" e puntava il primo nemico vicino)
        if (!this.factions[enemy]?.alive) { u.front = -1; u.stance = 'tieni'; u.squad = -1; const h = this.nearestOwnAnchor(u.tile); u.post = h >= 0 ? h : this.stopOf(u.tile); continue; }
        if (!lines.has(enemy)) { lines.set(enemy, this.frontLine(PLAYER, enemy)); posts.set(enemy, new Set()); }
        const line = lines.get(enemy)!, taken = posts.get(enemy)!;
        if (attack && this.atWar(PLAYER, enemy)) {
          if (this.planStep(u, planOf(enemy))) continue;
        }
        if (!line.length) continue;
        // tieni la linea: la provincia di confine libera più vicina (una pedina per provincia finché bastano)
        const here = this.provOf(u.tile);
        if (line.includes(here) && !taken.has(here)) { taken.add(here); continue; }
        const free = line.filter((p) => !taken.has(p));
        const pool = free.length ? free : line;
        const p = pool.reduce((a, b) => (hexDistance(provs[a].anchor, u.tile) <= hexDistance(provs[b].anchor, u.tile) ? a : b));
        taken.add(p);
        const tile = provs[p].tiles.find((i) => this.owner[i] === PLAYER && !this.unitAt(i)) ?? -1;
        if (tile >= 0) this.order(u, tile, true);
        continue;
      }
      if (!attack) {
        // senza ordini, ferita e mal rifornita: va da sola nella tua provincia rifornita più vicina (Nico: "mi sono morte 20
        // truppe a stare lì a far niente")
        // solo dentro il tuo territorio e verso una provincia vicina: una testa di sbarco resta dove l'hai mandata (Nico: in
        // Portogallo "rimbalzano subito indietro", tornavano attraverso l'oceano)
        if (u.supply < O.driftBelow && u.hp < u.maxHp * 0.95 && this.owner[u.tile] === PLAYER) {
          let best = -1, bd = O.driftMaxHex + 1;
          for (const q of this.owned[PLAYER] ?? []) {
            if (this.supply[q] < O.healMinSupply + 0.2) continue;
            const d = hexDistance(provs[q].anchor, u.tile);
            if (d < bd) { bd = d; best = q; }
          }
          if (best >= 0 && this.order(u, provs[best].anchor, true)) u.lastOrderMs = this.gameTimeMs;
        }
        continue;
      }
      // attacca da sola: prima le pedine nemiche vicine, poi le province in guerra più vicine
      let target = -1, bd = O.autoRadius + 1;
      for (const v of this.units) {
        if (v.owner === PLAYER || !this.atWar(PLAYER, v.owner) || !this.seesUnit(v)) continue;
        const d = hexDistance(u.tile, v.tile);
        if (d < bd) { bd = d; target = v.tile; }
      }
      if (target < 0) {
        for (const p of this.frontier(PLAYER)) {
          if (this.provOwner[p] === NEUTRAL || this.battleAt(p) || !this.atWar(PLAYER, this.provOwner[p])) continue;
          const d = hexDistance(provs[p].anchor, u.tile);
          if (d < bd) { bd = d; target = provs[p].anchor; }
        }
      }
      if (target >= 0) this.order(u, target);
    }
  }

  /** Centro della tua provincia più vicina a una casella (la sua se è già tua), −1 se non ne hai. */
  /** Dove si cura una pedina ferita: la tua provincia più vicina rifornita e senza nemici in guerra accanto (come la
   *  ritirata); se non ce n'è, la tua provincia più vicina. */
  private restHome(i: number): number {
    const provs = this.map.provinces;
    let best = -1, bd = Infinity;
    for (const q of this.owned[PLAYER] ?? []) {
      const a = provs[q].anchor;
      if (a < 0 || this.supply[q] < BALANCE.unitOps.healMinSupply) continue;
      const d = hexDistance(a, i);
      if (d >= bd || provs[q].neighbors.some((n) => { const o = this.provOwner[n]; return o !== PLAYER && o !== NEUTRAL && this.atWar(PLAYER, o); })) continue;
      bd = d; best = a;
    }
    return best >= 0 ? best : this.nearestOwnAnchor(i);
  }

  nearestOwnAnchor(i: number): number {
    const provs = this.map.provinces, p = this.provOf(i);
    if (p >= 0 && this.provOwner[p] === PLAYER) return provs[p].anchor;
    let best = -1, bd = Infinity;
    for (const q of this.owned[PLAYER] ?? []) {
      const d = hexDistance(provs[q].anchor, i);
      if (d < bd) { bd = d; best = provs[q].anchor; }
    }
    return best;
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
    // pedine in secchi di 8×8 caselle: si guardano solo i secchi vicini (gittata massima 6), non tutte le 300 pedine
    const CELL = 8, buckets = new Map<number, Unit[]>(), keyOf = (c: number, r: number) => r * 4096 + c;
    for (const u of this.units) {
      const k = keyOf(Math.floor(colOf(u.tile) / CELL), Math.floor(rowOf(u.tile) / CELL));
      const b = buckets.get(k);
      if (b) b.push(u); else buckets.set(k, [u]);
    }
    const out: Unit[] = []; // riusato: niente array nuovi per ogni pedina
    const nearby = (u: Unit): Unit[] => {
      const c = Math.floor(colOf(u.tile) / CELL), r = Math.floor(rowOf(u.tile) / CELL);
      out.length = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const b = buckets.get(keyOf(c + dc, r + dr)); if (b) for (const v of b) out.push(v); }
      return out;
    };
    for (const u of this.units) {
      let target: Unit | null = null, best = -1;
      const near = nearby(u);
      for (const v of near) {
        if (v.owner === u.owner || !this.atWar(u.owner, v.owner) || hexDistance(u.tile, v.tile) > U[u.type].range) continue; // in pace non si spara
        const m = rps(u.type, v.type);
        if (m > best) {
          best = m;
          target = v;
        }
      }
      // ferma chi spara e chi ha un nemico a contatto; il tiro da lontano (artiglieria, navi) colpisce ma non inchioda
      // (Nico, 27 novembre 2026: "l'artiglieria blocca i nemici mentre li spara")
      u.inCombat = !!target || near.some((v) => v.owner !== u.owner && this.atWar(u.owner, v.owner) && hexDistance(u.tile, v.tile) <= 1);
      const OP = BALANCE.unitOps, lowSup = u.supply >= OP.healMinSupply ? 1 : OP.lowSupplyAttack + (1 - OP.lowSupplyAttack) * Math.max(0, u.supply) / OP.healMinSupply; // senza rifornimento si colpisce meno
      const crowd = Math.max(BALANCE.upkeep.stackMinAttack, 1 - BALANCE.upkeep.stackAttackLoss * (this.stackOver(u) - 1)); // ammasso: colpisce meno
      const atk = U[u.type].attack * u.size * lowSup * crowd * (u.owner === PLAYER ? this.opts.mods.unitAttackMult * (this.opts.unitBoost?.[u.type]?.atk ?? 1) : 1); // munizioni perforanti, potenziamenti dell'Arsenale, reparti uniti
      if (target) {
        dmg.set(target, (dmg.get(target) ?? 0) + atk * best);
        this.events.push({ type: 'hit', from: u.id, to: target.id, fromTile: u.tile, toTile: target.tile, dmg: atk * best, owner: u.owner });
      }
    }
    for (const [v, d] of dmg) v.hp -= d;
    this.removeDead();

    // ammassi: reparti per provincia e padrone
    this.stackLoad.clear();
    for (const u of this.units) { const p = this.provOf(u.tile); if (p >= 0) this.stackLoad.set(p * 1024 + u.owner, (this.stackLoad.get(p * 1024 + u.owner) ?? 0) + u.size); }
    // squadre d'attacco: passo del reparto più lento e componenti (per aspettarsi sul confine)
    this.squadPace.clear();
    const squads = new Map<number, Unit[]>();
    for (const u of this.units) {
      if (u.owner !== PLAYER || u.squad === undefined || u.squad < 0 || u.hp <= 0) continue;
      this.squadPace.set(u.squad, Math.max(this.squadPace.get(u.squad) ?? 0, BALANCE.units[u.type].moveMs));
      const g = squads.get(u.squad);
      if (g) g.push(u); else squads.set(u.squad, [u]);
    }
    // 2. movimento, conquista di ciò che si calpesta, cura in casa
    // chi assedia e chi sta su ogni casella, una volta per tick (prima per ogni passo si scorrevano tutte le pedine e tutti
    // gli assedi: con 600 pedine il movimento era la parte più cara del motore)
    const sieging = new Set<number>();
    for (const b of this.battles) if (b.unit !== undefined) sieging.add(b.unit);
    const occ = new Map<number, Unit[]>();
    for (const v of this.units) { const l = occ.get(v.tile); if (l) l.push(v); else occ.set(v.tile, [v]); }
    // gruppetti: chi è già sul capo (o accanto) va con lui, passo per passo, sulla sua strada; chi è lontano lo raggiunge;
    // il capo aspetta finché le lontane si avvicinano; smette se per squadWaitMs nessuna si avvicina più (bloccata)
    const joined = new Set<Unit>(), gathering = new Map<number, number>(); // gruppetto → distanza della più lontana
    for (const u of this.units) {
      const L = this.bandLeader(u);
      if (L === u || u.hp <= 0) continue;
      const d = hexDistance(u.tile, L.tile);
      if (d <= 1) joined.add(u);
      else {
        gathering.set(u.band!, Math.max(gathering.get(u.band!) ?? 0, d));
        // nuova strada solo quando il capo cambia provincia: prima ogni secondo, e ogni volta il passo ripartiva da zero
        if (this.gameTimeMs - u.lastOrderMs >= 1000) {
          // già nella provincia del capo: dritta alla sua casella (il centro può essere a più di una casella dal capo)
          if (this.provOf(u.tile) === this.provOf(L.tile)) { if (!u.path.length) { this.setPath(u, this.landPath(u, L.tile)); u.lastOrderMs = this.gameTimeMs; } }
          else if (!u.path.length || this.provOf(u.path[u.path.length - 1]) !== this.provOf(L.tile)) this.order(u, L.tile);
        }
      }
    }
    for (const b of [...this.bandWait.keys()]) if (!gathering.has(b)) this.bandWait.delete(b); // raccolto: si riparte da zero
    for (const [b, gap] of gathering) {
      const w = this.bandWait.get(b);
      if (!w || gap < w.gap) this.bandWait.set(b, { gap, idle: 0 });
      else { w.gap = gap; w.idle += BALANCE.tick.ms; }
    }
    for (const u of [...this.units]) {
      if (u.hp <= 0) continue;
      if (joined.has(u)) {
        const L = this.bandLeader(u);
        if (u.tile !== L.tile) {
          const from = occ.get(u.tile);
          if (from) { const j = from.indexOf(u); if (j >= 0) from.splice(j, 1); if (!from.length) occ.delete(u.tile); }
          const to = occ.get(L.tile);
          if (to) to.push(u); else occ.set(L.tile, [u]);
          u.tile = L.tile;
        }
        if (u.path.length !== L.path.length || u.path[0] !== L.path[0]) u.path = L.path.slice(); // per il disegno: la sua strada
        u.moveAcc = L.moveAcc;
      } else if ((u.band ?? -1) >= 0 && gathering.has(u.band!) && this.bandLeader(u) === u && u.path.length && (this.bandWait.get(u.band!)?.idle ?? 0) < BALANCE.unitOps.squadWaitMs) {
        // il capo aspetta il gruppo
      } else if (!u.inCombat && u.path.length && !sieging.has(u.id)) { // chi assedia resta fermo
        u.moveAcc += BALANCE.tick.ms;
        // squadra: prima di entrare nella provincia bersaglio aspetta le compagne ancora lontane (al massimo squadWaitMs)
        const sq = u.squad !== undefined && u.squad >= 0 ? squads.get(u.squad) : undefined;
        if (sq && sq.length > 1 && u.moveAcc >= this.stepMs(u) && this.provOf(u.path[0]) === u.squad && this.provOf(u.tile) !== u.squad
          && (u.waitMs ?? 0) < BALANCE.unitOps.squadWaitMs && sq.some((v) => v !== u && this.provOf(v.tile) !== u.squad && hexDistance(v.tile, u.tile) > 2)) {
          u.waitMs = (u.waitMs ?? 0) + BALANCE.tick.ms;
          u.moveAcc = this.stepMs(u);
        } else if (u.moveAcc >= this.stepMs(u)) { // colline e montagne rallentano, la ferrovia accelera
          const next = u.path[0], there = occ.get(next)?.[0];
          // si passa attraverso le pedine amiche e ci si ferma insieme sul centro (pila, alla Call of War), mai attraverso le nemiche
          const blocked = !!there && there.owner !== u.owner;
          // la pace firmata durante la marcia chiude i confini: la pedina si ferma
          if (this.map.tiles[next] && this.owner[next] !== u.owner && !this.atWar(u.owner, this.owner[next]) && !this.allied(u.owner, this.owner[next])) u.path.length = 0;
          else if (!blocked) {
            // ogni passo dura gli stessi tick (prima il resto passava al passo dopo: passi ora di 4 ora di 5 tick, e sullo
            // schermo la pedina accelerava e frenava a ogni casella)
            u.moveAcc = 0;
            const from = occ.get(u.tile);
            if (from) { const j = from.indexOf(u); if (j >= 0) from.splice(j, 1); if (!from.length) occ.delete(u.tile); }
            const to = occ.get(next);
            if (to) to.push(u); else occ.set(next, [u]);
            u.tile = next;
            u.path.shift();
          }
        }
      }
      // rifornimento: sotto la soglia la pedina si logora e non si cura
      const O = BALANCE.unitOps;
      u.supply = this.unitSupply(u);
      // niente logoramento (Nico, 27 novembre 2026: "togli tutto questo danno passivo"): il rifornimento basso rallenta la
      // cura e abbassa il danno, senza togliere vita
      const fed = u.supply > O.healZeroSupply;
      const healK = Math.min(1, (u.supply - O.healZeroSupply) / (O.healMinSupply - O.healZeroSupply)); // cura in proporzione al rifornimento
      if (isNaval(u.type) || !this.map.tiles[u.tile]) {
        // le navi non conquistano: si riparano vicino a una tua costa
        if (!u.inCombat && neighbors(u.tile).some((n) => n >= 0 && this.owner[n] === u.owner)) u.hp = Math.min(u.maxHp, u.hp + U.healPerTick);
      } else if (this.owner[u.tile] !== u.owner && this.atWar(u.owner, this.owner[u.tile])) {
        // alla Call of War: la provincia si prende arrivando al suo centro; prima di arrivarci la pedina ci cammina e basta.
        // Ferma dentro una provincia non sua (ordine finito prima del centro): va al centro.
        const p = this.provOf(u.tile);
        // anche la terra libera si prende sul centro, subito e senza assedio (Nico, 26 novembre 2026: "la conquista
        // succede quando si arriva proprio sul centro"; prima appena ci si entrava)
        if (p >= 0 && this.map.provinces[p].anchor !== u.tile) {
          if (!u.path.length && !u.inCombat && this.map.provinces[p].anchor >= 0 && this.gameTimeMs - u.lastOrderMs > 1000) this.order(u, this.map.provinces[p].anchor);
          continue;
        }
        // in terra libera si avanza senza perdite; nel territorio di qualcuno la pedina si ferma e assedia la provincia
        if (this.provOwner[p] === NEUTRAL) this.transferProvince(u.owner, p, 0, u.id);
        else if (!this.battleAt(p)) this.startBattle(u.owner, p, 0, u.id);
      } else if (!u.inCombat && fed && this.owner[u.tile] === u.owner) {
        // rimpiazzi: la vita recuperata costa truppe del pool (Nico: chi combatte di continuo ha più perdite e più costi)
        const gain = Math.min(u.maxHp - u.hp, U.healPerTick * u.size * this.healMult(u) * healK), f = this.factions[u.owner];
        const pay = gain * BALANCE.upkeep.healTroops; // anche le IA pagano i rimpiazzi
        if (gain > 0 && f.troops >= pay) { u.hp += gain; f.troops -= pay; }
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
        this.setProvOwner(p, NEUTRAL);
        this.provWork[p] = -1; // le costruzioni saltano
        this.markSupply(o);
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

  /** Pedine al massimo di una IA: le milizie poche, gli imperi una in più ogni `aiProvPerUnit` province. */
  private aiUnitCap(f: Faction): number {
    const U0 = BALANCE.units;
    if (f.kind === 'bot') return this.opts.sandbox ? BALANCE.sandboxWorld.botUnits : BALANCE.bots.maxUnits;
    // sandbox con terra libera ancora da prendere: qualche pedina in più per allargarsi
    const rush = this.opts.sandbox && this.gameTimeMs < BALANCE.sandboxWorld.rushMs ? BALANCE.sandboxWorld.rushUnits : 0;
    return Math.min(U0.aiUnitsMax, this.opts.front.maxAiUnits + rush + Math.floor(f.provinces / U0.aiProvPerUnit));
  }

  /** Quanti pezzi un impero mette in una pedina: più truppe in cassa, divisioni più grosse (fino a `divisionMax`). */
  private aiBatch(f: Faction, type: UnitType, room: number): number {
    const A = BALANCE.aiUnits, cost = this.unitCost(f.id, type);
    if (f.kind !== 'empire') return 0;
    return Math.max(1, Math.min(room, Math.floor(f.troops / (cost * A.reserve * A.batchTroops))));
  }

  /** Bersagli che una pedina dell'impero non raggiunge via terra (provincia → quando): non li riprova per un po'. */
  private aiBadTarget = new Map<number, number>();

  /** IA: ogni tanto schiera la sua unità preferita e la manda verso il nemico più vicino (te, di preferenza). */
  private aiUnits(f: Faction) {
    const A = BALANCE.aiUnits;
    const sieging = new Set<number>();
    for (const b of this.battles) if (b.unit !== undefined && b.by === f.id) sieging.add(b.unit);
    for (const u of this.unitsOf(f.id)) {
      if (sieging.has(u.id)) continue; // sta assediando: resta lì (prima segnava la sua provincia come irraggiungibile)
      const idle = this.gameTimeMs - u.lastOrderMs;
      if ((!u.path.length && idle > 1000) || idle > A.repathMs) { // ferma: nuovo bersaglio al massimo una volta al secondo
        // la sua meta attuale non conta come "già presa" da un'altra: prima la saltava e cambiava provincia ogni 6 s
        const mine = u.path.length ? this.provOf(u.path[u.path.length - 1]) : -1;
        const target = this.unitTarget(f, u.tile, mine);
        // stessa meta della strada che ha già: niente nuova ricerca del percorso (la metà del tempo delle IA)
        if (target >= 0 && u.path.length && u.path[u.path.length - 1] === this.stopOf(target)) u.lastOrderMs = this.gameTimeMs;
        else if (target >= 0 && this.stopOf(target) === u.tile) u.lastOrderMs = this.gameTimeMs; // già lì: niente "irraggiungibile"
        else if (target >= 0 && !this.order(u, target) && f.kind === 'empire') this.aiBadTarget.set(f.id * 32768 + this.provOf(target), this.gameTimeMs);
        if (target < 0) u.lastOrderMs = this.gameTimeMs;
      }
    }
    const cap = this.aiUnitCap(f);
    if (this.gameTimeMs < this.aiSpawnAt[f.id]) return;
    if (this.unitsOf(f.id).length >= cap) {
      // al tetto: un impero ricco rinforza la sua pedina più piccola invece di tenere le truppe in cassa
      if (f.kind !== 'empire') return;
      const small = this.unitsOf(f.id).filter((u) => !isNaval(u.type) && u.size < BALANCE.unitOps.divisionMax).sort((a, b) => a.size - b.size || a.id - b.id)[0];
      // si rinforza solo in una sua città (come il giocatore: gli eserciti escono dalle città)
      if (!small || !this.canRecruitAt(this.provOf(small.tile), f.id)) return;
      this.aiSpawnAt[f.id] = this.gameTimeMs + A.spawnEveryMs + (this.aiRng() * 2 - 1) * A.spawnJitterMs;
      this.aiGrow(f, small, this.aiBatch(f, small.type, BALANCE.unitOps.divisionMax - small.size));
      return;
    }
    // sandbox, terra libera al confine (Nico, 26 novembre 2026: "come OpenFront, a 5 minuti tutto preso, ma la terra non si
    // compra: solo pedine"): pedine più spesse e quasi tutte ricognitori, i più veloci a prendere il vuoto
    const SW = BALANCE.sandboxWorld, rush = !!this.opts.sandbox && this.frontier(f.id).some((p) => this.provOwner[p] === NEUTRAL);
    this.aiSpawnAt[f.id] = this.gameTimeMs + (rush ? SW.rushSpawnMs : A.spawnEveryMs) + (this.aiRng() * 2 - 1) * (rush ? SW.rushSpawnMs / 3 : A.spawnJitterMs);
    // le armi delle IA dipendono dal fronte: più avanti, armi che tu forse non hai ancora
    const types = this.opts.front.aiUnits;
    const dominant = A.dominant[f.id] as UnitType;
    const type = rush && types.includes('ricognitori') && this.aiRng() < SW.rushScouts ? 'ricognitori'
      : types.includes(dominant) && this.aiRng() < A.dominantChance ? dominant : types[Math.floor(this.aiRng() * types.length)];
    if (f.troops < this.unitCost(f.id, type) * (f.kind === 'bot' ? 1.1 : A.reserve)) return; // le milizie spendono quasi tutto per difendersi
    const anchor = this.map.starts[f.id];
    const found = this.unitTarget(f, anchor);
    // nessun nemico in vista: la pedina si schiera lo stesso, ferma sul confine a difendere (Nico: truppe almeno per difendersi)
    const target = found >= 0 ? found : this.map.provinces[this.frontier(f.id)[0] ?? -1]?.anchor ?? -1;
    if (target < 0) return;
    // nasce nella sua città (capitale, città o caserma) più vicina al bersaglio, come le tue: si guardano solo i centri
    let spawn = -1, bestD = Infinity;
    const provs = this.map.provinces;
    for (const p of this.owned[f.id] ?? []) {
      const a = provs[p].anchor;
      if (a < 0 || !this.canRecruitAt(p, f.id)) continue;
      const d = hexDistance(a, target);
      if (d < bestD) { bestD = d; spawn = a; }
    }
    if (spawn < 0) return;
    const u = this.deploy(f.id, type, spawn);
    // impero ricco: la pedina nasce già divisione (prima 3,4 milioni di truppe in cassa e 12 fanterie da un pezzo)
    if (u && u.size === 1) this.aiGrow(f, u, this.aiBatch(f, type, BALANCE.unitOps.divisionMax) - 1);
    if (u && found >= 0) this.order(u, target);
  }

  /** Pezzi in più su una pedina dell'IA, ognuno pagato come il giocatore (truppe al prezzo del momento e la sua risorsa). */
  private aiGrow(f: Faction, u: Unit, n: number) {
    const hp = BALANCE.units[u.type].hp * this.opts.front.aiUnitHpMult, res = this.unitRes(u.type);
    for (let k = 0; k < n; k++) {
      const cost = this.unitCost(f.id, u.type);
      if (f.troops < cost * BALANCE.aiUnits.reserve || f.loot[res.res] < res.n) break;
      f.troops -= cost; f.loot[res.res] -= res.n;
      u.size++; u.maxHp += hp; u.hp += hp;
    }
  }

  /** Bersaglio di una pedina IA: il nemico più vicino; le milizie solo entro un raggio da casa (difendono la loro zona). */
  private onLand = new Map<number, Unit[]>();
  private onLandTick = -1;
  private unitTarget(f: Faction, from: number, mine = -1): number {
    if (f.kind === 'empire') return this.empireTarget(f, from, mine);
    if (f.kind !== 'bot') return this.nearestEnemyTile(f.id, from);
    // milizia: difende la sua zona. Prima le pedine nemiche che ci entrano, poi le tue province vicine a casa sua
    // (gli imperi non li va a cercare: con le pedine li distruggeva nei primi minuti)
    const home = this.map.starts[f.id], B = BALANCE.bots;
    let best = -1, bd = Infinity;
    // pedine sulla terra di ogni fazione, una volta per tick (prima ogni pedina di milizia scorreva tutte le pedine del mondo)
    const tickNo = Math.round(this.gameTimeMs / BALANCE.tick.ms);
    if (this.onLandTick !== tickNo) {
      this.onLandTick = tickNo;
      this.onLand.clear();
      for (const v of this.units) { const o = this.owner[v.tile], l = this.onLand.get(o); if (l) l.push(v); else this.onLand.set(o, [v]); }
    }
    for (const v of this.onLand.get(f.id) ?? []) {
      // solo chi entra davvero nella sua terra: prima inseguiva i tuoi reparti fermi nella tua capitale e la assediava
      // durante la tregua (eliminato in 40 s con una provincia sola)
      if (this.owner[v.tile] !== f.id || v.owner === f.id || hexDistance(v.tile, home) > B.unitRadius || !this.atWar(f.id, v.owner)) continue; // prima il controllo che costa meno
      const d = hexDistance(v.tile, from);
      if (d < bd) { bd = d; best = v.tile; }
    }
    if (best >= 0) return best;
    if (this.opts.tutorial) return -1;
    // terra libera vicino a casa: la milizia si allarga con le pedine, come te (prima la comprava con le truppe)
    for (const p of this.frontier(f.id)) {
      if (this.provOwner[p] !== NEUTRAL) continue;
      const a = this.map.provinces[p].anchor;
      if (a < 0 || hexDistance(a, home) > (this.opts.sandbox ? BALANCE.sandboxWorld.botExpandRadius : B.expandRadius)) continue;
      const d = hexDistance(a, from);
      if (d < bd) { bd = d; best = a; }
    }
    if (best >= 0) return best;
    if (this.gameTimeMs < this.opts.front.graceMs) return -1;
    for (const p of this.frontier(f.id)) {
      if (this.provOwner[p] !== PLAYER) continue;
      const a = this.map.provinces[p].anchor, d = hexDistance(a, home);
      if (d <= B.homeRadius && d < bd) { bd = d; best = a; }
    }
    return best;
  }

  /**
   * Bersaglio di una pedina dell'impero: la provincia nemica più vicina tra quelle che toccano il suo territorio (si
   * raggiungono a piedi), te prima degli altri (`empirePlayerBias`). Prima cercava il nemico più vicino in linea d'aria:
   * le pedine puntavano un'isola oltre il mare, restavano ferme e nascevano tutte lì (Nico, 27 novembre 2026).
   */
  private empireTarget(f: Faction, from: number, mine = -1): number {
    if (this.opts.tutorial) return this.nearestEnemyTile(f.id, from);
    // candidati una volta per tick e per impero (centri già filtrati, coordinate pronte): prima ogni pedina rifiltrava tutto
    // il confine dell'impero, centinaia di province, una volta al secondo
    const tickNo = Math.round(this.gameTimeMs / BALANCE.tick.ms);
    let c = this.empCand.get(f.id);
    if (!c || c.tick !== tickNo) {
      const playerReady = this.gameTimeMs >= this.opts.front.graceMs, bias = BALANCE.aiUnits.empirePlayerBias;
      const provs = this.map.provinces, cols = BALANCE.map.cols, a: number[] = [], k: number[] = [], ps: number[] = [];
      const WT = BALANCE.aiUnits.weakTarget, mineN = Math.max(1, this.owned[f.id]?.size ?? 1), weak = new Map<number, number>();
      const weakOf = (o: number) => {
        let w = weak.get(o);
        if (w === undefined) {
          w = o === NEUTRAL ? WT.neutral : Math.min(WT.max, WT.min + WT.slope * ((this.owned[o]?.size ?? 0) / mineN));
          weak.set(o, w);
        }
        return w;
      };
      for (const p of this.frontier(f.id)) {
        const o = this.provOwner[p], an = provs[p].anchor;
        // anche la terra libera: si prende arrivandoci con una pedina, come fai tu
        if (an < 0 || (o === PLAYER && !playerReady)) continue;
        const bad = this.aiBadTarget.get(f.id * 32768 + p);
        if (bad !== undefined && this.gameTimeMs - bad < BALANCE.aiUnits.badTargetMs) continue;
        // capitali degli altri imperi: le vanno a prendere (sembrano più vicine), perché chi la perde si arrende (`surrenders`)
        const cap = o > PLAYER && this.capitalProv[o] === p && this.factions[o].kind === 'empire' ? BALANCE.aiUnits.capitalPull : 1;
        // più debole il padrone e più chiusa fra le tue province, più "vicina" sembra
        const nb = provs[p].neighbors, inside = nb.filter((q) => this.provOwner[q] === f.id).length / Math.max(1, nb.length);
        a.push(an); k.push((o === PLAYER ? bias : 1) * cap * weakOf(o) * (1 - WT.fill * inside)); ps.push(p);
      }
      const r = a.map((i) => (i / cols) | 0), x = a.map((i, j) => i - r[j] * cols - (r[j] - (r[j] & 1)) / 2);
      // terra libera già scelta da un'altra sua pedina: ci va una sola (le pedine si spargono invece di andare tutte lì)
      const taken = new Set<number>();
      for (const v of this.units) if (v.owner === f.id && v.path.length) taken.add(this.provOf(v.path[v.path.length - 1]));
      c = { tick: tickNo, a, k, r, x, ps, taken };
      this.empCand.set(f.id, c);
      if (this.aiBadTarget.size > 4000) this.aiBadTarget.clear();
    }
    const cols = BALANCE.map.cols, fr = (from / cols) | 0, fx = from - fr * cols - (fr - (fr & 1)) / 2;
    let best = -1, bd = Infinity, bp = -1;
    for (let j = 0; j < c.a.length; j++) {
      if (c.ps[j] !== mine && c.taken.has(c.ps[j]) && this.provOwner[c.ps[j]] === NEUTRAL) continue;
      const dx = fx - c.x[j], dz = fr - c.r[j], dy = -dx - dz;
      const d = Math.max(dx < 0 ? -dx : dx, dy < 0 ? -dy : dy, dz < 0 ? -dz : dz) * c.k[j];
      if (d < bd) { bd = d; best = c.a[j]; bp = c.ps[j]; }
    }
    if (bp >= 0) c.taken.add(bp);
    return best;
  }
  private empCand = new Map<number, { tick: number; a: number[]; k: number[]; r: number[]; x: number[]; ps: number[]; taken: Set<number> }>();

  /** Centri delle province divisi in celle di 24×24 caselle: la ricerca del nemico più vicino guarda solo le celle attorno. */
  private anchorCells: number[][] | null = null;
  private static readonly ACELL = 24;

  /** Centro della provincia nemica (in guerra) più vicina, −1 se nessuna: si cerca tra le province, non tra le caselle. */
  private nearestEnemyTile(f: number, from: number): number {
    const playerReady = !this.opts.tutorial && this.gameTimeMs >= this.opts.front.graceMs;
    const provs = this.map.provinces, { cols, rows } = BALANCE.map, C = RunState.ACELL;
    const gw = Math.ceil(cols / C), gh = Math.ceil(rows / C);
    if (!this.anchorCells) {
      this.anchorCells = Array.from({ length: gw * gh }, () => []);
      for (let p = 0; p < provs.length; p++) {
        const a = provs[p].anchor;
        if (a >= 0) this.anchorCells[(((a / cols) | 0) / C | 0) * gw + ((a % cols) / C | 0)].push(p);
      }
    }
    // stesso risultato della scansione di tutte le province (a pari distanza vince l'indice più basso), ma ad anelli di celle
    // attorno alla pedina, fermandosi quando nessuna cella più lontana può battere il migliore (scatti con 150 fazioni)
    const bias = BALANCE.aiUnits.playerBias, minBias = Math.min(1, bias);
    const cx = (from % cols) / C | 0, cy = ((from / cols) | 0) / C | 0;
    let best = -1, bestP = Infinity, bestD = Infinity;
    const look = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= gw || y >= gh) return;
      for (const p of this.anchorCells![y * gw + x]) {
        const o = this.provOwner[p], a = provs[p].anchor;
        if (o === NEUTRAL || o === f || (o === PLAYER && !playerReady) || !this.atWar(f, o)) continue;
        const d = hexDistance(from, a) * (o === PLAYER ? bias : 1);
        if (d < bestD || (d === bestD && p < bestP)) { bestD = d; bestP = p; best = a; }
      }
    };
    for (let r = 0; r <= Math.max(gw, gh); r++) {
      if (r > 0 && ((2 / 3) * (r - 1) * C - 1) * minBias > bestD) break;
      if (r === 0) { look(cx, cy); continue; }
      for (let k = -r; k <= r; k++) { look(cx + k, cy - r); look(cx + k, cy + r); }
      for (let k = -r + 1; k <= r - 1; k++) { look(cx - r, cy + k); look(cx + r, cy + k); }
    }
    return best;
  }

  /** Milizia: prende la provincia libera più economica vicino a casa, se se la può permettere. */
  private botExpand(f: Faction) {
    for (let k = 0; k < BALANCE.bots.expandPerAct; k++) if (!this.botExpandOne(f)) break;
  }

  private botExpandOne(f: Faction): boolean {
    const home = this.map.starts[f.id];
    let best = -1, bestCost = Infinity, bestScore = Infinity;
    for (const p of this.frontier(f.id)) {
      if (this.provOwner[p] !== NEUTRAL || hexDistance(this.map.provinces[p].anchor, home) > BALANCE.bots.homeRadius) continue;
      const cost = this.provCost(f.id, p), score = cost * this.compact(f.id, p);
      if (score < bestScore) { best = p; bestCost = cost; bestScore = score; }
    }
    return best >= 0 && f.troops > bestCost * BALANCE.ai.reserve && this.attackProvince(f.id, best).ok;
  }

  /**
   * Quanto "pesa" allargarsi su `p` per la forma del territorio (Nico: meno border gore): meno se la provincia è già
   * circondata dalle tue (chiude i buchi), di più se è lontana dalla capitale (niente lingue di terra nel nulla).
   */
  private compact(f: number, p: number): number {
    const C = BALANCE.ai.compact, nb = this.map.provinces[p].neighbors;
    let mine = 0;
    for (const q of nb) if (this.provOwner[q] === f) mine++;
    const cap = this.capitalProv[f], a = this.map.provinces[p].anchor, ca = cap >= 0 ? this.map.provinces[cap].anchor : a;
    return (1 + C.surround * (1 - mine / Math.max(1, nb.length))) * (1 + hexDistance(a, ca) / C.reach);
  }

  /** IA: attacca la provincia vicina più debole, se se lo può permettere. */
  /**
   * Più prese in un colpo: il confine si legge una volta sola e si prendono le `n` province libere migliori (prima si
   * rileggeva dopo ogni presa: con 25 imperi grandi un tick costava fino a 40 ms).
   */
  private aiAttackMany(f: Faction, n: number) {
    if (n <= 1) { this.aiAttack(f); return; }
    const cand: { p: number; score: number; cost: number; r: number }[] = [];
    for (const p of this.frontier(f.id)) {
      if (this.provOwner[p] !== NEUTRAL || this.battleAt(p)) continue;
      const prov = this.map.provinces[p];
      const capital = prov.city >= 0 && this.map.tiles[prov.city]!.capital ? BALANCE.provinces.aiCityAttraction : 1;
      const cost = this.provCost(f.id, p);
      cand.push({ p, score: cost * capital * this.compact(f.id, p), cost, r: this.aiRng() });
    }
    cand.sort((a, b) => a.score - b.score || a.r - b.r);
    for (const c of cand.slice(0, n)) {
      if (this.provOwner[c.p] !== NEUTRAL || f.troops <= c.cost * BALANCE.ai.reserve) break;
      if (!this.attackProvince(f.id, c.p).ok) break;
    }
  }

  private aiAttack(f: Faction): boolean {
    let best = -1, bestScore = Infinity, bestCost = 0;
    for (const p of this.frontier(f.id)) {
      if (this.provOwner[p] !== NEUTRAL || this.battleAt(p)) continue; // con le truppe solo il vuoto: gli altri si attaccano con le pedine
      const prov = this.map.provinces[p];
      const capital = prov.city >= 0 && this.map.tiles[prov.city]!.capital ? BALANCE.provinces.aiCityAttraction : 1; // le capitali attirano
      const cost = this.provCost(f.id, p);
      const score = cost * capital * this.compact(f.id, p);
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
    const g = this.guardUntil.get(p);
    return g !== undefined && g > this.gameTimeMs ? d * BALANCE.events.guardMult : d; // rinforzata dopo un rapporto del radar
  }

  /** Truppe che `by` spende per prendere la provincia: la sua difesa (fissa: niente sovraestensione, Nico come in HOI4). */
  provCost(by: number, p: number): number {
    let d = 0;
    for (const i of this.map.provinces[p].tiles) if (this.passable(i)) d += this.costFor(by, i);
    if (by === PLAYER) d *= this.opts.mods.attackCostMult; // dottrina d'assalto
    if (by === PLAYER && this.isMilitia(this.provOwner[p])) d *= BALANCE.bots.troopAssaultMult; // milizie con le truppe: care
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
    if (this.owner[i] !== NEUTRAL) return d;
    const emp = BALANCE.ai.neutralCostMult * (this.opts.sandbox ? BALANCE.sandboxWorld.neutralCostMult : 1); // sandbox: la carta si riempie in 5 minuti
    return Math.ceil(d * (by === PLAYER ? this.opts.mods.neutralCostMult : this.factions[by]?.kind === 'bot' ? BALANCE.bots.neutralCostMult : emp));
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
  /**
   * Unico punto che cambia il padrone di una provincia: tiene l'elenco delle province di ogni fazione e svuota solo i
   * confini toccati (prima ogni conquista di una qualunque delle 150 milizie rifaceva i confini di tutti, scorrendo
   * tutte le 18 000 province: il gioco scattava).
   */
  private owned: Set<number>[] = [];
  /** Province di una fazione (insieme vivo: non modificarlo). */
  ownedProvinces(f: number): ReadonlySet<number> {
    return this.owned[f] ?? new Set();
  }
  /** Cresce a ogni cambio di padrone di una provincia (il disegno rifà i nomi solo se cambia). */
  ownVersion = 0;

  /** Replay: padroni all'inizio, cambi in attesa (provincia, padrone) e fotogrammi chiusi ogni 2 s di gioco. */
  private tl0: Int16Array | null = null;
  private tlPending: number[] = [];
  private tlFrames: { t: number; ch: number[] }[] = [];
  private tlAt = 0;
  chronicle: ChronEntry[] = [];
  private lostWave = new Map<number, number>(); // chi ti ha preso province negli ultimi 2 s → quante

  private chron(e: Omit<ChronEntry, 't'>) {
    this.chronicle.push({ t: this.gameTimeMs, ...e });
  }

  /** Chiude il fotogramma del replay ogni 2 s (e la riga "ti hanno preso N province" se sono tante). */
  private replayTick() {
    if (this.opts.tutorial) return;
    if (!this.tl0) { this.tl0 = Int16Array.from(this.provOwner); this.tlAt = this.gameTimeMs; }
    if (this.gameTimeMs - this.tlAt < 2000) return;
    this.tlAt = this.gameTimeMs;
    if (this.tlPending.length) { this.tlFrames.push({ t: this.gameTimeMs, ch: this.tlPending }); this.tlPending = []; }
    for (const [by, n] of this.lostWave) if (n >= 5) this.chron({ k: 'lost', a: by, b: PLAYER, n });
    this.lostWave.clear();
  }

  /** Tutto il replay, per il resoconto di fine partita. */
  replayData(): ReplayData | null {
    if (!this.tl0) return null;
    const frames = this.tlPending.length ? [...this.tlFrames, { t: this.gameTimeMs, ch: this.tlPending }] : this.tlFrames;
    return { own0: this.tl0, frames, chronicle: this.chronicle, endMs: this.gameTimeMs };
  }

  private setProvOwner(p: number, f: number) {
    this.ownVersion++;
    if (this.tl0) this.tlPending.push(p, f);
    const o = this.provOwner[p];
    if (o >= 0) this.owned[o]?.delete(p);
    this.provOwner[p] = f;
    if (f >= 0) (this.owned[f] ??= new Set()).add(p);
    this.frontierCache.delete(o);
    this.frontierCache.delete(f);
    for (const q of this.map.provinces[p].neighbors) if (q >= 0) this.frontierCache.delete(this.provOwner[q]);
  }

  frontier(f = PLAYER): number[] {
    const cached = this.frontierCache.get(f);
    if (cached) return cached;
    const set = new Set<number>(), provs = this.map.provinces;
    for (const p of this.owned[f] ?? []) {
      for (const q of provs[p].neighbors) if (this.provOwner[q] !== f && this.provPassable(q) && this.atWar(f, this.provOwner[q])) set.add(q);
    }
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

  /** Milizia provinciale (si assalta anche con le truppe). */
  isMilitia(f: number): boolean {
    return f > PLAYER && this.factions[f]?.kind === 'bot';
  }

  attackProvince(by: number, p: number): ConquerResult {
    if (!this.provPassable(p)) return { ok: false, reason: 'impassable' };
    if (this.provOwner[p] === by) return { ok: false, reason: 'owned' };
    if (!this.isFrontierProv(p, by)) return { ok: false, reason: 'not-adjacent' };
    if (this.battleAt(p)) return { ok: false, reason: 'battle' };
    // Nico: con le truppe si compra solo il territorio vuoto; le province di qualcuno (imperi e milizie) si prendono con le pedine,
    // alla Call of War (25 novembre 2026: "conquistare le province nemiche comprando non ha senso")
    if (this.provOwner[p] !== NEUTRAL) return { ok: false, reason: 'units' };
    // il giocatore prende anche la terra libera solo con gli eserciti, alla Call of War (Nico, 25 novembre 2026: "scopiazzerei
    // completamente Call of War"); la run guidata e le IA comprano ancora il vuoto con le truppe
    if (by === PLAYER && !this.opts.tutorial) return { ok: false, reason: 'units' };
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
    // assedio di una capitale: dura di più (prima costava il triplo della vita)
    const capital = unit !== undefined && this.capitalProv[this.provOwner[p]] === p ? B.capitalSiegeMult : 1;
    const ms = clamp((B.baseMs + weight * B.msPerCost) * (1 + (move - 1) * 0.5), B.minMs, B.maxMs) * capital;
    const b: Battle = { id: this.nextBattleId++, p, by, from: this.provOwner[p], troops, def0: this.provDefense(p), startMs: this.gameTimeMs, endMs: this.gameTimeMs + ms, unit };
    this.battles.push(b);
    this.events.push({ type: 'battle', phase: 'start', battle: b });
    return b;
  }

  /** Assalti che finiscono: vince chi ha ancora abbastanza truppe (o la pedina che resiste); gli altri si sciolgono. */
  private battlesTick() {
    const B = BALANCE.battle;
    if (!this.battles.length) return;
    // pedine vive per provincia e per id, una volta per tick (prima ogni assedio scorreva tutte le pedine tre volte)
    const inProv = new Map<number, Unit[]>(), byId = new Map<number, Unit>();
    for (const u of this.units) {
      if (u.hp <= 0) continue;
      byId.set(u.id, u);
      const p = this.provOf(u.tile), l = inProv.get(p);
      if (l) l.push(u); else inProv.set(p, [u]);
    }
    for (const b of [...this.battles]) {
      let unit = b.unit !== undefined ? byId.get(b.unit) : undefined;
      if (unit && unit.hp <= 0) unit = undefined;
      let unitHere = !!unit && this.provOf(unit.tile) === b.p;
      const here = inProv.get(b.p) ?? [];
      // assedio di pedine: contano tutte quelle dell'attaccante dentro la provincia (Nico: 5 pedine non possono metterci
      // quanto una). Se quella che l'ha iniziato muore o se ne va, lo porta avanti un'altra
      const group = b.unit !== undefined ? here.filter((u) => u.owner === b.by && u.hp > 0 && !isNaval(u.type)) : [];
      if (b.unit !== undefined && !unitHere && group.length) { unit = group[0]; b.unit = unit.id; unitHere = true; }
      const gone = this.provOwner[b.p] !== b.from || !this.factions[b.by].alive || !this.atWar(b.by, b.from) || (b.unit !== undefined && !unitHere);
      if (gone) {
        // la provincia è cambiata di mano, è arrivata la pace o la pedina se n'è andata: le truppe tornano
        this.battles = this.battles.filter((x) => x !== b);
        this.factions[b.by].troops += b.troops;
        this.events.push({ type: 'battle', phase: 'off', battle: b });
        continue;
      }
      if (unit && group.length > 1) {
        // somma con calo: la più forte conta intera, ogni altra un po' meno (×0,85 a testa). 2 pedine ≈ ×1,85, 5 ≈ ×3,7
        const atk = (u: Unit) => BALANCE.units[u.type].attack * u.size, ref = atk(unit);
        const m = group.map(atk).sort((x, y) => y - x).reduce((sum, a, k) => sum + a * B.stackFalloff ** k, 0) / Math.max(1e-6, ref);
        if (m > 1) b.endMs -= BALANCE.tick.ms * (m - 1); // l'assedio avanza m volte più veloce
      }
      if (this.gameTimeMs < b.endMs) continue;
      // assedio di pedine (Nico, 26 novembre 2026: "un'armata che entra in una terra con un po' di civili non muore"): l'assedio
      // costa solo tempo, mai vita. Finisce quando nella provincia non c'è più nessuna pedina del difensore: finché ce n'è
      // una si combatte (le pedine si sparano) e l'assedio aspetta. La difesa della provincia (fortificazione, montagna,
      // capitale) decide solo quanto dura. Prima a fine assedio la pedina perdeva vita = difesa × captureCost (×3 sulle
      // capitali) e se non bastava moriva tutto il gruppo
      if (unit && here.some((v) => v.hp > 0 && v.owner === b.from)) continue;
      this.battles = this.battles.filter((x) => x !== b);
      let win: boolean;
      if (unit) win = true;
      else {
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
  /** Catena dei tuoi depositi: [deposito, a chi si lega] (per disegnarla nella mappa logistica). */
  depotLinks: [number, number][] = [];

  /** Fazioni il cui rifornimento va rifatto (territorio, depositi o capitale cambiati); `supplyDirty` = tutte. */
  private supplyDirtyF = new Set<number>();
  private markSupply(f: number) {
    if (f >= 0) this.supplyDirtyF.add(f);
  }
  private supplyDist = new Int16Array(0);

  /** Rifornimento rifatto solo per le fazioni cambiate (Nico, 27 novembre 2026: "molto più efficiente"): prima tutte le 260
   *  fazioni ogni mezzo secondo, un quinto del tempo del motore. Il rifornimento di una provincia dipende solo dal suo padrone. */
  private recomputeSupply() {
    const all = this.supplyDirty;
    this.supplyDirty = false;
    const own = this.provOwner, L = BALANCE.logistics;
    if (this.supplyDist.length !== own.length) this.supplyDist = new Int16Array(own.length).fill(-1);
    const list = all ? this.factions.map((f) => f.id) : [...this.supplyDirtyF].sort((a, b) => a - b);
    this.supplyDirtyF.clear();
    if (all) this.supply.fill(L.cutOff);
    for (const id of list) {
      const f = this.factions[id];
      if (!f) continue;
      if (!all) for (const p of this.owned[id] ?? []) this.supply[p] = L.cutOff;
      if (id === PLAYER) this.depotLinks = [];
      if (f.alive) this.supplyOf(f);
    }
  }

  private supplyOf(f: Faction) {
    const L = BALANCE.logistics, own = this.provOwner, provs = this.map.provinces, dist = this.supplyDist;
    const depot = WORKS.indexOf('rifornimenti'), depots: number[] = [];
    for (const p of this.owned[f.id] ?? []) if (this.provWork[p] === depot && this.provWorkAt[p] === 0) depots.push(p);
    {
      let c = this.capitalProv[f.id];
      if (c < 0 || own[c] !== f.id) {
        c = this.capitalProv[f.id] = this.newCapital(f.id, c);
        if (c >= 0) this.events.push({ type: 'capital', faction: f.id, p: c });
      }
      if (c < 0) return;
      // dalla capitale rifornimento pieno fino a `range` passi; un deposito pronto solo per pochi passi attorno (Nico: prima
      // copriva un'area enorme come la capitale, allo stesso prezzo di un bunker che difende una provincia sola)
      const spread = (src: number, range: number, local = false, base = 1, decay: number = L.decay) => {
        const q = [src];
        dist[src] = 0;
        for (let h = 0; h < q.length; h++) {
          const p = q[h], d = dist[p];
          const v = d <= range ? base : Math.max(L.min, base - (d - range) * decay);
          this.supply[p] = Math.max(this.supply[p], v);
          if (local && v <= L.min) continue; // il deposito si ferma dove il suo rifornimento non serve più
          for (const n of provs[p].neighbors) if (dist[n] < 0 && own[n] === f.id) { dist[n] = d + 1; q.push(n); }
        }
        for (const p of q) dist[p] = -1;
      };
      spread(c, L.range);
      // catena dei depositi: dal più vicino alla capitale in poi, ognuno si lega al nodo già in catena più vicino (capitale o
      // deposito) e vale il 10% in meno di lui
      const nodes: { p: number; hops: number }[] = [{ p: c, hops: 0 }], cap = provs[c].anchor;
      // le città che costruisci sono nodi della rete come la capitale, altre "capitali" (Nico: solo quelle costruite, non le
      // città della carta che conquisti)
      for (const p of this.builtCity) if (p !== c && this.provOwner[p] === f.id) nodes.push({ p, hops: 0 });
      const list = depots.filter((p) => p !== c).sort((a, b) => hexDistance(provs[a].anchor, cap) - hexDistance(provs[b].anchor, cap) || a - b);
      for (const p of list) {
        let par = nodes[0], bd = Infinity;
        for (const n of nodes) { const d = hexDistance(provs[n.p].anchor, provs[p].anchor); if (d < bd) { bd = d; par = n; } }
        const hops = par.hops + 1;
        nodes.push({ p, hops });
        if (f.id === PLAYER) this.depotLinks.push([p, par.p]);
        const range = Math.max(L.depotRangeMin, L.depotRange - Math.floor((hops - 1) / L.depotHopsPerStep));
        spread(p, f.id === PLAYER && this.depotsUnpaid() ? Math.floor(range / 2) : range, true, 1, L.depotDecay); // mantenimento non pagato: metà area
      }
    }
  }

  /** Capitale persa: la nuova è la provincia della fazione più vicina alla vecchia. */
  private newCapital(f: number, old: number): number {
    const provs = this.map.provinces, from = old >= 0 ? provs[old].anchor : this.map.starts[f];
    let best = -1, bd = Infinity;
    for (const p of this.owned[f] ?? []) { // solo le sue province (prima tutte le 18 000, per ogni fazione senza capitale)
      if (provs[p].anchor < 0) continue;
      const d = hexDistance(provs[p].anchor, from);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** Rifornimento migliore tra le province di `by` che confinano con `p` (da lì parte l'attacco). */
  private supplyFrom(by: number, p: number): number {
    // niente ricalcolo qui: con 150 milizie la logistica si rifaceva a ogni conquista (8 FPS); si rifà una volta per tick e
    // la provincia appena presa eredita il rifornimento dei vicini (transferProvince)
    let s = 0;
    for (const q of this.map.provinces[p].neighbors) if (this.provOwner[q] === by && this.supply[q] > s) s = this.supply[q];
    return s || 1;
  }

  /** Passa la provincia a `by` (il costo è già stato pagato): bottino delle rovine, premio, capitale. */
  private transferProvince(by: number, p: number, cost: number, unit?: number): { loot: number; lootType: Resource } {
    const prov = this.map.provinces[p];
    const from = this.provOwner[p];
    if (from !== NEUTRAL && by !== NEUTRAL && this.capitalProv[from] === p && (by === PLAYER || from === PLAYER || this.factions[from].kind === 'empire')) this.chron({ k: 'capital', a: by, b: from });
    if (from === PLAYER && by !== NEUTRAL) this.lostWave.set(by, (this.lostWave.get(by) ?? 0) + 1);
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
    if (by === PLAYER) { // conti per gli obiettivi
      if (this.isCity(p)) this.objStats.cities.add(p);
      if (from !== NEUTRAL && this.factions[from].kind === 'empire') this.objStats.empireProv++;
    }
    this.setProvOwner(p, by);
    this.markSupply(by); this.markSupply(from);
    this.supply[p] = this.supplyFrom(by, p); // fino al prossimo tick: come i vicini da cui è stata presa
    f.provinces++;
    f.maxProvinces = Math.max(f.maxProvinces, f.provinces);
    f.maxTiles = Math.max(f.maxTiles, f.tiles);
    f.loot = addBag(f.loot, bag);
    const loot = bag.metallo + bag.benzina + bag.cibo;
    const lootType = (Object.keys(bag) as Resource[]).reduce((a, b) => (bag[b] > bag[a] ? b : a), 'metallo');
    this.events.push({ type: 'conquer', by, from, p, i: prov.anchor, cost, loot, lootType, unit });
    this.provinceReward(by, p);
    if (prov.city >= 0 && this.map.tiles[prov.city]!.capital && !this.capitalsTaken.has(prov.city)) {
      // capitale: truppe a chi la prende per primo
      this.capitalsTaken.add(prov.city);
      if (by === PLAYER) this.objStats.capitals++;
      const bonus = Math.round(BALANCE.provinces.capitalTroops * (by === PLAYER ? this.opts.mods.capitalTroopsMult : 1));
      f.troops += bonus;
      const nation = this.map.nations.find((n) => n.id === prov.country)?.name ?? '';
      this.events.push({ type: 'province', by, province: p, count: prov.tiles.length, capital: true, nation, bonus });
    }
    if (from !== NEUTRAL && this.factions[from].tiles <= 0) this.eliminate(from, by);
    else if (this.surrenders(from, by, p)) this.annex(from, by);
    return { loot, lootType };
  }

  /**
   * Resa (Nico, 26 novembre 2026: "gli imperi devono essere più aggressivi, alla fine ne restano pochi, le superpotenze, che si
   * prendono tutto"; prima dopo un'ora restavano 44 imperi su 45): un impero IA che perde la capitale contro un impero IA
   * almeno grande quanto lui si arrende, e tutta la sua terra passa al vincitore. Tu non ti arrendi mai e le tue conquiste
   * restano province per provincia.
   */
  private surrenders(from: number, by: number, p: number): boolean {
    if (from <= PLAYER || by <= PLAYER || this.opts.tutorial || this.capitalProv[from] !== p) return false;
    const a = this.factions[by], d = this.factions[from];
    return a.kind === 'empire' && d.kind === 'empire' && d.alive;
  }

  private annex(from: number, by: number) {
    const f = this.factions[by], d = this.factions[from];
    for (const q of [...(this.owned[from] ?? [])]) {
      for (const i of this.map.provinces[q].tiles) {
        if (!this.passable(i) || this.owner[i] !== from) continue;
        this.owner[i] = by;
        d.tiles--;
        f.tiles++;
      }
      this.setProvOwner(q, by);
      d.provinces--;
      f.provinces++;
      this.events.push({ type: 'conquer', by, from, p: q, i: this.map.provinces[q].anchor, cost: 0, loot: 0, lootType: 'metallo' });
    }
    f.maxProvinces = Math.max(f.maxProvinces, f.provinces);
    f.maxTiles = Math.max(f.maxTiles, f.tiles);
    f.troops += d.troops;
    this.markSupply(by); this.markSupply(from);
    this.eliminate(from, by);
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
    this.markSupply(f);
    for (const i of this.map.provinces[p].tiles) {
      if (!this.passable(i) || this.owner[i] !== NEUTRAL) continue;
      this.owner[i] = f;
      fac.tiles++;
    }
    this.setProvOwner(p, f);
    fac.provinces++;
    fac.maxProvinces = Math.max(fac.maxProvinces, fac.provinces);
    fac.maxTiles = Math.max(fac.maxTiles, fac.tiles);
  }

  /** Sandbox, prima della scelta: niente tuo sulla carta (Nico: "una tabella blu" che non si capiva). Si chiama a carta
   *  pronta (dopo il costruttore, che assegna comunque una partenza). */
  clearStart() {
    if (!this.placing) return;
    for (const u of this.unitsOf(PLAYER)) u.hp = 0;
    this.removeDead();
    this.drainEvents();
    this.map.provinces.forEach((prov, q) => {
      if (this.provOwner[q] !== PLAYER) return;
      for (const i of prov.tiles) if (this.owner[i] === PLAYER) this.owner[i] = NEUTRAL;
      this.setProvOwner(q, NEUTRAL);
    });
    this.player.tiles = 0;
    this.player.provinces = 0;
    this.frontierCache.clear();
  }

  /** Sandbox: il giocatore si cala sulla provincia toccata (libera); la partenza di prima torna terra libera. */
  placePlayer(p: number): boolean {
    if (!this.placing || p < 0 || !this.provPassable(p) || this.provOwner[p] !== NEUTRAL) return false;
    const f = this.player;
    this.map.provinces.forEach((prov, q) => {
      if (this.provOwner[q] !== PLAYER) return;
      for (const i of prov.tiles) if (this.owner[i] === PLAYER) this.owner[i] = NEUTRAL;
      this.setProvOwner(q, NEUTRAL);
    });
    f.tiles = 0;
    f.provinces = 0;
    this.claimProvince(PLAYER, p);
    this.capitalProv[PLAYER] = p;
    this.supplyDirty = true;
    this.frontierCache.clear();
    this.placing = false;
    this.starterArmy();
    return true;
  }

  // ---------- obiettivi e svolte ----------

  /** Attiva il prossimo obiettivo della lista; false se è finita. */
  private pullObjective(): boolean {
    const L = BALANCE.objectives.list;
    if (this.objNext >= L.length) return false;
    const d = L[this.objNext++];
    const o: Objective = { id: d.id, kind: d.kind, target: d.target, progress: 0, troops: d.troops, loot: d.loot,
      deadline: d.deadlineMs !== undefined ? this.gameTimeMs + d.deadlineMs : undefined };
    this.objectives.push(o);
    if (this.gameTimeMs > 0) this.events.push({ type: 'objective', phase: 'new', objective: o });
    return true;
  }

  private objectiveValue(kind: string): number {
    const S = this.objStats;
    switch (kind) {
      case 'provinces': return this.player.provinces;
      case 'cities': return S.cities.size;
      case 'capitals': return S.capitals;
      case 'empireProv': return S.empireProv;
      case 'repelled': return S.repelled;
      case 'rank': return this.rank().pos === 1 ? 1 : 0;
      default: return 0;
    }
  }

  /** Aggiorna gli obiettivi: premio a chi completa, via quelli scaduti, nuovi al loro posto; la svolta del dominio. */
  private objectivesTick() {
    if (this.opts.tutorial || this.opts.sandbox || this.over || !this.player.alive) return;
    const B = BALANCE.objectives, now = this.gameTimeMs;
    for (const o of [...this.objectives]) {
      if (o.decisive) continue;
      o.progress = Math.min(o.target, this.objectiveValue(o.kind));
      const done = o.progress >= o.target, late = o.deadline !== undefined && now > o.deadline;
      if (!done && !late) continue;
      this.objectives.splice(this.objectives.indexOf(o), 1);
      if (done) {
        this.player.troops += o.troops;
        const loot = this.lootFor(PLAYER, o.loot);
        this.player.loot.metallo += Math.ceil(loot / 2);
        this.player.loot.benzina += Math.floor(loot / 4);
        this.player.loot.cibo += Math.floor(loot / 4);
        const d = B.list.find((x) => x.id === o.id);
        if (d?.growthMult) this.growthBoost = { mult: d.growthMult, until: now + (d.growthMs ?? 0) };
      }
      this.events.push({ type: 'objective', phase: done ? 'done' : 'failed', objective: o });
      this.pullObjective();
    }
    // svolta: dal minuto 6 compare il dominio; tenuto per un minuto chiude la campagna con la vittoria
    const D = B.dominate;
    let dom = this.objectives.find((o) => o.decisive);
    if (!dom && now >= D.fromMs) {
      dom = { id: 'dominate', kind: 'dominate', target: Math.round(D.holdMs / 1000), progress: 0, troops: 0, loot: 0, decisive: true };
      this.objectives.unshift(dom);
      this.events.push({ type: 'objective', phase: 'new', objective: dom });
    }
    if (dom) {
      const top = Math.max(0, ...this.factions.filter((f) => f.kind === 'empire' && f.alive).map((f) => f.provinces));
      const ok = this.player.provinces >= D.minProvinces && this.player.provinces >= top * D.ratio;
      if (!ok) { dom.holdSince = undefined; dom.progress = 0; }
      else {
        dom.holdSince ??= now;
        dom.progress = Math.min(dom.target, Math.floor((now - dom.holdSince) / 1000));
        if (now - dom.holdSince >= D.holdMs) {
          this.events.push({ type: 'objective', phase: 'done', objective: dom });
          this.end('victory', 'dominance');
        }
      }
    }
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
        const lost = Math.max(0, o.lostAtStart - this.player.tiles);
        if (lost <= o.lostAtStart * BALANCE.objectives.repelMaxLoss) this.objStats.repelled++;
        this.events.push({ type: 'offensive', faction: o.faction, phase: 'end', lost });
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
    if (f === PLAYER || dead.kind === 'empire') this.chron({ k: 'fall', a: f, b: by });
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
