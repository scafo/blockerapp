# CLAUDE.md — Ashen Atlas (nome di lavoro)

Sei il developer di questo gioco. Nico è designer/art director e decide estetica, feeling e bilanciamento.
Lavora una milestone alla volta. Chiedi solo se una decisione non è scritta qui.

## Cos'è
Gioco mobile **single player** di conquista sulla mappa del mondo, con un **accampamento** personale.
Loop: **run sulla mappa → bottino → l'accampamento cresce → la run successiva è diversa.**
Formula: si impara come Territorial, si torna come in Clash, si ragiona come in HOI4, si paga come in Polytopia.

## Feeling (da confermare con Nico)
Misterioso, freddo e tecnologico, tensione da potere e dominio. Nebbia, radar, terminali, segnali.
Mappa: griglia luminosa su sfondo scuro, stile heatmap di dati (il territorio "si accende").
Evita: ottone/ingranaggi (steampunk), soldati realistici/HUD tattici moderni (MW3), qualsiasi IP Fallout.

## Stile visivo
Il mondo dopo la Caduta visto dagli schermi di un centro di comando: noto = nitido, ignoto = nebbia/glitch.
- Colori in `theme.ts`: sfondo `#07090C`, griglia `#1B2530`, testo `#C9D6DF`, UI attiva `#4FE3C1`, allerta `#FFB547`, pericolo `#FF4D4D`. Fazioni: Empirium `#E5484D`, Republica `#3E8BFF`, Aristocrazia `#B56BFF`, Elite `#F2C14E` (+ simbolo per daltonismo).
- Font: monospace per dati, sans condensato per titoli.
- Mappa: caselle quadrate con gap 1px su sfondo scuro, territorio = colore fazione + glow; terreno solo luminosità/trama; nebbia = rumore animato; Caduta = glitch.
- UI: pannelli piatti scuri, bordo 1px, angoli tagliati; icone silhouette monocolore.
- Accampamento: planimetria tecnica illuminata vista dall'alto.
- Leggibilità prima di tutto. Shader in `src/fx/`.

## Lore
Mondo alternativo dopo un cataclisma, **la Caduta**. Le potenze mondiali si contendono il dominio del mondo dopo la scoperta di una nuova tecnologia.
Chi riuscirà a dominare il mondo? Il mistero della Caduta si svela poco alla volta (Laboratorio + eventi).

## Stack
- **Phaser 3 + TypeScript + Vite**; app con **Capacitor** (iOS/Android). Niente server.
- d3-geo + world-atlas 110m per la griglia sul mondo.
- Salvataggio locale (try/catch); GameAnalytics per D1/D7.
- **Orizzontale**, solo orizzontale.
- Tutti i numeri in `src/config/balance.ts`. Contenuti (eventi, civiltà, unità, edifici) in JSON in `src/data/`.

## Run
- Mappa del mondo a esagoni, **riconoscibile ma alterata**: coste, rovine, zone tossiche e partenza cambiano a ogni run (seed).
- La mappa è divisa in **province** (stile Call of War): ognuna ha nome, città principale, valore e bottino. Le province sono fatte di caselle.
- **Truppe generiche** (pool) crescono col territorio; tap su casella adiacente = attacco (`troops > defense`).
- **Unità speciali** come carte: fanteria pesante, raider, artiglieria (sasso-carta-forbice). Mare e aria si sbloccano dopo; gli aerei sono **abilità a ricarica**, non unità.
- Economia a 2 leve: soldati vs lavoratori.
- Risorse: **Cibo, Metallo, Benzina**. Bottino nello **zaino**.
- **Eventi** stile Reigns: carta con 2 scelte, ~ogni 90 s.
- **Fine**: tempesta che restringe la mappa (~8 min base). Ritirati = tieni lo zaino; eliminato = perdi il 70%. Tasto **Rivincita stessa mappa**.
- Vittoria: 60% della mappa / 3 anomalie / più territorio all'arrivo della tempesta.
- Velocità x1/x2/x4. Difficoltà: Recluta, Comandante, Generale, Incubo.
- IA: fazioni che attaccano la casella vicina più debole (poi migliorabile).

## Terreno
Base OpenFront (griglia fine) + province Call of War sopra + effetti HOI4 semplificati.
| Terreno | Effetto |
|---|---|
| Pianura | normale |
| Montagna | difesa x2, conquista lenta |
| Foresta | -50% corazzati, +25% fanteria |
| Deserto | conquista veloce, nessuna crescita truppe |
| Zona della Caduta | bloccata all'inizio, bottino raro |
Speciali: fiumi (attacco attraverso -30%), città (difesa x3, produzione x2).
Visivo: terreno solo con luminosità/trama, **il colore è riservato alle fazioni**. Toggle "modalità terreno".

