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
import { lonLat, center, pixelToIndex, WORLD_W, WORLD_H } from '../src/map/hexGrid';
import { latToV } from '../src/map/projection';
import { PALETTE, hex } from '../src/config/palette';
import { DPR } from '../src/ui/screen';
import { drawUnitSymbol } from '../src/ui/unitSymbols';
import { rectOutline, squareProgress } from '../src/render/termMarks';
import { sfx, type Sfx } from '../src/audio/sfx';
import { music } from '../src/audio/music';
import type { UnitType } from '../src/config/balance';
import places from '../src/data/places.json';
import termUrl from '../src/assets/fonts/DejaVuSansMono.ttf';

const FPS = 30, HOLD0 = 0.5, HOLD1 = 3; // secondi: attesa iniziale e finale (la durata è dell'impero, 15 s di base)
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

/** Popolo rivale: sue le province dentro i poligoni (dentro l'impero si conquistano); colore da milizia o potenza. */
interface Rival { color: number; polys: LL[][]; type?: UnitType; units?: number; stays?: boolean } // stays: fuori dall'impero resta (Germani…)
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
  // esercito: sono i reparti a prendere le province (ognuno va alla provincia libera più vicina al confine, la prende, passa
  // alla prossima); `start` reparti alla capitale, poi uno di rinforzo ogni `every` passi fino a `max`; `speed` pixel-mondo a passo
  army?: { start: number; max: number; every: number; speed: number; types: UnitType[] };
  sec?: number; // durata del video in secondi (di base 15)
  sound?: boolean; // musica ed effetti del gioco nel video
  rivals?: Rival[]; // popoli rivali sulla carta: le loro province si prendono con un assedio
}
// popoli attorno a Roma (il primo poligono che contiene la provincia decide). Colori delle milizie e delle potenze del gioco
const ROMA_RIVALI: Rival[] = [
  { color: 0x6f8f98, polys: [BRITANNIA] }, // Britanni
  { color: 0x7a8aa6, stays: true, polys: [[[-8, 54.9], [-1.5, 55.1], [-1, 59], [-8, 59]]] }, // Caledoni
  { color: 0x7d9a7a, polys: [[[-5.2, 48.6], [-5, 43], [3.2, 42.4], [7.6, 43.7], [7, 45.9], [8.6, 47.6], [8.2, 49], [6.5, 50.5], [6.1, 51.9], [3.5, 51.8], [1.5, 51.2], [-2, 49.8]]] }, // Galli
  { color: 0xe0b040, type: 'ricognitori', polys: [ // Cartagine
    [[-6.5, 36], [-0.5, 37.4], [0.4, 38.8], [0, 39.6], [-1.6, 38.6], [-4, 37.4], [-6.6, 37.3]], [[8, 38.8], [10, 38.8], [10, 41.3], [8, 41.3]],
    [[0, 35.4], [3, 36.9], [11.3, 37.4], [11.3, 35], [10.6, 33], [15.5, 32.2], [15.2, 30.5], [10, 31.2], [8, 33.5], [3, 34.4], [0, 34.7]]] },
  { color: 0x9a8f6a, polys: [[[-10, 36], [-10, 44.2], [-1.8, 43.6], [3.4, 42.5], [0.8, 40.8], [-0.5, 39.5], [-1.6, 38.6], [-4, 37.4], [-6.6, 37.3], [-6.5, 36]]] }, // Iberi
  { color: 0xa08a5c, type: 'ricognitori', polys: [[[-10, 30], [-10, 36], [-5.5, 36], [-1.8, 35.3], [0, 35.4], [0, 34.7], [3, 34.4], [8, 33.5], [10, 31.2], [8, 29], [0, 29]]] }, // Mauri
  { color: 0x86996a, polys: [[[13.5, 45.6], [17, 45.3], [19.4, 45], [20.4, 43.3], [19.5, 42], [18.5, 42.4], [16, 43.5], [14.5, 44.8]]] }, // Illiri
  { color: 0x8a7d9c, polys: [[[19.3, 39.2], [19.5, 42], [20.4, 42.2], [23, 42.2], [26.6, 41.2], [26.3, 40], [24.5, 38.2], [23, 36.3], [21, 36.6]], [[23, 34.7], [26.6, 34.7], [26.6, 35.8], [23, 35.8]]] }, // Greci
  { color: 0x6e8a7e, polys: [[[22.5, 44.2], [28.6, 44], [28.2, 41.4], [26.6, 41.2], [23, 42.2], [22.3, 43]]] }, // Traci
  { color: 0x9a7a6e, polys: [[[20.5, 45.4], [22, 47.9], [26.5, 48.2], [28.2, 46.5], [29.7, 45.2], [27.5, 44.1], [22.5, 44.3]]] }, // Daci
  { color: 0x9c7f8c, polys: [[[26.2, 39.2], [26.4, 40.6], [29.5, 41.3], [33, 42], [36, 42], [41.6, 41.6], [44, 40.8], [43.5, 39.2], [38, 38.8], [32, 38.6], [28, 38.6]]] }, // Galati e Ponto
  { color: 0xb57ad6, polys: [[[27, 36.4], [27.5, 38.6], [32, 38.6], [38, 38.8], [43.5, 39.2], [45.6, 37], [46, 35], [48.7, 30.2], [46, 31], [40, 32.6], [35.9, 33], [34.2, 31.3], [34.9, 29.5]]] }, // Seleucidi
  { color: 0xa38770, polys: [ // Tolomei
    [[20, 30.2], [20, 33], [25, 32], [29, 31.3], [32.5, 31.4], [34.2, 31.3], [34.9, 29.5], [34, 27], [33.6, 24], [31, 23.3], [25, 21.8], [20, 28]], [[32, 34.4], [34.8, 34.4], [34.8, 35.8], [32, 35.8]]] },
  { color: 0x6f9a8c, stays: true, polys: [[[6.1, 51.9], [7.5, 50.3], [9, 49.7], [10.3, 49], [13.5, 48.7], [15.5, 48.9], [17, 48.6], [19, 49.5], [18, 51.5], [15, 54.3], [11, 54.5], [9, 55.3], [7, 53.6]]] }, // Germani
  { color: 0xa08a5c, stays: true, polys: [[[24, 48.3], [30, 46.5], [35, 47.2], [41, 47], [45, 46], [45, 51], [35, 53], [28, 52], [24, 50.5]]] }, // Sarmati
  { color: 0x4fc3d8, type: 'ricognitori', stays: true, polys: [[[44.5, 37.5], [46, 35], [48.7, 30.2], [50.5, 29], [57, 25.6], [62, 25.2], [62, 36.5], [57, 38], [54, 37.5], [49, 38.5], [47, 39.6]]] }, // Parti
];
const SPEED: Partial<Record<UnitType, number>> = { ricognitori: 1.5, artiglieria: 0.7 }; // passo dei reparti rispetto alla fanteria
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
  'roma-esercito': { start: [12.5, 41.9], polys: [ROMA, BRITANNIA], sea: 40, follow: true, labels: true, sec: 30, sound: true, rivals: ROMA_RIVALI,
    army: { start: 4, max: 32, every: 12, speed: 0.5, types: ['legionari', 'legionari', 'fanteria', 'ricognitori', 'legionari', 'artiglieria', 'fanteria', 'ricognitori'] } },
  carolingio: { start: [6.08, 50.78], polys: [CAROLINGIO], sea: 40 },
  bizantino: { start: [28.98, 41.01], countries: BIZANTINO, polys: [LIBIA_COSTA, ALGERIA_COSTA, SPANIA, BALEARI], exclude: [VOJVODINA], sea: 60 },
  spagnolo: { start: [-3.7, 40.4], countries: SPAGNOLO, polys: [USA_SPAGNOLI], world: true },
  austroungarico: { start: [16.37, 48.21], countries: AUSTROUNGARICO, polys: [GALIZIA, BUCOVINA, TRANSILVANIA, VOJVODINA, RUTENIA, TRENTO_TRIESTE], sea: 40 },
};

