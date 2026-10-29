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

    // staffe: linee sottili con un quadratino a ogni capo (proporzioni del riferimento 1728×1117).
    // Entrata (Nico): le linee partono dal basso e si aprono verso l'alto, poi compare il titolo.
    const g = this.add.graphics();
    const xs = [W * 0.154, W * 0.844], y0 = H * 0.197, y1 = H * 0.775, q = 7;
    const open = { k: 0 };
    const drawLines = () => {
      const top = y1 - (y1 - y0) * open.k;
      g.clear().lineStyle(1, 0xffffff, 1);
      for (const x of xs) {
        g.lineBetween(x, y1, x, top);
        g.fillStyle(0xffffff, 1).fillRect(x - q / 2, y1 - q / 2, q, q).fillRect(x - q / 2, top - q / 2, q, q);
      }
    };
    drawLines();
    this.tweens.add({ targets: open, k: 1, duration: 1100, delay: 350, ease: 'Cubic.easeInOut', onUpdate: drawLines });

    // titolo: si stringe da lettere larghe e trasparenti alla spaziatura normale, con un lampo leggero
    const size = Math.round(Math.min(W * 0.0556, H * 0.1, 110));
    const title = this.add.text(W / 2, H / 2, 'ARCHEON', {
      fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      fontStyle: '500',
      fontSize: `${Math.max(40, size)}px`,
      color: '#ffffff',
      shadow: { offsetX: 0, offsetY: -2, color: '#000000', blur: 24, fill: true },
    }).setOrigin(0.5).setAlpha(0);
    const sp = { v: Math.max(40, size) * 0.6 };
    title.setLetterSpacing(sp.v);
    this.tweens.add({ targets: title, alpha: 1, duration: 900, delay: 1150, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: sp, v: 0, duration: 1300, delay: 1150, ease: 'Expo.easeOut', onUpdate: () => title.setLetterSpacing(sp.v) });
    // poi respira piano (alone che sale e scende)
    this.time.delayedCall(2500, () => this.tweens.add({ targets: title, alpha: 0.82, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }));

    this.cameras.main.fadeIn(600, 0, 0, 0);
    this.input.once('pointerup', () => {
      this.cameras.main.fadeOut(400, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Load', next));
    });
  }
}
