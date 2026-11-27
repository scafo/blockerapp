// Effetti sonori da sala operativa anni '50: colpi di legno e di tamburo, carta, telescrivente, radar, ottoni scuri.
// Ogni effetto è costruito con pochi oscillatori e rumore filtrato; i più frequenti hanno un intervallo minimo (niente mitragliate).
import { ac, buses, noise } from './engine';
import { playSample, type Sample } from './samples';
import { buzz } from '../ui/haptics';

export type Sfx =
  | 'click' | 'select' | 'open' | 'close' | 'error' | 'type' | 'ping' | 'order' | 'deploy'
  | 'conquer' | 'lost' | 'battle' | 'repelled' | 'held' | 'shot' | 'shotSmg' | 'shotCannon' | 'death' | 'boom'
  | 'build' | 'built' | 'event' | 'alert' | 'war' | 'peace' | 'reward' | 'victory' | 'defeat';

const MIN_GAP: Partial<Record<Sfx, number>> = { click: 40, type: 45, conquer: 110, shot: 90, shotSmg: 160, shotCannon: 260, lost: 500, death: 150, select: 60, ping: 300, battle: 400, error: 200 };
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

/** Uscita: diretta sugli effetti più una parte nella sala (riverbero). */
function out(n: AudioNode, wet = 0.25) {
  const b = buses();
  n.connect(b.sfx);
  if (wet > 0) { const s = ac()!.createGain(); s.gain.value = wet; n.connect(s).connect(b.verb); }
}

// Suoni profondi alla Hearts of Iron (Nico, 28 novembre 2026: "non 8 bit, profondi"): niente onde quadre né bip acuti.
// Colpi di legno e di tamburo bassi, carta, metallo, ottoni scuri filtrati e una sala lunga.

/** Tono puro con inviluppo; `to` = glissato verso questa frequenza. */
function tone(t: number, f: number, dur: number, peak: number, to?: number, a = 0.005, wet = 0.25) {
  const c = ac()!, o = c.createOscillator(), g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  env(g, t, peak, a, dur);
  o.connect(g);
  out(g, wet);
  o.start(t);
  o.stop(t + a + dur + 0.05);
}

/** Rumore filtrato (carta, telex, metallo, soffio). */
function hiss(t: number, dur: number, peak: number, kind: BiquadFilterType, f: number, q = 1, a = 0.002, fTo?: number, wet = 0.2) {
  const c = ac()!, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
  s.buffer = noise();
  fl.type = kind;
  fl.frequency.setValueAtTime(f, t);
  if (fTo) fl.frequency.exponentialRampToValueAtTime(fTo, t + dur);
  fl.Q.value = q;
  env(g, t, peak, a, dur);
  s.connect(fl).connect(g);
  out(g, wet);
  s.start(t, Math.random() * 1.5);
  s.stop(t + a + dur + 0.05);
}

/** Clic di relè: due scatti secchi ravvicinati (Nico, 28 novembre 2026: "i click clack soddisfacenti ci stavano"). */
function relay(t: number, v = 1) {
  hiss(t, 0.012, 0.5 * v, 'highpass', 2500, 0.7, 0.002, undefined, 0);
  hiss(t + 0.018, 0.01, 0.3 * v, 'bandpass', 1800, 2, 0.002, undefined, 0);
}

/** Tamburo basso (timpano, grancassa): frequenza che scende, pelle di rumore scuro. */
function drum(t: number, f0: number, f1: number, dur: number, v = 1, wet = 0.35) {
  tone(t, f0, dur, 0.5 * v, f1, 0.003, wet);
  hiss(t, Math.min(0.25, dur * 0.6), 0.16 * v, 'lowpass', 420, 0.8, 0.002, 120, wet);
}

/** Rullo di timpani che cresce. */
function roll(t: number, dur: number, f: number, v = 1) {
  const n = Math.floor(dur / 0.055);
  for (let i = 0; i < n; i++) drum(t + i * 0.055 + Math.random() * 0.01, f * 1.05, f * 0.9, 0.18, v * (0.25 + 0.75 * (i / n)) * 0.45, 0.45);
}

/** Ottoni scuri: per ogni nota due seghe stonate di poco in un filtro che si apre e si richiude. */
function brass(t: number, freqs: number[], dur: number, v = 1, a = 0.06, bright = 1300, wet = 0.45) {
  const c = ac()!, fl = c.createBiquadFilter(), g = c.createGain();
  fl.type = 'lowpass';
  fl.Q.value = 0.7;
  fl.frequency.setValueAtTime(220, t);
  fl.frequency.linearRampToValueAtTime(bright, t + a + 0.05);
  fl.frequency.exponentialRampToValueAtTime(260, t + a + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.06 * v, t + a);
  g.gain.setValueAtTime(0.06 * v, t + a + dur * 0.55);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
  fl.connect(g);
  out(g, wet);
  for (const f of freqs) for (const d of [-7, 6]) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.value = d;
    o.connect(fl);
    o.start(t);
    o.stop(t + a + dur + 0.1);
  }
}

