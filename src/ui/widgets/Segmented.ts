import Phaser from 'phaser';
import { PALETTE, hex } from '../../config/palette';
import { textStyle } from '../style';

/** Selettore a segmenti (una sola scelta attiva), come i tasti di durata/potenza nella preparazione. */
export class Segmented extends Phaser.GameObjects.Container {
  private segs: { bg: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }[] = [];
  private value_: number;

  constructor(scene: Phaser.Scene, w: number, h: number, options: string[], initial: number, onChange: (i: number) => void) {
    super(scene, 0, 0);
    this.value_ = initial;
    const segW = w / options.length;
    options.forEach((label, i) => {
      const bg = scene.add.rectangle(i * segW, 0, segW, h, PALETTE.pannello, 0.94).setStrokeStyle(1, PALETTE.linea).setOrigin(0)
        .setInteractive({ useHandCursor: true }).on('pointerup', () => { this.setValue(i); onChange(i); });
      const txt = scene.add.text(i * segW + segW / 2, h / 2, label, textStyle(13, PALETTE.carta)).setOrigin(0.5);
      this.add([bg, txt]);
      this.segs.push({ bg, label: txt });
    });
    this.setSize(w, h);
    this.paint();
    scene.add.existing(this);
  }

  private paint(): void {
    this.segs.forEach((s, i) => {
      const on = i === this.value_;
      s.bg.setFillStyle(on ? PALETTE.ocra : PALETTE.pannello, on ? 1 : 0.94);
      s.label.setColor(hex(on ? PALETTE.inchiostro : PALETTE.carta));
    });
  }

  setValue(i: number): this {
    this.value_ = i;
    this.paint();
    return this;
  }

  get value(): number {
    return this.value_;
  }
}
