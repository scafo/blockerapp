import Phaser from 'phaser';
import { randomSeed } from '../map/rng';
import { loadProfile } from '../save/storage';
import { preloadImages } from '../ui/images';
import type { LoadData } from './LoadScene';

/** Carica le immagini e passa alla schermata di caricamento, che calcola terre e nazioni e apre la prima scena. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    preloadImages(this);
  }

  create() {
    this.cameras.main.setBackgroundColor(0x000000);
    const g = this.add.graphics().fillStyle(0xffffff).fillRect(0, 0, 6, 6);
    g.generateTexture('dot', 6, 6).destroy();
    // ?seed=... salta l'accampamento e apre subito quella mappa (test e rivincite condivise)
    const seed = new URLSearchParams(location.search).get('seed');
    const first = loadProfile().runs === 0; // prima volta: subito in azione (run guidata)
    const d: LoadData = seed || first ? { boot: true, next: 'Run', data: { seed: seed ?? randomSeed() } } : { boot: true, next: 'Camp' };
    this.scene.start('Load', d);
  }
}
