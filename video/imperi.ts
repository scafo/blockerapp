// Video degli imperi sulla carta del gioco. Stessa carta della campagna (WorldMap: puntini, rilievo, mare, colore
// dell'Imperium), nessuna partita: le province dentro i confini dell'impero si colorano una dopo l'altra partendo dalla
// capitale. Camera inclinata che ruota piano: la carta disegnata da Phaser diventa la texture di un piano in prospettiva
// (WebGL, con mipmap: la prospettiva CSS di Chrome lasciava righe tra i riquadri). Pagina a parte, il gioco non la carica:
// video/imperi.html?impero=mongolo&w=1080&h=1350
import Phaser from 'phaser';
import { loadWorld } from '../src/map/worldAsset';
import { buildShapes } from '../src/map/provinceShapes';
import { generateMap } from '../src/map/generate';
import { WorldMap } from '../src/render/WorldMap';
import { TERM, TERM_FONT, type TermFrame } from '../src/render/TerminalMap';
import { lonLat, center, WORLD_W, WORLD_H } from '../src/map/hexGrid';
import { latToV } from '../src/map/projection';
import { PALETTE, hex } from '../src/config/palette';
import { DPR } from '../src/ui/screen';
import { drawUnitSymbol } from '../src/ui/unitSymbols';
import type { UnitType } from '../src/config/balance';
import places from '../src/data/places.json';
import termUrl from '../src/assets/fonts/DejaVuSansMono.ttf';

const FPS = 30, SEC = 15, HOLD0 = 0.5, FILL = 11.5; // secondi: attesa iniziale, riempimento (poi attesa finale)
const TILT = 24, SPIN = 20, SCALE = 0.95, PERSP = 2800; // gradi di inclinazione, gradi di rotazione in tutto il video, prospettiva (punti)
const TERRAIN_IDX: Record<string, number> = { pianura: 0, colline: 1, montagne: 2, deserto: 3 };
type LL = [number, number]; // lon, lat
type Troop = LL | { to: LL; type: UnitType }; // città (fanteria) o città e tipo di pedina
const U = 1.5; // camera che segue: nomi e pedine 1,5 volte quelli del gioco (a 11 punti in un video da 1080 non si leggevano)

