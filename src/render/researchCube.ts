// Cubo della Ricerca in 3D (Nico, 24 novembre 2026, riferimento: spaccato a fil di ferro pieno di strati; "porta nel gioco"):
// un parallelepipedo a fil di ferro che gira col mouse, uno strato per ramo. Gli strati si riempiono poco alla volta: ogni
// ricerca fatta accende i suoi pezzi (modelli low-poly fatti in Blender, `concept-art/stili/cubo_modelli.py`); quella in corso
// si vede in trasparenza; un ramo senza ricerche è solo il telaio. Disegnato con three.js su un canvas a parte, che la scena
// Phaser mostra come texture (`render()` dice quando è cambiato). Phaser vuole un canvas 2D: il disegno WebGL si copia lì.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import cubeUrl from '../assets/models/cubo.glb?url';

export type CubeBranch = 'caduta' | 'esercito' | 'economia' | 'logistica' | 'difesa';

/** Colori dei rami, dalla palette del gioco (Corruzione, verde acqua, metallo, Lume, ruggine). */
export const BRANCH_COLOR: Record<CubeBranch, number> = { caduta: 0xb57ad6, esercito: 0x6cc7c2, economia: 0xa9bccb, logistica: 0x9fd0f5, difesa: 0xd23a2e };
/** Strati dall'alto: altezza del nome accanto al cubo e fascia in cui un tocco sceglie il ramo. */
export const LAYERS: [CubeBranch, number, number, number][] = [
  ['caduta', 1.5, 0.95, 2], ['esercito', 0.65, 0.38, 0.95], ['economia', 0.12, -0.12, 0.38], ['logistica', -0.42, -0.6, -0.12], ['difesa', -1.3, -2, -0.6],
];

const X = 0.85, Y0 = -2, Y1 = 2; // mezzo lato e altezza del parallelepipedo
const WIRE = 0x9fd0f5;
// pezzi interi già al loro posto nel modello, accesi dalla ricerca indicata
const PIECES: [string, string][] = [
  ['terreno', 'addestramento'], ['ghiaccio', 'strade'], ['binari', 'rifornimenti'], ['treno', 'ferrovie'],
  ['suolo', 'trincee'], ['trincea', 'trincee'], ['vetro', 'trincee'], ['bunker', 'radar'], ['ostacoli', 'fortezze'],
];
// modelli da piazzare: [modello, x, y, z, scala, rotazione, ricerca che lo accende]; fitti come il giardino del riferimento
const PLACE: [string, number, number, number, number, number, string][] = [
  ['abete', -0.55, 0.46, -0.55, 0.78, 0, 'addestramento'], ['abete2', -0.6, 0.46, 0.25, 0.8, 2, 'addestramento'], ['abete', 0.05, 0.46, -0.62, 0.72, 4, 'addestramento'],
  ['soldato', -0.08, 0.46, 0.42, 0.16, 0.5, 'addestramento'], ['soldato', 0.05, 0.46, 0.45, 0.16, -0.3, 'addestramento'],
  ['betulla', 0.5, 0.46, -0.55, 0.84, 1, 'elite'], ['betulla', 0.62, 0.46, 0.1, 0.66, 3, 'elite'], ['abete2', -0.2, 0.46, -0.3, 0.75, 5, 'elite'],
  ['sacchi', 0.0, 0.46, 0.58, 0.24, 1.57, 'elite'], ['sacchi', 0.58, 0.46, 0.45, 0.2, 0.5, 'elite'], ['sacchi', -0.4, 0.46, 0.0, 0.18, 2.6, 'elite'],
  ['carro', 0.12, 0.46, 0.15, 0.3, -0.7, 'assalto'], ['ostacolo', 0.62, 0.46, 0.65, 0.3, 0.4, 'assalto'], ['abete2', 0.62, 0.46, -0.2, 0.6, 1.5, 'assalto'],
  ['betulla', -0.6, 0.46, 0.62, 0.55, 4, 'assalto'], ['soldato', -0.22, 0.46, 0.38, 0.15, 1.2, 'assalto'], ['soldato', 0.38, 0.46, 0.28, 0.16, -1.4, 'assalto'],
  ['nube', -0.12, 1.3, 0.05, 0.78, 0.3, 'segnale'], ['scheggia', 0.5, 1.5, -0.4, 0.3, 0, 'frammenti'], ['scheggia', -0.45, 1.12, 0.45, 0.18, 1.2, 'prototipo'],
];
// righe dell'Economia nei colori delle tre risorse (cibo, benzina, metallo): un terzo per ricerca
const ECON = ['estrazione', 'industria', 'pianificazione'];
const LINES = 22;

