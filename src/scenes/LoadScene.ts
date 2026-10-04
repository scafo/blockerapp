// Schermata di caricamento (Figma, "Loading screens"): immagine drammatica a tutto schermo con lento avvicinamento e,
// sopra, un documento dell'archivio della Caduta che si scrive lettera per lettera in font da terminale. Sotto, solo la barra.
// Dura apposta qualche secondo in più (Nico): è il momento in cui si racconta la lore. Copre l'avvio della scena successiva.
import Phaser from 'phaser';
import { PALETTE, hex } from '../config/palette';
import loading from '../data/loading.json';
import { loadWorld } from '../map/worldAsset';
import { coverImage, fade } from '../ui/images';
import { textStyle, FONT_MONO } from '../ui/style';
import { uiCamera, view } from '../ui/screen';

export interface LoadData {
  next: 'Run' | 'Camp';
  data?: object;
  /** primo avvio: qui si calcolano anche terre e nazioni */
  boot?: boolean;
}

const CHAR_MS = 26; // velocità della telescrivente
const MIN_MS = 6500; // durata minima (si allunga col testo, fino a MAX_MS)
const MAX_MS = 11000;

export class LoadScene extends Phaser.Scene {
  private launched = false;
  private ready = false;
  private leaving = false;
  private startAt = 0;
  private bar!: Phaser.GameObjects.Rectangle;
  private barW = 0;
  private status!: Phaser.GameObjects.Text;
  private target!: LoadData;
  private typeEnd = 0;
  private typer!: { term: Phaser.GameObjects.Text; head: Phaser.GameObjects.Text; body: string; headLen: number; shown: number; cursor: boolean };
  private minMs = MIN_MS;

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

    // immagine grande, viraggio freddo, avvicinamento appena accennato (ingrandire di più la sgranerebbe)
    const holder = this.add.container(width / 2, height / 2);
    holder.add(coverImage(this, sc.img, -width / 2, -height / 2, width, height, 0.4).setTint(0xb8cbe0));
    this.tweens.add({ targets: holder, scale: { from: 1, to: 1.04 }, duration: MAX_MS + 2000, ease: 'Sine.easeOut' });
    this.add.rectangle(0, 0, width, height, 0x06101c, 0.22).setOrigin(0); // velo blu notte
    if (P) fade(this, 0, height * 0.35, width, height * 0.65, 0x03070d, 0, 0.82);
    else fade(this, 0, 0, width * 0.62, height, 0x03070d, 0.72, 0, 'h');
    fade(this, 0, height - 70, width, 70, 0x000000, 0, 0.6);

