import Phaser from 'phaser';
import { PALETTE, hex } from '../config/palette';
import { textStyle } from './style';

export interface ButtonOpts {
  icon?: string; // chiave di una texture già caricata, disegnata a sinistra dell'etichetta
  hotkey?: string; // es. "G": piccolo distintivo nell'angolo, solo indicativo (la scorciatoia vera la registra hotkeys.ts)
}

/** Bottone piatto: pannello scuro, filo d'oro in basso, etichetta chiara. */
export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Rectangle;
  private label: Phaser.GameObjects.Text;
  private edge: Phaser.GameObjects.Rectangle;
  private icon?: Phaser.GameObjects.Image;
  private hotkeyBadge?: Phaser.GameObjects.Text;
  private focusRing: Phaser.GameObjects.Rectangle;
  private reasonBubble?: Phaser.GameObjects.Text;
  private active_ = false;
  private disabled_ = false;
  private disabledReason?: string;
  private base = { x: 0, y: 0 };
  private pressT: { s: number } = { s: 1 };
  private btnW: number;

  constructor(scene: Phaser.Scene, text: string, w: number, h: number, onClick: () => void, size = 16, opts: ButtonOpts = {}) {
    super(scene, 0, 0);
    this.btnW = w;
    this.bg = scene.add.rectangle(0, 0, w, h, PALETTE.pannello, 0.94).setStrokeStyle(1, PALETTE.linea).setOrigin(0);
    this.edge = scene.add.rectangle(0, h - 2, w, 2, PALETTE.ocra, 0.9).setOrigin(0); // filo d'oro in basso
    this.focusRing = scene.add.rectangle(-3, -3, w + 6, h + 6, 0, 0)
      .setStrokeStyle(2, PALETTE.radioattivo, 1).setOrigin(0).setVisible(false);
    const labelX = opts.icon ? w / 2 + 10 : w / 2;
    this.label = scene.add.text(labelX, h / 2, text, textStyle(size, PALETTE.carta)).setOrigin(0.5);
    this.add([this.bg, this.edge, this.focusRing, this.label]);
    if (opts.icon) {
      this.icon = scene.add.image(labelX - this.label.width / 2 - 12, h / 2, opts.icon).setDisplaySize(size + 2, size + 2);
      this.add(this.icon);
    }
    if (opts.hotkey) {
      this.hotkeyBadge = scene.add.text(w - 4, 3, opts.hotkey, textStyle(9, PALETTE.tenue, false)).setOrigin(1, 0);
      this.add(this.hotkeyBadge);
    }
    this.setSize(w, h);
    // risposta al tocco: si abbassa quando premi, torna su con un piccolo rimbalzo quando lasci; si schiarisce sotto il mouse
    this.bg.setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { if (!this.disabled_) this.squash(0.94, 60, 'Quad.easeOut'); })
      .on('pointerover', () => {
        if (this.disabled_) { if (this.disabledReason) this.showReason(); return; }
        if (!this.active_) this.bg.setFillStyle(PALETTE.pannelloAlto, 0.97);
      })
      .on('pointerout', () => {
        this.hideReason();
        if (this.disabled_) return;
        if (!this.active_) this.bg.setFillStyle(PALETTE.pannello, 0.94);
        if (this.scale < 1) this.squash(1, 120, 'Quad.easeOut');
      })
      .on('pointerup', () => {
        if (this.disabled_) return;
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

  private showReason() {
    if (!this.disabledReason) return;
    this.reasonBubble?.destroy();
    this.reasonBubble = this.scene.add.text(this.btnW / 2, -8, this.disabledReason, textStyle(10, PALETTE.carta, false))
      .setOrigin(0.5, 1).setBackgroundColor(hex(PALETTE.inchiostro)).setPadding(5, 3, 5, 3).setDepth(50);
    this.add(this.reasonBubble);
  }

  private hideReason() {
    this.reasonBubble?.destroy();
    this.reasonBubble = undefined;
  }

  /** Azione principale dello schermo (es. GIOCA): fondo oro, etichetta scura, si distingue dalle altre. */
  setPrimary(): this {
    this.setOn(true);
    this.edge.setFillStyle(PALETTE.oroChiaro, 1);
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

  /** Disattiva il bottone: si scurisce, ignora i clic; se dai un motivo, appare al passaggio del mouse. */
  setDisabled(disabled: boolean, reason?: string): this {
    this.disabled_ = disabled;
    this.disabledReason = reason;
    this.setAlpha(disabled ? 0.45 : 1);
    this.bg.input!.cursor = disabled ? 'default' : 'pointer';
    if (!disabled) this.hideReason();
    return this;
  }

  get isDisabled() {
    return this.disabled_;
  }

  /** Anello di selezione per la navigazione da tastiera (Tab): lo gestisce il registro dei fuochi in hotkeys.ts. */
  setFocused(on: boolean): this {
    this.focusRing.setVisible(on);
    return this;
  }

  get isOn() {
    return this.active_;
  }

  contains(x: number, y: number): boolean {
    return x >= this.x && x <= this.x + this.width && y >= this.y && y <= this.y + this.height;
  }
}
