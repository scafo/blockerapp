// Pianta di una stanza dell'HQ (pagine delle stanze, Nico: "una pagina per ogni coso, più belle, a tema e dettagliate").
// Stesso linguaggio della planimetria della base: ardesia, filo avorio, corsivo verde acqua, tratteggio per ciò che non
// c'è ancora. Ogni stanza ha i suoi arredi (tavolo cartografico, consolle, vasca del Frammento, schermo radar, rastrelliere,
// scaffali, brande...), ognuno sbloccato da un livello: quelli già costruiti sono a filo pieno, i prossimi tratteggiati.
// Niente scritte (Nico: troppo testo): solo il disegno e qualche luce che vive (spie, scansione del radar, il Lume);
// i nomi degli arredi restano nei dati come promemoria.
import Phaser from 'phaser';
import { PALETTE } from '../config/palette';
import { drawResourceIcon } from './resourceIcons';
import { drawUnitIcon } from './unitIcons';
import { dashedBox, italic } from './schematic';
import type { Resource, UnitType } from '../config/balance';

const INK = PALETTE.carta, SLATE = PALETTE.inchiostro, TEAL = PALETTE.ocra, AMBER = PALETTE.allerta, RED = PALETTE.ruggine, LUME = PALETTE.radioattivo;

export type RoomId = 'comando' | 'laboratorio' | 'radar' | 'arsenale' | 'deposito' | 'spedizione' | 'alloggi' | 'archivio' | 'mercato'
  | 'fronte' | 'cantiere' | 'ricerca';

/** Stato della stanza che la pianta mostra (livello e i numeri che cambiano gli arredi). */
export interface RoomState {
  lvl: number;
  building?: boolean; // cantiere aperto su questa stanza
  /** riempimento 0..1 per risorsa (deposito) */
  fill?: Partial<Record<Resource, number>>;
  /** posti letto occupati (alloggi), frammenti trovati (archivio), mezzi fuori (estrazione: 1 = in missione) */
  count?: number;
  /** reparti sbloccati (arsenale) */
  units?: UnitType[];
}

type Kind = 'mapTable' | 'screens' | 'consoles' | 'desk' | 'cabinets' | 'vault' | 'chamber' | 'benches' | 'tubes' | 'scope' | 'mast'
  | 'racks' | 'vehicles' | 'crates' | 'shelves' | 'barrels' | 'bunks' | 'trucks' | 'crane' | 'counter' | 'board' | 'lockers' | 'generator';

/** Arredo: dove sta (frazioni della stanza), da che livello c'è, come si chiama nella legenda. */
interface Fix { k: Kind; x: number; y: number; w: number; h: number; lvl: number; name: string; n?: number; res?: Resource; vertical?: boolean }

