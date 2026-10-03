import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { PLAYER } from '../game/RunState';
import { FACTION_INFO } from '../game/factions';
import { PALETTE } from '../config/palette';
import { randomSeed } from '../map/rng';
import { Button } from '../ui/Button';
import { textStyle } from '../ui/style';
import { drawSymbol } from '../ui/symbols';
import type { RunScene } from './RunScene';

const PAD = 12;
const LEFT_W = 240;
const LEFT_H = 78;
const RIGHT_W = 128;
const ROW_H = 18;

// Orizzontale: mappa libera al centro, info negli angoli in alto, comandi negli angoli in basso.
export class HudScene extends Phaser.Scene {
  private troops!: Phaser.GameObjects.Text;
  private rate!: Phaser.GameObjects.Text;
  private stats!: Phaser.GameObjects.Text;
  private seed!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private leftPanel!: Phaser.GameObjects.Rectangle;
  private rightPanel!: Phaser.GameObjects.Rectangle;
  private symbols!: Phaser.GameObjects.Graphics;
  private rows: Phaser.GameObjects.Text[] = [];
  private aliveKey = '';
  private speedBtns: Button[] = [];
  private newRunBtn!: Button;
  private shownTroops = -1;
  private overlay: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('Hud');
  }

  private get run() {
    return this.scene.get('Run') as RunScene;
  }

  create() {
    this.shownTroops = -1;
    this.aliveKey = '';
    this.overlay = [];
    this.leftPanel = this.add.rectangle(PAD, PAD, LEFT_W, LEFT_H, PALETTE.inchiostro, 0.88).setOrigin(0).setStrokeStyle(2, PALETTE.ocra);
    this.add.text(PAD + 10, PAD + 6, 'TRUPPE', textStyle(11, PALETTE.ocra));
    this.troops = this.add.text(PAD + 10, PAD + 18, '0', textStyle(28, PALETTE.carta));
    this.rate = this.add.text(PAD + 10, PAD + 30, '', textStyle(12, PALETTE.radioattivo));
    this.stats = this.add.text(PAD + 10, PAD + LEFT_H - 8, '', textStyle(12, PALETTE.carta)).setOrigin(0, 1);

    this.rightPanel = this.add.rectangle(0, PAD, RIGHT_W, FACTION_INFO.length * ROW_H + 10, PALETTE.inchiostro, 0.88)
      .setOrigin(0).setStrokeStyle(2, PALETTE.ocra);
    this.symbols = this.add.graphics();
    this.rows = FACTION_INFO.map(() => this.add.text(0, 0, '', textStyle(12, PALETTE.carta)).setOrigin(0, 0.5));

    this.seed = this.add.text(0, 0, '', textStyle(11, PALETTE.ocra, false)).setOrigin(0, 1);
    this.hint = this.add.text(0, 0, 'Tocca una casella evidenziata per conquistarla', textStyle(14, PALETTE.carta))
      .setOrigin(0.5, 0).setAlign('center').setBackgroundColor('#2b2118').setPadding(10, 6, 10, 6);

    this.speedBtns = BALANCE.speeds.map((s) => new Button(this, `x${s}`, 48, 40, () => this.setSpeed(s)));
    this.newRunBtn = new Button(this, 'NUOVA RUN', 120, 40, () => {
      this.run.scene.restart({ seed: randomSeed() });
    });
    this.setSpeed(this.run.state.speed);

    this.layout();
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
  }

  private setSpeed(s: number) {
    this.run.setSpeed(s);
    BALANCE.speeds.forEach((v, k) => this.speedBtns[k].setOn(v === s));
  }

  private layout() {
    const { width, height } = this.scale;
    const rx = width - PAD - RIGHT_W;
    this.rightPanel.setX(rx);
    this.rows.forEach((r, k) => r.setPosition(rx + 26, PAD + 5 + ROW_H * (k + 0.5)));
    this.aliveKey = ''; // forza il ridisegno dei simboli
    this.speedBtns.forEach((b, k) => b.setPosition(width - PAD - (BALANCE.speeds.length - k) * 54 + 6, height - PAD - 40));
    this.newRunBtn.setPosition(PAD, height - PAD - 40);
    this.seed.setPosition(PAD, height - PAD - 46);
    const free = width - 2 * PAD - LEFT_W - RIGHT_W - 2 * PAD;
    this.hint.setPosition(width / 2, PAD).setWordWrapWidth(Math.max(180, free));
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
    const sec = Math.floor(st.gameTimeMs / 1000);
    const time = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    this.stats.setText(`${st.tilesOwned} caselle · zaino ${st.backpack} · ${time}`);
    this.seed.setText(`mappa #${st.map.seed}`);

    const key = st.factions.map((f) => +f.alive).join('');
    if (key !== this.aliveKey) {
      this.aliveKey = key;
      const g = this.symbols.clear();
      const rx = this.rightPanel.x;
      st.factions.forEach((f, k) => {
        const info = FACTION_INFO[k];
        g.setAlpha(1);
        drawSymbol(g, info.symbol, rx + 14, this.rows[k].y, 6, f.alive ? info.fill : 0x555555, PALETTE.carta);
      });
    }
    st.factions.forEach((f, k) => {
      const r = this.rows[k];
      r.setText(f.alive ? `${FACTION_INFO[k].short} ${f.tiles}` : `${FACTION_INFO[k].short} ✝`).setAlpha(f.alive ? 1 : 0.4);
    });
  }

  onEliminated(faction: number, by: number, loot: number) {
    if (faction === PLAYER) return this.showGameOver();
    const who = FACTION_INFO[faction].name.toUpperCase();
    const msg = by === PLAYER
      ? `${who} ELIMINATI${loot ? `\n+${loot} rottami dal loro bottino` : ''}`
      : `${who} SPAZZATI VIA DA ${FACTION_INFO[by].short}`;
    this.toast(msg, by === PLAYER ? PALETTE.radioattivo : PALETTE.ocra);
  }

  private toast(msg: string, color: number) {
    const { width } = this.scale;
    const t = this.add.text(width / 2, PAD + 64, msg, textStyle(16, color)).setOrigin(0.5).setAlign('center')
      .setBackgroundColor('#2b2118').setPadding(12, 8, 12, 8).setScale(0.6).setAlpha(0);
    this.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 220, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, delay: 2400, duration: 400, onComplete: () => t.destroy() });
  }

  private showGameOver() {
    const { width, height } = this.scale;
    const st = this.run.state;
    const sec = Math.floor(st.gameTimeMs / 1000);
    const shade = this.add.rectangle(0, 0, width, height, PALETTE.inchiostro, 0.82).setOrigin(0).setInteractive();
    const title = this.add.text(width / 2, height / 2 - 70, 'ELIMINATO', textStyle(40, PALETTE.ko)).setOrigin(0.5);
    const sub = this.add.text(width / 2, height / 2 - 20,
      `territorio max ${st.maxTiles} · ${Math.floor(sec / 60)}m ${sec % 60}s`, textStyle(15, PALETTE.carta)).setOrigin(0.5);
    const again = new Button(this, 'RIVINCITA', 150, 44, () => this.run.scene.restart({ seed: st.map.seed }));
    const fresh = new Button(this, 'NUOVA MAPPA', 150, 44, () => this.run.scene.restart({ seed: randomSeed() }));
    again.setPosition(width / 2 - 158, height / 2 + 20);
    fresh.setPosition(width / 2 + 8, height / 2 + 20);
    this.overlay = [shade, title, sub, again, fresh];
    this.tweens.add({ targets: title, scale: { from: 1.6, to: 1 }, duration: 300, ease: 'Back.easeOut' });
  }

  onConquest(loot: number) {
    if (this.hint.visible) {
      this.tweens.add({ targets: this.hint, alpha: 0, duration: 300, onComplete: () => this.hint.setVisible(false) });
    }
    if (loot) this.tweens.add({ targets: this.stats, scale: { from: 1.15, to: 1 }, duration: 200 });
  }

  /** true se il punto (schermo) cade su un elemento dell'HUD. */
  hitUi(x: number, y: number): boolean {
    if (this.overlay.length) return true;
    const inRect = (r: Phaser.GameObjects.Rectangle) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
    if (inRect(this.leftPanel) || inRect(this.rightPanel)) return true;
    return [...this.speedBtns, this.newRunBtn].some((b) => b.contains(x, y));
  }
}
