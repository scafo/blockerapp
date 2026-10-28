// Vibrazioni brevi sui momenti importanti (telefoni Android e WebView; iOS Safari le ignora).
import { audioSettings } from '../audio/engine';

export function buzz(ms: number | number[]) {
  if (!audioSettings().vibration) return; // spenta dalle impostazioni audio
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* non supportato: nessun problema */
  }
}
