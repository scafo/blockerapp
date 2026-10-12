// Carta unità: icona, nome, costo in truppe, ricarica che scende dall'alto.
import Phaser from 'phaser';
import { BALANCE, type AbilityType, type UnitType } from '../config/balance';
import buildingText from '../data/buildings.json';
import { PALETTE } from '../config/palette';
import { unitInfo } from '../game/units';
import { termStyle as textStyle } from './terminal';
import { drawAbilityIcon, drawUnitIcon } from './unitIcons';
import { drawResourceIcon } from './resourceIcons';

export const CARD_W = 92;
export const CARD_H = 76;

export class UnitCard extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Rectangle;
  private cool: Phaser.GameObjects.Rectangle;
  private selected = false;
  baseY = 0;

  constructor(scene: Phaser.Scene, readonly type: UnitType, onClick: () => void, costValue: number = BALANCE.units[type].cost, fuel = 0) {
    super(scene, 0, 0);
    this.bg = scene.add.rectangle(0, 0, CARD_W, CARD_H, 0x000000, 0.92).setOrigin(0).setStrokeStyle(1, 0xd8dadc, 0.75);
    const icon = scene.add.graphics();
    drawUnitIcon(icon, type, CARD_W / 2, 22, 12, PALETTE.carta);
    const name = scene.add.text(CARD_W / 2, 44, unitInfo(type).name.toUpperCase(), textStyle(10, PALETTE.carta)).setOrigin(0.5);
    if (name.width > CARD_W - 8) name.setScale((CARD_W - 8) / name.width); // nomi lunghi (Guardia repubblicana): stanno nella carta
    // costo in truppe; i mezzi anche in benzina dallo zaino (tanica + quantità)
    const cost = scene.add.text(fuel ? CARD_W / 2 - 6 : CARD_W / 2, 61, `${costValue}`, textStyle(13, PALETTE.ocra)).setOrigin(fuel ? 1 : 0.5, 0.5);
    const parts: Phaser.GameObjects.GameObject[] = [this.bg, icon, name, cost];
    if (fuel) {
      drawResourceIcon(icon, 'benzina', CARD_W / 2 + 6, 61, 5);
      parts.push(scene.add.text(CARD_W / 2 + 14, 61, `${fuel}`, textStyle(11, PALETTE.carta)).setOrigin(0, 0.5));
    }
    this.cool = scene.add.rectangle(0, 0, CARD_W, 0, 0x000000, 0.75).setOrigin(0);
    this.add([...parts, this.cool]);
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
      this.bg.setStrokeStyle(selected ? 2 : 1, selected ? 0xe1e496 : 0xd8dadc, selected ? 1 : 0.75);
      this.scene.tweens.add({ targets: this, y: this.baseY - (selected ? 8 : 0), duration: 120 });
    }
  }

  contains(x: number, y: number): boolean {
    return x >= this.x && x <= this.x + CARD_W * this.scaleX && y >= this.y && y <= this.y + CARD_H * this.scaleY;
  }
}

/** Abilità a ricarica (Ricognizione aerea, Bombardamento): si tocca e poi si tocca la mappa. */
export class AbilityCard extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Rectangle;
  private cool: Phaser.GameObjects.Rectangle;
  private selected = false;
  baseY = 0;

  constructor(scene: Phaser.Scene, readonly ability: AbilityType, onClick: () => void) {
    super(scene, 0, 0);
    this.bg = scene.add.rectangle(0, 0, CARD_W, CARD_H, 0x000000, 0.92).setOrigin(0).setStrokeStyle(1, 0x98a1d6, 0.9);
    const icon = scene.add.graphics();
    drawAbilityIcon(icon, ability, CARD_W / 2, 22, 12, PALETTE.radioattivo);
    const info = (buildingText as unknown as { abilita: Record<AbilityType, { name: string }> }).abilita[ability];
    const name = scene.add.text(CARD_W / 2, 46, info.name.toUpperCase(), textStyle(9, PALETTE.carta)).setOrigin(0.5).setAlign('center').setWordWrapWidth(CARD_W - 6);
    const tag = scene.add.text(CARD_W / 2, 64, 'ABILITÀ', textStyle(8, PALETTE.radioattivo, false)).setOrigin(0.5);
    this.cool = scene.add.rectangle(0, 0, CARD_W, 0, 0x000000, 0.75).setOrigin(0);
    this.add([this.bg, icon, name, tag, this.cool]);
    this.setSize(CARD_W, CARD_H);
    this.bg.setInteractive({ useHandCursor: true }).on('pointerup', onClick);
    scene.add.existing(this);
  }

  refresh(cooldown: number, selected: boolean) {
    this.cool.setSize(CARD_W, CARD_H * cooldown);
    this.setAlpha(cooldown === 0 ? 1 : 0.55);
    if (selected !== this.selected) {
      this.selected = selected;
      this.bg.setStrokeStyle(selected ? 2 : 1, selected ? 0xe1e496 : 0x98a1d6);
      this.scene.tweens.add({ targets: this, y: this.baseY - (selected ? 8 : 0), duration: 120 });
    }
  }

  contains(x: number, y: number): boolean {
    return x >= this.x && x <= this.x + CARD_W * this.scaleX && y >= this.y && y <= this.y + CARD_H * this.scaleY;
  }
}
