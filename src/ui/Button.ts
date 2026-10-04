import Phaser from 'phaser';
import { PALETTE, hex } from '../config/palette';
import { textStyle } from './style';

/** Bottone piatto: pannello scuro, filo d'oro in basso, etichetta chiara. */
export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Rectangle;
  private label: Phaser.GameObjects.Text;
  private edge: Phaser.GameObjects.Rectangle;
  private active_ = false;

  constructor(scene: Phaser.Scene, text: string, w: number, h: number, onClick: () => void, size = 16) {
    super(scene, 0, 0);
    this.bg = scene.add.rectangle(0, 0, w, h, PALETTE.pannello, 0.94).setStrokeStyle(1, PALETTE.linea).setOrigin(0);
    this.edge = scene.add.rectangle(0, h - 2, w, 2, PALETTE.ocra, 0.9).setOrigin(0); // filo d'oro in basso
    this.label = scene.add.text(w / 2, h / 2, text, textStyle(size, PALETTE.carta)).setOrigin(0.5);
    this.add([this.bg, this.edge, this.label]);
    this.setSize(w, h);
    this.bg.setInteractive({ useHandCursor: true }).on('pointerup', () => {
      scene.tweens.add({ targets: this, scale: { from: 0.92, to: 1 }, duration: 120 });
      onClick();
    });
    scene.add.existing(this);
  }

  setOn(on: boolean): this {
    this.active_ = on;
    this.bg.setFillStyle(on ? PALETTE.ocra : PALETTE.pannello, on ? 1 : 0.94);
    this.label.setColor(hex(on ? PALETTE.inchiostro : PALETTE.carta));
    return this;
  }

  setLabel(text: string): this {
    this.label.setText(text);
    return this;
  }

  get isOn() {
    return this.active_;
  }

  contains(x: number, y: number): boolean {
    return x >= this.x && x <= this.x + this.width && y >= this.y && y <= this.y + this.height;
  }
}
