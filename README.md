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
npx vite-node scripts/sim.ts 1 6   # simula 6 run (giocatore 1 tap/s) per tarare balance.ts
```

- `?seed=abc123` nell'URL → mappa riproducibile.
- Controlli: tap = conquista, trascina = sposta, pinch/rotella = zoom.

**Stato:** milestone 1 ✅ (mappa a esagoni + conquista col tap, zaino rovine, velocità x1/x2/x4) ·
milestone 2 ✅ (3 fazioni IA che si espandono, si combattono e ti attaccano dopo 60 s; eliminazione + rivincita).

---

## Visione completa (stella polare, oltre l'MVP)

Si parte dall'**accampamento**, la home del gioco, costruito come in Clash of Clans: piccolo all'inizio, poi sempre più tuo e da mostrare. Qui i **generali** (alla World Conqueror) hanno personalità e abilità da collezionare, le **spedizioni** rientrano a tempo e la **strada dei trofei** (alla Clash Royale) ti dà un motivo per tornare ogni giorno. Ogni edificio non dà solo numeri, ma sblocca **nuove strade per le run** come in Hades: una fucina per unità nuove, una radio per eventi rari, un archivio per tecnologie.

Dall'accampamento parti per la **run** sulla mappa del mondo, con le modalità mappa di HOI4 che cambi con un tocco, la leggibilità di Polytopia e l'espansione fluida di Territorial che fa "colare" il tuo colore sul mondo. Le **unità** funzionano a sasso-carta-forbice come in Polytopia, ma ognuna ha la silhouette e il carattere di una carta di Clash Royale. L'**economia** ha due sole leve alla OpenFront (soldati contro lavoratori), mentre la **ricerca** fa scoperte che cambiano davvero il modo di giocare come in Civilization.

Durante la run arrivano **carte evento** da scorrere alla Reigns, ironiche e misteriose, che danno indizi su cosa è successo al mondo. Le alleanze con l'IA seguono la logica di Europa Universalis, con rivalità che contano. Alla fine scegli se ritirarti con il bottino o rischiare, e torni all'accampamento più forte o a mani vuote, con il tasto **rivincita** sempre pronto.

Sopra tutto questo: il **sandbox** di Age of History per chi vuole giocare libero, monetizzazione **equa** alla Polytopia, e una community da far crescere come quella di HOI4.

### Cosa entra nell'MVP e cosa dopo

| Elemento della visione | MVP | Dove |
|---|---|---|
| Accampamento (= Villaggio) che cresce visivamente | ✅ | M4 |
| Edifici che sbloccano strade: Fucina, Radio | ✅ | M4 |
| Archivio → tecnologie / ricerca | ❌ dopo | — |
| Spedizioni a tempo reale | ✅ | M4 |
| Generali collezionabili | ❌ dopo | — |
| Strada dei trofei | ❌ dopo | — |
| Leggibilità (colori forti, confini netti) | ✅ | sempre |
| Espansione che "cola" sul mondo | ✅ | M5 (juice) |
| Modalità mappa con un tocco | ❌ dopo | — |
| Unità sasso-carta-forbice | ❌ dopo (MVP: solo raider dalla Fucina) | — |
| Economia soldati vs lavoratori | ❌ dopo | — |
| Carte evento da scorrere, indizi sul mondo | ✅ | M4 (swipe sx/dx = 2 opzioni) |
| Alleanze e rivalità IA | ❌ dopo | — |
| Ritirati o rischia + Rivincita | ✅ | M3 |
| Sandbox, monetizzazione, community | ❌ fuori MVP | — |

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
