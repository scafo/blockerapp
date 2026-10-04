// Schermata di caricamento (Figma, "Loading screens"): immagine drammatica a tutto schermo, viraggio freddo,
// una citazione dall'archivio della Caduta e lo stato delle operazioni. Copre l'avvio della scena successiva.
import Phaser from 'phaser';
import { PALETTE, hex } from '../config/palette';
import loading from '../data/loading.json';
import { buildLandMask } from '../map/landMask';
import { buildCountryMap } from '../map/countries';
import { coverImage, fade } from '../ui/images';
import { textStyle, FONT_TITLE } from '../ui/style';
import { uiCamera, view } from '../ui/screen';

export interface LoadData {
  next: 'Run' | 'Camp';
  data?: object;
  /** primo avvio: qui si calcolano anche terre e nazioni */
  boot?: boolean;
}

const MIN_MS = 2600;

export class LoadScene extends Phaser.Scene {
  private launched = false;
  private ready = false;
  private leaving = false;
  private startAt = 0;
  private bar!: Phaser.GameObjects.Rectangle;
  private barW = 0;
  private status!: Phaser.GameObjects.Text;
  private target!: LoadData;

  constructor() {
    super('Load');
  }

  create(d: LoadData) {
    uiCamera(this);
    this.target = d;
    this.launched = this.ready = this.leaving = false;
    this.startAt = this.time.now;
    const { width, height, portrait: P } = view(this);
    this.cameras.main.setBackgroundColor(0x000000).setAlpha(1);

    // una schermata diversa dall'ultima vista
    const screens = loading.screens;
    const last = (this.registry.get('lastLoad') as number | undefined) ?? -1;
    let k = Math.floor(Math.random() * screens.length);
    if (k === last) k = (k + 1) % screens.length;
    this.registry.set('lastLoad', k);
    const sc = screens[k];

    // immagine con lento avvicinamento (Ken Burns) e viraggio freddo
    const holder = this.add.container(width / 2, height / 2);
    const img = coverImage(this, sc.img, -width / 2, -height / 2, width, height, 0.4).setTint(0xb8cbe0);
    holder.add(img);
    this.tweens.add({ targets: holder, scale: { from: 1, to: 1.07 }, duration: 9000, ease: 'Sine.easeOut' });
    this.add.rectangle(0, 0, width, height, 0x06101c, 0.28).setOrigin(0); // velo blu notte
    fade(this, 0, 0, width, height * 0.22, 0x000000, 0.75, 0);
    fade(this, 0, height * 0.42, width, height * 0.58, PALETTE.inchiostro, 0, 0.96);

    // intestazione
    const pad = P ? 18 : 32;
    this.add.text(pad, pad, 'ASHEN ATLAS', textStyle(14, PALETTE.ocra)).setLetterSpacing(4);
    this.add.text(width - pad, pad + 2, `ARCHIVIO DI COMANDO · DOC. ${String(311 + k * 47).padStart(4, '0')}`, textStyle(10, PALETTE.tenue, false))
      .setOrigin(1, 0).setLetterSpacing(2);

    // titolo, citazione, fonte
    const wrap = Math.min(660, width - 2 * pad);
    const tip = loading.tips[Math.floor(Math.random() * loading.tips.length)];
    const bottom = height - pad;
    this.bar = this.add.rectangle(pad, bottom - 2, 0, 2, PALETTE.ocra).setOrigin(0, 0.5);
    this.add.rectangle(pad, bottom - 2, width - 2 * pad, 1, PALETTE.linea).setOrigin(0, 0.5);
    this.barW = width - 2 * pad;
    this.status = this.add.text(pad, bottom - 12, '', textStyle(11, PALETTE.tenue, false)).setOrigin(0, 1);
    const tipT = this.add.text(width - pad, bottom - 12, tip, textStyle(11, PALETTE.carta, false)).setOrigin(1, 1).setAlign('right')
      .setWordWrapWidth(P ? width - 2 * pad : wrap * 0.6);
    if (P) tipT.setOrigin(0, 1).setPosition(pad, bottom - 34).setAlign('left');
    const textBottom = (P ? tipT.y - tipT.height : bottom - 30) - 18;
    const src = this.add.text(pad, textBottom, `— ${sc.source}`, textStyle(12, PALETTE.ocra, false)).setOrigin(0, 1);
    const quote = this.add.text(pad, src.y - src.height - 10, `«${sc.quote}»`, {
      ...textStyle(P ? 18 : 22, PALETTE.carta, false), wordWrap: { width: wrap }, lineSpacing: 4,
    }).setOrigin(0, 1);
    const title = this.add.text(pad - 2, quote.y - quote.height - 12, sc.title, {
      ...textStyle(P ? 34 : 46, PALETTE.carta), fontFamily: FONT_TITLE, fontStyle: '600',
    }).setOrigin(0, 1).setLetterSpacing(6);
    this.add.rectangle(pad, title.y - title.height - 10, 46, 3, PALETTE.ocra).setOrigin(0, 0.5);
    for (const [t, delay] of [[title, 150], [quote, 450], [src, 750]] as const) {
      t.setAlpha(0);
      this.tweens.add({ targets: t, alpha: 1, x: { from: t.x - 14, to: t.x }, delay, duration: 700, ease: 'Cubic.easeOut' });
    }

    // stato: righe che cambiano, come un telex
    let line = 0;
    const next = () => {
      const s = loading.status[line++ % loading.status.length];
      let n = 0;
      this.time.addEvent({ delay: 18, repeat: s.length, callback: () => this.status.setText(`${s.slice(0, ++n)}${n <= s.length ? '▌' : ' …'}`) });
    };
    next();
    this.time.addEvent({ delay: 900, loop: true, callback: next });

    // tocco: salta l'attesa quando la scena dopo è pronta
    this.add.zone(0, 0, width, height).setOrigin(0).setInteractive().on('pointerup', () => {
      if (this.ready) this.leave();
    });
    this.cameras.main.fadeIn(450, 0, 0, 0);

    if (d.boot) {
      // il calcolo è sincrono: prima lasciamo disegnare la schermata
      this.time.delayedCall(260, () => {
        if (!this.registry.get('landMask')) {
          const mask = buildLandMask();
          this.registry.set('landMask', mask);
          this.registry.set('countries', buildCountryMap(mask)); // nazioni reali per province e confini
        }
      });
    }
  }

  update(time: number) {
    const t = Math.min(1, (time - this.startAt) / MIN_MS);
    this.bar.width = this.barW * (this.launched && !this.ready ? Math.min(t, 0.92) : t);
    // la scena successiva parte sotto, coperta da questa (che resta in cima)
    if (!this.launched && t > 0.62 && (!this.target.boot || this.registry.get('landMask'))) {
      this.launched = true;
      const key = this.target.next;
      this.scene.get(key).events.once('create', () => this.time.delayedCall(50, () => (this.ready = true)));
      this.scene.launch(key, this.target.data);
    }
    if (!this.leaving) this.scene.bringToTop();
    if (this.ready && t >= 1) this.leave();
  }

  private leave() {
    if (this.leaving) return;
    this.leaving = true;
    this.status.setText('Collegamento stabilito').setColor(hex(PALETTE.ocra));
    this.tweens.add({ targets: this.cameras.main, alpha: 0, duration: 520, ease: 'Quad.easeIn', onComplete: () => this.scene.stop() });
  }
}