/** Archi bassi e morbidi (pace, accordi lunghi): come gli ottoni ma con attacco lento e filtro chiuso. */
function pad(t: number, freqs: number[], dur: number, v = 1) {
  brass(t, freqs, dur, v * 0.8, Math.min(0.5, dur * 0.35), 700, 0.6);
}

/** Bip del radar, basso e lontano, con eco. */
function radarPing(t: number, f = 880, v = 0.18) {
  const c = ac()!, o = c.createOscillator(), g = c.createGain(), dl = c.createDelay(1), fb = c.createGain(), o2 = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(f, t);
  o.frequency.exponentialRampToValueAtTime(f * 0.94, t + 0.5);
  env(g, t, v, 0.01, 0.5);
  dl.delayTime.value = 0.28;
  fb.gain.value = 0.3;
  o.connect(g);
  g.connect(o2);
  g.connect(dl).connect(fb).connect(dl);
  dl.connect(o2);
  out(o2, 0.5);
  o.start(t);
  o.stop(t + 0.6);
  setTimeout(() => o2.disconnect(), 2500);
}

// note (Hz)
const N = { D2: 73.42, E2: 82.41, F2: 87.31, A2: 110, Bb2: 116.54, C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, Fs3: 185, G3: 196, A3: 220, D4: 293.66 };

