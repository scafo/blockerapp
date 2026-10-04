// Albero della ricerca (Laboratorio + Arsenale): nodi per ramo collegati dai prerequisiti, una ricerca alla volta.
// Si apre sopra l'HQ e usa lo stesso profilo della CampScene (che chiude le ricerche finite e salva).
import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { PALETTE, hex } from '../config/palette';
import { fmtTime } from '../game/camp';
import { BRANCHES, TECH_IDS, researchBlock, startResearch, techInfo, type ResearchBlock, type TechId } from '../game/tech';
import { RESOURCES } from '../game/resources';
import { analytics } from '../analytics/analytics';
import { saveProfile, type BuildingId, type Profile } from '../save/storage';
import { Button } from '../ui/Button';
import { drawResourceIcon } from '../ui/resourceIcons';
import { textStyle } from '../ui/style';
import { uiCamera, view } from '../ui/screen';
import { drawAbilityIcon, drawUnitIcon } from '../ui/unitIcons';

const NW = 150, NH = 56, GX = 34, GY = 18;
let LABEL_W = 104; // colonna dei nomi dei rami (più stretta in verticale)

const LOCK: Record<ResearchBlock, string> = {
  done: 'COMPLETATA', nolab: 'serve il Laboratorio', lab: 'Laboratorio più alto', arsenale: 'Arsenale più alto',
  prev: 'prima le ricerche collegate', busy: 'un\'altra ricerca in corso', cost: 'risorse insufficienti',
};

export interface TreeHost {
  profile: Profile;
  openBuilding(id: BuildingId): void;
  refreshAfterTree(): void;
}

export class TreeScene extends Phaser.Scene {
  private host!: TreeHost;
  private sel: TechId = TECH_IDS[0];
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

  constructor() {
    super('Tree');
  }

  create(data: { focus?: string }) {
    uiCamera(this);
    this.host = this.scene.get('Camp') as unknown as TreeHost;
    const p = this.host.profile;
    const { width, height, portrait: P } = view(this);
    LABEL_W = P ? 80 : 104;
    this.add.rectangle(0, 0, width, height, PALETTE.inchiostro, 1).setOrigin(0).setInteractive();
    // intestazione
    this.add.text(16, 12, 'ALBERO DELLA RICERCA', textStyle(20, PALETTE.carta)).setLetterSpacing(2);
    this.header = this.add.text(16, 42, '', textStyle(11, PALETTE.tenue, false));
    const close = this.add.text(width - 16, 10, '✕', textStyle(22, PALETTE.carta)).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on('pointerup', () => this.close());
    if (!P) {
      const b = (label: string, id: BuildingId, x: number) => this.add.text(x, 16, label, textStyle(11, PALETTE.ocra)).setOrigin(1, 0)
        .setInteractive({ useHandCursor: true }).on('pointerup', () => { this.close(); this.host.openBuilding(id); });
      b(`ARSENALE liv. ${p.buildings.arsenale} ›`, 'arsenale', width - 60);
      b(`LABORATORIO liv. ${p.buildings.laboratorio} ›`, 'laboratorio', width - 210);
    }
    this.add.rectangle(16, 64, width - 32, 1, PALETTE.linea).setOrigin(0);

    // area dell'albero (si trascina) e scheda di dettaglio in basso
    const detailH = P ? 190 : 128;
    this.area = { x: 0, y: 66, w: width, h: height - 66 - detailH };
    const rows = Math.max(...TECH_IDS.map((id) => BALANCE.tech[id].row)) + 1;
    const cols = Math.max(...TECH_IDS.map((id) => BALANCE.tech[id].col)) + 1;
    this.size = { w: LABEL_W + cols * (NW + GX) + 24, h: rows * (NH + GY) + 24 };
    this.content = this.add.container(0, this.area.y);
    this.labels = this.add.container(0, this.area.y);
    const maskG = this.make.graphics({}, false).fillRect(this.area.x, this.area.y, this.area.w, this.area.h);
    this.content.setMask(maskG.createGeometryMask());
    this.labels.setMask(maskG.createGeometryMask());
    this.add.rectangle(0, height - detailH, width, detailH, PALETTE.pannello, 1).setOrigin(0);
    this.add.rectangle(0, height - detailH, width, 2, PALETTE.ocra, 0.8).setOrigin(0);
    this.detail = this.add.container(0, height - detailH);

    // selezione iniziale: la ricerca in corso, o la prima disponibile del ramo richiesto
    const focus = data.focus ?? 'armamenti';
    this.sel = (p.research?.id as TechId) ?? TECH_IDS.find((id) => BALANCE.tech[id].branch === focus && !researchBlock(p, id))
      ?? TECH_IDS.find((id) => BALANCE.tech[id].branch === focus && !p.techs.includes(id)) ?? TECH_IDS[0];
    this.draw();
    // si parte dall'alto; ci si sposta solo se la ricerca scelta non si vedrebbe
    const t = BALANCE.tech[this.sel];
    const nx = LABEL_W + t.col * (NW + GX), ny = 12 + t.row * (NH + GY);
    this.setPan(nx + NW > this.area.w ? this.area.w - nx - NW - 24 : 0, this.area.y + (ny + NH > this.area.h ? this.area.h - ny - NH - 12 : 0));

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
    this.input.on('wheel', (_p: unknown, _o: unknown, dx: number, dy: number) => this.setPan(this.content.x - dx - (P ? 0 : 0), this.content.y - dy));
    this.input.keyboard?.on('keydown-ESC', () => this.close());
  }

