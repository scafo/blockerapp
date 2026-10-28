// Carta unità: icona e ricarica che scende dall'alto.
import Phaser from 'phaser';
import type { AbilityType, UnitType } from '../config/balance';
import { PALETTE } from '../config/palette';
import { TCOL } from './terminal';
import { drawAbilityIcon, drawUnitIcon } from './unitIcons';

// solo l'icona (Nico: nomi e costi non si leggevano): carte quadrate, in file da due a sinistra
export const CARD_W = 58;
export const CARD_H = 58;

export class UnitCard extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Rectangle;
  private cool: Phaser.GameObjects.Rectangle;
  private selected = false;
  baseY = 0;

  /** Carta del reparto: l'icona e basta; se non bastano truppe o risorsa si spegne. */
  constructor(scene: Phaser.Scene, readonly type: UnitType, onClick: () => void) {
    super(scene, 0, 0);
    this.bg = scene.add.rectangle(0, 0, CARD_W, CARD_H, TCOL.bg, 0.92).setOrigin(0).setStrokeStyle(1, TCOL.edge, 0.75);
    const icon = scene.add.graphics(); // icone disegnate di prima (Nico: le nuove non piacevano)
    drawUnitIcon(icon, type, CARD_W / 2, CARD_H / 2, 13, PALETTE.carta);
    this.cool = scene.add.rectangle(0, 0, CARD_W, 0, TCOL.bg, 0.75).setOrigin(0);
    this.add([this.bg, icon, this.cool]);
    this.setSize(CARD_W, CARD_H);
    this.bg.setInteractive({ useHandCursor: true }).on('pointerup', onClick);
    scene.add.existing(this);
  }

  /** cooldown 0..1 (1 = appena usata), usable = si può schierare, troopsOk/resOk = bastano truppe e risorsa. */
  refresh(cooldown: number, usable: boolean, selected: boolean, troopsOk = true, resOk = true) {
    this.cool.setSize(CARD_W, CARD_H * cooldown);
    this.setAlpha(usable && cooldown === 0 && troopsOk && resOk ? 1 : 0.45);
    if (selected !== this.selected) {
      this.selected = selected;
      this.bg.setStrokeStyle(selected ? 2 : 1, selected ? TCOL.text : TCOL.edge, selected ? 1 : 0.75);
      this.scene.tweens.add({ targets: this, y: this.baseY - (selected ? 8 : 0), duration: 120 });
    }
  }

  baseX = 0;

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
    this.bg = scene.add.rectangle(0, 0, CARD_W, CARD_H, TCOL.bg, 0.92).setOrigin(0).setStrokeStyle(1, TCOL.edge, 0.75);
    const parts: Phaser.GameObjects.GameObject[] = [this.bg];
    const g = scene.add.graphics();
    drawAbilityIcon(g, ability, CARD_W / 2, CARD_H / 2, 13, PALETTE.carta);
    parts.push(g);
    this.cool = scene.add.rectangle(0, 0, CARD_W, 0, TCOL.bg, 0.75).setOrigin(0);
    this.add([...parts, this.cool]);
    this.setSize(CARD_W, CARD_H);
    this.bg.setInteractive({ useHandCursor: true }).on('pointerup', onClick);
    scene.add.existing(this);
  }

  refresh(cooldown: number, selected: boolean) {
    this.cool.setSize(CARD_W, CARD_H * cooldown);
    this.setAlpha(cooldown === 0 ? 1 : 0.55);
    if (selected !== this.selected) {
      this.selected = selected;
      this.bg.setStrokeStyle(selected ? 2 : 1, selected ? TCOL.text : TCOL.edge, selected ? 1 : 0.75);
      this.scene.tweens.add({ targets: this, y: this.baseY - (selected ? 8 : 0), duration: 120 });
    }
  }

  baseX = 0;

  contains(x: number, y: number): boolean {
    return x >= this.x && x <= this.x + CARD_W * this.scaleX && y >= this.y && y <= this.y + CARD_H * this.scaleY;
  }
}
