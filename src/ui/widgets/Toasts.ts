import Phaser from 'phaser';
import { PALETTE } from '../../config/palette';
import { textStyle } from '../style';

export type ToastKind = 'info' | 'ok' | 'warn';

/** Coda di avvisi brevi in basso al centro: appaiono, restano un attimo, svaniscono. Una per scena. */
export class Toasts {
  private scene: Phaser.Scene;
  private x: number;
  private y: number;
  private active: Phaser.GameObjects.Container[] = [];

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene = scene;
    this.x = x;
    this.y = y;
  }

  show(text: string, kind: ToastKind = 'info', ms = 2200): void {
    const color = kind === 'ok' ? PALETTE.radioattivo : kind === 'warn' ? PALETTE.allerta : PALETTE.carta;
    const label = this.scene.add.text(0, 0, text, textStyle(12, color, false)).setOrigin(0.5);
    const bg = this.scene.add.rectangle(0, 0, label.width + 24, 28, PALETTE.inchiostro, 0.92).setStrokeStyle(1, PALETTE.linea);
    const c = this.scene.add.container(this.x, this.y + 20, [bg, label]).setAlpha(0).setDepth(900);
    this.active.push(c);
    this.reflow();
    this.scene.tweens.add({ targets: c, alpha: 1, y: c.y - 20, duration: 160 });
    this.scene.time.delayedCall(ms, () => {
      this.scene.tweens.add({
        targets: c, alpha: 0, duration: 200,
        onComplete: () => { c.destroy(); this.active = this.active.filter((a) => a !== c); this.reflow(); },
      });
    });
  }

  private reflow(): void {
    this.active.forEach((c, i) => { c.y = this.y - i * 34; });
  }
}
