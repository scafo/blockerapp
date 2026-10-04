// Tutti i numeri di bilanciamento vivono qui. Mai hardcoded altrove.

export const BALANCE = {
  map: {
    cols: 640, // griglia fine (invisibile): pedine, navi, nebbia; le forme vengono dalla mappa vera (scripts/build-map.ts)
    rows: 320,
    latMax: 84,
    latMin: -58, // niente Antartide
    hexSize: 2.5, // raggio esagono in pixel-mondo (griglia fitta: stessa mappa in pixel, più province)
    ruinsCount: 1620,
    minStartRegion: 6400, // caselle minime della regione di partenza (ci stanno 4 fazioni)
  },
  tick: {
    ms: 500,
    troopsPerTile: 0.045, // troops += caselle (pesate dal terreno) * troopsPerTile: crescita lineare, senza tetto, più lenta
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
    troops: 120, // si parte con la provincia della partenza: la prima conquista è subito
  },
  defense: {
    terra: 6, // una provincia (~11 caselle) costa la somma delle sue caselle (× terreno)
    rovine: 12,
    anomalia: 160, // la provincia con l'anomalia costa circa il doppio
    variance: 0.3, // ± percentuale casuale per casella
  },
  // Caselle possedute: difesa = base * mult + min(truppe/caselle * garrison, garrisonMax)
  owned: {
    defenseMult: 1,
    garrison: 0.5,
    garrisonMax: 8, // niente fortezze imbattibili accumulando truppe
    settlementDefense: 6, // gli insediamenti (rovine possedute) si difendono meglio
  },
  ai: {
    count: 3,
    // forza, ritmo, tregua e offensive delle IA dipendono dal fronte (vedi `fronts`)
    attacksPerAct: 1, // caselle piccole: più caselle per azione (stesso ritmo di prima in superficie)
    reserve: 1.25, // attacca solo se truppe > difesa * reserve
    playerBias: 0.9, // le province del giocatore "sembrano" un po' più deboli
    startDistance: [32, 69] as [number, number], // passi esagonali dal giocatore
    minDistanceBetween: 26, // passi esagonali tra fazioni IA
    releaseLootShare: 0.5, // quota di bottino rilasciata quando eliminata
    workers: 0.15, // anche le IA mandano gente a lavorare: più bottino da rubare
  },
  // Pedine: costano truppe del pool, si muovono casella per casella e conquistano dove passano.
  units: {
    fanteria: { cost: 60, hp: 60, attack: 6, range: 1, moveMs: 373, captureCost: 0.4 },
    ricognitori: { cost: 45, hp: 35, attack: 7, range: 1, moveMs: 186, captureCost: 0.5 },
    artiglieria: { cost: 70, hp: 30, attack: 9, range: 4, moveMs: 563, captureCost: 0.8 },
    // secondo gruppo dell'Arsenale
    corazzati: { cost: 90, hp: 110, attack: 9, range: 1, moveMs: 277, captureCost: 0.25 }, // travolgono fanteria e ricognitori
    genio: { cost: 50, hp: 50, attack: 4, range: 1, moveMs: 433, captureCost: 0.3 }, // fortifica le caselle attorno, ferma i corazzati
    cannoniera: { cost: 85, hp: 70, attack: 8, range: 4, moveMs: 217, captureCost: 0 }, // nave: copre le coste
    // unità uniche delle civiltà (arsenale liv. 6)
    legionari: { cost: 80, hp: 90, attack: 7, range: 1, moveMs: 407, captureCost: 0.35 }, // Imperium
    guardia: { cost: 55, hp: 75, attack: 6, range: 1, moveMs: 373, captureCost: 0.3 }, // Republica
    prototipo: { cost: 75, hp: 28, attack: 11, range: 6, moveMs: 624, captureCost: 0.8 }, // Aristocrazia
    infiltrati: { cost: 40, hp: 32, attack: 7, range: 1, moveMs: 165, captureCost: 0.2 }, // Cabal
    deckSize: 4, // in campagna porti 4 truppe delle sbloccate (il mazzo, come in Clash)
    fortifyDefense: 8, // genio: difesa in più sulle sue caselle e su quelle accanto
    supportRange: 4, // cannoniera: caselle di costa coperte dal fuoco
    supportCostMult: 0.7, // costo per prendere una casella coperta dalla cannoniera
    strong: 1.75, // moltiplicatore danno contro l'unità che batti
    weak: 0.5, // moltiplicatore danno contro l'unità che ti batte
    cooldownMs: 6000, // ricarica della carta (tempo di gioco)
    maxPerFaction: 4,
    healPerTick: 1, // hp recuperati sul proprio territorio, fuori combattimento
    // captureCost: hp persi conquistando = difesa della casella * captureCost
  },
  // Abilità a ricarica (Arsenale liv. 5): non sono unità
  abilities: {
    ricognizione: { cooldownMs: 40_000, radius: 15, durationMs: 15_000 }, // ricognizione aerea: svela la zona
    bombardamento: { cooldownMs: 60_000, radius: 1, unitRadius: 4, delayMs: 1200, unitDamage: 40, troopsPerTile: 3 }, // la provincia nemica colpita torna neutrale
  },
  aiUnits: {
    dominant: ['', 'ricognitori', 'artiglieria', 'fanteria'], // unità preferita per fazione (indice = fazione)
    dominantChance: 0.7,
    spawnEveryMs: 25_000,
    spawnJitterMs: 5_000,
    reserve: 1.5, // schiera solo se truppe > costo * reserve
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
    distance: [27, 99] as [number, number], // passi esagonali dalla partenza del giocatore
    minApart: 21,
  },
  // Terreno vero (Natural Earth, scripts/build-map.ts): difesa delle caselle, crescita delle truppe, lentezza di pedine e avanzata,
  // risorsa prodotta ogni minuto da ogni provincia posseduta (le fabbriche la moltiplicano).
  terrain: {
    pianura: { defense: 1, growth: 1, move: 1, res: 'cibo', perMin: 0.22 },
    colline: { defense: 1.35, growth: 0.85, move: 1.4, res: 'metallo', perMin: 0.18 },
    montagne: { defense: 1.9, growth: 0.55, move: 2, res: 'metallo', perMin: 0.32 },
    deserto: { defense: 0.7, growth: 0.45, move: 1.2, res: 'benzina', perMin: 0.28 },
  } as Record<Terrain, TerrainDef>,
  // Sovraestensione: ogni provincia posseduta rende le prossime un po' più care (logistica). Frena la valanga: l'impero cresce
  // veloce all'inizio e poi a ritmo costante, così una campagna dura davvero 10–30 minuti.
  overextension: 0.04,
  victory: {
    mapShare: 0.6, // quota della regione di partenza (terra attraversabile)
    anomalies: 3,
    bonus: 0.5, // +50% dello zaino in caso di vittoria
  },
  // Fine della campagna: allo scadere della durata scelta vince chi ha più territorio (avviso nell'ultimo minuto).
  campaign: {
    warnMs: 60_000,
  },

  // Avanzata: tocchi una casella lontana e il confine "cola" verso di lei, una casella ogni stepMs.
  // Provincia completa (tutte le sue caselle tue): ricompensa una volta per provincia e per fazione
  provinceReward: { troopsPerTile: 0.3, lootPerTile: 0.05 }, // bottino diviso metà metallo, un quarto benzina e cibo
  // Offensive nemiche: un'IA confinante concentra gli attacchi su di te per un po', con preavviso
  offensive: {
    jitterMs: 20_000, warnMs: 8_000, durationMs: 30_000, // primo e intervallo dipendono dal fronte
    attacksPerAct: 2, playerBias: 0.15, troopsBonus: 40, troopsPerTile: 0.8,
  },
  flow: {
    stepMs: 520, // una provincia alla volta (× lentezza del terreno)
    reserve: 5, // truppe che l'avanzata lascia sempre in cassa
    giveUpSteps: 14, // si ferma se si allontana dal bersaglio di tanti passi esagonali (es. mare in mezzo)
  },
  // Nazioni e province (alla Call of War): ogni nazione reale è divisa in province con una città.
  // Prendi la città → le caselle neutrali della provincia si arrendono. La capitale dà truppe a chi la prende.
  provinces: {
    size: 12, // caselle per provincia (circa; la carta è in src/data/worldmap.json)
    cityDefenseMult: 2, // difesa città = base × mult + bonus
    cityDefenseBonus: 6,
    capitalDefenseBonus: 8,
    capitalTroops: 110, // a chi prende una capitale (la prima volta)
    aiCityAttraction: 0.6, // le città sembrano più deboli all'IA: le cerca
    nameMinTiles: 40, // nomi delle nazioni solo per le più grandi
    minTilesForCity: 4, // province minuscole (isolette): niente città
    namesMaxZoom: 3.0, // sopra questo zoom (vista tattica) i nomi delle nazioni spariscono
  },
  // Navi: tocchi una costa che non raggiungi via terra; la nave parte dalla tua costa più vicina con la forza d'attacco.
  boats: {
    stepMs: 63, // tempo per attraversare una casella di mare
    maxSea: 105, // caselle di mare massime per una traversata
    maxInFlight: 3,
    minTroops: 10,
  },
  // Nebbia di guerra: vedi solo vicino a territorio, pedine e navi. Le anomalie si vedono sempre (emettono il segnale).
  fog: {
    territory: 12,
    unit: 10,
    boat: 6,
    shade: false, // velo scuro sulle zone non viste (tolto: la nebbia nasconde solo i nemici)
    seenAlpha: 0.45, // già esplorato ma ora fuori vista
    unseenAlpha: 0.88, // mai visto
  },
  // Prima run guidata: 1 sola IA che non attacca, senza limite di tempo né eventi, si vince con goalProvinces province.
  tutorial: {
    aiCount: 1,
    goalProvinces: 7, // province da tenere per vincere la run guidata
    aiGrowthMult: 0.5,
  },
  // Traguardi di territorio che meritano un cartello
  milestones: [10, 25, 50, 100, 200], // province
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
        { cost: { metallo: 380, benzina: 160, cibo: 40 }, timeSec: 600 }, // liv. 4–6: timer più lunghi (spec: fino a 2 h)
        { cost: { metallo: 520, benzina: 240, cibo: 80 }, timeSec: 1200 },
        { cost: { metallo: 700, benzina: 320, cibo: 140 }, timeSec: 1800 },
      ],
      comando: [
        { cost: { metallo: 30, benzina: 0, cibo: 15 }, timeSec: 60 },
        { cost: { metallo: 90, benzina: 20, cibo: 40 }, timeSec: 180 },
        { cost: { metallo: 200, benzina: 60, cibo: 80 }, timeSec: 300 },
        { cost: { metallo: 340, benzina: 120, cibo: 140 }, timeSec: 600 },
        { cost: { metallo: 480, benzina: 200, cibo: 200 }, timeSec: 1200 },
      ],
      deposito: [
        { cost: { metallo: 50, benzina: 0, cibo: 20 }, timeSec: 90 },
        { cost: { metallo: 140, benzina: 0, cibo: 60 }, timeSec: 240 },
        { cost: { metallo: 260, benzina: 60, cibo: 120 }, timeSec: 300 },
      ],
      laboratorio: [
        { cost: { metallo: 60, benzina: 30, cibo: 20 }, timeSec: 90 },
        { cost: { metallo: 150, benzina: 70, cibo: 50 }, timeSec: 240 },
        { cost: { metallo: 280, benzina: 120, cibo: 100 }, timeSec: 300 },
      ],
      radar: [
        { cost: { metallo: 40, benzina: 20, cibo: 0 }, timeSec: 60 },
        { cost: { metallo: 110, benzina: 50, cibo: 0 }, timeSec: 180 },
        { cost: { metallo: 220, benzina: 90, cibo: 0 }, timeSec: 300 },
      ],
    },
    radarFogBonus: [0, 0, 1, 2], // vista in più nelle campagne (liv. 1 = registro delle campagne)
    // effetti per livello (indice = livello, 0 = non costruito)
    // Arsenale: ogni livello apre ricerche del ramo Armamenti (tech.*.arsenale); al liv. 6 unità +25% vita
    arsenaleHpMult: [1, 1, 1, 1, 1, 1, 1.25],
    arsenaleUnique: 6, // l'unità unica si ricerca con l'Arsenale al liv. 6
    comandoEvents: [0, 1, 2, 2, 2, 2], // 0 = niente eventi, 1 = comuni, 2 = anche rari
    comandoTimeBonusMs: [0, 0, 0, 30_000, 30_000, 30_000], // rete di allerta: 30 s in più per ogni campagna
    comandoMaxUnitsBonus: [0, 0, 0, 0, 1, 1], // liv. 4: un'unità in più in campo
    comandoGrowthMult: [1, 1.04, 1.08, 1.12, 1.16, 1.2], // il Comando organizza la leva: crescita truppe in campagna
    comandoAbilityCdMult: [1, 1, 1, 1, 1, 0.75], // liv. 5: abilità -25% ricarica
    depositoLoss: [0.7, 0.4, 0.25, 0.25],
    depositoCap: [500, 1000, 2000, 4000], // capienza per risorsa (alla Clash): oltre si perde
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
    eliminatedLoss: 0.7, // zaino perso se eliminato
    resultDelayMs: 1200, // pausa prima della schermata finale
  },
  // effetti grafici della mappa (Figma: heatmap luminosa). bloom = bagliore su tutta la mappa (spento sui telefoni deboli)
  fx: { bloom: null as { blur: number; strength: number; steps: number } | null }, // niente bagliore da monitor
  speeds: [1, 2, 4],
  // Campagne a durata scelta (Figma: "campagne di durata più lunga portano più risorse")
  campaigns: {
    breve: { durationMs: 600_000, lootMult: 0.7 },
    standard: { durationMs: 1_200_000, lootMult: 1 },
    lunga: { durationMs: 1_800_000, lootMult: 1.4 },
  },
  // Fronti (difficoltà crescente, alla Clash): il successivo si sblocca vincendo il precedente. Le IA si rafforzano (crescita,
  // truppe, unità, difese, bunker, offensive): per andare avanti servono Arsenale, ricerche e postazioni. power = potenza consigliata.
  fronts: [
    { name: 'Prima linea', power: 0, lootMult: 1, aiGrowthMult: 0.85, aiStartTroops: 40, aiActChance: 0.07, aiUnits: ['fanteria'], aiUnitHpMult: 0.9, aiDefenseMult: 1, aiBunkers: 0, aiBunkerEveryMs: 0, graceMs: 240_000, offensiveFirstMs: 420_000, offensiveEveryMs: 210_000, maxAiUnits: 1 },
    { name: 'Valichi del Nord', power: 20, lootMult: 1.3, aiGrowthMult: 0.95, aiStartTroops: 55, aiActChance: 0.085, aiUnits: ['fanteria', 'ricognitori'], aiUnitHpMult: 1, aiDefenseMult: 1.05, aiBunkers: 1, aiBunkerEveryMs: 0, graceMs: 210_000, offensiveFirstMs: 380_000, offensiveEveryMs: 190_000, maxAiUnits: 2 },
    { name: 'Terre di cenere', power: 45, lootMult: 1.7, aiGrowthMult: 1.05, aiStartTroops: 75, aiActChance: 0.1, aiUnits: ['fanteria', 'ricognitori', 'artiglieria', 'genio'], aiUnitHpMult: 1.1, aiDefenseMult: 1.12, aiBunkers: 2, aiBunkerEveryMs: 180_000, graceMs: 180_000, offensiveFirstMs: 330_000, offensiveEveryMs: 165_000, maxAiUnits: 2 },
    { name: 'Fronte del Lume', power: 75, lootMult: 2.2, aiGrowthMult: 1.15, aiStartTroops: 100, aiActChance: 0.115, aiUnits: ['fanteria', 'ricognitori', 'artiglieria', 'genio', 'corazzati'], aiUnitHpMult: 1.2, aiDefenseMult: 1.2, aiBunkers: 4, aiBunkerEveryMs: 140_000, graceMs: 150_000, offensiveFirstMs: 280_000, offensiveEveryMs: 145_000, maxAiUnits: 3 },
    { name: 'Cielo aperto', power: 110, lootMult: 2.8, aiGrowthMult: 1.25, aiStartTroops: 130, aiActChance: 0.13, aiUnits: ['fanteria', 'ricognitori', 'artiglieria', 'genio', 'corazzati'], aiUnitHpMult: 1.35, aiDefenseMult: 1.3, aiBunkers: 6, aiBunkerEveryMs: 110_000, graceMs: 120_000, offensiveFirstMs: 240_000, offensiveEveryMs: 125_000, maxAiUnits: 3 },
    { name: "L'Avvento", power: 150, lootMult: 3.5, aiGrowthMult: 1.35, aiStartTroops: 170, aiActChance: 0.145, aiUnits: ['fanteria', 'ricognitori', 'artiglieria', 'genio', 'corazzati'], aiUnitHpMult: 1.5, aiDefenseMult: 1.4, aiBunkers: 9, aiBunkerEveryMs: 90_000, graceMs: 100_000, offensiveFirstMs: 200_000, offensiveEveryMs: 110_000, maxAiUnits: 4 },
  ] as FrontDef[],
  // Potenza del giocatore: punti per livello di postazione e per ricerca (si confronta con quella consigliata del fronte)
  power: { arsenale: 8, comando: 6, laboratorio: 4, deposito: 3, radar: 2, tech: 3 },
  // Costruzioni nelle province (alla Call of War): si pagano in truppe (lo zaino resta bottino da portare a casa), tempo di gioco.
  // Ogni costruzione già avviata rende la prossima più cara (priceStep). Restano alla provincia anche se cambia padrone
  // (le fabbriche nemiche si conquistano). prodAdd = risorse/min in più della provincia; tech = ricerca che le sblocca ('' = subito).
  works: {
    fabbrica: { troops: 35, timeMs: 30_000, prodAdd: 1, defenseMult: 1, growthTiles: 0, tech: '' },
    bunker: { troops: 45, timeMs: 40_000, prodAdd: 0, defenseMult: 1.7, growthTiles: 0, tech: '' },
    caserma: { troops: 60, timeMs: 45_000, prodAdd: 0, defenseMult: 1, growthTiles: 10, tech: 'addestramento' },
  } as Record<WorkId, WorkDef>,
  worksPriceStep: 0.2,
  // Modalità test (HQ → tasto TEST): sblocca tutto e azzera i timer per provare il gioco senza aspettare
  test: { stash: 9999, startTroops: 1000, abilityCdMult: 0.25, runs: 3, wins: 3, expeditions: 3 },
  progression: {
    campaignChoiceAfterRuns: 1, // la durata si sceglie dopo la run guidata
    civChoiceAfterRuns: 3, // le civiltà dopo qualche campagna (un sistema nuovo alla volta)
  },
  // Civiltà: bonus (sempre) + edificio unico (sugli insediamenti, cioè rovine possedute). Testi in src/data/civs.json.
  civs: {
    republica: { unit: 'guardia', unlock: null, bonus: { ownedDefenseMult: 1.2 }, building: { settlementDefense: 6 } },
    imperium: { unit: 'legionari', unlock: null, bonus: { neutralCostMult: 0.85 }, building: { settlementGrowth: 2 } },
    aristocrazia: { unit: 'prototipo', unlock: { wins: 3 }, bonus: { unitCostMult: 0.7, growthMult: 0.92 }, building: { fogBonus: 2, anomalyDefenseMult: 0.8 } },
    cabal: { unit: 'infiltrati', unlock: { expeditions: 3 }, bonus: { lootMult: 1.3 }, building: { settlementLoot: 0.25 } },
  },
  // Laboratorio: ricerche (una alla volta, a tempo reale). tier = livello di laboratorio richiesto (max 3). Testi in src/data/tech.json.
  // Albero della ricerca (Laboratorio + Arsenale): una ricerca alla volta, a tempo reale.
  // req = ricerche richieste; col/row = posizione nell'albero; arsenale = livello dell'Arsenale richiesto (ramo Armamenti),
  // tier = grado per il livello del Laboratorio (altri rami). unit/ability/unique = cosa sblocca in campagna.
  tech: {
    ricognitori: { branch: 'armamenti', col: 0, row: 0, req: [], arsenale: 1, cost: { metallo: 30, benzina: 10, cibo: 0 }, timeSec: 45, unit: 'ricognitori' },
    artiglieria: { branch: 'armamenti', col: 1, row: 0, req: ['ricognitori'], arsenale: 2, cost: { metallo: 60, benzina: 20, cibo: 0 }, timeSec: 90, unit: 'artiglieria' },
    corazzati: { branch: 'armamenti', col: 2, row: 0, req: ['artiglieria'], arsenale: 3, cost: { metallo: 120, benzina: 50, cibo: 0 }, timeSec: 150, unit: 'corazzati' },
    munizioni: { branch: 'armamenti', col: 3, row: 0, req: ['corazzati'], arsenale: 3, cost: { metallo: 140, benzina: 40, cibo: 0 }, timeSec: 180, mods: { unitAttackMult: 1.15 } },
    ricognizione: { branch: 'armamenti', col: 4, row: 0, req: ['munizioni'], arsenale: 5, cost: { metallo: 180, benzina: 100, cibo: 0 }, timeSec: 240, ability: 'ricognizione' },
    bombardamento: { branch: 'armamenti', col: 5, row: 0, req: ['ricognizione'], arsenale: 5, cost: { metallo: 240, benzina: 140, cibo: 0 }, timeSec: 300, ability: 'bombardamento' },
    unica: { branch: 'armamenti', col: 6, row: 0, req: ['bombardamento', 'corazze'], arsenale: 6, cost: { metallo: 300, benzina: 160, cibo: 60 }, timeSec: 360, unique: true },
    genio: { branch: 'armamenti', col: 2, row: 1, req: ['artiglieria'], arsenale: 3, cost: { metallo: 90, benzina: 20, cibo: 20 }, timeSec: 120, unit: 'genio' },
    cannoniera: { branch: 'armamenti', col: 3, row: 1, req: ['genio'], arsenale: 4, cost: { metallo: 160, benzina: 80, cibo: 0 }, timeSec: 200, unit: 'cannoniera' },
    corazze: { branch: 'armamenti', col: 4, row: 1, req: ['cannoniera'], arsenale: 4, cost: { metallo: 200, benzina: 60, cibo: 20 }, timeSec: 240, mods: { unitHpMult: 1.1 } },
    addestramento: { branch: 'esercito', col: 0, row: 2, req: [], tier: 1, cost: { metallo: 40, benzina: 20, cibo: 20 }, timeSec: 120, mods: { unitHpMult: 1.15 } },
    elite: { branch: 'esercito', col: 1, row: 2, req: ['addestramento'], tier: 2, cost: { metallo: 110, benzina: 50, cibo: 40 }, timeSec: 240, mods: { unitCostMult: 0.85 } },
    assalto: { branch: 'esercito', col: 2, row: 2, req: ['elite'], tier: 3, cost: { metallo: 220, benzina: 90, cibo: 80 }, timeSec: 360, mods: { attackCostMult: 0.85 } },
    strade: { branch: 'logistica', col: 0, row: 3, req: [], tier: 1, cost: { metallo: 40, benzina: 30, cibo: 10 }, timeSec: 120, mods: { flowSpeedMult: 1.25 } },
    rifornimenti: { branch: 'logistica', col: 1, row: 3, req: ['strade'], tier: 2, cost: { metallo: 80, benzina: 40, cibo: 70 }, timeSec: 240, mods: { startTroops: 40 } },
    ferrovie: { branch: 'logistica', col: 2, row: 3, req: ['rifornimenti'], tier: 3, cost: { metallo: 200, benzina: 120, cibo: 60 }, timeSec: 360, mods: { growthMult: 1.12 } },
    estrazione: { branch: 'economia', col: 0, row: 4, req: [], tier: 1, cost: { metallo: 30, benzina: 20, cibo: 30 }, timeSec: 120, mods: { expeditionTimeMult: 0.75 } },
    industria: { branch: 'economia', col: 1, row: 4, req: ['estrazione'], tier: 2, cost: { metallo: 120, benzina: 40, cibo: 40 }, timeSec: 240, mods: { capitalTroopsMult: 1.5 } },
    pianificazione: { branch: 'economia', col: 2, row: 4, req: ['industria'], tier: 3, cost: { metallo: 160, benzina: 80, cibo: 120 }, timeSec: 300, mods: { prodMult: 1.4 } },
    trincee: { branch: 'difesa', col: 0, row: 5, req: [], tier: 1, cost: { metallo: 50, benzina: 10, cibo: 20 }, timeSec: 120, mods: { ownedDefenseMult: 1.1 } },
    radar: { branch: 'difesa', col: 1, row: 5, req: ['trincee'], tier: 2, cost: { metallo: 100, benzina: 60, cibo: 20 }, timeSec: 240, mods: { fogBonus: 2 } },
    fortezze: { branch: 'difesa', col: 2, row: 5, req: ['radar'], tier: 3, cost: { metallo: 240, benzina: 60, cibo: 40 }, timeSec: 300, mods: { bunkerMult: 1.4, ownedDefenseMult: 1.1 } },
    segnale: { branch: 'caduta', col: 0, row: 6, req: [], tier: 1, cost: { metallo: 30, benzina: 30, cibo: 30 }, timeSec: 150, mods: { anomalyDefenseMult: 0.85 } },
    frammenti: { branch: 'caduta', col: 1, row: 6, req: ['segnale'], tier: 2, cost: { metallo: 90, benzina: 60, cibo: 50 }, timeSec: 240, mods: { lootMult: 1.1 } },
    prototipo: { branch: 'caduta', col: 2, row: 6, req: ['frammenti'], tier: 3, cost: { metallo: 180, benzina: 100, cibo: 80 }, timeSec: 300, mods: { unitHpMult: 1.1 } },
    caduta: { branch: 'caduta', col: 3, row: 6, req: ['prototipo'], tier: 3, cost: { metallo: 300, benzina: 160, cibo: 120 }, timeSec: 300, mods: { anomaliesNeeded: -1 } },
  } as Record<string, TechDef>,

  camera: {
    minZoom: 0.75,
    maxZoom: 13,
    startZoom: 4.6, // si vedono più province attorno alla partenza
    labelMinZoom: 3.2, // sotto questo zoom niente numeri di difesa
    dragThreshold: 8, // px schermo prima che un tap diventi trascinamento
  },
} as const;

