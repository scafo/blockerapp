import Phaser from 'phaser';
import { PALETTE, hex } from '../../config/palette';
import { textStyle } from '../style';

/** Aggiunge un fumetto al passaggio del mouse (300ms di attesa) su un oggetto interattivo già posizionato. */
export function attachTooltip(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.GameObject & { x: number; y: number },
  text: string | (() => string),
): { hide: () => void } {
  let bubble: Phaser.GameObjects.Text | undefined;
  let timer: Phaser.Time.TimerEvent | undefined;
  const show = () => {
    const t = typeof text === 'function' ? text() : text;
    if (!t) return;
    bubble = scene.add.text(target.x, target.y - 18, t, textStyle(11, PALETTE.carta, false))
      .setOrigin(0.5, 1).setBackgroundColor(hex(PALETTE.inchiostro)).setPadding(6, 4, 6, 4).setDepth(999).setAlpha(0);
    scene.tweens.add({ targets: bubble, alpha: 1, duration: 100 });
  };
  const hide = () => { timer?.remove(); bubble?.destroy(); bubble = undefined; };
  target.on('pointerover', () => { timer = scene.time.delayedCall(300, show); });
  target.on('pointerout', hide);
  target.on('pointerdown', hide);
  target.once('destroy', hide);
  return { hide };
}