/** Confine approssimato (lon, lat): costa d'Africa, Egitto, Arabia, Mesopotamia, Armenia, Mar Nero, Dacia, Danubio, Reno. */
const ROMA: LL[] = [
  [-10, 33.5], [-6.8, 33.9], [-5.2, 33.6], [-3.5, 34.6], [-1, 34.7], [2.5, 35.3], [5.5, 34.8], [7.5, 34.3], [8.2, 33], [10.2, 32.3],
  [12.5, 32], [15.2, 31.2], [18.5, 30.2], [20.2, 30.6], [22.5, 31.6], [25, 31], [29, 30.3], [30.3, 28], [31, 26.5], [32.2, 24],
  [33.2, 24], [34.3, 26.5], [34.8, 28], [36, 27.5], [37.9, 26.6], [38.5, 28.5], [38, 31], [37.8, 32.5], [38.5, 33.8], [40.8, 34.4],
  [43, 33.5], [46.5, 31], [48.5, 29.8], [48.6, 30.6], [47, 32.5], [45.3, 34.5], [44.5, 36.5], [45, 37.5], [46.5, 38.5], [47, 40.5],
  [45.5, 41.2], [42, 41.6], [41.5, 42.5], [36, 43], [30.5, 44], [29.9, 45.3], [28.2, 45.4], [27, 44.2], [25.3, 43.7], [25.2, 45],
  [25.8, 45.6], [26, 46.6], [25.2, 47.4], [23.6, 47.8], [22.5, 47.2], [21.6, 46.3], [21.3, 45.3], [20.4, 44.9], [19.1, 45.3],
  [18.9, 46.5], [19.05, 47.5], [18.9, 47.8], [17.6, 47.9], [16.9, 48.15], [15, 48.35], [13.45, 48.6], [12.1, 49], [11.8, 48.9],
  [10.75, 49.1], [9.8, 48.95], [9.5, 49.6], [9.15, 50], [8.9, 50.4], [8.2, 50.35], [7.3, 50.52], [6.95, 50.95], [6.6, 51.6],
  [6, 51.85], [5.1, 52.1], [4.4, 52.25], [3.5, 52.8], [1.2, 51.2], [-5.5, 48.8], [-10.5, 43.8], [-10.5, 36],
];
/** Britannia a sud del Vallo di Adriano. */
const BRITANNIA: LL[] = [
  [-6.5, 49.8], [2.2, 50.8], [2.2, 53], [-1.3, 55.05], [-3.5, 55], [-5, 54.5], [-5.5, 54.2], [-5.4, 52], [-6.5, 51.5],
];
/** Impero mongolo, 1279: dall'Europa orientale (Orda d'Oro) alla Corea, Cina dei Song compresa, Persia, Anatolia orientale. */
const MONGOLO: LL[] = [
  [24, 48], [24, 51], [26.5, 53], [28, 55.5], [31, 57.5], [33, 59.5], [38, 60], [44, 60.5], [50, 59.5], [56, 58.5], [60, 56.5],
  [64, 55.5], [68, 55], [73, 55.5], [78, 54.5], [84, 53.5], [88, 52], [92, 51.5], [97, 51.8], [102, 51], [106, 52.5], [110, 53],
  [114, 52], [118, 52.5], [122, 53.2], [127, 52], [131, 49.5], [135, 48.5], [138, 46.5], [135, 43], [131, 42.5], [130, 41.5], [129.6, 36], [129, 35], [126.3, 34.3],
  [126, 37], [125, 39.5], [122, 39], [121, 37.5], [122.5, 31], [122, 29], [120, 26], [117, 23], [111, 21], [108.5, 21.5],
  [106, 22.7], [103, 22.5], [100, 21.5], [98, 24], [97.5, 28], [92, 27], [88, 27.5], [84, 29], [80, 30.5], [78, 32.5], [75, 35],
  [72, 35], [70, 34], [70, 31], [66, 29], [62, 26], [57, 25.5], [54, 26.5], [51, 27.8], [50, 29.5], [48.5, 30], [47.5, 30],
  [46, 31.5], [44, 33], [42, 34.5], [41, 36.5], [38, 37], [36, 36.8], [33, 36.2], [30, 36.8], [29, 38], [30, 40], [31.5, 41.2],
  [35, 42], [38, 41], [41.5, 41.6], [40, 43.5], [37.5, 44.7], [36, 45.2], [33, 44.4], [32.5, 45.3], [30.5, 46], [29.5, 45.3],
  [28.5, 45.2], [27, 46], [26, 47],
];
/** Impero di Alessandro Magno, 323 a.C.: Macedonia e Grecia, Anatolia, Levante, Egitto, Mesopotamia, Persia fino all'Indo. */
const ALESSANDRO: LL[] = [
  [19.3, 42], [23, 42.5], [26, 42], [28, 41.6], [29, 41.2], [31, 41.2], [35, 42], [38, 41], [41.5, 41.5], [44, 41.2], [46.5, 41.5],
  [48.5, 41.5], [49.2, 38.5], [51, 37], [54, 37], [54, 38.5], [56, 38.5], [58, 38], [60, 38], [62, 39], [64, 41], [66, 42], [69, 42],
  [70.6, 41], [71.5, 40.5], [72, 38], [73, 37], [74, 36], [75, 34.5], [76, 32], [75.5, 30], [74, 28], [71.5, 25.5], [68, 23.5],
  [66, 25.3], [62, 25.2], [58, 25.6], [56.5, 27], [54, 26.7], [51, 27.9], [50, 29.5], [48.5, 30], [47.5, 29.5], [46, 31], [43, 30.5],
  [40, 32], [38, 31.5], [36.5, 29.5], [35, 29.5], [34.5, 28.5], [33.5, 27.5], [34, 25], [33, 23.5], [31, 23.5], [30, 26], [28, 28],
  [25, 29], [24, 30.5], [20, 30.5], [20, 32.8], [21, 36.2], [19.3, 40],
];
/** Impero ottomano, 1683: Ungheria centrale, Balcani, vassalli sul Danubio e Crimea, Anatolia, Levante, Iraq, Hegiaz, Egitto, Nordafrica. */
const OTTOMANO: LL[] = [
  [15.8, 44.5], [16.5, 45.2], [17, 46], [17.8, 46.6], [18.5, 47.2], [19, 47.7], [20, 48], [21.5, 48.3], [22.2, 48], [22.9, 47.9],
  [24.5, 47.9], [26.5, 48.3], [27, 49.3], [29, 49], [30, 48.5], [31, 48], [33, 47.5], [35, 47.5], [37.5, 47.2], [38.5, 47], [39, 45.5],
  [37.5, 44.6], [41.6, 41.6], [43, 41.3], [43.5, 40.5], [44.2, 39.5], [44.5, 38], [45.5, 36], [46, 34.5], [46.5, 33], [47.5, 32],
  [48.5, 30], [48.2, 29.5], [47, 29.5], [44, 30], [42, 30.5], [38, 29.8], [37.5, 28], [38.6, 25.8], [39.8, 23.5], [40.6, 21.5],
  [41.3, 19.6], [40, 16], [39.5, 15.3], [38.5, 16.5], [37.3, 18.5], [36.5, 20], [36.5, 22], [33, 22], [31.3, 21.8], [25, 22],
  [25, 29.5], [20, 30], [16, 30], [13, 30.5], [10.2, 30.5], [9.5, 32], [8, 34], [5, 34.2], [2, 34.6], [-1.8, 34.8], [-2, 35.2],
  [5, 37.5], [9.5, 37.6], [11, 37.2], [12, 36], [15.5, 35.5], [19, 37.5], [20, 39.3], [19.4, 41.8], [18.6, 42.4], [17.6, 42.9],
  [16.5, 43.5],
];
/** Impero britannico, 1920: nazioni di oggi (nomi della carta) più il protettorato di Aden. */
const BRITANNICO = ['Regno Unito', 'Irlanda', 'Isle of Man', 'Jersey', 'Guernsey', 'Canada', 'Australia', 'Nuova Zelanda', 'India',
  'Pakistan', 'Bangladesh', 'Birmania', 'Ceylon', 'Maldives', 'Egitto', 'Sudan', 'Sud Sudan', 'Sudafrica', 'Namibia', 'Botswana',
  'Lesotho', 'eSwatini', 'Zimbabwe', 'Zambia', 'Malawi', 'Kenya', 'Uganda', 'Tanzania', 'Nigeria', 'Ghana', 'Sierra Leone', 'Gambia',
  'Somaliland', 'Iraq', 'Giordania', 'Israel', 'Palestine', 'Kuwait', 'Qatar', 'Bahrain', 'Emirati', 'Malesia', 'Brunei', 'Singapore',
  'Hong Kong', 'Papua', 'Fiji', 'Solomon Is.', 'Tonga', 'Samoa', 'Kiribati', 'Nauru', 'Cook Is.', 'Niue', 'Norfolk Island', 'Guyana',
  'Belize', 'Jamaica', 'Bahamas', 'Trinidad and Tobago', 'Barbados', 'Antigua and Barb.', 'Saint Lucia', 'St. Vin. and Gren.',
  'Grenada', 'Dominica', 'St. Kitts and Nevis', 'Cayman Is.', 'Turks and Caicos Is.', 'British Virgin Is.', 'Montserrat', 'Anguilla',
  'Bermuda', 'Falkland', 'S. Geo. and the Is.', 'Saint Helena', 'Br. Indian Ocean Ter.', 'Pitcairn Is.', 'Mauritius', 'Seychelles',
  'Cyprus', 'N. Cyprus', 'Malta'];
