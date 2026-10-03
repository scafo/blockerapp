import Phaser from 'phaser';
import { THEME } from './config/theme';
import { HudScene } from './scenes/HudScene';
import { MapScene } from './scenes/MapScene';
import { DPR } from './ui/screen';

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
    backgroundColor: THEME.sfondo,
    // canvas a piena densità (DPR×) ridotto a schermo con zoom 1/DPR: nitido sui telefoni
    scale: { mode: Phaser.Scale.NONE, width: w, height: h, zoom: 1 / DPR },
    input: { activePointers: 3 },
    render: { antialias: true, powerPreference: 'high-performance' },
    scene: [MapScene, HudScene],
  });
  // debug/test: accesso al gioco dalla console
  (window as unknown as { __game: Phaser.Game }).__game = game;
  game.events.once('ready', () => document.getElementById('msg')?.remove()); // via la scritta di caricamento
}

new ResizeObserver(() => {
  if (!game) return boot();
  const { w, h } = size();
  if (w < MIN || h < MIN) return; // riquadro nascosto: tieni la misura di prima
  if (w !== game.scale.width || h !== game.scale.height) game.scale.resize(w, h);
}).observe(host);
window.addEventListener('resize', () => { if (!game) boot(); });
boot();
