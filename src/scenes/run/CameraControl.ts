// Telecamera della campagna: inquadratura iniziale e zoom centrato sul dito/rotella. Nessun cambio di comportamento:
// stesso codice di prima, solo spostato fuori da RunScene.ts (preparazione per C0/C1, che useranno l'API pubblica).
import Phaser from 'phaser';
import { BALANCE } from '../../config/balance';
import { UI } from '../../ui/screen';
import { WORLD_W, WORLD_H, center } from '../../map/hexGrid';
import type { RunScene } from '../RunScene';

const CAM = BALANCE.camera;

/** Inquadra la capitale di partenza e fissa i limiti della mappa (chiamata una volta, in create). */
export function setupCamera(scene: RunScene): void {
  const cam = scene.cameras.main;
  const m = 400;
  cam.setBounds(-m, -m, WORLD_W + 2 * m, WORLD_H + 2 * m);
  cam.setZoom(CAM.startZoom * UI()); // lo zoom della camera conta i pixel reali dello schermo
  const { x, y } = center(scene.map.starts[0]);
  cam.centerOn(x, y);
}

/** Zoom centrato su un punto schermo (pollici/rotella), entro i limiti min/maxZoom. */
export function zoomAt(scene: RunScene, sx: number, sy: number, z: number): void {
  const cam = scene.cameras.main;
  const nz = Phaser.Math.Clamp(z, CAM.minZoom * UI(), CAM.maxZoom * UI());
  const w = cam.width / 2, h = cam.height / 2;
  const wx = cam.scrollX + w + (sx - w) / cam.zoom;
  const wy = cam.scrollY + h + (sy - h) / cam.zoom;
  cam.setZoom(nz);
  cam.scrollX = wx - w - (sx - w) / nz;
  cam.scrollY = wy - h - (sy - h) / nz;
  scene.resetLabelTimer();
}
