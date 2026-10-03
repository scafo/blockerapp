// Interruttori di debug per i test sul campo.
export const FPS_KEY = 'ashen-atlas:fps';

/** Contatore FPS: ?fps=1 nell'URL oppure 5 tocchi sul titolo nell'accampamento. */
export function fpsEnabled(): boolean {
  if (new URLSearchParams(location.search).has('fps')) return true;
  try {
    return localStorage.getItem(FPS_KEY) === '1';
  } catch {
    return false;
  }
}
