import Phaser from 'phaser';
import { PALETTE } from '../config/palette';
import { buildLandMask } from '../map/landMask';
import { randomSeed } from '../map/rng';
import { textStyle } from '../ui/style';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create() {
    const { width, height } = this.scale;
    this.add.text(width / 2, height / 2, 'RICOGNIZIONE IN CORSO…', textStyle(18, PALETTE.ocra)).setOrigin(0.5);

    const g = this.add.graphics().fillStyle(0xffffff).fillRect(0, 0, 6, 6);
    g.generateTexture('dot', 6, 6).destroy();

    // Lascia disegnare il testo di caricamento prima del calcolo (sincrono).
    this.time.delayedCall(30, () => {
      this.registry.set('landMask', buildLandMask());
      const seed = new URLSearchParams(location.search).get('seed') || randomSeed();
      this.scene.start('Run', { seed });
    });
  }
}
