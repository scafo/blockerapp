export const PALETTE = {
  ocra: 0xc8963e,
  ruggine: 0x8b3a1e,
  carta: 0xefe3c8,
  inchiostro: 0x2b2118,
  radioattivo: 0x3fd9b0,
  terra: 0xd9cba8,
  rovine: 0x7a6a58,
  oceano: 0x1f2a2e,
  graticola: 0x34444a,
  player: 0x2f6fd6,
  playerBorder: 0x0f2e66,
  ok: 0xffffff,
  ko: 0xd8432b,
} as const;

export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
