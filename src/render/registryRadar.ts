// Registro della Sala Radar in 3D (Nico, 24 novembre 2026, riferimento: riquadri smussati di luce sospesi nel buio, ognuno
// allungato in una scia a lunga esposizione verso il centro; "come sull'Apple Watch, muovi il mouse e ti ingrandisce le
// immagini"). Ogni riquadro è un blocco smussato davanti alla camera e la sua scia un fascio di fili, puntini o immagini che va
// indietro nello spazio: la prospettiva lo porta al centro. Alcuni riquadri sono voci vere del registro (campagne, potenze,
// frammenti dell'archivio) con la loro foto; gli altri blocchi di luce. Il mouse sposta la camera e ingrandisce i riquadri
// vicini. three.js su un canvas a parte, copiato in un canvas 2D che la scena Phaser usa come texture.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export interface RadarEntry {
  img: TexImageSource;
  title: string;
  line: string;
}

// colori freddi del gioco: azzurro del Lume, bianco del testo, grigio ardesia (niente oro né arancio)
const BLUE = 0x5c98e8, WARM = 0xe9ebe6, SLATE = 0xa9bccb, ICE = 0x9fd0f5;
type Kind = 'photo' | 'lines' | 'dots' | 'grid';
// riquadri come nel riferimento, su uno schermo di 1440×836: posizione della faccia rispetto al centro, lato, tipo, colore,
// lunghezza della scia (1 = nessuna). I posti 'photo' prendono le voci del registro in ordine; senza voce diventano blocchi pieni.
const T: [number, number, number, Kind, number, number][] = [
  [25, -250, 86, 'photo', BLUE, 1.15], [-200, -190, 80, 'lines', ICE, 2.2], [-390, -150, 130, 'dots', SLATE, 1.8], [190, -190, 80, 'grid', WARM, 1],
  [370, -200, 84, 'lines', WARM, 1.9], [540, -170, 84, 'lines', SLATE, 1.25], [660, -110, 120, 'lines', ICE, 2.6], [360, -60, 100, 'photo', WARM, 2.2],
  [-190, -40, 70, 'dots', WARM, 2.4], [-400, 30, 110, 'lines', SLATE, 3.2], [-190, 50, 84, 'lines', ICE, 2.6], [-60, -60, 46, 'dots', WARM, 1.9],
  [80, 60, 60, 'dots', WARM, 2.2], [340, 60, 90, 'photo', ICE, 2.2], [640, 70, 120, 'dots', WARM, 2.6], [-350, 140, 100, 'lines', WARM, 2.4],
  [-200, 170, 100, 'photo', BLUE, 1.35], [-20, 190, 80, 'dots', SLATE, 1.7], [170, 175, 70, 'photo', WARM, 2.0], [180, 300, 86, 'photo', BLUE, 1.3],
  [370, 210, 100, 'lines', ICE, 1.9], [520, 160, 110, 'lines', SLATE, 1.8], [-560, -60, 90, 'photo', ICE, 1.6], [-560, 250, 90, 'photo', WARM, 1.5],
  [560, 300, 86, 'photo', BLUE, 1.4],
];
const Z0 = 6; // piano delle facce

