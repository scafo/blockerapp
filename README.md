# [NOME GIOCO] — MVP

Gioco mobile di conquista su mappa del mondo. Stile retro post-apocalittico moderno.
Loop: **run sulla mappa → bottino → villaggio cresce → run successiva diversa.**

Questo README è la specifica per costruire l'MVP con Claude Code.
Mettilo nella root del progetto (copialo anche come `CLAUDE.md` così Claude Code lo legge sempre).

---

## Avvio rapido

```bash
npm install
npm run dev        # http://localhost:5173 (aggiunge --host: apri dal telefono sulla stessa rete)
npm run build      # build di produzione in dist/
npm run typecheck
npm run check:land # verifica la maschera terra contro d3 geoContains (se cambi la griglia)
```

- `?seed=abc123` nell'URL → mappa riproducibile.
- Controlli: tap = conquista, trascina = sposta, pinch/rotella = zoom.

**Stato:** milestone 1 ✅ (mappa a esagoni + conquista col tap, zaino rovine, velocità x1/x2/x4).

---

## Obiettivo dell'MVP

Un prototipo **giocabile nel browser (anche da telefono)** da mandare via link a ~20 tester.
Domanda da validare: **più del 20% gioca ancora dopo 7 giorni?**
Non è il gioco finale. Brutto va bene, divertente no-negoziabile.

---

## Stack

- **Phaser 3 + TypeScript + Vite** (veloce da iterare, gira su mobile web)
- **d3-geo** + **world-atlas (Natural Earth 110m)** per generare la griglia sulla mappa del mondo
  (a runtime point-in-polygon planare: stesso risultato di `geoContains`, 50 ms invece di 5 s)
- **localStorage** per salvare villaggio e progressi (con try/catch)
- **GameAnalytics** (gratis) per retention D1/D7 e durata sessioni
- Deploy: **Vercel** o **Netlify** (link da mandare ai tester)

Più avanti: port in Godot 4 o wrap con Capacitor per App Store.

---

## Scope MVP (solo questo)

### 1. Mappa
- Griglia esagonale (~120×60) sopra la mappa del mondo; tieni solo le caselle su terra (`geoContains`).
- Tipi di casella: `terra`, `deserto` (difesa bassa), `rovine` (bottino), `acqua tossica` (non attraversabile).
- **Ogni run altera la mappa**: rovine e zone tossiche in posizioni casuali (seed). Partenza casuale.

### 2. Conquista
- Truppe del giocatore crescono ogni tick: `troops += tiles * 0.1` (tick = 500 ms).
- Tap su casella adiacente: se `troops > defense` → conquistata, `troops -= defense`.
- Bottino delle rovine va nello **zaino della run**.
- Velocità: x1, x2, x4 (gratis).

### 3. IA
- 3 fazioni nemiche, regola semplice: attaccano la casella vicina più debole.
- Una fazione eliminata rilascia parte del suo bottino.

### 4. Fine run
- **Tempesta**: dopo ~8 min (tempo di gioco) la mappa si restringe dai bordi.
- **Ritirati**: il giocatore torna al villaggio con lo zaino.
- **Eliminato**: perde il 70% dello zaino.
- Schermata finale: territorio max, bottino, tempo + tasto **"Rivincita stessa mappa"**.

### 5. Eventi
- 10 eventi a scelta (carta con 2 opzioni), ogni ~90 s di gioco. Umorismo nero leggero.
- Esempio: *"Un mercante offre acqua pulita in cambio di 30 truppe."* → Accetta / Rifiuta.
- Salvati in `src/data/events.json`.

### 6. Villaggio
- 3 edifici, costruiti con il bottino. Ogni edificio **sblocca qualcosa nelle run**, non solo numeri:
  - **Fucina** → nuova unità (es. raider: attacco a distanza 2)
  - **Radio** → eventi rari
  - **Magazzino** → perdi solo il 40% dello zaino se eliminato
- **Spedizione**: manda abitanti, rientrano dopo X ore reali con risorse (motivo per tornare domani).

### 7. Onboarding
- Prima run guidata: una meccanica alla volta, prima vittoria entro 2 minuti.
- Nessun muro di testo: frecce e highlight.

---

## Fuori dall'MVP (non costruire)

Multiplayer, account/login, acquisti, sandbox premium, fazioni multiple giocabili, stagioni, classifiche online, suono elaborato.

---

## Regole di design (sempre valide)

1. Mai più di 5–6 scelte a schermo.
2. Ogni conquista deve dare soddisfazione visiva (flash, scala, particelle).
3. Leggibilità > dettaglio: colori forti per fazione, confini netti.
4. Tutti i numeri di bilanciamento in `src/config/balance.ts`, mai hardcoded.
5. Niente IP di terzi (niente riferimenti Fallout: vault, mascotte, nomi).

### Estetica (placeholder per l'MVP)
Palette: ocra `#C8963E`, ruggine `#8B3A1E`, carta `#EFE3C8`, inchiostro `#2B2118`, radioattivo `#3FD9B0`.
Stile: mappa militare d'epoca + manifesti anni '50, forme piatte e pulite.

---

## Struttura cartelle

```
src/
  main.ts
  config/balance.ts
  data/events.json
  map/        generazione griglia, seed, tempesta
  game/       tick, conquista, IA, zaino
  scenes/     Boot, Village, Run, Result
  ui/         HUD, carte evento, bottoni velocità
  save/       localStorage
  analytics/  GameAnalytics wrapper
```

---

## Milestone (con criterio di "fatto")

| # | Settimana | Fatto quando… |
|---|---|---|
| 1 | Mappa + conquista | Vedo il mondo a esagoni e conquisto caselle col tap |
| 2 | IA + combattimento | 3 fazioni si espandono e mi attaccano |
| 3 | Bottino + ritirata + tempesta | Una run finisce in ~8 min e porto a casa lo zaino |
| 4 | Villaggio + eventi | Costruisco 3 edifici e cambiano la run successiva |
| 5 | Juice + estetica + onboarding | Un nuovo giocatore vince la prima run senza spiegazioni |
| 6 | Analytics + deploy + test | Link online, eventi D1/D7 tracciati, 20 tester invitati |

---

## Prompt da dare a Claude Code (uno per milestone)

1. *"Leggi CLAUDE.md. Crea il progetto Phaser 3 + TS + Vite e fai la milestone 1. Mostrami come avviarlo."*
2. *"Milestone 2: aggiungi 3 fazioni IA secondo il README. Numeri in balance.ts."*
3. *"Milestone 3: zaino, ritirata, tempesta, schermata finale con Rivincita."*
4. *"Milestone 4: scena Villaggio con 3 edifici e spedizioni a tempo reale. 10 eventi in events.json."*
5. *"Milestone 5: juice sulle conquiste, palette del README, onboarding della prima run."*
6. *"Milestone 6: integra GameAnalytics (sessioni, run iniziate/finite, D1/D7) e prepara deploy su Vercel."*

Dopo ogni milestone: **gioca 10 minuti tu stesso** prima di passare alla successiva.

---

## Metriche del test

- Retention D1 / D7 (obiettivo D7 > 20%)
- Run per sessione (obiettivo ≥ 2 = "ancora una partita" funziona)
- % che usa Rivincita dopo una sconfitta
- % che torna per ritirare una spedizione
- 3 domande ai tester: cosa ti ha annoiato? cosa vorresti sbloccare? lo consiglieresti?
