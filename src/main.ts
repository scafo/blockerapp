import Phaser from 'phaser';
import { analytics } from './analytics/analytics';
import { PALETTE } from './config/palette';
import { BootScene } from './scenes/BootScene';
import { CampScene } from './scenes/CampScene';
import { HudScene } from './scenes/HudScene';
import { ResultScene } from './scenes/ResultScene';
import { RunScene } from './scenes/RunScene';
import { DPR } from './ui/screen';

analytics.init();

const host = document.getElementById('game')!;
const MIN = 64; // sotto questa misura (riquadro nascosto o in caricamento) WebGL non riesce a creare i framebuffer
const size = () => ({
  w: Math.round((host.clientWidth || window.innerWidth) * DPR),
  h: Math.round((host.clientHeight || window.innerHeight) * DPR),
});

let game: Phaser.Game | null = null;

function boot() {
  const { w, h } = size();
  if (w < MIN || h < MIN) return; // aspetta che la pagina abbia una misura vera
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: PALETTE.inchiostro,
    // canvas a piena densità (DPR×) ridotto a schermo con zoom 1/DPR: nitido sui telefoni
    scale: { mode: Phaser.Scale.NONE, width: w, height: h, zoom: 1 / DPR },
    input: { activePointers: 3 },
    render: { antialias: true },
    scene: [BootScene, CampScene, RunScene, HudScene, ResultScene],
  });
  // debug/test: accesso al gioco dalla console
  (window as unknown as { __game: Phaser.Game }).__game = game;
  game.events.once('ready', () => {
    document.getElementById('msg')?.remove(); // via la scritta di caricamento
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
}
new ResizeObserver(fit).observe(host);
window.addEventListener('resize', fit);
boot();
