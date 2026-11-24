// Legge docs/econ/out/*.jsonl e calcola bottino a casa per fronte, durata, puntata ed esito (formula di RunState.summary).
import fs from 'node:fs';
const dir = new URL('./out/', import.meta.url);
const rows = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(new URL(f, dir), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const FR = [1, 1.3, 1.7, 2.2, 2.8, 3.5], CL = { 10: 0.7, 20: 1, 30: 1.4 };
const STAKE = [0, 60, 180, 450], MULT = [1, 1.25, 1.6, 2];
const keptOf = (r, s, opts = {}) => {
  const exitFee = 0.25, elim = opts.elim ?? 0.7, lossShare = opts.lossShare ?? 0.25;
  const S = STAKE[s], m = MULT[s], clm = CL[r.minutes] * FR[r.front];
  const k = r.outcome === 'victory' ? 1.5 : r.outcome === 'timeout' ? 1 : r.outcome === 'retreat' ? 1 - exitFee : 1 - elim;
  const sk = r.outcome === 'timeout' && S > 0 ? 1 - lossShare : 1;
  const L = r.raw; // bottino guadagnato (puntata non spesa)
  return (S * sk + L * m * clm) * k - S; // profitto netto rispetto al Deposito prima della partenza
};
const groups = {};
for (const r of rows) (groups[`F${r.front + 1} liv${r.level} ${r.minutes}min`] ??= []).push(r);
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
console.log('gruppo | n | vittorie | raw medio (min-max) | bagMix m/b/c | prov | impero15 | a casa senza puntata | profitto netto puntata 60/180/450');
for (const [g, rs] of Object.entries(groups).sort()) {
  const wins = rs.filter((r) => r.outcome === 'victory').length;
  const raw = rs.map((r) => r.raw);
  const mix = ['m', 'b', 'c'].map((k) => Math.round(avg(rs.map((r) => r.rawBag[k] / Math.max(1, r.raw))) * 100)).join('/');
  const base = avg(rs.map((r) => keptOf(r, 0)));
  const st = [1, 2, 3].map((s) => Math.round(avg(rs.map((r) => keptOf(r, s))) - base));
  console.log(`${g} | ${rs.length} | ${wins}/${rs.length} | ${Math.round(avg(raw))} (${Math.min(...raw)}-${Math.max(...raw)}) | ${mix} | ${Math.round(avg(rs.map((r) => r.maxProv)))} | ${rs.map((r) => r.emp15).join(',')} | ${Math.round(base)} | +${st.join(' / +')}`);
}
console.log('\nbottino cumulato per minuto (media, F1 20 min):');
const f1 = rows.filter((r) => r.front === 0 && r.minutes === 20);
const n = Math.max(...f1.map((r) => r.perMin.length));
console.log(Array.from({ length: n }, (_, i) => Math.round(avg(f1.map((r) => r.perMin[i] ?? r.raw)))).join(' '));
console.log('\nesiti:', rows.map((r) => `F${r.front + 1}L${r.level}/${r.minutes}:${r.outcome[0]}@${r.t}s raw${r.raw}`).join('  '));
