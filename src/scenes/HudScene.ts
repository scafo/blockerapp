import Phaser from 'phaser';
import { BALANCE, type UnitType } from '../config/balance';
import { PALETTE, hex } from '../config/palette';
import { NEUTRAL, PLAYER, WORKS, type DiploWhat, type Outcome, type VictoryReason } from '../game/RunState';
import { techInfo } from '../game/tech';
import { WORK_NAME, drawWorkIcon, workDesc } from '../ui/workIcons';
import { buzz } from '../ui/haptics';
import { FACTION_INFO, majorCount, majorIds } from '../game/factions';
import civText from '../data/civs.json';
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
import { safeInsets, uiCamera, view } from '../ui/screen';
import { drawSymbol } from '../ui/symbols';
import { dots } from '../ui/schematic';
import { TCOL, termLabel, termNotch, termNote, termStyle } from '../ui/terminal';
import { drawUnitIcon } from '../ui/unitIcons';
import { unitInfo } from '../game/units';
import type { RunScene } from './RunScene';

const PAD = 12;
const LEFT_W = 300;
const LEFT_H = 148;
const RIGHT_W = 180;
const BAR_H = 74; // orizzontale: barra in alto (truppe, obiettivi, tempo, bottino)
const ROW_H = 22; // righe delle potenze: abbastanza alte da toccare
const TOP_H = 140; // verticale: altezza dei riquadri in alto (esercito e fronte + bottino)
const STRIP_H = 46; // verticale: fazioni su due righe
const STATUS_H = 20; // barra di stato della carta da terminale, in fondo allo schermo
const DOCK_PAD = 8; // margine interno del riquadro dei reparti

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
  private recruitBtn!: Phaser.GameObjects.Text;
  private pauseBtn!: Button;
  /** Pausa strategica: cornice + cartello, la mappa resta comandabile. */
  private pauseUi: Phaser.GameObjects.Container | null = null;
  /** Scheda della provincia toccata (terreno, produzione, costruzioni). */
  private provCard: Phaser.GameObjects.Container | null = null;
  private provCardP = -1;
  private buildHint = false;
  private profile: Phaser.GameObjects.Container | null = null;
  private profileF = -1;
  private profileAcc = 0;
  private provCardAcc = 0;
  private selUnit = -1; // pedina selezionata nella tabella in basso
  private provOpen = true; // costruzioni aperte nella tabella
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
  private rowIds: number[] = []; // fazione di ogni riga dell'elenco
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
  /** Orizzontale: riquadri della pianta (fondo ardesia, filo avorio) con l'etichetta in corsivo sul bordo. */
  private frames!: Phaser.GameObjects.Graphics;
  private notches: Phaser.GameObjects.Text[] = [];
  private notes: Phaser.GameObjects.Container[] = [];
  private dockG!: Phaser.GameObjects.Graphics;
  private logiBtn!: Button;
  private helpBtn!: Button;
  private help: Phaser.GameObjects.Container | null = null;
  private hintBox!: Phaser.GameObjects.Rectangle;
  private wallBtn!: Button;
  private food!: Phaser.GameObjects.Text;
  private forecast: Phaser.GameObjects.Container | null = null;
  private forecastKey = '';

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
    this.frames = this.add.graphics();
    this.dockG = this.add.graphics();
    this.leftPanel = this.add.rectangle(PAD, PAD, LEFT_W, LEFT_H, TCOL.bg, 0.95).setOrigin(0).setStrokeStyle(1, PALETTE.linea);
    this.notches = ['Esercito', 'Fronte', 'Potenze', 'Reparti'].map((t) => termNotch(this, 0, 0, t));
    this.troopsLbl = this.add.text(0, 0, 'TRUPPE', termStyle(11, PALETTE.ocra));
    this.troops = this.add.text(0, 0, '0', termStyle(28, PALETTE.carta));
    this.rate = this.add.text(0, 0, '', termStyle(12, PALETTE.radioattivo));
    this.food = this.add.text(0, 0, '', termStyle(10, PALETTE.radioattivo)).setVisible(!this.run.state.opts.tutorial); // rancio: cibo dello zaino
    this.stats = this.add.text(0, 0, '', termStyle(12, PALETTE.carta));
    this.resIcons = this.add.graphics();
    // bottino: icone e numeri grandi, ognuno nel colore della sua risorsa
    this.resTexts = RESOURCES.map((r) => this.add.text(0, 0, '0', termStyle(20, RESOURCE_INFO[r].color)).setOrigin(0, 0.5));
    const stake = bagTotal(this.run.state.opts.stake);
    this.resLabel = this.add.text(0, 0, stake ? ` bottino · puntata ${stake} ` : ' bottino ', termLabel(11))
      .setBackgroundColor(hex(TCOL.bg));
    // ARRUOLA: risorse dello zaino in truppe subito (la puntata si può spendere per partire forte)
    this.recruitBtn = this.add.text(0, 0, `＋ ARRUOLA ${BALANCE.stake.recruitTroops} TRUPPE`, termStyle(10, PALETTE.radioattivo))
      .setPadding(6, 3, 6, 3).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    this.recruitBtn.on('pointerup', () => {
      const n = this.run.state.recruit();
      if (!n) return this.toast(`SERVONO ${BALANCE.stake.recruitCost} RISORSE NELLO ZAINO`, PALETTE.ko);
      this.toast(`+${n} TRUPPE ARRUOLATE · −${BALANCE.stake.recruitCost} risorse`, PALETTE.radioattivo);
      buzz(10);
    });
    this.recruitBtn.setVisible(!this.run.state.opts.tutorial);
    // entrate al minuto sotto ogni risorsa: si vede cosa rende l'impero
    this.incTexts = RESOURCES.map(() => this.add.text(0, 0, '', termStyle(9, PALETTE.tenue, false)).setOrigin(0, 0));
    this.stormText = this.add.text(0, 0, '', termStyle(12, PALETTE.ocra));

    // pannello destro: fazioni
    this.rightPanel = this.add.rectangle(0, PAD, RIGHT_W, majorCount() * ROW_H + 10, TCOL.bg, 0.95)
      .setOrigin(0).setStrokeStyle(1, PALETTE.linea);
    this.symbols = this.add.graphics();
    this.rowIds = majorIds();
    this.rows = this.rowIds.map((id) => {
      const t = this.add.text(0, 0, '', termStyle(12, PALETTE.carta)).setOrigin(0, 0.5);
      if (id > 0) t.setInteractive({ useHandCursor: true }).on('pointerup', () => this.showProfile(id)); // scheda dell'impero
      return t;
    });

    this.seed = this.add.text(0, 0, '', termStyle(11, PALETTE.ocra, false)).setOrigin(1, 1);
    // suggerimento: riquadro della pianta (fondo ardesia, filo avorio) che segue il testo
    this.hintBox = this.add.rectangle(0, 0, 10, 10, TCOL.bg, 0.94).setOrigin(0).setStrokeStyle(1, TCOL.edge, 0.75);
    this.hint = this.add.text(0, 0, 'Tocca una provincia evidenziata per conquistarla', termLabel(13))
      .setOrigin(0.5, 0).setAlign('center').setPadding(12, 7, 12, 7);

    // comandi: carte in basso a sinistra; ritirata e velocità in basso a destra
    // solo le unità sbloccate dalla Arsenale
    this.cards = this.run.state.opts.units.map((t) => new UnitCard(this, t, () => this.onCard(t), this.run.state.unitCost(PLAYER, t), this.run.state.unitFuel(t)));
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
    // vista logistica e comandi, sotto le potenze
    this.logiBtn = new Button(this, 'LOGISTICA', 88, 32, () => this.toggleLogistics(), 12);
    this.helpBtn = new Button(this, 'COMANDI', 88, 32, () => this.toggleHelp(), 12);
    // muro: trascinando sulle tue province si mettono bunker in fila
    this.wallBtn = new Button(this, 'MURO', 88, 32, () => this.setWallOn(this.run.toggleWall()), 12);
    this.wallBtn.setVisible(!this.run.state.opts.tutorial);
    this.help = null;
    this.forecast = null;
    for (const b of [this.speedBtn, this.retreatBtn, this.pauseBtn, this.logiBtn, this.helpBtn, this.wallBtn]) b.terminal();
    this.input.keyboard?.on('keydown-L', () => this.toggleLogistics());
    this.input.keyboard?.on('keydown-H', () => this.toggleHelp());
    this.input.keyboard?.on('keydown-ESC', () => { if (this.help) this.toggleHelp(); });
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
      this.attackBtn.terminal();
      this.workBtn.terminal();
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
      ? this.add.text(PAD, 0, '', termStyle(12, PALETTE.radioattivo)).setBackgroundColor(hex(TCOL.bg)).setDepth(60) : null;

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

  /** Vista logistica: le tue province colorate dal rifornimento (verde pieno, giallo in calo, rosso tagliate fuori). */
  private toggleLogistics() {
    const on = this.run.toggleLogistics();
    this.logiBtn.setOn(on);
    this.setHint(on ? 'LOGISTICA · verde: rifornite · giallo: in calo · rosso: tagliate fuori dalla capitale' : null);
  }

  /** Elenco dei comandi (tasto COMANDI o H). */
  private toggleHelp() {
    if (this.help) {
      this.help.destroy();
      this.help = null;
      this.helpBtn.setOn(false);
      return;
    }
    const { width, height } = view(this);
    const rows: [string, string][] = [
      ['tocco su provincia evidenziata', 'la compri con le truppe (assalto se è di qualcuno)'],
      ['tocco su una tua provincia', 'scheda e costruzioni'],
      ['tieni premuto', 'scheda di chi possiede la provincia'],
      ['trascina col destro · WASD o frecce', 'sposta la carta (telefono: trascina col dito)'],
      ['rotella o pizzico', 'zoom'],
      ['carta reparto, poi tuo territorio', 'schiera la pedina'],
      ['clic sulla pedina', 'la selezioni'],
      ['Maiusc + clic', 'aggiungi o togli la pedina dal gruppo'],
      ['trascina col sinistro', 'riquadro: seleziona più pedine (Maiusc: aggiungi)'],
      ['clic destro o tocco sulla meta', 'manda le pedine selezionate'],
      ['carta abilità, poi la mappa', 'ricognizione aerea o bombardamento'],
      ['Spazio o P', 'pausa strategica: i tocchi preparano il piano'],
      ['L', 'vista logistica (rifornimento)'],
      ['H', 'questi comandi · Esc chiude'],
      ['ATTACCO · LAVORO', 'truppe per ogni avanzata · lavoratori e soldati'],
      ['MURO o B, poi trascina', 'bunker su tutte le tue province toccate'],
      ['Ctrl o Maiusc + numero · numero', 'salva il gruppo · lo richiami (due volte: la carta ci va)'],
      ['T · F', 'pedine: difende o attacca da sola · assegna a un fronte'],
      ['U · I · R', 'unisci · dividi · ritirata delle pedine selezionate'],
      ['mouse su una provincia di confine', 'previsione dell\'assalto (con pedine scelte: il percorso)'],
    ];
    const W = Math.min(660, width - 2 * PAD), kx = 16, vx = Math.min(300, W * 0.46);
    // righe che vanno a capo se serve: l'altezza del riquadro si calcola dopo
    const texts: Phaser.GameObjects.Text[] = [];
    let y = 30;
    for (const [k, v] of rows) {
      const kt = this.add.text(kx, y, k, termStyle(12, TCOL.accent)).setWordWrapWidth(vx - kx - 10);
      const vt = this.add.text(vx, y, v, termStyle(12, TCOL.text)).setWordWrapWidth(W - vx - 14);
      texts.push(kt, vt);
      y += Math.max(kt.height, vt.height) + 6;
    }
    const H = y + 10;
    const items: Phaser.GameObjects.GameObject[] = [
      this.add.rectangle(0, 0, W, H, TCOL.bg, 0.96).setOrigin(0).setStrokeStyle(1, TCOL.edge, 0.75).setInteractive(),
      termNotch(this, 0, 0, 'comandi'),
      ...texts,
    ];
    const close = this.add.text(W - 4, 2, '✕', termStyle(14)).setOrigin(1, 0).setPadding(12, 8, 10, 12).setInteractive({ useHandCursor: true });
    close.on('pointerup', () => this.toggleHelp());
    items.push(close);
    this.help = this.add.container((width - W) / 2, Math.max(PAD, (height - H) / 2), items).setDepth(47);
    this.helpBtn.setOn(true);
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
    const fee = Math.round(this.run.state.opts.exitFee * 100);
    this.retreatBtn.setLabel(fee ? `ESCI −${fee}%?` : 'CONFERMI?').setOn(true); // uscire prima della fine costa
    this.retreatArmed = this.time.delayedCall(2500, () => {
      this.retreatArmed = null;
      this.retreatBtn.setLabel('RITIRATA').setOn(false);
    });
  }

  private onCard(t: UnitType) {
    const block = this.run.toggleCard(t);
    if (!block) return;
    const msg = ({ locked: 'serve l\'Arsenale', cooldown: 'carta in ricarica', troops: 'truppe insufficienti', cap: 'massimo pedine in campo', tile: '', fuel: `servono ${this.run.state.unitFuel(t)} benzina nello zaino` } as const)[block];
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
    const topPad = PAD + safeInsets().top; // notch/Dynamic Island: la barra in alto non ci deve finire sotto
    if (portrait) {
      // verticale: pannello in alto a tutta larghezza, fazioni in una striscia sotto
      P.setPosition(PAD, topPad).setSize(width - 2 * PAD, TOP_H);
      this.troopsLbl.setPosition(PAD + 10, topPad + 6);
      this.troops.setPosition(PAD + 10, topPad + 18);
      this.stats.setPosition(width - PAD - 10, topPad + 8).setOrigin(1, 0).setAlign('right');
      this.stormText.setPosition(width - PAD - 10, topPad + 56).setOrigin(1, 0);
      this.layoutResources(PAD + 16, topPad + 92, (width - 2 * PAD - 40) / 3);
      const sy = topPad + TOP_H + 6, slot = (width - 2 * PAD) / majorCount();
      this.rightPanel.setPosition(PAD, sy).setSize(width - 2 * PAD, STRIP_H);
      const half = (width - 2 * PAD) / 2;
      this.rows.forEach((r, k) => r.setPosition(PAD + (k % 2) * half + 26, sy + 12 + Math.floor(k / 2) * 22));
      this.symPos = this.rows.map((r) => ({ x: r.x - 12, y: r.y }));
      this.unitPos = this.rows.map(() => null);
      this.topBottom = sy + STRIP_H;
      void slot;
      const pb = height - PAD - STATUS_H; // fondo utile: sopra la barra di stato della carta
      this.speedBtn.setPosition(width - PAD - 56, pb - 44);
      this.pauseBtn.setPosition(width - PAD - 56, this.topBottom + 8); // in alto a destra: in basso ci sono le carte
      this.logiBtn.setPosition(width - PAD - 88, this.topBottom + 8 + 44 + 6);
      this.helpBtn.setPosition(width - PAD - 88, this.topBottom + 8 + 44 + 6 + 32 + 6);
      this.wallBtn.setPosition(width - PAD - 88, this.topBottom + 8 + 44 + 6 + 2 * (32 + 6));
      this.retreatBtn.setPosition(width - PAD - 112, pb - this.portraitCardH() - 8 - 44); // sulla riga delle leve, sopra le carte
      this.seed.setPosition(width - PAD, pb - 2 * 44 - 8 - 6);
      this.hint.setPosition(width / 2 - 34, this.topBottom + 8).setWordWrapWidth(width - 2 * PAD - 90);
    } else {
      // orizzontale: tre riquadri della pianta in alto (esercito | fronte | bottino), potenze nell'angolo; mappa libera
      const barW = width - 2 * PAD - RIGHT_W - 10;
      P.setPosition(PAD, topPad).setSize(barW, BAR_H); // area dei tocchi (il disegno lo fanno i riquadri)
      const aW = 190, bW = 220, gap = 10, bx = PAD + aW + gap, cx = bx + bW + gap, cW = PAD + barW - cx;
      this.troopsLbl.setVisible(false);
      this.troops.setPosition(PAD + 12, topPad + 16);
      this.stats.setPosition(bx + 12, topPad + 12).setOrigin(0, 0).setAlign('left');
      this.stormText.setPosition(bx + 12, topPad + 50).setOrigin(0, 0);
      const step = Math.min(110, (cW - 24) / 3);
      this.layoutResources(cx + 14, topPad + 40, step);
      this.resLabel.setPosition(cx + 8, topPad).setOrigin(0, 0.5);
      this.recruitBtn.setPosition(cx + cW - 6, topPad + 6);
      const rx = width - PAD - RIGHT_W, rh = majorCount() * ROW_H + 14;
      this.rightPanel.setPosition(rx, topPad).setSize(RIGHT_W, rh);
      this.rows.forEach((r, k) => r.setPosition(rx + 28, topPad + 9 + ROW_H * (k + 0.5)));
      this.symPos = this.rows.map((r) => ({ x: rx + 16, y: r.y }));
      this.unitPos = this.rows.map((r) => ({ x: rx + RIGHT_W - 16, y: r.y }));
      this.topBottom = topPad + Math.max(BAR_H, rh);
      const by = height - PAD - STATUS_H - 44; // comandi sopra la barra di stato della carta
      this.speedBtn.setPosition(width - PAD - 56, by);
      this.pauseBtn.setPosition(width - PAD - 56 - 8 - 56, by);
      this.retreatBtn.setPosition(width - PAD - 56 - 8 - 56 - 8 - 112, by);
      this.seed.setPosition(width - PAD, by - 6);
      this.hint.setPosition(PAD + barW / 2, topPad + BAR_H + 10).setWordWrapWidth(Math.max(220, barW - 40));
      this.logiBtn.setPosition(rx, this.topBottom + 8);
      this.helpBtn.setPosition(rx + RIGHT_W - 88, this.topBottom + 8);
      this.wallBtn.setPosition(rx, this.topBottom + 8 + 32 + 6);
      // riquadri
      const n = this.cards.length + this.abilityCards.length, ds = this.dockScale();
      const dockW = n * (CARD_W * ds + 6) - 6 + (this.abilityCards.length ? 10 : 0) + 2 * DOCK_PAD, dockH = CARD_H * ds + 2 * DOCK_PAD + 4;
      const dockY = height - PAD - STATUS_H - dockH;
      const boxes: [number, number, number, number, Phaser.GameObjects.Text][] = [
        [PAD, topPad, aW, BAR_H, this.notches[0]], [bx, topPad, bW, BAR_H, this.notches[1]], [cx, topPad, cW, BAR_H, this.resLabel],
        [rx, topPad, RIGHT_W, rh, this.notches[2]],
      ];
      const f = this.frames.clear().setVisible(true);
      for (const [x, y, w, h, label] of boxes) {
        f.fillStyle(TCOL.bg, 0.94).fillRect(x, y, w, h).lineStyle(1, TCOL.edge, 0.75).strokeRect(x, y, w, h);
        label.setPosition(x + 8, y).setOrigin(0, 0.5).setVisible(true);
      }
      // riquadro dei reparti a parte: si nasconde con le carte quando si apre la scheda in basso
      this.dockG.clear().fillStyle(TCOL.bg, 0.94).fillRect(PAD, dockY, dockW, dockH).lineStyle(1, TCOL.edge, 0.75).strokeRect(PAD, dockY, dockW, dockH);
      this.notches[3].setPosition(PAD + 8, dockY).setOrigin(0, 0.5).setVisible(true);
      P.setFillStyle(TCOL.bg, 0);
      this.rightPanel.setFillStyle(TCOL.bg, 0);
    }
    if (portrait) {
      // verticale: stessi riquadri della pianta, impilati (esercito e fronte | bottino | potenze)
      const w = width - 2 * PAD, sy = topPad + TOP_H + 6;
      const boxes: [number, number, number, number, Phaser.GameObjects.Text][] = [
        [PAD, topPad, w, 72, this.notches[0].setText(' esercito · fronte ')], [PAD, topPad + 80, w, TOP_H - 80, this.resLabel],
        [PAD, sy, w, STRIP_H, this.notches[2]],
      ];
      const f = this.frames.clear().setVisible(true);
      this.dockG.clear(); // in verticale niente riquadro dei reparti
      this.notches.forEach((t) => t.setVisible(false));
      for (const [x, y, bw, bh, label] of boxes) {
        f.fillStyle(TCOL.bg, 0.94).fillRect(x, y, bw, bh).lineStyle(1, TCOL.edge, 0.75).strokeRect(x, y, bw, bh);
        label.setPosition(x + 8, y).setOrigin(0, 0.5).setVisible(true);
      }
      this.troopsLbl.setVisible(false);
      this.troops.setPosition(PAD + 12, topPad + 16);
      this.stats.setPosition(width - PAD - 12, topPad + 10);
      this.stormText.setPosition(width - PAD - 12, topPad + 50);
      this.layoutResources(PAD + 16, topPad + 80 + (TOP_H - 80) / 2 + 2, (w - 40) / 3);
      this.recruitBtn.setPosition(width - PAD - 6, topPad + 80).setOrigin(1, 0.5).setBackgroundColor(hex(TCOL.bg)); // sul bordo, come un'etichetta
      this.rows.forEach((r, k) => r.setPosition(PAD + (k % 2) * (w / 2) + 26, sy + 14 + Math.floor(k / 2) * 20));
      this.symPos = this.rows.map((r) => ({ x: r.x - 12, y: r.y }));
      P.setFillStyle(TCOL.bg, 0);
      this.rightPanel.setFillStyle(TCOL.bg, 0);
    } else this.notches[0].setText(' esercito ');
    // la cornice disegnata del rettangolo segue la nuova misura
    P.setStrokeStyle(); // il disegno lo fanno i riquadri della pianta
    this.rightPanel.setStrokeStyle();
    this.rate.setPosition(this.troops.x + this.troops.width + 10, this.troops.y + 10);
    this.food.setPosition(this.troops.x, this.troops.y + 36);
    this.fps?.setPosition(PAD, this.topBottom + 6);
    if (this.pauseFrame?.visible) {
      this.drawPauseFrame();
      this.pauseUi?.setPosition(width / 2, this.topBottom + 10);
    }
    this.aliveKey = ''; // forza il ridisegno dei simboli
    // verticale: le carte si stringono per lasciare posto al tasto della velocità a destra
    const sc = portrait ? this.portraitCardScale() : this.dockScale(), step = CARD_W * sc + 6;
    const cy = portrait ? height - PAD - STATUS_H - CARD_H * sc : height - PAD - STATUS_H - DOCK_PAD - 2 - CARD_H * sc, cx0 = portrait ? PAD : PAD + DOCK_PAD;
    this.cards.forEach((c, k) => {
      c.baseY = cy;
      c.setScale(sc).setPosition(cx0 + k * step, c.baseY);
    });
    // abilità: dopo le carte in orizzontale; in verticale a destra, sopra il tasto RITIRATA
    this.abilityCards.forEach((c, k) => {
      c.baseY = portrait ? this.portraitAbilityY() : cy;
      c.setScale(sc).setPosition(portrait ? width - PAD - (k + 1) * step + 6 : cx0 + (this.cards.length + k) * step + 10, c.baseY);
    });
    // leve sopra le carte, nell'angolo in basso a sinistra
    const ly = portrait ? height - PAD - STATUS_H - this.portraitCardH() - 8 - 36 : height - PAD - STATUS_H - CARD_H * sc - 2 * DOCK_PAD - 4 - 12 - 36;
    this.attackBtn?.setPosition(PAD, ly);
    this.workBtn?.setPosition(PAD + 112 + 6, ly);
  }

  /** Orizzontale: niente mazzo, tutte le truppe in campagna; se non stanno, le carte si rimpiccioliscono (a destra restano i tasti). */
  private dockScale(): number {
    const avail = view(this).width - 2 * PAD - (112 + 56 + 56 + 2 * 8) - 24 - 2 * DOCK_PAD - (this.abilityCards.length ? 10 : 0);
    const n = this.cards.length + this.abilityCards.length;
    return Phaser.Math.Clamp((avail - (n - 1) * 6) / (n * CARD_W), 0.6, 1);
  }

  /** Verticale: riga delle abilità, sopra RITIRATA (che sta sulla riga delle leve, sopra le carte). */
  private portraitCardScale(): number {
    const avail = view(this).width - 2 * PAD - 56 - 8; // a destra resta il tasto della velocità
    return Math.min(1, (avail / Math.max(1, this.cards.length) - 6) / CARD_W);
  }

  private portraitCardH(): number {
    return CARD_H * this.portraitCardScale();
  }

  private portraitAbilityY(): number {
    return view(this).height - PAD - STATUS_H - this.portraitCardH() - 8 - 44 - 8 - this.portraitCardH();
  }

  private layoutResources(x: number, y: number, step: number) {
    this.resIcons.clear();
    RESOURCES.forEach((r, k) => {
      drawResourceIcon(this.resIcons, r, x + 4 + k * step, y, 9);
      this.resTexts[k].setPosition(x + 18 + k * step, y);
      this.incTexts[k].setPosition(x + 19 + k * step, y + 13); // entrate al minuto sotto il numero, dentro la barra
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
    if (!this.buildHint && !st.opts.tutorial && st.gameTimeMs > 40_000) {
      this.buildHint = true; // una volta per campagna, se non hai ancora costruito niente
      const msg = 'Tocca una tua provincia per costruire:\nfabbrica, bunker, caserma.';
      if (!st.worksStarted && !this.hint.visible && !this.provCard) {
        this.setHint(msg);
        this.time.delayedCall(8000, () => { if (this.hint.text === msg) this.setHint(null); });
      }
    }
    if (this.profile && (this.profileAcc -= delta) <= 0) {
      this.profileAcc = 1000;
      this.renderProfile();
    }
    if (this.provCard && (this.provCardAcc -= delta) <= 0) { // 2 volte al secondo: vita, cantiere, truppe
      this.provCardAcc = 500;
      this.renderProvince(); // cantiere che avanza, truppe e zaino che cambiano
    }
    this.mapLabels.update(this.run);
    const h = this.hint;
    this.hintBox.setVisible(h.visible).setAlpha(h.alpha).setPosition(h.x - h.width / 2, h.y).setSize(h.width, h.height);
    if (!this.ended) this.guide?.update();
    this.fps?.setText(`${Math.round(this.game.loop.actualFps)} fps`);
    const t = Math.floor(st.troops);
    if (t !== this.shownTroops) {
      this.shownTroops = t;
      this.troops.setText(String(t));
      this.rate.setX(this.troops.x + this.troops.width + 10);
    }
    this.rate.setText(`+${st.troopsPerSecond.toFixed(1)}/s`);
    if (!st.opts.tutorial) {
      const fed = st.backpack.cibo > 0, F = BALANCE.food;
      const up = `+${Math.round((F.fedGrowth - 1) * 100)}%`, down = `−${Math.round((1 - F.hungryGrowth) * 100)}%`;
      // in verticale accanto c'è il tempo della campagna: testo corto
      this.food.setText(this.portrait ? (fed ? `rancio ok ${up}` : `senza cibo ${down}`) : fed ? `rancio ok · crescita ${up}` : `senza cibo · crescita ${down}`)
        .setColor(hex(fed ? PALETTE.radioattivo : PALETTE.ko));
    }
    // classifica per province: a fine campagna vince chi ne ha di più
    const { pos, gap } = st.rank();
    const lead = st.opts.tutorial ? `obiettivo ${BALANCE.tutorial.goalProvinces}` : pos === 1 ? `1° · +${gap} sul 2°` : `${pos}° · ${gap} dal 1°`;
    this.stats.setText(`${st.player.provinces} ${st.player.provinces === 1 ? 'provincia' : 'province'}\n${lead}`);
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
      this.rowIds.forEach((id, k) => { // le milizie non sono nell'elenco
        const f = st.factions[id], info = FACTION_INFO[id];
        const sp = this.symPos[k], up = this.unitPos[k];
        drawSymbol(g, info.symbol, sp.x, sp.y, 6, f.alive ? info.fill : 0x555555, PALETTE.carta);
        const dom = BALANCE.aiUnits.dominant[id] as UnitType | '';
        if (dom && f.alive && up) drawUnitIcon(g, dom, up.x, up.y, 6, PALETTE.ocra);
      });
    }
    this.rowIds.forEach((id, k) => {
      const f = st.factions[id];
      this.rows[k].setText(f.alive ? `${FACTION_INFO[id].short} ${f.provinces}` : `${FACTION_INFO[id].short} ✝`).setAlpha(f.alive ? 1 : 0.4);
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

  /** Diplomazia: dichiarazioni, paci, alleanze, rifiuti, doni. */
  onDiplomacy(f: number, what: DiploWhat, byPlayer: boolean, amount = 0) {
    const who = FACTION_INFO[f]?.name.toUpperCase() ?? 'IL NEMICO';
    if (what === 'war' && !byPlayer) {
      this.banner(`${who} TI DICHIARA GUERRA`, PALETTE.ko, 'i confini non sono più sicuri');
      buzz([40, 30, 40]);
    } else if (what === 'war') this.toast(`GUERRA A ${who}`, PALETTE.ko);
    else if (what === 'peace') this.toast(`PACE CON ${who}`, PALETTE.ocra);
    else if (what === 'alliance') this.banner(`ALLEANZA CON ${who}`, PALETTE.radioattivo, 'non vi attaccherete, vedete insieme');
    else if (what === 'broken') this.toast(`ALLEANZA ROTTA CON ${who}`, PALETTE.allerta);
    else if (what === 'refused') this.toast(`${who} RIFIUTA`, PALETTE.ko);
    else if (what === 'tribute') this.toast(`TRIBUTO DA ${who} · +${amount} risorse`, PALETTE.ocra);
    else if (what === 'gift') this.toast(`DONO A ${who} · opinione in salita`, PALETTE.radioattivo);
    if (this.profileF === f) this.renderProfile();
  }

  /** Un nemico assalta una tua provincia: c'è tempo per rinforzarsi (truppe in cassa, bunker, pedine). */
  onDefending(by: number) {
    this.toast(`${FACTION_INFO[by]?.short ?? 'IL NEMICO'} ASSALTA UNA TUA PROVINCIA\nhai qualche secondo: tieni truppe in cassa`, PALETTE.ko);
  }

  /** La capitale è caduta: i rifornimenti ripartono dalla nuova. */
  onCapital() {
    this.banner('CAPITALE SPOSTATA', PALETTE.allerta, 'la logistica riparte dalla nuova capitale');
  }

  /** Accerchiamento: una sacca si arrende. */
  onEncircled(by: number, from: number, n: number) {
    if (by === PLAYER) this.banner(`ACCERCHIAMENTO · +${n} ${n === 1 ? 'PROVINCIA' : 'PROVINCE'}`, PALETTE.radioattivo, 'la sacca si arrende');
    else if (from === PLAYER) this.toast(`SACCA PERDUTA · ${n} ${n === 1 ? 'provincia' : 'province'} a ${FACTION_INFO[by]?.short ?? '?'}`, PALETTE.ko);
  }

  // ---------- scheda di un impero ----------

  /** Insegna di fazione toccata sulla mappa (punti CSS), −1 se nessuna. */
  tagAt(x: number, y: number): number {
    return this.mapLabels.tagAt(x, y);
  }

  showProfile(f: number) {
    if (f <= 0 || !FACTION_INFO[f]) return;
    this.profileF = f;
    this.hideProvince();
    this.renderProfile();
  }

  hideProfile() {
    this.profile?.destroy();
    this.profile = null;
    this.profileF = -1;
  }

  /** Profilo alla HOI4: chi sono, quanto pesano, che rapporti avete e cosa puoi fare (al massimo quattro scelte). */
  private renderProfile() {
    const st = this.run.state, f = this.profileF, info = FACTION_INFO[f], fac = st.factions[f];
    this.profile?.destroy();
    this.profile = null;
    if (!info || !fac) return;
    const { width, height } = view(this);
    const W = Math.min(380, width - 2 * PAD), H = 300;
    const items: Phaser.GameObjects.GameObject[] = [
      this.add.rectangle(0, 0, W, H, TCOL.bg, 0.97).setOrigin(0).setStrokeStyle(1, TCOL.edge, 0.75),
      termNotch(this, 0, 0, info.kind === 'bot' ? 'Milizia' : 'Impero'),
    ];
    const g = this.add.graphics();
    drawSymbol(g, info.symbol, 22, 26, 9, info.fill, PALETTE.carta);
    items.push(g, this.add.text(40, 14, info.name.toUpperCase(), termStyle(16, PALETTE.carta)).setWordWrapWidth(W - 80));
    const close = this.add.text(W - 10, 8, '✕', termStyle(18, PALETTE.carta)).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on('pointerup', () => this.hideProfile());
    items.push(close);
    const civ = info.civ ? (civText as Record<string, { name: string; regime: string; classe: string }>)[info.civ] : null;
    const kind = info.kind === 'bot' ? 'MILIZIA PROVINCIALE · forza locale, difende la sua zona'
      : `IMPERO · potenza ${civ?.name ?? ''} · ${civ?.regime.toLowerCase() ?? ''}`;
    items.push(this.add.text(14, 46, kind, termStyle(11, PALETTE.tenue, false)).setWordWrapWidth(W - 28));
    if (civ) items.push(this.add.text(14, 64, `classe dirigente: ${civ.classe}`, termStyle(11, PALETTE.tenue, false)).setWordWrapWidth(W - 28));
    // peso militare
    const ratio = fac.troops / Math.max(1, st.troops);
    const force = !fac.alive ? 'eliminati' : ratio > 1.25 ? 'più forti di te' : ratio < 0.8 ? 'più deboli di te' : 'forza pari alla tua';
    const troops = fac.alive ? `≈${Math.max(10, Math.round(fac.troops / 10) * 10)}` : '0';
    items.push(this.add.text(14, 90, `${fac.provinces} ${fac.provinces === 1 ? 'provincia' : 'province'} · truppe ${troops} · ${force}`, termStyle(13, PALETTE.carta)));
    // rapporto e opinione
    const rel = st.relation[f], op = Math.round(st.opinion[f]);
    const relTxt = rel === 'guerra' ? 'IN GUERRA' : rel === 'alleanza' ? 'ALLEATI' : 'IN PACE';
    const relCol = rel === 'guerra' ? PALETTE.ko : rel === 'alleanza' ? PALETTE.radioattivo : PALETTE.ocra;
    items.push(this.add.text(14, 118, relTxt, termStyle(15, relCol)));
    const bx = 120, bw = W - bx - 16, by = 126;
    const bar = this.add.graphics();
    bar.fillStyle(TCOL.bg, 1).fillRect(bx, by, bw, 8).lineStyle(1, PALETTE.carta, 0.6).strokeRect(bx, by, bw, 8).lineBetween(bx + bw / 2, by - 3, bx + bw / 2, by + 11);
    const half = (bw / 2) * Math.min(1, Math.abs(op) / 100);
    bar.fillStyle(op >= 0 ? PALETTE.radioattivo : PALETTE.ko, 1).fillRect(op >= 0 ? bx + bw / 2 : bx + bw / 2 - half, by, half, 8);
    items.push(bar, this.add.text(bx, by + 12, `opinione ${op > 0 ? '+' : ''}${op}`, termStyle(10, PALETTE.tenue, false)));
    // azioni
    const acts: { label: string; color: number; run: () => void }[] = [];
    const D = BALANCE.diplomacy;
    const gift = Math.floor(Math.max(D.donateMin, st.troops * D.donateShare));
    const why = (r: string) => this.toast(r.toUpperCase(), PALETTE.ko);
    if (fac.alive) {
      if (rel === 'guerra') {
        acts.push({ label: 'PROPONI PACE', color: PALETTE.ocra, run: () => {
          const r = st.proposePeace(f);
          if (r === 'cooldown') why('aspetta prima di riproporre');
        } });
      } else {
        acts.push({ label: 'DICHIARA GUERRA', color: PALETTE.ko, run: () => { if (!st.declareWar(f)) why('tregua in corso'); } });
      }
      if (rel === 'pace' && info.kind === 'empire') {
        acts.push({ label: 'PROPONI ALLEANZA', color: PALETTE.radioattivo, run: () => {
          const r = st.proposeAlliance(f);
          if (r === 'opinion') why(`serve opinione +${D.allyOpinion}: fai un dono`);
          else if (r === 'cooldown') why('aspetta prima di riproporre');
        } });
      }
      if (rel === 'alleanza') acts.push({ label: 'ROMPI ALLEANZA', color: PALETTE.allerta, run: () => st.breakAlliance(f) });
      acts.push({ label: `DONA ${gift} TRUPPE`, color: PALETTE.carta, run: () => { if (!st.donateTroops(f)) why('truppe insufficienti'); } });
      if (info.kind === 'bot') {
        acts.push({ label: 'CHIEDI TRIBUTO', color: PALETTE.ocra, run: () => {
          if (st.diploBlock(f) === 'cooldown') return why('aspetta prima di riproporre');
          st.demandTribute(f);
        } });
      } else {
        acts.push({ label: `DONA ${D.donateLoot} RISORSE`, color: PALETTE.carta, run: () => { if (!st.donateLoot(f)) why('zaino troppo vuoto'); } });
      }
    }
    const cw = (W - 28 - 8) / 2, ch = 40;
    acts.slice(0, 4).forEach((a, k) => {
      const x = 14 + (k % 2) * (cw + 8), y = 160 + Math.floor(k / 2) * (ch + 8);
      const r = this.add.rectangle(x, y, cw, ch, TCOL.bg).setOrigin(0).setStrokeStyle(1, TCOL.edge, 0.75).setInteractive({ useHandCursor: true });
      r.on('pointerover', () => r.setFillStyle(TCOL.hover)).on('pointerout', () => r.setFillStyle(TCOL.bg));
      r.on('pointerup', () => { a.run(); buzz(10); this.renderProfile(); });
      items.push(r, this.add.text(x + cw / 2, y + ch / 2, a.label, termStyle(12, a.color)).setOrigin(0.5));
    });
    items.push(this.add.text(14, H - 34, 'In pace non vi attaccate. Tieni premuto su una provincia per aprire la sua scheda.', termStyle(9, PALETTE.tenue, false)).setWordWrapWidth(W - 28));
    this.profile = this.add.container((width - W) / 2, Math.max(PAD, (height - H) / 2), items).setDepth(46);
  }

  onEliminated(faction: number, by: number, loot: Bag) {
    if (faction === PLAYER) return;
    if (by !== PLAYER && FACTION_INFO[faction]?.kind === 'bot') return; // milizie spazzate via altrove: niente avvisi
    const who = FACTION_INFO[faction].name.toUpperCase();
    const got = bagTotal(loot);
    const msg = by === PLAYER
      ? `${who} ELIMINATI${got ? `\n+${got} risorse dal loro bottino` : ''}`
      : `${who} SPAZZATI VIA DA ${FACTION_INFO[by]?.short ?? 'NESSUNO'}`;
    this.toast(msg, by === PLAYER ? PALETTE.radioattivo : PALETTE.ocra);
  }

  /** Ultimo minuto di campagna. */
  onTimer() {
    this.toast('ULTIMO MINUTO\nallo scadere vince chi ha più province', PALETTE.allerta);
  }

  /** Bigliettino dalla mappa (gruppi, muro, comandi delle pedine). */
  notify(msg: string, color: number) {
    this.toast(msg.toUpperCase(), color);
  }

  /** Coalizione degli imperi contro di te: si forma o si scioglie. */
  onCoalition(phase: 'form' | 'end', members: number[]) {
    if (phase === 'form') {
      this.banner('COALIZIONE CONTRO DI TE', PALETTE.ko, `${members.map((m) => FACTION_INFO[m]?.short ?? '?').join(' · ')} smettono di combattersi`);
      buzz([40, 30, 40]);
    } else this.toast('COALIZIONE SCIOLTA\nil tuo vantaggio è calato, gli imperi tornano rivali', PALETTE.ocra);
  }

  /** Un impero bombarda una tua provincia di confine. */
  onEnemyStrike(by: number) {
    this.toast(`BOMBARDAMENTO ${FACTION_INFO[by]?.short ?? 'NEMICO'} IN ARRIVO\nsposta le pedine · la contraerea lo ferma`, PALETTE.ko);
  }

  /** Tasto MURO acceso o spento. */
  setWallOn(on: boolean) {
    this.wallBtn.setOn(on);
  }

  /** Previsione dell'assalto accanto alla provincia sotto il mouse (punti CSS). */
  showForecast(p: number, x: number, y: number) {
    const st = this.run.state, f = st.forecast(p), o = st.provOwner[p];
    const key = `${p}|${f.cost}|${f.odds}|${Math.round(x)}|${Math.round(y)}`;
    if (key === this.forecastKey) return;
    this.forecastKey = key;
    this.forecast?.destroy();
    const col = { sicura: PALETTE.radioattivo, probabile: PALETTE.radioattivo, incerta: PALETTE.allerta, difficile: PALETTE.ko }[f.odds];
    const head = o === NEUTRAL ? `PRENDI · ${f.cost} truppe · subito` : `ASSALTO · ${f.cost} truppe · ${Math.ceil(f.ms / 1000)} s`;
    const odds = !f.can ? `servono ${f.cost + 1} truppe (ne hai ${Math.floor(st.troops)})` : `esito: ${f.odds}`;
    const t1 = this.add.text(8, 6, head, termStyle(11, TCOL.text)), t2 = this.add.text(8, 22, odds, termStyle(11, col));
    const w = Math.max(t1.width, t2.width) + 16, h = 42;
    const bg = this.add.rectangle(0, 0, w, h, TCOL.bg, 0.94).setOrigin(0).setStrokeStyle(1, TCOL.edge, 0.75);
    const { width } = view(this);
    this.forecast = this.add.container(Math.min(x + 18, width - w - PAD), y - h - 10, [bg, t1, t2]).setDepth(44);
  }

  hideForecast() {
    if (!this.forecast) return;
    this.forecast.destroy();
    this.forecast = null;
    this.forecastKey = '';
  }

  /** Bigliettini impilati nell'angolo in alto a destra, sotto le potenze (il più nuovo in cima); in verticale al centro. */
  private toast(msg: string, color: number) {
    const { width } = view(this);
    const w = this.portrait ? width - 2 * PAD : Math.min(300, width / 3);
    const n = termNote(this, this.portrait ? width / 2 : width - PAD, this.topBottom + (this.portrait ? 64 : 90), w, msg, color, this.portrait ? 0.5 : 1).setDepth(45).setAlpha(0);
    this.notes.unshift(n);
    this.layoutNotes();
    n.x += 16;
    this.tweens.add({ targets: n, alpha: 1, x: n.x - 16, duration: 200, ease: 'Quad.easeOut' });
    this.time.delayedCall(3000, () => this.tweens.add({ targets: n, alpha: 0, duration: 400, onComplete: () => {
      this.notes = this.notes.filter((o) => o !== n);
      n.destroy();
      this.layoutNotes();
    } }));
  }

  private layoutNotes() {
    let y = this.topBottom + (this.portrait ? 64 : 90);
    this.notes = this.notes.slice(0, 4); // al massimo quattro alla volta: i più vecchi spariscono
    for (const n of this.notes) {
      if (!n.active) continue;
      this.tweens.add({ targets: n, y, duration: 160 });
      y += n.height + 12;
    }
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
    const t = this.add.text(width / 2, height * 0.36, title, termStyle(34, color)).setOrigin(0.5).setDepth(40);
    const s2 = this.add.text(width / 2, height * 0.36 + 32, sub.toUpperCase(), termStyle(14, PALETTE.carta)).setOrigin(0.5)
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
      victory: reason === 'time' ? 'IL CAMPO È TUO' : reason === 'tutorial' ? 'PRIMA VITTORIA!' : 'IMPERO!',
      retreat: 'RITIRATA',
      eliminated: 'ELIMINATO',
      timeout: 'FINE DELLE OPERAZIONI',
    }[outcome];
    const color = outcome === 'victory' ? PALETTE.radioattivo : outcome === 'retreat' ? PALETTE.ocra : PALETTE.ko;
    const t = this.add.text(width / 2, height / 2, title, termStyle(40, color)).setOrigin(0.5)
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
    const title = this.add.text(0, 0, '❚❚  PAUSA STRATEGICA', termStyle(17, PALETTE.ocra)).setOrigin(0.5, 0);
    const sub = this.add.text(0, 26, 'il tempo è fermo · tocca le province per il piano · muovi le pedine', termStyle(11, PALETTE.carta, false))
      .setOrigin(0.5, 0).setAlign('center').setWordWrapWidth(Math.min(460, width - 40));
    const w = Math.max(title.width, sub.width) + 28;
    const bg = this.add.rectangle(0, -8, w, sub.y + sub.height + 16, TCOL.bg, 0.94).setOrigin(0.5, 0).setStrokeStyle(1, TCOL.edge, 0.75);
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

  /** Selezione alla Call of War: provincia (qualsiasi) o pedina; `open` mostra subito le costruzioni di una tua provincia. */
  showProvince(p: number, open = true) {
    this.provCardP = p;
    this.selUnit = -1;
    this.provOpen = open;
    this.provCardAcc = 500;
    this.renderProvince();
  }

  showUnit(id: number) {
    this.provCardP = -1;
    this.selUnit = id;
    this.provCardAcc = 500;
    this.renderProvince();
  }

  /** Chiude la scheda in basso se mostra una pedina (dopo un ordine o una deselezione). */
  hideUnit() {
    if (this.selUnit >= 0) this.hideProvince();
  }

  hideProvince() {
    this.provCard?.destroy();
    this.provCard = null;
    this.provCardP = -1;
    this.selUnit = -1;
    this.setBottomVisible(true);
  }

  /** Con la tabella aperta in fondo (alla Call of War) le carte e le leve si fanno da parte; in verticale anche i tasti. */
  private setBottomVisible(on: boolean) {
    const list: (Phaser.GameObjects.Components.Visible | null | undefined)[] = [...this.cards, ...this.abilityCards, this.attackBtn, this.workBtn];
    if (!this.portrait) list.push(this.dockG, this.notches[3]);
    if (this.portrait) list.push(this.retreatBtn, this.speedBtn, this.seed);
    for (const o of list) o?.setVisible(on);
  }

  refreshProvince() {
    if (this.provCardP >= 0 || this.selUnit >= 0) this.renderProvince();
  }

  /**
   * Tabella in basso alla Call of War: intestazione (padrone, nazione, terreno), una riga di dati a celle e le azioni.
   * Le tue province aprono anche le sette costruzioni.
   */
  private renderProvince() {
    const st = this.run.state, p = this.provCardP;
    this.provCard?.destroy();
    this.provCard = null;
    if (st.over || (p < 0 && this.selUnit < 0)) return void this.hideProvince();
    const unit = this.selUnit >= 0 ? st.units.find((u) => u.id === this.selUnit) : undefined;
    if (this.selUnit >= 0 && !unit) return void this.hideProvince(); // la pedina non c'è più
    const { width, height } = view(this);
    const W = Math.min(560, width - 2 * PAD - (this.portrait ? 0 : 252));
    const own = !unit && st.provOwner[p] === PLAYER;
    const ready = own ? st.workOf(p) : null, prog = own ? st.workInProgress(p) : null;
    const grid = own && this.provOpen && !ready && !prog;
    // previsione dell'assalto (province attaccabili che vedi)
    const fc = !unit && p >= 0 && st.provOwner[p] !== PLAYER && (st.seesProv(p) || st.provOwner[p] === NEUTRAL) && st.isFrontierProv(p) ? st.forecast(p) : null;
    const mineUnit = !!unit && unit.owner === PLAYER;
    // celle dei dati: su una riga se c'è posto, altrimenti su due (telefono in verticale)
    const nCells = unit ? 7 : 5 + (st.provOwner[p] > PLAYER && st.seesProv(p) ? 1 : 0) + (fc ? 1 : 0);
    // una riga se ogni cella ha almeno 86 punti (le etichette lunghe come "rifornimento" ci stanno), altrimenti righe da tre o quattro
    const perRow = (W - 24) / nCells >= 86 ? nCells : W - 24 >= 344 ? Math.min(nCells, 4) : Math.min(nCells, 3), rows = Math.ceil(nCells / perRow);
    const cellsY = 34, cellH = 42, actY = cellsY + rows * cellH + 8;
    const gCols = W - 24 >= 480 ? 4 : 3, gRows = Math.ceil(WORKS.length / gCols);
    // comandi della pedina: una riga di cinque tasti, o due righe se lo schermo è stretto
    const uPer = (W - 24 - 4 * 6) / 5 >= 64 ? 5 : 3, uRows = Math.ceil(5 / uPer);
    const H = grid ? actY + gRows * 62 + (gRows - 1) * 6 + 10 : mineUnit ? actY + uRows * 38 + 26 : actY + 40;
    // in fondo allo schermo come in Call of War: in orizzontale a sinistra (a destra restano RITIRATA, pausa e velocità)
    const bottom = height - PAD - STATUS_H; // sopra la barra di stato della carta
    const left = this.portrait ? (width - W) / 2 : PAD;
    this.setBottomVisible(false);
    const items: Phaser.GameObjects.GameObject[] = [
      this.add.rectangle(0, 0, W, H, TCOL.bg, 0.96).setOrigin(0).setStrokeStyle(1, TCOL.edge, 0.75),
    ];
    const g = this.add.graphics();
    items.push(termNotch(this, 0, 0, unit ? 'Reparto' : own ? 'Tua provincia' : 'Provincia'));
    const close = this.add.text(W - 10, 6, '✕', termStyle(16, PALETTE.carta)).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on('pointerup', () => this.hideProvince());
    const cells = (list: { k: string; v: string; c?: number }[]) => {
      const cw = (W - 24) / perRow;
      list.forEach((c, i) => {
        const col = i % perRow, x = 12 + col * cw, y = cellsY + Math.floor(i / perRow) * cellH;
        if (col) dots(g, x - 2, y + 6, x - 2, y + cellH - 6);
        items.push(this.add.text(x + 4, y + 4, c.k.toLowerCase(), termLabel(10)),
          this.add.text(x + 4, y + 20, c.v, termStyle(12, c.c ?? PALETTE.carta)).setWordWrapWidth(cw - 8).setMaxLines(1));
      });
      for (let r = 1; r < rows; r++) dots(g, 16, cellsY + r * cellH, W - 16, cellsY + r * cellH);
      g.lineStyle(1, PALETTE.carta, 0.6).strokeRect(12, cellsY, W - 24, rows * cellH);
    };
    const action = (label: string, color: number, x: number, w: number, run: () => void, y = actY) => {
      const r = this.add.rectangle(x, y, w, 32, TCOL.bg).setOrigin(0).setStrokeStyle(1, TCOL.edge, 0.75).setInteractive({ useHandCursor: true });
      r.on('pointerover', () => r.setFillStyle(TCOL.hover)).on('pointerout', () => r.setFillStyle(TCOL.bg));
      r.on('pointerup', () => { run(); buzz(10); });
      items.push(r, this.add.text(x + w / 2, y + 16, label, termStyle(11, color)).setOrigin(0.5));
    };

    if (unit) {
      // pedina: chi è, quanto è messa, cosa batte
      const U = BALANCE.units[unit.type], info = unitInfo(unit.type), mine = unit.owner === PLAYER, F = FACTION_INFO[unit.owner];
      const group = mine ? this.run.selectedUnits() : [];
      drawUnitIcon(g, unit.type, 22, 18, 8, F?.fill ?? PALETTE.carta);
      const size = unit.size > 1 ? ` ×${unit.size}` : '', many = group.length > 1 ? ` · ${group.length} selezionate` : '';
      items.push(this.add.text(38, 9, `${info.name.toUpperCase()}${size} · ${mine ? 'TUA' : (F?.short ?? 'NEMICA')}${many}`, termStyle(13, PALETTE.carta)));
      const pct = unit.hp / unit.maxHp, sup = unit.supply;
      const beats = info.beats.map((b) => unitInfo(b).short.toLowerCase()).join(', ') || '—';
      const front = mine && unit.front >= 0 ? `fronte ${FACTION_INFO[unit.front]?.short.toLowerCase() ?? ''}` : '';
      cells([
        { k: 'VITA', v: `${Math.ceil(unit.hp)}/${Math.round(unit.maxHp)}`, c: pct > 0.5 ? PALETTE.radioattivo : pct > 0.25 ? PALETTE.allerta : PALETTE.ko },
        { k: 'ATTACCO', v: String(U.attack * unit.size) },
        { k: 'GITTATA', v: String(U.range) },
        { k: 'PASSO', v: `${(U.moveMs / 1000).toFixed(1).replace('.', ',')} s` },
        { k: 'RIFORNIMENTO', v: sup < BALANCE.unitOps.attritionBelow ? `${Math.round(sup * 100)}% · si logora` : `${Math.round(sup * 100)}%`,
          c: sup >= BALANCE.unitOps.healMinSupply ? PALETTE.radioattivo : sup >= BALANCE.unitOps.attritionBelow ? PALETTE.allerta : PALETTE.ko },
        { k: 'BATTE', v: beats },
        { k: 'STATO', v: unit.inCombat ? 'combatte' : st.battles.some((b) => b.unit === unit.id) ? 'assedio' : unit.path.length ? 'in marcia' : front || 'ferma',
          c: unit.inCombat ? PALETTE.ko : PALETTE.carta },
      ]);
      if (!mine) items.push(this.add.text(12, actY + 8, 'Pedina nemica: schiera chi la batte.', termStyle(10, PALETTE.tenue, false)));
      else {
        // comandi: comportamento, fronte, unisci, dividi, ritirata (valgono per tutte le pedine selezionate)
        const att = group.length ? group.every((u) => u.stance === 'attacca') : unit.stance === 'attacca';
        const bw = (W - 24 - (uPer - 1) * 6) / uPer;
        const acts: [string, number, 'stance' | 'front' | 'merge' | 'split' | 'retreat'][] = [
          [att ? 'ATTACCA' : 'DIFENDE', att ? PALETTE.allerta : PALETTE.carta, 'stance'], ['FRONTE', PALETTE.ocra, 'front'],
          ['UNISCI', PALETTE.carta, 'merge'], ['DIVIDI', unit.size > 1 ? PALETTE.carta : PALETTE.tenue, 'split'], ['RITIRATA', PALETTE.ocra, 'retreat'],
        ];
        acts.forEach(([label, col, kind], k) => action(label, col, 12 + (k % uPer) * (bw + 6), bw, () => this.run.unitAction(kind), actY + Math.floor(k / uPer) * 38));
        items.push(this.add.text(12, actY + uRows * 38, 'T comportamento · F fronte · U unisci · I dividi · R ritirata',
          termStyle(9, PALETTE.tenue, false)).setWordWrapWidth(W - 24).setMaxLines(1));
      }
    } else {
      const prov = st.map.provinces[p], o = st.provOwner[p], T = BALANCE.terrain[prov.terrain];
      const seen = o === PLAYER || st.seesProv(p);
      const nation = st.map.nations.find((n) => n.id === prov.country)?.name ?? 'Terra di nessuno';
      const terrainName = { pianura: 'pianura', colline: 'colline', montagne: 'montagne', deserto: 'deserto' }[prov.terrain];
      const resName = RESOURCE_INFO[T.res].name.toLowerCase();
      const F = o >= 0 ? FACTION_INFO[o] : null;
      const ownerName = !seen && o !== PLAYER ? 'sconosciuto' : o === PLAYER ? 'TU' : F ? F.name : 'terra libera';
      if (seen && F) drawSymbol(g, F.symbol, 20, 18, 7, F.fill, PALETTE.carta);
      items.push(this.add.text(seen && F ? 34 : 12, 9, `${nation.toUpperCase()} · ${terrainName.toUpperCase()}`, termStyle(13, PALETTE.carta)));
      const rel = o > PLAYER && seen ? st.relation[o] : null;
      const work = ready ? WORK_NAME[ready] : prog ? `cantiere ${mmss(prog.leftMs)}` : (() => { const w = st.workOf(p); return w ? WORK_NAME[w] : '—'; })();
      const cost = o === PLAYER ? 0 : st.provCost(PLAYER, p);
      cells([
        { k: 'PADRONE', v: ownerName, c: o === PLAYER ? PALETTE.radioattivo : F && seen ? F.fill : PALETTE.carta },
        ...(rel ? [{ k: 'RAPPORTO', v: rel === 'guerra' ? 'in guerra' : rel === 'alleanza' ? 'alleati' : 'in pace', c: rel === 'guerra' ? PALETTE.ko : PALETTE.ocra }] : []),
        { k: 'DIFESA', v: seen || o === NEUTRAL ? String(st.provDefense(p)) : '?' },
        { k: 'PRODUCE', v: `${st.provPerMin(p).toFixed(1).replace('.', ',')} ${resName}/min` },
        { k: 'COSTRUZIONE', v: work, c: prog ? PALETTE.allerta : PALETTE.carta },
        o === PLAYER ? { k: 'RIFORNIMENTO', v: `${Math.round(st.supply[p] * 100)}%${st.capitalProv[PLAYER] === p ? ' · capitale' : ''}`,
          c: st.supply[p] >= 0.95 ? PALETTE.radioattivo : st.supply[p] >= 0.6 ? PALETTE.allerta : PALETTE.ko }
          : { k: 'PER PRENDERLA', v: seen || o === NEUTRAL ? `${cost} truppe` : '?', c: st.troops > cost ? PALETTE.radioattivo : PALETTE.ko },
        ...(fc ? [{ k: 'ESITO', v: fc.can ? fc.odds : 'mancano truppe', c: fc.odds === 'incerta' ? PALETTE.allerta : fc.odds === 'difficile' ? PALETTE.ko : PALETTE.radioattivo }] : []),
      ]);
      if (own && !grid) {
        if (ready || prog) items.push(this.add.text(12, actY + 8, ready ? workDesc(ready, resName) : 'Cantiere aperto: la costruzione resta alla provincia.', termStyle(11, PALETTE.carta, false)));
        else action('COSTRUISCI ▸', PALETTE.ocra, 12, 160, () => { this.provOpen = true; this.renderProvince(); });
      } else if (!own && st.battleAt(p)) {
        const b = st.battleAt(p)!, left = Math.max(0, Math.ceil((b.endMs - st.gameTimeMs) / 1000));
        items.push(this.add.text(12, actY + 8, `ASSALTO IN CORSO · ${left} s · ${b.by === PLAYER ? `${b.troops} truppe impegnate` : 'nemico all\'attacco'}`, termStyle(11, PALETTE.allerta)));
      } else if (!own) {
        const atWar = st.atWar(PLAYER, o);
        if (atWar && st.isFrontierProv(p)) action(`${o === NEUTRAL ? 'PRENDI' : 'ASSALTA'} · ${cost} TRUPPE`, st.troops > cost ? PALETTE.radioattivo : PALETTE.ko, 12, 200, () => this.run.tapProvince(p));
        if (o > PLAYER && seen) action('SCHEDA ›', PALETTE.ocra, W - 12 - 120, 120, () => this.showProfile(o));
      }
      if (grid) {
        // costruzioni su più righe: icona, nome, effetto, prezzo in truppe e metallo
        const cols = gCols, bw = (W - 24 - (cols - 1) * 6) / cols, bh = 62;
        WORKS.forEach((w, k) => {
          const D = BALANCE.works[w], block = st.workBlock(p, w), x = 12 + (k % cols) * (bw + 6), y = actY + Math.floor(k / cols) * (bh + 6);
          const price = st.workPrice(w);
          const bg = this.add.rectangle(x, y, bw, bh, TCOL.bg).setOrigin(0).setStrokeStyle(1.2, PALETTE.carta, block ? 0.25 : 0.8)
            .setInteractive({ useHandCursor: true });
          const ig = this.add.graphics();
          drawWorkIcon(ig, w, x + 12, y + 13, 7, block ? PALETTE.tenue : PALETTE.ocra);
          const name = this.add.text(x + 24, y + 6, WORK_NAME[w].toUpperCase(), termStyle(10, block ? PALETTE.tenue : PALETTE.carta));
          const lock = block === 'tech' ? `🔒 ${techInfo(D.tech).name}` : block === 'coast' ? 'solo sul mare' : workDesc(w, resName);
          const sub = this.add.text(x + 6, y + 23, lock, termStyle(9, PALETTE.carta, false)).setWordWrapWidth(bw - 10);
          const priceTxt = this.add.text(x + 6, y + bh - 4, `${price} truppe`, termStyle(9, block === 'troops' ? PALETTE.ko : PALETTE.tenue, false))
            .setOrigin(0, 1);
          // metallo dallo zaino: lingotto + quantità, in basso a destra
          const metal = st.workMetal(w), hidden = block === 'tech' || block === 'coast';
          const metalTxt = this.add.text(x + bw - 6, y + bh - 4, String(metal), termStyle(9, block === 'metal' ? PALETTE.ko : PALETTE.tenue, false)).setOrigin(1, 1);
          if (hidden) priceTxt.setVisible(false);
          if (hidden || !metal) metalTxt.setVisible(false);
          else drawResourceIcon(ig, 'metallo', x + bw - 12 - metalTxt.width, y + bh - 10, 4);
          bg.on('pointerup', () => {
            const now = st.workBlock(p, w); // lo stato può essere cambiato dopo il disegno della scheda
            if (now) {
              const why = now === 'tech' ? `serve la ricerca ${techInfo(D.tech).name}` : now === 'troops' ? `servono ${st.workPrice(w)} truppe`
                : now === 'metal' ? `servono ${st.workMetal(w)} metallo nello zaino`
                : now === 'busy' ? 'c\'è già una costruzione' : now === 'coast' ? 'il porto va sul mare' : 'provincia non tua';
              return this.toast(why.toUpperCase(), PALETTE.ko);
            }
            if (st.build(PLAYER, p, w)) {
              analytics.design(['costruzione', w]);
              this.toast(`${WORK_NAME[w].toUpperCase()} IN COSTRUZIONE · ${Math.round(D.timeMs / 1000)} s`, PALETTE.ocra);
              buzz(12);
            }
            this.renderProvince();
          });
          items.push(bg, ig, name, sub, priceTxt, metalTxt);
        });
      }
    }
    items.push(g, close);
    this.provCard = this.add.container(left, bottom - H, items).setDepth(45);
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
    if (this.profile && inRect(this.profile.list[0] as Phaser.GameObjects.Rectangle, this.profile.x, this.profile.y)) return true;
    if (this.help && inRect(this.help.list[0] as Phaser.GameObjects.Rectangle, this.help.x, this.help.y)) return true;
    const btns = [this.speedBtn, this.pauseBtn, this.retreatBtn, this.logiBtn, this.helpBtn, this.wallBtn, ...this.cards, ...this.abilityCards, this.attackBtn, this.workBtn].filter((b) => b !== null);
    return btns.some((b) => b.visible && b.contains(x, y));
  }
}