const q = new URLSearchParams(location.search);
const E = EMPIRES[q.get('impero') ?? 'roma'];
const SEC = E.sec ?? 15, FILL = SEC - HOLD0 - HOLD1; // durata e riempimento (secondi)
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
// popolo rivale di ogni provincia (−1 = libera); fuori dall'impero solo i popoli che restano (gli altri sono caduti: niente colore)
const rivalOf = new Int16Array(provs.length).fill(-1);
if (E.rivals) provs.forEach((p, i) => {
  if (p.anchor < 0) return;
  const [lon, lat] = lonLat(p.anchor), r = E.rivals!.findIndex((r) => r.polys.some((poly) => inside(poly, lon, lat)));
  if (r >= 0 && (mine[i] || E.rivals![r].stays)) rivalOf[i] = r;
});

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

/**
 * Campagna dell'esercito, prima di registrare: a ogni passo ogni reparto senza meta sceglie la provincia libera più vicina sul
 * confine (per terra o mare corto) e ci va in linea retta. Come in campagna: una provincia libera si prende arrivando, quella di
 * un popolo rivale con un assedio dal bordo (più lungo se un suo reparto accorre a difenderla). Il popolo che perde una provincia
 * ripiega sulla più vicina che gli resta; senza province cade. Rinforzi al confine più scoperto, guarnigioni sparse. Riempie
 * `born` (fotogramma di conquista) e restituisce posizioni a ogni passo ed eventi (per effetti e suoni).
 */
