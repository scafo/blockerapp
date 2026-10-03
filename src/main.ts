import Phaser from 'phaser';
import { THEME } from './config/theme';
import { HudScene } from './scenes/HudScene';
import { MapScene } from './scenes/MapScene';
import { DPR } from './ui/screen';

const host = document.getElementById('game')!;
const size = () => ({ w: (host.clientWidth || window.innerWidth) * DPR, h: (host.clientHeight || window.innerHeight) * DPR });

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: THEME.sfondo,
  // canvas a piena densità (DPR×) ridotto a schermo con zoom 1/DPR: nitido sui telefoni
  scale: { mode: Phaser.Scale.NONE, width: size().w, height: size().h, zoom: 1 / DPR },
  input: { activePointers: 3 },
  render: { antialias: true, powerPreference: 'high-performance' },
  scene: [MapScene, HudScene],
});

// debug/test: accesso al gioco dalla console
(window as unknown as { __game: Phaser.Game }).__game = game;

new ResizeObserver(() => {
  const { w, h } = size();
  if (Math.round(w) !== game.scale.width || Math.round(h) !== game.scale.height) game.scale.resize(Math.round(w), Math.round(h));
}).observe(host);

game.events.once('ready', () => document.getElementById('msg')?.remove()); // via la scritta di caricamento
