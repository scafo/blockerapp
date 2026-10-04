// Stile "sala operativa dopo la Caduta": blu notte e acciaio freddi, oro pallido (la luce degli angeli caduti)
// per gli accenti, colori forti solo per le fazioni. Niente effetti da monitor.
export const PALETTE = {
  ocra: 0xd8b86e, // accento (oro pallido): bordi attivi, titoli, valori importanti
  ruggine: 0xe8604c,
  allerta: 0xf2a93b, // ambra: timer, cantieri, avvisi
  carta: 0xe9eef3, // testo chiaro
  inchiostro: 0x0b1118, // pannelli e fondo
  pannello: 0x121a24, // pannelli rialzati
  linea: 0x2a3a4d, // bordi discreti
  tenue: 0x8a9bb0, // testo secondario
  radioattivo: 0x8fd6ff, // ghiaccio: segnale, abilità, selezioni
  oceano: 0x070d14,
  factions: [
    { fill: 0x2f8cff, border: 0xc2dcff }, // Republica
    { fill: 0xe23a3f, border: 0xffbdbd }, // Imperium
    { fill: 0x9b5cf2, border: 0xdfcbff }, // Aristocrazia
    { fill: 0xeaa21c, border: 0xffe3a3 }, // Cabal
  ],
  // carta politica alla Call of War: nazioni in toni smorzati, province con bordi sottili
  mappa: {
    fondo: 0x0a141f, // mare aperto
    mareCosta: 0x173049, // acque basse lungo le coste
    reticolo: 0x13263a, // meridiani e paralleli
    nazioni: [0x4c5a6b, 0x52625c, 0x5c6070, 0x47606a, 0x5d5869, 0x506866, 0x62665a, 0x555b72], // ardesia, acciaio, salvia
    deserto: 0x7a7060, // tinta delle province desertiche
    confine: 0xd5dee8, // confini nazionali
    provincia: 0x10171f, // confini di provincia
    costa: 0x9cbad3,
    nome: 0xe9eef3, // nomi delle nazioni
    capitale: 0xe9c46a,
    segno: 0xc5d0db, // città, rovine
    segnale: 0xc78cff, // la luce fredda della Caduta
  },
  ok: 0xffffff,
  ko: 0xff5252,
} as const;

export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
