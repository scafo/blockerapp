// Modello del percorso del giocatore (scratch): giorni di gioco con sessioni fisse, bottino per campagna dalla sim,
// spesa avida su postazioni e ricerche, timer reali con 1 cantiere + 1 laboratorio, capienza del Deposito.
// Uso: node docs/econ/journey.mjs [current|proposed] [campagne/giorno dal giorno 2] [verbose]
// I costi "current" sono copiati da src/config/balance.ts (23/11/2026).
const which = process.argv[2] ?? 'current';
const perDay = Number(process.argv[3] ?? 2);
const verbose = process.argv[4] === 'v';

// ---------- dati attuali ----------
const CUR = {
  buildings: {
    comando: [[30, 0, 15, 1], [90, 20, 40, 3], [200, 60, 80, 5], [340, 120, 140, 10], [480, 200, 200, 20]],
    arsenale: [[40, 10, 0, 1], [120, 40, 0, 3], [250, 90, 0, 5], [380, 160, 40, 10], [520, 240, 80, 20], [700, 320, 140, 30]],
    deposito: [[50, 0, 20, 1.5], [140, 0, 60, 4], [260, 60, 120, 5]],
    laboratorio: [[60, 30, 20, 1.5], [150, 70, 50, 4], [280, 120, 100, 5]],
    radar: [[40, 20, 0, 1], [110, 50, 0, 3], [220, 90, 0, 5]],
  },
  // id: [m, b, c, minuti, ars, tier, req]
  tech: {
    ricognitori: [30, 10, 0, 0.75, 1, 0, []], artiglieria: [60, 20, 0, 1.5, 2, 0, ['ricognitori']], corazzati: [120, 50, 0, 2.5, 3, 0, ['artiglieria']],
    munizioni: [140, 40, 0, 3, 3, 0, ['corazzati']], ricognizione: [180, 100, 0, 4, 5, 0, ['munizioni']], bombardamento: [240, 140, 0, 5, 5, 0, ['ricognizione']],
    unica: [300, 160, 60, 6, 6, 0, ['bombardamento', 'corazze']], genio: [90, 20, 20, 2, 3, 0, ['artiglieria']], cannoniera: [160, 80, 0, 3.33, 4, 0, ['genio']],
    corazze: [200, 60, 20, 4, 4, 0, ['cannoniera']],
    addestramento: [40, 20, 20, 2, 0, 1, []], elite: [110, 50, 40, 4, 0, 2, ['addestramento']], assalto: [220, 90, 80, 6, 0, 3, ['elite']],
    strade: [40, 30, 10, 2, 0, 1, []], rifornimenti: [80, 40, 70, 4, 0, 2, ['strade']], ferrovie: [200, 120, 60, 6, 0, 3, ['rifornimenti']],
    estrazione: [30, 20, 30, 2, 0, 1, []], industria: [120, 40, 40, 4, 0, 2, ['estrazione']], pianificazione: [160, 80, 120, 5, 0, 3, ['industria']],
    trincee: [50, 10, 20, 2, 0, 1, []], radar: [100, 60, 20, 4, 0, 2, ['trincee']], fortezze: [240, 60, 40, 5, 0, 3, ['radar']],
    segnale: [30, 30, 30, 2.5, 0, 1, []], frammenti: [90, 60, 50, 4, 0, 2, ['segnale']], prototipo: [180, 100, 80, 5, 0, 3, ['frammenti']], caduta: [300, 160, 120, 5, 0, 3, ['prototipo']],
  },
  cap: [500, 1000, 2000, 4000],
  frontLoot: [1, 1.3, 1.7, 2.2, 2.8, 3.5],
  stakeOpts: () => [0, 60, 180, 450], stakeMult: [1, 1.25, 1.6, 2],
  stakeRule: 'current',
  exped: { breve: [30, 0, 35], media: [240, 15, 170], lunga: [480, 30, 330] }, expedScale: false,
  rendita: 0, firstWin: 0,
};

