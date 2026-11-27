import { music } from '../audio/music';
import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { PALETTE } from '../config/palette';
import bulletins from '../data/bulletins.json';
import { RESOURCES, RESOURCE_INFO, bagTotal } from '../game/resources';
import { stashCap } from '../game/camp';
import { applyRunResult } from '../game/progress';
import type { RunSummary } from '../game/RunState';
import { loadProfile } from '../save/storage';
import { profileStore } from '../save/profileStore';
import { analytics } from '../analytics/analytics';
import { Button } from '../ui/Button';
import { OPS, body, label, panel, resIcon, resPhoto, rule, tech, value } from '../ui/ops';
import { uiCamera, view } from '../ui/screen';
import { civImage, coverImage, fade } from '../ui/images';

const TITLES: Record<RunSummary['outcome'], string> = {
  victory: 'Victory',
  retreat: 'Retreat',
  eliminated: 'Eliminated',
  timeout: 'End of operations',
};

const REASONS = { map: 'The three rival empires have fallen', time: 'The most provinces at the end of the campaign', tutorial: 'The first piece of the world is yours', dominance: 'Twice the provinces of the strongest empire, held for a minute', share: 'Eighty percent of the world is yours' };

/** Rapporto di fine campagna: a sinistra l'esito e la campagna, a destra il bottino portato a casa con le foto, in basso
 *  a destra TORNA ALLA BASE e la rivincita. */
export class ResultScene extends Phaser.Scene {
  constructor() {
    super('Result');
  }

