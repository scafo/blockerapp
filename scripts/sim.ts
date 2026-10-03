// Simula run senza grafica per tarare balance.ts.
// Uso: npx vite-node scripts/sim.ts [taps al secondo del giocatore] [numero run]
import { buildLandMask } from '../src/map/landMask';
import { generateMap } from '../src/map/generate';
import { RunState, PLAYER } from '../src/game/RunState';

const tapsPerSec = Number(process.argv[2] ?? 2);
const runs = Number(process.argv[3] ?? 6);
const mask = buildLandMask();
for (let r = 0; r < runs; r++) {
  const st = new RunState(generateMap('sim' + r, mask));
  let tapAcc = 0;
  const snaps: string[] = [];
  let firstContact = -1;
  for (let ms = 0; ms <= 8 * 60_000 && !st.over; ms += 100) {
    st.update(100);
    tapAcc += tapsPerSec / 10;
    while (tapAcc >= 1) {
      tapAcc--;
      // giocatore "medio": attacca la casella più debole che può permettersi
      const f = st.frontier(PLAYER).filter((i) => st.troops > st.defenseOf(i));
      if (f.length) st.tryConquer(f.reduce((a, b) => (st.defenseOf(a) <= st.defenseOf(b) ? a : b)));
    }
    for (const e of st.drainEvents()) if (e.type === 'conquer' && e.from === PLAYER && firstContact < 0) firstContact = ms;
    if (ms % 60_000 === 0) snaps.push(st.factions.map((f) => (f.alive ? f.tiles : '✝')).join('/'));
  }
  const t = Math.round(st.gameTimeMs / 1000);
  console.log(`run ${r}: ${st.over ?? 'vivo'} a ${t}s, primo attacco subito ${firstContact < 0 ? '-' : Math.round(firstContact / 1000) + 's'} | caselle per minuto ${snaps.join('  ')}`);
}