// ---------- proposta ----------
const scaleBuilding = (rows, totals, mins) => rows.map((r, i) => {
  const t = r[0] + r[1] + r[2];
  return [Math.round(r[0] / t * totals[i]), Math.round(r[1] / t * totals[i]), Math.round(r[2] / t * totals[i]), mins[i]];
});
const KF = Number(process.env.K ?? 1); const K = (x, i) => i === 0 ? x : Math.round(x * KF / 10) * 10;
const PRO = { ...CUR, tech: Object.fromEntries(Object.entries(CUR.tech).map(([k, v]) => [k, [...v]])) };
PRO.buildings = {
  comando: scaleBuilding(CUR.buildings.comando, [45, 400, 2000, 6000, 15000].map(K), [1, 15, 120, 480, 1440]),
  arsenale: scaleBuilding(CUR.buildings.arsenale, [50, 300, 1500, 5000, 13000, 30000].map(K), [1, 10, 60, 240, 720, 1440]),
  deposito: scaleBuilding(CUR.buildings.deposito, [70, 1200, 7000].map(K), [2, 60, 480]),
  laboratorio: scaleBuilding(CUR.buildings.laboratorio, [110, 1500, 9000].map(K), [2, 60, 720]),
  radar: scaleBuilding(CUR.buildings.radar, [60, 800, 4500].map(K), [1, 45, 360]),
};
// ricerche: costo e tempo scalati per grado (tier del Laboratorio o livello dell'Arsenale richiesto)
const techScale = (ars, tier) => {
  const g = (ars ? [0, 4, 8, 15, 25, 40, 55][ars] : [0, 4, 15, 40][tier]) * (KF);
  const tm = ars ? [0, 20, 20, 48, 72, 120, 160][ars] : [0, 15, 45, 96][tier];
  return [g, tm];
};
for (const [id, t] of Object.entries(PRO.tech)) {
  const [g, tm] = techScale(t[4], t[5]);
  PRO.tech[id] = [Math.round(t[0] * g), Math.round(t[1] * g), Math.round(t[2] * g), Math.round(t[3] * tm), t[4], t[5], t[6]];
}
PRO.cap = [1500, 5000, 12000, 30000].map((x) => x * Math.max(1, KF));
PRO.frontLoot = (process.env.FL ?? '1,1.25,1.5,1.8,2.1,2.5').split(',').map(Number);
PRO.stakeOpts = (f) => [0, 180, 450, 900].map((x) => Math.round(x * PRO.frontLoot[f]));
PRO.stakeMult = [1, 1.1, 1.25, 1.5];
PRO.stakeRule = 'proposed';
PRO.exped = { breve: [30, 0, 150], media: [240, 60, 600], lunga: [480, 120, 1100] };
PRO.expedScale = true;
PRO.rendita = 60; // risorse/ora × fronte, tetto 12 h
PRO.firstWin = 0.5; // prima vittoria del giorno: +50% sul bottino guadagnato

const C = which === 'proposed' ? PRO : CUR;

// ---------- giocatore ----------
const POWER = { arsenale: 8, comando: 6, laboratorio: 4, deposito: 3, radar: 2, tech: 3 };
const NEED = which === 'proposed' ? [0, 30, 60, 100, 140, 170] : [0, 50, 70, 130, 200, 230]; // potenza a cui il giocatore della sim vince ~65% (calibrata su docs/econ/out)
const RAW = 1800; // bottino grezzo medio di una campagna standard (sim, F1 20 min), simile su tutti i fronti
const DEP_LOSS = [0.7, 0.4, 0.25, 0.25];
const STAKE_INS = [0, 0.1, 0.2, 0.3]; // proposta: il Deposito assicura la puntata

