// Schermata di caricamento sul riferimento di Nico (Figma, "Loading screens"): fotografia a tutto schermo e sopra, sulla destra,
// un registro da terminale bianco che si accende riga per riga (colonna di sigle a sinistra, blocchi rientrati, alone luminoso).
// Dura apposta qualche secondo in più (Nico): è il momento in cui si racconta la lore. Copre l'avvio della scena successiva.
import { sfx } from '../audio/sfx';
import Phaser from 'phaser';
import loading from '../data/loading.json';
import { loadWorld } from '../map/worldAsset';
import { FONT_PIXEL } from '../ui/style';
import { uiCamera, view } from '../ui/screen';

export interface LoadData {
  next: 'Run' | 'Camp';
  data?: object;
  /** primo avvio: qui si calcolano anche terre e nazioni */
  boot?: boolean;
  /** sviluppo, ripresa dopo un ricaricamento di Vite: caricamento il più breve possibile */
  quick?: boolean;
}

// immagini che possono girare nel B-roll del caricamento (quelle che non esistono vengono saltate)
const BROLL = ['load-nave', 'load-radar', 'load-ghiaccio', 'load-statua', 'load-tornado', 'load-deserto', 'load-mediterraneo', 'load-citta',
  'front-1', 'front-2', 'front-3', 'front-4', 'front-5', 'front-6', 'u-artiglieria', 'u-corazzati', 't-ferrovie', 't-caduta', 't-radar',
  'room-arsenale', 'room-radar', 'bg-estrazione', 'civ-imperium', 'civ-republica', 'ev-convoglio', 'ev-disertori', 'ev-nebbia']; // foto nuove di stanze.py
const CHAR_MS = 22; // velocità della telescrivente
const MIN_MS = 2500; // durata minima (si allunga col testo, fino a MAX_MS; Nico 23 novembre 2026: "caricamento più veloce")
const MAX_MS = 5000;

/** Una riga del registro: sigla nella colonna di sinistra e testo (rientrato nei blocchi della lore). */
interface LogLine { gut: string; text: string; indent: number }

export class LoadScene extends Phaser.Scene {
  private launched = false;
  private needWorld = false;
  private ready = false;
  private leaving = false;
  private startAt = -1; // primo fotogramma (il tempo della scena in create era ancora quello vecchio: il testo partiva a metà)
  private now = 0;
  private charMs = CHAR_MS;
  private burst: [number, number][] = []; // [ms dall'inizio, caratteri visibili]
  private target!: LoadData;
  private typeEnd = 0;
  private minMs = MIN_MS;
  private log: LogLine[] = [];
  private total = 0;
  private shown = -1;
  private pct = -1;
  private cursor = true;
  private gut: Phaser.GameObjects.Text[] = []; // testo + due copie sfasate (rosso e azzurro), come nel riferimento
  private body: Phaser.GameObjects.Text[] = [];

  constructor() {
    super('Load');
  }

