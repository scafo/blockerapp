import Phaser from 'phaser';
import { PALETTE } from '../../config/palette';
import { textStyle } from '../style';

/**
 * Cassetto che scorre da un lato (destra di default), con velo dietro che chiude al tocco.
 * Aggiungi i tuoi elementi a `content` in coordinate locali (0,0 = angolo in alto a sinistra del pannello).
 */
export class Drawer extends Phaser.GameObjects.Container {
  readonly content: Phaser.GameObjects.Container;
  private veil: Phaser.GameObjects.Rectangle;
  private closedX: number;
  private openX: number;
  private onClosed?: () => void;

  constructor(scene: Phaser.Scene, screenW: number, screenH: number, panelW: number, opts: { side?: 'right' | 'left'; title?: string } = {}) {
    super(scene, 0, 0);
    const side = opts.side ?? 'right';
    this.openX = side === 'right' ? screenW - panelW : 0;
    this.closedX = side === 'right' ? screenW : -panelW;
    this.veil = scene.add.rectangle(0, 0, screenW, screenH, 0x000000, 0).setOrigin(0).setInteractive();
    this.veil.on('pointerup', () => this.close());
    this.content = scene.add.container(this.closedX, 0);
    const bg = scene.add.rectangle(0, 0, panelW, screenH, PALETTE.pannello, 0.98).setStrokeStyle(1, PALETTE.linea).setOrigin(0);
    const closeBtn = scene.add.text(panelW - 20, 16, '✕', textStyle(16, PALETTE.tenue))
      .setOrigin(0.5).setInteractive({ useHandCursor: true }).on('pointerup', () => this.close());
    this.content.add([bg, closeBtn]);
    if (opts.title) this.content.add(scene.add.text(16, 16, opts.title.toUpperCase(), textStyle(14, PALETTE.ocra)).setOrigin(0, 0.5));
    this.add([this.veil, this.content]);
    this.setDepth(800);
    scene.add.existing(this);
    scene.tweens.add({ targets: this.veil, alpha: 0.55, duration: 160 });
    scene.tweens.add({ targets: this.content, x: this.openX, duration: 200, ease: 'Quad.easeOut' });
  }

  onClose(fn: () => void): this {
    this.onClosed = fn;
    return this;
  }

  close(): void {
    this.scene.tweens.add({ targets: this.veil, alpha: 0, duration: 140 });
    this.scene.tweens.add({
      targets: this.content, x: this.closedX, duration: 160, ease: 'Quad.easeIn',
      onComplete: () => { this.onClosed?.(); this.destroy(); },
    });
  }
}
