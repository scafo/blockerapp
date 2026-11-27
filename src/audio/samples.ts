// Suoni registrati (Nico: "migliora i suoni"): armi d'epoca e cannoni veri, vento e statica radio per l'ambiente.
// Tutti CC0 da opengameart.org (The Free Firearm Sound Library; "Battle at sea" di Thimras; wind woosh loop; radio noise
// loop), tagliati e convertiti in mp3 mono piccoli (src/assets/sfx/README.md). Si caricano al primo tocco; finché non
// sono pronti restano i suoni sintetizzati.
import { ac, buses, onAudioChange } from './engine';
import rifleA from '../assets/sfx/rifle-a.mp3?url';
import rifleB from '../assets/sfx/rifle-b.mp3?url';
import rifleC from '../assets/sfx/rifle-c.mp3?url';
import smg from '../assets/sfx/smg.mp3?url';
import cannon from '../assets/sfx/cannon.mp3?url';
import impact from '../assets/sfx/impact.mp3?url';
import thud from '../assets/sfx/thud.mp3?url';
import explosion from '../assets/sfx/explosion.mp3?url';
import ambWind from '../assets/sfx/amb-wind.mp3?url';
import ambRadio from '../assets/sfx/amb-radio.mp3?url';

const URLS = { rifleA, rifleB, rifleC, smg, cannon, impact, thud, explosion, ambWind, ambRadio };
export type Sample = keyof typeof URLS;

const buffers = new Map<Sample, AudioBuffer>();
let loading = false;

/** Scarica e decodifica tutti i campioni (una volta; serve il contesto audio sbloccato). */
export function loadSamples() {
  const c = ac();
  if (!c || loading) return;
  loading = true;
  for (const [k, url] of Object.entries(URLS) as [Sample, string][]) {
    fetch(url).then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b)).then((buf) => { buffers.set(k, buf); }).catch(() => { /* resta il sintetizzato */ });
  }
}

onAudioChange(loadSamples); // al primo tocco (audio sbloccato) parte il caricamento

export function hasSample(k: Sample): boolean {
  return buffers.has(k);
}

/**
 * Suona un campione sul canale degli effetti. `rate` cambia altezza e durata (variazione: due spari uguali non suonano
 * identici), `lowpass` lo allontana (assalti lontani), `delay` in secondi. Ritorna false se non è ancora caricato.
 */
export function playSample(k: Sample, volume: number, opts: { rate?: number; lowpass?: number; delay?: number } = {}): boolean {
  const c = ac(), buf = buffers.get(k);
  if (!c || !buf) return false;
  const s = c.createBufferSource(), g = c.createGain();
  s.buffer = buf;
  s.playbackRate.value = opts.rate ?? 1;
  g.gain.value = volume;
  let node: AudioNode = s;
  if (opts.lowpass) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = opts.lowpass;
    node = node.connect(f);
  }
  node.connect(g).connect(buses().sfx);
  s.start(c.currentTime + (opts.delay ?? 0));
  return true;
}

/** Ciclo continuo (ambiente) verso un nodo; ritorna la sorgente per fermarlo. */
export function loopSample(k: Sample, volume: number, to: AudioNode): AudioBufferSourceNode | null {
  const c = ac(), buf = buffers.get(k);
  if (!c || !buf) return null;
  const s = c.createBufferSource(), g = c.createGain();
  s.buffer = buf;
  s.loop = true;
  g.gain.value = volume;
  s.connect(g).connect(to);
  s.start(c.currentTime, Math.random() * buf.duration);
  return s;
}
