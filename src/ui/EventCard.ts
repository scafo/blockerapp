// Carta evento stile Reigns: trascinala a sinistra o a destra (o tocca le scelte). La run è in pausa.
import Phaser from 'phaser';
import { PALETTE, hex } from '../config/palette';
import type { EventChoice, GameEvent } from '../game/events';
import { textStyle } from './style';
import { UI, view } from './screen';

const MAX_W = 380;
const H = 240;
const SWIPE = 90; // px per confermare con un trascinamento

export class EventCard extends Phaser.GameObjects.Container {
  private card: Phaser.GameObjects.Container;
  private leftLbl: Phaser.GameObjects.Text;
  private rightLbl: Phaser.GameObjects.Text;
  private done = false;
  private cardW = MAX_W;

  constructor(
    scene: Phaser.Scene,
    ev: GameEvent,
    canChoose: (c: EventChoice) => boolean,
    private onChoose: (side: 'left' | 'right') => void,
  ) {
    super(scene, 0, 0);
    const { width, height } = view(scene);
    const W = Math.min(MAX_W, width - 24);
    this.cardW = W;
    const shade = scene.add.rectangle(0, 0, width, height, PALETTE.inchiostro, 0.55).setOrigin(0).setInteractive();
    const cx = width / 2, cy = height / 2;

    const bg = scene.add.rectangle(0, 0, W, H, PALETTE.inchiostro).setStrokeStyle(2, ev.rare ? PALETTE.radioattivo : PALETTE.ocra);
    const head = scene.add.text(-W / 2 + 16, -H / 2 + 12, ev.rare ? '◉ FRAMMENTO DALLA CADUTA' : 'RAPPORTO DAL CAMPO', textStyle(11, ev.rare ? PALETTE.radioattivo : PALETTE.ruggine));
    const body = scene.add.text(0, -H / 2 + 40, ev.text, textStyle(15, PALETTE.carta, false))
      .setOrigin(0.5, 0).setAlign('center').setWordWrapWidth(W - 40).setLineSpacing(3);
    const hintTxt = scene.add.text(0, H / 2 - 64, '← trascina la carta →', textStyle(10, PALETTE.ruggine, false)).setOrigin(0.5);
    this.card = scene.add.container(cx, cy, [bg, head, body, hintTxt]);

    // scelte sotto la carta (anche toccabili)
    const mk = (side: 'left' | 'right') => {
      const c = ev[side];
      const ok = canChoose(c);
      const t = scene.add.text(cx + (side === 'left' ? -W / 2 + 8 : W / 2 - 8), cy + H / 2 - 26,
        side === 'left' ? `← ${c.label}` : `${c.label} →`, textStyle(15, ok ? PALETTE.carta : PALETTE.tenue))
        .setOrigin(side === 'left' ? 0 : 1, 0.5).setBackgroundColor(hex(ok ? PALETTE.inchiostro : 0x14221e)).setPadding(10, 7, 10, 7);
      if (ok) t.setInteractive({ useHandCursor: true }).on('pointerup', () => this.pick(side));
      return t;
    };
    this.leftLbl = mk('left');
    this.rightLbl = mk('right');
    this.add([shade, this.card, this.leftLbl, this.rightLbl]);
    scene.add.existing(this);
    this.setDepth(50);

    // trascinamento
    bg.setInteractive({ draggable: true });
    scene.input.setDraggable(bg);
    bg.on('drag', (p: Phaser.Input.Pointer) => {
      if (this.done) return;
      const dx = (p.x - p.downX) / UI();
      this.card.x = cx + dx;
      this.card.angle = dx / 18;
      this.leftLbl.setScale(dx < -20 ? 1.12 : 1);
      this.rightLbl.setScale(dx > 20 ? 1.12 : 1);
    });
    bg.on('dragend', () => {
      if (this.done) return;
      const dx = this.card.x - cx;
      const side = dx < -SWIPE ? 'left' : dx > SWIPE ? 'right' : null;
      if (side && canChoose(ev[side])) return this.pick(side);
      scene.tweens.add({ targets: this.card, x: cx, angle: 0, duration: 180, ease: 'Back.easeOut' });
    });

    this.card.setScale(0.7).setAlpha(0);
    scene.tweens.add({ targets: this.card, scale: 1, alpha: 1, duration: 220, ease: 'Back.easeOut' });
  }

  private pick(side: 'left' | 'right') {
    if (this.done) return;
    this.done = true;
    const { width } = view(this.scene);
    this.scene.tweens.add({
      targets: this.card, x: side === 'left' ? -this.cardW : width + this.cardW, angle: side === 'left' ? -25 : 25, duration: 260, ease: 'Quad.easeIn',
      onComplete: () => this.destroy(),
    });
    this.scene.tweens.add({ targets: [this.leftLbl, this.rightLbl], alpha: 0, duration: 150 });
    this.onChoose(side);
  }
}
