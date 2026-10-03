import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { PALETTE, hex } from '../config/palette';
import buildingText from '../data/buildings.json';
import {
  BUILDINGS, EXPEDITIONS, buildBlock, canAfford, collectExpedition, expeditionCost, fmtTime, nextLevel, settle,
  startBuild, startExpedition, tents,
} from '../game/camp';
import { FACTION_INFO } from '../game/factions';
import { RESOURCES, RESOURCE_INFO, type Bag } from '../game/resources';
import { randomSeed } from '../map/rng';
import { loadProfile, saveProfile, type BuildingId, type ExpeditionKind, type Profile } from '../save/storage';
import { analytics } from '../analytics/analytics';
import { FPS_KEY, fpsEnabled } from '../ui/debug';
import { Button } from '../ui/Button';
import { drawResourceIcon } from '../ui/resourceIcons';
import { textStyle } from '../ui/style';
import { drawSymbol } from '../ui/symbols';

const PAD = 12;
const MAX_LVL = 3;
const SKY = PALETTE.carta;
const GROUND = 0xb98535;
const INK = PALETTE.inchiostro;

type Spot = BuildingId | 'spedizione';

/** Accampamento (home): piccolo all'inizio, cresce con edifici, tende e spedizioni. */
export class CampScene extends Phaser.Scene {
  private profile!: Profile;
  private k = 1; // scala del disegno rispetto a 844×390
  private groundY = 0;
  private spots = new Map<Spot, { x: number; g: Phaser.GameObjects.Graphics; deco: Phaser.GameObjects.GameObject[]; label: Phaser.GameObjects.Text }>();
  private stashTexts: Phaser.GameObjects.Text[] = [];
  private timerTexts = new Map<Spot, Phaser.GameObjects.Text>();
  private panel: Phaser.GameObjects.Container | null = null;
  private panelSpot: Spot | null = null;
  private refreshAcc = 0;
  private panelKey = '';
  private lastToast: Phaser.GameObjects.Text | null = null;
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
    super('Camp');
  }

  create() {
    this.profile = loadProfile();
    this.spots = new Map();
    this.timerTexts = new Map();
    this.panel = null;
    this.panelSpot = null;
    const { width, height } = this.scale;
    this.k = Math.min(width / 844, height / 390);
    this.groundY = height * 0.74;

    this.drawBackdrop();
    this.drawCenter();
    const xs: Record<Spot, number> = { spedizione: 0.1, fucina: 0.3, radio: 0.7, magazzino: 0.88 };
    for (const id of [...BUILDINGS, 'spedizione'] as Spot[]) this.makeSpot(id, width * xs[id]);
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
    const c = this.profile.construction;
    for (const [spot, t] of this.timerTexts) {
      if (spot === 'spedizione') {
        const e = this.profile.expedition;
        t.setText(!e ? '' : e.until <= now ? 'DI RITORNO!' : `torna tra ${fmtTime(e.until - now)}`);
      } else {
        t.setText(c && c.id === spot ? `cantiere ${fmtTime(c.until - now)}` : '');
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
    return `${p.buildings[spot]}|${p.construction?.id ?? ''}|${RESOURCES.map((r) => p.stash[r]).join(',')}${p.construction?.id === spot ? ':timer' : ''}`;
  }

  // ---------- stato ----------

  private settleAll(first: boolean) {
    const done = settle(this.profile, Date.now());
    if (done) {
      saveProfile(this.profile);
      this.redrawSpot(done);
      const spot = this.spots.get(done)!;
      this.cameras.main.flash(250, 239, 227, 200);
      this.burst.setParticleTint(PALETTE.ocra);
      this.burst.explode(30, spot.x, this.groundY - 40 * this.k);
      const lvl = this.profile.buildings[done];
      analytics.design(['accampamento', 'completato', done], lvl);
      this.toast(`${buildingText[done].name.toUpperCase()} LIV. ${lvl} COMPLETATA\n${buildingText[done].levels[lvl - 1]}`, PALETTE.radioattivo);
    }
    if (first) {
      for (const id of [...BUILDINGS, 'spedizione'] as Spot[]) this.redrawSpot(id);
    }
    this.updateStash();
  }

  private updateStash() {
    RESOURCES.forEach((r, i) => this.stashTexts[i]?.setText(String(this.profile.stash[r])));
  }

  // ---------- disegno ----------

  private drawBackdrop() {
    const { width, height } = this.scale;
    const k = this.k;
    this.cameras.main.setBackgroundColor(SKY);
    const g = this.add.graphics();
    g.fillStyle(PALETTE.ocra, 0.28).fillCircle(width * 0.62, this.groundY - 120 * k, 70 * k); // sole velato
    // città in rovina all'orizzonte (sempre uguale: è casa)
    const rng = new Phaser.Math.RandomDataGenerator(['ashen-camp']);
    g.fillStyle(INK, 0.16);
    for (let x = 0; x < width; ) {
      const w = rng.between(18, 46) * k, h = rng.between(20, 90) * k;
      g.fillRect(x, this.groundY - h, w, h);
      if (rng.frac() < 0.5) g.fillTriangle(x, this.groundY - h, x + w, this.groundY - h, x + w * rng.frac(), this.groundY - h - 14 * k);
      x += w + rng.between(2, 14) * k;
    }
    // anomalia lontana: anelli che pulsano sull'orizzonte
    const ax = width * 0.93, ay = this.groundY - 70 * k;
    g.fillStyle(PALETTE.radioattivo, 0.9).fillCircle(ax, ay, 3 * k);
    const ring = this.add.graphics({ x: ax, y: ay }).lineStyle(2, PALETTE.radioattivo, 1).strokeCircle(0, 0, 8 * k);
    this.tweens.add({ targets: ring, scale: { from: 0.5, to: 3 }, alpha: { from: 0.9, to: 0 }, duration: 2200, repeat: -1 });
    // terreno e strada
    g.fillStyle(GROUND, 1).fillRect(0, this.groundY, width, height - this.groundY);
    g.fillStyle(0x9e6f2a, 1).fillRect(0, this.groundY + 26 * k, width, 18 * k);
    g.lineStyle(2, INK, 0.5).lineBetween(0, this.groundY, width, this.groundY);
  }

  /** Fuoco, tende (crescono con le run) e bandiera. */
  private drawCenter() {
    const { width } = this.scale;
    const k = this.k, cx = width * 0.5, y = this.groundY;
    const g = this.add.graphics();
    const n = tents(this.profile);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1, row = Math.floor(i / 2);
      const tx = cx + side * (44 + row * 34) * k, ty = y + (i === n - 1 && n % 2 ? 0 : 0);
      const w = (30 - row * 2) * k, h = (26 - row * 2) * k;
      g.fillStyle(row % 2 ? 0xd9cba8 : PALETTE.carta, 1).fillTriangle(tx - w, ty, tx + w, ty, tx, ty - h);
      g.lineStyle(2, INK, 1).strokeTriangle(tx - w, ty, tx + w, ty, tx, ty - h);
      g.fillStyle(INK, 1).fillTriangle(tx - w * 0.25, ty, tx + w * 0.25, ty, tx, ty - h * 0.55);
    }
    // bandiera della fazione
    const fx = cx - 4 * k;
    g.lineStyle(3 * k, INK, 1).lineBetween(fx, y - 4, fx, y - 86 * k);
    const flag = this.add.graphics({ x: fx, y: y - 84 * k });
    flag.fillStyle(FACTION_INFO[0].fill, 1).fillRect(0, 0, 34 * k, 22 * k);
    drawSymbol(flag, 'stella', 17 * k, 11 * k, 7 * k, PALETTE.carta);
    this.tweens.add({ targets: flag, scaleX: 0.86, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    // fuoco
    g.fillStyle(INK, 1).fillRect(cx + 10 * k, y - 4 * k, 26 * k, 5 * k);
    const fire = this.add.graphics({ x: cx + 23 * k, y: y - 4 * k });
    fire.fillStyle(PALETTE.ruggine, 1).fillTriangle(-10 * k, 0, 10 * k, 0, 0, -24 * k);
    fire.fillStyle(PALETTE.ocra, 1).fillTriangle(-6 * k, 0, 6 * k, 0, 0, -15 * k);
    this.tweens.add({ targets: fire, scaleY: 0.75, scaleX: 1.1, duration: 180, yoyo: true, repeat: -1 });
    this.add.text(cx, y + 54 * k, `${n} tende · ${this.profile.runs} run`, textStyle(11, INK, false)).setOrigin(0.5);
  }

  private makeSpot(id: Spot, x: number) {
    const k = this.k;
    const g = this.add.graphics();
    const name = id === 'spedizione' ? 'SPEDIZIONE' : buildingText[id].name.toUpperCase();
    const label = this.add.text(x, this.groundY + 8 * k, name, textStyle(12, INK)).setOrigin(0.5, 0);
    const timer = this.add.text(x, this.groundY + 50 * k, '', textStyle(11, PALETTE.ruggine)).setOrigin(0.5, 0);
    this.timerTexts.set(id, timer);
    this.spots.set(id, { x, g, deco: [], label });
    const hit = this.add.rectangle(x, this.groundY - 50 * k, 120 * k, 150 * k, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
    hit.on('pointerup', () => this.openPanel(id));
  }

  private redrawSpot(id: Spot) {
    const spot = this.spots.get(id)!;
    spot.deco.forEach((d) => d.destroy());
    spot.deco = [];
    const g = spot.g.clear();
    const k = this.k, x = spot.x, y = this.groundY;
    if (id === 'spedizione') return this.drawTruck(spot, g, x, y);

    const lvl = this.profile.buildings[id];
    const building = this.profile.construction?.id === id;
    if (lvl === 0 && !building) {
      // lotto vuoto: paletti, corda e cartello
      g.lineStyle(3 * k, INK, 1);
      for (const dx of [-40, 40]) g.lineBetween(x + dx * k, y, x + dx * k, y - 18 * k);
      g.lineStyle(1.5, INK, 0.7).lineBetween(x - 40 * k, y - 14 * k, x + 40 * k, y - 14 * k);
      g.fillStyle(0xd9cba8, 1).fillRect(x - 26 * k, y - 46 * k, 52 * k, 20 * k).lineStyle(2, INK, 1).strokeRect(x - 26 * k, y - 46 * k, 52 * k, 20 * k);
      g.lineStyle(3 * k, INK, 1).lineBetween(x, y - 26 * k, x, y);
      spot.deco.push(this.add.text(x, y - 36 * k, 'LOTTO', textStyle(10, INK)).setOrigin(0.5));
    } else {
      this.drawBuilding(spot, g, id, Math.max(lvl, building ? 1 : 0), x, y);
      if (building) {
        // impalcatura sopra il cantiere
        g.lineStyle(2, INK, 0.8);
        for (let i = -2; i <= 2; i++) g.lineBetween(x + i * 18 * k, y, x + (i + 1) * 18 * k, y - 70 * k);
        g.lineBetween(x - 46 * k, y - 35 * k, x + 46 * k, y - 35 * k);
      }
    }
    // pallini di livello
    for (let i = 0; i < MAX_LVL; i++) {
      g.fillStyle(i < lvl ? PALETTE.ruggine : 0xd9cba8, 1).fillCircle(x + (i - 1) * 10 * k, y + 30 * k, 3.5 * k);
      g.lineStyle(1, INK, 1).strokeCircle(x + (i - 1) * 10 * k, y + 30 * k, 3.5 * k);
    }
  }

  private drawBuilding(spot: { deco: Phaser.GameObjects.GameObject[] }, g: Phaser.GameObjects.Graphics, id: BuildingId, lvl: number, x: number, y: number) {
    const k = this.k * (0.85 + lvl * 0.12);
    if (id === 'fucina') {
      g.fillStyle(PALETTE.ruggine, 1).fillRect(x - 40 * k, y - 44 * k, 80 * k, 44 * k);
      g.fillStyle(INK, 1).fillTriangle(x - 46 * k, y - 44 * k, x + 46 * k, y - 44 * k, x, y - 66 * k);
      g.fillStyle(PALETTE.ocra, 1).fillRect(x - 12 * k, y - 26 * k, 24 * k, 26 * k); // porta del forno
      for (let c = 0; c < Math.min(lvl, 2); c++) {
        const chx = x + (18 + c * 14) * k;
        g.fillStyle(INK, 1).fillRect(chx, y - 82 * k, 8 * k, 30 * k);
        const smoke = this.add.circle(chx + 4 * k, y - 86 * k, 6 * k, 0x8a7f70, 0.7);
        this.tweens.add({ targets: smoke, y: y - 130 * k, alpha: 0, scale: 2, duration: 1800, repeat: -1, delay: c * 600 });
        spot.deco.push(smoke);
      }
      if (lvl >= 3) g.fillStyle(PALETTE.carta, 1).fillRect(x - 34 * k, y - 38 * k, 14 * k, 8 * k); // insegna
    } else if (id === 'radio') {
      g.fillStyle(0xd9cba8, 1).fillRect(x - 30 * k, y - 36 * k, 60 * k, 36 * k).lineStyle(2, INK, 1).strokeRect(x - 30 * k, y - 36 * k, 60 * k, 36 * k);
      g.fillStyle(INK, 1).fillRect(x - 34 * k, y - 42 * k, 68 * k, 7 * k);
      const mastH = (50 + lvl * 22) * k;
      g.lineStyle(3, INK, 1).lineBetween(x + 14 * k, y - 42 * k, x + 14 * k, y - 42 * k - mastH);
      for (let i = 1; i <= lvl + 1; i++) {
        const yy = y - 42 * k - (mastH * i) / (lvl + 2);
        g.lineBetween(x + 4 * k, yy, x + 24 * k, yy);
      }
      if (lvl >= 2) g.lineStyle(2, INK, 1).lineBetween(x - 18 * k, y - 42 * k, x - 18 * k, y - 80 * k);
      const light = this.add.circle(x + 14 * k, y - 42 * k - mastH, 4 * k, PALETTE.radioattivo);
      this.tweens.add({ targets: light, alpha: 0.15, duration: 600, yoyo: true, repeat: -1 });
      spot.deco.push(light);
    } else {
      const crates = lvl <= 1 ? 3 : 0;
      if (crates) {
        for (let i = 0; i < crates; i++) {
          const cx = x + (i === 2 ? 0 : i ? 14 : -14) * k, cy = y - (i === 2 ? 44 : 22) * k;
          g.fillStyle(PALETTE.ocra, 1).fillRect(cx - 14 * k, cy, 28 * k, 22 * k).lineStyle(2, INK, 1).strokeRect(cx - 14 * k, cy, 28 * k, 22 * k);
          g.lineBetween(cx - 14 * k, cy, cx + 14 * k, cy + 22 * k);
        }
      } else {
        g.fillStyle(0x7a6a58, 1).fillRect(x - 46 * k, y - 46 * k, 92 * k, 46 * k);
        g.fillStyle(INK, 1).fillRect(x - 50 * k, y - 54 * k, 100 * k, 9 * k);
        g.lineStyle(1.5, INK, 0.6);
        for (let i = -40; i <= 40; i += 10) g.lineBetween(x + i * k, y - 46 * k, x + i * k, y);
        g.fillStyle(INK, 1).fillRect(x - 14 * k, y - 30 * k, 28 * k, 30 * k);
        if (lvl >= 3) {
          g.lineStyle(2, INK, 1);
          for (let i = -60; i <= 60; i += 12) g.lineBetween(x + i * k, y, x + i * k, y - 14 * k);
          g.lineBetween(x - 60 * k, y - 10 * k, x + 60 * k, y - 10 * k);
        }
      }
    }
  }

  private drawTruck(spot: { deco: Phaser.GameObjects.GameObject[] }, g: Phaser.GameObjects.Graphics, x: number, y: number) {
    const k = this.k;
    const e = this.profile.expedition;
    const away = e && e.until > Date.now();
    if (away) {
      g.lineStyle(2, INK, 0.4);
      for (let i = 0; i < 4; i++) g.lineBetween(x - 50 * k + i * 26 * k, y + 34 * k, x - 36 * k + i * 26 * k, y + 34 * k);
      return;
    }
    g.fillStyle(0x5b6b4a, 1).fillRect(x - 40 * k, y - 34 * k, 50 * k, 26 * k); // cassone
    g.fillStyle(0x4a5a3a, 1).fillRect(x + 10 * k, y - 28 * k, 26 * k, 20 * k); // cabina
    g.fillStyle(PALETTE.carta, 1).fillRect(x + 18 * k, y - 25 * k, 12 * k, 8 * k);
    g.fillStyle(INK, 1).fillCircle(x - 26 * k, y - 6 * k, 8 * k).fillCircle(x + 22 * k, y - 6 * k, 8 * k);
    if (e) {
      // di ritorno: casse sul cassone e un "!" che salta
      g.fillStyle(PALETTE.ocra, 1).fillRect(x - 36 * k, y - 50 * k, 18 * k, 16 * k).fillRect(x - 16 * k, y - 48 * k, 16 * k, 14 * k);
      const bang = this.add.text(x, y - 82 * k, '!', textStyle(26, PALETTE.ruggine)).setOrigin(0.5);
      this.tweens.add({ targets: bang, y: y - 92 * k, duration: 400, yoyo: true, repeat: -1 });
      spot.deco.push(bang);
    }
  }

  // ---------- interfaccia ----------

  private drawHud() {
    const { width, height } = this.scale;
    // scorta in alto a sinistra
    const panelW = 240;
    this.add.rectangle(PAD, PAD, panelW, 56, INK, 0.9).setOrigin(0).setStrokeStyle(2, PALETTE.ocra);
    this.add.text(PAD + 10, PAD + 6, 'SCORTA DELL\'ACCAMPAMENTO', textStyle(10, PALETTE.ocra));
    const ig = this.add.graphics();
    this.stashTexts = RESOURCES.map((r, i) => {
      drawResourceIcon(ig, r, PAD + 18 + i * 76, PAD + 36, 6);
      return this.add.text(PAD + 30 + i * 76, PAD + 36, '0', textStyle(15, PALETTE.carta)).setOrigin(0, 0.5);
    });
    // titolo in alto a destra
    // 5 tocchi sul titolo = contatore FPS nelle run (per i test sui telefoni economici, anche dentro l'app)
    let taps = 0;
    this.add.text(width - PAD, PAD + 4, 'ASHEN ATLAS', textStyle(20, INK)).setOrigin(1, 0)
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
    this.add.text(width - PAD, PAD + 30, `accampamento · ${p.wins} vittorie su ${p.runs} run`, textStyle(11, PALETTE.ruggine, false)).setOrigin(1, 0);
    // GIOCA in basso a destra
    const play = new Button(this, 'GIOCA ▶', 150, 54, () => this.scene.start('Run', { seed: randomSeed() }));
    play.setPosition(width - PAD - 150, height - PAD - 54).setDepth(20);
    this.tweens.add({ targets: play, scale: 1.05, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.add.text(PAD, height - PAD, 'Tocca un edificio o il camion', textStyle(11, INK, false)).setOrigin(0, 1);
  }

  private closePanel() {
    this.panel?.destroy();
    this.panel = null;
    this.panelSpot = null;
  }

  /** Scheda a destra con dettagli e azione (costruisci / migliora / spedisci / ritira). */
  private openPanel(spot: Spot) {
    this.panel?.destroy();
    this.panelSpot = spot;
    this.panelKey = this.panelState(spot, Date.now());
    const { width, height } = this.scale;
    const W = 330, H = Math.min(290, height - 2 * PAD);
    const x0 = width / 2 - W / 2, y0 = (height - H) / 2;
    const items: Phaser.GameObjects.GameObject[] = [];
    const shade = this.add.rectangle(0, 0, width, height, INK, 0.35).setOrigin(0).setInteractive();
    shade.on('pointerup', () => this.closePanel());
    items.push(shade, this.add.rectangle(x0, y0, W, H, PALETTE.carta).setOrigin(0).setStrokeStyle(3, PALETTE.ocra).setInteractive());
    const close = this.add.text(x0 + W - 12, y0 + 8, '✕', textStyle(18, INK)).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on('pointerup', () => this.closePanel());
    items.push(close);
    const now = Date.now();

    if (spot === 'spedizione') {
      const T = buildingText.spedizione;
      items.push(this.add.text(x0 + 16, y0 + 12, T.name.toUpperCase(), textStyle(18, INK)));
      items.push(this.add.text(x0 + 16, y0 + 40, T.desc, textStyle(12, INK, false)).setWordWrapWidth(W - 32));
      const e = this.profile.expedition;
      if (e && e.until > now) {
        items.push(this.add.text(x0 + 16, y0 + 100, `${T.kinds[e.kind]}\nIn viaggio: torna tra ${fmtTime(e.until - now)}`, textStyle(14, PALETTE.ruggine)));
      } else if (e) {
        items.push(this.add.text(x0 + 16, y0 + 96, 'Il camion è tornato carico!', textStyle(14, 0x1e7a62)));
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
          this.burst.explode(30, s.x, this.groundY - 30 * this.k);
          this.toast(`+${got.rottami} rottami · +${got.carburante} carburante · +${got.viveri} viveri`, PALETTE.radioattivo);
        }));
      } else {
        EXPEDITIONS.forEach((kind: ExpeditionKind, i) => {
          const E = BALANCE.camp.expeditions[kind];
          const cost = expeditionCost(kind);
          const ok = this.profile.stash.viveri >= cost;
          const lbl = `${T.kinds[kind]} · ${fmtTime(E.timeSec * 1000)} · ${cost ? `${cost} viveri` : 'gratis'}`;
          items.push(this.btn(lbl, x0 + 16, y0 + 92 + i * 52, W - 32, ok, () => {
            if (!startExpedition(this.profile, kind, Date.now())) return;
            analytics.design(['spedizione', 'parti', kind]);
            saveProfile(this.profile);
            this.closePanel();
            this.redrawSpot('spedizione');
            this.updateStash();
            this.toast('Il camion parte. Tornerà, con qualcosa.', PALETTE.carta);
          }));
          items.push(this.add.text(x0 + 24, y0 + 92 + i * 52 + 42, `≈ ${E.rottami[0]}–${E.rottami[1]} rottami, ${E.carburante[0]}–${E.carburante[1]} carb., ${E.viveri[0]}–${E.viveri[1]} viveri`,
            textStyle(9, INK, false)));
        });
      }
    } else {
      const T = buildingText[spot];
      const lvl = this.profile.buildings[spot];
      items.push(this.add.text(x0 + 16, y0 + 12, `${T.name.toUpperCase()}  liv. ${lvl}/${MAX_LVL}`, textStyle(18, INK)));
      items.push(this.add.text(x0 + 16, y0 + 40, T.desc, textStyle(12, INK, false)).setWordWrapWidth(W - 32));
      T.levels.forEach((txt, i) => {
        const mark = i < lvl ? '✓' : i === lvl ? '→' : '·';
        const col = i < lvl ? 0x1e7a62 : i === lvl ? INK : 0x8a7f70;
        items.push(this.add.text(x0 + 16, y0 + 92 + i * 20, `${mark} liv. ${i + 1}: ${txt}`, textStyle(11, col, i === lvl)).setWordWrapWidth(W - 32));
      });
      const c = this.profile.construction;
      const next = nextLevel(this.profile, spot);
      if (c && c.id === spot) {
        const total = BALANCE.camp.buildings[spot][lvl].timeSec * 1000;
        const pct = 1 - (c.until - now) / total;
        items.push(this.add.rectangle(x0 + 16, y0 + H - 70, W - 32, 10, 0xd9cba8).setOrigin(0));
        items.push(this.add.rectangle(x0 + 16, y0 + H - 70, (W - 32) * Phaser.Math.Clamp(pct, 0, 1), 10, PALETTE.ruggine).setOrigin(0));
        items.push(this.btn(`IN COSTRUZIONE · ${fmtTime(c.until - now)}`, x0 + 16, y0 + H - 54, W - 32, false, () => {}));
      } else if (next) {
        items.push(this.bagRow(next.cost, x0 + 16, y0 + H - 84, this.profile.stash));
        const block = buildBlock(this.profile, spot);
        const why = { busy: 'cantiere occupato', cost: 'risorse insufficienti', max: '' } as const;
        const lbl = block ? why[block] : `${lvl ? 'MIGLIORA' : 'COSTRUISCI'} · ${fmtTime(next.timeSec * 1000)}`;
        items.push(this.btn(lbl.toUpperCase(), x0 + 16, y0 + H - 54, W - 32, !block, () => {
          if (!startBuild(this.profile, spot, Date.now())) return;
          analytics.design(['accampamento', 'costruisci', spot], lvl + 1);
          analytics.resources('sink', next.cost, 'edificio', spot);
          saveProfile(this.profile);
          this.closePanel();
          this.redrawSpot(spot);
          this.updateStash();
          this.toast(`Cantiere aperto: ${T.name}`, PALETTE.carta);
        }));
      } else {
        items.push(this.add.text(x0 + 16, y0 + H - 44, 'Livello massimo. Il resto lo fa la fantasia.', textStyle(12, 0x1e7a62)));
      }
    }
    this.panel = this.add.container(0, 0, items).setDepth(40);
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

  private btn(label: string, x: number, y: number, w: number, enabled: boolean, onClick: () => void) {
    const b = new Button(this, label, w, 40, () => enabled && onClick());
    b.setPosition(x, y).setAlpha(enabled ? 1 : 0.45);
    return b;
  }

  private toast(msg: string, color: number) {
    const { width } = this.scale;
    this.lastToast?.destroy();
    const t = (this.lastToast = this.add.text(width / 2, 90, msg, textStyle(15, color)).setOrigin(0.5).setAlign('center')
      .setBackgroundColor(hex(INK)).setPadding(12, 8, 12, 8).setDepth(60).setAlpha(0));
    this.tweens.add({ targets: t, alpha: 1, y: 80, duration: 220 });
    this.tweens.add({ targets: t, alpha: 0, delay: 2800, duration: 400, onComplete: () => t.destroy() });
  }
}
