// Etichette della mappa disegnate nello spazio dello schermo: sempre nitide e di dimensione costante con qualsiasi zoom
// (nomi delle nazioni, numeri del fronte, insegne delle fazioni, scritte che salgono, barra di stato da terminale).
import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { PALETTE, hex } from '../config/palette';
import { FACTION_INFO } from '../game/factions';
import { DPR, view } from '../ui/screen';
import { FONT, textStyle } from '../ui/style';
import { drawSymbol } from '../ui/symbols';

export interface WorldLabel { x: number; y: number; text: string; color: number }
export interface NationLabel { x: number; y: number; name: string; size: number }
export interface FactionTag { x: number; y: number; visible: boolean; scale: number }

/** Quello che la scena della mappa espone alle etichette. */
export interface LabelSource {
  cameras: { main: Phaser.Cameras.Scene2D.Camera };
  nationLabels: NationLabel[];
  frontLabels: WorldLabel[];
  factionTags: FactionTag[];
  worldToLonLat(x: number, y: number): [number, number];
}

export class MapLabels {
  private names: Phaser.GameObjects.Text[] = [];
  private front: Phaser.GameObjects.Text[] = [];
  private tags: Phaser.GameObjects.Container[] = [];
  private status: Phaser.GameObjects.Text;
  private layer: Phaser.GameObjects.Container;

  constructor(private scene: Phaser.Scene) {
    this.layer = scene.add.container(0, 0).setDepth(-10); // sotto i pannelli dell'interfaccia
    this.tags = FACTION_INFO.map((f) => {
      const g = scene.add.graphics();
      drawSymbol(g, f.symbol, 0, -12, 6, f.fill, PALETTE.mappa.fondo);
      const t = scene.add.text(0, 0, f.short, { fontFamily: FONT, fontSize: '12px', color: hex(f.border), resolution: DPR, backgroundColor: '#020409cc', padding: { x: 4, y: 1 } }).setOrigin(0.5, 0);
      const c = scene.add.container(0, 0, [g, t]).setVisible(false);
      this.layer.add(c);
      return c;
    });
    this.status = scene.add.text(0, 0, '', textStyle(10, PALETTE.mappa.segno, false)).setOrigin(0.5, 1).setAlpha(0.85);
    this.layer.add(this.status);
  }

  /** Coordinate mondo → punti CSS dello schermo, senza il ritardo di un fotogramma di worldView. */
  private toScreen(cam: Phaser.Cameras.Scene2D.Camera, x: number, y: number): [number, number] {
    const z = cam.zoom;
    const vx = cam.scrollX + cam.width / 2 - cam.width / (2 * z), vy = cam.scrollY + cam.height / 2 - cam.height / (2 * z);
    return [((x - vx) * z) / DPR, ((y - vy) * z) / DPR];
  }

  update(src: LabelSource) {
    const cam = src.cameras.main;
    const { width, height } = view(this.scene);
    const zoom = cam.zoom / DPR;
    const inView = (sx: number, sy: number, m = 40) => sx > -m && sx < width + m && sy > -m && sy < height + m;

    // nomi delle nazioni: solo da lontano (vista strategica), gialli come sui terminali
    const showNames = zoom < BALANCE.provinces.namesMaxZoom;
    let n = 0;
    if (showNames) {
      for (const l of src.nationLabels) {
        const [sx, sy] = this.toScreen(cam, l.x, l.y);
        if (!inView(sx, sy)) continue;
        let t = this.names[n];
        if (!t) {
          t = this.scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '12px', color: hex(PALETTE.mappa.nome), resolution: DPR }).setOrigin(0.5).setAlpha(0.9);
          this.layer.add(t);
          this.names.push(t);
        }
        const size = Math.round(Phaser.Math.Clamp(l.size * (0.55 + zoom * 0.35), 9, 18));
        if (t.text !== l.name) t.setText(l.name);
        if (t.style.fontSize !== `${size}px`) t.setFontSize(size);
        t.setPosition(Math.round(sx), Math.round(sy)).setVisible(true);
        n++;
      }
    }
    for (let k = n; k < this.names.length; k++) this.names[k].setVisible(false);

    // numeri del fronte (difesa da battere), dentro le celle
    let f = 0;
    for (const l of src.frontLabels) {
      const [sx, sy] = this.toScreen(cam, l.x, l.y);
      if (!inView(sx, sy, 10)) continue;
      let t = this.front[f];
      if (!t) {
        t = this.scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '11px', color: '#ffffff', resolution: DPR }).setOrigin(0.5);
        this.layer.add(t);
        this.front.push(t);
      }
      if (t.text !== l.text) t.setText(l.text);
      t.setColor(hex(l.color)).setPosition(Math.round(sx), Math.round(sy)).setVisible(true);
      f++;
    }
    for (let k = f; k < this.front.length; k++) this.front[k].setVisible(false);

    // insegne delle fazioni nel cuore del loro territorio
    src.factionTags.forEach((tag, k) => {
      const c = this.tags[k];
      if (!c) return;
      if (!tag.visible) return void c.setVisible(false);
      const [sx, sy] = this.toScreen(cam, tag.x, tag.y);
      c.setPosition(Math.round(sx), Math.round(sy)).setScale(Phaser.Math.Clamp(tag.scale, 0.9, 1.6)).setVisible(inView(sx, sy));
    });

    // barra di stato da terminale: centro della vista e zoom
    const [lon, lat] = src.worldToLonLat(cam.scrollX + cam.width / 2, cam.scrollY + cam.height / 2);
    this.status.setText(`CENTRO ${lat.toFixed(2)}, ${lon.toFixed(2)}   ZOOM ${zoom.toFixed(2)}`).setPosition(width / 2, height - 4).setVisible(width >= 760);
  }

  /** Scritta che sale da un punto della mappa (bottino, costi, ordini). */
  float(src: LabelSource, x: number, y: number, msg: string, color: number, delay = 0) {
    const [sx, sy] = this.toScreen(src.cameras.main, x, y);
    const t = this.scene.add.text(Math.round(sx), Math.round(sy), msg, { fontFamily: FONT, fontSize: '12px', color: hex(color), resolution: DPR }).setOrigin(0.5).setAlpha(0);
    this.layer.add(t);
    this.scene.tweens.add({ targets: t, y: sy - 22, alpha: { from: 1, to: 0 }, delay, duration: 900, ease: 'Quad.easeOut', onComplete: () => t.destroy() });
  }
}
