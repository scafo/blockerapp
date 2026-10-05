// La base del comandante vista dall'alto, di notte (alla Clash, nel tono della sala operativa): terreno, recinto con torrette e
// fari, strade, edifici con ombre, tetti, luci e dettagli che crescono col livello. Tutto disegnato (niente immagini).
import Phaser from 'phaser';
import { PALETTE } from '../config/palette';
import { drawPatch, type SymbolKind } from './symbols';

export const ART = {
  ground: 0x0c131b,
  pad: 0x111a24,
  concrete: 0x1a2531,
  concreteEdge: 0x2a3a4d,
  asphalt: 0x161f29,
  roadLine: 0x34465a,
  roof: 0x2c3a4a,
  roofLight: 0x45586e,
  roofDark: 0x1a2430,
  shadow: 0x000000,
  warm: 0xf2c46a,
  lume: 0x8fd6ff,
  beacon: 0xff5252,
  steel: 0x8a9bb0,
};

/** Terreno: fondo scuro con macchie e puntini (texture generata una volta). */
export function drawGround(scene: Phaser.Scene, w: number, h: number) {
  const key = 'base-ground', W = Math.max(64, Math.round(w / 2)), H = Math.max(64, Math.round(h / 2));
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, W, H)!;
  const ctx = tex.getContext();
  ctx.fillStyle = '#0c131b';
  ctx.fillRect(0, 0, W, H);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // macchie larghe e morbide (cenere, neve sporca)
  for (let i = 0; i < 70; i++) {
    const x = rnd() * W, y = rnd() * H, r = 12 + rnd() * 50;
    const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
    const light = rnd() < 0.55;
    gr.addColorStop(0, light ? 'rgba(60,78,96,0.16)' : 'rgba(0,0,0,0.25)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // grana fine
  for (let i = 0; i < (W * H) / 30; i++) {
    const v = rnd();
    ctx.fillStyle = v < 0.5 ? 'rgba(120,140,160,0.06)' : 'rgba(0,0,0,0.18)';
    ctx.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * H), 1, 1);
  }
  tex.refresh();
  return scene.add.image(0, 0, key).setOrigin(0).setDisplaySize(w, h);
}

/** Piazzale e recinto a otto lati con paletti; ritorna i quattro angoli (per le torrette). */
export function drawCompound(g: Phaser.GameObjects.Graphics, b: { x: number; y: number; w: number; h: number }, k: number) {
  const cut = 34 * k;
  const pts = [
    { x: b.x + cut, y: b.y }, { x: b.x + b.w - cut, y: b.y }, { x: b.x + b.w, y: b.y + cut }, { x: b.x + b.w, y: b.y + b.h - cut },
    { x: b.x + b.w - cut, y: b.y + b.h }, { x: b.x + cut, y: b.y + b.h }, { x: b.x, y: b.y + b.h - cut }, { x: b.x, y: b.y + cut },
  ];
  g.fillStyle(ART.pad, 0.92).fillPoints(pts, true);
  // recinto: doppia linea e paletti
  g.lineStyle(2, ART.concreteEdge, 0.9).strokePoints(pts, true, true);
  const inner = pts.map((p) => ({ x: p.x + Math.sign(b.x + b.w / 2 - p.x) * 5, y: p.y + Math.sign(b.y + b.h / 2 - p.y) * 5 }));
  g.lineStyle(1, ART.concreteEdge, 0.5).strokePoints(inner, true, true);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], c = pts[(i + 1) % pts.length], len = Math.hypot(c.x - a.x, c.y - a.y), n = Math.max(1, Math.floor(len / (22 * k)));
    for (let s = 0; s <= n; s++) g.fillStyle(ART.steel, 0.55).fillRect(a.x + ((c.x - a.x) * s) / n - 1.5, a.y + ((c.y - a.y) * s) / n - 1.5, 3, 3);
  }
  return [pts[0], pts[2], pts[4], pts[6]].map((p, i) => ({ x: p.x + (i === 1 || i === 2 ? -6 : 6), y: p.y + (i >= 2 ? -6 : 6) }));
}

