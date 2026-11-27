// Etichette della mappa disegnate nello spazio dello schermo: sempre nitide e di dimensione costante con qualsiasi zoom
// (nomi delle nazioni, numeri del fronte, insegne delle fazioni, scritte che salgono, barra di stato da terminale).
import Phaser from 'phaser';
import { PALETTE, hex } from '../config/palette';
import { FACTION_INFO } from '../game/factions';
import { UI, view } from '../ui/screen';
import { FONT_PIXEL } from '../ui/style';

export interface WorldLabel { x: number; y: number; text: string; color: number; icon?: string; dy?: number } // icon: texture accanto al numero; dy: spostamento sullo schermo (punti)
export interface NationLabel { x: number; y: number; name: string; size: number; width: number; tile: number; known?: boolean }
export interface PlaceLabel { x: number; y: number; name: string; kind: 'city' | 'sea' }
export interface FactionTag { x: number; y: number; visible: boolean; scale: number; angle: number; len: number; wid: number; bend?: number } // bend: curva (mondo⁻¹)

/** Quello che la scena della mappa espone alle etichette. */
export interface LabelSource {
  cameras: { main: Phaser.Cameras.Scene2D.Camera };
  nationLabels: NationLabel[];
  placeLabels: PlaceLabel[];
  frontLabels: WorldLabel[];
  factionTags: FactionTag[];
  worldToLonLat(x: number, y: number): [number, number];
  /** vista della carta: in quella del terreno niente nomi */
  mapMode?: string;
  /** COSTRUISCI aperto: niente nomi delle potenze (si sovrapponevano a rese e costruzioni, Nico) */
  buildView?: boolean;
}

export class MapLabels {
  private names: Phaser.GameObjects.Text[] = [];
  private front: Phaser.GameObjects.Text[] = [];
  private frontIcons: Phaser.GameObjects.Image[] = [];
  private tags: Phaser.GameObjects.Container[] = [];
  private status: Phaser.GameObjects.Text;
  private layer: Phaser.GameObjects.Container;

