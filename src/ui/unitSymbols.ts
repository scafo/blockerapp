// Pedine sulla mappa in stile sala radar: simboli militari essenziali (rettangolo = tue, rombo = nemiche, cerchio = navi),
// disegnati in punti d'interfaccia e mostrati a grandezza costante sullo schermo. Forma + colore: leggibili anche per i daltonici.
import Phaser from 'phaser';
import type { UnitType } from '../config/balance';
import { PALETTE } from '../config/palette';

const INK = 0x0b1118;

/** Simbolo della pedina centrato in (0,0): cornice, segno della specialità, alone tenue. */
export function drawUnitSymbol(g: Phaser.GameObjects.Graphics, type: UnitType, friendly: boolean, color: number) {
  const naval = type === 'cannoniera';
  // alone radar
  g.fillStyle(color, 0.16).fillCircle(0, 0, 17);
  g.lineStyle(1.6, color, 1).fillStyle(INK, 0.88);
  // cornice: rettangolo (tue), rombo (nemiche), cerchio (navi)
  let hw = 12, hh = 8; // area utile del segno
  if (naval) {
    g.fillCircle(0, 0, 11).strokeCircle(0, 0, 11);
    hw = 7; hh = 6;
  } else if (friendly) {
    g.fillRect(-13, -9, 26, 18).strokeRect(-13, -9, 26, 18);
  } else {
    const pts = [{ x: 0, y: -14 }, { x: 14, y: 0 }, { x: 0, y: 14 }, { x: -14, y: 0 }];
    g.fillPoints(pts, true).strokePoints(pts, true, true);
    hw = 7; hh = 7;
  }
  g.lineStyle(1.5, color, 1).fillStyle(color, 1);
  const X = () => g.lineBetween(-hw, -hh, hw, hh).lineBetween(-hw, hh, hw, -hh);
  switch (type) {
    case 'fanteria':
      X();
      break;
    case 'legionari': // fanteria pesante: croce + barra
      X();
      g.fillRect(-hw, -hh - 0.5, hw * 2, 2.5);
      break;
    case 'guardia': // fanteria della Republica: croce + anello
      X();
      g.fillStyle(INK, 1).fillCircle(0, 0, 3.4).lineStyle(1.4, color, 1).strokeCircle(0, 0, 3.4);
      break;
    case 'ricognitori':
      g.lineBetween(-hw, hh, hw, -hh);
      break;
    case 'infiltrati': // ricognitori tratteggiati
      g.lineBetween(-hw, hh, -hw * 0.25, hh * 0.25).lineBetween(hw * 0.25, -hh * 0.25, hw, -hh);
      break;
    case 'artiglieria':
      g.fillCircle(0, 0, 3);
      break;
    case 'prototipo':
      g.fillCircle(0, 0, 2.4).strokeCircle(0, 0, 5.2);
      break;
    case 'corazzati':
      g.strokeEllipse(0, 0, hw * 1.3, hh * 0.95);
      break;
    case 'genio': // ponte del genio
      g.lineBetween(-hw * 0.7, -1, hw * 0.7, -1);
      for (const x of [-hw * 0.7, 0, hw * 0.7]) g.lineBetween(x, -1, x, 4);
      break;
    case 'cannoniera':
      g.fillPoints([{ x: -6, y: 0 }, { x: 6, y: 0 }, { x: 4, y: 4 }, { x: -4, y: 4 }], true);
      g.lineBetween(0, 0, 0, -6).lineBetween(-3, -3, 3, -3);
      break;
  }
}

/** Barra della vita sotto la cornice (punti d'interfaccia). */
export function drawUnitHp(g: Phaser.GameObjects.Graphics, pct: number, friendly: boolean) {
  const w = 24, y = friendly ? 12 : 17;
  g.clear().fillStyle(INK, 0.9).fillRect(-w / 2 - 1, y - 1, w + 2, 4.5);
  g.fillStyle(pct > 0.5 ? PALETTE.radioattivo : pct > 0.25 ? PALETTE.allerta : PALETTE.ko, 1).fillRect(-w / 2, y, w * Phaser.Math.Clamp(pct, 0, 1), 2.5);
}