/** Impero napoleonico, 1812 (Impero francese e stati satellite): nazioni di oggi più il Ducato di Varsavia, meno isole e Prussia. */
const NAPOLEONICO = ['Francia', 'Belgium', 'Olanda', 'Luxembourg', 'Svizzera', 'Spagna', 'Andorra', 'Monaco', 'Liechtenstein',
  'Slovenia', 'Croazia', 'San Marino', 'Vatican', 'Germania', 'Italia'];
const VARSAVIA: LL[] = [[16, 52], [16.5, 53], [17.5, 53.5], [19.5, 54], [23, 54.2], [23.8, 53], [23.5, 51.5], [24, 50.5], [22, 50.2], [20, 50], [18.5, 50.2], [17.5, 51]];
const SICILIA: LL[] = [[12, 36.4], [15.8, 36.4], [15.8, 38.5], [12, 38.5]];
const SARDEGNA: LL[] = [[8, 38.7], [10, 38.7], [10, 41.4], [8, 41.4]];
const BALEARI: LL[] = [[1, 38.5], [4.6, 38.5], [4.6, 40.2], [1, 40.2]];
const BRANDEBURGO: LL[] = [[11.3, 51.4], [14.9, 51.4], [14.9, 53.6], [12.5, 53.6], [11.3, 53]]; // Prussia
/** Russia occupata nel 1812: Curlandia, Lituania, Bielorussia, la strada Vitebsk–Smolensk fino a Mosca. */
const RUSSIA_1812: LL[] = [
  [21.2, 55.3], [21, 56.5], [24, 56.9], [26.5, 56], [28.5, 55.8], [30.5, 55.6], [33, 55.5], [35, 55.8], [37.6, 56.1], [38.3, 55.7],
  [37.5, 55.3], [35, 54.6], [32, 54.2], [30, 53.5], [28, 52], [25, 51.8], [24, 52], [23.5, 53], [22.9, 54.4], [22.9, 55.1],
];
/** Impero carolingio, 814: dalla Bretagna all'Elba e alla Pannonia, Marca di Spagna, Italia fino a Roma, Corsica. */
const CAROLINGIO: LL[] = [
  [-1.8, 43.4], [-5, 43.5], [-5.2, 48.6], [-2, 49.8], [1.5, 51.2], [3.5, 51.8], [4.5, 53.3], [7, 53.8], [8.8, 54.5], [9.5, 54.9],
  [10.9, 54.4], [11, 53.9], [11.3, 53.2], [11.8, 52.6], [11.9, 51.9], [12, 51.2], [12.3, 50.4], [12.5, 49.8], [13.8, 48.8], [15, 48.7],
  [17.2, 48.1], [18.9, 47.8], [19, 46.5], [18.5, 45.6], [16.5, 45.2], [15.2, 45.2], [14.5, 45.3], [13.6, 45.1], [14.2, 42.4],
  [14.5, 42.1], [13.8, 41.3], [12.3, 41.6], [9, 41.3], [8, 42.5], [3.4, 41.6], [1.5, 41.1], [0.9, 41], [0, 41.5], [-1, 42.3],
];
/** Impero bizantino, 555 (Giustiniano): nazioni di oggi più coste d'Africa, Spania e Baleari, meno la Vojvodina. */
const BIZANTINO = ['Italia', 'Vatican', 'San Marino', 'Malta', 'Croazia', 'Bosnia', 'Grecia', 'Albania', 'Macedonia', 'Bulgaria',
  'Montenegro', 'Kosovo', 'Serbia', 'Turchia', 'Cyprus', 'N. Cyprus', 'Siria', 'Lebanon', 'Israel', 'Palestine', 'Giordania', 'Egitto', 'Tunisia'];
