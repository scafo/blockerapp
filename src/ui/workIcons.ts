// Costruzioni nelle province: nomi e icone semplici (fabbrica, bunker, caserma).
import type Phaser from 'phaser';
import { BALANCE, type WorkId } from '../config/balance';

export const WORK_NAME: Record<WorkId, string> = {
  fabbrica: 'Fabbrica', bunker: 'Bunker', caserma: 'Caserma', ospedale: 'Ospedale', radar: 'Radar', porto: 'Porto', aeroporto: 'Aeroporto',
  rifornimenti: 'Deposito rifornimenti', ferrovia: 'Ferrovia', contraerea: 'Contraerea', raffineria: 'Raffineria',
};
export const WORK_DESC: Record<WorkId, string> = {
  fabbrica: `+${BALANCE.works.fabbrica.prodAdd} risorse/min`,
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
};

/** Effetto della costruzione col nome della risorsa della provincia (fabbrica: "+1 metallo/min"). */
export const workDesc = (w: WorkId, res: string) => (w === 'fabbrica' ? `+${BALANCE.works.fabbrica.prodAdd} ${res}/min` : WORK_DESC[w]);

export function drawWorkIcon(g: Phaser.GameObjects.Graphics, w: WorkId, x: number, y: number, r: number, color: number) {
  g.fillStyle(color, 1);
  if (w === 'fabbrica') {
    // capannone a denti di sega con ciminiera
    g.fillPoints([
      { x: x - r, y: y + r * 0.8 }, { x: x - r, y: y - r * 0.1 }, { x: x - r * 0.4, y: y - r * 0.5 }, { x: x - r * 0.4, y: y - r * 0.1 },
      { x: x + r * 0.2, y: y - r * 0.5 }, { x: x + r * 0.2, y: y - r * 0.1 }, { x: x + r * 0.45, y: y - r * 0.1 }, { x: x + r * 0.45, y: y - r },
      { x: x + r, y: y - r }, { x: x + r, y: y + r * 0.8 },
    ], true);
  } else if (w === 'bunker') {
    // scudo
    g.fillPoints([{ x: x - r, y: y - r * 0.8 }, { x: x + r, y: y - r * 0.8 }, { x: x + r * 0.85, y: y + r * 0.2 }, { x, y: y + r }, { x: x - r * 0.85, y: y + r * 0.2 }], true);
  } else if (w === 'ospedale') {
    // croce
    g.fillRect(x - r * 0.3, y - r, r * 0.6, r * 2).fillRect(x - r, y - r * 0.3, r * 2, r * 0.6);
  } else if (w === 'radar') {
    // antenna con onde
    g.fillRect(x - r * 0.12, y - r * 0.2, r * 0.24, r).fillTriangle(x - r * 0.6, y + r * 0.8, x + r * 0.6, y + r * 0.8, x, y + r * 0.35);
    g.lineStyle(Math.max(1, r * 0.18), color, 1).beginPath().arc(x, y - r * 0.2, r * 0.55, -2.6, -0.55).strokePath();
    g.beginPath().arc(x, y - r * 0.2, r * 0.95, -2.5, -0.65).strokePath();
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
  } else {
    // tenda con bandiera
    g.fillTriangle(x - r, y + r * 0.8, x + r, y + r * 0.8, x, y - r * 0.3);
    g.fillRect(x - r * 0.06, y - r, r * 0.12, r * 0.8).fillTriangle(x, y - r, x + r * 0.6, y - r * 0.8, x, y - r * 0.6);
  }
}
