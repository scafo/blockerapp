// Linguaggio visivo delle schermate fuori dalla mappa, derivato dall'intro e dalle Squadre di Estrazione del Figma di Nico:
// foto drammatica fredda a tutto schermo, titolo grande bianco in alto a sinistra, Back in alto a destra, righe di vetro ardesia
// con testo spaziato (nome a sinistra, valore tenue a destra), azione principale ruggine in basso a destra.
// Un solo colore per significato (verde = guadagno, rosso = perdita, ruggine = azione principale).
// Gerarchia del testo (Nico: "font con poche gerarchie"): titolo dello schermo (value 28–56) → intestazione (heading 15, bianca)
// → testo (body 13) → didascalia (label 9–10, grigia). Le icone (texture `ic-*` generate con Draw Things) stanno accanto ai numeri
// e ai nomi, mai da sole senza senso; niente puntini, tacche o crocini decorativi.
import Phaser from 'phaser';
import { hex } from '../config/palette';
import { FONT, FONT_TECH, FONT_TITLE, textSize } from './style';
import { UI } from './screen';
import { RESOURCE_INFO } from '../game/resources';
import type { Resource } from '../config/balance';

export const OPS = {
  panel: 0x0a1018, // fondo dei pannelli
  edge: 0x7f8c98, // filo dei pannelli e delle righe
  row: 0x35424e, // vetro delle righe
  cta: 0xe6e9ea, // azione principale: bianco pieno, etichetta scura (prima ruggine; Nico, 23 novembre 2026)
  label: 0x8a949a, // didascalie
  text: 0xe9ebe6, // valori e testo principale
  body: 0xb9c0c2, // testo di lettura
  gain: 0x6fd08a, // guadagni, stati positivi
  loss: 0xe0523f, // perdite, stati negativi
  accent: 0xc8d0d6, // testi e collegamenti da evidenziare: grigio chiaro (prima ruggine chiara, tolta)
};

/** Etichetta: testo spaziato con la prima lettera maiuscola, grigio, nel carattere tecnico. */
export function label(scene: Phaser.Scene, x: number, y: number, text: string, color: number = OPS.label, size = 10) {
  return scene.add.text(x, y, text.charAt(0).toUpperCase() + text.slice(1), {
    fontFamily: FONT_TECH, fontSize: `${textSize(size)}px`, color: hex(color), resolution: UI(),
  }).setLetterSpacing(0.6);
}

/** Valore grande (titoli, numeri). */
export function value(scene: Phaser.Scene, x: number, y: number, text: string, size: number, color: number = OPS.text) {
  return scene.add.text(x, y, text, { fontFamily: FONT_TITLE, fontSize: `${Math.round(size)}px`, fontStyle: '500', color: hex(color), resolution: UI() });
}

/** Scritta tecnica grande (menu, sezioni della barra, numeri delle scorte): Chakra Petch. */
export function tech(scene: Phaser.Scene, x: number, y: number, text: string, size: number, color: number = OPS.text) {
  return scene.add.text(x, y, text, { fontFamily: FONT_TECH, fontSize: `${Math.round(size)}px`, fontStyle: '600', color: hex(color), resolution: UI() });
}

/** Intestazione di sezione o nome di una voce: bianca, media, senza spaziatura. */
export function heading(scene: Phaser.Scene, x: number, y: number, text: string, size = 15, color: number = OPS.text) {
  return value(scene, x, y, text, size, color);
}

/** Icona generata (texture `ic-<nome>`), centrata in (x, y), lato `size`, tinta `color`. */
export function icon(scene: Phaser.Scene, name: string, x: number, y: number, size: number, color = 0xffffff) {
  return scene.add.image(x, y, `ic-${name}`).setDisplaySize(size, size).setTint(color);
}

/** Icone stilizzate delle risorse (Nico: "piccole e semplici; le foto per le schermate grandi"): spiga, ingranaggio, pompa. */
const RES_LINE: Partial<Record<Resource, string>> = { cibo: 'li-wheat', metallo: 'li-cog', benzina: 'li-fuel' };

