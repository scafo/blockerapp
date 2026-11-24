// Schermata d'entrata (riferimento di Nico: menu di gioco a tutto schermo). Sfondo = la carta scura centrata sull'Europa col
// rilievo in ombreggiatura morbida (titleMap.ts), che segue il mouse, e poche nuvole (luci e convogli provati e tolti: Nico). Marchio piccolo in alto a sinistra, le stesse cinque sezioni della barra della base (GIOCA prima e
// più grande), ognuna con una riga che dice cosa c'è dentro; a destra il comandante, i lavori in corso e il Lume. Niente cornici
// né scritte decorative (Nico: "troppo AI"). Le voci portano dritte alla base (il caricamento c'è solo prima di una campagna).
import Phaser from 'phaser';
import { hex } from '../config/palette';
import buildingText from '../data/buildings.json';
import { activeFront, expeditionTimeSec, fmtTime, FRONT_ROMAN, nextLevel } from '../game/camp';
import { techInfo, type TechId } from '../game/tech';
import { fetchWallet, premiumOn, signedEmail } from '../online/premium';
import { loadProfile, type Profile } from '../save/storage';
import { RESOURCES } from '../game/resources';
import { fade } from '../ui/images';
import { lineIcon, loadLineIcons, type LineIcon } from '../ui/lineIcons';
import { body, heading, label, OPS, resIcon, tech, value } from '../ui/ops';
import { UI, uiCamera, view } from '../ui/screen';
import { MAP_PAD, titleTextures } from '../ui/titleMap';
import { BALANCE } from '../config/balance';
import { sfx } from '../audio/sfx';
import type { CampData } from './CampScene';
import type { LoadData } from './LoadScene';

const COLD = 0x9fd0f5; // accento freddo (il Lume, i lavori attivi): niente arancione (Nico)
const PANEL = 0x0a0f16;
// voci del menu non scelte: grigie, così quella sotto il mouse spicca bianca (Nico: "meno bianche quando non sono selezionate")
const DIM = 0x7f888e, DIM_OFF = 0x4a5258;

// le stesse sezioni della barra della base, nello stesso ordine (Nico: "che combacino")
type Item = { key: 'gioca' | 'base' | 'ricerca' | 'arsenale' | 'mercato'; text: string; what: string };
const ITEMS: Item[] = [
  { key: 'gioca', text: 'GIOCA', what: '' }, // la riga la scrive create(): il fronte che ti aspetta
  { key: 'base', text: 'BASE', what: 'Costruisci e migliora le stanze del quartier generale' },
  { key: 'ricerca', text: 'RICERCA', what: 'Nuove tecnologie, una ricerca alla volta' },
  { key: 'arsenale', text: 'ARSENALE', what: 'Le armi da sbloccare e migliorare' },
  { key: 'mercato', text: 'MERCATO', what: 'Scambi, estrazione, rifornimenti e Deposito' },
];

export class TitleScene extends Phaser.Scene {
  private next!: LoadData;
  private profile!: Profile;
  private sel = 0;
  private rows: { t: Phaser.GameObjects.Text; x: number; off: boolean; main: boolean; cap: Phaser.GameObjects.Text; tw?: Phaser.Tweens.Tween }[] = [];
  private gone = false;
  private map: { box: Phaser.GameObjects.Container; pad: number; x: number; y: number } | null = null;
  private clouds: { t: Phaser.GameObjects.TileSprite; vx: number; vy: number }[] = [];

  constructor() {
    super('Title');
  }