## Truppe
Triangolo: fanteria > ricognitori > artiglieria > fanteria.
Ordine di sblocco (Arsenale): Fanteria, Ricognitori, Artiglieria → Corazzati, Genio, Cannoniera → Ricognizione aerea (abilità), Bombardamento (abilità), unità unica civiltà.
In run porti **4 truppe** delle sbloccate (come il mazzo di Clash).

## Albero tecnologico (Laboratorio, 20 tech, 5 rami x 4)
Esercito: Addestramento, Corazzati, Genio, Unità d'élite
Logistica: Strade, Rifornimenti, Porto e Cannoniera, Aviazione
Economia: Estrazione+, Città industriali, Commercio, Mercato nero
Difesa: Trincee, Bunker, Contraerea, Rete radar
La Caduta: Segnale, Frammenti, Prototipo, Tecnologia della Caduta (svela la lore)
Lineare all'inizio; dal livello 3 si sceglie un ramo per run. I nemici usano le truppe che sblocca il giocatore.

## Feeling della conquista (priorità alta)
Ibrido: **struttura a province di Call of War + espansione fluida di OpenFront + picchi alla Clash Royale.**
- **Espansione continua:** il colore si espande fluido sulle caselle come una macchia d'inchiostro, con un bordo luminoso sul fronte. Mai cambi di colore secchi.
- **Ritmo:** veloce sulle caselle vuote, più lento e combattuto ai confini con i nemici (il contrasto crea tensione).
- **Picco – provincia completa:** flash, stendardo che cade, nome della provincia a schermo, numero del bottino che salta fuori, suono pieno, vibrazione.
- **Picco – città, anomalia, capitale:** come sopra ma più forte.
- **Picco – fazione eliminata:** il suo colore si sbriciola + bollettino radio ironico (momento da video).
- **Combo:** tante caselle di fila = suoni di relè/telescrivente in crescendo; dopo un'ondata la mappa si "assesta".
- Vibrazione leggera a ogni conquista (Capacitor Haptics).
- Tutte le durate e intensità degli effetti in `balance.ts` per poterle regolare.

## Civiltà
Scelta **a ogni run**; ognuna ha 1 bonus, 1 unità unica, 1 edificio unico, una regione di partenza. Diverse, mai più forti.
Lancio (sistemi politici, non nazioni):
- **Empirium** — ordine e dominio (espansione, militare)
- **Republica** — senato e stabilità (difesa, crescita costante)
- **Aristocrazia** — cultura, tecnologia e degrado (tecnologia forte, alto rischio)
- **Elite** — lavori nell'ombra ed economia (spionaggio, commercio)
Empirium e Republica gratis, le altre da sbloccare. Ogni civiltà dà alle postazioni un aspetto proprio.

## Accampamento (home)
Sezioni: Accampamento · Gioca · Civiltà e generali · Sfide · Negozio.
Postazioni (6):
1. **Centro di Comando** — quartier generale, il suo livello sblocca tutto.
2. **Sala Radar** — per ora solo classifica (online: Game Center / Google Play Games o Supabase).
3. **Laboratorio** — studia la nuova tecnologia: albero tecnologico + svela poco alla volta il mistero della Caduta.
4. **Arsenale** — sblocca e migliora unità e armamenti.
5. **Estrazione** — spedizioni a tempo che tornano con cibo, metallo, benzina.
6. **Deposito** — capacità risorse e quanto bottino salvi se la campagna va male.
Ogni postazione **sblocca opzioni nelle run**, non solo numeri.
Timer: liv. 1–3 fino a 5 min, 4–6 fino a 2 h, 7+ 4–8 h. Spedizioni 30 min / 4 h / 8 h.
**I timer non bloccano mai le run.**

## Progressione
4 livelli di complessità, **un sistema nuovo alla volta**, insegnato giocando:
1. prime 3 run: truppe + 1 unità, prima vittoria entro 2 min
2. run 4–10: accampamento, 3 risorse, eventi, ritirata
3. dopo ~1 settimana: civiltà, tecnologie (max 20–25), mare/aria
4. veterani: generali, sfide, (futuro) multiplayer

