// Schermata d'entrata (Figma di Nico): collage notturno a tutto schermo, titolo al centro tra due staffe verticali.
// Un tocco ovunque apre il caricamento.
import Phaser from 'phaser';
import { coverImage } from '../ui/images';
import { uiCamera, view } from '../ui/screen';
import type { LoadData } from './LoadScene';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create(next: LoadData) {
    uiCamera(this);
    const { width: W, height: H } = view(this);
    this.cameras.main.setBackgroundColor(0x232b33);
    coverImage(this, 'title-bg', 0, 0, W, H);

    // staffe: linee sottili con un quadratino a ogni capo (proporzioni del riferimento 1728×1117)
    const g = this.add.graphics();
    const xs = [W * 0.154, W * 0.844], y0 = H * 0.197, y1 = H * 0.775, q = 7;
    g.lineStyle(1, 0xffffff, 1);
    for (const x of xs) {
      g.lineBetween(x, y0, x, y1);
      g.fillStyle(0xffffff, 1).fillRect(x - q / 2, y0 - q / 2, q, q).fillRect(x - q / 2, y1 - q / 2, q, q);
    }

    const size = Math.round(Math.min(W * 0.0556, H * 0.1, 110));
    this.add.text(W / 2, H / 2, 'ARCHEON', {
      fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      fontStyle: '500',
      fontSize: `${Math.max(40, size)}px`,
      color: '#ffffff',
      shadow: { offsetX: 0, offsetY: -2, color: '#000000', blur: 24, fill: true },
    }).setOrigin(0.5);

    this.cameras.main.fadeIn(600, 0, 0, 0);
    this.input.once('pointerup', () => {
      this.cameras.main.fadeOut(400, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Load', next));
    });
  }
}