const LIBIA_COSTA: LL[] = [[11.5, 33.3], [15.5, 32.6], [19.5, 30.2], [20.5, 30.2], [22, 33], [25.2, 31.8], [25.2, 30.2], [22, 29.5], [19, 29.3], [15, 30.2], [11.5, 30.8]];
const ALGERIA_COSTA: LL[] = [[1, 36.6], [8.7, 37.1], [8.4, 35.2], [6, 34.8], [4, 35.5], [1, 36]];
const SPANIA: LL[] = [[-6.4, 36.2], [-5.6, 35.9], [-2, 36.6], [-0.7, 37.5], [-0.4, 38.4], [-1.4, 38.2], [-3.8, 37.4], [-5.8, 37.4]];
const VOJVODINA: LL[] = [[19, 46.2], [20.3, 46.2], [21.4, 44.8], [20.3, 44.8], [19, 44.9]];
/** Impero spagnolo, 1790: nazioni di oggi più Louisiana, Florida e il West degli Stati Uniti. */
const SPAGNOLO = ['Spagna', 'Messico', 'Guatemala', 'Honduras', 'El Salvador', 'Nicaragua', 'Costa Rica', 'Panama', 'Colombia',
  'Venezuela', 'Ecuador', 'Perù', 'Bolivia', 'Cile', 'Argentina', 'Paraguay', 'Uruguay', 'Cuba', 'Dominicana', 'Puerto Rico',
  'Trinidad and Tobago', 'Filippine', 'Guam', 'N. Mariana Is.', 'Micronesia', 'Palau', 'Eq. Guinea'];
const USA_SPAGNOLI: LL[] = [[-125, 49], [-95, 49], [-91, 47.5], [-90, 43], [-91, 40], [-89.5, 37], [-90.5, 35], [-91, 32], [-91.5, 31],
  [-81.5, 30.7], [-80, 24], [-98, 24], [-125, 32]];
/** Impero austro-ungarico, 1914: nazioni di oggi più Galizia, Bucovina, Transilvania e Banato, Vojvodina, Rutenia, Trentino e Trieste. */
const AUSTROUNGARICO = ['Austria', 'Ungheria', 'Boemia', 'Slovakia', 'Slovenia', 'Croazia', 'Bosnia'];
const GALIZIA: LL[] = [[18.9, 49.8], [19, 50.3], [20.5, 50.4], [22, 50.6], [23.5, 50.4], [24.2, 50.6], [25.5, 50.3], [26.2, 49.8], [26.3, 48.8],
  [25.3, 48.1], [24, 47.9], [22.8, 48.1], [22.5, 49.1], [20.5, 49.2], [19.4, 49.4]];
const BUCOVINA: LL[] = [[25.3, 48.1], [26.3, 48.4], [26.6, 48.2], [26.6, 47.6], [25.8, 47.2], [25, 47.5]];
const TRANSILVANIA: LL[] = [[20.3, 46.2], [21.4, 46.6], [22.9, 47.9], [24, 47.9], [25, 47.5], [25.8, 47.2], [26.4, 46.2], [25.6, 45.5],
  [24, 45.4], [22.6, 44.6], [21.4, 44.8], [20.3, 45.8]];
const RUTENIA: LL[] = [[22.1, 48.4], [22.5, 49.1], [23.5, 48.9], [24.6, 48], [24, 47.9], [22.8, 48]];
const TRENTO_TRIESTE: LL[] = [[10.4, 46.5], [10.5, 45.9], [11, 45.7], [11.8, 45.9], [12.4, 46.6], [12.8, 46.6], [13.2, 46.2], [13.4, 45.7],
  [13.6, 45.6], [13.9, 46.1], [12.3, 47.1], [10.5, 46.9]];
const ADEN: LL[] = [[43.3, 12.6], [45, 12.8], [49, 14], [52.2, 15.6], [53.1, 16.6], [51.5, 18.5], [49, 18.5], [46, 17.5], [45, 15.5], [43.4, 13.5]];

