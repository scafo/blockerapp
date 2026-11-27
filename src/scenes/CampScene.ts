import { openAudioPanel } from '../ui/audioPanel';
import { REGIONS, type MapId } from '../map/region';
import { music } from '../audio/music';
import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { PALETTE, hex } from '../config/palette';
import buildingText from '../data/buildings.json';
import {
  BUILDINGS, EXPEDITIONS, activeCiv, buildBlock, campaignChoice, canAfford, civChoice, collectExpedition, expeditionCost, unlockedUnits,
  activeFront, enableTestMode, expeditionTimeSec, sandboxOptions, SANDBOX_DOCTRINES, SANDBOX_LEVELS, type SandboxConfig, type SandboxDoctrine, fmtTime, nextLevel, playerPower, settle, startBuild, startExpedition, stashCap,
  SUPPLIES, buySupply, rush, rushable, rushCost, trade,
} from '../game/camp';
import shopText from '../data/shop.json';
import frontText from '../data/fronts.json';
import { CIV_IDS, civInfo, civUnlocked } from '../game/civs';
import { CIV_STYLE } from '../game/factions';
import { settleResearch, techInfo } from '../game/tech';
import { RegistryRadar, type RadarEntry } from '../render/registryRadar';
import { ResearchCube } from '../render/researchCube';
import { archiveCubeTechs, fragments } from '../game/archive';
import { unitInfo } from '../game/units';
import type { CampaignId, CivId, UnitType } from '../config/balance';
import { RESOURCES, RESOURCE_INFO, type Bag } from '../game/resources';
import { randomSeed } from '../map/rng';
import { loadProfile, resetProfile, saveProfile, type BuildingId, type ExpeditionKind, type Profile } from '../save/storage';
import { analytics } from '../analytics/analytics';
import { askName } from '../ui/nameInput';
import { askField } from '../ui/askField';
import { LUME_PACKS, PREMIUM, rushLume, type PackId, type RushKind } from '../config/premium';
import { applyGrant, buyPack, confirmClaimed, fetchWallet, premiumOn, sendCode, signOut, signedEmail, spend, verifyCode, type SpendReq } from '../online/premium';
import { recoverStake } from '../game/camp';
import { Button } from '../ui/Button';
import { buzz } from '../ui/haptics';
import { safeInsets, uiCamera, view } from '../ui/screen';
import { civImage, coverImage, fade, techImage } from '../ui/images';
import { OPS, body, glass, heading, icon, label, panel, resIcon, resPhoto, rule, tech, value } from '../ui/ops';
import { NAV_H, NavBar, type NavTab } from '../ui/navBar';
import { lineIcon } from '../ui/lineIcons';
import { type RoomId, type RoomState } from '../ui/roomArt';

const PAD = 12;
const IN = 20; // margine interno dei pannelli delle pagine
const PAGE_HEAD = 112; // testata delle pagine sotto la barra fissa (← Base e titolo)
/** Testo lungo: rimpicciolito per stare nella larghezza (mai tagliato). */
const fit = <T extends Phaser.GameObjects.Text>(t: T, w: number): T => t.setScale(Math.min(1, w / Math.max(1, t.width)));
// pianta della base (riferimento di Nico: planimetria tecnica su ardesia)
// risorse mostrate l'ultima volta che la base era aperta: al rientro da una campagna i numeri scorrono fino ai nuovi
let shownStash: number[] | null = null;
const maxLvl = (id: BuildingId) => BALANCE.camp.buildings[id].length;
const INK = PALETTE.carta; // testi chiari sul fondo scuro

// 'gioca' = la partita (fronte e GIOCA), 'profilo' = comandante, potenza e registro, 'test' = modalità test
/** Dati d'ingresso: pagina da aprire subito (dalla schermata d'entrata). */
export interface CampData { open?: 'gioca' | 'estrazione' | 'ricerca' | 'arsenale' | 'mercato' | 'profilo' | 'sandbox' }

