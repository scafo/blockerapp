import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { PALETTE, hex } from '../config/palette';
import buildingText from '../data/buildings.json';
import frontText from '../data/fronts.json';
import {
  BUILDINGS, EXPEDITIONS, activeCiv, buildBlock, campaignChoice, canAfford, civChoice, collectExpedition, deckOf, expeditionCost, unlockedUnits,
  activeFront, enableTestMode, expeditionTimeSec, fmtTime, nextLevel, playerPower, settle, startBuild, startExpedition, stashCap, tents, unlockedAbilities,
  SUPPLIES, buySupply, rush, rushCost, trade,
} from '../game/camp';
import shopText from '../data/shop.json';
import { CIV_IDS, civInfo, civUnlocked } from '../game/civs';
import { CIV_STYLE } from '../game/factions';
import { loreFragments, loreTotal, settleResearch, techInfo } from '../game/tech';
import { unitInfo } from '../game/units';
import type { CampaignId } from '../config/balance';
import { RESOURCES, RESOURCE_INFO, type Bag } from '../game/resources';
import { randomSeed } from '../map/rng';
import { loadProfile, resetProfile, saveProfile, type BuildingId, type ExpeditionKind, type Profile } from '../save/storage';
import { analytics } from '../analytics/analytics';
import { FPS_KEY, fpsEnabled } from '../ui/debug';
import { askName } from '../ui/nameInput';
import { canStake, recoverStake, runOptions, stakeIndex } from '../game/camp';
import { Button } from '../ui/Button';
import { buzz } from '../ui/haptics';
import { drawResourceIcon } from '../ui/resourceIcons';
import { textStyle } from '../ui/style';
import { safeInsets, uiCamera, view } from '../ui/screen';
import { drawPatch } from '../ui/symbols';
import { drawUnitIcon } from '../ui/unitIcons';
import { civImage, coverImage, fade } from '../ui/images';
import { ashFall, drawBuilding, drawCompound, drawGround, drawLot, drawRoad, drawScaffold, drawTower, truck } from '../ui/baseArt';

const PAD = 12;
// risorse mostrate l'ultima volta che la base era aperta: al rientro da una campagna i numeri scorrono fino ai nuovi
let shownStash: number[] | null = null;
const maxLvl = (id: BuildingId) => BALANCE.camp.buildings[id].length;
const SKY = PALETTE.inchiostro; // l'HQ è una planimetria sul tavolo dello stato maggiore, di notte
const INK = PALETTE.carta; // testi chiari sul fondo scuro
const LINE = PALETTE.linea; // tratti della planimetria

type Spot = BuildingId | 'spedizione' | 'gioca' | 'test' | 'mercato'; // 'gioca' = preparazione della campagna, 'test' = modalità test
type MapSpot = BuildingId | 'spedizione'; // le postazioni sulla planimetria
const CAMPAIGNS: CampaignId[] = ['breve', 'standard', 'lunga'];
const CAMPAIGN_NAME: Record<CampaignId, string> = { breve: 'BREVE', standard: 'STANDARD', lunga: 'LUNGA' };
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

/** Accampamento (home): piccolo all'inizio, cresce con edifici, tende e spedizioni. */
export class CampScene extends Phaser.Scene {
  profile!: Profile; // condiviso con l'albero della ricerca (TreeScene)
  private k = 1; // scala del disegno rispetto a 844×390
  private plan = { x: 0, y: 0, w: 0, h: 0 }; // area della planimetria
  private spotPos = {} as Record<MapSpot, { x: number; y: number }>;
  private clock: Phaser.GameObjects.Text | null = null;
  private portrait = false;
  private safe = { top: 0, right: 0, bottom: 0, left: 0 }; // notch e barra dei gesti (punti)
  private spots = new Map<Spot, { x: number; y: number; g: Phaser.GameObjects.Graphics; deco: Phaser.GameObjects.GameObject[]; label: Phaser.GameObjects.Text }>();
  private stashTexts: Phaser.GameObjects.Text[] = [];
  private stashBars: Phaser.GameObjects.Rectangle[] = [];
  private counting: boolean[] = [];
  private stashBarW = 0;
  private capText: Phaser.GameObjects.Text | null = null;
  private statusText: Phaser.GameObjects.Text | null = null;
  private timerTexts = new Map<Spot, Phaser.GameObjects.Text>();
  private panel: Phaser.GameObjects.Container | null = null;
  private panelSpot: Spot | null = null;
  private panelMode = ''; // laboratorio: '' ricerche · 'archivio' · 'build'; radar: '' registro · 'build'
  private refreshAcc = 0;
  private panelKey = '';
  private lastToast: Phaser.GameObjects.Text | null = null;
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;
  private navBtns: { btn: Button; on: () => boolean }[] = [];

  constructor() {
    super('Camp');
  }

  create() {
    uiCamera(this);
    this.profile = loadProfile();
    // campagna lasciata a metà (app chiusa): la puntata rientra come in una ritirata
    const back = recoverStake(this.profile);
    if (back) {
      saveProfile(this.profile);
      this.time.delayedCall(900, () => this.toast(`CAMPAGNA INTERROTTA · la puntata rientra: +${back} risorse (tassa di ritirata)`, PALETTE.allerta));
    }
    // dopo la run guidata: il nome del comandante (una volta sola, si cambia toccandolo)
    if (this.profile.runs >= 1 && !this.profile.name && !this.profile.nameAsked) this.time.delayedCall(600, () => this.editName(true));
    this.spots = new Map();
    this.timerTexts = new Map();
    this.panel = null;
    this.panelSpot = null;
    const { width, height } = view(this);
    // verticale: edifici su due file (dietro sull'orizzonte, davanti in basso), campo al centro
    this.portrait = height > width;

    // planimetria: area utile tra la scorta in alto e i comandi in basso
    this.safe = safeInsets();
    const st = this.safe.top, sb = this.safe.bottom;
    this.plan = this.portrait ? { x: PAD, y: 164 + st, w: width - 2 * PAD, h: height - 164 - 150 - st - sb }
      : { x: PAD, y: 114 + st, w: width - 2 * PAD, h: height - 114 - 76 - st - sb };
    this.k = this.portrait ? Math.min(this.plan.w / 400, 1.2) : Math.min(this.plan.w / 820, this.plan.h / 230, 1.6);
    const frac: Record<MapSpot, [number, number]> = this.portrait
      ? { comando: [0.5, 0.41], laboratorio: [0.27, 0.13], radar: [0.73, 0.13], arsenale: [0.27, 0.68], deposito: [0.73, 0.68], spedizione: [0.5, 0.88] }
      : { comando: [0.5, 0.5], laboratorio: [0.3, 0.16], radar: [0.7, 0.16], arsenale: [0.16, 0.66], deposito: [0.84, 0.66], spedizione: [0.5, 0.95] };
    this.spotPos = Object.fromEntries(Object.entries(frac).map(([id, [fx, fy]]) => [id, { x: this.plan.x + this.plan.w * fx, y: this.plan.y + this.plan.h * fy }])) as typeof this.spotPos;
    this.drawBackdrop();
    this.drawCenter();
    for (const id of [...BUILDINGS, 'spedizione'] as const) this.makeSpot(id, this.spotPos[id].x, this.spotPos[id].y);
    this.burst = this.add.particles(0, 0, 'dot', {
      speed: { min: 60, max: 180 }, lifespan: 600, scale: { start: 1, end: 0 }, emitting: false,
    }).setDepth(30);

    this.drawHud();
    this.settleAll(true);
    this.introSpots();
    // tastiera (PC): INVIO = GIOCA, ESC = chiude la scheda aperta
    this.input.keyboard?.on('keydown-ENTER', () => { if (!this.panel && !document.getElementById('name-ask')) this.onPlay(); });
    this.input.keyboard?.on('keydown-ESC', () => this.closePanel());
    this.scale.once('resize', () => this.scene.restart());
    // alcune WebView (app iOS) al primissimo avvio leggono il notch come 0: un ricontrollo rapido corregge il layout
    this.time.delayedCall(300, () => { if (safeInsets().top !== this.safe.top) this.scene.restart(); });
  }

  update(_t: number, delta: number) {
    this.refreshAcc -= delta;
    if (this.refreshAcc > 0) return;
    this.refreshAcc = 250;
    this.settleAll(false);
    const now = Date.now();
    const d = new Date(now);
    this.clock?.setText(`HQ // ${civInfo(activeCiv(this.profile)).name.toUpperCase()} · SETTORE 07 · ${d.toTimeString().slice(0, 8)}`);
    const c = this.profile.construction;
    for (const [spot, t] of this.timerTexts) {
      if (spot === 'spedizione') {
        const e = this.profile.expedition;
        t.setText(!e ? '' : e.until <= now ? 'DI RITORNO!' : `torna tra ${fmtTime(e.until - now)}`);
      } else {
        const r = this.profile.research;
        t.setText(c && c.id === spot ? `cantiere ${fmtTime(c.until - now)}` : spot === 'laboratorio' && r ? `ricerca ${fmtTime(r.until - now)}` : '');
      }
    }
    if (this.panelSpot) {
      // il pannello si ridisegna solo se mostra un timer o se lo stato è cambiato (non ruba i tocchi)
      const key = this.panelState(this.panelSpot, now);
      if (key !== this.panelKey || key.endsWith(':timer')) this.openPanel(this.panelSpot);
    }
  }

