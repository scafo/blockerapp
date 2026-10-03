// Vibrazioni brevi sui momenti importanti (telefoni Android e WebView; iOS Safari le ignora).
export function buzz(ms: number | number[]) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* non supportato: nessun problema */
  }
}
