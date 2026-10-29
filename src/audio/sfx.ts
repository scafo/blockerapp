// Effetti sonori da sala operativa anni '50 (Nico): clic di relè, telescrivente, bip radar, colpi attutiti, sirene corte.
// Ogni effetto è costruito con pochi oscillatori e rumore filtrato; i più frequenti hanno un intervallo minimo (niente mitragliate).
import { ac, buses, noise } from './engine';
import { buzz } from '../ui/haptics';

export type Sfx =
  | 'click' | 'select' | 'open' | 'close' | 'error' | 'type' | 'ping' | 'order' | 'deploy'
  | 'conquer' | 'lost' | 'battle' | 'repelled' | 'held' | 'shot' | 'death' | 'boom'
  | 'build' | 'built' | 'event' | 'alert' | 'war' | 'peace' | 'reward' | 'victory' | 'defeat';

const MIN_GAP: Partial<Record<Sfx, number>> = { click: 40, type: 45, conquer: 110, shot: 90, lost: 500, death: 150, select: 60, ping: 300, battle: 400, error: 200 };
const last = new Map<Sfx, number>();

/** Vibrazione legata al suono (solo i momenti importanti; spenta dalle impostazioni). */
const VIB: Partial<Record<Sfx, number | number[]>> = {
  war: [60, 40, 60], alert: [20, 60, 20], event: 15, victory: [40, 60, 40, 60, 120], defeat: 150, boom: 40,
};

