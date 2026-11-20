import { openAudioPanel } from '../ui/audioPanel';
import { music } from '../audio/music';
import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { PALETTE, hex } from '../config/palette';
import buildingText from '../data/buildings.json';
import {
  BUILDINGS, EXPEDITIONS, activeCiv, buildBlock, campaignChoice, canAfford, civChoice, collectExpedition, deckOf, expeditionCost, unlockedUnits,
  activeFront, enableTestMode, expeditionTimeSec, fmtTime, nextLevel, playerPower, settle, startBuild, startExpedition, stashCap, tents,
  SUPPLIES, buySupply, rush, rushCost, trade,
} from '../game/camp';
import shopText from '../data/shop.json';
import { CIV_IDS, civInfo, civUnlocked } from '../game/civs';
import { CIV_STYLE } from '../game/factions';
import { BRANCHES, TECH_IDS, loreFragments, loreTotal, settleResearch, techInfo } from '../game/tech';
import { unitInfo } from '../game/units';
import type { CampaignId } from '../config/balance';
import { RESOURCES, RESOURCE_INFO, type Bag } from '../game/resources';
import { randomSeed } from '../map/rng';
import { loadProfile, resetProfile, saveProfile, type BuildingId, type ExpeditionKind, type Profile } from '../save/storage';
import { analytics } from '../analytics/analytics';
import { FPS_KEY, fpsEnabled } from '../ui/debug';
import { askName } from '../ui/nameInput';
import { askField } from '../ui/askField';
import { LUME_PACKS, PREMIUM, rushLume, type PackId, type RushKind } from '../config/premium';
import { applyGrant, buyPack, confirmClaimed, fetchWallet, premiumOn, sendCode, signOut, signedEmail, spend, verifyCode, type SpendReq } from '../online/premium';
import { canStake, recoverStake, runOptions, stakeIndex } from '../game/camp';
import { Button } from '../ui/Button';
import { buzz } from '../ui/haptics';
import { safeInsets, uiCamera, view } from '../ui/screen';
import { civImage, coverImage, fade, techImage } from '../ui/images';
import { BRANCH_ICON } from '../ui/icons';
import { OPS, backBox, body, glass, heading, icon, label, panel, resIcon, rule, value } from '../ui/ops';
import { audioSettings, onAudioChange } from '../audio/engine';
import { type RoomId, type RoomState } from '../ui/roomArt';

const PAD = 12;
const IN = 20; // margine interno dei pannelli delle pagine
/** Testo lungo: rimpicciolito per stare nella larghezza (mai tagliato). */
const fit = <T extends Phaser.GameObjects.Text>(t: T, w: number): T => t.setScale(Math.min(1, w / Math.max(1, t.width)));
// pianta della base (riferimento di Nico: planimetria tecnica su ardesia)
// risorse mostrate l'ultima volta che la base era aperta: al rientro da una campagna i numeri scorrono fino ai nuovi
let shownStash: number[] | null = null;
const maxLvl = (id: BuildingId) => BALANCE.camp.buildings[id].length;
const INK = PALETTE.carta; // testi chiari sul fondo scuro

// 'gioca' = preparazione della campagna (sala operazioni), 'test' = modalità test; alloggi, archivio, cantiere e ricerca hanno la loro pagina
type Spot = BuildingId | 'spedizione' | 'gioca' | 'test' | 'mercato' | 'alloggi' | 'archivio' | 'cantiere' | 'ricerca';
type MapSpot = BuildingId | 'spedizione' | 'alloggi' | 'archivio' | 'mercato'; // le targhette dello schema
// base in sezione: tre piani di stanze, il Comando al centro del piano alto
const FLOORS: MapSpot[][] = [
  ['radar', 'comando', 'laboratorio'],
  ['arsenale', 'deposito', 'spedizione'],
  ['alloggi', 'archivio', 'mercato'],
];
// icona di ogni pagina (generate con Draw Things)
const STATION_ICON: Record<Spot, string> = {
  comando: 'st-comando', laboratorio: 'st-laboratorio', radar: 'st-radar', arsenale: 'st-arsenale', deposito: 'st-deposito',
  spedizione: 'st-estrazione', alloggi: 'st-alloggi', archivio: 'st-archivio', mercato: 'st-mercato', gioca: 'st-operazioni',
  cantiere: 'st-cantiere', ricerca: 'ui-ricerca', test: 'ui-info',
};
// nome sulla targa della stanza nella base (le pagine usano il nome intero)
const CELL: Record<MapSpot, string> = {
  comando: 'Centro di Comando', laboratorio: 'Laboratorio', radar: 'Sala Radar', arsenale: 'Arsenale', deposito: 'Deposito',
  spedizione: 'Estrazione', alloggi: 'Alloggi', archivio: 'Archivio', mercato: 'Mercato',
};
// foto di ogni stanza (generate in locale con Draw Things): nella base e come fondo della sua pagina
const ROOM_IMG: Record<Spot, string> = {
  comando: 'room-comando', laboratorio: 'room-laboratorio', radar: 'room-radar', arsenale: 'room-arsenale', deposito: 'room-deposito',
  spedizione: 'bg-estrazione', alloggi: 'room-alloggi', archivio: 'room-archivio', mercato: 'room-mercato',
  gioca: 'room-fronte', cantiere: 'room-vuota', ricerca: 'room-laboratorio', test: 'room-comando',
};
const CAMPAIGNS: CampaignId[] = ['breve', 'standard', 'lunga'];
const CAMPAIGN_NAME: Record<CampaignId, string> = { breve: 'Breve', standard: 'Standard', lunga: 'Lunga' };
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
/** Testo di un livello → [nome, effetto]: "Rapporti dal campo: eventi…" → ["Rapporti dal campo", "eventi…"]. */
const levelParts = (txt: string): [string, string] => {
  const t = txt.replace(/^Armamenti: /, ''), c = t.indexOf(':'), d = t.indexOf(' · ');
  if (c > 0) return [t.slice(0, c), t.slice(c + 1).trim()];
  if (d > 0) return [t.slice(0, d), t.slice(d + 3)];
  return [t, ''];
};
// pagine delle stanze: titolo e pianta da disegnare
const PAGE: Record<Spot, { name: string; room: RoomId | null }> = {
  comando: { name: 'Centro di Comando', room: 'comando' },
  laboratorio: { name: 'Laboratorio', room: 'laboratorio' },
  radar: { name: 'Sala Radar', room: 'radar' },
  arsenale: { name: 'Arsenale', room: 'arsenale' },
  deposito: { name: 'Deposito', room: 'deposito' },
  spedizione: { name: 'Squadre di Estrazione', room: 'spedizione' },
  alloggi: { name: 'Alloggi', room: 'alloggi' },
  archivio: { name: 'Archivio della Caduta', room: 'archivio' },
  mercato: { name: 'Mercato', room: 'mercato' },
  gioca: { name: 'Sala Operazioni', room: 'fronte' },
  cantiere: { name: 'Cantiere', room: 'cantiere' },
  ricerca: { name: 'Ricerca', room: 'ricerca' },
  test: { name: 'Modalità test', room: null },
};

/** Accampamento (home): piccolo all'inizio, cresce con edifici, tende e spedizioni. */
export class CampScene extends Phaser.Scene {
  profile!: Profile; // condiviso con l'albero della ricerca (TreeScene)
  private stripTexts: { cantiere?: Phaser.GameObjects.Text; ricerca?: Phaser.GameObjects.Text; estrazione?: Phaser.GameObjects.Text; audio?: Phaser.GameObjects.Text } = {};
  private clock: Phaser.GameObjects.Text | null = null;
  private portrait = false;
  private safe = { top: 0, right: 0, bottom: 0, left: 0 }; // notch e barra dei gesti (punti)
  private spots = new Map<Spot, { x: number; y: number; g: Phaser.GameObjects.Graphics; deco: Phaser.GameObjects.GameObject[]; label: Phaser.GameObjects.Text; w: number; h: number; left: number; top: number; img?: Phaser.GameObjects.Image }>();
  private stashTexts: Phaser.GameObjects.Text[] = [];
  private stashBars: Phaser.GameObjects.Rectangle[] = [];
  private counting: boolean[] = [];
  private stashBarW = 0;
  private capText: Phaser.GameObjects.Text | null = null;
  private statusText: Phaser.GameObjects.Text | null = null;
  private timerTexts = new Map<Spot, Phaser.GameObjects.Text>();
  private panel: Phaser.GameObjects.Container | null = null;
  private page: Phaser.GameObjects.Container | null = null; // pagina a tutto schermo della stanza (testata e pianta)
  private pageKey = '';
  private expKind: ExpeditionKind = 'breve'; // missione scelta nell'Estrazione
  private panelSpot: Spot | null = null;
  private panelMode = ''; // laboratorio: '' ricerche · 'archivio' · 'build'; radar: '' registro · 'build'
  private refreshAcc = 0;
  private panelKey = '';
  private lastToast: Phaser.GameObjects.Container | null = null;
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;
  private navBtns: { btn: { setOn: (on: boolean) => void; setVisible: (v: boolean) => void }; on: () => boolean }[] = [];
  private lume = { email: null as string | null, balance: null as number | null, busy: false }; // Lume (acquisti con soldi veri)

  constructor() {
    super('Camp');
  }

  create() {
    uiCamera(this);
    this.audioPanel = null;
    music.setMode('hq'); // musica della base: calma
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
    this.page = null;
    this.pageKey = ''; // la scena riparte (es. finestra ridimensionata): la pagina va ridisegnata
    this.panelSpot = null;
    const { width, height } = view(this);
    // verticale: edifici su due file (dietro sull'orizzonte, davanti in basso), campo al centro
    this.portrait = height > width;

    this.safe = safeInsets();
    this.drawBackdrop();
    this.drawHud();
    this.burst = this.add.particles(0, 0, 'dot', {
      speed: { min: 60, max: 180 }, lifespan: 600, scale: { start: 1, end: 0 }, emitting: false,
    }).setDepth(30);

    this.settleAll(true);
    this.introSpots();
    // tastiera (PC): INVIO = GIOCA, ESC = chiude la scheda aperta
    this.input.keyboard?.on('keydown-ENTER', () => { if (!this.panel && !document.getElementById('name-ask')) this.onPlay(); });
    this.input.keyboard?.on('keydown-ESC', () => this.closePanel());
    this.scale.once('resize', () => this.scene.restart());
    // alcune WebView (app iOS) al primissimo avvio leggono il notch come 0: un ricontrollo rapido corregge il layout
    this.time.delayedCall(300, () => { if (safeInsets().top !== this.safe.top) this.scene.restart(); });
    if (premiumOn) this.startLume();
  }

  /** Lume all'avvio: saldo e consegne in sospeso; al ritorno da Stripe (?lume=ok) aspetta l'accredito del webhook. */
  private startLume() {
    const q = new URLSearchParams(location.search), back = q.get('lume');
    if (back) {
      q.delete('lume');
      history.replaceState(null, '', location.pathname + (q.size ? `?${q}` : '') + location.hash);
    }
    if (back === 'annullato') this.time.delayedCall(700, () => this.toast('Pagamento annullato\nNessun addebito.', PALETTE.allerta));
    const before = this.lume.balance;
    void this.syncLume().then(async () => {
      if (back !== 'ok') return;
      // il webhook di Stripe può arrivare qualche secondo dopo il ritorno: ricontrolla per ~20 s
      for (let i = 0; i < 10 && this.scene.isActive() && (this.lume.balance ?? 0) <= (before ?? 0); i++) {
        await new Promise((r) => setTimeout(r, 2000));
        await this.syncLume();
      }
      if (this.scene.isActive()) this.toast(`Pagamento ricevuto\nSaldo: ${this.lume.balance ?? 0} Lume.`, PALETTE.radioattivo);
    });
  }

  /** Rilegge saldo e consegne dal server, applica le consegne al profilo, salva, poi le segna come ritirate. */
  private async syncLume() {
    this.lume.email = await signedEmail();
    if (!this.lume.email) { this.lume.balance = null; return this.refreshShop(); }
    const r = await fetchWallet();
    if (!r.ok) return this.refreshShop();
    this.lume.balance = r.data.lume;
    this.applyGrants(r.data.grants);
    this.refreshShop();
  }

  private applyGrants(grants: Parameters<typeof applyGrant>[1][]) {
    if (!grants.length) return;
    const p = this.profile, now = Date.now();
    for (const g of grants) applyGrant(p, g, now);
    saveProfile(p);
    this.updateStash();
    this.settleAll(false);
    void confirmClaimed(grants.map((g) => g.id));
  }

