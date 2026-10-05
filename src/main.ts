import Phaser from 'phaser';
import { analytics } from './analytics/analytics';
import { PALETTE } from './config/palette';
import { BootScene } from './scenes/BootScene';
import { CampScene } from './scenes/CampScene';
import { HudScene } from './scenes/HudScene';
import { LoadScene } from './scenes/LoadScene';
import { TreeScene } from './scenes/TreeScene';
import { ResultScene } from './scenes/ResultScene';
import { RunScene } from './scenes/RunScene';
import { DevScene } from './scenes/dev/DevScene';
import { DPR } from './ui/screen';
import { installHotkeys } from './ui/hotkeys';
import { initDevProfile } from './save/devProfiles';

initDevProfile(); // ?profile=nuovo|dopo1|medio|max: sposta il salvataggio su una chiave di prova, prima di tutto
installHotkeys();
import bodyUrl from '@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-500-normal.woff2';
import bodyBoldUrl from '@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-700-normal.woff2';
import titleUrl from '@fontsource/oswald/files/oswald-latin-600-normal.woff2';
import monoUrl from '@fontsource/share-tech-mono/files/share-tech-mono-latin-400-normal.woff2';

analytics.init();

const host = document.getElementById('game')!;
const MIN = 64; // sotto questa misura (riquadro nascosto o in caricamento) WebGL non riesce a creare i framebuffer
const size = () => ({
  w: Math.round((host.clientWidth || window.innerWidth) * DPR),
  h: Math.round((host.clientHeight || window.innerHeight) * DPR),
});

let game: Phaser.Game | null = null;
let fontsReady = false;

/** I testi di Phaser vanno disegnati con i font già caricati, altrimenti restano col font di riserva. */
async function loadFonts() {
  try {
    const faces = [
      new FontFace('Barlow Semi Condensed', `url(${bodyUrl})`, { weight: '500' }),
      new FontFace('Barlow Semi Condensed', `url(${bodyBoldUrl})`, { weight: '700' }),
      new FontFace('Oswald', `url(${titleUrl})`, { weight: '600' }),
      new FontFace('Share Tech Mono', `url(${monoUrl})`, { weight: '400' }),
    ];
    for (const f of await Promise.all(faces.map((x) => x.load()))) document.fonts.add(f);
  } catch {
    /* senza font si usa quello di riserva */
  }
}

function boot() {
  if (!fontsReady) return;
  const { w, h } = size();
  if (w < MIN || h < MIN) return; // aspetta che la pagina abbia una misura vera
  // solo la prima scena dell'elenco si avvia da sola: ?debug=widgets apre la galleria al posto del gioco vero
  const debugWidgets = new URLSearchParams(location.search).get('debug') === 'widgets';
  const scenes = [BootScene, CampScene, RunScene, HudScene, ResultScene, TreeScene, LoadScene, DevScene];
  if (debugWidgets) scenes.unshift(scenes.pop()!); // DevScene (ultima) va in testa
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: PALETTE.inchiostro,
    // canvas a piena densità (DPR×) ridotto a schermo con zoom 1/DPR: nitido sui telefoni
    scale: { mode: Phaser.Scale.NONE, width: w, height: h, zoom: 1 / DPR },
    input: { activePointers: 3 },
    // pixelArt esplicito: con zoom 1/DPR Phaser lo accenderebbe da solo (texture ingrandite a quadretti sui telefoni)
    render: { antialias: true, pixelArt: false },
    scene: scenes,
  });
  // debug/test: accesso al gioco dalla console
  (window as unknown as { __game: Phaser.Game }).__game = game;
  game.events.once('ready', () => {
    document.getElementById('msg')?.remove(); // via la scritta di caricamento
    snapCanvas();
    fit(); // misura cambiata durante l'avvio
  });
}

// verticale o orizzontale: il gioco si adatta allo spazio disponibile (misure a zero = riquadro nascosto, ignorate)
function fit() {
  if (!game) return boot();
  if (!game.isBooted) return; // prima dell'avvio la scala non esiste ancora
  const { w, h } = size();
  if (w < MIN || h < MIN) return;
  if (w !== game.scale.width || h !== game.scale.height) game.scale.resize(w, h);
  snapCanvas();
}

/** Il canvas occupa esattamente i punti CSS del contenitore: niente ricampionamento che sfoca i testi. */
function snapCanvas() {
  if (!game?.canvas) return;
  const cw = host.clientWidth || window.innerWidth, ch = host.clientHeight || window.innerHeight;
  game.canvas.style.width = `${cw}px`;
  game.canvas.style.height = `${ch}px`;
}
new ResizeObserver(fit).observe(host);
window.addEventListener('resize', fit);
loadFonts().finally(() => {
  fontsReady = true;
  boot();
});