function env(g: GainNode, t: number, peak: number, a: number, d: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

/** Tono con inviluppo; `to` = glissato verso questa frequenza. */
function tone(t: number, f: number, dur: number, peak: number, type: OscillatorType = 'sine', to?: number, a = 0.005) {
  const c = ac()!, o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  env(g, t, peak, a, dur);
  o.connect(g).connect(buses().sfx);
  o.start(t);
  o.stop(t + a + dur + 0.05);
}

/** Rumore filtrato (click, colpi, telex, vento). */
function hiss(t: number, dur: number, peak: number, kind: BiquadFilterType, f: number, q = 1, a = 0.002, fTo?: number) {
  const c = ac()!, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
  s.buffer = noise();
  fl.type = kind;
  fl.frequency.setValueAtTime(f, t);
  if (fTo) fl.frequency.exponentialRampToValueAtTime(fTo, t + dur);
  fl.Q.value = q;
  env(g, t, peak, a, dur);
  s.connect(fl).connect(g).connect(buses().sfx);
  s.start(t, Math.random() * 1.5);
  s.stop(t + a + dur + 0.05);
}

/** Clic di relè: due scatti secchi ravvicinati. */
function relay(t: number, v = 1) {
  hiss(t, 0.012, 0.5 * v, 'highpass', 2500, 0.7);
  hiss(t + 0.018, 0.01, 0.3 * v, 'bandpass', 1800, 2);
}

/** Bip radar con eco (una riga di ritardo con ritorno). */
function radarPing(t: number, f = 1320, v = 0.18) {
  const c = ac()!, o = c.createOscillator(), g = c.createGain(), dl = c.createDelay(1), fb = c.createGain(), out = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(f, t);
  o.frequency.exponentialRampToValueAtTime(f * 0.92, t + 0.35);
  env(g, t, v, 0.004, 0.35);
  dl.delayTime.value = 0.22;
  fb.gain.value = 0.35;
  out.gain.value = 1;
  o.connect(g);
  g.connect(out);
  g.connect(dl).connect(fb).connect(dl);
  dl.connect(out);
  out.connect(buses().sfx);
  o.start(t);
  o.stop(t + 0.45);
  setTimeout(() => out.disconnect(), 2000);
}

/** `vib = false` dove la scena vibra già per conto suo. */
export function sfx(name: Sfx, volume = 1, vib = true) {
  const c = ac();
  if (!c || c.state !== 'running') return;
  const now = performance.now(), gap = MIN_GAP[name];
  if (gap && now - (last.get(name) ?? -1e9) < gap) return;
  last.set(name, now);
  const v = VIB[name];
  if (v && vib) buzz(v);
  const t = c.currentTime + 0.005, k = volume;
  switch (name) {
    case 'click': relay(t, 0.6 * k); break;
    case 'select': relay(t, 0.5 * k); tone(t + 0.01, 880, 0.06, 0.06 * k, 'square'); break;
    case 'open': relay(t, 0.5 * k); hiss(t + 0.02, 0.12, 0.05 * k, 'bandpass', 900, 1.5, 0.03, 2400); break;
    case 'close': relay(t, 0.5 * k); hiss(t + 0.02, 0.1, 0.04 * k, 'bandpass', 2000, 1.5, 0.02, 700); break;
    case 'error': tone(t, 180, 0.12, 0.12 * k, 'square'); tone(t + 0.14, 140, 0.16, 0.1 * k, 'square'); break;
    // telescrivente: martelletto + battuta
    case 'type': hiss(t, 0.018, 0.25 * k, 'bandpass', 3200 + Math.random() * 1500, 4); hiss(t + 0.006, 0.03, 0.12 * k, 'lowpass', 600, 1); break;
    case 'ping': radarPing(t, 1320, 0.16 * k); break;
    case 'order': relay(t, 0.6 * k); tone(t + 0.02, 660, 0.05, 0.07 * k, 'square'); tone(t + 0.09, 990, 0.07, 0.07 * k, 'square'); break;
    case 'deploy': hiss(t, 0.18, 0.18 * k, 'lowpass', 400, 1, 0.01); for (let i = 0; i < 3; i++) relay(t + 0.05 + i * 0.07, 0.5 * k); break;
    // conquista: conferma a due toni da radio di campo
    case 'conquer': tone(t, 740, 0.07, 0.07 * k, 'triangle'); tone(t + 0.07, 1110, 0.1, 0.06 * k, 'triangle'); break;
    case 'lost': tone(t, 220, 0.35, 0.16 * k, 'sawtooth', 110); hiss(t, 0.3, 0.12 * k, 'lowpass', 300, 1); break;
    // assalto che parte: raffica attutita lontana
    case 'battle': for (let i = 0; i < 5; i++) hiss(t + i * 0.07 + Math.random() * 0.03, 0.06, 0.18 * k, 'lowpass', 900, 1); break;
    case 'repelled': tone(t, 300, 0.12, 0.1 * k, 'square'); tone(t + 0.13, 225, 0.25, 0.1 * k, 'square'); break;
    case 'held': tone(t, 523, 0.1, 0.07 * k, 'triangle'); tone(t + 0.1, 784, 0.18, 0.07 * k, 'triangle'); break;
    case 'shot': hiss(t, 0.05, 0.12 * k, 'bandpass', 1400 + Math.random() * 600, 1.2); break;
    case 'death': tone(t, 120, 0.4, 0.22 * k, 'sine', 45); hiss(t, 0.45, 0.2 * k, 'lowpass', 700, 0.8, 0.003, 120); break;
    case 'boom': tone(t, 90, 0.7, 0.3 * k, 'sine', 30); hiss(t, 0.9, 0.3 * k, 'lowpass', 1200, 0.7, 0.003, 80); break;
    // cantiere: tre colpi di martello metallico
    case 'build': for (let i = 0; i < 3; i++) { tone(t + i * 0.11, 1600, 0.05, 0.05 * k, 'square', 900); hiss(t + i * 0.11, 0.03, 0.12 * k, 'bandpass', 2500, 3); } break;
    case 'built': relay(t, 0.6 * k); tone(t + 0.03, 587, 0.12, 0.07 * k, 'triangle'); tone(t + 0.15, 880, 0.2, 0.07 * k, 'triangle'); break;
    // dispaccio in arrivo: raffica di telex
    case 'event': for (let i = 0; i < 9; i++) hiss(t + i * 0.045 + Math.random() * 0.02, 0.018, 0.22 * k, 'bandpass', 3000 + Math.random() * 1500, 4); radarPing(t + 0.45, 990, 0.08 * k); break;
    // allarme corto: due bip alternati
    case 'alert': for (let i = 0; i < 4; i++) tone(t + i * 0.16, i % 2 ? 660 : 880, 0.12, 0.08 * k, 'square'); break;
    // dichiarazione di guerra: sirena che sale e scende
    case 'war': tone(t, 300, 0.7, 0.1 * k, 'sawtooth', 700, 0.1); tone(t + 0.75, 700, 0.8, 0.1 * k, 'sawtooth', 300, 0.05); break;
    case 'peace': tone(t, 440, 0.25, 0.06 * k, 'sine'); tone(t + 0.2, 554, 0.25, 0.06 * k, 'sine'); tone(t + 0.4, 659, 0.45, 0.06 * k, 'sine'); break;
    case 'reward': [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.07, f, 0.14, 0.06 * k, 'triangle')); break;
    case 'victory': [392, 523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.16, f, i === 4 ? 1.2 : 0.3, 0.08 * k, 'triangle')); break;
    case 'defeat': [392, 349, 311, 262].forEach((f, i) => tone(t + i * 0.32, f, i === 3 ? 1.4 : 0.4, 0.08 * k, 'sawtooth')); break;
  }
}