  create(sum: RunSummary) {
    uiCamera(this);
    music.setMode('hq'); // dopo la campagna la musica torna quella della base
    const profile = loadProfile();
    // sandbox: partita libera, il profilo non cambia (niente bottino, registro, fronti)
    const { lostCap, unlocked } = sum.sandbox ? { lostCap: 0, unlocked: -1 } : applyRunResult(profile, sum, Date.now());
    if (!sum.sandbox) profileStore.save(profile);
    analytics.runEnd(sum.outcome, sum.reason, sum.maxTiles, sum.timeMs, sum.seed);
    analytics.resources('source', sum.kept, 'run', sum.outcome);

    const { width, height } = view(this);
    this.cameras.main.setBackgroundColor(PALETTE.inchiostro);
    // fondo: la potenza in vittoria, altrimenti la foto del fronte dove si è combattuto (le vecchie immagini del Figma
    // avevano scritte da terminale stampate sopra)
    const bg = sum.outcome === 'victory' ? civImage(sum.civ) : this.textures.exists(`front-${sum.front + 1}`) ? `front-${sum.front + 1}` : 'load-nave';
    coverImage(this, bg, 0, 0, width, height, 0.45).setTint(0xb8c4d0);
    this.add.rectangle(0, 0, width, height, 0x05080d, 0.35).setOrigin(0);
    fade(this, 0, 0, width * 0.62, height, 0x05070a, 0.85, 0, 'h');
    fade(this, 0, height * 0.6, width, height * 0.4, 0x05070a, 0, 0.8);
    const g = this.add.graphics();
    const M = Math.max(48, width * 0.04), L = M, R = width - M;
    const roman = ['I', 'II', 'III', 'IV', 'V', 'VI'];
    const civName = sum.civ.charAt(0).toUpperCase() + sum.civ.slice(1);
    const camp = { breve: 'Short', standard: 'Standard', lunga: 'Long' }[sum.campaign] ?? sum.campaign;

    // sinistra: di che campagna si parla (testo semplice, non riquadri che sembrano tasti), esito grande, una frase, due numeri
    let y = M + 8;
    label(this, L, y, `Report from the front, No. ${profile.runs}`, OPS.label, 10);
    label(this, L, y + 18, sum.sandbox ? `Sandbox, ${BALANCE.difficulty[sum.front]?.name ?? ''}, ${civName}` : `Front ${roman[sum.front]}, ${BALANCE.fronts[sum.front].name}, ${civName}, ${camp}`, OPS.body, 11);
    y += 62;
    const tone = sum.outcome === 'victory' ? OPS.gain : sum.outcome === 'retreat' ? PALETTE.allerta : sum.outcome === 'eliminated' ? OPS.loss : OPS.label;
    const colW = Math.min(560, width * 0.42);
    const title = value(this, L - 3, y, TITLES[sum.outcome], 76, tone === OPS.label ? OPS.text : tone).setWordWrapWidth(colW);
    this.tweens.add({ targets: title, alpha: { from: 0, to: 1 }, x: { from: L - 15, to: L - 3 }, duration: 380, ease: 'Quad.easeOut' });
    y += title.height + 6;
    const lines = bulletins[sum.outcome];
    const reason = sum.reason ? `${REASONS[sum.reason]}. ` : '';
    const bul = body(this, L, y, reason + lines[Math.floor(Math.random() * lines.length)], 16, OPS.body, colW);
    y += bul.height + 30;
    const sec = Math.floor(sum.timeMs / 1000);
    ([['Provinces', `${sum.maxProvinces}`], ['Duration', `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`]] as [string, string][]).forEach(([k, v], i) => {
      label(this, L + i * 170, y, k, OPS.label, 11);
      tech(this, L + i * 170, y + 18, v, 34);
    });
    y += 76;
    if (unlocked > 0) {
      label(this, L, y, `New front unlocked, ${roman[unlocked]}, ${BALANCE.fronts[unlocked].name}`, OPS.gain, 11);
      y += 30;
    }

    // destra: il bottino portato a casa, grande, con le foto delle risorse
    const panW = Math.min(520, R - L - colW - 60), panX = R - panW, ip = 24;
    let py = M + 70;
    const items: (() => void)[] = [];
    const top = py;
    py += ip;
    const hy = py;
    items.push(() => label(this, panX + ip, hy, 'Brought home', OPS.label, 11));
    py += 26;
    const cw = (panW - 2 * ip) / 3, cy = py;
    items.push(() => RESOURCES.forEach((r, i) => {
      const x = panX + ip + i * cw + cw / 2;
      resPhoto(this, r, x, cy + 40, 72);
      tech(this, x, cy + 96, `+${sum.kept[r]}`, 30, sum.kept[r] ? OPS.text : OPS.label).setOrigin(0.5);
      label(this, x, cy + 122, RESOURCE_INFO[r].name, OPS.label, 10).setOrigin(0.5);
      // raccolti in campagna, se diversi da quelli portati a casa
      if (sum.kept[r] !== sum.backpack[r]) label(this, x, cy + 140, `gathered ${sum.backpack[r]}`, OPS.label, 9).setOrigin(0.5);
    }));
    py += 162;
    // perché è cambiato: una riga per voce
    const mods: [string, string, number][] = [];
    if (sum.outcome === 'victory') mods.push(['Victory bonus', `+${Math.round(BALANCE.victory.bonus * 100)}%`, OPS.gain]);
    if (sum.feePct) mods.push([sum.outcome === 'retreat' ? 'Retreat fee' : 'Eliminated', `−${sum.feePct}%`, OPS.loss]);
    if (bagTotal(sum.stake) > 0) {
      const gm = Math.round(sum.gainMult * 100) / 100;
      if (gm !== 1) mods.push(['Gain over the stake', `×${String(gm)}`, OPS.gain]);
      if (sum.stakeLossPct) mods.push(['Stake lost', `−${sum.stakeLossPct}%`, OPS.loss]);
    }
    if (mods.length) {
      const ry = py;
      items.push(() => rule(g, panX + ip, panX + panW - ip, ry));
      py += 10;
      for (const [k, v, c] of mods) {
        const my = py;
        items.push(() => {
          body(this, panX + ip, my + 14, k, 14, OPS.body).setOrigin(0, 0.5);
          tech(this, panX + panW - ip, my + 14, v, 18, c).setOrigin(1, 0.5);
        });
        py += 30;
      }
    }
    // il Deposito dopo la campagna, piccolo
    const dyy = py + 8, st = profile.stash;
    items.push(() => {
      rule(g, panX + ip, panX + panW - ip, dyy);
      label(this, panX + ip, dyy + 18, 'In the Depot now', OPS.label, 10).setOrigin(0, 0.5);
      let dx = panX + panW - ip;
      for (const r of [...RESOURCES].reverse()) {
        const t = label(this, dx, dyy + 18, `${st[r]}`, OPS.body, 11).setOrigin(1, 0.5);
        resIcon(this, r, t.x - t.width - 10, dyy + 18, 14);
        dx = t.x - t.width - 28;
      }
    });
    py += 40;
    if (lostCap) {
      const ly = py;
      items.push(() => body(this, panX + ip, ly, `Depot full: lost ${lostCap} (capacity ${stashCap(profile)})`, 12, OPS.loss, panW - 2 * ip));
      py += 24;
    }
    py += ip;
    panel(g, panX, top, panW, py - top);
    items.forEach((f) => f());

    // tasti in basso a destra, staccati dal bordo: tornare alla home è l'azione principale, la rivincita accanto
    const bh = 56, bw = 260, by = height - M - bh;
    const base = new Button(this, 'BACK TO HOME', bw, bh, () => this.scene.start('Title', { next: 'Camp' }), 16).setPrimary(); // in home, non nella base (Nico)
    base.setPosition(R - bw, by);
    // replay e cronologia della partita (Nico, 27 novembre 2026): sopra gli altri tasti
    const replay = this.registry.get('replay');
    if (replay && !sum.tutorial) {
      const rb = new Button(this, 'REPLAY AND CHRONICLE', bw, bh, () => this.scene.launch('Replay', replay), 13);
      rb.setPosition(R - bw, by - bh - 12);
    }
    if (!sum.tutorial && !sum.sandbox) { // la sandbox si rifà dalla home, con le sue scelte
      const again = new Button(this, 'REMATCH: SAME MAP', bw, bh, () => {
        analytics.design(['run', 'rivincita', sum.outcome]); // % rivincita dopo una sconfitta
        this.scene.start('Load', { next: 'Run', data: { seed: sum.seed } });
      }, 13);
      again.setPosition(R - 2 * bw - 12, by);
    }
  }
}
