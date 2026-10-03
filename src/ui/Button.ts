import Phaser from 'phaser';
import { THEME, hex } from '../config/theme';
import { panel, textStyle } from './style';

/** Bottone piatto: pannello scuro, bordo 1px, angoli tagliati; acceso = colore UI attiva. */
export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private on_ = false;

  constructor(scene: Phaser.Scene, text: string, private bw: number, private bh: number, onClick: () => void, size = 13) {
    super(scene, 0, 0);
    this.bg = scene.add.graphics();
    this.label = scene.add.text(bw / 2, bh / 2, text, textStyle(size, THEME.testo)).setOrigin(0.5);
    this.add([this.bg, this.label]);
    this.setSize(bw, bh);
    this.draw();
    const hit = scene.add.zone(0, 0, bw, bh).setOrigin(0).setInteractive({ useHandCursor: true });
    this.add(hit);
    hit.on('pointerup', () => {
      scene.tweens.add({ targets: this.label, scale: { from: 0.9, to: 1 }, duration: 120 });
      onClick();
    });
    scene.add.existing(this);
  }

  private draw() {
    this.bg.clear();
    panel(this.bg, 0, 0, this.bw, this.bh, 6, this.on_ ? THEME.attivo : THEME.griglia, this.on_ ? 0x0f2a26 : THEME.pannello);
    this.label.setColor(hex(this.on_ ? THEME.attivo : THEME.testo));
  }

  setOn(on: boolean): this {
    this.on_ = on;
    this.draw();
    return this;
  }

  setLabel(text: string): this {
    this.label.setText(text);
    return this;
  }

  get isOn() {
    return this.on_;
  }
}
