// Audio del gioco: effetti e musica sintetizzati al volo con Web Audio, più alcuni suoni registrati CC0 (src/audio/samples.ts).
// Tre volumi: generale (muto), musica, effetti. Le impostazioni restano tra le partite (localStorage).

export interface AudioSettings { music: number; sfx: number; muted: boolean; vibration: boolean }

const KEY = 'aa-audio';
const DEFAULTS: AudioSettings = { music: 0.55, sfx: 0.8, muted: false, vibration: true };

let settings: AudioSettings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { /* valori di base */ }

let ctx: AudioContext | null = null;
let master: GainNode, musicBus: GainNode, sfxBus: GainNode, verbIn: GainNode;
let noiseBuf: AudioBuffer | null = null;
const listeners = new Set<() => void>();

export function audioSettings(): Readonly<AudioSettings> {
  return settings;
}

/** Contesto audio (creato al primo uso). I browser lo tengono muto finché l'utente non tocca la pagina. */
export function ac(): AudioContext | null {
  if (ctx) return ctx;
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  ctx = new C();
  master = ctx.createGain();
  // compressore dolce in uscita: tanti suoni insieme (battaglie) non saturano
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  musicBus = ctx.createGain();
  sfxBus = ctx.createGain();
  musicBus.connect(master);
  sfxBus.connect(master);
  // sala: riverbero lungo e scuro per gli effetti (Nico, 28 novembre 2026: "suoni profondi, alla Hearts of Iron, non 8 bit")
  verbIn = ctx.createGain();
  const conv = ctx.createConvolver(), ret = ctx.createGain();
  conv.buffer = hallImpulse(ctx, 2.6);
  ret.gain.value = 0.5;
  verbIn.connect(conv).connect(ret).connect(sfxBus);
  applyVolumes();
  return ctx;
}

/** Risposta all'impulso di una sala: rumore stereo che si spegne piano, con gli acuti che muoiono prima (suono scuro). */
function hallImpulse(c: AudioContext, sec: number): AudioBuffer {
  const n = Math.floor(c.sampleRate * sec), buf = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n, k = 0.08 + 0.85 * t; // filtro che si chiude col tempo
      lp += (Math.random() * 2 - 1 - lp) * (1 - k);
      d[i] = lp * Math.pow(1 - t, 2.6) * (i < c.sampleRate * 0.012 ? i / (c.sampleRate * 0.012) : 1);
    }
  }
  return buf;
}

export function buses() {
  ac();
  return { music: musicBus, sfx: sfxBus, verb: verbIn };
}

/** Rumore bianco (2 s, riusato): base di click, telex, colpi e statica radio. */
export function noise(): AudioBuffer {
  const c = ac()!;
  if (noiseBuf) return noiseBuf;
  noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function applyVolumes() {
  if (!ctx) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(settings.muted ? 0 : 1, t, 0.05);
  musicBus.gain.setTargetAtTime(settings.music * 0.5, t, 0.1);
  sfxBus.gain.setTargetAtTime(settings.sfx, t, 0.05);
}

export function setAudio(patch: Partial<AudioSettings>) {
  settings = { ...settings, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* niente */ }
  applyVolumes();
  for (const f of listeners) f();
}

export function onAudioChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Primo tocco o tasto: sblocca l'audio (regola dei browser) e avvisa la musica che può partire. */
export function installAudioUnlock() {
  const unlock = () => {
    const c = ac();
    if (!c) return;
    void c.resume().then(() => { for (const f of listeners) f(); });
    if (c.state === 'running') {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    }
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend(); else void ctx.resume();
  });
}