/** Strada d'asfalto tra due punti: bordi chiari e mezzeria tratteggiata. */
export function drawRoad(g: Phaser.GameObjects.Graphics, ax: number, ay: number, bx: number, by: number, k: number) {
  const w = 14 * k, ang = Math.atan2(by - ay, bx - ax), nx = -Math.sin(ang), ny = Math.cos(ang);
  g.lineStyle(w, ART.asphalt, 1).lineBetween(ax, ay, bx, by);
  g.lineStyle(1, ART.roadLine, 0.7).lineBetween(ax + (nx * w) / 2, ay + (ny * w) / 2, bx + (nx * w) / 2, by + (ny * w) / 2)
    .lineBetween(ax - (nx * w) / 2, ay - (ny * w) / 2, bx - (nx * w) / 2, by - (ny * w) / 2);
  const len = Math.hypot(bx - ax, by - ay), n = Math.floor(len / (12 * k));
  for (let s = 0; s < n; s += 2) {
    const t0 = s / n, t1 = (s + 1) / n;
    g.lineStyle(1.2, ART.warm, 0.25).lineBetween(ax + (bx - ax) * t0, ay + (by - ay) * t0, ax + (bx - ax) * t1, ay + (by - ay) * t1);
  }
}

/** Torretta d'angolo con faro che spazza piano (cono additivo). */
export function drawTower(scene: Phaser.Scene, x: number, y: number, k: number, aim: number): Phaser.GameObjects.GameObject[] {
  const cone = scene.add.graphics({ x, y }).setBlendMode(Phaser.BlendModes.ADD);
  const L = 120 * k;
  for (const [spread, a] of [[0.34, 0.035], [0.22, 0.05], [0.11, 0.07]] as const) {
    cone.fillStyle(0xdfe9f5, a).fillTriangle(0, 0, Math.cos(-spread) * L, Math.sin(-spread) * L, Math.cos(spread) * L, Math.sin(spread) * L);
  }
  cone.setRotation(aim);
  scene.tweens.add({ targets: cone, rotation: aim + 0.9, duration: 4200 + Math.random() * 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  const t = scene.add.graphics();
  t.fillStyle(ART.shadow, 0.5).fillRect(x - 5 * k + 3, y - 5 * k + 3, 10 * k, 10 * k);
  t.fillStyle(ART.roof, 1).fillRect(x - 5 * k, y - 5 * k, 10 * k, 10 * k).lineStyle(1, ART.roofLight, 1).strokeRect(x - 5 * k, y - 5 * k, 10 * k, 10 * k);
  const lamp = scene.add.circle(x, y, 2.2 * k, ART.warm);
  return [cone, t, lamp];
}

// ---------- edifici ----------

interface Ctx { scene: Phaser.Scene; g: Phaser.GameObjects.Graphics; deco: Phaser.GameObjects.GameObject[]; k: number }

/** Blocco visto dall'alto: ombra verso sud-est, tetto con bordo chiaro a nord-ovest. */
function block(c: Ctx, x: number, y: number, w: number, h: number, roof = ART.roof) {
  const { g, k } = c, sh = 5 * k;
  g.fillStyle(ART.shadow, 0.45).fillRect(x + sh, y + sh, w, h);
  g.fillStyle(roof, 1).fillRect(x, y, w, h);
  g.lineStyle(1.2, ART.roofLight, 1).lineBetween(x, y, x + w, y).lineBetween(x, y, x, y + h);
  g.lineStyle(1.2, ART.roofDark, 1).lineBetween(x + w, y, x + w, y + h).lineBetween(x, y + h, x + w, y + h);
}

/** Finestre accese lungo un lato (qualcuna lampeggia piano). */
function lights(c: Ctx, x: number, y: number, len: number, vertical: boolean, n: number) {
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, px = vertical ? x : x + len * t, py = vertical ? y + len * t : y;
    const l = c.scene.add.rectangle(px, py, vertical ? 2 * c.k : 4 * c.k, vertical ? 4 * c.k : 2 * c.k, ART.warm, 0.85);
    if (i % 3 === 1) c.scene.tweens.add({ targets: l, alpha: 0.25, duration: 1400 + i * 230, yoyo: true, repeat: -1 });
    c.deco.push(l);
  }
}

function beacon(c: Ctx, x: number, y: number, color = ART.beacon, ms = 900) {
  const b = c.scene.add.circle(x, y, 2.2 * c.k, color);
  const halo = c.scene.add.circle(x, y, 6 * c.k, color, 0.25).setBlendMode(Phaser.BlendModes.ADD);
  c.scene.tweens.add({ targets: [b, halo], alpha: 0.1, duration: ms, yoyo: true, repeat: -1 });
  c.deco.push(halo, b);
}

/** Carro visto dall'alto (scafo, cingoli, torretta, cannone). */
function tank(c: Ctx, x: number, y: number, s: number, ang = 0) {
  const t = c.scene.add.graphics({ x, y }).setRotation(ang);
  t.fillStyle(ART.shadow, 0.45).fillRect(-9 * s + 2, -6 * s + 2, 18 * s, 12 * s);
  t.fillStyle(0x1c2733, 1).fillRect(-9 * s, -6 * s, 18 * s, 3 * s).fillRect(-9 * s, 3 * s, 18 * s, 3 * s);
  t.fillStyle(0x4f6276, 1).fillRect(-8 * s, -3.5 * s, 16 * s, 7 * s);
  t.fillStyle(0x6a7f94, 1).fillCircle(-1 * s, 0, 3.4 * s).fillRect(1 * s, -0.8 * s, 9 * s, 1.6 * s);
  c.deco.push(t);
}

/** Camion visto dall'alto (cassone e cabina). */
export function truck(c: Ctx, x: number, y: number, s: number, color = 0x5b6e57) {
  const { g } = c;
  g.fillStyle(ART.shadow, 0.45).fillRect(x - 8 * s + 2, y - 3.5 * s + 2, 16 * s, 7 * s);
  g.fillStyle(color, 1).fillRect(x - 8 * s, y - 3.5 * s, 11 * s, 7 * s);
  g.fillStyle(0x7d8f74, 1).fillRect(x + 4 * s, y - 3 * s, 4 * s, 6 * s);
  g.fillStyle(ART.warm, 0.9).fillRect(x + 8 * s, y - 2.5 * s, 1 * s, 1.4 * s).fillRect(x + 8 * s, y + 1.1 * s, 1 * s, 1.4 * s);
}

/** Edificio di una postazione al livello dato (centro x, y; ingombro w×h). Le parti animate finiscono in deco. */
export function drawBuilding(c: Ctx, id: string, x: number, y: number, w: number, h: number, lvl: number, civ: { fill: number; symbol: SymbolKind }) {
  const { g, k, scene } = c, l = x - w / 2, t = y - h / 2;
  // piazzola di cemento
  g.fillStyle(ART.concrete, 1).fillRect(l - 4 * k, t - 4 * k, w + 8 * k, h + 8 * k);
  g.lineStyle(1, ART.concreteEdge, 0.8).strokeRect(l - 4 * k, t - 4 * k, w + 8 * k, h + 8 * k);
  if (id === 'comando') {
    block(c, l, t, w * 0.62, h);
    block(c, l + w * 0.12, t + h * 0.18, w * 0.38, h * 0.64, ART.roofLight); // corpo rialzato
    const pg = scene.add.graphics();
    drawPatch(pg, l + w * 0.31, y, Math.min(h * 0.24, 16 * k), civ.fill, civ.symbol);
    c.deco.push(pg);
    // eliporto
    const hx = l + w * 0.82, hr = Math.min(h * 0.36, w * 0.17);
    g.fillStyle(0x1f2b38, 1).fillCircle(hx, y, hr).lineStyle(1.5, ART.warm, 0.7).strokeCircle(hx, y, hr * 0.82);
    g.lineStyle(2, ART.warm, 0.8).lineBetween(hx - hr * 0.3, y - hr * 0.4, hx - hr * 0.3, y + hr * 0.4).lineBetween(hx + hr * 0.3, y - hr * 0.4, hx + hr * 0.3, y + hr * 0.4)
      .lineBetween(hx - hr * 0.3, y, hx + hr * 0.3, y);
    // antenna con luce rossa
    g.lineStyle(1.5, ART.steel, 1).lineBetween(l + w * 0.58, t + h * 0.12, l + w * 0.58, t - h * 0.25);
    beacon(c, l + w * 0.58, t - h * 0.25, ART.beacon, 700);
    lights(c, l + 3 * k, t + h + 1, w * 0.56, false, 3 + lvl);
  } else if (id === 'laboratorio') {
    block(c, l, t + h * 0.55, w * 0.36, h * 0.45);
    const r = Math.min(h * 0.46, w * 0.3), cx = l + w * 0.6, cy = y;
    g.fillStyle(ART.shadow, 0.45).fillCircle(cx + 5 * k, cy + 5 * k, r);
    for (let i = 0; i < 6; i++) g.fillStyle(Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(0x1d2a38), Phaser.Display.Color.ValueToColor(0x51667d), 5, i).color, 1).fillCircle(cx - i * r * 0.05, cy - i * r * 0.05, r * (1 - i * 0.14));
    // il Lume: luce fredda che pulsa al centro della cupola (più forte col livello)
    const glow = scene.add.circle(cx, cy, r * 0.55, ART.lume, 0.18 + lvl * 0.05).setBlendMode(Phaser.BlendModes.ADD);
    const core = scene.add.circle(cx, cy, r * 0.16, ART.lume, 1);
    scene.tweens.add({ targets: glow, scale: { from: 0.8, to: 1.25 }, alpha: { from: 0.35, to: 0.1 }, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    c.deco.push(glow, core);
    g.lineStyle(1.5, ART.lume, 0.35).lineBetween(l + w * 0.36, t + h * 0.75, cx - r * 0.7, cy + r * 0.5); // condotta
  } else if (id === 'radar') {
    block(c, l, t + h * 0.2, w * 0.42, h * 0.62);
    lights(c, l + w * 0.42 + 1, t + h * 0.25, h * 0.5, true, 2 + lvl);
    const r = Math.min(h * 0.44, w * 0.28) * (0.85 + lvl * 0.06), cx = l + w * 0.71, cy = y;
    g.fillStyle(ART.shadow, 0.45).fillCircle(cx + 5 * k, cy + 5 * k, r);
    g.fillStyle(0x16212c, 1).fillCircle(cx, cy, r).lineStyle(1, ART.steel, 0.6).strokeCircle(cx, cy, r).strokeCircle(cx, cy, r * 0.6).strokeCircle(cx, cy, r * 0.25);
    const sweep = scene.add.graphics({ x: cx, y: cy });
    sweep.fillStyle(PALETTE.radioattivo, 0.18).slice(0, 0, r, -0.7, 0, false).fillPath();
    sweep.lineStyle(1.5, PALETTE.radioattivo, 0.9).lineBetween(0, 0, r, 0);
    scene.tweens.add({ targets: sweep, rotation: Math.PI * 2, duration: 3000, repeat: -1 });
    const blip = scene.add.circle(cx + r * 0.45, cy - r * 0.3, 1.8 * k, PALETTE.radioattivo);
    scene.tweens.add({ targets: blip, alpha: 0, duration: 1500, yoyo: true, repeat: -1 });
    c.deco.push(sweep, blip);
  } else if (id === 'arsenale') {
    // hangar col tetto ad arco (strisce) e porta, carri sul piazzale (più carri col livello)
    const hw = w * 0.58;
    block(c, l, t, hw, h);
    for (let i = 1; i < 6; i++) g.lineStyle(1, ART.roofLight, 0.45).lineBetween(l + (hw * i) / 6, t + 2, l + (hw * i) / 6, t + h - 2);
    g.fillStyle(0x0f1720, 1).fillRect(l + hw - 3 * k, t + h * 0.2, 3 * k, h * 0.6);
    const n = Math.min(3, Math.max(1, lvl));
    for (let i = 0; i < n; i++) tank(c, l + hw + w * 0.22, t + h * (0.22 + i * 0.3), 1.05 * k, Math.PI);
    lights(c, l + 3 * k, t - 1, hw - 6 * k, false, 3);
  } else if (id === 'deposito') {
    // magazzino a falde, cisterne e container (più roba col livello)
    const ww = w * 0.55;
    block(c, l, t, ww, h * 0.62);
    g.lineStyle(1, ART.roofDark, 1).lineBetween(l, t + h * 0.31, l + ww, t + h * 0.31);
    const tanks = Math.min(3, 1 + Math.floor(lvl / 1.5));
    for (let i = 0; i < tanks; i++) {
      const cx = l + ww + w * 0.12 + (i % 2) * w * 0.2, cy = t + h * 0.25 + Math.floor(i / 2) * h * 0.42, r = Math.min(w * 0.09, h * 0.18);
      g.fillStyle(ART.shadow, 0.45).fillCircle(cx + 3 * k, cy + 3 * k, r);
      g.fillStyle(0x56687c, 1).fillCircle(cx, cy, r).lineStyle(1, 0x7d90a5, 1).strokeCircle(cx, cy, r * 0.6);
    }
    const colors = [0x8a4b3e, 0x3e6a8a, 0x6b7a3e, 0x8a7a3e];
    for (let i = 0; i < 2 + lvl; i++) {
      const cx = l + (i % 4) * w * 0.14, cy = t + h * 0.74 + Math.floor(i / 4) * h * 0.13;
      g.fillStyle(ART.shadow, 0.4).fillRect(cx + 2, cy + 2, w * 0.12, h * 0.1);
      g.fillStyle(colors[i % colors.length], 1).fillRect(cx, cy, w * 0.12, h * 0.1);
    }
  } else if (id === 'spedizione') {
    // rimessa delle squadre di estrazione
    block(c, l, t, w * 0.5, h * 0.7);
    g.fillStyle(0x0f1720, 1).fillRect(l + w * 0.5 - 3 * k, t + h * 0.1, 3 * k, h * 0.5);
    beacon(c, l + 4 * k, t + 4 * k, ART.warm, 1100);
  }
}

/** Lotto libero: piazzola tratteggiata e cartello. */
export function drawLot(c: Ctx, x: number, y: number, w: number, h: number) {
  const { g, k } = c, l = x - w / 2, t = y - h / 2;
  g.fillStyle(ART.concrete, 0.5).fillRect(l, t, w, h);
  const seg = 8 * k;
  for (const [x0, y0, x1, y1] of [[l, t, l + w, t], [l + w, t, l + w, t + h], [l + w, t + h, l, t + h], [l, t + h, l, t]]) {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.floor(len / seg);
    for (let s = 0; s < n; s += 2) g.lineStyle(1, ART.steel, 0.45).lineBetween(x0 + ((x1 - x0) * s) / n, y0 + ((y1 - y0) * s) / n, x0 + ((x1 - x0) * (s + 1)) / n, y0 + ((y1 - y0) * (s + 1)) / n);
  }
}

/** Cantiere: strisce di pericolo sul bordo e gru col gancio che dondola. */
export function drawScaffold(c: Ctx, x: number, y: number, w: number, h: number) {
  const { g, k, scene } = c, l = x - w / 2 - 4 * k, t = y - h / 2 - 4 * k, W = w + 8 * k, H = h + 8 * k, s = 6 * k;
  for (let i = 0; i < (W + H) * 2; i += s * 2) {
    // strisce gialle e nere lungo il perimetro (giallo a passo alterno)
    const pos = (d: number) => (d < W ? [l + d, t] : d < W + H ? [l + W, t + d - W] : d < 2 * W + H ? [l + W - (d - W - H), t + H] : [l, t + H - (d - 2 * W - H)]);
    const [ax, ay] = pos(i), [bx, by] = pos(Math.min(i + s, (W + H) * 2 - 0.01));
    g.lineStyle(3 * k, PALETTE.allerta, 0.85).lineBetween(ax, ay, bx, by);
  }
  const crane = scene.add.graphics({ x: l + W, y: t });
  crane.lineStyle(2 * k, PALETTE.allerta, 0.95).lineBetween(0, 0, -W * 0.55, H * 0.35);
  crane.lineStyle(1, ART.steel, 0.9).lineBetween(-W * 0.55, H * 0.35, -W * 0.55, H * 0.6);
  crane.fillStyle(PALETTE.allerta, 1).fillRect(-3 * k, -3 * k, 6 * k, 6 * k);
  scene.tweens.add({ targets: crane, rotation: 0.12, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  c.deco.push(crane);
}

/** Cenere che scende piano su tutta la base. */
export function ashFall(scene: Phaser.Scene, w: number, _h: number) {
  return scene.add.particles(0, 0, 'dot', {
    x: { min: 0, max: w }, y: -10, lifespan: 14000, speedY: { min: 8, max: 22 }, speedX: { min: -6, max: 6 },
    scale: { min: 0.25, max: 0.6 }, alpha: { start: 0.35, end: 0 }, frequency: 260, quantity: 1, tint: 0xc8d4e2,
  }).setDepth(25);
}
