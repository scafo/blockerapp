// Prima run guidata: una meccanica alla volta, frecce e anelli, testi di poche parole.
import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { PALETTE } from '../config/palette';
import { PLAYER, type RunState } from '../game/RunState';
import { hexDistance } from '../map/hexGrid';
import { textStyle } from './style';
import { analytics } from '../analytics/analytics';

export type GuideSignal = 'conquer' | 'flow' | 'paint' | 'deploy' | 'order';
type Step = 'tap' | 'troops' | 'flow' | 'paint' | 'unit' | 'order' | 'goal';

export interface GuideApi {
  state: () => RunState;
  tileToScreen: (i: number) => { x: number; y: number };
  selectedCard: () => string | null;
  selectedUnit: () => number | null;
  cardPos: () => { x: number; y: number } | null;
  troopsPos: { x: number; y: number };
  labelPos: () => { x: number; y: number }; // in alto al centro, tra i pannelli
  blocked: (x: number, y: number) => boolean; // punto coperto dall'HUD
}

export class TutorialGuide {
  private step: Step = 'tap';
  private stepAt = 0;
  private arrow: Phaser.GameObjects.Container;
  private ring: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private flowTarget = -1;

  constructor(private scene: Phaser.Scene, private api: GuideApi) {
    const g = scene.add.graphics();
    g.fillStyle(PALETTE.ocra, 1).fillTriangle(-11, -16, 11, -16, 0, 0).lineStyle(2, PALETTE.inchiostro, 1).strokeTriangle(-11, -16, 11, -16, 0, 0);
    const bob = scene.add.container(0, 0, [g]);
    scene.tweens.add({ targets: g, y: -8, duration: 380, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.arrow = scene.add.container(0, 0, [bob]).setDepth(45);
    this.ring = scene.add.graphics().setDepth(44);
    this.ring.lineStyle(3, PALETTE.ocra, 1).strokeCircle(0, 0, 18);
    scene.tweens.add({ targets: this.ring, scale: { from: 0.8, to: 1.3 }, alpha: { from: 1, to: 0.3 }, duration: 600, yoyo: true, repeat: -1 });
    this.label = scene.add.text(0, 0, '', textStyle(15, PALETTE.carta)).setOrigin(0.5, 0).setDepth(45)
      .setBackgroundColor('#2b2118').setPadding(10, 6, 10, 6).setAlign('center');
  }

  signal(kind: GuideSignal) {
    const next: Partial<Record<Step, GuideSignal>> = { tap: 'conquer', flow: 'flow', paint: 'paint', unit: 'deploy', order: 'order' };
    if (next[this.step] !== kind) return;
    const order: Step[] = ['tap', 'troops', 'flow', 'paint', 'unit', 'order', 'goal'];
    this.go(order[order.indexOf(this.step) + 1]);
  }

  private go(step: Step) {
    analytics.design(['tutorial', step]); // dove si fermano i nuovi giocatori
    this.step = step;
    this.stepAt = this.scene.time.now;
    this.flowTarget = -1;
  }

  update() {
    const st = this.api.state();
    const age = this.scene.time.now - this.stepAt;
    if (this.step === 'troops' && age > 3200) this.go('flow');
    if (this.step === 'paint' && age > 9000) this.go('unit');

    switch (this.step) {
      case 'tap': {
        const front = st.frontier(PLAYER).filter((i) => st.troops > st.defenseOf(i));
        const i = front.sort((a, b) => st.defenseOf(a) - st.defenseOf(b))[0];
        return i === undefined ? this.show(null, 'ASPETTA LE TRUPPE') : this.show(this.api.tileToScreen(i), 'TOCCA');
      }
      case 'troops':
        return this.show({ x: this.api.troopsPos.x, y: this.api.troopsPos.y }, 'LE TRUPPE CRESCONO\nCOL TERRITORIO', true);
      case 'flow': {
        if (this.flowTarget < 0 || st.owner[this.flowTarget] === PLAYER) this.flowTarget = this.pickFar(st);
        return this.show(this.flowTarget >= 0 ? this.api.tileToScreen(this.flowTarget) : null, 'TOCCA LONTANO:\nIL CONFINE AVANZA DA SOLO');
      }
      case 'paint': {
        const front = st.frontier(PLAYER);
        return this.show(front.length ? this.api.tileToScreen(front[0]) : null, 'OPPURE TRASCINA\nDAL TUO TERRITORIO');
      }
      case 'unit': {
        const cost = BALANCE.units.fanteria.cost;
        if (st.troops < cost && !this.api.selectedCard()) return this.show(null, `ACCUMULA ${cost} TRUPPE`);
        if (!this.api.selectedCard()) return this.show(this.api.cardPos(), 'SCHIERA UNA PEDINA');
        const own = this.ownBorder(st);
        return this.show(own >= 0 ? this.api.tileToScreen(own) : null, 'TOCCA UN TUO TERRITORIO');
      }
      case 'order': {
        const u = st.unitsOf(PLAYER)[0];
        if (!u) return this.go('goal');
        if (this.api.selectedUnit() === null) return this.show(this.api.tileToScreen(u.tile), 'TOCCA LA PEDINA');
        if (this.flowTarget < 0 || st.owner[this.flowTarget] === PLAYER) this.flowTarget = this.pickFar(st);
        return this.show(this.flowTarget >= 0 ? this.api.tileToScreen(this.flowTarget) : null, 'POI TOCCA LA META');
      }
      case 'goal':
        return this.show(null, `OBIETTIVO: ${BALANCE.tutorial.goalTiles} CASELLE · ${st.tilesOwned}/${BALANCE.tutorial.goalTiles}`);
    }
  }

  /** Casella neutra lontana qualche passo dal confine, visibile a schermo. */
  private pickFar(st: RunState): number {
    const front = st.frontier(PLAYER);
    const { width, height } = this.scene.scale;
    let best = -1, bestScore = Infinity;
    for (let i = 0; i < st.owner.length; i++) {
      if (st.owner[i] !== -1 || !st.passable(i)) continue;
      const p = this.api.tileToScreen(i);
      if (p.x < 40 || p.x > width - 40 || p.y < 40 || p.y > height - 40 || this.api.blocked(p.x, p.y)) continue;
      let d = Infinity;
      for (const f of front) d = Math.min(d, hexDistance(f, i));
      const score = Math.abs(d - 5);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  private ownBorder(st: RunState): number {
    for (let i = 0; i < st.owner.length; i++) {
      if (st.owner[i] !== PLAYER || st.unitAt(i)) continue;
      const p = this.api.tileToScreen(i);
      if (!this.api.blocked(p.x, p.y)) return i;
    }
    return -1;
  }

  /** Etichetta fissa in alto al centro; freccia sopra il punto (o a destra, per l'HUD) e anello sul punto. */
  private show(p: { x: number; y: number } | null, text: string, side = false) {
    const lp = this.api.labelPos();
    this.label.setText(text).setPosition(lp.x, lp.y);
    if (!p) {
      this.arrow.setVisible(false);
      this.ring.setVisible(false);
      return;
    }
    this.arrow.setVisible(true).setPosition(side ? p.x + 34 : p.x, side ? p.y : p.y - 16).setAngle(side ? 90 : 0);
    this.ring.setVisible(!side).setPosition(p.x, p.y);
  }

  destroy() {
    this.arrow.destroy();
    this.ring.destroy();
    this.label.destroy();
  }
}
