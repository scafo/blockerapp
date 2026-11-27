import { sfx } from '../audio/sfx';
import { audioSettings, onAudioChange } from '../audio/engine';
import { openAudioPanel } from '../ui/audioPanel';
import Phaser from 'phaser';
import { BALANCE, type AbilityType, type Resource, type UnitType, type WorkId } from '../config/balance';
import { PALETTE, TERRAIN_VIEW, WORK_VIEW, hex } from '../config/palette';
import { BUILDABLE, NEUTRAL, PLAYER, WORKS, type DiploWhat, type Objective, type Outcome, type RunState, type VictoryReason } from '../game/RunState';
import { techInfo } from '../game/tech';
import { WORK_NAME, workDesc } from '../ui/workIcons';
import { buzz } from '../ui/haptics';
import { FACTION_INFO, majorCount, majorIds } from '../game/factions';
import civText from '../data/civs.json';
import { RESOURCES, RESOURCE_INFO, bagTotal, type Bag } from '../game/resources';
import { EventCard } from '../ui/EventCard';
import { TutorialGuide, type GuideSignal } from '../ui/TutorialGuide';
import { analytics } from '../analytics/analytics';
import { fpsEnabled } from '../ui/debug';
import { Button } from '../ui/Button';
import { AbilityCard, CARD_H, CARD_W, UnitCard } from '../ui/UnitCard';
import { cloudTextures } from '../ui/titleMap';
import { MapLabels } from '../render/MapLabels';
import { icon, resIcon } from '../ui/ops';
import { lineIcon, type LineIcon } from '../ui/lineIcons';
import { dotTexture } from '../ui/dotIcons';
import { coverImage } from '../ui/images';
import { UI, safeInsets, uiCamera, view } from '../ui/screen';
import { drawSymbol } from '../ui/symbols';
import { Odometer } from '../ui/odometer';
import { TCOL, termBox, termLabel, termNotch, termStyle } from '../ui/terminal';
import { drawUnitIcon } from '../ui/unitIcons';
import { UNIT_TYPES, unitInfo, type Unit } from '../game/units';

/** Posizione in classifica in inglese: 1st, 2nd, 3rd, 4th… */
const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
/** Esito previsto dell'assalto (RunState.forecast) come si legge sulla mappa. */
const ODDS: Record<string, string> = { sicura: 'certain', probabile: 'likely', incerta: 'uncertain', difficile: 'hard' };
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

