// Generazione del mondo da seed: terreni (simplex-noise per latitudine), catene montuose, fiumi, Zone della Caduta,
// bottino sparso, province con flood fill, città e partenza. Stesso seed = stessa mappa (serve per la Rivincita).
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { BALANCE, T, TERRAINS, type Terrain } from '../config/balance';
import names from '../data/provinces.json';
import { COLS, N, NB, colOf, lonLat, rowOf } from './grid';
import { createRng, randInt, type Rng } from './rng';

export interface Province {
  id: number;
  name: string;
  city: number; // casella della città
  cells: number[]; // caselle attraversabili della provincia
  value: number;
  loot: number; // bottino totale nelle sue caselle
  cx: number; // baricentro in caselle (per il nome)
  cy: number;
}

/** Vista per casella come da specifica (la griglia vera è fatta di array tipizzati, molto più leggeri). */
export interface Cell {
  terrain: Terrain;
  provinceId: number;
  owner: number;
  defense: number;
  loot: number;
  isCity: boolean;
  isRiver: boolean;
}

export interface World {
  seed: string;
  terrain: Uint8Array; // codice T[...]; T.mare = 0
  river: Uint8Array;
  province: Int16Array; // −1 = nessuna (mare, Caduta)
  owner: Int8Array; // −1 = neutrale
  defense: Float32Array;
  loot: Uint8Array;
  city: Uint8Array;
  provinces: Province[];
  start: number;
}

export const NEUTRAL = -1;
export const passable = (w: World, i: number) => w.terrain[i] !== T.mare && w.terrain[i] !== T.caduta;

export function cellOf(w: World, i: number): Cell {
  return {
    terrain: TERRAINS[w.terrain[i]] as Terrain,
    provinceId: w.province[i], owner: w.owner[i], defense: w.defense[i], loot: w.loot[i], isCity: !!w.city[i], isRiver: !!w.river[i],
  };
}

const fbm = (n: NoiseFunction2D, x: number, y: number) => n(x, y) * 0.6 + n(x * 2, y * 2) * 0.3 + n(x * 4, y * 4) * 0.1;

/** 1 dentro [a, b], scende a 0 entro `soft` gradi fuori dalla fascia. */
const band = (v: number, [a, b]: [number, number], soft: number) => (v >= a && v <= b ? 1 : Math.max(0, 1 - Math.min(Math.abs(v - a), Math.abs(v - b)) / soft));

