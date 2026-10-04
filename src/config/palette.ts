// Stile "schermo di comando": fondo scuro, linee al fosforo, colori forti solo per le fazioni.
export const PALETTE = {
  ocra: 0x4dff9a, // accento (verde terminale): bordi dei pannelli, titoli
  ruggine: 0xff6a4d,
  allerta: 0xffb547, // ambra: timer, cantieri, avvisi
  carta: 0xe2fff0, // testo chiaro
  inchiostro: 0x07110f, // pannelli e fondo
  radioattivo: 0x4fd8ff, // anomalie e segnale
  terra: 0x0e1c18,
  deserto: 0x15211a,
  rovine: 0x0e1c18,
  tossica: 0x1f1d10,
  oceano: 0x050a09,
  graticola: 0x0f2721,
  fosforo: 0x8ff5c8, // coste e confini nazionali
  fosforoDebole: 0x2a6655, // confini di provincia, segni
  esagono: 0x15342c, // reticolo degli esagoni
  player: 0x3d8bff,
  playerBorder: 0xb5d3ff,
  factions: [
    { fill: 0x18c8ff, border: 0xc4f3ff }, // Republica (il ciano "caldo" della heatmap)
    { fill: 0xff3b4f, border: 0xffb3bb }, // Imperium
    { fill: 0xb45cff, border: 0xe4c4ff }, // Aristocrazia
    { fill: 0xffb627, border: 0xffe2a0 }, // Cabal
  ],
  // mappa (Figma: heatmap di celle luminose + mappa da terminale): mare a puntini blu, terra a celle blu notte
  mappa: {
    fondo: 0x020409,
    marePunto: 0x1d4ed8,
    terra: 0x0d1636, // cella neutrale
    terraChiara: 0x182a63, // province "calde"
    deserto: 0x141f45,
    reticolo: 0x0c1a3a,
    confine: 0xdbe6ff, // coste e confini (bianco freddo)
    nome: 0xf2d544, // nomi delle nazioni (giallo terminale)
    capitale: 0xff4d5e,
    segno: 0x6d8fe0, // città, rovine
    segnale: 0xff4fd8, // anomalie (il segnale della Caduta)
  },
  ok: 0xffffff,
  ko: 0xff4d4d,
} as const;

export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
