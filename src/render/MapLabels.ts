// Etichette della mappa disegnate nello spazio dello schermo: sempre nitide e di dimensione costante con qualsiasi zoom
// (nomi delle nazioni, numeri del fronte, insegne delle fazioni, scritte che salgono, barra di stato da terminale).
import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { PALETTE, hex } from '../config/palette';
import { FACTION_INFO } from '../game/factions';
import { UI, view } from '../ui/screen';
import { FONT, FONT_TITLE, textStyle } from '../ui/style';
import { drawSymbol } from '../ui/symbols';

export interface WorldLabel { x: number; y: number; text: string; color: number }
export interface NationLabel { x: number; y: number; name: string; size: number; width: number; tile: number; known?: boolean }
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
      const g = scene.add.graphics(), bot = f.kind === 'bot';
      drawSymbol(g, f.symbol, 0, bot ? -10 : -12, bot ? 4.5 : 6, f.fill, PALETTE.mappa.fondo);
      const t = scene.add.text(0, 0, f.short, { fontFamily: FONT, fontSize: bot ? '11px' : '13px', fontStyle: 'bold', color: hex(f.border), resolution: UI(), backgroundColor: '#0b1118dd', padding: { x: 4, y: 2 } }).setOrigin(0.5, 0);
      const c = scene.add.container(0, 0, [g, t]).setVisible(false);
      this.layer.add(c);
      return c;
    });
    this.status = scene.add.text(0, 0, '', textStyle(11, PALETTE.tenue, false)).setOrigin(0.5, 1);
    this.layer.add(this.status);
  }

  /** Coordinate mondo → punti CSS dello schermo, senza il ritardo di un fotogramma di worldView. */
  private toScreen(cam: Phaser.Cameras.Scene2D.Camera, x: number, y: number): [number, number] {
    const z = cam.zoom;
    const vx = cam.scrollX + cam.width / 2 - cam.width / (2 * z), vy = cam.scrollY + cam.height / 2 - cam.height / (2 * z);
    return [((x - vx) * z) / UI(), ((y - vy) * z) / UI()];
  }

  update(src: LabelSource) {
    const cam = src.cameras.main;
    const { width, height } = view(this.scene);
    const zoom = cam.zoom / UI();
    const inView = (sx: number, sy: number, m = 40) => sx > -m && sx < width + m && sy > -m && sy < height + m;

    // nomi delle nazioni: solo da lontano (vista strategica), spaziati come sulle carte di stato maggiore
    const showNames = zoom < BALANCE.provinces.namesMaxZoom;
    let n = 0;
    if (showNames) {
      const placed: number[][] = []; // riquadri già occupati (dai paesi più grandi): niente nomi sovrapposti
      for (const l of src.nationLabels) {
        const [sx, sy] = this.toScreen(cam, l.x, l.y);
        if (!inView(sx, sy)) continue;
        // corpo del nome in proporzione alla larghezza del paese sullo schermo; troppo piccolo = niente nome
        const screenW = (l.width * cam.zoom) / UI(), chars = l.name.length;
        const size = Math.floor(Phaser.Math.Clamp(((0.75 * screenW) / chars - 2) / 0.62, 0, 13));
        if (size < 9) continue;
        const tw = chars * (0.62 * size + 2), bx = [sx - tw / 2 - 4, sy - size / 2 - 3, sx + tw / 2 + 4, sy + size / 2 + 3];
        if (placed.some((q) => bx[0] < q[2] && bx[2] > q[0] && bx[1] < q[3] && bx[3] > q[1])) continue;
        placed.push(bx);
        let t = this.names[n];
        if (!t) {
          t = this.scene.add.text(0, 0, '', {
            fontFamily: FONT_TITLE, fontSize: '13px', fontStyle: '600', color: hex(PALETTE.mappa.nome), resolution: UI(),
            stroke: hex(PALETTE.inchiostro), strokeThickness: 2,
          }).setOrigin(0.5).setLetterSpacing(2).setAlpha(0.8);
          this.layer.add(t);
          this.names.push(t);
        }
        if (t.text !== l.name) t.setText(l.name);
        if (t.style.fontSize !== `${size}px`) t.setFontSize(size);
        t.setPosition(Math.round(sx), Math.round(sy)).setVisible(true).setAlpha(l.known === false ? 0.2 : 0.7); // sotto la nebbia appena accennati
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
        t = this.scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: '#ffffff', resolution: UI(), stroke: '#020409', strokeThickness: 3 }).setOrigin(0.5);
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
      if (!tag.visible || (FACTION_INFO[k]?.kind === 'bot' && zoom < 3)) return void c.setVisible(false); // milizie: solo da vicino
      const [sx, sy] = this.toScreen(cam, tag.x, tag.y), far = Phaser.Math.Clamp(zoom / 4, 0.6, 1);
      c.setPosition(Math.round(sx), Math.round(sy)).setScale(Phaser.Math.Clamp(tag.scale, 0.9, 1.6) * far).setVisible(inView(sx, sy));
    });

    // barra di stato da terminale: centro della vista e zoom
    const [lon, lat] = src.worldToLonLat(cam.scrollX + cam.width / 2, cam.scrollY + cam.height / 2);
    this.status.setText(`CENTRO ${lat.toFixed(2)}, ${lon.toFixed(2)}   ZOOM ${zoom.toFixed(2)}`).setPosition(width / 2, height - 4).setVisible(width >= 1100);
  }

  /** Insegna di fazione sotto il punto (punti CSS dello schermo), −1 se nessuna. */
  tagAt(x: number, y: number): number {
    for (let k = this.tags.length - 1; k >= 0; k--) {
      const c = this.tags[k];
      if (!c.visible) continue;
      const t = c.list[1] as Phaser.GameObjects.Text, s = c.scaleX;
      const w = (t.width / 2 + 6) * s, top = c.y - 20 * s, bottom = c.y + (t.height + 4) * s;
      if (x >= c.x - w && x <= c.x + w && y >= top && y <= bottom) return k;
    }
    return -1;
  }

  /** Scritta che sale da un punto della mappa (bottino, costi, ordini). */
  float(src: LabelSource, x: number, y: number, msg: string, color: number, delay = 0) {
    const [sx, sy] = this.toScreen(src.cameras.main, x, y);
    const t = this.scene.add.text(Math.round(sx), Math.round(sy), msg, { fontFamily: FONT, fontSize: '14px', fontStyle: 'bold', color: hex(color), resolution: UI(), stroke: '#020409', strokeThickness: 4 }).setOrigin(0.5).setAlpha(0);
    this.layer.add(t);
    this.scene.tweens.add({ targets: t, y: sy - 22, alpha: { from: 1, to: 0 }, delay, duration: 900, ease: 'Quad.easeOut', onComplete: () => t.destroy() });
  }
}
