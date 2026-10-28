// Colonna sonora generata (Nico: "musica generata nel gioco"): ambient freddo da sala operativa.
// Strati: bordone grave filtrato, accordi lenti in La minore, statica radio, bip radar lontani; in guerra un battito basso,
// durante un'offensiva anche un ticchettio teso. Nell'HQ è più calma (niente battito, accordi più lunghi).
import { ac, buses, noise, onAudioChange } from './engine';

export type MusicMode = 'off' | 'hq' | 'run';

// progressione in La minore (Am, F, Dm, Em) come rapporti sulla fondamentale
const ROOT = 55; // La1
const CHORDS = [[1, 1.2, 1.5], [0.8, 1, 1.2], [0.667, 0.8, 1], [0.75, 0.9, 1.125]];

class Music {
  private mode: MusicMode = 'off';
  private intensity = 0; // 0 pace, 1 guerra, 2 offensiva
  private out: GainNode | null = null;
  private drone: { osc: OscillatorNode[]; filter: BiquadFilterNode } | null = null;
  private timer: number | null = null;
  private next = { chord: 0, ping: 0, beat: 0, tick: 0 };
  private chordIdx = 0;

  constructor() {
    onAudioChange(() => { if (this.mode !== 'off' && !this.out) this.start(this.mode); });
  }

  setMode(mode: MusicMode) {
    if (mode === this.mode && (mode === 'off' || this.out)) return;
    this.stop();
    this.mode = mode;
    if (mode !== 'off') this.start(mode);
  }

  setIntensity(v: number) {
    this.intensity = v;
    const c = ac();
    if (c && this.drone) this.drone.filter.frequency.setTargetAtTime(this.mode === 'hq' ? 260 : 320 + v * 260, c.currentTime, 2);
  }

  private start(mode: MusicMode) {
    const c = ac();
    if (!c || c.state !== 'running' || this.out) return; // parte al primo tocco (regola dei browser)
    const t = c.currentTime;
    this.out = c.createGain();
    this.out.gain.setValueAtTime(0.0001, t);
    this.out.gain.exponentialRampToValueAtTime(1, t + 4); // entra piano
    this.out.connect(buses().music);
    // bordone: due seghe stonate di poco, molto filtrate, con il filtro che respira
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = mode === 'hq' ? 260 : 320 + this.intensity * 260;
    filter.Q.value = 2;
    const lfo = c.createOscillator(), lfoG = c.createGain();
    lfo.frequency.value = 0.05;
    lfoG.gain.value = 90;
    lfo.connect(lfoG).connect(filter.frequency);
    const dg = c.createGain();
    dg.gain.value = 0.16;
    const osc = [ROOT, ROOT * 1.006, ROOT / 2].map((f) => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(filter);
      o.start(t);
      return o;
    });
    lfo.start(t);
    osc.push(lfo);
    filter.connect(dg).connect(this.out);
    this.drone = { osc, filter };
    // statica radio: rumore in banda, appena udibile, che va e viene
    const s = c.createBufferSource(), sf = c.createBiquadFilter(), sg = c.createGain(), sl = c.createOscillator(), slg = c.createGain();
    s.buffer = noise();
    s.loop = true;
    sf.type = 'bandpass';
    sf.frequency.value = 1800;
    sf.Q.value = 0.8;
    sg.gain.value = 0.012;
    sl.frequency.value = 0.08;
    slg.gain.value = 0.008;
    sl.connect(slg).connect(sg.gain);
    s.connect(sf).connect(sg).connect(this.out);
    s.start(t);
    sl.start(t);
    osc.push(sl as OscillatorNode);
    (this.drone as { src?: AudioBufferSourceNode }).src = s;
    this.next = { chord: t + 1, ping: t + 5, beat: t + 2, tick: t + 2 };
    this.timer = window.setInterval(() => this.schedule(), 250);
  }

  private stop() {
    const c = ac();
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (!c || !this.out) { this.out = null; this.drone = null; return; }
    const out = this.out, drone = this.drone, t = c.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), t);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    setTimeout(() => {
      for (const o of drone?.osc ?? []) { try { o.stop(); } catch { /* già ferma */ } }
      try { (drone as { src?: AudioBufferSourceNode } | null)?.src?.stop(); } catch { /* già ferma */ }
      out.disconnect();
    }, 1700);
    this.out = null;
    this.drone = null;
  }

  /** Programma le note dei prossimi secondi (orologio dell'audio, non dei fotogrammi). */
  private schedule() {
    const c = ac();
    if (!c || !this.out) return;
    const ahead = c.currentTime + 0.6, hq = this.mode === 'hq', I = this.intensity;
    // accordi lenti
    while (this.next.chord < ahead) {
      const len = hq ? 12 : 9 - I * 1.5;
      this.pad(this.next.chord, CHORDS[this.chordIdx++ % CHORDS.length], len);
      this.next.chord += len;
    }
    // bip radar lontano
    while (this.next.ping < ahead) {
      this.ping(this.next.ping);
      this.next.ping += 7 + Math.random() * 8;
    }
    // battito in guerra
    while (this.next.beat < ahead) {
      if (!hq && I >= 1) this.kick(this.next.beat, I >= 2 ? 0.5 : 0.32);
      this.next.beat += I >= 2 ? 0.75 : 1.5;
    }
    // ticchettio teso durante le offensive
    while (this.next.tick < ahead) {
      if (!hq && I >= 2) this.tick(this.next.tick);
      this.next.tick += 0.1875;
    }
  }

  private pad(t: number, ratios: number[], len: number) {
    const c = ac()!, g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + len * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len * 1.05);
    f.connect(g).connect(this.out!);
    for (const r of ratios) for (const d of [1, 1.004]) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = ROOT * 4 * r * d;
      o.connect(f);
      o.start(t);
      o.stop(t + len * 1.1);
    }
  }

  private ping(t: number) {
    const c = ac()!, o = c.createOscillator(), g = c.createGain(), dl = c.createDelay(1), fb = c.createGain();
    o.frequency.value = 1760;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.025, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    dl.delayTime.value = 0.38;
    fb.gain.value = 0.45;
    o.connect(g).connect(this.out!);
    g.connect(dl).connect(fb).connect(dl);
    dl.connect(this.out!);
    o.start(t);
    o.stop(t + 0.6);
  }

  private kick(t: number, v: number) {
    const c = ac()!, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.3);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + 0.45);
  }

  private tick(t: number) {
    const c = ac()!, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = noise();
    f.type = 'highpass';
    f.frequency.value = 6000;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.025, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    s.connect(f).connect(g).connect(this.out!);
    s.start(t, Math.random());
    s.stop(t + 0.06);
  }
}

export const music = new Music();
