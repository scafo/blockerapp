// Costruzioni nelle province: nomi e icone semplici (fabbrica, fortificazione, caserma).
import type Phaser from 'phaser';
import { BALANCE, type WorkId } from '../config/balance';

export const WORK_NAME: Record<WorkId, string> = {
  fabbrica: 'Fabbrica', bunker: 'Fortificazione', caserma: 'Caserma', ospedale: 'Ospedale', radar: 'Radar', porto: 'Porto', aeroporto: 'Aeroporto',
  rifornimenti: 'Deposito rifornimenti', ferrovia: 'Ferrovia', contraerea: 'Contraerea', raffineria: 'Raffineria', fattoria: 'Fattoria',
};
export const WORK_DESC: Record<WorkId, string> = {
  fabbrica: `produzione ×${BALANCE.works.fabbrica.prodMult}`,
  bunker: 'difesa ×1,7',
  caserma: 'più truppe',
  ospedale: 'cura ×3 qui',
  radar: 'vista +7 caselle',
  porto: 'navi: +50% mare',
  aeroporto: 'abilità −30%',
  rifornimenti: 'logistica riparte da qui',
  ferrovia: 'pedine ×2 veloci qui e accanto',
  contraerea: 'ferma i bombardamenti',
  raffineria: `+${BALANCE.works.raffineria.prodAdd} benzina/min`,
  fattoria: `+${BALANCE.works.fattoria.prodAdd} cibo/min`,
};

/** Effetto della costruzione col nome della risorsa della provincia (fabbrica: "+1 metallo/min"). */
export const workDesc = (w: WorkId, _res: string) => WORK_DESC[w]; // fabbrica: tutta la produzione della provincia, non una risorsa

