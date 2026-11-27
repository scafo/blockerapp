// Albero della ricerca: è la pagina RICERCA (rami Esercito, Logistica, Economia, Difesa, La Caduta) e la pagina ARSENALE
// (ramo Armamenti), aperte subito dalla barra della base (Nico, 23 novembre 2026: "si dovrebbe vedere subito l'albero, ogni
// immagine cliccabile che ti fa vedere tutti i perk"). Sta sotto la barra fissa della CampScene, che resta cliccabile; a
// destra la scheda della ricerca scelta. Usa lo stesso profilo della CampScene (che chiude le ricerche finite e salva).
import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { PALETTE, hex } from '../config/palette';
import buildingText from '../data/buildings.json';
import { buildBlock, fmtTime, nextLevel, startBuild, unitBoosts } from '../game/camp';
import { UNITS, unitInfo } from '../game/units';
import { BRANCHES, TECH_IDS, researchBlock, startResearch, techInfo, type ResearchBlock, type TechId } from '../game/tech';
import { RESOURCES } from '../game/resources';
import { analytics } from '../analytics/analytics';
import { saveProfile, type BuildingId, type Profile } from '../save/storage';
import { Button } from '../ui/Button';
import { coverImage, techImage } from '../ui/images';
import { BRANCH_ICON } from '../ui/icons';
import { FONT_MONO, textStyle } from '../ui/style';
import { uiCamera, view } from '../ui/screen';
import { OPS, heading, icon, label as monoLabel, panel, resIcon, tech, value } from '../ui/ops';
import { RESOURCE_INFO } from '../game/resources';
import type { Resource } from '../config/balance';
import { activeCiv } from '../game/camp';

// Albero alla Civilization/XCOM (Nico: "più pulito, più icone, niente puntini"): carte scure con l'immagine della ricerca
// a sinistra (generata con Draw Things), nome e stato con icona; collegamenti a linea piena, più chiari se già fatti.
const BLUE = 0x070b10, CYAN = 0x8a949a;
const NW = 236, NH = 84, GX = 40, GY = 22; // carte grandi: l'immagine si legge
let LABEL_W = 104; // colonna dei nomi dei rami (più stretta in verticale)

// righe dell'Arsenale, una per reparto (Nico: "diviso per categoria, a destra si migliora"); l'ordine segue tech.*.row
const ARS_ROWS = ['Infantry', 'Scouts', 'Artillery', 'Armour', 'Engineers', 'Gunboat', 'Unique unit', 'All units', 'Air support'];

const LOCK: Record<ResearchBlock, string> = {
  done: 'Completed', nolab: 'needs the Laboratory', lab: 'higher Laboratory', arsenale: 'higher Arsenal',
  prev: 'first the linked research', busy: 'another research under way', cost: 'not enough resources',
};

export interface TreeHost {
  profile: Profile;
  openBuilding(id: BuildingId): void;
  refreshAfterTree(): void;
  treeClosed(): void;
}

const TOP = 64; // altezza della barra fissa della base (NAV_H)
const DETAIL_W = 420; // scheda della ricerca scelta, a destra

export class TreeScene extends Phaser.Scene {
  private host!: TreeHost;
  private sel: TechId | 'room' = TECH_IDS[0]; // 'room' = la stanza (Arsenale o Laboratorio), migliorabile da qui
  private content!: Phaser.GameObjects.Container;
  private labels!: Phaser.GameObjects.Container; // nomi dei rami: seguono lo scorrimento verticale, restano a sinistra
  private detail!: Phaser.GameObjects.Container;
  private area = { x: 0, y: 0, w: 0, h: 0 };
  private size = { w: 0, h: 0 };
  private drag: { x: number; y: number; cx: number; cy: number } | null = null;
  private moved = false;
  private key = '';
  private acc = 0;
  private header!: Phaser.GameObjects.Text;
  private ids: TechId[] = TECH_IDS; // ricerche di questa pagina
  private rowOf = new Map<number, number>(); // riga nel bilancio → riga compatta della pagina
  private mode: 'ricerca' | 'arsenale' = 'ricerca';
  private maskG!: Phaser.GameObjects.Graphics;
  private detailBg!: Phaser.GameObjects.Graphics;
  private detailOpen = true;
  private upBtn!: Button;

  constructor() {
    super('Tree');
  }

