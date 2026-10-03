// Tutti i numeri di bilanciamento vivono qui. Mai hardcoded altrove.

export const BALANCE = {
  map: {
    cols: 120,
    rows: 60,
    latMax: 84,
    latMin: -58, // niente Antartide
    hexSize: 10, // raggio esagono in pixel-mondo
    toxicClusters: 14,
    toxicClusterSize: [2, 7] as [number, number],
    ruinsCount: 70,
    desertLatBand: [12, 35] as [number, number], // |lat| in gradi
    desertChance: 0.7, // probabilità deserto dentro la fascia
    desertSprinkle: 0.04, // probabilità deserto fuori fascia
    minStartRegion: 300, // caselle minime della regione di partenza (ci stanno 4 fazioni)
  },
  tick: {
    ms: 500,
    troopsPerTile: 0.1, // troops += tiles * troopsPerTile
  },
  start: {
    troops: 25,
    radius: 1, // anello di caselle iniziali attorno alla partenza
  },
  defense: {
    terra: 6,
    deserto: 3,
    rovine: 12,
    anomalia: 22,
    variance: 0.3, // ± percentuale casuale per casella
  },
  // Caselle possedute: difesa = base * mult + min(truppe/caselle * garrison, garrisonMax)
  owned: {
    defenseMult: 1,
    garrison: 0.5,
    garrisonMax: 12, // niente fortezze imbattibili accumulando truppe
  },
  ai: {
    count: 3,
    startTroops: 20,
    growthMult: 0.85, // rispetto alla crescita del giocatore
    actChance: 0.6, // probabilità di agire a ogni tick
    attacksPerAct: 1,
    reserve: 1.25, // attacca solo se truppe > difesa * reserve
    playerBias: 0.7, // le caselle del giocatore "sembrano" più deboli: ce l'hanno con te
    graceMs: 60_000, // tempo di gioco prima che le IA attacchino il giocatore
    startDistance: [9, 20] as [number, number], // passi esagonali dal giocatore
    minDistanceBetween: 7, // passi esagonali tra fazioni IA
    releaseLootShare: 0.5, // quota di bottino rilasciata quando eliminata
  },
  // Pedine: costano truppe del pool, si muovono casella per casella e conquistano dove passano.
  units: {
    fanteria: { cost: 60, hp: 60, attack: 6, range: 1, moveMs: 1000, captureCost: 0.4 },
    raider: { cost: 45, hp: 35, attack: 7, range: 1, moveMs: 500, captureCost: 0.5 },
    artiglieria: { cost: 70, hp: 30, attack: 9, range: 2, moveMs: 1500, captureCost: 0.8 },
    strong: 1.75, // moltiplicatore danno contro l'unità che batti
    weak: 0.5, // moltiplicatore danno contro l'unità che ti batte
    cooldownMs: 6000, // ricarica della carta (tempo di gioco)
    maxPerFaction: 4,
    healPerTick: 1, // hp recuperati sul proprio territorio, fuori combattimento
    // captureCost: hp persi conquistando = difesa della casella * captureCost
  },
  aiUnits: {
    dominant: ['', 'raider', 'artiglieria', 'fanteria'], // unità preferita per fazione (indice = fazione)
    dominantChance: 0.7,
    spawnEveryMs: 25_000,
    spawnJitterMs: 5_000,
    reserve: 1.5, // schiera solo se truppe > costo * reserve
    maxUnits: 2,
    repathMs: 6_000,
    playerBias: 1, // 1 = le pedine IA vanno sul nemico più vicino, chiunque sia
  },
  // Bottino delle rovine: ogni rovina contiene una sola risorsa.
  loot: {
    weights: { rottami: 0.5, carburante: 0.25, viveri: 0.25 },
    rottami: [8, 20] as [number, number],
    carburante: [4, 10] as [number, number],
    viveri: [5, 12] as [number, number],
  },
  // Anomalie: caselle-segnale molto difese. Tenerne `victory.anomalies` = vittoria.
  anomalies: {
    count: 5,
    distance: [8, 28] as [number, number], // passi esagonali dalla partenza del giocatore
    minApart: 6,
  },
  victory: {
    mapShare: 0.6, // quota della regione di partenza (terra attraversabile)
    anomalies: 3,
    bonus: 0.5, // +50% dello zaino in caso di vittoria
  },
  // Tempesta di cenere: arriva e restringe la mappa attorno a un punto.
  storm: {
    startMs: 480_000, // 8 min di gioco
    warnMs: 60_000, // avviso + cerchio finale visibile prima dell'arrivo
    durationMs: 90_000, // tempo per chiudersi fino a finalRadius
    finalRadius: 3,
    unitDamage: 6, // hp per tick alle pedine nella cenere
  },
  // Eventi stile Reigns (servono la Radio): una carta con 2 scelte, la run è in pausa mentre è aperta.
  events: {
    firstMs: 45_000,
    everyMs: 90_000,
    jitterMs: 15_000,
  },
  // Accampamento: 1 cantiere alla volta, timer in tempo reale (secondi). I timer non bloccano mai le run.
  camp: {
    buildings: {
      fucina: [
        { cost: { rottami: 40, carburante: 10, viveri: 0 }, timeSec: 60 },
        { cost: { rottami: 120, carburante: 40, viveri: 0 }, timeSec: 180 },
        { cost: { rottami: 250, carburante: 90, viveri: 0 }, timeSec: 300 },
      ],
      radio: [
        { cost: { rottami: 30, carburante: 0, viveri: 15 }, timeSec: 60 },
        { cost: { rottami: 90, carburante: 20, viveri: 40 }, timeSec: 180 },
        { cost: { rottami: 200, carburante: 60, viveri: 80 }, timeSec: 300 },
      ],
      magazzino: [
        { cost: { rottami: 50, carburante: 0, viveri: 20 }, timeSec: 90 },
        { cost: { rottami: 140, carburante: 0, viveri: 60 }, timeSec: 240 },
        { cost: { rottami: 260, carburante: 60, viveri: 120 }, timeSec: 300 },
      ],
    },
    // effetti per livello (indice = livello, 0 = non costruito)
    fucinaUnits: [['fanteria'], ['fanteria', 'raider'], ['fanteria', 'raider', 'artiglieria'], ['fanteria', 'raider', 'artiglieria']],
    fucinaHpMult: [1, 1, 1, 1.25],
    radioEvents: [0, 1, 2, 2], // 0 = niente eventi, 1 = comuni, 2 = anche rari
    radioWarnBonusMs: [0, 0, 0, 30_000],
    magazzinoLoss: [0.7, 0.4, 0.25, 0.25],
    magazzinoRetreatBonus: [0, 0, 0, 0.1], // +10% zaino in ritirata al liv. 3
    expeditions: {
      breve: { timeSec: 30 * 60, cost: 0, rottami: [15, 30], carburante: [3, 8], viveri: [5, 10] },
      media: { timeSec: 4 * 3600, cost: 15, rottami: [80, 140], carburante: [20, 40], viveri: [10, 25] },
      lunga: { timeSec: 8 * 3600, cost: 30, rottami: [160, 260], carburante: [45, 80], viveri: [25, 50] },
    },
    tentsBase: 2, // tende all'inizio; +1 ogni 2 run, fino a tentsMax
    tentsMax: 7,
  },
  end: {
    eliminatedLoss: 0.7, // zaino perso se eliminato (o travolto dalla tempesta)
    resultDelayMs: 1200, // pausa prima della schermata finale
  },
  speeds: [1, 2, 4],
  camera: {
    minZoom: 0.35,
    maxZoom: 4,
    startZoom: 2.2,
    labelMinZoom: 1.6, // sotto questo zoom niente numeri di difesa
    dragThreshold: 8, // px schermo prima che un tap diventi trascinamento
  },
} as const;

export type TileType = 'terra' | 'deserto' | 'rovine' | 'tossica' | 'anomalia';
export type Resource = 'rottami' | 'carburante' | 'viveri';
export type UnitType = 'fanteria' | 'raider' | 'artiglieria';
