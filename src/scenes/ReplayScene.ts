// Replay di fine partita (Nico, 27 novembre 2026: "a fine gioco un timelapse, solo i territori, e una cronologia delle
// battaglie, così si può rivedere"): la carta a un pixel per casella, colorata dai padroni delle province, che si rifà
// fotogramma per fotogramma; a destra la cronologia che si scrive al suo momento. Si apre dal resoconto, niente file.
import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { FACTION_INFO } from '../game/factions';
import { NEUTRAL, PLAYER, type ChronEntry, type ReplayData } from '../game/RunState';
import type { RunMap } from '../map/generate';
import { Button } from '../ui/Button';
import { UI, uiCamera, view } from '../ui/screen';
import { TCOL, termStyle } from '../ui/terminal';

export interface ReplayInput { data: ReplayData; map: RunMap }

const SEA = 0x0b1622, FREE = 0x2b3034;

/** Una riga della cronologia in parole. */
export function chronText(e: ChronEntry): string {
  const nm = (f: number) => (f === PLAYER ? 'you' : FACTION_INFO[f]?.name ?? 'someone');
  const Nm = (f: number) => (f === PLAYER ? 'You' : FACTION_INFO[f]?.name ?? 'Someone');
  switch (e.k) {
    case 'war': return e.byPlayer ? `You declared war on ${nm(e.a)}` : `${Nm(e.a)} declared war on you`;
    case 'peace': return `Peace with ${nm(e.a)}`;
    case 'alliance': return `Alliance with ${nm(e.a)}`;
    case 'fall': return e.a === PLAYER ? 'You were eliminated' : `${Nm(e.a)} has fallen${e.b === PLAYER ? ', taken by you' : e.b !== NEUTRAL && e.b >= 0 ? ` to ${nm(e.b)}` : ''}`;
    case 'capital': return e.a === PLAYER ? `You took the capital of ${nm(e.b)}` : e.b === PLAYER ? `${Nm(e.a)} took your capital` : `${Nm(e.a)} took the capital of ${nm(e.b)}`;
    case 'attack': return `Your offensive against ${nm(e.a)}, ${e.n ?? 0} units`;
    case 'zone': return `Your units sent to take ${e.n ?? 0} provinces`;
    case 'lost': return `${Nm(e.a)} took ${e.n ?? 0} of your provinces`;
  }
}