interface Empire {
  start: LL; // capitale: da qui si riempie
  polys?: LL[][]; // confini approssimati
  countries?: string[]; // nazioni intere
  sea?: number; // salto più lungo per mare tra due province (pixel-mondo); senza = qualunque distanza
  aim?: LL; zoom?: number; // inquadratura fissa (punti CSS per pixel-mondo); senza = tutto l'impero
  world?: boolean; // grande come il mondo: inquadratura intera anche se si vede oltre la carta
  box?: [number, number, number, number]; // nazioni solo dentro [lon0, lat0, lon1, lat1] (niente territori d'oltremare)
  exclude?: LL[][]; // parti tolte
  troops?: Troop[]; // un reparto dalla capitale verso ognuna di queste città, al passo della conquista
  follow?: boolean; // camera vicina che segue la conquista, poi si allarga fino a tutto l'impero
  labels?: boolean; // nomi di nazioni, città e mari come nel gioco
}
const EMPIRES: Record<string, Empire> = {
  roma: { start: [12.5, 41.9], polys: [ROMA, BRITANNIA], sea: 40, aim: [19, 39], zoom: 2.25 },
  mongolo: { start: [102.8, 47.2], polys: [MONGOLO], sea: 40 },
  alessandro: { start: [22.5, 40.8], polys: [ALESSANDRO], sea: 40 },
  ottomano: { start: [29, 41], polys: [OTTOMANO], sea: 40 },
  britannico: { start: [-0.1, 51.5], countries: BRITANNICO, polys: [ADEN], world: true },
  napoleonico: { start: [2.35, 48.86], countries: NAPOLEONICO, box: [-12, 35, 30, 60], polys: [VARSAVIA], exclude: [SICILIA, SARDEGNA, BALEARI, BRANDEBURGO], sea: 40,
    troops: [[-3.7, 40.4], [-6, 37.4], [4.9, 52.4], [10, 53.55], [21, 52.2], [11.6, 48.1], [14.3, 40.85], [16.4, 43.5]] },
  // la massima espansione: anche la Russia fino a Mosca, un reparto in più verso Mosca
  'napoleonico-russia': { start: [2.35, 48.86], countries: NAPOLEONICO, box: [-12, 35, 30, 60], polys: [VARSAVIA, RUSSIA_1812],
    exclude: [SICILIA, SARDEGNA, BALEARI, BRANDEBURGO], sea: 40,
    troops: [[-3.7, 40.4], [-6, 37.4], [4.9, 52.4], [10, 53.55], [21, 52.2], [11.6, 48.1], [14.3, 40.85], [16.4, 43.5], [37.6, 55.75]] },
  'roma-dettaglio': { start: [12.5, 41.9], polys: [ROMA, BRITANNIA], sea: 40, follow: true, labels: true,
    troops: [
      { to: [2.35, 48.86], type: 'legionari' }, // Gallia
      { to: [-0.13, 51.5], type: 'legionari' }, // Britannia
      { to: [-4, 40], type: 'fanteria' }, // Hispania
      { to: [-6.3, 36.5], type: 'ricognitori' }, // Betica
      { to: [10.3, 36.85], type: 'ricognitori' }, // Africa
      { to: [23.3, 45.6], type: 'artiglieria' }, // Dacia
      { to: [36.2, 36.2], type: 'fanteria' }, // Siria
      { to: [29.9, 31.2], type: 'legionari' }, // Egitto
      { to: [44.4, 33.3], type: 'artiglieria' }, // Mesopotamia
    ] },
  carolingio: { start: [6.08, 50.78], polys: [CAROLINGIO], sea: 40 },
  bizantino: { start: [28.98, 41.01], countries: BIZANTINO, polys: [LIBIA_COSTA, ALGERIA_COSTA, SPANIA, BALEARI], exclude: [VOJVODINA], sea: 60 },
  spagnolo: { start: [-3.7, 40.4], countries: SPAGNOLO, polys: [USA_SPAGNOLI], world: true },
  austroungarico: { start: [16.37, 48.21], countries: AUSTROUNGARICO, polys: [GALIZIA, BUCOVINA, TRANSILVANIA, VOJVODINA, RUTENIA, TRENTO_TRIESTE], sea: 40 },
};

const q = new URLSearchParams(location.search);
const E = EMPIRES[q.get('impero') ?? 'roma'];
const VW = +(q.get('w') ?? 1080), VH = +(q.get('h') ?? 1350); // fotogramma (punti CSS)
document.body.style.width = `${VW}px`;
document.body.style.height = `${VH}px`;

