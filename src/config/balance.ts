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
  loot: {
    rovine: [8, 20] as [number, number],
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

export type TileType = 'terra' | 'deserto' | 'rovine' | 'tossica';
