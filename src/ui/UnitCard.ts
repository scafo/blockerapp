// Carta unità: icona, nome, costo in truppe, ricarica che scende dall'alto.
import Phaser from 'phaser';
import { BALANCE, type UnitType } from '../config/balance';
import { PALETTE } from '../config/palette';
import { unitInfo } from '../game/units';
import { textStyle } from './style';
import { drawUnitIcon } from './unitIcons';

export const CARD_W = 64;
export const CARD_H = 76;

export class UnitCard extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Rectangle;
  private cool: Phaser.GameObjects.Rectangle;
  private selected = false;
  baseY = 0;

  constructor(scene: Phaser.Scene, readonly type: UnitType, onClick: () => void, costValue: number = BALANCE.units[type].cost) {
    super(scene, 0, 0);
    this.bg = scene.add.rectangle(0, 0, CARD_W, CARD_H, PALETTE.inchiostro, 0.92).setOrigin(0).setStrokeStyle(2, PALETTE.ocra);
    const icon = scene.add.graphics();
    drawUnitIcon(icon, type, CARD_W / 2, 22, 12, PALETTE.carta);
    const name = scene.add.text(CARD_W / 2, 44, unitInfo(type).short, textStyle(10, PALETTE.carta)).setOrigin(0.5);
    const cost = scene.add.text(CARD_W / 2, 61, `${costValue}`, textStyle(13, PALETTE.ocra)).setOrigin(0.5);
    this.cool = scene.add.rectangle(0, 0, CARD_W, 0, PALETTE.inchiostro, 0.75).setOrigin(0);
    this.add([this.bg, icon, name, cost, this.cool]);
    this.setSize(CARD_W, CARD_H);
    this.bg.setInteractive({ useHandCursor: true }).on('pointerup', onClick);
    scene.add.existing(this);
  }

  /** cooldown 0..1 (1 = appena usata), usable = truppe e limite ok. */
  refresh(cooldown: number, usable: boolean, selected: boolean) {
    this.cool.height = CARD_H * cooldown;
    this.cool.setSize(CARD_W, CARD_H * cooldown);
    this.setAlpha(usable && cooldown === 0 ? 1 : 0.5);
    if (selected !== this.selected) {
      this.selected = selected;
      this.bg.setStrokeStyle(selected ? 3 : 2, selected ? PALETTE.radioattivo : PALETTE.ocra);
      this.scene.tweens.add({ targets: this, y: this.baseY - (selected ? 8 : 0), duration: 120 });
    }
  }

  contains(x: number, y: number): boolean {
    return x >= this.x && x <= this.x + CARD_W && y >= this.y && y <= this.y + CARD_H;
  }
}
