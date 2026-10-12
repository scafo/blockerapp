import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { PALETTE, hex } from '../config/palette';
import buildingText from '../data/buildings.json';
import frontText from '../data/fronts.json';
import {
  BUILDINGS, EXPEDITIONS, activeCiv, buildBlock, campaignChoice, canAfford, civChoice, collectExpedition, deckOf, expeditionCost, unlockedUnits,
  activeFront, enableTestMode, expeditionTimeSec, fmtTime, nextLevel, playerPower, settle, startBuild, startExpedition, stashCap, tents,
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
import { currentWorld } from '../game/world';
import { Button } from '../ui/Button';
import { buzz } from '../ui/haptics';
import { drawResourceIcon } from '../ui/resourceIcons';
import { textStyle } from '../ui/style';
import { safeInsets, uiCamera, view } from '../ui/screen';
import { drawPatch } from '../ui/symbols';
import { drawUnitIcon } from '../ui/unitIcons';
import { civImage, coverImage, fade } from '../ui/images';
import { drawGround } from '../ui/baseArt';
import { dashedBox, note, sheet } from '../ui/schematic';

const PAD = 12;
// pianta della base (riferimento di Nico: planimetria tecnica su ardesia)
const NAV_W = 190; // colonna di navigazione a sinistra (orizzontale)
const KEY_W = 200; // legenda e uscita a destra (orizzontale)
const TEAL = PALETTE.ocra; // etichette in corsivo verde acqua
const RED = PALETTE.ruggine; // uscita / punti critici
const italic = (size: number, color: number = TEAL): Phaser.Types.GameObjects.Text.TextStyle => ({ ...textStyle(size, color, false), fontStyle: 'italic', padding: { right: 3 } });
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
  private boardTexts = new Map<string, Phaser.GameObjects.Text[]>(); // bacheca operativa: valore e nota di ogni riga
  private panel: Phaser.GameObjects.Container | null = null;
  private panelSpot: Spot | null = null;
  private panelMode = ''; // laboratorio: '' ricerche · 'archivio' · 'build'; radar: '' registro · 'build'
  private refreshAcc = 0;
  private panelKey = '';
  private lastToast: Phaser.GameObjects.Container | null = null;
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;
  private navBtns: { btn: { setOn: (on: boolean) => void; setVisible: (v: boolean) => void }; on: () => boolean }[] = [];

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
    this.boardTexts = new Map();
    this.panel = null;
    this.panelSpot = null;
    const { width, height } = view(this);
    // verticale: edifici su due file (dietro sull'orizzonte, davanti in basso), campo al centro
    this.portrait = height > width;

    // planimetria: area utile tra la scorta in alto e i comandi in basso
    this.safe = safeInsets();
    const st = this.safe.top, sb = this.safe.bottom;
    this.plan = this.portrait ? { x: PAD, y: 164 + st, w: width - 2 * PAD, h: height - 164 - 150 - st - sb }
      : { x: PAD + 20, y: 150 + st, w: width - 2 * PAD - 20 - KEY_W - 24, h: height - 150 - 40 - st - sb };
    this.k = this.portrait ? Math.min(this.plan.w / 400, 1.2) : Math.min(this.plan.w / 820, this.plan.h / 560, 1.3);
    const frac: Record<MapSpot, [number, number]> = this.portrait
      ? { comando: [0.5, 0.41], laboratorio: [0.27, 0.13], radar: [0.73, 0.13], arsenale: [0.27, 0.68], deposito: [0.73, 0.68], spedizione: [0.5, 0.88] }
      : { comando: [0.5, 0.44], laboratorio: [0.15, 0.16], radar: [0.85, 0.16], arsenale: [0.15, 0.74], deposito: [0.85, 0.74], spedizione: [0.5, 0.9] };
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
    this.updateBoard();
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
      t.setColor(hex(finite && v >= cap ? PALETTE.ko : INK));
      const from = shownStash?.[i];
      if (from !== undefined && from !== v && !this.counting[i]) this.countTo(i, from, v);
      else if (!this.counting[i]) t.setText(String(v));
      if (!this.counting[i] && shownStash) shownStash[i] = v;
      if (this.stashBars[i]) this.stashBars[i].width = this.stashBarW * (finite ? Math.min(1, v / cap) : 1);
    });
    this.capText?.setText(finite ? `DEPOSITO · capienza ${cap} per risorsa` : 'DEPOSITO · senza limite (test)');
    const now = Date.now(), c = p.construction, rs = p.research;
    const parts = [
      c ? `🔨 ${buildingText[c.id].name} liv. ${p.buildings[c.id] + 1} · ${fmtTime(c.until - now)}` : '',
      rs ? `⚗ ${techInfo(rs.id).name} · ${fmtTime(rs.until - now)}` : '',
    ].filter(Boolean);
    this.statusText?.setText(parts.join('   ')).setColor(hex(c || rs ? PALETTE.allerta : PALETTE.tenue));
  }

  // ---------- disegno ----------

  /** Fondo: ardesia con la grana della carta stampata (niente foto: è una pianta). */
  private drawBackdrop() {
    const { width, height } = view(this);
    this.cameras.main.setBackgroundColor(SKY);
    drawGround(this, width, height);
  }

  /** La pianta: anello di corridoi attorno al Centro di Comando, un corridoio a gomito verso ogni ala, condotte tratteggiate. */
  private drawCenter() {
    const c = this.spotPos.comando, cf = this.footprint('comando'), g = this.add.graphics();
    const node = (x: number, y: number) => g.fillStyle(INK, 1).fillCircle(x, y, 3);
    const off = 34 * this.k, rl = c.x - cf.w / 2 - off, rr = c.x + cf.w / 2 + off, rt = c.y - cf.h / 2 - off, rb = c.y + cf.h / 2 + off;
    g.lineStyle(1.5, INK, 0.9).strokeRect(rl, rt, rr - rl, rb - rt);
    // ingressi del Centro di Comando sui quattro lati
    g.lineBetween(c.x, rt, c.x, c.y - cf.h / 2).lineBetween(c.x, rb, c.x, c.y + cf.h / 2).lineBetween(rl, c.y, c.x - cf.w / 2, c.y).lineBetween(rr, c.y, c.x + cf.w / 2, c.y);
    for (const [x, y] of [[c.x, rt], [c.x, rb], [rl, c.y], [rr, c.y]]) node(x, y);
    // ali agli angoli: dal lato della stanza in orizzontale fino all'anello, poi in verticale fino all'angolo
    for (const id of ['laboratorio', 'radar', 'arsenale', 'deposito'] as const) {
      const p = this.spotPos[id], f = this.footprint(id), right = p.x > c.x, top = p.y < c.y;
      const sx = right ? p.x - f.w / 2 : p.x + f.w / 2, cx = right ? rr : rl, cy = top ? rt : rb;
      g.lineStyle(1.5, INK, 0.9).lineBetween(sx, p.y, cx, p.y).lineBetween(cx, p.y, cx, cy);
      node(cx, cy);
    }
    // estrazione: dal fondo dell'anello
    const S = this.spotPos.spedizione, sf = this.footprint('spedizione');
    g.lineBetween(c.x, rb, S.x, S.y - sf.h / 2);
    // condotte di ventilazione (tratteggiate) tra le ali dello stesso lato
    const dash = (x0: number, y0: number, x1: number, y1: number) => {
      const n = Math.floor(Math.hypot(x1 - x0, y1 - y0) / 6);
      for (let i = 0; i < n; i += 2) g.fillStyle(INK, 0.55).fillRect(x0 + ((x1 - x0) * i) / n - 1, y0 + ((y1 - y0) * i) / n - 1, 2, 2);
    };
    const L = this.spotPos.laboratorio, R = this.spotPos.radar, A = this.spotPos.arsenale, D = this.spotPos.deposito;
    const fl = this.footprint('laboratorio'), fa = this.footprint('arsenale');
    dash(L.x, L.y + fl.h / 2 + 24, A.x, A.y - fa.h / 2 - 6);
    dash(R.x, R.y + fl.h / 2 + 24, D.x, D.y - fa.h / 2 - 6);
    this.clock = null;
    if (!this.portrait) this.drawSideRooms();
  }

  /**
   * Stanze laterali sulle condotte (orizzontale): a sinistra gli Alloggi (un posto per ogni tenda, crescono con le
   * campagne), a destra l'Archivio della Caduta (un vano per ogni frammento di lore; si tocca per leggerli).
   */
  private drawSideRooms() {
    const k = this.k, w = Math.max(160 * k, 172), h = Math.max(74 * k, 64), g = this.add.graphics();
    const room = (cx: number, cy: number, name: string, sub: string, n: number, total: number, onTap?: () => void) => {
      const l = cx - w / 2, t = cy - h / 2;
      g.fillStyle(PALETTE.inchiostro, 1).fillRect(l, t, w, h).lineStyle(1.5, INK, 0.9).strokeRect(l, t, w, h);
      const title = this.add.text(l + 12, t + 8, name, textStyle(12, INK));
      title.setScale(Math.min(1, (w - 24) / Math.max(1, title.width)));
      this.add.text(l + 12, t + 8 + title.displayHeight, sub, italic(11));
      const gap = 3, cw = (w - 24 - (total - 1) * gap) / total, ch = 8 * k + 3, cy0 = t + h - 9 - ch;
      for (let i = 0; i < total; i++) {
        const bx = l + 12 + i * (cw + gap);
        if (i < n) g.fillStyle(INK, 1).fillRect(bx, cy0, cw, ch);
        else g.lineStyle(1, INK, 0.4).strokeRect(bx, cy0, cw, ch);
      }
      if (onTap) {
        const hit = this.add.rectangle(cx, cy, w + 12, h + 12, 0xffffff, 0.001).setInteractive({ useHandCursor: true }).setDepth(7);
        let pressed = false;
        hit.on('pointerdown', () => { pressed = true; buzz(8); }).on('pointerout', () => { pressed = false; })
          .on('pointerup', () => { if (pressed) { pressed = false; onTap(); } });
      }
    };
    const L = this.spotPos.laboratorio, A = this.spotPos.arsenale, R = this.spotPos.radar, D = this.spotPos.deposito;
    const n = tents(this.profile), max = BALANCE.camp.tentsMax, frags = loreFragments(this.profile).length;
    room(L.x, (L.y + A.y) / 2, 'ALLOGGI', `${n} posti su ${max}`, n, max);
    room(R.x, (R.y + D.y) / 2, 'ARCHIVIO DELLA CADUTA', `${frags} di ${loreTotal} frammenti`, frags, loreTotal, () => this.openPanel('laboratorio', 'archivio'));
  }

  /** Ingombro dell'edificio di una postazione (punti). */
  private footprint(id: MapSpot) {
    const k = this.k;
    return id === 'comando' ? { w: 250 * k, h: 120 * k } : id === 'spedizione' ? { w: 250 * k, h: 56 * k } : id === 'arsenale' ? { w: 210 * k, h: 92 * k } : { w: 170 * k, h: 92 * k };
  }

  private makeSpot(id: MapSpot, x: number, y: number) {
    const { w, h } = this.footprint(id);
    const g = this.add.graphics();
    const label = this.add.text(x, y, '', textStyle(14, PALETTE.carta)).setDepth(6);
    const timer = this.add.text(x, y + h / 2 + 6, '', textStyle(10, PALETTE.allerta)).setOrigin(0.5, 0).setDepth(6);
    this.timerTexts.set(id, timer);
    this.spots.set(id, { x, y, g, deco: [], label });
    const hit = this.add.rectangle(x, y, w + 12, h + 12, 0xffffff, 0.001).setInteractive({ useHandCursor: true }).setDepth(7);
    let pressed = false; // apre solo se il tocco è iniziato qui (non il rilascio del ✕ di una scheda appena chiusa)
    hit.on('pointerdown', () => { pressed = true; this.tapRing(id, PALETTE.ocra, 1); buzz(8); });
    hit.on('pointerout', () => { pressed = false; });
    // il Laboratorio costruito apre direttamente l'albero della ricerca
    hit.on('pointerup', () => {
      if (!pressed) return;
      pressed = false;
      if (id === 'laboratorio' && this.profile.buildings.laboratorio > 0) this.openTree('esercito');
      else this.openPanel(id);
    });
  }

  /**
   * Postazione come stanza della pianta: nome per intero, livello, una cella per ogni livello lungo il fondo (piena se
   * raggiunto, ambra se in cantiere). Il Centro di Comando è pieno avorio; un lotto libero è tratteggiato.
   */
  private redrawSpot(id: MapSpot) {
    const spot = this.spots.get(id)!;
    spot.deco.forEach((d) => d.destroy());
    spot.deco = [];
    const g = spot.g.clear();
    const x = spot.x, y = spot.y, { w, h } = this.footprint(id);
    const lvl = id === 'spedizione' ? 1 : this.profile.buildings[id];
    const building = id !== 'spedizione' && this.profile.construction?.id === id;
    const name = id === 'spedizione' ? 'Squadre di estrazione' : buildingText[id].name;
    const l = x - w / 2, t = y - h / 2;
    const big = id === 'comando', solid = big && lvl > 0;
    if (lvl > 0) g.fillStyle(solid ? INK : PALETTE.inchiostro, 1).fillRect(l, t, w, h);
    if (lvl > 0 || building) g.lineStyle(1.5, building ? PALETTE.allerta : INK, 1).strokeRect(l, t, w, h);
    else for (let i = 0; i < (w + h) * 2; i += 8) { // lotto libero: riquadro tratteggiato
      const per = i < w ? [l + i, t] : i < w + h ? [l + w, t + i - w] : i < 2 * w + h ? [l + w - (i - w - h), t + h] : [l, t + h - (i - 2 * w - h)];
      g.fillStyle(INK, 0.5).fillRect(per[0] - 1, per[1] - 1, 3, 1.5);
    }
    const ink = solid ? PALETTE.inchiostro : INK, live = lvl > 0 || building;
    spot.label.setText(name.toUpperCase()).setStyle(textStyle(big ? 20 : 14, ink)).setOrigin(0, 0).setPosition(l + 12, t + 10).setAlpha(live ? 1 : 0.6);
    spot.label.setScale(Math.min(1, (w - 24) / Math.max(1, spot.label.width / spot.label.scaleX))); // il nome sta dentro la stanza
    if (id !== 'spedizione') {
      const n = maxLvl(id);
      const sub = building ? 'in costruzione' : lvl === 0 ? 'da costruire' : `livello ${lvl} di ${n}`;
      spot.deco.push(this.add.text(l + 12, t + 10 + spot.label.height, sub, italic(11, solid ? PALETTE.inchiostro : building ? PALETTE.allerta : TEAL)).setAlpha(live ? 1 : 0.7));
      // celle dei livelli lungo il fondo della stanza
      const gap = 4, ch = 10 * this.k + 4, cw = (w - 24 - (n - 1) * gap) / n, cy = t + h - 10 - ch;
      for (let i = 0; i < n; i++) {
        const bx = l + 12 + i * (cw + gap), done = i < lvl, now = building && i === lvl;
        const fill = done ? (solid ? PALETTE.inchiostro : INK) : solid ? INK : PALETTE.inchiostro;
        g.fillStyle(fill, 1).fillRect(bx, cy, cw, ch).lineStyle(1.2, now ? PALETTE.allerta : ink, done || now ? 1 : 0.45).strokeRect(bx, cy, cw, ch);
      }
      // si può migliorare adesso: freccia verde acqua nell'angolo
      if (lvl < n && !building && !buildBlock(this.profile, id)) {
        const up = this.add.text(l + w - 10, t + 8, '▲', textStyle(13, solid ? PALETTE.inchiostro : PALETTE.radioattivo)).setOrigin(1, 0).setDepth(6);
        this.tweens.add({ targets: up, y: up.y - 3, alpha: 0.4, duration: 600, yoyo: true, repeat: -1 });
        spot.deco.push(up);
      }
    } else this.drawConvoy(spot, g, x, y, w, h);
  }

  /** Squadre di estrazione: in rimessa, in missione (un puntino corre sul corridoio d'uscita) o di ritorno (!). */
  private drawConvoy(spot: { deco: Phaser.GameObjects.GameObject[] }, g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
    const e = this.profile.expedition, away = e && e.until > Date.now(), ready = e && e.until <= Date.now();
    void g;
    if (away) {
      const dot = this.add.rectangle(x, y + h / 2, 6, 6, PALETTE.allerta);
      this.tweens.add({ targets: dot, y: this.plan.y + this.plan.h + 20, alpha: 0.2, duration: 2600, repeat: -1 });
      spot.deco.push(dot);
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
    const P = this.portrait;
    const T = PAD + this.safe.top, B = PAD + this.safe.bottom; // margini sicuri in alto e in basso
    // scorta: riquadro della pianta con le tre risorse (filo avorio, numeri avorio, capienza in corsivo)
    const panelW = P ? width - 2 * PAD : NAV_W, panelY = P ? T + 52 : T, rowH = 22;
    const boxH = P ? 58 : 30 + RESOURCES.length * rowH;
    this.add.rectangle(PAD, panelY, panelW, boxH, PALETTE.inchiostro, 0.96).setOrigin(0).setStrokeStyle(1.5, INK, 0.9);
    this.capText = this.add.text(PAD + 10, panelY + 6, '', italic(10));
    const ig = this.add.graphics();
    this.stashBars = [];
    this.stashBarW = P ? (panelW - 40) / 3 - 30 : panelW - 110;
    this.stashTexts = RESOURCES.map((r, i) => {
      const x = P ? PAD + 12 + i * ((panelW - 20) / 3) : PAD + 10, y = P ? panelY + 36 : panelY + 30 + i * rowH + rowH / 2;
      drawResourceIcon(ig, r, x + 7, y, 7);
      if (!P) {
        this.add.text(x + 20, y, RESOURCE_INFO[r].name.toUpperCase(), textStyle(10, INK)).setOrigin(0, 0.5);
        this.add.rectangle(x + 86, y + 6, this.stashBarW, 2, LINE, 0.5).setOrigin(0);
        this.stashBars.push(this.add.rectangle(x + 86, y + 6, 0, 2, INK).setOrigin(0));
      }
      return this.add.text(P ? x + 20 : PAD + panelW - 10, y, '0', textStyle(15, INK)).setOrigin(P ? 0 : 1, 0.5);
    });
    // cantiere e ricerca in corso
    // verticale: cantiere e ricerca sotto la scorta (in orizzontale li mostra la bacheca operativa)
    this.statusText = P ? this.add.text(PAD + 2, panelY + boxH + 6, '', italic(10, PALETTE.tenue)) : null;
    // titolo in alto a destra (5 tocchi = contatore FPS nelle run)
    let taps = 0;
    const titleX = P ? width / 2 : width - PAD, titleO = P ? 0.5 : 1;
    this.add.text(titleX, T + 2, 'ASHEN ATLAS', textStyle(20, INK)).setOrigin(titleO, 0)
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
    // tasto TEST solo in sviluppo o con ?test=1 nell'indirizzo: i tester del link pubblico non lo vedono
    const testOk = import.meta.env.DEV || p.test || new URLSearchParams(location.search).has('test');
    if (testOk) this.add.text(P ? width - PAD : titleX - 150, P ? T + 4 : T + 7, p.test ? '[ TEST ATTIVO ]' : '[ TEST ]', textStyle(11, PALETTE.allerta))
      .setOrigin(1, 0).setInteractive({ useHandCursor: true }).on('pointerup', () => this.openPanel('test'));
    const power = playerPower(p), front = p.frontMax ?? 0;
    this.add.text(titleX, T + 28, `${p.name || 'Comandante'} ✎ · potenza ${power} · fronte ${ROMAN[front]} · ${p.wins} vittorie`, italic(11))
      .setOrigin(titleO, 0).setInteractive({ useHandCursor: true }).on('pointerup', () => this.editName());
    // legenda (KEY) tratteggiata in basso a destra, con l'uscita rossa = GIOCA
    const kw = P ? width - 2 * PAD : KEY_W, kh = P ? 0 : 150, kx = P ? PAD : width - PAD - kw, ky = height - B - kh;
    if (!P) {
      const kg = this.add.graphics();
      for (let i = 0; i < (kw + kh) * 2; i += 7) {
        const q = i < kw ? [kx + i, ky] : i < kw + kh ? [kx + kw, ky + i - kw] : i < 2 * kw + kh ? [kx + kw - (i - kw - kh), ky + kh] : [kx, ky + kh - (i - 2 * kw - kh)];
        kg.fillStyle(INK, 0.8).fillRect(q[0] - 1, q[1] - 1, 2.5, 2.5);
      }
      this.add.text(kx + kw / 2, ky + 12, 'LEGENDA', textStyle(12, INK)).setOrigin(0.5, 0);
      const row = (yy: number, draw: (x: number, y: number) => void, txt: string) => { draw(kx + 18, yy); this.add.text(kx + 40, yy, txt, textStyle(9, INK, false)).setOrigin(0, 0.5); };
      row(ky + 42, (x, y) => kg.lineStyle(1.2, INK, 1).strokeRect(x - 8, y - 5, 16, 10), 'LIVELLO DA COSTRUIRE');
      row(ky + 62, (x, y) => kg.fillStyle(INK, 1).fillRect(x - 8, y - 5, 16, 10), 'LIVELLO COSTRUITO');
      row(ky + 82, (x, y) => kg.lineStyle(1.5, INK, 1).lineBetween(x - 9, y, x + 9, y), 'CORRIDOIO');
      row(ky + 102, (x, y) => { for (let i = -8; i <= 8; i += 4) kg.fillStyle(INK, 0.8).fillRect(x + i - 1, y - 1, 2, 2); }, 'CONDOTTA');
      row(ky + 122, (x, y) => kg.fillStyle(RED, 1).fillCircle(x, y, 7).lineStyle(1, INK, 0.8).strokeCircle(x, y, 7), 'USCITA VERSO IL FRONTE');
    }
    // GIOCA: l'uscita della base (cerchio rosso) + riquadro avorio pieno, sopra la legenda
    const bw = P ? Math.min(260, width - 2 * PAD) : KEY_W, bh = 52;
    const play = new Button(this, 'AVVIA CAMPAGNA', bw - (P ? 0 : 46), bh, () => this.onPlay(), 16).setPrimary();
    play.setPosition(P ? (width - bw) / 2 : kx + 46, P ? height - B - bh : ky - bh - 14).setDepth(20);
    if (!P) {
      const ex = kx + 20, ey = play.y + bh / 2, eg = this.add.graphics().setDepth(20);
      eg.fillStyle(RED, 1).fillCircle(ex, ey, 17).lineStyle(1.5, INK, 0.9).strokeCircle(ex, ey, 17);
      eg.lineStyle(2, PALETTE.inchiostro, 1).lineBetween(ex - 7, ey - 3, ex + 7, ey - 3).lineBetween(ex - 5, ey + 2, ex + 5, ey + 2).lineBetween(ex, ey - 8, ex, ey - 3);
      eg.lineStyle(1.5, INK, 0.9).lineBetween(ex + 17, ey, kx + 46, ey);
      const pulse = this.add.circle(ex, ey, 17, RED, 0.35).setDepth(19);
      this.tweens.add({ targets: pulse, scale: 1.6, alpha: 0, duration: 1400, repeat: -1, ease: 'Quad.easeOut' });
    }
    if (this.profile.runs > 0 && P) this.drawNav(width, height, B); // in orizzontale il Mercato è una riga della bacheca
    if (!P) this.drawBoard(width - PAD - KEY_W, T + 62, KEY_W, play.y - 22 - (T + 62));
  }

  /**
   * Bacheca operativa (orizzontale, colonna destra): cosa succede in base e cosa fare adesso. Ogni riga apre la sua scheda.
   * I valori si aggiornano in update() (tempi dei cantieri, delle ricerche e delle squadre).
   */
  private drawBoard(x: number, y: number, w: number, hMax: number) {
    const p = this.profile, rowH = 50, rows: { key: string; label: string; run: () => void }[] = [
      { key: 'fronte', label: 'Prossimo fronte', run: () => this.openPanel('gioca', 'fronti') },
      { key: 'cantiere', label: 'Cantiere', run: () => { const c = p.construction; this.openPanel(c ? c.id : 'comando'); } },
      { key: 'ricerca', label: 'Ricerca', run: () => this.openTree('esercito') },
      { key: 'squadre', label: 'Squadre di estrazione', run: () => this.openPanel('spedizione') },
      ...(p.runs > 0 ? [{ key: 'mercato', label: 'Mercato', run: () => this.openPanel('mercato') }] : []),
    ];
    const n = Math.min(rows.length, Math.floor((hMax - 20) / rowH));
    if (n <= 0) return;
    const h = n * rowH + 16, g = this.add.graphics();
    g.fillStyle(PALETTE.inchiostro, 0.96).fillRect(x, y, w, h).lineStyle(1.5, INK, 0.9).strokeRect(x, y, w, h);
    this.add.text(x + 8, y, ' Bacheca operativa ', italic(11)).setOrigin(0, 0.5).setBackgroundColor(hex(PALETTE.inchiostro));
    this.boardTexts.clear();
    rows.slice(0, n).forEach((r, i) => {
      const ry = y + 10 + i * rowH;
      if (i) for (let dx = 10; dx < w - 10; dx += 5) g.fillStyle(INK, 0.4).fillRect(x + dx, ry - 1, 1.5, 1.5);
      const hit = this.add.rectangle(x + 2, ry + 1, w - 4, rowH - 2, PALETTE.pannelloAlto, 0).setOrigin(0).setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => hit.setFillStyle(PALETTE.pannelloAlto, 1)).on('pointerout', () => hit.setFillStyle(PALETTE.pannelloAlto, 0)).on('pointerup', r.run);
      this.add.text(x + 12, ry + 6, r.label, italic(10));
      const v = this.add.text(x + 12, ry + 19, '', textStyle(13, INK)).setWordWrapWidth(w - 36).setMaxLines(1);
      const sub = this.add.text(x + 12, ry + 35, '', textStyle(9, PALETTE.tenue, false)).setWordWrapWidth(w - 36).setMaxLines(1);
      this.add.text(x + w - 12, ry + rowH / 2, '›', textStyle(16, TEAL)).setOrigin(1, 0.5);
      this.boardTexts.set(r.key, [v, sub]);
    });
    this.updateBoard();
  }

  private updateBoard() {
    if (!this.boardTexts.size) return;
    const p = this.profile, now = Date.now();
    const set = (k: string, v: string, sub: string, color: number = INK, subColor: number = PALETTE.tenue) => {
      const t = this.boardTexts.get(k);
      if (!t) return;
      if (t[0].text !== v) t[0].setText(v);
      if (t[1].text !== sub) t[1].setText(sub);
      t[0].setColor(hex(color));
      t[1].setColor(hex(subColor));
    };
    const fi = activeFront(p), F = BALANCE.fronts[fi], power = playerPower(p), weak = power < F.power;
    set('fronte', `${ROMAN[fi]} · ${F.name}`, `potenza consigliata ${F.power} · tua ${power}`, INK, weak ? PALETTE.ko : PALETTE.tenue);
    const c = p.construction;
    if (c) set('cantiere', `${buildingText[c.id].name} → liv. ${p.buildings[c.id] + 1}`, `finisce tra ${fmtTime(c.until - now)}`, INK, PALETTE.allerta);
    else set('cantiere', 'libero', 'tocca una stanza per migliorarla', PALETTE.tenue);
    const r = p.research;
    if (r) set('ricerca', techInfo(r.id).name, `finisce tra ${fmtTime(r.until - now)}`, INK, PALETTE.allerta);
    else set('ricerca', 'nessuna in corso', p.buildings.laboratorio ? 'apri l\'albero della ricerca' : 'serve il Laboratorio', PALETTE.tenue);
    const e = p.expedition;
    if (!e) set('squadre', 'in base', 'pronte a partire', PALETTE.tenue);
    else if (e.until > now) set('squadre', 'in missione', `tornano tra ${fmtTime(e.until - now)}`, INK, PALETTE.allerta);
    else set('squadre', 'di ritorno', 'ritira il bottino', PALETTE.radioattivo, PALETTE.radioattivo);
    set('mercato', 'scambi e rifornimenti', 'risorse, scorte, lavori finiti subito');
  }

  /** Navigazione: riquadri verde acqua con la freccia che entra da sinistra, come i rimandi agli altri piani della pianta. */
  private drawNav(width: number, height: number, B: number) {
    // le altre voci (ricerca, arsenale, archivio, operazioni) sono già le stanze della pianta e l'uscita rossa
    const items: { label: string; on: () => boolean; run: () => void }[] = [
      { label: 'Mercato', on: () => this.panelSpot === 'mercato', run: () => this.openPanel('mercato') },
    ];
    const P = this.portrait, bh = 30, gap = 6, cols = 1;
    const bw = P ? 140 : NAV_W - 26;
    const x0 = P ? PAD + 26 : PAD + 26, y0 = P ? height - B - 52 - 10 - bh : this.safe.top + PAD + 30 + RESOURCES.length * 22 + 30;
    // rimando verde acqua con la freccia che entra da sinistra, come "→ Floor 3.2" della pianta
    const g = this.add.graphics().setDepth(50);
    void width;
    this.navBtns = items.map((it, i) => {
      const r = Math.floor(i / cols), c = i % cols, x = x0 + c * (bw + gap), y = y0 + r * (bh + gap);
      g.lineStyle(1.2, TEAL, 0.9).lineBetween(PAD, y + bh / 2, x, y + bh / 2).fillStyle(TEAL, 1).fillTriangle(x, y + bh / 2, x - 6, y + bh / 2 - 4, x - 6, y + bh / 2 + 4);
      const bg = this.add.rectangle(x, y, bw, bh, PALETTE.inchiostro, 1).setOrigin(0).setStrokeStyle(1.2, TEAL, 0.9).setDepth(50);
      const txt = this.add.text(x + 10, y + bh / 2, it.label, italic(12)).setOrigin(0, 0.5).setDepth(51);
      bg.setInteractive({ useHandCursor: true }).on('pointerup', it.run)
        .on('pointerover', () => { if (!it.on()) bg.setFillStyle(PALETTE.pannelloAlto, 1); })
        .on('pointerout', () => { if (!it.on()) bg.setFillStyle(PALETTE.inchiostro, 1); });
      const btn = {
        setOn: (on: boolean) => { bg.setFillStyle(on ? TEAL : PALETTE.inchiostro, 1); txt.setColor(hex(on ? PALETTE.inchiostro : TEAL)); },
        setVisible: (v: boolean) => { bg.setVisible(v); txt.setVisible(v); },
      };
      return { btn, on: it.on };
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
    for (const { btn } of this.navBtns) btn.setVisible(true);
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
    const W = Math.min(prep ? 700 : shop ? 560 : wide ? 540 : bld || spot === 'spedizione' ? 470 : 330, width - 24);
    const H = Math.min(prep ? (this.portrait ? 620 : 420) : shop ? (this.portrait ? 520 : 372) : wide ? (this.portrait ? 440 : 350) : bld ? 400 : 290, height - 2 * PAD);
    const x0 = width / 2 - W / 2, y0 = (height - H) / 2;
    // la scheda può finire più in basso di dove inizia la cornice di navigazione (depth 50, sempre sopra): se così, la
    // nascondiamo finché la scheda è aperta, altrimenti i suoi pulsanti galleggerebbero sopra il contenuto della scheda.
    for (const { btn } of this.navBtns) btn.setVisible(false);
    const items: Phaser.GameObjects.GameObject[] = [];
    const shade = this.add.rectangle(0, 0, width, height, PALETTE.inchiostro, 0.6).setOrigin(0).setInteractive();
    shade.on('pointerup', () => this.closePanel());
    // scheda della pianta: fondo ardesia, filo avorio, categoria in corsivo incastrata nel bordo
    const kind = spot === 'test' ? 'Modalità test' : shop ? 'Mercato' : prep ? 'Operazioni' : spot === 'spedizione' ? 'Rimessa delle squadre'
      : spot === 'laboratorio' && this.panelMode === 'archivio' ? 'Archivio' : spot === 'radar' && this.panelMode !== 'build' && this.profile.buildings.radar > 0 ? 'Registro'
      : 'Stanza della base';
    items.push(shade, ...sheet(this, x0, y0, W, H, kind, () => this.closePanel()));
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
        }, 16, true));
      } else {
        // tabella delle missioni: tipo · durata · costo · bottino atteso; si tocca la riga per partire
        const cx = [x0 + 16, x0 + 16 + (W - 32) * 0.38, x0 + 16 + (W - 32) * 0.56, x0 + 16 + (W - 32) * 0.74], ty = y0 + 92;
        ['missione', 'durata', 'costo', 'bottino'].forEach((h, k) => items.push(this.add.text(cx[k] + 6, ty, h, italic(10))));
        EXPEDITIONS.forEach((kind: ExpeditionKind, i) => {
          const E = BALANCE.camp.expeditions[kind];
          const cost = expeditionCost(kind);
          const ok = this.profile.stash.cibo >= cost;
          const ry = ty + 18 + i * 46;
          const r = this.add.rectangle(x0 + 16, ry, W - 32, 40, PALETTE.inchiostro).setOrigin(0).setStrokeStyle(1.2, INK, ok ? 0.75 : 0.25);
          if (ok) {
            r.setInteractive({ useHandCursor: true }).on('pointerover', () => r.setFillStyle(PALETTE.pannelloAlto)).on('pointerout', () => r.setFillStyle(PALETTE.inchiostro));
            r.on('pointerup', () => {
              if (!startExpedition(this.profile, kind, Date.now())) return;
              analytics.design(['spedizione', 'parti', kind]);
              saveProfile(this.profile);
              this.closePanel();
              this.redrawSpot('spedizione');
              this.updateStash();
              this.toast('Le squadre partono. Torneranno con quello che trovano.', PALETTE.carta);
            });
          }
          items.push(r,
            this.add.text(cx[0] + 6, ry + 20, T.kinds[kind], textStyle(12, INK)).setOrigin(0, 0.5).setAlpha(ok ? 1 : 0.5),
            this.add.text(cx[1] + 6, ry + 20, fmtTime(expeditionTimeSec(this.profile, kind) * 1000), textStyle(12, INK)).setOrigin(0, 0.5),
            this.add.text(cx[2] + 6, ry + 20, cost ? `${cost} cibo` : 'gratis', textStyle(12, ok ? INK : PALETTE.ko)).setOrigin(0, 0.5),
            this.add.text(cx[3] + 6, ry + 20, `${E.metallo[0]}–${E.metallo[1]} met.\n${E.benzina[0]}–${E.benzina[1]} benz. · ${E.cibo[0]}–${E.cibo[1]} cibo`, textStyle(9, PALETTE.tenue, false)).setOrigin(0, 0.5));
        });
      }
    } else {
      const T = buildingText[spot];
      const lvl = this.profile.buildings[spot];
      // testata: illustrazione animata del modulo, livello, potenza che guadagni migliorando
      // pianta della stanza: un vano per livello (pieno se costruito, ambra se in cantiere, tratteggiato se ancora da fare)
      const ig = this.add.graphics(), n = maxLvl(spot), cols = n > 3 ? 3 : n, rws = Math.ceil(n / cols);
      items.push(ig);
      const px = x0 + 16, py = y0 + 18, rw = 132, ph = 84, gp = 6;
      ig.lineStyle(1.5, INK, 0.9).strokeRect(px, py, rw, ph);
      const vw = (rw - 12 - (cols - 1) * gp) / cols, vh = (ph - 12 - (rws - 1) * gp) / rws, building = this.profile.construction?.id === spot;
      for (let i = 0; i < n; i++) {
        const vx = px + 6 + (i % cols) * (vw + gp), vy = py + 6 + Math.floor(i / cols) * (vh + gp);
        if (i < lvl) ig.fillStyle(INK, 1).fillRect(vx, vy, vw, vh);
        else if (building && i === lvl) ig.lineStyle(1.5, PALETTE.allerta, 1).strokeRect(vx, vy, vw, vh);
        else dashedBox(ig, vx, vy, vw, vh, INK, 0.45);
        items.push(this.add.text(vx + 4, vy + 3, String(i + 1), textStyle(9, i < lvl ? PALETTE.inchiostro : INK, false)).setAlpha(i < lvl ? 1 : 0.6));
      }
      const pw = BALANCE.power[spot as keyof typeof BALANCE.power] ?? 0;
      items.push(this.add.text(x0 + 162, y0 + 14, T.name.toUpperCase(), textStyle(T.name.length > 14 ? 16 : 20, INK)),
        this.add.text(x0 + 162, y0 + 42, `livello ${lvl} di ${maxLvl(spot)}${lvl < maxLvl(spot) ? ` · il prossimo dà +${pw} potenza` : ' · massimo'}`, italic(11)),
        this.add.text(x0 + 162, y0 + 62, T.desc, textStyle(10, PALETTE.tenue, false)).setWordWrapWidth(W - 178));
      if (spot === 'radar' && lvl > 0) items.push(this.link('‹ registro', x0 + W - 16, y0 + 90, () => this.openPanel(spot, '')));
      // Laboratorio e Arsenale: da qui all'albero della ricerca (armamenti e tecnologie)
      if (spot === 'laboratorio' || spot === 'arsenale') {
        items.push(this.link(spot === 'arsenale' ? 'albero: armamenti ›' : 'albero della ricerca ›', x0 + W - 16, y0 + 90, () => this.openTree(spot === 'arsenale' ? 'armamenti' : 'esercito')));
        if (spot === 'laboratorio') items.push(this.link(`archivio della Caduta (${loreFragments(this.profile).length}/${loreTotal}) ›`, x0 + 16, y0 + H - 132, () => this.openPanel('laboratorio', 'archivio'), 0));
      }
      // tutti i livelli: fatti, il prossimo evidenziato, quelli dopo
      // tabella dei livelli: numero · cosa sblocca · stato (fatto, prossimo, da fare)
      const tg = this.add.graphics(), step = T.levels.length > 3 ? 18 : 22, ty = y0 + 110, sx = x0 + W - 90;
      items.push(tg,
        this.add.text(x0 + 18, ty, 'liv.', italic(10)), this.add.text(x0 + 52, ty, 'cosa sblocca', italic(10)), this.add.text(sx, ty, 'stato', italic(10)));
      T.levels.forEach((txt, i) => {
        const ly = ty + 16 + i * step, col = i < lvl ? INK : i === lvl ? INK : PALETTE.tenue;
        if (i === lvl) items.push(this.add.rectangle(x0 + 12, ly - 2, W - 24, step, PALETTE.pannelloAlto).setOrigin(0).setStrokeStyle(1, INK, 0.5));
        for (let dx = x0 + 14; dx < x0 + W - 14; dx += 5) tg.fillStyle(INK, 0.25).fillRect(dx, ly - 3, 1.5, 1.5);
        const fs = T.levels.length > 3 ? 10 : 11;
        items.push(this.add.text(x0 + 18, ly + 1, String(i + 1), textStyle(fs, col)),
          this.add.text(x0 + 52, ly + 1, txt.replace(/^Armamenti: /, ''), textStyle(fs, col, i === lvl)).setWordWrapWidth(sx - x0 - 60).setMaxLines(1),
          this.add.text(sx, ly + 1, i < lvl ? 'fatto' : i === lvl ? 'prossimo' : 'da fare', italic(fs, i < lvl ? TEAL : i === lvl ? PALETTE.allerta : PALETTE.tenue)));
      });
      const c = this.profile.construction;
      const next = nextLevel(this.profile, spot);
      if (c && c.id === spot) {
        const total = BALANCE.camp.buildings[spot][lvl].timeSec * 1000;
        const pct = 1 - (c.until - now) / total;
        items.push(this.add.rectangle(x0 + 16, y0 + H - 70, W - 32, 10, PALETTE.inchiostro).setOrigin(0).setStrokeStyle(1, INK, 0.6));
        items.push(this.add.rectangle(x0 + 16, y0 + H - 70, (W - 32) * Phaser.Math.Clamp(pct, 0, 1), 10, PALETTE.allerta).setOrigin(0));
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
        }, 16, true));
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
      const r = this.add.rectangle(x, y, w, h, on ? PALETTE.pannelloAlto : PALETTE.inchiostro).setOrigin(0).setStrokeStyle(1, on ? PALETTE.ocra : INK, on ? 1 : ok ? 0.7 : 0.25)
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
      g.fillStyle(PALETTE.inchiostro, 1).fillRect(cx, y, cw, ch).lineStyle(1.2, ok ? INK : PALETTE.ko, ok ? 0.7 : 1).strokeRect(cx, y, cw, ch);
      drawResourceIcon(g, r, cx + 16, y + 18, 8);
      g.fillStyle(PALETTE.linea, 1).fillRect(cx + 8, y + ch - 9, cw - 16, 4);
      g.fillStyle(ok ? PALETTE.radioattivo : PALETTE.ko, 1).fillRect(cx + 8, y + ch - 9, (cw - 16) * Math.min(1, have[r] / cost[r]), 4);
      items.push(this.add.text(cx + 30, y + 18, String(cost[r]), textStyle(15, ok ? INK : PALETTE.ko)).setOrigin(0, 0.5),
        this.add.text(cx + cw - 8, y + 18, `hai ${have[r]}`, textStyle(9, PALETTE.tenue, false)).setOrigin(1, 0.5));
    });
    const tx = x + rs.length * (cw + 6);
    dashedBox(g, tx, y, cw, ch, INK, 0.7);
    items.push(this.add.text(tx + cw / 2, y + 14, 'tempo', italic(10)).setOrigin(0.5),
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
      const r = this.add.rectangle(x0 + 16, y, W - 32, h, PALETTE.inchiostro).setOrigin(0).setStrokeStyle(1.2, warn ? PALETTE.ko : INK, warn ? 1 : onClick ? 0.75 : 0.3);
      if (onClick) r.setInteractive({ useHandCursor: true }).on('pointerup', onClick).on('pointerover', () => r.setFillStyle(PALETTE.pannelloAlto)).on('pointerout', () => r.setFillStyle(PALETTE.inchiostro));
      items.push(r, this.add.text(x0 + 24, y + 5, label, italic(11, warn ? PALETTE.ko : TEAL)));
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
    row(y, 52, `REPARTI · ${deck.length} ${deck.length === 1 ? 'sbloccato' : 'sbloccati'}, tutti in campagna`, null);
    const dg = this.add.graphics();
    const dx = Math.min(110, (W - 60) / Math.max(1, deck.length));
    deck.forEach((t, k) => drawUnitIcon(dg, t, x0 + 34 + k * dx, y + 34, 8, PALETTE.carta));
    items.push(dg);
    if (dx >= 100) deck.forEach((t, k) => items.push(this.add.text(x0 + 48 + k * dx, y + 34, unitInfo(t).name, textStyle(10, PALETTE.carta, false)).setOrigin(0, 0.5))); // tanti reparti: solo i simboli
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
    // impero persistente: su questo fronte si torna nello stesso mondo finché non vinci
    const w = currentWorld(p, fi), left = BALANCE.ai.count - (w?.fallen.length ?? 0);
    const grudges = w?.rivals.filter((r) => r.relation === 'guerra').length ?? 0, allies = w?.rivals.filter((r) => r.relation === 'alleanza').length ?? 0;
    const worldLine = !w ? 'MONDO NUOVO · su questo fronte il mondo resta tra una campagna e l\'altra finché non vinci.'
      : `MONDO · campagna ${w.campaigns + 1} · riparti con ${w.core.length + 1} province · imperi caduti ${w.fallen.length}/${BALANCE.ai.count}`
        + (grudges ? ` · ${grudges} rival${grudges > 1 ? 'i' : 'e'} col rancore` : '') + (allies ? ` · ${allies} allea${allies > 1 ? 'ti' : 'to'}` : '');
    const brief = [
      worldLine,
      (frontText as { brief: string }[])[fi]?.brief ?? '',
      `OBIETTIVI · più province di tutti allo scadere, o fai cadere ${left === 3 ? 'i tre imperi rivali' : left === 1 ? "l'ultimo impero rivale" : `i ${left} imperi rimasti`}.`,
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
    }, 13, true));
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
      const r = this.add.rectangle(x0 + 16, y, W - 32, rh, k === sel ? PALETTE.pannelloAlto : PALETTE.inchiostro).setOrigin(0)
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

  /** primary = azione principale della scheda: riquadro avorio pieno (una sola per scheda); le altre solo col filo. */
  private btn(label: string, x: number, y: number, w: number, enabled: boolean, onClick: () => void, size = 16, primary = false) {
    const b = new Button(this, label, w, 40, () => enabled && onClick(), size);
    b.setPosition(x, y).setAlpha(enabled ? 1 : 0.45);
    if (primary && enabled) b.setPrimary();
    return b;
  }

  private toast(msg: string, color: number) {
    const { width } = view(this);
    this.lastToast?.destroy();
    const ty = this.portrait ? 160 : 90;
    const t = (this.lastToast = note(this, width / 2, ty - 20, Math.min(420, width - 40), msg, color).setDepth(60).setAlpha(0));
    this.tweens.add({ targets: t, alpha: 1, y: ty - 10, duration: 220 });
    this.tweens.add({ targets: t, alpha: 0, delay: 2800, duration: 400, onComplete: () => t.destroy() });
  }
}
