// Schermi ad alta densità: il gioco disegna a DPR× (testi e linee nitidi) ma i layout ragionano in punti CSS.
import Phaser from 'phaser';

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;

const lowEnd = (navigator.hardwareConcurrency || 4) <= 4; // telefoni economici: meno pixel da riempire
// nitidezza prima di tutto (si valida su browser): densità reale fino a 3, 2 sui dispositivi deboli
export const DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, lowEnd ? 2 : 3));
export const LOW_END = lowEnd;

/**
 * Mouse/trackpad + finestra abbastanza larga = desktop (interfaccia pensata apposta, non solo telefono ingrandito).
 * ?dense=1 forza desktop, ?dense=0 forza telefono: utile per confrontare i due layout senza cambiare schermo.
 */
export function isDesktop(): boolean {
  const forced = params?.get('dense');
  if (forced === '1') return true;
  if (forced === '0') return false;
  if (typeof matchMedia === 'undefined') return false;
  const fine = matchMedia('(pointer: fine)').matches && !matchMedia('(hover: none)').matches;
  return fine && (window.innerWidth || 0) >= 1024;
}

/**
 * Ingrandimento dell'interfaccia sugli schermi grandi: su desktop il layout è pensato apposta per ~1280×720 punti,
 * sul telefono resta invariato (~900×500 in orizzontale). Oltre il riferimento tutto cresce in proporzione, fino a 1,75×.
 */
export function uiScale(): number {
  const w = window.innerWidth || 900, h = window.innerHeight || 500;
  const [rw, rh] = isDesktop() ? [1280, 720] : [900, 500];
  return Phaser.Math.Clamp(Math.min(w / rw, h / rh), 1, 1.75);
}

/** Pixel reali per punto d'interfaccia (densità × ingrandimento). */
export const UI = () => DPR * uiScale();

/** Dimensioni utili in punti d'interfaccia e orientamento. */
export function view(scene: Phaser.Scene) {
  const width = scene.scale.width / UI(), height = scene.scale.height / UI();
  return { width, height, portrait: height > width };
}

/** Camera delle scene di interfaccia: coordinate in punti CSS, disegno a piena densità. */
export function uiCamera(scene: Phaser.Scene) {
  scene.cameras.main.setZoom(UI()).setOrigin(0, 0).setRoundPixels(true);
}

/**
 * ?freeze=1: ferma il tempo di gioco per confronti prima/dopo deterministici (screenshot identici a ogni avvio).
 * Chi genera eventi/particelle/IA col tempo reale deve leggere FROZEN e, se vero, usare now() al posto di Date.now().
 */
export const FROZEN = params?.get('freeze') === '1';
export const now = (): number => (FROZEN ? 0 : Date.now());

/** Ancore in punti d'interfaccia, sul margine di sicurezza, scattate su una griglia di 8pt (allineamento pulito). */
export function anchors(scene: Phaser.Scene, margin = 16) {
  const { width, height } = view(scene);
  const inset = safeInsets();
  const snap = (v: number) => Math.round(v / 8) * 8;
  const x0 = snap(inset.left + margin), y0 = snap(inset.top + margin);
  const x1 = snap(width - inset.right - margin), y1 = snap(height - inset.bottom - margin);
  return {
    x0, y0, x1, y1, width: x1 - x0, height: y1 - y0, snap,
    topLeft: { x: x0, y: y0 }, topRight: { x: x1, y: y0 },
    bottomLeft: { x: x0, y: y1 }, bottomRight: { x: x1, y: y1 },
    centerX: snap((x0 + x1) / 2), centerY: snap((y0 + y1) / 2),
    /** i-esima di n colonne uguali dentro [x0,x1], con gap tra loro. */
    col: (i: number, n: number, gap = 16) => {
      const w = (x1 - x0 - gap * (n - 1)) / n;
      return { x: snap(x0 + i * (w + gap)), width: snap(w) };
    },
  };
}

/**
 * Margini di sicurezza (notch, angoli arrotondati, barra dei gesti) in punti d'interfaccia: dal CSS env(safe-area-inset-*),
 * che funziona con viewport-fit=cover (index.html). Zero su PC e nei browser che non li conoscono.
 */
export function safeInsets(): { top: number; right: number; bottom: number; left: number } {
  const zero = { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof document === 'undefined') return zero;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;'
    + 'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';
  document.body.append(probe);
  const cs = getComputedStyle(probe), k = uiScale();
  const out = { top: parseFloat(cs.paddingTop) / k || 0, right: parseFloat(cs.paddingRight) / k || 0,
    bottom: parseFloat(cs.paddingBottom) / k || 0, left: parseFloat(cs.paddingLeft) / k || 0 };
  probe.remove();
  return out;
}