let rng = 12345;
const rand = () => ((rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648);
const p = { stash: { m: 45, b: 0, c: 15 }, b: { comando: 0, arsenale: 0, deposito: 0, laboratorio: 0, radar: 0 }, techs: new Set(), front: 0, frontMax: 0,
  build: null, research: null, exp: null, lostCap: 0, earned: 0, spent: 0, buildIdle: 0, lastWinDay: -1, renditaAt: 0, campaigns: 0, wins: 0 };
const power = () => Object.entries(p.b).reduce((s, [k, v]) => s + v * POWER[k], 0) + p.techs.size * POWER.tech;
const winP = (f) => Math.max(0.05, Math.min(0.85, 0.6 + (power() - NEED[f]) / 80));
const cap = () => C.cap[p.b.deposito];
const add = (bag) => { for (const k of ['m', 'b', 'c']) { const v = p.stash[k] + bag[k]; const keep = Math.min(v, Math.max(cap(), p.stash[k])); p.lostCap += v - keep; p.stash[k] = keep; } };
const afford = (c) => p.stash.m >= c[0] && p.stash.b >= c[1] && p.stash.c >= c[2];
const pay = (c) => { p.stash.m -= c[0]; p.stash.b -= c[1]; p.stash.c -= c[2]; p.spent += c[0] + c[1] + c[2]; };
const log = [];
const ev = (t, s) => { log.push([t, s]); if (verbose) console.log(fmt(t), s); };
const fmt = (t) => `g${Math.floor(t / 1440) + 1} ${String(Math.floor((t % 1440) / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function settle(t) {
  if (p.build && p.build.until <= t) { p.b[p.build.id]++; ev(p.build.until, `${p.build.id} L${p.b[p.build.id]}`); p.buildFree = p.build.until; p.build = null; }
  if (p.research && p.research.until <= t) { p.techs.add(p.research.id); ev(p.research.until, `ricerca ${p.research.id} (${p.techs.size})`); p.research = null; }
  if (p.exp && p.exp.until <= t) { add(p.exp.bag); p.earned += p.exp.bag.m + p.exp.bag.b + p.exp.bag.c; p.exp = null; }
}
function spend(t) {
  // cantiere: prima il Comando se si può, altrimenti l'upgrade più economico permesso
  if (!p.build) {
    const opts = Object.keys(p.b).filter((id) => C.buildings[id][p.b[id]] && (id === 'comando' || p.b[id] < p.b.comando + 1))
      .map((id) => ({ id, row: C.buildings[id][p.b[id]] })).filter((o) => afford(o.row));
    const pick = opts.find((o) => o.id === 'comando') ?? opts.sort((a, b) => a.row[0] + a.row[1] + a.row[2] - (b.row[0] + b.row[1] + b.row[2]))[0];
    if (pick) { pay(pick.row); p.build = { id: pick.id, until: t + pick.row[3] }; if (p.buildFree !== undefined) p.buildIdle += t - p.buildFree; }
  }
  if (!p.research) {
    const opts = Object.entries(C.tech).filter(([id, r]) => !p.techs.has(id) && r[6].every((q) => p.techs.has(q))
      && (r[4] ? p.b.arsenale >= r[4] : p.b.laboratorio >= r[5]) && afford(r)).sort((a, b) => a[1][0] + a[1][1] + a[1][2] - (b[1][0] + b[1][1] + b[1][2]));
    if (opts.length) { pay(opts[0][1]); p.research = { id: opts[0][0], until: t + opts[0][1][3] }; }
  }
}
function expedition(t, kind) {
  if (p.exp) return;
  const [min, cost, tot] = C.exped[kind];
  if (p.stash.c < cost) return;
  p.stash.c -= cost;
  const k = C.expedScale ? C.frontLoot[p.frontMax] : 1;
  const n = tot * k * (0.85 + rand() * 0.3);
  p.exp = { until: t + min * (p.techs.has('estrazione') ? 0.75 : 1), bag: { m: n * 0.6, b: n * 0.2, c: n * 0.2 } };
}
function campaign(t, day) {
  // fronte: il più alto sbloccato se si vince almeno 4 volte su 10, altrimenti uno più basso
  let f = p.frontMax;
  while (f > 0 && winP(f) < 0.4) f--;
  const pw = winP(f);
  const opts = C.stakeOpts(f);
  // puntata: con le regole attuali conviene sempre la più alta; con la proposta solo se si vince almeno 4 volte su 10
  let s = 0;
  for (let k = opts.length - 1; k > 0; k--) {
    const n = Math.floor(opts[k] / 3);
    if (p.stash.m >= n && p.stash.b >= n && p.stash.c >= n && (C.stakeRule === 'current' || pw >= 0.5)) { s = k; break; }
  }
  const S = Math.floor(opts[s] / 3) * 3;
  p.stash.m -= S / 3; p.stash.b -= S / 3; p.stash.c -= S / 3;
  const r = rand();
  const outcome = r < pw ? 'v' : r < pw + (1 - pw) * 0.85 ? 't' : 'e';
  const L = RAW * (outcome === 'v' ? 1.15 : outcome === 't' ? 0.85 : 0.3) * C.frontLoot[f] * (0.8 + rand() * 0.4);
  let kept;
  if (C.stakeRule === 'current') {
    const k = outcome === 'v' ? 1.5 : outcome === 't' ? 1 : 1 - DEP_LOSS[p.b.deposito];
    kept = (S * (outcome === 't' && S ? 0.75 : 1) + L * C.stakeMult[s]) * k;
  } else {
    const ins = STAKE_INS[p.b.deposito];
    const first = outcome === 'v' && p.lastWinDay !== day ? 1 + C.firstWin : 1;
    kept = outcome === 'v' ? S + L * 1.5 * C.stakeMult[s] * first
      : outcome === 't' ? S * ins + L
        : S * ins + L * (1 - DEP_LOSS[p.b.deposito]);
  }
  if (outcome === 'v') p.lastWinDay = day;
  p.campaigns++;
  if (outcome === 'v') p.wins++;
  p.earned += kept - S;
  add({ m: kept * 0.48, b: kept * 0.22, c: kept * 0.30 }); // mix del bottino misurato (sim: 43–58% metallo)
  if (outcome === 'v' && f === p.frontMax && p.frontMax < 5 && (which !== 'proposed' || p.b.comando >= p.frontMax + 1)) { p.frontMax++; ev(t + 20, `FRONTE ${p.frontMax + 1} sbloccato`); }
  if (verbose) console.log(fmt(t), `campagna F${f + 1} p=${pw.toFixed(2)} puntata ${S} → ${outcome} a casa ${Math.round(kept)} potenza ${power()}`);
}

// ---------- calendario ----------
const DAYS = 60;
const snap = (d) => console.log(`  fine giorno ${d}: potenza ${power()}, Comando ${p.b.comando}, Arsenale ${p.b.arsenale}, Lab ${p.b.laboratorio}, Deposito ${p.b.deposito}, Radar ${p.b.radar}, ricerche ${p.techs.size}/26, fronte max ${p.frontMax + 1}, campagne ${p.campaigns} (vinte ${p.wins}), guadagnato ${Math.round(p.earned)}, perso per capienza ${Math.round(p.lostCap)}`);
for (let day = 0; day < DAYS; day++) {
  if ([1, 3, 7, 14, 30].includes(day)) snap(day);
  const base = day * 1440;
  // giorno 1: run guidata + 4 campagne di fila dalle 18:00; poi due campagne (8:00 e 20:00) e un controllo alle 13:00
  const sessions = day === 0 ? [[1080, 4]] : perDay >= 2 ? [[480, 1], [780, 0], [1200, perDay - 1]] : [[1200, perDay]];
  for (const [min, n] of sessions) {
    let t = base + min;
    if (C.rendita) {
      const h = Math.min(12, (t - p.renditaAt) / 60);
      const g = C.rendita * h * C.frontLoot[p.frontMax];
      if (p.renditaAt) { add({ m: g * 0.5, b: g * 0.25, c: g * 0.25 }); p.earned += g; }
      p.renditaAt = t;
    }
    settle(t); spend(t);
    for (let i = 0; i < n; i++) {
      campaign(t, day); t += 23; settle(t); spend(t);
    }
    expedition(t, min >= 1080 ? 'lunga' : min >= 700 ? 'breve' : 'media');
  }
}
settle(DAYS * 1440);
const milestones = log.filter(([, s]) => /comando|FRONTE|arsenale L6/.test(s));
const totalB = Object.values(C.buildings).flat().reduce((s, r) => s + r[0] + r[1] + r[2], 0);
const totalT = Object.values(C.tech).reduce((s, r) => s + r[0] + r[1] + r[2], 0);
const timeB = Object.values(C.buildings).flat().reduce((s, r) => s + r[3], 0);
const timeT = Object.values(C.tech).reduce((s, r) => s + r[3], 0);
console.log(`== ${which}, ${perDay} campagne/giorno dal giorno 2 ==`);
console.log(`contenuto: postazioni ${totalB} (${(timeB / 60).toFixed(1)} h), ricerche ${totalT} (${(timeT / 60).toFixed(1)} h), totale ${totalB + totalT}`);
for (const [t, s] of milestones) console.log(`  ${fmt(t)}  ${s}`);
const doneB = log.find(([, s]) => s === 'arsenale L6'), allT = log.find(([, s]) => s.includes(`(${Object.keys(C.tech).length})`));
console.log(`  tutte le ricerche: ${allT ? fmt(allT[0]) : 'no'} · potenza finale ${power()} · campagne ${p.campaigns} (vinte ${p.wins})`);
console.log(`  guadagnato ${Math.round(p.earned)}, speso ${Math.round(p.spent)}, perso per Deposito pieno ${Math.round(p.lostCap)}, scorta finale ${Math.round(p.stash.m)}/${Math.round(p.stash.b)}/${Math.round(p.stash.c)}`);
// potenza per giorno
const byDay = [];
console.log(`  (log eventi: ${log.length})`);
export {};
if (process.env.PRINT) {
  for (const [id, rows] of Object.entries(C.buildings)) console.log(id, rows.map((r, i) => `L${i + 1} ${r[0]}/${r[1]}/${r[2]} ${r[3] >= 60 ? (r[3] / 60) + 'h' : r[3] + 'm'}`).join(' · '));
  for (const [id, r] of Object.entries(C.tech)) console.log('tech', id, `${r[0]}/${r[1]}/${r[2]} = ${r[0] + r[1] + r[2]}`, r[3] >= 60 ? (r[3] / 60).toFixed(1) + 'h' : r[3] + 'm');
  console.log('cap', C.cap, 'frontLoot', C.frontLoot);
}
