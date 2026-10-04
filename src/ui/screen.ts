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