  create(next: LoadData) {
    uiCamera(this);
    this.next = next;
    this.profile = loadProfile();
    this.gone = false;
    this.sel = 0;
    this.rows = [];
    const { width: W, height: H } = view(this);
    const s = Phaser.Math.Clamp(Math.min(W / 1280, H / 720), 0.8, 1.6);
    this.cameras.main.setBackgroundColor(0x05070d);
    this.drawBackdrop(W, H);
    // veli più leggeri di prima (Nico: "un 20–30% meno scuro"): solo quanto serve a leggere menu e riquadri
    fade(this, 0, 0, W * 0.48, H, 0x05080c, 0.62, 0, 'h');
    fade(this, W * 0.66, 0, W * 0.34, H, 0x05080c, 0, 0.42, 'h');
    fade(this, 0, H * 0.75, W, H * 0.25, 0x05080c, 0, 0.5);

    const pad = Math.round(64 * s);
    // marchio piccolo (Nico: "ARCHEON può essere molto più piccolo"), entra stringendo la spaziatura
    const tSize = Math.round(22 * s);
    const title = tech(this, pad, pad, 'ARCHEON', tSize).setAlpha(0);
    const sub = label(this, pad, title.y + title.height + 4 * s, 'IL MONDO DOPO LA CADUTA', OPS.label, 10 * s).setLetterSpacing(3 * s).setAlpha(0);
    const sp = { v: tSize * 0.9 };
    title.setLetterSpacing(sp.v);
    this.tweens.add({ targets: [title, sub], alpha: 1, duration: 800, delay: 200, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: sp, v: tSize * 0.42, duration: 1200, delay: 200, ease: 'Expo.easeOut', onUpdate: () => title.setLetterSpacing(sp.v) });

    // voci: GIOCA più grande, le altre a seguire; sotto la voce scelta una riga dice cosa c'è dentro
    const F = BALANCE.fronts[activeFront(this.profile)];
    ITEMS[0].what = this.profile.runs === 0 ? 'La prima campagna' : `Prossimo: Fronte ${FRONT_ROMAN[activeFront(this.profile)]} · ${F.name}`;
    const iSize = Math.round(40 * s), mainSize = Math.round(58 * s);
    let y = Math.max(sub.y + sub.height + 60 * s, H * 0.3);
    ITEMS.forEach((it, i) => {
      const main = i === 0, off = it.key === 'mercato' && this.profile.runs === 0, size = main ? mainSize : iSize;
      const t = tech(this, pad, y + size / 2, it.text, size, off ? DIM_OFF : DIM).setOrigin(0, 0.5).setAlpha(0);
      t.setLetterSpacing((main ? 3 : 2) * s).setShadow(0, 0, '#000000', 10, true, true);
      const cap = label(this, pad + 2 * s, y + size + 2 * s, off ? 'Dopo la prima campagna' : it.what, OPS.body, 11 * s).setAlpha(0).setShadow(0, 0, '#000000', 6, true, true);
      this.add.rectangle(pad - 12, y - 6 * s, Math.max(t.width * 1.2 + 40 * s, 300 * s), size + 18 * s, 0xffffff, 0.001).setOrigin(0)
        .setInteractive({ useHandCursor: !off })
        .on('pointerover', () => this.select(i))
        .on('pointerup', () => { if (!off) this.choose(i); });
      this.rows.push({ t, x: pad, off, main, cap });
      this.tweens.add({ targets: t, alpha: 1, duration: 420, delay: 500 + i * 90, ease: 'Quad.easeOut' });
      y += size + (main ? 44 : 30) * s; // spazio per la riga sotto
    });
    this.time.delayedCall(600, () => this.select(0, true));

    // a destra: comandante, lavori in corso, Lume (le icone a linea si caricano prima)
    const pw = Math.round(380 * s), px = W - pad - pw;
    void loadLineIcons(this, Math.round(48 * UI())).then(() => {
      if (!this.scene.isActive()) return;
      let py = this.drawCommander(px, pad, pw, s) + 16 * s;
      py = this.drawJobs(px, py, pw, s) + 16 * s;
      if (premiumOn) this.drawLume(px, py, pw, s);
    });

    this.cameras.main.fadeIn(600, 0, 0, 0);
    const kb = this.input.keyboard;
    kb?.on('keydown-UP', () => this.move(-1));
    kb?.on('keydown-W', () => this.move(-1));
    kb?.on('keydown-DOWN', () => this.move(1));
    kb?.on('keydown-S', () => this.move(1));
    kb?.on('keydown-ENTER', () => { if (!document.getElementById('name-ask')) this.choose(this.sel); }); // non mentre si scrive il nome
    this.scale.once('resize', () => this.scene.restart(this.next));
  }

