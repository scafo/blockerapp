import Phaser from 'phaser';
import { PALETTE } from '../config/palette';
import { buildLandMask } from '../map/landMask';
import { buildCountryMap } from '../map/countries';
import { randomSeed } from '../map/rng';
import { loadProfile } from '../save/storage';
import { textStyle } from '../ui/style';
import { uiCamera, view } from '../ui/screen';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create() {
    uiCamera(this);
    const { width, height } = view(this);
    this.cameras.main.setBackgroundColor(0x010604);
    // avvio da terminale (Figma, "Loading screens"): righe che compaiono una alla volta
    const lines = ['> ASHEN ATLAS // TERMINALE DI COMANDO', '> COLLEGAMENTO SATELLITARE ........ OK', '> RICOSTRUZIONE CARTOGRAFICA DOPO LA CADUTA ...'];
    const x = Math.max(16, width / 2 - 220), y0 = height / 2 - 40;
    lines.forEach((l, k) => {
      const t = this.add.text(x, y0 + k * 20, l, textStyle(13, k === 0 ? PALETTE.carta : PALETTE.ocra, false)).setAlpha(0);
      this.tweens.add({ targets: t, alpha: 1, delay: k * 120, duration: 60 });
    });
    const cursor = this.add.text(x, y0 + lines.length * 20, '_', textStyle(13, PALETTE.ocra, false));
    this.tweens.add({ targets: cursor, alpha: 0, duration: 380, yoyo: true, repeat: -1 });

    const g = this.add.graphics().fillStyle(0xffffff).fillRect(0, 0, 6, 6);
    g.generateTexture('dot', 6, 6).destroy();

    // Lascia disegnare il testo di caricamento prima del calcolo (sincrono).
    this.time.delayedCall(420, () => {
      const mask = buildLandMask();
      this.registry.set('landMask', mask);
      this.registry.set('countries', buildCountryMap(mask)); // nazioni reali per province e confini
      // ?seed=... salta l'accampamento e apre subito quella mappa (test e rivincite condivise)
      const seed = new URLSearchParams(location.search).get('seed');
      if (seed) this.scene.start('Run', { seed });
      else if (loadProfile().runs === 0) this.scene.start('Run', { seed: randomSeed() }); // prima volta: subito in azione (run guidata)
      else this.scene.start('Camp');
    });
  }
}
