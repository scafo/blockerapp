// Solo sviluppo: pannello debug sopra il gioco (tasto \ per aprirlo e chiuderlo). Valori di bilanciamento modificabili a
// partita in corso, scorciatoie per i test (truppe, province, guerra, costruzioni, nebbia, tempo) e FPS.
// Le modifiche ai valori valgono solo per questa sessione: quelli giusti vanno poi scritti in `src/config/balance.ts`.
import type Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { RESOURCES } from '../game/resources';
import { WORKS, type RunState } from '../game/RunState';
import { clearResume } from '../save/devResume';

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function installDevPanel(game: Phaser.Game) {
  const { Pane } = await import('tweakpane');
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:96px;right:12px;width:290px;z-index:9999;display:none;max-height:calc(100vh - 170px);overflow:auto';
  document.body.appendChild(host);
  const pane = new Pane({ container: host, title: 'DEBUG  ( \\ chiude )' });

  const run = () => game.scene.getScene('Run') as unknown as Any | null;
  const st = (): RunState | null => {
    const r = run();
    return r && game.scene.isActive('Run') && r.state ? (r.state as RunState) : null;
  };
  const dirty = () => { const r = run(); if (r) { r.ownedDirty = true; r.termDirty = true; r.borderKey = ''; } };
  const act = (f: (s: RunState, x: Any) => void) => () => { const s = st(); if (s) { f(s, s as unknown as Any); dirty(); } };

  // ---------- stato ----------
  const info = { fps: 0, province: 0, truppe: 0, tempo: '0:00', imperoMax: 0 };
  const fInfo = pane.addFolder({ title: 'Stato' });
  fInfo.addBinding(info, 'fps', { readonly: true, view: 'graph', min: 0, max: 120 });
  fInfo.addBinding(info, 'tempo', { readonly: true });
  fInfo.addBinding(info, 'province', { readonly: true, format: (v: number) => String(Math.round(v)) });
  fInfo.addBinding(info, 'imperoMax', { label: 'impero IA max', readonly: true, format: (v: number) => String(Math.round(v)) });
  fInfo.addBinding(info, 'truppe', { readonly: true, format: (v: number) => String(Math.round(v)) });
  setInterval(() => {
    info.fps = Math.round(game.loop.actualFps);
    const s = st();
    if (!s) return;
    info.province = s.player.provinces;
    info.truppe = s.factions[0].troops;
    info.imperoMax = Math.max(0, ...s.factions.slice(1).filter((f) => f.kind === 'empire').map((f) => f.provinces));
    const sec = Math.floor(s.gameTimeMs / 1000);
    info.tempo = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }, 250);

  // ---------- scorciatoie ----------
  const fAct = pane.addFolder({ title: 'Scorciatoie' });
  fAct.addButton({ title: '+1000 truppe' }).on('click', act((s) => { s.factions[0].troops += 1000; }));
  fAct.addButton({ title: '+100 di ogni risorsa' }).on('click', act((s) => { for (const r of RESOURCES) s.backpack[r] += 100; }));
  fAct.addButton({ title: 'Prendi 20 province vicine' }).on('click', act((s, x) => {
    for (let k = 0; k < 20; k++) {
      const p = s.frontier(0).find((q) => s.provOwner[q] === -1 || s.atWar(0, s.provOwner[q])) ?? s.frontier(0)[0];
      if (p === undefined) break;
      x.transferProvince(0, p, 0);
      x.frontierCache?.clear?.();
    }
  }));
  fAct.addButton({ title: 'Guerra con tutti gli imperi' }).on('click', act((s, x) => {
    s.factions.forEach((f, i) => { if (i > 0 && f.alive && f.kind === 'empire' && !s.atWar(0, i)) x.setRelation(i, 'guerra', true, 'war'); });
  }));
  fAct.addButton({ title: 'Pace con tutti' }).on('click', act((s, x) => {
    s.factions.forEach((f, i) => { if (i > 0 && f.alive && s.atWar(0, i)) x.setRelation(i, 'pace', true, 'peace'); });
  }));
  fAct.addButton({ title: 'Fabbrica in tutte le tue province' }).on('click', act((s) => {
    const k = WORKS.indexOf('fabbrica');
    for (let p = 0; p < s.provOwner.length; p++) if (s.provOwner[p] === 0 && s.provWork[p] < 0) { s.provWork[p] = k; s.provWorkAt[p] = 0; }
  }));
  fAct.addButton({ title: 'Rivela la mappa (niente nebbia)' }).on('click', act((s, x) => {
    s.visible.fill(1);
    s.seen.fill(1);
    s.provVisible.fill(1);
    s.fogVersion++;
    run()?.redrawFog?.();
    x.opts.fog = false;
  }));
  fAct.addButton({ title: 'Salta 1 minuto' }).on('click', act((s) => {
    const sp = s.speed;
    s.speed = 1;
    for (let k = 0; k < 60; k++) s.update(1000);
    s.speed = sp;
  }));
  fAct.addButton({ title: 'Ricomincia da capo' }).on('click', async () => { await clearResume(); location.reload(); });

  // ---------- bilanciamento (solo questa sessione) ----------
  const fBal = pane.addFolder({ title: 'Bilanciamento (sessione)', expanded: false });
  const tempo = { velocita: 1 };
  fBal.addBinding(tempo, 'velocita', { label: 'velocità', options: { '×1': 1, '×2': 2, '×4': 4, '×8': 8, '×16': 16 } })
    .on('change', (e) => { const s = st(); if (s) s.speed = e.value; });
  const E = BALANCE.economy as Any, A = BALANCE.ai as Any;
  fBal.addBinding(E, 'totalMult', { label: 'produzione ×', min: 0, max: 6, step: 0.1 });
  fBal.addBinding(E, 'cityMult', { label: 'città ×', min: 1, max: 6, step: 0.1 });
  fBal.addBinding(E, 'mainShare', { label: 'quota risorsa principale', min: 0.34, max: 1, step: 0.02 });
  fBal.addBinding(A, 'attacksPerAct', { label: 'IA province per azione', min: 1, max: 10, step: 1 });
  fBal.addBinding(A, 'reserve', { label: 'IA riserva', min: 0.5, max: 3, step: 0.05 });
  // valori del fronte di questa partita (crescita e ritmo delle IA): si legano alla partita in corso quando si apre il pannello
  const fFront = fBal.addFolder({ title: 'Fronte della partita' });
  let bound: object | null = null;
  const bindFront = () => {
    const s = st();
    const front = s ? (s.opts as Any).front : null;
    if (!front || front === bound) return;
    bound = front;
    for (const c of [...fFront.children]) fFront.remove(c);
    fFront.addBinding(front, 'aiActChance', { label: 'IA probabilità azione', min: 0, max: 1, step: 0.01 });
    fFront.addBinding(front, 'aiGrowthMult', { label: 'IA crescita ×', min: 0, max: 4, step: 0.05 });
    fFront.addBinding(front, 'maxAiUnits', { label: 'IA pedine max', min: 0, max: 20, step: 1 });
  };

  const toggle = () => {
    const on = host.style.display === 'none';
    host.style.display = on ? 'block' : 'none';
    if (on) { bindFront(); const s = st(); if (s) tempo.velocita = s.speed; pane.refresh(); }
  };
  window.addEventListener('keydown', (e) => {
    if (e.key === '\\' || e.code === 'Backquote' || e.code === 'Backslash' || e.code === 'IntlBackslash') { e.preventDefault(); toggle(); }
  });
}
