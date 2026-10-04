// Immagini del Figma di Nico (civiltà e schermate di caricamento): moodboard segnaposto finché non arrivano le illustrazioni definitive.
import Phaser from 'phaser';
import type { CivId } from '../config/balance';
import imperium from '../assets/img/civ-imperium.jpg';
import republica from '../assets/img/civ-republica.jpg';
import aristocrazia from '../assets/img/civ-aristocrazia.jpg';
import cabal from '../assets/img/civ-cabal.jpg';
import nave from '../assets/img/load-nave.jpg';
import croce from '../assets/img/load-croce.jpg';
import festa from '../assets/img/load-festa.jpg';
import ghiaccio from '../assets/img/load-ghiaccio.jpg';
import radar from '../assets/img/load-radar.jpg';

const URLS: Record<string, string> = {
  'civ-imperium': imperium, 'civ-republica': republica, 'civ-aristocrazia': aristocrazia, 'civ-cabal': cabal,
  'load-nave': nave, 'load-croce': croce, 'load-festa': festa, 'load-ghiaccio': ghiaccio, 'load-radar': radar,
};

export const civImage = (id: CivId) => `civ-${id}`;

/** Da chiamare nel preload della prima scena. */
export function preloadImages(scene: Phaser.Scene) {
  for (const [k, u] of Object.entries(URLS)) if (!scene.textures.exists(k)) scene.load.image(k, u);
}

/**
 * Immagine che riempie il riquadro (x, y, w, h) tagliando quello che avanza, come `object-fit: cover`.
 * fy = punto verticale da tenere (0 alto, 0.5 centro, 1 basso).
 */
export function coverImage(scene: Phaser.Scene, key: string, x: number, y: number, w: number, h: number, fy = 0.5): Phaser.GameObjects.Image {
  const img = scene.add.image(0, 0, key).setOrigin(0);
  const iw = img.width, ih = img.height;
  const s = Math.max(w / iw, h / ih);
  const cw = w / s, ch = h / s, cx = (iw - cw) / 2, cy = (ih - ch) * fy;
  return img.setScale(s).setCrop(cx, cy, cw, ch).setPosition(x - cx * s, y - cy * s);
}

/** Velo per leggere il testo sopra un'immagine: sfuma dal trasparente al colore `c` verso il basso (o verso l'alto). */
export function fade(scene: Phaser.Scene, x: number, y: number, w: number, h: number, c: number, from = 0, to = 1, dir: 'v' | 'h' = 'v'): Phaser.GameObjects.Graphics {
  const [tl, tr, bl, br] = dir === 'v' ? [from, from, to, to] : [from, to, from, to]; // verticale: dall'alto in basso; orizzontale: da sinistra
  return scene.add.graphics().fillGradientStyle(c, c, c, c, tl, tr, bl, br).fillRect(x, y, w, h);
}
