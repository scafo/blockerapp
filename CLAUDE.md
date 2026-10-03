# CLAUDE.md — Ashen Atlas (nome di lavoro)

Sei il developer di questo gioco. Nico è designer/art director e decide estetica, feeling e bilanciamento. Lavora una milestone alla volta. Chiedi solo se una decisione non è scritta qui.

## Cos'è

Gioco mobile single player di conquista sulla mappa del mondo, con un accampamento personale. Loop: run sulla mappa → bottino → l'accampamento cresce → la run successiva è diversa. Formula: si impara come Territorial, si torna come in Clash, si ragiona come in HOI4, si paga come in Polytopia.

## Feeling (verifica ogni scelta contro queste 3 parole)

**Epico** (costruire un impero, chiarezza) · **Curioso** (mistero, esplorazione) · **Ironico** (umorismo nero, calore nella rovina). Tecnologia analogica anni '40–'70 + un solo elemento inventato: le anomalie. Evita: ottone/ingranaggi (steampunk), HUD tattici moderni (MW3), qualsiasi IP Fallout (vault, mascotte, nomi).

## Lore

1971: un segnale misterioso, "il Silenzio", spegne la tecnologia avanzata. 40 anni dopo le fazioni ricostruiscono imperi quasi feudali. Le zone di anomalia emettono ancora il segnale. Il mistero si svela poco alla volta negli eventi. Tono: bollettino radio anni '50, ironico.

## Stack

- Phaser 3 + TypeScript + Vite; app con Capacitor (iOS/Android). Niente server.
- d3-geo + world-atlas 110m per la griglia sul mondo.
- Salvataggio locale (try/catch); GameAnalytics per D1/D7.
- Verticale e orizzontale: layout adattivo (decisione di Nico; prima era solo orizzontale).
- Tutti i numeri in `src/config/balance.ts`. Contenuti (eventi, civiltà, unità, edifici) in JSON in `src/data/`.

## Run

- Mappa del mondo a esagoni, riconoscibile ma alterata: coste, rovine, zone tossiche e partenza cambiano a ogni run (seed).
- Truppe generiche (pool) crescono col territorio; tap su casella adiacente = attacco (`troops > defense`).
- Unità speciali come carte: fanteria pesante, raider, artiglieria (sasso-carta-forbice). Mare e aria si sbloccano dopo; gli aerei sono abilità a ricarica, non unità.
- Economia a 2 leve: soldati vs lavoratori.
- Risorse: Rottami, Carburante, Viveri. Bottino nello zaino.
- Eventi stile Reigns: carta con 2 scelte, ~ogni 90 s.
- Fine: tempesta che restringe la mappa (~8 min base). Ritirati = tieni lo zaino; eliminato = perdi il 70%. Tasto Rivincita stessa mappa.
- Vittoria: 60% della mappa / 3 anomalie / più territorio all'arrivo della tempesta.
- Velocità x1/x2/x4. Difficoltà: Recluta, Comandante, Generale, Incubo.
- IA: fazioni che attaccano la casella vicina più debole (poi migliorabile).

## Civiltà

Scelta a ogni run; ognuna ha 1 bonus, 1 unità unica, 1 edificio unico, una regione di partenza. Diverse, mai più forti. Lancio: Nuova Roma, Lega Baltica (gratis), Dominio delle Sabbie, Ordine del Segnale (da sbloccare).

## Accampamento (home)

Sezioni: Accampamento · Gioca · Civiltà e generali · Sfide · Negozio. Edifici: Comando, Mensa, Hangar spedizioni, Fucina, Magazzino, Radio, Archivio, Cartografo, Caserma generali, Molo, Pista, Sala trofei. Ogni edificio sblocca opzioni nelle run, non solo numeri. Timer: liv. 1–3 fino a 5 min, 4–6 fino a 2 h, 7+ 4–8 h. Spedizioni 30 min / 4 h / 8 h. I timer non bloccano mai le run.

## Progressione

