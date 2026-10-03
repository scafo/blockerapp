import Phaser from 'phaser';
import { PALETTE } from './config/palette';
import { BootScene } from './scenes/BootScene';
import { HudScene } from './scenes/HudScene';
import { RunScene } from './scenes/RunScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: PALETTE.inchiostro,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  input: { activePointers: 3 },
  render: { antialias: true },
  scene: [BootScene, RunScene, HudScene],
});

// debug/test: accesso al gioco dalla console
(window as unknown as { __game: Phaser.Game }).__game = game;

// Solo orizzontale: in verticale su touch il gioco dorme (l'avviso è in index.html).
const portrait = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
const syncOrientation = () => (portrait.matches ? game.loop.sleep() : game.loop.wake());
portrait.addEventListener('change', syncOrientation);
game.events.once('ready', syncOrientation);
