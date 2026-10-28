// Audio del gioco, tutto sintetizzato al volo con Web Audio (niente file da scaricare, niente licenze).
// Tre volumi: generale (muto), musica, effetti. Le impostazioni restano tra le partite (localStorage).

export interface AudioSettings { music: number; sfx: number; muted: boolean; vibration: boolean }

const KEY = 'aa-audio';
const DEFAULTS: AudioSettings = { music: 0.55, sfx: 0.8, muted: false, vibration: true };

let settings: AudioSettings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { /* valori di base */ }

let ctx: AudioContext | null = null;
let master: GainNode, musicBus: GainNode, sfxBus: GainNode;
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
  applyVolumes();
  return ctx;
}

export function buses() {
  ac();
  return { music: musicBus, sfx: sfxBus };
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