/** Facce a righe, puntini, griglia o piene: piccole texture disegnate una volta. */
function faceTex(kind: Kind | 'solid'): THREE.Texture {
  const S = 128, o = document.createElement('canvas');
  o.width = o.height = S;
  const q = o.getContext('2d')!;
  q.fillStyle = '#fff';
  if (kind === 'lines') {
    q.globalAlpha = 0.1;
    q.fillRect(0, 0, S, S);
    q.globalAlpha = 1;
    for (let y = 3; y < S; y += 7) q.fillRect(0, y, S, 3);
  } else if (kind === 'grid') {
    for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) { q.beginPath(); q.arc(10 + a * 15.4, 10 + b * 15.4, 2.6, 0, 7); q.fill(); }
  } else if (kind === 'dots') {
    for (let k = 0; k < 140; k++) { q.globalAlpha = 0.4 + 0.6 * Math.random(); q.beginPath(); q.arc(Math.random() * S, Math.random() * S, 1 + Math.random() * 2.4, 0, 7); q.fill(); }
  } else q.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(o);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class RegistryRadar {
  readonly canvas: HTMLCanvasElement; // 2D, per la texture di Phaser
  private gl: HTMLCanvasElement;
  private r: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private scene = new THREE.Scene();
  private cam: THREE.PerspectiveCamera;
  private tiles: { g: THREE.Group; s: number; entry: RadarEntry | null }[] = [];
  private mouse = { x: 0, y: 0, in: false };
  private dirty = true;
  hot: RadarEntry | null = null;

  constructor(private w: number, private h: number, dpr: number, entries: RadarEntry[]) {
    this.gl = document.createElement('canvas');
    this.r = new THREE.WebGLRenderer({ canvas: this.gl, antialias: true, preserveDrawingBuffer: true });
    this.r.setPixelRatio(dpr);
    this.r.setSize(w, h, false);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.gl.width;
    this.canvas.height = this.gl.height;
    this.scene.background = new THREE.Color(0x05080d); // fondo del gioco (come sfondo della scena il colore resta giusto col bloom)
    this.cam = new THREE.PerspectiveCamera(50, w / h, 0.1, 100);
    this.composer = new EffectComposer(this.r);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.cam));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.9, 0.25, 0.45));
    this.composer.addPass(new OutputPass());

    // da pixel del riferimento a spazio 3D sul piano delle facce, riscalato sull'area della pagina
    const K = (2 * Math.tan(THREE.MathUtils.degToRad(25)) * Z0) / h, sx = w / 1440, sy = h / 836, ss = (sx + sy) / 2 * 1.1; // pagina più stretta del riferimento: riquadri un po' più grandi
    const TEX = { lines: faceTex('lines'), grid: faceTex('grid'), dots: faceTex('dots'), solid: faceTex('solid') };
    const dot = (() => {
      const o = document.createElement('canvas');
      o.width = o.height = 32;
      const q = o.getContext('2d')!, gr = q.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, '#fff');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      q.fillStyle = gr;
      q.fillRect(0, 0, 32, 32);
      return new THREE.CanvasTexture(o);
    })();
    const add = { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false };
    let next = 0;
    for (const [px, py, ps, kind0, col, len] of T) {
      const entry = kind0 === 'photo' ? entries[next++] ?? null : null;
      const kind: Kind | 'solid' = kind0 === 'photo' && !entry ? 'solid' : kind0;
      const g = new THREE.Group(), s = ps * ss * K, c = new THREE.Color(col);
      g.position.set(px * sx * K, -py * sy * K, -Z0);
      this.scene.add(g);
      let map: THREE.Texture;
      if (entry) {
        map = new THREE.Texture(entry.img as never);
        map.colorSpace = THREE.SRGBColorSpace;
        map.needsUpdate = true;
      } else map = TEX[kind as keyof typeof TEX];
      // faccia davanti: blocco smussato vero; le foto restano leggibili, gli altri sono luce che si somma
      const faceMat = entry ? new THREE.MeshBasicMaterial({ map }) : new THREE.MeshBasicMaterial({ map, color: c.clone().multiplyScalar(kind === 'solid' ? 0.45 : 0.7), ...add });
      g.add(new THREE.Mesh(new RoundedBoxGeometry(s, s, s * 0.12, 3, s * 0.16), faceMat));
      const L = Z0 * (len - 1); // la scia va indietro nello spazio: in prospettiva converge al centro
      if (L > 0) {
        if (kind === 'lines' || kind === 'grid') { // ogni riga della faccia diventa un filo di luce che si spegne
          const pos: number[] = [], cols: number[] = [];
          for (let y = -0.42; y <= 0.43; y += 0.12) for (let x = -0.4; x <= 0.41; x += 0.2) {
            pos.push(x * s, y * s, 0, x * s, y * s, -L);
            cols.push(c.r, c.g, c.b, 0, 0, 0);
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
          g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, opacity: 0.45, ...add })));
        } else if (kind === 'dots') { // scia di puntini che si spengono
          const pos: number[] = [], cols: number[] = [], n = 26;
          for (let k = 0; k < 40; k++) {
            const x = (Math.random() - 0.5) * s, y = (Math.random() - 0.5) * s;
            for (let i = 0; i < n; i++) {
              const f = i / n;
              pos.push(x, y, -L * f);
              cols.push(c.r * (1 - f) * 0.7, c.g * (1 - f) * 0.7, c.b * (1 - f) * 0.7);
            }
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
          g.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.045, map: dot, vertexColors: true, ...add })));
        } else { // foto o blocco pieno: la faccia ripetuta all'indietro, sempre più fioca (lunga esposizione)
          const n = 18, plane = new THREE.PlaneGeometry(s * 0.96, s * 0.96);
          for (let i = 1; i <= n; i++) {
            const f = i / n, m = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map, color: c, opacity: (1 - f) * 0.1, ...add }));
            m.position.z = -L * f;
            g.add(m);
          }
        }
      }
      this.tiles.push({ g, s, entry });
    }
  }

  /** Puntatore in pixel del canvas; `inside` = il mouse è sopra l'area del registro. */
  setPointer(x: number, y: number, inside: boolean) {
    if (x === this.mouse.x && y === this.mouse.y && inside === this.mouse.in) return;
    this.mouse = { x, y, in: inside };
    this.dirty = true;
  }

  /** Disegna se qualcosa si muove; true se il canvas è cambiato. */
  render(): boolean {
    const m = this.mouse, ax = m.in ? (m.x / this.w - 0.5) * 1.6 : 0, ay = m.in ? -(m.y / this.h - 0.5) : 0;
    let moving = this.dirty || Math.abs(ax - this.cam.position.x) + Math.abs(ay - this.cam.position.y) > 0.002;
    this.cam.position.x += (ax - this.cam.position.x) * 0.06;
    this.cam.position.y += (ay - this.cam.position.y) * 0.06;
    this.cam.lookAt(0, 0, -20);
    this.cam.updateMatrixWorld();
    // lente: i riquadri vicini al puntatore si ingrandiscono e vengono avanti; il più vicino con una voce è quello indicato
    const v = new THREE.Vector3(), K = (2 * Math.tan(THREE.MathUtils.degToRad(25)) * Z0) / this.h;
    let hot: RadarEntry | null = null, hotD = 1e9;
    for (const t of this.tiles) {
      v.copy(t.g.position).project(this.cam);
      const sx = ((v.x + 1) / 2) * this.w, sy = ((1 - v.y) / 2) * this.h, d = Math.hypot(sx - m.x, sy - m.y);
      const z = m.in ? 1 + Math.max(0, 1 - d / 220) * 0.8 : 1, k = t.g.scale.x;
      if (Math.abs(z - k) > 0.002) {
        moving = true;
        t.g.scale.setScalar(k + (z - k) * 0.12);
        t.g.position.z = -Z0 + (t.g.scale.x - 1) * 0.6;
      }
      if (m.in && t.entry && d < hotD && d < (t.s / K) * t.g.scale.x) { hotD = d; hot = t.entry; }
    }
    this.hot = hot;
    this.dirty = false;
    if (!moving) return false;
    this.composer.render();
    const c = this.canvas.getContext('2d')!;
    c.drawImage(this.gl, 0, 0);
    return true;
  }

  dispose() {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => {
        (x as THREE.MeshBasicMaterial).map?.dispose();
        x.dispose();
      });
    });
    this.composer.dispose();
    this.r.dispose();
    this.r.forceContextLoss();
  }
}
