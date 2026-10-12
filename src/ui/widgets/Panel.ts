import Phaser from 'phaser';
import { PALETTE } from '../../config/palette';
import { textStyle } from '../style';

/** Pannello ardesia con filo avorio sottile, filo d'accento opzionale in alto e titolo opzionale (verde acqua). */
export class Panel extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Rectangle;
  private title?: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, w: number, h: number, opts: { title?: string; accent?: boolean } = {}) {
    super(scene, 0, 0);
    this.bg = scene.add.rectangle(0, 0, w, h, PALETTE.inchiostro, 0.97).setStrokeStyle(1, PALETTE.carta, 0.55).setOrigin(0);
    this.add(this.bg);
    if (opts.accent) this.add(scene.add.rectangle(0, 0, w, 2, PALETTE.ocra, 0.9).setOrigin(0));
    if (opts.title) {
      this.title = scene.add.text(12, 10, opts.title.toUpperCase(), textStyle(13, PALETTE.ocra)).setOrigin(0);
      this.add(this.title);
    }
    this.setSize(w, h);
    scene.add.existing(this);
  }

  setTitle(text: string): this {
    this.title?.setText(text.toUpperCase());
    return this;
  }
}
