// Acquisti con soldi veri (Nico, 20 novembre 2026: "acquisti dentro il gioco", moneta Lume, pacchetti 1,99/4,99/9,99 €).
// Letto sia dal gioco (per mostrare i prezzi) sia dal server in api/ (che è l'unico a decidere cosa costa e cosa si riceve).
// Niente import dal resto del gioco: il server lo carica da solo.

export type PackId = 'piccolo' | 'medio' | 'grande';
export type RushKind = 'construction' | 'research' | 'expedition';

/** Pacchetti di Lume venduti con Stripe Checkout (prezzo in centesimi di euro). */
export const LUME_PACKS: Record<PackId, { lume: number; cents: number; bonus: number }> = {
  piccolo: { lume: 100, cents: 199, bonus: 0 },
  medio: { lume: 330, cents: 499, bonus: 10 }, // 300 + 10% in regalo
  grande: { lume: 875, cents: 999, bonus: 25 }, // 700 + 25% in regalo
};

export const PREMIUM = {
  currency: 'eur',
  /** Finire un timer: 1 Lume ogni `rushMinPerLume` minuti che mancano, minimo `rushMin`. */
  rushMinPerLume: 10,
  rushMin: 5,
  rushMaxMinutes: 8 * 60, // il timer più lungo del gioco (spedizione lunga): oltre, il server non accetta
  /** Pacchetto di risorse: `amount` di ogni risorsa per `cost` Lume (può superare la capienza del Deposito). */
  resources: { amount: 300, cost: 30 },
  /** Oggetti estetici: chiave → costo in Lume. Vuoto finché Nico non decide quali (60–150 Lume l'uno). */
  cosmetics: {} as Record<string, number>,
};

export const rushLume = (minutes: number) =>
  Math.max(PREMIUM.rushMin, Math.ceil(Math.min(Math.max(1, minutes), PREMIUM.rushMaxMinutes) / PREMIUM.rushMinPerLume));

/** Cosa il server consegna dopo una spesa in Lume (il gioco lo applica al profilo e poi lo segna come ritirato). */
export type Grant =
  | { kind: 'rush'; what: RushKind }
  | { kind: 'resources'; amount: number }
  | { kind: 'cosmetic'; item: string };