  create(d: LoadData) {
    uiCamera(this);
    this.target = d;
    this.launched = this.ready = this.leaving = false;
    this.startAt = -1;
    this.shown = this.pct = -1;
    const { width, height, portrait: P } = view(this);
    this.cameras.main.setAlpha(1).setBackgroundColor(0x000000);

    // una schermata diversa dall'ultima vista
    const screens = loading.screens;
    const last = (this.registry.get('lastLoad') as number | undefined) ?? -1;
    let k = Math.floor(Math.random() * screens.length);
    if (k === last) k = (k + 1) % screens.length;
    this.registry.set('lastLoad', k);
    const sc = screens[k];

    // B-roll (Nico: "un dataset di immagini che girano una sopra l'altra con l'opacità, scorrimento lento, non a caso"):
    // la foto della schermata e poi altre dell'archivio, ognuna con un avvicinamento lentissimo e sempre uguale, che sfumano
    // l'una nell'altra
    const pool = Phaser.Utils.Array.Shuffle(BROLL.filter((key) => key !== sc.img && this.textures.exists(key)));
    const reel = [sc.img, ...pool.slice(0, 2)], slot = (MAX_MS + 1500) / reel.length;
    reel.forEach((key, i) => {
      const img = this.add.image(width / 2, height / 2, key).setTint(0xb8c0c4).setAlpha(i ? 0 : 1);
      const z = Math.max(width / img.width, height / img.height) * 1.04;
      img.setScale(z);
      this.tweens.add({ targets: img, scale: z * 1.07, duration: slot + 1600, delay: Math.max(0, i * slot - 800), ease: 'Linear' });
      if (i) this.tweens.add({ targets: img, alpha: 1, duration: 1000, delay: i * slot - 500, ease: 'Sine.easeInOut' });
    });
    this.add.rectangle(0, 0, width, height, 0x000000, 0.42).setOrigin(0);

    // registro: colonna delle sigle, poi il testo; la lore va a capo a mano così le sigle restano allineate
    const size = P ? 11 : Math.round(Math.min(15, Math.max(12, width / 90)));
    const charW = size * 0.602, lineH = Math.round(size * 1.5);
    // largo come prima (metà schermo), ma ogni volta in un punto diverso (Nico: le scritte mai nello stesso posto)
    const gutW = Math.round(charW * 7);
    const cols = Math.max(24, Math.floor((P ? width - 32 - gutW : width * 0.5 - 40 - gutW) / charW));
    const blockW = gutW + cols * charW;
    const x0 = P ? 16 : Math.round(40 + Math.random() * Math.max(0, width - 80 - blockW));
    const wrap = (s: string, w: number) => {
      const out: string[] = [];
      let line = '';
      for (const word of s.split(' ')) {
        if (line && (line + ' ' + word).length > w) { out.push(line); line = word; } else line = line ? `${line} ${word}` : word;
      }
      if (line) out.push(line);
      return out;
    };
    const docN = String(311 + k * 47).padStart(4, '0');
    const L: LogLine[] = [
      { gut: '', text: 'ARCHEON // archivio di comando', indent: 0 },
      { gut: '', text: `sessione ${docN}.${String(screens.length).padStart(2, '0')}`, indent: 0 },
      { gut: '', text: '', indent: 0 },
      { gut: '0x01', text: 'collegamento al terminale ...... ok', indent: 0 },
      { gut: '0x02', text: `apertura documento ${docN} ...... ok`, indent: 0 },
      { gut: '0x03', text: `oggetto: ${sc.title}`, indent: 0 },
      { gut: '', text: '', indent: 0 },
    ];
    sc.lines.forEach((ln, i) => wrap(ln, cols - 4).forEach((w, j) => L.push({ gut: j ? '' : `${String(i + 1).padStart(2, '0')}  `, text: w, indent: 4 })));
    L.push({ gut: '', text: '', indent: 0 });
    wrap(`«${sc.quote}»`, cols - 4).forEach((w) => L.push({ gut: '', text: w, indent: 4 }));
    L.push({ gut: '', text: `— ${sc.source}`, indent: 4 });
    L.push({ gut: '', text: '', indent: 0 });
    L.push({ gut: '0x04', text: 'caricamento carta', indent: 0 }); // l'ultima riga riporta l'avanzamento
    this.log = L;
    this.total = L.reduce((n, l) => n + l.gut.length + l.text.length + 1, 0);
    const m = P ? 24 : 40;
    const y0 = Math.round(m + Math.random() * Math.max(0, height - 2 * m - L.length * lineH));

    const style = (color: string) => ({ fontFamily: FONT_PIXEL, fontSize: `${size}px`, color, lineSpacing: lineH - size, resolution: 2 });
    const make = (x: number, color: string, alpha: number, dx: number) => {
      const t = this.add.text(x + dx, y0, '', style(color)).setAlpha(alpha);
      return t;
    };
    // copie sfasate prima (sotto), poi il testo bianco con l'alone
    // sotto: alone largo (testo sfocato), poi le copie sfasate, sopra il testo bianco con un alone stretto
    this.gut = [make(x0, '#ffffff', 0.5, 0), make(x0, '#ff5a4a', 0.4, -1), make(x0, '#5ad2ff', 0.4, 1), make(x0, '#f4f7f8', 0.85, 0)];
    this.body = [make(x0 + gutW, '#ffffff', 0.5, 0), make(x0 + gutW, '#ff5a4a', 0.4, -1), make(x0 + gutW, '#5ad2ff', 0.4, 1), make(x0 + gutW, '#f4f7f8', 1, 0)];
    for (const t of [this.gut[0], this.body[0]]) t.setShadow(0, 0, 'rgba(255,255,255,1)', 14, false, true).setColor('rgba(255,255,255,0.25)');
    for (const t of [this.gut[3], this.body[3]]) t.setShadow(0, 0, 'rgba(255,255,255,0.9)', 5, false, true);

    // testi lunghi: la telescrivente accelera quanto basta per finire (con la barra) prima che la schermata se ne vada
    this.charMs = Math.min(CHAR_MS, (MAX_MS - 1800) / this.total);
    // a scatti (Nico): pezzi di testo che arrivano di colpo, con pause in mezzo (più lunghe a fine riga), come un terminale
    // che riceve i dati a pacchetti; il tempo totale resta quello di prima
    const marks: number[] = []; // quanti caratteri si vedono a ogni passo
    const ends = new Set<number>();
    let acc = 0;
    for (const l of L) { acc += l.gut.length + l.text.length + 1; ends.add(acc); }
    const pauses: number[] = [];
    for (let n = 0; n < this.total;) {
      let step = 2 + Math.floor(Math.random() * 18);
      for (let j = 1; j <= step; j++) if (ends.has(n + j)) { step = j; break; } // un pacchetto non va oltre la fine della riga
      n = Math.min(this.total, n + step);
      marks.push(n);
      pauses.push(ends.has(n) ? 1.5 + Math.random() * 2.5 : Math.random() < 0.15 ? 2 + Math.random() * 3 : 0.3 + Math.random() * 1.2);
    }
    const sum = pauses.reduce((a, b) => a + b, 0), span = this.total * this.charMs;
    let t = 0;
    this.burst = marks.map((n, i) => { t += (pauses[i] / sum) * span; return [t, n] as [number, number]; });
    this.minMs = Phaser.Math.Clamp(this.total * this.charMs + 1800, MIN_MS, MAX_MS);
    if (d.quick) this.minMs = 400;
    this.time.addEvent({ delay: 420, loop: true, callback: () => { this.cursor = !this.cursor; this.shown = -1; } });
    this.scatter(width, height, x0, y0, blockW, L.length * lineH, size);

    // tocco: salta solo quando il documento è scritto e la scena dopo è pronta
    this.add.zone(0, 0, width, height).setOrigin(0).setInteractive().on('pointerup', () => {
      if (this.ready && this.startAt >= 0 && this.now >= this.typeEnd) this.leave();
    });
    this.cameras.main.fadeIn(450, 0, 0, 0);

    // la carta serve solo alla campagna: si decodifica al primo caricamento che porta in partita (la base ci arriva senza caricamento)
    this.needWorld = d.next === 'Run' && !this.registry.get('world');
    if (this.needWorld) this.time.delayedCall(200, () => this.registry.set('world', loadWorld())); // carta già pronta: solo decodifica
  }

