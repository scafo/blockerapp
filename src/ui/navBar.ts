// Barra fissa in alto, uguale su tutte le pagine della base (Nico, 23 novembre 2026: "non ci sono tasti per tornare indietro,
// non ci si può muovere"): a sinistra Home, poi le sezioni nello stesso ordine della home (Gioca, Base, Ricerca, Arsenale,
// Mercato) con quella aperta sottolineata, a destra le scorte, il Lume e l'audio. Ogni pagina è a un clic da tutte le altre.
import Phaser from 'phaser';
import { hex } from '../config/palette';
import { RESOURCES, type Bag } from '../game/resources';
import { audioSettings, onAudioChange } from '../audio/engine';
import { lineIcon } from './lineIcons';
import { OPS, heading, resIcon, tech } from './ops';
import { sfx } from '../audio/sfx';
import { premiumOn } from '../online/premium';

export type NavTab = 'gioca' | 'base' | 'ricerca' | 'arsenale' | 'mercato';
const TABS: [NavTab, string][] = [['gioca', 'GIOCA'], ['base', 'BASE'], ['ricerca', 'RICERCA'], ['arsenale', 'ARSENALE'], ['mercato', 'MERCATO']];

export const NAV_H = 64;
export const LUME = 0x9fd0f5; // colore del Lume: la luce fredda

export interface NavOptions {
  onHome: () => void;
  onTab: (t: NavTab) => void;
  onAudio: (x: number, y: number) => void;
  onProfile: () => void;
  /** Sezioni chiuse, col motivo (es. il Mercato prima della prima campagna). */
  locked?: Partial<Record<NavTab, string>>;
  onLocked?: (why: string) => void;
}

export class NavBar {
  readonly h = NAV_H;
  private tabs = new Map<NavTab, { t: Phaser.GameObjects.Text; line: Phaser.GameObjects.Rectangle }>();
  private stash: Phaser.GameObjects.Text[] = [];
  private active: NavTab | null = null;
  private lume!: Phaser.GameObjects.Text;
  readonly root: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene, width: number, private opts: NavOptions) {
    const s = scene, H = NAV_H, cy = H / 2, items: Phaser.GameObjects.GameObject[] = [];
    // schermi più stretti (portatili): sezioni e scorte più compatte, così niente si accavalla
    const tight = width < 1360, tabSize = tight ? 14 : 16, tabGap = tight ? 24 : 40, resStep = tight ? 92 : 112;
    // fondo pieno scuro, filo sotto: la barra non si confonde con le foto delle pagine
    items.push(s.add.rectangle(0, 0, width, H, 0x05080d, 0.94).setOrigin(0).setInteractive(),
      s.add.rectangle(0, H - 1, width, 1, OPS.edge, 0.28).setOrigin(0));
    // Home: freccia + parola, sempre nello stesso posto
    const home = s.add.container(24, cy);
    const hi = lineIcon(s, 'back', 0, 0, 22, OPS.text);
    const ht = heading(s, 18, 0, 'Home', 17, OPS.text).setOrigin(0, 0.5);
    home.add([hi, ht]);
    const hw = 18 + ht.width + 8;
    const hHit = s.add.rectangle(10, 6, hw + 22, H - 12, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true })
      .on('pointerover', () => home.setAlpha(1)).on('pointerout', () => home.setAlpha(0.8))
      .on('pointerup', () => { sfx('click'); opts.onHome(); });
    home.setAlpha(0.8);
    items.push(home, hHit, s.add.rectangle(24 + hw + 20, 16, 1, H - 32, OPS.edge, 0.35).setOrigin(0));
    // sezioni
    let x = 24 + hw + 48;
    for (const [k, name] of TABS) {
      const off = !!opts.locked?.[k];
      const t = tech(s, x, cy, name, tabSize, off ? 0x4c555c : OPS.label).setOrigin(0, 0.5).setLetterSpacing(2.5);
      const line = s.add.rectangle(x, H - 3, t.width, 3, 0xffffff).setOrigin(0).setVisible(false);
      const hit = s.add.rectangle(x - 14, 0, t.width + 28, H, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true })
        .on('pointerover', () => { if (!off && this.active !== k) t.setColor(hex(OPS.text)); })
        .on('pointerout', () => { if (!off && this.active !== k) t.setColor(hex(OPS.label)); })
        .on('pointerup', () => {
          if (off) { opts.onLocked?.(opts.locked![k]!); return; }
          sfx('click');
          opts.onTab(k);
        });
      this.tabs.set(k, { t, line });
      items.push(t, line, hit);
      x += t.width + tabGap;
    }
    // audio all'estremo destro, scorte alla sua sinistra
    const ax = width - 34;
    const ai = lineIcon(s, audioSettings().muted ? 'mute' : 'volume', ax, cy, 22, OPS.body);
    const aHit = s.add.rectangle(ax - 20, 8, 40, H - 16, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true })
      .on('pointerup', () => opts.onAudio(ax, H));
    const off = onAudioChange(() => ai.setTexture(`li-${audioSettings().muted ? 'mute' : 'volume'}`));
    s.events.once('shutdown', off);
    items.push(ai, aHit);
    // profilo (comandante, potenza, registro): un'icona accanto all'audio
    const px = ax - 44;
    const pi = lineIcon(s, 'user', px, cy, 22, OPS.body);
    items.push(pi, s.add.rectangle(px - 20, 8, 40, H - 16, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true })
      .on('pointerover', () => pi.setTint(OPS.text)).on('pointerout', () => pi.setTint(OPS.body))
      .on('pointerup', () => { sfx('click'); opts.onProfile(); }));
    // Frammenti, la moneta speciale: accanto alle scorte, si tocca per andare al Mercato
    // (solo se gli acquisti sono accesi: senza, un "—" che non si può riempire non serve)
    const lx = premiumOn ? px - 40 - 96 : px - 20;
    this.lume = tech(s, lx + 32, cy, '—', 18, LUME).setOrigin(0, 0.5).setVisible(premiumOn);
    if (premiumOn) items.push(lineIcon(s, 'sparkles', lx + 14, cy, 22, LUME), this.lume, s.add.rectangle(lx, 8, 96, H - 16, 0xffffff, 0.001).setOrigin(0)
      .setInteractive({ useHandCursor: true }).on('pointerup', () => opts.onTab('mercato')));
    let sx = lx - 20 - RESOURCES.length * resStep;
    for (const r of RESOURCES) {
      items.push(resIcon(s, r, sx + 14, cy, 22));
      const t = tech(s, sx + 34, cy, '0', 18).setOrigin(0, 0.5);
      this.stash.push(t);
      items.push(t);
      sx += resStep;
    }
    this.root = s.add.container(0, 0, items).setDepth(60);
  }

  /** Sezione aperta (null = nessuna, es. una stanza che non è nella barra). */
  setActive(t: NavTab | null) {
    this.active = t;
    for (const [k, { t: txt, line }] of this.tabs) {
      const on = k === t, off = !!this.opts.locked?.[k];
      txt.setColor(hex(off ? 0x4c555c : on ? OPS.text : OPS.label));
      line.setVisible(on);
    }
  }

  /** Testi delle scorte (la scena li fa scorrere al rientro da una campagna). */
  stashTexts(): Phaser.GameObjects.Text[] {
    return this.stash;
  }

  /** Saldo del Lume (null = non ancora entrato col proprio account). */
  setLume(n: number | null) {
    this.lume.setText(n === null ? '—' : String(n));
  }

  setStash(b: Bag) {
    RESOURCES.forEach((r, i) => this.stash[i]?.setText(String(b[r])));
  }
}
