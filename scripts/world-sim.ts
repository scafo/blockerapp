// Simula il mondo senza giocatore attivo: quanta terra resta libera e quante milizie restano in vita nel tempo.
// Uso: npx vite-node scripts/world-sim.ts [run] [fronte]
import { loadWorld } from '../src/map/worldAsset';
import { generateMap } from '../src/map/generate';
import { RunState } from '../src/game/RunState';
import { hexDistance } from '../src/map/hexGrid';
import { BALANCE } from '../src/config/balance';
import { DEFAULT_OPTIONS, type RunOptions } from '../src/game/camp';
import { BASE_MODS } from '../src/game/mods';

const runs = Number(process.argv[2] ?? 2), front = Number(process.argv[3] ?? 0);
const world = loadWorld();
const marks = [1, 2, 3, 5, 8, 12, 20].map((m) => m * 60_000);
for (let r = 0; r < runs; r++) {
  const opts: RunOptions = { ...DEFAULT_OPTIONS, front: BALANCE.fronts[front], frontIndex: front, mods: { ...BASE_MODS }, endMs: 21 * 60_000 } as RunOptions;
  const st = new RunState(generateMap('w' + r, world, undefined, undefined, opts.front.aiDistance), opts);
  const el = (st as any).eliminate.bind(st); // il giocatore passivo non conta: si guarda solo il mondo
  (st as any).eliminate = (f: number, by: number) => (f === 0 ? undefined : el(f, by));
  const land = st.map.provinces.filter((p) => p.tiles.length).length;
  // la zona che il giocatore vede in partita: province entro 70 passi dalla sua partenza
  const zone = st.map.provinces.map((p, q) => q).filter((q) => st.map.provinces[q].tiles.length && hexDistance(st.map.provinces[q].anchor, st.map.starts[0]) <= 70);
  const out: string[] = [];
  for (let ms = 0, k = 0; k < marks.length && !st.over; ms += 100) {
    st.update(100);
    if (ms >= marks[k]) {
      const free = st.map.provinces.filter((p, q) => p.tiles.length && st.provOwner[q] === -1).length;
      const bots = st.factions.filter((f) => f.kind === 'bot' && f.alive);
      const emp = st.factions.filter((f) => f.kind === 'empire').map((f) => (f.alive ? f.provinces : '✝')).join('/');
      const zfree = zone.filter((q) => st.provOwner[q] === -1).length;
      out.push(`${marks[k] / 60_000}m libera ${Math.round((100 * free) / land)}% (zona ${Math.round((100 * zfree) / zone.length)}% di ${zone.length}) milizie ${bots.length} (med ${bots.length ? Math.round(bots.reduce((a, f) => a + f.provinces, 0) / bots.length) : 0}) imperi ${emp}`);
      k++;
    }
  }
  console.log(`run ${r} (${land} province) over=${st.over} t=${Math.round(st.gameTimeMs/1000)}s:\n  ` + out.join('\n  '));
}