  constructor(private scene: Phaser.Scene) {
    this.layer = scene.add.container(0, 0).setDepth(-10); // sotto i pannelli dell'interfaccia
    // nomi delle potenze dentro il territorio (alla HOI4): lettere spaziate, grandi quanto il territorio, nel colore della potenza
    // una lettera per oggetto: il nome segue la curva del territorio (HOI4), più trasparente (Nico: "un po' meno opacità")
    // le lettere si fanno solo quando il nome si vede e si buttano 10 s dopo che è sparito (Nico, 27 novembre 2026: blocchi
    // di 5 s. Con 180 potenze erano 4000 testi, ognuno col suo canvas, e la pulizia della memoria li scorreva tutti)
    this.tags = FACTION_INFO.map(() => {
      const c = scene.add.container(0, 0).setVisible(false);
      c.setData('fs', 0);
      this.layer.add(c);
      return c;
    });
    this.status = scene.add.text(0, 0, '', { fontFamily: FONT_PIXEL, fontSize: '14px', color: '#f2f2f2', backgroundColor: '#000000', resolution: UI() }).setOrigin(0.5, 1);
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
    const inView = (sx: number, sy: number, m = 40) => sx > -m && sx < width + m && sy > -m && sy < height + m;

    // nomi delle nazioni: solo da lontano (vista strategica), spaziati come sulle carte di stato maggiore
    const noNames = src.mapMode === 'terreno' || !!src.buildView;
    // i nomi di nazioni, città e mari li scrive già la carta da terminale: qui si raddoppiavano, sfasati (Nico)
    const showNames = false;
    let n = 0;
    if (showNames) {
      const placed: number[][] = []; // riquadri già occupati (dai paesi più grandi): niente nomi sovrapposti
      for (const l of src.nationLabels) {
        const [sx, sy] = this.toScreen(cam, l.x, l.y);
        if (!inView(sx, sy)) continue;
        // corpo del nome in proporzione alla larghezza del paese sullo schermo; troppo piccolo = niente nome
        const screenW = (l.width * cam.zoom) / UI(), chars = l.name.length;
        const size = 15; // corpo fisso come nel terminale
        if ((0.9 * screenW) / chars < 9) continue; // il nome non ci sta nel paese
        const tw = chars * 0.6 * size, bx = [sx - tw / 2 - 4, sy - size / 2 - 3, sx + tw / 2 + 4, sy + size / 2 + 3];
        if (placed.some((q) => bx[0] < q[2] && bx[2] > q[0] && bx[1] < q[3] && bx[3] > q[1])) continue;
        placed.push(bx);
        let t = this.names[n];
        if (!t) {
          t = this.scene.add.text(0, 0, '', {
            fontFamily: FONT_PIXEL, fontSize: '15px', fontStyle: '400', color: hex(PALETTE.mappa.nome), resolution: UI(),
            backgroundColor: '#000000', padding: { x: 1, y: 0 },
          }).setOrigin(0.5);
          this.layer.add(t);
          this.names.push(t);
        }
        if (t.text !== l.name) t.setText(l.name);
        if (t.style.fontSize !== `${size}px`) t.setFontSize(size);
        t.setColor('#9fd0f5').setPosition(Math.round(sx), Math.round(sy)).setVisible(true).setAlpha(1);
        n++;
      }
      // città in rosso e mari in grigio, come nel terminale (dopo le nazioni: prendono gli spazi liberi)
      for (const l of src.placeLabels) {
        const [sx, sy] = this.toScreen(cam, l.x, l.y);
        if (!inView(sx, sy)) continue;
        const size = 15, tw = l.name.length * 0.6 * size, pad = 26; // più aria attorno a città e mari: carta meno affollata
        const bx = [sx - tw / 2 - pad, sy - size / 2 - pad, sx + tw / 2 + pad, sy + size / 2 + pad];
        if (placed.some((q) => bx[0] < q[2] && bx[2] > q[0] && bx[1] < q[3] && bx[3] > q[1])) continue;
        placed.push(bx);
        let t = this.names[n];
        if (!t) {
          t = this.scene.add.text(0, 0, '', {
            fontFamily: FONT_PIXEL, fontSize: '15px', fontStyle: '400', color: '#ffffff', resolution: UI(),
            backgroundColor: '#000000', padding: { x: 1, y: 0 },
          }).setOrigin(0.5);
          this.layer.add(t);
          this.names.push(t);
        }
        if (t.text !== l.name) t.setText(l.name);
        t.setColor(l.kind === 'city' ? '#4f8fd6' : '#a5adb1').setPosition(Math.round(sx), Math.round(sy)).setVisible(true).setAlpha(1);
        n++;
      }
    }
    for (let k = n; k < this.names.length; k++) this.names[k].setVisible(false);

    // numeri del fronte (difesa da battere), dentro le celle
    let f = 0;
    for (const l of src.frontLabels) {
      const [sx, sy0] = this.toScreen(cam, l.x, l.y), sy = sy0 + (l.dy ?? 0);
      if (!inView(sx, sy, 10)) continue;
      let t = this.front[f];
      if (!t) {
        t = this.scene.add.text(0, 0, '', { fontFamily: FONT_PIXEL, fontSize: '14px', fontStyle: '400', color: '#f2f2f2', resolution: UI(), stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5);
        this.layer.add(t);
        this.front.push(t);
      }
      if (t.text !== l.text) t.setText(l.text);
      if (t.getData('c') !== l.color) t.setColor(hex(l.color)).setData('c', l.color); // il colore si riscrive solo se cambia
      t.setPosition(Math.round(sx), Math.round(sy)).setVisible(true);
      // icona della risorsa a sinistra del numero (Nico: "+1.8 che cosa?"): icona e numero centrati insieme
      let ic = this.frontIcons[f];
      if (!ic) { ic = this.scene.add.image(0, 0, '__WHITE').setVisible(false); this.layer.add(ic); this.frontIcons[f] = ic; }
      if (l.icon && this.scene.textures.exists(l.icon)) {
        if (ic.texture.key !== l.icon) ic.setTexture(l.icon);
        const S = 14, w = S + 3 + t.width;
        ic.setDisplaySize(S, S).setTint(l.color).setPosition(Math.round(sx - w / 2 + S / 2), Math.round(sy)).setVisible(true);
        t.setX(Math.round(sx - w / 2 + S + 3 + t.width / 2));
      } else ic.setVisible(false);
      f++;
    }
    for (let k = f; k < this.front.length; k++) this.front[k].setVisible(false);
    for (let k = f; k < this.frontIcons.length; k++) this.frontIcons[k]?.setVisible(false);

    // nomi delle potenze nel loro territorio: corpo in proporzione alla lunghezza del territorio sullo schermo
    const now = this.scene.time.now;
    const hide = (c: Phaser.GameObjects.Container) => {
      if (c.visible) c.setVisible(false).setData('hid', now);
      else if (c.list.length && now - (c.getData('hid') ?? now) > 10_000) { c.removeAll(true); c.setData('fs', 0).setData('lk', ''); }
    };
    src.factionTags.forEach((tag, k) => {
      const c = this.tags[k];
      if (!c) return;
      if (!tag.visible || noNames) return void hide(c);
      const [sx, sy] = this.toScreen(cam, tag.x, tag.y), name = FACTION_INFO[k].name.toUpperCase();
      const lenPx = (tag.len * cam.zoom) / UI(), widPx = (tag.wid * cam.zoom) / UI(), chars = Math.max(1, name.length);
      const fs = Math.floor(Math.min(64, (lenPx * 0.78) / (chars * 0.6 + (chars - 1) * 0.35), widPx * 0.55));
      if (fs < 11 || !inView(sx, sy, 200)) return void hide(c); // territorio troppo piccolo per scriverci il nome
      if (!c.list.length) {
        const m = this.fsMetrics.get(fs);
        c.add([...name].map((ch) => this.scene.add.text(0, 0, ch, { fontFamily: FONT_PIXEL, fontSize: `${fs}px`, fontStyle: '400', color: hex(FACTION_INFO[k].border), resolution: UI(),
          stroke: '#000000', strokeThickness: 3, ...(m ? { metrics: m } : {}) }).setOrigin(0.5).setAlpha(0.6)));
        if (!m) this.fsMetrics.set(fs, (c.list[0] as Phaser.GameObjects.Text).style.getTextMetrics());
        c.setData('fs', fs).setData('lk', '');
      }
      const letters = c.list as Phaser.GameObjects.Text[];
      if (c.getData('fs') !== fs) { c.setData('fs', fs); for (const t of letters) this.letterSize(t, fs); }
      // lettere lungo la parabola: y = kb·x², ognuna girata come la tangente. Si rifà solo se cambiano corpo o curva (prima a
      // ogni fotogramma per ogni lettera di ogni nome: ~2 ms)
      const kb = (tag.bend ?? 0) * UI() / cam.zoom, lk = `${fs}|${kb.toFixed(6)}`;
      if (c.getData('lk') !== lk) {
        c.setData('lk', lk);
        const gap = fs * 0.35, widths = letters.map((t) => (t.text === ' ' ? fs * 0.5 : t.width)), total = widths.reduce((a, w) => a + w, 0) + gap * (chars - 1);
        let x = -total / 2;
        letters.forEach((t, i) => {
          const cx = x + widths[i] / 2;
          t.setPosition(cx, kb * cx * cx).setRotation(Math.atan(2 * kb * cx));
          x += widths[i] + gap;
        });
        c.setData('w', total).setData('h', fs);
      }
      c.setPosition(Math.round(sx), Math.round(sy)).setRotation(tag.angle).setScale(1).setVisible(true);
    });

    // barra di stato: la disegna la carta da terminale; questa resta nascosta (prima si riscriveva a ogni fotogramma senza
    // vedersi: un canvas ridisegnato per niente)
    if (this.status.visible) this.status.setVisible(false);
  }

  /** Corpo di una lettera dei nomi delle potenze. Le misure del font si prendono una volta per corpo (Nico, 27 novembre
   *  2026: blocchi di secondi zoomando). setFontSize di Phaser le rimisura per ogni lettera leggendo i pixel di un canvas:
   *  migliaia di lettere a ogni scatto di zoom, e la memoria buttata fermava il gioco per pulirla. */
  private fsMetrics = new Map<number, Phaser.Types.GameObjects.Text.TextMetrics>();
  private letterSize(t: Phaser.GameObjects.Text, fs: number) {
    const st = t.style, size = `${fs}px`;
    if (st.fontSize === size) return;
    st.fontSize = size;
    const m = this.fsMetrics.get(fs);
    if (!m) { st.update(true); this.fsMetrics.set(fs, st.getTextMetrics()); return; }
    const raw = st as unknown as { _font: string; metrics: Phaser.Types.GameObjects.Text.TextMetrics };
    raw._font = [st.fontStyle, size, st.fontFamily].join(' ').trim();
    raw.metrics = { ...m };
    st.update(false);
  }

  /** Insegna di fazione sotto il punto (punti CSS dello schermo), −1 se nessuna. */
  tagAt(x: number, y: number): number {
    for (let k = this.tags.length - 1; k >= 0; k--) {
      const c = this.tags[k];
      if (!c.visible) continue;
      const s = c.scaleX, tw = (c.getData('w') as number) ?? 0, th = (c.getData('h') as number) ?? 14;
      const w = (tw / 2 + 6) * s, top = c.y - 20 * s, bottom = c.y + (th + 4) * s;
      if (x >= c.x - w && x <= c.x + w && y >= top && y <= bottom) return k;
    }
    return -1;
  }

  /** Scritta che sale da un punto della mappa (bottino, costi, ordini). */
  float(src: LabelSource, x: number, y: number, msg: string, color: number, delay = 0) {
    const [sx, sy] = this.toScreen(src.cameras.main, x, y);
    // più grande e più lenta di prima: costi, bottino ed errori si leggono anche sopra il territorio colorato
    // cartellino su fondo scuro che compare, resta e si spegne con appena un filo di salita (Nico, 28 novembre 2026: la
    // scritta col bordo nero che volava via sembrava fatta in fretta)
    const t = this.scene.add.text(Math.round(sx), Math.round(sy), msg, { fontFamily: FONT_PIXEL, fontSize: '14px', fontStyle: '400', color: hex(color), resolution: UI(), backgroundColor: 'rgba(6,9,12,0.82)', padding: { x: 6, y: 3 } }).setOrigin(0.5).setAlpha(0);
    this.layer.add(t);
    this.scene.tweens.chain({ targets: t, tweens: [
      { alpha: 1, y: sy - 4, delay, duration: 140, ease: 'Sine.easeOut' },
      { alpha: 0, y: sy - 10, delay: 900, duration: 380, ease: 'Sine.easeIn' },
    ], onComplete: () => t.destroy() });
  }
}
