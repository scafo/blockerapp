import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { PLAYER } from '../game/RunState';
import { FACTION_INFO } from '../game/factions';
import { PALETTE } from '../config/palette';
import { randomSeed } from '../map/rng';
import { Button } from '../ui/Button';
import { textStyle } from '../ui/style';
import type { RunScene } from './RunScene';

const PAD = 12;
const BAR_H = 64;
const STRIP_H = 24;
const TOP_H = BAR_H + STRIP_H;

export class HudScene extends Phaser.Scene {
  private troops!: Phaser.GameObjects.Text;
  private rate!: Phaser.GameObjects.Text;
  private stats!: Phaser.GameObjects.Text;
  private seed!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private panel!: Phaser.GameObjects.Rectangle;
  private speedBtns: Button[] = [];
  private newRunBtn!: Button;
  private shownTroops = -1;
  private strip!: Phaser.GameObjects.Rectangle;
  private chips: { sq: Phaser.GameObjects.Rectangle; txt: Phaser.GameObjects.Text }[] = [];
  private overlay: Phaser.GameObjects.GameObject[] = [];
  private overlayBtns: Button[] = [];

  constructor() {
    super('Hud');
  }

  private get run() {
    return this.scene.get('Run') as RunScene;
  }

  create() {
    this.shownTroops = -1;
    this.overlay = [];
    this.overlayBtns = [];
    this.strip = this.add.rectangle(0, BAR_H, 10, STRIP_H, PALETTE.inchiostro, 0.7).setOrigin(0);
    this.chips = FACTION_INFO.map((f) => ({
      sq: this.add.rectangle(0, BAR_H + STRIP_H / 2, 10, 10, f.fill).setStrokeStyle(1, f.border),
      txt: this.add.text(0, BAR_H + STRIP_H / 2, '', textStyle(11, PALETTE.carta)).setOrigin(0, 0.5),
    }));
    this.panel = this.add.rectangle(0, 0, 10, BAR_H, PALETTE.inchiostro, 0.88).setOrigin(0).setStrokeStyle(2, PALETTE.ocra);
    this.add.text(PAD, 8, 'TRUPPE', textStyle(11, PALETTE.ocra));
    this.troops = this.add.text(PAD, 20, '0', textStyle(30, PALETTE.carta));
    this.rate = this.add.text(PAD, 0, '', textStyle(12, PALETTE.radioattivo));
    this.stats = this.add.text(0, 10, '', textStyle(13, PALETTE.carta)).setOrigin(1, 0).setAlign('right').setLineSpacing(2);
    this.seed = this.add.text(0, 0, '', textStyle(11, PALETTE.ocra, false)).setOrigin(0, 1);
    this.hint = this.add.text(0, 0, 'Tocca una casella evidenziata per conquistarla', textStyle(14, PALETTE.carta))
      .setOrigin(0.5).setBackgroundColor('#2b2118').setPadding(10, 6, 10, 6);

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
    this.panel.setSize(width, BAR_H);
    this.strip.setSize(width, STRIP_H);
    const slot = (width - 2 * PAD) / this.chips.length;
    this.chips.forEach((c, k) => {
      c.sq.setX(PAD + k * slot + 5);
      c.txt.setX(PAD + k * slot + 14);
    });
    this.rate.setPosition(PAD + this.troops.width + 10, 34);
    this.stats.setPosition(width - PAD, 10);
    this.speedBtns.forEach((b, k) => b.setPosition(width - PAD - (BALANCE.speeds.length - k) * 54 + 6, height - PAD - 40));
    this.newRunBtn.setPosition(PAD, height - PAD - 40);
    this.seed.setPosition(PAD, height - PAD - 46);
    this.hint.setPosition(width / 2, TOP_H + 30).setWordWrapWidth(width - 2 * PAD);
  }

  update() {
    const st = this.run.state;
    if (!st) return;
    const t = Math.floor(st.troops);
    if (t !== this.shownTroops) {
      this.shownTroops = t;
      this.troops.setText(String(t));
      this.rate.setX(PAD + this.troops.width + 10);
    }
    this.rate.setText(`+${st.troopsPerSecond.toFixed(1)}/s`);
    const sec = Math.floor(st.gameTimeMs / 1000);
    const time = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    this.stats.setText(`TERRITORIO ${st.tilesOwned}\nZAINO ${st.backpack}\n${time}`);
    this.seed.setText(`mappa #${st.map.seed}`);
    st.factions.forEach((f, k) => {
      const c = this.chips[k];
      if (!c) return;
      c.txt.setText(f.alive ? `${FACTION_INFO[k].short} ${f.tiles}` : `${FACTION_INFO[k].short} ✝`);
      c.txt.setAlpha(f.alive ? 1 : 0.4);
      c.sq.setAlpha(f.alive ? 1 : 0.3);
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
    const t = this.add.text(width / 2, TOP_H + 70, msg, textStyle(16, color)).setOrigin(0.5).setAlign('center')
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
    this.overlayBtns = [again, fresh];
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
    if (y <= TOP_H || this.overlay.length) return true;
    return [...this.speedBtns, this.newRunBtn, ...this.overlayBtns].some((b) => b.contains(x, y));
  }
}
