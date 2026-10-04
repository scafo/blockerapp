// Schermi ad alta densità: il gioco disegna a DPR× (testi e linee nitidi) ma i layout ragionano in punti CSS.
import Phaser from 'phaser';

const lowEnd = (navigator.hardwareConcurrency || 4) <= 4; // telefoni economici: meno pixel da riempire
// nitidezza prima di tutto (si valida su browser): densità reale fino a 3, 2 sui dispositivi deboli
export const DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, lowEnd ? 2 : 3));
export const LOW_END = lowEnd;

/** Dimensioni utili in punti CSS e orientamento. */
export function view(scene: Phaser.Scene) {
  const width = scene.scale.width / DPR, height = scene.scale.height / DPR;
  return { width, height, portrait: height > width };
}

/** Camera delle scene di interfaccia: coordinate in punti CSS, disegno a piena densità. */
export function uiCamera(scene: Phaser.Scene) {
  scene.cameras.main.setZoom(DPR).setOrigin(0, 0).setRoundPixels(true);
}