  private refreshShop() {
    if (this.scene.isActive() && this.panelSpot === 'mercato') this.openPanel('mercato');
  }

  private lumeLogin() {
    askField({ title: shopText.lume.login, note: shopText.lume.loginNote, placeholder: 'nome@esempio.it', type: 'email', maxLength: 120, inputMode: 'email' }, async (email) => {
      if (!email) return;
      if (!(await sendCode(email))) return this.toast('Email non valida\nControlla e riprova.', OPS.loss);
      askField({ title: shopText.lume.codeTitle, note: shopText.lume.codeNote.replace('{email}', email), placeholder: '123456', type: 'text', maxLength: 10, inputMode: 'numeric' }, async (code) => {
        if (!code) return;
        if (!(await verifyCode(email, code.replace(/\s/g, '')))) return this.toast('Codice sbagliato o scaduto\nRichiedi un codice nuovo.', OPS.loss);
        await this.syncLume();
      });
    });
  }

  /** Spesa di Lume: il server scala e consegna, il gioco applica la consegna. */
  private async lumeSpend(req: SpendReq) {
    if (this.lume.busy) return;
    this.lume.busy = true;
    const r = await spend(req);
    this.lume.busy = false;
    if (!r.ok) {
      this.toast(r.error === 'lume' ? 'Lume insufficiente\nCompra un pacchetto.' : 'Operazione non riuscita\nRiprova tra poco.', OPS.loss);
      return this.syncLume();
    }
    this.lume.balance = r.data.lume;
    buzz(12);
    this.applyGrants([r.data.grant]);
    this.refreshShop();
  }

  private async lumeBuy(pack: PackId) {
    if (this.lume.busy) return;
    this.lume.busy = true;
    const err = await buyPack(pack);
    this.lume.busy = false;
    if (err) this.toast('Pagamento non disponibile\nRiprova tra poco.', OPS.loss);
  }

