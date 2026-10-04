// Costruzioni nelle province: nomi e icone semplici (fabbrica, bunker, caserma).
import type Phaser from 'phaser';
import type { WorkId } from '../config/balance';

export const WORK_NAME: Record<WorkId, string> = {
  fabbrica: 'Fabbrica', bunker: 'Bunker', caserma: 'Caserma', ospedale: 'Ospedale', radar: 'Radar', porto: 'Porto', aeroporto: 'Aeroporto',
};
export const WORK_DESC: Record<WorkId, string> = {
  fabbrica: '+1 risorsa/min',
  bunker: 'difesa ×1,7',
  caserma: 'più truppe',
  ospedale: 'cura ×3 qui',
  radar: 'vista +7 caselle',
  porto: 'navi: +50% mare',
  aeroporto: 'abilità −30%',
};

/** Effetto della costruzione col nome della risorsa della provincia (fabbrica: "+1 metallo/min"). */
export const workDesc = (w: WorkId, res: string) => (w === 'fabbrica' ? `+1 ${res}/min` : WORK_DESC[w]);

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
  } else {
    // tenda con bandiera
    g.fillTriangle(x - r, y + r * 0.8, x + r, y + r * 0.8, x, y - r * 0.3);
    g.fillRect(x - r * 0.06, y - r, r * 0.12, r * 0.8).fillTriangle(x, y - r, x + r * 0.6, y - r * 0.8, x, y - r * 0.6);
  }
}
