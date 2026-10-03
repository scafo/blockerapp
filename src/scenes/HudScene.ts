// Interfaccia sopra la mappa: dati in alto a sinistra, comandi negli angoli in basso, stendardo della provincia.
import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { FACTIONS, PLAYER, THEME } from '../config/theme';
import type { Province } from '../map/world';
import { Button } from '../ui/Button';
import { fpsEnabled } from '../ui/debug';
import { uiCamera, view } from '../ui/screen';
import { panel, textStyle, titleStyle } from '../ui/style';
import type { MapScene } from './MapScene';

export class HudScene extends Phaser.Scene {
  private map!: MapScene;
  private box!: Phaser.GameObjects.Graphics;
  private troops!: Phaser.GameObjects.Text;
  private rate!: Phaser.GameObjects.Text;
  private stats!: Phaser.GameObjects.Text;
  private info!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private attackLabel!: Phaser.GameObjects.Text;
  private ratioBtns: Button[] = [];
  private terrainBtn!: Button;
  private banner?: Phaser.GameObjects.Container;
  private fps = fpsEnabled();

  constructor() {
    super('hud');
  }

  create() {
    uiCamera(this);
    this.map = this.registry.get('map') as MapScene;
    const f = FACTIONS[PLAYER];
    this.box = this.add.graphics();
    this.add.text(22, 18, `${f.symbol} ${f.name.toUpperCase()}`, textStyle(10, f.fill));
    this.add.text(22, 32, 'TRUPPE', textStyle(10, THEME.testoDebole));
    this.troops = this.add.text(22, 44, '0', titleStyle(26, THEME.testo));
    this.rate = this.add.text(0, 54, '', textStyle(11, THEME.attivo));
    this.stats = this.add.text(22, 76, '', textStyle(11, THEME.testo, false));
    this.info = this.add.text(0, 0, '', textStyle(10, THEME.testoDebole, false)).setOrigin(1, 0);
    this.hint = this.add.text(0, 0, 'TOCCA VICINO AL CONFINE PER AVANZARE', textStyle(11, THEME.attivo)).setOrigin(0.5, 1);
    this.tweens.add({ targets: this.hint, alpha: { from: 1, to: 0.35 }, duration: 900, yoyo: true, repeat: -1 });

    this.attackLabel = this.add.text(0, 0, 'ATTACCO', textStyle(10, THEME.testoDebole));
    const ratios = BALANCE.wave.ratios;
    this.ratioBtns = ratios.map((r, k) => new Button(this, `${Math.round(r * 100)}%`, 50, 34, () => this.setRatio(k)));
    this.setRatio(BALANCE.wave.defaultRatio);
    this.terrainBtn = new Button(this, 'TERRENO', 92, 34, () => {
      const on = !this.terrainBtn.isOn;
      this.terrainBtn.setOn(on);
      this.map.setTerrainMode(on);
    });

    this.layout();
    this.scale.on('resize', () => this.layout());
    this.game.events.on('provinceCaptured', this.showBanner, this);
    this.events.once('shutdown', () => this.game.events.off('provinceCaptured', this.showBanner, this));
  }

  private setRatio(k: number) {
    this.ratioBtns.forEach((b, j) => b.setOn(j === k));
    this.map.setRatio(BALANCE.wave.ratios[k]);
  }

  private layout() {
    uiCamera(this);
    const { width, height } = view(this);
    this.box.clear();
    panel(this.box, 12, 12, 196, 82, 8);
    this.info.setPosition(width - 12, 12);
    this.hint.setPosition(width / 2, height - 16);
    const by = height - 12 - 34;
    this.attackLabel.setPosition(12, by - 15);
    this.ratioBtns.forEach((b, k) => b.setPosition(12 + k * 56, by));
    this.terrainBtn.setPosition(width - 12 - 92, by);
  }

  private showBanner(p: Province) {
    const { width } = view(this);
    this.banner?.destroy();
    const w = Math.min(320, width - 40), h = 70;
    const g = panel(this.add.graphics(), -w / 2, 0, w, h, 10, THEME.attivo);
    const c = this.add.container(width / 2, -h - 10, [
      g,
      this.add.text(0, 8, 'PROVINCIA CONQUISTATA', textStyle(10, THEME.attivo)).setOrigin(0.5, 0),
      this.add.text(0, 21, p.name.toUpperCase(), titleStyle(24, THEME.testo)).setOrigin(0.5, 0),
      this.add.text(0, 50, `VALORE ${p.value}${p.loot ? `  ·  BOTTINO +${p.loot}` : ''}`, textStyle(11, THEME.allerta)).setOrigin(0.5, 0),
    ]);
    this.banner = c;
    // lo stendardo cade dall'alto, resta, poi risale
    this.tweens.add({ targets: c, y: 12, duration: 380, ease: 'Back.easeOut' });
    this.tweens.add({ targets: c, y: -h - 10, delay: BALANCE.fx.bannerMs, duration: 300, ease: 'Quad.easeIn', onComplete: () => c.destroy() });
  }

  update() {
    const q = this.map.conquest;
    if (!q) return;
    this.troops.setText(Math.floor(q.troops).toLocaleString('it-IT'));
    this.rate.setText(`+${(q.rate * (1000 / BALANCE.troops.tickMs)).toFixed(1)}/s`).setX(this.troops.x + this.troops.width + 8);
    this.stats.setText(`CASELLE ${q.cells}  PROV ${q.provincesOwned}/${this.map.world.provinces.length}\nBOTTINO ${q.loot}  ONDATE ${q.busy}`);
    this.info.setText(`SEED ${this.map.seed}${this.fps ? `\n${Math.round(this.game.loop.actualFps)} FPS` : ''}`);
    if (q.busy && this.hint.visible && q.cells > 40) this.hint.setVisible(false);
  }
}

