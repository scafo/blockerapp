// Simula run senza grafica per tarare balance.ts.
// Uso: npx vite-node scripts/sim.ts [taps al secondo] [numero run] [pedine: 0/1] [avanzate: 0/1] [fronte 0-5] [potenziamenti 0/1/2]
import { loadWorld } from '../src/map/worldAsset';
import { generateMap } from '../src/map/generate';
import { RunState, PLAYER } from '../src/game/RunState';
import { hexDistance } from '../src/map/hexGrid';
import { unitInfo } from '../src/game/units';
import { BALANCE } from '../src/config/balance';
import { DEFAULT_OPTIONS, type RunOptions } from '../src/game/camp';
import { BASE_MODS } from '../src/game/mods';

const tapsPerSec = Number(process.argv[2] ?? 2);
const runs = Number(process.argv[3] ?? 6);
const useUnits = process.argv[4] !== '0';
const useFlow = process.argv[5] !== '0'; // 5° argomento: 0 = niente avanzate
const front = Number(process.argv[6] ?? 0);
const level = Number(process.argv[7] ?? 0); // 0 = nessun potenziamento, 1 = HQ a metà, 2 = HQ al massimo
const upgrades = [
  {},
  { unitHpMult: 1.15, unitAttackMult: 1.15, startTroops: 40, ownedDefenseMult: 1.1, flowSpeedMult: 1.25, growthMult: 1.08 * 1.12, attackCostMult: 0.85 },
  { unitHpMult: 1.4, unitAttackMult: 1.15, startTroops: 40, ownedDefenseMult: 1.21, flowSpeedMult: 1.25, unitCostMult: 0.85, capitalTroopsMult: 1.5,
    growthMult: 1.2 * 1.12, attackCostMult: 0.85, prodMult: 1.4, bunkerMult: 1.4 },
][level];
const opts: RunOptions = {
  ...DEFAULT_OPTIONS, front: BALANCE.fronts[front], frontIndex: front, mods: { ...BASE_MODS, ...upgrades },
  units: level ? ['fanteria', 'ricognitori', 'artiglieria', 'corazzati'] : ['fanteria'],
  techs: level ? ['addestramento'] : [],
};
const world = loadWorld();
for (let r = 0; r < runs; r++) {
  const st = new RunState(generateMap('sim' + r, world), opts);
  let tapAcc = 0;
  const snaps: string[] = [];
  let firstContact = -1;
  const marks: string[] = []; // tempi delle fasi: primo impero, primo contatto
  for (let ms = 0; ms <= 31 * 60_000 && !st.over; ms += 100) {
    st.update(100);
    tapAcc += tapsPerSec / 10;
    while (tapAcc >= 1) {
      tapAcc--;
      // giocatore "medio": attacca la provincia più debole che può permettersi
      const f = st.frontier(PLAYER).filter((p) => st.troops > st.provCost(PLAYER, p));
      if (f.length) st.attackProvince(PLAYER, f.reduce((a, b) => (st.provCost(PLAYER, a) <= st.provCost(PLAYER, b) ? a : b)));
    }
    // giocatore "da OpenFront": se le truppe superano il punto ottimale lancia un'avanzata verso il nemico/neutro più vicino
    if (useFlow && ms % 1000 === 0 && st.flowTarget === null && st.troops > 120 + st.tilesOwned * 0.3) {
      const front = st.frontier(PLAYER);
      if (front.length) {
        const f0 = st.map.provinces[front[Math.floor((ms / 1000) % front.length)]].anchor;
        const far = st.map.land.filter((i) => st.passable(i) && st.owner[i] !== PLAYER && hexDistance(i, f0) === 21);
        if (far.length) st.startFlow(far[0]);
      }
    }
    if (useUnits && ms % 2000 === 0) {
      // giocatore attivo: contro la pedina nemica più vicina schiera quella che la batte
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
    // costruzioni: fabbriche appena lo zaino lo consente, caserme se ricercate
    if (ms % 45_000 === 0) { // una costruzione ogni tanto, come un giocatore vero
      const mine = st.map.provinces.map((_, p) => p).filter((p) => st.provOwner[p] === PLAYER && st.provWork[p] < 0);
      if (mine.length) {
        const p = mine[ms % mine.length];
        if (!st.workBlock(p, 'caserma')) st.build(PLAYER, p, 'caserma');
        else if (!st.workBlock(p, 'fabbrica')) st.build(PLAYER, p, 'fabbrica');
      }
    }
    // diplomazia del giocatore simulato: guerra a un impero confinante se è più forte di lui, pace se perde terreno
    if (ms % 30_000 === 0) {
      for (const f of st.factions) {
        if (f.kind !== 'empire' || !f.alive) continue;
        if (st.relation[f.id] === 'pace' && st.troops > f.troops * 1.3 && st.frontier(f.id).some((p) => st.provOwner[p] === PLAYER)) st.declareWar(f.id);
        else if (st.relation[f.id] === 'guerra' && st.troops < f.troops * 0.6) st.proposePeace(f.id);
      }
    }
    if (!marks.length && st.player.provinces >= 15) marks.push(`impero15 ${Math.round(ms / 1000)}s`);
    for (const e of st.drainEvents()) if (e.type === 'conquer' && e.from === PLAYER && firstContact < 0) firstContact = ms;
    if (ms % 120_000 === 0) {
      const z = st.player.loot, built = st.provWork.reduce((n, w, p) => n + (w >= 0 && st.provOwner[p] === PLAYER ? 1 : 0), 0);
      const bots = st.factions.filter((f) => f.kind === 'bot'), alive = bots.filter((f) => f.alive);
      const major = st.factions.filter((f) => f.kind !== 'bot').map((f) => (f.alive ? f.provinces : '✝')).join('/');
      const war = st.factions.filter((f) => f.kind === 'empire' && st.relation[f.id] === 'guerra').length;
      snaps.push(`${major} m${alive.length}:${alive.reduce((n, f) => n + f.provinces, 0)} g${war} [${Math.round(z.metallo + z.benzina + z.cibo)}r ${built}🏭]`);
    }
  }
  const t = Math.round(st.gameTimeMs / 1000);
  const sum = st.summary();
  const kept = sum.kept.metallo + sum.kept.benzina + sum.kept.cibo;
  console.log(`run ${r}: ${st.over ?? 'vivo'}${sum.reason ? '/' + sum.reason : ''} a ${t}s, porta a casa ${kept}, primo attacco subito ${firstContact < 0 ? '-' : Math.round(firstContact / 1000) + 's'} | ${marks.join(' ')} | province ogni 2 min ${snaps.join('  ')}`);
}
