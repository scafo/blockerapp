import Phaser from 'phaser';
import { PALETTE, hex } from '../../config/palette';
import { textStyle } from '../style';

/** Barra di schede: sottolineatura dorata sotto la scheda attiva, le altre tenui. */
export class Tabs extends Phaser.GameObjects.Container {
  private tabs: { label: Phaser.GameObjects.Text; underline: Phaser.GameObjects.Rectangle }[] = [];
  private value_: number;

  constructor(scene: Phaser.Scene, w: number, h: number, options: string[], initial: number, onChange: (i: number) => void) {
    super(scene, 0, 0);
    this.value_ = initial;
    const tabW = w / options.length;
    options.forEach((label, i) => {
      const x = i * tabW + tabW / 2;
      const txt = scene.add.text(x, h / 2 - 4, label.toUpperCase(), textStyle(13, i === initial ? PALETTE.carta : PALETTE.tenue))
        .setOrigin(0.5).setInteractive({ useHandCursor: true }).on('pointerup', () => { this.setValue(i); onChange(i); });
      const underline = scene.add.rectangle(x, h - 2, tabW - 12, 2, PALETTE.ocra, 1).setVisible(i === initial);
      this.add([txt, underline]);
      this.tabs.push({ label: txt, underline });
    });
    this.setSize(w, h);
    scene.add.existing(this);
  }

  setValue(i: number): this {
    this.value_ = i;
    this.tabs.forEach((t, k) => { t.label.setColor(hex(k === i ? PALETTE.carta : PALETTE.tenue)); t.underline.setVisible(k === i); });
    return this;
  }

  get value(): number {
    return this.value_;
  }
}
