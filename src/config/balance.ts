// Tutti i numeri di bilanciamento vivono qui. Mai hardcoded altrove.

export const BALANCE = {
  map: {
    cols: 200, // griglia fine: molti più territori
    rows: 100,
    latMax: 84,
    latMin: -58, // niente Antartide
    hexSize: 6, // raggio esagono in pixel-mondo
    toxicClusters: 30,
    toxicClusterSize: [3, 14] as [number, number],
    ruinsCount: 190,
    desertLatBand: [12, 35] as [number, number], // |lat| in gradi
    desertChance: 0.7, // probabilità deserto dentro la fascia
    desertSprinkle: 0.04, // probabilità deserto fuori fascia
    minStartRegion: 800, // caselle minime della regione di partenza (ci stanno 4 fazioni)
  },
  tick: {
    ms: 500,
    troopsPerTile: 0.1, // troops += tiles * troopsPerTile (crescita originale, senza tetto)
  },
  // Insediamenti: le rovine possedute contano come caselle in più per la crescita e si difendono meglio.
  settlements: {
    growthTiles: 3,
  },
  // Soldati contro lavoratori: la quota di lavoratori non diventa truppa ma riempie lo zaino di risorse.
  // Parte da 0: senza toccare la leva le truppe crescono esattamente come la formula originale.
  workers: {
    steps: [0, 0.25, 0.5, 0.75],
    default: 0,
    lootPerWorker: 0.015, // risorse per ogni "truppa" mandata a lavorare
    mix: { metallo: 0.6, benzina: 0.2, cibo: 0.2 },
  },
  // Forza d'attacco: quota delle truppe che un'avanzata può spendere (il resto resta a difendere).
  attack: {
    ratios: [0.25, 0.5, 1],
    default: 0.5,
  },
  start: {
    troops: 65,
    radius: 2, // anello di caselle iniziali attorno alla partenza
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
    settlementDefense: 6, // gli insediamenti (rovine possedute) si difendono meglio
  },
  ai: {
    count: 3,
    startTroops: 55,
    growthMult: 1, // rispetto alla crescita del giocatore (con il 15% di lavoratori = 0,85 in truppe, come prima)
    actChance: 0.6, // probabilità di agire a ogni tick
    attacksPerAct: 1, // caselle piccole: più caselle per azione (stesso ritmo di prima in superficie)
    reserve: 1.25, // attacca solo se truppe > difesa * reserve
    playerBias: 0.7, // le caselle del giocatore "sembrano" più deboli: ce l'hanno con te
    graceMs: 60_000, // tempo di gioco prima che le IA attacchino il giocatore
    startDistance: [15, 33] as [number, number], // passi esagonali dal giocatore
    minDistanceBetween: 12, // passi esagonali tra fazioni IA
    releaseLootShare: 0.5, // quota di bottino rilasciata quando eliminata
    workers: 0.15, // anche le IA mandano gente a lavorare: più bottino da rubare
  },
  // Pedine: costano truppe del pool, si muovono casella per casella e conquistano dove passano.
  units: {
    fanteria: { cost: 60, hp: 60, attack: 6, range: 1, moveMs: 600, captureCost: 0.4 },
    ricognitori: { cost: 45, hp: 35, attack: 7, range: 1, moveMs: 300, captureCost: 0.5 },
    artiglieria: { cost: 70, hp: 30, attack: 9, range: 3, moveMs: 900, captureCost: 0.8 },
    strong: 1.75, // moltiplicatore danno contro l'unità che batti
    weak: 0.5, // moltiplicatore danno contro l'unità che ti batte
    cooldownMs: 6000, // ricarica della carta (tempo di gioco)
    maxPerFaction: 4,
    healPerTick: 1, // hp recuperati sul proprio territorio, fuori combattimento
    // captureCost: hp persi conquistando = difesa della casella * captureCost
  },
  aiUnits: {
    dominant: ['', 'ricognitori', 'artiglieria', 'fanteria'], // unità preferita per fazione (indice = fazione)
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
    weights: { metallo: 0.5, benzina: 0.25, cibo: 0.25 },
    metallo: [3, 8] as [number, number],
    benzina: [2, 4] as [number, number],
    cibo: [2, 5] as [number, number],
  },
  // Anomalie: caselle-segnale molto difese. Tenerne `victory.anomalies` = vittoria.
  anomalies: {
    count: 5,
    distance: [13, 47] as [number, number], // passi esagonali dalla partenza del giocatore
    minApart: 10,
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
    finalRadius: 5,
    unitDamage: 6, // hp per tick alle pedine nella cenere
  },
  // Avanzata: tocchi una casella lontana e il confine "cola" verso di lei, una casella ogni stepMs.
  flow: {
    stepMs: 65,
    reserve: 5, // truppe che l'avanzata lascia sempre in cassa
    giveUpSteps: 3, // si ferma se si allontana dal bersaglio di tanti passi (es. mare in mezzo)
  },
  // Nazioni e province (alla Call of War): ogni nazione reale è divisa in province con una città.
  // Prendi la città → le caselle neutrali della provincia si arrendono. La capitale dà truppe a chi la prende.
  provinces: {
    size: 12, // caselle per provincia (circa)
    cityDefenseMult: 2, // difesa città = base × mult + bonus
    cityDefenseBonus: 6,
    capitalDefenseBonus: 8,
    capitalTroops: 110, // a chi prende una capitale (la prima volta)
    aiCityAttraction: 0.6, // le città sembrano più deboli all'IA: le cerca
    nameMinTiles: 20, // nomi delle nazioni solo per le più grandi
    minTilesForCity: 6, // staterelli più piccoli: niente città né capitale (meno simboli sulla mappa)
    namesMaxZoom: 2.6, // sopra questo zoom (vista tattica) i nomi delle nazioni spariscono
  },
  // Navi: tocchi una costa che non raggiungi via terra; la nave parte dalla tua costa più vicina con la forza d'attacco.
  boats: {
    stepMs: 130, // tempo per attraversare una casella di mare
    maxSea: 50, // caselle di mare massime per una traversata
    maxInFlight: 3,
    minTroops: 10,
  },
  // Nebbia di guerra: vedi solo vicino a territorio, pedine e navi. Le anomalie si vedono sempre (emettono il segnale).
  fog: {
    territory: 6,
    unit: 5,
    boat: 3,
    shade: false, // velo scuro sulle zone non viste (tolto: la nebbia nasconde solo i nemici)
    seenAlpha: 0.45, // già esplorato ma ora fuori vista
    unseenAlpha: 0.88, // mai visto
  },
  // Prima run guidata: 1 sola IA che non attacca, niente tempesta né eventi, si vince con goalTiles caselle.
  tutorial: {
    aiCount: 1,
    goalTiles: 110,
    aiGrowthMult: 0.5,
  },
  // Traguardi di territorio che meritano un cartello
  milestones: [60, 125, 250, 500, 1000],
  // Eventi stile Reigns (servono la Radio): una carta con 2 scelte, la run è in pausa mentre è aperta.
  events: {
    firstMs: 45_000,
    everyMs: 90_000,
    jitterMs: 15_000,
  },
  // Accampamento: 1 cantiere alla volta, timer in tempo reale (secondi). I timer non bloccano mai le run.
  camp: {
    buildings: {
      arsenale: [
        { cost: { metallo: 40, benzina: 10, cibo: 0 }, timeSec: 60 },
        { cost: { metallo: 120, benzina: 40, cibo: 0 }, timeSec: 180 },
        { cost: { metallo: 250, benzina: 90, cibo: 0 }, timeSec: 300 },
      ],
      comando: [
        { cost: { metallo: 30, benzina: 0, cibo: 15 }, timeSec: 60 },
        { cost: { metallo: 90, benzina: 20, cibo: 40 }, timeSec: 180 },
        { cost: { metallo: 200, benzina: 60, cibo: 80 }, timeSec: 300 },
      ],
      deposito: [
        { cost: { metallo: 50, benzina: 0, cibo: 20 }, timeSec: 90 },
        { cost: { metallo: 140, benzina: 0, cibo: 60 }, timeSec: 240 },
        { cost: { metallo: 260, benzina: 60, cibo: 120 }, timeSec: 300 },
      ],
    },
    // effetti per livello (indice = livello, 0 = non costruito)
    arsenaleUnits: [['fanteria'], ['fanteria', 'ricognitori'], ['fanteria', 'ricognitori', 'artiglieria'], ['fanteria', 'ricognitori', 'artiglieria']],
    arsenaleHpMult: [1, 1, 1, 1.25],
    comandoEvents: [0, 1, 2, 2], // 0 = niente eventi, 1 = comuni, 2 = anche rari
    comandoWarnBonusMs: [0, 0, 0, 30_000],
    depositoLoss: [0.7, 0.4, 0.25, 0.25],
    depositoRetreatBonus: [0, 0, 0, 0.1], // +10% zaino in ritirata al liv. 3
    expeditions: {
      breve: { timeSec: 30 * 60, cost: 0, metallo: [15, 30], benzina: [3, 8], cibo: [5, 10] },
      media: { timeSec: 4 * 3600, cost: 15, metallo: [80, 140], benzina: [20, 40], cibo: [10, 25] },
      lunga: { timeSec: 8 * 3600, cost: 30, metallo: [160, 260], benzina: [45, 80], cibo: [25, 50] },
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
    minZoom: 0.5,
    maxZoom: 5,
    startZoom: 2.4,
    labelMinZoom: 2.3, // sotto questo zoom niente numeri di difesa
    dragThreshold: 8, // px schermo prima che un tap diventi trascinamento
  },
} as const;

export type TileType = 'terra' | 'deserto' | 'rovine' | 'tossica' | 'anomalia';
export type Resource = 'metallo' | 'benzina' | 'cibo';
export type UnitType = 'fanteria' | 'ricognitori' | 'artiglieria';
