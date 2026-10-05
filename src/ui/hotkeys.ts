// Registro delle scorciatoie: ogni livello (schermata, cassetto, finestra) registra i propri tasti; Esc chiude
// solo il livello più in cima alla pila, non uno globale. Ignora tutto mentre si scrive in un campo di testo.
// Ascolta a livello di finestra (non la cattura tasti di Phaser), così le lettere usate dall'interfaccia
// (G, M, 1-6...) restano libere anche quando Phaser ha il focus sul canvas.
type Handler = () => void;

interface Level {
  id: number;
  keys: Map<string, Handler>;
  onEscape?: Handler; // se assente, Esc passa al livello sotto
}

let nextId = 1;
const stack: Level[] = [];

const norm = (k: string) => k.toLowerCase();

const isTyping = (): boolean => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

export interface LevelHandle {
  readonly id: number;
  pop: () => void;
  setKey: (key: string, handler: Handler) => void;
}

/** Apre un nuovo livello di scorciatoie (es. entrando in una schermata o aprendo un cassetto/finestra). */
export function pushLevel(keys: Record<string, Handler> = {}, onEscape?: Handler): LevelHandle {
  const level: Level = { id: nextId++, keys: new Map(Object.entries(keys).map(([k, h]) => [norm(k), h])), onEscape };
  stack.push(level);
  return {
    id: level.id,
    pop: () => { const i = stack.findIndex((l) => l.id === level.id); if (i >= 0) stack.splice(i, 1); },
    setKey: (key: string, handler: Handler) => level.keys.set(norm(key), handler),
  };
}

let installed = false;

/** Da chiamare una sola volta all'avvio (main.ts): installa l'ascolto globale dei tasti. */
export function installHotkeys(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', (e) => {
    if (isTyping()) return;
    const top = stack[stack.length - 1];
    if (!top) return;
    if (e.key === 'Escape') {
      if (top.onEscape) { e.preventDefault(); top.onEscape(); }
      return;
    }
    const h = top.keys.get(norm(e.key));
    if (h) { e.preventDefault(); h(); }
  });
}