  update(_t: number, delta: number) {
    this.acc -= delta;
    if (this.acc > 0) return;
    this.acc = 250;
    const p = this.host.profile;
    const k = `${p.techs.length}:${p.research?.id ?? ''}:${p.buildings.arsenale}:${p.buildings.laboratorio}:${RESOURCES.map((r) => p.stash[r]).join(',')}:${this.sel}`;
    const r = p.research;
    this.header.setText(r ? `IN RICERCA: ${techInfo(r.id).name.toUpperCase()} · ${fmtTime(r.until - Date.now())}`
      : 'Una ricerca alla volta, a tempo reale. Non blocca mai le campagne.').setColor(hex(r ? PALETTE.allerta : PALETTE.tenue));
    if (k !== this.key || r) this.draw();
  }

  private setPan(x: number, y: number) {
    const minX = Math.min(0, this.area.w - this.size.w), minY = Math.min(0, this.area.h - this.size.h);
    this.content.setPosition(Phaser.Math.Clamp(x, minX, 0), this.area.y + Phaser.Math.Clamp(y - this.area.y, minY, 0));
    this.labels.setY(this.content.y);
  }

  private pos(id: TechId) {
    const t = BALANCE.tech[id];
    return { x: LABEL_W + t.col * (NW + GX), y: 12 + t.row * (NH + GY) };
  }

  private draw() {
    const p = this.host.profile;
    this.key = `${p.techs.length}:${p.research?.id ?? ''}:${p.buildings.arsenale}:${p.buildings.laboratorio}:${RESOURCES.map((r) => p.stash[r]).join(',')}:${this.sel}`;
    this.content.removeAll(true);
    this.labels.removeAll(true);
    const g = this.add.graphics();
    this.content.add(g);
    this.labels.add(this.add.rectangle(0, 0, LABEL_W - 8, this.size.h, PALETTE.inchiostro, 0.94).setOrigin(0));
    // fasce dei rami con il nome a sinistra
    const rowsOf = new Map<string, number[]>();
    for (const id of TECH_IDS) {
      const t = BALANCE.tech[id];
      (rowsOf.get(t.branch) ?? rowsOf.set(t.branch, []).get(t.branch)!).push(t.row);
    }
    let band = 0;
    for (const [branch, rows] of rowsOf) {
      const r0 = Math.min(...rows), r1 = Math.max(...rows);
      const y0 = 12 + r0 * (NH + GY) - GY / 2, y1 = 12 + r1 * (NH + GY) + NH + GY / 2;
      if (band++ % 2 === 0) g.fillStyle(0xffffff, 0.025).fillRect(0, y0, this.size.w, y1 - y0);
      this.labels.add(this.add.text(12, (y0 + y1) / 2, BRANCHES[branch].toUpperCase(), textStyle(11, branch === 'armamenti' ? PALETTE.ocra : PALETTE.tenue))
        .setOrigin(0, 0.5).setWordWrapWidth(LABEL_W - 20));
      this.labels.add(this.add.rectangle(LABEL_W - 9, y0 + 6, 2, y1 - y0 - 12, branch === 'armamenti' ? PALETTE.ocra : PALETTE.linea).setOrigin(0));
    }
    // collegamenti: dalla ricerca richiesta a quella che sblocca
    for (const id of TECH_IDS) {
      const b = this.pos(id);
      for (const r of BALANCE.tech[id].req) {
        const a = this.pos(r);
        const done = p.techs.includes(r);
        const x0 = a.x + NW, y0 = a.y + NH / 2, x1 = b.x, y1 = b.y + NH / 2, mx = x1 - GX / 2;
        g.lineStyle(2, done ? PALETTE.ocra : PALETTE.linea, done ? 0.9 : 1);
        g.strokePoints([{ x: x0, y: y0 }, { x: mx, y: y0 }, { x: mx, y: y1 }, { x: x1, y: y1 }], false);
      }
    }
    for (const id of TECH_IDS) this.drawNode(id, g);
    this.drawDetail();
  }

