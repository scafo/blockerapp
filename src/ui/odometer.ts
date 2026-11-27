// Numeri a rullo come i contatori meccanici (Nico, 27 novembre 2026: "che scorrono da sopra a sotto, come nelle vecchie
// macchine"; scelta la versione leggera): ogni cifra è una striscia 0–9 ritagliata in una finestrella. Quando il numero
// sale la cifra vecchia esce in alto e la nuova entra da sotto, quando scende il contrario. Sopra e sotto una sfumatura
// leggera nel colore del fondo. Punti, virgole e lettere ("k", "M") restano fermi. Niente testo ridisegnato mentre gira:
// la striscia 0–9 si disegna una volta su un canvas; ogni cifra è un'immagine di quella striscia, ritagliata (i testi di
// Phaser non si ritagliano, le immagini sì).
import Phaser from 'phaser';

const HOLD_MS = 450; // un numero nuovo al massimo ogni tanto: in mezzo resta fermo

interface Cell { digit: boolean; obj: Phaser.GameObjects.Text | Phaser.GameObjects.Image; pos: number; to: number; x: number }

export class Odometer extends Phaser.GameObjects.Container {
  private cells: Cell[] = [];
  private shape = '';
  private shown = '';
  private value = 0;
  private dir = 1;
  private lineH = 0;
  private digitW = 0;
  private fade: Phaser.GameObjects.Graphics;
  private alignY = 0;
  private strip: Phaser.Textures.CanvasTexture;
  private res: number;

  constructor(scene: Phaser.Scene, private style: Phaser.Types.GameObjects.Text.TextStyle, private bg: number) {
    super(scene, 0, 0);
    scene.add.existing(this);
    // misure: una cifra e l'altezza di una riga della striscia
    const probe = scene.add.text(0, 0, '0', style);
    this.digitW = probe.width;
    this.lineH = probe.height;
    probe.destroy();
    // striscia delle cifre disegnata su un canvas suo: 0..9 più uno 0 in fondo, così il giro 9 → 0 scorre senza salti.
    // (La texture di un testo di Phaser tiene misure 1×1 e il ritaglio delle immagini non funzionava)
    this.res = Number(style.resolution ?? 1);
    const r = this.res, W = Math.ceil(this.digitW), key = `odometer-${Phaser.Utils.String.UUID()}`;
    this.strip = scene.textures.createCanvas(key, Math.ceil(W * r), Math.ceil(this.lineH * 11 * r))!;
    const ctx = this.strip.getContext();
    ctx.font = `${style.fontStyle ?? 'normal'} ${style.fontSize} ${style.fontFamily}`;
    ctx.fillStyle = String(style.color ?? '#ffffff');
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.scale(r, r);
    for (let i = 0; i < 11; i++) ctx.fillText(String(i % 10), W / 2, (i + 0.5) * this.lineH);
    this.strip.refresh();
    this.fade = scene.add.graphics();
    this.add(this.fade);
    this.setSize(0, this.lineH);
  }

  get text(): string {
    return this.shown;
  }

  /** Allineamento verticale come setOrigin di un testo (0 in alto, 0.5 al centro). */
  setOriginY(y: number): this {
    this.alignY = y;
    this.layout();
    return this;
  }

  /** Numero da mostrare e il suo testo già formattato (es. 2734 → "2.7k"). Si applica a scatti (al massimo ogni `HOLD_MS`):
   *  tra uno scatto e l'altro il numero sta fermo e si legge (Nico, 27 novembre 2026: "si muovono così veloci che non si vede
   *  neanche che numero è"). */
  setValue(v: number, label: string): this {
    this.pending = { v, label };
    if (!this.shape) this.apply(); // la prima volta subito
    return this;
  }
  private pending: { v: number; label: string } | null = null;
  private held = Infinity;

  private apply() {
    const p = this.pending;
    this.pending = null;
    if (!p) return;
    if (p.v !== this.value) this.dir = p.v > this.value ? 1 : -1;
    this.value = p.v;
    if (p.label === this.shown) return;
    this.held = 0;
    this.shown = p.label;
    const shape = p.label.replace(/\d/g, '#');
    if (shape !== this.shape) { this.shape = shape; this.rebuild(p.label); return; }
    [...p.label].forEach((ch, i) => { const c = this.cells[i]; if (c.digit) c.to = +ch; });
  }

  /** Cifre verso la loro meta, veloci e secche: si gira sempre nel verso del numero (sale: in su, scende: in giù). */
  tick(delta: number) {
    this.held += delta;
    if (this.pending && this.held >= HOLD_MS) this.apply();
    for (const c of this.cells) {
      if (!c.digit || c.pos === c.to) continue;
      const d = this.dir > 0 ? (c.to - c.pos + 10) % 10 : -((c.pos - c.to + 10) % 10);
      const step = d * Math.min(1, delta / 45) + Math.sign(d) * Math.min(Math.abs(d), 0.06 * delta / 16);
      c.pos = Math.abs(step) >= Math.abs(d) - 0.02 ? c.to : (c.pos + step + 10) % 10; // arrivata: niente giro in più
      this.crop(c);
    }
  }

  destroy(fromScene?: boolean) {
    this.strip?.destroy();
    super.destroy(fromScene);
  }

  private rebuild(label: string) {
    for (const c of this.cells) c.obj.destroy();
    this.cells = [];
    let x = 0;
    for (const ch of label) {
      const digit = /\d/.test(ch);
      const obj = digit ? this.scene.add.image(x, 0, this.strip.key).setOrigin(0).setScale(1 / this.res) : this.scene.add.text(x, 0, ch, this.style);
      this.add(obj);
      const w = digit ? this.digitW : obj.width;
      const c: Cell = { digit, obj, pos: digit ? +ch : 0, to: digit ? +ch : 0, x };
      this.cells.push(c);
      x += w;
    }
    this.bringToTop(this.fade);
    this.setSize(x, this.lineH);
    this.layout();
  }

  private layout() {
    const top = -this.lineH * this.alignY;
    for (const c of this.cells) this.crop(c, top);
    const w = this.width, h = this.lineH, b = Math.round(h * 0.28);
    // sfumatura leggera sopra e sotto, nel colore del fondo
    this.fade.clear()
      .fillGradientStyle(this.bg, this.bg, this.bg, this.bg, 0.55, 0.55, 0, 0).fillRect(0, top, w, b)
      .fillGradientStyle(this.bg, this.bg, this.bg, this.bg, 0, 0, 0.55, 0.55).fillRect(0, top + h - b, w, b);
  }

  private crop(c: Cell, top = -this.lineH * this.alignY) {
    if (!c.digit) { c.obj.setPosition(c.x, top); return; }
    const sy = c.pos * this.lineH, r = this.res;
    (c.obj as Phaser.GameObjects.Image).setPosition(c.x, top - sy).setCrop(0, sy * r, Math.ceil(this.digitW) * r, this.lineH * r);
  }
}
