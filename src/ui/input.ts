// Rileva se l'ultimo puntatore usato è stato un tocco o il mouse, per scegliere il verbo giusto nei testi.
let lastWasTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => { lastWasTouch = e.pointerType !== 'mouse'; }, { passive: true, capture: true });
}

export const isTouch = (): boolean => lastWasTouch;

/** Verbo giusto per l'ultimo puntatore usato: "tocca" su schermo touch, "clicca" con mouse/trackpad. */
export const verb = (cap = false): string => {
  const v = lastWasTouch ? 'tocca' : 'clicca';
  return cap ? v[0].toUpperCase() + v.slice(1) : v;
};
