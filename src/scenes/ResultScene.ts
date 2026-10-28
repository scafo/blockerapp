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
import { drawResourceIcon } from '../ui/resourceIcons';
import { OPS, body, chip, dot, frameMarks, label, panel, rule, value } from '../ui/ops';
import { uiCamera, view } from '../ui/screen';
import { civImage, coverImage, fade } from '../ui/images';

const TITLES: Record<RunSummary['outcome'], string> = {
  victory: 'VITTORIA',
  retreat: 'RITIRATA',
  eliminated: 'ELIMINATO',
  timeout: 'FINE DELLE OPERAZIONI',
};

const REASONS = { map: 'I tre imperi rivali sono caduti', time: 'Più province di tutti a fine campagna', tutorial: 'Il primo pezzo di mondo è tuo' };

/** Schermata finale stile manifesto: esito, bollettino comando, bottino portato a casa, rivincita. */
export class ResultScene extends Phaser.Scene {
  constructor() {
    super('Result');
  }

  create(sum: RunSummary) {
    uiCamera(this);
    music.setMode('hq'); // dopo la campagna la musica torna quella della base
    const profile = loadProfile();
    const { lostCap, unlocked } = applyRunResult(profile, sum, Date.now());
    profileStore.save(profile);
    analytics.runEnd(sum.outcome, sum.reason, sum.maxTiles, sum.timeMs, sum.seed);
    analytics.resources('source', sum.kept, 'run', sum.outcome);

    const { width, height, portrait: P } = view(this);
    this.cameras.main.setBackgroundColor(PALETTE.inchiostro);
    // fondo cinematografico: la potenza in vittoria, un'immagine dell'archivio della Caduta negli altri casi, scurita
    const bg = sum.outcome === 'victory' ? civImage(sum.civ) : ({ retreat: 'load-nave', eliminated: 'load-croce', timeout: 'load-ghiaccio' } as Record<string, string>)[sum.outcome];
    const img = coverImage(this, bg, 0, 0, width, height, 0.4).setTint(0x9fb4cc).setAlpha(0.55);
    this.tweens.add({ targets: img, alpha: 0.4, duration: 4000, yoyo: true, repeat: -1 });
    this.add.rectangle(0, 0, width, height, 0x05070a, 0.5).setOrigin(0);
    fade(this, 0, 0, width * 0.6, height, 0x05070a, 0.75, 0, 'h');
    const g = this.add.graphics();

    // cornice con i crocini
    const M = P ? 16 : 28, fx = M, fy = M, fw = width - 2 * M, fh = height - 2 * M;
    frameMarks(g, fx, fy, fw, fh);
    const pad = P ? 14 : 26, L = fx + pad, R = fx + fw - pad;

    // intestazione: numero del rapporto a sinistra, codice della mappa a destra; sotto, potenza/fronte/durata in riquadri
    const roman = ['I', 'II', 'III', 'IV', 'V', 'VI'];
    label(this, L, fy + pad - 4, `Rapporto dal fronte · N° ${profile.runs}`);
    label(this, R, fy + pad - 4, `mappa #${sum.seed}`).setOrigin(1, 0);
    let cx = L;
    for (const c of [sum.civ, `fronte ${roman[sum.front]}`, sum.campaign]) cx += chip(this, g, cx, fy + pad + 18, c) + 6;

    // colonne: esito a sinistra, bottino a destra (in verticale una sotto l'altra)
    const colW = P ? R - L : Math.min(440, (R - L) * 0.5);
    const panW = P ? R - L : Math.min(380, (R - L) - colW - 40);
    const panX = P ? L : R - panW;
    let y = fy + pad + 62;

    // esito: puntino del suo colore + parola grande
    const tone = sum.outcome === 'victory' ? OPS.gain : sum.outcome === 'retreat' ? PALETTE.allerta : sum.outcome === 'eliminated' ? OPS.loss : OPS.label;
    dot(g, L + 3, y + 7, tone);
    label(this, L + 14, y, 'esito', tone);
    y += 20;
    const title = value(this, L - 2, y, TITLES[sum.outcome], P ? 40 : 64).setWordWrapWidth(colW);
    this.tweens.add({ targets: title, alpha: { from: 0, to: 1 }, x: { from: L - 14, to: L - 2 }, duration: 380, ease: 'Quad.easeOut' });
    y += title.height + 6;
    const lines = bulletins[sum.outcome];
    const reason = sum.reason ? `${REASONS[sum.reason]}. ` : '';
    const bul = body(this, L, y, reason + lines[Math.floor(Math.random() * lines.length)], 14, OPS.body, colW);
    y += bul.height + (P ? 16 : 26);

    // due dati della campagna, separati da un filo verticale
    const sec = Math.floor(sum.timeMs / 1000);
    const stats: [string, string][] = [['province max', `${sum.maxProvinces}`], ['durata', `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`]];
    stats.forEach(([k, v], i) => {
      const sx = L + i * 140;
      if (i) g.lineStyle(1, OPS.edge, 0.5).lineBetween(sx - 20, y + 2, sx - 20, y + 50);
      label(this, sx, y, k);
      value(this, sx, y + 16, v, 30);
    });
    y += 66;

    // fronte nuovo: una riga d'avviso con il suo puntino
    if (unlocked > 0) {
      dot(g, L + 3, y + 7, OPS.accent);
      label(this, L + 14, y, `nuovo fronte sbloccato · ${roman[unlocked]}`, OPS.accent);
      body(this, L, y + 18, `${BALANCE.fronts[unlocked].name}: nemici più forti, potenzia l'HQ.`, 13, OPS.body, colW);
      y += 52;
    }
    const leftEnd = y;

    // ---------- pannello del bottino ----------
    const py0 = P ? leftEnd + 4 : fy + pad + 62;
    const ip = 16, IL = panX + ip, IR = panX + panW - ip;
    const items: (() => void)[] = []; // si disegna dopo aver misurato l'altezza
    let py = py0 + ip;
    const at = (h: number) => { const v = py; py += h; return v; };
    const ty = at(26);
    items.push(() => { label(this, IL, ty, 'bottino portato a casa'); });
    // tre risorse: icona, nome, valore grande a destra; "di N" se è cambiato rispetto allo zaino
    RESOURCES.forEach((r) => {
      const ry = at(40);
      items.push(() => {
        drawResourceIcon(g, r, IL + 9, ry + 14, 8);
        body(this, IL + 28, ry + 14, RESOURCE_INFO[r].name, 13, OPS.body).setOrigin(0, 0.5);
        const v = value(this, IR, ry + 14, `${sum.kept[r]}`, 24).setOrigin(1, 0.5);
        if (sum.kept[r] !== sum.backpack[r]) label(this, IR - v.width - 8, ry + 14, `di ${sum.backpack[r]}`).setOrigin(1, 0.5);
      });
    });
    // cosa ha cambiato il bottino: una riga per voce, col suo colore
    const mods: [string, string, number][] = [];
    if (sum.outcome === 'victory') mods.push(['bonus vittoria', `+${Math.round(BALANCE.victory.bonus * 100)}%`, OPS.gain]);
    if (sum.feePct) mods.push([sum.outcome === 'retreat' ? 'tassa di ritirata' : 'eliminato', `−${sum.feePct}%`, OPS.loss]);
    const gm = Math.round(sum.gainMult * 100) / 100;
    if (gm !== 1 && RESOURCES.some((r) => sum.backpack[r] > sum.stake[r])) mods.push(['guadagno oltre la puntata', `×${String(gm).replace('.', ',')}`, OPS.gain]);
    if (sum.stakeLossPct) mods.push(['puntata persa', `−${sum.stakeLossPct}%`, OPS.loss]);
    if (mods.length) {
      const ry = at(14);
      items.push(() => rule(g, IL, IR, ry + 6));
      for (const [k, v, c] of mods) {
        const my = at(28);
        items.push(() => {
          body(this, IL, my + 12, k, 13, OPS.body).setOrigin(0, 0.5);
          value(this, IR, my + 12, v, 16, c).setOrigin(1, 0.5);
        });
      }
    }
    // puntata: messa in gioco → portata a casa, differenza in verde o rosso
    const staked = bagTotal(sum.stake), kept = bagTotal(sum.kept);
    if (staked) {
      const ry = at(14);
      items.push(() => rule(g, IL, IR, ry + 6));
      const sy = at(34);
      const diff = kept - staked;
      items.push(() => {
        label(this, IL, sy + 2, 'puntata');
        body(this, IL, sy + 16, `${staked} → ${kept}`, 14, OPS.text);
        value(this, IR, sy + 16, `${diff >= 0 ? '+' : '−'}${Math.abs(diff)}`, 22, diff >= 0 ? OPS.gain : OPS.loss).setOrigin(1, 0.5);
      });
    }
    py += ip;
    const ph = py - py0;
    panel(g, panX, py0, panW, ph);
    items.forEach((f) => f());

    // Deposito: sotto il pannello, piccolo (è lo stato della base, non il risultato)
    const s = profile.stash;
    let dy = py0 + ph + 12;
    label(this, panX, dy, 'deposito');
    let dx = panX + 84;
    for (const r of RESOURCES) {
      drawResourceIcon(g, r, dx + 6, dy + 7, 6);
      const t = body(this, dx + 18, dy + 7, `${s[r]}`, 12, OPS.body).setOrigin(0, 0.5);
      dx += 18 + t.width + 16;
    }
    if (lostCap) body(this, panX, dy + 20, `Deposito pieno: perse ${lostCap} (capienza ${stashCap(profile)})`, 12, OPS.loss, panW);
    dy += lostCap ? 40 : 22;

    // pulsanti: in basso a sinistra (in verticale in fondo, larghi per il pollice)
    const bh = 48, bw1 = P ? R - L : 240, bw2 = P ? R - L : 190;
    const by = P ? Math.max(dy + 16, fy + fh - pad - bh * 2 - 10) : fy + fh - pad - bh;
    const again = new Button(this, 'RIVINCITA', bw1, bh, () => {
      analytics.design(['run', 'rivincita', sum.outcome]); // % rivincita dopo una sconfitta
      this.scene.start('Load', { next: 'Run', data: { seed: sum.seed } });
    }).setPrimary();
    const fresh = new Button(this, 'ACCAMPAMENTO', bw2, bh, () => this.scene.start('Camp'));
    again.setPosition(L, by);
    fresh.setPosition(P ? L : L + bw1 + 12, P ? by + bh + 10 : by);
    const cap = label(this, L, by - 18, `rivincita: stessa mappa #${sum.seed}`);
    if (sum.tutorial) {
      // dopo la run guidata si va a scoprire l'accampamento (la rivincita genererebbe un'altra mappa)
      again.destroy();
      cap.destroy();
      fresh.setPosition(L, P ? by + bh + 10 : by).setPrimary();
      this.tweens.add({ targets: fresh, scale: 1.06, duration: 600, yoyo: true, repeat: -1 });
    }
  }
}