export function generateWorld(seed: string, mask: Uint8Array): World {
  const G = BALANCE.generation;
  const rng = createRng(seed);
  const terrain = new Uint8Array(N);
  const river = new Uint8Array(N);
  const loot = new Uint8Array(N);
  const nBase = createNoise2D(rng), nForest = createNoise2D(rng), nRidge = createNoise2D(rng), nMask = createNoise2D(rng);
  const land: number[] = [];

  // 1. terreni: fasce di latitudine spostate dal noise, catene montuose dal noise "a cresta"
  for (let i = 0; i < N; i++) {
    if (!mask[i]) continue;
    land.push(i);
    const c = colOf(i), r = rowOf(i), lat = Math.abs(lonLat(i)[1]);
    const ridge = 1 - Math.abs(fbm(nRidge, c * G.mountainScale, r * G.mountainScale));
    if (ridge > G.mountainRidge && nMask(c * G.mountainScale * 0.5, r * G.mountainScale * 0.5) > G.mountainMask) {
      terrain[i] = T.montagna;
      continue;
    }
    const desert = band(lat, G.desertBand, G.bandSoftness) + fbm(nBase, c * G.noiseScale, r * G.noiseScale) * G.noiseWeight;
    const forest = Math.max(...G.forestBands.map((b) => band(lat, b, G.bandSoftness)))
      + fbm(nForest, c * G.noiseScale, r * G.noiseScale) * G.noiseWeight;
    terrain[i] = desert > G.threshold && desert >= forest ? T.deserto : forest > G.threshold ? T.foresta : T.pianura;
  }

  // 2. fiumi: dalle montagne verso il mare seguendo la distanza dalla costa (con qualche ansa)
  const seaDist = new Int16Array(N).fill(-1);
  const q: number[] = [];
  for (let i = 0; i < N; i++) if (!mask[i]) { seaDist[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) {
    const cur = q[h];
    for (let k = 0; k < 4; k++) {
      const n = NB[cur * 4 + k];
      if (n >= 0 && seaDist[n] < 0) { seaDist[n] = seaDist[cur] + 1; q.push(n); }
    }
  }
  const sources = land.filter((i) => terrain[i] === T.montagna && seaDist[i] >= 8);
  const nRivers = randInt(rng, G.rivers[0], G.rivers[1]);
  for (let k = 0; k < nRivers && sources.length; k++) {
    let cur = sources.splice(Math.floor(rng() * sources.length), 1)[0];
    let dir = -1;
    for (let step = 0; step < G.riverMaxLength && seaDist[cur] > 0; step++) {
      river[cur] = 1;
      // scende verso il mare; ogni tanto scorre in piano (anse), preferisce tenere la direzione
      const down: number[] = [], flat: number[] = [];
      for (let d = 0; d < 4; d++) {
        const n = NB[cur * 4 + d];
        if (n < 0 || seaDist[n] < 0 || river[n]) continue;
        if (seaDist[n] < seaDist[cur]) down.push(d);
        else if (seaDist[n] === seaDist[cur]) flat.push(d);
      }
      const opts = flat.length && rng() < G.riverMeander ? flat : down.length ? down : flat;
      if (!opts.length) break;
      const d = opts.includes(dir) && rng() < 0.3 ? dir : opts[Math.floor(rng() * opts.length)];
      dir = d;
      const next = NB[cur * 4 + d];
      if (!mask[next]) break; // arrivato al mare
      cur = next;
    }
  }

  // 3. Zone della Caduta: macchie bloccate
  const nZones = randInt(rng, G.cadutaZones[0], G.cadutaZones[1]);
  for (let k = 0; k < nZones; k++) {
    const c0 = land[Math.floor(rng() * land.length)];
    const rad = randInt(rng, G.cadutaRadius[0], G.cadutaRadius[1]);
    const cx = colOf(c0), cy = rowOf(c0);
    for (let dy = -rad - 2; dy <= rad + 2; dy++) {
      for (let dx = -rad - 2; dx <= rad + 2; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || x >= COLS || y < 0 || y * COLS >= N) continue;
        const i = y * COLS + x;
        const wobble = 0.75 + 0.5 * ((nBase(x * 0.3 + k * 17, y * 0.3) + 1) / 2);
        if (mask[i] && Math.hypot(dx, dy) <= rad * wobble) {
          terrain[i] = T.caduta;
          river[i] = 0;
        }
      }
    }
  }

  // 4. bottino sparso; nelle Zone della Caduta è raro ma ricco
  const C = BALANCE.caduta;
  for (const i of land) {
    if (terrain[i] === T.caduta) { if (rng() < C.lootChance) loot[i] = randInt(rng, C.loot[0], C.loot[1]); }
    else if (rng() < G.lootChance) loot[i] = randInt(rng, G.loot[0], G.loot[1]);
  }

  const w: World = {
    seed, terrain, river, loot, province: new Int16Array(N).fill(-1), owner: new Int8Array(N).fill(NEUTRAL),
    defense: new Float32Array(N), city: new Uint8Array(N), provinces: [], start: -1,
  };
  buildProvinces(w, rng, land);
  computeDefense(w);
  w.start = pickStart(w, rng, land);
  return w;
}

