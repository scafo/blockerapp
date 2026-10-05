import Phaser from 'phaser';
import { PALETTE } from '../../config/palette';
import { textStyle } from '../style';

/** Pallino o etichetta piccola per notifiche, livelli o distintivi: puntino colorato o numero/testo breve. */
export class Badge extends Phaser.GameObjects.Container {
  private circle: Phaser.GameObjects.Arc;
  private label?: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, color: number = PALETTE.ocra, text?: string) {
    super(scene, 0, 0);
    const r = text ? 9 : 4;
    this.circle = scene.add.circle(0, 0, r, color, 1);
    this.add(this.circle);
    if (text) {
      this.label = scene.add.text(0, 0, text, textStyle(9, PALETTE.inchiostro)).setOrigin(0.5);
      this.add(this.label);
    }
    scene.add.existing(this);
  }

  setText(text: string): this {
    this.label?.setText(text);
    return this;
  }

  setColor(color: number): this {
    this.circle.setFillStyle(color, 1);
    return this;
  }
}
