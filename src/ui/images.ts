// Immagini del Figma di Nico (schermate di caricamento); le potenze ora sono generate (img/civs).
import Phaser from 'phaser';
import { BALANCE, type CivId } from '../config/balance';
import { techInfo, type TechId } from '../game/tech';
import nave from '../assets/img/load-nave.jpg';
import croce from '../assets/img/load-croce.jpg';
import festa from '../assets/img/load-festa.jpg';
import ghiaccio from '../assets/img/load-ghiaccio.jpg';
import radar from '../assets/img/load-radar.jpg';
import statua from '../assets/img/load-statua.jpg';
import arpanet from '../assets/img/load-arpanet.jpg';
import titleBg from '../assets/img/title-bg.jpg';
import bgEstrazione from '../assets/img/bg-estrazione.jpg';

// immagini generate in locale con Draw Things (prompt in ../concept-art/manifest.py, copiate con scripts/import-art.py):
// stanze (rooms), personaggi (people), reparti e abilità (units), eventi (events), ricerche (tech). Chiave = nome del file.
const ROOMS = Object.fromEntries(Object.entries(import.meta.glob<string>('../assets/img/*/*.jpg', { eager: true, import: 'default' }))
  .map(([path, url]) => [path.split('/').pop()!.replace('.jpg', ''), url]));

// oggetti delle risorse scontornati (scripts/import-stili.py): texture `rp-<risorsa>`, a colori
const PNGS = Object.fromEntries(Object.entries(import.meta.glob<string>('../assets/img/res/*.png', { eager: true, import: 'default' }))
  .map(([path, url]) => [path.split('/').pop()!.replace('.png', ''), url]));

const URLS: Record<string, string> = {
  ...ROOMS,
  ...PNGS,
  'load-nave': nave, 'load-croce': croce, 'load-festa': festa, 'load-ghiaccio': ghiaccio, 'load-radar': radar,
  'load-statua': statua, 'load-arpanet': arpanet,
  'title-bg': titleBg, 'bg-estrazione': bgEstrazione,
};

export const civImage = (id: CivId) => `civ-${id}`;

/** Immagine di una ricerca: il reparto o l'abilità che sblocca, l'unità unica della potenza, altrimenti il suo oggetto. */
export function techImage(scene: Phaser.Scene, id: TechId, civ: CivId): string {
  const t = techInfo(id);
  if (t.unit) return `u-${t.unit}`;
  if (t.boost) return `u-${t.boost.unit}`; // potenziamento: la foto del suo reparto
  if (t.ability) return `a-${t.ability}`;
  if (t.unique) return `u-${BALANCE.civs[civ].unit}`;
  return scene.textures.exists(`t-${id}`) ? `t-${id}` : 'room-laboratorio';
}

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
