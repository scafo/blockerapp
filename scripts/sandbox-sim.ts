// Mondo della sandbox senza giocatore attivo: quanta terra resta libera, quante milizie e quanti imperi restano nel tempo.
// Obiettivo (Nico, 26 novembre 2026): entro 5 minuti la carta è tutta presa, i 25 imperi si mangiano le milizie.
// Uso: npx vite-node scripts/sandbox-sim.ts [run]
import { loadWorld, preloadWorld } from '../src/map/worldAsset';
import { REGIONS, setRegion, type MapId } from '../src/map/region';
import { generateMap } from '../src/map/generate';
import { RunState, NEUTRAL } from '../src/game/RunState';
import { BALANCE } from '../src/config/balance';
import { DEFAULT_OPTIONS, type RunOptions } from '../src/game/camp';
import { BASE_MODS } from '../src/game/mods';

const runs = Number(process.argv[2] ?? 1);
// carta: MAP=europa / america (default mondo)
const MAP = (process.env.MAP ?? 'world') as MapId;
await preloadWorld(MAP);
setRegion(MAP);
const world = loadWorld();
const fill = REGIONS[MAP].provinces / REGIONS.world.provinces;
const marks = (process.env.MARKS ?? "1,3,5,8,10,15,20,30,45,60").split(",").map(Number).map((m) => m * 60_000);
for (let r = 0; r < runs; r++) {
  const sandbox = { troops: 500, resources: 200, front: 0, minutes: 30, civ: 'republica', units: ['fanteria'], level: 0, speed: 1, doctrine: 'none', map: MAP };
  const opts = { ...DEFAULT_OPTIONS, sandbox, front: BALANCE.difficulty[0], frontIndex: 0, mods: { ...BASE_MODS }, endMs: 90 * 60_000 } as unknown as RunOptions;
  const t0 = Date.now();
  const map = generateMap('s' + r, world, Math.round(BALANCE.ai.sandboxCount * fill), Math.round(BALANCE.bots.sandboxCount * fill), opts.front.aiDistance, true);
  const st = new RunState(map, opts);
  const el = (st as any).eliminate.bind(st); // il giocatore passivo non conta: si guarda solo il mondo
  (st as any).eliminate = (f: number, by: number) => (f === 0 ? undefined : el(f, by));
  const P = st.map.provinces;
  const first = P.findIndex((p, q) => p.anchor >= 0 && p.neighbors.length >= 5 && st.provOwner[q] === NEUTRAL);
  st.exec({ k: 'place', p: first });
  const land = P.filter((p) => p.tiles.length).length;
  const out: string[] = [];
  let stepMs = 0;
  for (let ms = 0, k = 0; k < marks.length && !st.over; ms += 100) {
    const a = performance.now();
    st.update(100);
    stepMs += performance.now() - a;
    if (ms >= marks[k]) {
      const free = P.filter((p, q) => p.tiles.length && st.provOwner[q] === NEUTRAL).length;
      const bots = st.factions.filter((f) => f.kind === 'bot' && f.alive);
      const emp = st.factions.filter((f) => f.kind === 'empire' && f.alive).map((f) => f.provinces).sort((x, y) => y - x);
      const mega = st.factions.filter((f) => st.isMega(f.id)).map((f) => (f.alive ? f.provinces : 0)).join('/');
      out.push(`${marks[k] / 60_000}m libera ${Math.round((100 * free) / land)}% milizie ${bots.length} imperi ${emp.length} (max ${emp[0] ?? 0}, med ${emp[emp.length >> 1] ?? 0}, min ${emp[emp.length - 1] ?? 0}) fortissimi ${mega} unità ${st.units.length} passo ${(stepMs / (marks[k] / 100)).toFixed(2)} ms`);
      k++;
    }
  }
  console.log(`run ${r} (${land} province, ${Math.round((Date.now() - t0) / 1000)} s):\n  ` + out.join('\n  '));
}
