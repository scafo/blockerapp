// Simulatore economico (scratch, non fa parte del gioco). Stessa IA del giocatore di scripts/sim.ts,
// ma registra il bottino grezzo (zaino - scorta di guerra) minuto per minuto, l'esito e il tempo.
// Uso: npx vite-node docs/econ/simecon.ts <fronte 0-5> <livello 0/1/2> <minuti 10/20/30> <runs> <seedPrefix>
// Output: una riga JSON per run.
import { loadWorld } from '../../src/map/worldAsset';
import { generateMap } from '../../src/map/generate';
import { RunState, PLAYER } from '../../src/game/RunState';
import { hexDistance } from '../../src/map/hexGrid';
import { unitInfo } from '../../src/game/units';
import { BALANCE } from '../../src/config/balance';
import { DEFAULT_OPTIONS, type RunOptions } from '../../src/game/camp';
import { BASE_MODS } from '../../src/game/mods';

const front = Number(process.argv[2] ?? 0);
const level = Number(process.argv[3] ?? 0);
const minutes = Number(process.argv[4] ?? 20);
const runs = Number(process.argv[5] ?? 2);
const prefix = process.argv[6] ?? 'e';
const tapsPerSec = 1;
const upgrades = [
  {},
  { unitHpMult: 1.15, unitAttackMult: 1.15, startTroops: 40, ownedDefenseMult: 1.1, flowSpeedMult: 1.25, growthMult: 1.08 * 1.12, attackCostMult: 0.85 },
  { unitHpMult: 1.4, unitAttackMult: 1.15, startTroops: 40, ownedDefenseMult: 1.21, flowSpeedMult: 1.25, unitCostMult: 0.85, capitalTroopsMult: 1.5,
    growthMult: 1.2 * 1.12, attackCostMult: 0.85, prodMult: 1.4, bunkerMult: 1.4 },
][level];
const opts: RunOptions = {
  ...DEFAULT_OPTIONS, front: BALANCE.fronts[front], frontIndex: front, mods: { ...BASE_MODS, ...upgrades },
  units: level ? ['fanteria', 'ricognitori', 'artiglieria', 'corazzati'] : ['fanteria'],
  techs: level ? ['addestramento'] : [], endMs: minutes * 60_000,
};
const SS = BALANCE.economy.startStock;
const world = loadWorld();
for (let r = 0; r < runs; r++) {
  const st = new RunState(generateMap(prefix + front + level + minutes + r, world, undefined, undefined, opts.front.aiDistance), opts);
  let tapAcc = 0;
  const perMin: number[] = [];
  let emp15 = -1;
  for (let ms = 0; ms <= (minutes + 1) * 60_000 && !st.over; ms += 100) {
    st.update(100);
    tapAcc += tapsPerSec / 10;
    while (tapAcc >= 1) {
      tapAcc--;
      const f = st.frontier(PLAYER).filter((p) => (st.provOwner[p] === -1 || st.isMilitia(st.provOwner[p])) && !st.battleAt(p) && st.troops > st.provCost(PLAYER, p));
      if (f.length) st.attackProvince(PLAYER, f.reduce((a, b) => (st.provCost(PLAYER, a) <= st.provCost(PLAYER, b) ? a : b)));
    }
    if (ms % 1000 === 0 && st.flowTarget === null && st.troops > 120 + st.tilesOwned * 0.3) {
      const fr = st.frontier(PLAYER);
      if (fr.length) {
        const f0 = st.map.provinces[fr[Math.floor((ms / 1000) % fr.length)]].anchor;
        const far = st.map.land.filter((i) => st.passable(i) && st.owner[i] !== PLAYER && hexDistance(i, f0) === 21);
        if (far.length) st.startFlow(far[0]);
      }
    }
    if (ms % 2000 === 0) {
      const mine = st.map.starts[0];
      const foe = st.units.filter((u) => u.owner !== PLAYER).sort((a, b) => hexDistance(a.tile, mine) - hexDistance(b.tile, mine))[0];
      const type = (foe ? st.opts.units.find((t) => unitInfo(t).beats.includes(unitInfo(foe.type).cls)) : undefined) ?? 'fanteria';
      if (st.troops > BALANCE.units[type].cost * 2) {
        const ref = foe ? foe.tile : mine;
        let spawn = -1, best = Infinity;
        for (let i = 0; i < st.owner.length; i++) {
          if (st.owner[i] === PLAYER && !st.unitAt(i) && hexDistance(i, ref) < best) { best = hexDistance(i, ref); spawn = i; }
        }
        const u = spawn >= 0 ? st.deploy(PLAYER, type, spawn) : null;
        if (u && foe) st.order(u, foe.tile);
      }
      for (const u of st.unitsOf(PLAYER)) {
        if (u.path.length) continue;
        const foeU = st.units.filter((v) => v.owner !== PLAYER).sort((a, b) => hexDistance(a.tile, u.tile) - hexDistance(b.tile, u.tile))[0];
        if (foeU) st.order(u, foeU.tile);
      }
    }
    if (ms % 45_000 === 0) {
      const mine = st.map.provinces.map((_, p) => p).filter((p) => st.provOwner[p] === PLAYER && st.provWork[p] < 0);
      if (mine.length) {
        const p = mine[ms % mine.length];
        if (!st.workBlock(p, 'caserma')) st.build(PLAYER, p, 'caserma');
        else if (!st.workBlock(p, 'fabbrica')) st.build(PLAYER, p, 'fabbrica');
      }
    }
    if (ms % 30_000 === 0) {
      for (const f of st.factions) {
        if (f.kind !== 'empire' || !f.alive) continue;
        if (st.relation[f.id] === 'pace' && st.troops > f.troops * 1.3 && st.frontier(f.id).some((p) => st.provOwner[p] === PLAYER)) st.declareWar(f.id);
        else if (st.relation[f.id] === 'guerra' && st.troops < f.troops * 0.6) st.proposePeace(f.id);
      }
    }
    if (emp15 < 0 && st.player.provinces >= 15) emp15 = ms;
    st.drainEvents();
    if (ms % 60_000 === 0 && ms > 0) {
      const z = st.player.loot;
      perMin.push(Math.round(Math.max(0, z.metallo - SS.metallo) + Math.max(0, z.benzina - SS.benzina) + Math.max(0, z.cibo - SS.cibo)));
    }
  }
  const z = st.player.loot;
  const raw = { metallo: Math.max(0, z.metallo - SS.metallo), benzina: Math.max(0, z.benzina - SS.benzina), cibo: Math.max(0, z.cibo - SS.cibo) };
  const rank = st.rank();
  console.log(JSON.stringify({
    front, level, minutes, run: r, outcome: st.over ?? 'vivo', t: Math.round(st.gameTimeMs / 1000),
    raw: Math.round(raw.metallo + raw.benzina + raw.cibo), rawBag: { m: Math.round(raw.metallo), b: Math.round(raw.benzina), c: Math.round(raw.cibo) },
    prov: st.player.provinces, maxProv: st.player.maxProvinces, pos: rank.pos, emp15: emp15 < 0 ? -1 : Math.round(emp15 / 1000), perMin,
  }));
}