const pick = (a: Sample[]): Sample => a[Math.floor(Math.random() * a.length)];

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
    case 'select': relay(t, 0.5 * k); tone(t + 0.01, 196, 0.12, 0.06 * k, undefined, 0.01); break;
    // carta che si sfoglia
    case 'open': relay(t, 0.5 * k); hiss(t + 0.02, 0.12, 0.05 * k, 'bandpass', 900, 1.5, 0.03, 2400, 0); break;
    case 'close': relay(t, 0.5 * k); hiss(t + 0.02, 0.1, 0.04 * k, 'bandpass', 2000, 1.5, 0.02, 700, 0); break;
    case 'error': drum(t, 150, 95, 0.12, 0.35 * k, 0.15); drum(t + 0.13, 120, 80, 0.16, 0.3 * k, 0.15); break;
    // telescrivente: martelletto + battuta, più scura
    case 'type': hiss(t, 0.018, 0.18 * k, 'bandpass', 2200 + Math.random() * 900, 3, 0.002, undefined, 0.05); hiss(t + 0.006, 0.03, 0.1 * k, 'lowpass', 420, 1, 0.002, undefined, 0.05); break;
    case 'ping': radarPing(t, 880, 0.14 * k); break;
    // ordine: timbro sul foglio
    case 'order': relay(t, 0.6 * k); drum(t + 0.02, 140, 70, 0.14, 0.35 * k, 0.2); break;
    // schieramento: grancassa e metallo d'equipaggiamento
    case 'deploy': hiss(t, 0.18, 0.18 * k, 'lowpass', 400, 1, 0.01, undefined, 0); for (let i = 0; i < 3; i++) relay(t + 0.05 + i * 0.07, 0.5 * k); break;
    // conquista: colpo sordo e una quinta bassa d'ottoni, breve
    // conquista (Nico, 28 novembre 2026: gli ottoni non gli piacevano): clic clac secco e un colpo sordo sotto
    case 'conquer': relay(t, 0.7 * k); relay(t + 0.06, 0.45 * k); drum(t, 95, 45, 0.2, 0.3 * k, 0.15); break;
    case 'lost': drum(t, 80, 38, 0.5, 0.6 * k); brass(t + 0.02, [N.A2, N.C3], 0.35, 0.7 * k, 0.05, 800); brass(t + 0.38, [N.F2, N.A2], 0.6, 0.7 * k, 0.04, 700); break;
    // assalto che parte: raffica attutita lontana
    case 'battle': if (!playSample('cannon', 0.45 * k, { lowpass: 1400, rate: 0.9 + Math.random() * 0.15 })) for (let i = 0; i < 5; i++) drum(t + i * 0.08, 110, 50, 0.2, 0.3 * k); break;
    case 'repelled': drum(t, 100, 45, 0.4, 0.5 * k); brass(t + 0.02, [N.D2, N.F2], 0.5, 0.7 * k, 0.04, 800); break;
    case 'held': drum(t, 100, 50, 0.3, 0.35 * k); brass(t + 0.02, [N.D3, N.A3], 0.45, 0.6 * k, 0.05, 1100); break;
    // spari registrati (fucili d'epoca a otturatore, mitra, cannone), ognuno un po' diverso
    case 'shot': if (!playSample(pick(['rifleA', 'rifleB', 'rifleC']), 0.28 * k, { rate: 0.9 + Math.random() * 0.2 })) hiss(t, 0.05, 0.12 * k, 'bandpass', 1200 + Math.random() * 400, 1.2); break;
    case 'shotSmg': if (!playSample('smg', 0.24 * k, { rate: 0.92 + Math.random() * 0.16 })) hiss(t, 0.05, 0.12 * k, 'bandpass', 1200 + Math.random() * 400, 1.2); break;
    case 'shotCannon': if (!playSample('cannon', 0.3 * k, { rate: 0.95 + Math.random() * 0.15 })) drum(t, 90, 40, 0.3, 0.4 * k); break;
    case 'death': if (!playSample('thud', 0.5 * k, { rate: 0.85 + Math.random() * 0.2 })) drum(t, 100, 40, 0.45, 0.5 * k); break;
    case 'boom': if (playSample('explosion', 0.7 * k)) playSample('impact', 0.45 * k, { delay: 0.25, rate: 0.9 }); else { drum(t, 70, 28, 0.9, 0.8 * k, 0.5); hiss(t, 0.9, 0.3 * k, 'lowpass', 900, 0.7, 0.003, 80, 0.5); } break;
    // cantiere: tre colpi di metallo pesante
    case 'build': for (let i = 0; i < 3; i++) { tone(t + i * 0.14, 190, 0.12, 0.12 * k, 150, 0.002, 0.35); hiss(t + i * 0.14, 0.09, 0.08 * k, 'bandpass', 900, 6, 0.001, undefined, 0.35); } break;
    case 'built': relay(t, 0.6 * k); brass(t + 0.02, [N.D3, N.Fs3, N.A3], 0.55, 0.55 * k, 0.06, 1100); break;
    // dispaccio in arrivo: raffica di telex e un bip lontano
    case 'event': for (let i = 0; i < 9; i++) hiss(t + i * 0.045 + Math.random() * 0.02, 0.018, 0.16 * k, 'bandpass', 2200 + Math.random() * 900, 3, 0.002, undefined, 0.05); radarPing(t + 0.45, 660, 0.08 * k); break;
    // allarme: due note di corno basse, due volte
    case 'alert': for (let i = 0; i < 2; i++) { brass(t + i * 0.5, [N.E3, N.A3], 0.2, 0.8 * k, 0.03, 1500); brass(t + i * 0.5 + 0.22, [N.C3, N.F3], 0.22, 0.8 * k, 0.03, 1500); } break;
    // dichiarazione di guerra: rullo di timpani che cresce, ottoni bassi che si gonfiano, colpo finale
    case 'war': roll(t, 1.1, 70, k); brass(t + 0.2, [N.D2, N.A2, N.D3, N.F3], 1.6, 1.1 * k, 0.8, 1200, 0.6); drum(t + 1.15, 75, 30, 1.2, 0.9 * k, 0.6); break;
    case 'peace': pad(t, [N.D3, N.Fs3, N.A3], 1.6, k); pad(t + 0.05, [N.D2], 1.6, 0.7 * k); break;
    case 'reward': [[N.D3, N.A3], [N.Fs3, N.D4]].forEach((ch, i) => brass(t + i * 0.16, ch, i ? 0.5 : 0.18, 0.6 * k, 0.03, 1400)); break;
    case 'victory': {
      const ch = [[N.D3, N.A3], [N.E3, N.A3], [N.Fs3, N.A3, N.D4], [N.D2, N.A2, N.D3, N.Fs3, N.A3, N.D4]];
      ch.forEach((c2, i) => { brass(t + i * 0.38, c2, i === 3 ? 2.4 : 0.32, k, 0.05, 1500, 0.6); drum(t + i * 0.38, 90, 55, i === 3 ? 1 : 0.3, 0.5 * k, 0.5); });
      break;
    }
    case 'defeat': {
      const ch = [[N.A2, N.C3, N.E3], [N.G3 / 2, N.Bb2, N.D3], [N.F2, N.A2, N.C3], [N.D2, N.F2, N.A2]];
      ch.forEach((c2, i) => { brass(t + i * 0.55, c2, i === 3 ? 2.6 : 0.5, 0.9 * k, 0.12, 900, 0.6); drum(t + i * 0.55, 70, 35, i === 3 ? 1.2 : 0.4, 0.5 * k, 0.5); });
      break;
    }
  }
}
