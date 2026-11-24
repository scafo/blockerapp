// Tutti i numeri di bilanciamento vivono qui. Mai hardcoded altrove.

export const BALANCE = {
  map: {
    cols: 960, // griglia fine (invisibile): pedine, navi, nebbia; le forme vengono dalla mappa vera (scripts/build-map.ts)
    rows: 612, // Mercatore: righe in più perché la carta resti proporzionata (larghezza / altezza ≈ 1,81)
    latMax: 78, // oltre, il Mercatore allunga all'infinito
    latMin: -58, // niente Antartide
    hexSize: 5 / 3, // raggio esagono in pixel-mondo (griglia fitta: stessa mappa in pixel, più province)
    ruinsCount: 4860,
    minStartRegion: 14400, // caselle minime della regione di partenza (ci stanno 4 fazioni)
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
    troops: 180, // si parte con la provincia della partenza e truppe per due o tre conquiste subito
    minGrowth: 0.85, // partenza (tua e degli imperi) in pianura o colline...
    minNearGrowth: 0.75, // ...con le province vicine che crescono bene in media
  },
  defense: {
    terra: 6, // una provincia (~11 caselle) costa la somma delle sue caselle (× terreno)
    rovine: 12,
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
    attacksPerAct: 3, // province per azione: gli imperi si allargano di continuo (Nico)
    reserve: 1.1, // attacca solo se truppe > difesa * reserve (più basso = IA più aggressive)
    playerBias: 0.8, // le province del giocatore "sembrano" più deboli: le IA puntano di più su di te
    minDistanceBetween: 23, // passi esagonali tra fazioni IA
    releaseLootShare: 0.5, // quota di bottino rilasciata quando eliminata
    workers: 0.15, // anche le IA mandano gente a lavorare: più bottino da rubare
  },
  // Pedine: costano truppe del pool, si muovono casella per casella e conquistano dove passano.
  units: {
    fanteria: { cost: 60, hp: 60, attack: 6, range: 1, moveMs: 429, captureCost: 0.4, res: 'cibo', resCost: 6 },
    ricognitori: { cost: 45, hp: 35, attack: 7, range: 1, moveMs: 214, captureCost: 0.5, res: 'benzina', resCost: 5 },
    artiglieria: { cost: 70, hp: 30, attack: 9, range: 4, moveMs: 647, captureCost: 0.8, res: 'metallo', resCost: 8 },
    // secondo gruppo dell'Arsenale
    corazzati: { cost: 90, hp: 110, attack: 9, range: 1, moveMs: 319, captureCost: 0.25, res: 'benzina', resCost: 10 }, // travolgono fanteria e ricognitori
    genio: { cost: 50, hp: 50, attack: 4, range: 1, moveMs: 498, captureCost: 0.3, res: 'metallo', resCost: 5 }, // fortifica le caselle attorno, ferma i corazzati
    cannoniera: { cost: 85, hp: 70, attack: 8, range: 4, moveMs: 250, captureCost: 0, res: 'benzina', resCost: 9 }, // nave: copre le coste
    // unità uniche delle civiltà (arsenale liv. 6)
    legionari: { cost: 80, hp: 90, attack: 7, range: 1, moveMs: 468, captureCost: 0.35, res: 'cibo', resCost: 8 }, // Imperium
    guardia: { cost: 55, hp: 75, attack: 6, range: 1, moveMs: 429, captureCost: 0.3, res: 'cibo', resCost: 6 }, // Republica
    prototipo: { cost: 75, hp: 28, attack: 11, range: 6, moveMs: 718, captureCost: 0.8, res: 'metallo', resCost: 10 }, // Aristocrazia
    infiltrati: { cost: 40, hp: 32, attack: 7, range: 1, moveMs: 190, captureCost: 0.2, res: 'benzina', resCost: 4 }, // Cabal
    fortifyDefense: 8, // genio: difesa in più sulle sue caselle e su quelle accanto
    supportRange: 4, // cannoniera: caselle di costa coperte dal fuoco
    supportCostMult: 0.7, // costo per prendere una casella coperta dalla cannoniera
    strong: 1.75, // moltiplicatore danno contro l'unità che batti
    weak: 0.5, // moltiplicatore danno contro l'unità che ti batte
    cooldownMs: 6000, // ricarica della carta (tempo di gioco)
    maxPerFaction: 12, // pedine per fazione IA (Nico: nemici più forti, tutti schierano truppe)
    healPerTick: 1, // hp recuperati sul proprio territorio, fuori combattimento
    // captureCost: hp persi conquistando = difesa della casella * captureCost
    // res/resCost: come in Call of War ogni reparto costa truppe + una risorsa fissa dallo zaino (solo il giocatore)
  },
  // Comandi delle pedine (2026-10-12, Nico): unire/dividere, comportamento, fronte, rifornimento e logoramento
  unitOps: {
    mergeMax: 4, // reparti uniti al massimo in una pedina
    mergeRange: 3, // caselle entro cui due pedine si possono unire
    autoRadius: 12, // "attacca da sola": cerca nemici entro queste caselle
    autoEveryMs: 1500, // ogni quanto una pedina ferma cerca un bersaglio o il suo posto sul fronte
    outsideSupply: 0.85, // fuori dal territorio: rifornimento della tua provincia accanto × questo
    farSupply: 0.45, // a due province dal tuo territorio
    attritionBelow: 0.4, // sotto questo rifornimento la pedina perde vita
    attritionPerTick: 0.8, // vita persa per tick a rifornimento zero
    healMinSupply: 0.6, // si cura solo se rifornita almeno così
  },
  // Rancio (cibo dello zaino): l'esercito mangia; con cibo cresce di più, senza cresce meno
  food: { perProvPerMin: 0.04, freeProvinces: 3, fedGrowth: 1.15, hungryGrowth: 0.9 },
  // Coalizione: se diventi troppo grande, gli imperi smettono di farsi la guerra e si alleano contro di te
  coalition: { ratio: 2.5, minProvinces: 80, endRatio: 1.6, focusBias: 0.7, opinion: -40 }, // sim: si forma a metà campagna, non al primo impero
  // Bombardamenti nemici (dal Fronte III): un impero in guerra con te colpisce una tua provincia di confine; la contraerea li ferma
  aiStrike: { fromFront: 2, firstMs: 300_000, everyMs: 240_000, jitterMs: 40_000 }, // per impero in guerra: ~1 bombardamento ogni 1,5 min con tre imperi
  // Abilità a ricarica (Arsenale liv. 5): non sono unità
  abilities: {
    ricognizione: { cooldownMs: 40_000, radius: 13, durationMs: 15_000 }, // ricognizione aerea: svela la zona
    bombardamento: { cooldownMs: 60_000, radius: 1, unitRadius: 4, delayMs: 1200, unitDamage: 40, troopsPerTile: 3 }, // la provincia nemica colpita torna neutrale
  },
  aiUnits: {
    dominant: ['', 'ricognitori', 'artiglieria', 'fanteria'], // unità preferita per fazione (indice = fazione)
    dominantChance: 0.7,
    spawnEveryMs: 10_000,
    firstSpawnMs: 15_000, // prima pedina IA dopo pochi secondi, non a fine tregua (Nico: attivi subito)
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
  // Terreno vero (Natural Earth, scripts/build-map.ts): difesa delle caselle, crescita delle truppe, lentezza di pedine e avanzata,
  // risorsa prodotta ogni minuto da ogni provincia posseduta (le fabbriche la moltiplicano).
  terrain: {
    pianura: { defense: 1, growth: 1, move: 1, res: 'cibo', perMin: 0.22 },
    colline: { defense: 1.35, growth: 0.85, move: 1.4, res: 'metallo', perMin: 0.18 },
    montagne: { defense: 1.9, growth: 0.55, move: 2, res: 'metallo', perMin: 0.32 },
    deserto: { defense: 0.7, growth: 0.45, move: 1.2, res: 'benzina', perMin: 0.28 },
  } as Record<Terrain, TerrainDef>,
  // Costi fissi come in HOI4 / Call of War (Nico): una provincia costa la sua difesa, gli edifici e i reparti il loro prezzo,
  // sempre uguale per tutta la partita (niente sovraestensione né rincari). Economia: ogni provincia produce la risorsa del suo
  // terreno (perMin) e un po' delle altre due (sidePerMin); a inizio campagna una scorta di guerra (startStock) che non conta
  // come bottino.
  // growthKnee/growthExp: fino a growthKnee caselle la crescita è proporzionale, oltre cresce come (caselle)^growthExp
  // (2026-10-28, Nico) ogni provincia dà tutte e tre: 60% la risorsa del terreno, 20% ciascuna le altre; totale = perMin × totalMult
  // (le città valgono cityMult volte una provincia normale)
  economy: { mainShare: 0.6, totalMult: 1.5, cityMult: 2.5, startStock: { metallo: 40, benzina: 30, cibo: 40 }, growthKnee: 100, growthExp: 0.35 },
  // Province diverse (Nico): ognuna rende un po' di più o di meno (rich, fisso per mappa); alcune hanno un giacimento della
  // risorsa del loro terreno (miniera, pozzo, granaio) che rende molto di più. Province più ricche = bersagli che valgono.
  provinceEconomy: { rich: [0.55, 1.6] as [number, number], depositShare: 0.08, depositPerMin: 1.2 },
  // Mantenimento (Nico: le risorse devono servire): ogni pedina consuma al minuto la sua risorsa (resCost × perResCost × reparti).
  // Se nello zaino manca, le pedine di quella risorsa hanno il rifornimento dimezzato: si logorano e non si curano.
  upkeep: { perResCost: 0.06, unpaidSupply: 0.5 },
  // Vittoria: più province di tutti allo scadere, o prima se cadono i tre imperi rivali.
  victory: {
    bonus: 0.5, // +50% dello zaino in caso di vittoria
  },
  // Fine della campagna: allo scadere della durata scelta vince chi ha più province (avviso nell'ultimo minuto).
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
    size: 8, // caselle per provincia (circa; la carta è in src/data/worldmap.ts)
    cityDefenseMult: 2, // difesa città = base × mult + bonus
    cityDefenseBonus: 6,
    capitalDefenseBonus: 8,
    capitalTroops: 110, // a chi prende una capitale (la prima volta)
    aiCityAttraction: 0.6, // le città sembrano più deboli all'IA: le cerca
    nameMinTiles: 40, // nomi delle nazioni solo per le più grandi
    minTilesForCity: 4, // province minuscole (isolette): niente città
    namesMaxZoom: 6.0, // sopra questo zoom (vista tattica) i nomi delle nazioni spariscono
  },
  // Navi: tocchi una costa che non raggiungi via terra; la nave parte dalla tua costa più vicina con la forza d'attacco.
  boats: {
    stepMs: 42, // tempo per attraversare una casella di mare
    maxSea: 158, // caselle di mare massime per una traversata
    maxInFlight: 3,
    minTroops: 10,
  },
  // Nebbia di guerra: vedi solo vicino a territorio, pedine e navi (caselle). Nelle prime campagne copre quasi tutta la mappa:
  // la Sala Radar allarga la vista e la zona già nota attorno alla partenza (camp.radarFogBonus, camp.radarIntel).
  fog: {
    territory: 9,
    unit: 8,
    boat: 5,
    intel: 18, // raggio già noto attorno alla partenza (esplorato, non sorvegliato)
    shade: false, // velo sulle zone non viste (spento: la carta da terminale resta pulita; i nemici fuori vista restano nascosti)
    seenAlpha: 0.14, // già esplorato ma ora fuori vista
    unseenAlpha: 0.48, // mai visto: la carta sbiadisce (velo color carta)
    blur: 4, // caselle di sfumatura sul bordo della nebbia
    color: 0xebe4d4, // carta: dove non vedi, la carta resta bianca (STYLE.md)
  },
  // Milizie provinciali (bot deboli alla OpenFront): poche province ciascuna, difendono e crescono piano; gli imperi
  // (ai.*) si espandono molto di più. All'inizio la terra è quasi tutta libera.
  bots: {
    count: 56,
    nearShare: 0.65, // quota nella regione del giocatore
    near: [12, 110] as [number, number], // distanza dalla partenza del giocatore (passi esagonali)
    minApart: 14, // tra una partenza e l'altra
    provinces: [2, 4] as [number, number], // province iniziali
    startTroops: [60, 120] as [number, number], // (Nico: nemici più forti) prima 25–70
    growthMult: 0.75,
    actChance: 0.04, // per tick: si allargano su terra libera vicina
    homeRadius: 16, // non si allontanano oltre (passi dalla partenza)
    maxUnits: 2, // pedine per milizia (Nico: generano tutti truppe): difendono casa e attaccano chi si avvicina
    unitRadius: 24, // le pedine delle milizie non vanno a cercare nemici oltre questi passi da casa
    troopAssaultMult: 2, // assalto alle milizie con le truppe: costa più dei reparti (prima conquistavi 600 province e il bottino esplodeva)
  },
  // Diplomazia alla HOI4 (rapporti col giocatore): gli imperi partono in pace e possono dichiararti guerra quando vi toccate,
  // le milizie sono ostili. Donazioni = opinione; con l'opinione alta accettano pace e alleanze.
  // Gli imperi forti mangiano i deboli (Nico): col passare del tempo un impero molto più forte di un vicino (milizia o impero,
  // mai il giocatore) gli prende una provincia di confine alla volta senza battaglia; sotto poche province lo annette tutto.
  // L'intervallo si accorcia man mano che la campagna va avanti.
  absorb: { fromMs: 180_000, everyMs: 26_000, minEveryMs: 8_000, speedupPerMin: 1_500, ratio: 2.5, annexBelow: 2, annexRatio: 4 },
  // Spionaggio (Nico): le pedine di chi ha un'opinione bassa di te non si vedono, se non a contatto (sul tuo confine o vicino
  // alle tue pedine). Alleati e chi ti stima le vedi sempre (nella zona che vedi).
  intel: { opinion: 25, contact: 3 },
  diplomacy: {
    checkMs: 5000,
    warChance: 0.1, // per controllo: impero confinante in pace, dopo la tregua del fronte
    peaceBase: 0.2, // probabilità di base che accettino la pace
    allyOpinion: 40, // opinione minima per proporre un'alleanza
    donateShare: 0.15, // quota di truppe donate
    donateMin: 20,
    donateLoot: 20, // risorse donate dallo zaino
    opinionPerTroop: 0.25, // opinione per truppa donata (massimo 25 a dono)
    truceMs: 60_000, // dopo una pace nessuno può dichiarare guerra per un po'
    askCooldownMs: 15_000,
    tributeRatio: 3, // una milizia paga se hai il triplo delle sue truppe
    tribute: 15,
  },
  // Accerchiamenti (alla OpenFront): una sacca circondata da una sola fazione in guerra con lei si arrende.
  encircle: {
    maxNeutral: 10, // province libere al massimo in una sacca
    maxPocket: 6, // province di una fazione tagliate fuori (senza capitale, o fazione piccola)
  },
  // Puntata (alla poker / estrazione): prima della campagna metti in gioco risorse del Deposito. Finiscono nello zaino,
  // le puoi spendere per arruolare truppe; più punti, più rende il guadagno (solo la parte oltre la puntata).
  // Uscire prima della fine costa una tassa (il Deposito liv. 3 la riduce), farsi eliminare costa quasi tutto,
  // finire la campagna senza vincere costa una parte della puntata (come al tavolo: la puntata si può perdere).
  stake: {
    // Economia (23 novembre 2026, docs/economia.md): una scommessa vera, conviene se vinci più di 2 volte su 5.
    // Si perde tutta se non vinci (fine tempo o eliminato), meno l'assicurazione del Deposito; in vittoria torna ×1 e solo il
    // guadagno oltre la puntata rende di più. La puntata cresce col bottino del fronte e della durata (stakeOf in camp.ts).
    options: [0, 180, 450, 900], // risorse in gioco al Fronte I standard (divise tra metallo, benzina, cibo)
    mult: [1, 1.1, 1.25, 1.5], // moltiplicatore del guadagno oltre la puntata
    exitFee: 0.25, // ritirata: quota dello zaino lasciata sul campo
    lossShare: 1, // fine campagna senza vincere o eliminato: quota della puntata persa (meno l'assicurazione del Deposito)
    recruitCost: 10, // ARRUOLA: risorse dallo zaino...
    recruitTroops: 30, // ...per queste truppe subito
  },
  // Assalti: le province di una fazione non cadono al primo tocco. Le truppe partono subito, la battaglia dura qualche secondo
  // (di più se la provincia è difesa bene o in montagna) e alla fine vince chi ha ancora abbastanza truppe: il difensore può
  // rinforzarsi nel frattempo. Le province libere si prendono ancora subito. Vale anche per le IA e per gli assedi delle pedine.
  battle: {
    baseMs: 2500, msPerCost: 30, minMs: 3000, maxMs: 15_000,
    winRatio: 0.85, // all'ultimo istante bastano truppe ≥ 85% del costo attuale
    defenderLoss: 0.4, // assalto respinto: il difensore perde comunque questa quota delle truppe impegnate
  },
  // Logistica alla HOI4: ogni fazione ha una capitale; le province fino a `range` passi (lungo il proprio territorio) sono
  // rifornite in pieno, poi il rifornimento cala; quelle tagliate fuori scendono a `cutOff`. Rifornimento basso = meno crescita
  // e produzione, difesa più debole, attacchi da lì più cari. Se la capitale cade, se ne sceglie un'altra.
  logistics: {
    range: 8, decay: 0.06, min: 0.45, cutOff: 0.25,
    defenseMin: 0.6, // difesa a rifornimento zero (× della normale)
    attackPenalty: 0.8, // costo d'attacco × (1 + (1 − rifornimento) × penalità)
  },
  // Mercato della base: solo risorse di gioco (niente soldi veri, niente casse a sorpresa). Scambi in perdita, rifornimenti
  // per la prossima campagna (uno per tipo, si consumano quando parte), cantiere e ricerca finiti subito pagando metallo.
  shop: {
    trade: { give: 50, get: 35 }, // 50 di una risorsa → 35 di un'altra
    supplies: {
      truppe: { cost: { metallo: 0, benzina: 20, cibo: 60 }, mods: { startTroops: 80 } },
      mappe: { cost: { metallo: 20, benzina: 50, cibo: 0 }, mods: { fogIntel: 10 } },
      sabbia: { cost: { metallo: 60, benzina: 0, cibo: 20 }, mods: { ownedDefenseMult: 1.1 } },
    },
    rushPerMin: 8, // metallo per ogni minuto che manca (arrotondato in su)
    rushMaxMin: 60, // col metallo solo i lavori a cui mancano al massimo 60 minuti; quelli lunghi col Lume
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
    minEveryMs: 25_000, // con tanti radar, al massimo un rapporto ogni 25 s
  },
  // Accampamento: 1 cantiere alla volta, timer in tempo reale (secondi). I timer non bloccano mai le run.
  camp: {
    // Economia (23 novembre 2026, docs/economia.md): costi ×2,5–5 a livello, timer da 1 minuto a 24 ore (il Lume vale lì)
    buildings: {
      arsenale: [
        { cost: { metallo: 40, benzina: 10, cibo: 0 }, timeSec: 60 },
        { cost: { metallo: 450, benzina: 150, cibo: 0 }, timeSec: 600 },
        { cost: { metallo: 2206, benzina: 794, cibo: 0 }, timeSec: 3600 },
        { cost: { metallo: 6552, benzina: 2759, cibo: 690 }, timeSec: 14400 },
        { cost: { metallo: 16095, benzina: 7429, cibo: 2476 }, timeSec: 43200 },
        { cost: { metallo: 36207, benzina: 16552, cibo: 7241 }, timeSec: 86400 },
      ],
      comando: [
        { cost: { metallo: 30, benzina: 0, cibo: 15 }, timeSec: 60 },
        { cost: { metallo: 480, benzina: 107, cibo: 213 }, timeSec: 900 },
        { cost: { metallo: 2353, benzina: 706, cibo: 941 }, timeSec: 7200 },
        { cost: { metallo: 6800, benzina: 2400, cibo: 2800 }, timeSec: 28800 },
        { cost: { metallo: 16364, benzina: 6818, cibo: 6818 }, timeSec: 86400 },
      ],
      deposito: [
        { cost: { metallo: 50, benzina: 0, cibo: 20 }, timeSec: 120 },
        { cost: { metallo: 1680, benzina: 0, cibo: 720 }, timeSec: 3600 },
        { cost: { metallo: 8273, benzina: 1909, cibo: 3818 }, timeSec: 28800 },
      ],
      laboratorio: [
        { cost: { metallo: 60, benzina: 30, cibo: 20 }, timeSec: 120 },
        { cost: { metallo: 1667, benzina: 778, cibo: 556 }, timeSec: 3600 },
        { cost: { metallo: 10080, benzina: 4320, cibo: 3600 }, timeSec: 43200 },
      ],
      radar: [
        { cost: { metallo: 40, benzina: 20, cibo: 0 }, timeSec: 60 },
        { cost: { metallo: 1100, benzina: 500, cibo: 0 }, timeSec: 2700 },
        { cost: { metallo: 6387, benzina: 2613, cibo: 0 }, timeSec: 21600 },
      ],
    },
    radarFogBonus: [0, 1, 2, 3], // vista in più nelle campagne
    radarIntel: [0, 10, 22, 36], // raggio in più già noto attorno alla partenza
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
    depositoCap: [3000, 10_000, 24_000, 60_000], // capienza per risorsa (alla Clash): oltre si perde
    depositoStakeInsurance: [0, 0.1, 0.2, 0.3], // quota della puntata che torna se non vinci
    depositoRetreatBonus: [0, 0, 0, 0.1], // +10% zaino in ritirata al liv. 3
    expeditions: {
      // bottino × lootMult del fronte (startExpedition); la lunga vale ~1/3 di campagna: si torna la mattina
      breve: { timeSec: 30 * 60, cost: 0, metallo: [85, 115], benzina: [20, 30], cibo: [25, 35] },
      media: { timeSec: 4 * 3600, cost: 60, metallo: [330, 450], benzina: [90, 130], cibo: [50, 90] },
      lunga: { timeSec: 8 * 3600, cost: 120, metallo: [600, 820], benzina: [170, 250], cibo: [90, 150] },
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
    breve: { durationMs: 600_000, lootMult: 1.5 }, // la breve rende al minuto come la standard: modalità da telefono
    standard: { durationMs: 1_200_000, lootMult: 1 },
    lunga: { durationMs: 1_800_000, lootMult: 1.25 },
  },
  // Impero persistente: sullo stesso fronte il mondo resta tra una campagna e l'altra (stessa mappa, stessi rivali) finché non vinci.
  world: {
    coreMax: 5, // province del nucleo riprese a inizio campagna (le più vicine alla partenza, collegate)
    grudge: -50, // chi era in guerra con te a fine campagna riparte in pace ma con questa opinione al massimo (riapre presto le ostilità)
  },
  // Fronti (difficoltà crescente, alla Clash): il successivo si sblocca vincendo il precedente. Le IA si rafforzano (crescita,
  // truppe, unità, difese, bunker, offensive): per andare avanti servono Arsenale, ricerche e postazioni. power = potenza consigliata.
  // (2026-10-12, Nico: nemici più aggressivi) azioni ×1,6, tregua iniziale dimezzata, offensive prima e più spesse, +1 pedina IA
  // (2026-10-27, Nico: imperi che si espandono subito e sempre, gioco difficile) azioni ×2,5, crescita ×1,3, truppe iniziali ×1,5, +2 pedine
  fronts: [
    { name: 'Prima linea', power: 0, lootMult: 1, aiGrowthMult: 0.85, aiStartTroops: 78, aiActChance: 0.168, aiUnits: ['fanteria'], aiUnitHpMult: 1.03, aiDefenseMult: 1, aiBunkers: 0, aiBunkerEveryMs: 0, graceMs: 120_000, offensiveFirstMs: 252_000, offensiveEveryMs: 126_000, maxAiUnits: 7, aiDistance: [34, 60] },
    { name: 'Valichi del Nord', power: 30, lootMult: 1.25, aiGrowthMult: 1.38, aiStartTroops: 107, aiActChance: 0.205, aiUnits: ['fanteria', 'ricognitori'], aiUnitHpMult: 1.15, aiDefenseMult: 1.05, aiBunkers: 1, aiBunkerEveryMs: 0, graceMs: 105_000, offensiveFirstMs: 228_000, offensiveEveryMs: 114_000, maxAiUnits: 8, aiDistance: [28, 52] },
    { name: 'Terre di cenere', power: 60, lootMult: 1.5, aiGrowthMult: 1.95, aiStartTroops: 195, aiActChance: 0.3, aiUnits: ['fanteria', 'ricognitori', 'artiglieria', 'genio'], aiUnitHpMult: 1.26, aiDefenseMult: 1.12, aiBunkers: 2, aiBunkerEveryMs: 180_000, graceMs: 90_000, offensiveFirstMs: 198_000, offensiveEveryMs: 99_000, maxAiUnits: 8, aiDistance: [22, 42] },
    { name: 'Fronte del Lume', power: 100, lootMult: 1.8, aiGrowthMult: 2.07, aiStartTroops: 273, aiActChance: 0.352, aiUnits: ['fanteria', 'ricognitori', 'artiglieria', 'genio', 'corazzati'], aiUnitHpMult: 1.38, aiDefenseMult: 1.2, aiBunkers: 4, aiBunkerEveryMs: 140_000, graceMs: 75_000, offensiveFirstMs: 168_000, offensiveEveryMs: 87_000, maxAiUnits: 9, aiDistance: [20, 38] },
    { name: 'Cielo aperto', power: 140, lootMult: 2.1, aiGrowthMult: 2.44, aiStartTroops: 370, aiActChance: 0.4, aiUnits: ['fanteria', 'ricognitori', 'artiglieria', 'genio', 'corazzati'], aiUnitHpMult: 1.55, aiDefenseMult: 1.3, aiBunkers: 6, aiBunkerEveryMs: 110_000, graceMs: 60_000, offensiveFirstMs: 144_000, offensiveEveryMs: 75_000, maxAiUnits: 9, aiDistance: [18, 34] },
    { name: "L'Avvento", power: 170, lootMult: 2.5, aiGrowthMult: 2.54, aiStartTroops: 468, aiActChance: 0.448, aiUnits: ['fanteria', 'ricognitori', 'artiglieria', 'genio', 'corazzati'], aiUnitHpMult: 1.72, aiDefenseMult: 1.4, aiBunkers: 9, aiBunkerEveryMs: 90_000, graceMs: 50_000, offensiveFirstMs: 120_000, offensiveEveryMs: 66_000, maxAiUnits: 10, aiDistance: [16, 30] },
  ] as FrontDef[],
  // Potenza del giocatore: punti per livello di postazione e per ricerca (si confronta con quella consigliata del fronte)
  power: { arsenale: 8, comando: 6, laboratorio: 4, deposito: 3, radar: 2, tech: 3 },
  // Costruzioni nelle province (alla Call of War): si pagano in truppe (lo zaino resta bottino da portare a casa), tempo di gioco.
  // Ogni costruzione già avviata rende la prossima più cara (priceStep). Restano alla provincia anche se cambia padrone
  // (le fabbriche nemiche si conquistano). prodAdd = risorse/min in più della provincia; tech = ricerca che le sblocca ('' = subito).
  works: {
    fabbrica: { troops: 35, metal: 8, timeMs: 10_000, prodAdd: 0, prodMult: 2, defenseMult: 1, growthTiles: 0, tech: '' }, // tutta la produzione della provincia ×2 (Nico)
    bunker: { troops: 45, metal: 6, timeMs: 13_000, prodAdd: 0, defenseMult: 1.7, growthTiles: 0, tech: '' },
    caserma: { troops: 60, metal: 10, timeMs: 15_000, prodAdd: 0, defenseMult: 1, growthTiles: 10, tech: 'addestramento' },
    ospedale: { troops: 40, metal: 6, timeMs: 12_000, prodAdd: 0, defenseMult: 1, growthTiles: 0, tech: '', heal: 3 }, // pedine qui e accanto: cura ×3
    radar: { troops: 30, metal: 5, timeMs: 10_000, prodAdd: 0, defenseMult: 1, growthTiles: 0, tech: '', vision: 7 }, // vista attorno alla provincia
    porto: { troops: 50, metal: 8, timeMs: 13_000, prodAdd: 0, defenseMult: 1, growthTiles: 0, tech: '', coastal: true, seaMult: 1.5 }, // navi più lontane, +1 in mare
    aeroporto: { troops: 70, metal: 12, timeMs: 17_000, prodAdd: 0, defenseMult: 1, growthTiles: 0, tech: 'ricognizione', abilityCdMult: 0.7 }, // abilità più rapide
    // (2026-10-12, Nico) nuovi edifici
    rifornimenti: { troops: 55, metal: 10, timeMs: 13_000, prodAdd: 0, defenseMult: 1, growthTiles: 0, tech: '', supplyHub: true }, // deposito: la logistica riparte da qui come dalla capitale
    ferrovia: { troops: 40, metal: 12, timeMs: 12_000, prodAdd: 0, defenseMult: 1, growthTiles: 0, tech: '', railMult: 0.45 }, // pedine più veloci qui e nelle tue province accanto
    contraerea: { troops: 45, metal: 8, timeMs: 12_000, prodAdd: 0, defenseMult: 1, growthTiles: 0, tech: '', antiAir: true }, // ferma i bombardamenti qui e accanto
    raffineria: { troops: 40, metal: 8, timeMs: 12_000, prodAdd: 2, defenseMult: 1, growthTiles: 0, tech: '', res: 'benzina' }, // +2 benzina/min
    fattoria: { troops: 40, metal: 6, timeMs: 12_000, prodAdd: 2, defenseMult: 1, growthTiles: 0, tech: '', res: 'cibo' }, // +2 cibo/min (Nico)
  } as Record<WorkId, WorkDef>,
  // Modalità test (HQ → tasto TEST): sblocca tutto e azzera i timer per provare il gioco senza aspettare
  test: { stash: 9999, startTroops: 1000, abilityCdMult: 0.25, runs: 3, wins: 3, expeditions: 3 },
  progression: {
    campaignChoiceAfterRuns: 1, // la durata si sceglie dopo la run guidata
    civChoiceAfterRuns: 3, // le civiltà dopo qualche campagna (un sistema nuovo alla volta)
  },
  // — meccaniche nuove (piano schermate/retention): tutte spente finché Nico non le conferma —
  features: {
    orders: false, // ordini del giorno
    morningReport: false, // rapporto del mattino + calendario 7gg
    rendita: false, // rendita del Centro di Comando
    merit: false, // grado del comandante
    stars: false, // stelle per fronte
    medals: false, // onorificenze
    archive: false, // archivio della Caduta a puntate
    gradualUnlock: false, // sblocco graduale delle schermate nella prima settimana
  },
  // — navigazione (schermate B1+): quando sblocca ogni voce, se features.gradualUnlock è attivo —
  ui: {
    navUnlock: { comando: 0, operazioni: 0, ricerca: 3, arsenale: 1, estrazione: 2, mercato: 4 }, // runs minimi
  },
  // — HUD (interfaccia in campagna, C0+) —
  hud: {
    toastMs: 2200,
  },
  // — grado del comandante (Merito): sale sempre, anche perdendo —
  merit: {
    perRun: 10,
    perWin: 25,
    tiers: [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200], // soglie di merito per grado (10 gradi)
  },
  // — ordini del giorno: 3 al giorno, un cambio gratis —
  daily: {
    count: 3,
    freeReroll: 1,
  },
  // — rendita del Centro di Comando: matura da sola, tetto a 12h, si ritira nel QG —
  rendita: {
    capHours: 12,
  },
  // — stelle per fronte: vittoria, capitale mai persa, vittoria entro il 60% del tempo —
  stars: {
    fastWinShare: 0.6,
  },
  // — onorificenze: 3 livelli, premio fisso e toppa —
  medals: {
    tiers: ['recluta', 'veterano', 'elite'] as const,
  },
  // — archivio della Caduta: documenti a puntate nei caricamenti —
  archive: {
    docCount: 36,
    skipKnownAfterMs: 2500, // i caricamenti già letti si saltano prima
  },
  weekly: {}, // operazione della settimana (P2): riservato

  // Civiltà: bonus (sempre) + edificio unico (sugli insediamenti, cioè rovine possedute). Testi in src/data/civs.json.
  civs: {
    republica: { unit: 'guardia', unlock: null, bonus: { ownedDefenseMult: 1.2 }, building: { settlementDefense: 6 } },
    imperium: { unit: 'legionari', unlock: null, bonus: { neutralCostMult: 0.85 }, building: { settlementGrowth: 2 } },
    aristocrazia: { unit: 'prototipo', unlock: { wins: 3 }, bonus: { unitCostMult: 0.7, growthMult: 0.92 }, building: { fogBonus: 3 } },
    cabal: { unit: 'infiltrati', unlock: { expeditions: 3 }, bonus: { lootMult: 1.3 }, building: { settlementLoot: 0.25 } },
  },
  // Laboratorio: ricerche (una alla volta, a tempo reale). tier = livello di laboratorio richiesto (max 3). Testi in src/data/tech.json.
  // Albero della ricerca (Laboratorio + Arsenale): una ricerca alla volta, a tempo reale.
  // req = ricerche richieste; col/row = posizione nell'albero; arsenale = livello dell'Arsenale richiesto (ramo Armamenti),
  // tier = grado per il livello del Laboratorio (altri rami). unit/ability/unique = cosa sblocca in campagna.
  // costi e tempi × grado (23 novembre 2026, docs/economia.md): da 15 minuti a 16 ore
  tech: {
    // Arsenale per reparto (Nico, 23 novembre 2026: "diviso per categoria, poi si va a destra per migliorare, non per sbloccare
    // cose nuove"): una riga per reparto, la prima carta lo sblocca (la Fanteria c'è già), a destra i potenziamenti dello stesso
    // reparto (boost: vita, danni, costo in truppe, solo per quel reparto). Righe senza legami tra loro: decide il livello.
    fanteria_vita: { branch: 'armamenti', col: 1, row: 0, req: [], arsenale: 1, cost: { metallo: 200, benzina: 60, cibo: 0 }, timeSec: 600, boost: { unit: 'fanteria', hp: 1.2 } },
    fanteria_danni: { branch: 'armamenti', col: 2, row: 0, req: ['fanteria_vita'], arsenale: 2, cost: { metallo: 700, benzina: 240, cibo: 0 }, timeSec: 1500, boost: { unit: 'fanteria', atk: 1.2 } },
    fanteria_costo: { branch: 'armamenti', col: 3, row: 0, req: ['fanteria_danni'], arsenale: 3, cost: { metallo: 2400, benzina: 900, cibo: 400 }, timeSec: 5400, boost: { unit: 'fanteria', cost: 0.85 } },
    ricognitori: { branch: 'armamenti', col: 0, row: 1, req: [], arsenale: 1, cost: { metallo: 240, benzina: 80, cibo: 0 }, timeSec: 900, unit: 'ricognitori' },
    ricognitori_vita: { branch: 'armamenti', col: 1, row: 1, req: ['ricognitori'], arsenale: 2, cost: { metallo: 600, benzina: 200, cibo: 0 }, timeSec: 1500, boost: { unit: 'ricognitori', hp: 1.2 } },
    ricognitori_danni: { branch: 'armamenti', col: 2, row: 1, req: ['ricognitori_vita'], arsenale: 3, cost: { metallo: 2400, benzina: 900, cibo: 0 }, timeSec: 5400, boost: { unit: 'ricognitori', atk: 1.2 } },
    artiglieria: { branch: 'armamenti', col: 0, row: 2, req: [], arsenale: 2, cost: { metallo: 960, benzina: 320, cibo: 0 }, timeSec: 1800, unit: 'artiglieria' },
    artiglieria_vita: { branch: 'armamenti', col: 1, row: 2, req: ['artiglieria'], arsenale: 3, cost: { metallo: 2200, benzina: 700, cibo: 0 }, timeSec: 5400, boost: { unit: 'artiglieria', hp: 1.2 } },
    artiglieria_danni: { branch: 'armamenti', col: 2, row: 2, req: ['artiglieria_vita'], arsenale: 4, cost: { metallo: 6000, benzina: 2400, cibo: 0 }, timeSec: 12000, boost: { unit: 'artiglieria', atk: 1.2 } },
    corazzati: { branch: 'armamenti', col: 0, row: 3, req: [], arsenale: 3, cost: { metallo: 3600, benzina: 1500, cibo: 0 }, timeSec: 7200, unit: 'corazzati' },
    corazzati_vita: { branch: 'armamenti', col: 1, row: 3, req: ['corazzati'], arsenale: 4, cost: { metallo: 7000, benzina: 3000, cibo: 0 }, timeSec: 14400, boost: { unit: 'corazzati', hp: 1.2 } },
    corazzati_danni: { branch: 'armamenti', col: 2, row: 3, req: ['corazzati_vita'], arsenale: 5, cost: { metallo: 14000, benzina: 7000, cibo: 0 }, timeSec: 28800, boost: { unit: 'corazzati', atk: 1.2 } },
    genio: { branch: 'armamenti', col: 0, row: 4, req: [], arsenale: 3, cost: { metallo: 2700, benzina: 600, cibo: 600 }, timeSec: 5760, unit: 'genio' },
    genio_vita: { branch: 'armamenti', col: 1, row: 4, req: ['genio'], arsenale: 4, cost: { metallo: 5000, benzina: 1200, cibo: 1200 }, timeSec: 10800, boost: { unit: 'genio', hp: 1.2 } },
    genio_danni: { branch: 'armamenti', col: 2, row: 4, req: ['genio_vita'], arsenale: 5, cost: { metallo: 12000, benzina: 4000, cibo: 2000 }, timeSec: 25200, boost: { unit: 'genio', atk: 1.2 } },
    cannoniera: { branch: 'armamenti', col: 0, row: 5, req: [], arsenale: 4, cost: { metallo: 8000, benzina: 4000, cibo: 0 }, timeSec: 14400, unit: 'cannoniera' },
    cannoniera_vita: { branch: 'armamenti', col: 1, row: 5, req: ['cannoniera'], arsenale: 5, cost: { metallo: 12000, benzina: 6000, cibo: 0 }, timeSec: 21600, boost: { unit: 'cannoniera', hp: 1.2 } },
    cannoniera_danni: { branch: 'armamenti', col: 2, row: 5, req: ['cannoniera_vita'], arsenale: 6, cost: { metallo: 24000, benzina: 12000, cibo: 0 }, timeSec: 43200, boost: { unit: 'cannoniera', atk: 1.2 } },
    unica: { branch: 'armamenti', col: 0, row: 6, req: [], arsenale: 6, cost: { metallo: 33000, benzina: 17600, cibo: 6600 }, timeSec: 57600, unique: true },
    munizioni: { branch: 'armamenti', col: 0, row: 7, req: [], arsenale: 3, cost: { metallo: 4200, benzina: 1200, cibo: 0 }, timeSec: 8640, mods: { unitAttackMult: 1.15 } },
    corazze: { branch: 'armamenti', col: 1, row: 7, req: ['munizioni'], arsenale: 4, cost: { metallo: 10000, benzina: 3000, cibo: 1000 }, timeSec: 17280, mods: { unitHpMult: 1.1 } },
    ricognizione: { branch: 'armamenti', col: 0, row: 8, req: [], arsenale: 5, cost: { metallo: 14400, benzina: 8000, cibo: 0 }, timeSec: 28800, ability: 'ricognizione' },
    bombardamento: { branch: 'armamenti', col: 1, row: 8, req: ['ricognizione'], arsenale: 5, cost: { metallo: 19200, benzina: 11200, cibo: 0 }, timeSec: 36000, ability: 'bombardamento' },
    addestramento: { branch: 'esercito', col: 0, row: 9, req: [], tier: 1, cost: { metallo: 320, benzina: 160, cibo: 160 }, timeSec: 1800, mods: { unitHpMult: 1.15 } },
    elite: { branch: 'esercito', col: 1, row: 9, req: ['addestramento'], tier: 2, cost: { metallo: 3300, benzina: 1500, cibo: 1200 }, timeSec: 10800, mods: { unitCostMult: 0.85 } },
    assalto: { branch: 'esercito', col: 2, row: 9, req: ['elite'], tier: 3, cost: { metallo: 17600, benzina: 7200, cibo: 6400 }, timeSec: 34560, mods: { attackCostMult: 0.85 } },
    strade: { branch: 'logistica', col: 0, row: 10, req: [], tier: 1, cost: { metallo: 320, benzina: 240, cibo: 80 }, timeSec: 1800, mods: { flowSpeedMult: 1.25 } },
    rifornimenti: { branch: 'logistica', col: 1, row: 10, req: ['strade'], tier: 2, cost: { metallo: 2400, benzina: 1200, cibo: 2100 }, timeSec: 10800, mods: { startTroops: 40 } },
    ferrovie: { branch: 'logistica', col: 2, row: 10, req: ['rifornimenti'], tier: 3, cost: { metallo: 16000, benzina: 9600, cibo: 4800 }, timeSec: 34560, mods: { growthMult: 1.12 } },
    estrazione: { branch: 'economia', col: 0, row: 11, req: [], tier: 1, cost: { metallo: 240, benzina: 160, cibo: 240 }, timeSec: 1800, mods: { expeditionTimeMult: 0.75 } },
    industria: { branch: 'economia', col: 1, row: 11, req: ['estrazione'], tier: 2, cost: { metallo: 3600, benzina: 1200, cibo: 1200 }, timeSec: 10800, mods: { capitalTroopsMult: 1.5 } },
    pianificazione: { branch: 'economia', col: 2, row: 11, req: ['industria'], tier: 3, cost: { metallo: 12800, benzina: 6400, cibo: 9600 }, timeSec: 28800, mods: { prodMult: 1.4 } },
    trincee: { branch: 'difesa', col: 0, row: 12, req: [], tier: 1, cost: { metallo: 400, benzina: 80, cibo: 160 }, timeSec: 1800, mods: { ownedDefenseMult: 1.1 } },
    radar: { branch: 'difesa', col: 1, row: 12, req: ['trincee'], tier: 2, cost: { metallo: 3000, benzina: 1800, cibo: 600 }, timeSec: 10800, mods: { fogBonus: 2 } },
    fortezze: { branch: 'difesa', col: 2, row: 12, req: ['radar'], tier: 3, cost: { metallo: 19200, benzina: 4800, cibo: 3200 }, timeSec: 28800, mods: { bunkerMult: 1.4, ownedDefenseMult: 1.1 } },
    segnale: { branch: 'caduta', col: 0, row: 13, req: [], tier: 1, cost: { metallo: 240, benzina: 240, cibo: 240 }, timeSec: 2250, mods: { fogBonus: 2 } },
    frammenti: { branch: 'caduta', col: 1, row: 13, req: ['segnale'], tier: 2, cost: { metallo: 2700, benzina: 1800, cibo: 1500 }, timeSec: 10800, mods: { lootMult: 1.1 } },
    prototipo: { branch: 'caduta', col: 2, row: 13, req: ['frammenti'], tier: 3, cost: { metallo: 14400, benzina: 8000, cibo: 6400 }, timeSec: 28800, mods: { unitHpMult: 1.1 } },
    caduta: { branch: 'caduta', col: 3, row: 13, req: ['prototipo'], tier: 3, cost: { metallo: 24000, benzina: 12800, cibo: 9600 }, timeSec: 28800, mods: { growthMult: 1.08 } },
  } as Record<string, TechDef>,

  camera: {
    minZoom: 0.75,
    maxZoom: 22,
    startZoom: 8, // si vedono più province attorno alla partenza
    labelMinZoom: 5.5, // sotto questo zoom niente numeri di difesa
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
  boost?: { unit: UnitType; hp?: number; atk?: number; cost?: number }; // potenziamento di un reparto solo (Arsenale)
}

export type TileType = 'terra' | 'rovine';
export type WorkId = 'fabbrica' | 'bunker' | 'caserma' | 'ospedale' | 'radar' | 'porto' | 'aeroporto' | 'rifornimenti' | 'ferrovia' | 'contraerea' | 'raffineria' | 'fattoria';
export interface WorkDef {
  troops: number; metal: number; timeMs: number; prodAdd: number; defenseMult: number; growthTiles: number; tech: string;
  heal?: number; vision?: number; coastal?: boolean; seaMult?: number; abilityCdMult?: number;
  supplyHub?: boolean; railMult?: number; antiAir?: boolean; res?: Resource; prodMult?: number;
}
export interface FrontDef {
  name: string; power: number; lootMult: number;
  aiGrowthMult: number; aiStartTroops: number; aiActChance: number; aiUnits: UnitType[]; aiUnitHpMult: number; aiDefenseMult: number;
  aiBunkers: number; aiBunkerEveryMs: number; graceMs: number; offensiveFirstMs: number; offensiveEveryMs: number; maxAiUnits: number;
  aiDistance: [number, number]; // passi esagonali tra te e gli imperi alla partenza (fronti duri: vicini)
}
export type Terrain = 'pianura' | 'colline' | 'montagne' | 'deserto';
export interface TerrainDef { defense: number; growth: number; move: number; res: Resource; perMin: number }
export type Resource = 'metallo' | 'benzina' | 'cibo';
export type UnitType = 'fanteria' | 'ricognitori' | 'artiglieria' | 'corazzati' | 'genio' | 'cannoniera' | 'legionari' | 'guardia' | 'prototipo' | 'infiltrati';
export type AbilityType = 'ricognizione' | 'bombardamento';
export type CivId = 'republica' | 'imperium' | 'aristocrazia' | 'cabal';
export type CampaignId = 'breve' | 'standard' | 'lunga';