4 livelli di complessità, un sistema nuovo alla volta, insegnato giocando:

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

1 civiltà, 3 unità, 3 risorse, 10 eventi, 3 edifici (Fucina, Radio, Magazzino), spedizioni, tempesta, ritirata, rivincita, onboarding, analytics. Fuori dall'MVP: multiplayer, account, acquisti, sandbox, stagioni, classifiche online.

## Milestone

1. Mappa + conquista a tap
2. IA + combattimento + unità
3. Zaino, ritirata, tempesta, schermata finale
4. Accampamento + eventi
5. Juice, onboarding, estetica placeholder
6. Analytics + build Capacitor + test su Android economico

Dopo ogni milestone Nico gioca 10 minuti prima di andare avanti. Obiettivo del test: D7 > 20% su ~20 tester.

---

## Note del developer (stato e comandi)

- `npm run dev` · `npm run build` · `npm run typecheck`
- `npm run build:single` — pagina unica con JS inline (`dist-single/`): gli artifact bloccano gli script esterni, usare questa.
- `npm run check:land` — verifica la maschera terra contro `geoContains` (a runtime si usa un point-in-polygon planare: 50 ms invece di 5 s).
- `npx vite-node scripts/sim.ts 1 6 1` — simula 6 run senza grafica (giocatore 1 tap/s, usa le pedine) per tarare `balance.ts`.
- `?seed=abc123` nell'URL → mappa riproducibile.
- Stato: M1 ✅ · M2 ✅ · M3 ✅ · M4 ✅ · M5 ✅ · M6 ✅ lato codice (manca: chiavi GameAnalytics e test sul telefono → `TESTING.md`).
- M6: analytics in `src/analytics/analytics.ts` (chiavi in `src/config/analytics.ts`, vuote = spento). App Android con Capacitor
  (`android/`, verticale e orizzontale, schermo intero); l'APK lo compila GitHub Actions a ogni push (`.github/workflows/android-apk.yml`).
  Web: `vercel.json`. Mappa statica disegnata una volta in una texture (prestazioni).
- Schermo: disegno a densità reale (`src/ui/screen.ts`: DPR max 2, 1,5 sui telefoni deboli); le scene di interfaccia ragionano
  in punti CSS con `view(this)` + `uiCamera(this)`. HUD, accampamento, schermata finale e carte si adattano a verticale/orizzontale.
  Vibrazioni brevi in `src/ui/haptics.ts`. Contatore FPS: 5 tocchi sul titolo
  nell'accampamento o `?fps=1`. Dopo modifiche web per l'app: `npm run build && npx cap sync android`.
- Gameplay (richieste di Nico), numeri in `balance.ts`:
  **crescita truppe originale** (caselle × 0,1 a tick, nessun tetto: il tetto alla OpenFront è stato tolto su richiesta).
  **Soldati vs lavoratori** (tasto LAVORO 0/25/50/75%, parte da 0): i lavoratori riempiono lo zaino, l'esercito cresce meno.
  **Forza d'attacco** (tasto ATTACCO 25/50/100%): budget di un'avanzata e truppe imbarcate sulle navi.
  **Insediamenti**: rovine possedute = +3 caselle di crescita e difesa più alta (casetta sulla mappa).
  **Navi** (`boats`, `src/game/boats.ts`): tocco su una costa irraggiungibile via terra → nave dalla tua costa più vicina
  (max 30 caselle di mare, 3 in viaggio); sbarca se supera la difesa, i superstiti tornano nel pool. Le IA non usano navi.
  **Nebbia** (`fog`): vedi entro 4 caselle dal territorio, 3 dalle pedine, 2 dalle navi; mai visto = scuro, già visto = velato;
  pedine e nomi nemici nascosti nella nebbia; anomalie sempre visibili. Disegnata in una texture a mezza risoluzione solo quando
  la vista cambia. Niente nebbia né navi nella run guidata. Leve ricordate tra le run (`loadPrefs`/`savePrefs`).