  /** Sfondo: la carta (in un contenitore che segue il mouse) e due strati leggeri di nuvole. */
  private drawBackdrop(W: number, H: number) {
    this.clouds = [];
    this.map = null;
    void titleTextures(this, W, H, UI()).then(() => {
      if (!this.scene.isActive()) return;
      const pad = W * MAP_PAD;
      const img = this.add.image(-pad, -pad, 'title-map').setOrigin(0).setDisplaySize(W + 2 * pad, H + 2 * pad);
      const box = this.add.container(0, 0, [img]).setDepth(-10).setAlpha(0);
      this.map = { box, pad, x: 0, y: 0 };
      this.tweens.add({ targets: box, alpha: 1, duration: 1400, ease: 'Quad.easeOut' });
      // nuvole: meno e più leggere di prima (Nico: "preferivo la prima versione")
      for (const [key, scale, alpha, vx, vy, tint] of [['title-clouds-a', 3.2, 0.3, 9, 2, 0x9aa8b8], ['title-clouds-b', 2.1, 0.18, 16, -3, 0xc4ccd6]] as const) {
        const t = this.add.tileSprite(0, 0, W, H, key).setOrigin(0).setTileScale(scale).setAlpha(0).setTint(tint).setDepth(-9);
        this.tweens.add({ targets: t, alpha, duration: 1800, ease: 'Quad.easeOut' });
        this.clouds.push({ t, vx, vy });
      }
    });
  }

  update(_t: number, dt: number) {
    // la carta (e le sue luci) segue il mouse di poco, nel verso opposto (profondità), e rallenta arrivando
    if (this.map) {
      const { width: W, height: H } = view(this), a = this.input.activePointer, m = this.map;
      const p = this.cameras.main.getWorldPoint(a.x, a.y); // in punti, come il resto della scena
      const tx = -Phaser.Math.Clamp((p.x - W / 2) / (W / 2), -1, 1) * m.pad, ty = -Phaser.Math.Clamp((p.y - H / 2) / (H / 2), -1, 1) * m.pad;
      const k = 1 - Math.exp(-dt / 450);
      m.x += (tx - m.x) * k;
      m.y += (ty - m.y) * k;
      m.box.setPosition(m.x, m.y);
    }
    for (const c of this.clouds) {
      c.t.tilePositionX += (c.vx * dt) / 1000;
      c.t.tilePositionY += (c.vy * dt) / 1000;
    }
  }

  /** Fondo dei riquadri a destra: vetro scuro, filo sottile. */
  private card(x: number, y: number, w: number, h: number) {
    this.add.graphics().fillStyle(PANEL, 0.78).fillRect(x, y, w, h).lineStyle(1, OPS.edge, 0.28).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  /** Comandante: ritratto, nome, fronte. Ritorna la y sotto. */
  private drawCommander(x: number, y: number, w: number, s: number): number {
    // una riga sola (Nico: "stringi il comandante, solo icona o nome, e accanto le risorse"): icona e nome a sinistra (aprono il
    // Profilo), le scorte del Deposito a destra
    const h = Math.round(52 * s), p = this.profile, inset = 16 * s;
    this.card(x, y, w, h);
    const ui = lineIcon(this, 'user', x + inset + 9 * s, y + h / 2, 18 * s, OPS.body);
    const nm = heading(this, x + inset + 26 * s, y + h / 2, p.name || 'Comandante', 16 * s).setOrigin(0, 0.5);
    const hit = this.add.rectangle(x, y, nm.x + nm.width + 12 * s - x, h, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true })
      .on('pointerover', () => { ui.setTint(OPS.text); }).on('pointerout', () => ui.setTint(OPS.body)).on('pointerup', () => this.go({ open: 'profilo' }));
    void hit;
    let rx = x + w - inset;
    for (const r of [...RESOURCES].reverse()) {
      const t = tech(this, rx, y + h / 2, String(p.stash[r]), 15 * s).setOrigin(1, 0.5);
      resIcon(this, r, t.x - t.width - 11 * s, y + h / 2, 16 * s);
      rx = t.x - t.width - 30 * s;
    }
    return y + h;
  }

