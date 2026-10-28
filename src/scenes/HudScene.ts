import Phaser from 'phaser';
import { BALANCE, type Resource, type UnitType, type WorkId } from '../config/balance';
import { PALETTE, TERRAIN_VIEW, hex } from '../config/palette';
import { BUILDABLE, NEUTRAL, PLAYER, WORKS, type DiploWhat, type Outcome, type VictoryReason } from '../game/RunState';
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
import { Button } from '../ui/Button';
import { AbilityCard, CARD_H, CARD_W, UnitCard } from '../ui/UnitCard';
import { MapLabels } from '../render/MapLabels';
import { drawResourceIcon } from '../ui/resourceIcons';
import { UI, safeInsets, uiCamera, view } from '../ui/screen';
import { drawSymbol } from '../ui/symbols';
import { TCOL, termBox, termLabel, termNotch, termNote, termStyle } from '../ui/terminal';
import { drawUnitIcon } from '../ui/unitIcons';
import { unitInfo } from '../game/units';
import type { RunScene } from './RunScene';

const ABIL_GAP = 14; // stacco tra il riquadro dei reparti e quello delle abilità
const PAD = 12;
const LEFT_W = 300;
const LEFT_H = 148;
const RIGHT_W = 180;
const BAR_H = 74; // orizzontale: barra in alto (truppe, obiettivi, tempo, bottino)
const ROW_H = 22; // righe delle potenze: abbastanza alte da toccare
const TOP_H = 140; // verticale: altezza dei riquadri in alto (esercito e fronte + bottino)
const STATUS_H = 0; // barra di stato della carta tolta (Nico): niente spazio riservato in fondo
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
  private pauseBtn!: Button;
  /** Pausa strategica: cornice + cartello, la mappa resta comandabile. */
  private pauseUi: Phaser.GameObjects.Container | null = null;
  /** Scheda della provincia toccata (terreno, produzione, costruzioni). */
  private provCard: Phaser.GameObjects.Container | null = null;
  private provCardP = -1;
  /** Provincia mostrata nella scheda in basso (−1 = nessuna). */
  get cardProvince(): number {
    return this.provCard ? this.provCardP : -1;
  }
  private buildHint = false;
  private profile: Phaser.GameObjects.Container | null = null;
  private profileF = -1;
  private profileAcc = 0;
  private provCardAcc = 0;
  private provKey = '';
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
  private troopIcon!: Phaser.GameObjects.Image;
  private clockIcon!: Phaser.GameObjects.Image;
  private medalBtn!: Button; // al posto del riquadro territorio (Nico): apre province, classifica e fine campagna
  private medalPanel: Phaser.GameObjects.Container | null = null;
  private medalAcc = 0;
  private symPos: { x: number; y: number }[] = [];
  private unitPos: ({ x: number; y: number } | null)[] = [];
  private topBottom = PAD + LEFT_H; // dove finisce l'HUD in alto
  private nextBannerAt = 0;
  private eventCard: EventCard | null = null;
  private guide: TutorialGuide | null = null;
  private fps: Phaser.GameObjects.Text | null = null;
  /** Orizzontale: riquadri della pianta (fondo ardesia, filo avorio) con l'etichetta in corsivo sul bordo. */
  private frames!: Phaser.GameObjects.Graphics;
  private notches: Phaser.GameObjects.Text[] = [];
  private notes: Phaser.GameObjects.Container[] = [];
  private dockG!: Phaser.GameObjects.Graphics;
  private mapBtn!: Button;
  private menu: Phaser.GameObjects.Container | null = null; // tendina di MAPPA o COSTRUISCI
  private menuOf: 'mappa' | 'costruisci' | null = null;
  private legend: Phaser.GameObjects.Container | null = null; // legenda della vista del terreno
  private help: Phaser.GameObjects.Container | null = null;
  private hintBox!: Phaser.GameObjects.Rectangle;
  private buildBtn!: Button;
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
    this.notches = ['Esercito', 'Fronte', 'Potenze', 'Reparti', 'Abilità'].map((t) => termNotch(this, 0, 0, t));
    this.troopsLbl = this.add.text(0, 0, 'TRUPPE', termStyle(11, PALETTE.ocra));
    this.troops = this.add.text(0, 0, '0', termStyle(28, PALETTE.carta));
    this.troopIcon = this.add.image(0, 0, 'ico-truppe').setDisplaySize(20, 20).setOrigin(0, 0.5); // uomini dell'esercito
    this.rate = this.add.text(0, 0, '', termStyle(11, PALETTE.radioattivo));
    this.food = this.add.text(0, 0, '', termStyle(11, PALETTE.radioattivo)).setVisible(false); // rancio: tolto dalla barra (Nico: non si capiva)
    this.stats = this.add.text(0, 0, '', termStyle(13, PALETTE.carta)).setLineSpacing(2);
    this.resIcons = this.add.graphics();
    // bottino: icone e numeri grandi, ognuno nel colore della sua risorsa
    this.resTexts = RESOURCES.map(() => this.add.text(0, 0, '0', termStyle(16, PALETTE.carta)).setOrigin(0, 0.5)); // valori: bianco (l'icona dice quale risorsa)
    const stake = bagTotal(this.run.state.opts.stake);
    this.resLabel = this.add.text(0, 0, stake ? ` bottino · puntata ${stake} ` : ' bottino ', termLabel(11))
      .setBackgroundColor(hex(TCOL.bg));
    // entrate al minuto sotto ogni risorsa: si vede cosa rende l'impero
    this.incTexts = RESOURCES.map(() => this.add.text(0, 0, '', termStyle(11, PALETTE.radioattivo, false)).setOrigin(0, 0));
    this.stormText = this.add.text(0, 0, '', termStyle(11, PALETTE.ocra));
    this.clockIcon = this.add.image(0, 0, 'ico-tempo').setDisplaySize(12, 12).setOrigin(0, 0.5).setTint(TCOL.label).setVisible(!this.run.state.opts.tutorial);

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
    this.cards = this.run.state.opts.units.map((t) => new UnitCard(this, t, () => this.onCard(t)));
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
    // in alto a destra (Nico): MAPPA (viste della carta: politica, terreno, logistica) e COSTRUISCI (scegli l'edificio e
    // trascini sulle tue province, come il vecchio muro). I comandi restano sul tasto H.
    this.mapBtn = new Button(this, 'MAPPA', 124, 32, () => this.toggleMenu('mappa'), 12, { icon: 'ico-mappa' });
    this.buildBtn = new Button(this, 'COSTRUISCI', 124, 32, () => this.toggleBuildMenu(), 12, { icon: 'ico-costruisci' });
    this.buildBtn.setVisible(!this.run.state.opts.tutorial);
    this.medalBtn = new Button(this, '', 44, 44, () => this.toggleMedal(), 22, { icon: 'ico-medaglia' });
    this.medalPanel = null;
    this.menu = null;
    this.menuOf = null;
    this.legend = null;
    this.help = null;
    this.forecast = null;
    for (const b of [this.speedBtn, this.retreatBtn, this.pauseBtn, this.mapBtn, this.buildBtn, this.medalBtn]) b.terminal();
    this.input.keyboard?.on('keydown-L', () => this.toggleLogistics());
    this.input.keyboard?.on('keydown-H', () => this.toggleHelp());
    this.input.keyboard?.on('keydown-ESC', () => { if (this.help) this.toggleHelp(); this.closeMenu(); });
    // tocco fuori dalla tendina (e fuori dai suoi tasti): si chiude
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const m = this.menu;
      if (!m) return;
      const r = m.list[0] as Phaser.GameObjects.Rectangle, x = p.x / UI(), y = p.y / UI(); // punti CSS
      const inMenu = x >= m.x && x <= m.x + r.width && y >= m.y && y <= m.y + r.height;
      if (!inMenu && !this.mapBtn.contains(x, y) && !this.buildBtn.contains(x, y)) this.closeMenu();
    });
    this.pauseUi = null;
    this.pauseFrame = this.add.graphics().setDepth(39).setVisible(false);
    // PC: barra spaziatrice (o P) = pausa strategica, come in HOI4
    this.input.keyboard?.on('keydown-SPACE', () => this.togglePause());
    this.input.keyboard?.on('keydown-P', () => this.togglePause());
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

  /** Vista logistica col tasto L: le tue province colorate dal rifornimento (verde pieno, giallo in calo, rosso tagliate fuori). */
  private toggleLogistics() {
    this.setMapMode(this.run.mapMode === 'logistica' ? 'politica' : 'logistica');
  }

  private setMapMode(m: 'politica' | 'terreno' | 'logistica') {
    this.run.setMapMode(m);
    this.mapBtn.setOn(m !== 'politica');
    this.setHint(m === 'logistica' ? 'LOGISTICA · verde: rifornite · giallo: in calo · rosso: tagliate fuori dalla capitale' : null);
    this.legend?.destroy();
    this.legend = m === 'terreno' ? this.terrainLegend() : null;
  }

  /** Legenda della vista del terreno: un campione a puntini (pieno o a righe, come sulla carta) e il nome. */
  private terrainLegend(): Phaser.GameObjects.Container {
    const rows = Object.values(TERRAIN_VIEW), W = 150, RH = 24, top = 22, H = top + rows.length * RH + 6;
    const g = this.add.graphics();
    termBox(g, 0, 0, W, H, 0.95);
    const items: Phaser.GameObjects.GameObject[] = [g, termNotch(this, 0, 0, 'terreno')];
    rows.forEach((r, i) => {
      const y = top + i * RH, col = Phaser.Display.Color.HexStringToColor(r.col).color;
      g.fillStyle(col, 1);
      for (let Y = 0; Y < 5; Y++) for (let X = 0; X < 10; X++) {
        if (r.stripe && (r.stripe === 1 ? X + Y : X - Y + 40) % 4 >= 2) continue;
        g.fillRect(12 + X * 3, y + 2 + Y * 3, 1.6, 1.6);
      }
      items.push(this.add.text(52, y + 8, r.name, termStyle(13, TCOL.text)).setOrigin(0, 0.5));
    });
    return this.add.container(PAD, this.topBottom + 10, items).setDepth(40);
  }

  /** Medaglia: apre/chiude il pannello con province, classifica e fine campagna. */
  private toggleMedal() {
    if (this.medalPanel) { this.medalPanel.destroy(); this.medalPanel = null; this.medalBtn.setOn(false); return; }
    this.openMedal();
    this.medalBtn.setOn(true);
  }

  private openMedal() {
    this.medalPanel?.destroy();
    const st = this.run.state, { pos, gap } = st.rank(), n = st.player.provinces;
    const lines = [`${n} ${n === 1 ? 'provincia' : 'province'}`,
      st.opts.tutorial ? `obiettivo ${BALANCE.tutorial.goalProvinces} province` : pos === 1 ? `1° in classifica (+${gap})` : `${pos}° in classifica`];
    const left = Math.max(0, st.timeLeft);
    if (!st.opts.tutorial) lines.push(`fine campagna tra ${mmss(left)}`);
    const W = 210, H = 22 + lines.length * 20 + 8;
    const bg = this.add.rectangle(0, 0, W, H, TCOL.bg, 0.95).setOrigin(0).setStrokeStyle(1, TCOL.edge, 0.6);
    const items: Phaser.GameObjects.GameObject[] = [bg, termNotch(this, 8, 0, ' campagna ').setOrigin(0, 0.5)];
    lines.forEach((l, k) => {
      const warn = k === 2 && left <= BALANCE.campaign.warnMs;
      items.push(this.add.text(12, 18 + k * 20, l, termStyle(13, warn ? PALETTE.ko : PALETTE.carta)));
    });
    const b = this.medalBtn, x = Math.min(b.x, view(this).width - PAD - W);
    this.medalPanel = this.add.container(x, b.y + 44 + 8, items).setDepth(40);
  }

  private closeMenu() {
    this.menu?.destroy();
    this.menu = null;
    this.menuOf = null;
    this.run.setBuildPeek(false);
  }

  /** Tendina sotto il tasto: MAPPA (tre viste) o COSTRUISCI (edifici). */
  private toggleMenu(kind: 'mappa' | 'costruisci') {
    if (this.menuOf === kind) return this.closeMenu();
    this.closeMenu();
    if (kind === 'costruisci') this.run.setBuildPeek(true);
    const st = this.run.state, btn = kind === 'mappa' ? this.mapBtn : this.buildBtn;
    const W = kind === 'mappa' ? 180 : 250, RH = 34;
    type Row = { label: string; sub?: string; on: boolean; off: boolean; icon?: WorkId; pick: () => void };
    const rows: Row[] = kind === 'mappa'
      ? (['politica', 'terreno', 'logistica'] as const).map((m) => ({
        label: { politica: 'Politica', terreno: 'Terreno', logistica: 'Logistica' }[m], on: this.run.mapMode === m, off: false,
        pick: () => this.setMapMode(m),
      }))
      : BUILDABLE.map((w) => {
        const D = BALANCE.works[w], locked = !!D.tech && !st.opts.techs.includes(D.tech);
        const metal = st.workMetal(w);
        return {
          label: WORK_NAME[w], icon: w, on: false, off: locked,
          sub: locked ? `serve ${techInfo(D.tech).name}` : `${st.workPrice(w)} truppe${metal ? ` · ${metal} metallo` : ''}`,
          pick: () => { if (locked) return this.toast(`SERVE LA RICERCA ${techInfo(D.tech).name.toUpperCase()}`, PALETTE.ko); this.run.setBuildMode(w); },
        };
      });
    const H = rows.length * RH + 8;
    const items: Phaser.GameObjects.GameObject[] = [this.add.rectangle(0, 0, W, H, TCOL.bg, 0.96).setOrigin(0).setStrokeStyle(1, TCOL.edge, 0.75)];
    const g = this.add.graphics();
    rows.forEach((r, i) => {
      const y = 4 + i * RH;
      const hit = this.add.rectangle(4, y, W - 8, RH - 2, r.on ? TCOL.hover : TCOL.bg).setOrigin(0).setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => hit.setFillStyle(TCOL.hover)).on('pointerout', () => hit.setFillStyle(r.on ? TCOL.hover : TCOL.bg));
      hit.on('pointerup', () => { this.closeMenu(); r.pick(); buzz(10); });
      items.push(hit);
      const tx = r.icon ? 34 : 14, col = r.off ? TCOL.dim : TCOL.text;
      if (r.icon) drawWorkIcon(g, r.icon, 20, y + RH / 2 - 1, 7, col);
      if (kind === 'mappa') items.push(this.add.text(W - 14, y + RH / 2 - 1, r.on ? '■' : '□', termStyle(13, TCOL.text)).setOrigin(1, 0.5));
      if (r.sub) {
        items.push(this.add.text(tx, y + 3, r.label, termStyle(13, col)), this.add.text(tx, y + 18, r.sub, termStyle(11, r.off ? TCOL.dim : TCOL.label)));
      } else items.push(this.add.text(tx, y + RH / 2 - 1, r.label, termStyle(13, col)).setOrigin(0, 0.5));
    });
    items.push(g);
    const { height } = view(this);
    const y0 = Math.min(btn.y + 38, height - PAD - H);
    this.menu = this.add.container(btn.x + 124 - W, y0, items).setDepth(48);
    this.menuOf = kind;
  }

  /** COSTRUISCI: se stai già costruendo lo spegne, altrimenti apre la tendina degli edifici (anche col tasto B). */
  toggleBuildMenu() {
    if (this.run.state.opts.tutorial) return;
    if (this.run.wallMode) { this.closeMenu(); return void this.run.setBuildMode(null); }
    this.toggleMenu('costruisci');
  }

  /** Elenco dei comandi (tasto H). */
  private toggleHelp() {
    if (this.help) {
      this.help.destroy();
      this.help = null;
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
      ['MAPPA · L', 'viste della carta: politica, terreno, logistica · L: logistica'],
      ['H', 'questi comandi · Esc chiude'],
      ['COSTRUISCI o B, scegli, poi trascina', 'l\'edificio su tutte le tue province toccate'],
      ['Ctrl o Maiusc + numero · numero', 'salva il gruppo · lo richiami (due volte: la carta ci va)'],
      ['T · F', 'pedine: difende o attacca da sola · assegna a un fronte'],
      ['G, poi trascina', 'linea d\'attacco: le pedine selezionate si schierano lungo il tratto'],
      ['U · I · R', 'unisci · dividi · ritirata delle pedine selezionate'],
      ['mouse su una provincia di confine', 'previsione dell\'assalto (con pedine scelte: il percorso)'],
    ];
    const W = Math.min(660, width - 2 * PAD), kx = 16, vx = Math.min(300, W * 0.46);
    // righe che vanno a capo se serve: l'altezza del riquadro si calcola dopo
    const texts: Phaser.GameObjects.Text[] = [];
    let y = 30;
    for (const [k, v] of rows) {
      const kt = this.add.text(kx, y, k, termStyle(12, TCOL.text)).setWordWrapWidth(vx - kx - 10); // il tasto: bianco
      const vt = this.add.text(vx, y, v, termStyle(12, TCOL.label)).setWordWrapWidth(W - vx - 14); // cosa fa: grigio
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
    const msg = ({ locked: 'serve l\'Arsenale', cooldown: 'carta in ricarica', troops: 'truppe insufficienti', cap: 'massimo pedine in campo', tile: '', res: `servono ${this.run.state.unitRes(t).n} ${RESOURCE_INFO[this.run.state.unitRes(t).res].name.toLowerCase()} nello zaino` } as const)[block];
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
    // potenze: l'elenco nell'angolo è tolto (Nico: non si capiva); le schede degli imperi si aprono toccando la mappa
    this.rightPanel.setVisible(false);
    this.symbols.setVisible(false);
    this.rows.forEach((r) => r.setVisible(false));
    this.notches[2].setVisible(false);
    this.troopsLbl.setVisible(false);
    const f = this.frames.clear().setVisible(true);
    const box = (x: number, y: number, w: number, h: number, label: Phaser.GameObjects.Text | null) => {
      f.fillStyle(TCOL.bg, 0.94).fillRect(x, y, w, h).lineStyle(1, TCOL.edge, 0.6).strokeRect(x, y, w, h);
      label?.setPosition(x + 8, y).setOrigin(0, 0.5).setVisible(true);
    };
    if (portrait) {
      // verticale: una barra in alto (esercito | fronte), sotto il bottino; tasti a destra sotto la barra
      const w = width - 2 * PAD;
      P.setPosition(PAD, topPad).setSize(w, TOP_H);
      box(PAD, topPad, w, 72, this.notches[0].setText(' esercito · fronte '));
      box(PAD, topPad + 80, w, TOP_H - 80, this.resLabel);
      this.notches[1].setVisible(false);
      this.troopIcon.setPosition(PAD + 12, topPad + 30);
      this.troops.setPosition(PAD + 38, topPad + 14);
      this.medalBtn.setPosition(width - PAD - 12 - 44, topPad + 14);
      this.layoutResources(PAD + 16, topPad + 80 + (TOP_H - 80) / 2 - 4, (w - 40) / 3);
      this.topBottom = topPad + TOP_H;
      this.symPos = this.rows.map(() => ({ x: 0, y: 0 }));
      this.unitPos = this.rows.map(() => null);
      const pb = height - PAD - STATUS_H; // fondo utile: sopra la barra di stato della carta
      this.speedBtn.setPosition(width - PAD - 56, pb - 44);
      this.pauseBtn.setPosition(width - PAD - 56, this.topBottom + 8); // in alto a destra: in basso ci sono le carte
      this.mapBtn.setPosition(width - PAD - 124, this.topBottom + 8 + 44 + 6);
      this.buildBtn.setPosition(width - PAD - 124, this.topBottom + 8 + 44 + 6 + 38);
      this.retreatBtn.setPosition(width - PAD - 112, pb - this.portraitCardH() - 8 - 44); // sulla riga delle leve, sopra le carte
      this.seed.setPosition(width - PAD, pb - 2 * 44 - 8 - 6);
      this.hint.setPosition(width / 2 - 34, this.topBottom + 8).setWordWrapWidth(width - 2 * PAD - 140);
      this.dockG.clear(); // in verticale niente riquadri attorno alle carte
      this.notches[3].setVisible(false);
      this.notches[4].setVisible(false);
    } else {
      // orizzontale: una sola barra compatta in alto a sinistra (esercito | fronte | bottino), tasti in alto a destra
      // riquadro territorio tolto (Nico): al suo posto, dopo il bottino, il tasto con la medaglia
      const aW = 176, bW = 44, cW = 252, gap = 6, cx = PAD + aW + gap, bx = cx + cW + gap;
      P.setPosition(PAD, topPad).setSize(aW + cW + gap, BAR_H); // area dei tocchi
      box(PAD, topPad, aW, BAR_H, this.notches[0].setText(' esercito '));
      box(cx, topPad, cW, BAR_H, this.resLabel);
      this.notches[1].setVisible(false);
      this.medalBtn.setPosition(bx, topPad);
      this.troopIcon.setPosition(PAD + 12, topPad + 30);
      this.troops.setPosition(PAD + 38, topPad + 14);
      this.layoutResources(cx + 14, topPad + 32, (cW - 24) / 3);
      this.topBottom = topPad + BAR_H;
      this.symPos = this.rows.map(() => ({ x: 0, y: 0 }));
      this.unitPos = this.rows.map(() => null);
      const tx = width - PAD - 124;
      this.mapBtn.setPosition(tx, topPad);
      this.buildBtn.setPosition(tx, topPad + 38);
      const by = height - PAD - STATUS_H - 44; // comandi sopra la barra di stato della carta
      this.speedBtn.setPosition(width - PAD - 56, by);
      this.pauseBtn.setPosition(width - PAD - 56 - 8 - 56, by);
      this.retreatBtn.setPosition(width - PAD - 56 - 8 - 56 - 8 - 112, by);
      this.seed.setPosition(width - PAD, by - 6);
      this.hint.setPosition(PAD + (aW + bW + cW + 2 * gap) / 2, topPad + BAR_H + 10).setWordWrapWidth(Math.max(220, aW + bW + cW - 40)); // (bW = medaglia)
      // reparti in orizzontale su due file, in basso a sinistra (Nico): la scheda della provincia, in basso al centro, non li copre.
      // Le abilità in un riquadro sopra; se lo schermo è stretto si rimpiccioliscono
      const g = this.dockGrid();
      this.dockG.clear().fillStyle(TCOL.bg, 0.94).fillRect(PAD, g.uY, g.uW, g.uH).lineStyle(1, TCOL.edge, 0.6).strokeRect(PAD, g.uY, g.uW, g.uH);
      this.notches[3].setPosition(PAD + 8, g.uY).setOrigin(0, 0.5).setVisible(true);
      if (this.abilityCards.length) {
        this.dockG.fillStyle(TCOL.bg, 0.94).fillRect(PAD, g.aY, g.aW, g.aH).lineStyle(1, TCOL.edge, 0.6).strokeRect(PAD, g.aY, g.aW, g.aH);
        this.notches[4].setPosition(PAD + 8, g.aY).setOrigin(0, 0.5).setVisible(true);
      } else this.notches[4].setVisible(false);
    }
    for (const o of [this.stats, this.stormText, this.clockIcon]) o.setVisible(false); // ora nel pannello della medaglia
    if (this.medalPanel) this.openMedal();
    P.setFillStyle(TCOL.bg, 0);
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
    const sc = portrait ? this.portraitCardScale() : this.dockGrid().sc, step = CARD_W * sc + 6;
    const cy = height - PAD - STATUS_H - CARD_H * sc, cx0 = PAD;
    const grid = portrait ? null : this.dockGrid();
    this.cards.forEach((c, k) => {
      const x = grid ? PAD + DOCK_PAD + (k % grid.cols) * step : cx0 + k * step, y = grid ? grid.uY + DOCK_PAD + 4 + Math.floor(k / grid.cols) * step : cy;
      c.baseY = y;
      c.baseX = x;
      c.setScale(sc).setPosition(x, y);
    });
    // abilità: dopo le carte in orizzontale; in verticale a destra, sopra il tasto RITIRATA
    this.abilityCards.forEach((c, k) => {
      const x = grid ? PAD + DOCK_PAD + k * step : width - PAD - (k + 1) * step + 6;
      c.baseY = grid ? grid.aY + DOCK_PAD + 4 : this.portraitAbilityY();
      c.baseX = x;
      c.setScale(sc).setPosition(x, c.baseY);
    });
  }

  /** Orizzontale: reparti su due file (colonne quante servono), abilità in una fila sopra; scala per non toccare la scheda al centro. */
  private dockGrid() {
    const { width, height } = view(this), bottom = height - PAD - STATUS_H;
    const cols = Math.max(1, Math.ceil(this.cards.length / 2)), na = this.abilityCards.length;
    const boxW = (n: number, sc: number) => n * (CARD_W * sc + 6) - 6 + 2 * DOCK_PAD;
    const boxH = (rows: number, sc: number) => (rows ? rows * (CARD_H * sc + 6) - 6 + 2 * DOCK_PAD + 8 : 0);
    const avail = (width - 470) / 2 - PAD - 8; // la scheda della provincia è larga al massimo 470, al centro
    const sc = Phaser.Math.Clamp(avail / Math.max(1, boxW(Math.max(cols, na), 1)), 0.6, 1);
    const uH = boxH(Math.min(2, this.cards.length), sc), uY = bottom - uH, aH = boxH(na ? 1 : 0, sc), aY = uY - ABIL_GAP - aH;
    return { sc, cols, uW: boxW(cols, sc), uY, uH, aW: boxW(na, sc), aY, aH };
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
      // colonna allineata a sinistra: icona e valore sulla riga, entrate al minuto sotto, dal bordo dell'icona (Nico: era in diagonale)
      const cx = x + k * step;
      drawResourceIcon(this.resIcons, r, cx + 7, y, 8);
      this.resTexts[k].setPosition(cx + 20, y);
      this.incTexts[k].setPosition(cx, y + 13);
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
      const msg = 'Tocca una tua provincia per costruire:\nfabbrica, fortificazione, caserma.';
      if (!st.worksStarted && !this.hint.visible && !this.provCard) {
        this.setHint(msg);
        this.time.delayedCall(8000, () => { if (this.hint.text === msg) this.setHint(null); });
      }
    }
    if (this.medalPanel && (this.medalAcc -= delta) <= 0) { this.medalAcc = 1000; this.openMedal(); }
    if (this.profile && (this.profileAcc -= delta) <= 0) {
      this.profileAcc = 1000;
      this.renderProfile();
    }
    if (this.provCard && (this.provCardAcc -= delta) <= 0) { // 2 volte al secondo: vita, cantiere, truppe
      this.provCardAcc = 500;
      // cantiere che avanza, truppe e zaino che cambiano: si ricostruisce solo se cambia qualcosa di mostrato (prestazioni)
      if (this.provCardKey() !== this.provKey) this.renderProvince();
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
    // posto in classifica per numero di province (a fine campagna vince chi ne ha di più), detto per esteso
    const lead = st.opts.tutorial ? `obiettivo ${BALANCE.tutorial.goalProvinces}` : pos === 1 ? `1° in classifica (+${gap})` : `${pos}° in classifica`;
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
      this.stormText.setText(`fine campagna tra ${mmss(left)}`)
        .setColor(left <= BALANCE.campaign.warnMs ? hex(PALETTE.ko) : hex(PALETTE.ocra));
    }
    this.seed.setVisible(false); // codice della mappa: tolto (Nico: informazione inutile)

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
      const block = st.deployBlock(PLAYER, c.type), rc = st.unitRes(c.type);
      c.refresh(cd, block === null || block === 'cooldown', sel === c.type, st.troops >= st.unitCost(PLAYER, c.type), st.backpack[rc.res] >= rc.n);
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

  /** Tasto COSTRUISCI acceso (con l'edificio scelto) o spento. */
  setBuildOn(w: WorkId | null) {
    this.buildBtn.setLabel(w ? WORK_NAME[w].toUpperCase() : 'COSTRUISCI').setOn(!!w);
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
    // orizzontale: i reparti stanno a sinistra e la scheda al centro, non si coprono (Nico): restano sempre
    if (!this.portrait) return;
    const list: (Phaser.GameObjects.Components.Visible | null | undefined)[] = [...this.cards, ...this.abilityCards];
    list.push(this.retreatBtn, this.speedBtn, this.seed);
    for (const o of list) o?.setVisible(on);
  }

  refreshProvince() {
    if (this.provCardP >= 0 || this.selUnit >= 0) this.renderProvince();
  }

  /**
   * Tabella in basso alla Call of War: intestazione (padrone, nazione, terreno), una riga di dati a celle e le azioni.
   * Le tue province aprono anche le sette costruzioni.
   */
  /** Impronta di quello che la scheda in basso mostra: uguale = niente da ridisegnare. */
  private provCardKey(): string {
    const st = this.run.state, p = this.provCardP;
    const { width } = view(this);
    const k: unknown[] = [p, this.selUnit, this.provOpen, width, this.portrait, st.over];
    const unit = this.selUnit >= 0 ? st.units.find((u) => u.id === this.selUnit) : undefined;
    if (unit) {
      const group = unit.owner === PLAYER ? this.run.selectedUnits() : [];
      k.push(Math.ceil(unit.hp), Math.round(unit.maxHp), unit.size, unit.stance, unit.front, Math.round(unit.supply * 100), unit.inCombat,
        st.battles.some((b) => b.unit === unit.id), unit.path.length > 0, group.length, group.every((u) => u.stance === 'attacca'));
    } else if (this.selUnit < 0 && p >= 0) {
      const o = st.provOwner[p], prog = o === PLAYER ? st.workInProgress(p) : null, b = st.battleAt(p);
      const fc = o !== PLAYER && (st.seesProv(p) || o === NEUTRAL) && st.isFrontierProv(p) ? st.forecast(p) : null;
      const cost = o === PLAYER ? 0 : st.provCost(PLAYER, p);
      k.push(o, st.seesProv(p), o > PLAYER ? st.relation[o] : '', st.provDefense(p), st.provPerMin(p).toFixed(1), st.workOf(p),
        prog ? mmss(prog.leftMs) : '', Math.round(st.supply[p] * 100), st.capitalProv[PLAYER], cost, st.troops > cost,
        fc ? `${fc.can}${fc.odds}` : '', b ? `${Math.ceil((b.endMs - st.gameTimeMs) / 1000)}${b.by}${b.troops}` : '', st.isFrontierProv(p), st.atWar(PLAYER, o));
      if (o === PLAYER) for (const w of WORKS) k.push(st.workBlock(p, w), st.workPrice(w), st.workMetal(w));
    }
    return k.join('|');
  }

  private renderProvince() {
    const st = this.run.state, p = this.provCardP;
    this.provKey = this.provCardKey();
    this.provCard?.destroy();
    this.provCard = null;
    if (st.over || (p < 0 && this.selUnit < 0)) return void this.hideProvince();
    const unit = this.selUnit >= 0 ? st.units.find((u) => u.id === this.selUnit) : undefined;
    if (this.selUnit >= 0 && !unit) return void this.hideProvince(); // la pedina non c'è più
    const { width, height } = view(this);
    // larga quanto serve (Nico: occupava troppo): pedina 460 per i cinque comandi, tua provincia 470 (tre risorse)
    const W = Math.min(unit ? 460 : st.provOwner[p] === PLAYER ? 470 : 460, width - 2 * PAD - (this.portrait ? 0 : 252));
    const own = !unit && st.provOwner[p] === PLAYER;
    const ready = own ? st.workOf(p) : null, prog = own ? st.workInProgress(p) : null;
    // previsione dell'assalto (province attaccabili che vedi)
    const fc = !unit && p >= 0 && st.provOwner[p] !== PLAYER && (st.seesProv(p) || st.provOwner[p] === NEUTRAL) && st.isFrontierProv(p) ? st.forecast(p) : null;

    // Gerarchia (Nico: "100 cose tutte attaccate, stesso font, stesse grandezze"): titolo 16 bianco → riga grigia 11 di chi/cosa →
    // dati principali grandi (16) → dati secondari (13) → azioni. Etichette sempre 11 grigie, margini a passi di 8.
    const M = 16, inner = W - 2 * M;
    const items: Phaser.GameObjects.GameObject[] = [];
    const g = this.add.graphics();
    let y = 14;
    const title = (text: string, sub: string, icon?: (x: number, y: number) => void) => {
      const tx = icon ? M + 22 : M;
      icon?.(M + 8, y + 9);
      items.push(this.add.text(tx, y, text, termStyle(16, TCOL.text)).setWordWrapWidth(inner - 40).setMaxLines(1));
      y += 22;
      items.push(this.add.text(tx, y, sub, termStyle(11, TCOL.label)).setWordWrapWidth(inner - 22).setMaxLines(1));
      y += 22;
    };
    // riga di dati: etichetta piccola sopra, valore sotto (grande per i principali)
    // icona accanto al valore: texture (ico-*) o icona della risorsa
    type Stat = { k: string; v: string; c?: number; icon?: string; res?: Resource };
    const stats = (list: Stat[], big: boolean, oneRow = false) => {
      if (!list.length) return;
      const per = oneRow ? list.length : Math.min(list.length, big ? 3 : inner >= 420 ? 4 : 3), cw = inner / per, rowH = big ? 44 : 38;
      list.forEach((s, i) => {
        const x = M + (i % per) * cw, yy = y + Math.floor(i / per) * rowH;
        const vy = yy + 15, vh = big ? 10 : 8, ix = s.icon || s.res ? 20 : 0;
        if (s.icon) items.push(this.add.image(x, vy + vh, s.icon).setDisplaySize(14, 14).setOrigin(0, 0.5).setTint(TCOL.label));
        if (s.res) drawResourceIcon(g, s.res, x + 7, vy + vh, 7);
        items.push(this.add.text(x, yy, s.k, termStyle(11, TCOL.label)).setWordWrapWidth(cw - 8).setMaxLines(1),
          this.add.text(x + ix, vy, s.v, termStyle(big ? 16 : 13, s.c ?? TCOL.text)).setWordWrapWidth(cw - 8 - ix).setMaxLines(1));
      });
      y += Math.ceil(list.length / per) * rowH;
    };
    const rule = () => { g.lineStyle(1, TCOL.edge, 0.35).lineBetween(M, y + 0.5, W - M, y + 0.5); y += 12; };
    // tasti: tutti alti 36, distanziati di 8; il principale pieno, gli altri col filo
    const BH = 36, GAP = 8;
    const button = (label: string, x: number, w: number, yy: number, run: () => void, kind: 'main' | 'line' | 'off' = 'line') => {
      const fill = kind === 'main' ? TCOL.text : TCOL.bg;
      const r = this.add.rectangle(x, yy, w, BH, fill).setOrigin(0).setStrokeStyle(1, kind === 'off' ? TCOL.dim : TCOL.edge, kind === 'main' ? 0 : 0.9)
        .setInteractive({ useHandCursor: true });
      r.on('pointerover', () => r.setFillStyle(kind === 'main' ? 0xffffff : TCOL.hover)).on('pointerout', () => r.setFillStyle(fill));
      r.on('pointerup', () => { run(); buzz(10); });
      items.push(r, this.add.text(x + w / 2, yy + BH / 2, label, termStyle(13, kind === 'main' ? TCOL.bg : kind === 'off' ? TCOL.dim : TCOL.text)).setOrigin(0.5));
    };
    const note = (text: string, color: number = TCOL.label) => {
      const t = this.add.text(M, y, text, termStyle(13, color)).setWordWrapWidth(inner);
      items.push(t);
      y += t.height + 8;
    };

    if (unit) {
      // pedina: chi è, quanto è messa, cosa batte
      const U = BALANCE.units[unit.type], info = unitInfo(unit.type), mine = unit.owner === PLAYER, F = FACTION_INFO[unit.owner];
      const group = mine ? this.run.selectedUnits() : [];
      const size = unit.size > 1 ? ` ×${unit.size}` : '';
      title(`${info.name}${size}`, `${mine ? 'tua pedina' : `pedina di ${F?.name ?? 'nemico'}`}${group.length > 1 ? ` · ${group.length} selezionate` : ''}`,
        (x, yy) => drawUnitIcon(g, unit.type, x, yy, 8, F?.fill ?? TCOL.text));
      const pct = unit.hp / unit.maxHp, sup = unit.supply;
      const beats = info.beats.map((b) => unitInfo(b).short.toLowerCase()).join(', ') || '—';
      const front = mine && unit.front >= 0 ? `fronte ${FACTION_INFO[unit.front]?.short.toLowerCase() ?? ''}` : '';
      stats([
        { k: 'vita', v: `${Math.ceil(unit.hp)}/${Math.round(unit.maxHp)}`, c: pct > 0.5 ? TCOL.ok : pct > 0.25 ? TCOL.accent : TCOL.alert },
        { k: 'attacco', v: String(U.attack * unit.size) },
        { k: 'stato', v: unit.inCombat ? 'combatte' : st.battles.some((b) => b.unit === unit.id) ? 'assedio' : unit.path.length ? 'in marcia' : front || 'ferma',
          c: unit.inCombat ? TCOL.alert : TCOL.text },
      ], true);
      stats([
        { k: 'rifornimento', v: sup < BALANCE.unitOps.attritionBelow ? `${Math.round(sup * 100)}% · si logora` : `${Math.round(sup * 100)}%`,
          c: sup >= BALANCE.unitOps.healMinSupply ? TCOL.ok : sup >= BALANCE.unitOps.attritionBelow ? TCOL.accent : TCOL.alert },
        { k: 'batte', v: beats },
        { k: 'gittata', v: String(U.range) },
        { k: 'passo', v: `${(U.moveMs / 1000).toFixed(1).replace('.', ',')} s` },
      ], false);
      rule();
      if (!mine) note('Pedina nemica: schiera un reparto che la batte.');
      else {
        // comandi: comportamento, fronte, unisci, dividi, ritirata (valgono per tutte le pedine selezionate)
        const att = group.length ? group.every((u) => u.stance === 'attacca') : unit.stance === 'attacca';
        const acts: [string, 'stance' | 'front' | 'merge' | 'split' | 'retreat' | 'line', boolean][] = [
          [att ? 'Attacca' : 'Difende', 'stance', true], ['Linea', 'line', true], ['Fronte', 'front', true], ['Unisci', 'merge', true],
          ['Dividi', 'split', unit.size > 1], ['Ritirata', 'retreat', true],
        ];
        const per = (inner - 5 * GAP) / 6 >= 62 ? 6 : 3, bw = (inner - (per - 1) * GAP) / per;
        acts.forEach(([label, kind, on], k) => button(label, M + (k % per) * (bw + GAP), bw, y + Math.floor(k / per) * (BH + GAP),
          () => this.run.unitAction(kind), on ? 'line' : 'off'));
        y += Math.ceil(acts.length / per) * (BH + GAP);
        items.push(this.add.text(M, y, 'T  G  F  U  I  R  da tastiera', termStyle(11, TCOL.dim)));
        y += 18;
      }
    } else {
      const prov = st.map.provinces[p], o = st.provOwner[p], T = BALANCE.terrain[prov.terrain];
      const seen = o === PLAYER || st.seesProv(p);
      const nation = st.map.nations.find((n) => n.id === prov.country)?.name ?? 'Terra di nessuno';
      const terrainName = { pianura: 'pianura', colline: 'colline', montagne: 'montagne', deserto: 'deserto' }[prov.terrain];
      const resName = RESOURCE_INFO[T.res].name.toLowerCase();
      const F = o >= 0 ? FACTION_INFO[o] : null;
      const ownerName = !seen && o !== PLAYER ? 'padrone sconosciuto' : o === PLAYER ? (st.capitalProv[PLAYER] === p ? 'tua capitale' : 'tua provincia') : F ? F.name : 'terra libera';
      const rel = o > PLAYER && seen ? st.relation[o] : null;
      const relTxt = rel ? (rel === 'guerra' ? ' · in guerra' : rel === 'alleanza' ? ' · alleati' : ' · in pace') : '';
      // assalto in corso nella riga sotto il titolo (niente righe in più: la scheda resta bassa)
      const bt = !own ? st.battleAt(p) : null;
      const battleTxt = bt ? ` · assalto ${Math.max(0, Math.ceil((bt.endMs - st.gameTimeMs) / 1000))} s` : '';
      title(nation, `${terrainName}${st.isCity(p) ? ' · città' : ''} · ${ownerName}${relTxt}${battleTxt}`); // niente simbolo davanti (Nico): titolo e riga allineati a sinistra
      // scheda della potenza: link piccolo nell'intestazione, accanto alla ✕
      if (o > PLAYER && seen) {
        const link = this.add.text(W - M - 28, 16, 'scheda ›', termStyle(11, TCOL.label)).setOrigin(1, 0).setInteractive({ useHandCursor: true });
        link.on('pointerover', () => link.setColor(hex(TCOL.text))).on('pointerout', () => link.setColor(hex(TCOL.label)));
        link.on('pointerup', () => this.showProfile(o));
        items.push(link);
      }
      const work = ready ? WORK_NAME[ready] : prog ? `cantiere ${mmss(prog.leftMs)}` : (() => { const w = st.workOf(p); return w ? WORK_NAME[w] : 'nessuna'; })();
      const cost = o === PLAYER ? 0 : st.provCost(PLAYER, p);
      const odds = fc ? (fc.can ? fc.odds : 'mancano truppe') : '';
      if (o === PLAYER) {
        // tutte e tre le risorse della provincia (Nico): la prima è quella del terreno
        const bag = st.provBag(p), order = [T.res, ...RESOURCES.filter((r) => r !== T.res)];
        stats([
          ...order.map((r) => ({ k: `${RESOURCE_INFO[r].name.toLowerCase()} /min`, v: bag[r].toFixed(1).replace('.', ','), res: r })),
          { k: 'logistica', v: `${Math.round(st.supply[p] * 100)}%`, icon: 'ico-logistica',
            c: st.supply[p] >= 0.95 ? TCOL.ok : st.supply[p] >= 0.6 ? TCOL.accent : TCOL.alert },
          { k: 'difesa', v: String(st.provDefense(p)), icon: 'ico-difesa' },
        ], true);
      } else {
        // una riga sola (Nico: "appiattiscila"); la costruzione solo se c'è
        const w = st.workOf(p);
        stats([
          { k: 'per prenderla', v: seen || o === NEUTRAL ? `${cost}` : '?', c: st.troops > cost ? TCOL.text : TCOL.alert, icon: 'ico-truppe' },
          ...(fc ? [{ k: 'esito', v: odds, c: fc.odds === 'incerta' ? TCOL.accent : fc.odds === 'difficile' || !fc.can ? TCOL.alert : TCOL.ok }] : []),
          { k: 'difesa', v: seen || o === NEUTRAL ? String(st.provDefense(p)) : '?', icon: 'ico-difesa' },
          { k: `${resName} al min`, v: st.provPerMin(p).toFixed(1).replace('.', ','), res: T.res },
          ...(w ? [{ k: 'costruzione', v: WORK_NAME[w] }] : []),
        ], true, true);
      }
      // tua provincia: si costruisce dal tasto COSTRUISCI in alto (Nico: il tasto qui non serviva più); la costruzione solo se c'è
      if (own) {
        if (ready || prog) {
          rule();
          // icona della costruzione accanto al nome (sulla carta si vede solo toccando la provincia o in COSTRUISCI)
          const wk = ready ?? prog!.work, col = ready ? TCOL.text : TCOL.accent;
          g.fillStyle(TCOL.bg, 1).fillRoundedRect(M, y - 3, 22, 22, 3).lineStyle(1, col, 0.9).strokeRoundedRect(M, y - 3, 22, 22, 3);
          drawWorkIcon(g, wk, M + 11, y + 8, 6.5, col, TCOL.bg);
          const t = this.add.text(M + 30, y, ready ? `${WORK_NAME[ready]} · ${workDesc(ready, resName)}` : `${work} · ${WORK_NAME[prog!.work]}`, termStyle(13, col)).setWordWrapWidth(inner - 30);
          items.push(t);
          y += Math.max(t.height, 18) + 8;
        }
      }
    }
    const H = Math.ceil(y + M - GAP);
    // in fondo allo schermo come in Call of War: in orizzontale a sinistra (a destra restano RITIRATA, pausa e velocità)
    const bottom = height - PAD - STATUS_H; // sopra la barra di stato della carta
    const left = (width - W) / 2; // centrata in basso (Nico)
    this.setBottomVisible(false);
    const close = this.add.text(W - M, 14, '✕', termStyle(16, TCOL.label)).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on('pointerup', () => this.hideProvince());
    const bgRect = this.add.rectangle(0, 0, W, H, TCOL.bg, 0.96).setOrigin(0).setStrokeStyle(1, TCOL.edge, 0.75);
    this.provCard = this.add.container(left, bottom - H, [bgRect, ...items, g, close]).setDepth(45);
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
    if (this.menu && inRect(this.menu.list[0] as Phaser.GameObjects.Rectangle, this.menu.x, this.menu.y)) return true;
    if (this.medalPanel && inRect(this.medalPanel.list[0] as Phaser.GameObjects.Rectangle, this.medalPanel.x, this.medalPanel.y)) return true;
    const btns = [this.speedBtn, this.pauseBtn, this.retreatBtn, this.mapBtn, this.buildBtn, this.medalBtn, ...this.cards, ...this.abilityCards].filter((b) => b !== null);
    return btns.some((b) => b.visible && b.contains(x, y));
  }
}