function campaign(A: NonNullable<Empire['army']>, born: Map<number, number>) {
  const sea = E.sea ?? Infinity, SIEGE = 30; // passi d'assedio (×1,7 con un difensore)
  const adj = new Map<number, number[]>(ids.map((i) => [i, []]));
  for (const i of ids) for (const j of ids) {
    if (j <= i) continue;
    const a = at(i), b = at(j);
    if (provs[i].neighbors.includes(j) || Math.hypot(a.x - b.x, a.y - b.y) < sea) { adj.get(i)!.push(j); adj.get(j)!.push(i); }
  }
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const noise = new Map(ids.map((i) => [i, 0.75 + 0.5 * rnd()]));
  const start = nearest(E.start), cap = at(start);
  const tick = new Map<number, number>([[start, 0]]), front = new Set<number>(adj.get(start)), claimed = new Set<number>();
  // reparto: provincia da prendere (tgt), assedio (sg passi che mancano, foe = difensore), guarnigione (post)
  const units: { x: number; y: number; v: number; tgt: number; post: number; sg: number; foe: number; t0: number }[] = [];
  const types: UnitType[] = [], tracks: Float32Array[] = [];
  const spawns: number[] = [], conquests: { t: number; p: number; siege: boolean }[] = [], sieges: { p: number; t0: number; t1: number }[] = [];
  const shots: { t: number; u: number; f: number }[] = [], deaths: { t: number; f: number }[] = [], fallen: number[] = [];
  const spawn = () => {
    const type = A.types[types.length % A.types.length];
    types.push(type);
    units.push({ x: cap.x, y: cap.y, v: A.speed * (SPEED[type] ?? 1), tgt: -1, post: -1, sg: -1, foe: -1, t0: 0 });
  };
  for (let i = 0; i < A.start; i++) spawn();
  // reparti dei popoli rivali (rombi del loro colore, come i nemici in campagna): pochi per popolo, lontani l'uno dall'altro
  const land = (E.rivals ?? []).map((_, r) => provs.map((_, i) => i).filter((i) => rivalOf[i] === r));
  const foes: { x: number; y: number; r: number; home: number; dead: number }[] = [], foeTypes: UnitType[] = [], ftracks: Float32Array[] = [];
  (E.rivals ?? []).forEach((rv, r) => {
    const L = land[r];
    if (!L.length) return;
    const dmin = (q: number, ps: number[]) => Math.min(...ps.map((p) => Math.hypot(at(p).x - at(q).x, at(p).y - at(q).y)));
    const picked = [L[Math.floor(rnd() * L.length)]];
    const n = Math.min(L.length, rv.units ?? Math.min(3, Math.max(1, Math.round(L.length / 14))));
    while (picked.length < n) picked.push(L.reduce((b, q) => (dmin(q, picked) > dmin(b, picked) ? q : b)));
    for (const p of picked) { const c = at(p); foes.push({ x: c.x, y: c.y, r, home: p, dead: -1 }); foeTypes.push(rv.type ?? 'fanteria'); }
  });
  const defending = new Set<number>();
  const conquer = (p: number, t: number, siege: boolean) => {
    tick.set(p, t);
    front.delete(p);
    for (const q of adj.get(p)!) if (!tick.has(q)) front.add(q);
    conquests.push({ t, p, siege });
    const r = rivalOf[p];
    if (r < 0) return;
    const rest = land[r].filter((i) => !tick.has(i));
    foes.forEach((o, fi) => {
      if (o.dead >= 0 || o.r !== r || o.home !== p) return;
      if (rest.length) o.home = rest.reduce((b, q) => (Math.hypot(at(q).x - o.x, at(q).y - o.y) < Math.hypot(at(b).x - o.x, at(b).y - o.y) ? q : b));
      else { o.dead = t; deaths.push({ t, f: fi }); }
    });
    if (!rest.length) fallen.push(t);
  };
  const REACH = 90; // pixel-mondo: più lontano un reparto non va a prendere province (prima correvano tutti all'ultimo fronte)
  const near = (p: number) => { const c = at(p); return Math.min(...units.map((u) => Math.hypot(c.x - u.x, c.y - u.y))); };
  // guarnigione (Nico: "truppe stazionate sparse nell'impero"): una provincia già presa lontana dalle mete degli altri reparti
  // (oltre 60 conta solo la vicinanza), non troppo lontana da lui
  const dest = (o: (typeof units)[number]) => (o.tgt >= 0 ? at(o.tgt) : o.post >= 0 ? at(o.post) : o);
  const pickPost = (u: (typeof units)[number]) => {
    let bs = -Infinity;
    for (const p of tick.keys()) {
      const c = at(p);
      let m = Infinity;
      for (const o of units) if (o !== u) { const d = dest(o); m = Math.min(m, Math.hypot(c.x - d.x, c.y - d.y)); }
      const sc = Math.min(m, 60) - 0.25 * Math.hypot(c.x - u.x, c.y - u.y);
      if (sc > bs) { bs = sc; u.post = p; }
    }
  };
  // dopo l'ultima provincia i reparti finiscono di andare alle guarnigioni (al più 400 passi)
  let t = 0, Tc = 0, settle = 0;
  for (; t < 50_000; t++) {
    const done = tick.size >= ids.length;
    if (done && !Tc) Tc = t;
    if (done && (++settle > 400 || units.every((u) => u.post < 0 || (u.x === at(u.post).x && u.y === at(u.post).y)))) break;
    const open = [...front].filter((p) => !claimed.has(p));
    // rinforzo: si schiera sul proprio territorio accanto al tratto di confine più scoperto (come le pedine in campagna)
    if (t > 0 && t % A.every === 0 && units.length < A.max && open.length) {
      const p = open.reduce((b, q) => (near(q) > near(b) ? q : b));
      const base = adj.get(p)!.filter((q) => tick.has(q)).reduce((b, q) => (b < 0 || Math.hypot(at(q).x - at(p).x, at(q).y - at(p).y) < Math.hypot(at(b).x - at(p).x, at(b).y - at(p).y) ? q : b), -1);
      spawn();
      spawns.push(t);
      const c = at(base >= 0 ? base : start), u = units[units.length - 1];
      u.x = c.x; u.y = c.y;
    }
    units.forEach((u, ui) => {
      if (u.sg >= 0) { // assedio in corso: colpi se il difensore è vicino
        const o = u.foe >= 0 ? foes[u.foe] : null;
        if (o && o.dead < 0 && (t - u.t0) % 8 === 0 && Math.hypot(o.x - u.x, o.y - u.y) < 40) shots.push({ t, u: ui, f: u.foe });
        if (--u.sg > 0) return;
        defending.delete(u.foe);
        conquer(u.tgt, t, true);
        u.tgt = -1; u.sg = -1; u.foe = -1;
        return;
      }
      if (u.tgt < 0) {
        let bd = REACH;
        for (const p of open) {
          if (claimed.has(p)) continue;
          const c = at(p), d = Math.hypot(c.x - u.x, c.y - u.y) * noise.get(p)!;
          if (d < bd) { bd = d; u.tgt = p; }
        }
        if (u.tgt >= 0) { claimed.add(u.tgt); u.post = -1; } else if (u.post < 0) pickPost(u);
      }
      const goal = u.tgt >= 0 ? u.tgt : u.post;
      if (goal < 0) return;
      const c = at(goal), dx = c.x - u.x, dy = c.y - u.y, d = Math.hypot(dx, dy);
      const stop = u.tgt >= 0 && rivalOf[u.tgt] >= 0 ? 9 : 0; // provincia di un popolo: ci si ferma al bordo e si assedia
      if (d > Math.max(u.v, stop)) { u.x += (dx / d) * u.v; u.y += (dy / d) * u.v; return; }
      if (u.tgt < 0) { u.x = c.x; u.y = c.y; return; } // arrivato alla guarnigione
      if (stop) {
        let fi = -1, fd = 90;
        foes.forEach((o, i) => {
          if (o.dead >= 0 || o.r !== rivalOf[u.tgt] || defending.has(i)) return;
          const dd = Math.hypot(o.x - c.x, o.y - c.y);
          if (dd < fd) { fd = dd; fi = i; }
        });
        if (fi >= 0) { defending.add(fi); foes[fi].home = u.tgt; }
        u.foe = fi; u.t0 = t; u.sg = Math.round(SIEGE * (fi >= 0 ? 1.7 : 1));
        sieges.push({ p: u.tgt, t0: t, t1: t + u.sg });
        return;
      }
      u.x = c.x; u.y = c.y;
      conquer(u.tgt, t, false);
      u.tgt = -1;
    });
    // i reparti dei popoli vanno verso la loro provincia (posto o difesa)
    for (const o of foes) {
      if (o.dead >= 0) continue;
      const c = at(o.home), dx = c.x - o.x, dy = c.y - o.y, d = Math.hypot(dx, dy);
      if (d > 0.45) { o.x += (dx / d) * 0.45; o.y += (dy / d) * 0.45; } else { o.x = c.x; o.y = c.y; }
    }
    // nessuno in cammino e confine ancora aperto fuori portata: ci va comunque il reparto più vicino (se no si ferma tutto)
    const left = [...front].filter((p) => !claimed.has(p));
    if (left.length && units.every((u) => u.tgt < 0)) {
      let bu = units[0], bp = left[0], bd = Infinity;
      for (const u of units) for (const p of left) { const d = Math.hypot(at(p).x - u.x, at(p).y - u.y); if (d < bd) { bd = d; bu = u; bp = p; } }
      bu.tgt = bp;
      bu.post = -1;
      claimed.add(bp);
    }
    const tr = new Float32Array(A.max * 2).fill(NaN);
    units.forEach((u, i) => { tr[i * 2] = u.x; tr[i * 2 + 1] = u.y; });
    tracks.push(tr);
    const ft = new Float32Array(foes.length * 2).fill(NaN);
    foes.forEach((o, i) => { if (o.dead < 0) { ft[i * 2] = o.x; ft[i * 2 + 1] = o.y; } });
    ftracks.push(ft);
  }
  if (!Tc) Tc = t;
  const T = Math.max(2, tracks.length);
  for (const [p, tk] of tick) born.set(p, p === start ? 0 : Math.round((HOLD0 + (tk / Math.max(1, Tc - 1)) * FILL) * FPS));
  return { tracks, types, T, Tc, ftracks, foeTypes, foeRival: foes.map((o) => o.r), spawns, conquests, sieges, shots, deaths, fallen };
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
    const mixN = (a: number, b: number, t: number) => { const c = C.Interpolate.ColorWithColor(C.ValueToColor(a), C.ValueToColor(b), 100, t); return C.GetColor(c.r, c.g, c.b); };
    const mix = (a: number, b: number, t: number) => hex(mixN(a, b, t));
    const fill = hex(f.fill);
    // popoli rivali come le fazioni in campagna: confine schiarito (dal bordo da milizia), costa scurita, fronte tratteggiato
    const rivalFill = (E.rivals ?? []).map((r) => hex(r.color));
    const edges: Record<string, string> = { [fill]: mix(f.border, 0xffffff, 55) }, coasts: Record<string, string> = { [fill]: mix(f.fill, 0x000000, 50) };
    (E.rivals ?? []).forEach((r, i) => { edges[rivalFill[i]] = mix(mixN(r.color, 0xffffff, 55), 0xffffff, 55); coasts[rivalFill[i]] = mix(r.color, 0x000000, 50); });
    const owned = new Uint8Array(provs.length);
    const got = (k: number) => {
      const t = Math.min(Math.max((k / FPS - HOLD0) / FILL, 0), 1);
      return Math.max(1, Math.round((ord.length * (1 - Math.cos(Math.PI * t))) / 2));
    };
    const tilt = E.follow ? makeTilt(this.game.canvas, CW / 2, CH / 2, CW, CH)
      : makeTilt(this.game.canvas, (aimX - X0) * ZOOM, (aimY - Y0) * ZOOM, (CW * ZOOM) / ZR, (CH * ZOOM) / ZR);
    // fotogramma in cui ogni provincia diventa dell'impero
    const born = new Map<number, number>();
    let army: ReturnType<typeof campaign> | null = null;
    if (E.army) army = campaign(E.army, born);
    else for (let k = FPS * SEC - 1; k >= 0; k--) for (const p of ord.slice(0, got(k))) born.set(p, k);
    // camera che segue: inquadra le province prese (con un po' di anticipo), parte vicina alla capitale e si allarga fino a
    // tutto l'impero. Percorso calcolato prima e ammorbidito (media gaussiana su ~1 s, avanti e indietro): seguire il riquadro
    // fotogramma per fotogramma dava uno scatto a ogni provincia lontana (Nico: "camera che trema"). Lo zoom solo si allarga
    const N = FPS * SEC, camZ: number[] = [], camX: number[] = [], camY: number[] = [];
    if (E.follow) {
      const pad = 25, LOOK = 20, ZCLOSE = 8;
      const seq = [...born].sort((a, b) => a[1] - b[1]), lz: number[] = [], rx: number[] = [], ry: number[] = [];
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, n = 0;
      for (let k = 0; k < N; k++) {
        for (; n < seq.length && seq[n][1] <= k + LOOK; n++) {
          const c = at(seq[n][0]);
          x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x); y0 = Math.min(y0, c.y); y1 = Math.max(y1, c.y);
        }
        const fit = Math.min((VW * 0.8) / SCALE / (x1 - x0 + 2 * pad), (VH * 0.7) / SCALE / ((y1 - y0 + 2 * pad) * Math.cos(T)));
        lz.push(Math.log(Math.min(ZCLOSE, Math.max(ZOOM, fit), k ? Math.exp(lz[k - 1]) : ZCLOSE)));
        rx.push((x0 + x1) / 2);
        ry.push((y0 + y1) / 2);
      }
      const blur = (a: number[], sg: number) => a.map((_, k) => {
        let sum = 0, w = 0;
        for (let j = -3 * sg; j <= 3 * sg; j++) { const e = Math.exp(-(j * j) / (2 * sg * sg)); sum += a[Math.min(N - 1, Math.max(0, k + j))] * e; w += e; }
        return sum / w;
      });
      camZ.push(...blur(lz, 20).map(Math.exp));
      camX.push(...blur(rx, 30));
      camY.push(...blur(ry, 30));
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
    // esercito: pedine dai passi della campagna; per mare (casella d'acqua sotto) diventano navi
    const soldiers = (army?.types ?? []).map((type) => {
      const g = this.add.graphics().setDepth(2).setVisible(false), ship = this.add.graphics().setDepth(2).setVisible(false);
      drawUnitSymbol(g, type, true, 0xf2f2f2);
      drawUnitSymbol(ship, 'cannoniera', true, 0xf2f2f2);
      return { g, ship };
    });
    // reparti dei popoli: rombo del loro colore, come i nemici in campagna
    const foeG = (army?.foeTypes ?? []).map((type, i) => {
      const g = this.add.graphics().setDepth(2).setVisible(false);
      drawUnitSymbol(g, type, false, E.rivals![army!.foeRival[i]].color);
      return g;
    });
    const posU: { x: number; y: number }[] = [], posF: ({ x: number; y: number } | null)[] = []; // posizioni del fotogramma (per i colpi)
    const onSea = (x: number, y: number) => { const i = pixelToIndex(x, y); return i < 0 || world.tileProv[i] < 0; };
    const march = (k: number) => {
      const sc = E.follow ? U / zoomAt(k) : 1 / ZOOM; // misura del gioco: 26 punti sullo schermo
      if (army) {
        const tk = Math.min(Math.max((k / FPS - HOLD0) / FILL, 0) * (army.Tc - 1), army.T - 1), i0 = Math.floor(tk), i1 = Math.min(i0 + 1, army.T - 1), f = tk - i0;
        const a = army.tracks[i0], b = army.tracks[i1];
        soldiers.forEach(({ g, ship }, i) => {
          if (Number.isNaN(b[i * 2])) { g.setVisible(false); ship.setVisible(false); return; }
          const x = Number.isNaN(a[i * 2]) ? b[i * 2] : a[i * 2] + (b[i * 2] - a[i * 2]) * f;
          const y = Number.isNaN(a[i * 2]) ? b[i * 2 + 1] : a[i * 2 + 1] + (b[i * 2 + 1] - a[i * 2 + 1]) * f;
          const sea = onSea(x, y);
          posU[i] = { x, y };
          for (const o of [g, ship]) o.setPosition(x, y).setScale(sc);
          g.setVisible(!sea);
          ship.setVisible(sea);
        });
        const fa = army.ftracks[i0], fb = army.ftracks[i1];
        foeG.forEach((g, i) => {
          if (Number.isNaN(fa[i * 2]) || Number.isNaN(fb[i * 2])) { g.setVisible(false); posF[i] = null; return; }
          const x = fa[i * 2] + (fb[i * 2] - fa[i * 2]) * f, y = fa[i * 2 + 1] + (fb[i * 2 + 1] - fa[i * 2 + 1]) * f;
          posF[i] = { x, y };
          g.setPosition(x, y).setScale(sc).setVisible(true);
        });
      }
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
    // effetti come in campagna: anello d'assalto con le sciabole, lampo a quadratini sulla provincia presa (con scintille dopo un
    // assedio), colpi tracciati tra assediante e difensore, scoppio quando cade l'ultimo reparto di un popolo
    const fx = this.add.graphics().setDepth(3), rings = this.add.graphics().setDepth(1.9);
    const fr = (t: number) => Math.round((HOLD0 + (t / Math.max(1, (army?.Tc ?? 2) - 1)) * FILL) * FPS);
    const sieges = (army?.sieges ?? []).map((g) => ({ p: g.p, f0: fr(g.t0), f1: fr(g.t1) }));
    const wins = (army?.conquests ?? []).map((c) => ({ p: c.p, siege: c.siege, f: fr(c.t) }));
    const shotsF = (army?.shots ?? []).map((h) => ({ u: h.u, fo: h.f, f: fr(h.t) }));
    const deathsF = (army?.deaths ?? []).map((d) => { const tr = army!.ftracks[Math.max(0, d.t - 1)]; return { x: tr[d.f * 2], y: tr[d.f * 2 + 1], f: fr(d.t), sd: d.f }; });
    const hash = (n: number) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
    const spots = new Map<number, { x: number; y: number; d: number }[]>();
    const flash = (p: number, age: number, F: number, from: number, s: number) => {
      const sh = shapes.provinces[p];
      if (!sh?.parts.length) return;
      const cell = 6 * s; // un quadratino ≈ 6 punti sullo schermo
      let pts = spots.get(p);
      if (!pts) {
        pts = [];
        const n = Math.min(36, Math.max(8, Math.round(((sh.x1 - sh.x0) * (sh.y1 - sh.y0)) / (cell * cell * 6))));
        for (let j = 0; j < n * 4 && pts.length < n; j++) {
          const x = sh.x0 + hash(p * 131 + j) * (sh.x1 - sh.x0), y = sh.y0 + hash(p * 137 + j + 0.5) * (sh.y1 - sh.y0), i = pixelToIndex(x, y);
          if (i >= 0 && world.tileProv[i] === p) pts.push({ x, y, d: hash(p * 139 + j) * 0.4 * F });
        }
        spots.set(p, pts);
      }
      for (const q of pts) {
        const a = from * (1 - Math.floor(Math.min(1, Math.max(0, (age - q.d) / (0.6 * F))) * 3) / 3); // si spengono a scatti
        if (a > 0) fx.fillStyle(0xffffff, a).fillRect(Math.round(q.x / cell) * cell - cell * 0.35, Math.round(q.y / cell) * cell - cell * 0.35, cell * 0.7, cell * 0.7);
      }
      const t = Math.min(1, age / F);
      fx.lineStyle(1.5 * s, 0xffffff, from * (1 - t) * (1 - t));
      for (const part of sh.parts) fx.strokePoints(Array.from({ length: part.outer.length / 2 }, (_, j) => ({ x: part.outer[2 * j], y: part.outer[2 * j + 1] })), true);
    };
    const burst = (x: number, y: number, age: number, n: number, tint: number, s: number, sd: number) => {
      for (let j = 0; j < n; j++) {
        const h = (m: number) => hash(sd * 977 + j * 31 + m);
        const pr = age / (((320 + h(1) * 200) / 1000) * FPS);
        if (pr >= 1) continue;
        const e = 1 - (1 - pr) ** 3, a = (Math.PI / 4) * Math.floor(h(2) * 8) + (h(3) - 0.5) * 0.4, d = (14 + h(4) * 26) * s, z = (j % 3 === 0 ? 4 : 2.6) * s;
        fx.fillStyle(tint, 1 - e).fillRect(x + Math.cos(a) * d * e - z / 2, y + Math.sin(a) * d * e - z / 2, z, z);
      }
    };
    const effects = (k: number) => {
      const s = (E.follow ? U : 1) / zoomAt(k);
      fx.clear();
      rings.clear();
      for (const g of sieges) {
        if (k < g.f0 || k >= g.f1) continue;
        const { x, y } = at(g.p), r = 13 * s, kk = 6 * s;
        rings.fillStyle(0x000000, 0.8).fillRect(x - r - 2 * s, y - r - 2 * s, 2 * r + 4 * s, 2 * r + 4 * s);
        rectOutline(rings, x - r - 1.25 * s, y - r - 1.25 * s, 2 * r + 2.5 * s, 2 * r + 2.5 * s, 2.5 * s, 0x2a2f36);
        squareProgress(rings, x, y, r, (k - g.f0) / Math.max(1, g.f1 - g.f0), 2.5 * s, f.fill);
        rings.lineStyle(2 * s, 0xf2efe6, 1).lineBetween(x - kk, y - kk, x + kk, y + kk).lineBetween(x + kk, y - kk, x - kk, y + kk);
      }
      for (const w of wins) {
        const age = k - w.f;
        if (age < 0 || age > 18) continue;
        flash(w.p, age, (w.siege ? 0.48 : 0.36) * FPS, w.siege ? 0.75 : 0.5, s);
        if (w.siege) { const c = at(w.p); burst(c.x, c.y, age, 10, 0xf2f2f2, s, w.p); }
      }
      for (const h of shotsF) {
        const age = k - h.f, a = posU[h.u], b = posF[h.fo];
        if (age < 0 || age > 3 || !a || !b) continue;
        fx.lineStyle(1.5 * s, 0xffe08a, 1 - age / 4).lineBetween(a.x, a.y, b.x, b.y);
        fx.fillStyle(0xffffff, 1 - age / 4).fillRect(a.x - 2 * s, a.y - 2 * s, 4 * s, 4 * s);
      }
      for (const d of deathsF) { const age = k - d.f; if (age >= 0 && age <= 18) burst(d.x, d.y, age, 18, 0xffb547, s, 7919 + d.sd); }
    };
    // suoni degli eventi: fotogramma → effetti del gioco
    const soundAt = new Map<number, [Sfx, number][]>();
    const cue = (k: number, n: Sfx, v: number) => { const l = soundAt.get(k) ?? []; l.push([n, v]); soundAt.set(k, l); };
    if (army && E.sound) {
      for (const w of wins) cue(w.f, 'conquer', w.siege ? 0.9 : 0.45);
      for (const g of sieges) cue(g.f0, 'battle', 0.6);
      for (const h of shotsF) cue(h.f, 'shot', 0.5);
      for (const d of deathsF) cue(d.f, 'death', 0.8);
      for (const t of army.fallen) cue(fr(t), 'reward', 0.7);
      for (const t of army.spawns) cue(fr(t), 'deploy', 0.3);
      cue(fr(army.Tc), 'victory', 0.8);
    }
    const set = (k: number) => {
      owned.fill(0);
      for (const [p, kb] of born) if (kb <= k) owned[p] = 1;
      const frame: TermFrame = { view: new Phaser.Geom.Rectangle(0, 0, WORLD_W, WORLD_H), provinces: [], borders: [], labels: [], status: '',
        edges, coasts, front: rivalFill.length ? { own: [fill], war: rivalFill, color: '#e0473a' } : undefined };
      for (let p = 0; p < shapes.provinces.length; p++) {
        if (!shapes.provinces[p].parts.length) continue;
        frame.provinces.push({ id: p, color: owned[p] ? fill : rivalOf[p] >= 0 ? rivalFill[rivalOf[p]] : null, terrain: TERRAIN_IDX[provs[p].terrain] ?? 0 });
      }
      if (E.follow) {
        cam.setZoom(camZ[k] * DPR);
        cam.centerOn(camX[k], camY[k]); // senza arrotondare al pixel: con lo zoom che cambia sempre faceva scattare la carta
      }
      wm.render(frame);
      wm.align(); // livello per lo zoom e riquadri da vicino da preparare
      wm.work(60_000);
      wm.align();
      label(zoomAt(k));
      march(k);
      effects(k);
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
      // suono: musica ed effetti del gioco (sintetizzati) in un contesto audio offline che segue l'orologio del video
      let vt = 0;
      const off = E.sound ? new OfflineAudioContext(2, Math.ceil(48000 * (SEC + 1)), 48000) : null;
      const M = music as unknown as { timer: number; schedule: () => void };
      if (off) {
        Object.defineProperty(off, 'currentTime', { get: () => vt });
        Object.defineProperty(off, 'state', { get: () => 'running' });
        (window as unknown as { AudioContext: unknown }).AudioContext = function () { return off; };
        music.setMode('run');
        music.setIntensity(1);
        clearInterval(M.timer); // le note le programma la registrazione, fotogramma per fotogramma
      }
      const play = (n: Sfx, v: number) => {
        Object.defineProperty(performance, 'now', { value: () => vt * 1000, configurable: true }); // intervalli minimi degli effetti sul tempo del video
        sfx(n, v, false);
        delete (performance as unknown as { now?: unknown }).now;
      };
      const loud = born.size ? [...born.values()].sort((a, b) => a - b)[Math.floor(born.size * 0.25)] : 0; // musica più tesa da un quarto
      const N = FPS * SEC, t0 = performance.now();
      for (let k = 0; k < N; k++) {
        if (off) {
          vt = k / FPS;
          if (k === loud) music.setIntensity(2);
          M.schedule();
          for (const [n, v] of soundAt.get(k) ?? []) play(n, v);
        }
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
      // audio in WAV (16 bit)
      let wav: string | null = null;
      if (off) {
        const ab = await off.startRendering(), n = ab.length, ch = ab.numberOfChannels, dv = new DataView(new ArrayBuffer(44 + n * ch * 2));
        const w = (o: number, t: string) => { for (let i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)); };
        w(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
        dv.setUint16(22, ch, true); dv.setUint32(24, ab.sampleRate, true); dv.setUint32(28, ab.sampleRate * ch * 2, true); dv.setUint16(32, ch * 2, true);
        dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * ch * 2, true);
        const data = Array.from({ length: ch }, (_, c) => ab.getChannelData(c));
        for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) { const v = Math.max(-1, Math.min(1, data[c][i])); dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
        wav = await b64(new Blob([dv.buffer]));
      }
      return { h264: await b64(new Blob(chunks as BlobPart[])), png: await b64(png), wav, ms: Math.round(performance.now() - t0) };
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