export interface TechDef {
  branch: string;
  col: number;
  row: number;
  req: string[];
  arsenale?: number;
  tier?: number;
  cost: { metallo: number; benzina: number; cibo: number };
  timeSec: number;
  mods?: Record<string, number>;
  unit?: UnitType;
  ability?: AbilityType;
  unique?: boolean;
}

export type TileType = 'terra' | 'rovine' | 'anomalia';
export type WorkId = 'fabbrica' | 'bunker' | 'caserma';
export interface WorkDef {
  troops: number; timeMs: number; prodAdd: number; defenseMult: number; growthTiles: number; tech: string;
}
export interface FrontDef {
  name: string; power: number; lootMult: number;
  aiGrowthMult: number; aiStartTroops: number; aiActChance: number; aiUnits: UnitType[]; aiUnitHpMult: number; aiDefenseMult: number;
  aiBunkers: number; aiBunkerEveryMs: number; graceMs: number; offensiveFirstMs: number; offensiveEveryMs: number; maxAiUnits: number;
}
export type Terrain = 'pianura' | 'colline' | 'montagne' | 'deserto';
export interface TerrainDef { defense: number; growth: number; move: number; res: Resource; perMin: number }
export type Resource = 'metallo' | 'benzina' | 'cibo';
export type UnitType = 'fanteria' | 'ricognitori' | 'artiglieria' | 'corazzati' | 'genio' | 'cannoniera' | 'legionari' | 'guardia' | 'prototipo' | 'infiltrati';
export type AbilityType = 'ricognizione' | 'bombardamento';
export type CivId = 'republica' | 'imperium' | 'aristocrazia' | 'cabal';
export type CampaignId = 'breve' | 'standard' | 'lunga';
