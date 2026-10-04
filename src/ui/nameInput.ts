// Campo di testo vero (HTML) sopra il gioco per scrivere il proprio nome: funziona con la tastiera del telefono
// e dentro gli artifact (niente prompt() del browser, spesso bloccato).
import { PALETTE, hex } from '../config/palette';
import { FONT, FONT_TITLE } from './style';

export const NAME_MAX = 16;

/** Nome pulito: spazi compressi, niente caratteri di controllo, al massimo NAME_MAX caratteri. */
export const cleanName = (s: string) => s.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

/** Mostra il riquadro; `done` riceve il nome (o null se si annulla). */
export function askName(title: string, current: string, done: (name: string | null) => void) {
  document.getElementById('name-ask')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'name-ask';
  wrap.style.cssText = 'position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;'
    + 'background:rgba(5,9,15,0.72);padding:16px;box-sizing:border-box;';
  const box = document.createElement('div');
  box.style.cssText = `width:min(360px,100%);background:${hex(PALETTE.inchiostro)};border:1px solid ${hex(PALETTE.linea)};`
    + `border-top:2px solid ${hex(PALETTE.ocra)};padding:18px;box-sizing:border-box;font-family:${FONT};color:${hex(PALETTE.carta)};`;
  const h = document.createElement('div');
  h.textContent = title;
  h.style.cssText = `font-family:${FONT_TITLE};font-size:20px;letter-spacing:1px;margin-bottom:12px;color:${hex(PALETTE.carta)};`;
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = NAME_MAX;
  input.value = current;
  input.placeholder = 'Il tuo nome';
  input.autocomplete = 'off';
  input.style.cssText = `width:100%;box-sizing:border-box;font-family:${FONT};font-size:20px;padding:10px 12px;`
    + `background:${hex(PALETTE.pannello)};color:${hex(PALETTE.carta)};border:1px solid ${hex(PALETTE.ocra)};outline:none;`;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;margin-top:14px;justify-content:flex-end;';
  const mk = (label: string, main: boolean) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `font-family:${FONT_TITLE};font-size:16px;letter-spacing:1px;padding:10px 18px;cursor:pointer;`
      + (main ? `background:${hex(PALETTE.ocra)};color:${hex(PALETTE.inchiostro)};border:none;`
        : `background:transparent;color:${hex(PALETTE.tenue)};border:1px solid ${hex(PALETTE.linea)};`);
    return b;
  };
  const cancel = mk('ANNULLA', false), ok = mk('CONFERMA', true);
  row.append(cancel, ok);
  box.append(h, input, row);
  wrap.append(box);
  document.body.append(wrap);
  const close = (v: string | null) => {
    wrap.remove();
    done(v === null ? null : cleanName(v) || null);
  };
  ok.onclick = () => close(input.value);
  cancel.onclick = () => close(null);
  wrap.onclick = (e) => { if (e.target === wrap) close(null); };
  // i tasti restano nel campo: il gioco non li vede (spazio, P, ESC...)
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') close(input.value);
    if (e.key === 'Escape') close(null);
  });
  input.addEventListener('keyup', (e) => e.stopPropagation());
  setTimeout(() => { input.focus(); input.select(); }, 30);
}
