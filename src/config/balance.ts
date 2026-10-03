// Tutti i numeri del gioco. Terreni: tabella in CLAUDE.md, moltiplicatori rispetto alla pianura.
export const TERRAINS = ['mare', 'pianura', 'foresta', 'deserto', 'montagna', 'caduta'] as const;
export type Terrain = (typeof TERRAINS)[number];
export const T = Object.fromEntries(TERRAINS.map((t, i) => [t, i])) as Record<Terrain, number>;

export const BALANCE = {
  grid: { cols: 300, rows: 150, latMax: 84, latMin: -60, cellPx: 8, gapPx: 1 }, // Antartide esclusa
  baseDefense: 2, // difesa di una pianura neutrale = truppe spese per prenderla
  terrain: {
    // defense ×, speed × (velocità della conquista), growth (conta per la crescita truppe), value (valore provincia)
    pianura: { defense: 1, speed: 1, growth: 1, value: 1 },
    foresta: { defense: 1, speed: 0.8, growth: 1, value: 1 }, // −50% corazzati / +25% fanteria: con le unità (M2)
    deserto: { defense: 0.6, speed: 1.7, growth: 0, value: 0.5 }, // conquista veloce, nessuna crescita truppe
    montagna: { defense: 2, speed: 0.35, growth: 1, value: 2 }, // difesa ×2, conquista lenta
  },
  river: { attack: 0.7, speed: 0.7, value: 1 }, // attacco attraverso un fiume −30%
  cities: { defense: 3, value: 5 }, // difesa ×3 (produzione ×2: con le risorse)
  caduta: { lootChance: 0.08, loot: [6, 15] as [number, number] }, // bloccata all'inizio, bottino raro
  generation: {
    noiseScale: 0.06, noiseWeight: 0.45, desertBand: [14, 34] as [number, number],
    forestBands: [[0, 9], [40, 62]] as [number, number][], bandSoftness: 7, threshold: 0.55,
    mountainScale: 0.035, mountainRidge: 0.9, mountainMask: 0.1,
    rivers: [6, 10] as [number, number], riverMaxLength: 160, riverMeander: 0.45,
    cadutaZones: [3, 5] as [number, number], cadutaRadius: [3, 6] as [number, number],
    lootChance: 0.02, loot: [1, 5] as [number, number],
  },
  provinces: { minCells: 15, maxCells: 40, seedSpacing: 4 },
  troops: { tickMs: 500, base: 1, perCell: 0.1, perCity: 1, start: 60 },
  start: { radius: 3, minLandmass: 400 },
  wave: {
    ratios: [0.25, 0.5, 1], defaultRatio: 1, // indice in ratios
    stepMs: 45, // ms per casella in pianura
    maxTapDistance: 14, // caselle dal confine
    seedSpread: 5, // caselle di confine che partono insieme verso il bersaglio
    directionBias: 2.5, // quanto rallenta andando di lato/indietro rispetto al bersaglio
    maxCapturesPerFrame: 40,
  },
  camera: { maxZoom: 6, startZoom: 2.2, dragThreshold: 10, doubleTapMs: 300, namesZoom: 1.6 },
  fx: {
    captureMs: 150, captureFromScale: 0.25, // fade + scala di ogni casella presa
    glowAlpha: 0.7, // alone del territorio
    frontPx: 2, // spessore del confine di fazione (pixel di texture)
    provinceFlashMs: 700, bannerMs: 2200, lootPopMs: 1100,
    cityPulseMs: 600,
    hapticCapture: 6, hapticProvince: 40,
  },
};
