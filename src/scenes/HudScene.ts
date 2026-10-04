import Phaser from 'phaser';
import { BALANCE, type UnitType } from '../config/balance';
import { PALETTE, hex } from '../config/palette';
import { PLAYER, WORKS, type Outcome, type VictoryReason } from '../game/RunState';
import { techInfo } from '../game/tech';
import { WORK_DESC, WORK_NAME, drawWorkIcon } from '../ui/workIcons';
import { FACTION_INFO } from '../game/factions';
import { RESOURCES, RESOURCE_INFO, bagTotal, type Bag } from '../game/resources';
import type { GameEvent } from '../game/events';
import { EventCard } from '../ui/EventCard';
import { TutorialGuide, type GuideSignal } from '../ui/TutorialGuide';
import { analytics } from '../analytics/analytics';
import { fpsEnabled } from '../ui/debug';
import { savePrefs } from '../save/storage';
import { Button } from '../ui/Button';
import { AbilityCard, CARD_H, CARD_W, UnitCard } from '../ui/UnitCard';
import { MapLabels } from '../render/MapLabels';
import { drawResourceIcon } from '../ui/resourceIcons';
import { textStyle } from '../ui/style';
import { uiCamera, view } from '../ui/screen';
import { drawSymbol } from '../ui/symbols';
import { drawUnitIcon } from '../ui/unitIcons';
import type { RunScene } from './RunScene';

const PAD = 12;
const LEFT_W = 300;
const LEFT_H = 148;
const RIGHT_W = 180;
const BAR_H = 64; // orizzontale: barra in alto (truppe, obiettivi, tempo, bottino)
const ROW_H = 18;
const TOP_H = 112; // verticale: altezza del pannello in alto
const STRIP_H = 46; // verticale: fazioni su due righe