  private panelState(spot: Spot, now: number): string {
    const p = this.profile;
    if (spot === 'spedizione') return !p.expedition ? 'none' : p.expedition.until > now ? 'away:timer' : 'ready';
    if (spot === 'test') return `test|${p.test ? 1 : 0}`;
    if (spot === 'mercato') {
      // si ridisegna quando cambiano risorse, acquisti o il prezzo per finire i lavori (a minuti)
      const mins = [p.construction, p.research].map((j) => (j && j.until > now ? Math.ceil((j.until - now) / 60_000) : 0)).join(',');
      return `mercato|${RESOURCES.map((r) => p.stash[r]).join(',')}|${(p.supplies ?? []).join(',')}|${mins}`;
    }
    if (spot === 'gioca') return `gioca|${this.panelMode}|${p.civ}|${p.campaign}|${(p.deck ?? []).join(',')}`;
    if (spot === 'laboratorio' && this.panelMode === 'archivio') return `lab|archivio|${p.techs.length}`;
    return `${p.buildings[spot]}|${p.construction?.id ?? ''}|${RESOURCES.map((r) => p.stash[r]).join(',')}${p.construction?.id === spot ? ':timer' : ''}`;
  }

  // ---------- stato ----------

  private settleAll(first: boolean) {
    const done = settle(this.profile, Date.now());
    if (done) {
      saveProfile(this.profile);
      this.redrawSpot(done);
      const spot = this.spots.get(done)!;
      this.cameras.main.flash(200, 77, 255, 154);
      this.cameras.main.shake(180, 0.003);
      this.tapRing(done, PALETTE.radioattivo, 1.15);
      buzz([30, 40, 30]);
      this.burst.setParticleTint(PALETTE.ocra);
      this.burst.explode(30, spot.x, spot.y);
      const lvl = this.profile.buildings[done];
      analytics.design(['accampamento', 'completato', done], lvl);
      this.toast(`${buildingText[done].name.toUpperCase()} LIV. ${lvl} COMPLETATA\n${buildingText[done].levels[lvl - 1]}`, PALETTE.radioattivo);
    }
    const tech = settleResearch(this.profile, Date.now());
    if (tech) {
      saveProfile(this.profile);
      const t = techInfo(tech);
      analytics.design(['laboratorio', 'ricerca', tech]);
      this.toast(`RICERCA COMPLETATA: ${t.name.toUpperCase()}\n${t.desc}${t.lore ? '\nNuovo frammento nell\'archivio della Caduta' : ''}`, PALETTE.radioattivo);
    }
    if (first) {
      for (const id of [...BUILDINGS, 'spedizione'] as const) this.redrawSpot(id);
    }
    this.updateStash();
  }

  private updateStash() {
    const p = this.profile, cap = stashCap(p), finite = Number.isFinite(cap);
    shownStash ??= RESOURCES.map((r) => p.stash[r]); // prima apertura: niente da far scorrere
    RESOURCES.forEach((r, i) => {
      const v = p.stash[r];
      const t = this.stashTexts[i];
      if (!t) return;
      t.setColor(hex(finite && v >= cap ? PALETTE.ko : RESOURCE_INFO[r].color));
      const from = shownStash?.[i];
      if (from !== undefined && from !== v && !this.counting[i]) this.countTo(i, from, v);
      else if (!this.counting[i]) t.setText(String(v));
      if (!this.counting[i] && shownStash) shownStash[i] = v;
      if (this.stashBars[i]) this.stashBars[i].width = this.stashBarW * (finite ? Math.min(1, v / cap) : 1);
    });
    this.capText?.setText(finite ? `DEPOSITO · capienza ${cap} per risorsa` : 'DEPOSITO · senza limite (test)');
    const now = Date.now(), c = p.construction, rs = p.research;
    const parts = [
      c ? `🔨 ${buildingText[c.id].name} liv. ${p.buildings[c.id] + 1} · ${fmtTime(c.until - now)}` : '🔨 cantiere libero',
      rs ? `⚗ ${techInfo(rs.id).name} · ${fmtTime(rs.until - now)}` : '⚗ nessuna ricerca',
    ];
    this.statusText?.setText(parts.join('   ')).setColor(hex(c || rs ? PALETTE.allerta : PALETTE.tenue));
  }

  // ---------- disegno ----------

