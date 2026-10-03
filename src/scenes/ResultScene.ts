import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { PALETTE } from '../config/palette';
import bulletins from '../data/bulletins.json';
import { RESOURCES, RESOURCE_INFO, addBag } from '../game/resources';
import type { RunSummary } from '../game/RunState';
import { loadProfile, saveProfile } from '../save/storage';
import { Button } from '../ui/Button';
import { drawResourceIcon } from '../ui/resourceIcons';
import { textStyle } from '../ui/style';

const TITLES: Record<RunSummary['outcome'], string> = {
  victory: 'VITTORIA',
  retreat: 'RITIRATA',
  eliminated: 'ELIMINATO',
  storm: 'TRAVOLTO DALLA CENERE',
};

const REASONS = { map: 'Impero sul 60% della regione', anomalies: '3 anomalie in mano tua', storm: 'Più territorio alla fine della tempesta', tutorial: 'Il primo pezzo di mondo è tuo' };

/** Schermata finale stile manifesto: esito, bollettino radio, bottino portato a casa, rivincita. */
export class ResultScene extends Phaser.Scene {
  constructor() {
    super('Result');
  }

  create(sum: RunSummary) {
    const profile = loadProfile();
    profile.stash = addBag(profile.stash, sum.kept);
    profile.runs++;
    if (sum.outcome === 'victory') profile.wins++;
    profile.bestTiles = Math.max(profile.bestTiles, sum.maxTiles);
    saveProfile(profile);

    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(PALETTE.inchiostro);
    const W = Math.min(600, width - 32), H = Math.min(340, height - 24);
    const x0 = (width - W) / 2, y0 = (height - H) / 2;
    this.add.rectangle(x0, y0, W, H, PALETTE.carta).setOrigin(0).setStrokeStyle(4, PALETTE.ocra);
    const cx = width / 2;
    const ink = PALETTE.inchiostro;

    this.add.text(x0 + 16, y0 + 12, `BOLLETTINO N° ${profile.runs}`, textStyle(11, PALETTE.ruggine));
    this.add.text(x0 + W - 16, y0 + 12, `mappa #${sum.seed}`, textStyle(11, PALETTE.ruggine, false)).setOrigin(1, 0);
    const color = sum.outcome === 'victory' ? 0x1e7a62 : sum.outcome === 'retreat' ? ink : PALETTE.ruggine;
    const title = this.add.text(cx, y0 + 46, TITLES[sum.outcome], textStyle(34, color)).setOrigin(0.5);
    this.tweens.add({ targets: title, scale: { from: 1.4, to: 1 }, duration: 300, ease: 'Back.easeOut' });
    const lines = bulletins[sum.outcome];
    const line = sum.reason ? `${REASONS[sum.reason]}. ` : '';
    this.add.text(cx, y0 + 80, line + lines[Math.floor(Math.random() * lines.length)], textStyle(13, ink, false))
      .setOrigin(0.5, 0).setAlign('center').setWordWrapWidth(W - 48);

    const sec = Math.floor(sum.timeMs / 1000);
    this.add.text(cx, y0 + 136, `TERRITORIO MAX ${sum.maxTiles}   ·   TEMPO ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}   ·   ANOMALIE ${sum.anomalies}`,
      textStyle(13, ink)).setOrigin(0.5);

    // bottino: portato a casa (e quanto zaino c'era, se è cambiato)
    const delta = sum.outcome === 'victory' ? `+${BALANCE.victory.bonus * 100}% vittoria`
      : sum.outcome === 'retreat' ? '' : `-${BALANCE.end.eliminatedLoss * 100}% perso`;
    this.add.text(cx, y0 + 162, `BOTTINO PORTATO A CASA${delta ? `  (${delta})` : ''}`, textStyle(11, PALETTE.ruggine)).setOrigin(0.5);
    const g = this.add.graphics();
    RESOURCES.forEach((r, k) => {
      const x = cx + (k - 1) * 150;
      drawResourceIcon(g, r, x - 46, y0 + 192, 8);
      this.add.text(x - 32, y0 + 192, `${sum.kept[r]}`, textStyle(22, ink)).setOrigin(0, 0.5);
      const note = sum.kept[r] !== sum.backpack[r] ? ` / ${sum.backpack[r]}` : '';
      this.add.text(x - 32, y0 + 210, `${RESOURCE_INFO[r].name.toLowerCase()}${note}`, textStyle(10, ink, false)).setOrigin(0, 0.5);
    });
    const s = profile.stash;
    this.add.text(cx, y0 + 236, `Scorta dell'accampamento: ${s.rottami} rottami · ${s.carburante} carburante · ${s.viveri} viveri`,
      textStyle(11, ink, false)).setOrigin(0.5);

    const again = new Button(this, 'RIVINCITA STESSA MAPPA', 250, 46, () => this.scene.start('Run', { seed: sum.seed }));
    const fresh = new Button(this, 'ACCAMPAMENTO', 170, 46, () => this.scene.start('Camp'));
    const bw = 250 + 12 + 170;
    again.setPosition(cx - bw / 2, y0 + H - 46 - 16);
    fresh.setPosition(cx - bw / 2 + 262, y0 + H - 46 - 16);
    if (sum.tutorial) {
      // dopo la run guidata si va a scoprire l'accampamento (la rivincita genererebbe un'altra mappa)
      again.destroy();
      fresh.setPosition(cx - 85, y0 + H - 46 - 16);
      this.tweens.add({ targets: fresh, scale: 1.06, duration: 600, yoyo: true, repeat: -1 });
    }
  }
}