function inside(poly: [number, number][], x: number, y: number): boolean {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

const lonX = (lon: number) => ((lon + 180) / 360) * WORLD_W;
const latY = (lat: number) => latToV(lat) * WORLD_H;

const world = loadWorld(), shapes = buildShapes(world), map = generateMap('roma', world);
const provs = map.provinces;
const mine = provs.map((p) => {
  if (p.anchor < 0) return false;
  const [lon, lat] = lonLat(p.anchor), b = E.box;
  if (E.exclude?.some((poly) => inside(poly, lon, lat))) return false;
  if (E.countries?.includes(world.names[p.country]) && (!b || (lon >= b[0] && lat >= b[1] && lon <= b[2] && lat <= b[3]))) return true;
  return !!E.polys?.some((poly) => inside(poly, lon, lat));
});
const ids = provs.map((_, i) => i).filter((i) => mine[i]);
const at = (i: number) => center(provs[i].anchor);

// inquadratura: tutto l'impero nel fotogramma; la camera non deve vedere oltre il bordo della carta (nord e sud)
const T = (TILT * Math.PI) / 180, Yh = VH / 2 / SCALE;
const reachN = (Yh * PERSP) / (PERSP * Math.cos(T) - Yh * Math.sin(T)), reachS = (Yh * PERSP) / (PERSP * Math.cos(T) + Yh * Math.sin(T));
const farW = ((VW / 2 / SCALE) * (PERSP + reachN * Math.sin(T))) / PERSP;
let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
for (const i of ids) { const c = at(i); bx0 = Math.min(bx0, c.x); bx1 = Math.max(bx1, c.x); by0 = Math.min(by0, c.y); by1 = Math.max(by1, c.y); }
// angoli del fotogramma con la camera ruotata di SPIN / 2: quanto vede a nord e a sud del centro (punti)
const sp = ((SPIN / 2) * Math.PI) / 180, nearW = VW / 2 / SCALE;
const seeN = (reachN * Math.cos(sp) + farW * Math.sin(sp)) * 1.05, seeS = (reachS * Math.cos(sp) + nearW * Math.sin(sp)) * 1.05;
// zoom minimo perché l'inquadratura stia nell'altezza della carta (non per un impero grande come il mondo: lì resta il nero)
const ZOOM = E.zoom ?? Math.max(Math.min((VW * 0.86) / SCALE / (bx1 - bx0), (VH * 0.8) / SCALE / ((by1 - by0) * Math.cos(T))),
  E.world ? 0 : (seeN + seeS) / WORLD_H);
// zoom di disegno: da lontano i puntini della carta scendono sotto il pixel (moiré). Phaser la disegna più grande, poi la
// prospettiva la riduce con le mipmap. Sotto 3,7: da più vicino WorldMap passa al livello col mosaico delle province, diverso
// dagli altri video
const ZR = Math.min(Math.max(ZOOM, 1.2), 3.7);
let aimX = E.aim ? lonX(E.aim[0]) : (bx0 + bx1) / 2, aimY = E.aim ? latY(E.aim[1]) : (by0 + by1) / 2;
const nMin = seeN / ZOOM, sMax = WORLD_H - seeS / ZOOM;
if (!E.aim && nMin <= sMax) aimY = Math.min(Math.max(aimY, nMin), sMax);
// carta disegnata: quanto può vedere la camera girando, entro il mondo
const R = (1.15 * Math.hypot(farW, reachN)) / ZOOM;
const X0 = Math.max(0, aimX - R), X1 = Math.min(WORLD_W, aimX + R), Y0 = Math.max(0, aimY - R), Y1 = Math.min(WORLD_H, aimY + R);
// canvas in punti CSS, pari: riquadri della carta a pixel interi. Camera che segue: canvas fisso grande quanto può vedere la
// camera girando, la carta ci scorre sotto (zoom di disegno = zoom della camera)
const RF = 1.15 * Math.hypot(farW, reachN);
const CW = E.follow ? Math.round(RF) * 2 : Math.round(((X1 - X0) * ZR) / 2) * 2, CH = E.follow ? CW : Math.round(((Y1 - Y0) * ZR) / 2) * 2;

const nearest = (ll: LL) => ids.reduce((b, i) => {
  const d = (i: number) => { const [lon, lat] = lonLat(provs[i].anchor); return (lon - ll[0]) ** 2 + (lat - ll[1]) ** 2; };
  return d(i) < d(b) ? i : b;
});

/** Ordine delle province: dalla capitale, per terra e (costa di più) per mare, con un po' di caso. `from`: da dove è arrivata. */
function order(): { out: number[]; from: Map<number, number> } {
  const start = nearest(E.start);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const noise = provs.map(() => 0.6 + 0.8 * rnd());
  const sea = E.sea ?? Infinity;
  const dist = new Map<number, number>([[start, 0]]);
  const done = new Set<number>(), out: number[] = [], from = new Map<number, number>();
  while (out.length < ids.length) {
    let i = -1, best = Infinity;
    for (const [j, d] of dist) if (!done.has(j) && d < best) { best = d; i = j; }
    if (i < 0) break;
    done.add(i);
    out.push(i);
    const a = at(i), land = new Set(provs[i].neighbors);
    for (const j of ids) {
      if (done.has(j)) continue;
      const b = at(j), d = Math.hypot(a.x - b.x, a.y - b.y);
      const step = land.has(j) ? d * noise[j] : d < sea ? d * 2.5 * noise[j] : Infinity;
      if (best + step < (dist.get(j) ?? Infinity)) { dist.set(j, best + step); from.set(j, i); }
    }
  }
  return { out, from };
}

/** Piano inclinato (come CSS: scale · rotateX · rotateZ, prospettiva PERSP) con la carta come texture, nel canvas #out. */
function makeTilt(src: HTMLCanvasElement, ax: number, ay: number, pw: number, ph: number) {
  const out = document.getElementById('out') as HTMLCanvasElement;
  out.width = VW * devicePixelRatio;
  out.height = VH * devicePixelRatio;
  const gl = out.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true })!;
  const sh = (type: number, src: string) => { const o = gl.createShader(type)!; gl.shaderSource(o, src); gl.compileShader(o); return o; };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, `#version 300 es
    in vec2 uv;
    uniform vec2 size, aim, view;
    uniform float spin, tilt, scale, persp;
    out vec2 vuv;
    void main() {
      vec2 p = uv * size - aim;
      float c = cos(spin), s = sin(spin);
      p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
      float z = p.y * sin(tilt);
      vec2 q = vec2(p.x, p.y * cos(tilt)) * scale;
      vuv = uv;
      gl_Position = vec4(q.x / (view.x / 2.0) * persp, -q.y / (view.y / 2.0) * persp, 0.0, persp - z);
    }`));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;
    in vec2 vuv;
    uniform sampler2D tex;
    out vec4 col;
    void main() { col = texture(tex, vuv); }`));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'uv');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT));
  const u = (n: string) => gl.getUniformLocation(prog, n);
  gl.uniform2f(u('size'), pw, ph); // piano in punti dello schermo
  gl.uniform2f(u('aim'), ax, ay);
  gl.uniform2f(u('view'), VW, VH);
  gl.uniform1f(u('tilt'), (TILT * Math.PI) / 180);
  gl.uniform1f(u('scale'), SCALE);
  gl.uniform1f(u('persp'), PERSP);
  return (spin: number) => {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.uniform1f(u('spin'), spin);
    gl.viewport(0, 0, out.width, out.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
}

class Imperi extends Phaser.Scene {
  constructor() { super('Imperi'); }

  create() {
    const cam = this.cameras.main;
    cam.setBackgroundColor(PALETTE.mappa.fondo);
    cam.setZoom(ZR * DPR);
    cam.centerOn((X0 + X1) / 2, (Y0 + Y1) / 2);
    cam.scrollX = Math.round(cam.scrollX * cam.zoom) / cam.zoom; // a pixel interi, come in campagna
    cam.scrollY = Math.round(cam.scrollY * cam.zoom) / cam.zoom;
    const wm = new WorldMap(this, shapes, 1);
    wm.setTerrain(Uint8Array.from(provs, (p) => TERRAIN_IDX[p.terrain] ?? 0));
    wm.work(60_000); // tutti i livelli subito
    const { out: ord, from } = order();
    // colori dell'Imperium come in campagna: confine schiarito, costa col riempimento scurito
    const C = Phaser.Display.Color, f = PALETTE.factions[1];
    const mix = (a: number, b: number, t: number) => { const c = C.Interpolate.ColorWithColor(C.ValueToColor(a), C.ValueToColor(b), 100, t); return hex(C.GetColor(c.r, c.g, c.b)); };
    const fill = hex(f.fill);
    const owned = new Uint8Array(provs.length);
    const got = (k: number) => {
      const t = Math.min(Math.max((k / FPS - HOLD0) / FILL, 0), 1);
      return Math.max(1, Math.round((ord.length * (1 - Math.cos(Math.PI * t))) / 2));
    };
    const tilt = E.follow ? makeTilt(this.game.canvas, CW / 2, CH / 2, CW, CH)
      : makeTilt(this.game.canvas, (aimX - X0) * ZOOM, (aimY - Y0) * ZOOM, (CW * ZOOM) / ZR, (CH * ZOOM) / ZR);
    // fotogramma in cui ogni provincia diventa dell'impero
    const born = new Map<number, number>();
    for (let k = FPS * SEC - 1; k >= 0; k--) for (const p of ord.slice(0, got(k))) born.set(p, k);
    // camera che segue: inquadra le province prese (con un po' di anticipo), parte vicina alla capitale e si allarga fino a
    // tutto l'impero; movimento smorzato
    const N = FPS * SEC, camZ: number[] = [], camX: number[] = [], camY: number[] = [];
    if (E.follow) {
      const pad = 25, LOOK = 15, ZCLOSE = 8, s = 0.07;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, n = 0;
      let z = ZCLOSE, x = at(ord[0]).x, y = at(ord[0]).y;
      for (let k = 0; k < N; k++) {
        for (const g = got(Math.min(N - 1, k + LOOK)); n < g; n++) {
          const c = at(ord[n]);
          x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x); y0 = Math.min(y0, c.y); y1 = Math.max(y1, c.y);
        }
        const fit = Math.min((VW * 0.8) / SCALE / (x1 - x0 + 2 * pad), (VH * 0.7) / SCALE / ((y1 - y0 + 2 * pad) * Math.cos(T)));
        const zt = Math.min(ZCLOSE, Math.max(ZOOM, fit));
        z = Math.exp(Math.log(z) + (Math.log(zt) - Math.log(z)) * s);
        x += ((x0 + x1) / 2 - x) * s;
        y += ((y0 + y1) / 2 - y) * s;
        camZ.push(z); camX.push(x); camY.push(y);
      }
    }
    const zoomAt = (k: number) => (E.follow ? camZ[k] : ZR);
    // nomi come nel gioco (carattere da terminale su fondo nero; nazioni, città, mari), grandi U volte; una nazione ha il nome
    // solo se ci sta dentro (regola della campagna), quelli che si sovrappongono restano fuori
    const names: { t: Phaser.GameObjects.Text; need: number }[] = [];
    if (E.labels) {
      const box = new Map<number, [number, number]>();
      provs.forEach((p, k) => {
        const sh = shapes.provinces[k];
        if (!sh?.parts.length) return;
        const b = box.get(p.country);
        box.set(p.country, b ? [Math.min(b[0], sh.x0), Math.max(b[1], sh.x1)] : [sh.x0, sh.x1]);
      });
      const add = (x: number, y: number, text: string, color: string, small: boolean, need: number) => names.push({ need,
        t: this.add.text(x, y, text, { fontFamily: TERM_FONT, fontSize: `${small ? 9 : 11}px`, color, backgroundColor: '#000000', padding: { x: 2, y: 0 }, resolution: DPR * U * 2 })
          .setOrigin(0.5).setDepth(1.5) });
      for (const n of [...map.nations].filter((n) => n.size >= 40).sort((a, b) => b.size - a.size)) {
        const { x, y } = center(n.label), b = box.get(n.id) ?? [x - 10, x + 10];
        add(x, y, n.name, TERM.country, false, (n.name.length * 9 * 1.1 * U) / (b[1] - b[0]));
      }
      for (const [n, lon, lat] of places.cities as [string, number, number][]) add(lonX(lon), latY(lat), n, TERM.city, true, 0);
      for (const [n, lon, lat] of places.seas as [string, number, number][]) add(lonX(lon), latY(lat), n, TERM.sea, false, 0);
    }
    const label = (z: number) => {
      const placed: [number, number, number, number][] = [];
      for (const { t, need } of names) {
        t.setScale(U / z);
        if (z < need) { t.setVisible(false); continue; }
        const w = t.displayWidth / 2 + 3 / z, h = t.displayHeight / 2 + 2 / z;
        const free = !placed.some((b) => b[0] < t.x + w && b[2] > t.x - w && b[1] < t.y + h && b[3] > t.y - h);
        t.setVisible(free);
        if (free) placed.push([t.x - w, t.y - h, t.x + w, t.y + h]);
      }
    };
    // reparti (pedine del gioco, bianche come le tue): ognuno segue la strada della conquista dalla capitale alla sua città ed
    // entra in ogni provincia quando diventa dell'impero; per mare diventa una nave
    const troops = (E.troops ?? []).map((tr) => {
      const to = Array.isArray(tr) ? tr : tr.to, type: UnitType = Array.isArray(tr) ? 'fanteria' : tr.type;
      const path: number[] = [];
      for (let p: number | undefined = nearest(to); p !== undefined; p = from.get(p)) path.unshift(p);
      const g = this.add.graphics().setDepth(2), ship = this.add.graphics().setDepth(2).setVisible(false);
      drawUnitSymbol(g, type, true, 0xf2f2f2);
      drawUnitSymbol(ship, 'cannoniera', true, 0xf2f2f2);
      return { g, ship, path };
    });
    const march = (k: number) => {
      const sc = E.follow ? U / zoomAt(k) : 1 / ZOOM; // misura del gioco: 26 punti sullo schermo
      for (const { g, ship, path } of troops) {
        let i = 0;
        while (i + 1 < path.length && born.get(path[i + 1])! <= k) i++;
        const pa = path[i], pb = path[Math.min(i + 1, path.length - 1)];
        const a = at(pa), b = at(pb), ka = born.get(pa)!, kb = born.get(pb)!;
        const t = kb > ka ? Math.min(1, (k - ka) / (kb - ka)) : 0;
        const sea = pa !== pb && t > 0 && t < 1 && !provs[pa].neighbors.includes(pb);
        for (const o of [g, ship]) o.setPosition(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t).setScale(sc);
        g.setVisible(!sea);
        ship.setVisible(sea);
      }
    };
    const set = (k: number) => {
      owned.fill(0);
      for (const p of ord.slice(0, got(k))) owned[p] = 1;
      const frame: TermFrame = { view: new Phaser.Geom.Rectangle(0, 0, WORLD_W, WORLD_H), provinces: [], borders: [], labels: [], status: '',
        edges: { [fill]: mix(f.border, 0xffffff, 55) }, coasts: { [fill]: mix(f.fill, 0x000000, 50) } };
      for (let p = 0; p < shapes.provinces.length; p++) {
        if (!shapes.provinces[p].parts.length) continue;
        frame.provinces.push({ id: p, color: owned[p] ? fill : null, terrain: TERRAIN_IDX[provs[p].terrain] ?? 0 });
      }
      if (E.follow) {
        cam.setZoom(camZ[k] * DPR);
        cam.centerOn(camX[k], camY[k]);
        cam.scrollX = Math.round(cam.scrollX * cam.zoom) / cam.zoom;
        cam.scrollY = Math.round(cam.scrollY * cam.zoom) / cam.zoom;
      }
      wm.render(frame);
      wm.align(); // livello per lo zoom e riquadri da vicino da preparare
      wm.work(60_000);
      wm.align();
      label(zoomAt(k));
      march(k);
    };
    // dopo che Phaser ha ridisegnato la carta: piano in prospettiva per il fotogramma k
    const draw = (k: number) => tilt(((SPIN / 2 - (SPIN * k) / (FPS * SEC - 1)) * Math.PI) / 180);
    set(0);
    // registrazione dentro la pagina: Phaser avanza a mano, il video lo codifica il browser (WebCodecs, H.264 della scheda
    // grafica) in H.264 grezzo; ffmpeg lo mette solo nel contenitore mp4. Prima ogni fotogramma era uno screenshot passato a
    // ffmpeg: ~300 ms l'uno
    const record = async () => {
      const out = document.getElementById('out') as HTMLCanvasElement;
      const small = document.createElement('canvas');
      small.width = VW; small.height = VH;
      const ctx = small.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      const chunks: Uint8Array[] = [];
      const enc = new VideoEncoder({ output: (c) => { const b = new Uint8Array(c.byteLength); c.copyTo(b); chunks.push(b); }, error: (e) => console.error(e) });
      enc.configure({ codec: 'avc1.640028', width: VW, height: VH, bitrate: 20_000_000, framerate: FPS, avc: { format: 'annexb' } });
      this.game.loop.sleep();
      const N = FPS * SEC, t0 = performance.now();
      for (let k = 0; k < N; k++) {
        set(k);
        this.game.step(t0 + (k * 1000) / FPS, 1000 / FPS);
        draw(k);
        ctx.drawImage(out, 0, 0, VW, VH);
        const vf = new VideoFrame(small, { timestamp: Math.round((k * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
        enc.encode(vf, { keyFrame: k % FPS === 0 });
        vf.close();
        while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1));
      }
      await enc.flush();
      const png = await new Promise<Blob>((r) => small.toBlob((b) => r(b!), 'image/png')); // ultimo fotogramma: l'immagine
      const b64 = async (b: Blob) => { const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
      return { h264: await b64(new Blob(chunks as BlobPart[])), png: await b64(png), ms: Math.round(performance.now() - t0) };
    };
    (window as unknown as { __roma: object }).__roma = { frames: FPS * SEC, set, draw, record, provinces: ids.length };
  }
}

// carattere da terminale dei nomi, prima di disegnarli
document.fonts.add(await new FontFace('DejaVu Sans Mono', `url(${termUrl})`).load());

new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  backgroundColor: '#000000',
  scale: { mode: Phaser.Scale.NONE, width: CW * DPR, height: CH * DPR, zoom: 1 / DPR },
  render: { antialias: true, pixelArt: false, preserveDrawingBuffer: true }, // come il gioco; la carta si copia nella texture del piano
  scene: [Imperi],
});
