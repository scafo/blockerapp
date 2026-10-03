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
const size = () => ({ w: (host.clientWidth || window.innerWidth) * DPR, h: (host.clientHeight || window.innerHeight) * DPR });

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: PALETTE.inchiostro,
  // canvas a piena densità (DPR×) ridotto a schermo con zoom 1/DPR: nitido sui telefoni
  scale: { mode: Phaser.Scale.NONE, width: size().w, height: size().h, zoom: 1 / DPR },
  input: { activePointers: 3 },
  render: { antialias: true },
  scene: [BootScene, CampScene, RunScene, HudScene, ResultScene],
});

// debug/test: accesso al gioco dalla console
(window as unknown as { __game: Phaser.Game }).__game = game;

// verticale o orizzontale: il gioco si adatta allo spazio disponibile
new ResizeObserver(() => {
  const { w, h } = size();
  if (Math.round(w) !== game.scale.width || Math.round(h) !== game.scale.height) game.scale.resize(Math.round(w), Math.round(h));
}).observe(host);

game.events.once('ready', () => document.getElementById('msg')?.remove()); // via la scritta di caricamento