## Regole di design
- Max 5–6 scelte a schermo. Mappa sempre libera al centro, comandi negli angoli in basso.
- Leggibilità > atmosfera: colori fazione forti + simboli (daltonismo).
- Ogni conquista dà soddisfazione visiva.
- Mai pay-to-win, mai loot box a pagamento.

## MVP (costruisci SOLO questo)
1 civiltà, 3 unità, 3 risorse, 10 eventi, 4 postazioni (Centro di Comando, Arsenale, Estrazione, Deposito), tempesta, ritirata, rivincita, onboarding, analytics.
**Fuori dall'MVP:** multiplayer, account, acquisti, sandbox, stagioni, classifiche online.

## Milestone
1. Mappa + conquista a tap
2. IA + combattimento + unità
3. Zaino, ritirata, tempesta, schermata finale
4. Accampamento + eventi
5. Juice, onboarding, estetica placeholder
6. Analytics + build Capacitor + test su Android economico

Dopo ogni milestone Nico gioca 10 minuti prima di andare avanti.
Obiettivo del test: **D7 > 20%** su ~20 tester.

---

## Note del developer (stato e comandi)

- `npm run dev` · `npm run build` · `npm run typecheck` · `npm run build:single` (pagina unica con JS inline in `dist-single/`:
  gli artifact bloccano gli script esterni) · `npm run gen:land` (rigenera `src/data/landmask.json` con `geoContains`, ~40 s: solo se cambia la griglia).
- `?seed=abc123` nell'URL → mappa riproducibile; `?fps=1` → contatore FPS. App Android: `npm run build && npx cap sync android`
  (APK da GitHub Actions a ogni push, solo orizzontale `sensorLandscape`). Il vecchio prototipo a esagoni è nel commit `cd22868`.
- **Stato: ricostruzione da zero, M1 ✅ lato codice** (mappa + conquista a tap). Il resto (IA, unità, zaino, accampamento…) è da rifare.
- Griglia: **quadrata 300×150** equirettangolare (lat 84…−60, Antartide esclusa), 13 414 caselle di terra; dati in array tipizzati
  (`src/map/world.ts`; `cellOf(w, i)` dà la vista `{ terrain, provinceId, owner, defense, loot, isCity, isRiver }`).
  "Esagoni" nella sezione Run: superato dalla griglia quadrata (Stile visivo + spec M1).
- Generazione da seed (`src/map/world.ts`): terreni con simplex-noise per fasce di latitudine (deserto ai tropici, foresta equatoriale e
  temperata), montagne a catene (noise a cresta), 6–10 fiumi dalle montagne al mare, 3–5 Zone della Caduta (bloccate, bottino raro).
  Province: semi distanziati + flood fill a turni (15–40 caselle) → **~490 province** (non ~60: con 15–40 caselle non ci stanno; numeri in `balance.provinces`).
  Nomi da `src/data/provinces.json` (nome + prefisso, unici), 1 città al centro, valore = terreni + città + bottino.
- Terreni (decisione del dev, `balance.terrain`, moltiplicatori sulla pianura): difesa base 2; montagna difesa ×2 velocità 0,35;
  deserto difesa 0,6 velocità 1,7 e non fa crescere le truppe; foresta difesa ×1 velocità 0,8 (gli effetti sulle unità arrivano con la M2);
  fiume attacco −30% (costo ÷0,7) e velocità 0,7; città difesa ×3.
- Conquista (`src/game/conquest.ts`): truppe +(1 + caselle×0,1 + città×1) ogni 500 ms (deserto escluso). Tap entro 14 caselle dal confine
  = ondata con 25/50/100% delle truppe: Dijkstra a tempo dal confine (45 ms/casella ÷ velocità terreno, più lenta di lato/indietro rispetto
  al bersaglio), ogni casella costa la sua difesa, il resto torna nel pool. Provincia completa → evento `provinceCaptured`.
- Rendering (`src/render/MapRenderer.ts`): base statica su canvas (luminosità + trama, costa e confini di provincia nel gap da 1px),
  territorio su RenderTexture aggiornata solo nelle caselle cambiate (batch), confine di fazione spesso e luminoso, alone a 1 texel per casella
  filtrato sotto il territorio, animazione fade + scala 150 ms per casella, lampo + stendardo + numero sulla provincia. Modalità terreno = colori.
  Camera: trascina, pinch/rotella, doppio tap = centra sul mio territorio. Fazione del giocatore in M1: Republica (`PLAYER` in `theme.ts`).