/** Icona piccola della risorsa: il segno a linea nel colore della risorsa (le truppe restano la loro icona). */
export const resIcon = (scene: Phaser.Scene, r: Resource, x: number, y: number, size: number) => {
  const k = RES_LINE[r];
  return k && scene.textures.exists(k) ? scene.add.image(x, y, k).setDisplaySize(size, size).setTint(RESOURCE_INFO[r].color)
    : icon(scene, `res-${r}`, x, y, size, RESOURCE_INFO[r].color);
};

/** Foto della risorsa scontornata (sacco, ingranaggio, fusto): per premi e schermate grandi. */
export const resPhoto = (scene: Phaser.Scene, r: Resource, x: number, y: number, size: number) =>
  scene.textures.exists(`rp-${r}`) ? scene.add.image(x, y, `rp-${r}`).setDisplaySize(size, size) : resIcon(scene, r, x, y, size);

/** Testo di lettura. */
export function body(scene: Phaser.Scene, x: number, y: number, text: string, size = 13, color: number = OPS.body, wrap = 0) {
  const t = scene.add.text(x, y, text, { fontFamily: FONT, fontSize: `${textSize(size)}px`, color: hex(color), resolution: UI(), lineSpacing: 3 });
  if (wrap) t.setWordWrapWidth(wrap);
  return t;
}

/** Pannello scuro velato con filo sottile. */
export function panel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, alpha = 0.74) {
  g.fillStyle(OPS.panel, alpha).fillRect(x, y, w, h);
  g.lineStyle(1, OPS.edge, 0.3).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/** Riga di vetro: fondo ardesia traslucido e filo sottile, come le missioni dell'Estrazione. */
export function glass(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, on = false) {
  g.fillStyle(OPS.row, on ? 0.92 : 0.62).fillRect(x, y, w, h);
  g.lineStyle(1, on ? 0xffffff : OPS.edge, on ? 0.75 : 0.32).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/** Tasto Back in alto a destra; x è il suo bordo destro. */
export function backBox(scene: Phaser.Scene, x: number, y: number, onClick: () => void, w = 104, h = 36): Phaser.GameObjects.GameObject[] {
  const g = scene.add.graphics();
  glass(g, x - w, y, w, h);
  const t = label(scene, x - w / 2 + 9, y + h / 2, 'Back', OPS.text, 11).setOrigin(0.5);
  const ic = icon(scene, 'ui-indietro', t.x - t.width / 2 - 13, y + h / 2, 13, OPS.text);
  const hit = scene.add.rectangle(x - w, y, w, h, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true }).on('pointerup', onClick);
  return [g, ic, t, hit];
}

/** Riga divisoria interna. */
export function rule(g: Phaser.GameObjects.Graphics, x0: number, x1: number, y: number, alpha = 0.35) {
  g.lineStyle(1, OPS.edge, alpha).lineBetween(x0, Math.round(y) + 0.5, x1, Math.round(y) + 0.5);
}

/** Crocini agli angoli della cornice e trattini a metà dei lati (mirino da sala operativa). */
export function frameMarks(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, len = 16, alpha = 0.5) {
  g.lineStyle(1, OPS.text, alpha);
  for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    g.lineBetween(cx - sx * len * 0.6, cy, cx + sx * len, cy);
    g.lineBetween(cx, cy - sy * len * 0.6, cx, cy + sy * len);
  }
  g.lineBetween(x + w / 2 - 6, y, x + w / 2 + 6, y).lineBetween(x + w / 2 - 6, y + h, x + w / 2 + 6, y + h);
}

/** Puntino di stato (es. ● RITIRATA). */
export function dot(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number, r = 3) {
  g.fillStyle(color, 1).fillRect(x - r, y - r, r * 2, r * 2);
}

/** Etichetta in un riquadro sottile (chip: potenza, fronte, durata). */
export function chip(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics, x: number, y: number, text: string): number {
  const t = label(scene, x + 8, y + 5, text, OPS.text, 9);
  const w = t.width + 16, h = t.height + 10;
  g.lineStyle(1, OPS.edge, 0.7).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  return w;
}
