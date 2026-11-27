// Intro all'apertura del gioco (Nico, 24 novembre 2026: "un layout del genere può essere molto figo per l'intro, che quando entri
// si compone con tutte le immagini"): nel buio si accendono una dopo l'altra finestre con le foto del gioco (stanze, fronti,
// eventi, comandante), tremolando come luci che si accendono; poi compaiono "archeon" che brilla e frammenti di testo sparsi.
// Dopo pochi secondi (o al primo tocco/tasto) sfuma nella home. Una volta per apertura della pagina.
import Phaser from 'phaser';
import { uiCamera, view } from '../ui/screen';
import { FONT_SERIF, FONT_MONO } from '../ui/style';
import { tech } from '../ui/ops';
import { coverImage } from '../ui/images';

// finestre in proporzione allo schermo (x, y, larghezza, altezza) e la foto di ciascuna; disposte come nel mockup. Le foto
// raccontano la lore (Nico, 25 novembre 2026: "le immagini dell'intro vanno cambiate"; concept-art/stili/intro.py)
const WINDOWS: [number, number, number, number, string, number][] = [
  [0.21, 0.17, 0.39, 0.37, 'intro-concordia', 3],
  [0.61, 0.13, 0.17, 0.33, 'intro-alati', 2],
  [0.13, 0.22, 0.067, 0.15, 'intro-frammento', 0],
  [0.8, 0.19, 0.083, 0.13, 'intro-segnale', 0],
  [0.8, 0.34, 0.104, 0.18, 'intro-corruzione', 2],
  [0.21, 0.56, 0.125, 0.22, 'intro-generale', 0],
  [0.35, 0.58, 0.17, 0.17, 'intro-senato', 2],
  [0.61, 0.49, 0.14, 0.26, 'intro-lume', 0],
  [0.53, 0.77, 0.09, 0.12, 'intro-colonna', 0],
  [0.76, 0.56, 0.076, 0.19, 'intro-statua', 0],
  [0.06, 0.5, 0.11, 0.16, 'intro-archivio', 2],
  [0.88, 0.62, 0.09, 0.2, 'intro-avvento', 0],
];
const PROSE = [
  [0.03, 0.83, 'First there was the Concord: a century of peace.\nThen, in Year Zero, the Winged came down from the sky.'],
  [0.79, 0.84, 'What remains are the Fragments, and the Signal\nthat no one can read yet.'],
  [0.36, 0.78, 'The powers fight over the Lumen.'],
];
const DATA = [[0.03, 0.06, 'ARCHEON // COMMAND ARCHIVE'], [0.8, 0.07, 'FREQ 47.2 MHz, SIGNAL ACTIVE'], [0.03, 0.94, 'YEAR ZERO + 31, 03:14']];

let shown = false;

export class IntroScene extends Phaser.Scene {
  private next: { key: string; data: unknown } = { key: 'Title', data: {} };
  private leaving = false;

  constructor() {
    super('Intro');
  }

  /** Se l'intro è già passata in questa apertura, si va dritti alla scena dopo. */
  static seen() {
    return shown;
  }

  create(data: { key: string; data: unknown }) {
    shown = true;
    this.next = data;
    this.leaving = false;
    uiCamera(this);
    const { width: W, height: H } = view(this);
    this.add.rectangle(0, 0, W, H, 0x030409).setOrigin(0);
    // finestre: si accendono una alla volta con un tremolio, il telaio sopra la foto
    WINDOWS.forEach(([fx, fy, fw, fh, key, bars], i) => {
      const x = fx * W, y = fy * H, w = fw * W, h = fh * H;
      if (!this.textures.exists(key)) return;
      const img = coverImage(this, key, x, y, w, h, 0.4).setAlpha(0);
      const frame = this.add.graphics().setAlpha(0);
      frame.lineStyle(1, 0xffffff, 0.12).strokeRect(x, y, w, h);
      for (let k = 1; k <= bars; k++) frame.fillStyle(0x030409, 1).fillRect(x + (w * k) / (bars + 1) - 2, y, 4, h);
      if (bars) frame.fillStyle(0x030409, 1).fillRect(x, y + h * 0.45 - 2, w, 4);
      const at = 250 + i * 190;
      // accensione: lampi brevi (a scatti) e poi la luce piena
      this.tweens.add({ targets: [img, frame], alpha: 1, delay: at, duration: 520, ease: (v: number) => (v < 0.45 ? (Math.floor(v * 18) % 2 ? 0.65 : 0.06) : v) });
    });
    const t0 = 250 + WINDOWS.length * 190;
    // parola che brilla, come nel riferimento
    const word = tech(this, W * 0.18, H * 0.42, 'archeon', Math.round(Math.min(W, H) * 0.12), 0xf4f4f0).setAlpha(0);
    word.setShadow(0, 0, 'rgba(255,255,255,0.85)', 24, false, true);
    this.tweens.add({ targets: word, alpha: 1, delay: t0, duration: 700 });
    PROSE.forEach(([fx, fy, txt], i) => {
      const t = this.add.text(Number(fx) * W, Number(fy) * H, String(txt), { fontFamily: FONT_SERIF, fontSize: '17px', fontStyle: 'italic', color: '#dfe2dc' }).setAlpha(0);
      this.tweens.add({ targets: t, alpha: 0.8, delay: t0 + 300 + i * 260, duration: 600 });
    });
    DATA.forEach(([fx, fy, txt], i) => {
      const t = this.add.text(Number(fx) * W, Number(fy) * H, String(txt), { fontFamily: FONT_MONO, fontSize: '12px', color: '#7f888e' }).setAlpha(0);
      this.tweens.add({ targets: t, alpha: 1, delay: 200 + i * 400, duration: 300 });
    });
    // fine: da sola dopo un momento, o subito al primo tocco/tasto
    this.time.delayedCall(t0 + 2600, () => this.leave());
    this.input.once('pointerdown', () => this.leave());
    this.input.keyboard?.once('keydown', () => this.leave());
  }

  private leave() {
    if (this.leaving) return;
    this.leaving = true;
    this.cameras.main.fadeOut(600, 3, 4, 9);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(this.next.key, this.next.data as object));
  }
}
