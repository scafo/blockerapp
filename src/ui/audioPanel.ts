// Impostazioni audio (Nico): volume della musica e degli effetti, vibrazione, muto. Restano tra le partite.
// Pannello piccolo sotto il tasto che lo apre; stile della carta da terminale in campagna, della base nell'HQ.
import Phaser from 'phaser';
import { PALETTE } from '../config/palette';
import { audioSettings, setAudio } from '../audio/engine';
import { sfx } from '../audio/sfx';
import { TCOL, termStyle } from './terminal';
import { textStyle } from './style';

const STEPS = 10;

export function openAudioPanel(scene: Phaser.Scene, x: number, y: number, look: 'term' | 'camp'): Phaser.GameObjects.Container {
  const W = 236, RH = 34, H = 26 + RH * 4 + 6;
  const bgCol = look === 'term' ? TCOL.bg : PALETTE.inchiostro, ink = look === 'term' ? TCOL.text : PALETTE.carta;
  const dim = look === 'term' ? TCOL.label : PALETTE.tenue, edge = look === 'term' ? TCOL.edge : PALETTE.carta;
  const font = (size: number, c: number) => (look === 'term' ? termStyle(size, c) : textStyle(size, c, false));
  const box = scene.add.container(x, y).setDepth(60);
  const draw = () => {
    box.removeAll(true);
    const s = audioSettings();
    const bg = scene.add.rectangle(0, 0, W, H, bgCol, 0.96).setOrigin(0).setStrokeStyle(1, edge, 0.6).setInteractive();
    box.add([bg, scene.add.text(12, 8, 'AUDIO', font(11, dim))]);
    const g = scene.add.graphics();
    box.add(g);
    const btn = (bx: number, by: number, w: number, label: string, run: () => void) => {
      const r = scene.add.rectangle(bx, by, w, 24, bgCol).setOrigin(0).setStrokeStyle(1, edge, 0.8).setInteractive({ useHandCursor: true });
      r.on('pointerup', () => { run(); draw(); });
      box.add([r, scene.add.text(bx + w / 2, by + 12, label, font(13, ink)).setOrigin(0.5)]);
    };
    // volume a tacche: [−] ▮▮▮▮▯▯ [+]
    const vol = (row: number, label: string, key: 'music' | 'sfx') => {
      const yy = 26 + row * RH, v = Math.round(s[key] * STEPS);
      box.add(scene.add.text(12, yy + 5, label, font(13, ink)));
      btn(92, yy, 24, '−', () => { setAudio({ [key]: Math.max(0, v - 1) / STEPS }); if (key === 'sfx') sfx('click'); });
      for (let k = 0; k < STEPS; k++) g.fillStyle(k < v ? ink : dim, k < v ? 1 : 0.3).fillRect(122 + k * 8, yy + 6, 6, 12);
      btn(W - 36, yy, 24, '+', () => { setAudio({ [key]: Math.min(STEPS, v + 1) / STEPS }); if (key === 'sfx') sfx('click'); });
    };
    const toggle = (row: number, label: string, on: boolean, run: () => void) => {
      const yy = 26 + row * RH;
      box.add(scene.add.text(12, yy + 5, label, font(13, ink)));
      btn(W - 72, yy, 60, on ? 'SÌ' : 'NO', run);
    };
    vol(0, 'Musica', 'music');
    vol(1, 'Effetti', 'sfx');
    toggle(2, 'Vibrazione', s.vibration, () => setAudio({ vibration: !s.vibration }));
    toggle(3, 'Muto', s.muted, () => setAudio({ muted: !s.muted }));
  };
  draw();
  return box;
}
