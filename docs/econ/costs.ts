// Somma costi e tempi di postazioni e ricerche (scratch).
import { BALANCE } from '../../src/config/balance';
const B = BALANCE.camp.buildings as Record<string, { cost: Record<string, number>; timeSec: number }[]>;
const tot = (c: Record<string, number>) => c.metallo + c.benzina + c.cibo;
let all = { m: 0, b: 0, c: 0, t: 0 };
for (const [id, lv] of Object.entries(B)) {
  let s = { m: 0, b: 0, c: 0, t: 0 };
  lv.forEach((l, i) => {
    console.log(`${id} L${i + 1}: ${l.cost.metallo}/${l.cost.benzina}/${l.cost.cibo} = ${tot(l.cost)}  ${l.timeSec / 60} min  ratio cost ${i ? (tot(l.cost) / tot(lv[i - 1].cost)).toFixed(2) : '-'} time ${i ? (l.timeSec / lv[i - 1].timeSec).toFixed(2) : '-'}`);
    s.m += l.cost.metallo; s.b += l.cost.benzina; s.c += l.cost.cibo; s.t += l.timeSec;
  });
  console.log(`  TOT ${id}: ${s.m}/${s.b}/${s.c} = ${s.m + s.b + s.c}, ${(s.t / 60).toFixed(0)} min`);
  all.m += s.m; all.b += s.b; all.c += s.c; all.t += s.t;
}
console.log(`EDIFICI: ${all.m}/${all.b}/${all.c} = ${all.m + all.b + all.c}, ${(all.t / 60).toFixed(0)} min`);
let T = { m: 0, b: 0, c: 0, t: 0 };
for (const [id, t] of Object.entries(BALANCE.tech)) {
  T.m += t.cost.metallo; T.b += t.cost.benzina; T.c += t.cost.cibo; T.t += t.timeSec;
  console.log(`tech ${id} (${t.branch} ${t.arsenale ? 'ars' + t.arsenale : 'lab' + t.tier}): ${tot(t.cost)} ${t.timeSec / 60} min`);
}
console.log(`RICERCHE (${Object.keys(BALANCE.tech).length}): ${T.m}/${T.b}/${T.c} = ${T.m + T.b + T.c}, ${(T.t / 60).toFixed(0)} min`);
console.log(`TOTALE: metallo ${all.m + T.m}, benzina ${all.b + T.b}, cibo ${all.c + T.c} = ${all.m + all.b + all.c + T.m + T.b + T.c}; tempo ${((all.t + T.t) / 3600).toFixed(2)} h`);
