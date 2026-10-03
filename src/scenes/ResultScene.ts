import Phaser from 'phaser';
import { PALETTE } from '../config/palette';
import bulletins from '../data/bulletins.json';
import { RESOURCES, RESOURCE_INFO, addBag, bagTotal } from '../game/resources';
import type { RunSummary } from '../game/RunState';
import { loadProfile, saveProfile } from '../save/storage';
import { analytics } from '../analytics/analytics';
import { Button } from '../ui/Button';
import { drawResourceIcon } from '../ui/resourceIcons';
import { textStyle } from '../ui/style';
import { uiCamera, view } from '../ui/screen';

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
    uiCamera(this);
    const profile = loadProfile();
    profile.stash = addBag(profile.stash, sum.kept);
    profile.runs++;
    if (sum.outcome === 'victory') profile.wins++;
    profile.bestTiles = Math.max(profile.bestTiles, sum.maxTiles);
    saveProfile(profile);
    analytics.runEnd(sum.outcome, sum.reason, sum.maxTiles, sum.timeMs, sum.seed);
    analytics.resources('source', sum.kept, 'run', sum.outcome);

    const { width, height, portrait: P } = view(this);
    this.cameras.main.setBackgroundColor(PALETTE.inchiostro);
    // verticale: scheda alta con tutto in colonna; orizzontale: scheda larga
    const W = Math.min(600, width - 32), H = P ? Math.min(520, height - 24) : Math.min(340, height - 24);
    const x0 = (width - W) / 2, y0 = (height - H) / 2;
    this.add.rectangle(x0, y0, W, H, PALETTE.carta).setOrigin(0).setStrokeStyle(4, PALETTE.ocra);
    const cx = width / 2;
    const ink = PALETTE.inchiostro;

    this.add.text(x0 + 16, y0 + 12, `BOLLETTINO N° ${profile.runs}`, textStyle(11, PALETTE.ruggine));
    this.add.text(x0 + W - 16, y0 + 12, `mappa #${sum.seed}`, textStyle(11, PALETTE.ruggine, false)).setOrigin(1, 0);
    const color = sum.outcome === 'victory' ? 0x1e7a62 : sum.outcome === 'retreat' ? ink : PALETTE.ruggine;
    const title = this.add.text(cx, y0 + 50, TITLES[sum.outcome], textStyle(P ? 26 : 34, color)).setOrigin(0.5)
      .setAlign('center').setWordWrapWidth(W - 24);
    this.tweens.add({ targets: title, scale: { from: 1.4, to: 1 }, duration: 300, ease: 'Back.easeOut' });
    const lines = bulletins[sum.outcome];
    const line = sum.reason ? `${REASONS[sum.reason]}. ` : '';
    const bulletin = this.add.text(cx, y0 + (P ? 82 : 80), line + lines[Math.floor(Math.random() * lines.length)], textStyle(13, ink, false))
      .setOrigin(0.5, 0).setAlign('center').setWordWrapWidth(W - 40);

    const sec = Math.floor(sum.timeMs / 1000);
    const time = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    let y = P ? bulletin.y + bulletin.height + 22 : y0 + 136;
    this.add.text(cx, y, P ? `TERRITORIO MAX ${sum.maxTiles}\nTEMPO ${time} · ANOMALIE ${sum.anomalies}`
      : `TERRITORIO MAX ${sum.maxTiles}   ·   TEMPO ${time}   ·   ANOMALIE ${sum.anomalies}`, textStyle(13, ink)).setOrigin(0.5).setAlign('center');

    // bottino: portato a casa (e quanto zaino c'era, se è cambiato: bonus vittoria o perdita, Magazzino incluso)
    const had = bagTotal(sum.backpack), kept = bagTotal(sum.kept);
    const pct = had ? Math.round((kept / had - 1) * 100) : 0;
    const delta = pct > 0 ? `+${pct}% vittoria` : pct < 0 ? `${pct}% perso` : '';
    y += P ? 46 : 26;
    this.add.text(cx, y, `BOTTINO PORTATO A CASA${delta ? `  (${delta})` : ''}`, textStyle(11, PALETTE.ruggine)).setOrigin(0.5);
    const g = this.add.graphics();
    RESOURCES.forEach((r, k) => {
      // verticale: una risorsa per riga; orizzontale: tre colonne
      const x = P ? cx - 70 : cx + (k - 1) * Math.min(150, (W - 40) / 3);
      const ry = P ? y + 32 + k * 40 : y + 30;
      drawResourceIcon(g, r, x - 46 + (P ? 30 : 0), ry, 8);
      this.add.text(x - 32 + (P ? 30 : 0), ry, `${sum.kept[r]}`, textStyle(22, ink)).setOrigin(0, 0.5);
      const note = sum.kept[r] !== sum.backpack[r] ? ` / ${sum.backpack[r]}` : '';
      this.add.text(x - 32 + (P ? 30 : 0) + (P ? 60 : 0), ry + (P ? 0 : 18), `${RESOURCE_INFO[r].name.toLowerCase()}${note}`, textStyle(P ? 12 : 10, ink, false))
        .setOrigin(0, 0.5);
    });
    y += P ? 32 + 3 * 40 + 6 : 74;
    const s = profile.stash;
    this.add.text(cx, y, `Scorta dell'accampamento: ${s.rottami} rottami · ${s.carburante} carburante · ${s.viveri} viveri`,
      textStyle(11, ink, false)).setOrigin(0.5).setAlign('center').setWordWrapWidth(W - 32);

    // pulsanti: affiancati in orizzontale, impilati e larghi in verticale (comodi col pollice)
    const bw1 = P ? W - 32 : 250, bw2 = P ? W - 32 : 170;
    const again = new Button(this, 'RIVINCITA STESSA MAPPA', bw1, 46, () => {
      analytics.design(['run', 'rivincita', sum.outcome]); // % rivincita dopo una sconfitta
      this.scene.start('Run', { seed: sum.seed });
    });
    const fresh = new Button(this, 'ACCAMPAMENTO', bw2, 46, () => this.scene.start('Camp'));
    if (P) {
      again.setPosition(x0 + 16, y0 + H - 46 - 16 - 46 - 10);
      fresh.setPosition(x0 + 16, y0 + H - 46 - 16);
    } else {
      const bw = bw1 + 12 + bw2;
      again.setPosition(cx - bw / 2, y0 + H - 46 - 16);
      fresh.setPosition(cx - bw / 2 + bw1 + 12, y0 + H - 46 - 16);
    }
    if (sum.tutorial) {
      // dopo la run guidata si va a scoprire l'accampamento (la rivincita genererebbe un'altra mappa)
      again.destroy();
      fresh.setPosition(cx - bw2 / 2, y0 + H - 46 - 16);
      this.tweens.add({ targets: fresh, scale: 1.06, duration: 600, yoyo: true, repeat: -1 });
    }
  }
}
