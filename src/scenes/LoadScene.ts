// Schermata di caricamento come un fascicolo dell'archivio (stile pianta): riquadro ardesia con filo avorio, documento della
// Caduta che si scrive lettera per lettera e fotografia allegata e incorniciata. Sotto, solo la barra.
// Dura apposta qualche secondo in più (Nico): è il momento in cui si racconta la lore. Copre l'avvio della scena successiva.
import Phaser from 'phaser';
import { PALETTE, hex } from '../config/palette';
import loading from '../data/loading.json';
import { loadWorld } from '../map/worldAsset';
import { coverImage } from '../ui/images';
import { box, dots, italic, notch } from '../ui/schematic';
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
    this.cameras.main.setAlpha(1);

    // una schermata diversa dall'ultima vista
    const screens = loading.screens;
    const last = (this.registry.get('lastLoad') as number | undefined) ?? -1;
    let k = Math.floor(Math.random() * screens.length);
    if (k === last) k = (k + 1) % screens.length;
    this.registry.set('lastLoad', k);
    const sc = screens[k];

    // fascicolo dell'archivio (stile pianta): fondo ardesia, riquadro con filo avorio e la sigla incastrata nel bordo,
    // testo che si scrive da solo a sinistra, fotografia allegata e incorniciata a destra (in verticale sopra il testo)
    this.cameras.main.setBackgroundColor(PALETTE.inchiostro);
    const m = P ? 14 : 24, sx = m, sy = m + 40, sw = width - 2 * m, sh = height - sy - (P ? 56 : 66);
    const sg = this.add.graphics();
    box(sg, sx, sy, sw, sh, 0.96, 0.9);
    const docN = String(311 + k * 47).padStart(4, '0');
    notch(this, sx, sy, `Archivio di comando · documento ${docN}`);
    this.add.text(sx, m, 'ASHEN ATLAS', textStyle(16, PALETTE.carta)).setLetterSpacing(3);
    this.add.text(sx + sw, m + 4, `fascicolo ${k + 1} di ${screens.length}`, italic(11)).setOrigin(1, 0);
    // fotografia allegata
    const pw = P ? sw - 28 : Math.min(sw * 0.42, 460), ph = P ? Math.min(sh * 0.36, pw * 0.62) : Math.min(sh - 70, pw * 1.05);
    const px = P ? sx + 14 : sx + sw - pw - 22, py = P ? sy + 22 : sy + 30;
    const photo = this.add.container(0, 0);
    photo.add(coverImage(this, sc.img, px, py, pw, ph, 0.4).setTint(0xc9d2d6));
    this.tweens.add({ targets: photo, alpha: { from: 0, to: 1 }, duration: 900, delay: 300 });
    sg.lineStyle(1.5, PALETTE.carta, 0.9).strokeRect(px - 5, py - 5, pw + 10, ph + 10);
    this.add.text(px, py + ph + 10, `Allegato 1 · ${sc.title.toLowerCase()}`, italic(11));
    // documento: si scrive da solo
    const pad = P ? sx + 14 : sx + 24, wrap = P ? sw - 28 : sw - pw - 80;
    const doc = `DOCUMENTO ${docN}`;
    const body = [`${doc}`, `OGGETTO: ${sc.title}`, '', ...sc.lines, '', `«${sc.quote}»`, `— ${sc.source}`].join('\n');
    const size = P ? 13 : Math.min(17, Math.max(14, width / 66));
    const mono = (sz: number, color: string) => ({ fontFamily: FONT_MONO, fontSize: `${sz}px`, color, lineSpacing: Math.round(sz * 0.5) });
    const term = this.add.text(pad, 0, '', { ...mono(size, hex(PALETTE.carta)), wordWrap: { width: wrap, useAdvancedWrap: true } });
    term.setText(body);
    const full = term.height;
    term.setY(P ? py + ph + 34 : Math.max(sy + 30, sy + (sh - full) / 2)).setText('');
    const head = this.add.text(pad, term.y, '', mono(size, hex(PALETTE.ocra))); // intestazione in verde acqua
    this.typer = { term, head, body, headLen: `${doc}\nOGGETTO: ${sc.title}`.length, shown: -1, cursor: true };
    this.typeEnd = this.startAt + body.length * CHAR_MS;
    this.minMs = Phaser.Math.Clamp(body.length * CHAR_MS + 1800, MIN_MS, MAX_MS);
    this.time.addEvent({ delay: 420, loop: true, callback: () => { this.typer.cursor = !this.typer.cursor; this.typer.shown = -1; } });

    // sotto: barra di caricamento come un corridoio della pianta che si traccia
    const bottom = height - (P ? 26 : 30);
    dots(this.add.graphics(), sx, bottom, sx + sw, bottom, PALETTE.carta, 0.5);
    this.bar = this.add.rectangle(sx, bottom, 0, 2, PALETTE.carta).setOrigin(0, 0.5);
    this.barW = sw;
    this.status = this.add.text(sx + sw, bottom - 8, '', italic(11)).setOrigin(1, 1);

    // tocco: salta solo quando il documento è scritto e la scena dopo è pronta
    this.add.zone(0, 0, width, height).setOrigin(0).setInteractive().on('pointerup', () => {
      if (this.ready && this.time.now >= this.typeEnd) this.leave();
    });
    this.cameras.main.fadeIn(450, 31, 40, 48);

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
    if (!this.leaving) this.status.setText(`caricamento ${Math.floor(shown * 100)}%`);
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
    this.status.setText('collegamento stabilito');
    this.tweens.add({ targets: this.cameras.main, alpha: 0, duration: 520, ease: 'Quad.easeIn', onComplete: () => this.scene.stop() });
  }
}
