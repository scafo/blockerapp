import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { PALETTE } from '../config/palette';
import { randomSeed } from '../map/rng';
import { Button } from '../ui/Button';
import { textStyle } from '../ui/style';
import type { RunScene } from './RunScene';

const PAD = 12;

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

  constructor() {
    super('Hud');
  }

  private get run() {
    return this.scene.get('Run') as RunScene;
  }

  create() {
    this.shownTroops = -1;
    this.panel = this.add.rectangle(0, 0, 10, 64, PALETTE.inchiostro, 0.88).setOrigin(0).setStrokeStyle(2, PALETTE.ocra);
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
    this.panel.setSize(width, 64);
    this.rate.setPosition(PAD + this.troops.width + 10, 34);
    this.stats.setPosition(width - PAD, 10);
    this.speedBtns.forEach((b, k) => b.setPosition(width - PAD - (BALANCE.speeds.length - k) * 54 + 6, height - PAD - 40));
    this.newRunBtn.setPosition(PAD, height - PAD - 40);
    this.seed.setPosition(PAD, height - PAD - 46);
    this.hint.setPosition(width / 2, 64 + 30).setWordWrapWidth(width - 2 * PAD);
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
  }

  onConquest(loot: number) {
    if (this.hint.visible) {
      this.tweens.add({ targets: this.hint, alpha: 0, duration: 300, onComplete: () => this.hint.setVisible(false) });
    }
    if (loot) this.tweens.add({ targets: this.stats, scale: { from: 1.15, to: 1 }, duration: 200 });
  }

  /** true se il punto (schermo) cade su un elemento dell'HUD. */
  hitUi(x: number, y: number): boolean {
    if (y <= 64) return true;
    return [...this.speedBtns, this.newRunBtn].some((b) => b.contains(x, y));
  }
}