  /** Fondo: l'immagine della potenza scelta (Figma), virata al freddo e velata; sopra la planimetria dell'HQ. */
  private drawBackdrop() {
    const { width, height } = view(this);
    this.cameras.main.setBackgroundColor(SKY);
    drawGround(this, width, height);
    // l'immagine della potenza appena accennata, come un riflesso sul vetro della sala operativa
    const img = coverImage(this, civImage(activeCiv(this.profile)), 0, 0, width, height, 0.35).setTint(0x9fb4cc).setAlpha(0.12);
    this.tweens.add({ targets: img, alpha: 0.06, duration: 6000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    fade(this, 0, 0, width, height * 0.22, SKY, 0.9, 0);
    fade(this, 0, height * 0.78, width, height * 0.22, SKY, 0, 0.85);
  }

  /** La base: piazzale recintato, torrette coi fari, strade dal Centro di Comando a ogni postazione, alloggi. */
  private drawCenter() {
    const b = this.plan, c = this.spotPos.comando, k = this.k;
    const g = this.add.graphics();
    const corners = drawCompound(g, b, k);
    for (const [id, p] of Object.entries(this.spotPos)) if (id !== 'comando') drawRoad(g, c.x, c.y, p.x, p.y, k);
    // uscita del convoglio verso il bordo
    const sp = this.spotPos.spedizione;
    drawRoad(g, sp.x, sp.y, sp.x, b.y + b.h + 30, k);
    corners.forEach((q, i) => drawTower(this, q.x, q.y, k, [Math.PI * 0.15, Math.PI * 0.65, Math.PI * 1.15, Math.PI * 1.65][i]));
    // alloggi: una baracca ogni tenda, in fila in un angolo libero
    // in verticale a metà del lato sinistro (in basso c'è la rimessa), in orizzontale in basso a sinistra
    const n = tents(this.profile), ax = b.x + (this.portrait ? 14 : 40) * k, ay = this.portrait ? c.y + 16 * k : b.y + b.h - 30 * k;
    for (let i = 0; i < n; i++) {
      const x = ax + i * 15 * k;
      g.fillStyle(0x000000, 0.4).fillRect(x + 2, ay + 2, 11 * k, 7 * k);
      g.fillStyle(0x3a4a3a, 1).fillRect(x, ay, 11 * k, 7 * k).lineStyle(1, 0x55684f, 1).lineBetween(x, ay + 3.5 * k, x + 11 * k, ay + 3.5 * k);
    }
    this.add.text(ax, ay - 4, `ALLOGGI ${n}${this.portrait ? '\n' : ' · '}CAMPAGNE ${this.profile.runs}`, textStyle(9, PALETTE.ocra, false)).setOrigin(0, 1).setAlpha(0.85);
    // intestazione con l'ora (aggiornata in update); in verticale non c'è posto
    if (!this.portrait) this.clock = this.add.text(b.x + b.w - 30, b.y - 14, '', textStyle(10, PALETTE.ocra, false)).setOrigin(1, 0.5);
    else this.clock = null;
    ashFall(this, view(this).width, view(this).height);
  }

  /** Ingombro dell'edificio di una postazione (punti). */
  private footprint(id: MapSpot) {
    const k = this.k;
    return id === 'comando' ? { w: 160 * k, h: 88 * k } : id === 'spedizione' ? { w: 112 * k, h: 60 * k } : { w: 122 * k, h: 70 * k };
  }

  private makeSpot(id: MapSpot, x: number, y: number) {
    const { w, h } = this.footprint(id);
    const g = this.add.graphics();
    const label = this.add.text(x, y + h / 2 + 12, id === 'spedizione' ? 'ESTRAZIONE' : buildingText[id].name.toUpperCase(), textStyle(10, PALETTE.carta))
      .setOrigin(0.5).setDepth(6);
    const timer = this.add.text(x, y + h / 2 + 24, '', textStyle(10, PALETTE.allerta)).setOrigin(0.5, 0).setDepth(6);
    this.timerTexts.set(id, timer);
    this.spots.set(id, { x, y, g, deco: [], label });
    const hit = this.add.rectangle(x, y + 8, w + 16, h + 36, 0xffffff, 0.001).setInteractive({ useHandCursor: true }).setDepth(7);
    hit.on('pointerdown', () => { this.tapRing(id, PALETTE.ocra, 1); buzz(8); });
    // il Laboratorio costruito apre direttamente l'albero della ricerca
    hit.on('pointerup', () => (id === 'laboratorio' && this.profile.buildings.laboratorio > 0 ? this.openTree('esercito') : this.openPanel(id)));
  }

  /** Edificio della postazione: lotto libero, cantiere o costruito (più dettagli col livello); targa col nome e livello. */
  private redrawSpot(id: MapSpot) {
    const spot = this.spots.get(id)!;
    spot.deco.forEach((d) => d.destroy());
    spot.deco = [];
    const g = spot.g.clear();
    const k = this.k, x = spot.x, y = spot.y, { w, h } = this.footprint(id);
    const lvl = id === 'spedizione' ? 1 : this.profile.buildings[id];
    const building = id !== 'spedizione' && this.profile.construction?.id === id;
    const ctx = { scene: this as Phaser.Scene, g, deco: spot.deco, k };
    const civ = CIV_STYLE[activeCiv(this.profile)];
    if (lvl > 0) drawBuilding(ctx, id, x, y, w, h, lvl, civ);
    else drawLot(ctx, x, y, w, h);
    if (building) drawScaffold(ctx, x, y, w, h);
    if (id === 'spedizione') this.drawConvoy(spot, g, x, y, w, h);
    // targa: nome sotto l'edificio, livello nel distintivo (alla Clash)
    const lw = spot.label.width + 22;
    g.fillStyle(PALETTE.inchiostro, 0.88).fillRoundedRect(x - lw / 2, y + h / 2 + 4, lw, 17, 4).lineStyle(1, lvl > 0 ? PALETTE.ocra : PALETTE.linea, 0.8)
      .strokeRoundedRect(x - lw / 2, y + h / 2 + 4, lw, 17, 4);
    spot.label.setAlpha(lvl > 0 || building ? 1 : 0.6);
    if (lvl === 0 && !building) spot.deco.push(this.add.text(x, y, '[ + ] LOTTO LIBERO', textStyle(10, PALETTE.ocra)).setOrigin(0.5).setAlpha(0.8));
    if (id !== 'spedizione') {
      const n = maxLvl(id);
      if (lvl > 0) {
        const bx = x - lw / 2 - 2, by = y + h / 2 + 12, r = 10;
        g.fillStyle(lvl >= n ? PALETTE.ocra : PALETTE.inchiostro, 1).fillCircle(bx, by, r).lineStyle(1.5, PALETTE.ocra, 1).strokeCircle(bx, by, r);
        spot.deco.push(this.add.text(bx, by, String(lvl), textStyle(11, lvl >= n ? PALETTE.inchiostro : PALETTE.ocra)).setOrigin(0.5).setDepth(6));
      }
      // si può migliorare adesso: freccia verde che pulsa sulla targa
      if (lvl < n && !building && !buildBlock(this.profile, id)) {
        const up = this.add.text(x + lw / 2 + 4, y + h / 2 + 12, '▲', textStyle(13, PALETTE.ok)).setOrigin(0, 0.5).setDepth(6);
        this.tweens.add({ targets: up, y: up.y - 3, alpha: 0.4, duration: 600, yoyo: true, repeat: -1 });
        spot.deco.push(up);
      }
    }
    void k;
  }

  /** Squadre di estrazione: camion in rimessa, oppure in missione (uno corre sulla strada d'uscita) o di ritorno (!). */
  private drawConvoy(spot: { deco: Phaser.GameObjects.GameObject[] }, g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
    const k = this.k, e = this.profile.expedition, away = e && e.until > Date.now(), ready = e && e.until <= Date.now();
    const ctx = { scene: this as Phaser.Scene, g, deco: spot.deco, k };
    if (!away) {
      for (let i = 0; i < 2; i++) truck(ctx, x + w * 0.2, y - h * 0.18 + i * h * 0.36, k, ready ? 0x8a7a3e : 0x5b6e57);
    } else {
      const dot = this.add.rectangle(x, y + h * 0.2, 10 * k, 5 * k, 0x5b6e57).setStrokeStyle(1, 0x7d8f74);
      this.tweens.add({ targets: dot, y: this.plan.y + this.plan.h + 24, alpha: 0.2, duration: 2600, repeat: -1 });
      spot.deco.push(dot, this.add.text(x + w * 0.22, y - 6 * k, 'IN MISSIONE', textStyle(9, PALETTE.allerta, false)).setOrigin(0.5));
    }
    if (ready) {
      const bang = this.add.text(x + w / 2 + 8, y - h * 0.3, '!', textStyle(22, PALETTE.allerta)).setOrigin(0.5);
      this.tweens.add({ targets: bang, alpha: 0.2, duration: 400, yoyo: true, repeat: -1 });
      spot.deco.push(bang);
    }
  }

  // ---------- interfaccia ----------

  private drawHud() {
    const { width, height } = view(this);
    // scorta in alto a sinistra
    const P = this.portrait;
    // scorta alla Clash: risorse grandi nel loro colore, barra di riempimento sulla capienza del Deposito
    const T = PAD + this.safe.top, B = PAD + this.safe.bottom; // margini sicuri in alto e in basso
    const panelW = P ? width - 2 * PAD : 360, panelY = P ? T + 52 : T, step = P ? (panelW - 20) / 3 : 116;
    this.add.rectangle(PAD, panelY, panelW, 74, PALETTE.inchiostro, 0.84).setOrigin(0).setStrokeStyle(1, PALETTE.linea);
    this.capText = this.add.text(PAD + 10, panelY + 6, '', textStyle(10, PALETTE.ocra));
    const ig = this.add.graphics();
    this.stashBars = [];
    this.stashBarW = step - 22;
    this.stashTexts = RESOURCES.map((r, i) => {
      const x = PAD + 12 + i * step;
      drawResourceIcon(ig, r, x + 10, panelY + 38, 10);
      this.add.rectangle(x, panelY + 60, this.stashBarW, 5, PALETTE.linea).setOrigin(0);
      this.stashBars.push(this.add.rectangle(x, panelY + 60, 0, 5, RESOURCE_INFO[r].color).setOrigin(0));
      return this.add.text(x + 26, panelY + 38, '0', textStyle(22, RESOURCE_INFO[r].color)).setOrigin(0, 0.5);
    });
    // sotto: cantiere e ricerca in corso (alla Clash: chi lavora e quanto manca)
    this.statusText = this.add.text(PAD + 2, panelY + 80, '', textStyle(10, PALETTE.carta, false));
    // titolo in alto a destra
    // 5 tocchi sul titolo = contatore FPS nelle run (per i test sui telefoni economici, anche dentro l'app)
    let taps = 0;
    const titleX = P ? width / 2 : width - PAD, titleO = P ? 0.5 : 1;
    this.add.text(titleX, T + 4, 'ASHEN ATLAS', textStyle(20, INK)).setOrigin(titleO, 0)
      .setInteractive().on('pointerup', () => {
        if (++taps < 5) return;
        taps = 0;
        const on = !fpsEnabled();
        try {
          localStorage.setItem(FPS_KEY, on ? '1' : '0');
        } catch {
          /* niente storage: pazienza */
        }
        this.toast(on ? 'Contatore FPS attivo nelle run' : 'Contatore FPS spento', PALETTE.carta);
      });
    const p = this.profile;
    // tasto TEST (giallo se attiva): apre la modalità test
    const testBtn = this.add.text(P ? width - PAD : titleX - 150, P ? T + 4 : T + 8, p.test ? '[ TEST ATTIVO ]' : '[ TEST ]', textStyle(11, PALETTE.allerta))
      .setOrigin(1, 0).setInteractive({ useHandCursor: true }).on('pointerup', () => this.openPanel('test'));
    void testBtn;
    // potenza e fronte (alla Call of War: il punteggio della tua nazione)
    const power = playerPower(p), front = p.frontMax ?? 0;
    this.add.text(titleX, T + 30, `⛨ ${(p.name || 'COMANDANTE').toUpperCase()} ✎  ·  POTENZA ${power} · FRONTE ${ROMAN[front]} · ${p.wins} vittorie`, textStyle(11, PALETTE.ocra))
      .setOrigin(titleO, 0).setInteractive({ useHandCursor: true }).on('pointerup', () => this.editName());
    // GIOCA: in basso a destra (orizzontale) o grande in basso al centro (verticale, sotto il pollice)
    const bw = P ? Math.min(260, width - 2 * PAD) : 150;
    // dopo la run guidata GIOCA apre la preparazione: civiltà e durata della campagna
    const play = new Button(this, 'GIOCA ▶', bw, 56, () => this.onPlay(), 20).setPrimary();
    play.setPosition(P ? (width - bw) / 2 : width - PAD - bw, height - B - 56).setDepth(20);
    // azione principale: fondo oro e un alone che respira piano dietro (attira l'occhio senza muovere il tasto)
    const glow = this.add.rectangle(play.x - 5, play.y - 5, bw + 10, 66, PALETTE.ocra, 0.22).setOrigin(0).setDepth(19);
    this.tweens.add({ targets: glow, alpha: 0.04, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    // cornice: QG, Operazioni, Ricerca, Arsenale, Mercato, Archivio — una riga sopra GIOCA, sempre a portata
    if (this.profile.runs > 0) this.drawNav(width, height, B);
    if (!P) this.add.text(PAD, height - B, 'Tocca una postazione o il convoglio', textStyle(11, INK, false)).setOrigin(0, 1);
  }

  /** Cornice di navigazione: 6 voci verso le schede già esistenti (preparazione, albero, arsenale, mercato, registro). */
  private drawNav(width: number, height: number, B: number) {
    const items: { label: string; on: () => boolean; run: () => void }[] = [
      { label: 'QG', on: () => this.panelSpot === null && !this.scene.isActive('Tree'),
        run: () => { if (this.scene.isActive('Tree')) this.scene.stop('Tree'); this.closePanel(); } },
      { label: 'OPERAZIONI', on: () => this.panelSpot === 'gioca', run: () => this.openPanel('gioca') },
      { label: this.profile.research ? 'RICERCA ⏱' : 'RICERCA', on: () => this.scene.isActive('Tree'), run: () => this.openTree('armamenti') },
      { label: 'ARSENALE', on: () => this.panelSpot === 'arsenale', run: () => this.openPanel('arsenale') },
      { label: 'MERCATO', on: () => this.panelSpot === 'mercato', run: () => this.openPanel('mercato') },
      { label: 'ARCHIVIO', on: () => this.panelSpot === 'radar', run: () => this.openPanel('radar') },
    ];
    // stretto (telefono verticale): 2 righe da 3, altrimenti 1 riga da 6 (etichette leggibili, non accavallate)
    const n = items.length, gap = 6, bh = 36, rowGap = 6, minBw = 92;
    const cols = (width - 2 * PAD - (n - 1) * gap) / n >= minBw ? n : Math.ceil(n / 2);
    const rows = Math.ceil(n / cols);
    const bw = Math.min(150, (width - 2 * PAD - (cols - 1) * gap) / cols);
    const totalH = rows * bh + (rows - 1) * rowGap, yTop = height - B - 56 - 8 - totalH; // blocco appena sopra GIOCA
    const totalW = cols * bw + (cols - 1) * gap, x0 = Math.max(PAD, width - PAD - totalW);
    this.navBtns = items.map((it, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      const b = new Button(this, it.label, bw, bh, it.run, 11);
      b.setPosition(x0 + c * (bw + gap), yTop + r * (bh + rowGap)).setDepth(50); // sopra il pannello aperto (depth 40): sempre raggiungibile
      return { btn: b, on: it.on };
    });
    this.refreshNav();
  }

  /** Aggiorna quale voce della cornice risulta attiva (dopo aver aperto/chiuso una scheda o l'albero). */
  private refreshNav() {
    for (const { btn, on } of this.navBtns) btn.setOn(on());
  }

  /** GIOCA: la prima volta parte la run guidata, poi si apre la preparazione della campagna. */
  private onPlay() {
    if (this.profile.runs === 0) this.scene.start('Load', { next: 'Run', data: { seed: randomSeed() } });
    else this.openPanel('gioca');
  }

  /** Anello che si allarga e svanisce attorno a una postazione: tocco (piccolo) o lavori finiti (grande). */
  private tapRing(id: MapSpot, color: number, size: number) {
    const spot = this.spots.get(id);
    if (!spot) return;
    const { w, h } = this.footprint(id);
    const g = this.add.graphics({ x: spot.x, y: spot.y }).setDepth(8);
    g.lineStyle(2, color, 0.9).strokeRoundedRect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12, 8);
    g.setScale(0.97 * size);
    this.tweens.add({ targets: g, scale: 1.07 * size, alpha: 0, duration: size > 1 ? 650 : 280, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
  }

  /** Entrata della base: le postazioni scendono al loro posto una dopo l'altra, con un piccolo rimbalzo. */
  private introSpots() {
    this.cameras.main.fadeIn(250, 5, 9, 15);
    [...this.spots.values()].forEach((spot, k) => {
      // decorazioni già animate (fari, radar, frecce) restano come sono: solo quelle ferme entrano in dissolvenza
      const still = spot.deco.filter((d) => d.type !== 'ParticleEmitter' && 'setAlpha' in d && !this.tweens.isTweening(d));
      const parts = [spot.label, ...still] as unknown as Phaser.GameObjects.Components.Alpha[];
      spot.g.y = 14;
      spot.g.alpha = 0;
      for (const d of parts) d.setAlpha(0);
      this.tweens.add({ targets: spot.g, y: 0, alpha: 1, duration: 380, delay: 60 + k * 70, ease: 'Back.easeOut' });
      this.tweens.add({ targets: parts, alpha: 1, duration: 260, delay: 160 + k * 70 });
    });
  }

  /** Il numero della risorsa scorre fino al nuovo valore (rientro da una campagna, spese); in salita, scintille del suo colore. */
  private countTo(i: number, from: number, to: number) {
    const t = this.stashTexts[i], r = RESOURCES[i], o = { v: from };
    this.counting[i] = true;
    this.tweens.add({
      targets: o, v: to, duration: Math.min(1200, 400 + Math.abs(to - from) * 2), delay: 350, ease: 'Quad.easeOut',
      onUpdate: () => t.setText(String(Math.round(o.v))),
      onComplete: () => {
        t.setText(String(to));
        this.counting[i] = false;
        if (shownStash) shownStash[i] = to;
        this.tweens.add({ targets: t, scale: { from: 1.25, to: 1 }, duration: 260, ease: 'Back.easeOut' });
        if (to > from) {
          this.burst.setParticleTint(RESOURCE_INFO[r].color);
          this.burst.explode(10, t.x + t.width / 2, t.y);
        }
      },
    });
  }

  private closePanel() {
    this.panel?.destroy();
    this.panel = null;
    this.panelSpot = null;
    this.refreshNav();
  }

  /** Scheda a destra con dettagli e azione (costruisci / migliora / spedisci / ritira). */
  private openPanel(spot: Spot, mode?: string) {
    const fresh = spot !== this.panelSpot; // scheda appena aperta (non un ridisegno per i timer): entra con una dissolvenza
    this.panel?.destroy();
    if (mode !== undefined || spot !== this.panelSpot) this.panelMode = mode ?? '';
    this.panelSpot = spot;
    this.refreshNav();
    this.panelKey = this.panelState(spot, Date.now());
    const { width, height } = view(this);
    const wide = spot === 'gioca' || ((spot === 'laboratorio' || spot === 'radar') && this.panelMode !== 'build' && this.profile.buildings[spot] > 0);
    const prep = spot === 'gioca';
    const bld = !prep && !wide && spot !== 'spedizione' && spot !== 'test' && spot !== 'mercato';
    const shop = spot === 'mercato';
    const W = Math.min(prep ? 700 : shop ? 560 : wide ? 540 : bld ? 470 : 330, width - 24);
    const H = Math.min(prep ? (this.portrait ? 620 : 420) : shop ? (this.portrait ? 520 : 372) : wide ? (this.portrait ? 440 : 350) : bld ? 400 : 290, height - 2 * PAD);
    const x0 = width / 2 - W / 2, y0 = (height - H) / 2;
    const items: Phaser.GameObjects.GameObject[] = [];
    const shade = this.add.rectangle(0, 0, width, height, PALETTE.inchiostro, 0.6).setOrigin(0).setInteractive();
    shade.on('pointerup', () => this.closePanel());
    items.push(shade, this.add.rectangle(x0, y0, W, H, PALETTE.inchiostro).setOrigin(0).setStrokeStyle(1, PALETTE.linea).setInteractive());
    const fr = this.add.graphics();
    fr.lineStyle(1, PALETTE.ocra, 0.35).lineBetween(x0 + 8, y0 + 36, x0 + W - 8, y0 + 36);
    for (const [cx, cy, dx, dy] of [[x0, y0, 1, 1], [x0 + W, y0, -1, 1], [x0, y0 + H, 1, -1], [x0 + W, y0 + H, -1, -1]]) {
      fr.lineStyle(3, PALETTE.ocra, 1).lineBetween(cx, cy, cx + dx * 14, cy).lineBetween(cx, cy, cx, cy + dy * 14);
    }
    items.push(fr);
    const close = this.add.text(x0 + W - 12, y0 + 8, '✕', textStyle(18, INK)).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on('pointerup', () => this.closePanel());
    items.push(close);
    const now = Date.now();

    if (spot === 'test') {
      this.fillTest(items, x0, y0, W, H);
    } else if (spot === 'mercato') {
      this.fillShop(items, x0, y0, W, H);
    } else if (spot === 'gioca') {
      this.fillPrep(items, x0, y0, W, H);
    } else if (spot === 'laboratorio' && this.panelMode === 'archivio') {
      this.fillLab(items, x0, y0, W, H);
    } else if (spot === 'radar' && this.panelMode !== 'build' && this.profile.buildings.radar > 0) {
      this.fillRadar(items, x0, y0, W, H);
    } else if (spot === 'spedizione') {
      const T = buildingText.spedizione;
      items.push(this.add.text(x0 + 16, y0 + 12, T.name.toUpperCase(), textStyle(18, INK)));
      items.push(this.add.text(x0 + 16, y0 + 40, T.desc, textStyle(12, INK, false)).setWordWrapWidth(W - 32));
      const e = this.profile.expedition;
      if (e && e.until > now) {
        items.push(this.add.text(x0 + 16, y0 + 100, `${T.kinds[e.kind]}\nIn viaggio: torna tra ${fmtTime(e.until - now)}`, textStyle(14, PALETTE.ruggine)));
      } else if (e) {
        items.push(this.add.text(x0 + 16, y0 + 96, 'Le squadre sono rientrate cariche!', textStyle(14, PALETTE.ocra)));
        items.push(this.bagRow(e.reward, x0 + 16, y0 + 128));
        items.push(this.btn('RITIRA IL BOTTINO', x0 + 16, y0 + H - 60, W - 32, true, () => {
          const kind = this.profile.expedition?.kind ?? 'breve';
          const got = collectExpedition(this.profile, Date.now());
          if (!got) return;
          analytics.design(['spedizione', 'ritira', kind]); // % che torna a ritirare
          analytics.resources('source', got, 'spedizione', kind);
          saveProfile(this.profile);
          this.closePanel();
          this.redrawSpot('spedizione');
          this.updateStash();
          const s = this.spots.get('spedizione')!;
          this.burst.setParticleTint(PALETTE.ocra);
          this.burst.explode(30, s.x, s.y);
          this.toast(`+${got.metallo} metallo · +${got.benzina} benzina · +${got.cibo} cibo`, PALETTE.radioattivo);
        }));
      } else {
        EXPEDITIONS.forEach((kind: ExpeditionKind, i) => {
          const E = BALANCE.camp.expeditions[kind];
          const cost = expeditionCost(kind);
          const ok = this.profile.stash.cibo >= cost;
          const lbl = `${T.kinds[kind]} · ${fmtTime(expeditionTimeSec(this.profile, kind) * 1000)} · ${cost ? `${cost} cibo` : 'gratis'}`;
          items.push(this.btn(lbl, x0 + 16, y0 + 92 + i * 52, W - 32, ok, () => {
            if (!startExpedition(this.profile, kind, Date.now())) return;
            analytics.design(['spedizione', 'parti', kind]);
            saveProfile(this.profile);
            this.closePanel();
            this.redrawSpot('spedizione');
            this.updateStash();
            this.toast('Le squadre partono. Torneranno con quello che trovano.', PALETTE.carta);
          }));
          items.push(this.add.text(x0 + 24, y0 + 92 + i * 52 + 42, `≈ ${E.metallo[0]}–${E.metallo[1]} metallo, ${E.benzina[0]}–${E.benzina[1]} benz., ${E.cibo[0]}–${E.cibo[1]} cibo`,
            textStyle(9, INK, false)));
        });
      }
    } else {
      const T = buildingText[spot];
      const lvl = this.profile.buildings[spot];
      // testata: illustrazione animata del modulo, livello, potenza che guadagni migliorando
      const ig = this.add.graphics();
      ig.fillStyle(PALETTE.pannello, 1).fillRect(x0 + 16, y0 + 14, 132, 88).lineStyle(1, LINE, 1).strokeRect(x0 + 16, y0 + 14, 132, 88);
      const ill = { scene: this as Phaser.Scene, g: ig, deco: [] as Phaser.GameObjects.GameObject[], k: 0.8 };
      drawBuilding(ill, spot, x0 + 82, y0 + 56, 104, 60, Math.max(1, lvl), CIV_STYLE[activeCiv(this.profile)]); // com'è (o sarà) dall'alto
      // livello a tacche: piene quelle fatte, bordo oro la prossima
      for (let i = 0; i < maxLvl(spot); i++) {
        const tx = x0 + 162 + i * 16, ty = y0 + 48;
        if (i < lvl) ig.fillStyle(PALETTE.ocra, 1).fillRect(tx, ty, 12, 7);
        else ig.fillStyle(PALETTE.pannello, 1).fillRect(tx, ty, 12, 7).lineStyle(1, i === lvl ? PALETTE.ocra : PALETTE.linea, 1).strokeRect(tx, ty, 12, 7);
      }
      items.push(ig, ...ill.deco);
      const pw = BALANCE.power[spot as keyof typeof BALANCE.power] ?? 0;
      items.push(this.add.text(x0 + 162, y0 + 14, T.name.toUpperCase(), textStyle(T.name.length > 14 ? 16 : 20, INK)),
        this.add.text(x0 + 162 + maxLvl(spot) * 16 + 6, y0 + 44, `LIV. ${lvl}/${maxLvl(spot)}${lvl < maxLvl(spot) ? ` · +${pw} potenza` : ' · MASSIMO'}`, textStyle(10, PALETTE.ocra)),
        this.add.text(x0 + 162, y0 + 62, T.desc, textStyle(10, PALETTE.tenue, false)).setWordWrapWidth(W - 178));
      if (spot === 'radar' && lvl > 0) items.push(this.link('‹ registro', x0 + W - 16, y0 + 90, () => this.openPanel(spot, '')));
      // Laboratorio e Arsenale: da qui all'albero della ricerca (armamenti e tecnologie)
      if (spot === 'laboratorio' || spot === 'arsenale') {
        items.push(this.link(spot === 'arsenale' ? 'albero: armamenti ›' : 'albero della ricerca ›', x0 + W - 16, y0 + 90, () => this.openTree(spot === 'arsenale' ? 'armamenti' : 'esercito')));
        if (spot === 'laboratorio') items.push(this.link(`archivio della Caduta (${loreFragments(this.profile).length}/${loreTotal}) ›`, x0 + 16, y0 + H - 132, () => this.openPanel('laboratorio', 'archivio'), 0));
      }
      // tutti i livelli: fatti, il prossimo evidenziato, quelli dopo
      T.levels.forEach((txt, i) => {
        const mark = i < lvl ? '✓' : i === lvl ? '▶' : '·';
        const col = i < lvl ? PALETTE.ocra : i === lvl ? INK : PALETTE.tenue;
        const step = T.levels.length > 3 ? 18 : 22, ly = y0 + 112 + i * step;
        if (i === lvl) items.push(this.add.rectangle(x0 + 12, ly - 3, W - 24, step, 0x1b2634).setOrigin(0));
        items.push(this.add.text(x0 + 18, ly, `${mark} LIV. ${i + 1}  ${txt}`, textStyle(T.levels.length > 3 ? 10 : 11, col, i === lvl)).setWordWrapWidth(W - 36));
      });
      const c = this.profile.construction;
      const next = nextLevel(this.profile, spot);
      if (c && c.id === spot) {
        const total = BALANCE.camp.buildings[spot][lvl].timeSec * 1000;
        const pct = 1 - (c.until - now) / total;
        items.push(this.add.rectangle(x0 + 16, y0 + H - 70, W - 32, 10, 0x1d3a31).setOrigin(0));
        items.push(this.add.rectangle(x0 + 16, y0 + H - 70, (W - 32) * Phaser.Math.Clamp(pct, 0, 1), 10, PALETTE.ruggine).setOrigin(0));
        // accanto al tempo: finisci subito pagando metallo (come al Mercato)
        const half = (W - 32 - 8) / 2, cost = rushCost(c.until, now), ok = this.profile.stash.metallo >= cost;
        items.push(this.btn(`IN COSTRUZIONE · ${fmtTime(c.until - now)}`, x0 + 16, y0 + H - 54, half, false, () => {}, 12));
        items.push(this.btn(`FINISCI ORA · ${cost} METALLO`, x0 + 24 + half, y0 + H - 54, half, ok, () => {
          if (!rush(this.profile, 'construction', Date.now())) return;
          analytics.design(['mercato', 'accelera', 'construction'], cost);
          saveProfile(this.profile);
          this.closePanel();
          this.settleAll(false);
        }, 12));
      } else if (next) {
        this.costChips(items, next.cost, next.timeSec, x0 + 16, y0 + H - 110, W - 32);
        const block = buildBlock(this.profile, spot);
        const why = { busy: 'cantiere occupato', cost: 'risorse insufficienti', comando: `serve il centro di comando liv. ${lvl}`, max: '' } as const;
        const lbl = block ? why[block] : `${lvl ? 'MIGLIORA' : 'COSTRUISCI'} · ${fmtTime(next.timeSec * 1000)}`;
        items.push(this.btn(lbl.toUpperCase(), x0 + 16, y0 + H - 54, W - 32, !block, () => {
          if (!startBuild(this.profile, spot, Date.now())) return;
          analytics.design(['accampamento', 'costruisci', spot], lvl + 1);
          analytics.resources('sink', next.cost, 'edificio', spot);
          saveProfile(this.profile);
          this.closePanel();
          this.redrawSpot(spot as BuildingId);
          this.updateStash();
          this.toast(`Cantiere aperto: ${T.name}`, PALETTE.carta);
        }));
      } else {
        items.push(this.add.text(x0 + 16, y0 + H - 44, 'Livello massimo. Il resto lo fa la fantasia.', textStyle(12, PALETTE.ocra)));
      }
    }
    this.panel = this.add.container(0, 0, items).setDepth(40);
    if (fresh) {
      this.panel.setAlpha(0).setY(8);
      this.tweens.add({ targets: this.panel, alpha: 1, y: 0, duration: 170, ease: 'Quad.easeOut' });
    }
  }

  /** Mercato: scambi tra risorse, rifornimenti per la prossima campagna, lavori finiti subito. Solo risorse di gioco. */
  private fillShop(items: Phaser.GameObjects.GameObject[], x0: number, y0: number, W: number, _H: number) {
    const p = this.profile, P = this.portrait, S = BALANCE.shop, now = Date.now();
    const done = (msg: string) => {
      saveProfile(p);
      this.updateStash();
      buzz(12);
      this.toast(msg, PALETTE.radioattivo);
      this.openPanel('mercato');
    };
    items.push(this.add.text(x0 + 16, y0 + 10, shopText.title, textStyle(18, INK)),
      this.add.text(x0 + 16, y0 + 44, shopText.desc, textStyle(10, PALETTE.tenue, false)).setWordWrapWidth(W - 32));
    const g = this.add.graphics(); // icone: aggiunte in fondo, sopra le schede
    const tile = (x: number, y: number, w: number, h: number, ok: boolean, on: boolean, run: () => void) => {
      const r = this.add.rectangle(x, y, w, h, on ? 0x1b2634 : PALETTE.pannello).setOrigin(0).setStrokeStyle(1, on ? PALETTE.ocra : ok ? PALETTE.linea : 0x2a3340)
        .setAlpha(ok || on ? 1 : 0.55);
      if (ok) r.setInteractive({ useHandCursor: true }).on('pointerup', run);
      items.push(r);
    };
    // scambio: 50 di una → 30 di un'altra
    let y = y0 + (P ? 82 : 70);
    items.push(this.add.text(x0 + 16, y, shopText.trade, textStyle(10, PALETTE.ocra)));
    y += 18;
    const pairs = RESOURCES.flatMap((a) => RESOURCES.filter((b) => b !== a).map((b) => [a, b] as const));
    const cols = P ? 2 : 3, tw = (W - 32 - (cols - 1) * 6) / cols, th = 36;
    pairs.forEach(([a, b], k) => {
      const x = x0 + 16 + (k % cols) * (tw + 6), ty = y + Math.floor(k / cols) * (th + 6);
      const ok = p.stash[a] >= S.trade.give;
      tile(x, ty, tw, th, ok, false, () => { if (trade(p, a, b)) done(`SCAMBIO · −${S.trade.give} ${RESOURCE_INFO[a].name.toLowerCase()} · +${S.trade.get} ${RESOURCE_INFO[b].name.toLowerCase()}`); });
      drawResourceIcon(g, a, x + 18, ty + th / 2, 7);
      items.push(this.add.text(x + 30, ty + th / 2, String(S.trade.give), textStyle(13, ok ? INK : PALETTE.tenue)).setOrigin(0, 0.5),
        this.add.text(x + tw / 2, ty + th / 2, '→', textStyle(13, PALETTE.ocra)).setOrigin(0.5));
      drawResourceIcon(g, b, x + tw - 44, ty + th / 2, 7);
      items.push(this.add.text(x + tw - 32, ty + th / 2, String(S.trade.get), textStyle(13, ok ? PALETTE.ok : PALETTE.tenue)).setOrigin(0, 0.5));
    });
    y += Math.ceil(pairs.length / cols) * (th + 6) + 10;
    // rifornimenti: uno per tipo, valgono per la prossima campagna
    items.push(this.add.text(x0 + 16, y, shopText.supplies, textStyle(10, PALETTE.ocra)));
    y += 18;
    const scols = P ? 1 : 3, sw = (W - 32 - (scols - 1) * 6) / scols, sh = P ? 44 : 64;
    SUPPLIES.forEach((k, i) => {
      const T = shopText.items[k], D = S.supplies[k], own = (p.supplies ?? []).includes(k), ok = !own && canAfford(p.stash, D.cost);
      const x = x0 + 16 + (i % scols) * (sw + 6), ty = y + Math.floor(i / scols) * (sh + 6);
      tile(x, ty, sw, sh, ok, own, () => { if (buySupply(p, k)) done(`${T.name.toUpperCase()} · pronti per la prossima campagna`); });
      items.push(this.add.text(x + 10, ty + 6, T.name.toUpperCase(), textStyle(11, own ? PALETTE.ocra : INK)),
        this.add.text(x + 10, ty + 22, T.desc, textStyle(9, PALETTE.tenue, false)));
      if (own) items.push(this.add.text(x + sw - 10, ty + (P ? sh / 2 : sh - 12), '✓ PRONTO', textStyle(10, PALETTE.ocra)).setOrigin(1, 0.5));
      else this.costRow(g, items, D.cost, P ? x + sw - 150 : x + 10, P ? ty + sh / 2 : ty + sh - 12, p.stash);
    });
    y += Math.ceil(SUPPLIES.length / scols) * (sh + 6) + 10;
    // lavori in corso: finiti subito pagando metallo
    items.push(this.add.text(x0 + 16, y, shopText.rush, textStyle(10, PALETTE.ocra)));
    y += 18;
    const jobs = [
      { what: 'construction' as const, job: p.construction, name: p.construction ? `${buildingText[p.construction.id].name} liv. ${p.buildings[p.construction.id] + 1}` : '' },
      { what: 'research' as const, job: p.research, name: p.research ? techInfo(p.research.id).name : '' },
    ].filter((j) => j.job && j.job.until > now);
    if (!jobs.length) items.push(this.add.text(x0 + 16, y + 4, 'Nessun cantiere o ricerca in corso.', textStyle(11, PALETTE.tenue, false)));
    jobs.forEach((j, i) => {
      const cost = rushCost(j.job!.until, now), ok = p.stash.metallo >= cost;
      items.push(this.btn(`FINISCI ORA: ${j.name.toUpperCase()} · ${cost} METALLO`, x0 + 16, y + i * 46, W - 32, ok, () => {
        if (!rush(p, j.what, Date.now())) return;
        analytics.design(['mercato', 'accelera', j.what], cost);
        saveProfile(p);
        this.closePanel();
        this.settleAll(false);
      }, 12));
    });
    items.push(g);
  }

  /** Costo del prossimo livello a schede: icona, quanto serve, quanto hai (barra verde se basta, rossa se no) e tempo. */
  private costChips(items: Phaser.GameObjects.GameObject[], cost: Bag, timeSec: number, x: number, y: number, w: number) {
    const have = this.profile.stash, rs = RESOURCES.filter((r) => cost[r] > 0), n = rs.length + 1, cw = (w - (n - 1) * 6) / n, ch = 48;
    const g = this.add.graphics();
    items.push(g);
    rs.forEach((r, i) => {
      const cx = x + i * (cw + 6), ok = have[r] >= cost[r];
      g.fillStyle(PALETTE.pannello, 1).fillRect(cx, y, cw, ch).lineStyle(1, ok ? PALETTE.linea : PALETTE.ko, 1).strokeRect(cx, y, cw, ch);
      drawResourceIcon(g, r, cx + 16, y + 18, 8);
      g.fillStyle(PALETTE.linea, 1).fillRect(cx + 8, y + ch - 9, cw - 16, 4);
      g.fillStyle(ok ? PALETTE.radioattivo : PALETTE.ko, 1).fillRect(cx + 8, y + ch - 9, (cw - 16) * Math.min(1, have[r] / cost[r]), 4);
      items.push(this.add.text(cx + 30, y + 18, String(cost[r]), textStyle(15, ok ? INK : PALETTE.ko)).setOrigin(0, 0.5),
        this.add.text(cx + cw - 8, y + 18, `hai ${have[r]}`, textStyle(9, PALETTE.tenue, false)).setOrigin(1, 0.5));
    });
    const tx = x + rs.length * (cw + 6);
    g.fillStyle(PALETTE.pannello, 1).fillRect(tx, y, cw, ch).lineStyle(1, PALETTE.linea, 1).strokeRect(tx, y, cw, ch);
    items.push(this.add.text(tx + cw / 2, y + 14, 'TEMPO', textStyle(9, PALETTE.tenue)).setOrigin(0.5),
      this.add.text(tx + cw / 2, y + 31, fmtTime(timeSec * 1000), textStyle(14, INK)).setOrigin(0.5));
  }

  /** Costo in fila: icona, quanto serve (rosso se non basta). */
  private costRow(g: Phaser.GameObjects.Graphics, items: Phaser.GameObjects.GameObject[], cost: Bag, x: number, y: number, have: Bag) {
    let cx = x;
    for (const r of RESOURCES) {
      if (!cost[r]) continue;
      drawResourceIcon(g, r, cx + 6, y, 6);
      const t = this.add.text(cx + 15, y, String(cost[r]), textStyle(11, have[r] < cost[r] ? PALETTE.ko : INK)).setOrigin(0, 0.5);
      items.push(t);
      cx += t.width + 26;
    }
  }

  /** Modalità test: sblocca tutto per provare armi, civiltà e ricerche senza aspettare; si torna indietro azzerando il profilo. */
  private fillTest(items: Phaser.GameObjects.GameObject[], x0: number, y0: number, W: number, H: number) {
    const p = this.profile;
    items.push(this.add.text(x0 + 16, y0 + 10, 'MODALITÀ TEST', textStyle(16, PALETTE.allerta)));
    const txt = p.test
      ? 'ATTIVA. Postazioni al massimo, tutte le ricerche, risorse piene, civiltà sbloccate, cantieri e spedizioni istantanei, +1000 truppe a inizio campagna, abilità con ricarica ridotta.'
      : 'Sblocca subito tutto: postazioni al massimo (tutte le armi e le abilità), tutte le ricerche, risorse piene, civiltà sbloccate, cantieri e spedizioni istantanei, +1000 truppe a inizio campagna.\n\nServe solo per provare il gioco: i progressi veri si perdono.';
    items.push(this.add.text(x0 + 16, y0 + 46, txt, textStyle(11, PALETTE.carta, false)).setWordWrapWidth(W - 32).setLineSpacing(4));
    const restart = () => this.scene.restart();
    if (!p.test) {
      items.push(this.btn('ATTIVA LA MODALITÀ TEST', x0 + 16, y0 + H - 104, W - 32, true, () => {
        enableTestMode(p);
        saveProfile(p);
        analytics.design(['test', 'attiva']);
        restart();
      }, 13));
    }
    items.push(this.btn(p.test ? 'ESCI: AZZERA IL PROFILO' : 'AZZERA IL PROFILO', x0 + 16, y0 + H - 56, W - 32, true, () => {
      this.profile = resetProfile();
      restart();
    }, 13));
  }

  /** Testo cliccabile piccolo (link nei pannelli). */
  private link(label: string, x: number, y: number, onClick: () => void, origin = 1) {
    return this.add.text(x, y, label, textStyle(11, PALETTE.ocra)).setOrigin(origin, 0).setInteractive({ useHandCursor: true }).on('pointerup', onClick);
  }

  /** Preparazione della campagna: vista principale (potenza, mazzo, durata, avvia) e due sotto-viste. Max 6 scelte per vista. */
  private fillPrep(items: Phaser.GameObjects.GameObject[], x0: number, y0: number, W: number, H: number) {
    const p = this.profile;
    const civ = activeCiv(p);
    const back = () => items.push(this.link('‹ indietro', x0 + W - 40, y0 + 12, () => this.openPanel('gioca', '')));
    if (this.panelMode === 'civ') {
      items.push(this.add.text(x0 + 16, y0 + 10, 'SCEGLI LA POTENZA', textStyle(16, INK)));
      back();
      // quattro sistemi politici: immagine (Figma), insegna, nome e forma di governo
      const P = this.portrait, cols = P ? 2 : 4, gap = 8;
      const cw = (W - 32 - (cols - 1) * gap) / cols, ch = P ? 150 : 190, y = y0 + 42;
      CIV_IDS.forEach((id, k) => {
        const st = CIV_STYLE[id], info = civInfo(id), open = civUnlocked(p, id), sel = id === civ;
        const cx = x0 + 16 + (k % cols) * (cw + gap), cy = y + Math.floor(k / cols) * (ch + gap);
        const img = coverImage(this, civImage(id), cx, cy, cw, ch, 0.4).setTint(open ? 0xffffff : 0x555a66).setAlpha(open ? 1 : 0.6);
        const shade = fade(this, cx, cy + ch * 0.35, cw, ch * 0.65, PALETTE.inchiostro, 0, 0.95);
        const frame = this.add.rectangle(cx, cy, cw, ch).setOrigin(0).setStrokeStyle(sel ? 2 : 1, sel ? PALETTE.ocra : PALETTE.linea)
          .setInteractive({ useHandCursor: open });
        frame.on('pointerup', () => {
          if (!open) return this.toast(`${info.name}: ${info.unlock}`, PALETTE.carta);
          p.civ = id;
          saveProfile(p);
          this.openPanel('gioca', 'civ');
        });
        const g = this.add.graphics();
        drawPatch(g, cx + 20, cy + 20, 13, st.fill, st.symbol);
        items.push(img, shade, frame, g,
          this.add.text(cx + 10, cy + ch - 38, info.name.toUpperCase(), textStyle(16, open ? PALETTE.carta : PALETTE.tenue)),
          this.add.text(cx + 10, cy + ch - 16, open ? info.regime : `🔒 ${info.unlock}`, textStyle(9, open ? PALETTE.ocra : PALETTE.tenue, false)));
        if (sel) items.push(this.add.rectangle(cx, cy, cw, 3, PALETTE.ocra).setOrigin(0));
      });
      // scheda della potenza scelta: classe dirigente, dottrina, storia, regole
      const info = civInfo(civ), unit = unitInfo(info.unit);
      const ty = y + (P ? 2 : 1) * (ch + gap) + 4;
      items.push(this.add.text(x0 + 16, ty, info.classe.toUpperCase(), textStyle(11, PALETTE.ocra)).setWordWrapWidth(W - 32),
        this.add.text(x0 + W - 16, ty, `${info.dottrina.toUpperCase()} · «${info.motto}»`, textStyle(9, PALETTE.tenue, false)).setOrigin(1, 0)
          .setVisible(!P));
      items.push(this.add.text(x0 + 16, ty + 20, info.lore, textStyle(11, PALETTE.carta, false)).setWordWrapWidth(W - 32).setLineSpacing(3));
      items.push(this.add.text(x0 + 16, ty + (P ? 82 : 62), [`▸ ${info.bonus}`, `▸ Unità unica: ${unit.name} (Arsenale liv. ${BALANCE.camp.arsenaleUnique})`,
        `▸ Edificio unico: ${info.building} — ${info.buildingText}`].join('\n'), textStyle(10, PALETTE.tenue, false)).setWordWrapWidth(W - 32).setLineSpacing(3));
      return;
    }
    if (this.panelMode === 'fronti') return this.fillFronts(items, x0, y0, W, H);
    if (this.panelMode === 'mazzo') {
      const open = unlockedUnits(p, civ), deck = deckOf(p, civ), max = BALANCE.units.deckSize;
      items.push(this.add.text(x0 + 16, y0 + 12, `MAZZO  ${deck.length}/${max}`, textStyle(16, INK)));
      back();
      items.push(this.add.text(x0 + 16, y0 + 36, `Porti in campagna ${max} truppe tra quelle sbloccate dall'Arsenale. Tocca per scambiarle.`, textStyle(9, PALETTE.carta, false)).setWordWrapWidth(W - 32));
      const cols = Math.min(5, Math.max(4, open.length)), cw = (W - 32 - (cols - 1) * 6) / cols;
      open.forEach((t, k) => {
        const cx = x0 + 16 + (k % cols) * (cw + 6), cy = y0 + 60 + Math.floor(k / cols) * 82;
        const sel = deck.includes(t), u = unitInfo(t);
        const tile = this.add.rectangle(cx, cy, cw, 76, sel ? 0x1b2634 : PALETTE.inchiostro).setOrigin(0).setStrokeStyle(sel ? 2 : 1, sel ? PALETTE.ocra : PALETTE.linea)
          .setInteractive({ useHandCursor: true });
        tile.on('pointerup', () => {
          let next = (p.deck ?? []).length ? deckOf(p, civ) : [...deck];
          if (next.includes(t)) { if (next.length > 1) next = next.filter((x) => x !== t); }
          else if (next.length < max) next.push(t);
          else next = [...next.slice(1), t]; // pieno: esce la prima
          p.deck = next;
          saveProfile(p);
          this.openPanel('gioca', 'mazzo');
        });
        const g = this.add.graphics();
        drawUnitIcon(g, t, cx + cw / 2, cy + 22, 12, sel ? PALETTE.ocra : PALETTE.carta);
        items.push(tile, g, this.add.text(cx + cw / 2, cy + 42, u.short, textStyle(9, PALETTE.carta)).setOrigin(0.5, 0),
          this.add.text(cx + cw / 2, cy + 58, `${BALANCE.units[t].cost} truppe`, textStyle(8, PALETTE.ocra, false)).setOrigin(0.5, 0));
      });
      if (unlockedAbilities(p).length) {
        items.push(this.add.text(x0 + 16, y0 + H - 24, '+ abilità: Ricognizione aerea · Bombardamento (sempre con te)', textStyle(9, PALETTE.radioattivo, false)));
      }
      return;
    }
    // vista principale: in testa la potenza scelta (tocca per cambiarla), poi fronte, mazzo, durata
    const info = civInfo(civ), st = CIV_STYLE[civ];
    const bh = this.portrait ? 120 : 104;
    const banner = coverImage(this, civImage(civ), x0 + 1, y0 + 1, W - 2, bh, 0.4).setTint(0xc8d6e6);
    items.push(banner, fade(this, x0 + 1, y0 + 1, W - 2, bh, PALETTE.inchiostro, 0.35, 0.97));
    items.push(this.add.text(x0 + 16, y0 + 10, 'PREPARA LA CAMPAGNA', textStyle(11, PALETTE.ocra)).setLetterSpacing(2));
    const bp = this.add.graphics();
    drawPatch(bp, x0 + 34, y0 + bh - 34, 16, st.fill, st.symbol);
    items.push(bp, this.add.text(x0 + 60, y0 + bh - 56, info.name.toUpperCase(), textStyle(24, INK)),
      this.add.text(x0 + 60, y0 + bh - 22, `${info.regime} · ${info.bonus}`, textStyle(9, PALETTE.carta, false)).setWordWrapWidth(W - 90));
    if (civChoice(p)) {
      const hit = this.add.rectangle(x0 + 1, y0 + 1, W - 2, bh, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true });
      hit.on('pointerup', () => this.openPanel('gioca', 'civ'));
      items.push(hit, this.add.text(x0 + W - 16, y0 + 10, 'cambia potenza ›', textStyle(10, PALETTE.ocra)).setOrigin(1, 0));
    }
    const row = (y: number, h: number, label: string, onClick: (() => void) | null, warn = false) => {
      const r = this.add.rectangle(x0 + 16, y, W - 32, h, PALETTE.inchiostro).setOrigin(0).setStrokeStyle(1, warn ? PALETTE.ko : onClick ? PALETTE.ocra : PALETTE.linea);
      if (onClick) r.setInteractive({ useHandCursor: true }).on('pointerup', onClick);
      items.push(r, this.add.text(x0 + 24, y + 6, label, textStyle(9, warn ? PALETTE.ko : PALETTE.ocra)));
      if (onClick) items.push(this.add.text(x0 + W - 24, y + h / 2, '›', textStyle(18, PALETTE.ocra)).setOrigin(1, 0.5));
    };
    let y = y0 + bh + 8;
    // fronte: difficoltà e potenza consigliata (alla Clash)
    const fi = activeFront(p), F = BALANCE.fronts[fi], power = playerPower(p), weak = power < F.power;
    row(y, 52, `FRONTE ${ROMAN[fi]} · ${'★'.repeat(fi + 1)}${'☆'.repeat(BALANCE.fronts.length - fi - 1)}${weak ? ' · NEMICI PIÙ FORTI DI TE' : ''}`, () => this.openPanel('gioca', 'fronti'), weak);
    items.push(this.add.text(x0 + 24, y + 24, `${F.name} · potenza consigliata ${F.power} (tua ${power}) · bottino ×${F.lootMult}`,
      textStyle(10, weak ? PALETTE.ko : PALETTE.carta, false)).setWordWrapWidth(W - 70));
    y += 58;
    const deck = deckOf(p, civ);
    row(y, 52, `MAZZO · ${deck.length}/${BALANCE.units.deckSize}`, unlockedUnits(p, civ).length > 1 ? () => this.openPanel('gioca', 'mazzo') : null);
    const dg = this.add.graphics();
    const dx = Math.min(110, (W - 80) / Math.max(1, deck.length));
    deck.forEach((t, k) => drawUnitIcon(dg, t, x0 + 34 + k * dx, y + 34, 8, PALETTE.carta));
    items.push(dg);
    deck.forEach((t, k) => items.push(this.add.text(x0 + 48 + k * dx, y + 34, unitInfo(t).short, textStyle(9, PALETTE.carta, false)).setOrigin(0, 0.5)));
    y += 58;
    // nemici del fronte: le loro armi (se ne hanno che tu non hai, servono potenziamenti)
    const eg = this.add.graphics();
    const mine = unlockedUnits(p, civ);
    items.push(this.add.text(x0 + 16, y + 2, 'ARMI NEMICHE', textStyle(9, PALETTE.tenue)));
    F.aiUnits.forEach((t, k) => drawUnitIcon(eg, t, x0 + 112 + k * 28, y + 10, 7, mine.includes(t) ? PALETTE.tenue : PALETTE.ko));
    items.push(eg);
    // puntata (alla poker): risorse del Deposito in gioco; più punti, più rende il guadagno; uscire prima costa
    y += 22;
    const K = stakeIndex(p), SK = BALANCE.stake, fee = Math.round(runOptions(p).exitFee * 100);
    // rischi della puntata (in verticale senza la ritirata, che la chiede comunque il tasto ESCI)
    const risks = [`non vinci −${Math.round(SK.lossShare * 100)}%`, ...(this.portrait ? [] : [`ritirata −${fee}%`]), `eliminato −${Math.round(runOptions(p).eliminatedLoss * 100)}%`];
    row(y, 52, `PUNTATA ×${String(SK.mult[K]).replace('.', ',')} · ${risks.join(' · ')}`, null);
    const cw = Math.min(70, (W - 64) / SK.options.length - 6);
    SK.options.forEach((v, k) => {
      const ok = canStake(p, k), cx = x0 + 24 + k * (cw + 6), cy = y + 22;
      const chip = this.add.rectangle(cx, cy, cw, 24, k === K ? PALETTE.ocra : PALETTE.pannello).setOrigin(0)
        .setStrokeStyle(1, ok ? PALETTE.ocra : PALETTE.linea);
      if (ok) chip.setInteractive({ useHandCursor: true }).on('pointerup', () => { p.stake = k; saveProfile(p); this.openPanel('gioca', ''); });
      items.push(chip, this.add.text(cx + cw / 2, cy + 12, v ? String(v) : 'NIENTE', textStyle(11, k === K ? PALETTE.inchiostro : ok ? PALETTE.carta : PALETTE.tenue)).setOrigin(0.5));
    });
    y += 36;
    // briefing del fronte: storia, obiettivi, cosa fanno i nemici
    const mm = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`;
    const brief = [
      (frontText as { brief: string }[])[fi]?.brief ?? '',
      'OBIETTIVI · più province di tutti allo scadere, o fai cadere i tre imperi rivali.',
      `INTEL · tregua ${mm(F.graceMs)} · prima offensiva a ${mm(F.offensiveFirstMs)} · bunker nemici ${F.aiBunkers} · crescita nemica ×${String(F.aiGrowthMult).replace('.', ',')}`,
    ].join('\n');
    const limit = y0 + H - 64 - (this.portrait ? 48 : 0);
    const bt = this.add.text(x0 + 16, y + 28, brief, textStyle(10, PALETTE.carta, false)).setWordWrapWidth(W - 32).setLineSpacing(4);
    for (let parts = brief.split('\n'); bt.y + bt.height > limit && parts.length > 1;) bt.setText((parts = parts.slice(0, -1)).join('\n')); // se non c'è posto, meno righe
    if (bt.y + bt.height > limit) bt.setVisible(false);
    items.push(bt);
    // durata + avvia
    const stack = this.portrait;
    const bw = stack ? W - 32 : (W - 32 - 10) / 2, by = y0 + H - 56;
    if (campaignChoice(p)) {
      const C = BALANCE.campaigns[p.campaign];
      const lbl = `DURATA ${CAMPAIGN_NAME[p.campaign]} · ${Math.round(C.durationMs / 60000)} MIN · ×${C.lootMult} ▸`;
      items.push(this.btn(lbl, x0 + 16, stack ? by - 48 : by, bw, true, () => {
        p.campaign = CAMPAIGNS[(CAMPAIGNS.indexOf(p.campaign) + 1) % CAMPAIGNS.length];
        saveProfile(p);
        this.openPanel('gioca', '');
      }, 12));
    }
    items.push(this.btn('AVVIA LA CAMPAGNA ▶', stack ? x0 + 16 : x0 + 16 + bw + 10, by, bw, true, () => {
      analytics.design(['campagna', 'avvia', `${civ}:${p.campaign}:${fi}`]);
      this.scene.start('Load', { next: 'Run', data: { seed: randomSeed() } });
    }, 13));
  }

  /** Fronti: la scala della difficoltà (alla Clash). Si sblocca il successivo vincendo; potenza consigliata contro la tua. */
  private fillFronts(items: Phaser.GameObjects.GameObject[], x0: number, y0: number, W: number, H: number) {
    const p = this.profile;
    const power = playerPower(p), max = p.frontMax ?? 0, sel = activeFront(p);
    items.push(this.add.text(x0 + 16, y0 + 10, 'FRONTI', textStyle(16, INK)),
      this.add.text(x0 + 110, y0 + 16, `la tua potenza: ${power}`, textStyle(11, PALETTE.ocra)),
      this.link('‹ indietro', x0 + W - 40, y0 + 12, () => this.openPanel('gioca', '')));
    const rh = Math.min(46, (H - 52) / BALANCE.fronts.length - 4);
    BALANCE.fronts.forEach((F, k) => {
      const y = y0 + 44 + k * (rh + 4), open = k <= max, weak = power < F.power;
      const r = this.add.rectangle(x0 + 16, y, W - 32, rh, k === sel ? 0x1b2634 : PALETTE.inchiostro).setOrigin(0)
        .setStrokeStyle(k === sel ? 2 : 1, k === sel ? PALETTE.ocra : PALETTE.linea).setAlpha(open ? 1 : 0.5).setInteractive({ useHandCursor: open });
      r.on('pointerup', () => {
        if (!open) return this.toast(`Vinci il fronte ${ROMAN[k - 1]} per sbloccarlo`, PALETTE.carta);
        p.front = k;
        saveProfile(p);
        this.openPanel('gioca', '');
      });
      items.push(r,
        this.add.text(x0 + 30, y + rh / 2, ROMAN[k], textStyle(18, open ? PALETTE.ocra : PALETTE.tenue)).setOrigin(0.5),
        this.add.text(x0 + 52, y + 5, `${F.name.toUpperCase()}  ${'★'.repeat(k + 1)}`, textStyle(11, open ? PALETTE.carta : PALETTE.tenue)),
        this.add.text(x0 + 52, y + rh - 5, open ? `potenza ${F.power}${weak ? ' · troppo forti per te' : ''} · bottino ×${F.lootMult}` : '🔒 vinci il fronte precedente',
          textStyle(9, open && weak ? PALETTE.ko : PALETTE.tenue, false)).setOrigin(0, 1));
    });
  }

  /** Archivio della Caduta: i frammenti di lore sbloccati dal ramo "La Caduta" dell'albero. */
  private fillLab(items: Phaser.GameObjects.GameObject[], x0: number, y0: number, W: number, H: number) {
    const frags = loreFragments(this.profile);
    items.push(this.add.text(x0 + 16, y0 + 12, `ARCHIVIO DELLA CADUTA  ${frags.length}/${loreTotal}`, textStyle(16, INK)));
    const txt = frags.length ? frags.map((f, i) => `${i + 1}. ${f.name.toUpperCase()}\n${f.lore}`).join('\n\n')
      : 'Nessun frammento. Le ricerche del ramo "La Caduta" riempiono questo archivio.';
    items.push(this.add.text(x0 + 16, y0 + 44, txt, textStyle(10, PALETTE.carta, false)).setWordWrapWidth(W - 32).setLineSpacing(3));
    items.push(this.link('albero della ricerca ›', x0 + 16, y0 + H - 26, () => this.openTree('caduta'), 0));
  }

  /** Albero della ricerca a tutto schermo, sopra l'HQ. */
  openTree(focus: string) {
    this.closePanel();
    this.scene.launch('Tree', { focus });
    this.scene.bringToTop('Tree');
  }

  /** Nome del comandante: si vede sulla mappa, nell'elenco delle potenze e nei rapporti. */
  private editName(first = false) {
    const p = this.profile;
    askName(first ? 'COME TI CHIAMI, COMANDANTE?' : 'NOME DEL COMANDANTE', p.name ?? '', (name) => {
      p.nameAsked = true;
      if (name) p.name = name;
      saveProfile(p);
      if (name) this.scene.restart();
    });
  }

  /** Dall'albero: apre la scheda di una postazione (per migliorarla). */
  openBuilding(id: BuildingId) {
    this.openPanel(id, 'build');
  }

  /** Dopo l'albero: scorta e moduli aggiornati. */
  refreshAfterTree() {
    this.updateStash();
    for (const id of BUILDINGS) this.redrawSpot(id);
    this.refreshNav();
  }


  /** Sala Radar: registro delle campagne (record locali; la classifica online è fuori dall'MVP). */
  private fillRadar(items: Phaser.GameObjects.GameObject[], x0: number, y0: number, W: number, _H: number) {
    const p = this.profile;
    items.push(this.add.text(x0 + 16, y0 + 12, `SALA RADAR  liv. ${p.buildings.radar}/${maxLvl('radar')}`, textStyle(16, INK)));
    items.push(this.link('migliora ›', x0 + W - 40, y0 + 12, () => this.openPanel('radar', 'build')));
    const byCiv = CIV_IDS.map((c) => {
      const h = p.history.filter((r) => r.civ === c);
      return h.length ? `${civInfo(c).name} ${h.filter((r) => r.outcome === 'victory').length}/${h.length}` : '';
    }).filter(Boolean).join(' · ');
    const best = p.history.reduce((m, r) => Math.max(m, r.tiles), p.bestTiles);
    items.push(this.add.text(x0 + 16, y0 + 40, `CAMPAGNE ${p.runs} · VITTORIE ${p.wins} · TERRITORIO MAX ${best}\n${byCiv || 'Nessuna campagna registrata.'}`,
      textStyle(11, PALETTE.carta)).setLineSpacing(4).setWordWrapWidth(W - 32));
    const OUT: Record<string, string> = { victory: 'VITTORIA', retreat: 'RITIRATA', eliminated: 'ELIMINATO', timeout: 'FINE TEMPO' };
    const rows = p.history.slice(0, 7).map((r) => {
      const d = new Date(r.at);
      const when = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return `${when}  ${civInfo(r.civ).name.toUpperCase().padEnd(12)} ${CAMPAIGN_NAME[r.campaign].padEnd(8)} ${(OUT[r.outcome] ?? r.outcome).padEnd(9)} ${String(r.tiles).padStart(4)} caselle  ${fmtTime(r.timeMs)}`;
    });
    items.push(this.add.text(x0 + 16, y0 + 92, rows.length ? rows.join('\n') : '', textStyle(9, PALETTE.ocra, false)).setLineSpacing(5));
  }

  /** Riga di risorse (costo o bottino); in rosso quelle che non bastano. */
  private bagRow(bag: Bag, x: number, y: number, have?: Bag) {
    const c = this.add.container(0, 0);
    const g = this.add.graphics();
    c.add(g);
    let cx = x;
    for (const r of RESOURCES) {
      if (!bag[r]) continue;
      drawResourceIcon(g, r, cx + 6, y + 8, 6);
      const short = have && have[r] < bag[r];
      const t = this.add.text(cx + 16, y + 8, `${bag[r]} ${RESOURCE_INFO[r].name.toLowerCase()}`, textStyle(12, short ? PALETTE.ko : INK)).setOrigin(0, 0.5);
      c.add(t);
      cx += t.width + 30;
    }
    if (have && !canAfford(have, bag)) c.add(this.add.text(x, y + 20, 'servono altre run', textStyle(10, PALETTE.ko, false)));
    return c;
  }

  private btn(label: string, x: number, y: number, w: number, enabled: boolean, onClick: () => void, size = 16) {
    const b = new Button(this, label, w, 40, () => enabled && onClick(), size);
    b.setPosition(x, y).setAlpha(enabled ? 1 : 0.45);
    return b;
  }

  private toast(msg: string, color: number) {
    const { width } = view(this);
    this.lastToast?.destroy();
    const ty = this.portrait ? 160 : 90;
    const t = (this.lastToast = this.add.text(width / 2, ty, msg, textStyle(15, color)).setOrigin(0.5).setAlign('center')
      .setWordWrapWidth(width - 40)
      .setBackgroundColor(hex(PALETTE.inchiostro)).setPadding(12, 8, 12, 8).setDepth(60).setAlpha(0));
    this.tweens.add({ targets: t, alpha: 1, y: ty - 10, duration: 220 });
    this.tweens.add({ targets: t, alpha: 0, delay: 2800, duration: 400, onComplete: () => t.destroy() });
  }
}