  /**
   * Frammenti di dati sparsi in altri punti dello schermo (Nico: "più scritte in posti diversi, più random"): coordinate,
   * frequenze, orari, che compaiono a scatti in momenti a caso e si spengono, lontano dal documento principale.
   */
  private scatter(W: number, H: number, bx: number, by: number, bw: number, bh: number, size: number) {
    const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
    const frag = () => pick([
      () => `LAT ${(30 + Math.random() * 40).toFixed(2)} N · LON ${(Math.random() * 50 - 10).toFixed(2)} E`,
      () => `FREQ ${(2 + Math.random() * 12).toFixed(3)} MHz · ${Math.round(-60 + Math.random() * 40)} dB`,
      () => `SEGNALE ${String(Math.floor(Math.random() * 9999)).padStart(4, '0')} · ricevuto`,
      () => `${String(Math.floor(Math.random() * 24)).padStart(2, '0')}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')} · turno di notte`,
      () => `SETTORE ${String.fromCharCode(65 + Math.floor(Math.random() * 8))}-${Math.floor(Math.random() * 90 + 10)} · nessun contatto`,
      () => `ARCHIVIO ${Math.floor(Math.random() * 900 + 100)}/${Math.floor(Math.random() * 90 + 10)} · protetto`,
    ])();
    // lontano dal documento e dagli altri frammenti (prima finivano uno sull'altro)
    const taken: [number, number, number, number][] = [[bx - 20, by - 20, bw + 40, bh + 40]];
    const free = (x: number, y: number, w: number) => taken.every(([tx, ty, tw, th]) => x + w < tx || x > tx + tw || y + 30 < ty || y > ty + th);
    const count = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const text = frag();
      let x = 0, y = 0;
      for (let tries = 0; tries < 20; tries++) {
        x = 24 + Math.random() * (W - 340);
        y = 24 + Math.random() * (H - 80);
        if (free(x, y, 320)) break;
      }
      if (!free(x, y, 320)) continue;
      taken.push([x, y, 320, 30]);
      const t = this.add.text(x, y, '', { fontFamily: FONT_PIXEL, fontSize: `${Math.max(10, size - 2)}px`, color: '#cfe3f0', resolution: 2 }).setAlpha(0.55);
      // a scatti: pezzi di parola che arrivano di colpo, poi resta un po' e sparisce
      let n = 0;
      this.time.delayedCall(300 + Math.random() * (MAX_MS - 1500), () => {
        const ev = this.time.addEvent({
          delay: 60, loop: true, callback: () => {
            if (Math.random() < 0.45) return; // pause irregolari
            n = Math.min(text.length, n + 1 + Math.floor(Math.random() * 5));
            t.setText(text.slice(0, n) + (n < text.length ? '█' : ''));
            if (n >= text.length) { ev.remove(); this.tweens.add({ targets: t, alpha: 0, delay: 1200 + Math.random() * 1500, duration: 500 }); }
          },
        });
      });
    }
  }

  /** Registro scritto fino al carattere n, con l'avanzamento sull'ultima riga. */
  private draw(n: number, pct: number) {
    const g: string[] = [], b: string[] = [];
    let left = n;
    for (let i = 0; i < this.log.length && left > 0; i++) {
      const l = this.log[i], last = i === this.log.length - 1;
      const gs = l.gut.slice(0, left);
      left -= gs.length;
      let ts = l.text.slice(0, Math.max(0, left));
      left -= ts.length + 1;
      if (last && left >= 0) {
        const bar = 18, on = Math.round((pct / 100) * bar);
        ts += ` [${'#'.repeat(on)}${'.'.repeat(bar - on)}] ${String(pct).padStart(3)}%`;
      }
      g.push(gs);
      b.push(' '.repeat(l.indent) + ts + (left < 0 && this.cursor ? '█' : ''));
    }
    if (left >= 0 && this.cursor) b[b.length - 1] += '█';
    const gt = g.join('\n'), bt = b.join('\n');
    for (const t of this.gut) t.setText(gt);
    for (const t of this.body) t.setText(bt);
  }

  update(time: number) {
    this.now = time;
    if (this.startAt < 0) { this.startAt = time; this.typeEnd = time + this.total * this.charMs; }
    // telescrivente legata al tempo vero (non ai fotogrammi): sui telefoni lenti il testo arriva comunque in tempo
    const el = time - this.startAt;
    let n = 0;
    for (const [bt, bn] of this.burst) { if (bt > el) break; n = bn; }
    const t = Math.min(1, (time - this.startAt) / this.minMs);
    const shownT = this.launched && !this.ready ? Math.min(t, 0.92) : t;
    const pct = this.leaving ? 100 : Math.floor(shownT * 100);
    if (n !== this.shown || pct !== this.pct) {
      if (n > this.shown && this.shown >= 0) sfx('type', 0.45); // telescrivente: battuta a ogni gruppo di lettere
      this.shown = n;
      this.pct = pct;
      this.draw(n, pct);
    }
    // la scena successiva parte sotto, coperta da questa (che resta in cima)
    if (!this.launched && t > 0.5 && (!this.needWorld || this.registry.get('world'))) {
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
    this.tweens.add({ targets: this.cameras.main, alpha: 0, duration: 520, ease: 'Quad.easeIn', onComplete: () => this.scene.stop() });
  }
}
