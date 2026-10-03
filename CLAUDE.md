# CLAUDE.md — Ashen Atlas (nome di lavoro)

Sei il developer di questo gioco. Nico è designer/art director e decide estetica, feeling e bilanciamento.
Lavora una milestone alla volta. Chiedi solo se una decisione non è scritta qui.
**Fonte della visione: il Figma di Nico** (https://www.figma.com/design/wiJbr892yftHAh6St8jTHd): lore, civiltà, regole, risorse, truppe,
postazioni, estetica. Se questo file e il Figma non coincidono, vale il Figma.
**Il gioco si valida prima su browser** (pagina web / artifact), poi app.

## Cos'è
Gioco **single player** di conquista sulla mappa del mondo, con un **accampamento/HQ** personale.
Loop (Figma, "Regole"): **partita sandbox per estrarre risorse → Centro di Comando con upgrade a tempo → migliorie e prossimi nemici → estrazione risorse.**
Progressione con **campagne** di durata selezionabile (più lunghe = più risorse) che portano risorse per migliorare l'HQ, che aiuta a progredire.
Formula: si impara come Territorial, si torna come in Clash, si ragiona come in HOI4, si paga come in Polytopia.

## Lore
Mondo alternativo dopo un cataclisma, **la Caduta**. Le potenze mondiali si contendono il dominio del mondo dopo la scoperta di
**una nuova tecnologia**. Chi riuscirà a dominare il mondo? Il mistero della Caduta si svela poco alla volta (eventi rari, poi Laboratorio).
Tono: misterioso, freddo, tecnologico, tensione da potere e dominio (rapporti operativi, intercettazioni). Niente ironia da cartone.

## Civiltà (sistemi politici, non nazioni)
- **Imperium** — ordine e dominio
- **Republica** — senato e stabilità
- **Aristocrazia** — cultura, tecnologia e degrado
- **Cabal** — lavori nell'ombra ed economia
Ognuna: 1 bonus, 1 unità unica, 1 edificio unico, una regione di partenza. Diverse, mai più forti. MVP: il giocatore è la Republica,
le altre tre sono le IA.

## Risorse
**Cibo, Metallo, Benzina.** Il bottino della campagna finisce nel Deposito.

## Truppe
Fanteria, Ricognitori, Artiglieria (base; fanteria > ricognitori > artiglieria > fanteria) → Corazzati, Genio, Cannoniera →
Ricognizione aerea, Bombardamento (abilità) → unità unica per ogni civiltà.

## Postazioni (HQ)
1. **Centro di Comando** — il quartier generale. Il suo livello sblocca tutto.
2. **Sala Radar** — classifica e altro online (fuori MVP).
3. **Laboratorio** — studia la nuova tecnologia: albero tecnologico e, poco alla volta, il mistero della Caduta (fuori MVP).
4. **Arsenale** — sblocca e migliora unità e armamenti.
5. **Squadre di Estrazione** — spedizioni a tempo che tornano con cibo, metallo e benzina.
6. **Deposito** — capacità delle risorse e quanto bottino salvi se la campagna va male.
Timer brevi all'inizio, lunghi dopo. **I timer non bloccano mai le campagne.**

## Estetica (Figma, "Estetica" e "Loading screens")
Notte, centri di comando, radar e terminali verdi, mappe a griglia luminosa tipo heatmap, operazioni speciali con visori notturni,
toppe/insegne di reparto, tipografia luminosa. Leggibilità prima di tutto: colori fazione forti + simboli (daltonismo).

## Run (campagna sulla mappa)
- Mappa del mondo a esagoni, riconoscibile ma alterata (seed), divisa in nazioni reali e province con città.
- Truppe generiche (pool) che crescono col territorio; tap/avanzata per conquistare; unità come pedine.
- Eventi a carta con 2 scelte ~ogni 90 s. Fine: tempesta che restringe la mappa (~8 min). Ritirata = tieni il bottino; eliminato = perdi il 70%.
- Vittoria: 60% della regione / 3 anomalie / più territorio all'arrivo della tempesta.

## Regole di design
- Max 5–6 scelte a schermo. Mappa sempre libera al centro, comandi negli angoli in basso.
- Ogni conquista dà soddisfazione visiva. Mai pay-to-win, mai loot box a pagamento.
- Tutti i numeri in `src/config/balance.ts`. Contenuti (eventi, unità, edifici) in JSON in `src/data/`.

## MVP (costruisci SOLO questo)
1 civiltà, 3 unità, 3 risorse, 10 eventi, 4 postazioni (Centro di Comando, Arsenale, Estrazione, Deposito), tempesta, ritirata,
rivincita, onboarding, analytics. **Fuori dall'MVP:** multiplayer, account, acquisti, sandbox libera, stagioni, classifiche online.

## Milestone
1. Mappa + conquista a tap · 2. IA + combattimento + unità · 3. Zaino, ritirata, tempesta, schermata finale · 4. Accampamento + eventi ·
5. Juice, onboarding, estetica placeholder · 6. Analytics + build (prima web, poi Capacitor) + test.
Dopo ogni milestone Nico gioca 10 minuti prima di andare avanti. Obiettivo del test: D7 > 20% su ~20 tester.

---

## Note del developer (stato e comandi)

- **Sistemi dal Figma** (numeri in `balance.ts`: `campaigns`, `progression`, `civs`, `tech`, `camp.radarFogBonus`; testi in `src/data/civs.json`,
  `tech.json`, `buildings.json`; logica in `src/game/civs.ts`, `tech.ts`, `mods.ts`, `camp.ts`):
  **Campagne** breve 5 min ×0,8 risorse / standard 8 min / lunga 12 min ×1,4 (si sceglie dopo la run guidata).
  **Civiltà** (scelta dopo 3 campagne; Republica e Imperium libere, Aristocrazia = 3 vittorie, Cabal = 3 spedizioni): bonus sempre attivo +
  edificio unico che agisce sugli insediamenti + unità unica con Arsenale liv. 3 (Legionari, Guardia, Prototipo, Infiltrati: stessa classe
  della base nel sasso-carta-forbice). Le IA sono le altre tre potenze, con colore e simbolo fissi per civiltà (`assignFactions`).
  **Laboratorio** (postazione): 12 ricerche in 5 rami, una alla volta a tempo reale, in ordine dentro il ramo, il livello del laboratorio
  limita il grado; il ramo "La Caduta" sblocca 4 frammenti dell'archivio (la lore si svela). **Sala Radar**: registro locale delle campagne
  (record, vittorie per civiltà, ultime 20) + vista in più; la classifica online resta fuori dall'MVP.
  Tutto confluisce in `RunOptions.mods` (moltiplicatori/addendi) letti da `RunState`. Run guidata: nessun bonus.

- **Allineamento al Figma** (ultima modifica): lore della Caduta al posto del "Silenzio"; fazioni Republica (tu), Imperium, Aristocrazia,
  Cabal; risorse Cibo/Metallo/Benzina; Ricognitori al posto dei Raider; postazioni Arsenale (ex Fucina), Centro di Comando (ex Radio:
  eventi, frammenti sulla Caduta, allerta tempesta; le altre postazioni non lo superano di più di un livello), Deposito (ex Magazzino),
  Squadre di Estrazione (ex camion). Testi in `src/data/*.json` riscritti nel tono del Figma. I vecchi salvataggi vengono convertiti
  (`migrate` in `src/save/storage.ts`). Le note sotto possono usare ancora i nomi vecchi.

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
  **Nebbia** (`fog`): vedi entro 6 caselle dal territorio, 5 dalle pedine, 3 dalle navi; niente velo scuro (Nico: "togli ombra"):
  fuori vista la mappa si vede ma territorio, pedine e nomi nemici no; anomalie sempre visibili (`fog.shade` riaccende il velo). Niente nebbia né navi nella run guidata. Leve ricordate tra le run (`loadPrefs`/`savePrefs`).
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
  caselle, onda radioattiva sulle anomalie, coriandoli in vittoria. Estetica: vedi "Stile schermo di comando".
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
- **Stile schermo di comando** (richiesta di Nico, riferimento: mappa al fosforo su monitor): fondo scuro, reticolo geografico ogni 10°
  con coordinate e scala in km, esagoni con reticolo sottile, **coste e confini nazionali veri** (Natural Earth 110m, linee al fosforo con alone)
  sopra la griglia, province come linee sottili, nomi delle nazioni spaziati, niente ombre/contorni sui testi. Territorio = colore fazione
  semitrasparente + bordo chiaro. Colori in `src/config/palette.ts` (chiavi vecchie, valori nuovi); accampamento in versione notturna.
- **Griglia fine** (Nico: "mooolti più territori"): 200×100 esagoni (~6100 di terra, ~420 province da ~12 caselle; prima 120×60, ~170).
  Numeri riscalati in `balance.ts` per tenere lo stesso ritmo in superficie (partenza a 2 anelli, avanzata 65 ms, IA, distanze, bottino per casella);
  `sim.ts` 2 tocchi/s: 4 vittorie su 6 come prima.
