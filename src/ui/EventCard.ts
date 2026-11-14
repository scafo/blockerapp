// Carta evento stile Reigns: trascinala a sinistra o a destra (o tocca le scelte). La run è in pausa.
// In alto l'illustrazione dell'evento (generata con Draw Things, `ev-<id>`), sotto la didascalia e il racconto.
import { sfx } from '../audio/sfx';
import Phaser from 'phaser';
import { PALETTE } from '../config/palette';
import type { EventChoice, GameEvent } from '../game/events';
import { termLabel as italic, termStyle as textStyle } from './terminal';
import { UI, view } from './screen';
import { coverImage, fade } from './images';
import { TCOL } from './terminal';

const MAX_W = 380;
const IMG_H = 170; // illustrazione
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
    const shade = scene.add.rectangle(0, 0, width, height, 0x000000, 0.55).setOrigin(0).setInteractive();
    const cx = width / 2, cy = height / 2;

    // altezza su misura del racconto
    const probe = scene.add.text(0, 0, ev.text, textStyle(13, PALETTE.carta, false)).setWordWrapWidth(W - 40).setLineSpacing(4);
    const H = IMG_H + 30 + probe.height + 46;
    probe.destroy();
    const bg = scene.add.rectangle(0, 0, W, H, TCOL.bg).setStrokeStyle(1, ev.rare ? 0x9fe0a8 : TCOL.edge, 0.6);
    const art = scene.textures.exists(`ev-${ev.id}`) ? coverImage(scene, `ev-${ev.id}`, -W / 2, -H / 2, W, IMG_H, 0.5) : null;
    const artFade = fade(scene, -W / 2, -H / 2 + IMG_H * 0.55, W, IMG_H * 0.45 + 1, TCOL.bg, 0, 1);
    const head = scene.add.text(-W / 2 + 20, -H / 2 + IMG_H + 6, ev.rare ? 'Frammento dalla Caduta' : 'Rapporto dal campo', italic(11, ev.rare ? 0x9fe0a8 : TCOL.label));
    const body = scene.add.text(-W / 2 + 20, head.y + 22, ev.text, textStyle(13, PALETTE.carta, false))
      .setWordWrapWidth(W - 40).setLineSpacing(4);
    const hintTxt = scene.add.text(0, H / 2 - 18, '← trascina la carta →', italic(11)).setOrigin(0.5);
    this.card = scene.add.container(cx, cy - 20, [bg, ...(art ? [art] : []), artFade, head, body, hintTxt]);

    // scelte sotto la carta (anche toccabili)
    const mk = (side: 'left' | 'right') => {
      const c = ev[side];
      const ok = canChoose(c);
      const t = scene.add.text(cx + (side === 'left' ? -W / 2 : W / 2), cy - 20 + H / 2 + 28,
        side === 'left' ? `← ${c.label}` : `${c.label} →`, textStyle(15, ok ? PALETTE.carta : PALETTE.tenue))
        .setOrigin(side === 'left' ? 0 : 1, 0.5).setBackgroundColor(ok ? '#35424e' : '#0a1018').setPadding(12, 9, 12, 9);
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
    sfx('select');
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