const mmss = (ms: number) => {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

// Orizzontale: mappa libera al centro, info negli angoli in alto, comandi negli angoli in basso.
export class HudScene extends Phaser.Scene {
  private troops!: Phaser.GameObjects.Text;
  private rate!: Phaser.GameObjects.Text;
  private stats!: Phaser.GameObjects.Text;
  private resTexts: Phaser.GameObjects.Text[] = [];
  private resLabel!: Phaser.GameObjects.Text;
  private pauseBtn!: Button;
  /** Pausa strategica: cornice + cartello, la mappa resta comandabile. */
  private pauseUi: Phaser.GameObjects.Container | null = null;
  /** Scheda della provincia toccata (terreno, produzione, costruzioni). */
  private provCard: Phaser.GameObjects.Container | null = null;
  private provCardP = -1;
  private provCardAcc = 0;
  private pauseFrame!: Phaser.GameObjects.Graphics;
  private stormText!: Phaser.GameObjects.Text;
  private incTexts: Phaser.GameObjects.Text[] = [];
  private incAcc = 0;
  private seed!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private leftPanel!: Phaser.GameObjects.Rectangle;
  private rightPanel!: Phaser.GameObjects.Rectangle;
  private symbols!: Phaser.GameObjects.Graphics;
  private rows: Phaser.GameObjects.Text[] = [];
  private aliveKey = '';
  private speedBtn!: Button;
  private retreatBtn!: Button;
  private retreatArmed: Phaser.Time.TimerEvent | null = null;
  private cards: UnitCard[] = [];
  private mapLabels!: MapLabels;
  private abilityCards: AbilityCard[] = [];
  private shownTroops = -1;
  private ended = false;
  private portrait = false;
  private troopsLbl!: Phaser.GameObjects.Text;
  private resIcons!: Phaser.GameObjects.Graphics;
  private symPos: { x: number; y: number }[] = [];
  private unitPos: ({ x: number; y: number } | null)[] = [];
  private topBottom = PAD + LEFT_H; // dove finisce l'HUD in alto
  private nextBannerAt = 0;
  private attackBtn: Button | null = null;
  private workBtn: Button | null = null;
  private eventCard: EventCard | null = null;
  private guide: TutorialGuide | null = null;
  private fps: Phaser.GameObjects.Text | null = null;

  constructor() {
    super('Hud');
  }

  private get run() {
    return this.scene.get('Run') as RunScene;
  }

  create() {
    uiCamera(this);
    // etichette della mappa nitide (spazio schermo)
    this.mapLabels = new MapLabels(this);
    this.shownTroops = -1;
    this.nextBannerAt = 0;
    this.aliveKey = '';
    this.ended = false;
    this.retreatArmed = null;
    this.eventCard = null;

    // pannello sinistro: truppe, territorio/obiettivi, zaino, tempo di campagna
    // (le posizioni le decide layout(): verticale e orizzontale hanno disposizioni diverse)
    this.leftPanel = this.add.rectangle(PAD, PAD, LEFT_W, LEFT_H, PALETTE.inchiostro, 0.84).setOrigin(0).setStrokeStyle(1, PALETTE.linea);
    this.troopsLbl = this.add.text(0, 0, 'TRUPPE', textStyle(11, PALETTE.ocra));
    this.troops = this.add.text(0, 0, '0', textStyle(28, PALETTE.carta));
    this.rate = this.add.text(0, 0, '', textStyle(12, PALETTE.radioattivo));
    this.stats = this.add.text(0, 0, '', textStyle(12, PALETTE.carta));
    this.resIcons = this.add.graphics();
    // bottino: icone e numeri grandi, ognuno nel colore della sua risorsa
    this.resTexts = RESOURCES.map((r) => this.add.text(0, 0, '0', textStyle(20, RESOURCE_INFO[r].color)).setOrigin(0, 0.5));
    this.resLabel = this.add.text(0, 0, 'BOTTINO', textStyle(10, PALETTE.ocra));
    // entrate al minuto sotto ogni risorsa: si vede cosa rende l'impero
    this.incTexts = RESOURCES.map(() => this.add.text(0, 0, '', textStyle(9, PALETTE.tenue, false)).setOrigin(0, 0));
    this.stormText = this.add.text(0, 0, '', textStyle(12, PALETTE.ocra));

    // pannello destro: fazioni
    this.rightPanel = this.add.rectangle(0, PAD, RIGHT_W, FACTION_INFO.length * ROW_H + 10, PALETTE.inchiostro, 0.88)
      .setOrigin(0).setStrokeStyle(1, PALETTE.linea);
    this.symbols = this.add.graphics();
    this.rows = FACTION_INFO.map(() => this.add.text(0, 0, '', textStyle(12, PALETTE.carta)).setOrigin(0, 0.5));

    this.seed = this.add.text(0, 0, '', textStyle(11, PALETTE.ocra, false)).setOrigin(1, 1);
    this.hint = this.add.text(0, 0, 'Tocca una provincia evidenziata per conquistarla', textStyle(14, PALETTE.carta))
      .setOrigin(0.5, 0).setAlign('center').setBackgroundColor(hex(PALETTE.inchiostro)).setPadding(10, 6, 10, 6);

    // comandi: carte in basso a sinistra; ritirata e velocità in basso a destra
    // solo le unità sbloccate dalla Arsenale
    this.cards = this.run.state.opts.units.map((t) => new UnitCard(this, t, () => this.onCard(t), this.run.state.unitCost(PLAYER, t)));
    this.abilityCards = this.run.state.opts.abilities.map((a) => new AbilityCard(this, a, () => {
      const block = this.run.toggleAbility(a);
      if (block === 'cooldown') this.toast('abilità in ricarica', PALETTE.ko);
    }));
    this.speedBtn = new Button(this, 'x1', 56, 44, () => {
      const sp = BALANCE.speeds as readonly number[];
      this.setSpeed(sp[(sp.indexOf(this.run.state.speed) + 1) % sp.length]);
    });
    this.retreatBtn = new Button(this, 'RITIRATA', 112, 44, () => this.onRetreat());
    this.pauseBtn = new Button(this, '❚❚', 56, 44, () => this.togglePause());
    this.pauseUi = null;
    this.pauseFrame = this.add.graphics().setDepth(39).setVisible(false);
    // PC: barra spaziatrice (o P) = pausa strategica, come in HOI4
    this.input.keyboard?.on('keydown-SPACE', () => this.togglePause());
    this.input.keyboard?.on('keydown-P', () => this.togglePause());
    // le due leve alla OpenFront: forza d'attacco e soldati/lavoratori (non nella run guidata)
    this.attackBtn = this.workBtn = null;
    if (!this.run.state.opts.tutorial) {
      this.attackBtn = new Button(this, '', 112, 36, () => this.cycleAttack(), 13);
      this.workBtn = new Button(this, '', 112, 36, () => this.cycleWorkers(), 13);
      this.refreshLevers();
    }
    this.setSpeed(this.run.state.speed);

    // prima run: guida con frecce al posto del suggerimento testuale
    this.guide = null;
    if (this.run.state.opts.tutorial) {
      this.hint.setVisible(false);
      this.guide = new TutorialGuide(this, {
        state: () => this.run.state,
        tileToScreen: (i) => this.run.tileToScreen(i),
        selectedCard: () => this.run.selectedCard,
        selectedUnit: () => this.run.selectedUnitId,
        cardPos: () => (this.cards[0] ? { x: this.cards[0].x + CARD_W / 2, y: this.cards[0].y } : null),
        troopsPos: () => ({ x: this.troops.x + this.troops.width + 70, y: this.troops.y + 16 }),
        labelPos: () => ({ x: this.hint.x, y: this.hint.y }),
        blocked: (x, y) => this.hitUi(x, y, true),
      });
    }

    // ?fps=1 → contatore per il test sui telefoni economici
    this.fps = fpsEnabled()
      ? this.add.text(PAD, 0, '', textStyle(12, PALETTE.radioattivo)).setBackgroundColor(hex(PALETTE.inchiostro)).setDepth(60) : null;

    this.layout();
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
  }

  private refreshLevers() {
    const st = this.run.state;
    this.attackBtn?.setLabel(`ATTACCO ${Math.round(st.attackRatio * 100)}%`);
    this.workBtn?.setLabel(`LAVORO ${Math.round(st.player.workers * 100)}%`);
  }

  /** Forza d'attacco: quante truppe può spendere un'avanzata (il resto resta a difendere). */
  private cycleAttack() {
    const st = this.run.state, R = BALANCE.attack.ratios as readonly number[];
    st.attackRatio = R[(R.indexOf(st.attackRatio) + 1) % R.length] ?? BALANCE.attack.default;
    savePrefs({ attack: st.attackRatio });
    this.refreshLevers();
    this.toast(`Le avanzate usano il ${Math.round(st.attackRatio * 100)}% delle truppe`, PALETTE.carta);
  }

  /** Soldati contro lavoratori: i lavoratori riempiono lo zaino, ma l'esercito cresce meno. */
  private cycleWorkers() {
    const st = this.run.state, W = BALANCE.workers.steps as readonly number[];
    const next = W[(W.indexOf(st.player.workers) + 1) % W.length] ?? BALANCE.workers.default;
    st.setWorkers(next);
    savePrefs({ workers: next });
    this.refreshLevers();
    this.toast(next ? `${Math.round(next * 100)}% lavoratori: più bottino, meno soldati` : 'Tutti sotto le armi: niente bottino dai lavoratori', PALETTE.carta);
  }

  private setSpeed(s: number) {
    this.run.setSpeed(s);
    this.speedBtn.setLabel(`x${s}`).setOn(s > 1);
  }

  /** Ritirata a doppio tocco: il primo arma, il secondo conferma. */
  private onRetreat() {
    if (this.ended) return;
    if (this.retreatArmed) {
      this.retreatArmed.remove();
      this.retreatArmed = null;
      this.run.ritirata();
      return;
    }
    this.retreatBtn.setLabel('CONFERMI?').setOn(true);
    this.retreatArmed = this.time.delayedCall(2500, () => {
      this.retreatArmed = null;
      this.retreatBtn.setLabel('RITIRATA').setOn(false);
    });
  }

  private onCard(t: UnitType) {
    const block = this.run.toggleCard(t);
    if (!block) return;
    const msg = ({ locked: 'serve l\'Arsenale', cooldown: 'carta in ricarica', troops: 'truppe insufficienti', cap: 'massimo pedine in campo', tile: '' } as const)[block];
    const card = this.cards.find((c) => c.type === t)!;
    this.tweens.add({ targets: card, x: card.x + 4, duration: 50, yoyo: true, repeat: 2 });
    if (msg) this.toast(msg, PALETTE.ko);
  }

  /** Messaggio di contesto in alto al centro (null = nascondi). */
  setHint(msg: string | null) {
    this.tweens.killTweensOf(this.hint);
    if (!msg) return void this.hint.setVisible(false);
    this.hint.setText(msg).setVisible(true).setAlpha(1);
  }

  private layout() {
    const { width, height, portrait } = view(this);
    this.portrait = portrait;
    const P = this.leftPanel;
    if (portrait) {
      // verticale: pannello in alto a tutta larghezza, fazioni in una striscia sotto
      P.setPosition(PAD, PAD).setSize(width - 2 * PAD, TOP_H);
      this.troopsLbl.setPosition(PAD + 10, PAD + 6);
      this.troops.setPosition(PAD + 10, PAD + 18);
      this.stats.setPosition(width - PAD - 10, PAD + 8).setOrigin(1, 0).setAlign('right');
      this.stormText.setPosition(width - PAD - 10, PAD + 56).setOrigin(1, 0);
      this.layoutResources(PAD + 16, PAD + 92, (width - 2 * PAD - 40) / 3);
      const sy = PAD + TOP_H + 6, slot = (width - 2 * PAD) / FACTION_INFO.length;
      this.rightPanel.setPosition(PAD, sy).setSize(width - 2 * PAD, STRIP_H);
      const half = (width - 2 * PAD) / 2;
      this.rows.forEach((r, k) => r.setPosition(PAD + (k % 2) * half + 26, sy + 12 + Math.floor(k / 2) * 22));
      this.symPos = this.rows.map((r) => ({ x: r.x - 12, y: r.y }));
      this.unitPos = this.rows.map(() => null);
      this.topBottom = sy + STRIP_H;
      void slot;
      this.speedBtn.setPosition(width - PAD - 56, height - PAD - 44);
      this.pauseBtn.setPosition(width - PAD - 56, this.topBottom + 8); // in alto a destra: in basso ci sono le carte
      this.retreatBtn.setPosition(width - PAD - 112, height - PAD - CARD_H - 8 - 44); // sulla riga delle leve, sopra le carte
      this.seed.setPosition(width - PAD, height - PAD - 2 * 44 - 8 - 6);
      this.hint.setPosition(width / 2 - 34, this.topBottom + 8).setWordWrapWidth(width - 2 * PAD - 90);
    } else {
      // orizzontale: una barra compatta in alto (truppe | obiettivi e tempo | bottino), fazioni nell'angolo; mappa libera
      const barW = width - 2 * PAD - RIGHT_W - 8;
      P.setPosition(PAD, PAD).setSize(barW, BAR_H);
      this.troopsLbl.setPosition(PAD + 10, PAD + 6);
      this.troops.setPosition(PAD + 10, PAD + 18);
      const bx = PAD + 168;
      this.stats.setPosition(bx, PAD + 6).setOrigin(0, 0).setAlign('left');
      this.stormText.setPosition(bx, PAD + 42).setOrigin(0, 0);
      const step = Math.min(96, Math.max(74, (barW - 400) / 3));
      this.layoutResources(PAD + barW - 3 * step - 4, PAD + 42, step);
      const rx = width - PAD - RIGHT_W;
      this.rightPanel.setPosition(rx, PAD).setSize(RIGHT_W, FACTION_INFO.length * ROW_H + 10);
      this.rows.forEach((r, k) => r.setPosition(rx + 26, PAD + 5 + ROW_H * (k + 0.5)));
      this.symPos = this.rows.map((r) => ({ x: rx + 14, y: r.y }));
      this.unitPos = this.rows.map((r) => ({ x: rx + RIGHT_W - 14, y: r.y }));
      this.topBottom = PAD + Math.max(BAR_H, FACTION_INFO.length * ROW_H + 10);
      this.speedBtn.setPosition(width - PAD - 56, height - PAD - 44);
      this.pauseBtn.setPosition(width - PAD - 56 - 8 - 56, height - PAD - 44);
      this.retreatBtn.setPosition(width - PAD - 56 - 8 - 56 - 8 - 112, height - PAD - 44);
      this.seed.setPosition(width - PAD, height - PAD - 50);
      this.hint.setPosition(PAD + barW / 2, PAD + BAR_H + 8).setWordWrapWidth(Math.max(220, barW - 40));
    }
    // la cornice disegnata del rettangolo segue la nuova misura
    P.setStrokeStyle(1, PALETTE.linea);
    this.rightPanel.setStrokeStyle(1, PALETTE.linea);
    this.rate.setPosition(this.troops.x + this.troops.width + 10, this.troops.y + 10);
    this.fps?.setPosition(PAD, this.topBottom + 6);
    if (this.pauseFrame?.visible) {
      this.drawPauseFrame();
      this.pauseUi?.setPosition(width / 2, this.topBottom + 10);
    }
    this.aliveKey = ''; // forza il ridisegno dei simboli
    this.cards.forEach((c, k) => {
      c.baseY = height - PAD - CARD_H;
      c.setPosition(PAD + k * (CARD_W + 6), c.baseY);
    });
    // abilità: dopo le carte in orizzontale, sopra le carte a destra in verticale
    this.abilityCards.forEach((c, k) => {
      c.baseY = portrait ? height - PAD - CARD_H * 2 - 14 : height - PAD - CARD_H;
      c.setPosition(portrait ? width - PAD - (k + 1) * (CARD_W + 6) + 6 : PAD + (this.cards.length + k) * (CARD_W + 6) + 10, c.baseY);
    });
    // leve sopra le carte, nell'angolo in basso a sinistra
    const ly = height - PAD - CARD_H - 8 - 36;
    this.attackBtn?.setPosition(PAD, ly);
    this.workBtn?.setPosition(PAD + 112 + 6, ly);
  }

  private layoutResources(x: number, y: number, step: number) {
    this.resIcons.clear();
    this.resLabel.setPosition(x - 6, y - 24);
    RESOURCES.forEach((r, k) => {
      drawResourceIcon(this.resIcons, r, x + 4 + k * step, y, 9);
      this.resTexts[k].setPosition(x + 18 + k * step, y);
      this.incTexts[k].setPosition(x + 18 + k * step, y + 11);
    });
  }

  /** Scritta che sale da un punto della mappa, nitida. */
  floatAt(x: number, y: number, msg: string, color: number, delay = 0) {
    this.mapLabels.float(this.run, x, y, msg, color, delay);
  }

  update(_t: number, delta: number) {
    const st = this.run.state;
    if (!st) return;
    if ((this.incAcc -= delta) <= 0) {
      this.incAcc = 1000;
      const inc = st.incomePerMin();
      RESOURCES.forEach((r, k) => this.incTexts[k].setText(inc[r] >= 0.05 ? `+${inc[r].toFixed(1).replace('.', ',')}/min` : ''));
    }
    if (this.provCard && (this.provCardAcc -= delta) <= 0) {
      this.provCardAcc = 500;
      this.renderProvince(); // cantiere che avanza, truppe e zaino che cambiano
    }
    this.mapLabels.update(this.run);
    if (!this.ended) this.guide?.update();
    this.fps?.setText(`${Math.round(this.game.loop.actualFps)} fps`);
    const t = Math.floor(st.troops);
    if (t !== this.shownTroops) {
      this.shownTroops = t;
      this.troops.setText(String(t));
      this.rate.setX(this.troops.x + this.troops.width + 10);
    }
    this.rate.setText(`+${st.troopsPerSecond.toFixed(1)}/s`);
    const share = Math.round(st.mapShare * 100);
    const goal = `${share}%/${BALANCE.victory.mapShare * 100}%`, anom = `frammenti ${st.anomaliesOwned()}/${st.anomaliesToWin}`;
    this.stats.setText(`${st.player.provinces} ${st.player.provinces === 1 ? 'provincia' : 'province'} · ${goal}\n${anom}`);
    RESOURCES.forEach((r, k) => {
      const t = this.resTexts[k], v = String(st.backpack[r]);
      if (t.text !== v) {
        if (Number(v) > Number(t.text)) this.tweens.add({ targets: t, scale: { from: 1.45, to: 1 }, duration: 260, ease: 'Back.easeOut' });
        t.setText(v);
      }
    });
    if (st.opts.tutorial) {
      this.stormText.setText(`prima missione: ${BALANCE.tutorial.goalProvinces} province`).setColor(hex(PALETTE.radioattivo));
    } else {
      const left = Math.max(0, st.timeLeft);
      this.stormText.setText(`fronte ${['I', 'II', 'III', 'IV', 'V', 'VI'][st.opts.frontIndex]} · fine tra ${mmss(left)}`)
        .setColor(left <= BALANCE.campaign.warnMs ? hex(PALETTE.ko) : hex(PALETTE.ocra));
    }
    this.seed.setText(`mappa #${st.map.seed}`);

    const key = st.factions.map((f) => +f.alive).join('');
    if (key !== this.aliveKey) {
      this.aliveKey = key;
      const g = this.symbols.clear();
      st.factions.forEach((f, k) => {
        const info = FACTION_INFO[k];
        const sp = this.symPos[k], up = this.unitPos[k];
        drawSymbol(g, info.symbol, sp.x, sp.y, 6, f.alive ? info.fill : 0x555555, PALETTE.carta);
        const dom = BALANCE.aiUnits.dominant[k] as UnitType | '';
        if (dom && f.alive && up) drawUnitIcon(g, dom, up.x, up.y, 6, PALETTE.ocra);
      });
    }
    st.factions.forEach((f, k) => {
      const r = this.rows[k];
      r.setText(f.alive ? `${FACTION_INFO[k].short} ${f.provinces}` : `${FACTION_INFO[k].short} ✝`).setAlpha(f.alive ? 1 : 0.4);
    });
    const sel = this.run.selectedCard;
    for (const c of this.cards) {
      const cd = Math.max(0, st.cooldowns[PLAYER][c.type] - st.gameTimeMs) / BALANCE.units.cooldownMs;
      const block = st.deployBlock(PLAYER, c.type);
      c.refresh(cd, block === null || block === 'cooldown', sel === c.type);
    }
    for (const c of this.abilityCards) {
      const A = BALANCE.abilities[c.ability];
      const cd = Math.max(0, st.abilityReadyAt[c.ability] - st.gameTimeMs) / (A.cooldownMs * st.opts.abilityCdMult);
      c.refresh(Math.min(1, cd), this.run.selectedAbility === c.ability);
    }
  }

  /** Provincia tutta tua: stendardo con truppe e bottino. */
  /** Offensiva nemica: preavviso, inizio, esito. */
  onOffensive(faction: number, phase: 'warn' | 'start' | 'end', lost = 0) {
    const who = FACTION_INFO[faction]?.name.toUpperCase() ?? 'IL NEMICO';
    if (phase === 'warn') this.toast(`⚠ ${who} PREPARA UN'OFFENSIVA\nrinforza il confine (genio, truppe in cassa)`, PALETTE.allerta);
    else if (phase === 'start') this.banner(`OFFENSIVA ${who}`, PALETTE.ko, 'attaccano il tuo confine');
    else this.toast(lost ? `OFFENSIVA FINITA · perso il ${Math.round((lost / Math.max(1, lost + this.run.state.player.tiles)) * 100)}% del territorio` : 'OFFENSIVA RESPINTA', lost > 40 ? PALETTE.ko : PALETTE.ocra);
  }

  onEliminated(faction: number, by: number, loot: Bag) {
    if (faction === PLAYER) return;
    const who = FACTION_INFO[faction].name.toUpperCase();
    const got = bagTotal(loot);
    const msg = by === PLAYER
      ? `${who} ELIMINATI${got ? `\n+${got} risorse dal loro bottino` : ''}`
      : `${who} SPAZZATI VIA DA ${FACTION_INFO[by]?.short ?? 'NESSUNO'}`;
    this.toast(msg, by === PLAYER ? PALETTE.radioattivo : PALETTE.ocra);
  }

  /** Ultimo minuto di campagna. */
  onTimer() {
    this.toast('ULTIMO MINUTO\nallo scadere vince chi ha più territorio', PALETTE.allerta);
  }

  private toast(msg: string, color: number) {
    const { width } = view(this);
    const t = this.add.text(width / 2, this.topBottom + 70, msg, textStyle(this.portrait ? 14 : 16, color)).setOrigin(0.5).setAlign('center')
      .setWordWrapWidth(width - 2 * PAD - 24).setBackgroundColor(hex(PALETTE.inchiostro)).setPadding(12, 8, 12, 8).setScale(0.6).setAlpha(0);
    this.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 220, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, delay: 2600, duration: 400, onComplete: () => t.destroy() });
  }

  /** Carta evento: la run resta in pausa finché non scegli. */
  showEvent(ev: GameEvent) {
    const st = this.run.state;
    this.eventCard = new EventCard(this, ev, (c) => st.canChoose(c), (side) => {
      const msg = st.choose(side);
      analytics.design(['evento', ev.id, side]);
      this.eventCard = null;
      if (msg) this.toast(msg, PALETTE.carta);
    });
  }

  tutorialSignal(kind: GuideSignal) {
    this.guide?.signal(kind);
  }

  /** Città presa: provincia annessa (toast) o capitale caduta (cartello). Le IA si annunciano solo per le capitali. */
  onProvince(by: number, capital: boolean, nation: string, bonus: number) {
    if (by === PLAYER) {
      if (capital) this.banner(`${nation.toUpperCase()} CADE`, PALETTE.ocra, `capitale presa${bonus ? ` · +${bonus} truppe` : ''}`);
    } else if (capital && by >= 0) {
      this.toast(`${FACTION_INFO[by].short} PRENDONO LA CAPITALE: ${nation.toUpperCase()}`, PALETTE.ocra);
    }
  }

  onAnomaly(count: number, gained: boolean) {
    if (gained) this.banner(`FRAMMENTO ${count}/${this.run.state.anomaliesToWin}`, PALETTE.radioattivo, 'il segnale è tuo');
    else this.toast(`FRAMMENTO PERSO · ${count}/${this.run.state.anomaliesToWin}`, PALETTE.ko);
  }

  onMilestone(n: number) {
    const names: Record<number, string> = { 8: 'testa di ponte', 15: 'dominio regionale', 30: 'potenza continentale', 60: 'egemonia', 120: 'il mondo trattiene il fiato' };
    this.banner(`${n} PROVINCE`, PALETTE.ocra, names[n] ?? '');
  }

  /** Cartello grande e breve al centro: per i momenti epici. */
  /** I cartelli escono uno alla volta: se due arrivano insieme il secondo aspetta il suo turno. */
  private banner(title: string, color: number, sub: string) {
    const now = this.time.now;
    const at = Math.max(now, this.nextBannerAt);
    this.nextBannerAt = at + 1300;
    if (at > now) this.time.delayedCall(at - now, () => this.showBanner(title, color, sub));
    else this.showBanner(title, color, sub);
  }

  private showBanner(title: string, color: number, sub: string) {
    if (this.ended) return;
    const { width, height } = view(this);
    const t = this.add.text(width / 2, height * 0.36, title, textStyle(34, color)).setOrigin(0.5).setDepth(40);
    const s2 = this.add.text(width / 2, height * 0.36 + 32, sub.toUpperCase(), textStyle(14, PALETTE.carta)).setOrigin(0.5)
      .setDepth(40);
    s2.setWordWrapWidth(width - 40).setAlign('center');
    for (const o of [t, s2]) {
      const fit = Math.min(1, (width - 32) / Math.max(1, o.width)); // titoli lunghi: si rimpiccioliscono, non escono dallo schermo
      o.setScale(1.8 * fit).setAlpha(0);
      this.tweens.add({ targets: o, scale: fit, alpha: 1, duration: 260, ease: 'Back.easeOut' });
      this.tweens.add({ targets: o, alpha: 0, y: o.y - 20, delay: 1500, duration: 400, onComplete: () => o.destroy() });
    }
  }

  /** Cartello di fine run, mostrato prima della schermata finale. */
  showEnd(outcome: Outcome, reason?: VictoryReason) {
    this.ended = true;
    this.guide?.destroy();
    this.guide = null;
    const { width, height } = view(this);
    if (outcome === 'victory') {
      // coriandoli di carta e ocra
      const conf = this.add.particles(width / 2, -10, 'dot', {
        x: { min: -width / 2, max: width / 2 }, speedY: { min: 120, max: 260 }, speedX: { min: -60, max: 60 },
        lifespan: 2200, scale: { min: 0.8, max: 1.6 }, tint: [PALETTE.ocra, PALETTE.carta, PALETTE.radioattivo, PALETTE.ruggine],
        quantity: 4, frequency: 30, duration: 900,
      }).setDepth(41);
      this.time.delayedCall(2600, () => conf.destroy());
    }
    const title = {
      victory: reason === 'anomalies' ? 'IL SEGNALE È TUO' : reason === 'time' ? 'IL CAMPO È TUO' : reason === 'tutorial' ? 'PRIMA VITTORIA!' : 'IMPERO!',
      retreat: 'RITIRATA',
      eliminated: 'ELIMINATO',
      timeout: 'FINE DELLE OPERAZIONI',
    }[outcome];
    const color = outcome === 'victory' ? PALETTE.radioattivo : outcome === 'retreat' ? PALETTE.ocra : PALETTE.ko;
    const t = this.add.text(width / 2, height / 2, title, textStyle(40, color)).setOrigin(0.5)
      .setScale(1.8).setAlpha(0);
    this.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 320, ease: 'Back.easeOut' });
  }

  onConquest(loot: number) {
    if (this.hint.visible && !this.run.selectedCard && !this.guide) {
      this.tweens.add({ targets: this.hint, alpha: 0, duration: 300, onComplete: () => this.hint.setVisible(false) });
    }
    if (loot) this.tweens.add({ targets: this.resTexts, scale: { from: 1.3, to: 1 }, duration: 220 });
  }

  /** true se il punto (schermo) cade su un elemento dell'HUD. */
  /**
   * PAUSA STRATEGICA (alla HOI4): il tempo si ferma ma si comanda lo stesso. Tocchi e trascinamenti sulla mappa
   * preparano il piano (province in coda), pedine, abilità e navi prendono ordini; tutto parte alla ripresa.
   */
  togglePause() {
    const st = this.run.state;
    if (this.ended || st.over || st.pendingEvent) return;
    st.paused = !st.paused;
    this.pauseBtn.setLabel(st.paused ? '▶' : '❚❚').setOn(st.paused);
    this.pauseUi?.destroy();
    this.pauseUi = null;
    this.pauseFrame.setVisible(st.paused);
    if (!st.paused) {
      if (st.plan.length) this.toast(`PIANO IN ESECUZIONE · ${st.plan.length} province`, PALETTE.radioattivo);
      return;
    }
    this.hint.setVisible(false);
    const { width } = view(this);
    const title = this.add.text(0, 0, '❚❚  PAUSA STRATEGICA', textStyle(17, PALETTE.ocra)).setOrigin(0.5, 0);
    const sub = this.add.text(0, 26, 'il tempo è fermo · tocca le province per il piano · muovi le pedine', textStyle(11, PALETTE.carta, false))
      .setOrigin(0.5, 0).setAlign('center').setWordWrapWidth(Math.min(460, width - 40));
    const w = Math.max(title.width, sub.width) + 28;
    const bg = this.add.rectangle(0, -8, w, sub.y + sub.height + 16, PALETTE.inchiostro, 0.88).setOrigin(0.5, 0).setStrokeStyle(1, PALETTE.ocra);
    this.pauseUi = this.add.container(width / 2, this.topBottom + 10, [bg, title, sub]).setDepth(40);
    this.tweens.add({ targets: title, alpha: 0.55, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.drawPauseFrame();
  }

  /** Cornice dorata attorno allo schermo: si vede subito che il tempo è fermo. */
  private drawPauseFrame() {
    const { width, height } = view(this);
    const g = this.pauseFrame.clear();
    g.lineStyle(3, PALETTE.ocra, 0.85).strokeRect(1.5, 1.5, width - 3, height - 3);
    const L = 26;
    g.lineStyle(5, PALETTE.ocra, 1);
    for (const [cx, cy, dx, dy] of [[0, 0, 1, 1], [width, 0, -1, 1], [0, height, 1, -1], [width, height, -1, -1]]) {
      g.lineBetween(cx, cy + dy * 2, cx + dx * L, cy + dy * 2).lineBetween(cx + dx * 2, cy, cx + dx * 2, cy + dy * L);
    }
  }

  showProvince(p: number) {
    this.provCardP = p;
    this.provCardAcc = 500;
    this.renderProvince();
  }

  hideProvince() {
    this.provCard?.destroy();
    this.provCard = null;
    this.provCardP = -1;
  }

  refreshProvince() {
    if (this.provCardP >= 0) this.renderProvince();
  }

  /** Scheda provincia alla Call of War: terreno, difesa, produzione e le tre costruzioni. */
  private renderProvince() {
    const st = this.run.state, p = this.provCardP;
    this.provCard?.destroy();
    this.provCard = null;
    if (p < 0 || st.provOwner[p] !== PLAYER || st.over) return void (this.provCardP = -1);
    const prov = st.map.provinces[p];
    const { width, height } = view(this);
    const W = Math.min(400, width - 2 * PAD), H = 146;
    const ly = height - PAD - CARD_H - 8 - 36;
    const y0 = this.portrait ? (this.abilityCards.length ? height - PAD - CARD_H * 2 - 22 : ly - 8) - H : this.topBottom + 8;
    const T = BALANCE.terrain[prov.terrain];
    const nation = st.map.nations.find((n) => n.id === prov.country)?.name ?? 'Terra di nessuno';
    const terrainName = { pianura: 'pianura', colline: 'colline', montagne: 'montagne', deserto: 'deserto' }[prov.terrain];
    const ready = st.workOf(p), prog = st.workInProgress(p);
    const mult = ready ? BALANCE.works[ready].prodMult : 1;
    const items: Phaser.GameObjects.GameObject[] = [
      this.add.rectangle(0, 0, W, H, PALETTE.inchiostro, 0.95).setOrigin(0).setStrokeStyle(1, PALETTE.linea),
      this.add.rectangle(0, 0, W, 2, PALETTE.ocra).setOrigin(0),
      this.add.text(12, 8, `${nation.toUpperCase()} · ${terrainName.toUpperCase()}`, textStyle(13, PALETTE.carta)),
      this.add.text(12, 30, `difesa ${st.provDefense(p)} · produce ${(T.perMin * mult).toFixed(1).replace('.', ',')} ${RESOURCE_INFO[T.res].name.toLowerCase()}/min`
        + `${T.move > 1 ? ` · pedine lente ×${String(T.move).replace('.', ',')}` : ''}`, textStyle(10, PALETTE.tenue, false)).setWordWrapWidth(W - 24),
    ];
    const close = this.add.text(W - 10, 6, '✕', textStyle(16, PALETTE.carta)).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on('pointerup', () => this.hideProvince());
    items.push(close);
    if (ready || prog) {
      const w = ready ?? prog!.work;
      const ig = this.add.graphics();
      ig.fillStyle(PALETTE.pannello, 1).fillCircle(30, 86, 18);
      drawWorkIcon(ig, w, 30, 86, 11, ready ? PALETTE.ocra : PALETTE.allerta);
      items.push(ig, this.add.text(58, 70, WORK_NAME[w].toUpperCase(), textStyle(14, ready ? PALETTE.ocra : PALETTE.allerta)),
        this.add.text(58, 92, ready ? WORK_DESC[w] : `in costruzione · ${mmss(prog!.leftMs)}`, textStyle(11, PALETTE.carta, false)));
    } else {
      const bw = (W - 24 - 12) / 3;
      WORKS.forEach((w, k) => {
        const D = BALANCE.works[w], block = st.workBlock(p, w), x = 12 + k * (bw + 6), y = 56;
        const cost = [`${D.troops} truppe`, ...RESOURCES.filter((r) => D.cost[r]).map((r) => `${D.cost[r]} ${RESOURCE_INFO[r].name.slice(0, 3).toLowerCase()}`)].join(' · ');
        const bg = this.add.rectangle(x, y, bw, 80, PALETTE.pannello).setOrigin(0).setStrokeStyle(1, block ? PALETTE.linea : PALETTE.ocra)
          .setInteractive({ useHandCursor: true });
        const ig = this.add.graphics();
        drawWorkIcon(ig, w, x + 15, y + 16, 8, block ? PALETTE.tenue : PALETTE.ocra);
        const name = this.add.text(x + 28, y + 8, WORK_NAME[w].toUpperCase(), textStyle(11, block ? PALETTE.tenue : PALETTE.carta));
        const sub = this.add.text(x + 8, y + 30, block === 'tech' ? `🔒 ${techInfo(D.tech).name}` : WORK_DESC[w], textStyle(9, PALETTE.carta, false))
          .setWordWrapWidth(bw - 12);
        const price = this.add.text(x + 8, y + 74, cost, textStyle(8, block === 'troops' || block === 'loot' ? PALETTE.ko : PALETTE.tenue, false))
          .setOrigin(0, 1).setWordWrapWidth(bw - 12);
        if (block === 'tech') price.setVisible(false);
        bg.on('pointerup', () => {
          if (block) {
            const why = { owner: 'non è tua', busy: 'c\'è già una costruzione', tech: `serve la ricerca ${techInfo(D.tech).name}`, troops: `servono ${D.troops} truppe`, loot: 'risorse insufficienti nello zaino' }[block];
            return this.toast(why.toUpperCase(), PALETTE.ko);
          }
          if (this.run.state.build(PLAYER, p, w)) analytics.design(['costruzione', w]);
          this.renderProvince();
        });
        items.push(bg, ig, name, sub, price);
      });
    }
    this.provCard = this.add.container((width - W) / 2, y0, items).setDepth(45);
    this.hint.setVisible(false);
  }

  hitUi(x: number, y: number, layoutOnly = false): boolean {
    if (!layoutOnly && (this.ended || this.eventCard)) return true;
    if (layoutOnly && y > this.hint.y - 4 && y < this.hint.y + 60 && Math.abs(x - this.hint.x) < 200) return true; // etichetta della guida
    const inRect = (r: Phaser.GameObjects.Rectangle, ox = 0, oy = 0) => {
      const rx = ox + r.x - r.width * r.originX, ry = oy + r.y - r.height * r.originY;
      return x >= rx && x <= rx + r.width && y >= ry && y <= ry + r.height;
    };
    if (inRect(this.leftPanel) || inRect(this.rightPanel)) return true;
    if (this.pauseUi && inRect(this.pauseUi.list[0] as Phaser.GameObjects.Rectangle, this.pauseUi.x, this.pauseUi.y)) return true;
    if (this.provCard && inRect(this.provCard.list[0] as Phaser.GameObjects.Rectangle, this.provCard.x, this.provCard.y)) return true;
    const btns = [this.speedBtn, this.pauseBtn, this.retreatBtn, ...this.cards, ...this.abilityCards, this.attackBtn, this.workBtn].filter((b) => b !== null);
    return btns.some((b) => b.contains(x, y));
  }
}