  private drawNode(id: TechId, g: Phaser.GameObjects.Graphics) {
    const p = this.host.profile;
    const t = techInfo(id), { x, y } = this.pos(id);
    const block = researchBlock(p, id);
    const running = p.research?.id === id;
    const done = block === 'done';
    const locked = block === 'prev' || block === 'arsenale' || block === 'lab' || block === 'nolab';
    const border = running ? PALETTE.allerta : done ? PALETTE.ocra : locked ? PALETTE.linea : PALETTE.carta;
    g.fillStyle(done ? 0x272413 : PALETTE.pannello, 1).fillRect(x, y, NW, NH);
    g.lineStyle(id === this.sel ? 3 : running || !locked ? 2 : 1, id === this.sel ? PALETTE.radioattivo : border, 1).strokeRect(x, y, NW, NH);
    // icona: unità, abilità o segno del ramo
    const ic = this.add.graphics();
    const col = done ? PALETTE.ocra : locked ? PALETTE.tenue : PALETTE.carta;
    if (t.unit) drawUnitIcon(ic, t.unit, x + 20, y + NH / 2, 9, col);
    else if (t.ability) drawAbilityIcon(ic, t.ability, x + 20, y + NH / 2, 9, col);
    else if (t.unique) ic.fillStyle(col, 1).fillTriangle(x + 12, y + NH / 2 + 7, x + 28, y + NH / 2 + 7, x + 20, y + NH / 2 - 9);
    else ic.lineStyle(2, col, 1).strokeCircle(x + 20, y + NH / 2, 7);
    const name = this.add.text(x + 38, y + 8, t.name.toUpperCase(), textStyle(11, done ? PALETTE.ocra : locked ? PALETTE.tenue : PALETTE.carta))
      .setWordWrapWidth(NW - 44).setLineSpacing(-2);
    const sub = running ? `IN CORSO · ${fmtTime(p.research!.until - Date.now())}` : done ? '✓ fatta'
      : block === 'arsenale' ? `🔒 Arsenale liv. ${t.arsenale}` : block === 'lab' || block === 'nolab' ? `🔒 Laboratorio liv. ${Math.min(t.tier ?? 1, 3)}`
        : block === 'prev' ? '🔒 prima le precedenti' : fmtTime(t.timeSec * 1000);
    const subT = this.add.text(x + 38, y + NH - 8, sub, textStyle(9, running ? PALETTE.allerta : block === 'cost' ? PALETTE.ko : PALETTE.tenue, false)).setOrigin(0, 1);
    const hit = this.add.rectangle(x, y, NW, NH, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true });
    hit.on('pointerup', () => {
      if (this.moved) return;
      this.sel = id;
      this.draw();
    });
    const node = [ic, name, subT, hit];
    if (locked) [ic, name, subT].forEach((o) => o.setAlpha(0.7));
    this.content.add(node);
  }

  private drawDetail() {
    const p = this.host.profile;
    const { width, portrait: P } = view(this);
    this.detail.removeAll(true);
    const t = techInfo(this.sel), block = researchBlock(p, this.sel), running = p.research?.id === this.sel;
    const req = t.req.map((r) => techInfo(r).name).join(', ');
    const where = t.arsenale !== undefined ? `Arsenale liv. ${t.arsenale}` : `Laboratorio liv. ${Math.min(t.tier ?? 1, 3)}`;
    const items: Phaser.GameObjects.GameObject[] = [
      this.add.text(16, 12, t.name.toUpperCase(), textStyle(18, PALETTE.carta)),
      this.add.text(16, 40, `${BRANCHES[t.branch].toUpperCase()} · richiede ${where}${req ? ` · dopo: ${req}` : ''}`, textStyle(10, PALETTE.ocra, false))
        .setWordWrapWidth(width - 32),
      this.add.text(16, 60, t.desc + (t.lore ? '  ·  sblocca un frammento dell\'archivio della Caduta' : ''), textStyle(12, PALETTE.carta, false))
        .setWordWrapWidth(P ? width - 32 : width - 360),
    ];
    // costo con le icone delle risorse
    const cy = P ? 104 : 96;
    const ig = this.add.graphics();
    let cx = 22;
    for (const r of RESOURCES) {
      if (!t.cost[r]) continue;
      drawResourceIcon(ig, r, cx, cy, 7);
      const enough = p.stash[r] >= t.cost[r];
      const tx = this.add.text(cx + 12, cy, String(t.cost[r]), textStyle(13, enough ? PALETTE.carta : PALETTE.ko)).setOrigin(0, 0.5);
      items.push(tx);
      cx += tx.width + 34;
    }
    items.push(ig, this.add.text(cx, cy, `⏱ ${fmtTime(t.timeSec * 1000)}`, textStyle(12, PALETTE.tenue, false)).setOrigin(0, 0.5));
    const bw = P ? width - 32 : 300, bx = P ? 16 : width - 316, by = P ? 128 : 24;
    if (block === null) {
      const btn = new Button(this, 'AVVIA RICERCA ▶', bw, 46, () => {
        if (!startResearch(p, this.sel, Date.now())) return;
        analytics.design(['ricerca', 'avvia', this.sel]);
        analytics.resources('sink', t.cost, 'ricerca', this.sel);
        saveProfile(p);
        this.host.refreshAfterTree();
        this.draw();
      });
      btn.setPosition(bx, by);
      items.push(btn);
    } else {
      items.push(this.add.text(bx + bw / 2, by + 23, running ? `IN CORSO · ${fmtTime(p.research!.until - Date.now())}` : LOCK[block].toUpperCase(),
        textStyle(13, running ? PALETTE.allerta : block === 'done' ? PALETTE.ocra : PALETTE.tenue)).setOrigin(0.5));
    }
    this.detail.add(items);
  }

  private close() {
    this.host.refreshAfterTree();
    this.scene.stop();
  }
}