const ROOMS: Record<RoomId, { code: string; size: string; fix: Fix[] }> = {
  comando: { code: 'C-01', size: '18,40 × 12,60 m', fix: [
    { k: 'screens', x: 0.12, y: 0.03, w: 0.76, h: 0.09, lvl: 1, name: 'Parete degli schermi', n: 6 },
    { k: 'mapTable', x: 0.3, y: 0.27, w: 0.4, h: 0.36, lvl: 1, name: 'Tavolo cartografico' },
    { k: 'consoles', x: 0.04, y: 0.2, w: 0.12, h: 0.52, lvl: 2, name: 'Postazioni radio', n: 4, vertical: true },
    { k: 'consoles', x: 0.84, y: 0.2, w: 0.12, h: 0.52, lvl: 3, name: 'Telex e cifrari', n: 4, vertical: true },
    { k: 'board', x: 0.22, y: 0.7, w: 0.2, h: 0.08, lvl: 4, name: 'Lavagna dei reparti' },
    { k: 'desk', x: 0.44, y: 0.78, w: 0.2, h: 0.12, lvl: 1, name: 'Scrivania del comandante' },
    { k: 'vault', x: 0.76, y: 0.78, w: 0.18, h: 0.16, lvl: 5, name: 'Sala blindata' },
    { k: 'cabinets', x: 0.04, y: 0.8, w: 0.16, h: 0.12, lvl: 2, name: 'Archivio degli ordini', n: 4 },
  ] },
  laboratorio: { code: 'L-02', size: '14,20 × 10,80 m', fix: [
    { k: 'chamber', x: 0.38, y: 0.26, w: 0.24, h: 0.34, lvl: 1, name: 'Camera del Frammento' },
    { k: 'benches', x: 0.05, y: 0.12, w: 0.24, h: 0.16, lvl: 1, name: 'Banchi di analisi' },
    { k: 'benches', x: 0.05, y: 0.38, w: 0.24, h: 0.16, lvl: 2, name: 'Banchi di sintesi' },
    { k: 'tubes', x: 0.72, y: 0.12, w: 0.23, h: 0.2, lvl: 1, name: 'Campioni del Lume', n: 12 },
    { k: 'consoles', x: 0.7, y: 0.42, w: 0.26, h: 0.14, lvl: 2, name: 'Calcolatori a schede', n: 3 },
    { k: 'generator', x: 0.06, y: 0.68, w: 0.2, h: 0.22, lvl: 3, name: 'Schermatura del Progetto Caduta' },
    { k: 'desk', x: 0.4, y: 0.74, w: 0.2, h: 0.12, lvl: 1, name: 'Tavolo del direttore' },
    { k: 'lockers', x: 0.72, y: 0.72, w: 0.24, h: 0.16, lvl: 3, name: 'Camere di contenimento', n: 4 },
  ] },
  radar: { code: 'R-03', size: '12,00 × 12,00 m', fix: [
    { k: 'scope', x: 0.3, y: 0.18, w: 0.4, h: 0.48, lvl: 1, name: 'Schermo panoramico' },
    { k: 'consoles', x: 0.06, y: 0.12, w: 0.18, h: 0.5, lvl: 1, name: 'Operatori di ascolto', n: 3, vertical: true },
    { k: 'mast', x: 0.78, y: 0.08, w: 0.16, h: 0.2, lvl: 1, name: 'Albero d\'antenna' },
    { k: 'cabinets', x: 0.76, y: 0.38, w: 0.18, h: 0.22, lvl: 2, name: 'Nastri delle registrazioni', n: 3 },
    { k: 'board', x: 0.28, y: 0.76, w: 0.3, h: 0.08, lvl: 1, name: 'Registro delle campagne' },
    { k: 'mast', x: 0.06, y: 0.72, w: 0.14, h: 0.18, lvl: 3, name: 'Seconda antenna' },
    { k: 'consoles', x: 0.66, y: 0.72, w: 0.28, h: 0.14, lvl: 2, name: 'Tracciatori di rotta', n: 3 },
  ] },
  arsenale: { code: 'A-04', size: '22,60 × 11,20 m', fix: [
    { k: 'racks', x: 0.04, y: 0.08, w: 0.3, h: 0.14, lvl: 1, name: 'Rastrelliere della fanteria', n: 8 },
    { k: 'racks', x: 0.04, y: 0.3, w: 0.3, h: 0.14, lvl: 2, name: 'Pezzi d\'artiglieria', n: 5 },
    { k: 'vehicles', x: 0.42, y: 0.06, w: 0.54, h: 0.36, lvl: 3, name: 'Rimessa dei corazzati', n: 3 },
    { k: 'crates', x: 0.04, y: 0.56, w: 0.22, h: 0.3, lvl: 1, name: 'Casse sigillate', n: 9 },
    { k: 'crane', x: 0.34, y: 0.5, w: 0.3, h: 0.4, lvl: 4, name: 'Gru di carico' },
    { k: 'board', x: 0.7, y: 0.52, w: 0.26, h: 0.08, lvl: 5, name: 'Piani di volo' },
    { k: 'vault', x: 0.74, y: 0.68, w: 0.22, h: 0.22, lvl: 6, name: 'Hangar della potenza' },
  ] },
  deposito: { code: 'D-05', size: '20,00 × 10,40 m', fix: [
    { k: 'shelves', x: 0.05, y: 0.08, w: 0.26, h: 0.62, lvl: 0, name: 'Scaffali del metallo', res: 'metallo', n: 6 },
    { k: 'barrels', x: 0.37, y: 0.08, w: 0.26, h: 0.62, lvl: 0, name: 'Fusti di benzina', res: 'benzina', n: 6 },
    { k: 'shelves', x: 0.69, y: 0.08, w: 0.26, h: 0.62, lvl: 0, name: 'Dispensa del cibo', res: 'cibo', n: 6 },
    { k: 'crates', x: 0.05, y: 0.78, w: 0.18, h: 0.14, lvl: 1, name: 'Casse di riserva', n: 4 },
    { k: 'desk', x: 0.4, y: 0.78, w: 0.2, h: 0.14, lvl: 1, name: 'Banco del quartiermastro' },
    { k: 'vault', x: 0.76, y: 0.76, w: 0.19, h: 0.18, lvl: 2, name: 'Caveau del bottino' },
  ] },
  spedizione: { code: 'E-06', size: '24,00 × 9,60 m', fix: [
    { k: 'trucks', x: 0.04, y: 0.1, w: 0.6, h: 0.42, lvl: 0, name: 'Rimessa dei mezzi', n: 3 },
    { k: 'board', x: 0.7, y: 0.1, w: 0.26, h: 0.1, lvl: 0, name: 'Carta delle zone spente' },
    { k: 'barrels', x: 0.7, y: 0.28, w: 0.26, h: 0.24, lvl: 0, name: 'Taniche di scorta', n: 3 },
    { k: 'crates', x: 0.04, y: 0.66, w: 0.26, h: 0.24, lvl: 0, name: 'Bottino da smistare', n: 6 },
    { k: 'lockers', x: 0.38, y: 0.68, w: 0.28, h: 0.2, lvl: 0, name: 'Armadietti delle squadre', n: 5 },
    { k: 'desk', x: 0.74, y: 0.7, w: 0.2, h: 0.14, lvl: 0, name: 'Ufficio partenze' },
  ] },
  alloggi: { code: 'H-07', size: '16,80 × 8,40 m', fix: [
    { k: 'bunks', x: 0.04, y: 0.1, w: 0.92, h: 0.34, lvl: 0, name: 'Brande', n: 7 },
    { k: 'lockers', x: 0.04, y: 0.56, w: 0.4, h: 0.14, lvl: 0, name: 'Armadietti', n: 7 },
    { k: 'desk', x: 0.52, y: 0.58, w: 0.22, h: 0.16, lvl: 0, name: 'Mensa' },
    { k: 'board', x: 0.8, y: 0.58, w: 0.16, h: 0.1, lvl: 0, name: 'Turni di guardia' },
    { k: 'generator', x: 0.04, y: 0.78, w: 0.14, h: 0.16, lvl: 0, name: 'Stufa' },
  ] },
  archivio: { code: 'X-08', size: '10,20 × 10,20 m', fix: [
    { k: 'vault', x: 0.06, y: 0.08, w: 0.18, h: 0.22, lvl: 1, name: 'Frammento I' },
    { k: 'vault', x: 0.3, y: 0.08, w: 0.18, h: 0.22, lvl: 2, name: 'Frammento II' },
    { k: 'vault', x: 0.54, y: 0.08, w: 0.18, h: 0.22, lvl: 3, name: 'Frammento III' },
    { k: 'vault', x: 0.78, y: 0.08, w: 0.18, h: 0.22, lvl: 4, name: 'Frammento IV' },
    { k: 'cabinets', x: 0.06, y: 0.44, w: 0.3, h: 0.18, lvl: 0, name: 'Schedari dell\'Anno Zero', n: 5 },
    { k: 'desk', x: 0.42, y: 0.46, w: 0.22, h: 0.16, lvl: 0, name: 'Tavolo di lettura' },
    { k: 'cabinets', x: 0.7, y: 0.44, w: 0.26, h: 0.18, lvl: 0, name: 'Intercettazioni trascritte', n: 4 },
    { k: 'chamber', x: 0.4, y: 0.7, w: 0.2, h: 0.24, lvl: 4, name: 'Il Segnale' },
  ] },
  mercato: { code: 'M-09', size: '15,00 × 9,00 m', fix: [
    { k: 'counter', x: 0.06, y: 0.1, w: 0.88, h: 0.2, lvl: 0, name: 'Banco degli scambi' },
    { k: 'shelves', x: 0.06, y: 0.42, w: 0.24, h: 0.42, lvl: 0, name: 'Metallo in conto', res: 'metallo', n: 4 },
    { k: 'barrels', x: 0.38, y: 0.42, w: 0.24, h: 0.42, lvl: 0, name: 'Benzina in conto', res: 'benzina', n: 4 },
    { k: 'shelves', x: 0.7, y: 0.42, w: 0.24, h: 0.42, lvl: 0, name: 'Viveri in conto', res: 'cibo', n: 4 },
  ] },
  fronte: { code: 'O-10', size: 'sala operazioni', fix: [
    { k: 'mapTable', x: 0.12, y: 0.14, w: 0.76, h: 0.5, lvl: 0, name: 'Carta del fronte' },
    { k: 'screens', x: 0.12, y: 0.03, w: 0.76, h: 0.07, lvl: 0, name: 'Bollettini', n: 4 },
    { k: 'consoles', x: 0.12, y: 0.74, w: 0.36, h: 0.14, lvl: 0, name: 'Collegamenti col fronte', n: 3 },
    { k: 'board', x: 0.56, y: 0.76, w: 0.32, h: 0.1, lvl: 0, name: 'Ordine di battaglia' },
  ] },
  cantiere: { code: 'K-11', size: 'cortile dei lavori', fix: [
    { k: 'crane', x: 0.3, y: 0.08, w: 0.4, h: 0.5, lvl: 0, name: 'Gru' },
    { k: 'crates', x: 0.05, y: 0.1, w: 0.2, h: 0.3, lvl: 0, name: 'Materiali', n: 6 },
    { k: 'barrels', x: 0.76, y: 0.1, w: 0.2, h: 0.26, lvl: 0, name: 'Calce e bitume', n: 4 },
    { k: 'board', x: 0.06, y: 0.72, w: 0.4, h: 0.1, lvl: 0, name: 'Piano dei lavori' },
    { k: 'trucks', x: 0.54, y: 0.66, w: 0.4, h: 0.26, lvl: 0, name: 'Mezzi del cantiere', n: 2 },
  ] },
  ricerca: { code: 'L-02b', size: 'sala dei progetti', fix: [
    { k: 'board', x: 0.08, y: 0.06, w: 0.84, h: 0.12, lvl: 0, name: 'Lavagna dei rami' },
    { k: 'benches', x: 0.08, y: 0.3, w: 0.36, h: 0.18, lvl: 0, name: 'Prototipi' },
    { k: 'tubes', x: 0.56, y: 0.28, w: 0.36, h: 0.22, lvl: 0, name: 'Campioni', n: 10 },
    { k: 'chamber', x: 0.4, y: 0.6, w: 0.2, h: 0.3, lvl: 0, name: 'Il Lume sotto studio' },
    { k: 'consoles', x: 0.08, y: 0.66, w: 0.26, h: 0.16, lvl: 0, name: 'Calcolatori', n: 2 },
  ] },
};


