import Phaser from 'phaser';
import { PALETTE } from '../config/palette';
import { buildLandMask } from '../map/landMask';
import { randomSeed } from '../map/rng';
import { loadProfile } from '../save/storage';
import { textStyle } from '../ui/style';
import { uiCamera, view } from '../ui/screen';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create() {
    uiCamera(this);
    const { width, height } = view(this);
    this.add.text(width / 2, height / 2, 'RICOGNIZIONE IN CORSO…', textStyle(18, PALETTE.ocra)).setOrigin(0.5);

    const g = this.add.graphics().fillStyle(0xffffff).fillRect(0, 0, 6, 6);
    g.generateTexture('dot', 6, 6).destroy();

    // Lascia disegnare il testo di caricamento prima del calcolo (sincrono).
    this.time.delayedCall(30, () => {
      this.registry.set('landMask', buildLandMask());
      // ?seed=... salta l'accampamento e apre subito quella mappa (test e rivincite condivise)
      const seed = new URLSearchParams(location.search).get('seed');
      if (seed) this.scene.start('Run', { seed });
      else if (loadProfile().runs === 0) this.scene.start('Run', { seed: randomSeed() }); // prima volta: subito in azione (run guidata)
      else this.scene.start('Camp');
    });
  }
}
