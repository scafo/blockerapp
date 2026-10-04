import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { PALETTE, hex } from '../config/palette';
import buildingText from '../data/buildings.json';
import {
  BUILDINGS, EXPEDITIONS, activeCiv, buildBlock, campaignChoice, canAfford, civChoice, collectExpedition, deckOf, expeditionCost, unlockedUnits,
  enableTestMode, expeditionTimeSec, fmtTime, nextLevel, settle, startBuild, startExpedition, tents,
} from '../game/camp';
import { CIV_IDS, civInfo, civUnlocked } from '../game/civs';
import { CIV_STYLE } from '../game/factions';
import { BRANCHES, loreFragments, loreTotal, nextInBranches, researchBlock, settleResearch, startResearch, techInfo, type TechId } from '../game/tech';
import { unitInfo } from '../game/units';
import type { CampaignId } from '../config/balance';
import { RESOURCES, RESOURCE_INFO, type Bag } from '../game/resources';
import { randomSeed } from '../map/rng';
import { loadProfile, resetProfile, saveProfile, type BuildingId, type ExpeditionKind, type Profile } from '../save/storage';
import { analytics } from '../analytics/analytics';
import { FPS_KEY, fpsEnabled } from '../ui/debug';
import { Button } from '../ui/Button';
import { drawResourceIcon } from '../ui/resourceIcons';
import { textStyle } from '../ui/style';
import { uiCamera, view } from '../ui/screen';
import { drawPatch } from '../ui/symbols';
import { drawUnitIcon } from '../ui/unitIcons';

const PAD = 12;
const maxLvl = (id: BuildingId) => BALANCE.camp.buildings[id].length;
const SKY = 0x010604; // l'HQ è una planimetria su uno schermo di comando al buio
const INK = 0x9fe8c8; // tratto luminoso (testi) sul fondo scuro

type Spot = BuildingId | 'spedizione' | 'gioca' | 'test'; // 'gioca' = preparazione della campagna, 'test' = modalità test
type MapSpot = BuildingId | 'spedizione'; // le postazioni sulla planimetria
const CAMPAIGNS: CampaignId[] = ['breve', 'standard', 'lunga'];
const CAMPAIGN_NAME: Record<CampaignId, string> = { breve: 'BREVE', standard: 'STANDARD', lunga: 'LUNGA' };

