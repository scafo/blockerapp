// Prova del lockstep: gioca 8 minuti con ordini casuali, poi rigioca la partita dal solo registro dei comandi e confronta
// l'impronta ogni 10 s. Se si separano, il motore dipende da qualcosa che non passa dai comandi.
// Uso: npx vite-node scripts/lockstep-check.ts
import { loadWorld } from '../src/map/worldAsset';
import { generateMap } from '../src/map/generate';
import { RunState, PLAYER } from '../src/game/RunState';
import { BALANCE } from '../src/config/balance';
import { DEFAULT_OPTIONS, type RunOptions } from '../src/game/camp';
import { BASE_MODS } from '../src/game/mods';
import { createRng } from '../src/map/rng';
const world = loadWorld();
const mk = () => {
  const opts = { ...DEFAULT_OPTIONS, front: BALANCE.fronts[0], frontIndex: 0, mods: { ...BASE_MODS }, endMs: 9 * 60_000 } as RunOptions;
  const st = new RunState(generateMap('rp1', world, undefined, undefined, opts.front.aiDistance), opts);
  st.backpack.metallo = st.backpack.benzina = st.backpack.cibo = 5000;
  return st;
};
const a = mk(), rnd = createRng('cmds');
const hashes: number[] = [];
let dep = 0, con = 0, died = 0; const why: Record<string, number> = {};
while (!a.over && a.gameTimeMs < 8 * 60_000) {
  if (rnd() < 0.05) {
    const fr = a.frontier(PLAYER);
    if (fr.length) { const r = a.exec({ k: 'conquer', tile: a.map.provinces[fr[Math.floor(rnd() * fr.length)]].anchor }); if (r.ok) con++; else why[r.reason] = (why[r.reason] ?? 0) + 1; }
  }
  if (rnd() < 0.04) {
    const t = a.freeTileIn(a.capitalProv[PLAYER]);
    if (t !== null) { const u = a.exec({ k: 'deploy', type: 'fanteria', tile: t }); if (u) dep++; }
  }
  if (rnd() < 0.03) { const us0 = a.unitsOf(PLAYER); if (us0.length && rnd() < 0.3) a.exec({ k: 'stance', units: us0.map((u) => u.id), stance: 'attacca' });
    const us = a.unitsOf(PLAYER), fr = a.frontier(PLAYER);
    if (us.length && fr.length) a.exec({ k: 'move', units: us.map((u) => u.id), to: a.map.provinces[fr[Math.floor(rnd() * fr.length)]].anchor });
  }
  a.step();
  died += a.drainEvents().filter((e) => e.type === 'unitDied' && e.unit.owner === PLAYER).length;
  if (a.gameTimeMs % 10_000 === 0) hashes.push(a.hash());
}
const b = mk();
let k = 0, bad = -1;
const log = a.cmdLog;
while (b.gameTimeMs < a.gameTimeMs) {
  while (k < log.length && log[k].t === b.gameTimeMs) b.exec(log[k++].c, log[k - 1].by);
  b.step();
  if (b.gameTimeMs % 10_000 === 0 && b.hash() !== hashes[b.gameTimeMs / 10_000 - 1] && bad < 0) bad = b.gameTimeMs;
}
console.log({ dep, con, died, why }); console.log('t', a.gameTimeMs, a.over, Math.round(a.troops), a.frontier(PLAYER).length, 'cmds', log.length, 'provinces', a.player.provinces, 'units', a.unitsOf(PLAYER).length, 'hashA', a.hash(), 'hashB', b.hash(), bad < 0 ? 'IDENTICAL' : 'DIVERGED at ' + bad);
