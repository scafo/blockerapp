import Phaser from 'phaser';
import { BALANCE, type UnitType } from '../config/balance';
import { PALETTE } from '../config/palette';
import { PLAYER, type Outcome, type VictoryReason } from '../game/RunState';
import { FACTION_INFO } from '../game/factions';
import { RESOURCES, bagTotal, type Bag } from '../game/resources';
import { UNIT_TYPES } from '../game/units';
import type { GameEvent } from '../game/events';
import { EventCard } from '../ui/EventCard';
import { Button } from '../ui/Button';
import { CARD_H, CARD_W, UnitCard } from '../ui/UnitCard';
import { drawResourceIcon } from '../ui/resourceIcons';
import { textStyle } from '../ui/style';
import { drawSymbol } from '../ui/symbols';
import { drawUnitIcon } from '../ui/unitIcons';
import type { RunScene } from './RunScene';

const PAD = 12;
const LEFT_W = 262;
const LEFT_H = 112;
const RIGHT_W = 128;
const ROW_H = 18;
const RES_X = [0, 64, 128]; // colonne delle 3 risorse nel pannello

const mmss = (ms: number) => {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

// Orizzontale: mappa libera al centro, info negli angoli in alto, comandi negli angoli in basso.
export class HudScene extends Phaser.Scene {
  private troops!: Phaser.GameObjects.Text;
  private rate!: Phaser.GameObjects.Text;
  private stats!: Phaser.GameObjects.Text;
  private resTexts: Phaser.GameObjects.Text[] = [];
  private stormText!: Phaser.GameObjects.Text;
  private seed!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private leftPanel!: Phaser.GameObjects.Rectangle;
  private rightPanel!: Phaser.GameObjects.Rectangle;
  private symbols!: Phaser.GameObjects.Graphics;
  private rows: Phaser.GameObjects.Text[] = [];
  private aliveKey = '';
  private speedBtn!: Button;
  private retreatBtn!: Button;
  private retreatArmed: Phaser.Time.TimerEvent | null = null;
  private cards: UnitCard[] = [];
  private shownTroops = -1;
  private ended = false;
  private eventCard: EventCard | null = null;

  constructor() {
    super('Hud');
  }

  private get run() {
    return this.scene.get('Run') as RunScene;
  }

  create() {
    this.shownTroops = -1;
    this.aliveKey = '';
    this.ended = false;
    this.retreatArmed = null;
    this.eventCard = null;

    // pannello sinistro: truppe, territorio/obiettivi, zaino, tempesta
    this.leftPanel = this.add.rectangle(PAD, PAD, LEFT_W, LEFT_H, PALETTE.inchiostro, 0.88).setOrigin(0).setStrokeStyle(2, PALETTE.ocra);
    this.add.text(PAD + 10, PAD + 6, 'TRUPPE', textStyle(11, PALETTE.ocra));
    this.troops = this.add.text(PAD + 10, PAD + 18, '0', textStyle(28, PALETTE.carta));
    this.rate = this.add.text(PAD + 10, PAD + 30, '', textStyle(12, PALETTE.radioattivo));
    this.stats = this.add.text(PAD + 10, PAD + 54, '', textStyle(12, PALETTE.carta));
    const icons = this.add.graphics();
    this.resTexts = RESOURCES.map((r, k) => {
      drawResourceIcon(icons, r, PAD + 16 + RES_X[k], PAD + 79, 5);
      return this.add.text(PAD + 26 + RES_X[k], PAD + 79, '0', textStyle(12, PALETTE.carta)).setOrigin(0, 0.5);
    });
    this.stormText = this.add.text(PAD + 10, PAD + 92, '', textStyle(12, PALETTE.ocra));

    // pannello destro: fazioni
    this.rightPanel = this.add.rectangle(0, PAD, RIGHT_W, FACTION_INFO.length * ROW_H + 10, PALETTE.inchiostro, 0.88)
      .setOrigin(0).setStrokeStyle(2, PALETTE.ocra);
    this.symbols = this.add.graphics();
    this.rows = FACTION_INFO.map(() => this.add.text(0, 0, '', textStyle(12, PALETTE.carta)).setOrigin(0, 0.5));

    this.seed = this.add.text(0, 0, '', textStyle(11, PALETTE.ocra, false)).setOrigin(1, 1);
    this.hint = this.add.text(0, 0, 'Tocca una casella evidenziata per conquistarla', textStyle(14, PALETTE.carta))
      .setOrigin(0.5, 0).setAlign('center').setBackgroundColor('#2b2118').setPadding(10, 6, 10, 6);

    // comandi: carte in basso a sinistra; ritirata e velocità in basso a destra
    // solo le unità sbloccate dalla Fucina
    this.cards = UNIT_TYPES.filter((t) => this.run.state.opts.units.includes(t)).map((t) => new UnitCard(this, t, () => this.onCard(t)));
    this.speedBtn = new Button(this, 'x1', 56, 44, () => {
      const sp = BALANCE.speeds as readonly number[];
      this.setSpeed(sp[(sp.indexOf(this.run.state.speed) + 1) % sp.length]);
    });
    this.retreatBtn = new Button(this, 'RITIRATA', 112, 44, () => this.onRetreat());
    this.setSpeed(this.run.state.speed);

    this.layout();
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
  }

  private setSpeed(s: number) {
    this.run.setSpeed(s);
    this.speedBtn.setLabel(`x${s}`).setOn(s > 1);
  }

  /** Ritirata a doppio tocco: il primo arma, il secondo conferma. */
  private onRetreat() {
    if (this.ended) return;
    if (this.retreatArmed) {
      this.retreatArmed.remove();
      this.retreatArmed = null;
      this.run.ritirata();
      return;
    }
    this.retreatBtn.setLabel('CONFERMI?').setOn(true);
    this.retreatArmed = this.time.delayedCall(2500, () => {
      this.retreatArmed = null;
      this.retreatBtn.setLabel('RITIRATA').setOn(false);
    });
  }

  private onCard(t: UnitType) {
    const block = this.run.toggleCard(t);
    if (!block) return;
    const msg = ({ locked: 'serve la Fucina', cooldown: 'carta in ricarica', troops: 'truppe insufficienti', cap: 'massimo pedine in campo', tile: '' } as const)[block];
    const card = this.cards.find((c) => c.type === t)!;
    this.tweens.add({ targets: card, x: card.x + 4, duration: 50, yoyo: true, repeat: 2 });
    if (msg) this.toast(msg, PALETTE.ko);
  }

  /** Messaggio di contesto in alto al centro (null = nascondi). */
  setHint(msg: string | null) {
    this.tweens.killTweensOf(this.hint);
    if (!msg) return void this.hint.setVisible(false);
    this.hint.setText(msg).setVisible(true).setAlpha(1);
  }

  private layout() {
    const { width, height } = this.scale;
    const rx = width - PAD - RIGHT_W;
    this.rightPanel.setX(rx);
    this.rows.forEach((r, k) => r.setPosition(rx + 26, PAD + 5 + ROW_H * (k + 0.5)));
    this.aliveKey = ''; // forza il ridisegno dei simboli
    this.speedBtn.setPosition(width - PAD - 56, height - PAD - 44);
    this.retreatBtn.setPosition(width - PAD - 56 - 8 - 112, height - PAD - 44);
    this.cards.forEach((c, k) => {
      c.baseY = height - PAD - CARD_H;
      c.setPosition(PAD + k * (CARD_W + 6), c.baseY);
    });
    this.seed.setPosition(width - PAD, height - PAD - 50);
    const free = width - 2 * PAD - LEFT_W - RIGHT_W - 2 * PAD;
    this.hint.setPosition(width / 2 + (LEFT_W - RIGHT_W) / 2, PAD).setWordWrapWidth(Math.max(180, free));
  }

  update() {
    const st = this.run.state;
    if (!st) return;
    const t = Math.floor(st.troops);
    if (t !== this.shownTroops) {
      this.shownTroops = t;
      this.troops.setText(String(t));
      this.rate.setX(PAD + 10 + this.troops.width + 10);
    }
    this.rate.setText(`+${st.troopsPerSecond.toFixed(1)}/s`);
    const share = Math.round(st.mapShare * 100);
    this.stats.setText(
      `${st.tilesOwned} caselle ${share}%/${BALANCE.victory.mapShare * 100}% · anomalie ${st.anomaliesOwned()}/${BALANCE.victory.anomalies}`,
    );
    RESOURCES.forEach((r, k) => this.resTexts[k].setText(String(st.backpack[r])));
    if (st.stormIn > 0) {
      this.stormText.setText(`tempesta di cenere tra ${mmss(st.stormIn)}`).setColor(st.stormIn <= BALANCE.storm.warnMs ? '#d8432b' : '#c8963e');
    } else {
      const left = BALANCE.storm.startMs + BALANCE.storm.durationMs - st.gameTimeMs;
      this.stormText.setText(`LA CENERE AVANZA · ${mmss(left)}`).setColor('#d8432b');
    }
    this.seed.setText(`mappa #${st.map.seed}`);

    const key = st.factions.map((f) => +f.alive).join('');
    if (key !== this.aliveKey) {
      this.aliveKey = key;
      const g = this.symbols.clear();
      const rx = this.rightPanel.x;
      st.factions.forEach((f, k) => {
        const info = FACTION_INFO[k];
        drawSymbol(g, info.symbol, rx + 14, this.rows[k].y, 6, f.alive ? info.fill : 0x555555, PALETTE.carta);
        const dom = BALANCE.aiUnits.dominant[k] as UnitType | '';
        if (dom && f.alive) drawUnitIcon(g, dom, rx + RIGHT_W - 14, this.rows[k].y, 6, PALETTE.ocra);
      });
    }
    st.factions.forEach((f, k) => {
      const r = this.rows[k];
      r.setText(f.alive ? `${FACTION_INFO[k].short} ${f.tiles}` : `${FACTION_INFO[k].short} ✝`).setAlpha(f.alive ? 1 : 0.4);
    });
    const sel = this.run.selectedCard;
    for (const c of this.cards) {
      const cd = Math.max(0, st.cooldowns[PLAYER][c.type] - st.gameTimeMs) / BALANCE.units.cooldownMs;
      const block = st.deployBlock(PLAYER, c.type);
      c.refresh(cd, block === null || block === 'cooldown', sel === c.type);
    }
  }

  onEliminated(faction: number, by: number, loot: Bag) {
    if (faction === PLAYER) return;
    const who = FACTION_INFO[faction].name.toUpperCase();
    const got = bagTotal(loot);
    const msg = by === PLAYER
      ? `${who} ELIMINATI${got ? `\n+${got} risorse dal loro bottino` : ''}`
      : by < 0 ? `${who} INGHIOTTITI DALLA CENERE` : `${who} SPAZZATI VIA DA ${FACTION_INFO[by].short}`;
    this.toast(msg, by === PLAYER ? PALETTE.radioattivo : PALETTE.ocra);
  }

  onStorm(phase: 'warn' | 'start') {
    if (phase === 'warn') this.toast('BOLLETTINO: TEMPESTA DI CENERE IN ARRIVO\nresta dentro il confine bianco', PALETTE.carta);
    else this.toast('LA CENERE AVANZA\nchi ha più territorio quando si chiude vince', PALETTE.ko);
  }

  private toast(msg: string, color: number) {
    const { width } = this.scale;
    const t = this.add.text(width / 2, PAD + LEFT_H + 40, msg, textStyle(16, color)).setOrigin(0.5).setAlign('center')
      .setBackgroundColor('#2b2118').setPadding(12, 8, 12, 8).setScale(0.6).setAlpha(0);
    this.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 220, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, delay: 2600, duration: 400, onComplete: () => t.destroy() });
  }

  /** Carta evento: la run resta in pausa finché non scegli. */
  showEvent(ev: GameEvent) {
    const st = this.run.state;
    this.eventCard = new EventCard(this, ev, (c) => st.canChoose(c), (side) => {
      const msg = st.choose(side);
      this.eventCard = null;
      if (msg) this.toast(msg, PALETTE.carta);
    });
  }

  /** Cartello di fine run, mostrato prima della schermata finale. */
  showEnd(outcome: Outcome, reason?: VictoryReason) {
    this.ended = true;
    const { width, height } = this.scale;
    const title = {
      victory: reason === 'anomalies' ? 'IL SEGNALE È TUO' : reason === 'storm' ? 'ULTIMI IN PIEDI' : 'IMPERO!',
      retreat: 'RITIRATA',
      eliminated: 'ELIMINATO',
      storm: 'TRAVOLTO DALLA CENERE',
    }[outcome];
    const color = outcome === 'victory' ? PALETTE.radioattivo : outcome === 'retreat' ? PALETTE.ocra : PALETTE.ko;
    const t = this.add.text(width / 2, height / 2, title, textStyle(40, color)).setOrigin(0.5)
      .setStroke('#2b2118', 8).setScale(1.8).setAlpha(0);
    this.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 320, ease: 'Back.easeOut' });
  }

  onConquest(loot: number) {
    if (this.hint.visible && !this.run.selectedCard) {
      this.tweens.add({ targets: this.hint, alpha: 0, duration: 300, onComplete: () => this.hint.setVisible(false) });
    }
    if (loot) this.tweens.add({ targets: this.resTexts, scale: { from: 1.3, to: 1 }, duration: 220 });
  }

  /** true se il punto (schermo) cade su un elemento dell'HUD. */
  hitUi(x: number, y: number): boolean {
    if (this.ended || this.eventCard) return true;
    const inRect = (r: Phaser.GameObjects.Rectangle) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
    if (inRect(this.leftPanel) || inRect(this.rightPanel)) return true;
    return [this.speedBtn, this.retreatBtn, ...this.cards].some((b) => b.contains(x, y));
  }
}