/**
 * Disegna la pianta della stanza nel riquadro (x, y, w, h). Restituisce gli oggetti creati (da distruggere chiudendo la pagina).
 */
export function drawRoom(scene: Phaser.Scene, id: RoomId, x: number, y: number, w: number, h: number, st: RoomState): Phaser.GameObjects.GameObject[] {
  const R = ROOMS[id], out: Phaser.GameObjects.GameObject[] = [];
  const g = scene.add.graphics();
  out.push(g);
  // legenda: due colonne in fondo
  // stanza: margine attorno, muri spessi (niente quote, sigle né legenda: la pianta parla da sola)
  const m = 22, rx = x + m, ry = y + m, rw = w - 2 * m, rh = h - 2 * m;
  const wall = 5;
  // pavimento: griglia di piastrelle a puntini
  for (let gx = rx + 14; gx < rx + rw - 6; gx += 18) for (let gy = ry + 14; gy < ry + rh - 6; gy += 18) g.fillStyle(INK, 0.12).fillRect(gx, gy, 1.5, 1.5);
  // muri: doppio filo con il vuoto in mezzo, porta in basso al centro con l'arco d'apertura
  const door = Math.min(46, rw * 0.12), dx = rx + rw / 2 - door / 2;
  g.lineStyle(1.6, INK, 0.95);
  g.beginPath(); g.moveTo(dx, ry + rh); g.lineTo(rx, ry + rh); g.lineTo(rx, ry); g.lineTo(rx + rw, ry); g.lineTo(rx + rw, ry + rh); g.lineTo(dx + door, ry + rh); g.strokePath();
  g.lineStyle(1, INK, 0.6);
  g.beginPath(); g.moveTo(dx, ry + rh - wall); g.lineTo(rx + wall, ry + rh - wall); g.lineTo(rx + wall, ry + wall); g.lineTo(rx + rw - wall, ry + wall); g.lineTo(rx + rw - wall, ry + rh - wall); g.lineTo(dx + door, ry + rh - wall); g.strokePath();
  for (let i = 0; i < rw; i += 6) if (i % 18 < 6) g.fillStyle(INK, 0.25).fillRect(rx + i, ry + 1.5, 2, 2); // tratteggio nel muro (sezione)
  g.lineStyle(1, INK, 0.7).lineBetween(dx, ry + rh, dx, ry + rh - door).beginPath();
  g.arc(dx, ry + rh, door, -Math.PI / 2, 0, false).strokePath();
  // finestre a feritoia sui lati
  for (const fy of [0.3, 0.7]) {
    g.fillStyle(SLATE, 1).fillRect(rx - 1, ry + rh * fy - 10, wall + 2, 20).lineStyle(1, INK, 0.8).strokeRect(rx - 1, ry + rh * fy - 10, wall + 2, 20).lineBetween(rx + wall / 2, ry + rh * fy - 10, rx + wall / 2, ry + rh * fy + 10);
    g.fillStyle(SLATE, 1).fillRect(rx + rw - wall - 1, ry + rh * fy - 10, wall + 2, 20).lineStyle(1, INK, 0.8).strokeRect(rx + rw - wall - 1, ry + rh * fy - 10, wall + 2, 20);
  }
  // arredi
  R.fix.forEach((f) => {
    const fx = rx + wall + 6 + f.x * (rw - 2 * wall - 12), fy = ry + wall + 6 + f.y * (rh - 2 * wall - 12);
    const fw = f.w * (rw - 2 * wall - 12), fh = f.h * (rh - 2 * wall - 12);
    // archivio: un vano per frammento trovato; deposito/mercato: sempre; altri: dal loro livello
    const on = id === 'archivio' && f.k === 'vault' ? (st.count ?? 0) >= f.lvl : id === 'archivio' && f.k === 'chamber' ? (st.count ?? 0) >= f.lvl : st.lvl >= f.lvl;
    const next = !on && (id === 'archivio' ? (st.count ?? 0) + 1 === f.lvl : st.lvl + 1 === f.lvl);
    if (!on) {
      dashedBox(g, fx, fy, fw, fh, next && st.building ? AMBER : INK, next ? 0.75 : 0.35);
      out.push(scene.add.text(fx + fw / 2, fy + fh / 2, id === 'archivio' ? '?' : `liv. ${f.lvl}`, italic(9, next ? (st.building ? AMBER : TEAL) : PALETTE.tenue)).setOrigin(0.5).setAlpha(fw > 34 ? 1 : 0));
    } else out.push(...fixture(scene, g, f, fx, fy, fw, fh, st, id));
  });

  return out;
}