  create(data: { mode?: 'ricerca' | 'arsenale' }) {
    uiCamera(this);
    this.host = this.scene.get('Camp') as unknown as TreeHost;
    const p = this.host.profile;
    const { width, height } = view(this);
    this.mode = data.mode ?? 'ricerca';
    const arsenal = this.mode === 'arsenale';
    this.ids = TECH_IDS.filter((id) => (BALANCE.tech[id].branch === 'armamenti') === arsenal);
    [...new Set(this.ids.map((id) => BALANCE.tech[id].row))].sort((a, b) => a - b).forEach((r, i) => this.rowOf.set(r, i));
    LABEL_W = 120; // nomi dei rami (Ricerca) o dei reparti (Arsenale)
    this.add.rectangle(0, TOP, width, height - TOP, BLUE, 1).setOrigin(0).setInteractive();
    coverImage(this, arsenal ? 'room-arsenale' : 'room-laboratorio', 0, TOP, width, height - TOP, 0.5).setAlpha(0.22);
    // testata: titolo della sezione, stato, la stanza che decide fin dove si arriva (si tocca per migliorarla)
    value(this, 28, TOP + 22, arsenal ? 'Arsenal' : 'Research', 40);
    this.header = monoLabel(this, 30, TOP + 74, '', CYAN, 11);
    // la stanza si migliora da qui, nella scheda a destra (Nico: "Laboratorio e Arsenale integrati meglio, non serve una
    // schermata a parte"): il tasto apre la scheda della stanza al posto di un'altra pagina
    this.upBtn = new Button(this, '', 300, 44, () => {
      this.sel = 'room';
      if (!this.detailOpen) this.setDetailOpen(true);
      this.draw();
    }, 12);
    this.upBtn.setPosition(width - DETAIL_W - 24 - 300, TOP + 24);

    // area dell'albero (si trascina) e scheda della ricerca scelta a destra
    const top = TOP + 108;
    this.area = { x: 0, y: top, w: width - DETAIL_W - 16, h: height - top - 16 };
    const rows = this.rowOf.size, cols = Math.max(...this.ids.map((id) => BALANCE.tech[id].col)) + 1;
    this.size = { w: LABEL_W + cols * (NW + GX) + 24, h: rows * (NH + GY) + 24 };
    this.content = this.add.container(0, this.area.y);
    this.labels = this.add.container(0, this.area.y);
    this.maskG = this.make.graphics({}, false);
    this.content.setMask(this.maskG.createGeometryMask());
    this.labels.setMask(this.maskG.createGeometryMask());
    // scheda della ricerca scelta: si chiude con la X (Nico: "che si possano chiudere i dettagli") e si riapre toccando una carta
    this.detailBg = this.add.graphics();
    panel(this.detailBg, width - DETAIL_W - 8, TOP + 16, DETAIL_W - 8, height - TOP - 32, 0.94);
    this.detail = this.add.container(width - DETAIL_W - 8, TOP + 16);
    this.setDetailOpen(true);

    // selezione iniziale: la ricerca in corso (se è di questa pagina), o la prima disponibile
    const cur = p.research?.id as TechId | undefined;
    this.sel = (cur && this.ids.includes(cur) ? cur : undefined) ?? this.ids.find((id) => !researchBlock(p, id))
      ?? this.ids.find((id) => !p.techs.includes(id)) ?? this.ids[0];
    this.draw();
    // si parte sempre dall'inizio dell'albero (prima si spostava sulla scelta e la prima carta restava fuori); la scelta è a destra
    this.setPan(0, this.area.y);

    // trascina per spostarti, rotella per scorrere
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      const x = ptr.x / (this.cameras.main.zoom), y = ptr.y / this.cameras.main.zoom;
      if (y < this.area.y || y > this.area.y + this.area.h) return;
      this.drag = { x, y, cx: this.content.x, cy: this.content.y };
      this.moved = false;
    });
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (!this.drag || !ptr.isDown) return;
      const x = ptr.x / this.cameras.main.zoom, y = ptr.y / this.cameras.main.zoom;
      if (Math.hypot(x - this.drag.x, y - this.drag.y) > 6) this.moved = true;
      this.setPan(this.drag.cx + x - this.drag.x, this.drag.cy + y - this.drag.y);
    });
    this.input.on('pointerup', () => (this.drag = null));
    this.input.on('wheel', (_p: unknown, _o: unknown, dx: number, dy: number) => this.setPan(this.content.x - dx, this.content.y - dy));
    this.input.keyboard?.on('keydown-ESC', () => this.close(true));
  }

  update(_t: number, delta: number) {
    this.acc -= delta;
    if (this.acc > 0) return;
    this.acc = 250;
    const p = this.host.profile;
    const k = this.stateKey();
    const r = p.research;
    this.header.setText(r ? `Under way: ${techInfo(r.id).name}, ${fmtTime(r.until - Date.now())}`
      : 'One research at a time, in real time. Tap a card to see it.').setColor(hex(r ? PALETTE.allerta : CYAN));
    if (k !== this.key || r || p.construction) this.draw();
  }

  /** Apre o chiude la scheda a destra; chiusa, l'albero prende tutta la larghezza. */
  private setDetailOpen(open: boolean) {
    const { width } = view(this);
    this.detailOpen = open;
    this.detailBg.setVisible(open);
    this.detail.setVisible(open);
    this.area.w = open ? width - DETAIL_W - 16 : width;
    this.maskG.clear().fillRect(this.area.x, this.area.y, this.area.w, this.area.h);
    this.setPan(this.content.x, this.content.y);
  }

  private setPan(x: number, y: number) {
    const minX = Math.min(0, this.area.w - this.size.w), minY = Math.min(0, this.area.h - this.size.h);
    this.content.setPosition(Phaser.Math.Clamp(x, minX, 0), this.area.y + Phaser.Math.Clamp(y - this.area.y, minY, 0));
    this.labels.setY(this.content.y);
  }

  private pos(id: TechId) {
    const t = BALANCE.tech[id];
    return { x: LABEL_W + t.col * (NW + GX), y: 12 + (this.rowOf.get(t.row) ?? 0) * (NH + GY) };
  }

  private stateKey() {
    const p = this.host.profile;
    return `${p.techs.length}:${p.research?.id ?? ''}:${p.construction?.id ?? ''}:${p.buildings.arsenale}:${p.buildings.laboratorio}:${RESOURCES.map((r) => p.stash[r]).join(',')}:${this.sel}`;
  }

  private draw() {
    const p = this.host.profile;
    this.key = this.stateKey();
    const room = this.room(), lvl = p.buildings[room], max = BALANCE.camp.buildings[room].length;
    this.upBtn.setLabel(`${buildingText[room].name.toUpperCase()} LV. ${lvl}/${max}${p.construction?.id === room ? ', UNDER CONSTRUCTION' : lvl < max ? ', UPGRADE' : ''}`);
    this.content.removeAll(true);
    this.labels.removeAll(true);
    const g = this.add.graphics();
    this.content.add(g);
    this.labels.add(this.add.rectangle(0, 0, LABEL_W - 8, this.size.h, BLUE, 0.94).setOrigin(0));
    // fasce dei rami con il nome a sinistra
    const rowsOf = new Map<string, number[]>();
    for (const id of this.ids) {
      const t = BALANCE.tech[id];
      (rowsOf.get(t.branch) ?? rowsOf.set(t.branch, []).get(t.branch)!).push(this.rowOf.get(t.row) ?? 0);
    }
    let band = 0;
    for (const [branch, rows] of rowsOf) {
      const r0 = Math.min(...rows), r1 = Math.max(...rows);
      const y0 = 12 + r0 * (NH + GY) - GY / 2, y1 = 12 + r1 * (NH + GY) + NH + GY / 2;
      band++;
      // ramo: la sua icona sopra il nome (prima "Ramo 1", "Ramo 2"…)
      const my = (y0 + y1) / 2;
      if (this.mode === 'ricerca') {
        this.labels.add(icon(this, BRANCH_ICON[branch] ?? 'ui-ricerca', 26, my - 14, 20, OPS.text));
        this.labels.add(heading(this, 14, my + 4, BRANCHES[branch], 14).setWordWrapWidth(LABEL_W - 24));
      }
      if (band > 1) g.lineStyle(1, 0xffffff, 0.08).lineBetween(LABEL_W - 8, y0, this.size.w, y0);
    }
    // Arsenale: una fascia per reparto con il suo nome a sinistra
    if (this.mode === 'arsenale') {
      for (const [r, i] of this.rowOf) {
        const y0 = 12 + i * (NH + GY);
        this.labels.add(heading(this, 14, y0 + NH / 2, ARS_ROWS[r] ?? '', 14).setOrigin(0, 0.5).setWordWrapWidth(LABEL_W - 24));
        if (i > 0) g.lineStyle(1, 0xffffff, 0.08).lineBetween(LABEL_W - 8, y0 - GY / 2, this.size.w, y0 - GY / 2);
      }
      this.drawIssued(g);
    }
    // collegamenti: dalla ricerca richiesta a quella che sblocca
    for (const id of this.ids) {
      const b = this.pos(id);
      for (const r of BALANCE.tech[id].req.filter((q) => this.ids.includes(q))) {
        const a = this.pos(r);
        const done = p.techs.includes(r);
        const x0 = a.x + NW, y0 = a.y + NH / 2, x1 = b.x, y1 = b.y + NH / 2, mx = x1 - GX / 2;
        // linea piena: chiara se la ricerca richiesta è fatta, tenue se no
        g.lineStyle(done ? 1.5 : 1, 0xffffff, done ? 0.7 : 0.22).strokePoints([{ x: x0, y: y0 }, { x: mx, y: y0 }, { x: mx, y: y1 }, { x: x1, y: y1 }], false);
      }
    }
    for (const id of this.ids) this.drawNode(id, g);
    this.children.bringToTop(this.upBtn); // sopra le carte scorse sotto la testata
    this.drawDetail();
  }

  private drawNode(id: TechId, g: Phaser.GameObjects.Graphics) {
    const p = this.host.profile;
    const t = techInfo(id), { x, y } = this.pos(id);
    const block = researchBlock(p, id);
    const running = p.research?.id === id;
    const done = block === 'done';
    const locked = block === 'prev' || block === 'arsenale' || block === 'lab' || block === 'nolab';
    // carta: fondo scuro, immagine a sinistra; filo bianco se scelta, ambra se in corso, barretta verde se fatta
    const sel = id === this.sel;
    g.fillStyle(0x111a22, 0.94).fillRect(x, y, NW, NH);
    g.lineStyle(sel ? 2 : 1, sel ? 0xffffff : running ? PALETTE.allerta : OPS.edge, sel ? 1 : running ? 1 : locked ? 0.2 : 0.5).strokeRect(x + 0.5, y + 0.5, NW - 1, NH - 1);
    const art = this.art(id);
    const img = coverImage(this, art, x + 1, y + 1, NH - 2, NH - 2, 0.45).setTint(locked ? 0x5d666e : 0xffffff);
    if (done) g.fillStyle(OPS.gain, 1).fillRect(x + NW - 4, y + 1, 3, NH - 2);
    const name = heading(this, x + NH + 10, y + 10, t.name, 15, locked ? OPS.label : OPS.text).setWordWrapWidth(NW - NH - 16).setLineSpacing(-2);
    // stato: icona + parola (fatta, in corso, bloccata dal livello, tempo che serve)
    const [sicon, sub, scol] = running ? ['ui-tempo', fmtTime(p.research!.until - Date.now()), PALETTE.allerta]
      : done ? ['ui-spunta', 'Done', OPS.gain]
        : block === 'arsenale' ? ['ui-lucchetto', `Arsenal lv. ${t.arsenale}`, OPS.label] : block === 'lab' || block === 'nolab' ? ['ui-lucchetto', `Laboratory lv. ${Math.min(t.tier ?? 1, 3)}`, OPS.label]
          : block === 'prev' ? ['ui-lucchetto', 'Previous ones first', OPS.label] : ['ui-tempo', fmtTime(t.timeSec * 1000), block === 'cost' ? PALETTE.ko : OPS.body];
    const ic = icon(this, sicon, x + NH + 16, y + NH - 15, 12, scol);
    const subT = monoLabel(this, x + NH + 28, y + NH - 15, sub, scol, 10).setOrigin(0, 0.5);
    const hit = this.add.rectangle(x, y, NW, NH, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true });
    hit.on('pointerup', (ptr: Phaser.Input.Pointer) => {
      // la maschera nasconde le carte scorse fuori dall'area ma non il loro tocco: fuori dall'area non valgono
      const py = ptr.y / this.cameras.main.zoom;
      if (this.moved || py < this.area.y || py > this.area.y + this.area.h) return;
      this.sel = id;
      if (!this.detailOpen) this.setDetailOpen(true);
      this.draw();
    });
    const node = [img, ic, name, subT, hit];
    this.content.add(node);
  }

  /** Scheda della ricerca scelta, a destra: immagine grande, nome, cosa dà, frammento della Caduta, costo, tasto. */
  private drawDetail() {
    const p = this.host.profile;
    this.detail.removeAll(true);
    if (this.sel === 'room') { this.drawRoom(); return; }
    const t = techInfo(this.sel), block = researchBlock(p, this.sel), running = p.research?.id === this.sel;
    const where = t.arsenale !== undefined ? `Arsenal lv. ${t.arsenale}` : `Laboratory lv. ${Math.min(t.tier ?? 1, 3)}`;
    const W = DETAIL_W - 8, IN = 20, w = W - 2 * IN, ih = Math.round(w * 0.56);
    const items: Phaser.GameObjects.GameObject[] = [
      coverImage(this, this.art(this.sel), IN, IN, w, ih, 0.45),
      this.add.rectangle(IN, IN, w, ih, 0, 0).setOrigin(0).setStrokeStyle(1, OPS.edge, 0.5),
      monoLabel(this, IN, IN + ih + 16, this.mode === 'arsenale' ? ARS_ROWS[t.row] ?? '' : BRANCHES[t.branch], CYAN, 10),
    ];
    // Arsenale: titolo grande nel font tecnico (Nico, mockup del 24 novembre: "il titolo è molto figo col font")
    const name = (this.mode === 'arsenale' ? tech(this, IN, IN + ih + 32, t.name, 30) : heading(this, IN, IN + ih + 34, t.name, 24)).setWordWrapWidth(w);
    items.push(name);
    let y = name.y + name.height + 10;
    if (this.mode === 'arsenale') y = this.drawStats(items, IN, y, w);
    const desc = this.add.text(IN, y, t.desc, textStyle(14, PALETTE.carta, false)).setWordWrapWidth(w);
    items.push(desc);
    y = desc.y + desc.height + 12;
    if (t.lore) {
      const lore = this.add.text(IN, y, block === 'done' ? `«${t.lore}»` : 'Unlocks a fragment of the archive of the Fall.', textStyle(12, block === 'done' ? PALETTE.tenue : OPS.label, false)).setWordWrapWidth(w);
      items.push(lore);
      y = lore.y + lore.height + 12;
    }
    // cosa serve: spunta verde o croce rossa per ogni requisito, così si capisce subito cosa manca
    const lvlOk = t.arsenale !== undefined ? p.buildings.arsenale >= t.arsenale : p.buildings.laboratorio >= Math.min(t.tier ?? 1, 3);
    const checks: [boolean, string, Resource?][] = [[lvlOk, where], ...t.req.map((r) => [p.techs.includes(r), `First: ${techInfo(r).name}`] as [boolean, string])];
    for (const r of RESOURCES) if (t.cost[r]) checks.push([p.stash[r] >= t.cost[r], this.costText(t.cost[r], p.stash[r], r), r]);
    checks.push([!p.research || running, p.research && !running ? `Laboratory busy: ${techInfo(p.research.id).name}` : 'No other research under way']);
    if (block !== 'done') {
      items.push(monoLabel(this, IN, y, 'What you need', OPS.label, 10));
      y += 22;
      checks.forEach(([ok, txt, res]) => {
        // le risorse con la loro icona, come nelle pagine delle stanze
        if (res) items.push(resIcon(this, res, IN + 34, y + 8, 15));
        items.push(icon(this, ok ? 'ui-spunta' : 'ui-chiudi', IN + 8, y + 8, 12, ok ? OPS.gain : OPS.loss),
          monoLabel(this, IN + (res ? 48 : 24), y + 8, txt, ok ? OPS.body : OPS.loss, 11).setOrigin(0, 0.5));
        y += 24;
      });
      items.push(icon(this, 'ui-tempo', IN + 8, y + 8, 12, OPS.label), monoLabel(this, IN + 24, y + 8, `Duration ${fmtTime(t.timeSec * 1000)}`, OPS.label, 11).setOrigin(0, 0.5));
      y += 36;
    }
    if (block === null) {
      const btn = new Button(this, 'START RESEARCH', w, 52, () => {
        if (!startResearch(p, this.sel, Date.now())) return;
        analytics.design(['ricerca', 'avvia', this.sel]);
        analytics.resources('sink', t.cost, 'ricerca', this.sel);
        saveProfile(p);
        this.host.refreshAfterTree();
        this.draw();
      }, 17);
      btn.setPosition(IN, y).setPrimary();
      items.push(btn);
    } else {
      items.push(heading(this, IN + w / 2, y + 26, running ? `Under way, ${fmtTime(p.research!.until - Date.now())}` : LOCK[block],
        16, running ? PALETTE.allerta : block === 'done' ? OPS.gain : OPS.label).setOrigin(0.5));
    }
    const x = this.add.image(W - 22, 22, 'ic-ui-chiudi').setDisplaySize(16, 16).setTint(OPS.body).setInteractive({ useHandCursor: true })
      .on('pointerover', () => x.setTint(OPS.text)).on('pointerout', () => x.setTint(OPS.body)).on('pointerup', () => this.setDetailOpen(false));
    items.push(this.add.circle(W - 22, 22, 15, 0x05080d, 0.8), x);
    this.detail.add(items);
  }

  /**
   * Scheda del reparto in stile dati (Nico, mockup del 24 novembre: "le statistiche del personaggio così sono molto fighe"):
   * vita, danni e costo con barra a tacche e puntini di guida, chi batte e chi teme. Numeri coi potenziamenti già fatti; se la
   * carta scelta è un potenziamento non ancora fatto, accanto il valore dopo ("→").
   */
  private drawStats(items: Phaser.GameObjects.GameObject[], x: number, y: number, w: number): number {
    const p = this.host.profile, t = techInfo(this.sel as TechId);
    const type = t.unit ?? t.boost?.unit ?? (t.unique ? BALANCE.civs[activeCiv(p)].unit : undefined);
    if (!type) return y;
    const U = BALANCE.units[type], now = unitBoosts(p.techs)[type] ?? { hp: 1, atk: 1, cost: 1 };
    const after = t.boost && !p.techs.includes(t.id) ? unitBoosts([...p.techs, t.id])[type]! : null;
    const max = { hp: Math.max(...UNITS.map((u) => BALANCE.units[u.id].hp)), atk: Math.max(...UNITS.map((u) => BALANCE.units[u.id].attack)), cost: Math.max(...UNITS.map((u) => BALANCE.units[u.id].cost)) };
    const mono = (tx: number, ty: number, txt: string, col: number) => this.add.text(tx, ty, txt, { fontFamily: FONT_MONO, fontSize: '12px', color: hex(col) }).setOrigin(0, 0.5);
    const rows: [string, number, number, number | null, number, string][] = [
      ['HEALTH', U.hp * now.hp, max.hp, after && U.hp * after.hp, OPS.gain, ''],
      ['DAMAGE', U.attack * now.atk, max.atk, after && U.attack * after.atk, 0x8fd3e8, ''],
      ['COST', U.cost * now.cost, max.cost, after && U.cost * after.cost, 0xc8ccce, ' TROOPS'],
    ];
    const g = this.add.graphics();
    items.push(g);
    y += 4;
    const BX = x + 112, BW = 100, N = 10;
    for (const [lab, v, m, nv, col, unit] of rows) {
      items.push(mono(x, y + 6, `${lab} ${'.'.repeat(12 - lab.length)}`, OPS.label));
      const on = Math.round((v / m) * N);
      for (let k = 0; k < N; k++) {
        if (k < on) g.fillStyle(col, 1).fillRect(BX + k * (BW / N), y, BW / N - 1, 12);
        else for (let d = 0; d < 3; d++) for (let e = 0; e < 3; e++) g.fillStyle(OPS.label, 0.5).fillRect(BX + k * (BW / N) + 1 + d * 3, y + 2 + e * 4, 1, 1);
      }
      const txt = mono(BX + BW + 10, y + 6, `${Math.round(v)}${unit}`, OPS.body);
      items.push(txt);
      if (nv !== null && Math.round(nv) !== Math.round(v)) items.push(mono(txt.x + txt.width + 6, y + 6, `-> ${Math.round(nv)}`, OPS.gain));
      y += 20;
    }
    const name = (u: string) => unitInfo(u as never).name.toUpperCase();
    const beats = unitInfo(type).beats.map(name).join(', ') || '—';
    const fears = UNITS.filter((u) => u.beats.includes(type) && BALANCE.units[u.id] && !['legionari', 'guardia', 'prototipo', 'infiltrati'].includes(u.id)).map((u) => u.name.toUpperCase()).join(', ') || '—';
    items.push(mono(x, y + 6, 'BEATS .......', OPS.label), mono(BX, y + 6, beats, OPS.text));
    y += 20;
    items.push(mono(x, y + 6, 'FEARS .......', OPS.label), mono(BX, y + 6, fears, OPS.loss));
    void w;
    return y + 28;
  }

  /** La Fanteria c'è già: prima carta della sua riga, senza ricerca (a destra i suoi potenziamenti). */
  private drawIssued(g: Phaser.GameObjects.Graphics) {
    const x = LABEL_W, y = 12;
    g.fillStyle(0x111a22, 0.94).fillRect(x, y, NW, NH);
    g.lineStyle(1, OPS.edge, 0.5).strokeRect(x + 0.5, y + 0.5, NW - 1, NH - 1);
    g.fillStyle(OPS.gain, 1).fillRect(x + NW - 4, y + 1, 3, NH - 2);
    const first = this.ids.find((id) => BALANCE.tech[id].row === 0 && BALANCE.tech[id].col === 1);
    if (first) g.lineStyle(this.host.profile.techs.includes(first) ? 1.5 : 1, 0xffffff, this.host.profile.techs.includes(first) ? 0.7 : 0.22).lineBetween(x + NW, y + NH / 2, x + NW + GX, y + NH / 2);
    this.content.add([coverImage(this, 'u-fanteria', x + 1, y + 1, NH - 2, NH - 2, 0.45),
      heading(this, x + NH + 10, y + 10, 'Infantry', 15),
      icon(this, 'ui-spunta', x + NH + 16, y + NH - 15, 12, OPS.gain),
      monoLabel(this, x + NH + 28, y + NH - 15, 'Standard issue', OPS.gain, 10).setOrigin(0, 0.5)]);
  }

  private room(): BuildingId {
    return this.mode === 'arsenale' ? 'arsenale' : 'laboratorio';
  }

  /** Scheda della stanza: cosa fa adesso, cosa apre il prossimo livello, cosa serve, e il tasto per metterla in cantiere. */
  private drawRoom() {
    const p = this.host.profile, room = this.room(), T = buildingText[room], lvl = p.buildings[room], n = T.levels.length;
    const W = DETAIL_W - 8, IN = 20, w = W - 2 * IN, ih = Math.round(w * 0.46), now = Date.now();
    const c = p.construction, building = c?.id === room, next = nextLevel(p, room);
    const items: Phaser.GameObjects.GameObject[] = [
      coverImage(this, room === 'arsenale' ? 'room-arsenale' : 'room-laboratorio', IN, IN, w, ih, 0.5),
      this.add.rectangle(IN, IN, w, ih, 0, 0).setOrigin(0).setStrokeStyle(1, OPS.edge, 0.5),
      monoLabel(this, IN, IN + ih + 16, `Room, level ${lvl} of ${n}`, CYAN, 10),
      heading(this, IN, IN + ih + 34, T.name, 24),
    ];
    let y = IN + ih + 72;
    const line = (txt: string, col: number, size = 13) => {
      const t = this.add.text(IN, y, txt, textStyle(size, col, false)).setWordWrapWidth(w);
      items.push(t);
      y = t.y + t.height + 8;
    };
    // cosa apre un livello: le carte di questa pagina che chiedono proprio quel livello
    const opens = (l: number) => this.ids.filter((id) => {
      const t = BALANCE.tech[id];
      return room === 'arsenale' ? t.arsenale === l : Math.min(t.tier ?? 1, 3) === l;
    }).map((id) => techInfo(id).name);
    if (lvl > 0) {
      items.push(monoLabel(this, IN, y, `Now, level ${lvl}`, OPS.gain, 10));
      y += 20;
      line(`You opened: ${[...Array(lvl).keys()].flatMap((i) => opens(i + 1)).join(', ') || '—'}`, OPS.body, 12);
      y += 6;
    }
    if (building) {
      items.push(monoLabel(this, IN, y, `Under construction, level ${lvl + 1}`, PALETTE.allerta, 10));
      y += 20;
      line(`Opens: ${opens(lvl + 1).join(', ')}`, OPS.text);
      items.push(heading(this, IN, y + 4, fmtTime(c!.until - now), 26, PALETTE.allerta));
    } else if (next) {
      items.push(monoLabel(this, IN, y, `Next, level ${lvl + 1}`, OPS.label, 10));
      y += 20;
      line(`Opens: ${opens(lvl + 1).join(', ')}`, OPS.text);
      y += 4;
      const block = buildBlock(p, room);
      const checks: [boolean, string, Resource?][] = RESOURCES.filter((r) => next.cost[r] > 0).map((r) => [p.stash[r] >= next.cost[r], this.costText(next.cost[r], p.stash[r], r), r]);
      checks.push([!c, c ? `Construction busy: ${buildingText[c.id].name}` : 'Construction free']);
      if (block === 'comando') checks.push([false, `Command Center lv. ${lvl}`]);
      items.push(monoLabel(this, IN, y, 'What you need', OPS.label, 10));
      y += 22;
      checks.forEach(([ok, txt, res]) => {
        // le risorse con la loro icona, come nelle pagine delle stanze
        if (res) items.push(resIcon(this, res, IN + 34, y + 8, 15));
        items.push(icon(this, ok ? 'ui-spunta' : 'ui-chiudi', IN + 8, y + 8, 12, ok ? OPS.gain : OPS.loss),
          monoLabel(this, IN + (res ? 48 : 24), y + 8, txt, ok ? OPS.body : OPS.loss, 11).setOrigin(0, 0.5));
        y += 24;
      });
      items.push(icon(this, 'ui-tempo', IN + 8, y + 8, 12, OPS.label), monoLabel(this, IN + 24, y + 8, `Duration ${fmtTime(next.timeSec * 1000)}`, OPS.label, 11).setOrigin(0, 0.5));
      y += 36;
      if (!block) {
        const btn = new Button(this, `UPGRADE: ${fmtTime(next.timeSec * 1000)}`, w, 52, () => {
          if (!startBuild(p, room, Date.now())) return;
          analytics.design(['accampamento', 'costruisci', room], lvl + 1);
          analytics.resources('sink', next.cost, 'edificio', room);
          saveProfile(p);
          this.host.refreshAfterTree();
          this.draw();
        }, 17);
        btn.setPosition(IN, y).setPrimary();
        items.push(btn);
      } else {
        items.push(heading(this, IN + w / 2, y + 26, block === 'busy' ? 'Construction busy' : block === 'comando' ? 'Needs the Command Center' : 'Not enough resources', 16, OPS.label).setOrigin(0.5));
      }
    } else {
      items.push(icon(this, 'ui-spunta', IN + 8, y + 10, 14, OPS.gain), heading(this, IN + 26, y + 10, 'Maximum level reached', 16, OPS.gain).setOrigin(0, 0.5));
    }
    const x = this.add.image(W - 22, 22, 'ic-ui-chiudi').setDisplaySize(16, 16).setTint(OPS.body).setInteractive({ useHandCursor: true })
      .on('pointerover', () => x.setTint(OPS.text)).on('pointerout', () => x.setTint(OPS.body)).on('pointerup', () => this.setDetailOpen(false));
    items.push(this.add.circle(W - 22, 22, 15, 0x05080d, 0.8), x);
    this.detail.add(items);
  }

  /** Costo di una risorsa nelle liste "Cosa serve": quantità, nome e quanto ne hai. */
  private costText(need: number, have: number, r: Resource): string {
    return `${need.toLocaleString('en-US')} ${RESOURCE_INFO[r].name.toLowerCase()}, you have ${have.toLocaleString('en-US')}`;
  }

  /** Immagine della ricerca: il reparto o l'abilità che sblocca, l'unità della tua potenza, o l'oggetto della ricerca. */
  private art(id: TechId): string {
    return techImage(this, id, activeCiv(this.host.profile));
  }

  /** Chiude l'albero; `toBase` = si torna alla base (ESC), altrimenti la base apre un'altra pagina. */
  private close(toBase: boolean) {
    this.host.refreshAfterTree();
    if (toBase) this.host.treeClosed();
    this.scene.stop();
  }
}