  /** Sezione Lume in cima al Mercato: accesso, saldo, pacchetti, risorse. Ritorna la y sotto. */
  private fillLume(items: Phaser.GameObjects.GameObject[], L: number, y: number, w: number): number {
    const T = shopText.lume, e = this.lume;
    y = this.head(items, L, y, w, T.title, e.balance === null ? '' : `${e.balance} Lume`, OPS.accent);
    if (!e.email) {
      const d = body(this, L, y, T.desc, 12, OPS.body, w);
      items.push(d, this.btn(T.login, L, d.y + d.height + 10, w, true, () => this.lumeLogin(), 12));
      return d.y + d.height + 10 + 40 + 16;
    }
    const ids = Object.keys(LUME_PACKS) as PackId[], pw = (w - (ids.length - 1) * 6) / ids.length;
    ids.forEach((k, i) => {
      const P = LUME_PACKS[k], eur = (P.cents / 100).toFixed(2).replace('.', ',');
      items.push(this.btn(`${P.lume} LUME · ${eur} €`, L + i * (pw + 6), y, pw, !e.busy, () => void this.lumeBuy(k), 11));
    });
    y += 46;
    const R = PREMIUM.resources;
    items.push(this.btn(T.resources.replace('{amount}', String(R.amount)).replace('{cost}', String(R.cost)), L, y, w,
      !e.busy && (e.balance ?? 0) >= R.cost, () => void this.lumeSpend({ item: 'resources' }), 12));
    y += 46;
    items.push(label(this, L, y + 4, '', OPS.label, 10).setText(e.email).setOrigin(0, 0.5),
      label(this, L + w, y + 4, T.out, OPS.accent, 10).setOrigin(1, 0.5).setInteractive({ useHandCursor: true })
        .on('pointerup', () => void signOut().then(() => this.syncLume())));
    return y + 22;
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
    const c = this.profile.construction, rs = this.profile.research;
    // lavori in corso: ambra se attivi, grigio se fermi, verde se c'è qualcosa da ritirare
    const e = this.profile.expedition;
    this.stripTexts.cantiere?.setText(c ? `${buildingText[c.id].name} → liv ${this.profile.buildings[c.id] + 1} · ${fmtTime(c.until - now)}` : 'Libero · tocca una stanza')
      .setColor(hex(c ? PALETTE.allerta : OPS.label));
    this.stripTexts.ricerca?.setText(rs ? `${techInfo(rs.id).name} · ${fmtTime(rs.until - now)}` : this.profile.buildings.laboratorio ? 'Ferma · scegli un progetto' : 'Serve il Laboratorio')
      .setColor(hex(rs ? PALETTE.allerta : OPS.label));
    this.stripTexts.estrazione?.setText(!e ? 'Squadre pronte a partire' : e.until <= now ? 'Di ritorno · ritira il bottino' : `${buildingText.spedizione.kinds[e.kind]} · ${fmtTime(e.until - now)}`)
      .setColor(hex(!e ? OPS.label : e.until <= now ? OPS.gain : PALETTE.allerta));
    for (const [spot, t] of this.timerTexts) {
      const r = this.profile.research, was = t.text;
      t.setText(spot === 'spedizione' ? (e && e.until > now ? fmtTime(e.until - now) : '')
        : c && c.id === spot ? fmtTime(c.until - now) : spot === 'laboratorio' && r ? fmtTime(r.until - now) : '');
      if (!!was !== !!t.text) this.paintRow(spot as MapSpot, false); // la targhetta del tempo compare o sparisce
      if (t.text && !t.getData('ic')) t.setData('ic', icon(this, 'ui-tempo', 0, t.y, 12, PALETTE.allerta).setDepth(6));
      (t.getData('ic') as Phaser.GameObjects.Image | undefined)?.setPosition(t.x - t.width - 12, t.y).setVisible(!!t.text);
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
    if (spot === 'alloggi') return `alloggi|${tents(p)}`;
    if (spot === 'archivio') return `archivio|${p.techs.length}`;
    if (spot === 'cantiere') return `cantiere|${BUILDINGS.map((b) => p.buildings[b]).join(',')}|${p.construction?.id ?? ''}|${RESOURCES.map((r) => p.stash[r]).join(',')}${p.construction ? ':timer' : ''}`;
    if (spot === 'ricerca') return `ricerca|${p.techs.length}|${p.research?.id ?? ''}${p.research ? ':timer' : ''}`;
    const lab = spot === 'laboratorio' ? `|${this.panelMode}|${p.techs.length}|${p.research?.id ?? ''}` : '';
    return `${p.buildings[spot]}|${p.construction?.id ?? ''}|${RESOURCES.map((r) => p.stash[r]).join(',')}${lab}${p.construction?.id === spot || (lab && p.research) ? ':timer' : ''}`;
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
      for (const id of this.spots.keys()) this.redrawSpot(id as MapSpot);
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
  // Base vista in sezione, alla XCOM 2 (scelta di Nico): la montagna di notte, dentro tre piani di stanze illustrate; ogni stanza
  // è una postazione che si tocca. Barra sottile in alto (comandante, scorte, audio), a destra i lavori in corso e in fondo
  // la prossima operazione con l'azione principale. In verticale le stanze vanno su due colonne e la colonna di destra va sotto.

  /** Fondo scuro sotto tutto; la montagna la mette drawHud, che sa dove iniziano le stanze. */
  private drawBackdrop() {
    this.cameras.main.setBackgroundColor(0x05080d);
  }

  /**
   * La montagna della base di notte (vetta con il radar): a tutta larghezza, con la parabola appena sotto la barra in alto;
   * la roccia tagliata continua dietro le stanze.
   */
  private placeMountain(skyTop: number, rockY: number) {
    const { width, height } = view(this);
    const img = this.add.image(0, 0, 'base-esterno').setOrigin(0.5, 0).setDepth(-1).setTint(0xc4d0dc);
    const DISH = 0.22; // dove sta la cima della parabola nell'immagine (in altezza)
    const s = Math.max(width / img.width, height / img.height);
    img.setScale(s).setPosition(width / 2, Math.max(height - img.height * s, Math.min(0, skyTop - DISH * img.height * s)));
    fade(this, 0, rockY, width, height - rockY, 0x05080d, 0.2, 0.7).setDepth(-1);
  }

  /** Immagine della stanza: illustrata se costruita, cantiere vuoto se no. */
  private roomKey(id: MapSpot): string {
    const isB = (BUILDINGS as string[]).includes(id), lvl = isB ? this.profile.buildings[id as BuildingId] : 1;
    const locked = id === 'mercato' && this.profile.runs === 0;
    return lvl > 0 && !locked ? ROOM_IMG[id] : 'room-vuota';
  }

  /** Stanza della base: foto ritagliata nella cella, targa in basso (icona, nome, livello, stato), tutta la cella si tocca. */
  private makeSpot(id: MapSpot, x: number, y: number, w: number, h: number) {
    const g = this.add.graphics().setDepth(3);
    const ph = this.plaqueH(h);
    const name = heading(this, x + 32, y + h - ph / 2, CELL[id], 14).setOrigin(0, 0.5).setDepth(6);
    this.spots.set(id, { x: x + w / 2, y: y + h / 2, g, deco: [], label: name, w, h, left: x, top: y });
    // tempo che manca (cantiere, ricerca, squadre): in alto a destra su una targhetta scura
    const timer = label(this, x + w - 10, y + 15, '', PALETTE.allerta, 10).setOrigin(1, 0.5).setDepth(6);
    this.timerTexts.set(id, timer);
    const hit = this.add.rectangle(x, y, w, h, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true }).setDepth(7);
    let pressed = false; // apre solo se il tocco è iniziato qui
    hit.on('pointerdown', () => { pressed = true; buzz(8); });
    hit.on('pointerover', () => this.paintRow(id, true));
    hit.on('pointerout', () => { pressed = false; this.paintRow(id, false); });
    hit.on('pointerup', () => {
      if (!pressed) return;
      pressed = false;
      if (id === 'mercato' && this.profile.runs === 0) { this.toast('Il Mercato apre dopo la prima campagna', PALETTE.carta); return; }
      this.tapRing(id, OPS.text, 1);
      this.openPanel(id);
    });
  }

  private plaqueH = (h: number) => Phaser.Math.Clamp(h * 0.26, 34, 42);

  /** Cornice e targa della stanza; sotto il mouse la foto si accende e la cornice diventa bianca. */
  private paintRow(id: MapSpot, hover: boolean) {
    const r = this.spots.get(id);
    if (!r) return;
    const built = this.roomKey(id) !== 'room-vuota', ph = this.plaqueH(r.h);
    r.img?.setTint(hover ? 0xffffff : built ? 0xc9d2da : 0x56606a);
    r.g.clear();
    r.g.fillGradientStyle(0x05080d, 0x05080d, 0x05080d, 0x05080d, 0, 0, 0.85, 0.85).fillRect(r.left, r.top + r.h - ph * 1.9, r.w, ph * 0.9);
    r.g.fillStyle(0x05080d, 0.85).fillRect(r.left, r.top + r.h - ph, r.w, ph);
    // il tempo che manca sta su una targhetta in alto a destra
    const t = this.timerTexts.get(id);
    if (t?.text) r.g.fillStyle(0x05080d, 0.85).fillRect(t.x - t.width - 30, r.top + 5, t.width + 36, 20);
    r.g.lineStyle(hover ? 2 : 1, hover ? 0xffffff : OPS.edge, hover ? 0.95 : 0.4).strokeRect(r.left + 0.5, r.top + 0.5, r.w - 1, r.h - 1);
  }

  /** Stato della stanza: foto, icona, livello, stato (da costruire, migliorabile, di ritorno); i timer li scrive update(). */
  private redrawSpot(id: MapSpot) {
    const spot = this.spots.get(id);
    if (!spot) return;
    spot.deco.forEach((d) => d.destroy());
    spot.deco = [];
    const { left: x, top: y, w, h } = spot;
    spot.img = coverImage(this, this.roomKey(id), x, y, w, h, 0.5).setDepth(2);
    spot.deco.push(spot.img);
    const isB = (BUILDINGS as string[]).includes(id), lvl = isB ? this.profile.buildings[id as BuildingId] : 1, max = isB ? maxLvl(id as BuildingId) : 0;
    const building = isB && this.profile.construction?.id === id, locked = id === 'mercato' && this.profile.runs === 0, built = lvl > 0 && !locked;
    const ph = this.plaqueH(h), cy = y + h - ph / 2;
    spot.label.setColor(hex(built ? OPS.text : OPS.body));
    spot.deco.push(icon(this, STATION_ICON[id], x + 16, cy, 18, built ? OPS.text : OPS.label).setDepth(6));
    // a destra della targa: livello, oppure lo stato quando conta (da costruire, migliorabile, di ritorno, chiuso)
    const e = id === 'spedizione' ? this.profile.expedition : null;
    const upgradable = isB && built && lvl < max && !building && !buildBlock(this.profile, id as BuildingId);
    const state: [string, number] | null = locked ? ['Chiuso', OPS.label] : building ? ['In cantiere', PALETTE.allerta] : !built ? ['Da costruire', OPS.label]
      : e && e.until <= Date.now() ? ['Di ritorno', OPS.gain] : upgradable ? ['Migliorabile', OPS.gain] : null;
    const right = state ? label(this, x + w - 10, cy, state[0], state[1], 9) : max ? label(this, x + w - 10, cy, `Liv ${lvl}/${max}`, OPS.label, 9) : null;
    if (right) spot.deco.push(right.setOrigin(1, 0.5).setDepth(6));
    spot.label.setScale(1);
    fit(spot.label, w - 42 - (right ? right.width + 10 : 0));
    this.paintRow(id, false);
  }

  // ---------- interfaccia ----------

  private drawHud() {
    const { width, height } = view(this);
    const P = this.portrait, p = this.profile;
    const M = P ? 10 : 18, T = M + this.safe.top, B = M + this.safe.bottom;
    const g = this.add.graphics().setDepth(1);

    // barra in alto: ritratto e nome del comandante (si tocca per cambiarlo), scorte con le loro icone, audio
    const barH = P ? 84 : 52, barY = T, L = M, R = width - M;
    glass(g, L, barY, R - L, barH);
    const ps = P ? 40 : 38, px = L + 8, py = barY + (P ? 8 : (barH - ps) / 2);
    coverImage(this, 'comandante', px, py, ps, ps, 0.2).setDepth(2);
    g.lineStyle(1, OPS.edge, 0.6).strokeRect(px + 0.5, py + 0.5, ps - 1, ps - 1);
    const title = value(this, px + ps + 12, py + 2, 'ARCHEON', P ? 18 : 18).setDepth(2);
    // 5 tocchi sul titolo = contatore FPS nelle run (test sui telefoni)
    let taps = 0;
    title.setInteractive().on('pointerup', () => {
      if (++taps < 5) return;
      taps = 0;
      const on = !fpsEnabled();
      try { localStorage.setItem(FPS_KEY, on ? '1' : '0'); } catch { /* niente storage */ }
      this.toast(on ? 'Contatore FPS attivo nelle run' : 'Contatore FPS spento', PALETTE.carta);
    });
    label(this, title.x, py + ps - 1, `${p.name || 'Comandante'} · cambia nome`, OPS.label, 9).setOrigin(0, 1).setDepth(2)
      .setInteractive({ useHandCursor: true }).on('pointerup', () => this.editName());
    // audio: un'icona all'estremo destro
    const aIcon = icon(this, audioSettings().muted ? 'ui-muto' : 'ui-audio', R - 22, barY + (P ? 22 : barH / 2), 20, OPS.text).setDepth(2)
      .setInteractive({ useHandCursor: true }).on('pointerup', () => this.toggleAudio(R - 236, barY));
    const off = onAudioChange(() => aIcon.setTexture(`ic-${audioSettings().muted ? 'ui-muto' : 'ui-audio'}`).setDisplaySize(20, 20));
    this.events.once('shutdown', off);
    this.stripTexts.audio = undefined;
    // scorte: icona della risorsa (nel suo colore) + numero; in verticale su una riga sotto il nome
    this.stashBars = [];
    const sy = P ? barY + barH - 16 : barY + barH / 2, step = P ? (R - L - 16) / 3 : 112;
    let sx = P ? L + 10 : R - 56 - 3 * step;
    this.stashTexts = RESOURCES.map((r) => {
      resIcon(this, r, sx + 10, sy, 20).setDepth(2);
      const t = heading(this, sx + 26, sy, '0', 15).setOrigin(0, 0.5).setDepth(2);
      sx += step;
      return t;
    });
    this.capText = null;
    this.statusText = null;
    // tasto TEST solo in sviluppo o con ?test=1 nell'indirizzo
    const testOk = import.meta.env.DEV || p.test || new URLSearchParams(location.search).has('test');
    if (testOk) label(this, R - 2, barY + barH + 6, p.test ? 'Test attivo' : 'Test', PALETTE.allerta, 8).setOrigin(1, 0).setDepth(2)
      .setInteractive({ useHandCursor: true }).on('pointerup', () => this.openPanel('test'));

    // colonna di destra (in verticale: fascia in fondo): lavori in corso e prossima operazione
    const top = barY + barH + (P ? 26 : 14), bottom = height - B;
    const sideW = P ? R - L : Phaser.Math.Clamp(width * 0.25, 250, 330);
    const footH = P ? 196 : 0;
    const side = P ? { x: L, y: bottom - footH, w: sideW, h: footH } : { x: R - sideW, y: top, w: sideW, h: bottom - top };
    this.drawOps(g, side.x, side.y, side.w, side.h, P);

    // stanze: tre piani nella roccia sotto la vetta (in verticale il Comando largo in cima, poi due colonne)
    const gap = P ? 6 : 8;
    const area = P ? { x: L, y: top, w: R - L, h: side.y - 10 - top } : { x: L, y: top, w: side.x - 14 - L, h: bottom - top };
    const surface = P ? 0 : Math.min(170, area.h * 0.2); // in orizzontale si vede la vetta con il radar sopra le stanze
    const rows: MapSpot[][] = P
      ? [['comando'], ['radar', 'laboratorio'], ['arsenale', 'deposito'], ['spedizione', 'alloggi'], ['archivio', 'mercato']]
      : FLOORS;
    const ry0 = area.y + surface, rh = (area.h - surface - gap * (rows.length - 1)) / rows.length;
    this.placeMountain(barY + barH + 4, ry0);
    // roccia scura dietro le stanze, come la sezione della montagna
    g.fillStyle(0x070a0e, 0.72).fillRect(area.x - 4, ry0 - 4, area.w + 8, area.h - surface + 8);
    rows.forEach((row, r) => {
      const cw = (area.w - gap * (row.length - 1)) / row.length;
      row.forEach((id, c) => this.makeSpot(id, area.x + c * (cw + gap), ry0 + r * (rh + gap), cw, rh));
    });
  }

  /**
   * Lavori in corso (cantiere, ricerca, estrazione: righe con icona che si toccano) e prossima operazione con AVVIA CAMPAGNA in
   * fondo, come la coda degli eventi e il tasto della mappa in XCOM 2.
   */
  private drawOps(_g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, P: boolean) {
    const p = this.profile;
    const rowH = P ? 30 : 52, rows: ['cantiere' | 'ricerca' | 'estrazione', string, string, Spot][] = [
      ['cantiere', 'Cantiere', 'st-cantiere', 'cantiere'], ['ricerca', 'Ricerca', 'ui-ricerca', 'ricerca'], ['estrazione', 'Estrazione', 'st-estrazione', 'spedizione'],
    ];
    let yy = y;
    if (!P) {
      heading(this, x, y, 'In corso', 15).setDepth(2);
      yy += 28;
    }
    for (const [key, name, ic, spot] of rows) {
      const r = this.add.rectangle(x, yy, w, rowH, OPS.row, 0.62).setOrigin(0).setStrokeStyle(1, OPS.edge, 0.32).setDepth(1)
        .setInteractive({ useHandCursor: true }).on('pointerup', () => this.openPanel(spot))
        .on('pointerover', () => r.setFillStyle(OPS.row, 0.92)).on('pointerout', () => r.setFillStyle(OPS.row, 0.62));
      icon(this, ic, x + (P ? 16 : 22), yy + rowH / 2, P ? 16 : 22, OPS.text).setDepth(2);
      if (P) {
        label(this, x + 32, yy + rowH / 2, name, OPS.label, 9).setOrigin(0, 0.5).setDepth(2);
        this.stripTexts[key] = label(this, x + w - 10, yy + rowH / 2, '', OPS.text, 9).setOrigin(1, 0.5).setDepth(2);
      } else {
        label(this, x + 44, yy + 15, name, OPS.label, 9).setOrigin(0, 0.5).setDepth(2);
        this.stripTexts[key] = heading(this, x + 44, yy + 35, '', 13).setOrigin(0, 0.5).setDepth(2);
      }
      yy += rowH + (P ? 4 : 6);
    }
    // prossima operazione: fronte, potenza contro consigliata, AVVIA CAMPAGNA (ruggine) nell'angolo in basso a destra
    const fi = activeFront(p), F = BALANCE.fronts[fi], yours = playerPower(p), weak = yours < F.power;
    const bh = P ? 50 : 58, by = y + h - bh;
    const play = new Button(this, 'AVVIA CAMPAGNA', w, bh, () => this.onPlay(), 17).setPrimary();
    play.setPosition(x, by).setDepth(20);
    if (P) {
      icon(this, 'st-operazioni', x + 8, by - 16, 14, OPS.accent).setDepth(2);
      label(this, x + 22, by - 16, `Fronte ${ROMAN[fi]} · ${F.name}`, OPS.text, 10).setOrigin(0, 0.5).setDepth(2);
      icon(this, 'ui-potenza', x + w - 74, by - 16, 14, weak ? OPS.loss : OPS.label).setDepth(2);
      label(this, x + w - 64, by - 16, F.power ? `${yours}/${F.power}` : `${yours}`, weak ? OPS.loss : OPS.text, 10).setOrigin(0, 0.5).setDepth(2);
      return;
    }
    const oy = by - (weak ? 172 : 146);
    // nello spazio libero sopra, la sala operazioni (come la carta della missione in XCOM 2)
    const imgY = yy + 10, imgH = oy - 14 - imgY;
    if (imgH > 70) {
      coverImage(this, this.frontImage(fi), x, imgY, w, imgH, 0.45).setDepth(1).setTint(0xd4dce4); // l'immagine del fronte
      this.add.rectangle(x, imgY, w, imgH, 0, 0).setOrigin(0).setStrokeStyle(1, OPS.edge, 0.4).setDepth(2);
    }
    icon(this, 'st-operazioni', x + 8, oy + 8, 15, OPS.accent).setDepth(2);
    label(this, x + 22, oy + 8, 'Prossima operazione', OPS.accent, 9).setOrigin(0, 0.5).setDepth(2);
    if (p.runs > 0) label(this, x + w, oy + 8, 'Cambia fronte', OPS.label, 9).setOrigin(1, 0.5).setDepth(2)
      .setInteractive({ useHandCursor: true }).on('pointerup', () => this.openPanel('gioca', 'fronti'));
    const big = value(this, x - 1, oy + 22, `Fronte ${ROMAN[fi]}`, 40).setDepth(2);
    body(this, x + 1, big.y + big.height - 2, F.name, 14, OPS.text).setDepth(2);
    // potenza: la tua contro quella consigliata, con l'icona del pugno
    const pw = big.y + big.height + 30;
    icon(this, 'ui-potenza', x + 10, pw + 9, 18, weak ? OPS.loss : OPS.text).setDepth(2);
    const yv = heading(this, x + 26, pw + 9, `${yours}`, 18, weak ? OPS.loss : OPS.text).setOrigin(0, 0.5).setDepth(2);
    label(this, yv.x + yv.width + 6, pw + 10, F.power ? `potenza · consigliata ${F.power}` : 'potenza', OPS.label, 9).setOrigin(0, 0.5).setDepth(2);
    if (weak) body(this, x, pw + 26, 'Nemici più forti: potenzia la base prima di partire.', 11, OPS.loss, w).setDepth(2);
  }

  private audioPanel: Phaser.GameObjects.Container | null = null;

  /** Impostazioni audio sopra (o sotto) il tasto AUDIO. */
  private toggleAudio(x: number, y: number) {
    if (this.audioPanel?.active) { this.audioPanel.destroy(); this.audioPanel = null; return; }
    const H = 26 + 34 * 4 + 6, { width, height } = view(this);
    const px = Math.min(x, width - 236 - 8), py = y - H - 8 >= 8 ? y - H - 8 : Math.min(y + 42, height - H - 8);
    this.audioPanel = openAudioPanel(this, px, py, 'camp');
  }

  // (bacheca operativa tolta: le sue voci sono ora targhette, timer sotto le targhette e tasti secondari)
  private updateBoard() {}

  /** Navigazione: non serve più (il Mercato è una targhetta dello schema). */
  private refreshNav() {
    for (const { btn, on } of this.navBtns) btn.setOn(on());
  }

  /** GIOCA: la prima volta parte la run guidata, poi si apre la preparazione della campagna. */
  private onPlay() {
    if (this.profile.runs === 0) this.scene.start('Load', { next: 'Run', data: { seed: randomSeed() } });
    else this.openPanel('gioca');
  }

  /** Anello che si allarga e svanisce attorno a una targhetta: tocco (piccolo) o lavori finiti (grande). */
  private tapRing(id: MapSpot, color: number, size: number) {
    const spot = this.spots.get(id);
    if (!spot) return;
    const { w, h } = spot;
    const g = this.add.graphics({ x: spot.x, y: spot.y }).setDepth(8);
    g.lineStyle(2, color, 0.9).strokeRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8);
    g.setScale(0.98 * size);
    this.tweens.add({ targets: g, scale: 1.04 * size, alpha: 0, duration: size > 1 ? 650 : 280, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
  }

  /** Entrata: le targhette compaiono una dopo l'altra lungo i fili. */
  private introSpots() {
    this.cameras.main.fadeIn(300, 5, 9, 15);
    [...this.spots.values()].forEach((spot, k) => {
      const parts = [spot.g, spot.label, ...spot.deco.filter((d) => 'setAlpha' in d && !this.tweens.isTweening(d))] as unknown as Phaser.GameObjects.Components.Alpha[];
      for (const d of parts) d.setAlpha(0);
      this.tweens.add({ targets: parts, alpha: 1, duration: 260, delay: 80 + k * 60 });
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
    this.page?.destroy();
    this.page = null;
    this.pageKey = '';
    this.panelSpot = null;
    for (const { btn } of this.navBtns) btn.setVisible(true);
    this.refreshNav();
  }

  /** Stato della stanza che la pianta disegna (livello, scorte, posti, frammenti, mezzi fuori, reparti). */
  private roomState(spot: Spot): RoomState {
    const p = this.profile, isB = (BUILDINGS as string[]).includes(spot), now = Date.now();
    const st: RoomState = { lvl: isB ? p.buildings[spot as BuildingId] : 1, building: isB && p.construction?.id === spot };
    if (spot === 'deposito' || spot === 'mercato') {
      const cap = stashCap(p);
      st.fill = Object.fromEntries(RESOURCES.map((r) => [r, Number.isFinite(cap) ? Math.round(Math.min(1, p.stash[r] / cap) * 20) / 20 : 1]));
    }
    if (spot === 'alloggi') st.count = tents(p);
    if (spot === 'archivio') st.count = loreFragments(p).length;
    if (spot === 'spedizione') st.count = p.expedition && p.expedition.until > now ? 1 : 0;
    if (spot === 'arsenale') st.units = unlockedUnits(p);
    return st;
  }

  /**
   * Pagina a tutto schermo della stanza: testata (titolo, livello, scorte, Back) sopra la foto della stanza, fascicolo a destra
   * (in verticale sotto). Si ridisegna solo quando cambia la stanza o il suo stato, così le luci animate non ripartono a ogni
   * timer. Restituisce il riquadro del fascicolo (a destra o sotto), dove va il contenuto della stanza.
   */
  private drawPage(spot: Spot) {
    const { width, height } = view(this);
    const P = this.portrait, T = PAD + this.safe.top, Bm = PAD + this.safe.bottom, head = P ? 116 : 104, info = PAGE[spot], p = this.profile;
    const top = T + head;
    // la stanza si vede a sinistra (in verticale sopra), il fascicolo sta a destra (sotto), come le stanze di XCOM 2
    let x0: number, y0: number, W: number, H: number;
    if (spot === 'spedizione') { x0 = 0; y0 = 0; W = width; H = height; }
    else if (!info.room) { x0 = PAD; y0 = top; W = width - 2 * PAD; H = height - top - Bm; }
    else if (P) {
      const ah = Math.min(height * 0.2, width * 0.6);
      x0 = PAD; y0 = top + ah + 10; W = width - 2 * PAD; H = height - y0 - Bm;
    } else {
      const aw = Math.min(width * 0.56, (height - top - Bm) * 1.45);
      x0 = PAD + aw + 12; y0 = top; W = width - x0 - PAD; H = height - top - Bm;
    }
    const st = this.roomState(spot);
    const key = `${spot}|${JSON.stringify(st)}|${RESOURCES.map((r) => p.stash[r]).join(',')}|${width}x${height}`;
    if (key !== this.pageKey) {
      const fresh = !this.page;
      this.page?.destroy();
      this.pageKey = key;
      // fondo: la foto della stanza a tutto schermo (l'elicottero per l'Estrazione, come nel Figma), velata solo dietro
      // al titolo e al fascicolo
      const ext = spot === 'spedizione';
      const objs: Phaser.GameObjects.GameObject[] = [
        this.add.rectangle(0, 0, width, height, 0x07090c, 1).setOrigin(0).setInteractive(), // la base sotto non riceve i tocchi
        ext ? coverImage(this, 'bg-estrazione', 0, 0, width, height, 0.5)
          : coverImage(this, ROOM_IMG[spot], 0, 0, width, height, 0.5).setTint(0xd4dce4),
      ];
      if (!ext) {
        objs.push(fade(this, 0, 0, width, T + 120, 0x05080d, 0.8, 0));
        if (!info.room) objs.push(this.add.rectangle(0, 0, width, height, 0x05080d, 0.55).setOrigin(0));
        else if (P) objs.push(fade(this, 0, y0 - 60, width, height - y0 + 60, 0x05080d, 0, 0.85));
        else objs.push(fade(this, x0 - 80, 0, width - x0 + 80, height, 0x05080d, 0, 0.6, 'h')); // il fascicolo ha il suo fondo: il velo resta leggero
      }
      // testata: titolo grande a sinistra, Back a destra (Figma di Nico)
      const hg = this.add.graphics();
      // la testata respira dal bordo in alto (prima il titolo lo toccava)
      const barY = T + (P ? 4 : 8), barH = P ? 84 : 56, titleY = barY + (P ? 18 : barH / 2);
      const isB = (BUILDINGS as string[]).includes(spot), lvl = isB ? p.buildings[spot as BuildingId] : 0, max = isB ? maxLvl(spot as BuildingId) : 0;
      const em = ext && !P ? width * 0.05 : PAD, ty = ext && !P ? Math.max(titleY, height * 0.1) : titleY; // l'Estrazione ha i margini larghi del Figma
      // icona della pagina, titolo, sotto il livello in parole (niente tacche)
      const ix = em + (ext ? 0 : 4);
      if (!ext) objs.push(icon(this, STATION_ICON[spot], ix + 14, ty, 26, OPS.text));
      const tsize = Phaser.Math.Clamp(width * 0.03, P ? 26 : 30, 48);
      const title = value(this, ext ? ix : ix + 38, ty - (isB ? 8 : 0), ext ? 'Extraction squads' : info.name, tsize).setOrigin(0, 0.5);
      fit(title, width - em - 104 - 16 - title.x); // il titolo lungo non finisce sotto il Back (telefono)
      objs.push(hg, title, ...backBox(this, width - em, ty - 18, () => this.closePanel()));
      if (isB) objs.push(label(this, title.x + 1, title.y + title.displayHeight / 2 + 2, st.building ? `In cantiere verso il livello ${lvl + 1}` : lvl ? `Livello ${lvl} di ${max}` : 'Da costruire',
        st.building ? PALETTE.allerta : OPS.label, 9));
      // scorte: icona nel colore della risorsa e numero, a sinistra del Back (in verticale sotto il titolo)
      let sx = P ? PAD + 4 : width - PAD - 104 - 24 - 3 * 92;
      const sy = barY + (P ? barH - 10 : barH / 2);
      if (!ext) RESOURCES.forEach((r) => {
        objs.push(resIcon(this, r, sx + 9, sy, 18), heading(this, sx + 24, sy, String(p.stash[r]), 15).setOrigin(0, 0.5));
        sx += P ? 96 : 92;
      });
      this.page = this.add.container(0, 0, objs).setDepth(39);
      if (fresh) {
        this.page.setAlpha(0);
        this.tweens.add({ targets: this.page, alpha: 1, duration: 200, ease: 'Quad.easeOut' });
      }
    }
    return { x0, y0, W, H };
  }

  /** Alloggi: i posti branda (crescono con le campagne). */
  /** Alloggi: i posti branda (crescono con le campagne), una riga per branda con l'icona del letto. */
  private fillAlloggi(items: Phaser.GameObjects.GameObject[], L: number, y: number, w: number): number {
    const p = this.profile, n = tents(p), max = BALANCE.camp.tentsMax;
    const d = body(this, L, y, 'Le squadre che tornano dal fronte dormono qui. Un posto branda in più ogni due campagne combattute.', 13, OPS.text, w);
    items.push(d);
    y = this.head(items, L, d.y + d.height + 18, w, 'Brande', `${n} di ${max}`);
    for (let i = 0; i < max; i++) {
      const ry = y + i * 40, on = i < n, wait = (i - n) * 2 + 2 - (p.runs % 2);
      this.rowBox(items, L, ry, w, 34, undefined, undefined, !on);
      items.push(icon(this, 'st-alloggi', L + 18, ry + 17, 16, on ? OPS.text : OPS.label),
        heading(this, L + 38, ry + 17, `Branda ${i + 1}`, 14, on ? OPS.text : OPS.label).setOrigin(0, 0.5),
        label(this, L + w - 12, ry + 17, on ? 'Occupata' : `Libera tra ${wait} ${wait === 1 ? 'campagna' : 'campagne'}`, on ? OPS.gain : OPS.label, 10).setOrigin(1, 0.5));
    }
    return y + max * 40 - 6;
  }

  /** Titoletto di sezione: didascalia grigia (e un valore a destra), riga sotto. Restituisce dove inizia il contenuto. */
  private head(items: Phaser.GameObjects.GameObject[], x: number, y: number, w: number, text: string, right = '', rightColor: number = OPS.label): number {
    items.push(label(this, x, y, text, OPS.label, 10));
    if (right) items.push(label(this, x + w, y, right, rightColor, 10).setOrigin(1, 0));
    const g = this.add.graphics();
    rule(g, x, x + w, y + 20);
    items.push(g);
    return y + 30;
  }

  /** Schede in testa alla pagina (Radar: registro e livelli; Laboratorio: ricerca e livelli). */
  private pageTabs(spot: Spot): [string, string][] | null {
    if (spot === 'radar' && this.profile.buildings.radar > 0) return [['Registro', ''], ['Livelli', 'build']];
    if (spot === 'laboratorio' && this.profile.buildings.laboratorio > 0) return [['Ricerca', ''], ['Livelli', 'build']];
    return null;
  }

  /** Controllo a segmenti: la scheda attiva è chiara, le altre si toccano. Restituisce dove finisce. */
  private tabs(items: Phaser.GameObjects.GameObject[], spot: Spot, x: number, y: number, w: number, tabs: [string, string][]): number {
    const h = 36, tw = w / tabs.length, g = this.add.graphics();
    items.push(g);
    tabs.forEach(([name, mode], i) => {
      const on = this.panelMode === mode || (mode === '' && this.panelMode !== 'build' && !tabs.some(([, m]) => m === this.panelMode));
      const tx = x + i * tw;
      glass(g, tx, y, tw - (i < tabs.length - 1 ? 4 : 0), h, on);
      items.push(heading(this, tx + (tw - 4) / 2, y + h / 2, name, 14, on ? OPS.text : OPS.label).setOrigin(0.5));
      if (!on) items.push(this.add.rectangle(tx, y, tw - 4, h, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true })
        .on('pointerup', () => this.openPanel(spot, mode)));
    });
    return y + h;
  }

  /** Riga traslucida come nella home; si schiarisce sotto il mouse se si tocca; barretta a sinistra se evidenziata. */
  private rowBox(items: Phaser.GameObjects.GameObject[], x: number, y: number, w: number, h: number, onClick?: () => void, accent?: number, dim = false) {
    const r = this.add.rectangle(x, y, w, h, OPS.row, 0.62).setOrigin(0).setStrokeStyle(1, OPS.edge, 0.32).setAlpha(dim ? 0.5 : 1);
    if (onClick) r.setInteractive({ useHandCursor: true }).on('pointerup', onClick)
      .on('pointerover', () => r.setFillStyle(OPS.row, 0.92)).on('pointerout', () => r.setFillStyle(OPS.row, 0.62));
    items.push(r);
    if (accent !== undefined) items.push(this.add.rectangle(x, y, 2, h, accent).setOrigin(0));
    return r;
  }

  /** Barra d'avanzamento piatta. */
  private bar(items: Phaser.GameObjects.GameObject[], x: number, y: number, w: number, pct: number, color: number) {
    const g = this.add.graphics();
    g.fillStyle(OPS.edge, 0.4).fillRect(x, y, w, 4).fillStyle(color, 1).fillRect(x, y, w * Phaser.Math.Clamp(pct, 0, 1), 4);
    items.push(g);
  }

  /** Cantiere: tutte le stanze con livello e stato; si tocca una riga per aprirne la pagina. */
  /** Cantiere: tutte le stanze con la loro foto, livello e stato; si tocca una riga per aprirne la pagina. */
  private fillWorks(items: Phaser.GameObjects.GameObject[], L: number, y: number, w: number): number {
    const p = this.profile, now = Date.now(), c = p.construction;
    const d = body(this, L, y, c ? `${buildingText[c.id].name} verso il livello ${p.buildings[c.id] + 1}. Una postazione alla volta.` : 'Libero. Tocca una postazione per vederne il prossimo livello.', 13, c ? PALETTE.allerta : OPS.text, w);
    items.push(d);
    y = d.y + d.height + 16;
    if (c) {
      // lavoro in corso: avanzamento e "finisci ora" subito sotto la frase
      const total = BALANCE.camp.buildings[c.id][p.buildings[c.id]].timeSec * 1000, cost = rushCost(c.until, now), ok = p.stash.metallo >= cost;
      this.bar(items, L, y, w, 1 - (c.until - now) / total, PALETTE.allerta);
      items.push(this.btn(`FINISCI ORA · ${cost} METALLO`, L, y + 14, w, ok, () => {
        if (!rush(p, 'construction', Date.now())) return;
        analytics.design(['mercato', 'accelera', 'construction'], cost);
        saveProfile(p);
        this.closePanel();
        this.settleAll(false);
      }, 13));
      y += 70;
    }
    y = this.head(items, L, y, w, 'Postazioni');
    const why = { busy: 'Cantiere occupato', cost: 'Risorse insufficienti', comando: 'Serve il Comando', max: 'Livello massimo' } as const;
    const rowH = 52, th = rowH - 8, tw = Math.round(th * 1.6);
    BUILDINGS.forEach((id, i) => {
      const ry = y + i * (rowH + 6), lvl = p.buildings[id], max = maxLvl(id), here = c?.id === id, block = buildBlock(p, id);
      this.rowBox(items, L, ry, w, rowH, () => this.openPanel(id), here ? PALETTE.allerta : undefined);
      // foto della stanza (cantiere vuoto se non è costruita), nome, livello in parole, stato a destra
      items.push(coverImage(this, lvl > 0 ? ROOM_IMG[id] : 'room-vuota', L + 4, ry + 4, tw, th, 0.5).setTint(lvl > 0 ? 0xc9d2da : 0x56606a),
        heading(this, L + tw + 16, ry + 18, buildingText[id].name, 15).setOrigin(0, 0.5),
        label(this, L + tw + 16, ry + 37, lvl ? `Livello ${lvl} di ${max}` : 'Da costruire', OPS.label, 10).setOrigin(0, 0.5));
      const state = here ? fmtTime(c!.until - now) : lvl >= max ? 'Al massimo' : block ? why[block] : 'Migliorabile';
      items.push(label(this, L + w - 30, ry + rowH / 2, state, here ? PALETTE.allerta : !block && lvl < max ? OPS.gain : OPS.label, 10).setOrigin(1, 0.5),
        icon(this, 'ui-play', L + w - 16, ry + rowH / 2, 10, OPS.label));
    });
    return y + BUILDINGS.length * (rowH + 6) - 6;
  }

  /** Ricerca (scheda del Laboratorio): progetto in corso con la sua immagine, avanzamento di ogni ramo, ingresso all'albero. */
  private fillResearch(items: Phaser.GameObjects.GameObject[], L: number, y: number, w: number): number {
    const p = this.profile, now = Date.now(), r = p.research;
    // progetto in corso
    y = this.head(items, L, y, w, 'In corso', r ? `Finisce tra ${fmtTime(r.until - now)}` : 'Nessuno', r ? PALETTE.allerta : OPS.label);
    if (r) {
      const t = techInfo(r.id), total = (BALANCE.tech[r.id]?.timeSec ?? 1) * 1000;
      this.rowBox(items, L, y, w, 72, undefined, PALETTE.allerta);
      items.push(coverImage(this, techImage(this, r.id, activeCiv(p)), L + 6, y + 6, 60, 60, 0.5),
        heading(this, L + 78, y + 10, t.name, 16), body(this, L + 78, y + 32, t.desc, 11, OPS.body).setWordWrapWidth(w - 92).setMaxLines(1));
      this.bar(items, L + 78, y + 56, w - 92, 1 - (r.until - now) / total, PALETTE.allerta);
      y += 84;
    } else {
      const t = body(this, L, y, 'Nessun progetto in corso: scegline uno dall\'albero.', 13, OPS.text, w);
      items.push(t);
      y += t.height + 16;
    }
    // rami: quanti progetti completati su quanti (si toccano per aprire l'albero lì)
    y = this.head(items, L, y + 4, w, 'Rami della ricerca');
    Object.entries(BRANCHES).forEach(([k, name], i) => {
      const ids = TECH_IDS.filter((id) => BALANCE.tech[id].branch === k), done = ids.filter((id) => p.techs.includes(id)).length, ry = y + i * 42, full = done === ids.length;
      this.rowBox(items, L, ry, w, 36, () => this.openTree(k));
      items.push(icon(this, BRANCH_ICON[k] ?? 'ui-ricerca', L + 18, ry + 18, 16, OPS.text), heading(this, L + 38, ry + 18, name, 14).setOrigin(0, 0.5),
        label(this, L + w - 12, ry + 18, `${done} di ${ids.length}`, full ? OPS.gain : OPS.label, 10).setOrigin(1, 0.5));
      this.bar(items, L + w * 0.42, ry + 16, w * 0.36, ids.length ? done / ids.length : 0, full ? OPS.gain : OPS.text);
    });
    y += Object.keys(BRANCHES).length * 42 + 8;
    // l'albero è l'azione principale; l'archivio accanto
    const half = (w - 8) / 2, frags = loreFragments(p).length;
    items.push(this.btn(`ARCHIVIO ${frags}/${loreTotal}`, L, y, half, true, () => this.openPanel('archivio'), 12),
      this.btn('APRI L\'ALBERO', L + half + 8, y, half, true, () => this.openTree(r ? BALANCE.tech[r.id].branch : 'esercito'), 13, true));
    return y + 40;
  }

  /** Scheda a destra con dettagli e azione (costruisci / migliora / spedisci / ritira). */
  private openPanel(spot: Spot, mode?: string) {
    if (spot === 'ricerca') { spot = 'laboratorio'; mode = ''; } // la ricerca vive nel Laboratorio (scheda Ricerca)
    const fresh = spot !== this.panelSpot; // scheda appena aperta (non un ridisegno per i timer): entra con una dissolvenza
    this.panel?.destroy();
    if (mode !== undefined || spot !== this.panelSpot) this.panelMode = mode ?? '';
    this.panelSpot = spot;
    this.refreshNav();
    this.panelKey = this.panelState(spot, Date.now());
    const { x0, y0, W, H } = this.drawPage(spot);
    // la cornice di navigazione (depth 50, sempre sopra) si nasconde finché la pagina è aperta
    for (const { btn } of this.navBtns) btn.setVisible(false);
    const items: Phaser.GameObjects.GameObject[] = [];
    // fascicolo: riquadro scuro velato sulla foto, alto quanto il suo contenuto (niente vuoti), filo sottile
    const fg = this.add.graphics();
    items.push(fg);
    const p = this.profile, L = x0 + IN, w = W - 2 * IN;
    let y = y0 + IN;
    const tabs = this.pageTabs(spot);
    if (tabs) y = this.tabs(items, spot, L, y, w, tabs) + 20;
    let end = y0 + H - IN;
    if (spot === 'test') end = this.fillTest(items, L, y, w);
    else if (spot === 'mercato') end = this.fillShop(items, L, y, w);
    else if (spot === 'gioca') end = this.fillPrep(items, x0, y0, W, H);
    else if (spot === 'archivio') end = this.fillLab(items, L, y, w);
    else if (spot === 'alloggi') end = this.fillAlloggi(items, L, y, w);
    else if (spot === 'cantiere') end = this.fillWorks(items, L, y, w);
    else if (spot === 'laboratorio' && this.panelMode !== 'build' && p.buildings.laboratorio > 0) end = this.fillResearch(items, L, y, w);
    else if (spot === 'radar' && this.panelMode !== 'build' && p.buildings.radar > 0) end = this.fillRadar(items, L, y, w);
    else if (spot === 'spedizione') this.fillExtraction(items, W, H);
    else end = this.fillLevels(items, spot, L, y, w, y0 + H);
    // contenuto più alto dello spazio (telefono): il fascicolo sale sulla foto fin sotto la testata
    const top = PAD + this.safe.top + (this.portrait ? 116 : 104);
    const lift = spot === 'spedizione' ? 0 : Phaser.Math.Clamp(end + IN - (y0 + H), 0, Math.max(0, y0 - top));
    if (spot !== 'spedizione') panel(fg, x0, y0, W, Math.min(H + lift, end + IN - y0));
    this.panel = this.add.container(0, -lift, items).setDepth(40);
    if (fresh) {
      this.panel.setAlpha(0).setY(8 - lift);
      this.tweens.add({ targets: this.panel, alpha: 1, y: -lift, duration: 170, ease: 'Quad.easeOut' });
    }
  }

  /**
   * Livelli della stanza: a cosa serve, la funzione della stanza (Arsenale: l'albero), i livelli (spunta = fatto, cantiere = in
   * costruzione, freccia = prossimo, lucchetto = più avanti), poi subito sotto costo e tasto, oppure l'avanzamento del cantiere.
   */
  private fillLevels(items: Phaser.GameObjects.GameObject[], spot: BuildingId, L: number, y: number, w: number, maxY: number): number {
    const p = this.profile, T = buildingText[spot], lvl = p.buildings[spot], n = T.levels.length, now = Date.now();
    const c = p.construction, building = c?.id === spot, next = nextLevel(p, spot);
    const desc = body(this, L, y, T.desc, 13, OPS.text, w);
    items.push(desc);
    y = desc.y + desc.height + 18;
    if (spot === 'arsenale') {
      items.push(this.btn('ALBERO DEGLI ARMAMENTI', L, y, w, true, () => this.openTree('armamenti'), 12));
      y += 58;
    }
    y = this.head(items, L, y, w, 'Livelli', `${lvl} di ${n}`);
    // i livelli si stringono solo se lo schermo è basso (telefono): sotto restano costo e tasto
    const foot = building ? 62 : next ? 132 : 30;
    const step = Phaser.Math.Clamp((maxY - IN - foot - y) / n, 30, 46);
    const tg = this.add.graphics();
    items.push(tg);
    T.levels.forEach((txt, i) => {
      const ly = y + i * step, done = i < lvl, cur = i === lvl, [nm, eff] = levelParts(txt);
      if (cur) tg.fillStyle(OPS.row, 0.7).fillRect(L - 8, ly - 5, w + 16, step - 4).fillStyle(building ? PALETTE.allerta : OPS.cta, 1).fillRect(L - 8, ly - 5, 3, step - 4);
      items.push(icon(this, done ? 'ui-spunta' : cur ? (building ? 'st-cantiere' : 'ui-play') : 'ui-lucchetto', L + 10, ly + 10, done ? 16 : 14,
        done ? OPS.gain : cur ? (building ? PALETTE.allerta : OPS.text) : OPS.label),
        fit(heading(this, L + 30, ly, nm, 15, done ? OPS.body : cur ? 0xffffff : OPS.label), w - (cur ? 120 : 40)));
      if (eff && step >= 36) items.push(body(this, L + 30, ly + 20, eff, 11, done || cur ? OPS.body : OPS.label).setWordWrapWidth(w - 40).setMaxLines(1));
      if (cur) items.push(label(this, L + w - 4, ly + 10, building ? 'In cantiere' : 'Prossimo', building ? PALETTE.allerta : OPS.accent, 10).setOrigin(1, 0.5));
    });
    y += n * step + 6;
    if (building) {
      // cantiere aperto qui: avanzamento, tempo che manca e "finisci ora" pagando metallo (come al Mercato)
      const total = BALANCE.camp.buildings[spot][lvl].timeSec * 1000, cost = rushCost(c!.until, now), ok = p.stash.metallo >= cost;
      this.bar(items, L, y, w, 1 - (c!.until - now) / total, PALETTE.allerta);
      const half = (w - 8) / 2;
      items.push(this.btn(`MANCANO ${fmtTime(c!.until - now)}`, L, y + 14, half, false, () => {}, 12),
        this.btn(`FINISCI ORA · ${cost} METALLO`, L + half + 8, y + 14, half, ok, () => {
          if (!rush(p, 'construction', Date.now())) return;
          analytics.design(['mercato', 'accelera', 'construction'], cost);
          saveProfile(p);
          this.closePanel();
          this.settleAll(false);
        }, 12));
      return y + 54;
    }
    if (next) {
      this.costChips(items, next.cost, next.timeSec, L, y + 26, w);
      const block = buildBlock(p, spot);
      const why = { busy: 'Cantiere occupato', cost: 'Risorse insufficienti', comando: `Serve il Centro di Comando liv. ${lvl}`, max: '' } as const;
      const lbl = block ? why[block] : `${lvl ? 'MIGLIORA' : 'COSTRUISCI'} · ${fmtTime(next.timeSec * 1000)}`;
      items.push(this.btn(block ? lbl : lbl.toUpperCase(), L, y + 88, w, !block, () => {
        if (!startBuild(p, spot, Date.now())) return;
        analytics.design(['accampamento', 'costruisci', spot], lvl + 1);
        analytics.resources('sink', next.cost, 'edificio', spot);
        saveProfile(p);
        this.closePanel();
        this.redrawSpot(spot as MapSpot);
        this.updateStash();
        this.toast(`Cantiere aperto: ${T.name}`, PALETTE.carta);
      }, 16, true));
      return y + 128;
    }
    items.push(icon(this, 'ui-spunta', L + 10, y + 12, 16, OPS.gain), label(this, L + 30, y + 12, 'Livello massimo raggiunto', OPS.gain, 10).setOrigin(0, 0.5));
    return y + 24;
  }

  /**
   * Squadre di Estrazione (Figma di Nico): le missioni in righe di vetro a destra, nome e durata; la riga toccata è la scelta,
   * SEND SQUAD in basso la fa partire. Costo e bottino atteso della scelta stanno sopra il tasto.
   */
  private fillExtraction(items: Phaser.GameObjects.GameObject[], W: number, H: number) {
    const p = this.profile, now = Date.now(), T = buildingText.spedizione, e = p.expedition, P = this.portrait;
    const away = !!e && e.until > now, back = !!e && !away;
    const kindNow: ExpeditionKind = e?.kind ?? this.expKind;
    const m = P ? PAD : W * 0.05, rw = P ? W - 2 * m : Math.max(280, W * 0.268), rx = W - m - rw;
    const rh = Math.max(50, H * 0.092), gap = P ? 10 : Math.max(10, H * 0.035), ctaH = Math.max(52, H * 0.092), ctaY = H - Math.max(H * 0.092, PAD + this.safe.bottom) - ctaH;
    const y0 = P ? ctaY - 76 - 3 * rh - 2 * gap : Math.max(H * 0.216, 110); // in verticale le righe stanno appena sopra costo e tasto
    const px = Phaser.Math.Clamp(W * 0.0078, 10.5, 15); // misura per label(), che la riporta in punti
    const dur = (s: number) => (s >= 3600 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 60)} min`);
    const g = this.add.graphics();
    items.push(g);
    EXPEDITIONS.forEach((kind: ExpeditionKind, i) => {
      const y = y0 + i * (rh + gap), on = kind === kindNow, dim = (away || back) && !on;
      glass(g, rx, y, rw, rh, on);
      const right = on && away ? fmtTime(e!.until - now) : on && back ? 'di ritorno' : dur(expeditionTimeSec(p, kind));
      items.push(label(this, rx + 18, y + rh / 2, T.kinds[kind], OPS.text, px).setOrigin(0, 0.5).setAlpha(dim ? 0.45 : 1),
        label(this, rx + rw - 18, y + rh / 2, right, on && away ? PALETTE.allerta : OPS.label, px).setOrigin(1, 0.5).setAlpha(dim ? 0.45 : 1));
      if (!away && !back) items.push(this.add.rectangle(rx, y, rw, rh, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true }).on('pointerup', () => {
        this.expKind = kind;
        this.openPanel('spedizione');
      }));
    });
    // azione: in basso a destra, ruggine
    const bw = P ? rw : Math.max(220, W * 0.193), bh = ctaH, bx = W - m - bw, by = ctaY;
    const E = BALANCE.camp.expeditions[kindNow], cost = expeditionCost(kindNow), ok = p.stash.cibo >= cost;
    const go = () => {
      if (back) {
        const got = collectExpedition(p, Date.now());
        if (!got) return;
        analytics.design(['spedizione', 'ritira', kindNow]); // % che torna a ritirare
        analytics.resources('source', got, 'spedizione', kindNow);
        saveProfile(p);
        this.closePanel();
        this.redrawSpot('spedizione');
        this.updateStash();
        const s = this.spots.get('spedizione')!;
        this.burst.setParticleTint(PALETTE.ocra);
        this.burst.explode(30, s.x, s.y);
        this.toast(`+${got.metallo} metallo · +${got.benzina} benzina · +${got.cibo} cibo`, PALETTE.radioattivo);
        return;
      }
      if (!startExpedition(p, kindNow, Date.now())) return;
      analytics.design(['spedizione', 'parti', kindNow]);
      saveProfile(p);
      this.closePanel();
      this.redrawSpot('spedizione');
      this.updateStash();
      this.toast('Le squadre partono. Torneranno con quello che trovano.', PALETTE.carta);
    };
    const can = back || (!away && ok);
    const b = new Button(this, back ? 'COLLECT' : away ? 'ON MISSION' : 'SEND SQUAD', bw, bh, () => can && go(), Math.round(px * 1.15));
    b.setPosition(bx, by).setAlpha(can ? 1 : 0.5);
    if (can) b.setPrimary();
    items.push(b);
    // costo e bottino della scelta, sopra il tasto
    const loot = back ? `${e!.reward.metallo} metallo · ${e!.reward.benzina} benzina · ${e!.reward.cibo} cibo`
      : `${E.metallo[0]}–${E.metallo[1]} metallo · ${E.benzina[0]}–${E.benzina[1]} benzina · ${E.cibo[0]}–${E.cibo[1]} cibo`;
    items.push(label(this, W - m, by - 12, loot, OPS.text, P ? 8 : 9).setOrigin(1, 1).setWordWrapWidth(rw).setAlign('right'));
    if (!away && !back) items.push(label(this, W - m, by - (P ? 50 : 32), cost ? `Costo ${cost} cibo · ne hai ${p.stash.cibo}` : 'Gratis', ok ? OPS.label : OPS.loss, 9).setOrigin(1, 1));
  }

  /** Mercato: scambi tra risorse, rifornimenti per la prossima campagna, lavori finiti subito. Solo risorse di gioco. */
  private fillShop(items: Phaser.GameObjects.GameObject[], L: number, y: number, w: number): number {
    const p = this.profile, P = this.portrait, S = BALANCE.shop, now = Date.now();
    const done = (msg: string) => {
      saveProfile(p);
      this.updateStash();
      buzz(12);
      this.toast(msg, PALETTE.radioattivo);
      this.openPanel('mercato');
    };
    const desc = body(this, L, y, shopText.desc, 13, OPS.text, w);
    items.push(desc);
    y = desc.y + desc.height + 18;
    if (premiumOn) y = this.fillLume(items, L, y, w);
    const g = this.add.graphics(); // icone: aggiunte in fondo, sopra le schede
    const tile = (x: number, ty: number, tw: number, th: number, ok: boolean, on: boolean, run: () => void) =>
      this.rowBox(items, x, ty, tw, th, ok ? run : undefined, on ? OPS.gain : undefined, !ok && !on);
    // scambio: 50 di una → 30 di un'altra
    y = this.head(items, L, y, w, shopText.trade);
    const pairs = RESOURCES.flatMap((a) => RESOURCES.filter((b) => b !== a).map((b) => [a, b] as const));
    const cols = P ? 2 : 3, tw = (w - (cols - 1) * 6) / cols, th = 36;
    pairs.forEach(([a, b], k) => {
      const x = L + (k % cols) * (tw + 6), ty = y + Math.floor(k / cols) * (th + 6);
      const ok = p.stash[a] >= S.trade.give;
      tile(x, ty, tw, th, ok, false, () => { if (trade(p, a, b)) done(`SCAMBIO · −${S.trade.give} ${RESOURCE_INFO[a].name.toLowerCase()} · +${S.trade.get} ${RESOURCE_INFO[b].name.toLowerCase()}`); });
      items.push(resIcon(this, a, x + 16, ty + th / 2, 18));
      items.push(label(this, x + 28, ty + th / 2, String(S.trade.give), ok ? OPS.text : OPS.label, 12).setOrigin(0, 0.5),
        label(this, x + tw / 2, ty + th / 2, '→', OPS.label, 12).setOrigin(0.5));
      items.push(resIcon(this, b, x + tw - 42, ty + th / 2, 18));
      items.push(label(this, x + tw - 30, ty + th / 2, String(S.trade.get), ok ? OPS.gain : OPS.label, 12).setOrigin(0, 0.5));
    });
    y += Math.ceil(pairs.length / cols) * (th + 6) + 12;
    // rifornimenti: uno per tipo, valgono per la prossima campagna
    y = this.head(items, L, y, w, shopText.supplies);
    // ogni rifornimento con la sua icona (truppe, carte, sacchi di sabbia)
    const SUP_ICON: Record<string, string> = { truppe: 'res-truppe', mappe: 'ui-mappa', sabbia: 'ui-difesa' };
    const scols = P ? 1 : 3, sw = (w - (scols - 1) * 6) / scols, sh = P ? 52 : 76;
    SUPPLIES.forEach((k, i) => {
      const T = shopText.items[k], D = S.supplies[k], own = (p.supplies ?? []).includes(k), ok = !own && canAfford(p.stash, D.cost);
      const x = L + (i % scols) * (sw + 6), ty = y + Math.floor(i / scols) * (sh + 6);
      tile(x, ty, sw, sh, ok, own, () => { if (buySupply(p, k)) done(`${T.name.toUpperCase()} · pronti per la prossima campagna`); });
      const tx = x + 38;
      items.push(icon(this, SUP_ICON[k] ?? 'ui-rifornimento', x + 19, ty + 18, 18, own ? OPS.gain : OPS.text),
        heading(this, tx, ty + 8, T.name, 14, own ? OPS.gain : OPS.text),
        body(this, tx, ty + 28, T.desc, 10, OPS.body).setWordWrapWidth(sw - 50).setMaxLines(1));
      if (own) items.push(label(this, x + sw - 10, ty + (P ? sh / 2 : sh - 13), 'Pronto', OPS.gain, 10).setOrigin(1, 0.5));
      else this.costRow(g, items, D.cost, P ? x + sw - 130 : tx, P ? ty + sh / 2 : ty + sh - 13, p.stash);
    });
    y += Math.ceil(SUPPLIES.length / scols) * (sh + 6) + 12;
    // lavori in corso: finiti subito pagando metallo
    y = this.head(items, L, y, w, shopText.rush);
    const withLume = premiumOn && this.lume.balance !== null;
    const jobs: { what: RushKind; job: { until: number } | null; name: string }[] = [
      { what: 'construction' as const, job: p.construction, name: p.construction ? `${buildingText[p.construction.id].name} liv. ${p.buildings[p.construction.id] + 1}` : '' },
      { what: 'research' as const, job: p.research, name: p.research ? techInfo(p.research.id).name : '' },
      ...(withLume ? [{ what: 'expedition' as const, job: p.expedition, name: 'Estrazione' }] : []),
    ].filter((j) => j.job && j.job.until > now);
    if (!jobs.length) items.push(label(this, L, y, 'Nessun cantiere o ricerca in corso', OPS.label, 10));
    // col Lume: nome del lavoro sopra, due tasti affiancati (metallo | Lume); l'Estrazione solo col Lume
    const step = withLume ? 66 : 46, top = withLume ? 20 : 0;
    jobs.forEach((j, i) => {
      const cost = rushCost(j.job!.until, now), ok = p.stash.metallo >= cost, metal = j.what !== 'expedition', jy = y + i * step;
      const mw = withLume ? (w - 6) / 2 : w;
      if (withLume) items.push(label(this, L, jy + 6, `Finisci ora: ${j.name}`, OPS.body, 11).setOrigin(0, 0.5));
      if (metal) items.push(this.btn(withLume ? `${cost} METALLO` : `FINISCI ORA: ${j.name.toUpperCase()} · ${cost} METALLO`, L, jy + top, mw, ok, () => {
        if (!rush(p, j.what as 'construction' | 'research', Date.now())) return;
        analytics.design(['mercato', 'accelera', j.what], cost);
        saveProfile(p);
        this.closePanel();
        this.settleAll(false);
      }, 12));
      if (withLume) {
        const min = Math.ceil((j.job!.until - now) / 60_000), lc = rushLume(min);
        items.push(this.btn(`${lc} LUME`, metal ? L + mw + 6 : L, jy + top, metal ? mw : w,
          !this.lume.busy && (this.lume.balance ?? 0) >= lc, () => void this.lumeSpend({ item: 'rush', what: j.what, minutes: min }), 12));
      }
    });
    items.push(g);
    return y + (jobs.length ? jobs.length * step - 6 : 16);
  }

  /** Costo del prossimo livello a schede: icona, quanto serve, quanto hai (barra verde se basta, rossa se no) e tempo. */
  private costChips(items: Phaser.GameObjects.GameObject[], cost: Bag, timeSec: number, x: number, y: number, w: number) {
    const have = this.profile.stash, rs = RESOURCES.filter((r) => cost[r] > 0), n = rs.length + 1, cw = (w - (n - 1) * 6) / n, ch = 50;
    items.push(label(this, x, y - 18, 'costo del prossimo livello', OPS.label, 9));
    const g = this.add.graphics();
    items.push(g);
    rs.forEach((r, i) => {
      const cx = x + i * (cw + 6), ok = have[r] >= cost[r];
      g.fillStyle(0x2b333b, 0.55).fillRect(cx, y, cw, ch);
      if (!ok) g.fillStyle(OPS.loss, 1).fillRect(cx, y, 2, ch);
      items.push(resIcon(this, r, cx + 16, y + 17, 18));
      g.fillStyle(OPS.edge, 0.4).fillRect(cx + 10, y + ch - 9, cw - 20, 3);
      g.fillStyle(ok ? OPS.gain : OPS.loss, 1).fillRect(cx + 10, y + ch - 9, (cw - 20) * Math.min(1, have[r] / cost[r]), 3);
      items.push(value(this, cx + 30, y + 17, String(cost[r]), 17, ok ? OPS.text : OPS.loss).setOrigin(0, 0.5),
        label(this, cx + cw - 8, y + 30, `hai ${have[r]}`, OPS.label, 8).setOrigin(1, 0.5));
    });
    const tx = x + rs.length * (cw + 6);
    g.fillStyle(0x2b333b, 0.3).fillRect(tx, y, cw, ch);
    items.push(label(this, tx + cw / 2, y + 12, 'tempo', OPS.label, 8).setOrigin(0.5),
      value(this, tx + cw / 2, y + 31, fmtTime(timeSec * 1000), 16).setOrigin(0.5));
  }

  /** Costo in fila: icona, quanto serve (rosso se non basta). */
  private costRow(_g: Phaser.GameObjects.Graphics, items: Phaser.GameObjects.GameObject[], cost: Bag, x: number, y: number, have: Bag) {
    let cx = x;
    for (const r of RESOURCES) {
      if (!cost[r]) continue;
      items.push(resIcon(this, r, cx + 6, y, 15));
      const t = label(this, cx + 15, y, String(cost[r]), have[r] < cost[r] ? OPS.loss : OPS.text, 10).setOrigin(0, 0.5);
      items.push(t);
      cx += t.width + 26;
    }
  }

  /** Modalità test: sblocca tutto per provare armi, civiltà e ricerche senza aspettare; si torna indietro azzerando il profilo. */
  private fillTest(items: Phaser.GameObjects.GameObject[], L: number, y: number, w: number): number {
    const p = this.profile;
    y = this.head(items, L, y, w, 'Modalità test', p.test ? 'Attiva' : 'Spenta', p.test ? PALETTE.allerta : OPS.label);
    const txt = p.test
      ? 'Postazioni al massimo, tutte le ricerche, risorse piene, civiltà sbloccate, cantieri e spedizioni istantanei, +1000 truppe a inizio campagna, abilità con ricarica ridotta.'
      : 'Sblocca subito tutto: postazioni al massimo (tutte le armi e le abilità), tutte le ricerche, risorse piene, civiltà sbloccate, cantieri e spedizioni istantanei, +1000 truppe a inizio campagna.\n\nServe solo per provare il gioco: i progressi veri si perdono.';
    const t = body(this, L, y, txt, 13, OPS.text, w);
    items.push(t);
    y = t.y + t.height + 20;
    const restart = () => this.scene.restart();
    if (!p.test) {
      items.push(this.btn('ATTIVA LA MODALITÀ TEST', L, y, w, true, () => {
        enableTestMode(p);
        saveProfile(p);
        analytics.design(['test', 'attiva']);
        restart();
      }, 13));
      y += 48;
    }
    items.push(this.btn(p.test ? 'ESCI: AZZERA IL PROFILO' : 'AZZERA IL PROFILO', L, y, w, true, () => {
      this.profile = resetProfile();
      restart();
    }, 13));
    return y + 40;
  }

  /** Torna alla vista principale della preparazione: freccia e nome, in testa al pannello. */
  private crumb(items: Phaser.GameObjects.GameObject[], x: number, y: number, title: string) {
    const ic = icon(this, 'ui-indietro', x + 8, y + 12, 14, OPS.text), t = heading(this, x + 26, y + 12, title, 16).setOrigin(0, 0.5);
    const hit = this.add.rectangle(x - 6, y - 4, t.width + 44, 32, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true })
      .on('pointerup', () => this.openPanel('gioca', ''));
    items.push(ic, t, hit);
    return y + 40;
  }

  /** Scelta a segmenti (durata, puntata): quella attiva è piena e chiara; le spente non si toccano. */
  private choice(items: Phaser.GameObjects.GameObject[], x: number, y: number, w: number, h: number,
    opts: { text: string; sub?: string; on: boolean; ok: boolean; pick: () => void }[]) {
    const g = this.add.graphics(), cw = (w - (opts.length - 1) * 6) / opts.length;
    items.push(g);
    opts.forEach((o, k) => {
      const cx = x + k * (cw + 6);
      if (o.on) g.fillStyle(OPS.text, 1).fillRect(cx, y, cw, h);
      else glass(g, cx, y, cw, h);
      const col = o.on ? 0x0a0d10 : o.ok ? OPS.text : OPS.label;
      items.push(heading(this, cx + cw / 2, y + (o.sub ? h / 2 - 8 : h / 2), o.text, 14, col).setOrigin(0.5).setAlpha(o.ok || o.on ? 1 : 0.5));
      if (o.sub) items.push(label(this, cx + cw / 2, y + h / 2 + 10, o.sub, o.on ? 0x2a3138 : OPS.label, 9).setOrigin(0.5).setAlpha(o.ok || o.on ? 1 : 0.5));
      if (o.ok && !o.on) items.push(this.add.rectangle(cx, y, cw, h, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true }).on('pointerup', o.pick));
    });
  }

  /** Immagine del fronte (generata con Draw Things); finché non c'è, la sala operazioni. */
  private frontImage(fi: number): string {
    return this.textures.exists(`front-${fi + 1}`) ? `front-${fi + 1}` : 'room-fronte';
  }

  /**
   * Preparazione della campagna alla XCOM 2: in testa la potenza (ritratto del capo), poi l'operazione (fronte con la sua
   * immagine), i reparti come carte, la durata e la puntata come scelte visibili, AVVIA LA CAMPAGNA in fondo. Due sotto-viste:
   * la scelta della potenza e la scala dei fronti.
   */
  private fillPrep(items: Phaser.GameObjects.GameObject[], x0: number, y0: number, W: number, _H: number): number {
    const p = this.profile;
    const civ = activeCiv(p), L = x0 + IN, w = W - 2 * IN;
    if (this.panelMode === 'civ') {
      const P = this.portrait, cols = P ? 2 : 4, gap = 8;
      const y = this.crumb(items, L, y0 + 14, 'Scegli la potenza');
      // quattro sistemi politici: immagine (Figma), insegna, nome e forma di governo
      const cw = (w - (cols - 1) * gap) / cols, ch = P ? 150 : 190;
      CIV_IDS.forEach((id, k) => {
        const st = CIV_STYLE[id], info = civInfo(id), open = civUnlocked(p, id), sel = id === civ;
        const cx = L + (k % cols) * (cw + gap), cy = y + Math.floor(k / cols) * (ch + gap);
        const img = coverImage(this, civImage(id), cx, cy, cw, ch, 0.4).setTint(open ? 0xffffff : 0x555a66).setAlpha(open ? 1 : 0.6);
        const shade = fade(this, cx, cy + ch * 0.35, cw, ch * 0.65, PALETTE.inchiostro, 0, 0.95);
        const frame = this.add.rectangle(cx, cy, cw, ch).setOrigin(0).setStrokeStyle(sel ? 2 : 1, sel ? OPS.text : OPS.edge, sel ? 1 : 0.6)
          .setInteractive({ useHandCursor: open });
        frame.on('pointerup', () => {
          if (!open) return this.toast(`${info.name}: ${info.unlock}`, PALETTE.carta);
          p.civ = id;
          saveProfile(p);
          this.openPanel('gioca', 'civ');
        });
        items.push(img, shade, frame, icon(this, `civ-${id}`, cx + 20, cy + 20, 22, open ? st.fill : OPS.label),
          heading(this, cx + 10, cy + ch - 44, info.name, 18, open ? OPS.text : OPS.label),
          label(this, cx + 10, cy + ch - 18, open ? info.regime : info.unlock, open ? OPS.body : OPS.label, 9).setWordWrapWidth(cw - 20).setMaxLines(1));
        if (!open) items.push(icon(this, 'ui-lucchetto', cx + cw - 18, cy + 18, 14, OPS.label));
        if (sel) items.push(this.add.rectangle(cx, cy, cw, 3, OPS.text).setOrigin(0));
      });
      // scheda della potenza scelta: classe dirigente, dottrina, storia, regole
      const info = civInfo(civ), unit = unitInfo(info.unit);
      const ty = y + (P ? 2 : 1) * (ch + gap) + 8;
      const cls = heading(this, L, ty, info.classe, 14).setWordWrapWidth(w);
      const doc = label(this, L, cls.y + cls.height + 4, `${info.dottrina} · «${info.motto}»`, OPS.label, 9).setWordWrapWidth(w);
      items.push(cls, doc);
      const lore = body(this, L, doc.y + doc.height + 10, info.lore, 12, OPS.body, w);
      items.push(lore);
      // regole della potenza: bonus, unità, edificio
      let ry = lore.y + lore.height + 14;
      for (const [k, v] of [['Bonus', info.bonus], ['Unità unica', `${unit.name} (Arsenale liv. ${BALANCE.camp.arsenaleUnique})`], ['Edificio unico', `${info.building}: ${info.buildingText}`]]) {
        items.push(label(this, L, ry + 2, k, OPS.label, 10));
        const t = body(this, L + 120, ry, v, 12, OPS.text, w - 120);
        items.push(t);
        ry += t.height + 8;
      }
      return ry;
    }
    if (this.panelMode === 'fronti') return this.fillFronts(items, L, y0 + 14, w);
    // vista principale: in testa la potenza scelta (tocca per cambiarla)
    const info = civInfo(civ), st = CIV_STYLE[civ];
    const bh = this.portrait ? 112 : 104;
    const banner = coverImage(this, civImage(civ), x0 + 1, y0 + 1, W - 2, bh, 0.4).setTint(0xc8d6e6);
    items.push(banner, fade(this, x0 + 1, y0 + 1, W - 2, bh, PALETTE.inchiostro, 0.35, 0.97));
    // ritratto del capo della potenza e il suo emblema accanto al nome
    const pw = Math.round((bh - 16) * 0.75);
    items.push(coverImage(this, `leader-${civ}`, x0 + 10, y0 + 8, pw, bh - 16, 0.25),
      this.add.rectangle(x0 + 10, y0 + 8, pw, bh - 16, 0, 0).setOrigin(0).setStrokeStyle(1, st.fill, 0.9),
      icon(this, `civ-${civ}`, x0 + pw + 34, y0 + bh - (this.portrait ? 60 : 46), 22, st.fill),
      value(this, x0 + pw + 52, y0 + bh - (this.portrait ? 74 : 60), info.name, 26),
      // sul telefono il bonus va su due righe (mai tagliato a metà frase)
      body(this, x0 + pw + 22, y0 + bh - (this.portrait ? 42 : 26), `${info.regime} · ${info.bonus}`, 10, OPS.body, W - pw - 40).setMaxLines(this.portrait ? 2 : 1));
    if (civChoice(p)) {
      const hit = this.add.rectangle(x0 + 1, y0 + 1, W - 2, bh, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true });
      hit.on('pointerup', () => this.openPanel('gioca', 'civ'));
      items.push(hit, label(this, x0 + W - 16, y0 + 12, 'Cambia potenza', OPS.accent, 10).setOrigin(1, 0));
    }
    let y = y0 + bh + 16;
    // operazione: il fronte con la sua immagine, difficoltà, potenza consigliata (se c'è) e bottino; si tocca per cambiarlo
    const fi = activeFront(p), F = BALANCE.fronts[fi], power = playerPower(p), weak = power < F.power;
    y = this.head(items, L, y, w, 'Operazione', p.runs > 0 ? 'Cambia fronte' : '', OPS.accent);
    const fh = 64, fw = Math.round(fh * 1.75);
    this.rowBox(items, L, y, w, fh, p.runs > 0 ? () => this.openPanel('gioca', 'fronti') : undefined, weak ? OPS.loss : undefined);
    items.push(coverImage(this, this.frontImage(fi), L + 4, y + 4, fw, fh - 8, 0.5).setTint(0xd4dce4),
      heading(this, L + fw + 16, y + 12, `Fronte ${ROMAN[fi]} · ${F.name}`, 15, weak ? OPS.loss : OPS.text),
      label(this, L + fw + 16, y + 42, `Difficoltà ${fi + 1} di ${BALANCE.fronts.length}${F.power ? ` · consigliata ${F.power}, tua ${power}` : ''} · bottino ×${String(F.lootMult).replace('.', ',')}`,
        weak ? OPS.loss : OPS.label, 9).setOrigin(0, 0.5).setWordWrapWidth(w - fw - 40).setMaxLines(1));
    if (p.runs > 0) items.push(icon(this, 'ui-play', L + w - 16, y + fh / 2, 10, OPS.label));
    y += fh + 20;
    // reparti: le carte del mazzo (foto e icona); sotto, le armi dei nemici del fronte (rosse quelle che non hai)
    const deck = deckOf(p, civ), mine = unlockedUnits(p, civ);
    y = this.head(items, L, y, w, 'Reparti', `${deck.length} in campagna`);
    const cs = Math.min(56, (w - 6 * (deck.length - 1)) / Math.max(1, deck.length));
    deck.forEach((t, k) => {
      const cx = L + k * (cs + 6);
      items.push(coverImage(this, `u-${t}`, cx, y, cs, cs, 0.4).setTint(0x8a96a2), this.add.rectangle(cx, y, cs, cs, 0x05080d, 0.3).setOrigin(0)
        .setStrokeStyle(1, OPS.edge, 0.5), icon(this, `u-${t}`, cx + cs / 2, y + cs / 2, cs * 0.45, PALETTE.carta));
    });
    y += cs + 12;
    items.push(icon(this, 'ui-guerra', L + 8, y + 9, 14, OPS.label), label(this, L + 24, y + 9, 'Armi nemiche', OPS.label, 10).setOrigin(0, 0.5));
    F.aiUnits.forEach((t, k) => items.push(icon(this, `u-${t}`, L + 130 + k * 28, y + 9, 18, mine.includes(t) ? OPS.body : OPS.loss)));
    y += 34;
    // durata: tre scelte visibili (prima era un tasto che cambiava a ogni tocco)
    if (campaignChoice(p)) {
      y = this.head(items, L, y, w, 'Durata');
      this.choice(items, L, y, w, 46, CAMPAIGNS.map((k) => {
        const C = BALANCE.campaigns[k];
        return {
          text: CAMPAIGN_NAME[k], sub: `${Math.round(C.durationMs / 60000)} min · ${this.portrait ? '' : 'bottino '}×${String(C.lootMult).replace('.', ',')}`, on: p.campaign === k, ok: true,
          pick: () => { p.campaign = k; saveProfile(p); this.openPanel('gioca', ''); },
        };
      }));
      y += 66;
    }
    // puntata (alla poker): risorse del Deposito in gioco; più punti, più rende il guadagno; uscire prima costa
    const K = stakeIndex(p), SK = BALANCE.stake, fee = Math.round(runOptions(p).exitFee * 100);
    const risks = [`non vinci −${Math.round(SK.lossShare * 100)}%`, ...(this.portrait ? [] : [`ritirata −${fee}%`]), `eliminato −${Math.round(runOptions(p).eliminatedLoss * 100)}%`];
    y = this.head(items, L, y, w, `Puntata ×${String(SK.mult[K]).replace('.', ',')}`, risks.join(' · '));
    this.choice(items, L, y, w, 36, SK.options.map((v, k) => ({
      text: v ? String(v) : 'Niente', on: k === K, ok: canStake(p, k),
      pick: () => { p.stake = k; saveProfile(p); this.openPanel('gioca', ''); },
    })));
    y += 56;
    items.push(this.btn('AVVIA LA CAMPAGNA', L, y, w, true, () => {
      analytics.design(['campagna', 'avvia', `${civ}:${p.campaign}:${fi}`]);
      this.scene.start('Load', { next: 'Run', data: { seed: randomSeed() } });
    }, 16, true));
    return y + 40;
  }

  /** Fronti: la scala della difficoltà (alla Clash), ognuno con la sua immagine. Si sblocca il successivo vincendo. */
  private fillFronts(items: Phaser.GameObjects.GameObject[], L: number, y: number, w: number): number {
    const p = this.profile;
    const power = playerPower(p), max = p.frontMax ?? 0, sel = activeFront(p);
    y = this.crumb(items, L, y, 'Scegli il fronte');
    items.push(label(this, L + w, y - 28, `La tua potenza ${power}`, OPS.label, 10).setOrigin(1, 0.5));
    const rh = this.portrait ? 54 : 60, iw = Math.round((rh - 8) * 1.75);
    BALANCE.fronts.forEach((F, k) => {
      const ry = y + k * (rh + 6), open = k <= max, weak = power < F.power;
      this.rowBox(items, L, ry, w, rh, open ? () => { p.front = k; saveProfile(p); this.openPanel('gioca', ''); }
        : () => this.toast(`Vinci il fronte ${ROMAN[k - 1]} per sbloccarlo`, PALETTE.carta), k === sel ? OPS.text : undefined, !open);
      items.push(coverImage(this, this.frontImage(k), L + 4, ry + 4, iw, rh - 8, 0.5).setTint(open ? 0xd4dce4 : 0x56606a),
        heading(this, L + iw + 16, ry + rh / 2 - 10, `Fronte ${ROMAN[k]} · ${F.name}`, 15, open ? (weak ? OPS.loss : OPS.text) : OPS.label).setOrigin(0, 0.5),
        label(this, L + iw + 16, ry + rh / 2 + 12, open ? `${F.power ? `Consigliata ${F.power} · ` : ''}bottino ×${String(F.lootMult).replace('.', ',')}${weak ? ' · troppo forti per te' : ''}`
          : `Vinci il fronte ${ROMAN[k - 1]}`, open && weak ? OPS.loss : OPS.label, 9).setOrigin(0, 0.5));
      if (!open) items.push(icon(this, 'ui-lucchetto', L + w - 18, ry + rh / 2, 14, OPS.label));
      else if (k === sel) items.push(icon(this, 'ui-spunta', L + w - 18, ry + rh / 2, 14, OPS.gain));
    });
    return y + BALANCE.fronts.length * (rh + 6) - 6;
  }

  /** Archivio della Caduta: i frammenti di lore sbloccati dal ramo "La Caduta" dell'albero. */
  private fillLab(items: Phaser.GameObjects.GameObject[], L: number, y: number, w: number): number {
    const frags = loreFragments(this.profile);
    y = this.head(items, L, y, w, 'Frammenti decifrati', `${frags.length} di ${loreTotal}`);
    if (!frags.length) {
      const t = body(this, L, y, 'Nessun frammento. Le ricerche del ramo "La Caduta" riempiono questo archivio.', 13, OPS.text, w);
      items.push(t);
      y = t.y + t.height + 18;
    }
    frags.forEach((f, i) => {
      items.push(label(this, L, y, `Frammento ${ROMAN[i] ?? i + 1}`, OPS.accent, 10), heading(this, L, y + 16, f.name, 16));
      const t = body(this, L, y + 40, f.lore, 12, OPS.body, w);
      items.push(t);
      y = t.y + t.height + 20;
    });
    items.push(this.btn('RAMO DELLA CADUTA', L, y, w, true, () => this.openTree('caduta'), 12));
    return y + 40;
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
  private fillRadar(items: Phaser.GameObjects.GameObject[], L: number, y: number, w: number): number {
    const p = this.profile;
    // record vecchi o incompleti (senza territorio o durata): restano nel registro ma non rompono i numeri
    const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    const best = Math.max(0, ...[p.bestTiles, ...p.history.map((r) => r.tiles)].filter(num));
    // tre numeri grandi, poi le vittorie per potenza, poi il registro in tabella
    ([['Campagne', p.runs], ['Vittorie', p.wins], ['Territorio massimo', best]] as [string, number][]).forEach(([k, v], i) => {
      const sx = L + i * (w / 3);
      items.push(label(this, sx, y, k, OPS.label, 10), value(this, sx, y + 18, String(v), 28));
    });
    y += 64;
    const byCiv = CIV_IDS.map((c) => {
      const h = p.history.filter((r) => r.civ === c);
      return h.length ? `${civInfo(c).name} ${h.filter((r) => r.outcome === 'victory').length} vinte su ${h.length}` : '';
    }).filter(Boolean).join(' · ');
    const bc = body(this, L, y, byCiv || 'Nessuna campagna registrata', 12, OPS.body, w);
    items.push(bc);
    y = this.head(items, L, bc.y + bc.height + 18, w, 'Ultime campagne');
    // intestazioni delle colonne, poi una riga per campagna
    const cols = [L, L + w * 0.27, L + w * 0.52, L + w];
    items.push(label(this, cols[0], y, 'Data', OPS.label, 10), label(this, cols[1], y, 'Potenza', OPS.label, 10), label(this, cols[2], y, 'Esito', OPS.label, 10),
      icon(this, 'ui-province', cols[3] - 66, y + 8, 12, OPS.label), icon(this, 'ui-tempo', cols[3] - 6, y + 8, 12, OPS.label));
    y += 24;
    const OUT: Record<string, [string, number]> = { victory: ['Vittoria', OPS.gain], retreat: ['Ritirata', PALETTE.allerta], eliminated: ['Eliminato', OPS.loss], timeout: ['Fine tempo', OPS.label] };
    const rows = p.history.slice(0, 7);
    rows.forEach((r, i) => {
      const d = new Date(r.at), ry = y + i * 26;
      const when = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const [o, oc] = OUT[r.outcome] ?? [r.outcome, OPS.label];
      items.push(label(this, cols[0], ry, when, OPS.label, 10), label(this, cols[1], ry, CIV_IDS.includes(r.civ) ? civInfo(r.civ).name : '—', OPS.text, 10),
        label(this, cols[2], ry, o, oc, 10), label(this, cols[3] - 60, ry, num(r.tiles) ? String(r.tiles) : '—', OPS.body, 10).setOrigin(1, 0),
        label(this, cols[3], ry, num(r.timeMs) ? fmtTime(r.timeMs) : '—', OPS.body, 10).setOrigin(1, 0));
    });
    return y + Math.max(1, rows.length) * 26 - 8;
  }

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
    // avviso: vetro scuro con una barretta del colore del messaggio, testo normale (prima riga come titolo)
    const w = Math.min(440, width - 40), [first, ...rest] = msg.split('\n');
    const head = heading(this, 18, 12, first.charAt(0) + first.slice(1).toLowerCase(), 14).setWordWrapWidth(w - 30);
    const more = rest.length ? body(this, 18, head.y + head.height + 4, rest.join('\n'), 12, OPS.body, w - 30) : null;
    const h = (more ? more.y + more.height : head.y + head.height) + 12;
    const bg = this.add.rectangle(0, 0, w, h, OPS.panel, 0.94).setOrigin(0).setStrokeStyle(1, OPS.edge, 0.4);
    const bar = this.add.rectangle(0, 0, 3, h, color).setOrigin(0);
    const t = (this.lastToast = this.add.container(width / 2 - w / 2, ty - 20, [bg, bar, head, ...(more ? [more] : [])]).setDepth(60).setAlpha(0));
    this.tweens.add({ targets: t, alpha: 1, y: ty - 10, duration: 220 });
    this.tweens.add({ targets: t, alpha: 0, delay: 2800, duration: 400, onComplete: () => t.destroy() });
  }
}
