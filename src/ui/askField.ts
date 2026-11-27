// Campo di testo HTML sopra il gioco (email, codice di accesso): stesso aspetto del riquadro del nome (nameInput.ts).
import { PALETTE, hex } from '../config/palette';
import { FONT, FONT_TITLE } from './style';

export interface FieldOpts {
  title: string;
  note?: string; // riga sotto il titolo
  placeholder: string;
  type: 'email' | 'text';
  maxLength: number;
  inputMode?: 'email' | 'numeric';
}

/** Mostra il riquadro; `done` riceve il testo (o null se si annulla). */
export function askField(o: FieldOpts, done: (v: string | null) => void) {
  document.getElementById('field-ask')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'field-ask';
  wrap.style.cssText = 'position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;'
    + 'background:rgba(5,9,15,0.72);padding:16px;box-sizing:border-box;';
  const box = document.createElement('div');
  box.style.cssText = `width:min(380px,100%);background:${hex(PALETTE.inchiostro)};border:1px solid ${hex(PALETTE.linea)};`
    + `border-top:2px solid ${hex(PALETTE.ocra)};padding:18px;box-sizing:border-box;font-family:${FONT};color:${hex(PALETTE.carta)};`;
  const h = document.createElement('div');
  h.textContent = o.title;
  h.style.cssText = `font-family:${FONT_TITLE};font-size:20px;letter-spacing:1px;margin-bottom:${o.note ? 6 : 12}px;color:${hex(PALETTE.carta)};`;
  box.append(h);
  if (o.note) {
    const n = document.createElement('div');
    n.textContent = o.note;
    n.style.cssText = `font-size:14px;line-height:1.35;margin-bottom:12px;color:${hex(PALETTE.tenue)};`;
    box.append(n);
  }
  const input = document.createElement('input');
  input.type = o.type;
  input.maxLength = o.maxLength;
  input.placeholder = o.placeholder;
  input.autocomplete = o.type === 'email' ? 'email' : 'one-time-code';
  if (o.inputMode) input.inputMode = o.inputMode;
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
  const cancel = mk('CANCEL', false), ok = mk('CONFIRM', true);
  row.append(cancel, ok);
  box.append(input, row);
  wrap.append(box);
  document.body.append(wrap);
  const close = (v: string | null) => {
    wrap.remove();
    done(v === null ? null : v.trim() || null);
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
  setTimeout(() => input.focus(), 30);
}