type Spot = BuildingId | 'spedizione' | 'gioca' | 'test' | 'mercato' | 'profilo' | 'sandbox';
type MapSpot = BuildingId | 'spedizione'; // le stanze della base
// base in sezione: il Comando grande, le altre stanze accanto
// (Mercato, Alloggi e Archivio tolti dalla griglia: niente livelli, le loro funzioni stanno nelle sezioni. Nico, 23 novembre 2026)
// (poi anche Arsenale e Deposito: l'Arsenale sta nella sua sezione, il Deposito nel Mercato. Nico, 23 novembre 2026)
const SIDE_ROOMS: MapSpot[] = ['radar']; // Laboratorio in Ricerca, Arsenale nell'Arsenale, Deposito ed Estrazione nel Mercato
// icona di ogni pagina (generate con Draw Things)
const STATION_ICON: Record<Spot, string> = {
  comando: 'st-comando', laboratorio: 'st-laboratorio', radar: 'st-radar', arsenale: 'st-arsenale', deposito: 'st-deposito',
  spedizione: 'st-estrazione', mercato: 'st-mercato', gioca: 'st-operazioni', profilo: 'ui-info', test: 'ui-info', sandbox: 'st-operazioni',
};
// nome sulla targa della stanza nella base (le pagine usano il nome intero)
const CELL: Record<MapSpot, string> = {
  comando: 'Command Center', laboratorio: 'Laboratory', radar: 'Radar Room', arsenale: 'Arsenal', deposito: 'Depot',
  spedizione: 'Extraction',
};
// foto di ogni stanza (generate in locale con Draw Things): nella base e come fondo della sua pagina
const ROOM_IMG: Record<Spot, string> = {
  comando: 'room-comando', laboratorio: 'room-laboratorio', radar: 'room-radar', arsenale: 'room-arsenale', deposito: 'room-deposito',
  spedizione: 'bg-estrazione', mercato: 'room-mercato', gioca: 'room-fronte', profilo: 'room-comando', test: 'room-comando', sandbox: 'room-fronte',
};
const CAMPAIGNS: CampaignId[] = ['breve', 'standard', 'lunga'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
/** Testo di un livello → [nome, effetto]: "Rapporti dal campo: eventi…" → ["Rapporti dal campo", "eventi…"]. */
const levelParts = (txt: string): [string, string] => {
  const t = txt.replace(/^Armamenti: /, ''), c = t.indexOf(':'), d = t.indexOf(', ');
  if (c > 0) return [t.slice(0, c), t.slice(c + 1).trim()];
  if (d > 0) return [t.slice(0, d), t.slice(d + 2)];
  return [t, ''];
};
// pagine delle stanze: titolo e pianta da disegnare
const PAGE: Record<Spot, { name: string; room: RoomId | null }> = {
  comando: { name: 'Command Center', room: 'comando' },
  laboratorio: { name: 'Laboratory', room: 'laboratorio' },
  radar: { name: 'Radar Room', room: 'radar' },
  arsenale: { name: 'Arsenal', room: 'arsenale' },
  deposito: { name: 'Depot', room: 'deposito' },
  spedizione: { name: 'Extraction Teams', room: 'spedizione' },
  mercato: { name: 'Market', room: 'mercato' },
  gioca: { name: '', room: 'fronte' }, // la partita: niente titolo, il fronte è il titolo
  profilo: { name: '', room: 'comando' }, // il Profilo ha la sua testata
  test: { name: 'Test mode', room: null },
  sandbox: { name: 'Sandbox', room: 'fronte' },
};

/** Accampamento (home): piccolo all'inizio, cresce con edifici, tende e spedizioni. */
export class CampScene extends Phaser.Scene {
  profile!: Profile; // condiviso con l'albero della ricerca (TreeScene)
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
  private radar: { view: RegistryRadar | ResearchCube; tex: Phaser.Textures.CanvasTexture; x: number; y: number; w: number; h: number; card: Phaser.GameObjects.Text[]; hot: RadarEntry | null } | null = null; // registro o archivio 3D della Sala Radar
  private radarTab: 'registro' | 'archivio' = 'registro';
  private sandbox: SandboxConfig = { troops: 500, resources: 200, front: 0, minutes: 30, civ: 'republica', units: ['fanteria', 'ricognitori', 'artiglieria'], level: 0, speed: 1, doctrine: 'none', map: 'world' }; // scelte della sandbox
  private pageKey = '';
  private expKind: ExpeditionKind = 'breve'; // missione scelta nell'Estrazione
  private panelSpot: Spot | null = null;
  private refreshAcc = 0;
  private panelKey = '';
  private lastToast: Phaser.GameObjects.Container | null = null;
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;
  private nav!: NavBar;
  private previewFront: number | null = null; // fronte chiuso guardato in anteprima nella pagina GIOCA
  private backTo: NavTab | null = null; // sezione da cui si è aperta la pagina: "←" torna lì (Nico: niente ritorni a caso)
  private navBtns: { btn: { setOn: (on: boolean) => void; setVisible: (v: boolean) => void }; on: () => boolean }[] = [];
  private lume = { email: null as string | null, balance: null as number | null, busy: false }; // Lume (acquisti con soldi veri)

  constructor() {
    super('Camp');
  }

  create(data?: CampData) {
    uiCamera(this);
    this.audioPanel = null;
    this.radar = null;
    this.events.once('shutdown', () => this.dropRadar()); // il registro 3D ha il suo contesto WebGL: si libera uscendo
    music.setMode('hq'); // musica della base: calma
    this.profile = loadProfile();
    // campagna lasciata a metà (app chiusa): la puntata rientra come in una ritirata
    const back = recoverStake(this.profile);
    if (back) {
      saveProfile(this.profile);
      this.time.delayedCall(900, () => this.toast(`CAMPAIGN INTERRUPTED: the stake comes back: +${back} resources (retreat fee)`, PALETTE.allerta));
    }
    // dopo la run guidata: il nome del comandante (una volta sola, si cambia toccandolo)
    if (this.profile.runs >= 1 && !this.profile.name && !this.profile.nameAsked) this.time.delayedCall(600, () => this.editName(true));
    this.spots = new Map();
    this.timerTexts = new Map();
    this.panel = null;
    this.page = null;
    this.pageKey = ''; // la scena riparte (es. finestra ridimensionata): la pagina va ridisegnata
    this.panelSpot = null;
    this.backTo = null;
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
    // voce scelta nella schermata d'entrata: si apre la sua pagina
    const open = data?.open;
    if (open) this.time.delayedCall(350, () => {
      if (open === 'mercato' && this.profile.runs === 0) this.toast('The Market opens after the first campaign', PALETTE.carta);
      else if (open === 'estrazione') this.onTab('mercato'); // l'Estrazione sta nel Mercato
      else if (open === 'profilo') this.openPanel('profilo');
      else if (open === 'sandbox') this.openPanel('sandbox');
      else this.onTab(open);
    });
  }

  /** Lume all'avvio: saldo e consegne in sospeso; al ritorno da Stripe (?lume=ok) aspetta l'accredito del webhook. */
  private startLume() {
    const q = new URLSearchParams(location.search), back = q.get('lume');
    if (back) {
      q.delete('lume');
      history.replaceState(null, '', location.pathname + (q.size ? `?${q}` : '') + location.hash);
    }
    if (back === 'annullato') this.time.delayedCall(700, () => this.toast('Payment cancelled\nNothing was charged.', PALETTE.allerta));
    const before = this.lume.balance;
    void this.syncLume().then(async () => {
      if (back !== 'ok') return;
      // il webhook di Stripe può arrivare qualche secondo dopo il ritorno: ricontrolla per ~20 s
      for (let i = 0; i < 10 && this.scene.isActive() && (this.lume.balance ?? 0) <= (before ?? 0); i++) {
        await new Promise((r) => setTimeout(r, 2000));
        await this.syncLume();
      }
      if (this.scene.isActive()) this.toast(`Payment received\nBalance: ${this.lume.balance ?? 0} Fragments.`, PALETTE.radioattivo);
    });
  }

  /** Rilegge saldo e consegne dal server, applica le consegne al profilo, salva, poi le segna come ritirate. */
  private async syncLume() {
    this.lume.email = await signedEmail();
    if (!this.lume.email) { this.lume.balance = null; this.nav.setLume(null); return this.refreshShop(); }
    const r = await fetchWallet();
    if (!r.ok) return this.refreshShop();
    this.lume.balance = r.data.lume;
    this.nav.setLume(r.data.lume);
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
    if (this.scene.isActive() && this.panelSpot === 'profilo') this.openPanel('profilo'); // i Frammenti stanno nel Profilo
  }

  private lumeLogin() {
    askField({ title: shopText.lume.login, note: shopText.lume.loginNote, placeholder: 'nome@esempio.it', type: 'email', maxLength: 120, inputMode: 'email' }, async (email) => {
      if (!email) return;
      if (!(await sendCode(email))) return this.toast('Invalid email\nCheck it and try again.', OPS.loss);
      askField({ title: shopText.lume.codeTitle, note: shopText.lume.codeNote.replace('{email}', email), placeholder: '123456', type: 'text', maxLength: 10, inputMode: 'numeric' }, async (code) => {
        if (!code) return;
        if (!(await verifyCode(email, code.replace(/\s/g, '')))) return this.toast('Wrong or expired code\nRequest a new one.', OPS.loss);
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
      this.toast(r.error === 'lume' ? 'Not enough Fragments\nBuy a pack.' : r.error === 'daily' ? 'Already taken today\nThe resource pack is back tomorrow.' : 'Operation failed\nTry again shortly.', OPS.loss);
      return this.syncLume();
    }
    this.lume.balance = r.data.lume;
    this.nav.setLume(r.data.lume);
    buzz(12);
    this.applyGrants([r.data.grant]);
    this.refreshShop();
  }

  private async lumeBuy(pack: PackId) {
    if (this.lume.busy) return;
    this.lume.busy = true;
    const err = await buyPack(pack);
    this.lume.busy = false;
    if (err) this.toast('Payment unavailable\nTry again shortly.', OPS.loss);
  }

  /** Sezione Lume in cima al Mercato: accesso, saldo, pacchetti, risorse. Ritorna la y sotto. */
  private fillLume(items: Phaser.GameObjects.GameObject[], L: number, y: number, w: number): number {
    const T = shopText.lume, e = this.lume;
    y = this.head(items, L, y, w, T.title, e.balance === null ? '' : `${e.balance} Fragments`, OPS.accent);
    if (!e.email) {
      const d = body(this, L, y, T.desc, 12, OPS.body, w);
      items.push(d, this.btn(T.login, L, d.y + d.height + 10, w, true, () => this.lumeLogin(), 12));
      return d.y + d.height + 10 + 40 + 16;
    }
    const ids = Object.keys(LUME_PACKS) as PackId[], pw = (w - (ids.length - 1) * 6) / ids.length;
    ids.forEach((k, i) => {
      const P = LUME_PACKS[k], eur = (P.cents / 100).toFixed(2).replace('.', ',');
      items.push(this.btn(`${P.lume} FRAGMENTS, ${eur} €`, L + i * (pw + 6), y, pw, !e.busy, () => void this.lumeBuy(k), 11));
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
    this.renderRadar();
    this.refreshAcc -= delta;
    if (this.refreshAcc > 0) return;
    this.refreshAcc = 250;
    this.settleAll(false);
    const now = Date.now();
    const d = new Date(now);
    this.clock?.setText(`HQ // ${civInfo(activeCiv(this.profile)).name.toUpperCase()}, SETTORE 07, ${d.toTimeString().slice(0, 8)}`);
    this.updateBoard();
    const c = this.profile.construction, e = this.profile.expedition;
    if (!this.panelSpot) this.refreshWorks();
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
    if (spot === 'spedizione') return `${this.expKind}|${p.stash.cibo}|${!p.expedition ? 'none' : p.expedition.until > now ? 'away:timer' : 'ready'}`;
    if (spot === 'test') return `test|${p.test ? 1 : 0}`;
    if (spot === 'sandbox') return `sandbox|${JSON.stringify(this.sandbox)}`;
    if (spot === 'mercato') {
      // si ridisegna quando cambiano risorse, acquisti o il prezzo per finire i lavori (a minuti)
      const mins = [p.construction, p.research].map((j) => (j && j.until > now ? Math.ceil((j.until - now) / 60_000) : 0)).join(',');
      const ex = !p.expedition ? 'none' : p.expedition.until > now ? 'away:timer' : 'back'; // l'Estrazione sta qui: il suo tempo scorre
      return `mercato|${RESOURCES.map((r) => p.stash[r]).join(',')}|${(p.supplies ?? []).join(',')}|${mins}|${this.expKind}|${ex}`;
    }
    if (spot === 'gioca') return `gioca|${p.civ}|${p.campaign}|${p.front}|${this.previewFront}`;
    if (spot === 'profilo') return `profilo|${p.civ}|${p.name}`;
    const lab = '';
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
      this.tapRing(done, PALETTE.radioattivo, 1.15);
      buzz([30, 40, 30]);
      this.burst.setParticleTint(PALETTE.ocra);
      this.burst.explode(30, spot.x, spot.y);
      const lvl = this.profile.buildings[done];
      analytics.design(['accampamento', 'completato', done], lvl);
      this.toast(`${buildingText[done].name.toUpperCase()} LV. ${lvl} COMPLETE\n${buildingText[done].levels[lvl - 1]}`, PALETTE.radioattivo);
    }
    const tech = settleResearch(this.profile, Date.now());
    if (tech) {
      saveProfile(this.profile);
      const t = techInfo(tech);
      analytics.design(['laboratorio', 'ricerca', tech]);
      this.toast(`RESEARCH COMPLETE: ${t.name.toUpperCase()}\n${t.desc}${t.lore ? '\nNew fragment in the archive of the Fall' : ''}`, PALETTE.radioattivo);
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
    this.capText?.setText(finite ? `DEPOT: capacity ${cap} per resource` : 'DEPOT: no limit (test)');
    const now = Date.now(), c = p.construction, rs = p.research;
    const parts = [
      c ? `🔨 ${buildingText[c.id].name} lv. ${p.buildings[c.id] + 1}, ${fmtTime(c.until - now)}` : '',
      rs ? `⚗ ${techInfo(rs.id).name}, ${fmtTime(rs.until - now)}` : '',
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
    const DISH = 0.12; // dove sta la cima dell'antenna nell'immagine (in altezza): appena sotto la barra
    // abbastanza grande da avere la parabola sotto la barra e la roccia fino in fondo (prima la parabola finiva dietro le stanze)
    const s = Math.max(width / img.width, height / img.height, (height - skyTop) / (img.height * (1 - DISH)));
    img.setScale(s).setPosition(width / 2, Math.max(height - img.height * s, Math.min(0, skyTop - DISH * img.height * s)));
    fade(this, 0, rockY, width, height - rockY, 0x05080d, 0.2, 0.7).setDepth(-1);
  }

  /** Ogni stanza mostra sempre la sua foto (Nico: prima tutte quelle da costruire avevano la stessa); spenta finché non c'è. */
  // nella base la stanza ha la sua foto in verticale e piena (Nico, 25 novembre 2026: "migliora immagini", via la metà nera);
  // la foto larga resta per il fondo della sua pagina
  private roomKey(id: MapSpot): string {
    return this.textures.exists(`base-${id}`) ? `base-${id}` : ROOM_IMG[id];
  }

  private roomBuilt(id: MapSpot): boolean {
    const isB = (BUILDINGS as string[]).includes(id), lvl = isB ? this.profile.buildings[id as BuildingId] : 1;
    return lvl > 0;
  }

  /** Stanza della base: foto ritagliata nella cella, targa in basso (icona, nome, livello, stato), tutta la cella si tocca. */
  private makeSpot(id: MapSpot, x: number, y: number, w: number, h: number) {
    const g = this.add.graphics().setDepth(3);
    const ph = this.plaqueH(h);
    const name = heading(this, x + 32, y + h - ph / 2 - 8, CELL[id], 14).setOrigin(0, 0.5).setDepth(6);
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
      this.tapRing(id, OPS.text, 1);
      // nella base ogni stanza apre i suoi livelli (costruire e migliorare); le funzioni stanno nelle sezioni della barra
      this.backTo = 'base';
      if (id === 'spedizione') this.openPanel('spedizione');
      else this.openPanel(id);
    });
  }

  private plaqueH = (h: number) => Phaser.Math.Clamp(h * 0.3, 50, 56); // due righe: nome e cosa dà adesso

  /** Cornice e targa della stanza; sotto il mouse la foto si accende e la cornice diventa bianca. */
  private paintRow(id: MapSpot, hover: boolean) {
    const r = this.spots.get(id);
    if (!r) return;
    const built = this.roomBuilt(id), ph = this.plaqueH(r.h);
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
    const building = isB && this.profile.construction?.id === id, locked = false, built = lvl > 0;
    const ph = this.plaqueH(h), cy = y + h - ph / 2 - 8;
    spot.label.setColor(hex(built ? OPS.text : OPS.body));
    // seconda riga: cosa fa la stanza adesso (il livello raggiunto), o cosa sta facendo l'Estrazione
    const exp = id === 'spedizione' ? this.profile.expedition : null;
    const now = !isB ? (exp ? (exp.until > Date.now() ? 'Teams on a mission' : 'Teams on their way back') : 'Teams ready to leave')
      : lvl > 0 ? levelParts(buildingText[id as BuildingId].levels[lvl - 1])[0] : buildingText[id as BuildingId].desc.split('.')[0];
    spot.deco.push(fit(label(this, x + 32, cy + 18, now, OPS.label, 9).setOrigin(0, 0.5).setDepth(6), w - 44));
    spot.deco.push(icon(this, STATION_ICON[id], x + 16, cy + 8, 18, built ? OPS.text : OPS.label).setDepth(6));
    // a destra della targa: livello, oppure lo stato quando conta (da costruire, migliorabile, di ritorno, chiuso)
    const e = id === 'spedizione' ? this.profile.expedition : null;
    const upgradable = isB && built && lvl < max && !building && !buildBlock(this.profile, id as BuildingId);
    const state: [string, number] | null = locked ? ['Locked', OPS.label] : building ? ['Under construction', PALETTE.allerta] : !built ? ['Not built', OPS.label]
      : e && e.until <= Date.now() ? ['Back', OPS.gain] : upgradable ? ['Upgradable', OPS.gain] : null;
    const right = state ? label(this, x + w - 10, cy, state[0], state[1], 9) : max ? label(this, x + w - 10, cy, `Lv ${lvl}/${max}`, OPS.label, 9) : null;
    if (right) spot.deco.push(right.setOrigin(1, 0.5).setDepth(6));
    spot.label.setScale(1);
    fit(spot.label, w - 42 - (right ? right.width + 10 : 0));
    this.paintRow(id, false);
  }

  // ---------- interfaccia ----------

  private drawHud() {
    const { width, height } = view(this);
    const P = this.portrait, p = this.profile;
    const M = P ? 10 : 18, B = M + this.safe.bottom;
    const g = this.add.graphics().setDepth(1);

    // barra fissa in alto (Home, sezioni, scorte, audio): la stessa sopra la base e sopra ogni pagina
    const barY = 0, barH = NAV_H, L = M, R = width - M;
    this.nav = new NavBar(this, width, {
      onHome: () => this.goHome(),
      onTab: (t) => this.onTab(t),
      onAudio: (x) => this.toggleAudio(x - 236, NAV_H - 34),
      onProfile: () => { this.backTo = null; this.openPanel('profilo'); },
      locked: p.runs === 0 ? { mercato: 'The Market opens after the first campaign' } : {},
      onLocked: (why) => this.toast(why, PALETTE.carta),
    });
    this.nav.setActive('base');
    this.stashTexts = this.nav.stashTexts();
    this.stashBars = [];
    this.capText = null;
    this.statusText = null;
    // tasto TEST solo in sviluppo o con ?test=1 nell'indirizzo
    const testOk = import.meta.env.DEV || p.test || new URLSearchParams(location.search).has('test');
    if (testOk) label(this, R - 2, height - 6, p.test ? 'Test on' : 'Test', PALETTE.allerta, 8).setOrigin(1, 1).setDepth(61)
      .setInteractive({ useHandCursor: true }).on('pointerup', () => this.openPanel('test'));

    // colonna di destra (in verticale: fascia in fondo): lavori in corso e prossima operazione
    const top = barY + barH + (P ? 26 : 22), bottom = height - B;
    const sideW = P ? R - L : Phaser.Math.Clamp(width * 0.25, 250, 330);
    const footH = P ? 196 : 0;
    const side = P ? { x: L, y: bottom - footH, w: sideW, h: footH } : { x: R - sideW, y: top, w: sideW, h: bottom - top };
    this.drawOps(g, side.x, side.y, side.w, side.h, P);

    // stanze: tre piani nella roccia sotto la vetta (in verticale il Comando largo in cima, poi due colonne)
    const gap = P ? 6 : 8;
    const area = P ? { x: L, y: top, w: R - L, h: side.y - 10 - top } : { x: L, y: top, w: side.x - 14 - L, h: bottom - top };
    const surface = P ? 0 : Math.min(170, area.h * 0.2); // in orizzontale si vede la vetta con il radar sopra le stanze
    const ry0 = area.y + surface, ah = area.h - surface;
    this.placeMountain(barY + barH + 4, ry0);
    // roccia scura dietro le stanze, come la sezione della montagna
    g.fillStyle(0x070a0e, 0.72).fillRect(area.x - 4, ry0 - 4, area.w + 8, ah + 8);
    // priorità (Nico): il Centro di Comando grande a sinistra, che sblocca tutto; a destra le altre stanze una sotto l'altra.
    // Laboratorio, Arsenale, Deposito ed Estrazione non sono stanze della base (Nico, 25 novembre 2026: tolte di nuovo)
    if (P) {
      const rh = (ah - gap * 2) / 3, cw = (area.w - gap) / 2;
      this.makeSpot('comando', area.x, ry0, area.w, rh);
      SIDE_ROOMS.forEach((id, k) => this.makeSpot(id, area.x + k * (cw + gap), ry0 + rh + gap, cw, rh * 2 + gap));
    } else {
      const bw = Math.round(area.w * 0.58), sw = area.w - bw - gap, sh = (ah - gap * (SIDE_ROOMS.length - 1)) / SIDE_ROOMS.length;
      this.makeSpot('comando', area.x, ry0, bw, ah);
      SIDE_ROOMS.forEach((id, k) => this.makeSpot(id, area.x + bw + gap, ry0 + k * (sh + gap), sw, sh));
    }
  }

  /**
   * Colonna della base = il cantiere, perché la base serve a costruire (Nico: "cosa ha senso avere dove"): il lavoro in corso
   * con avanzamento e "finisci ora", oppure le stanze migliorabili adesso. Ricerca ed estrazione stanno nelle loro sezioni e
   * nella home, la campagna in Operazioni: qui niente doppioni.
   */
  private drawOps(_g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, _P: boolean) {
    this.worksArea = { x, y, w, h };
    this.worksKey = '';
    this.refreshWorks();
  }

  private worksArea = { x: 0, y: 0, w: 0, h: 0 };
  private worksKey = '';
  private worksBox: Phaser.GameObjects.Container | null = null;
  private worksTime: Phaser.GameObjects.Text | null = null;
  private worksBar: Phaser.GameObjects.Rectangle | null = null;

  /** Ridisegna la colonna del cantiere quando cambia lo stato; il tempo e la barra si aggiornano da soli. */
  private refreshWorks() {
    const p = this.profile, now = Date.now(), c = p.construction, { x, y, w } = this.worksArea;
    const key = `${c?.id ?? ''}|${BUILDINGS.map((b) => p.buildings[b]).join(',')}|${RESOURCES.map((r) => p.stash[r]).join(',')}|${c ? rushable(c.until, now) : ''}`;
    if (c && this.worksTime) {
      const total = BALANCE.camp.buildings[c.id][p.buildings[c.id]].timeSec * 1000;
      this.worksTime.setText(fmtTime(c.until - now));
      this.worksBar?.setSize(Math.max(0, (w - 32) * Phaser.Math.Clamp(1 - (c.until - now) / total, 0, 1)), 4);
    }
    if (key === this.worksKey) return;
    this.worksKey = key;
    this.worksBox?.destroy();
    this.worksTime = this.worksBar = null;
    const items: Phaser.GameObjects.GameObject[] = [];
    items.push(lineIcon(this, 'hammer', x + 9, y + 10, 18, OPS.text), heading(this, x + 26, y + 10, 'Construction', 17).setOrigin(0, 0.5),
      label(this, x + w, y + 10, c ? 'Working' : 'Free', c ? PALETTE.allerta : OPS.gain, 10).setOrigin(1, 0.5));
    let yy = y + 34;
    if (c) {
      // lavoro in corso: foto della stanza, nome, livello, tempo, barra, finisci ora
      const bh = 150, cost = rushCost(c.until, now), fast = rushable(c.until, now), ok = fast && p.stash.metallo >= cost;
      items.push(this.add.rectangle(x, yy, w, bh, OPS.row, 0.62).setOrigin(0).setStrokeStyle(1, PALETTE.allerta, 0.6),
        coverImage(this, ROOM_IMG[c.id], x + 1, yy + 1, w - 2, 78, 0.5).setTint(0xc9d2da),
        heading(this, x + 16, yy + 96, buildingText[c.id].name, 16).setOrigin(0, 0.5),
        label(this, x + 16, yy + 116, `Towards level ${p.buildings[c.id] + 1}`, OPS.label, 10).setOrigin(0, 0.5));
      this.worksTime = heading(this, x + w - 16, yy + 96, fmtTime(c.until - now), 16, PALETTE.allerta).setOrigin(1, 0.5);
      items.push(this.worksTime, this.add.rectangle(x + 16, yy + 134, w - 32, 4, OPS.edge, 0.4).setOrigin(0));
      this.worksBar = this.add.rectangle(x + 16, yy + 134, 0, 4, PALETTE.allerta).setOrigin(0);
      items.push(this.worksBar);
      yy += bh + 10;
      items.push(this.btn(fast ? `FINISH NOW: ${cost} METAL` : 'METAL UNDER 60 MIN', x, yy, w, ok, () => {
        if (!rush(p, 'construction', Date.now())) return;
        analytics.design(['mercato', 'accelera', 'construction'], cost);
        saveProfile(p);
        this.settleAll(false);
      }, 13));
      yy += 52;
    } else {
      items.push(body(this, x, yy, 'One room at a time. Tap a room to see its levels.', 12, OPS.body, w));
      yy += 44;
    }
    // stanze migliorabili adesso (o le prossime, con cosa manca)
    items.push(label(this, x, yy, c ? 'After this job' : 'Next jobs', OPS.label, 10));
    yy += 22;
    const why = { busy: 'Construction busy', cost: 'Not enough resources', comando: 'Needs the Command Center', max: 'At maximum' } as const;
    const list = BUILDINGS.filter((b) => b !== c?.id && p.buildings[b] < maxLvl(b))
      .sort((a, b) => Number(!!buildBlock(p, a)) - Number(!!buildBlock(p, b)));
    // una riga per stanza: nome e livello in alto, costi con le icone sotto (prima stavano sulla stessa riga e si accavallavano);
    // quelle migliorabili adesso hanno la barretta verde a sinistra
    for (const id of list.slice(0, 6)) {
      const block = buildBlock(p, id), lvl = p.buildings[id], next = nextLevel(p, id), ready = !block;
      const r = this.add.rectangle(x, yy, w, 54, OPS.row, 0.62).setOrigin(0).setStrokeStyle(1, OPS.edge, 0.3)
        .setInteractive({ useHandCursor: true }).on('pointerup', () => { this.backTo = 'base'; this.openPanel(id); })
        .on('pointerover', () => r.setFillStyle(OPS.row, 0.92)).on('pointerout', () => r.setFillStyle(OPS.row, 0.62));
      items.push(r, icon(this, STATION_ICON[id], x + 18, yy + 17, 16, block && block !== 'busy' ? OPS.label : OPS.text),
        fit(heading(this, x + 36, yy + 17, buildingText[id].name, 13, OPS.text).setOrigin(0, 0.5), w - 130),
        label(this, x + w - 10, yy + 17, lvl ? `Lv ${lvl} → ${lvl + 1}` : 'Not built', ready ? OPS.gain : OPS.label, 9).setOrigin(1, 0.5));
      if (ready) items.push(this.add.rectangle(x, yy, 2, 54, OPS.gain).setOrigin(0));
      if (next && block !== 'comando') { // costi sempre visibili, in rosso quello che manca
        let cx = x + 36;
        for (const res of RESOURCES) {
          const v = next.cost[res];
          if (!v) continue;
          items.push(resIcon(this, res, cx + 6, yy + 38, 12));
          const t = label(this, cx + 16, yy + 38, v.toLocaleString('en-US'), p.stash[res] >= v ? OPS.body : OPS.loss, 9).setOrigin(0, 0.5);
          items.push(t);
          cx = t.x + t.width + 14;
        }
      } else items.push(fit(label(this, x + 36, yy + 38, why[block!], OPS.label, 9).setOrigin(0, 0.5), w - 46));
      yy += 60;
    }
    this.worksBox = this.add.container(0, 0, items).setDepth(2);
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

  /** Home: la schermata d'entrata con la carta e il menu. */
  private goHome() {
    this.cameras.main.fadeOut(250, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Title', { next: 'Camp' }));
  }

  /** Sezione della barra in alto. */
  private onTab(t: NavTab) {
    this.backTo = null;
    this.previewFront = null;
    this.scene.stop('Tree');
    if (t === 'base') this.closePanel();
    else if (t === 'gioca') this.onPlay();
    else if (t === 'ricerca' || t === 'arsenale') this.openTree(t);
    else this.openPanel(t);
  }

  /** Sezione della barra accesa per una pagina: le stanze stanno sotto Base. */
  private navOf(spot: Spot | null): NavTab | null {
    if (this.backTo && spot !== 'gioca' && spot !== 'mercato' && spot !== 'profilo') return this.backTo;
    if (spot === 'gioca' || spot === 'mercato' || spot === 'arsenale') return spot;
    if (spot === 'deposito') return 'mercato';
    if (spot === 'laboratorio') return 'ricerca';
    if (spot === 'profilo' || spot === 'sandbox') return null;
    return 'base';
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
    this.dropRadar();
    this.page?.destroy();
    this.page = null;
    this.pageKey = '';
    this.panelSpot = null;
    this.backTo = null;
    this.nav?.setActive('base');
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
    const P = this.portrait, T = NAV_H, Bm = PAD + this.safe.bottom, head = PAGE_HEAD, info = PAGE[spot], p = this.profile;
    const top = T + head;
    // la stanza si vede a sinistra (in verticale sopra), il fascicolo sta a destra (sotto), come le stanze di XCOM 2
    let x0: number, y0: number, W: number, H: number;
    if (!info.room) { x0 = PAD; y0 = top; W = width - 2 * PAD; H = height - top - Bm; }
    else if (spot === 'mercato') {
      // Mercato al centro (Nico): titolo e fascicolo sulla stessa colonna
      W = Math.min(1180, width - 2 * PAD); x0 = (width - W) / 2; y0 = top; H = height - top - Bm;
    }
    else if (P) {
      const ah = Math.min(height * 0.2, width * 0.6);
      x0 = PAD; y0 = top + ah + 10; W = width - 2 * PAD; H = height - y0 - Bm;
    } else {
      // fascicolo largo (Nico: "le pagine sono piccole e fitte"): ~40% dello schermo, mai sotto 500 punti
      const aw = width - 2 * PAD - 12 - Phaser.Math.Clamp(width * 0.4, 500, 720);
      // il fascicolo parte subito sotto la barra (il titolo sta a sinistra): più spazio in altezza
      x0 = PAD + aw + 12; y0 = T + 16; W = width - x0 - PAD; H = height - y0 - Bm;
    }
    const st = this.roomState(spot);
    const key = `${spot}|${this.backTo}|${this.pageBg(spot)}|${JSON.stringify(st)}|${width}x${height}|${spot === 'radar' ? this.radarTab : ''}`;
    if (key !== this.pageKey) {
      const fresh = !this.page;
      this.dropRadar();
      this.page?.destroy();
      this.pageKey = key;
      // fondo: la foto della stanza a tutto schermo (l'elicottero per l'Estrazione, come nel Figma), velata solo dietro
      // al titolo e al fascicolo
      // Sala Radar: al posto della foto il registro in 3D, a sinistra del fascicolo
      const radar = spot === 'radar' && !P;
      const objs: Phaser.GameObjects.GameObject[] = [
        this.add.rectangle(0, 0, width, height, radar ? 0x05080d : 0x07090c, 1).setOrigin(0).setInteractive(), // la base sotto non riceve i tocchi
      ];
      if (radar) objs.push(...this.makeRadar(0, T, x0 - 12, height - T));
      else objs.push(coverImage(this, this.pageBg(spot), 0, 0, width, height, 0.5).setTint(0xd4dce4));
      {
        objs.push(fade(this, 0, 0, width, T + 120, 0x05080d, 0.8, 0));
        if (!info.room || spot === 'mercato' || spot === 'profilo') objs.push(this.add.rectangle(0, 0, width, height, 0x05080d, spot === 'profilo' ? 0.78 : spot === 'mercato' ? 0.7 : 0.55).setOrigin(0));
        else if (spot === 'gioca') { /* GIOCA disegna i suoi veli */ }
        else if (P) objs.push(fade(this, 0, y0 - 60, width, height - y0 + 60, 0x05080d, 0, 0.85));
        else if (radar) objs.push(fade(this, 0, T, x0, 150, 0x05080d, 0.85, 0)); // solo dietro al titolo
        else {
          // stanze: la foto più scura, il contenuto conta più dell'immagine (Nico)
          objs.push(this.add.rectangle(0, 0, width, height, 0x05080d, 0.35).setOrigin(0), fade(this, x0 - 80, 0, width - x0 + 80, height, 0x05080d, 0, 0.6, 'h'));
        }
      }
      // testata sotto la barra fissa: "← Base" per tornare (sempre nello stesso posto), sotto il titolo grande col livello
      const isB = (BUILDINGS as string[]).includes(spot), lvl = isB ? p.buildings[spot as BuildingId] : 0, max = isB ? maxLvl(spot as BuildingId) : 0;
      const em = spot === 'mercato' ? x0 : PAD + 12;
      const by = T + 22;
      // ritorno alla sezione da cui la pagina dipende: Deposito → Mercato, Arsenale → il suo albero, Laboratorio → Ricerca;
      // le altre stanze → Base (solo se ci si è arrivati dalla base)
      const back = this.backTo, NAMES: Record<NavTab, string> = { gioca: 'Play', base: 'Base', ricerca: 'Research', arsenale: 'Arsenal', mercato: 'Market' };
      const parent: [string, () => void] | null = back ? [NAMES[back], () => this.onTab(back)] : null;
      if (parent) {
        const bi = lineIcon(this, 'back', em + 9, by, 16, OPS.body), bt = label(this, em + 24, by, parent[0], OPS.body, 11).setOrigin(0, 0.5);
        objs.push(bi, bt, this.add.rectangle(em - 6, by - 14, bt.x + bt.width - em + 18, 28, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true })
          .on('pointerover', () => { bi.setTint(OPS.text); bt.setColor(hex(OPS.text)); })
          .on('pointerout', () => { bi.setTint(OPS.body); bt.setColor(hex(OPS.body)); })
          .on('pointerup', parent[1]));
      }
      const tsize = Phaser.Math.Clamp(width * 0.03, 30, 46), ty = T + 62;
      const title = value(this, em, ty - (isB ? 6 : 0), info.name, tsize).setOrigin(0, 0.5);
      fit(title, width - em - 16 - title.x);
      if (info.name) objs.push(title); else title.destroy();
      if (isB) objs.push(label(this, title.x + 1, title.y + title.displayHeight / 2 + 2, (st.building ? `Under construction towards level ${lvl + 1}` : lvl ? `Level ${lvl} of ${max}` : 'Not built'),
        st.building ? PALETTE.allerta : OPS.label, 9));
      this.page = this.add.container(0, 0, objs).setDepth(39);
      if (fresh) {
        this.page.setAlpha(0);
        this.tweens.add({ targets: this.page, alpha: 1, duration: 200, ease: 'Quad.easeOut' });
      }
    }
    return { x0, y0, W, H };
  }

  /** Fondo della pagina: GIOCA la foto del fronte scelto, le altre la foto della loro stanza. */
  private pageBg(spot: Spot): string {
    if (spot === 'gioca') return this.frontImage(this.previewFront ?? activeFront(this.profile));
    return ROOM_IMG[spot]; // il Mercato: la sua stanza (il porto tropicale non c'entrava, Nico)
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



  /**
   * Pagine (Nico, 23 novembre 2026: "ogni pagina con la sua gerarchia, niente schermate vecchie"): GIOCA = la partita a tutto
   * schermo (fillPlay); Profilo = comandante, potenza, registro; Mercato al centro; ogni stanza della base = i suoi livelli
   * (l'Estrazione = le sue missioni). Ricerca e Arsenale aprono l'albero (TreeScene), non una pagina.
   */
  private openPanel(spot: Spot) {
    this.scene.stop('Tree');
    const fresh = spot !== this.panelSpot; // scheda appena aperta (non un ridisegno per i timer): entra con una dissolvenza
    this.panel?.destroy();
    this.panelSpot = spot;
    this.nav.setActive(this.navOf(spot));
    this.panelKey = this.panelState(spot, Date.now());
    const { x0, y0, W, H } = this.drawPage(spot);
    const items: Phaser.GameObjects.GameObject[] = [];
    if (spot === 'gioca') {
      this.fillPlay(items);
    } else if (spot === 'profilo') {
      this.fillProfile(items);
    } else {
      // fascicolo: riquadro scuro velato sulla foto, alto quanto il suo contenuto
      const fg = this.add.graphics();
      items.push(fg);
      const L = x0 + IN, w = W - 2 * IN, y = y0 + IN;
      let end: number;
      if (spot === 'test') end = this.fillTest(items, L, y, w);
      else if (spot === 'sandbox') end = this.fillSandbox(items, L, y, w);
      else if (spot === 'mercato') end = this.fillShop(items, L, y, w);
      else if (spot === 'spedizione') end = this.fillExpedition(items, L, y, w);
      else end = this.fillLevels(items, spot as BuildingId, L, y, w);
      panel(fg, x0, y0, W, Math.min(H, end + IN - y0));
      // Centro di Comando (Nico: "cosa ha senso avere dove"): a sinistra, sulla foto, la potenza che guidi e la tua forza;
      // a destra restano solo i livelli
      if (spot === 'sandbox' && !this.portrait) {
        const lx = PAD + 12, ly = NAV_H + PAGE_HEAD + 8, lw = Math.min(640, x0 - 24 - lx), lg = this.add.graphics();
        items.unshift(lg); // sotto i contenuti
        const ey = this.fillSandboxArmy(items, lx + IN, ly + IN, lw - 2 * IN);
        panel(lg, lx, ly, lw, ey + IN - ly);
      }
      if (spot === 'comando' && !this.portrait) {
        const lx = PAD + 12, ly = NAV_H + PAGE_HEAD + 8, lw = Math.min(620, x0 - 24 - lx), lg = this.add.graphics();
        items.push(lg);
        let ey = this.fillPower(items, lx + IN, ly + IN, lw - 2 * IN, true);
        const pw = playerPower(this.profile);
        ey = this.head(items, lx + IN, ey, lw - 2 * IN, 'Strength', 'base levels, research and units');
        items.push(tech(this, lx + IN, ey + 2, String(pw), 44), body(this, lx + IN + 110, ey + 8,
          'Higher than the front\'s recommended power = a campaign within your reach. It grows with the Command Center, the other rooms and research.', 12, OPS.body, lw - 2 * IN - 110));
        ey += 70;
        panel(lg, lx, ly, lw, ey + IN - ly);
        items.splice(items.indexOf(lg), 1);
        items.unshift(lg); // sotto i contenuti
      }
    }
    this.panel = this.add.container(0, 0, items).setDepth(40);
    if (fresh) {
      this.panel.setAlpha(0).setY(8);
      this.tweens.add({ targets: this.panel, alpha: 1, y: 0, duration: 170, ease: 'Quad.easeOut' });
    }
  }

  /**
   * Livelli della stanza: a cosa serve, la funzione della stanza (Arsenale: l'albero), i livelli (spunta = fatto, cantiere = in
   * costruzione, freccia = prossimo, lucchetto = più avanti), poi subito sotto costo e tasto, oppure l'avanzamento del cantiere.
   */
  private fillLevels(items: Phaser.GameObjects.GameObject[], spot: BuildingId, L: number, y: number, w: number): number {
    const p = this.profile, T = buildingText[spot], lvl = p.buildings[spot], n = T.levels.length, now = Date.now();
    if (spot === 'comando' && this.portrait) y = this.fillPower(items, L, y, w); // in orizzontale la potenza sta a sinistra
    if (spot === 'radar') y = this.fillService(items, L, y, w);
    const c = p.construction, building = c?.id === spot, next = nextLevel(p, spot);
    const desc = body(this, L, y, T.desc, 13, OPS.text, w);
    items.push(desc);
    y = desc.y + desc.height + 18;
    if (spot === 'deposito') {
      // quanto è pieno adesso: una barra per risorsa (prima si leggeva solo la capienza dei livelli)
      const cap = stashCap(p), fin = Number.isFinite(cap);
      y = this.head(items, L, y, w, 'Stock now', fin ? `capacity ${cap.toLocaleString('en-US')} per resource` : 'no limit');
      RESOURCES.forEach((r, i) => {
        const ry = y + i * 26, v = p.stash[r], full = fin && v >= cap;
        items.push(resIcon(this, r, L + 9, ry + 8, 16), label(this, L + 26, ry + 8, RESOURCE_INFO[r].name, OPS.body, 10).setOrigin(0, 0.5),
          label(this, L + w, ry + 8, fin ? `${v.toLocaleString('en-US')} / ${cap.toLocaleString('en-US')}` : String(v), full ? OPS.loss : OPS.text, 10).setOrigin(1, 0.5));
        this.bar(items, L + 110, ry + 6, w - 230, fin ? v / cap : 1, full ? OPS.loss : RESOURCE_INFO[r].color);
      });
      y += RESOURCES.length * 26 + 14;
    }
    // cosa fa la stanza adesso, in chiaro (Nico: "il Radar sembra vago, spiega cosa sblocca")
    if (lvl > 0) {
      const [nowName, nowEff] = levelParts(T.levels[lvl - 1]);
      items.push(label(this, L, y, `Now, level ${lvl}`, OPS.gain, 11), heading(this, L, y + 18, nowName, 17));
      const ne = nowEff ? body(this, L, y + 42, nowEff, 13, OPS.text, w) : null;
      if (ne) items.push(ne);
      y = (ne ? ne.y + ne.height : y + 40) + 22;
    }
    // Pagina pensata per una cosa sola, migliorare la stanza (Nico: "ogni UI per il suo caso d'uso"): in testa il prossimo
    // livello e cosa dà, sotto cosa serve con spunte (risorse, cantiere, Comando), il tasto che dice cosa manca; in fondo la
    // storia dei livelli, piccola.
    const why = (block: string | null): string => {
      if (block === 'busy') return `Construction busy: ${buildingText[c!.id].name}`;
      if (block === 'comando') return `Needs Command Center lv. ${lvl}`;
      if (block === 'cost' && next) {
        const miss = RESOURCES.filter((r) => p.stash[r] < next.cost[r]).map((r) => `${next.cost[r] - p.stash[r]} ${RESOURCE_INFO[r].name.toLowerCase()}`);
        return `Missing ${miss.join(', ')}`;
      }
      return '';
    };
    if (building) {
      const total = BALANCE.camp.buildings[spot][lvl].timeSec * 1000, cost = rushCost(c!.until, now), fast = rushable(c!.until, now), ok = fast && p.stash.metallo >= cost;
      const [nm, eff] = levelParts(T.levels[lvl]);
      items.push(label(this, L, y, `Under construction, level ${lvl + 1}`, PALETTE.allerta, 11), heading(this, L, y + 18, nm, 22));
      if (eff) items.push(body(this, L, y + 50, eff, 13, OPS.body, w));
      y += eff ? 84 : 58;
      this.bar(items, L, y, w, 1 - (c!.until - now) / total, PALETTE.allerta);
      items.push(tech(this, L, y + 14, fmtTime(c!.until - now), 26, PALETTE.allerta));
      y += 56;
      items.push(this.btn(fast ? `FINISH NOW: ${cost} METAL` : 'CAN BE FINISHED WITH METAL UNDER 60 MIN', L, y, w, ok, () => {
        if (!rush(p, 'construction', Date.now())) return;
        analytics.design(['mercato', 'accelera', 'construction'], cost);
        saveProfile(p);
        this.closePanel();
        this.settleAll(false);
      }, 13, true));
      y += 64;
    } else if (next) {
      const [nm, eff] = levelParts(T.levels[lvl]), block = buildBlock(p, spot);
      items.push(label(this, L, y, lvl ? `Next, level ${lvl + 1} of ${n}` : 'Not built', OPS.label, 11), heading(this, L, y + 18, nm, 22));
      if (eff) items.push(body(this, L, y + 50, eff, 13, OPS.body, w));
      y += eff ? 88 : 60;
      // cosa serve: una riga per requisito, spunta verde o croce rossa
      y = this.head(items, L, y, w, 'What you need');
      const req: [boolean, string, Phaser.GameObjects.GameObject | null, string][] = RESOURCES.filter((r) => next.cost[r] > 0).map((r) =>
        [p.stash[r] >= next.cost[r], `${next.cost[r].toLocaleString('en-US')} ${RESOURCE_INFO[r].name.toLowerCase()}`, resIcon(this, r, L + 38, 0, 16), `you have ${p.stash[r].toLocaleString('en-US')}`]);
      req.push([!p.construction, 'Construction free', null, p.construction ? buildingText[p.construction.id].name : '']);
      if (block === 'comando') req.push([false, `Command Center lv. ${lvl}`, null, '']);
      req.forEach(([ok, txt, ic, side], i) => {
        const ry = y + i * 30 + 10;
        items.push(icon(this, ok ? 'ui-spunta' : 'ui-chiudi', L + 10, ry, 14, ok ? OPS.gain : OPS.loss));
        if (ic) items.push((ic as Phaser.GameObjects.Image).setY(ry));
        items.push(heading(this, L + (ic ? 54 : 30), ry, txt, 14, ok ? OPS.text : OPS.loss).setOrigin(0, 0.5),
          label(this, L + w, ry, side, OPS.label, 10).setOrigin(1, 0.5));
      });
      const ty = y + req.length * 30 + 10;
      items.push(icon(this, 'ui-tempo', L + 10, ty, 13, OPS.label), label(this, L + 30, ty, `Duration ${fmtTime(next.timeSec * 1000)}`, OPS.label, 10).setOrigin(0, 0.5));
      y += req.length * 30 + 42;
      items.push(this.btn(block ? why(block) : `${lvl ? 'UPGRADE' : 'BUILD'}, ${fmtTime(next.timeSec * 1000)}`, L, y, w, !block, () => {
        if (!startBuild(p, spot, Date.now())) return;
        analytics.design(['accampamento', 'costruisci', spot], lvl + 1);
        analytics.resources('sink', next.cost, 'edificio', spot);
        saveProfile(p);
        this.closePanel();
        this.redrawSpot(spot as MapSpot);
        this.updateStash();
        this.toast(`Construction started: ${T.name}`, PALETTE.carta);
      }, block ? 12 : 16, true));
      y += 64;
    } else {
      items.push(icon(this, 'ui-spunta', L + 10, y + 12, 16, OPS.gain), heading(this, L + 30, y + 12, 'Maximum level reached', 16, OPS.gain).setOrigin(0, 0.5));
      y += 44;
    }
    // storia dei livelli, piccola
    y = this.head(items, L, y, w, 'Levels', `${lvl} of ${n}`);
    T.levels.forEach((txt, i) => {
      const ly = y + i * 26 + 8, done = i < lvl, cur = i === lvl, [nm] = levelParts(txt);
      items.push(icon(this, done ? 'ui-spunta' : 'ui-lucchetto', L + 8, ly, done ? 12 : 10, done ? OPS.gain : OPS.label),
        fit(label(this, L + 24, ly, `${i + 1}. ${nm}`, done ? OPS.body : cur ? OPS.text : OPS.label, 10).setOrigin(0, 0.5), w - 30));
    });
    return y + n * 26;
  }

  /**
   * Estrazione (stanza della base), pensata per tre momenti (Nico: "ogni UI per il suo caso d'uso"): squadre pronte = scegli
   * una delle tre missioni (carte con durata grande e bottino atteso per risorsa) e PARTI; fuori = tempo che manca grande con
   * la barra; di ritorno = il bottino con le foto delle risorse e RITIRA.
   */
  private fillExpedition(items: Phaser.GameObjects.GameObject[], L: number, y: number, w: number): number {
    const p = this.profile, now = Date.now(), T = buildingText.spedizione, e = p.expedition;
    const away = !!e && e.until > now, back = !!e && !away, kindNow: ExpeditionKind = e?.kind ?? this.expKind;
    const dur = (sec: number) => (sec >= 3600 ? `${Math.round(sec / 3600)} h` : `${Math.round(sec / 60)} min`);
    if (away) {
      const total = expeditionTimeSec(p, kindNow) * 1000;
      items.push(label(this, L, y, `On a mission, ${T.kinds[kindNow]}`, OPS.label, 11), tech(this, L, y + 20, fmtTime(e!.until - now), 52, PALETTE.allerta));
      this.bar(items, L, y + 92, w, 1 - (e!.until - now) / total, PALETTE.allerta);
      const t = body(this, L, y + 110, 'The teams come back on their own. Extractions never block campaigns: you can play meanwhile.', 13, OPS.body, w);
      items.push(t);
      return t.y + t.height;
    }
    if (back) {
      items.push(label(this, L, y, `Back, ${T.kinds[kindNow]}`, OPS.gain, 11), heading(this, L, y + 18, 'Mission spoils', 22));
      const cw = (w - 2 * 12) / 3;
      RESOURCES.forEach((r, i) => {
        const x = L + i * (cw + 12);
        items.push(resPhoto(this, r, x + cw / 2, y + 100, 70), tech(this, x + cw / 2, y + 150, `+${e!.reward[r]}`, 24, OPS.gain).setOrigin(0.5),
          label(this, x + cw / 2, y + 174, RESOURCE_INFO[r].name, OPS.label, 10).setOrigin(0.5));
      });
      items.push(this.btn('COLLECT', L, y + 200, w, true, () => {
        const got = collectExpedition(p, Date.now());
        if (!got) return;
        analytics.design(['spedizione', 'ritira', kindNow]);
        analytics.resources('source', got, 'spedizione', kindNow);
        saveProfile(p);
        this.redrawSpot('spedizione');
        this.updateStash();
        this.openPanel(this.panelSpot ?? 'mercato');
        this.toast(`+${got.metallo} metal, +${got.benzina} fuel, +${got.cibo} food`, PALETTE.radioattivo);
      }, 18, true));
      return y + 244;
    }
    const d = label(this, L, y, 'One team at a time, it comes back on its own: you can play meanwhile.', OPS.label, 10);
    items.push(d);
    y += 24;
    // le tre missioni: carte cliccabili, la scelta ha il filo bianco
    const ch = 84;
    EXPEDITIONS.forEach((kind: ExpeditionKind, i) => {
      const ry = y + i * (ch + 8), on = kind === kindNow, E = BALANCE.camp.expeditions[kind], cost = expeditionCost(kind), short = cost > p.stash.cibo;
      const r = this.add.rectangle(L, ry, w, ch, OPS.row, on ? 0.9 : 0.55).setOrigin(0).setStrokeStyle(on ? 2 : 1, on ? 0xffffff : OPS.edge, on ? 1 : 0.3)
        .setInteractive({ useHandCursor: true }).on('pointerup', () => { this.expKind = kind; this.openPanel(this.panelSpot ?? 'mercato'); });
      items.push(r, heading(this, L + 16, ry + 22, T.kinds[kind], 17).setOrigin(0, 0.5),
        tech(this, L + w - 16, ry + 22, dur(expeditionTimeSec(p, kind)), 22).setOrigin(1, 0.5),
        label(this, L + w - 16, ry + 46, cost ? `costs ${cost} food` : 'free', short ? OPS.loss : OPS.label, 10).setOrigin(1, 0.5));
      // bottino atteso: icona e intervallo per risorsa
      let bx = L + 16;
      for (const res of RESOURCES) {
        const [lo, hi] = E[res];
        items.push(resIcon(this, res, bx + 8, ry + 66, 16));
        const t = label(this, bx + 22, ry + 66, `${lo}–${hi}`, OPS.body, 11).setOrigin(0, 0.5);
        items.push(t);
        bx = t.x + t.width + 22;
      }
    });
    y += EXPEDITIONS.length * (ch + 8) + 8;
    const cost = expeditionCost(kindNow), ok = p.stash.cibo >= cost;
    items.push(this.btn(ok ? `DEPART: ${T.kinds[kindNow].toUpperCase()}, ${dur(expeditionTimeSec(p, kindNow))}` : `Missing ${cost - p.stash.cibo} food`, L, y, w, ok, () => {
      if (!startExpedition(p, kindNow, Date.now())) return;
      analytics.design(['spedizione', 'parti', kindNow]);
      saveProfile(p);
      this.redrawSpot('spedizione');
      this.updateStash();
      this.openPanel(this.panelSpot ?? 'mercato');
      this.toast('The teams are leaving. They will come back with whatever they find.', PALETTE.carta);
    }, ok ? 16 : 12, true));
    return y + 44;
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
    // tre colonne (Nico, 25 novembre 2026: "il mercato tutto mischiato"): Deposito | Scambi | Estrazione; sotto i rifornimenti
    const P3 = !P, gap = 24, colW = P3 ? (w - 2 * gap) / 3 : w, X1 = L, X2 = P3 ? L + colW + gap : L, X3 = P3 ? L + 2 * (colW + gap) : L, y0 = y;
    // Deposito: quanto hai di ogni risorsa sulla capienza, e il suo livello si migliora da qui
    const cap = stashCap(p), fin = Number.isFinite(cap), dl = p.buildings.deposito, dm = maxLvl('deposito');
    let yd = this.head(items, X1, y0, colW, `Depot, lv. ${dl}/${dm}`, fin ? `${cap.toLocaleString('en-US')} per resource` : 'no limit');
    RESOURCES.forEach((r) => {
      const v = p.stash[r], full = fin && v >= cap;
      if (this.textures.exists(`pk-${r}`)) items.push(this.add.image(X1 + 24, yd + 22, `pk-${r}`).setDisplaySize(48, 48));
      items.push(heading(this, X1 + 58, yd + 12, RESOURCE_INFO[r].name, 14).setOrigin(0, 0.5),
        tech(this, X1 + colW, yd + 12, fin ? `${v.toLocaleString('en-US')} / ${cap.toLocaleString('en-US')}` : String(v), 13, full ? OPS.loss : OPS.text).setOrigin(1, 0.5));
      this.bar(items, X1 + 58, yd + 30, colW - 58, fin ? v / cap : 1, full ? OPS.loss : RESOURCE_INFO[r].color);
      yd += 58;
    });
    items.push(this.btn(dl < dm ? 'UPGRADE THE DEPOT' : 'DEPOT AT MAXIMUM', X1, yd + 4, colW, dl < dm, () => { this.backTo = 'mercato'; this.openPanel('deposito'); }, 12));
    yd += 56;
    // Scambi: una riga per scambio, con le icone (dai → ricevi); in grigio quelli che non puoi fare
    let yt = this.head(items, X2, P3 ? y0 : yd + 10, colW, shopText.trade, 'you lose something');
    RESOURCES.forEach((a) => {
      const ok = p.stash[a] >= S.trade.give;
      RESOURCES.filter((b) => b !== a).forEach((b) => {
        const row = this.rowBox(items, X2, yt, colW, 38, ok ? () => {
          if (trade(p, a, b)) done(`TRADE: −${S.trade.give} ${RESOURCE_INFO[a].name.toLowerCase()}, +${S.trade.get} ${RESOURCE_INFO[b].name.toLowerCase()}`);
        } : undefined, undefined, !ok);
        void row;
        const ga = tech(this, X2 + 34, yt + 19, String(S.trade.give), 15, ok ? OPS.text : OPS.label).setOrigin(0, 0.5);
        items.push(resIcon(this, a, X2 + 20, yt + 19, 16), ga, lineIcon(this, 'back', ga.x + ga.width + 18, yt + 19, 14, OPS.label).setFlipX(true));
        const gb = tech(this, ga.x + ga.width + 52, yt + 19, String(S.trade.get), 15, ok ? OPS.gain : OPS.label).setOrigin(0, 0.5);
        items.push(resIcon(this, b, gb.x - 14, yt + 19, 16), gb, label(this, X2 + colW - 12, yt + 19, RESOURCE_INFO[b].name, OPS.label, 10).setOrigin(1, 0.5));
        yt += 44;
      });
    });
    // Estrazione: missioni, in missione o di ritorno
    const ye = this.fillExpedition(items, X3, this.head(items, X3, P3 ? y0 : yt + 10, colW, 'Extraction'), colW);
    y = Math.max(yd, yt, ye) + 28;
    // rifornimenti: uno per tipo, valgono per la prossima campagna
    const g = this.add.graphics(); // icone: aggiunte in fondo, sopra le schede
    const tile = (x: number, ty: number, tw: number, th: number, ok: boolean, on: boolean, run: () => void) =>
      this.rowBox(items, x, ty, tw, th, ok ? run : undefined, on ? OPS.gain : undefined, !ok && !on);
    y = this.head(items, L, y, w, shopText.supplies);
    // ogni rifornimento con la sua icona (truppe, carte, sacchi di sabbia)
    const SUP_ICON: Record<string, string> = { truppe: 'res-truppe', mappe: 'ui-mappa', sabbia: 'ui-difesa' };
    const scols = P ? 1 : 3, sw = (w - (scols - 1) * 8) / scols, sh = P ? 52 : 96;
    SUPPLIES.forEach((k, i) => {
      const T = shopText.items[k], D = S.supplies[k], own = (p.supplies ?? []).includes(k), ok = !own && canAfford(p.stash, D.cost);
      const x = L + (i % scols) * (sw + 8), ty = y + Math.floor(i / scols) * (sh + 8);
      tile(x, ty, sw, sh, ok, own, () => { if (buySupply(p, k)) done(`${T.name.toUpperCase()}, ready for the next campaign`); });
      const tx = x + 14;
      items.push(icon(this, SUP_ICON[k] ?? 'ui-rifornimento', tx + 9, ty + 21, 18, own ? OPS.gain : OPS.text),
        fit(heading(this, tx + 26, ty + 12, T.name, 15, own ? OPS.gain : OPS.text), sw - 50),
        body(this, tx, ty + 36, T.desc, 11, OPS.body).setWordWrapWidth(sw - 24).setMaxLines(2));
      if (own) items.push(label(this, x + sw - 10, ty + (P ? sh / 2 : sh - 13), 'Ready', OPS.gain, 10).setOrigin(1, 0.5));
      else this.costRow(g, items, D.cost, P ? x + sw - 130 : tx, P ? ty + sh / 2 : ty + sh - 15, p.stash);
    });
    y += Math.ceil(SUPPLIES.length / scols) * (sh + 8) + 14;
    // lavori in corso: finiti subito pagando metallo
    const withLume = premiumOn && this.lume.balance !== null;
    const jobs: { what: RushKind; job: { until: number } | null; name: string }[] = [
      { what: 'construction' as const, job: p.construction, name: p.construction ? `${buildingText[p.construction.id].name} lv. ${p.buildings[p.construction.id] + 1}` : '' },
      { what: 'research' as const, job: p.research, name: p.research ? techInfo(p.research.id).name : '' },
      ...(withLume ? [{ what: 'expedition' as const, job: p.expedition, name: 'Extraction' }] : []),
    ].filter((j) => j.job && j.job.until > now);
    // "finisci subito" solo se c'è qualcosa da finire (prima una sezione vuota che diceva "nessun lavoro")
    if (!jobs.length) { items.push(g); return y - 14; }
    y = this.head(items, L, y, w, shopText.rush);
    // col Lume: nome del lavoro sopra, due tasti affiancati (metallo | Lume); l'Estrazione solo col Lume
    const step = withLume ? 66 : 46, top = withLume ? 20 : 0;
    jobs.forEach((j, i) => {
      const cost = rushCost(j.job!.until, now), fast = rushable(j.job!.until, now), ok = fast && p.stash.metallo >= cost, metal = j.what !== 'expedition', jy = y + i * step;
      const mw = withLume ? (w - 6) / 2 : w;
      if (withLume) items.push(label(this, L, jy + 6, `Finish now: ${j.name}`, OPS.body, 11).setOrigin(0, 0.5));
      if (metal) items.push(this.btn(!fast ? (withLume ? 'METAL < 60 MIN' : `${j.name.toUpperCase()}: METAL UNDER 60 MIN`) : withLume ? `${cost} METAL` : `FINISH NOW: ${j.name.toUpperCase()}, ${cost} METAL`, L, jy + top, mw, ok, () => {
        if (!rush(p, j.what as 'construction' | 'research', Date.now())) return;
        analytics.design(['mercato', 'accelera', j.what], cost);
        saveProfile(p);
        this.closePanel();
        this.settleAll(false);
      }, 12));
      if (withLume) {
        const min = Math.ceil((j.job!.until - now) / 60_000), lc = rushLume(min);
        items.push(this.btn(`${lc} FRAGMENTS`, metal ? L + mw + 6 : L, jy + top, metal ? mw : w,
          !this.lume.busy && (this.lume.balance ?? 0) >= lc, () => void this.lumeSpend({ item: 'rush', what: j.what, minutes: min }), 12));
      }
    });
    items.push(g);
    return y + (jobs.length ? jobs.length * step - 6 : 16);
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

  /**
   * Sandbox (Nico, 25 novembre 2026: "una parte sandbox dove uno è droppato sulla mappa e può decidere dove mettersi, le
   * risorse"): si scelgono truppe, risorse, forza dei nemici e durata, poi sulla carta si tocca dove calarsi. Non tocca il profilo.
   */
  private fillSandbox(items: Phaser.GameObjects.GameObject[], L: number, y: number, w: number): number {
    const S = this.sandbox, set = <K extends keyof SandboxConfig>(k: K, v: SandboxConfig[K]) => { this.sandbox = { ...S, [k]: v }; this.openPanel('sandbox'); };
    const d = body(this, L, y, 'Free play on the whole map. You choose your starting army and resources, then drop wherever you want. Nothing is carried home and your base does not change.', 13, OPS.text, w);
    items.push(d);
    y = d.y + d.height + 22;
    const row = <K extends keyof SandboxConfig>(title: string, k: K, opts: [SandboxConfig[K], string][]) => {
      y = this.head(items, L, y, w, title);
      this.choice(items, L, y, w, 40, opts.map(([v, t]) => ({ text: t, on: S[k] === v, ok: true, pick: () => set(k, v) })));
      y += 54;
    };
    row('Starting troops', 'troops', [[200, '200'], [500, '500'], [1000, '1,000'], [2500, '2,500']]);
    row('Starting resources (each)', 'resources', [[0, '0'], [200, '200'], [1000, '1,000'], [5000, '5,000']]);
    row('Map', 'map', (Object.keys(REGIONS) as MapId[]).map((m) => [m, REGIONS[m].name] as [MapId, string]));
    row('Difficulty', 'front', BALANCE.difficulty.map((d, i) => [i, d.name] as [number, string]));
    row('Duration', 'minutes', [[20, '20 min'], [30, '30 min'], [60, '60 min'], [0, 'No limit']]);
    y += 6;
    items.push(this.btn('DROP INTO THE MAP', L, y, w, true, () => {
      analytics.design(['sandbox', 'avvia', `${S.front}:${S.minutes}`]);
      this.scene.start('Load', { next: 'Run', data: { seed: randomSeed(), opts: sandboxOptions(this.profile, this.sandbox) } });
    }, 18, true));
    return y + 60;
  }

  /** Sandbox, pannello a sinistra: l'esercito (potenza, reparti, livello, dottrina, velocità). */
  private fillSandboxArmy(items: Phaser.GameObjects.GameObject[], L: number, y: number, w: number): number {
    const S = this.sandbox, set = <K extends keyof SandboxConfig>(k: K, v: SandboxConfig[K]) => { this.sandbox = { ...S, [k]: v }; this.openPanel('sandbox'); };
    const row = <K extends keyof SandboxConfig>(title: string, k: K, opts: [SandboxConfig[K], string][]) => {
      y = this.head(items, L, y, w, title);
      this.choice(items, L, y, w, 40, opts.map(([v, t]) => ({ text: t, on: S[k] === v, ok: true, pick: () => set(k, v) })));
      y += 54;
    };
    // potenza: bonus, reparto unico ed edificio (Nico: "che nazione vuoi essere")
    row('Power', 'civ', CIV_IDS.map((c) => [c, civInfo(c).name] as [CivId, string]));
    // reparti: si accendono e spengono (quello unico è della potenza scelta)
    y = this.head(items, L, y, w, 'Units');
    const pool: UnitType[] = ['fanteria', 'ricognitori', 'artiglieria', 'corazzati', 'genio', 'cannoniera', BALANCE.civs[S.civ].unit as UnitType];
    this.choice(items, L, y, w, 40, pool.map((u) => ({ text: unitInfo(u).short, on: S.units.includes(u), ok: true,
      pick: () => set('units', S.units.includes(u) ? S.units.filter((x) => x !== u) : [...S.units, u]) })));
    y += 54;
    row('Troop level', 'level', SANDBOX_LEVELS.map((m, i) => [i, i ? `+${Math.round((m - 1) * 100)}%` : 'Base'] as [number, string]));
    row('Doctrine', 'doctrine', (Object.keys(SANDBOX_DOCTRINES) as SandboxDoctrine[]).map((d) => [d, SANDBOX_DOCTRINES[d].name] as [SandboxDoctrine, string]));
    if (S.doctrine !== 'none') { const t = body(this, L, y - 10, SANDBOX_DOCTRINES[S.doctrine].desc, 12, OPS.label, w); items.push(t); y += t.height + 4; }
    row('Game speed', 'speed', (BALANCE.speeds as readonly number[]).map((v) => [v, `x${v}`] as [number, string]));
    return y;
  }

  /** Modalità test: sblocca tutto per provare armi, civiltà e ricerche senza aspettare; si torna indietro azzerando il profilo. */
  private fillTest(items: Phaser.GameObjects.GameObject[], L: number, y: number, w: number): number {
    const p = this.profile;
    y = this.head(items, L, y, w, 'Test mode', p.test ? 'On' : 'Off', p.test ? PALETTE.allerta : OPS.label);
    const txt = p.test
      ? 'Rooms at maximum, all research, full resources, powers unlocked, instant construction and expeditions, +1000 troops at the start of a campaign, abilities with reduced cooldown.'
      : 'Unlocks everything at once: rooms at maximum (all weapons and abilities), all research, full resources, powers unlocked, instant construction and expeditions, +1000 troops at the start of a campaign.\n\nOnly for trying the game: real progress is lost.';
    const t = body(this, L, y, txt, 13, OPS.text, w);
    items.push(t);
    y = t.y + t.height + 20;
    const restart = () => this.scene.restart();
    if (!p.test) {
      items.push(this.btn('TURN ON TEST MODE', L, y, w, true, () => {
        enableTestMode(p);
        saveProfile(p);
        analytics.design(['test', 'attiva']);
        restart();
      }, 13));
      y += 48;
    }
    items.push(this.btn(p.test ? 'EXIT: RESET THE PROFILE' : 'RESET THE PROFILE', L, y, w, true, () => {
      this.profile = resetProfile();
      restart();
    }, 13));
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

  /**
   * GIOCA (Nico: "la campagna deve essere la cosa più importante, molto più chiara; troppe scritte e cose che sembrano
   * cliccabili"): a tutto schermo sulla foto del fronte. Gerarchia: nome del fronte enorme, una frase, tre numeri; in basso a
   * sinistra la fila dei fronti (le uniche carte che si toccano), in basso a destra la durata e il tasto GIOCA. Niente puntata.
   */
  private fillPlay(items: Phaser.GameObjects.GameObject[]) {
    // il fronte mostrato: quello scelto, o quello toccato in basso (anteprima, anche se è ancora chiuso)
    const p = this.profile, { width: W, height: H } = view(this), fi = this.previewFront ?? activeFront(p), F = BALANCE.fronts[fi];
    const power = playerPower(p), weak = power < F.power, mine = unlockedUnits(p);
    const maxF = p.frontMax ?? 0, isOpen = (k: number) => k <= maxF && k <= p.buildings.comando;
    const whyLocked = (k: number) => (k > maxF ? `Win front ${ROMAN[k - 1]} to open it` : `Needs Command Center lv. ${k}`);
    const bx = PAD + 40, bw = Math.min(620, W * 0.46);
    items.push(fade(this, 0, NAV_H, W * 0.65, H - NAV_H, 0x05080d, 0.88, 0, 'h'), fade(this, 0, H * 0.55, W, H * 0.45, 0x05080d, 0, 0.92));
    // il fronte: numero, nome, una frase
    let y = NAV_H + Math.max(40, H * 0.08);
    items.push(tech(this, bx, y, `FRONT ${ROMAN[fi]}`, 18, OPS.label).setLetterSpacing(5));
    const name = value(this, bx - 3, y + 26, F.name, Math.round(Phaser.Math.Clamp(W * 0.05, 52, 84)));
    items.push(name);
    y = name.y + name.height + 8;
    const brief = body(this, bx, y, (frontText[fi] as { brief: string }).brief, 17, OPS.text, bw);
    items.push(brief);
    y = brief.y + brief.height + 30;
    // tre numeri, senza riquadri (non sono tasti)
    const stats: [string, string, number][] = [
      ['Difficulty', `${fi + 1} of ${BALANCE.fronts.length}`, OPS.text],
      ['Your power', F.power ? `${power} / ${F.power}` : `${power}`, weak ? OPS.loss : OPS.gain],
      ['Spoils', `×${String(F.lootMult)}`, OPS.text],
    ];
    stats.forEach(([k, v, c], i) => {
      const sx = bx + i * (bw / 3);
      items.push(label(this, sx, y, k, OPS.label, 11), tech(this, sx, y + 18, v, 30, c));
    });
    y += 74;
    // il nemico, in una riga di testo (in rosso le armi che non hai)
    const foes = F.aiUnits.map((t) => unitInfo(t).name);
    const ft = label(this, bx, y, `The enemy fields: ${foes.join(', ')}`, OPS.body, 11);
    items.push(ft);
    if (weak) items.push(body(this, bx, y + 26, 'Stronger than you: upgrade your base and research, or pick an easier front.', 13, OPS.loss, bw));
    const missing = F.aiUnits.filter((t) => !mine.includes(t));
    if (missing.length) items.push(label(this, bx, y + (weak ? 52 : 24), `You don\'t have yet: ${missing.map((t) => unitInfo(t).name).join(', ')}`, OPS.loss, 10));

    // destra in basso: durata (se si sceglie) e GIOCA
    const rw = Math.min(440, W * 0.32), rx = W - PAD - 40 - rw, by = H - PAD - 40 - 76;
    const locked = !isOpen(fi);
    const play = new Button(this, locked ? whyLocked(fi) : 'PLAY', rw, 76, () => {
      if (locked) return;
      p.stake = 0; // la puntata è tolta (Nico)
      saveProfile(p);
      analytics.design(['campagna', 'avvia', `${activeCiv(p)}:${p.campaign}:${fi}`]);
      this.scene.start('Load', { next: 'Run', data: { seed: randomSeed() } });
    }, locked ? 14 : 26);
    if (!locked) play.setPrimary(); else play.setAlpha(0.6);
    play.setPosition(rx, by);
    items.push(play);
    if (campaignChoice(p)) {
      items.push(label(this, rx, by - 84, 'Duration', OPS.label, 11));
      this.choice(items, rx, by - 62, rw, 50, CAMPAIGNS.map((k) => {
        const C = BALANCE.campaigns[k];
        return {
          text: `${Math.round(C.durationMs / 60000)} min`, sub: `spoils ${Math.round((C.durationMs * C.lootMult) / (BALANCE.campaigns.standard.durationMs * BALANCE.campaigns.standard.lootMult) * 100)}%`,
          on: p.campaign === k, ok: true, pick: () => { p.campaign = k; saveProfile(p); this.openPanel('gioca'); },
        };
      }));
    }

    // sinistra in basso: i fronti, le uniche carte che si toccano
    const n = BALANCE.fronts.length;
    const avail = rx - 40 - bx, cw = Math.min(150, (avail - (n - 1) * 10) / n), ch = Math.round(cw * 0.58), fy = H - PAD - 40 - ch;
    items.push(label(this, bx, fy - 24, 'Fronts', OPS.label, 11));
    BALANCE.fronts.forEach((_Fk, k) => {
      const cx = bx + k * (cw + 10), open = isOpen(k), sel = k === fi;
      items.push(coverImage(this, this.frontImage(k), cx, fy, cw, ch, 0.5).setTint(open ? (sel ? 0xffffff : 0xa8b2bc) : 0x3c444c),
        this.add.rectangle(cx, fy, cw, ch, 0, 0).setOrigin(0).setStrokeStyle(sel ? 2 : 1, sel ? 0xffffff : OPS.edge, sel ? 1 : 0.4),
        tech(this, cx + 8, fy + ch - 6, ROMAN[k], 18, open ? OPS.text : OPS.label).setOrigin(0, 1));
      if (!open) items.push(icon(this, 'ui-lucchetto', cx + cw - 14, fy + 14, 12, OPS.label));
      // ogni carta si tocca: quelle aperte diventano il fronte scelto, quelle chiuse si vedono in anteprima (Nico: "voglio
      // vedere cos'è il secondo fronte")
      if (!sel) {
        const hit = this.add.rectangle(cx, fy, cw, ch, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true })
          .on('pointerup', () => {
            if (open) { p.front = k; saveProfile(p); this.previewFront = null; }
            else this.previewFront = k;
            this.openPanel('gioca');
          });
        items.push(hit);
      }
    });
  }

  /**
   * Potenza che guidi, nel Centro di Comando (Nico: "il comando contiene la politica che sblocchi, i tuoi generali"): le quattro
   * con la loro immagine, quella scelta col filo bianco, e cosa dà. Restituisce dove finisce.
   */
  private fillPower(items: Phaser.GameObjects.GameObject[], L: number, y: number, w: number, big = false): number {
    const p = this.profile, civ = activeCiv(p);
    y = this.head(items, L, y, w, 'Power', civChoice(p) ? 'tap to change' : `chosen after ${BALANCE.progression.civChoiceAfterRuns} campaigns`);
    const cw = (w - 3 * 8) / 4, ch = Math.round(cw * (big ? 1.25 : 0.7)); // grande: carte in piedi
    CIV_IDS.forEach((id, k) => {
      const info = civInfo(id), open = civChoice(p) && civUnlocked(p, id), sel = id === civ, cx = L + k * (cw + 8);
      items.push(coverImage(this, civImage(id), cx, y, cw, ch, 0.4).setTint(sel ? 0xffffff : open ? 0x8a949c : 0x3c444c),
        fade(this, cx, y + ch * 0.45, cw, ch * 0.55, PALETTE.inchiostro, 0, 0.95),
        this.add.rectangle(cx, y, cw, ch, 0, 0).setOrigin(0).setStrokeStyle(sel ? 2 : 1, sel ? 0xffffff : OPS.edge, sel ? 1 : 0.35),
        icon(this, `civ-${id}`, cx + 14, y + 14, 14, CIV_STYLE[id].fill),
        fit(heading(this, cx + 8, y + ch - 22, info.name, 13, sel ? OPS.text : OPS.body), cw - 16));
      if (!civUnlocked(p, id)) items.push(icon(this, 'ui-lucchetto', cx + cw - 12, y + 12, 10, OPS.label));
      if (open && !sel) items.push(this.add.rectangle(cx, y, cw, ch, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true })
        .on('pointerup', () => { p.civ = id; saveProfile(p); this.openPanel('comando'); }));
    });
    y += ch + 10;
    const info = civInfo(civ);
    if (big) { // pagina del Comando: cosa dà la potenza scelta, in chiaro
      items.push(heading(this, L, y + 4, info.name, 22));
      const rows: [string, string][] = [['Bonus', info.bonus], ['Unique unit', unitInfo(info.unit).name]];
      let ry = y + 40;
      for (const [k, v] of rows) {
        const t = body(this, L + 110, ry, v, 13, OPS.text, w - 110);
        items.push(label(this, L, ry + 2, k, OPS.label, 10), t);
        ry = t.y + t.height + 10;
      }
      return ry + 14;
    }
    const t = body(this, L, y, `${info.name}: ${info.bonus}, unique unit ${unitInfo(info.unit).name}`, 12, OPS.body, w);
    items.push(t);
    return t.y + t.height + 22;
  }

  /** Sala Radar: il registro in numeri, in cima al fascicolo (campagne, vittorie, fronte più alto, territorio record). */
  private fillService(items: Phaser.GameObjects.GameObject[], L: number, y: number, w: number): number {
    const p = this.profile, num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    const best = Math.max(0, ...[p.bestTiles, ...p.history.map((r) => r.provinces ?? r.tiles)].filter(num));
    const stats: [string, string][] = [['Campaigns', String(p.runs)], ['Victories', String(p.wins)],
      ['Highest front', ROMAN[p.frontMax ?? 0] ?? '—'], ['Record', String(best)]];
    y = this.head(items, L, y, w, 'Log');
    stats.forEach(([k, v], i) => {
      const sx = L + i * (w / stats.length);
      items.push(tech(this, sx, y, v, 28), label(this, sx, y + 38, k, OPS.label, 10));
    });
    return y + 70;
  }

  /**
   * Profilo a tutta pagina (Nico: "migliora schermata profilo"): chi sei e come stai andando. A sinistra il comandante
   * (ritratto grande, nome, cambia nome); a destra il servizio in numeri, la potenza che guidi (le quattro, con cosa dà
   * quella scelta) e le ultime campagne.
   */
  private fillProfile(items: Phaser.GameObjects.GameObject[]) {
    const p = this.profile, { width: W, height: H } = view(this);
    const X = PAD + 40, top = NAV_H + 36;
    // comandante
    const pw = Math.min(320, W * 0.22), ph = Math.round(pw * 1.3);
    items.push(coverImage(this, 'comandante', X, top, pw, ph, 0.2), this.add.rectangle(X, top, pw, ph, 0, 0).setOrigin(0).setStrokeStyle(1, OPS.edge, 0.5),
      fade(this, X, top + ph * 0.55, pw, ph * 0.45, 0x05080d, 0, 0.9));
    items.push(label(this, X + 16, top + ph - 62, 'Commander', OPS.label, 10));
    const nm = value(this, X + 14, top + ph - 44, p.name || 'Nameless', 30);
    fit(nm, pw - 28);
    items.push(nm, this.btn('CHANGE NAME', X, top + ph + 12, pw, true, () => this.editName(), 12));
    // destra
    const RX = X + pw + 56, RW = W - RX - PAD - 40;
    let y = top;
    // servizio: cinque numeri
    const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    const best = Math.max(0, ...[p.bestTiles, ...p.history.map((r) => r.tiles)].filter(num));
    const stats: [string, string][] = [
      ['Campaigns', String(p.runs)], ['Victories', String(p.wins)], ['Win rate', p.runs ? `${Math.round((p.wins / p.runs) * 100)}%` : '—'],
      ['Highest front', ROMAN[p.frontMax ?? 0]], ['Territory record', String(best)],
    ];
    items.push(label(this, RX, y, 'Service', OPS.label, 11));
    stats.forEach(([k, v], i) => {
      const sx = RX + i * (RW / stats.length);
      items.push(tech(this, sx, y + 20, v, 36), label(this, sx, y + 66, k, OPS.label, 10));
    });
    y += 110;
    // account, Frammenti e estetiche (Nico: "nel profilo i dati, l'account, le risorse che si comprano, le skin"); la
    // potenza sta nel Centro di Comando
    const half = (RW - 32) / 2;
    items.push(label(this, RX, y, 'Account and Fragments', OPS.label, 11));
    let ya = y + 24;
    if (premiumOn) ya = this.fillLume(items, RX, ya, half);
    else {
      const t = body(this, RX, ya, 'Purchases are not active in this version. Here you will buy Fragments to finish timers and resource packs.', 13, OPS.body, half);
      items.push(t);
      ya = t.y + t.height;
    }
    const SX = RX + half + 32;
    items.push(label(this, SX, y, 'Cosmetics', OPS.label, 11));
    const cos = Object.keys(PREMIUM.cosmetics);
    const ct = body(this, SX, y + 24, cos.length ? cos.join(', ') : 'No cosmetics on sale yet: insignia, flags and colours will arrive here.', 13, OPS.body, half);
    items.push(ct);
    y = Math.max(ya, ct.y + ct.height) + 30;
    // ultime campagne
    items.push(label(this, RX, y, 'Recent campaigns', OPS.label, 11));
    y += 24;
    const OUT: Record<string, [string, number]> = { victory: ['Victory', OPS.gain], retreat: ['Retreat', PALETTE.allerta], eliminated: ['Eliminated', OPS.loss], timeout: ['Time up', OPS.label] };
    const rows = p.history.slice(0, Math.max(3, Math.floor((H - y - 40) / 34)));
    if (!rows.length) items.push(body(this, RX, y, 'No campaigns yet: go to PLAY.', 13, OPS.body));
    rows.forEach((r, i) => {
      const ry = y + i * 34, d = new Date(r.at), [o, oc] = OUT[r.outcome] ?? [r.outcome, OPS.label];
      const when = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
      items.push(this.add.rectangle(RX, ry, RW, 28, OPS.row, i % 2 ? 0.25 : 0.45).setOrigin(0),
        tech(this, RX + 12, ry + 14, o, 14, oc).setOrigin(0, 0.5),
        label(this, RX + RW * 0.3, ry + 14, CIV_IDS.includes(r.civ) ? civInfo(r.civ).name : '—', OPS.body, 10).setOrigin(0, 0.5),
        label(this, RX + RW * 0.55, ry + 14, num(r.tiles) ? `${r.tiles} territory` : '—', OPS.body, 10).setOrigin(0, 0.5),
        label(this, RX + RW * 0.78, ry + 14, num(r.timeMs) ? fmtTime(r.timeMs) : '—', OPS.body, 10).setOrigin(0, 0.5),
        label(this, RX + RW - 12, ry + 14, when, OPS.label, 10).setOrigin(1, 0.5));
    });
  }

  // ——— Sala Radar: registro in 3D ———

  /** Voci del registro con la loro foto: ultime campagne, potenze, frammenti dell'archivio della Caduta. */
  private radarEntries(): RadarEntry[] {
    const p = this.profile, out: RadarEntry[] = [];
    const img = (k: string) => (this.textures.exists(k) ? (this.textures.get(k).getSourceImage() as TexImageSource) : null);
    const OUT: Record<string, string> = { victory: 'Victory', retreat: 'Retreat', eliminated: 'Eliminated', timeout: 'Time up' };
    for (const r of p.history.slice(0, 3)) { // le ultime tre: di più sarebbero tante foto uguali dello stesso fronte
      const fi = r.front ?? 0, i = img(this.frontImage(fi)), d = new Date(r.at);
      const n = r.provinces ?? r.tiles;
      if (i) out.push({ img: i, title: `Front ${ROMAN[fi] ?? fi + 1}, ${OUT[r.outcome] ?? r.outcome}`,
        line: `${Number.isFinite(n) ? `${n} PROVINCES, ` : ''}${Number.isFinite(r.timeMs) ? `${fmtTime(r.timeMs)}, ` : ''}${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` });
    }
    // potenze: la tua sempre, le rivali dopo la prima campagna
    const mine = activeCiv(p);
    for (const c of CIV_IDS) {
      if (c !== mine && !p.runs) continue;
      const i = img(`leader-${c}`) ?? img(civImage(c));
      if (i) out.push({ img: i, title: civInfo(c).name, line: c === mine ? 'YOUR POWER' : 'RIVAL POWER' });
    }
    // frammenti dell'archivio: ognuno con l'immagine della sua ricerca
    for (const id of p.techs.filter((t) => techInfo(t).lore)) {
      const i = img(techImage(this, id, mine));
      if (i) out.push({ img: i, title: techInfo(id).name, line: 'ARCHIVE OF THE FALL' });
    }
    return out;
  }

  /**
   * Sala Radar, a sinistra del fascicolo: due schede sotto il titolo. Registro = i riquadri di luce con le voci del registro;
   * Archivio = il cubo 3D che si riempie coi frammenti della Caduta trovati, e accanto i loro testi.
   */
  private makeRadar(x: number, y: number, w: number, h: number): Phaser.GameObjects.GameObject[] {
    const objs: Phaser.GameObjects.GameObject[] = [], arch = this.radarTab === 'archivio', z = this.cameras.main.zoom;
    if (this.textures.exists('registry-radar')) this.textures.remove('registry-radar');
    // Archivio: cubo nella metà sinistra (sotto le schede), testi nella destra
    const cx = x, cy = y + 120, cw = arch ? Math.round(w * 0.46) : w, ch = arch ? h - 120 : h;
    const view3 = arch ? new ResearchCube(cw, ch, z, false) : new RegistryRadar(w, h, z, this.radarEntries());
    const frs = fragments(this.profile), found = frs.filter((f) => f.found).length;
    if (view3 instanceof ResearchCube) view3.setProgress(archiveCubeTechs(found, frs.length), null);
    const tex = this.textures.addCanvas('registry-radar', view3.canvas)!;
    objs.push(this.add.image(arch ? cx : x, arch ? cy : y, 'registry-radar').setOrigin(0).setDisplaySize(cw, ch));
    // didascalia della voce sotto il mouse (solo Registro), in basso al centro
    const t1 = heading(this, x + w / 2, y + h - 64, '', 22).setOrigin(0.5);
    const t2 = label(this, x + w / 2, y + h - 36, arch ? '' : 'RADAR ROOM: LOG', OPS.label, 10).setOrigin(0.5);
    objs.push(t1, t2);
    // schede Registro / Archivio
    let tx = PAD + 12;
    for (const [k, name] of [['registro', 'LOG'], ['archivio', `ARCHIVE ${found}/${frs.length}`]] as const) {
      const on = this.radarTab === k, t = tech(this, tx, y + 104, name, 14, on ? OPS.text : OPS.label).setLetterSpacing(2).setOrigin(0, 0.5);
      objs.push(t);
      if (on) objs.push(this.add.rectangle(tx, y + 118, t.width, 2, 0xffffff).setOrigin(0));
      else objs.push(this.add.rectangle(tx - 8, y + 88, t.width + 16, 32, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true })
        .on('pointerover', () => t.setColor(hex(OPS.text))).on('pointerout', () => t.setColor(hex(OPS.label)))
        .on('pointerup', () => { this.radarTab = k; this.openPanel('radar'); }));
      tx += t.width + 32;
    }
    // Archivio: i frammenti, trovati col loro testo, mancanti con dove cercarli
    if (arch) {
      const lx = x + cw + 16, lw = w - cw - 40;
      let ly = y + 140;
      for (const f of frs) {
        if (f.found) {
          const t = heading(this, lx, ly, f.title, 15), b = body(this, lx, ly + 22, f.text, 12, OPS.body, lw);
          objs.push(t, b);
          ly = b.y + b.height + 16;
        } else {
          objs.push(heading(this, lx, ly, 'Missing fragment', 15, OPS.label), label(this, lx, ly + 22, f.hint, OPS.label, 10));
          ly += 52;
        }
      }
    }
    this.radar = { view: view3, tex, x: arch ? cx : x, y: arch ? cy : y, w: cw, h: ch, card: [t1, t2], hot: null };
    return objs;
  }

  private renderRadar() {
    const R = this.radar;
    if (!R) return;
    const ptr = this.input.activePointer, z = this.cameras.main.zoom, mx = ptr.x / z - R.x, my = ptr.y / z - R.y;
    if (R.view instanceof ResearchCube) { // Archivio: il cubo gira verso il mouse
      const { width, height } = view(this);
      R.view.setPointer(ptr.x / z / width, ptr.y / z / height);
      if (R.view.render()) R.tex.refresh();
      return;
    }
    R.view.setPointer(mx, my, mx >= 0 && my >= 0 && mx <= R.w && my <= R.h);
    if (R.view.render()) R.tex.refresh();
    if (R.view.hot !== R.hot) {
      R.hot = R.view.hot;
      R.card[0].setText(R.hot?.title ?? '');
      R.card[1].setText(R.hot?.line ?? 'RADAR ROOM: LOG');
    }
  }

  private dropRadar() {
    if (!this.radar) return;
    this.radar.view.dispose();
    this.radar = null;
    if (this.textures.exists('registry-radar')) this.textures.remove('registry-radar');
  }

  /** Immagine del fronte (generata con Draw Things); finché non c'è, la sala operazioni. */
  private frontImage(fi: number): string {
    return this.textures.exists(`front-${fi + 1}`) ? `front-${fi + 1}` : 'room-fronte';
  }






  /** Albero della ricerca a tutto schermo, sopra l'HQ. */
  /** Ricerca e Arsenale: l'albero subito, sotto la barra (Nico: "si dovrebbe vedere subito l'albero"). */
  openTree(mode: 'ricerca' | 'arsenale') {
    this.closePanel();
    this.scene.stop('Tree');
    this.nav.setActive(mode);
    this.scene.launch('Tree', { mode });
    this.scene.bringToTop('Tree');
  }

  /** L'albero si è chiuso (ESC): come "← Home" in alto, si torna alla home (prima finiva in Base anche arrivando dalla home). */
  treeClosed() {
    this.goHome();
  }

  /** Nome del comandante: si vede sulla mappa, nell'elenco delle potenze e nei rapporti. */
  private editName(first = false) {
    const p = this.profile;
    askName(first ? 'WHAT IS YOUR NAME, COMMANDER?' : 'COMMANDER NAME', p.name ?? '', (name) => {
      p.nameAsked = true;
      if (name) p.name = name;
      saveProfile(p);
      if (name) this.scene.restart();
    });
  }

  /** Dall'albero: apre la scheda di una postazione (per migliorarla). */
  openBuilding(id: BuildingId) {
    this.backTo = id === 'arsenale' ? 'arsenale' : id === 'laboratorio' ? 'ricerca' : 'base';
    this.openPanel(id);
  }

  /** Dopo l'albero: scorta e moduli aggiornati. */
  refreshAfterTree() {
    this.updateStash();
    for (const id of BUILDINGS) this.redrawSpot(id);
    this.refreshNav();
  }



  private btn(label: string, x: number, y: number, w: number, enabled: boolean, onClick: () => void, size = 16, primary = false) {
    const b = new Button(this, label, w, 40, () => enabled && onClick(), size);
    b.setPosition(x, y).setAlpha(enabled ? 1 : 0.45);
    if (primary && enabled) b.setPrimary();
    return b;
  }

  private toast(msg: string, color: number) {
    const { width } = view(this);
    // con l'albero aperto (Ricerca, Arsenale) l'avviso va disegnato nella sua scena, altrimenti resta sotto e non si vede
    const S: Phaser.Scene = this.scene.isActive('Tree') ? this.scene.get('Tree') : this;
    this.lastToast?.destroy();
    const ty = this.portrait ? 160 : 90;
    // avviso: vetro scuro con una barretta del colore del messaggio, testo normale (prima riga come titolo)
    const w = Math.min(440, width - 40), [first, ...rest] = msg.split('\n');
    const head = heading(S, 18, 12, first.charAt(0) + first.slice(1).toLowerCase(), 14).setWordWrapWidth(w - 30);
    const more = rest.length ? body(S, 18, head.y + head.height + 4, rest.join('\n'), 12, OPS.body, w - 30) : null;
    const h = (more ? more.y + more.height : head.y + head.height) + 12;
    const bg = S.add.rectangle(0, 0, w, h, OPS.panel, 0.94).setOrigin(0).setStrokeStyle(1, OPS.edge, 0.4);
    const bar = S.add.rectangle(0, 0, 3, h, color).setOrigin(0);
    const t = (this.lastToast = S.add.container(width / 2 - w / 2, ty - 20, [bg, bar, head, ...(more ? [more] : [])]).setDepth(60).setAlpha(0));
    S.tweens.add({ targets: t, alpha: 1, y: ty - 10, duration: 220 });
    S.tweens.add({ targets: t, alpha: 0, delay: 2800, duration: 400, onComplete: () => t.destroy() });
  }

}