const clock = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export class ReplayScene extends Phaser.Scene {
  constructor() {
    super('Replay');
  }

  create(input: ReplayInput) {
    uiCamera(this);
    const { width, height } = view(this);
    const { data, map } = input;
    const { cols, rows } = BALANCE.map, n = cols * rows;
    this.add.rectangle(0, 0, width, height, 0x05080d, 0.97).setOrigin(0).setInteractive(); // copre il resoconto e i suoi tasti

    // carta: un pixel per casella, rifatta solo dove cambiano i padroni
    const key = 'replay-map';
    if (this.textures.exists(key)) this.textures.remove(key);
    const tex = this.textures.createCanvas(key, cols, rows)!, ctx = tex.getContext(), img = ctx.createImageData(cols, rows), px = img.data;
    const rgb = (c: number, i: number) => { px[i * 4] = (c >> 16) & 255; px[i * 4 + 1] = (c >> 8) & 255; px[i * 4 + 2] = c & 255; px[i * 4 + 3] = 255; };
    const colorOf = (o: number) => (o === NEUTRAL || o < 0 ? FREE : FACTION_INFO[o]?.fill ?? FREE);
    const provTiles = map.provinces.map((p) => p.tiles);
    const own = Int16Array.from(data.own0);
    const paint = (p: number) => { const c = colorOf(own[p]); for (const i of provTiles[p]) rgb(c, i); };
    const reset = () => {
      own.set(data.own0);
      for (let i = 0; i < n; i++) if (!map.tiles[i]) rgb(SEA, i);
      for (let p = 0; p < provTiles.length; p++) paint(p);
    };
    reset();
    ctx.putImageData(img, 0, 0);
    tex.refresh();
    // la griglia esagonale è più larga che alta: 960 colonne × 480 righe sono ~2,3:1 sul mondo
    const aspect = (Math.sqrt(3) * cols) / (1.5 * rows);
    const M = 24, colW = Math.min(380, width * 0.3), mapW = Math.min(width - colW - 3 * M, (height - 140) * aspect), mapH = mapW / aspect;
    const mx = M, my = Math.max(M + 40, (height - 90 - mapH) / 2);
    this.add.image(mx, my, key).setOrigin(0).setDisplaySize(mapW, mapH);
    this.add.text(M, M, 'REPLAY', termStyle(16, TCOL.text));
    const timeTxt = this.add.text(mx + mapW, M, '', termStyle(13, TCOL.label)).setOrigin(1, 0);
    // momento appena successo, grande sotto la carta (i momenti compaiono anche nel replay, Nico)
    const moment = this.add.text(mx + mapW / 2, my + mapH + 14, '', termStyle(16, TCOL.accent)).setOrigin(0.5, 0);

    // cronologia a destra: le righe arrivano al loro momento, la più nuova in alto
    const cx = width - M - colW;
    this.add.text(cx, M, 'CHRONICLE', termStyle(12, TCOL.label));
    const lines: Phaser.GameObjects.Text[] = [];
    const maxLines = Math.max(4, Math.floor((height - 160) / 40));
    const showChron = (upTo: number) => {
      const shown = data.chronicle.filter((e) => e.t <= upTo).slice(-maxLines).reverse();
      for (const l of lines) l.destroy();
      lines.length = 0;
      shown.forEach((e, k) => {
        const col = e.k === 'lost' || e.k === 'fall' && e.a === PLAYER || e.k === 'capital' && e.b === PLAYER ? TCOL.alert : k === 0 && upTo - e.t < 2500 ? TCOL.accent : TCOL.text;
        lines.push(this.add.text(cx, M + 26 + k * 40, `${clock(e.t)}  ${chronText(e)}`, termStyle(12, col)).setWordWrapWidth(colW).setMaxLines(2));
      });
      if (!data.chronicle.length) lines.push(this.add.text(cx, M + 26, 'Nothing to report', termStyle(12, TCOL.dim)));
    };

    // tempo: tutta la partita in 10–30 s (1 minuto di gioco ≈ 1,2 s)
    const dur = Phaser.Math.Clamp((data.endMs / 60_000) * 1200, 10_000, 30_000);
    const barY = height - M - 44, barX = mx, barW = mapW;
    const bar = this.add.graphics();
    let at = 0, frame = 0, playing = true, lastChron = -1;
    const seek = (t: number) => {
      if (t < at) { reset(); frame = 0; }
      at = t;
      const gameT = (at / dur) * data.endMs;
      let changed = false;
      while (frame < data.frames.length && data.frames[frame].t <= gameT) {
        const ch = data.frames[frame].ch;
        for (let k = 0; k < ch.length; k += 2) { own[ch[k]] = ch[k + 1]; paint(ch[k]); }
        frame++;
        changed = true;
      }
      if (changed || t === 0) { ctx.putImageData(img, 0, 0); tex.refresh(); }
      timeTxt.setText(`${clock(gameT)} / ${clock(data.endMs)}`);
      const nChron = data.chronicle.filter((e) => e.t <= gameT).length;
      if (nChron !== lastChron) {
        lastChron = nChron;
        showChron(gameT);
        const last = data.chronicle[nChron - 1];
        moment.setText(last && gameT - last.t < 3000 ? chronText(last) : '');
      } else if (moment.text) {
        const last = data.chronicle[nChron - 1];
        if (!last || gameT - last.t >= 3000) moment.setText('');
      }
      bar.clear().fillStyle(TCOL.edge, 0.35).fillRect(barX, barY, barW, 4).fillStyle(TCOL.text, 1).fillRect(barX, barY, barW * (at / dur), 4);
      // segni dei momenti sulla barra
      bar.fillStyle(TCOL.accent, 0.9);
      for (const e of data.chronicle) bar.fillRect(barX + (barW * e.t) / Math.max(1, data.endMs) - 1, barY - 4, 2, 12);
    };
    // la barra si tocca per saltare
    this.add.rectangle(barX, barY - 10, barW, 24, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true })
      .on('pointerdown', (p: Phaser.Input.Pointer) => seek(Phaser.Math.Clamp((p.x / UI() - barX) / barW, 0, 1) * dur));
    seek(0);

    const by = height - M - 30, bw = 120, bh = 34;
    const play = new Button(this, 'PAUSE', bw, bh, () => { playing = !playing; if (at >= dur) { seek(0); playing = true; } play.setLabel(playing ? 'PAUSE' : 'PLAY'); }, 13);
    play.setPosition(barX, by + 4);
    const again = new Button(this, 'RESTART', bw, bh, () => { seek(0); playing = true; play.setLabel('PAUSE'); }, 13);
    again.setPosition(barX + bw + 10, by + 4);
    const close = new Button(this, 'CLOSE', bw, bh, () => this.scene.stop(), 13);
    close.setPosition(width - M - bw, by + 4);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.stop());
    this.input.keyboard?.on('keydown-SPACE', () => { playing = !playing; play.setLabel(playing ? 'PAUSE' : 'PLAY'); });

    this.events.on('update', (_t: number, dt: number) => {
      if (!playing) return;
      const next = Math.min(dur, at + dt);
      seek(next);
      if (next >= dur) { playing = false; play.setLabel('PLAY'); }
    });
  }
}
