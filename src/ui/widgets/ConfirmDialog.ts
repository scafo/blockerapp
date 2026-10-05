import Phaser from 'phaser';
import { PALETTE } from '../../config/palette';
import { textStyle } from '../style';
import { Button } from '../Button';

/** Finestra di conferma modale (es. RITIRATA, azzera profilo): velo + pannello + annulla/conferma. */
export class ConfirmDialog extends Phaser.GameObjects.Container {
  constructor(
    scene: Phaser.Scene, screenW: number, screenH: number, title: string, body: string,
    confirmLabel: string, onConfirm: () => void, opts: { danger?: boolean; cancelLabel?: string } = {},
  ) {
    super(scene, 0, 0);
    const veil = scene.add.rectangle(0, 0, screenW, screenH, 0x000000, 0.6).setOrigin(0).setInteractive();
    const pw = 360, ph = 180, px = (screenW - pw) / 2, py = (screenH - ph) / 2;
    const panel = scene.add.rectangle(px, py, pw, ph, PALETTE.pannello, 0.98).setStrokeStyle(1, PALETTE.linea).setOrigin(0);
    const titleTxt = scene.add.text(px + pw / 2, py + 28, title.toUpperCase(), textStyle(15, PALETTE.ocra)).setOrigin(0.5);
    const bodyTxt = scene.add.text(px + pw / 2, py + 64, body,
      { ...textStyle(12, opts.danger ? PALETTE.ko : PALETTE.carta, false), wordWrap: { width: pw - 40 }, align: 'center' }).setOrigin(0.5, 0);
    const cancel = new Button(scene, opts.cancelLabel ?? 'ANNULLA', 140, 40, () => this.destroy(), 13);
    cancel.setPosition(px + 24, py + ph - 54);
    const confirm = new Button(scene, confirmLabel, 140, 40, () => { onConfirm(); this.destroy(); }, 13);
    confirm.setPosition(px + pw - 164, py + ph - 54);
    this.add([veil, panel, titleTxt, bodyTxt, cancel, confirm]);
    this.setDepth(1000);
    scene.add.existing(this);
  }
}
