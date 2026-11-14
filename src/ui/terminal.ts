// Interfaccia della campagna (Nico, novembre 2026: "più pulita, più gerarchica"): stesso linguaggio del resto del gioco
// (src/ui/ops.ts) sopra la carta da terminale, che resta com'è: riquadri di vetro scuro con filo sottile, Helvetica, etichette
// grigie piccole, valori bianchi, numeri importanti grandi. I nomi termStyle/termBox restano per non toccare ogni schermata.
import Phaser from 'phaser';
import { PALETTE, hex } from '../config/palette';
import { FONT } from './style';
import { UI } from './screen';

// Sistema dei colori dell'interfaccia (Nico: troppi colori a caso). Ogni colore ha un solo significato:
// bianco = valori · grigio = etichette e testo secondario · verde = va bene / guadagno · ambra = avviso, timer, in corso ·
// rosso = problema, manca qualcosa. Più i colori delle fazioni. Nient'altro.
export const TCOL = {
  bg: 0x0a1018, // fondo dei riquadri (vetro scuro)
  hover: 0x1c252e,
  edge: 0x7f8c98, // filo dei riquadri: grigio, non compete coi valori
  label: 0x8a949a, // etichette
  text: 0xe9ebe6, // valori
  accent: 0xe0b04a, // avvisi, timer, cose in corso
  alert: 0xe0473a, // problemi
  ok: 0x7fd18b, // va bene, guadagni
  dim: 0x5d646b, // spento / non disponibile
};

/** Corpi del testo: solo quattro (piccolo 11, testo 13, titolo 16, numero grande 28). */
export const TSIZE = { small: 11, body: 13, title: 16, hero: 28 } as const;
const snapSize = (size: number) => (size >= 24 ? TSIZE.hero : size >= 15 ? TSIZE.title : size >= 12 ? TSIZE.body : TSIZE.small);

/** Converte i colori della pianta (casa) nei colori del terminale, così i testi esistenti cambiano tono da soli. */
export function tc(color: number): number {
  switch (color) {
    case PALETTE.carta: return TCOL.text;
    case PALETTE.ocra: return TCOL.label; // gli "accenti" verde acqua della pianta qui sono etichette grigie
    case PALETTE.tenue: return TCOL.dim;
    case PALETTE.ko: return TCOL.alert;
    case PALETTE.allerta: return TCOL.accent;
    case PALETTE.radioattivo: return TCOL.ok;
    default: return color;
  }
}

/** Testo dell'interfaccia: un solo font, corpo agganciato ai quattro della scala; titoli e numeri grandi in medio. */
export const termStyle = (size: number, color: number = TCOL.text, _bold = true): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: FONT, fontSize: `${snapSize(size)}px`, fontStyle: snapSize(size) >= TSIZE.title ? '500' : 'normal', color: hex(tc(color)), resolution: UI(),
});

/** Etichetta (al posto del corsivo della pianta): blu del mare. */
export const termLabel = (size: number, color: number = TCOL.label) => termStyle(size, color);

/** Etichetta incastrata nel bordo superiore di un riquadro (prima lettera maiuscola), con il fondo del riquadro che interrompe il filo. */
export function termNotch(scene: Phaser.Scene, x: number, y: number, label: string, color: number = TCOL.label) {
  const t = label.toLowerCase();
  return scene.add.text(x + 8, y, ` ${t.charAt(0).toUpperCase() + t.slice(1)} `, termStyle(11, color)).setOrigin(0, 0.5).setBackgroundColor(hex(TCOL.bg));
}

/** Riquadro del terminale. */
export function termBox(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, alpha = 0.92) {
  return g.fillStyle(TCOL.bg, alpha * 0.9).fillRect(x, y, w, h).lineStyle(1, TCOL.edge, 0.4).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
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
