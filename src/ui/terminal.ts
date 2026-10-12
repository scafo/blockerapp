// Interfaccia della campagna nello stile della carta da terminale (MapSCII): fondo nero, filo grigio chiaro, font
// monospazio del terminale, etichette nel blu del mare, valori in bianco, evidenze in giallo come i nomi delle nazioni.
import Phaser from 'phaser';
import { PALETTE, hex } from '../config/palette';
import { TERM_FONT } from '../render/TerminalMap';
import { UI } from './screen';

export const TCOL = {
  bg: 0x000000, // fondo dei riquadri (come la terra della carta)
  hover: 0x16181c,
  edge: 0xd8dadc, // filo dei riquadri (come i confini)
  label: 0x98a1d6, // etichette (blu dei puntini del mare)
  text: 0xf2f2f2, // valori (bianco della barra di stato)
  accent: 0xe1e496, // evidenze (giallo dei nomi delle nazioni)
  alert: 0xe0473a, // allarmi (rosso delle città, più acceso)
  ok: 0x9fe0a8,
};

/** Converte i colori della pianta (casa) nei colori del terminale, così i testi esistenti cambiano tono da soli. */
export function tc(color: number): number {
  switch (color) {
    case PALETTE.carta: return TCOL.text;
    case PALETTE.ocra: return TCOL.label;
    case PALETTE.tenue: return 0x8a9096;
    case PALETTE.ko: return TCOL.alert;
    case PALETTE.allerta: return TCOL.accent;
    case PALETTE.radioattivo: return TCOL.ok;
    default: return color;
  }
}

/** Testo del terminale: monospazio, mai sotto 11 punti. */
export const termStyle = (size: number, color: number = TCOL.text, _bold = true): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: TERM_FONT, fontSize: `${Math.round(Math.max(11, size * 1.05))}px`, color: hex(tc(color)), resolution: UI(),
});

/** Etichetta (al posto del corsivo della pianta): blu del mare. */
export const termLabel = (size: number, color: number = TCOL.label) => termStyle(size, color);

/** Etichetta incastrata nel bordo superiore di un riquadro, con il fondo nero che interrompe il filo. */
export function termNotch(scene: Phaser.Scene, x: number, y: number, label: string, color: number = TCOL.label) {
  return scene.add.text(x + 8, y, ` ${label.toLowerCase()} `, termStyle(11, color)).setOrigin(0, 0.5).setBackgroundColor('#000000');
}

/** Riquadro del terminale. */
export function termBox(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, alpha = 0.92) {
  return g.fillStyle(TCOL.bg, alpha).fillRect(x, y, w, h).lineStyle(1, TCOL.edge, 0.75).strokeRect(x, y, w, h);
}

/** Bigliettino di comunicazione in stile terminale (allarme rosso, avviso giallo, comunicazione blu). */
export function termNote(scene: Phaser.Scene, x: number, y: number, w: number, msg: string, color: number, ox = 0.5) {
  const alarm = color === PALETTE.ko, warn = color === PALETTE.allerta;
  const label = alarm ? 'allarme' : warn ? 'avviso' : 'comunicazione';
  const lc = alarm ? TCOL.alert : warn ? TCOL.accent : TCOL.label;
  const t = scene.add.text(12, 14, msg, termStyle(13, alarm || warn ? TCOL.text : color)).setWordWrapWidth(w - 24).setLineSpacing(2);
  const h = t.height + 26;
  const g = scene.add.graphics();
  termBox(g, 0, 0, w, h, 0.95);
  g.fillStyle(lc, 1).fillRect(0, 0, 3, h);
  const c = scene.add.container(x - w * ox, y, [g, t, termNotch(scene, 0, 0, label, lc)]);
  c.setSize(w, h);
  return c;
}
