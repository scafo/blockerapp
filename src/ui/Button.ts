import Phaser from 'phaser';
import { PALETTE, hex } from '../config/palette';
import { textStyle } from './style';

/** Bottone piatto: pannello scuro, filo d'oro in basso, etichetta chiara. */
export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Rectangle;
  private label: Phaser.GameObjects.Text;
  private edge: Phaser.GameObjects.Rectangle;
  private active_ = false;
  private base = { x: 0, y: 0 };
  private pressT: { s: number } = { s: 1 };

  constructor(scene: Phaser.Scene, text: string, w: number, h: number, onClick: () => void, size = 16) {
    super(scene, 0, 0);
    this.bg = scene.add.rectangle(0, 0, w, h, PALETTE.pannello, 0.94).setStrokeStyle(1, PALETTE.linea).setOrigin(0);
    this.edge = scene.add.rectangle(0, h - 2, w, 2, PALETTE.ocra, 0.9).setOrigin(0); // filo d'oro in basso
    this.label = scene.add.text(w / 2, h / 2, text, textStyle(size, PALETTE.carta)).setOrigin(0.5);
    this.add([this.bg, this.edge, this.label]);
    this.setSize(w, h);
    // risposta al tocco: si abbassa quando premi, torna su con un piccolo rimbalzo quando lasci; si schiarisce sotto il mouse
    this.bg.setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.squash(0.94, 60, 'Quad.easeOut'))
      .on('pointerover', () => { if (!this.active_) this.bg.setFillStyle(0x1b2634, 0.97); })
      .on('pointerout', () => {
        if (!this.active_) this.bg.setFillStyle(PALETTE.pannello, 0.94);
        if (this.scale < 1) this.squash(1, 120, 'Quad.easeOut');
      })
      .on('pointerup', () => {
        this.squash(1, 220, 'Back.easeOut', 0.94);
        onClick();
      });
    scene.add.existing(this);
  }

  /** Scala attorno al centro (il contenitore ha l'origine in alto a sinistra): la posizione compensa. */
  private squash(to: number, duration: number, ease: string, from = this.scale) {
    if (this.scale === 1) this.base = { x: this.x, y: this.y };
    const b = this.base, o = { s: from };
    this.scene.tweens.killTweensOf(this.pressT);
    this.pressT = o;
    this.scene.tweens.add({
      targets: o, s: to, duration, ease,
      onUpdate: () => this.setScale(o.s).setPosition(b.x + ((1 - o.s) * this.width) / 2, b.y + ((1 - o.s) * this.height) / 2),
    });
  }

  /** Azione principale dello schermo (es. GIOCA): fondo oro, etichetta scura, si distingue dalle altre. */
  setPrimary(): this {
    this.setOn(true);
    this.edge.setFillStyle(0xfff1c4, 1);
    return this;
  }

  setOn(on: boolean): this {
    this.active_ = on;
    this.bg.setFillStyle(on ? PALETTE.ocra : PALETTE.pannello, on ? 1 : 0.94);
    this.label.setColor(hex(on ? PALETTE.inchiostro : PALETTE.carta));
    return this;
  }

  setLabel(text: string): this {
    this.label.setText(text);
    return this;
  }

  get isOn() {
    return this.active_;
  }

  contains(x: number, y: number): boolean {
    return x >= this.x && x <= this.x + this.width && y >= this.y && y <= this.y + this.height;
  }
}