/** Accampamento (home): piccolo all'inizio, cresce con edifici, tende e spedizioni. */
export class CampScene extends Phaser.Scene {
  private profile!: Profile;
  private k = 1; // scala del disegno rispetto a 844×390
  private plan = { x: 0, y: 0, w: 0, h: 0 }; // area della planimetria
  private spotPos = {} as Record<MapSpot, { x: number; y: number }>;
  private clock: Phaser.GameObjects.Text | null = null;
  private portrait = false;
  private spots = new Map<Spot, { x: number; y: number; g: Phaser.GameObjects.Graphics; deco: Phaser.GameObjects.GameObject[]; label: Phaser.GameObjects.Text }>();
  private stashTexts: Phaser.GameObjects.Text[] = [];
  private timerTexts = new Map<Spot, Phaser.GameObjects.Text>();
  private panel: Phaser.GameObjects.Container | null = null;
  private panelSpot: Spot | null = null;
  private panelMode = ''; // laboratorio: '' ricerche · 'archivio' · 'build'; radar: '' registro · 'build'
  private refreshAcc = 0;
  private panelKey = '';
  private lastToast: Phaser.GameObjects.Text | null = null;
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
    super('Camp');
  }

  create() {
    uiCamera(this);
    this.profile = loadProfile();
    this.spots = new Map();
    this.timerTexts = new Map();
    this.panel = null;
    this.panelSpot = null;
    const { width, height } = view(this);
    // verticale: edifici su due file (dietro sull'orizzonte, davanti in basso), campo al centro
    this.portrait = height > width;

    // planimetria: area utile tra la scorta in alto e i comandi in basso
    this.plan = this.portrait ? { x: PAD, y: 150, w: width - 2 * PAD, h: height - 150 - 150 } : { x: PAD, y: 84, w: width - 2 * PAD, h: height - 84 - 76 };
    this.k = this.portrait ? Math.min(this.plan.w / 400, 1.2) : Math.min(this.plan.w / 820, this.plan.h / 230, 1.6);
    const frac: Record<MapSpot, [number, number]> = this.portrait
      ? { comando: [0.5, 0.42], laboratorio: [0.27, 0.13], radar: [0.73, 0.13], arsenale: [0.27, 0.7], deposito: [0.73, 0.7], spedizione: [0.5, 0.93] }
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
    this.scale.once('resize', () => this.scene.restart());
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
    if (spot === 'gioca') return `gioca|${this.panelMode}|${p.civ}|${p.campaign}|${(p.deck ?? []).join(',')}`;
    if (spot === 'laboratorio' && this.panelMode !== 'build' && p.buildings.laboratorio > 0) {
      return `lab|${this.panelMode}|${p.techs.join(',')}|${p.research?.id ?? ''}|${RESOURCES.map((r) => p.stash[r]).join(',')}${p.research ? ':timer' : ''}`;
    }
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
    RESOURCES.forEach((r, i) => this.stashTexts[i]?.setText(String(this.profile.stash[r])));
  }

  // ---------- disegno ----------

  /** Fondo: schermo di comando al buio, griglia da planimetria, intestazione con l'ora. */
  private drawBackdrop() {
    const { width, height } = view(this);
    this.cameras.main.setBackgroundColor(SKY);
    const g = this.add.graphics();
    for (let x = 0; x < width; x += 20) g.lineStyle(1, PALETTE.ocra, x % 100 === 0 ? 0.1 : 0.04).lineBetween(x, 0, x, height);
    for (let y = 0; y < height; y += 20) g.lineStyle(1, PALETTE.ocra, y % 100 === 0 ? 0.1 : 0.04).lineBetween(0, y, width, y);
    // riga di scansione che scende lenta, come un monitor che si aggiorna
    const sweep = this.add.rectangle(0, 0, width, 40, PALETTE.ocra, 0.035).setOrigin(0);
    this.tweens.add({ targets: sweep, y: { from: -40, to: height }, duration: 6000, repeat: -1 });
    const scan = this.add.tileSprite(0, 0, width, height, this.scanTexture()).setOrigin(0).setAlpha(0.15); // dietro a moduli e scritte
    void scan;
  }

  private scanTexture(): string {
    if (!this.textures.exists('scan')) {
      const sg = this.make.graphics({}, false).fillStyle(0x000000, 1).fillRect(0, 2, 4, 1);
      sg.generateTexture('scan', 4, 3);
      sg.destroy();
    }
    return 'scan';
  }

  /** Planimetria: recinto tratteggiato, corridoi dal Centro di Comando a ogni postazione, alloggi lungo il recinto. */
  private drawCenter() {
    const g = this.add.graphics();
    const b = this.plan, c = this.spotPos.comando;
    // recinto a otto lati, tratteggiato
    const cut = 30 * this.k;
    const pts = [[b.x + cut, b.y], [b.x + b.w - cut, b.y], [b.x + b.w, b.y + cut], [b.x + b.w, b.y + b.h - cut], [b.x + b.w - cut, b.y + b.h], [b.x + cut, b.y + b.h], [b.x, b.y + b.h - cut], [b.x, b.y + cut]];
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x1 - x0, y1 - y0), n = Math.floor(len / 10);
      for (let k = 0; k < n; k += 2) g.lineStyle(1, PALETTE.ocra, 0.35).lineBetween(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, x0 + ((x1 - x0) * (k + 1)) / n, y0 + ((y1 - y0) * (k + 1)) / n);
    }
    // corridoi (doppia linea)
    for (const [id, p] of Object.entries(this.spotPos)) {
      if (id === 'comando') continue;
      const ang = Math.atan2(p.y - c.y, p.x - c.x), nx = -Math.sin(ang) * 4, ny = Math.cos(ang) * 4;
      g.lineStyle(1, PALETTE.ocra, 0.22).lineBetween(c.x + nx, c.y + ny, p.x + nx, p.y + ny).lineBetween(c.x - nx, c.y - ny, p.x - nx, p.y - ny);
    }
    // alloggi: uno ogni tenda, lungo il lato basso del recinto
    const n = tents(this.profile);
    // in verticale vanno in alto a sinistra (in basso c'è il convoglio)
    const ay = this.portrait ? b.y + cut + 14 : b.y + b.h - 18 * this.k;
    for (let i = 0; i < n; i++) {
      const x = b.x + cut + 12 + i * 16 * this.k;
      g.lineStyle(1, PALETTE.ocra, 0.6).strokeRect(x, ay, 11 * this.k, 8 * this.k);
    }
    this.add.text(b.x + cut + 12, ay - 14, `ALLOGGI ${n} · CAMPAGNE ${this.profile.runs}`, textStyle(10, PALETTE.ocra, false)).setAlpha(0.9);
    // intestazione con l'ora (aggiornata in update)
    this.clock = this.add.text(b.x + b.w / 2, b.y - 14, '', textStyle(10, PALETTE.ocra, false)).setOrigin(0.5, 0.5);
  }

  private makeSpot(id: MapSpot, x: number, y: number) {
    const k = this.k, big = id === 'comando';
    const w = (big ? 168 : 132) * k, h = (big ? 84 : 66) * k;
    const g = this.add.graphics();
    const label = this.add.text(x - w / 2 + 8, y - h / 2 + 6, id === 'spedizione' ? 'ESTRAZIONE' : buildingText[id].name.toUpperCase(), textStyle(10, PALETTE.carta, false));
    const timer = this.add.text(x, y + h / 2 + 4, '', textStyle(10, PALETTE.allerta)).setOrigin(0.5, 0);
    this.timerTexts.set(id, timer);
    this.spots.set(id, { x, y, g, deco: [], label });
    const hit = this.add.rectangle(x, y, w, h, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
    hit.on('pointerup', () => this.openPanel(id));
  }

  /** Modulo della planimetria: contorno ad angoli tagliati se costruito, tratteggio se lotto libero, tratteggio obliquo se in cantiere. */
  private redrawSpot(id: MapSpot) {
    const spot = this.spots.get(id)!;
    spot.deco.forEach((d) => d.destroy());
    spot.deco = [];
    const g = spot.g.clear();
    const k = this.k, x = spot.x, y = spot.y, big = id === 'comando';
    const w = (big ? 168 : 132) * k, h = (big ? 84 : 66) * k, l = x - w / 2, t = y - h / 2, cut = 10 * k;
    const lvl = id === 'spedizione' ? 1 : this.profile.buildings[id];
    const building = id !== 'spedizione' && this.profile.construction?.id === id;
    const built = lvl > 0 || building;
    const outline = [{ x: l + cut, y: t }, { x: l + w, y: t }, { x: l + w, y: t + h - cut }, { x: l + w - cut, y: t + h }, { x: l, y: t + h }, { x: l, y: t + cut }];
    if (built) {
      g.fillStyle(0x03140c, 0.92).fillPoints(outline, true);
      g.lineStyle(1.5, PALETTE.ocra, 1).strokePoints(outline, true, true);
      g.lineStyle(1, PALETTE.ocra, 0.35).lineBetween(l + 6, t + 20 * k, l + w - 6, t + 20 * k);
      spot.label.setAlpha(1);
    } else {
      for (let i = 0; i < outline.length; i++) {
        const p0 = outline[i], p1 = outline[(i + 1) % outline.length];
        const n = Math.max(2, Math.floor(Math.hypot(p1.x - p0.x, p1.y - p0.y) / 6));
        for (let s = 0; s < n; s += 2) g.lineStyle(1, PALETTE.ocra, 0.45).lineBetween(p0.x + ((p1.x - p0.x) * s) / n, p0.y + ((p1.y - p0.y) * s) / n, p0.x + ((p1.x - p0.x) * (s + 1)) / n, p0.y + ((p1.y - p0.y) * (s + 1)) / n);
      }
      spot.label.setAlpha(0.55);
      spot.deco.push(this.add.text(x, y + 8 * k, '[ + ] LOTTO LIBERO', textStyle(9, PALETTE.ocra, false)).setOrigin(0.5).setAlpha(0.7));
    }
    if (building) {
      g.lineStyle(1, PALETTE.allerta, 0.35);
      for (let i = -h; i < w; i += 9 * k) g.lineBetween(l + Math.max(0, i), t + Math.max(0, -i), l + Math.min(w, i + h), t + Math.min(h, h - (i + h - w > 0 ? i + h - w : 0)));
    }
    if (built && id !== 'spedizione') this.drawModule(spot, g, id, x, y + 6 * k, w, h);
    if (id === 'spedizione') this.drawConvoy(spot, g, x, y + 6 * k, w);
    // livello: quadratini in basso a destra
    if (id !== 'spedizione') {
      const n = maxLvl(id);
      for (let i = 0; i < n; i++) {
        const px = l + w - 10 * k - (n - 1 - i) * 7 * k, py = t + h - 9 * k;
        g.fillStyle(i < lvl ? PALETTE.ocra : 0x0f2a1d, 1).fillRect(px - 2.5 * k, py - 2.5 * k, 5 * k, 5 * k);
      }
    }
  }

  /** Simboli da planimetria dentro ogni modulo (+ animazioni: radar che spazza, antenna che lampeggia, laboratorio acceso). */
  private drawModule(spot: { deco: Phaser.GameObjects.GameObject[] }, g: Phaser.GameObjects.Graphics, id: BuildingId, x: number, y: number, w: number, _h: number) {
    const k = this.k, C = PALETTE.ocra;
    if (id === 'comando') {
      g.lineStyle(1, C, 0.8).strokeCircle(x, y + 4 * k, 18 * k).strokeCircle(x, y + 4 * k, 10 * k);
      g.lineBetween(x - 26 * k, y + 4 * k, x + 26 * k, y + 4 * k).lineBetween(x, y - 18 * k, x, y + 26 * k);
      const light = this.add.circle(x, y + 4 * k, 3 * k, PALETTE.allerta);
      this.tweens.add({ targets: light, alpha: 0.15, duration: 700, yoyo: true, repeat: -1 });
      spot.deco.push(light);
      const civ = activeCiv(this.profile), st = CIV_STYLE[civ];
      const pg = this.add.graphics();
      drawPatch(pg, x - w / 2 + 22 * k, y + 8 * k, 13 * k, st.fill, st.symbol);
      spot.deco.push(pg);
    } else if (id === 'arsenale') {
      for (let i = 0; i < 4; i++) g.lineStyle(1, C, 0.5).strokeRect(x - 50 * k + i * 16 * k, y - 4 * k, 12 * k, 22 * k); // rastrelliere
      drawUnitIcon(g, 'corazzati', x + 34 * k, y + 8 * k, 13 * k, C);
    } else if (id === 'laboratorio') {
      g.lineStyle(1, C, 0.9).strokeEllipse(x, y + 6 * k, 44 * k, 14 * k).strokeEllipse(x, y + 6 * k, 14 * k, 34 * k);
      const core = this.add.circle(x, y + 6 * k, 4 * k, PALETTE.radioattivo);
      this.tweens.add({ targets: core, scale: { from: 0.7, to: 1.4 }, alpha: { from: 1, to: 0.4 }, duration: 900, yoyo: true, repeat: -1 });
      spot.deco.push(core);
    } else if (id === 'radar') {
      const r = 22 * k;
      g.lineStyle(1, C, 0.7).strokeCircle(x, y + 4 * k, r).strokeCircle(x, y + 4 * k, r * 0.55);
      const sweep = this.add.graphics({ x, y: y + 4 * k });
      sweep.fillStyle(C, 0.25).slice(0, 0, r, -0.5, 0, false).fillPath();
      sweep.lineStyle(1.5, C, 1).lineBetween(0, 0, r, 0);
      this.tweens.add({ targets: sweep, rotation: Math.PI * 2, duration: 2600, repeat: -1 });
      const blip = this.add.circle(x + r * 0.5, y - r * 0.2, 2 * k, PALETTE.allerta);
      this.tweens.add({ targets: blip, alpha: 0, duration: 1300, yoyo: true, repeat: -1 });
      spot.deco.push(sweep, blip);
    } else if (id === 'deposito') {
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
        const cx = x - 30 * k + i * 22 * k, cy = y - 4 * k + j * 14 * k;
        g.lineStyle(1, C, 0.7).strokeRect(cx, cy, 18 * k, 11 * k).lineBetween(cx, cy, cx + 18 * k, cy + 11 * k);
      }
    }
  }

  /** Convoglio delle squadre di estrazione: in garage, oppure fuori (rotta tratteggiata verso il bordo). */
  private drawConvoy(spot: { deco: Phaser.GameObjects.GameObject[] }, g: Phaser.GameObjects.Graphics, x: number, y: number, w: number) {
    const k = this.k;
    const e = this.profile.expedition;
    const away = e && e.until > Date.now();
    if (away) {
      for (let i = 0; i < 6; i++) g.lineStyle(1, PALETTE.allerta, 0.6).lineBetween(x - w / 2 + 10 + i * 18 * k, y + 6 * k, x - w / 2 + 18 + i * 18 * k, y + 6 * k);
      const dot = this.add.circle(x - w / 2 + 10, y + 6 * k, 3 * k, PALETTE.allerta);
      this.tweens.add({ targets: dot, x: x + w / 2 - 10, duration: 2400, repeat: -1 });
      spot.deco.push(dot, this.add.text(x, y - 10 * k, 'IN MISSIONE', textStyle(9, PALETTE.allerta, false)).setOrigin(0.5));
      return;
    }
    const ready = e && e.until <= Date.now();
    g.fillStyle(PALETTE.ocra, 1);
    for (const dx of [-26, 4]) {
      drawUnitIcon(g, 'corazzati', x + dx * k, y + 4 * k, 11 * k, ready ? PALETTE.allerta : PALETTE.ocra);
    }
    if (ready) {
      const bang = this.add.text(x + 44 * k, y - 4 * k, '!', textStyle(20, PALETTE.allerta)).setOrigin(0.5);
      this.tweens.add({ targets: bang, alpha: 0.2, duration: 400, yoyo: true, repeat: -1 });
      spot.deco.push(bang);
    }
  }

  // ---------- interfaccia ----------

  private drawHud() {
    const { width, height } = view(this);
    // scorta in alto a sinistra
    const P = this.portrait;
    const panelW = P ? width - 2 * PAD : 240, panelY = P ? PAD + 52 : PAD, step = P ? (panelW - 20) / 3 : 76;
    this.add.rectangle(PAD, panelY, panelW, 56, PALETTE.inchiostro, 0.9).setOrigin(0).setStrokeStyle(2, PALETTE.ocra);
    this.add.text(PAD + 10, panelY + 6, 'SCORTA DELL\'ACCAMPAMENTO', textStyle(10, PALETTE.ocra));
    const ig = this.add.graphics();
    this.stashTexts = RESOURCES.map((r, i) => {
      drawResourceIcon(ig, r, PAD + 18 + i * step, panelY + 36, 6);
      return this.add.text(PAD + 30 + i * step, panelY + 36, '0', textStyle(15, PALETTE.carta)).setOrigin(0, 0.5);
    });
    // titolo in alto a destra
    // 5 tocchi sul titolo = contatore FPS nelle run (per i test sui telefoni economici, anche dentro l'app)
    let taps = 0;
    const titleX = P ? width / 2 : width - PAD, titleO = P ? 0.5 : 1;
    this.add.text(titleX, PAD + 4, 'ASHEN ATLAS', textStyle(20, INK)).setOrigin(titleO, 0)
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
    const testBtn = this.add.text(P ? width - PAD : titleX - 150, P ? PAD + 4 : PAD + 8, p.test ? '[ TEST ATTIVO ]' : '[ TEST ]', textStyle(11, PALETTE.allerta))
      .setOrigin(1, 0).setInteractive({ useHandCursor: true }).on('pointerup', () => this.openPanel('test'));
    void testBtn;
    this.add.text(titleX, PAD + 30, `HQ · ${p.wins} vittorie su ${p.runs} campagne`, textStyle(11, PALETTE.ocra, false)).setOrigin(titleO, 0);
    // GIOCA: in basso a destra (orizzontale) o grande in basso al centro (verticale, sotto il pollice)
    const bw = P ? Math.min(260, width - 2 * PAD) : 150;
    // dopo la run guidata GIOCA apre la preparazione: civiltà e durata della campagna
    const play = new Button(this, 'GIOCA ▶', bw, 56, () => (this.profile.runs === 0 ? this.scene.start('Run', { seed: randomSeed() }) : this.openPanel('gioca')));
    play.setPosition(P ? (width - bw) / 2 : width - PAD - bw, height - PAD - 56).setDepth(20);
    this.tweens.add({ targets: play, scale: 1.04, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.add.text(P ? width / 2 : PAD, P ? height - PAD - 64 : height - PAD, 'Tocca una postazione o il convoglio', textStyle(11, INK, false))
      .setOrigin(P ? 0.5 : 0, 1);
  }

  private closePanel() {
    this.panel?.destroy();
    this.panel = null;
    this.panelSpot = null;
  }

  /** Scheda a destra con dettagli e azione (costruisci / migliora / spedisci / ritira). */
  private openPanel(spot: Spot, mode?: string) {
    this.panel?.destroy();
    if (mode !== undefined || spot !== this.panelSpot) this.panelMode = mode ?? '';
    this.panelSpot = spot;
    this.panelKey = this.panelState(spot, Date.now());
    const { width, height } = view(this);
    const wide = spot === 'gioca' || ((spot === 'laboratorio' || spot === 'radar') && this.panelMode !== 'build' && this.profile.buildings[spot] > 0);
    const W = Math.min(wide ? 540 : 330, width - 24), H = Math.min(wide ? (this.portrait ? 440 : 350) : 290, height - 2 * PAD);
    const x0 = width / 2 - W / 2, y0 = (height - H) / 2;
    const items: Phaser.GameObjects.GameObject[] = [];
    const shade = this.add.rectangle(0, 0, width, height, PALETTE.inchiostro, 0.6).setOrigin(0).setInteractive();
    shade.on('pointerup', () => this.closePanel());
    items.push(shade, this.add.rectangle(x0, y0, W, H, 0x020a06).setOrigin(0).setStrokeStyle(1, PALETTE.ocra).setInteractive());
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
    } else if (spot === 'gioca') {
      this.fillPrep(items, x0, y0, W, H);
    } else if (spot === 'laboratorio' && this.panelMode !== 'build' && this.profile.buildings.laboratorio > 0) {
      this.fillLab(items, x0, y0, W, H, now);
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
      items.push(this.add.text(x0 + 16, y0 + 12, `${T.name.toUpperCase()}  liv. ${lvl}/${maxLvl(spot)}`, textStyle(T.name.length > 14 ? 15 : 18, INK)));
      if ((spot === 'laboratorio' || spot === 'radar') && lvl > 0) items.push(this.link('‹ indietro', x0 + W - 40, y0 + 10, () => this.openPanel(spot, '')));
      items.push(this.add.text(x0 + 16, y0 + 40, T.desc, textStyle(12, INK, false)).setWordWrapWidth(W - 32));
      T.levels.forEach((txt, i) => {
        const mark = i < lvl ? '✓' : i === lvl ? '→' : '·';
        const col = i < lvl ? PALETTE.ocra : i === lvl ? INK : 0x8fb5a6;
        const step = T.levels.length > 3 ? 16 : 20;
        items.push(this.add.text(x0 + 16, y0 + 84 + i * step, `${mark} liv. ${i + 1}: ${txt}`, textStyle(T.levels.length > 3 ? 10 : 11, col, i === lvl)).setWordWrapWidth(W - 32));
      });
      const c = this.profile.construction;
      const next = nextLevel(this.profile, spot);
      if (c && c.id === spot) {
        const total = BALANCE.camp.buildings[spot][lvl].timeSec * 1000;
        const pct = 1 - (c.until - now) / total;
        items.push(this.add.rectangle(x0 + 16, y0 + H - 70, W - 32, 10, 0x1d3a31).setOrigin(0));
        items.push(this.add.rectangle(x0 + 16, y0 + H - 70, (W - 32) * Phaser.Math.Clamp(pct, 0, 1), 10, PALETTE.ruggine).setOrigin(0));
        items.push(this.btn(`IN COSTRUZIONE · ${fmtTime(c.until - now)}`, x0 + 16, y0 + H - 54, W - 32, false, () => {}));
      } else if (next) {
        items.push(this.bagRow(next.cost, x0 + 16, y0 + H - 84, this.profile.stash));
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
      items.push(this.add.text(x0 + 16, y0 + 12, 'SCEGLI LA POTENZA', textStyle(16, INK)));
      back();
      const cw = (W - 32 - 18) / 4, y = y0 + 44;
      CIV_IDS.forEach((id, k) => {
        const st = CIV_STYLE[id], info = civInfo(id), open = civUnlocked(p, id), sel = id === civ;
        const cx = x0 + 16 + k * (cw + 6);
        const card = this.add.rectangle(cx, y, cw, 96, sel ? 0x0f2a26 : PALETTE.inchiostro).setOrigin(0)
          .setStrokeStyle(sel ? 2 : 1, sel ? PALETTE.ocra : 0x2a6655).setAlpha(open ? 1 : 0.5).setInteractive({ useHandCursor: open });
        card.on('pointerup', () => {
          if (!open) return this.toast(`${info.name}: ${info.unlock}`, PALETTE.carta);
          p.civ = id;
          saveProfile(p);
          this.openPanel('gioca', 'civ');
        });
        const g = this.add.graphics();
        drawPatch(g, cx + cw / 2, y + 30, 20, st.fill, st.symbol);
        const nm = cw < 110 && info.name.length > 8 ? `${info.name.slice(0, 7)}.` : info.name;
        items.push(card, g, this.add.text(cx + cw / 2, y + 56, nm.toUpperCase(), textStyle(cw < 110 ? 9 : 11, open ? PALETTE.carta : 0x8fb5a6)).setOrigin(0.5, 0),
          this.add.text(cx + cw / 2, y + 72, open ? info.motto : `🔒 ${info.unlock}`, textStyle(8, open ? PALETTE.ocra : 0x8fb5a6, false)).setOrigin(0.5, 0).setAlign('center').setWordWrapWidth(cw - 8));
      });
      const info = civInfo(civ), unit = unitInfo(info.unit);
      items.push(this.add.text(x0 + 16, y + 106, [`Bonus: ${info.bonus}`, `Unità unica: ${unit.name} (Arsenale liv. ${BALANCE.camp.arsenaleUnique}) — ${unit.desc}`,
        `Edificio unico: ${info.building} — ${info.buildingText}`].join('\n'), textStyle(10, PALETTE.carta, false)).setWordWrapWidth(W - 32).setLineSpacing(4));
      return;
    }
    if (this.panelMode === 'mazzo') {
      const open = unlockedUnits(p, civ), deck = deckOf(p, civ), max = BALANCE.units.deckSize;
      items.push(this.add.text(x0 + 16, y0 + 12, `MAZZO  ${deck.length}/${max}`, textStyle(16, INK)));
      back();
      items.push(this.add.text(x0 + 16, y0 + 36, `Porti in campagna ${max} truppe tra quelle sbloccate dall'Arsenale. Tocca per scambiarle.`, textStyle(9, PALETTE.carta, false)).setWordWrapWidth(W - 32));
      const cols = Math.min(5, Math.max(4, open.length)), cw = (W - 32 - (cols - 1) * 6) / cols;
      open.forEach((t, k) => {
        const cx = x0 + 16 + (k % cols) * (cw + 6), cy = y0 + 60 + Math.floor(k / cols) * 82;
        const sel = deck.includes(t), u = unitInfo(t);
        const tile = this.add.rectangle(cx, cy, cw, 76, sel ? 0x0f2a26 : PALETTE.inchiostro).setOrigin(0).setStrokeStyle(sel ? 2 : 1, sel ? PALETTE.ocra : 0x2a6655)
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
      if (p.buildings.arsenale >= BALANCE.camp.arsenaleAbilities) {
        items.push(this.add.text(x0 + 16, y0 + H - 24, '+ abilità: Ricognizione aerea · Bombardamento (sempre con te)', textStyle(9, PALETTE.radioattivo, false)));
      }
      return;
    }
    // vista principale
    items.push(this.add.text(x0 + 16, y0 + 12, 'PREPARA LA CAMPAGNA', textStyle(18, INK)));
    const info = civInfo(civ), st = CIV_STYLE[civ];
    const row = (y: number, label: string, onClick: (() => void) | null) => {
      const r = this.add.rectangle(x0 + 16, y, W - 32, 52, PALETTE.inchiostro).setOrigin(0).setStrokeStyle(1, onClick ? PALETTE.ocra : 0x2a6655);
      if (onClick) r.setInteractive({ useHandCursor: true }).on('pointerup', onClick);
      items.push(r, this.add.text(x0 + 24, y + 6, label, textStyle(9, PALETTE.ocra)));
      if (onClick) items.push(this.add.text(x0 + W - 24, y + 26, '›', textStyle(18, PALETTE.ocra)).setOrigin(1, 0.5));
    };
    let y = y0 + 44;
    row(y, civChoice(p) ? 'POTENZA' : `POTENZA · le altre dopo ${BALANCE.progression.civChoiceAfterRuns} campagne`, civChoice(p) ? () => this.openPanel('gioca', 'civ') : null);
    const pg = this.add.graphics();
    drawPatch(pg, x0 + 40, y + 32, 13, st.fill, st.symbol);
    items.push(pg, this.add.text(x0 + 60, y + 24, `${info.name.toUpperCase()} — ${info.bonus}`, textStyle(10, PALETTE.carta, false)).setWordWrapWidth(W - 100));
    y += 60;
    const deck = deckOf(p, civ);
    row(y, `MAZZO · ${deck.length}/${BALANCE.units.deckSize}`, unlockedUnits(p, civ).length > 1 ? () => this.openPanel('gioca', 'mazzo') : null);
    const dg = this.add.graphics();
    deck.forEach((t, k) => drawUnitIcon(dg, t, x0 + 40 + k * 60, y + 32, 8, PALETTE.carta));
    items.push(dg);
    deck.forEach((t, k) => items.push(this.add.text(x0 + 52 + k * 60, y + 27, unitInfo(t).short.slice(0, 7), textStyle(8, PALETTE.carta, false))));
    // durata + avvia
    const stack = this.portrait;
    const bw = stack ? W - 32 : (W - 32 - 10) / 2, by = y0 + H - 56;
    if (campaignChoice(p)) {
      const C = BALANCE.campaigns[p.campaign];
      const lbl = `DURATA ${CAMPAIGN_NAME[p.campaign]} · ${Math.round(C.stormMs / 60000)} MIN · ×${C.lootMult} ▸`;
      items.push(this.btn(lbl, x0 + 16, stack ? by - 48 : by, bw, true, () => {
        p.campaign = CAMPAIGNS[(CAMPAIGNS.indexOf(p.campaign) + 1) % CAMPAIGNS.length];
        saveProfile(p);
        this.openPanel('gioca', '');
      }, 12));
      items.push(this.add.text(x0 + 16, (stack ? by - 48 : by) - 16, 'risorse a fine campagna: breve ×0.8 · standard ×1 · lunga ×1.4', textStyle(8, 0x8fb5a6, false)));
    }
    items.push(this.btn('AVVIA LA CAMPAGNA ▶', stack ? x0 + 16 : x0 + 16 + bw + 10, by, bw, true, () => {
      analytics.design(['campagna', 'avvia', `${civ}:${p.campaign}`]);
      this.scene.start('Run', { seed: randomSeed() });
    }, 13));
  }

  /** Laboratorio: la prossima ricerca di ogni ramo + archivio della Caduta. */
  private fillLab(items: Phaser.GameObjects.GameObject[], x0: number, y0: number, W: number, H: number, now: number) {
    const p = this.profile;
    const lvl = p.buildings.laboratorio;
    items.push(this.link('migliora ›', x0 + W - 40, y0 + 12, () => this.openPanel('laboratorio', 'build')));
    if (this.panelMode === 'archivio') {
      const frags = loreFragments(p);
      items.push(this.add.text(x0 + 16, y0 + 12, `ARCHIVIO DELLA CADUTA  ${frags.length}/${loreTotal}`, textStyle(16, INK)));
      const txt = frags.length ? frags.map((f, i) => `${i + 1}. ${f.name.toUpperCase()}\n${f.lore}`).join('\n\n')
        : 'Nessun frammento. Le ricerche del ramo "La Caduta" riempiono questo archivio.';
      items.push(this.add.text(x0 + 16, y0 + 44, txt, textStyle(10, PALETTE.carta, false)).setWordWrapWidth(W - 32).setLineSpacing(3));
      items.push(this.link('‹ ricerche', x0 + 16, y0 + H - 26, () => this.openPanel('laboratorio', ''), 0));
      return;
    }
    items.push(this.add.text(x0 + 16, y0 + 12, `LABORATORIO  liv. ${lvl}/${maxLvl('laboratorio')}`, textStyle(16, INK)));
    const r = p.research;
    items.push(this.add.text(x0 + 16, y0 + 36, r ? `IN RICERCA: ${techInfo(r.id as TechId).name.toUpperCase()} · ${fmtTime(r.until - now)}` : 'Scegli una ricerca. Una alla volta; non blocca le campagne.',
      textStyle(10, r ? PALETTE.radioattivo : PALETTE.carta, !!r)));
    const why = { done: '', nolab: '', lab: 'serve laboratorio di livello più alto', prev: '', busy: 'ricerca in corso', cost: 'risorse insufficienti' } as const;
    nextInBranches(p).forEach((id, k) => {
      const t = techInfo(id), block = researchBlock(p, id), y = y0 + 56 + k * 46;
      const row = this.add.rectangle(x0 + 16, y, W - 32, 42, block ? PALETTE.inchiostro : 0x0f2a26).setOrigin(0)
        .setStrokeStyle(1, block ? 0x2a6655 : PALETTE.ocra).setInteractive({ useHandCursor: !block });
      row.on('pointerup', () => {
        if (block || !startResearch(p, id, Date.now())) return;
        analytics.design(['laboratorio', 'avvia', id]);
        analytics.resources('sink', t.cost, 'ricerca', id);
        saveProfile(p);
        this.updateStash();
        this.openPanel('laboratorio', '');
        this.toast(`Ricerca avviata: ${t.name}`, PALETTE.carta);
      });
      const cost = RESOURCES.filter((q) => t.cost[q]).map((q) => `${t.cost[q]} ${RESOURCE_INFO[q].name.toLowerCase()}`).join(' · ');
      items.push(row,
        this.add.text(x0 + 24, y + 5, `${BRANCHES[t.branch].toUpperCase()} › ${t.name} — ${t.desc}`, textStyle(11, block ? 0x8fb5a6 : PALETTE.carta)).setWordWrapWidth(W - 48),
        this.add.text(x0 + 24, y + 24, block ? why[block] || cost : `${cost} · ${fmtTime(t.timeSec * 1000)}`, textStyle(9, block === 'cost' ? PALETTE.ko : PALETTE.ocra, false)));
    });
    items.push(this.link(`archivio della Caduta (${loreFragments(p).length}/${loreTotal}) ›`, x0 + 16, y0 + H - 26, () => this.openPanel('laboratorio', 'archivio'), 0));
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
    const OUT: Record<string, string> = { victory: 'VITTORIA', retreat: 'RITIRATA', eliminated: 'ELIMINATO', storm: 'TEMPESTA' };
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