export function drawWorkIcon(g: Phaser.GameObjects.Graphics, w: WorkId, x: number, y: number, r: number, color: number, cut = 0x0b0d10) {
  g.fillStyle(color, 1);
  if (w === 'fabbrica') {
    // capannone a denti di sega, ciminiera col fumo e finestre
    g.fillPoints([
      { x: x - r, y: y + r * 0.85 }, { x: x - r, y: y - r * 0.05 }, { x: x - r * 0.45, y: y - r * 0.45 }, { x: x - r * 0.45, y: y - r * 0.05 },
      { x: x + r * 0.1, y: y - r * 0.45 }, { x: x + r * 0.1, y: y - r * 0.05 }, { x: x + r * 0.45, y: y - r * 0.05 }, { x: x + r * 0.45, y: y - r * 0.75 },
      { x: x + r * 0.8, y: y - r * 0.75 }, { x: x + r * 0.8, y: y + r * 0.85 },
    ], true);
    g.fillCircle(x + r * 0.75, y - r * 0.98, r * 0.17).fillCircle(x + r * 0.98, y - r * 1.12, r * 0.13);
    g.fillStyle(cut, 1);
    for (const k of [-0.75, -0.3, 0.15]) g.fillRect(x + r * k, y + r * 0.2, r * 0.26, r * 0.26);
    g.fillRect(x + r * 0.5, y + r * 0.35, r * 0.24, r * 0.5);
  } else if (w === 'bunker') {
    // fortificazione: torre con merli e porta ad arco
    g.fillRect(x - r * 0.85, y - r * 0.45, r * 1.7, r * 1.3);
    for (const k of [-0.85, -0.2, 0.45]) g.fillRect(x + r * k, y - r * 0.85, r * 0.4, r * 0.45);
    g.fillStyle(cut, 1).fillRect(x - r * 0.25, y + r * 0.3, r * 0.5, r * 0.55).fillCircle(x, y + r * 0.3, r * 0.25);
    g.fillRect(x - r * 0.65, y - r * 0.15, r * 0.22, r * 0.3).fillRect(x + r * 0.43, y - r * 0.15, r * 0.22, r * 0.3);
  } else if (w === 'caserma') {
    // caserma: edificio col tetto, porta e bandiera
    g.fillRect(x - r * 0.9, y - r * 0.05, r * 1.5, r * 0.9).fillTriangle(x - r, y - r * 0.05, x + r * 0.7, y - r * 0.05, x - r * 0.15, y - r * 0.6);
    g.fillRect(x + r * 0.78, y - r, r * 0.12, r * 1.85).fillTriangle(x + r * 0.9, y - r, x + r * 0.9, y - r * 0.5, x + r * 1.3, y - r * 0.75);
    g.fillStyle(cut, 1).fillRect(x - r * 0.35, y + r * 0.3, r * 0.4, r * 0.55).fillRect(x - r * 0.75, y + r * 0.15, r * 0.25, r * 0.25).fillRect(x + r * 0.2, y + r * 0.15, r * 0.25, r * 0.25);
  } else if (w === 'radar') {
    // parabola sul traliccio con le onde
    g.fillTriangle(x - r * 0.55, y + r * 0.9, x + r * 0.55, y + r * 0.9, x, y + r * 0.05);
    g.fillStyle(cut, 1).fillTriangle(x - r * 0.22, y + r * 0.9, x + r * 0.22, y + r * 0.9, x, y + r * 0.5);
    g.fillStyle(color, 1).beginPath().arc(x - r * 0.1, y - r * 0.2, r * 0.6, Math.PI * 0.15, Math.PI * 1.15, false).closePath().fillPath();
    g.lineStyle(Math.max(1, r * 0.16), color, 1).beginPath().arc(x - r * 0.1, y - r * 0.2, r * 0.95, -1.35, -0.15).strokePath();
    g.beginPath().arc(x - r * 0.1, y - r * 0.2, r * 1.3, -1.25, -0.25).strokePath();
  } else if (w === 'ospedale') {
    // croce
    g.fillRect(x - r * 0.3, y - r, r * 0.6, r * 2).fillRect(x - r, y - r * 0.3, r * 2, r * 0.6);
  } else if (w === 'porto') {
    // ancora
    g.lineStyle(Math.max(1, r * 0.2), color, 1).lineBetween(x, y - r * 0.7, x, y + r * 0.85).lineBetween(x - r * 0.5, y - r * 0.35, x + r * 0.5, y - r * 0.35);
    g.beginPath().arc(x, y + r * 0.15, r * 0.75, 0.3, Math.PI - 0.3).strokePath();
    g.fillCircle(x, y - r * 0.8, r * 0.2);
  } else if (w === 'aeroporto') {
    // aereo visto dall'alto
    g.fillRect(x - r * 0.12, y - r, r * 0.24, r * 2).fillRect(x - r, y - r * 0.2, r * 2, r * 0.32).fillRect(x - r * 0.45, y + r * 0.65, r * 0.9, r * 0.22);
  } else if (w === 'rifornimenti') {
    // casse impilate
    g.fillRect(x - r, y + r * 0.05, r * 0.92, r * 0.8).fillRect(x + r * 0.08, y + r * 0.05, r * 0.92, r * 0.8).fillRect(x - r * 0.46, y - r * 0.85, r * 0.92, r * 0.8);
    g.lineStyle(Math.max(1, r * 0.12), cut, 1);
    for (const [cx, cy] of [[x - r * 0.54, y + r * 0.45], [x + r * 0.54, y + r * 0.45], [x, y - r * 0.45]]) {
      g.lineBetween(cx - r * 0.34, cy - r * 0.28, cx + r * 0.34, cy + r * 0.28).lineBetween(cx - r * 0.34, cy + r * 0.28, cx + r * 0.34, cy - r * 0.28);
    }
  } else if (w === 'ferrovia') {
    // binari con traversine
    g.fillRect(x - r * 0.6, y - r, r * 0.18, r * 2).fillRect(x + r * 0.42, y - r, r * 0.18, r * 2);
    for (const k of [-0.75, -0.25, 0.25, 0.75]) g.fillRect(x - r, y + r * k - r * 0.08, r * 2, r * 0.16);
  } else if (w === 'contraerea') {
    // cannone puntato in alto su base
    g.fillRect(x - r, y + r * 0.45, r * 2, r * 0.45).fillRect(x - r * 0.45, y + r * 0.05, r * 0.9, r * 0.45);
    g.fillPoints([{ x: x - r * 0.12, y: y + r * 0.1 }, { x: x + r * 0.55, y: y - r }, { x: x + r * 0.8, y: y - r * 0.85 }, { x: x + r * 0.15, y: y + r * 0.2 }], true);
  } else if (w === 'raffineria') {
    // serbatoio e torre
    g.fillRect(x - r, y - r * 0.1, r * 1.1, r * 0.95).fillRect(x + r * 0.35, y - r, r * 0.4, r * 1.85).fillRect(x + r * 0.2, y - r * 0.45, r * 0.8, r * 0.14);
  } else if (w === 'fattoria') {
    // fienile: tetto a punta e porta
    g.fillPoints([{ x: x - r, y: y + r * 0.85 }, { x: x - r, y: y - r * 0.15 }, { x, y: y - r }, { x: x + r, y: y - r * 0.15 }, { x: x + r, y: y + r * 0.85 }], true);
    g.fillStyle(cut, 1).fillRect(x - r * 0.3, y + r * 0.1, r * 0.6, r * 0.75);
  } else {
    // tenda con bandiera
    g.fillTriangle(x - r, y + r * 0.8, x + r, y + r * 0.8, x, y - r * 0.3);
    g.fillRect(x - r * 0.06, y - r, r * 0.12, r * 0.8).fillTriangle(x, y - r, x + r * 0.6, y - r * 0.8, x, y - r * 0.6);
  }
}
