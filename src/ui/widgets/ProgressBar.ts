import Phaser from 'phaser';
import { PALETTE } from '../../config/palette';

/** Barra di avanzamento generica (cantieri, ricerche, timer, deposito): sfondo scuro + riempimento colorato. */
export class ProgressBar extends Phaser.GameObjects.Container {
  private fill: Phaser.GameObjects.Rectangle;
  private bw: number;

  constructor(scene: Phaser.Scene, w: number, h: number, color: number = PALETTE.ocra) {
    super(scene, 0, 0);
    this.bw = w;
    const bg = scene.add.rectangle(0, 0, w, h, PALETTE.pannello, 1).setOrigin(0);
    this.fill = scene.add.rectangle(0, 0, 0, h, color, 1).setOrigin(0);
    this.add([bg, this.fill]);
    this.setSize(w, h);
    scene.add.existing(this);
  }

  setProgress(pct: number): this {
    this.fill.width = this.bw * Phaser.Math.Clamp(pct, 0, 1);
    return this;
  }

  setColor(color: number): this {
    this.fill.setFillStyle(color, 1);
    return this;
  }
}
