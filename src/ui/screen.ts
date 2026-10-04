// Schermi ad alta densità: il gioco disegna a DPR× (testi e linee nitidi) ma i layout ragionano in punti CSS.
import Phaser from 'phaser';

const lowEnd = (navigator.hardwareConcurrency || 4) <= 4; // telefoni economici: meno pixel da riempire
// nitidezza prima di tutto (si valida su browser): densità reale fino a 3, 2 sui dispositivi deboli
export const DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, lowEnd ? 2 : 3));
export const LOW_END = lowEnd;

/**
 * Ingrandimento dell'interfaccia sugli schermi grandi (PC, tablet): il layout è pensato per un telefono in orizzontale
 * (~900×500 punti); su uno schermo più grande tutto cresce in proporzione, fino a 1,75×.
 */
export function uiScale(): number {
  const w = window.innerWidth || 900, h = window.innerHeight || 500;
  return Phaser.Math.Clamp(Math.min(w / 900, h / 500), 1, 1.75);
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