const MEDAL_W = 92; // tasto del tempo che manca (clessidra e minuti)
/** Numero corto per la barra in alto (Nico: i numeri uscivano dai riquadri): da 10 000 in su in migliaia. */
const short = (n: number) => (Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : Math.abs(n) >= 10_000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
/** Entrate e crescita: da 100 in su senza decimali. */
const rate = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1));
const mmss = (ms: number) => {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

// Orizzontale: mappa libera al centro, info negli angoli in alto, comandi negli angoli in basso.

/** Prezzo di una costruzione: risorse, e truppe solo se ne costa (run guidata). */
const workCostText = (troops: number, cost: Bag) => [troops ? `${troops} troops` : '', ...RESOURCES.map((r) => (cost[r] ? `${cost[r]} ${RESOURCE_INFO[r].name.toLowerCase()}` : ''))].filter(Boolean).join(', ') || 'free';
/** Campione dell'economia per i grafici. */
interface EconSample { stock: Bag; net: Bag; troops: number; prov: number }
const EconHistStepMs = 10_000, EconHistMax = 61; // 10 minuti di gioco

export class HudScene extends Phaser.Scene {
  private troops!: Odometer; // numero a rullo (Nico, 27 novembre 2026)
  private rate!: Phaser.GameObjects.Text;
  private stats!: Phaser.GameObjects.Text;
  private resTexts: Odometer[] = [];
  private rollTroops = 0; // valori mostrati mentre scorrono verso quelli veri
  private rollRes: number[] = [];
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
  private clouds: { t: Phaser.GameObjects.TileSprite; vx: number; vy: number; par: number }[] = [];
  private camPrev = { x: 0, y: 0 };
  private incAcc = 0;
  private seed!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private objBox: Phaser.GameObjects.Container | null = null; // obiettivi della campagna, sotto la barra in alto a sinistra
  private objKey = '';
  private objPos = { x: 0, y: 0, w: 0 };
  private leftPanel!: Phaser.GameObjects.Rectangle;
  private rightPanel!: Phaser.GameObjects.Rectangle;
  private symbols!: Phaser.GameObjects.Graphics;
  private rows: Phaser.GameObjects.Text[] = [];
  private rowIds: number[] = []; // fazione di ogni riga dell'elenco
  private aliveKey = '';
  private speedBtn!: Button;
  private retreatBtn!: Button;
  private linesBtn!: Button;
  private linesPanel: Phaser.GameObjects.Container | null = null; // pannello delle linee (Nico: un tasto in basso per gestirle)
  private linesKey = '';
  private retreatArmed: Phaser.Time.TimerEvent | null = null;
  private cards: UnitCard[] = [];
  private mapLabels!: MapLabels;
  private abilityCards: AbilityCard[] = [];
  private shownTroops = -1;
  private ended = false;
  private portrait = false;
  private troopsLbl!: Phaser.GameObjects.Text;
  private resIcons: Phaser.GameObjects.Image[] = [];
  private troopIcon!: Phaser.GameObjects.Image;
  private clockIcon!: Phaser.GameObjects.Image;
  private medalBtn!: Button; // al posto del riquadro territorio (Nico): apre province, classifica e fine campagna
  private medalPanel: Phaser.GameObjects.Container | null = null;
  private clockKey = '';
  private audioBtn!: Button; // impostazioni audio (Nico): accanto alla medaglia
  private radarBtn!: Button; // rapporti del radar (Nico, 26 novembre 2026): arrivano qui col numero, si aprono quando vuoi
  private hpTrend = new Map<string, { hp: number; at: number; trend: number }>();
  private unitListOpen = false; // scheda della pedina: elenco delle pedine del gruppo aperto // vita della pedina scelta: sale, scende, ferma
  private econBtn!: Button; // ECONOMIA (Nico, 27 novembre 2026): entrate, spese, truppe, impero
  private profileBtn!: Button;
  private settingsBtn!: Button;
  private econPanel: Phaser.GameObjects.Container | null = null;
  private econAcc = 0;
  private audioPanel: Phaser.GameObjects.Container | null = null;
  private groupBar: Phaser.GameObjects.Container | null = null; // gruppi (armate) alla HOI4, in alto accanto ai tasti
  private groupBarKey = '';
  private groupBarRect = { x: 0, y: 0, w: 0, h: 0 };
  private medalAcc = 0;
  private symPos: { x: number; y: number }[] = [];
  private unitPos: ({ x: number; y: number } | null)[] = [];
  private topBottom = PAD + LEFT_H; // dove finisce l'HUD in alto
  private eventCard: EventCard | null = null;
  private guide: TutorialGuide | null = null;
  private fps: Phaser.GameObjects.Text | null = null;
  /** Orizzontale: riquadri della pianta (fondo ardesia, filo avorio) con l'etichetta in corsivo sul bordo. */
  private frames!: Phaser.GameObjects.Graphics;
  private notches: Phaser.GameObjects.Text[] = [];
  private notes: Phaser.GameObjects.Container[] = [];
  private dockG!: Phaser.GameObjects.Graphics;
  private buildPanel: Phaser.GameObjects.Container | null = null; // COSTRUISCI: le costruzioni al posto dei reparti, in basso a sinistra
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
    this.econHist = []; // la scena si riusa da una campagna all'altra: i grafici ripartono da zero
    this.econHistAt = -Infinity;
    // etichette della mappa nitide (spazio schermo)
    this.mapLabels = new MapLabels(this);
    this.shownTroops = -1;
    this.aliveKey = '';
    this.ended = false;
    this.clockKey = ''; // il tempo sul tasto si riscrive alla nuova campagna
    this.retreatArmed = null;
    this.eventCard = null;
    // nuvole come nella home (Nico): due strati leggeri sopra la carta e sotto l'interfaccia, che scorrono piano e seguono
    // lo spostamento della carta (più lente di lei: sembrano più in alto)
    cloudTextures(this);
    const { width: cw0, height: ch0 } = view(this);
    this.clouds = [['title-clouds-a', 3.2, 0.24, 6, 1.5, 0.5], ['title-clouds-b', 2.1, 0.15, 11, -2, 0.8]].map(([key, sc, a, vx, vy, par]) => ({
      t: this.add.tileSprite(0, 0, cw0, ch0, key as string).setOrigin(0).setTileScale(sc as number).setAlpha(a as number).setTint(0xc4ccd6).setDepth(-20),
      vx: vx as number, vy: vy as number, par: par as number,
    }));

    // pannello sinistro: truppe, territorio/obiettivi, zaino, tempo di campagna
    // (le posizioni le decide layout(): verticale e orizzontale hanno disposizioni diverse)
    this.frames = this.add.graphics();
    this.dockG = this.add.graphics();
    this.leftPanel = this.add.rectangle(PAD, PAD, LEFT_W, LEFT_H, TCOL.bg, 0.95).setOrigin(0).setStrokeStyle(1, PALETTE.linea);
    this.notches = ['Army', 'Front', 'Powers', 'Units', 'Abilities'].map((t) => termNotch(this, 0, 0, t));
    this.troopsLbl = this.add.text(0, 0, 'TROOPS', termStyle(11, PALETTE.ocra));
    this.troops = new Odometer(this, termStyle(28, PALETTE.carta), TCOL.bg);
    this.troopIcon = this.add.image(0, 0, 'ico-truppe').setDisplaySize(20, 20).setOrigin(0, 0.5); // uomini dell'esercito
    this.rate = this.add.text(0, 0, '', termStyle(11, 0x7f888e)); // crescita: grigio scuro, non verde fluo (Nico)
    this.food = this.add.text(0, 0, '', termStyle(11, PALETTE.radioattivo)).setVisible(false); // rancio: tolto dalla barra (Nico: non si capiva)
    this.stats = this.add.text(0, 0, '', termStyle(13, PALETTE.carta)).setLineSpacing(2);
    this.resIcons = RESOURCES.map((r) => resIcon(this, r, 0, 0, 18));
    // bottino: icone e numeri grandi, ognuno nel colore della sua risorsa
    this.resTexts = RESOURCES.map(() => new Odometer(this, termStyle(16, PALETTE.carta), TCOL.bg).setOriginY(0.5)); // valori: bianco (l'icona dice quale risorsa), a rullo
    const stake = bagTotal(this.run.state.opts.stake);
    this.resLabel = this.add.text(0, 0, stake ? ` Spoils, stake ${stake} ` : ' Spoils ', termLabel(11))
      .setBackgroundColor(hex(TCOL.bg));
    // entrate al minuto sotto ogni risorsa: si vede cosa rende l'impero
    this.incTexts = RESOURCES.map(() => this.add.text(0, 0, '', termStyle(11, 0x7f888e, false)).setOrigin(0, 0));
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
    this.hint = this.add.text(0, 0, 'Tap a number on the map: it is the troop price of a free province', termLabel(13))
      .setOrigin(0.5, 0).setAlign('center').setPadding(12, 7, 12, 7);

    // comandi: carte in basso a sinistra; ritirata e velocità in basso a destra
    // solo le unità sbloccate dalla Arsenale
    this.cards = this.run.state.opts.units.map((t) => new UnitCard(this, t, () => this.onCard(t), (on) => this.unitTip(on ? t : null)));
    // abilità tolte per ora (Nico, 27 novembre 2026: "fuori posto, si faranno meglio dopo"): al loro posto gruppi ed ECONOMIA
    this.abilityCards = ([] as AbilityType[]).map((a) => new AbilityCard(this, a, () => {
      const block = this.run.toggleAbility(a);
      if (block === 'cooldown') this.toast('Ability recharging', PALETTE.ko, 'ui-tempo');
    }));
    this.speedBtn = new Button(this, 'x1', 56, 44, () => {
      const sp = BALANCE.speeds as readonly number[];
      this.setSpeed(sp[(sp.indexOf(this.run.state.speed) + 1) % sp.length]);
    });
    if (this.run.state.speed !== 1) this.speedBtn.setLabel(`x${this.run.state.speed}`).setOn(true); // sandbox: velocità scelta
    this.retreatBtn = new Button(this, 'EXTRACT', 124, 44, () => this.onRetreat(), 16, { icon: 'li-exit' }); // (Nico: "invece di retreat, extract")
    this.linesBtn = new Button(this, 'LINES', 118, 44, () => this.toggleLines(), 16, { icon: 'li-waypoints' }); // icona: si capisce che parla delle linee (Nico)
    this.linesBtn.setVisible(!this.run.state.opts.tutorial);
    this.linesPanel = null;
    this.linesKey = '';
    this.pauseBtn = new Button(this, '❚❚', 56, 44, () => this.togglePause());
    // in alto a destra (Nico): MAPPA (viste della carta: politica, terreno, logistica) e COSTRUISCI (scegli l'edificio e
    // trascini sulle tue province, come il vecchio muro). I comandi restano sul tasto H.
    this.mapBtn = new Button(this, 'MAP', 150, 34, () => this.toggleMenu('mappa'), 12, { icon: 'li-map' }); // più largo: COSTRUISCI non stava (Nico)
    this.buildBtn = new Button(this, 'BUILD', 150, 34, () => this.toggleBuildMenu(), 12, { icon: 'li-hammer' });
    this.buildBtn.setVisible(!this.run.state.opts.tutorial);
    // tempo che manca sul tasto stesso (prima si vedeva solo aprendo il pannello); nella guida resta la medaglia
    const tut = this.run.state.opts.tutorial;
    // tempo della campagna senza clessidra (Nico); la sandbox senza limite mostra il tempo trascorso
    this.medalBtn = new Button(this, tut ? '' : this.clockText(), tut ? 44 : MEDAL_W + 18, 44, () => this.toggleMedal(), tut ? 22 : 15, { icon: tut ? 'ico-medaglia' : 'li-clock' });
    this.medalPanel = null;
    this.audioBtn = new Button(this, '', 44, 44, () => this.toggleAudio(), 22, { icon: audioSettings().muted ? 'ico-muto' : 'ico-audio' });
    this.audioPanel = null;
    const offAudio = onAudioChange(() => this.audioBtn.setIcon(audioSettings().muted ? 'ico-muto' : 'ico-audio'));
    this.radarBtn = new Button(this, 'RADAR', 130, 44, () => this.openReport(), 13, { icon: 'li-radar' }); // largo: il numero ci sta
    this.radarBtn.setVisible(!tut && this.run.state.opts.events > 0);
    this.econBtn = new Button(this, 'ECONOMY', 136, 44, () => this.toggleEcon(), 13, { icon: 'li-coins' });
    this.econBtn.setVisible(!tut);
    // profilo e impostazioni sotto COSTRUISCI (Nico: "anche se fasulli"): il profilo per ora non apre niente, le impostazioni l'audio
    this.profileBtn = new Button(this, '', 72, 34, () => undefined, 16, { icon: 'li-user' });
    this.settingsBtn = new Button(this, '', 72, 34, () => this.toggleAudio(), 16, { icon: 'li-settings' });
    this.profileBtn.setVisible(!tut && !view(this).portrait);
    this.settingsBtn.setVisible(!tut && !view(this).portrait);
    this.events.once('shutdown', offAudio);
    this.menu = null;
    this.menuOf = null;
    this.legend = null;
    this.help = null;
    this.forecast = null;
    for (const b of [this.speedBtn, this.retreatBtn, this.linesBtn, this.pauseBtn, this.mapBtn, this.buildBtn, this.medalBtn, this.audioBtn, this.radarBtn, this.econBtn, this.profileBtn, this.settingsBtn]) b.terminal();
    this.refreshRadar();
    this.input.keyboard?.on('keydown-L', () => this.toggleLogistics());
    this.input.keyboard?.on('keydown-H', () => this.toggleHelp());
    this.input.keyboard?.on('keydown-ESC', () => { if (this.help) this.toggleHelp(); this.closeMenu(); });
    // tocco fuori dalla tendina (e fuori dai suoi tasti): si chiude. Solo un tocco, non un trascinamento: spostando la carta
    // la tendina (e la mappa delle costruzioni) restavano aperte prima e poi sparivano (Nico)
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const m = this.menu;
      if (!m || Phaser.Math.Distance.Between(p.downX, p.downY, p.upX, p.upY) > 8) return;
      const r = m.list[0] as Phaser.GameObjects.Rectangle, x = p.x / UI(), y = p.y / UI(); // punti CSS
      const inMenu = x >= m.x && x <= m.x + r.width && y >= m.y && y <= m.y + r.height;
      if (!inMenu && !this.mapBtn.contains(x, y) && !this.buildBtn.contains(x, y)) this.closeMenu();
    });
    this.pauseUi = null;
    this.pauseFrame = this.add.graphics().setDepth(39).setVisible(false);
    // partita ripresa già in pausa (dopo un ricaricamento): cornice e tasto come in pausa. Prima il tempo era fermo senza
    // nessun segno e il gioco sembrava bloccato (Nico, 27 novembre 2026: "sembra mezzo freezato")
    this.time.delayedCall(0, () => {
      const st = this.run.state;
      if (st.paused && !st.over && !this.pauseFrame.visible) { st.paused = false; this.togglePause(); }
    });
    // PC: barra spaziatrice (o P) = pausa strategica, come in HOI4
    this.input.keyboard?.on('keydown-SPACE', () => this.togglePause());
    this.input.keyboard?.on('keydown-P', () => this.togglePause());
    this.setSpeed(this.run.state.speed);

    this.hint.setVisible(false); // il cartellino piccolo non si mostra mai (vedi setHint)
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

  private setMapMode(m: 'politica' | 'terreno' | 'logistica' | 'strutture') {
    this.run.setMapMode(m);
    this.mapBtn.setOn(m !== 'politica');
    this.setHint(m === 'logistica' ? 'LOGISTICS: green full supply, yellow falling, red cut off from the capital\nFull supply up to 8 provinces from the capital and 2 around each depot, dashed lines: where each unit gets supplies' : null);
    this.legend?.destroy();
    this.legend = m === 'terreno' ? this.terrainLegend() : m === 'strutture' ? this.worksLegend() : null;
  }

  /** Legenda della vista Strutture (e di COSTRUISCI): campione a puntini nel colore della costruzione e il nome. */
  private worksLegend(): Phaser.GameObjects.Container {
    const keys = BUILDABLE.filter((k) => WORK_VIEW[k]); // solo quelle che si costruiscono
    const W = 200, RH = 20, top = 22, H = top + keys.length * RH + 6;
    const g = this.add.graphics();
    termBox(g, 0, 0, W, H, 0.95);
    const items: Phaser.GameObjects.GameObject[] = [g, termNotch(this, 0, 0, 'Structures')];
    keys.forEach((k, i) => {
      const r = WORK_VIEW[k], y = top + i * RH;
      g.fillStyle(Phaser.Display.Color.HexStringToColor(r.col).color, 1);
      for (let Y = 0; Y < 4; Y++) for (let X = 0; X < 10; X++) {
        if (r.stripe && (r.stripe === 1 ? X + Y : X - Y + 40) % 4 >= 2) continue;
        g.fillRect(12 + X * 3, y + 3 + Y * 3, 1.6, 1.6);
      }
      items.push(this.add.text(52, y + 2, WORK_NAME[k], termStyle(12, TCOL.text)));
    });
    return this.add.container(PAD, this.topBottom + 10, items).setDepth(40);
  }

  /** Legenda della vista del terreno: un campione a puntini (pieno o a righe, come sulla carta) e il nome. */
  private terrainLegend(): Phaser.GameObjects.Container {
    const keys = Object.keys(TERRAIN_VIEW) as (keyof typeof BALANCE.terrain)[], rows = keys.map((k) => TERRAIN_VIEW[k]);
    const W = 250, RH = 34, top = 22, H = top + rows.length * RH + 6;
    const g = this.add.graphics();
    termBox(g, 0, 0, W, H, 0.95);
    const items: Phaser.GameObjects.GameObject[] = [g, termNotch(this, 0, 0, 'Terrain')];
    rows.forEach((r, i) => {
      const y = top + i * RH, col = Phaser.Display.Color.HexStringToColor(r.col).color;
      g.fillStyle(col, 1);
      for (let Y = 0; Y < 5; Y++) for (let X = 0; X < 10; X++) {
        if (r.stripe && (r.stripe === 1 ? X + Y : X - Y + 40) % 4 >= 2) continue;
        g.fillRect(12 + X * 3, y + 2 + Y * 3, 1.6, 1.6);
      }
      // cosa fa il terreno: difesa, marcia, cosa produce
      const T = BALANCE.terrain[keys[i]];
      items.push(this.add.text(52, y + 1, r.name, termStyle(13, TCOL.text)),
        this.add.text(52, y + 16, `defence ×${T.defense}, march ×${T.move}, ${RESOURCE_INFO[T.res].name.toLowerCase()}`, termStyle(11, TCOL.label)));
    });
    return this.add.container(PAD, this.topBottom + 10, items).setDepth(40);
  }

  /** Altoparlante: apre/chiude le impostazioni audio (l'icona diventa barrata se è muto). */
  private toggleEcon() {
    if (this.econPanel) { this.econPanel.destroy(); this.econPanel = null; this.econBtn.setOn(false); return; }
    this.econBtn.setOn(true);
    this.drawEcon();
  }

  /**
   * ECONOMIA alla Call of War (Nico): scheda grande al centro. In alto, grandi, le cose che contano: il netto al minuto di
   * ogni risorsa (verde se cresce, rosso se cala, e fra quanto finisce) e le truppe. Sotto, riquadri separati (Nico, 27
   * novembre 2026: "separata meglio, evidenziare le cose importanti, mettere tutte le cose"): risorse voce per voce,
   * truppe, impero, province che producono di più.
   */
  private drawEcon() {
    this.econPanel?.destroy();
    const st = this.run.state, net = st.incomePerMin(), sp = st.upkeepSplit();
    const { width, height } = view(this), W = Math.min(820, width - 2 * PAD), M = 18, GAP = 14, CW = (W - 2 * M - GAP) / 2;
    const items: Phaser.GameObjects.GameObject[] = [], g = this.add.graphics();
    items.push(g);
    const f1 = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1));
    const sign = (n: number) => `${n >= 0 ? '+' : '−'}${f1(Math.abs(n))}`;
    items.push(this.add.text(M, 14, 'ECONOMY', termStyle(18, TCOL.text)));
    const close = this.add.text(W - M, 16, '✕', termStyle(16, TCOL.label)).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on('pointerup', () => this.toggleEcon());
    items.push(close);
    // riquadro: fondo appena più chiaro e filo, titolo dentro
    const box = (x: number, y: number, w: number, h: number, title: string) => {
      g.fillStyle(TCOL.hover, 0.55).fillRect(x, y, w, h).lineStyle(1, TCOL.edge, 0.45).strokeRect(x, y, w, h);
      items.push(this.add.text(x + 12, y + 10, title, termStyle(11, TCOL.label)));
    };

    // 1. in evidenza: netto al minuto per risorsa + truppe
    let y = 48;
    const HH = 92, cells = RESOURCES.length + 1, cw = (W - 2 * M - GAP * (cells - 1)) / cells;
    RESOURCES.forEach((r, i) => {
      const x = M + i * (cw + GAP), n = net[r], col = n >= 0 ? TCOL.ok : TCOL.alert;
      g.fillStyle(TCOL.hover, 0.55).fillRect(x, y, cw, HH).lineStyle(1, n >= 0 ? TCOL.edge : TCOL.alert, n >= 0 ? 0.45 : 0.9).strokeRect(x, y, cw, HH);
      items.push(resIcon(this, r, x + 20, y + 20, 16), this.add.text(x + 34, y + 12, RESOURCE_INFO[r].name.toUpperCase(), termStyle(11, TCOL.label)),
        this.add.text(x + 12, y + 32, `${sign(n)}/min`, termStyle(28, col)),
        this.add.text(x + 12, y + 68, n < 0 && st.backpack[r] > 0 ? `${short(st.backpack[r])} in stock, runs out in ${Math.max(1, Math.round(st.backpack[r] / -n))} min` : `${short(st.backpack[r])} in stock`, termStyle(11, n < 0 ? TCOL.alert : TCOL.label)));
    });
    {
      const x = M + RESOURCES.length * (cw + GAP);
      g.fillStyle(TCOL.hover, 0.55).fillRect(x, y, cw, HH).lineStyle(1, TCOL.edge, 0.45).strokeRect(x, y, cw, HH);
      items.push(icon(this, 'res-truppe', x + 20, y + 20, 16, TCOL.text), this.add.text(x + 34, y + 12, 'TROOPS', termStyle(11, TCOL.label)),
        this.add.text(x + 12, y + 32, short(st.troops), termStyle(28, TCOL.text)),
        this.add.text(x + 12, y + 68, `+${rate(st.troopsPerSecond)}/s in reserve`, termStyle(11, TCOL.ok)));
    }
    y += HH + GAP;

    // grafici degli ultimi 10 minuti di gioco (Nico, 26 novembre 2026: "mettici grafici e altre robe"): scorte, netto al
    // minuto (con lo zero), truppe in riserva e province
    {
      const CH = 118, n = 3, gw = (W - 2 * M - GAP * (n - 1)) / n, hist = this.econHist;
      const series = (f: (s: EconSample) => number) => hist.map(f);
      const chart = (i: number, title: string, lines: { v: number[]; c: number }[], zero: boolean, fmt: (v: number) => string) => {
        const x = M + i * (gw + GAP);
        box(x, y, gw, CH, title);
        const px = x + 12, py = y + 30, pw = gw - 24, ph = CH - 52;
        const all = lines.flatMap((l) => l.v);
        if (all.length < 2) { items.push(this.add.text(px, py + ph / 2, 'collecting data...', termStyle(11, TCOL.dim)).setOrigin(0, 0.5)); return; }
        let lo = Math.min(...all, zero ? 0 : Infinity), hi = Math.max(...all, zero ? 0 : -Infinity);
        if (hi - lo < 1e-6) { hi += 1; lo -= zero ? 1 : 0; }
        const Y = (v: number) => py + ph - ((v - lo) / (hi - lo)) * ph;
        if (zero && lo < 0) g.lineStyle(1, TCOL.edge, 0.7).lineBetween(px, Y(0), px + pw, Y(0));
        for (const l of lines) {
          g.lineStyle(2, l.c, 1).beginPath();
          l.v.forEach((v, k) => { const xx = px + pw - ((l.v.length - 1 - k) / (EconHistMax - 1)) * pw; /* ora a destra, il passato verso sinistra */ if (k) g.lineTo(xx, Y(v)); else g.moveTo(xx, Y(v)); });
          g.strokePath();
        }
        items.push(this.add.text(px + pw, py - 2, fmt(hi), termStyle(10, TCOL.label)).setOrigin(1, 1),
          this.add.text(px + pw, py + ph + 2, fmt(lo), termStyle(10, TCOL.label)).setOrigin(1, 0),
          this.add.text(px, py + ph + 4, `${Math.round((hist.length - 1) * EconHistStepMs / 60_000 * 10) / 10} min ago`, termStyle(10, TCOL.dim)));
      };
      chart(0, 'IN STOCK', RESOURCES.map((r) => ({ v: series((s) => s.stock[r]), c: RESOURCE_INFO[r].color })), false, short);
      chart(1, 'NET PER MINUTE', RESOURCES.map((r) => ({ v: series((s) => s.net[r]), c: RESOURCE_INFO[r].color })), true, (v) => sign(v));
      chart(2, 'TROOPS AND PROVINCES', [{ v: series((s) => s.troops), c: TCOL.text }, { v: series((s) => s.prov * Math.max(1, ...hist.map((h) => h.troops)) / Math.max(1, ...hist.map((h) => h.prov))), c: TCOL.ok }], false, short);
      y += CH + GAP;
    }

    // 2. risorse voce per voce (sinistra) e truppe + impero (destra)
    const L = M, R = M + CW + GAP, top = y;
    const rowAt = (x: number, yy: number, k: string, vals: string[], col: number | number[] = TCOL.text, colW = 66) => {
      items.push(this.add.text(x + 12, yy, k, termStyle(12, TCOL.label)));
      vals.forEach((v, i) => items.push(this.add.text(x + CW - 12 - (vals.length - 1 - i) * colW, yy, v, termStyle(12, Array.isArray(col) ? col[i] : col)).setOrigin(1, 0)));
    };
    const dep = (r: Resource) => sp.depots * BALANCE.upkeep.depotSplit[r]; // i depositi costano di tutto
    const gross = RESOURCES.map((r) => net[r] + sp.units[r] + dep(r));
    const resRows: [string, string[], number | number[]][] = [
      ['production', gross.map((v) => `+${f1(v)}`), TCOL.ok],
      ['units upkeep', RESOURCES.map((r) => (sp.units[r] ? `−${f1(sp.units[r])}` : '0')), TCOL.alert],
      ['supply depots', RESOURCES.map((r) => (dep(r) ? `−${f1(dep(r))}` : '0')), TCOL.alert],
      ['net', RESOURCES.map((r) => sign(net[r])), RESOURCES.map((r) => (net[r] >= 0 ? TCOL.ok : TCOL.alert))],
      ['in stock', RESOURCES.map((r) => short(st.backpack[r])), TCOL.text],
    ];
    let ly = top;
    const lh = 34 + 22 + resRows.length * 21 + 8;
    box(L, ly, CW, lh, 'RESOURCES PER MINUTE');
    RESOURCES.forEach((r, i) => items.push(resIcon(this, r, L + CW - 12 - (2 - i) * 66 - 22, ly + 38, 14)));
    ly += 52;
    resRows.forEach(([k, v, c], i) => {
      if (k === 'net') g.lineStyle(1, TCOL.edge, 0.35).lineBetween(L + 12, ly - 3, L + CW - 12, ly - 3);
      rowAt(L, ly, k, v, c);
      ly += 21;
      void i;
    });
    ly = top + lh + GAP;
    // province che producono di più, sotto le risorse
    const provs = st.map.provinces, nations = new Map(st.map.nations.map((n) => [n.id, n.name]));
    const best = [...st.ownedProvinces(PLAYER)].map((p) => ({ p, v: st.provPerMin(p) })).sort((a, b) => b.v - a.v).slice(0, 5); // 5 (prima 8): sopra ci sono i grafici
    const th = 34 + Math.max(1, best.length) * 21 + 6;
    box(L, ly, CW, th, 'TOP PROVINCES');
    let ty = ly + 32;
    for (const { p, v } of best) {
      const w = st.workOf(p), res = BALANCE.terrain[provs[p].terrain].res;
      items.push(resIcon(this, res, L + 20, ty + 7, 13),
        this.add.text(L + 34, ty, `${nations.get(provs[p].country) ?? 'Province'}${st.isCity(p) ? ', city' : ''}`, termStyle(12, TCOL.text)).setWordWrapWidth(CW - 170).setMaxLines(1),
        this.add.text(L + CW - 70, ty, w ? WORK_NAME[w] : '', termStyle(11, TCOL.label)).setOrigin(1, 0),
        this.add.text(L + CW - 12, ty, `+${f1(v)}`, termStyle(12, TCOL.ok)).setOrigin(1, 0));
      ty += 21;
    }
    const leftH = ly + th;

    // destra: truppe e impero
    const mine = st.unitsOf(PLAYER), rep = mine.reduce((n, u) => n + u.size, 0);
    const troopRows: [string, string, number?][] = [
      ['in reserve', short(st.troops)],
      ['growth', `+${rate(st.troopsPerSecond)}/s`, TCOL.ok],
      ['units in the field', `${mine.length}, ${rep} squads`],
      ['next infantry costs', `${st.unitCost(PLAYER, 'fanteria')} troops`],
      ['healing', `${BALANCE.upkeep.healTroops} troop per health point`],
    ];
    let ry = top;
    const trh = 34 + troopRows.length * 21 + 6;
    box(R, ry, CW, trh, 'TROOPS');
    ry += 32;
    for (const [k, v, c] of troopRows) { rowAt(R, ry, k, [v], c ?? TCOL.text); ry += 21; }
    ry = top + trh + GAP;
    const owned = [...st.ownedProvinces(PLAYER)], eff = st.adminEff(PLAYER);
    const empRows: [string, string, number?][] = [
      ['provinces', String(st.player.provinces)],
      ['cities', String(owned.filter((p) => st.isCity(p)).length)],
      ['buildings', String(owned.filter((p) => st.workOf(p)).length)],
      ['supply depots', String(st.depotLinks.length)],
      ['output per province', `${Math.round(eff * 100)}%`, eff < 0.5 ? TCOL.alert : TCOL.text],
    ];
    const eh = 34 + empRows.length * 21 + 6;
    box(R, ry, CW, eh, 'EMPIRE');
    let ey = ry + 32;
    for (const [k, v, c] of empRows) { rowAt(R, ey, k, [v], c ?? TCOL.text); ey += 21; }
    const rightH = ry + eh;

    const H = Math.max(leftH, rightH) + M;
    items.unshift(this.add.rectangle(0, 0, W, H, TCOL.bg, 0.97).setOrigin(0).setStrokeStyle(1, TCOL.edge, 0.8));
    this.econPanel = this.add.container(Math.round((width - W) / 2), Math.round(Math.max(this.topBottom + 10, (height - H) / 2)), items).setDepth(48);
  }

  /** Storia per i grafici dell'economia: un campione ogni `EconHistStepMs` di gioco, gli ultimi `EconHistMax`. */
  private econHist: EconSample[] = [];
  private econHistAt = -Infinity;
  private sampleEcon() {
    const st = this.run.state;
    if (st.gameTimeMs - this.econHistAt < EconHistStepMs) return;
    this.econHistAt = st.gameTimeMs;
    this.econHist.push({ stock: { ...st.backpack }, net: { ...st.incomePerMin() }, troops: st.troops, prov: st.player.provinces });
    if (this.econHist.length > EconHistMax) this.econHist.shift();
  }

  private toggleAudio() {
    if (this.audioPanel) {
      this.audioPanel.destroy();
      this.audioPanel = null;
      this.audioBtn.setOn(false);
      return;
    }
    const b = this.audioBtn, x = Math.min(b.x, view(this).width - PAD - 236);
    this.audioPanel = openAudioPanel(this, x, b.y + 44 + 8, 'term');
    this.audioBtn.setOn(true);
  }

  /** Medaglia: apre/chiude il pannello con province, classifica e fine campagna. */
  private toggleMedal() {
    if (this.medalPanel) { this.medalPanel.destroy(); this.medalPanel = null; this.medalBtn.setOn(false); return; }
    this.openMedal();
    this.medalBtn.setOn(true);
  }

  private medalKey = '';
  private medalKeyOf(): string {
    const st = this.run.state, { pos, gap } = st.rank(), left = Math.max(0, st.timeLeft);
    return `${st.player.provinces}|${pos}|${gap}|${mmss(left)}|${left <= BALANCE.campaign.warnMs}`;
  }

  private openMedal() {
    this.medalKey = this.medalKeyOf();
    this.medalPanel?.destroy();
    const st = this.run.state, { pos, gap } = st.rank(), n = st.player.provinces;
    const left = Math.max(0, st.timeLeft), warn = left <= BALANCE.campaign.warnMs;
    // tre righe con la loro icona: province, classifica (o obiettivo della guida), fine campagna
    const lines: [string, string, number][] = [
      ['ui-province', `${n} ${n === 1 ? 'province' : 'provinces'}`, TCOL.text],
      ['ui-trofeo', st.opts.tutorial ? `Goal ${BALANCE.tutorial.goalProvinces} provinces` : pos === 1 ? `1st in the ranking (+${gap})` : `${ord(pos)} in the ranking`, TCOL.text],
    ];
    if (!st.opts.tutorial) lines.push(['ui-tempo', `Campaign ends in ${mmss(left)}`, warn ? PALETTE.ko : TCOL.text]);
    const W = 230, H = 22 + lines.length * 26 + 6;
    const bg = this.add.rectangle(0, 0, W, H, TCOL.bg, 0.95).setOrigin(0).setStrokeStyle(1, TCOL.edge, 0.6);
    const items: Phaser.GameObjects.GameObject[] = [bg, termNotch(this, 8, 0, 'campaign').setOrigin(0, 0.5)];
    lines.forEach(([ic, l, col], k) => {
      const ly = 26 + k * 26;
      items.push(icon(this, ic, 22, ly, 14, col), this.add.text(38, ly, l, termStyle(13, col)).setOrigin(0, 0.5));
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
    type Row = { label: string; sub?: string; on: boolean; off: boolean; icon?: WorkId; li?: LineIcon; pick: () => void };
    const rows: Row[] = kind === 'mappa'
      // Structures tolta (Nico: doppione di COSTRUISCI); icona per vista
      ? (['politica', 'terreno', 'logistica'] as const).map((m) => ({
        label: { politica: 'Political', terreno: 'Terrain', logistica: 'Logistics' }[m], on: this.run.mapMode === m, off: false,
        li: ({ politica: 'flag', terreno: 'mountain', logistica: 'truck' } as const)[m], pick: () => this.setMapMode(m),
      }))
      : BUILDABLE.map((w) => {
        const D = BALANCE.works[w], locked = !!D.tech && !st.opts.techs.includes(D.tech);
        return {
          label: WORK_NAME[w], icon: w, on: false, off: locked,
          sub: locked ? `needs ${techInfo(D.tech).name}` : workCostText(st.workPrice(w), st.workCost(w)),
          pick: () => { if (locked) return this.toast(`Needs the research ${techInfo(D.tech).name}`, PALETTE.ko, 'ui-lucchetto'); this.run.setBuildMode(w); },
        };
      });
    const H = rows.length * RH + 8;
    const items: Phaser.GameObjects.GameObject[] = [this.add.rectangle(0, 0, W, H, TCOL.bg, 0.96).setOrigin(0).setStrokeStyle(1, TCOL.edge, 0.75)];
    const g = this.add.graphics();
    rows.forEach((r, i) => {
      const y = 4 + i * RH;
      const hit = this.add.rectangle(4, y, W - 8, RH - 2, r.on ? TCOL.hover : TCOL.bg).setOrigin(0).setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => hit.setFillStyle(TCOL.hover)).on('pointerout', () => hit.setFillStyle(r.on ? TCOL.hover : TCOL.bg));
      hit.on('pointerup', () => { this.closeMenu(); r.pick(); buzz(10); sfx('click'); });
      items.push(hit);
      const tx = r.icon || r.li ? 34 : 14, col = r.off ? TCOL.dim : TCOL.text;
      if (r.li) items.push(lineIcon(this, r.li, 20, y + RH / 2 - 1, 15, col));
      if (r.icon) items.push(this.add.image(20, y + RH / 2 - 1, dotTexture(this, `ic-w-${r.icon}`)).setDisplaySize(20, 20).setTint(col)); // a puntini come la carta
      if (kind === 'mappa' && r.on) items.push(icon(this, 'ui-spunta', W - 20, y + RH / 2 - 1, 14, TCOL.ok));
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
    if (this.buildPanel) { this.closeBuildPanel(); if (this.run.wallMode) this.run.setBuildMode(null); return; }
    this.closeMenu();
    this.openBuildPanel();
    // riaperto: l'ultima costruzione scelta è già pronta (Nico: passare da logistica a deposito senza ricliccare)
    if (this.lastBuild && !this.run.wallMode) this.run.setBuildMode(this.lastBuild);
  }

  /**
   * COSTRUISCI (Nico, 26 novembre 2026): in basso a sinistra, al posto dei reparti, le costruzioni con il loro motivo sulla
   * carta (fa da legenda finché il pannello è aperto), icona, cosa fanno e quanto costano. Si sceglie da qui.
   */
  private openBuildPanel() {
    this.buildPanel?.destroy();
    const st = this.run.state, cur = this.run.buildWorkId;
    this.run.setBuildPeek(true);
    for (const c of [...this.cards, ...this.abilityCards]) c.setVisible(false);
    this.dockG.setVisible(false);
    this.notches[3].setVisible(false);
    this.notches[4].setVisible(false);
    // edificio scelto in grande in cima (Nico, 26 novembre 2026: "quando clicchi City voglio che esca bello grande City, che
    // capisci cosa hai selezionato"): nome, cosa fa e prezzo
    const W = 330, RH = 46, head = cur ? 92 : 0, top = 28 + head, H = top + BUILDABLE.length * RH + 6, { height } = view(this);
    const g = this.add.graphics(), items: Phaser.GameObjects.GameObject[] = [];
    const bg = this.add.rectangle(0, 0, W, H, TCOL.bg, 0.96).setOrigin(0).setStrokeStyle(1, TCOL.edge, 0.75);
    items.push(bg, this.add.text(10, 8, 'BUILD', termStyle(12, TCOL.label)));
    if (cur) {
      const wc = Phaser.Display.Color.HexStringToColor(WORK_VIEW[cur]?.col ?? '#e9ebe6').color;
      items.push(this.add.image(30, 50, dotTexture(this, `ic-w-${cur}`)).setDisplaySize(36, 36).setTint(wc),
        this.add.text(58, 30, WORK_NAME[cur].toUpperCase(), termStyle(30, TCOL.text)),
        this.add.rectangle(10, 28 + head - 6, W - 20, 1, TCOL.edge, 0.6).setOrigin(0));
      this.costIcons(items, st.workCost(cur), 58, 74, 13, false);
    }
    BUILDABLE.forEach((w, i) => {
      const D = BALANCE.works[w], locked = !!D.tech && !st.opts.techs.includes(D.tech), y = top + i * RH, on = cur === w;
      const wc = Phaser.Display.Color.HexStringToColor(WORK_VIEW[w]?.col ?? '#e9ebe6').color;
      const hit = this.add.rectangle(4, y, W - 8, RH - 4, on ? TCOL.hover : TCOL.bg).setOrigin(0).setInteractive({ useHandCursor: true });
      if (on) items.push(this.add.rectangle(4, y, 3, RH - 4, wc).setOrigin(0)); // scelta: barretta del suo colore
      hit.on('pointerover', () => hit.setFillStyle(TCOL.hover)).on('pointerout', () => hit.setFillStyle(on ? TCOL.hover : TCOL.bg));
      hit.on('pointerup', () => {
        buzz(10); sfx('click');
        if (locked) return this.toast(`Needs the research ${techInfo(D.tech).name}`, PALETTE.ko, 'ui-lucchetto');
        this.run.setBuildMode(on ? null : w);
      });
      items.push(hit);
      // campione a puntini come sulla carta (fa da legenda), più grande
      g.fillStyle(0x000000, 1).fillRect(10, y + 10, 22, 22);
      g.fillStyle(wc, 1);
      for (let Y = 0; Y < 6; Y++) for (let X = 0; X < 6; X++) g.fillRect(12 + X * 3.2, y + 12 + Y * 3.2, 2, 2);
      const col = locked ? TCOL.dim : TCOL.text;
      items.push(this.add.image(48, y + RH / 2 - 2, dotTexture(this, `ic-w-${w}`)).setDisplaySize(20, 20).setTint(col));
      items.push(this.add.text(64, y + 4, WORK_NAME[w], termStyle(13, col)),
        ...(locked ? [this.add.text(W - 12, y + 5, 'locked', termStyle(10, TCOL.dim)).setOrigin(1, 0)] : []),
        this.add.text(64, y + 21, locked ? `needs ${techInfo(D.tech).name}` : workDesc(w, ''), { ...termStyle(10, TCOL.label), wordWrap: { width: W - 76 } }));
      if (!locked) this.costIcons(items, st.workCost(w), W - 12, y + 11, 10, true);
    });
    items.push(g); // campioni sopra il fondo delle righe
    this.buildPanel = this.add.container(PAD, height - PAD - STATUS_H - H, items).setDepth(46);
    this.buildKey = this.buildKeyOf();
    this.buildBtn.setOn(true);
  }

  private buildAcc = 0;
  private buildKey = '';
  private buildKeyOf(): string {
    const st = this.run.state, have = st.backpack;
    return BUILDABLE.map((w) => { const c = st.workCost(w); return RESOURCES.map((r) => `${c[r]}${have[r] < c[r] ? '!' : ''}`).join(','); }).join('|') + this.run.buildWorkId;
  }

  /** Prezzo come icone delle risorse e numeri, da sinistra (o allineato a destra a `x`). Rosso dove non ti basta. */
  private costIcons(items: Phaser.GameObjects.GameObject[], cost: Bag, x: number, y: number, size: number, right: boolean) {
    const have = this.run.state.backpack, parts = RESOURCES.filter((r) => cost[r] > 0);
    if (!parts.length) { items.push(this.add.text(x, y, 'free', termStyle(size, TCOL.label)).setOrigin(right ? 1 : 0, 0.5)); return; }
    const made = parts.map((r) => ({ r, t: this.add.text(0, y, String(cost[r]), termStyle(size, have[r] < cost[r] ? TCOL.alert : TCOL.label)).setOrigin(0, 0.5) }));
    const iw = size + 3, gap = 8, total = made.reduce((s, m) => s + iw + m.t.width, 0) + gap * (made.length - 1);
    let cx = right ? x - total : x;
    for (const m of made) {
      items.push(resIcon(this, m.r, cx + size / 2, y, size));
      m.t.setX(cx + iw);
      items.push(m.t);
      cx += iw + m.t.width + gap;
    }
  }

  private closeBuildPanel() {
    if (!this.buildPanel) return;
    this.buildPanel.destroy();
    this.buildPanel = null;
    this.run.setBuildPeek(false);
    for (const c of [...this.cards, ...this.abilityCards]) c.setVisible(true);
    this.dockG.setVisible(true);
    this.notches[3].setVisible(!view(this).portrait);
    this.notches[4].setVisible(!view(this).portrait && this.abilityCards.length > 0);
    this.buildBtn.setOn(!!this.run.buildWorkId);
  }

  /** Elenco dei comandi (tasto H). */
  private toggleHelp() {
    if (this.help) {
      this.help.destroy();
      this.help = null;
      return;
    }
    const { width, height } = view(this);
    // comandi in quattro gruppi con la loro icona (prima: un muro di venti righe)
    const groups: [string, string, [string, string][]][] = [
      ['Map', 'ui-mappa', [
        ['Tap a highlighted province', 'buy it with troops (enemy land: with units)'],
        ['Tap one of your provinces', 'info and buildings'],
        ['Press and hold', 'info on who owns the province'],
        ['Right-drag, WASD or arrows', 'move the map (phone: drag with a finger)'],
        ['Wheel or pinch', 'zoom'],
        ['Mouse over a border province', 'assault forecast (with units selected: the route)'],
        ['MAP: L', 'map views: political, terrain, logistics, L: logistics'],
      ]],
      ['Units', 'u-fanteria', [
        ['Unit card, then your territory', 'deploys the unit'],
        ['Click a unit', 'selects it'],
        ['Shift + click', 'add or remove the unit from the group'],
        ['Left-drag', 'box: selects several units (Shift: add)'],
        ['Right-click or tap the destination', 'sends the selected units'],
        ['G, then drag', 'attack line: the selected units deploy along the line'],
        ['T, F', 'units: defend or attack on their own, assign to a front'],
        ['U, I, R', 'merge, split, retreat the selected units'],
        ['Ctrl or Shift + number, number', 'saves the group, recalls it (twice: the map goes there)'],
      ]],
      ['Abilities and buildings', 'ui-costruisci', [
        ['Ability card, then the map', 'air reconnaissance or bombardment'],
        ['BUILD or B, choose, then drag', 'the building on all your provinces you touch'],
      ]],
      ['Match', 'ui-pausa', [
        ['Space or P', 'strategic pause: taps prepare the plan'],
        ['H', 'these controls, Esc closes'],
      ]],
    ];
    const W = Math.min(680, width - 2 * PAD), kx = 18, vx = Math.min(300, W * 0.46);
    // righe che vanno a capo se serve: l'altezza del riquadro si calcola dopo
    const texts: Phaser.GameObjects.GameObject[] = [];
    let y = 34;
    for (const [name, ic, rows] of groups) {
      texts.push(icon(this, ic, kx + 8, y + 9, 16, TCOL.text), this.add.text(kx + 26, y + 9, name, termStyle(14, TCOL.text)).setOrigin(0, 0.5));
      y += 28;
      for (const [k, v] of rows) {
        const kt = this.add.text(kx, y, k, termStyle(12, TCOL.text)).setWordWrapWidth(vx - kx - 10); // il tasto: bianco
        const vt = this.add.text(vx, y, v, termStyle(12, TCOL.label)).setWordWrapWidth(W - vx - 14); // cosa fa: grigio
        texts.push(kt, vt);
        y += Math.max(kt.height, vt.height) + 6;
      }
      y += 14;
    }
    const H = y;
    const items: Phaser.GameObjects.GameObject[] = [
      this.add.rectangle(0, 0, W, H, TCOL.bg, 0.96).setOrigin(0).setStrokeStyle(1, TCOL.edge, 0.75).setInteractive(),
      termNotch(this, 0, 0, 'controls'),
      ...texts,
    ];
    const close = icon(this, 'ui-chiudi', W - 20, 20, 14, TCOL.text);
    const hit = this.add.rectangle(W - 44, 0, 44, 40, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true }).on('pointerup', () => this.toggleHelp());
    items.push(close, hit);
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
    this.retreatBtn.setLabel(fee ? `LEAVE −${fee}%?` : 'CONFIRM?').setOn(true); // uscire prima della fine costa
    this.retreatArmed = this.time.delayedCall(2500, () => {
      this.retreatArmed = null;
      this.retreatBtn.setLabel('EXTRACT').setOn(false);
    });
  }

  private tipBox: Phaser.GameObjects.Container | null = null;

  /** Scheda del reparto al passaggio sulla carta, alla Call of War: barre di vita, attacco, velocità e gittata, chi batte e
   *  chi teme, quanto costa (truppe + la sua risorsa). null = chiudi. */
  private unitTip(t: UnitType | null) {
    this.tipBox?.destroy();
    this.tipBox = null;
    const card = t ? this.cards.find((c) => c.type === t) : undefined;
    if (!t || !card) return;
    const st = this.run.state, U = BALANCE.units, info = unitInfo(t), u = U[t];
    const land = UNIT_TYPES.filter((k) => !unitInfo(k).naval);
    const max = (f: (k: UnitType) => number) => Math.max(...land.map(f));
    const W = 240, P = 14, items: Phaser.GameObjects.GameObject[] = [];
    const bg = this.add.graphics(), g = this.add.graphics(); // fondo sotto, barre sopra
    items.push(bg, g);
    let y = P;
    items.push(this.add.text(P, y, info.name, termStyle(16, TCOL.text)));
    y += 24;
    items.push(this.add.text(P, y, info.desc, { ...termStyle(11, TCOL.label), wordWrap: { width: W - 2 * P } }));
    y += (items[items.length - 1] as Phaser.GameObjects.Text).height + 10;
    const bars: [string, number, string][] = [
      ['Health', u.hp / max((k) => U[k].hp), String(u.hp)],
      ['Attack', u.attack / max((k) => U[k].attack), String(u.attack)],
      ['Speed', Math.min(...land.map((k) => U[k].moveMs)) / u.moveMs, `${((u.moveMs * U.paceMult) / 1000).toFixed(1)} s/tile`],
      ['Range', u.range / max((k) => U[k].range), `${u.range}`],
    ];
    const bx = P + 62, bw = W - P - bx - 58;
    for (const [k, v, txt] of bars) {
      items.push(this.add.text(P, y, k, termStyle(11, TCOL.label)));
      g.fillStyle(TCOL.dim, 0.5).fillRect(bx, y + 4, bw, 6).fillStyle(TCOL.text, 1).fillRect(bx, y + 4, Math.max(3, bw * v), 6);
      items.push(this.add.text(W - P, y, txt, termStyle(11, TCOL.text)).setOrigin(1, 0));
      y += 18;
    }
    if (t === 'corazzati') {
      items.push(this.add.text(P, y, 'Fast on plains, slow in mountains', termStyle(11, TCOL.label)));
      y += 18;
    }
    y += 4;
    const names = (ids: UnitType[]) => ids.map((k) => unitInfo(k).name.toLowerCase()).join(', ') || '—';
    const beats = land.filter((k) => info.beats.includes(unitInfo(k).cls) && k === unitInfo(k).cls);
    const fears = land.filter((k) => unitInfo(k).beats.includes(info.cls) && k === unitInfo(k).cls);
    items.push(this.add.text(P, y, `Beats  ${names(beats)}`, { ...termStyle(11, TCOL.ok), wordWrap: { width: W - 2 * P } }));
    y += (items[items.length - 1] as Phaser.GameObjects.Text).height + 2;
    items.push(this.add.text(P, y, `Fears  ${names(fears)}`, { ...termStyle(11, TCOL.alert), wordWrap: { width: W - 2 * P } }));
    y += (items[items.length - 1] as Phaser.GameObjects.Text).height + 10;
    g.lineStyle(1, TCOL.edge, 0.4).lineBetween(P, y, W - P, y);
    y += 10;
    // costo: truppe + la sua risorsa, rosso se non basta
    const cost = st.unitCost(PLAYER, t), r = st.unitRes(t);
    items.push(this.add.text(P, y, 'Cost', termStyle(11, TCOL.label)));
    const tc = this.add.text(P + 62, y, `${cost} troops`, termStyle(13, st.troops >= cost ? TCOL.text : TCOL.alert));
    items.push(tc);
    if (r.n) {
      const rx = tc.x + tc.width + 16;
      items.push(resIcon(this, r.res, rx + 7, y + 8, 14));
      items.push(this.add.text(rx + 18, y, `${r.n} ${RESOURCE_INFO[r.res].name.toLowerCase()}`, termStyle(13, st.backpack[r.res] >= r.n ? TCOL.text : TCOL.alert)));
    }
    y += 20 + P - 6;
    termBox(bg, 0, 0, W, y);
    const { height } = view(this), sc = card.scaleX;
    const grid = this.dockGrid();
    const x = PAD + grid.uW + 10, yy = Phaser.Math.Clamp(card.y + (CARD_H * sc) / 2 - y / 2, PAD, height - PAD - y);
    this.tipBox = this.add.container(x, yy, items).setDepth(45);
  }

  private onCard(t: UnitType) {
    const block = this.run.toggleCard(t);
    if (!block) return;
    const msg = ({ locked: 'Needs the Arsenal', cooldown: 'Card recharging', troops: 'Not enough troops', cap: 'Maximum units on the field', tile: '', city: 'Armies are raised in your cities', res: `Needs ${this.run.state.unitRes(t).n} ${RESOURCE_INFO[this.run.state.unitRes(t).res].name.toLowerCase()} in the pack` } as const)[block];
    const card = this.cards.find((c) => c.type === t)!;
    this.tweens.add({ targets: card, x: card.x + 4, duration: 50, yoyo: true, repeat: 2 });
    if (msg) this.toast(msg, PALETTE.ko, block === 'troops' ? 'res-truppe' : block === 'cooldown' ? 'ui-tempo' : block === 'res' ? `res-${this.run.state.unitRes(t).res}` : 'ui-lucchetto');
  }

  private bigPrompt: Phaser.GameObjects.Container | null = null;

  /**
   * Suggerimento (Nico: "più chiari e meglio"): riquadro in alto al centro con cosa fare, perché, e un tasto che lo fa
   * subito; ✕ per chiudere, sparisce da solo dopo 14 s o quando premi il tasto.
   */
  tip(title: string, body: string, action: string, run: () => void) {
    this.tipCard?.destroy();
    const { width } = view(this), W = Math.min(420, width - 2 * PAD), P = 14, items: Phaser.GameObjects.GameObject[] = [];
    const g = this.add.graphics();
    items.push(g, this.add.text(P, P, 'TIP', termStyle(11, TCOL.accent)), this.add.text(P, P + 16, title, termStyle(16, TCOL.text)));
    const b = this.add.text(P, P + 42, body, { ...termStyle(13, TCOL.label), wordWrap: { width: W - 2 * P } });
    items.push(b);
    let h = P + 42 + b.height + 12;
    const bw = 150, bh = 32, btn = this.add.rectangle(P, h, bw, bh, 0xffffff, 1).setOrigin(0).setInteractive({ useHandCursor: true });
    const bt = this.add.text(P + bw / 2, h + bh / 2, action, termStyle(13, 0x0a1018)).setOrigin(0.5);
    const close = this.add.text(W - P, P - 2, '✕', termStyle(16, TCOL.label)).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    items.push(btn, bt, close);
    h += bh + P;
    termBox(g, 0, 0, W, h);
    g.fillStyle(TCOL.accent, 1).fillRect(0, 0, 3, h);
    const box = this.add.container(width / 2 - W / 2, this.topBottom + 10, items).setDepth(46);
    const done = () => { if (this.tipCard === box) { box.destroy(); this.tipCard = null; } };
    btn.on('pointerup', () => { sfx('click'); done(); run(); });
    close.on('pointerup', () => { sfx('close'); done(); });
    this.time.delayedCall(14_000, done);
    this.tipCard = box;
  }
  private tipCard: Phaser.GameObjects.Container | null = null;

  /** Istruzione grande al centro (sandbox: scegli dove partire); null = via. */
  centerPrompt(title: string | null, sub = '') {
    this.bigPrompt?.destroy();
    this.bigPrompt = null;
    if (!title) return;
    const { width, height } = view(this);
    const t = this.add.text(0, 0, title, termStyle(28, TCOL.text)).setOrigin(0.5, 0);
    const d = this.add.text(0, t.height + 6, sub, termStyle(13, TCOL.label)).setOrigin(0.5, 0);
    const w = Math.max(t.width, d.width) + 48, h = t.height + d.height + 36;
    const bg = this.add.rectangle(0, -14, w, h, TCOL.bg, 0.92).setOrigin(0.5, 0).setStrokeStyle(1, TCOL.edge, 0.75);
    this.bigPrompt = this.add.container(width / 2, height * 0.16, [bg, t, d]).setDepth(46);
    this.tweens.add({ targets: t, alpha: { from: 1, to: 0.55 }, duration: 900, yoyo: true, repeat: -1 });
  }

  /** Toglie il messaggio di contesto solo se è ancora quello (un altro arrivato nel frattempo resta). */
  clearHint(msg: string) {
    if (this.hint.text === msg) this.setHint(null);
  }

  /** Messaggio di contesto in alto al centro (null = nascondi). */
  /** Cartellino piccolo d'aiuto: tolto per sempre (Nico, 26 novembre 2026: "o quelli grandi per cose serie o niente").
   *  Le chiamate restano: il cartellino non si mostra mai. */
  setHint(_msg: string | null) {
    this.tweens.killTweensOf(this.hint);
    this.hint.setVisible(false);
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
      // etichetta dentro il riquadro, in alto a sinistra (Nico: sul bordo era centrata male)
      label?.setPosition(x + 10, y + 7).setOrigin(0, 0).setBackgroundColor('rgba(0,0,0,0)').setVisible(true);
    };
    if (portrait) {
      // verticale: una barra in alto (esercito | fronte), sotto il bottino; tasti a destra sotto la barra
      const w = width - 2 * PAD;
      P.setPosition(PAD, topPad).setSize(w, TOP_H);
      box(PAD, topPad, w, 72, this.notches[0].setText(' Army, front '));
      box(PAD, topPad + 80, w, TOP_H - 80, this.resLabel);
      this.notches[1].setVisible(false);
      this.troopIcon.setPosition(PAD + 12, topPad + 30);
      this.troops.setPosition(PAD + 38, topPad + 14);
      this.medalBtn.setPosition(width - PAD - 12 - this.medalBtn.width, topPad + 14);
      this.audioBtn.setPosition(width - PAD - 12 - this.medalBtn.width - 50, topPad + 14);
      this.radarBtn.setPosition(this.audioBtn.x - 6 - this.radarBtn.width, topPad + 14);
      this.econBtn.setPosition(this.radarBtn.x - 6 - this.econBtn.width, topPad + 14);
      this.layoutResources(PAD + 16, topPad + 80 + (TOP_H - 80) / 2 - 4, (w - 40) / 3);
      this.topBottom = topPad + TOP_H;
      this.symPos = this.rows.map(() => ({ x: 0, y: 0 }));
      this.unitPos = this.rows.map(() => null);
      const pb = height - PAD - STATUS_H; // fondo utile: sopra la barra di stato della carta
      this.speedBtn.setPosition(width - PAD - 56, pb - 44);
      this.pauseBtn.setPosition(width - PAD - 56, this.topBottom + 8); // in alto a destra: in basso ci sono le carte
      this.mapBtn.setPosition(width - PAD - 150, this.topBottom + 8 + 44 + 6);
      this.buildBtn.setPosition(width - PAD - 150, this.topBottom + 8 + 44 + 6 + 38);
      this.retreatBtn.setPosition(width - PAD - 124, pb - this.portraitCardH() - 8 - 44); // sulla riga delle leve, sopra le carte
      this.linesBtn.setPosition(width - PAD - 124 - 8 - 118, pb - this.portraitCardH() - 8 - 44);
      this.seed.setPosition(width - PAD, pb - 2 * 44 - 8 - 6);
      this.objPos = { x: PAD, y: this.topBottom + 8, w: Math.min(300, width - 2 * PAD - 170) };
      this.hint.setPosition(width / 2 - 34, this.topBottom + 132).setWordWrapWidth(width - 2 * PAD - 140);
      this.dockG.clear(); // in verticale niente riquadri attorno alle carte
      this.notches[3].setVisible(false);
      this.notches[4].setVisible(false);
    } else {
      // orizzontale: una sola barra compatta in alto a sinistra (esercito | fronte | bottino), tasti in alto a destra
      // riquadro territorio tolto (Nico): al suo posto, dopo il bottino, il tasto con la medaglia
      const aW = 176, bW = 44, cW = 252, gap = 6, cx = PAD + aW + gap, bx = cx + cW + gap;
      P.setPosition(PAD, topPad).setSize(aW + cW + gap, BAR_H); // area dei tocchi
      box(PAD, topPad, aW, BAR_H, this.notches[0].setText(' Army '));
      box(cx, topPad, cW, BAR_H, this.resLabel);
      this.notches[1].setVisible(false);
      this.medalBtn.setPosition(bx, topPad);
      this.audioBtn.setPosition(bx + this.medalBtn.width + 6, topPad);
      this.radarBtn.setPosition(this.audioBtn.x + 50, topPad);
      // ECONOMIA e barra dei gruppi in basso a sinistra, sopra i reparti (Nico: in alto li copriva COMMS)
      const dg = this.dockGrid();
      this.econBtn.setPosition(PAD, dg.uY - 8 - 44);
      // profilo e impostazioni in cima, sopra MAPPA e COSTRUISCI (Nico)
      this.profileBtn.setPosition(width - PAD - 150, topPad);
      this.settingsBtn.setPosition(width - PAD - 150 + 78, topPad);
      this.troopIcon.setPosition(PAD + 12, topPad + 44);
      this.troops.setPosition(PAD + 38, topPad + 27);
      this.layoutResources(cx + 14, topPad + 40, (cW - 24) / 3);
      this.topBottom = topPad + BAR_H;
      this.symPos = this.rows.map(() => ({ x: 0, y: 0 }));
      this.unitPos = this.rows.map(() => null);
      const tx = width - PAD - 150;
      this.mapBtn.setPosition(tx, topPad + 40);
      this.buildBtn.setPosition(tx, topPad + 80);
      const by = height - PAD - STATUS_H - 44; // comandi sopra la barra di stato della carta
      this.speedBtn.setPosition(width - PAD - 56, by);
      this.pauseBtn.setPosition(width - PAD - 56 - 8 - 56, by);
      this.retreatBtn.setPosition(width - PAD - 56 - 8 - 56 - 8 - 124, by);
      this.linesBtn.setPosition(width - PAD - 56 - 8 - 56 - 8 - 124 - 8 - 118, by);
      this.seed.setPosition(width - PAD, by - 6);
      this.objPos = { x: PAD, y: topPad + BAR_H + 8, w: aW + cW + gap };
      this.hint.setPosition(PAD + (aW + bW + cW + 2 * gap) / 2, topPad + BAR_H + 132).setWordWrapWidth(Math.max(220, aW + bW + cW - 40)); // (bW = medaglia); sotto gli obiettivi
      // reparti in orizzontale su due file, in basso a sinistra (Nico): la scheda della provincia, in basso al centro, non li copre.
      // Le abilità in un riquadro sopra; se lo schermo è stretto si rimpiccioliscono
      const g = this.dockGrid();
      this.dockG.clear().fillStyle(TCOL.bg, 0.94).fillRect(PAD, g.uY, g.uW, g.uH).lineStyle(1, TCOL.edge, 0.6).strokeRect(PAD, g.uY, g.uW, g.uH);
      this.notches[3].setPosition(PAD + 10, g.uY + 6).setOrigin(0, 0).setBackgroundColor('rgba(0,0,0,0)').setVisible(true);
      if (this.abilityCards.length) {
        this.dockG.fillStyle(TCOL.bg, 0.94).fillRect(PAD, g.aY, g.aW, g.aH).lineStyle(1, TCOL.edge, 0.6).strokeRect(PAD, g.aY, g.aW, g.aH);
        this.notches[4].setPosition(PAD + 10, g.aY + 6).setOrigin(0, 0).setBackgroundColor('rgba(0,0,0,0)').setVisible(true);
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
    this.drawChat();
    // verticale: le carte si stringono per lasciare posto al tasto della velocità a destra
    const sc = portrait ? this.portraitCardScale() : this.dockGrid().sc, step = CARD_W * sc + 6;
    const cy = height - PAD - STATUS_H - CARD_H * sc, cx0 = PAD;
    const grid = portrait ? null : this.dockGrid();
    this.cards.forEach((c, k) => {
      const x = grid ? PAD + DOCK_PAD + (k % grid.cols) * step : cx0 + k * step, y = grid ? grid.uY + DOCK_PAD + 18 + Math.floor(k / grid.cols) * step : cy;
      c.baseY = y;
      c.baseX = x;
      c.setScale(sc).setPosition(x, y);
    });
    // abilità: dopo le carte in orizzontale; in verticale a destra, sopra il tasto RITIRATA
    this.abilityCards.forEach((c, k) => {
      const x = grid ? PAD + DOCK_PAD + k * step : width - PAD - (k + 1) * step + 6;
      c.baseY = grid ? grid.aY + DOCK_PAD + 18 : this.portraitAbilityY();
      c.baseX = x;
      c.setScale(sc).setPosition(x, c.baseY);
    });
  }

  /** Orizzontale: reparti su due file (colonne quante servono), abilità in una fila sopra; scala per non toccare la scheda al centro. */
  private dockGrid() {
    const { width, height } = view(this), bottom = height - PAD - STATUS_H;
    const cols = Math.max(1, Math.ceil(this.cards.length / 2)), na = this.abilityCards.length;
    const boxW = (n: number, sc: number) => n * (CARD_W * sc + 6) - 6 + 2 * DOCK_PAD;
    const boxH = (rows: number, sc: number) => (rows ? rows * (CARD_H * sc + 6) - 6 + 2 * DOCK_PAD + 22 : 0); // spazio in alto per l'etichetta dentro il riquadro
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
    RESOURCES.forEach((_r, k) => {
      // colonna allineata a sinistra: icona e valore sulla riga, entrate al minuto sotto, dal bordo dell'icona (Nico: era in diagonale)
      const cx = x + k * step;
      this.resIcons[k].setPosition(cx + 8, y);
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
    const cam = this.run.cameras?.main;
    for (const c of this.clouds) {
      c.t.tilePositionX += (c.vx * delta) / 1000;
      c.t.tilePositionY += (c.vy * delta) / 1000;
      if (cam) c.t.setTilePosition(c.t.tilePositionX + (cam.scrollX - this.camPrev.x) * cam.zoom * c.par / UI(), c.t.tilePositionY + (cam.scrollY - this.camPrev.y) * cam.zoom * c.par / UI());
    }
    if (cam) this.camPrev = { x: cam.scrollX, y: cam.scrollY };
    if ((this.incAcc -= delta) <= 0) {
      this.incAcc = 1000;
      const inc = st.incomePerMin();
      // entrata netta (mantenimento delle pedine compreso): in rosso se si consuma più di quanto si produce
      RESOURCES.forEach((r, k) => this.incTexts[k].setText(Math.abs(inc[r]) >= 0.05 ? `${inc[r] > 0 ? '+' : '−'}${rate(Math.abs(inc[r]))}/min` : '')
        .setColor(hex(inc[r] < 0 ? TCOL.alert : 0x7f888e))); // guadagno in grigio scuro, perdita in rosso
    }
    // cose che cambiano di rado: 4 volte al secondo, non a ogni fotogramma (Nico, 27 novembre 2026: "più fluido e meno
    // pesante"; l'interfaccia prendeva ~3 ms a fotogramma scorrendo pedine e fazioni)
    const slow = (this.slowAcc -= delta) <= 0, quick = (this.quickAcc -= delta) <= 0;
    if (slow) this.slowAcc = 250;
    if (quick) this.quickAcc = 100;
    if (quick) this.drawGroupBar();
    if (this.linesPanel && slow) this.drawLines();
    if (slow) this.drawObjectives();
    if (!this.buildHint && !st.opts.tutorial && st.gameTimeMs > 40_000) {
      this.buildHint = true; // una volta per campagna, se non hai ancora costruito niente
      if (!st.worksStarted && !this.hint.visible && !this.provCard) {
        this.tip('Build a factory', `A factory makes a province produce ×${BALANCE.works.fabbrica.prodMult}. Open BUILD, pick Factory, then click your provinces.`,
          'OPEN BUILD', () => { if (!this.menu) this.toggleBuildMenu(); });
      }
    }
    if (!st.opts.tutorial) {
      // si ridisegna solo quando cambia il secondo (o il colore dell'ultimo minuto)
      const left = Math.max(0, st.timeLeft), warn = this.unlimited ? false : left <= BALANCE.campaign.warnMs, key = `${this.clockText()}|${warn ? 1 : 0}`;
      if (key !== this.clockKey) {
        this.clockKey = key;
        this.medalBtn.setLabel(this.clockText()).setLabelColor(warn ? PALETTE.ko : 0xf2f2f2);
      }
    }
    // pannelli aperti: si ricostruiscono solo se cambia quello che mostrano (prima ogni secondo, anche in pausa)
    if (this.medalPanel && (this.medalAcc -= delta) <= 0) { this.medalAcc = 1000; if (this.medalKeyOf() !== this.medalKey) this.openMedal(); }
    this.sampleEcon();
    if (this.econPanel && (this.econAcc -= delta) <= 0) { this.econAcc = 1000; this.drawEcon(); }
    if (this.profile && (this.profileAcc -= delta) <= 0) {
      this.profileAcc = 1000;
      if (this.profileKeyOf() !== this.profileKey) this.renderProfile();
    }
    if (this.buildPanel && (this.buildAcc -= delta) <= 0) { // prezzi che salgono e risorse che bastano o no (rosso)
      this.buildAcc = 500;
      if (this.buildKeyOf() !== this.buildKey) this.openBuildPanel();
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
    // numeri che scorrono verso il valore nuovo, come un contatore (Nico: niente rimbalzo a ogni cambio)
    const roll = (cur: number, to: number) => (Math.abs(to - cur) < 1 ? to : cur + (to - cur) * Math.min(1, delta / 180));
    this.rollTroops = roll(this.rollTroops, Math.floor(st.troops));
    const t = Math.round(this.rollTroops);
    if (t !== this.shownTroops) {
      this.shownTroops = t;
      this.troops.setValue(t, short(t));
      this.rate.setX(this.troops.x + this.troops.width + 10);
    }
    this.troops.tick(delta);
    for (const o of this.resTexts) o.tick(delta);
    RESOURCES.forEach((r, k) => {
      this.rollRes[k] = roll(this.rollRes[k] ?? st.backpack[r], st.backpack[r]);
      this.resTexts[k].setValue(Math.round(this.rollRes[k]), short(this.rollRes[k]));
    });
    if (!slow) { this.refreshCards(st, quick); return; }
    this.rate.setText(`+${rate(st.troopsPerSecond)}/s`);
    if (!st.opts.tutorial) {
      const fed = st.backpack.cibo > 0, F = BALANCE.food;
      const up = `+${Math.round((F.fedGrowth - 1) * 100)}%`, down = `−${Math.round((1 - F.hungryGrowth) * 100)}%`;
      // in verticale accanto c'è il tempo della campagna: testo corto
      this.food.setText(this.portrait ? (fed ? `fed ${up}` : `no food ${down}`) : fed ? `fed, growth ${up}` : `no food, growth ${down}`)
        .setColor(hex(fed ? PALETTE.radioattivo : PALETTE.ko));
    }
    // classifica per province: a fine campagna vince chi ne ha di più
    const { pos, gap } = st.rank();
    // posto in classifica per numero di province (a fine campagna vince chi ne ha di più), detto per esteso
    const lead = st.opts.tutorial ? `goal ${BALANCE.tutorial.goalProvinces}` : pos === 1 ? `1st in the ranking (+${gap})` : `${ord(pos)} in the ranking`;
    this.stats.setText(`${st.player.provinces} ${st.player.provinces === 1 ? 'province' : 'provinces'}\n${lead}`);
    if (st.opts.tutorial) {
      this.stormText.setText(`first mission: ${BALANCE.tutorial.goalProvinces} provinces`).setColor(hex(PALETTE.radioattivo));
    } else {
      const left = Math.max(0, st.timeLeft);
      this.stormText.setText(`campaign ends in ${mmss(left)}`)
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
    this.refreshCards(st, true);
  }

  private slowAcc = 0;
  private quickAcc = 0;

  /** Carte delle pedine e delle abilità: ricarica, disponibilità, scelta (10 volte al secondo). */
  private refreshCards(st: RunState, now: boolean) {
    if (!now) return;
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
    const who = FACTION_INFO[faction]?.name ?? 'The enemy';
    if (phase === 'warn') this.toast(`${who} is preparing an offensive\nReinforce the border: engineers and troops in reserve`, PALETTE.allerta, 'ui-offensiva');
    else if (phase === 'start') this.banner(`${who.toUpperCase()} OFFENSIVE`, PALETTE.ko, 'They are attacking your border');
    else this.toast(lost ? `Offensive over\nLost ${Math.round((lost / Math.max(1, lost + this.run.state.player.tiles)) * 100)}% of the territory` : 'Offensive repelled', lost > 40 ? PALETTE.ko : PALETTE.ocra, lost ? 'ui-guerra' : 'ui-difesa');
  }

  /** Diplomazia: dichiarazioni, paci, alleanze, rifiuti, doni. */
  onDiplomacy(f: number, what: DiploWhat, byPlayer: boolean, amount = 0) {
    const who = FACTION_INFO[f]?.name ?? 'The enemy';
    if (what === 'war' && !byPlayer) {
      this.banner(`${who.toUpperCase()} DECLARES WAR ON YOU`, PALETTE.ko, 'The borders are no longer safe');
      buzz([40, 30, 40]);
    } else if (what === 'war') this.toast(`War on ${who}`, PALETTE.ko, 'ui-guerra');
    else if (what === 'peace') this.toast(`Peace with ${who}`, PALETTE.ocra, 'ui-pace');
    else if (what === 'alliance') this.banner(`ALLIANCE WITH ${who.toUpperCase()}`, PALETTE.radioattivo, 'You will not attack each other, you share sight');
    else if (what === 'broken') this.toast(`Alliance with ${who} broken`, PALETTE.allerta, 'ui-alleanza');
    else if (what === 'refused') this.toast(`${who} refuses`, PALETTE.ko, 'ui-chiudi');
    else if (what === 'tribute') this.toast(`Tribute from ${who}\n+${amount} resources`, PALETTE.ocra, 'res-metallo');
    else if (what === 'gift') this.toast(`Gift to ${who}\nOpinion rises`, PALETTE.radioattivo, 'ui-alleanza');
    if (this.profileF === f) this.renderProfile();
  }

  /** Hai perso province (al massimo un avviso ogni 10 s, col conto). */
  onProvinceLost(by: number, n: number) {
    this.toast(`${FACTION_INFO[by]?.name ?? 'The enemy'} took ${n === 1 ? 'one of your provinces' : `${n} of your provinces`}`, PALETTE.ko, 'ui-province');
  }

  /** Un nemico assalta una tua provincia: c'è tempo per rinforzarsi (truppe in cassa, bunker, pedine). */
  onDefending(by: number) {
    this.toast(`${FACTION_INFO[by]?.name ?? 'The enemy'} is assaulting one of your provinces\nYou have a few seconds: keep troops in reserve`, PALETTE.ko, 'ui-attacco');
  }

  /** La capitale è caduta: i rifornimenti ripartono dalla nuova. */
  onCapital() {
    this.banner('CAPITAL MOVED', PALETTE.allerta, 'Logistics restart from the new capital');
  }

  /** Accerchiamento: una sacca si arrende. */
  onEncircled(by: number, from: number, n: number) {
    if (by === PLAYER) this.banner(`ENCIRCLEMENT: +${n} ${n === 1 ? 'PROVINCE' : 'PROVINCES'}`, PALETTE.radioattivo, 'The pocket surrenders');
    else if (from === PLAYER) this.toast(`Pocket lost\n${n} ${n === 1 ? 'province' : 'provinces'} to ${FACTION_INFO[by]?.name ?? '?'}`, PALETTE.ko, 'ui-province');
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
  private profileKey = '';
  private profileKeyOf(): string {
    const st = this.run.state, f = this.profileF, fac = st.factions[f];
    if (!fac) return '';
    const ratio = fac.troops / Math.max(1, st.troops), force = ratio > 1.25 ? 2 : ratio < 0.8 ? 0 : 1;
    const gift = Math.floor(Math.max(BALANCE.diplomacy.donateMin, st.troops * BALANCE.diplomacy.donateShare));
    return `${f}|${fac.alive}|${fac.provinces}|${Math.round(fac.troops / 10)}|${force}|${st.relation[f]}|${Math.round(st.opinion[f])}|${gift}|${view(this).width}|${view(this).height}`;
  }

  private renderProfile() {
    this.profileKey = this.profileKeyOf();
    const st = this.run.state, f = this.profileF, info = FACTION_INFO[f], fac = st.factions[f];
    this.profile?.destroy();
    this.profile = null;
    if (!info || !fac) return;
    const { width, height } = view(this);
    const W = Math.min(380, width - 2 * PAD), H = 306;
    const items: Phaser.GameObjects.GameObject[] = [
      this.add.rectangle(0, 0, W, H, TCOL.bg, 0.97).setOrigin(0).setStrokeStyle(1, TCOL.edge, 0.75),
      termNotch(this, 0, 0, info.kind === 'bot' ? 'Militia' : 'Empire'),
    ];
    // ritratto del capo (generato con Draw Things): il capo della sua potenza, o il capitano per le milizie
    const PW = 74, PH = 98, TX = 14 + PW + 14;
    items.push(coverImage(this, info.kind === 'bot' || !info.civ ? 'leader-milizia' : `leader-${info.civ}`, 14, 16, PW, PH, 0.25),
      this.add.rectangle(14, 16, PW, PH, 0, 0).setOrigin(0).setStrokeStyle(1, info.fill, 0.9));
    const g = this.add.graphics();
    drawSymbol(g, info.symbol, 14 + PW - 9, 16 + PH - 9, 7, info.fill, PALETTE.carta);
    items.push(g, this.add.text(TX, 14, info.name, termStyle(16, PALETTE.carta)).setWordWrapWidth(W - TX - 40));
    const close = icon(this, 'ui-chiudi', W - 20, 22, 16, TCOL.label).setInteractive({ useHandCursor: true });
    close.on('pointerup', () => this.hideProfile());
    items.push(close);
    const civ = info.civ ? (civText as Record<string, { name: string; regime: string; classe: string }>)[info.civ] : null;
    const kind = info.kind === 'bot' ? 'Provincial militia, defends its area'
      : `Empire, ${civ?.name ?? ''}, ${civ?.regime.toLowerCase() ?? ''}`;
    items.push(this.add.text(TX, 38, kind, termStyle(11, TCOL.label, false)).setWordWrapWidth(W - TX - 14));
    if (civ) items.push(this.add.text(TX, 56, civ.classe, termStyle(11, TCOL.label, false)).setWordWrapWidth(W - TX - 14));
    // peso militare
    const ratio = fac.troops / Math.max(1, st.troops);
    const force = !fac.alive ? 'eliminated' : ratio > 1.25 ? 'stronger than you' : ratio < 0.8 ? 'weaker than you' : 'as strong as you';
    const troops = fac.alive ? `≈${Math.max(10, Math.round(fac.troops / 10) * 10)}` : '0';
    items.push(icon(this, 'ui-province', TX + 7, 92, 14, TCOL.label), this.add.text(TX + 18, 92, `${fac.provinces}`, termStyle(13, PALETTE.carta)).setOrigin(0, 0.5),
      icon(this, 'u-fanteria', TX + 64, 92, 15, TCOL.label), this.add.text(TX + 76, 92, troops, termStyle(13, PALETTE.carta)).setOrigin(0, 0.5),
      this.add.text(TX, 104, force, termStyle(11, ratio > 1.25 && fac.alive ? TCOL.alert : TCOL.label, false)));
    // rapporto e opinione
    const rel = st.relation[f], op = Math.round(st.opinion[f]);
    const relTxt = rel === 'guerra' ? 'At war' : rel === 'alleanza' ? 'Allies' : 'At peace';
    const relCol = rel === 'guerra' ? PALETTE.ko : rel === 'alleanza' ? PALETTE.radioattivo : PALETTE.ocra;
    items.push(icon(this, rel === 'guerra' ? 'ui-guerra' : rel === 'alleanza' ? 'ui-alleanza' : 'ui-pace', 24, 130, 20, relCol),
      this.add.text(40, 130, relTxt, termStyle(15, relCol)).setOrigin(0, 0.5));
    const bx = 130, bw = W - bx - 16, by = 126;
    const bar = this.add.graphics();
    bar.fillStyle(TCOL.bg, 1).fillRect(bx, by, bw, 8).lineStyle(1, PALETTE.carta, 0.6).strokeRect(bx, by, bw, 8).lineBetween(bx + bw / 2, by - 3, bx + bw / 2, by + 11);
    const half = (bw / 2) * Math.min(1, Math.abs(op) / 100);
    bar.fillStyle(op >= 0 ? PALETTE.radioattivo : PALETTE.ko, 1).fillRect(op >= 0 ? bx + bw / 2 : bx + bw / 2 - half, by, half, 8);
    items.push(bar, this.add.text(bx, by + 12, `opinion ${op > 0 ? '+' : ''}${op}`, termStyle(10, PALETTE.tenue, false)));
    // azioni
    const acts: { label: string; icon: string; color: number; run: () => void }[] = [];
    const D = BALANCE.diplomacy;
    const gift = Math.floor(Math.max(D.donateMin, st.troops * D.donateShare));
    const why = (r: string) => this.toast(r.charAt(0).toUpperCase() + r.slice(1), PALETTE.ko, 'ui-chiudi');
    if (fac.alive) {
      if (rel === 'guerra') {
        acts.push({ label: 'Propose peace', icon: 'ui-pace', color: PALETTE.ocra, run: () => {
          const r = st.exec({ k: 'peace', f });
          if (r === 'cooldown') why('wait before proposing again');
        } });
      } else {
        acts.push({ label: 'Declare war', icon: 'ui-guerra', color: PALETTE.ko, run: () => { if (!st.exec({ k: 'war', f })) why('truce in progress'); } });
      }
      if (rel === 'pace' && info.kind === 'empire') {
        acts.push({ label: 'Propose alliance', icon: 'ui-alleanza', color: PALETTE.radioattivo, run: () => {
          const r = st.exec({ k: 'alliance', f });
          if (r === 'opinion') why(`needs opinion +${D.allyOpinion}: send a gift`);
          else if (r === 'cooldown') why('wait before proposing again');
        } });
      }
      if (rel === 'alleanza') acts.push({ label: 'Break alliance', icon: 'ui-chiudi', color: PALETTE.allerta, run: () => st.exec({ k: 'breakAlliance', f }) });
      acts.push({ label: `Give ${gift} troops`, icon: 'u-fanteria', color: PALETTE.carta, run: () => { if (!st.exec({ k: 'giveTroops', f })) why('not enough troops'); } });
      if (info.kind === 'bot') {
        acts.push({ label: 'Demand tribute', icon: 'ui-trofeo', color: PALETTE.ocra, run: () => {
          if (st.diploBlock(f) === 'cooldown') return why('wait before proposing again');
          st.exec({ k: 'tribute', f });
        } });
      } else {
        acts.push({ label: `Give ${st.lootGift(f)} resources`, icon: 'st-deposito', color: PALETTE.carta, run: () => { if (!st.exec({ k: 'giveLoot', f })) why('pack too empty'); } });
      }
    }
    const cw = (W - 28 - 8) / 2, ch = 40;
    acts.slice(0, 4).forEach((a, k) => {
      const x = 14 + (k % 2) * (cw + 8), y = 162 + Math.floor(k / 2) * (ch + 8);
      const r = this.add.rectangle(x, y, cw, ch, TCOL.bg).setOrigin(0).setStrokeStyle(1, TCOL.edge, 0.75).setInteractive({ useHandCursor: true });
      r.on('pointerover', () => r.setFillStyle(TCOL.hover)).on('pointerout', () => r.setFillStyle(TCOL.bg));
      r.on('pointerup', () => { a.run(); buzz(10); sfx('click'); this.renderProfile(); });
      items.push(r, icon(this, a.icon, x + 18, y + ch / 2, 16, a.color), this.add.text(x + 32, y + ch / 2, a.label, termStyle(12, a.color)).setOrigin(0, 0.5));
    });
    items.push(this.add.text(14, H - 34, 'At peace you do not attack each other. Press and hold a province to open its info.', termStyle(9, PALETTE.tenue, false)).setWordWrapWidth(W - 28));
    this.profile = this.add.container((width - W) / 2, Math.max(PAD, (height - H) / 2), items).setDepth(46);
  }

  onEliminated(faction: number, by: number, loot: Bag) {
    if (faction === PLAYER) return;
    if (by !== PLAYER && FACTION_INFO[faction]?.kind === 'bot') return; // milizie spazzate via altrove: niente avvisi
    const who = FACTION_INFO[faction].name;
    const got = bagTotal(loot);
    const msg = by === PLAYER
      ? `${who} eliminated${got ? `\n+${got} resources from their spoils` : ''}`
      : `${who} wiped out\nBy ${FACTION_INFO[by]?.name ?? 'no one'}`;
    if (by === PLAYER) this.toast(msg, PALETTE.radioattivo, 'ui-trofeo');
    else this.news(msg, PALETTE.ocra); // notizie dal mondo: nella chat
  }

  /** Ultimo minuto di campagna. */
  onTimer() {
    this.toast('Last minute\nWhen time runs out, whoever has the most provinces wins', PALETTE.allerta, 'ui-tempo');
  }

  /** Bigliettino dalla mappa (gruppi, muro, comandi delle pedine). */
  notify(msg: string, color: number) {
    this.toast(msg.charAt(0).toUpperCase() + msg.slice(1), color);
  }

  /** Coalizione degli imperi contro di te: si forma o si scioglie. */
  onCoalition(phase: 'form' | 'end', members: number[]) {
    if (phase === 'form') {
      this.banner('COALITION AGAINST YOU', PALETTE.ko, `${members.map((m) => FACTION_INFO[m]?.name ?? '?').join(', ')} stop fighting each other`);
      buzz([40, 30, 40]);
    } else this.toast('Coalition dissolved\nYour lead has shrunk, the empires are rivals again', PALETTE.ocra, 'ui-alleanza');
  }

  /** Un impero bombarda una tua provincia di confine. */
  onEnemyStrike(by: number) {
    this.toast(`Bombardment from ${FACTION_INFO[by]?.name ?? 'an enemy'} incoming\nMove your units: anti-aircraft stops it`, PALETTE.ko, 'a-bombardamento');
  }

  /** Tasto COSTRUISCI acceso (con l'edificio scelto) o spento. */
  private lastBuild: WorkId | null = null; // ultima costruzione scelta in COSTRUISCI

  setBuildOn(w: WorkId | null) {
    if (w) this.lastBuild = w;
    this.buildBtn.setOn(!!w || !!this.buildPanel); // resta BUILD: l'edificio scelto si vede nel pannello (Nico)
    // la legenda delle costruzioni sta nel pannello COSTRUISCI (in basso a sinistra), che si ridisegna con la scelta
    if (this.buildPanel) this.openBuildPanel();
    else if (this.run.mapMode !== 'strutture') {
      this.legend?.destroy();
      this.legend = w ? this.worksLegend() : this.run.mapMode === 'terreno' ? this.terrainLegend() : null;
    }
  }

  /** Previsione dell'assalto accanto alla provincia sotto il mouse (punti CSS). */
  showForecast(p: number, x: number, y: number) {
    const st = this.run.state, f = st.forecast(p), o = st.provOwner[p];
    const key = `${p}|${f.cost}|${f.odds}|${Math.round(x)}|${Math.round(y)}`;
    if (key === this.forecastKey) return;
    this.forecastKey = key;
    this.forecast?.destroy();
    const col = { sicura: PALETTE.radioattivo, probabile: PALETTE.radioattivo, incerta: PALETTE.allerta, difficile: PALETTE.ko }[f.odds];
    const head = o === NEUTRAL ? `TAKE: ${f.cost} troops, now` : `ASSAULT: ${f.cost} troops, ${Math.ceil(f.ms / 1000)} s`;
    const odds = !f.can ? `needs ${f.cost + 1} troops (you have ${Math.floor(st.troops)})` : `outcome: ${ODDS[f.odds]}`;
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
  /** Mantenimento: manca una risorsa per le pedine. */
  onUpkeep(res: Resource) {
    this.toast(`Out of ${RESOURCE_INFO[res].name.toLowerCase()}\nUnits that use it are wearing down`, PALETTE.ko, `res-${res}`);
  }

  /** Nome dell'obiettivo come si legge nell'HUD. */
  private objTitle(o: Objective): string {
    const t = o.target;
    switch (o.kind) {
      case 'provinces': return `Hold ${t} provinces`;
      case 'cities': return t === 1 ? 'Take a city' : `Take ${t} cities`;
      case 'capitals': return `Take ${t} national capitals`;
      case 'empireProv': return `Take ${t} provinces from the empires`;
      case 'repelled': return 'Repel an enemy offensive';
      case 'rank': return 'Be 1st in the ranking';
      case 'dominate': return 'DOMINION: twice the provinces of the strongest empire';
      default: return o.kind;
    }
  }

  /**
   * Obiettivi della campagna (Nico, 25 novembre 2026: "inizio più vivo, obiettivi e svolte"): tre alla volta con l'avanzamento e il
   * premio; in cima, dal minuto 6, il dominio che chiude la campagna se tenuto un minuto. Si ridisegna solo quando cambia qualcosa.
   */
  private drawObjectives() {
    const st = this.run.state;
    if (!st || st.opts.tutorial) return;
    const now = st.gameTimeMs, list = st.objectives;
    const key = list.map((o) => `${o.id}:${o.progress}:${o.deadline ? Math.ceil((o.deadline - now) / 1000) : ''}`).join('|') + `|${this.objPos.x},${this.objPos.y},${this.objPos.w}`;
    if (key === this.objKey) return;
    this.objKey = key;
    this.objBox?.destroy();
    if (!list.length) { this.objBox = null; return; }
    const { x, y, w } = this.objPos, items: Phaser.GameObjects.GameObject[] = [];
    const g = this.add.graphics();
    items.push(g, this.add.text(10, 7, 'Objectives', termLabel(11)));
    let yy = 28;
    for (const o of list) {
      const col = o.decisive ? PALETTE.allerta : TCOL.text;
      const right = o.decisive ? `${o.progress}/${o.target} s` : `${o.progress}/${o.target}`;
      const r = this.add.text(w - 10, yy, right, termStyle(12, col)).setOrigin(1, 0);
      const t = this.add.text(10, yy, this.objTitle(o), termStyle(12, col)).setWordWrapWidth(w - 30 - r.width);
      const sub = o.decisive ? (o.holdSince !== undefined ? 'hold it: the campaign ends in victory' : 'ends the campaign in victory')
        : `+${o.troops} troops, +${o.loot} spoils${o.deadline ? `, ${mmss(Math.max(0, o.deadline - now))} left` : ''}`;
      const sb = this.add.text(10, t.y + t.height + 1, sub, termStyle(10, o.deadline && o.deadline - now < 30_000 ? TCOL.alert : 0x7f888e, false));
      // barretta d'avanzamento
      g.fillStyle(TCOL.edge, 0.35).fillRect(10, sb.y + sb.height + 3, w - 20, 2).fillStyle(col, 0.9).fillRect(10, sb.y + sb.height + 3, (w - 20) * Math.min(1, o.progress / Math.max(1, o.target)), 2);
      items.push(t, r, sb);
      yy = sb.y + sb.height + 10;
    }
    // lo sfondo va sotto le scritte e le barrette
    const bg = this.add.graphics().fillStyle(TCOL.bg, 0.94).fillRect(0, 0, w, yy).lineStyle(1, TCOL.edge, 0.6).strokeRect(0, 0, w, yy);
    items.unshift(bg);
    this.objBox = this.add.container(x, y, items).setDepth(20);
  }

  /** Obiettivo completato, mancato o nuovo (solo la svolta del dominio si annuncia). */
  onObjective(phase: 'new' | 'done' | 'failed', o: Objective) {
    this.objKey = '';
    if (phase === 'done' && !o.decisive) this.toast(`OBJECTIVE COMPLETE\n${this.objTitle(o)}, +${o.troops} troops`, PALETTE.radioattivo, 'ui-trofeo');
    else if (phase === 'failed') this.toast(`Objective missed\n${this.objTitle(o)}`, PALETTE.ko, 'ui-tempo');
    else if (phase === 'new' && o.decisive) this.toast('NEW OBJECTIVE: DOMINION\nTwice the provinces of the strongest empire for a minute: you win now', PALETTE.allerta, 'ui-trofeo');
  }

  // ---------- comunicazioni (Nico: "in una chat che si può aprire e chiudere") ----------
  private chatLog: { at: string; msg: string; color: number }[] = [];
  private chatOpen = false;
  private chatUnread = 0;
  private chatUi: Phaser.GameObjects.Container | null = null;
  private chatRect = { x: 0, y: 0, w: 0, h: 0 };

  /** Messaggio nella chat delle comunicazioni (si legge aprendola; chiusa conta i non letti). */
  private chat(msg: string, color: number) {
    const st = this.run.state;
    this.chatLog.unshift({ at: st ? mmss(st.gameTimeMs) : '', msg, color });
    this.chatLog.length = Math.min(this.chatLog.length, 40);
    if (!this.chatOpen) this.chatUnread++;
    this.drawChat();
  }

  /** Tasto COMMS in alto a destra e, se aperta, la lista dei messaggi (i più nuovi in cima). */
  private drawChat() {
    this.chatUi?.destroy();
    const { width } = view(this);
    // orizzontale: stretto, in alto accanto a MAPPA (Nico: "molto più piccolo, sopra, non coperto dalle cose della mappa")
    const W = this.portrait ? width - 2 * PAD : 220, x0 = this.portrait ? width - PAD - W : this.mapBtn.x - 8 - W, y0 = this.portrait ? this.topBottom + 8 : this.mapBtn.y;
    const items: Phaser.GameObjects.GameObject[] = [], g = this.add.graphics();
    items.push(g);
    const label = `COMMS${this.chatUnread ? ` (${this.chatUnread} new)` : ''}`;
    const head = this.add.text(12, 9, label, termStyle(13, this.chatUnread ? TCOL.accent : TCOL.text));
    const arrow = this.add.text(W - 12, 9, this.chatOpen ? '▴' : '▾', termStyle(13, TCOL.label)).setOrigin(1, 0);
    items.push(head, arrow);
    let h = 34;
    if (this.chatOpen) {
      if (!this.chatLog.length) { items.push(this.add.text(12, h, 'No messages yet', termStyle(11, TCOL.dim))); h += 22; }
      for (const m of this.chatLog.slice(0, 9)) {
        const [title, ...rest] = m.msg.split('\n');
        const t = this.add.text(56, h, title, { ...termStyle(13, m.color === PALETTE.ko ? TCOL.alert : TCOL.text), wordWrap: { width: W - 68 } });
        items.push(this.add.text(12, h + 1, m.at, termStyle(11, TCOL.dim)), t);
        h += t.height + 2;
        if (rest.length) {
          const d = this.add.text(56, h, rest.join(' '), { ...termStyle(11, TCOL.label), wordWrap: { width: W - 68 } });
          items.push(d);
          h += d.height;
        }
        h += 8;
      }
    }
    termBox(g, 0, 0, W, h);
    const hit = this.add.rectangle(0, 0, W, 34, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true });
    hit.on('pointerup', () => { this.chatOpen = !this.chatOpen; if (this.chatOpen) this.chatUnread = 0; sfx('click'); this.drawChat(); this.layoutNotes(); });
    items.push(hit);
    this.chatUi = this.add.container(x0, y0, items).setDepth(44);
    this.chatRect = { x: x0, y: y0, w: W, h };
  }

  /** Mondo e notizie: solo nella chat (niente bigliettino). */
  private news(msg: string, color: number) {
    this.chat(msg, color);
  }

  private toast(msg: string, color: number, _ic = '') {
    // tutte le notifiche solo nei COMMS (Nico, 26 novembre 2026: niente bigliettini che escono sulla mappa)
    this.chat(msg, color);
  }

  private layoutNotes() {
    let y = Math.max(this.topBottom + (this.portrait ? 64 : 90), this.chatRect.y + this.chatRect.h + 10); // sotto la chat
    this.notes = this.notes.slice(0, 4); // al massimo quattro alla volta: i più vecchi spariscono
    for (const n of this.notes) {
      if (!n.active) continue;
      this.tweens.add({ targets: n, y, duration: 160 });
      y += n.height + 12;
    }
  }

  /** Campagna senza fine (sandbox senza limite): il tasto del tempo conta quello trascorso. */
  private get unlimited(): boolean {
    return this.run.state.endMs > 24 * 3_600_000;
  }

  private clockText(): string {
    const st = this.run.state;
    return this.unlimited ? mmss(st.gameTimeMs) : mmss(Math.max(0, st.timeLeft));
  }

  /** Nuovo rapporto: non si apre da solo, il tasto RADAR ne conta uno in più. */
  onReport() {
    this.refreshRadar();
  }

  /** Numero dei rapporti da leggere sul tasto RADAR (acceso se ce n'è almeno uno). */
  private refreshRadar() {
    const n = this.run.state.eventInbox.length;
    this.radarBtn.setLabel(n ? `RADAR ${n}` : 'RADAR').setLabelColor(n ? TCOL.accent : TCOL.dim);
  }

  /** Apre il rapporto più recente; toccando fuori si chiude e resta nel RADAR. */
  private openReport() {
    const st = this.run.state, ev = st.eventInbox[0];
    if (!ev || this.eventCard) return;
    this.eventCard = new EventCard(this, ev, (c) => st.canChoose(c), (side) => {
      const msg = st.exec({ k: 'event', side, i: st.eventInbox.indexOf(ev) });
      analytics.design(['evento', ev.id, side]);
      this.eventCard = null;
      if (typeof msg === 'string' && msg) this.toast(msg, PALETTE.carta);
      this.refreshRadar();
    }, () => { this.eventCard = null; });
  }

  tutorialSignal(kind: GuideSignal) {
    this.guide?.signal(kind);
  }

  /** Città presa: provincia annessa (toast) o capitale caduta (cartello). Le IA si annunciano solo per le capitali. */
  onProvince(by: number, capital: boolean, nation: string, bonus: number) {
    if (by === PLAYER) {
      if (capital) this.banner(`${nation.toUpperCase()} FALLS`, PALETTE.ocra, `Capital taken${bonus ? `, +${bonus} troops` : ''}`);
    }
    // (capitali prese tra imperi IA: niente notizia, con 45 imperi riempivano i COMMS e gli avvisi contro di te sparivano)
  }

  onMilestone(n: number) {
    const names: Record<number, string> = { 8: 'bridgehead', 15: 'regional dominion', 30: 'continental power', 60: 'hegemony', 120: 'the world holds its breath' };
    this.banner(`${n} PROVINCES`, PALETTE.ocra, names[n] ?? '');
  }

  /** Cartello grande e breve al centro: per i momenti epici. */
  /** I cartelli escono uno alla volta: se due arrivano insieme il secondo aspetta il suo turno. */
  private banner(title: string, color: number, sub: string) {
    // niente scritte grandi al centro (Nico: "anche le scritte grandi"): il messaggio va nei COMMS
    this.chat(sub ? `${title}\n${sub.charAt(0).toUpperCase() + sub.slice(1)}` : title, color);
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
      victory: reason === 'time' ? 'THE FIELD IS YOURS' : reason === 'tutorial' ? 'FIRST VICTORY!' : reason === 'dominance' ? 'DOMINION!' : 'EMPIRE!',
      retreat: 'RETREAT',
      eliminated: 'ELIMINATED',
      timeout: 'END OF OPERATIONS',
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
    void loot; // (niente più rimbalzo dei numeri: scorrono da soli)
  }

  /** true se il punto (schermo) cade su un elemento dell'HUD. */
  /**
   * PAUSA STRATEGICA (alla HOI4): il tempo si ferma ma si comanda lo stesso. Tocchi e trascinamenti sulla mappa
   * preparano il piano (province in coda), pedine, abilità e navi prendono ordini; tutto parte alla ripresa.
   */
  togglePause() {
    const st = this.run.state;
    if (this.ended || st.over) return;
    st.exec({ k: 'pause', on: !st.paused });
    this.pauseBtn.setLabel(st.paused ? '▶' : '❚❚').setOn(st.paused);
    this.pauseUi?.destroy();
    this.pauseUi = null;
    this.pauseFrame.setVisible(st.paused);
    if (!st.paused) {
      if (st.plan.length) this.toast(`Plan under way\n${st.plan.length} provinces`, PALETTE.radioattivo, 'ui-play');
      return;
    }
    this.hint.setVisible(false);
    const { width } = view(this);
    const title = this.add.text(0, 0, '❚❚  STRATEGIC PAUSE', termStyle(17, PALETTE.ocra)).setOrigin(0.5, 0);
    const sub = this.add.text(0, 26, 'time is stopped, tap provinces for the plan, move your units', termStyle(11, PALETTE.carta, false))
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
  /** Vita che sale (1), scende (−1) o ferma (0), confrontata con un secondo e mezzo fa. */
  private hpTrendOf(group: Unit[]): number {
    const hp = group.reduce((n, u) => n + u.hp, 0), now = this.time.now, key = group.map((u) => u.id).join(','), prev = this.hpTrend.get(key);
    let trend = prev?.trend ?? 0;
    if (!prev || now - prev.at > 1500) { trend = prev ? Math.sign(Math.round(hp - prev.hp)) : 0; this.hpTrend.set(key, { hp, at: now, trend }); }
    if (this.hpTrend.size > 50) this.hpTrend.clear();
    return trend;
  }

  /** Velocità vera adesso (secondi per casella: terreno, gruppetto, ammasso, mare) e chi la decide: nel gruppo la più lenta. */
  private speedOf(group: Unit[]): { s: string; by: Unit } {
    const st = this.run.state;
    let by = group[0], ms = 0;
    for (const u of group) { const m = st.stepMs(u); if (m > ms) { ms = m; by = u; } }
    return { s: `${(ms / 1000).toFixed(1)} s/tile`, by };
  }

  private provCardKey(): string {
    const st = this.run.state, p = this.provCardP;
    const { width } = view(this);
    const k: unknown[] = [p, this.selUnit, this.provOpen, width, this.portrait, st.over];
    const unit = this.selUnit >= 0 ? st.units.find((u) => u.id === this.selUnit) : undefined;
    if (unit) {
      const group = unit.owner === PLAYER ? this.run.selectedUnits() : [], sel = this.run.selectedUnits();
      k.push(Math.ceil(unit.hp), Math.round(unit.maxHp), unit.size, unit.stance, unit.front, Math.round(unit.supply * 100), unit.inCombat,
        st.battles.some((b) => b.unit === unit.id), unit.path.length > 0, group.length, group.every((u) => u.stance === 'attacca'),
        Math.ceil(group.reduce((n, u) => n + u.hp, 0)), this.hpTrendOf(sel.length > 1 ? sel : [unit]), // vita del gruppo e freccia della vita
        this.speedOf(sel.length > 1 ? sel : [unit]).s, this.run.activeTool);
      // (prima c'era il tempo: la scheda si ricostruiva da zero ogni 1,5 s anche in pausa, e la memoria si riempiva)
    } else if (this.selUnit < 0 && p >= 0) {
      const o = st.provOwner[p], prog = o === PLAYER ? st.workInProgress(p) : null, b = st.battleAt(p);
      const fc = o === NEUTRAL && st.isFrontierProv(p) ? st.forecast(p) : null;
      const cost = o === PLAYER ? 0 : st.provCost(PLAYER, p);
      k.push(o, st.seesProv(p), o > PLAYER ? st.relation[o] : '', st.provDefense(p), st.provPerMin(p).toFixed(1), st.workOf(p),
        prog ? mmss(prog.leftMs) : '', Math.round(st.supply[p] * 100), st.capitalProv[PLAYER], cost, st.troops > cost,
        fc ? `${fc.can}${fc.odds}` : '', b ? `${Math.ceil((b.endMs - st.gameTimeMs) / 1000)}${b.by}${b.troops}` : '', st.isFrontierProv(p), st.atWar(PLAYER, o));
      if (o === PLAYER) for (const w of WORKS) k.push(st.workBlock(p, w), st.workPrice(w, PLAYER, p), ...Object.values(st.workCost(w, p)));
      k.push(st.provLevel[p], Math.ceil((st.upgradeInProgress(p) ?? 0) / 1000));
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
    const W = Math.min(unit ? 740 : st.provOwner[p] === PLAYER ? 470 : 460, width - 2 * PAD - (this.portrait ? 0 : 252)); // pedina: larga e bassa
    const own = !unit && st.provOwner[p] === PLAYER;
    const ready = own ? st.workOf(p) : null, prog = own ? st.workInProgress(p) : null;
    // previsione dell'assalto (province attaccabili che vedi)
    const fc = !unit && p >= 0 && st.provOwner[p] === NEUTRAL && st.isFrontierProv(p) ? st.forecast(p) : null; // il prezzo vale solo per il vuoto

    // Gerarchia (Nico: "100 cose tutte attaccate, stesso font, stesse grandezze"): titolo 16 bianco → riga grigia 11 di chi/cosa →
    // dati principali grandi (16) → dati secondari (13) → azioni. Etichette sempre 11 grigie, margini a passi di 8.
    const M = 16, inner = W - 2 * M;
    const items: Phaser.GameObjects.GameObject[] = [];
    const g = this.add.graphics();
    let y = 14;
    const title = (text: string, sub: string, icon?: (x: number, y: number) => void, wrap = inner - 40) => {
      const tx = icon ? M + 22 : M;
      icon?.(M + 8, y + 9);
      items.push(this.add.text(tx, y, text, termStyle(16, TCOL.text)).setWordWrapWidth(wrap).setMaxLines(1));
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
        if (s.icon) items.push(this.add.image(x, vy + vh, s.icon).setDisplaySize(15, 15).setOrigin(0, 0.5).setTint(TCOL.label));
        if (s.res) items.push(resIcon(this, s.res, x + 8, vy + vh, 16));
        items.push(this.add.text(x, yy, s.k, termStyle(11, TCOL.label)).setWordWrapWidth(cw - 8).setMaxLines(1),
          this.add.text(x + ix, vy, s.v, termStyle(big ? 16 : 13, s.c ?? TCOL.text)).setWordWrapWidth(cw - 8 - ix).setMaxLines(1));
      });
      y += Math.ceil(list.length / per) * rowH;
    };
    const rule = () => { g.lineStyle(1, TCOL.edge, 0.35).lineBetween(M, y + 0.5, W - M, y + 0.5); y += 12; };
    const GAP = 8;

    const sel = unit && unit.owner === PLAYER ? this.run.selectedUnits() : [];
    if (unit) {
      // scheda della pedina bassa e orizzontale alla Call of War (Nico: "copre troppo"): chi è a sinistra, dati in colonne,
      // comandi a icona a destra. Con più pedine scelte, i totali del gruppo
      const group = sel.length > 1 ? sel : [unit], mine = unit.owner === PLAYER, F = FACTION_INFO[unit.owner], info = unitInfo(unit.type);
      const reparti = group.reduce((n, u) => n + u.size, 0), hp = group.reduce((n, u) => n + u.hp, 0), max = group.reduce((n, u) => n + u.maxHp, 0);
      const atk = group.reduce((n, u) => n + BALANCE.units[u.type].attack * u.size, 0), pct = hp / Math.max(1, max);
      const sup = Math.min(...group.map((u) => u.supply));
      const fighting = group.filter((u) => u.inCombat).length, moving = group.filter((u) => u.path.length).length;
      const sieging = group.some((u) => st.battles.some((b) => b.unit === u.id));
      // vita che sale o scende (Nico): confronto con un secondo e mezzo fa
      const trend = this.hpTrendOf(group);
      const arrow = trend > 0 ? ' ▲' : trend < 0 ? ' ▼' : ' ■';
      const name = group.length > 1 ? `Group ×${reparti}` : `${info.name}${unit.size > 1 ? ` ×${unit.size}` : ''}`;
      // velocità sempre in vista (Nico, 26 novembre 2026: "cosa determina la velocità del gruppo, fai vedere sempre la
      // velocità"): un gruppo va al passo della sua pedina più lenta, e lo si scrive
      const spd = this.speedOf(group);
      // la velocità per prima (Nico, 28 novembre 2026: "non mi hai ancora messo la velocità"): in fondo la riga si tagliava
      const subTxt = group.length > 1 ? `speed ${spd.s}, ${group.length} units` : `speed ${spd.s}, ${mine ? 'your unit' : `${F?.name ?? 'enemy'} unit`}`;
      items.push(icon(this, group.length > 1 ? 'ui-gruppo' : `u-${unit.type}`, M + 9, 26, 20, F?.fill ?? TCOL.text),
        this.add.text(M + 24, 12, name, termStyle(15, TCOL.text)).setWordWrapWidth(150).setMaxLines(1));
      const sub = this.add.text(M + 24, 34, subTxt, termStyle(11, TCOL.label)).setWordWrapWidth(150).setMaxLines(1);
      items.push(sub);
      const cols: { k: string; v: string; c?: number }[] = [
        { k: 'health', v: `${Math.ceil(hp)}/${Math.round(max)}${arrow}`, c: pct > 0.5 ? TCOL.ok : pct > 0.25 ? TCOL.accent : TCOL.alert },
        { k: 'attack', v: String(atk) },
        { k: 'supply', v: `${Math.round(sup * 100)}%`, c: sup >= BALANCE.unitOps.healMinSupply ? TCOL.ok : sup >= BALANCE.unitOps.attritionBelow ? TCOL.accent : TCOL.alert },
        { k: 'status', v: fighting ? 'fighting' : sieging ? 'siege' : moving ? 'marching' : 'halted', c: fighting ? TCOL.alert : TCOL.text },
        group.length > 1
          ? { k: 'speed', v: spd.s }
          : { k: 'beats', v: info.beats.map((b) => unitInfo(b).short.toLowerCase()).join(', ') || '—' },
      ];
      const cx0 = M + 184, cw = 92;
      cols.forEach((c, i) => items.push(this.add.text(cx0 + i * cw, 12, c.k, termStyle(10, TCOL.label)),
        this.add.text(cx0 + i * cw, 30, c.v, termStyle(13, c.c ?? TCOL.text)).setWordWrapWidth(cw - 6).setMaxLines(1)));
      if (mine) {
        // la freccia d'offensiva è in beta (Nico, 27 novembre 2026: "troppo difficile da costruire"): al suo posto le regioni
        const acts: [string, 'line' | 'zone' | 'nation' | 'list', LineIcon][] = [['Units in detail', 'list', 'list'], ['Line (G)', 'line', 'spline'], ['Regions (O): drag over the provinces to take', 'zone', 'pencil'], ['Attack nation (N)', 'nation', 'crosshair']];
        const S = 38;
        acts.forEach(([label, kind, ico], k) => {
          const x = W - M - 24 - (4 - k) * (S + 6), yy = 10;
          const r = this.add.rectangle(x, yy, S, S, TCOL.bg).setOrigin(0).setStrokeStyle(1, TCOL.edge, 0.9).setInteractive({ useHandCursor: true });
          r.on('pointerover', () => { r.setFillStyle(TCOL.hover); sub.setText(label).setColor(hex(TCOL.text)); })
            .on('pointerout', () => { r.setFillStyle(TCOL.bg); sub.setText(subTxt).setColor(hex(TCOL.label)); });
          r.on('pointerup', () => {
            buzz(10); sfx('click');
            if (kind === 'list') { this.unitListOpen = !this.unitListOpen; this.provKey = ''; this.renderProvince(); return; }
            this.run.unitAction(kind);
          });
          if (kind === 'list' && this.unitListOpen) r.setStrokeStyle(1, TCOL.text, 1);
          // strumento in uso (Nico, 26 novembre 2026: "quando lo selezioni non cambia molto"): tasto pieno e la sua istruzione
          // sotto il nome finché aspetta il clic sulla carta; azzurro come le selezioni sulla carta
          const on = kind !== 'list' && this.run.activeTool === kind;
          if (on) { r.setFillStyle(0x8fd6ff, 1).setStrokeStyle(2, 0xffffff, 1); r.removeAllListeners('pointerout').removeAllListeners('pointerover'); sub.setText(label).setColor(hex(TCOL.text)); }
          items.push(r, lineIcon(this, ico, x + S / 2, yy + S / 2, 18, on ? 0x0a0d10 : TCOL.text));
        });
      }
      y = 52;
      // elenco delle pedine del gruppo (tasto lista, Nico): tipo, reparti, vita, rifornimento, stato; al massimo 14 righe
      if (mine && this.unitListOpen) {
        y += 6;
        g.lineStyle(1, TCOL.edge, 0.35).lineBetween(M, y, W - M, y);
        y += 8;
        const rows = [...group].sort((a, b) => a.type.localeCompare(b.type) || b.size - a.size).slice(0, 14);
        for (const u of rows) {
          const pu = u.hp / u.maxHp, st2 = u.inCombat ? 'fighting' : st.battles.some((b) => b.unit === u.id) ? 'siege' : u.path.length ? 'marching' : 'halted';
          items.push(icon(this, `u-${u.type}`, M + 8, y + 8, 14, TCOL.text),
            this.add.text(M + 22, y, `${unitInfo(u.type).name}${u.size > 1 ? ` ×${u.size}` : ''}`, termStyle(12, TCOL.text)),
            this.add.text(M + 200, y, `${Math.ceil(u.hp)}/${Math.round(u.maxHp)}`, termStyle(12, pu > 0.5 ? TCOL.ok : pu > 0.25 ? TCOL.accent : TCOL.alert)),
            this.add.text(M + 320, y, `${Math.round(u.supply * 100)}%`, termStyle(12, u.supply >= BALANCE.unitOps.healMinSupply ? TCOL.ok : TCOL.accent)),
            this.add.text(M + 400, y, st2, termStyle(12, u.inCombat ? TCOL.alert : TCOL.label)));
          // barretta della vita
          g.fillStyle(0x000000, 0.6).fillRect(M + 270, y + 6, 40, 4).fillStyle(pu > 0.5 ? TCOL.ok : pu > 0.25 ? TCOL.accent : TCOL.alert, 1).fillRect(M + 270, y + 6, 40 * pu, 4);
          y += 19;
        }
        if (group.length > rows.length) { items.push(this.add.text(M + 22, y, `and ${group.length - rows.length} more`, termStyle(11, TCOL.dim))); y += 18; }
      }
    } else {
      const prov = st.map.provinces[p], o = st.provOwner[p], T = BALANCE.terrain[prov.terrain];
      const seen = o === PLAYER || st.seesProv(p);
      const nation = st.map.nations.find((n) => n.id === prov.country)?.name ?? 'No man\'s land';
      const terrainName = { pianura: 'plains', colline: 'hills', montagne: 'mountains', deserto: 'desert' }[prov.terrain];
      const resName = RESOURCE_INFO[T.res].name.toLowerCase();
      const F = o >= 0 ? FACTION_INFO[o] : null;
      const ownerName = !seen && o !== PLAYER ? 'unknown owner' : o === PLAYER ? (st.capitalProv[PLAYER] === p ? 'your capital' : 'your province') : F ? F.name : 'free land';
      const rel = o > PLAYER && seen ? st.relation[o] : null;
      const relTxt = rel ? (rel === 'guerra' ? ', at war' : rel === 'alleanza' ? ', allies' : ', at peace') : '';
      // assalto in corso nella riga sotto il titolo (niente righe in più: la scheda resta bassa)
      const bt = !own ? st.battleAt(p) : null;
      const battleTxt = bt ? `, assault ${Math.max(0, Math.ceil((bt.endMs - st.gameTimeMs) / 1000))} s` : '';
      const dep = st.deposit(p), depTxt = dep ? `, ${RESOURCE_INFO[dep].name.toLowerCase()} deposit` : ''; // province diverse (Nico)
      title(nation, `${terrainName}${st.isCity(p) ? ', city' : ''}${depTxt}, ${ownerName}${relTxt}${battleTxt}`, undefined, o > PLAYER && seen ? inner - 140 : inner - 40); // niente simbolo davanti (Nico): titolo e riga allineati a sinistra
      // scheda della potenza: link piccolo nell'intestazione, accanto alla ✕
      if (o > PLAYER && seen) {
        // scritta chiara e più grande (Nico, 28 novembre 2026: "non ti esce il coso per vedere come siete messi tra di voi")
        const link = this.add.text(W - M - 28, 14, 'RELATIONS ›', termStyle(13, TCOL.text)).setOrigin(1, 0).setInteractive({ useHandCursor: true });
        link.on('pointerover', () => link.setColor(hex(0x8fd6ff))).on('pointerout', () => link.setColor(hex(TCOL.text)));
        link.on('pointerup', () => this.showProfile(o));
        items.push(link);
      }
      const work = ready ? WORK_NAME[ready] : prog ? `building ${mmss(prog.leftMs)}` : (() => { const w = st.workOf(p); return w ? WORK_NAME[w] : 'none'; })();
      const cost = o === PLAYER ? 0 : st.provCost(PLAYER, p);
      const odds = fc ? (fc.can ? ODDS[fc.odds] : 'not enough troops') : '';
      if (o === PLAYER) {
        // tutte e tre le risorse della provincia (Nico): la prima è quella del terreno
        const bag = st.provBag(p), order = [T.res, ...RESOURCES.filter((r) => r !== T.res)];
        stats([
          ...order.map((r) => ({ k: `${RESOURCE_INFO[r].name.toLowerCase()} /min`, v: bag[r].toFixed(1).replace('.', ','), res: r })),
          { k: 'supply', v: `${Math.round(st.supply[p] * 100)}%`, icon: 'ico-logistica',
            c: st.supply[p] >= 0.95 ? TCOL.ok : st.supply[p] >= 0.6 ? TCOL.accent : TCOL.alert },
          { k: 'defence', v: String(st.provDefense(p)), icon: 'ico-difesa' },
        ], true);
      } else {
        // una riga sola (Nico: "appiattiscila"); la costruzione solo se c'è
        const w = st.workOf(p);
        stats([
          o === NEUTRAL ? { k: 'to take it', v: `${cost}`, c: st.troops > cost ? TCOL.text : TCOL.alert, icon: 'ico-truppe' }
            : { k: 'to take it', v: 'units', c: TCOL.text, icon: 'ico-truppe' }, // Nico: gli imperi si combattono alla HOI4
          ...(fc ? [{ k: 'outcome', v: odds, c: fc.odds === 'incerta' ? TCOL.accent : fc.odds === 'difficile' || !fc.can ? TCOL.alert : TCOL.ok }] : []),
          { k: 'defence', v: seen || o === NEUTRAL ? String(st.provDefense(p)) : '?', icon: 'ico-difesa' },
          { k: `${resName} per min`, v: st.provPerMin(p).toFixed(1).replace('.', ','), res: T.res },
          ...(w ? [{ k: 'building', v: WORK_NAME[w] }] : []),
        ], true, true);
      }
      // tua provincia: si costruisce dal tasto COSTRUISCI in alto (Nico: il tasto qui non serviva più); la costruzione solo se c'è
      if (own) {
        if (ready || prog) {
          rule();
          // icona della costruzione accanto al nome (sulla carta si vede solo toccando la provincia o in COSTRUISCI)
          const wk = ready ?? prog!.work, col = ready ? TCOL.text : TCOL.accent;
          items.push(icon(this, `w-${wk}`, M + 11, y + 8, 18, col));
          const max = ready ? BALANCE.works[ready].maxLevel ?? 1 : 1, upMs = st.upgradeInProgress(p);
          const lvl = max > 1 ? `, level ${st.provLevel[p]}/${max}${upMs !== null ? `, upgrading ${mmss(upMs)}` : ''}` : '';
          const t = this.add.text(M + 30, y, ready ? `${WORK_NAME[ready]}${lvl}, ${workDesc(ready, resName)}` : `${work}, ${WORK_NAME[prog!.work]}`, termStyle(13, col)).setWordWrapWidth(inner - 30);
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

  /**
   * Barra dei gruppi (armate alla HOI4): una scheda per gruppo (numero, pedine, cosa fanno), si tocca per selezionarlo
   * (due volte: la carta lo inquadra); + GRUPPO fa un gruppo delle pedine selezionate. Ctrl/Maiusc + numero fa lo stesso.
   */
  private drawGroupBar() {
    if (this.run.state.opts.tutorial) return;
    const list = this.run.groupList(), sel = this.run.selectedCount;
    const key = `${list.map((g) => `${g.n}:${g.count}:${g.state}:${g.selected ? 1 : 0}`).join(',')}|${sel > 0 ? 1 : 0}|${this.econBtn.x}|${this.econBtn.y}`;
    if (key === this.groupBarKey) return;
    this.groupBarKey = key;
    this.groupBar?.destroy();
    const { width } = view(this), portrait = view(this).portrait;
    const x0 = portrait ? PAD : this.econBtn.x + this.econBtn.width + 6, y0 = portrait ? this.topBottom + 8 : this.econBtn.y;
    const H = 44, CW = 70, items: Phaser.GameObjects.GameObject[] = [], g = this.add.graphics();
    items.push(g);
    let x = 0;
    const STATE_COL: Record<string, number> = { offensiva: TCOL.accent, combatte: TCOL.alert, 'in line': TCOL.ok, fronte: TCOL.ok, 'marching': TCOL.text, fermo: TCOL.label };
    for (const gr of list) {
      if (x0 + x + CW > width - PAD - 140) break; // non sopra i tasti a destra
      termBox(g, x, 0, CW, H, 0.92);
      if (gr.selected) g.lineStyle(2, TCOL.text, 1).strokeRect(x + 1, 1, CW - 2, H - 2);
      const hit = this.add.rectangle(x, 0, CW, H, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true });
      const n = gr.n;
      hit.on('pointerup', () => { sfx('select'); this.run.selectGroup(n); });
      items.push(hit,
        this.add.text(x + 8, 5, ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][n], termStyle(16, TCOL.text)),
        this.add.text(x + CW - 7, 7, `×${gr.count}`, termStyle(11, TCOL.label)).setOrigin(1, 0),
        this.add.text(x + 8, H - 6, gr.state, termStyle(11, STATE_COL[gr.state] ?? TCOL.label)).setOrigin(0, 1));
      x += CW + 6;
    }
    // + GRUPPO: compare quando serve (pedine selezionate o gruppi già fatti), acceso se ci sono pedine selezionate
    const on = sel > 0, PW = 82;
    if (on || list.length) {
      termBox(g, x, 0, PW, H, 0.92);
      const plus = this.add.text(x + PW / 2, H / 2, on && this.run.selectionIsGroup() ? 'UNGROUP' : '+ GROUP', termStyle(11, on ? TCOL.text : TCOL.dim)).setOrigin(0.5);
      const hitP = this.add.rectangle(x, 0, PW, H, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: on });
      hitP.on('pointerup', () => { if (on) { sfx('order'); this.run.makeGroup(); } else this.notify('select units first', PALETTE.ko); });
      items.push(plus, hitP);
      x += PW;
    }
    this.groupBar = this.add.container(x0, y0, items).setDepth(20);
    this.groupBarRect = { x: x0, y: y0, w: x, h: H };
  }

  private toggleLines() {
    if (this.linesPanel) {
      this.linesPanel.destroy();
      this.linesPanel = null;
      this.linesBtn.setOn(false);
      return;
    }
    this.linesKey = '';
    this.linesBtn.setOn(true);
    this.drawLines();
  }

  /**
   * Pannello LINES sopra il tasto: una riga per linea (colore, reparti, contro chi) con i comandi. Senza linee spiega
   * come farne una. Si ridisegna solo quando le linee cambiano.
   */
  private drawLines() {
    const list = this.run.lineList(), atk = this.run.nationAttacks(), zones = this.run.zoneList(), sel = this.run.selectedCount;
    const key = `${list.map((l) => `${l.n}:${l.count}:${l.vs}`).join(',')}|${atk.map((a) => `${a.f}:${a.count}`).join(',')}|${zones.map((z) => `${z.id}:${z.count}:${z.left}`).join(',')}|${sel > 0 ? 1 : 0}`;
    if (key === this.linesKey && this.linesPanel) return;
    this.linesKey = key;
    this.linesPanel?.destroy();
    // tasti a icona (Nico: "tutti con le icone, spiegare bene cosa sono"): sotto, una riga dice cosa fa quello sotto il mouse
    type Act = 'select' | 'add' | 'attack' | 'redraw' | 'delete' | 'stop';
    const INFO: Record<Act, { ic: LineIcon; t: string }> = {
      select: { ic: 'pointer', t: 'Select: picks the units of this group' },
      add: { ic: 'plus', t: 'Add: puts the selected units on this line' },
      attack: { ic: 'arrow', t: 'Attack: drag an arrow, the whole line advances' },
      redraw: { ic: 'pencil', t: 'Redraw: draw this line again on the border' },
      delete: { ic: 'close', t: 'Remove: deletes the line, units stay where they are' },
      stop: { ic: 'stop', t: 'Stop: the attack ends, units hold where they are' },
    };
    const LINE_ACTS: Act[] = ['select', 'add', 'redraw', 'delete'], ATK_ACTS: Act[] = ['select', 'stop'];
    const W = 360, RH = 40, M = 10, BW = 32, rows = Math.max(1, list.length + atk.length + zones.length), H = 30 + rows * RH + 26;
    const g = this.add.graphics(), items: Phaser.GameObjects.GameObject[] = [];
    const bg = this.add.rectangle(0, 0, W, H, TCOL.bg, 0.96).setOrigin(0).setStrokeStyle(1, TCOL.edge, 0.75);
    const DEF = 'Hover a button to see what it does';
    const info = this.add.text(M, H - 8, DEF, termStyle(10, TCOL.dim)).setOrigin(0, 1);
    items.push(bg, g, this.add.text(M, 9, 'LINES', termStyle(12, TCOL.label)), info);
    if (!list.length && !atk.length && !zones.length) items.push(this.add.text(M, 32, 'No lines yet. Select units, press G and drag along your border.', termStyle(11, TCOL.dim)));
    const row = (r: number, color: number, title: string, sub: string, acts: Act[], run: (a: Act) => void) => {
      const y = 30 + r * RH;
      g.fillStyle(color, 1).fillRect(M, y + 8, 6, RH - 16);
      items.push(this.add.text(M + 14, y + 7, title, termStyle(12, TCOL.text)),
        this.add.text(M + 14, y + RH - 7, sub.length > 22 ? sub.slice(0, 21) + '…' : sub, termStyle(10, TCOL.label)).setOrigin(0, 1));
      let x = W - M;
      for (const a of [...acts].reverse()) {
        x -= BW;
        const off = a === 'add' && !sel, col = off ? TCOL.dim : a === 'delete' || a === 'stop' ? TCOL.alert : TCOL.text;
        termBox(g, x, y + 6, BW, RH - 12, 0.92);
        items.push(lineIcon(this, INFO[a].ic, x + BW / 2, y + RH / 2, 15, col));
        const hit = this.add.rectangle(x, y + 6, BW, RH - 12, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: !off });
        hit.on('pointerover', () => info.setText(INFO[a].t).setColor(hex(TCOL.text))).on('pointerout', () => info.setText(DEF).setColor(hex(TCOL.dim)));
        hit.on('pointerup', () => { sfx('select'); run(a); this.linesKey = ''; });
        items.push(hit);
        x -= 4;
      }
    };
    list.forEach((l, r) => row(r, l.color, `LINE ${l.n} ×${l.count}`, l.vs ? `vs ${l.vs}` : '', LINE_ACTS, (a) => this.run.lineAction(l.n, a as 'select' | 'add' | 'attack' | 'redraw' | 'delete')));
    atk.forEach((o, k) => row(list.length + k, o.color, `ATTACK ${o.name.toUpperCase()} ×${o.count}`, 'until the nation falls', ATK_ACTS, (a) => this.run.attackAction(o.f, a === 'stop' ? 'stop' : 'select')));
    // regioni scelte (Nico, 27 novembre 2026: "deve essere nelle linee, ci deve essere un gruppo")
    zones.forEach((z, k) => row(list.length + atk.length + k, z.color, `REGIONS ×${z.count}`, `${z.left} provinces left`, ATK_ACTS, (a) => this.run.zoneAction(z.id, a === 'stop' ? 'stop' : 'select')));
    const bx = this.linesBtn.x, by = this.linesBtn.y;
    this.linesPanel = this.add.container(Math.max(PAD, Math.min(bx, view(this).width - PAD - W)), by - 8 - H, items).setDepth(46);
  }

  hitUi(x: number, y: number, layoutOnly = false): boolean {
    if (!layoutOnly && (this.ended || this.eventCard)) return true;
    if (layoutOnly && y > this.hint.y - 4 && y < this.hint.y + 60 && Math.abs(x - this.hint.x) < 200) return true; // etichetta della guida
    const inRect = (r: Phaser.GameObjects.Rectangle, ox = 0, oy = 0) => {
      const rx = ox + r.x - r.width * r.originX, ry = oy + r.y - r.height * r.originY;
      return x >= rx && x <= rx + r.width && y >= ry && y <= ry + r.height;
    };
    if (inRect(this.leftPanel) || inRect(this.rightPanel)) return true;
    if (this.tipCard?.getBounds().contains(x, y)) return true; // suggerimento
    const cr = this.chatRect;
    if (cr.w && x >= cr.x && x <= cr.x + cr.w && y >= cr.y && y <= cr.y + cr.h) return true; // chat delle comunicazioni
    const gb = this.groupBarRect;
    if (this.groupBar && x >= gb.x && x <= gb.x + gb.w && y >= gb.y && y <= gb.y + gb.h) return true; // barra dei gruppi
    if (this.linesPanel && inRect(this.linesPanel.list[0] as Phaser.GameObjects.Rectangle, this.linesPanel.x, this.linesPanel.y)) return true;
    if (this.buildPanel && inRect(this.buildPanel.list[0] as Phaser.GameObjects.Rectangle, this.buildPanel.x, this.buildPanel.y)) return true;
    if (this.econPanel && inRect(this.econPanel.list[0] as Phaser.GameObjects.Rectangle, this.econPanel.x, this.econPanel.y)) return true;
    if (this.pauseUi && inRect(this.pauseUi.list[0] as Phaser.GameObjects.Rectangle, this.pauseUi.x, this.pauseUi.y)) return true;
    if (this.provCard && inRect(this.provCard.list[0] as Phaser.GameObjects.Rectangle, this.provCard.x, this.provCard.y)) return true;
    if (this.profile && inRect(this.profile.list[0] as Phaser.GameObjects.Rectangle, this.profile.x, this.profile.y)) return true;
    if (this.help && inRect(this.help.list[0] as Phaser.GameObjects.Rectangle, this.help.x, this.help.y)) return true;
    if (this.menu && inRect(this.menu.list[0] as Phaser.GameObjects.Rectangle, this.menu.x, this.menu.y)) return true;
    if (this.medalPanel && inRect(this.medalPanel.list[0] as Phaser.GameObjects.Rectangle, this.medalPanel.x, this.medalPanel.y)) return true;
    if (this.audioPanel && inRect(this.audioPanel.list[0] as Phaser.GameObjects.Rectangle, this.audioPanel.x, this.audioPanel.y)) return true;
    const btns = [this.speedBtn, this.pauseBtn, this.retreatBtn, this.mapBtn, this.buildBtn, this.medalBtn, this.audioBtn, this.radarBtn, this.econBtn, this.profileBtn, this.settingsBtn, ...this.cards, ...this.abilityCards].filter((b) => b !== null);
    return btns.some((b) => b.visible && b.contains(x, y));
  }
}
