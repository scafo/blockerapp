// Stile "schermo di comando": fondo scuro, linee al fosforo, colori forti solo per le fazioni.
export const PALETTE = {
  ocra: 0x6ff0b0, // accento (fosforo): bordi dei pannelli, titoli
  ruggine: 0xff6a4d,
  carta: 0xd6f5e6, // testo chiaro
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
    { fill: 0x3d8bff, border: 0xb5d3ff }, // giocatore
    { fill: 0xff5a3c, border: 0xffc0b0 },
    { fill: 0xc04dff, border: 0xe9c2ff },
    { fill: 0xf2b84b, border: 0xffe3a8 },
  ],
  ok: 0xffffff,
  ko: 0xff4d4d,
} as const;

export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
