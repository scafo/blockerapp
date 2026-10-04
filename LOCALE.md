# Continuare Ashen Atlas in locale (Claude Code)

## 1. Prendi il progetto

```bash
git clone https://github.com/scafo/blockerapp.git
cd blockerapp
git checkout claude/world-conquest-game-mvp-oj4otd
npm install
```

Serve Node.js 20 o più recente.

## 2. Provalo

```bash
npm run dev            # gioco nel browser: apri l'indirizzo che stampa (di solito http://localhost:5173)
npm run dev -- --host  # anche dal telefono sulla stessa rete Wi-Fi
```

Altri comandi utili:

| Comando | Cosa fa |
|---|---|
| `npm run typecheck` | controllo dei tipi |
| `npm run build:single` | pagina unica in `dist-single/` (quella pubblicata come artifact) |
| `npx vite-node scripts/sim.ts 1 4 1 1 2 0` | 4 campagne simulate senza grafica (Fronte III, senza potenziamenti) per il bilanciamento |
| `npm run build && npx cap sync android` | aggiorna l'app Android (l'APK lo compila GitHub Actions a ogni push) |

## 3. Apri Claude Code

```bash
claude
```

Claude legge da solo `CLAUDE.md` (visione, regole, stato del gioco, note su ogni richiesta fatta finora) e le skill in
`.claude/skills/` (game-ui-ux, game-feel). Come primo messaggio puoi incollare:

> Sei il developer di Ashen Atlas: leggi CLAUDE.md e LOCALE.md. Lavoriamo sul branch claude/world-conquest-game-mvp-oj4otd.
> Rispondi in italiano, breve. Prima cosa: scarica dal Figma (https://www.figma.com/design/wiJbr892yftHAh6St8jTHd, sezione
> "Loading screens") le immagini originali in alta risoluzione e sostituisci quelle sgranate in `src/assets/img/`
> (load-croce, load-nave, load-radar; le civiltà civ-*.jpg).

## Dove eravamo rimasti

- Ultima versione: v36 (assalti a tempo sulle province nemiche, capitale e logistica alla HOI4, mappa più bella da vicino,
  pedine più fluide, immagini nuove di Nico nei caricamenti, bilanciamento rifatto).
- Da fare: immagini originali dal Figma (nel cloud il download era bloccato dalla rete), decisioni di Nico sui numeri del
  Mercato (`shop` in `src/config/balance.ts`) e sulla puntata (`stake`).
- Tutti i numeri sono in `src/config/balance.ts`, i testi in `src/data/*.json`.
