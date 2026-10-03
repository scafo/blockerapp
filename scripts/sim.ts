// Simula run senza grafica per tarare balance.ts.
// Uso: npx vite-node scripts/sim.ts [taps al secondo del giocatore] [numero run] [pedine: 0/1] [avanzate: 0/1]
import { buildLandMask } from '../src/map/landMask';
import { generateMap } from '../src/map/generate';
import { RunState, PLAYER } from '../src/game/RunState';
import { hexDistance } from '../src/map/hexGrid';
import { unitInfo, UNIT_TYPES } from '../src/game/units';
import { BALANCE } from '../src/config/balance';

const tapsPerSec = Number(process.argv[2] ?? 2);
const runs = Number(process.argv[3] ?? 6);
const useUnits = process.argv[4] !== '0';
const useFlow = process.argv[5] !== '0'; // 5° argomento: 0 = niente avanzate
const mask = buildLandMask();
for (let r = 0; r < runs; r++) {
  const st = new RunState(generateMap('sim' + r, mask));
  let tapAcc = 0;
  const snaps: string[] = [];
  let firstContact = -1;
  for (let ms = 0; ms <= 12 * 60_000 && !st.over; ms += 100) {
    st.update(100);
    tapAcc += tapsPerSec / 10;
    while (tapAcc >= 1) {
      tapAcc--;
      // giocatore "medio": attacca la casella più debole che può permettersi
      const f = st.frontier(PLAYER).filter((i) => st.troops > st.defenseOf(i));
      if (f.length) st.tryConquer(f.reduce((a, b) => (st.defenseOf(a) <= st.defenseOf(b) ? a : b)));
    }
    // giocatore "da OpenFront": se le truppe superano il punto ottimale lancia un'avanzata verso il nemico/neutro più vicino
    if (useFlow && ms % 1000 === 0 && st.flowTarget === null && st.fill() > BALANCE.population.optimum + 0.1) {
      const front = st.frontier(PLAYER);
      if (front.length) {
        const f0 = front[Math.floor((ms / 1000) % front.length)];
        const far = st.map.land.filter((i) => st.passable(i) && st.owner[i] !== PLAYER && hexDistance(i, f0) === 6);
        if (far.length) st.startFlow(far[0]);
      }
    }
    if (useUnits && ms % 2000 === 0) {
      // giocatore attivo: contro la pedina nemica più vicina schiera quella che la batte
      const mine = st.map.starts[0];
      const foe = st.units.filter((u) => u.owner !== PLAYER).sort((a, b) => hexDistance(a.tile, mine) - hexDistance(b.tile, mine))[0];
      const type = foe ? UNIT_TYPES.find((t) => unitInfo(t).beats === foe.type)! : 'fanteria';
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
    for (const e of st.drainEvents()) if (e.type === 'conquer' && e.from === PLAYER && firstContact < 0) firstContact = ms;
    if (ms % 60_000 === 0) snaps.push(st.factions.map((f) => (f.alive ? f.tiles : '✝')).join('/'));
  }
  const t = Math.round(st.gameTimeMs / 1000);
  const sum = st.summary();
  const kept = sum.kept.rottami + sum.kept.carburante + sum.kept.viveri;
  console.log(`run ${r}: ${st.over ?? 'vivo'}${sum.reason ? '/' + sum.reason : ''} a ${t}s, anomalie ${sum.anomalies}, porta a casa ${kept}, primo attacco subito ${firstContact < 0 ? '-' : Math.round(firstContact / 1000) + 's'} | caselle per minuto ${snaps.join('  ')}`);
}
