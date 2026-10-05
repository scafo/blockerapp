// Verifica applyRunResult (fine campagna) con alcuni casi di base.
// Uso: npx vite-node scripts/check-progress.ts
import { BALANCE } from '../src/config/balance';
import { applyRunResult } from '../src/game/progress';
import { freshProfile } from '../src/save/storage';
import { emptyBag } from '../src/game/resources';
import type { RunSummary } from '../src/game/RunState';

const sum = (over: Partial<RunSummary>): RunSummary => ({
  seed: 'abc123', outcome: 'victory', timeMs: 600_000, maxTiles: 400, maxProvinces: 12,
  backpack: emptyBag(), kept: emptyBag(), stake: emptyBag(), gainMult: 1, feePct: 0, stakeLossPct: 0,
  tutorial: false, civ: 'republica', campaign: 'standard', front: 0, ...over,
});

let fails = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
  if (!ok) fails++;
};

// 1. vittoria: wins++, runs++
{
  const p = freshProfile();
  applyRunResult(p, sum({ outcome: 'victory' }), Date.now());
  check('vittoria: runs=1 wins=1', p.runs === 1 && p.wins === 1);
}

// 2. ritirata: runs++ ma non wins
{
  const p = freshProfile();
  applyRunResult(p, sum({ outcome: 'retreat' }), Date.now());
  check('ritirata: runs=1 wins=0', p.runs === 1 && p.wins === 0);
}

// 3. eliminato: runs++ ma non wins, niente sblocco fronte
{
  const p = freshProfile();
  const { unlocked } = applyRunResult(p, sum({ outcome: 'eliminated' }), Date.now());
  check('eliminato: runs=1 wins=0 nessuno sblocco', p.runs === 1 && p.wins === 0 && unlocked === -1);
}

// 4. nuovo fronte sbloccato: vittoria sull'ultimo fronte sbloccato (frontMax 0, gioco il fronte 0)
{
  const p = freshProfile();
  p.frontMax = 0;
  const { unlocked } = applyRunResult(p, sum({ outcome: 'victory', front: 0 }), Date.now());
  check('nuovo fronte: sblocca il successivo', unlocked === 1 && p.frontMax === 1 && p.front === 1);
}

// 4b. vittoria su un fronte già non all'avanguardia: nessuno sblocco
{
  const p = freshProfile();
  p.frontMax = 2;
  const { unlocked } = applyRunResult(p, sum({ outcome: 'victory', front: 0 }), Date.now());
  check('vittoria su fronte già superato: nessuno sblocco', unlocked === -1 && p.frontMax === 2);
}

// 5. Deposito pieno: bottino oltre la capienza va perso (lostCap > 0)
{
  const p = freshProfile();
  const cap = BALANCE.camp.depositoCap[0];
  const { lostCap } = applyRunResult(p, sum({ outcome: 'victory', kept: { metallo: cap * 2, benzina: 0, cibo: 0 } }), Date.now());
  check('deposito pieno: bottino in eccesso perso', lostCap > 0 && p.stash.metallo === cap);
}

// 6. primo miglioramento garantito: run guidata con zaino vuoto deve comunque bastare per Comando liv.1
{
  const p = freshProfile();
  const need = BALANCE.camp.buildings.comando[0].cost;
  applyRunResult(p, sum({ outcome: 'timeout', tutorial: true, kept: emptyBag() }), Date.now());
  const ok = p.stash.metallo >= need.metallo && p.stash.benzina >= need.benzina && p.stash.cibo >= need.cibo;
  check('run guidata: basta per Comando liv.1', ok);
}

// 7. record: bestProvinces e bestTiles salgono, mai scendono
{
  const p = freshProfile();
  applyRunResult(p, sum({ outcome: 'victory', maxTiles: 500, maxProvinces: 20 }), Date.now());
  applyRunResult(p, sum({ outcome: 'victory', maxTiles: 100, maxProvinces: 5 }), Date.now());
  check('record: non scendono mai', p.bestTiles === 500 && p.bestProvinces === 20);
}

console.log(fails ? `\n${fails} caso/i falliti` : '\ntutti i casi passano');
process.exit(fails ? 1 : 0);