- **Nazioni e province alla Call of War** (richiesta di Nico; `provinces` in `balance.ts`, `src/map/countries.ts`): ogni casella
  appartiene al suo paese reale (Natural Earth 110m, nomi italiani in `src/data/countries-it.json`); ogni nazione è divisa in
  province di ~16 caselle attorno a città scelte a ogni run. Prendi la città → le caselle neutrali della provincia si arrendono
  (anomalie escluse); la capitale (stella) dà +40 truppe la prima volta. Città più difese; le IA le cercano. Carta politica:
  confini nazionali tratteggiati, linee sottili tra province, nomi delle nazioni visibili solo con lo zoom lontano.
  Staterelli sotto 3 caselle senza città.
- Controlli mappa (M5): tocco su casella adiacente = attacco; tocco lontano = **avanzata** (il confine "cola" verso il bersaglio,
  una casella ogni 160 ms finché bastano le truppe; tocco sul tuo territorio = alt); trascinamento che parte dal tuo territorio =
  **dipingi** la frontiera; trascinamento altrove = sposta; due dita = zoom + sposta. Numeri in `balance.ts` (`flow`).
- Onboarding (M5): alla primissima apertura si entra subito in una run guidata (1 IA che non attacca, niente tempesta/eventi,
  si vince con 40 caselle): frecce + anello + etichette di 2–5 parole, un passo alla volta (tocca → truppe → avanzata → trascina →
  pedina → ordine → obiettivo). Poi si scopre l'accampamento. Effetti: lampo sulle caselle prese, cartelli a 25/50/100/200/400
  caselle, onda radioattiva sulle anomalie, coriandoli in vittoria. Estetica: coste nette, mare tratteggiato, rosa dei venti.
- M4 (decisioni del dev): l'app si apre sull'**accampamento** (`CampScene`; `?seed=` salta direttamente in una run).
  3 edifici a 3 livelli, 1 cantiere alla volta, timer reali 1–5 min. Fucina: liv.0 solo Fanteria → +Raider → +Artiglieria → +25% vita.
  Radio: eventi → eventi rari (lore del Silenzio) → avviso tempesta +30 s. Magazzino: perdita 70% → 40% → 25% → +10% in ritirata.
  Spedizioni 30 min (gratis) / 4 h / 8 h, pagate in viveri, una alla volta, bottino deciso alla partenza.
  Tende: +1 ogni 2 run. Eventi: 10 in `src/data/events.json` (7 comuni, 3 rari), ~ogni 90 s, run in pausa, carta da trascinare.
  Testi edifici in `src/data/buildings.json`, numeri in `balance.ts` (`camp`, `events`).
- M3 (decisioni del dev, tutte in `balance.ts`): le rovine contengono una sola risorsa (Rottami 50%, Carburante 25%, Viveri 25%).
  5 anomalie (caselle-segnale, difesa alta) nella regione del giocatore; tenerne 3 = vittoria. 60% = della regione raggiungibile.
  Tempesta di cenere: avviso a 7:00 col confine finale, arriva a 8:00 e si chiude in 90 s attorno a un punto vicino al baricentro
  della regione; a chiusura vince chi ha più territorio, altrimenti "travolto" = come eliminato (−70%). Vittoria = +50% zaino.
  Ritirata a doppio tocco in qualsiasi momento. Lo zaino finisce nella scorta dell'accampamento (localStorage, `src/save/`).
  Bollettini di fine run in `src/data/bulletins.json`.
- Unità (decisione di Nico): **pedine sulla mappa**, pagate con truppe del pool. Carta → tocca un tuo territorio → la pedina compare;
  tocca la pedina → tocca una casella → ci va casella per casella conquistando (perde hp = difesa × captureCost).
  Fanteria > Raider > Artiglieria (gittata 2) > Fanteria. Si curano sul proprio territorio. Ogni IA ha un'unità preferita
  (icona nel pannello fazioni). Testi in `src/data/units.json`, numeri in `balance.ts` (`units`, `aiUnits`).