export class ResearchCube {
  readonly canvas: HTMLCanvasElement; // 2D, per la texture di Phaser
  private gl: HTMLCanvasElement; // dove disegna three.js
  private r: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam: THREE.PerspectiveCamera;
  private cube = new THREE.Group();
  private parts = new Map<string, THREE.Object3D[]>(); // ricerca → oggetti che accende
  private glow: THREE.PointLight;
  private picks: [CubeBranch, THREE.Mesh][] = [];
  private yaw = 0.78;
  private pitch = 0.28;
  private aim = { yaw: 0.78, pitch: 0.28 };
  private dirty = true;
  private state = { done: new Set<string>(), running: '' };

  constructor(private w: number, private h: number, dpr: number) {
    this.gl = document.createElement('canvas');
    this.r = new THREE.WebGLRenderer({ canvas: this.gl, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.r.setPixelRatio(dpr);
    this.r.setSize(w, h, false);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.gl.width;
    this.canvas.height = this.gl.height;
    this.r.shadowMap.enabled = true;
    this.r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.r.toneMapping = THREE.ACESFilmicToneMapping;
    this.r.toneMappingExposure = 1.1;
    this.cam = new THREE.PerspectiveCamera(26, w / h, 0.1, 100);
    this.cam.setViewOffset(w, h, w * 0.09, 0, w, h); // cubo un po' a sinistra: a destra c'è posto per i nomi degli strati
    this.scene.add(this.cube);
    // luce fredda dall'alto con ombre morbide, luce viola attorno al Frammento
    this.scene.add(new THREE.HemisphereLight(0xc8d8e8, 0x1a1d20, 1.4));
    const sun = new THREE.DirectionalLight(0xe9f0f6, 2.4);
    sun.position.set(2, 5, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0008;
    sun.shadow.radius = 3;
    Object.assign(sun.shadow.camera, { left: -2.2, right: 2.2, top: 2.6, bottom: -2.6, near: 1, far: 12 });
    this.scene.add(sun);
    this.glow = new THREE.PointLight(0xb57ad6, 0, 1.4);
    this.glow.position.set(0.5, 1.62, -0.4);
    this.cube.add(this.glow);
    this.frame();
    this.economy();
    // fasce invisibili per capire quale strato si tocca
    for (const [b, , y0, y1] of LAYERS) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(2 * X, y1 - y0, 2 * X), new THREE.MeshBasicMaterial({ visible: false }));
      m.position.y = (y0 + y1) / 2;
      this.cube.add(m);
      this.picks.push([b, m]);
    }
    new GLTFLoader().load(cubeUrl, (gltf) => {
      const add = (src: THREE.Object3D, tech: string) => {
        src.traverse((c) => {
          if (!(c instanceof THREE.Mesh)) return;
          const glass = (c.material as THREE.Material).transparent;
          c.castShadow = !glass;
          c.receiveShadow = true;
          c.material = (c.material as THREE.Material).clone(); // ognuno il suo: quelli in corso si fanno trasparenti
          c.userData.opacity = (c.material as THREE.Material).opacity;
        });
        this.cube.add(src);
        (this.parts.get(tech) ?? this.parts.set(tech, []).get(tech)!).push(src);
      };
      for (const [name, tech] of PIECES) {
        const src = gltf.scene.getObjectByName(name);
        if (src) add(src.clone(), tech);
      }
      for (const [name, x, y, z, k, rot, tech] of PLACE) {
        const src = gltf.scene.getObjectByName(name);
        if (!src) continue;
        const m = src.clone();
        m.position.set(x, y, z);
        m.scale.setScalar(k);
        m.rotation.set(0, rot, 0);
        add(m, tech);
      }
      this.apply();
    });
  }

  /** Telaio a fil di ferro: montanti, bordi, reticolo in cima (La Caduta) e righe sui fianchi, come nel riferimento. */
  private frame() {
    const C = [[-X, -X], [X, -X], [X, X], [-X, X]];
    C.forEach(([x, z]) => this.line([[x, Y0, z], [x, Y1, z]], WIRE, 0.9));
    this.rect(Y1, X, WIRE, 0.9);
    this.rect(Y0, X, WIRE, 0.9);
    for (let k = 1; k < 6; k++) {
      const v = -X + (2 * X * k) / 6;
      this.line([[v, 0.5, X], [v, Y1, X], [X, 0.5, v], [X, Y1, v]], WIRE, 0.3);
    }
    for (let k = 0; k <= 8; k++) {
      const v = -X + (2 * X * k) / 8;
      this.line([[v, 1.9, -X], [v, 1.9, X], [-X, 1.9, v], [X, 1.9, v]], WIRE, 0.5);
      this.line([[v, 1.6, -X], [v, 1.6, X]], WIRE, 0.25);
    }
    for (let k = 0; k <= 6; k++) this.rect(1.0 + k * 0.16, X, WIRE, 0.35);
    this.rect(1.75, X * 0.55, WIRE, 0.6);
    this.line([[-X * 0.55, 1.75, -X * 0.55], [-X * 0.55, 1.35, -X * 0.55], [X * 0.55, 1.75, X * 0.55], [X * 0.55, 1.35, X * 0.55]], WIRE, 0.5);
  }

  /** Economia: righe colorate impilate; ogni ricerca del ramo ne accende un terzo. */
  private economy() {
    const RES = [0x9dbf6b, 0xf2b84b, 0xa9bccb].map((c) => new THREE.Color(c));
    for (let k = 0; k < LINES; k++) {
      const f = k / (LINES - 1), y = -0.12 + f * 0.46;
      const col = f < 0.5 ? RES[0].clone().lerp(RES[1], f * 2) : RES[1].clone().lerp(RES[2], f * 2 - 1);
      const tech = ECON[Math.min(2, Math.floor((k / LINES) * 3))];
      const a = this.rect(y, X - 0.02, col, 0.9), b = this.line([[-X + 0.02, y, 0], [X - 0.02, y, 0]], col, 0.25);
      for (const o of [a, b]) (this.parts.get(tech) ?? this.parts.set(tech, []).get(tech)!).push(o);
    }
  }

  private line(pts: number[][], col: THREE.ColorRepresentation, op: number) {
    const g = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op, toneMapped: false }));
    l.userData.opacity = op;
    this.cube.add(l);
    return l;
  }

  private rect(y: number, s: number, col: THREE.ColorRepresentation, op: number) {
    const c = [[-s, y, -s], [s, y, -s], [s, y, s], [-s, y, s]];
    return this.line([c[0], c[1], c[1], c[2], c[2], c[3], c[3], c[0]], col, op);
  }

  /** Ricerche fatte e quella in corso: accende i loro pezzi (in corso = in trasparenza). */
  setProgress(done: string[], running: string | null) {
    const key = `${done.join(',')}|${running ?? ''}`;
    if (key === `${[...this.state.done].join(',')}|${this.state.running}`) return;
    this.state = { done: new Set(done), running: running ?? '' };
    this.apply();
  }

  private apply() {
    for (const [tech, objs] of this.parts) {
      const on = this.state.done.has(tech), ghost = this.state.running === tech;
      for (const o of objs) {
        o.visible = on || ghost;
        o.traverse((c) => {
          const m = (c as THREE.Mesh).material as THREE.Material | undefined;
          if (!m) return;
          const base = c.userData.opacity ?? o.userData.opacity ?? 1;
          m.transparent = ghost || base < 1;
          m.opacity = ghost ? base * 0.28 : base;
          m.depthWrite = !ghost && base >= 1;
        });
      }
    }
    // la luce viola cresce con La Caduta (Prototipo, poi la ricerca finale)
    this.glow.intensity = this.state.done.has('caduta') ? 4 : this.state.done.has('prototipo') || this.state.done.has('frammenti') ? 2 : 0;
    this.dirty = true;
  }

  /** Puntatore in coordinate 0..1 della pagina: il cubo gira verso il mouse. */
  setPointer(nx: number, ny: number) {
    this.aim = { yaw: 0.78 + (nx - 0.5) * 1.6, pitch: 0.28 + (ny - 0.5) * 0.3 };
  }

  /** Ramo sotto il punto (coordinate 0..1 del canvas), o null. */
  pick(nx: number, ny: number): CubeBranch | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx * 2 - 1, 1 - ny * 2), this.cam);
    const hit = ray.intersectObjects(this.picks.map(([, m]) => m), false)[0];
    return hit ? this.picks.find(([, m]) => m === hit.object)![0] : null;
  }

  /** Dove cade il nome di ogni strato (coordinate 0..1 del canvas): a destra del montante più a destra. */
  tags(): [CubeBranch, number, number][] {
    return LAYERS.map(([b, y]) => {
      const v = [[-X, -X], [X, -X], [X, X], [-X, X]].map(([x, z]) => new THREE.Vector3(x, y, z).project(this.cam)).reduce((a, c) => (c.x > a.x ? c : a));
      return [b, (v.x + 1) / 2, (1 - v.y) / 2];
    });
  }

  /** Disegna se qualcosa si è mosso; true se il canvas è cambiato. */
  render(): boolean {
    const still = Math.abs(this.aim.yaw - this.yaw) + Math.abs(this.aim.pitch - this.pitch) < 1e-4;
    if (still && !this.dirty) return false;
    this.dirty = false;
    this.yaw += (this.aim.yaw - this.yaw) * 0.08;
    this.pitch += (this.aim.pitch - this.pitch) * 0.08;
    const d = 10.8;
    this.cam.position.set(Math.sin(this.yaw) * Math.cos(this.pitch) * d, Math.sin(this.pitch) * d + 0.1, Math.cos(this.yaw) * Math.cos(this.pitch) * d);
    this.cam.lookAt(0, 0.05, 0);
    this.r.render(this.scene, this.cam);
    const c = this.canvas.getContext('2d')!;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.gl, 0, 0);
    return true;
  }

  dispose() {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
    });
    this.r.dispose();
    this.r.forceContextLoss();
  }

  get size() {
    return { w: this.w, h: this.h };
  }
}