/** Un arredo a filo pieno (con le sue luci animate). */
function fixture(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics, f: Fix, x: number, y: number, w: number, h: number, st: RoomState, room: RoomId): Phaser.GameObjects.GameObject[] {
  const out: Phaser.GameObjects.GameObject[] = [];
  const blink = (bx: number, by: number, color: number, r = 1.8, delay = 0) => {
    const d = scene.add.circle(bx, by, r, color, 1);
    scene.tweens.add({ targets: d, alpha: 0.15, duration: 500 + ((bx * 7 + by * 3) % 700), delay, yoyo: true, repeat: -1 });
    out.push(d);
  };
  const solid = (bx: number, by: number, bw: number, bh: number, a = 1) => g.fillStyle(SLATE, 1).fillRect(bx, by, bw, bh).lineStyle(1.2, INK, a).strokeRect(bx, by, bw, bh);
  const n = f.n ?? 3;
  switch (f.k) {
    case 'mapTable': {
      solid(x, y, w, h);
      g.lineStyle(1, INK, 0.5).strokeRect(x + 6, y + 6, w - 12, h - 12);
      // la carta: tre masse di terra e la linea del fronte
      const land = [[0.12, 0.2, 0.3, 0.35], [0.5, 0.15, 0.35, 0.3], [0.3, 0.6, 0.45, 0.3]];
      for (const [a, b, c, d] of land) {
        const px = x + 6 + a * (w - 12), py = y + 6 + b * (h - 12), pw = c * (w - 12), ph = d * (h - 12);
        g.fillStyle(INK, 0.16).fillEllipse(px + pw / 2, py + ph / 2, pw, ph).lineStyle(1, INK, 0.5).strokeEllipse(px + pw / 2, py + ph / 2, pw, ph);
      }
      g.lineStyle(1.5, RED, 0.9);
      g.beginPath(); g.moveTo(x + w * 0.2, y + h * 0.75); g.lineTo(x + w * 0.45, y + h * 0.55); g.lineTo(x + w * 0.62, y + h * 0.62); g.lineTo(x + w * 0.82, y + h * 0.35); g.strokePath();
      // segnalini dei reparti e il tuo (pulsa)
      for (const [a, b] of [[0.3, 0.35], [0.6, 0.3], [0.7, 0.7]]) g.fillStyle(INK, 0.9).fillRect(x + a * w - 3, y + b * h - 2, 6, 4);
      blink(x + w * 0.42, y + h * 0.45, LUME, 3);
      // sedie attorno
      const chairs = Math.max(3, Math.round(w / 34));
      for (let i = 0; i < chairs; i++) {
        const cx = x + (w * (i + 0.5)) / chairs;
        g.lineStyle(1, INK, 0.7).strokeRect(cx - 5, y - 13, 10, 8).strokeRect(cx - 5, y + h + 5, 10, 8);
      }
      break;
    }
    case 'screens': {
      const sw = (w - (n - 1) * 4) / n;
      for (let i = 0; i < n; i++) {
        const sx = x + i * (sw + 4);
        solid(sx, y, sw, h);
        g.lineStyle(1, TEAL, 0.6).strokeRect(sx + 3, y + 3, sw - 6, h - 6);
        // traccia sullo schermo
        g.lineStyle(1, TEAL, 0.8);
        g.beginPath(); g.moveTo(sx + 4, y + h * 0.6);
        for (let k = 1; k <= 6; k++) g.lineTo(sx + 4 + ((sw - 8) * k) / 6, y + h * (0.3 + 0.4 * (((i * 7 + k * 5) % 9) / 9)));
        g.strokePath();
        blink(sx + sw - 6, y + 5, i % 3 ? TEAL : AMBER, 1.5, i * 150);
      }
      break;
    }
    case 'consoles': {
      const vert = !!f.vertical, len = vert ? h : w, cl = (len - (n - 1) * 6) / n;
      for (let i = 0; i < n; i++) {
        const cx = vert ? x : x + i * (cl + 6), cy = vert ? y + i * (cl + 6) : y, cw = vert ? w * 0.6 : cl, ch = vert ? cl : h * 0.6;
        solid(cx, cy, cw, ch);
        // tasti e spie
        for (let k = 0; k < 3; k++) g.fillStyle(INK, 0.6).fillRect(vert ? cx + cw - 7 : cx + 4 + k * 6, vert ? cy + 4 + k * 6 : cy + ch - 6, 3, 3);
        blink(vert ? cx + 5 : cx + cw - 5, vert ? cy + ch - 5 : cy + 5, i % 2 ? LUME : AMBER, 1.6, i * 230);
        // sedia davanti
        const sx = vert ? cx + cw + 8 : cx + cw / 2, sy = vert ? cy + ch / 2 : cy + ch + 8;
        g.lineStyle(1, INK, 0.75).strokeCircle(sx, sy, 4.5);
      }
      break;
    }
    case 'desk': {
      solid(x, y, w, h);
      g.lineStyle(1, INK, 0.5).lineBetween(x + 6, y + h * 0.35, x + w * 0.45, y + h * 0.35).lineBetween(x + 6, y + h * 0.55, x + w * 0.4, y + h * 0.55);
      g.lineStyle(1, INK, 0.8).strokeRect(x + w * 0.6, y + 4, w * 0.28, h * 0.45); // macchina da scrivere / radio
      blink(x + w * 0.74, y + h * 0.27, AMBER, 1.5);
      g.lineStyle(1, INK, 0.8).strokeCircle(x + w / 2, y + h + 9, 5);
      break;
    }
    case 'cabinets': case 'lockers': {
      const cw = (w - (n - 1) * 3) / n;
      for (let i = 0; i < n; i++) {
        const cx = x + i * (cw + 3);
        solid(cx, y, cw, h);
        const rows = f.k === 'cabinets' ? 3 : 1;
        for (let r = 1; r <= rows; r++) g.lineStyle(1, INK, 0.45).lineBetween(cx + 2, y + (h * r) / (rows + 1), cx + cw - 2, y + (h * r) / (rows + 1));
        if (f.k === 'lockers') g.fillStyle(INK, 0.7).fillRect(cx + cw - 4, y + h / 2 - 2, 2, 4);
      }
      break;
    }
    case 'vault': {
      g.fillStyle(SLATE, 1).fillRect(x, y, w, h).lineStyle(2.2, INK, 1).strokeRect(x, y, w, h).lineStyle(1, INK, 0.6).strokeRect(x + 4, y + 4, w - 8, h - 8);
      const r = Math.min(w, h) * 0.22;
      g.lineStyle(1.2, INK, 0.9).strokeCircle(x + w / 2, y + h / 2, r).lineBetween(x + w / 2 - r, y + h / 2, x + w / 2 + r, y + h / 2).lineBetween(x + w / 2, y + h / 2 - r, x + w / 2, y + h / 2 + r);
      if (room === 'archivio') blink(x + w / 2, y + h / 2, LUME, 3); // frammento custodito: il Lume
      break;
    }
    case 'chamber': {
      const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) / 2;
      g.lineStyle(2, INK, 1).strokeCircle(cx, cy, r).lineStyle(1, INK, 0.6).strokeCircle(cx, cy, r - 6);
      for (let a = 0; a < 8; a++) g.lineStyle(1, INK, 0.5).lineBetween(cx + Math.cos((a * Math.PI) / 4) * (r - 6), cy + Math.sin((a * Math.PI) / 4) * (r - 6), cx + Math.cos((a * Math.PI) / 4) * r, cy + Math.sin((a * Math.PI) / 4) * r);
      // il Frammento: nucleo di luce fredda che respira
      const glow = scene.add.circle(cx, cy, r * 0.45, LUME, 0.18);
      const core = scene.add.star(cx, cy, 4, r * 0.1, r * 0.3, LUME, 0.9);
      scene.tweens.add({ targets: glow, scale: 1.35, alpha: 0.05, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      scene.tweens.add({ targets: core, angle: 360, duration: 9000, repeat: -1 });
      out.push(glow, core);
      break;
    }
    case 'benches': {
      solid(x, y, w, h);
      const k = Math.max(3, Math.floor(w / 18));
      for (let i = 0; i < k; i++) {
        const bx = x + 8 + (i * (w - 16)) / (k - 1);
        if (i % 3 === 0) g.lineStyle(1, INK, 0.8).strokeRect(bx - 4, y + h / 2 - 4, 8, 8);
        else g.lineStyle(1, INK, 0.8).strokeCircle(bx, y + h / 2, 3.5);
      }
      blink(x + w - 7, y + 6, LUME, 1.6);
      break;
    }
    case 'tubes': {
      solid(x, y, w, h, 0.8);
      const cols = Math.ceil(n / 2), cw = (w - 10) / cols;
      for (let i = 0; i < n; i++) {
        const tx = x + 5 + cw * (i % cols) + cw / 2, ty = y + h * (i < cols ? 0.32 : 0.7);
        g.lineStyle(1, INK, 0.85).strokeCircle(tx, ty, Math.min(cw, h) * 0.18);
        if (i % 3 === 1) g.fillStyle(LUME, 0.8).fillCircle(tx, ty, Math.min(cw, h) * 0.09);
      }
      break;
    }
    case 'scope': {
      const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) / 2;
      g.fillStyle(SLATE, 1).fillCircle(cx, cy, r).lineStyle(2, INK, 1).strokeCircle(cx, cy, r);
      for (const k of [0.33, 0.66]) g.lineStyle(1, TEAL, 0.45).strokeCircle(cx, cy, r * k);
      g.lineStyle(1, TEAL, 0.35).lineBetween(cx - r, cy, cx + r, cy).lineBetween(cx, cy - r, cx, cy + r);
      for (let a = 0; a < 36; a++) {
        const L = a % 3 ? 3 : 6, an = (a * Math.PI) / 18;
        g.lineStyle(1, INK, 0.6).lineBetween(cx + Math.cos(an) * r, cy + Math.sin(an) * r, cx + Math.cos(an) * (r - L), cy + Math.sin(an) * (r - L));
      }
      // fascio che gira con la scia, e i contatti che si accendono quando ci passa sopra
      const sweep = scene.add.graphics({ x: cx, y: cy });
      for (let k = 0; k < 10; k++) sweep.fillStyle(LUME, 0.22 - k * 0.02).slice(0, 0, r - 2, -k * 0.07, -(k + 1) * 0.07, true).fillPath();
      sweep.lineStyle(1.5, LUME, 0.95).lineBetween(0, 0, r - 2, 0);
      scene.tweens.add({ targets: sweep, angle: 360, duration: 4200, repeat: -1 });
      out.push(sweep);
      for (const [a, d] of [[0.7, 0.55], [2.4, 0.8], [4.1, 0.35], [5.3, 0.7]]) {
        const b = scene.add.circle(cx + Math.cos(a) * r * d, cy + Math.sin(a) * r * d, 2.5, LUME, 1).setAlpha(0);
        scene.tweens.add({ targets: b, alpha: { from: 1, to: 0 }, duration: 1800, delay: (a / (Math.PI * 2)) * 4200, repeat: -1, repeatDelay: 2400 });
        out.push(b);
      }
      break;
    }
    case 'mast': {
      solid(x, y, w, h);
      g.lineStyle(1, INK, 0.7).lineBetween(x, y, x + w, y + h).lineBetween(x + w, y, x, y + h);
      g.lineStyle(1.2, INK, 0.9).strokeCircle(x + w / 2, y + h / 2, Math.min(w, h) * 0.28);
      blink(x + w / 2, y + h / 2, RED, 2.2);
      break;
    }
    case 'racks': {
      solid(x, y, w, h);
      for (let i = 0; i < n; i++) {
        const rx = x + 6 + (i * (w - 12)) / Math.max(1, n - 1);
        g.lineStyle(1.2, INK, 0.85).lineBetween(rx - 3, y + h - 4, rx + 3, y + 4);
      }
      break;
    }
    case 'vehicles': {
      const bw = (w - (n - 1) * 6) / n;
      const units = st.units ?? [];
      for (let i = 0; i < n; i++) {
        const bx = x + i * (bw + 6);
        g.lineStyle(1, INK, 0.6).strokeRect(bx, y, bw, h);
        for (let k = 0; k < bw; k += 8) g.fillStyle(AMBER, 0.5).fillRect(bx + k, y + h - 3, 4, 2); // strisce di sicurezza
        // carro: scafo, torretta, cannone
        const hx = bx + bw * 0.18, hy = y + h * 0.2, hw = bw * 0.64, hh = h * 0.6;
        solid(hx, hy, hw, hh);
        g.lineStyle(1, INK, 0.5).lineBetween(hx + 4, hy, hx + 4, hy + hh).lineBetween(hx + hw - 4, hy, hx + hw - 4, hy + hh);
        g.lineStyle(1.2, INK, 1).strokeCircle(hx + hw / 2, hy + hh / 2, Math.min(hw, hh) * 0.22).lineBetween(hx + hw / 2, hy + hh / 2 - Math.min(hw, hh) * 0.22, hx + hw / 2, y + 2);
      }
      // reparti sbloccati: simboli in fila sotto la rimessa
      units.slice(0, 8).forEach((u, i) => drawUnitIcon(g, u, x + 10 + i * 20, y + h + 12, 6, TEAL));
      break;
    }
    case 'crates': {
      const cols = Math.ceil(Math.sqrt(n * (w / Math.max(1, h)))), rows = Math.ceil(n / cols), cw = (w - (cols - 1) * 3) / cols, ch = (h - (rows - 1) * 3) / rows;
      for (let i = 0; i < n; i++) {
        const cx = x + (i % cols) * (cw + 3), cy = y + Math.floor(i / cols) * (ch + 3);
        solid(cx, cy, cw, ch, 0.9);
        g.lineStyle(1, INK, 0.45).lineBetween(cx, cy, cx + cw, cy + ch).lineBetween(cx + cw, cy, cx, cy + ch);
      }
      break;
    }
    case 'shelves': case 'barrels': {
      // scorte: quanto è pieno il deposito di quella risorsa (deposito) o una scorta fissa (altre stanze)
      const fill = f.res ? st.fill?.[f.res] ?? 0.6 : 0.7;
      const rows = n, rh = (h - (rows - 1) * 4) / rows, full = Math.round(fill * rows * 4);
      g.lineStyle(1, INK, 0.7).strokeRect(x, y, w, h);
      for (let r = 0; r < rows; r++) {
        const ry = y + r * (rh + 4);
        if (f.k === 'shelves') g.lineStyle(1, INK, 0.5).lineBetween(x, ry + rh + 2, x + w, ry + rh + 2);
        for (let c = 0; c < 4; c++) {
          const idx = (rows - 1 - r) * 4 + c, cx = x + 4 + (c * (w - 8)) / 4, cw = (w - 8) / 4 - 3;
          if (idx >= full) { if (f.k === 'shelves') g.lineStyle(1, INK, 0.2).strokeRect(cx, ry + 2, cw, rh - 4); continue; }
          if (f.k === 'barrels') g.fillStyle(SLATE, 1).fillCircle(cx + cw / 2, ry + rh / 2, Math.min(cw, rh) / 2 - 1).lineStyle(1, INK, 0.85).strokeCircle(cx + cw / 2, ry + rh / 2, Math.min(cw, rh) / 2 - 1);
          else solid(cx, ry + 2, cw, rh - 4, 0.85);
        }
      }
      if (f.res) drawResourceIcon(g, f.res, x + w / 2, y - 10, 6);
      break;
    }
    case 'bunks': {
      const total = n, used = Math.min(total, st.count ?? 0), bw = (w - (total - 1) * 6) / total;
      for (let i = 0; i < total; i++) {
        const bx = x + i * (bw + 6), on = i < used;
        if (on) { solid(bx, y, bw, h); g.lineStyle(1, INK, 0.6).strokeRect(bx + 3, y + 3, bw - 6, h * 0.16); g.lineStyle(1, INK, 0.35).lineBetween(bx + 3, y + h * 0.55, bx + bw - 3, y + h * 0.55); }
        else dashedBox(g, bx, y, bw, h, INK, 0.35);
      }
      break;
    }
    case 'trucks': {
      const bw = (w - (n - 1) * 8) / n, away = (st.count ?? 0) > 0;
      for (let i = 0; i < n; i++) {
        const bx = x + i * (bw + 8);
        g.lineStyle(1, INK, 0.6).strokeRect(bx, y, bw, h);
        for (let k = 0; k < bw; k += 8) g.fillStyle(AMBER, 0.5).fillRect(bx + k, y + h - 3, 4, 2);
        if (away && i < (room === 'spedizione' ? n : 1)) { out.push(scene.add.text(bx + bw / 2, y + h / 2, 'in missione', italic(9, AMBER)).setOrigin(0.5)); continue; }
        // camion visto dall'alto: cabina e cassone telonato
        const tx = bx + bw * 0.25, tw = bw * 0.5;
        solid(tx, y + h * 0.12, tw, h * 0.22);
        solid(tx, y + h * 0.38, tw, h * 0.5);
        for (let k = 1; k < 4; k++) g.lineStyle(1, INK, 0.4).lineBetween(tx + 2, y + h * 0.38 + (h * 0.5 * k) / 4, tx + tw - 2, y + h * 0.38 + (h * 0.5 * k) / 4);
      }
      break;
    }
    case 'crane': {
      const bx = x + w * 0.15, by = y + h * 0.85;
      g.lineStyle(1.2, INK, 1).strokeRect(bx - 8, by - 8, 16, 16).lineBetween(bx - 8, by - 8, bx + 8, by + 8).lineBetween(bx + 8, by - 8, bx - 8, by + 8);
      // braccio a traliccio
      const ex = x + w * 0.9, ey = y + h * 0.15;
      g.lineStyle(1.2, INK, 1).lineBetween(bx, by, ex, ey).lineBetween(bx + 6, by, ex, ey + 6);
      for (let k = 1; k < 10; k++) {
        const t = k / 10;
        g.lineStyle(1, INK, 0.5).lineBetween(bx + (ex - bx) * t, by + (ey - by) * t, bx + 6 + (ex - bx - 6) * (t + 0.05), by + (ey + 6 - by) * (t + 0.05));
      }
      // carico appeso che dondola
      const hook = scene.add.container(ex - 6, ey + 4);
      const hg = scene.add.graphics();
      hg.lineStyle(1, INK, 0.8).lineBetween(0, 0, 0, 26).fillStyle(SLATE, 1).fillRect(-9, 26, 18, 12).lineStyle(1.2, AMBER, 1).strokeRect(-9, 26, 18, 12);
      hook.add(hg);
      scene.tweens.add({ targets: hook, angle: { from: -6, to: 6 }, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      out.push(hook);
      break;
    }
    case 'counter': {
      solid(x, y, w, h * 0.45);
      g.lineStyle(1, INK, 0.6).lineBetween(x, y + h * 0.45, x, y + h).lineBetween(x + w, y + h * 0.45, x + w, y + h);
      const k = 5;
      for (let i = 0; i < k; i++) g.lineStyle(1, INK, 0.75).strokeRect(x + 10 + (i * (w - 20)) / k, y + h * 0.1, (w - 20) / k - 10, h * 0.25);
      // bilancia
      g.lineStyle(1, TEAL, 0.9).strokeCircle(x + w * 0.5, y + h * 0.75, 6).lineBetween(x + w * 0.5 - 14, y + h * 0.75, x + w * 0.5 + 14, y + h * 0.75);
      blink(x + w - 10, y + 8, AMBER, 1.6);
      break;
    }
    case 'board': {
      solid(x, y, w, h);
      const lines = Math.max(2, Math.floor(w / 26));
      for (let i = 0; i < lines; i++) g.lineStyle(1, INK, 0.45).lineBetween(x + 5 + (i * (w - 10)) / lines, y + h * 0.3, x + 5 + (i * (w - 10)) / lines + (w - 10) / lines - 6, y + h * 0.3);
      for (let i = 0; i < lines; i++) g.fillStyle(i % 3 === 0 ? RED : INK, 0.8).fillRect(x + 6 + (i * (w - 10)) / lines, y + h * 0.6, 3, 3);
      break;
    }
    case 'generator': {
      solid(x, y, w, h);
      const r = Math.min(w, h) * 0.3;
      g.lineStyle(1.2, INK, 0.9).strokeCircle(x + w / 2, y + h / 2, r);
      const fan = scene.add.graphics({ x: x + w / 2, y: y + h / 2 });
      for (let a = 0; a < 3; a++) fan.lineStyle(1.5, INK, 0.8).lineBetween(0, 0, Math.cos((a * Math.PI * 2) / 3) * r * 0.85, Math.sin((a * Math.PI * 2) / 3) * r * 0.85);
      scene.tweens.add({ targets: fan, angle: 360, duration: 2600, repeat: -1 });
      out.push(fan);
      blink(x + w - 6, y + 6, room === 'alloggi' ? AMBER : LUME, 1.8);
      break;
    }
  }
  return out;
}
