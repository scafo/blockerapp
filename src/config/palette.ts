// Stile "planimetria tecnica" (riferimento di Nico: pianta di una struttura su fondo ardesia): fondo ardesia, riquadri con
// filo avorio e testo avorio condensato, riquadri pieni avorio per ciò che è attivo, etichette secondarie verde acqua,
// rosso solo per i punti critici. Le chiavi sono quelle di sempre (tutta l'interfaccia le usa), i valori sono nuovi.
// — interfaccia —
export const PALETTE = {
  ocra: 0x6cc7c2, // accento verde acqua: titoli, etichette, valori importanti
  ruggine: 0xd23a2e, // rosso dei punti critici
  allerta: 0x9fd0f5, // timer, cantieri, avvisi: azzurro freddo (prima ambra; Nico, 23 novembre 2026: "arancio rimasto, togli")
  carta: 0xeeeee4, // avorio: testo e fili dei riquadri
  inchiostro: 0x1f2830, // ardesia: fondo e pannelli
  pannello: 0x232d36, // pannelli
  pannelloAlto: 0x2d3944, // pannello sotto il mouse
  oroChiaro: 0xffffff, // filo del bottone principale
  linea: 0x8e989c, // fili discreti dei pannelli
  tenue: 0x95a1a6, // testo secondario
  radioattivo: 0x7ad6d1, // verde acqua chiaro: selezioni, stati positivi
  oceano: 0x1a2229,
  // — mappa — carta da terminale (riferimento di Nico): terra nera, mare a puntini blu, confini a puntini chiari
  // `fill` = colore dei puntini del territorio; `border` = colore del confine della potenza
  factions: [
    { fill: 0x4fc3d8, border: 0xa6ecf7 }, // Republica: ciano
    { fill: 0xe05a47, border: 0xffc4b8 }, // Imperium: rosso
    { fill: 0xb57ad6, border: 0xe2c2f2 }, // Aristocrazia: viola
    { fill: 0xe0b040, border: 0xf6dc96 }, // Cabal: ocra
  ],
  mappa: {
    fondo: 0x7a82b0, // mare: puntini color pervinca (campionati dall'immagine di riferimento)
    mareCosta: 0x7a82b0,
    reticolo: 0x7a82b0,
    nazioni: [0x000000, 0x000000, 0x000000, 0x000000, 0x000000, 0x000000, 0x000000, 0x000000], // terra nera
    deserto: 0x000000,
    confine: 0xeef0f0, // confini nazionali: puntini bianchi
    provincia: 0x444444,
    costa: 0x000000,
    nome: 0xe1e496, // nomi delle nazioni: giallo pallido
    capitale: 0x96231e, // capitali: rosso scuro
    segno: 0xd8d8d8,
    segnale: 0xe8f1ff,
  },
  ok: 0xffffff,
  ko: 0xd23a2e,
} as const;

export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

// vista del terreno (tasto MAPPA): solo sfumature di blu, alcuni terreni a righe e altri pieni (Nico); legenda nell'interfaccia
/** Vista Strutture (Nico: le icone erano minuscole): ogni costruzione è un colore pieno o a righe sulla provincia, come la
 *  vista del terreno, con la legenda. Niente arancio. */
export const WORK_VIEW: Record<string, { col: string; stripe: number }> = {
  // Nico, 26 novembre 2026: pochi colori pieni, niente righe: fabbrica gialla, città blu scuro, deposito marrone, radar blu
  // (27 novembre: "colori più belli") toni pieni e armonici: senape, ardesia, cobalto, cuoio, verde acqua
  fabbrica: { col: '#d9b84a', stripe: 0 }, bunker: { col: '#8f95a8', stripe: 0 }, caserma: { col: '#c95c5c', stripe: 0 },
  ospedale: { col: '#e9ebe6', stripe: 0 }, radar: { col: '#56b3c0', stripe: 0 }, porto: { col: '#4f8fd6', stripe: 0 },
  aeroporto: { col: '#9fd0f5', stripe: 0 }, rifornimenti: { col: '#9a6b3f', stripe: 0 }, ferrovia: { col: '#8a7d9c', stripe: 0 },
  contraerea: { col: '#b57ad6', stripe: 0 }, raffineria: { col: '#c9a0dc', stripe: 0 }, fattoria: { col: '#5b7f4f', stripe: 0 },
  citta: { col: '#3a5fae', stripe: 0 },
};

export const TERRAIN_VIEW: Record<string, { col: string; stripe: number; name: string }> = {
  // un colore per terreno (prima quattro blu che non si distinguevano); niente arancio
  pianura: { col: '#5b7f4f', stripe: 0, name: 'Plains' },
  // Nico, 26 novembre 2026: colline verde scuro piene (parenti della pianura), montagne grigie a righe, deserto beige più tenue
  colline: { col: '#3e5a36', stripe: 0, name: 'Hills' },
  montagne: { col: '#3c3a37', stripe: 0, name: 'Mountains' }, // grigio scuro pieno, senza righe (Nico: tra le righe passava il fondo bluastro)
  deserto: { col: '#c8b99c', stripe: 0, name: 'Desert' },
};