    // stile delle scritte sull'immagine della nave: monospazio sottile, azzurro chiaro che brilla, righe di dati che scorrono
    const GLOW = '#8fd0ff', INKC = '#dcefff';
    const mono = (sz: number, color: string) => ({ fontFamily: FONT_MONO, fontSize: `${sz}px`, color, lineSpacing: Math.round(sz * 0.5) });
    // flusso di dati: colonne di numeri e sigle che salgono senza sosta (a destra in orizzontale, in alto in verticale)
    const feedSize = P ? 9 : 10;
    const feedX = P ? 18 : width * 0.64, feedW = P ? width - 36 : width * 0.33;
    const feedRows = P ? 14 : Math.max(8, Math.floor((height * 0.84 - 100) / (feedSize * 1.65))); // finisce sopra la barra
    const rnd = (n: number) => Array.from({ length: n }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('');
    const codes = ['SIG', 'LAT', 'LON', 'ALT', 'FRQ', 'LUM', 'TMP', 'RX', 'TX', 'BRG'];
    const row = () => {
      const c = codes[Math.floor(Math.random() * codes.length)];
      return `${rnd(4)} ${rnd(4)}  ${c} ${(Math.random() * 999).toFixed(1).padStart(5, '0')}  ${rnd(2)}:${rnd(2)}  ${'▮'.repeat(1 + Math.floor(Math.random() * 6))}`;
    };
    const feedLines = Array.from({ length: feedRows }, row);
    const feed = this.add.text(feedX, P ? 74 : height * 0.16, feedLines.join('\n'), mono(feedSize, INKC))
      .setAlpha(0.42).setShadow(0, 0, GLOW, 6, false, true).setWordWrapWidth(feedW).setMaxLines(feedRows);
    this.time.addEvent({ delay: 140, loop: true, callback: () => { feedLines.shift(); feedLines.push(row()); feed.setText(feedLines.join('\n')); } });

    // documento dell'archivio: si scrive da solo
    const pad = P ? 20 : 44, wrap = P ? width - 2 * pad : Math.min(560, width * 0.52);
    const doc = `ARCHIVIO DI COMANDO // DOC.${String(311 + k * 47).padStart(4, '0')}`;
    const body = [`> ${doc}`, `> OGGETTO: ${sc.title}`, '', ...sc.lines.map((l) => `  ${l}`), '', `  «${sc.quote}»`, `  — ${sc.source}`].join('\n');
    const size = P ? 14 : Math.min(18, Math.max(15, width / 62));
    const term = this.add.text(pad, 0, '', { ...mono(size, INKC), wordWrap: { width: wrap, useAdvancedWrap: true } })
      .setShadow(0, 0, GLOW, 8, false, true);
    term.setText(body);
    const full = term.height;
    term.setY(P ? height - 70 - full : Math.max(pad + 30, (height - full) / 2 - 10)).setText('');
    this.add.text(pad, P ? pad : pad - 6, 'ASHEN ATLAS', textStyle(13, PALETTE.ocra)).setLetterSpacing(4);
    const head = this.add.text(pad, term.y, '', mono(size, '#ffffff')).setShadow(0, 0, GLOW, 12, false, true); // intestazione più accesa
    this.typer = { term, head, body, headLen: `> ${doc}\n> OGGETTO: ${sc.title}`.length, shown: -1, cursor: true };
    this.typeEnd = this.startAt + body.length * CHAR_MS;
    this.minMs = Phaser.Math.Clamp(body.length * CHAR_MS + 1800, MIN_MS, MAX_MS);
    this.time.addEvent({ delay: 420, loop: true, callback: () => { this.typer.cursor = !this.typer.cursor; this.typer.shown = -1; } });

    // sotto: solo la barra di caricamento
    const bottom = height - (P ? 26 : 30);
    this.add.rectangle(pad, bottom, width - 2 * pad, 2, PALETTE.linea).setOrigin(0, 0.5);
    this.bar = this.add.rectangle(pad, bottom, 0, 2, PALETTE.ocra).setOrigin(0, 0.5);
    this.barW = width - 2 * pad;
    this.status = this.add.text(width - pad, bottom - 8, '', { fontFamily: FONT_MONO, fontSize: '12px', color: '#9fc8e8' }).setOrigin(1, 1);

    // tocco: salta solo quando il documento è scritto e la scena dopo è pronta
    this.add.zone(0, 0, width, height).setOrigin(0).setInteractive().on('pointerup', () => {
      if (this.ready && this.time.now >= this.typeEnd) this.leave();
    });
    this.cameras.main.fadeIn(450, 0, 0, 0);

    if (d.boot) this.time.delayedCall(200, () => this.registry.set('world', loadWorld())); // carta già pronta: solo decodifica
  }

  update(time: number) {
    // telescrivente legata al tempo vero (non ai fotogrammi): sui telefoni lenti il testo arriva comunque in tempo
    const T = this.typer, n = Math.min(T.body.length, Math.floor((time - this.startAt) / CHAR_MS));
    if (n !== T.shown) {
      T.shown = n;
      T.term.setText(T.body.slice(0, n) + (T.cursor || n < T.body.length ? '█' : ' '));
      T.head.setText(T.body.slice(0, Math.min(n, T.headLen)));
    }
    const t = Math.min(1, (time - this.startAt) / this.minMs);
    const shown = this.launched && !this.ready ? Math.min(t, 0.92) : t;
    this.bar.width = this.barW * shown;
    if (!this.leaving) this.status.setText(`CARICAMENTO ${String(Math.floor(shown * 100)).padStart(3, ' ')}%`);
    // la scena successiva parte sotto, coperta da questa (che resta in cima)
    if (!this.launched && t > 0.5 && (!this.target.boot || this.registry.get('world'))) {
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
    this.status.setText('COLLEGAMENTO STABILITO').setColor(hex(PALETTE.ocra));
    this.tweens.add({ targets: this.cameras.main, alpha: 0, duration: 520, ease: 'Quad.easeIn', onComplete: () => this.scene.stop() });
  }
}