/** Province: semi distanziati, flood fill a turni (crescono insieme), piccole unite alla vicina più piccola. */
function buildProvinces(w: World, rng: Rng, land: number[]) {
  const P = BALANCE.provinces;
  const cells = land.filter((i) => passable(w, i));
  const order = [...cells].sort(() => rng() - 0.5);
  const near = new Uint8Array(N); // aree già vicine a un seme
  const prov = w.province;
  const members: number[][] = [];
  const queues: number[][] = [];
  const addSeed = (s: number) => {
    prov[s] = members.length;
    members.push([s]);
    queues.push([s]);
  };
  for (const s of order) {
    if (near[s]) continue;
    addSeed(s);
    const c = colOf(s), r = rowOf(s);
    for (let dy = -P.seedSpacing; dy <= P.seedSpacing; dy++) {
      for (let dx = -P.seedSpacing; dx <= P.seedSpacing; dx++) {
        const x = c + dx, y = r + dy;
        if (x >= 0 && x < COLS && y >= 0 && y * COLS < N) near[y * COLS + x] = 1;
      }
    }
  }
  const grow = () => {
    let active = true;
    while (active) {
      active = false;
      for (let p = 0; p < queues.length; p++) {
        const qu = queues[p];
        if (!qu.length || members[p].length >= P.maxCells) continue;
        const cur = qu.shift()!;
        for (let k = 0; k < 4; k++) {
          const n = NB[cur * 4 + k];
          if (n >= 0 && prov[n] < 0 && passable(w, n) && members[p].length < P.maxCells) {
            prov[n] = p;
            members[p].push(n);
            qu.push(n);
          }
        }
        active = true;
      }
    }
  };
  grow();
  // caselle rimaste fuori (province piene, isolette): nuovi semi
  for (const i of cells) if (prov[i] < 0) { addSeed(i); grow(); }

  // unisci le province troppo piccole alla vicina più piccola (se c'è e non diventa enorme)
  for (let p = 0; p < members.length; p++) {
    if (!members[p].length || members[p].length >= P.minCells) continue;
    const adj = new Set<number>();
    for (const i of members[p]) for (let k = 0; k < 4; k++) {
      const n = NB[i * 4 + k];
      if (n >= 0 && prov[n] >= 0 && prov[n] !== p) adj.add(prov[n]);
    }
    let best = -1;
    for (const a of adj) if (best < 0 || members[a].length < members[best].length) best = a;
    if (best < 0) continue; // isoletta: resta piccola
    if (members[best].length + members[p].length <= P.maxCells + 10) {
      for (const i of members[p]) prov[i] = best;
      members[best].push(...members[p]);
      members[p] = [];
      continue;
    }
    // altrimenti si spartisce casella per casella tra le province confinanti
    let rest = members[p], moved = true;
    while (rest.length && moved) {
      moved = false;
      const keep: number[] = [];
      for (const i of rest) {
        let to = -1;
        for (let k = 0; k < 4 && to < 0; k++) { const n = NB[i * 4 + k]; if (n >= 0 && prov[n] >= 0 && prov[n] !== p) to = prov[n]; }
        if (to < 0) { keep.push(i); continue; }
        prov[i] = to;
        members[to].push(i);
        moved = true;
      }
      rest = keep;
    }
    members[p] = rest;
  }

  // numerazione compatta, nomi, città, valore
  const N_ = names as { nomi: string[]; prefissi: string[] };
  const pool = [...N_.nomi].sort(() => rng() - 0.5);
  const used = new Set<string>();
  const nextName = () => {
    for (let tries = 0; tries < 200; tries++) {
      const base = pool[Math.floor(rng() * pool.length)];
      const name = used.size < pool.length && !used.has(base) ? base : `${N_.prefissi[Math.floor(rng() * N_.prefissi.length)]} ${base}`;
      if (!used.has(name)) { used.add(name); return name; }
    }
    return `Provincia ${used.size + 1}`;
  };
  for (const m of members) {
    if (!m.length) continue;
    const id = w.provinces.length;
    let sx = 0, sy = 0;
    for (const i of m) { prov[i] = id; sx += colOf(i); sy += rowOf(i); }
    const cx = sx / m.length, cy = sy / m.length;
    // città: la casella più vicina al baricentro (meglio se non montagna né fiume)
    let city = m[0], best = Infinity;
    for (const i of m) {
      const d = Math.hypot(colOf(i) - cx, rowOf(i) - cy) + (w.terrain[i] === T.montagna || w.river[i] ? 3 : 0);
      if (d < best) { best = d; city = i; }
    }
    w.city[city] = 1;
    let value = BALANCE.cities.value, loot = 0;
    for (const i of m) loot += w.loot[i];
    for (const i of m) value += terrainStats(w.terrain[i]).value + (w.river[i] ? BALANCE.river.value : 0) + w.loot[i];
    w.provinces.push({ id, name: nextName(), city, cells: m, value: Math.round(value), loot, cx, cy });
  }
}

/** Difesa = truppe per prendere la casella: base × terreno × città, diviso l'attacco attraverso il fiume. */
function computeDefense(w: World) {
  for (let i = 0; i < N; i++) {
    if (!passable(w, i)) continue;
    w.defense[i] = BALANCE.baseDefense * terrainStats(w.terrain[i]).defense * (w.city[i] ? BALANCE.cities.defense : 1) / (w.river[i] ? BALANCE.river.attack : 1);
  }
}


export const terrainStats = (t: number) => BALANCE.terrain[(TERRAINS[t] === 'mare' || TERRAINS[t] === 'caduta' ? 'pianura' : TERRAINS[t]) as 'pianura'];
/** Velocità di conquista della casella (moltiplicatore). */
export const cellSpeed = (w: World, i: number) => terrainStats(w.terrain[i]).speed * (w.river[i] ? BALANCE.river.speed : 1);

/** Partenza: pianura o foresta in una massa di terra grande, lontana dalle Zone della Caduta. */
function pickStart(w: World, rng: Rng, land: number[]): number {
  const comp = new Int32Array(N).fill(-1);
  const sizes: number[] = [];
  for (const s of land) {
    if (comp[s] >= 0 || !passable(w, s)) continue;
    const id = sizes.length;
    const st = [s];
    comp[s] = id;
    let n = 0;
    while (st.length) {
      const c = st.pop()!;
      n++;
      for (let k = 0; k < 4; k++) {
        const nb = NB[c * 4 + k];
        if (nb >= 0 && comp[nb] < 0 && passable(w, nb)) { comp[nb] = id; st.push(nb); }
      }
    }
    sizes.push(n);
  }
  const ok = land.filter((i) => (w.terrain[i] === T.pianura || w.terrain[i] === T.foresta) && !w.city[i] && sizes[comp[i]] >= BALANCE.start.minLandmass);
  return ok[Math.floor(rng() * ok.length)];
}