  /** Lavori in corso: cantiere, ricerca, estrazione; nome e stato a sinistra, tempo a destra, barra sotto. Ritorna la y sotto. */
  private drawJobs(x: number, y: number, w: number, s: number): number {
    const p = this.profile, now = Date.now(), rowH = Math.round(64 * s), headH = Math.round(40 * s), inset = 18 * s;
    const c = p.construction, r = p.research, e = p.expedition;
    const jobs: { ic: LineIcon; name: string; what: string; left: number; total: number; open: CampData['open'] | null }[] = [
      {
        ic: 'hammer', name: 'Cantiere',
        what: c ? `${buildingText[c.id].name} → livello ${p.buildings[c.id] + 1}` : 'Libero',
        left: c ? c.until - now : 0, total: c ? (nextLevel(p, c.id)?.timeSec ?? 1) * 1000 : 0, open: null, // la base è il cantiere
      },
      {
        ic: 'flask', name: 'Ricerca',
        what: r ? techInfo(r.id as TechId).name : p.buildings.laboratorio ? 'Nessun progetto' : 'Serve il Laboratorio',
        left: r ? r.until - now : 0, total: r ? techInfo(r.id as TechId).timeSec * 1000 : 0, open: 'ricerca',
      },
      {
        ic: 'truck', name: 'Estrazione',
        what: !e ? 'Squadre pronte' : e.until <= now ? 'Di ritorno · ritira il bottino' : buildingText.spedizione.kinds[e.kind],
        left: e ? e.until - now : 0, total: e ? expeditionTimeSec(p, e.kind) * 1000 : 0, open: 'estrazione',
      },
    ];
    const h = headH + jobs.length * rowH;
    this.card(x, y, w, h);
    label(this, x + inset, y + headH / 2 + 2 * s, 'IN CORSO', OPS.label, 11 * s).setOrigin(0, 0.5).setLetterSpacing(2.5 * s);
    lineIcon(this, 'hourglass', x + w - inset - 7 * s, y + headH / 2 + 2 * s, 14 * s, OPS.label);
    const g = this.add.graphics();
    jobs.forEach((j, i) => {
      const ry = y + headH + i * rowH, busy = j.total > 0 && j.left > 0, done = j.total > 0 && !busy, cy = ry + rowH / 2 - 4 * s;
      g.lineStyle(1, OPS.edge, 0.18).lineBetween(x + inset, ry, x + w - inset, ry);
      // icona in un cerchio
      g.lineStyle(1, busy ? COLD : OPS.edge, busy ? 0.9 : 0.45).strokeCircle(x + inset + 17 * s, cy, 17 * s);
      lineIcon(this, j.ic, x + inset + 17 * s, cy, 18 * s, busy ? 0xffffff : OPS.body);
      const tx = x + inset + 46 * s;
      heading(this, tx, cy - 2 * s, j.name, 16 * s).setOrigin(0, 1);
      label(this, tx, cy + 3 * s, j.what, busy ? OPS.body : OPS.label, 12 * s);
      heading(this, x + w - inset, cy, busy ? fmtTime(j.left) : done ? 'Pronto' : '', 15 * s, busy ? 0xffffff : done ? OPS.gain : OPS.label).setOrigin(1, 0.5); // fermo: niente (prima un trattino senza senso)
      if (j.total > 0) {
        const bx = tx, bw = x + w - inset - tx, by = ry + rowH - 12 * s;
        g.fillStyle(0xffffff, 0.08).fillRect(bx, by, bw, 2 * s);
        g.fillStyle(busy ? COLD : OPS.gain, 1).fillRect(bx, by, bw * Phaser.Math.Clamp(1 - j.left / j.total, 0, 1), 2 * s);
      }
      const hit = this.add.rectangle(x, ry, w, rowH, 0xffffff, 0).setOrigin(0).setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => hit.setFillStyle(0xffffff, 0.04)).on('pointerout', () => hit.setFillStyle(0xffffff, 0))
        .on('pointerup', () => this.go(j.open ? { open: j.open } : {}));
    });
    return y + h;
  }

  /** Riquadro del Lume (al posto di "Upgrade to Premium"): apre il Mercato. */
  private drawLume(x: number, y: number, w: number, s: number) {
    const h = Math.round(84 * s), off = this.profile.runs === 0, inset = 18 * s;
    const g = this.add.graphics();
    g.fillStyle(0x0a1620, 0.85).fillRect(x, y, w, h).lineStyle(1, COLD, 0.6).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    lineIcon(this, 'sparkles', x + inset + 12 * s, y + h / 2, 24 * s, COLD);
    const tx = x + inset + 40 * s;
    value(this, tx, y + h / 2 - 2 * s, 'FRAMMENTI', 26 * s).setOrigin(0, 1).setLetterSpacing(4 * s);
    body(this, tx, y + h / 2 + 4 * s, off ? 'Apre dopo la prima campagna' : 'Finisci i timer · pacchetti di risorse', 12 * s, OPS.body);
    const bal = heading(this, x + w - inset, y + h / 2, '', 16 * s, COLD).setOrigin(1, 0.5);
    if (!off) {
      this.add.rectangle(x, y, w, h, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true })
        .on('pointerover', () => g.setAlpha(0.85)).on('pointerout', () => g.setAlpha(1))
        .on('pointerup', () => this.go({ open: 'mercato' }));
    }
    // saldo, se si è già entrati col proprio account
    void (async () => {
      if (!(await signedEmail())) return;
      const r = await fetchWallet();
      if (r.ok && bal.active) bal.setText(`${r.data.lume} Frammenti`);
    })();
  }

  /** Voce scelta: si ingrandisce e si sposta a destra; le altre tornano. */
  private select(i: number, first = false) {
    if (i === this.sel && !first) return;
    this.sel = i;
    this.rows.forEach((r, k) => {
      const on = k === i;
      r.tw?.stop(); // solo spostamento e scala: la dissolvenza d'entrata continua
      r.tw = this.tweens.add({ targets: r.t, x: r.x + (on ? 10 : 0), scale: on ? 1.04 : 1, duration: 320, ease: 'Sine.easeOut' }); // calmo (Nico)
      r.t.setColor(hex(r.off ? DIM_OFF : on ? 0xffffff : DIM));
      this.tweens.killTweensOf(r.cap);
      this.tweens.add({ targets: r.cap, alpha: on ? 1 : 0, x: r.x + (on ? 12 : 2), duration: on ? 320 : 160, ease: 'Sine.easeOut' });
    });
    if (!first) sfx('click');
  }

  private move(d: number) {
    this.select((this.sel + d + this.rows.length) % this.rows.length);
  }

  private choose(i: number) {
    if (this.rows[i]?.off) return;
    const k = ITEMS[i].key;
    // prima volta (o ?seed=): GIOCA va dritto nella campagna come prima
    if (k === 'gioca') return this.go(this.next.next === 'Run' ? null : { open: 'gioca' });
    this.go(k === 'base' ? {} : { open: k });
  }

  /** Base (con la pagina da aprire), senza caricamento; null = campagna prevista all'avvio (lì il caricamento resta). */
  private go(open: CampData | null) {
    if (this.gone) return;
    this.gone = true;
    sfx('click');
    this.cameras.main.fadeOut(350, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => (open === null ? this.scene.start('Load', this.next) : this.scene.start('Camp', open)));
  }
}
