# Archeon — mercato, viralità e "game feel"

*23 novembre 2026. Ricerca e strategia. Nessun file di codice toccato. Non ripete `docs/ui-ricerca.md` (interfaccia) né
`docs/economia.md` (numeri di economia, retention, monetizzazione, costi del multigiocatore): quando serve li richiama.*

**Legenda**
- **[F n]**: fonte esterna, elenco numerato in fondo. Molti numeri di mercato sono **stime di terzi** (Sensor Tower, Gamalytic,
  Semrush, Appfigures…), non dati ufficiali: valgono come ordine di grandezza.
- **[CODICE]**: letto nel repository (`RunState.ts`, `world.ts`, `ResultScene.ts`, `analytics.ts`, `supabase/schema.sql`).
- **[IPOTESI]**: giudizio mio, da verificare con i tester o con i dati.
- Le stime di fatica sono in **giorni di lavoro di Nico + sviluppatore AI** (codice scritto dall'AI, prove e decisioni di Nico).

---

## 0. In una pagina

1. **Il mercato premia la strategia, ma non quella "pesante".** Sul telefono la strategia è stata nel 2025 l'unica categoria in crescita
   su ricavi, download e tempo di gioco, trainata dai 4X ibridi (Last War, Whiteout Survival) [F3, F4, F5]. Su Steam la strategia vale ~14%
   dei ricavi storici, ma RTS e strategia a turni classici calano e salgono gli ibridi brevi "alla roguelite" [F7, F8]. La motivazione
   "strategia" nei sondaggi dei giocatori è quella calata di più in nove anni [F10]. **Lezione: strategia leggibile in 10–20 minuti, sì;
   strategia da manuale, no.** Archeon è dalla parte giusta se mantiene la promessa "si impara come Territorial".
2. **La posizione migliore**: *"Territorial/OpenFront che puoi mettere in pausa, da solo, con una base che cresce tra una partita e l'altra
   e un mistero che si svela"*. Nessuno dei .io ha progressione e pausa; nessuno dei 4X mobile parte in 5 secondi dal browser.
3. **Il canale giusto per partire è il web** (proprio sito + portali come CrazyGames/Poki, che hanno 35–100 milioni di giocatori al mese e
   fanno da test di mercato gratuito) [F11, F12, F13]; **Steam dopo**, con pagina e demo, quando ci sono numeri e materiale da mostrare
   (Next Fest aiuta solo chi ha già ~2.000 wishlist) [F14].
4. **Quasi tutti i grandi successi recenti sono esplosi per un motivo solo**: un momento che si guarda volentieri anche senza giocare
   (Among Us, Lethal Company, Helldivers 2, R.E.P.O.), un risultato che si condivide senza spoiler (Wordle), un prezzo d'impulso
   più streamer (Vampire Survivors, Balatro), una frase-meme (Palworld). Per un gioco di conquista sulla mappa del mondo i meccanismi
   che si trasferiscono sono tre: **la mappa finale/timelapse come immagine da condividere**, **la sfida con lo stesso mondo per tutti**
   (seme del giorno, Polytopia/Wordle) e **i paesi veri come esca per i commenti** ("gioca con l'Italia", "perché la Francia è sparita?").
5. **Le 10 azioni** (dettaglio in §3 e §5): cartolina di fine campagna · timelapse da 10 s · Operazione del giorno con classifica ·
   link di sfida · primo minuto più esplosivo · momenti da clip (sacca, tradimento, capitale caduta) · ultimi 2 minuti in crescendo ·
   voto della chat Twitch sulle carte evento · build per CrazyGames + Discord · 3 corti a settimana su TikTok/Shorts dalla stessa
   pipeline del timelapse.

---

## 1. Il mercato 2022–2026

### 1.1 Dimensione e tendenze

| Dato | Valore | Fonte |
|---|---|---|
| Mercato videogiochi 2025 | ~196,7 mld $ (+7,4%); PC il segmento che cresce di più (+10,4%, ~43 mld $), mobile ~108 mld $ | Newzoo via GamesBeat/Pocketgamer [F1] |
| Mobile, acquisti in-app 2025 | ~82 mld $ (+1%), download −7%: mercato maturo, si cresce togliendo giocatori agli altri | Sensor Tower [F3] |
| Strategia su mobile | 24% della spesa nel 1° semestre 2025, +26% anno su anno; **unica categoria in crescita su ricavi, download e tempo** | Sensor Tower via Pocketgamer.biz [F4, F3] |
| 4X ibridi | Last War oltre 1,1 mld $ nel 2024; Whiteout Survival 1° incasso mondiale ad agosto 2025 (~136 mln $ nel mese); pubblicità fatta di "minigiochi" che non sono il gioco | Naavik, Appfigures, 36Kr [F5, F6] |
| Ibrido-casual | +17–20%, ~4,2 mld $ nel 2025: il segmento che monetizza meglio | Sensor Tower via stampa [F3] |
| Strategia su Steam | ~14% dei ricavi storici di Steam; dentro la strategia domina la MOBA; RTS e strategia a turni in calo 2021→2025, crescono gli ibridi "roguelite" (ipotesi degli analisti) | GameDiscoverCo [F7, F8] |
| Steam 2025, chi ha venduto | i primi posti sono giochi cooperativi caotici ("friendslop": R.E.P.O. ~147 mln $, Peak ~87 mln $, Schedule I ~151 mln $) a **8–20 $** | Kotaku, Game World Observer (stime) [F9] |
| Web | Poki ~100 mln di giocatori al mese (10 mln nel 2020), 1 mld di partite al mese; CrazyGames 35–60 mln al mese; 62% dei giocatori web dice di aver scaricato o comprato un gioco dopo averlo provato nel browser | Poki, CrazyGames, sondaggio Poki/Atomik [F11, F12, F13] |
| Motivazione "strategia" | la motivazione calata di più in 9 anni di sondaggi (eccezione: Cina); pubblico della strategia più anziano e molto maschile | Quantic Foundry [F10] |

**Cosa è cresciuto**
- **Ibridi**: 4X + minigiochi casual (mobile), strategia + roguelite (Steam: Against the Storm, Thronefall, i "tower defense roguelike"
  dei solisti, es. Tangy TD ~250.000 $ in una settimana, Gnomes ~360.000 $) [F15]. Formula comune: **partita breve con decisioni
  forti + progressione tra le partite**. È esattamente il ciclo campagna → HQ di Archeon.
- **Giochi da browser multigiocatore "massivi"**: Territorial.io (5 milioni+ di installazioni Android, ~2 milioni di visite al mese),
  OpenFront (nato sul web, poi su Steam con numeri piccoli: ~27.000 copie stimate, ~650 giocatori medi) [F16, F17]. La comunità vive su
  YouTube e tornei su Twitch più che sui negozi.
- **Social/cooperativi a prezzo basso** su Steam (non è il nostro genere, ma insegna la distribuzione: amici che si trascinano a vicenda).

**Chi gioca a strategia** [F10, IPOTESI]: su PC uomini 25–45 anni, molti che giocavano a HOI4/EU4/Civ e oggi hanno meno tempo ("una
partita da 20 minuti in pausa pranzo"); sul web ragazzi 13–25 che arrivano da Territorial/OpenFront/agar.io e da YouTube; su
telefono pubblico 30–50 anni che spende nei 4X. **Archeon parla bene ai primi due**: il terzo vuole il 4X da 3 anni con alleanze.

### 1.2 Modelli di prezzo che hanno funzionato

| Modello | Esempi | Per chi funziona |
|---|---|---|
| Gratis + pubblicità (portali) | Territorial, OpenFront, agar.io | traffico enorme, ricavo basso per giocatore |
| Gratis + acquisti "onesti" con tetto | Polytopia (tribù 1–4 $, 25 mln di download organici) [F18] | single player strategico: la nostra strada (vedi `economia.md` §4) |
| Premium economico | Vampire Survivors 3–5 $, Balatro ~15 $, friendslop 8–20 $ [F19, F20, F9] | Steam, acquisto d'impulso spinto dagli streamer |
| Gratis + battle pass/estetica | Fortnite, Marvel Rivals (10 mln di giocatori in 72 h) [F21, F22] | grandi studi, multigiocatore |
| 4X a balena | Last War, Whiteout | serve un budget pubblicitario da decine di milioni: **fuori portata** |

### 1.3 Piattaforme: pro e contro per Archeon

| Canale | Pro | Contro | Verdetto |
|---|---|---|---|
| **Proprio sito** (Vercel, già pronto) | Lume con Stripe acceso, link condivisibili con seme, dati completi | zero traffico spontaneo | **base di tutto**: ogni condivisione porta qui |
| **CrazyGames** | "Basic Launch" di 7–21 giorni su un pubblico limitato con metriche, gratis; poi "Full Launch" con quota pubblicitaria se i numeri reggono [F23] | serve il loro SDK; acquisti in-game solo tramite il loro sistema (su invito, secondo guide terze) e, per quanto risulta, niente link esterni: **da verificare** nei requisiti [F23] | **test di mercato n. 1**: misura D1, durata e tempo di gioco su sconosciuti |
| **Poki** | il portale più grande, cura editoriale | si entra su selezione, solo pubblicità | candidatura dopo un buon Basic Launch |
| **itch.io** | comunità indie, devlog, nessuna barriera | poco traffico per giochi da browser | vetrina e devlog, costo zero |
| **Steam** | i giocatori di strategia stanno lì; demo e Next Fest | serve una build desktop (Electron/Tauri), capsule, trailer; acquisti in-game con il sistema di Steam; Next Fest rende solo oltre ~2.000 wishlist, tetto ~15.000 [F14] | **fase 2** (dal mese 3–4): pagina presto per raccogliere wishlist, demo almeno 1 mese prima di un Next Fest |
| **Google Play** | telefono = dove sta la spesa sulla strategia | Play Billing obbligatorio, schede, recensioni; la campagna da 20 min è una sessione da PC (vedi `economia.md` §2.1) | dopo il web, con campagna da 10 min che valga |

### 1.4 Cosa può raggiungere realisticamente un solista [IPOTESI motivate]

- **Scenario prudente** (nessun momento virale): 2.000–10.000 giocatori al mese tra sito e portali dopo 3 mesi, Discord da 100–300 persone.
  Con i numeri di `economia.md` §4.3: 15–170 € al mese.
- **Scenario buono** (un corto da 500.000+ visualizzazioni o uno streamer medio): picco di 50.000–200.000 visite in una settimana,
  poi assestamento a 10.000–30.000 al mese. È ciò che è successo a OpenFront sul web e a molti giochi da TikTok [F17, F24].
- **Scenario raro** (Territorial, Balatro): non si pianifica, si prepara (il gioco deve reggere picchi: tutto in locale, Supabase solo
  per classifiche e acquisti, quindi già robusto [CODICE]).
- Il fattore che sposta più di tutti è **la qualità dei primi 5 minuti per uno sconosciuto** (CrazyGames lo misura da solo) e
  **quante partite finiscono con una condivisione**.

### 1.5 Dove si colloca Archeon e come presentarlo

**Frase da 7 parole** (per TikTok, scheda del portale, Reddit): *"Conquista il mondo in 20 minuti. Mettilo in pausa."*
Alternative da provare: *"Territorial.io, ma con una base e una storia"* (per chi conosce il genere), *"HOI4 in una pausa caffè"*.

Pilastri da comunicare in quest'ordine (dal più visibile in 3 secondi al più profondo):
1. **La mappa del mondo che si colora** (è l'immagine-esca: funziona da sola nei video, vedi i timelapse di OpenFront e i video "every
   country" su YouTube).
2. **Pausa strategica e diplomazia** (la differenza con i .io: si pensa, non si clicca a raffica).
3. **La base** (motivo per tornare) e **il mistero degli Alati e del Lume** (motivo per parlarne: teorie, archivio, eventi rari).

Rischio di posizionamento: la carta "da terminale" a puntini è bella ma, in un video da 2 secondi, **meno leggibile** di una mappa a
colori pieni. Per i video e la cartolina conviene una vista "manifesto" a colori pieni della stessa mappa (vedi §3.1).

---

## 2. Come sono diventati virali (meccanismo per meccanismo)

### 2.1 I casi

| Gioco | Meccanismo specifico | Prova | Si trasferisce ad Archeon? |
|---|---|---|---|
| **Among Us** (2018, esploso 2020) | partita sociale fatta per essere guardata (accuse, tradimenti), streamer che giocano *tra loro* e si portano dietro i pubblici; gratis su telefono | uscito nel 2018, esplode dopo Sodapoppin (luglio 2020) e la catena xQc/Toast/Ludwig; picco 774.000 spettatori su Twitch [F25] | **in parte**: il "tradimento" esiste (diplomazia, alleanze) ma è contro l'IA. Va reso spettacolare (§3.6) |
| **Fall Guys** (2020) | caos fisico comico, lancio gratis con PlayStation Plus, round da 1–2 min | — (nessuna fonte trovata in questa ricerca; noto) | poco: niente caos fisico |
| **Vampire Survivors** | prezzo d'impulso (3 $), "una partita ancora", schermo che si riempie; streamer che dicono "compratelo ora" | 27 milioni di giocatori; l'autore: prezzo "giusto, non furbo" [F19] | **sì**: la sensazione di "il mio impero diventa enorme" e la partita breve |
| **Balatro** | demo ripetute, più Next Fest, streamer, passaparola; ogni mano è un piccolo "boom" numerico | 500.000 copie in 10 giorni, 1 milione in un mese, 5 milioni dopo; seconda demo decisiva [F20] | **sì**: numeri che esplodono a fine campagna, demo come motore |
| **Lethal Company** | chat vocale di prossimità = clip comiche, ogni partita genera una storia | picco 117.000 su Steam, 180.000 spettatori su Twitch [F26] | **no** (niente voce), ma insegna: *ogni partita deve produrre una storia raccontabile* |
| **Helldivers 2** | guerra galattica condivisa: le scelte della comunità diventano storia ufficiale (Malevelon Creek, Difesa di Mort), account TikTok di "propaganda" fatti dai fan | stampa: storia "scritta dai giocatori", clip ovunque su TikTok/X [F27] | **molto**: una *guerra mondiale della comunità* sulla stessa mappa del mondo con la lore dell'Avvento (§3.9) |
| **Palworld** | frase-meme "Pokémon con le pistole", contrasto assurdo, streamer al lancio | 5 milioni in 3 giorni, 25 milioni poi [F28] | **sì come lezione di comunicazione**: serve una frase che la gente ripete ("angeli caduti + Seconda guerra mondiale") |
| **Fortnite** | gratis e su tutte le piattaforme, streamer (Ninja + Drake 600.000+ spettatori), balli come linguaggio dei meme | [F21] | poco (budget), ma: *gratis e subito nel browser* è già il nostro "gratis e ovunque" |
| **Marvel Rivals** | gratis, IP famosa, eroi sbloccati per tutti | 10 milioni in 72 h [F22] | no (IP, budget) |
| **R.E.P.O., Peak, Schedule I** (2025) | "friendslop": cooperativi caotici a 8–20 $, clip di fallimenti comici, si comprano per giocare con gli amici | i tre giochi indie più venduti del 2025 su Steam [F9] | **no come genere**; sì la lezione: *il fallimento deve essere divertente da guardare* (una sconfitta spettacolare si condivide quanto una vittoria) |
| **Clash Royale** | partite di 3 minuti, forzieri a tempo che fanno tornare, replay condivisi nel clan, TV Royale per guardare i migliori, "doppio elisir" nell'ultimo minuto | ~1 mld $ nel primo anno [F29] | **sì**: ultimo minuto in crescendo, replay, timer gentili |
| **Polytopia** | sfida settimanale con lo stesso seme per tutti e un solo tentativo, tornei giornalieri, nessuna pubblicità | 25 milioni di download organici; tornei giornalieri usati dal ~10% dei giocatori del giorno [F18] | **sì, quasi identico**: `RunState` è già generato da un seme [CODICE] |
| **Territorial.io / OpenFront** | partita subito nel browser, nessun account, mappa del mondo, YouTuber che caricano partite e timelapse, tornei | Territorial 5M+ installazioni; OpenFront: picco di streamer al lancio su YouTube, canale di tornei su Twitch [F16, F17] | **sì**: è il nostro genere |
| **agar.io / slither.io** | link condiviso su 4chan → YouTuber (PewDiePie) → 2 miliardi di visualizzazioni; gioco comprensibile in 1 secondo di video | agar.io gioco più cercato su Google nel 2015; slither.io 60 milioni di giocatori al giorno [F30] | **sì**: leggibilità immediata del video (un colore che si mangia gli altri) |
| **Wordle** | un tentativo al giorno uguale per tutti, griglia di emoji che **mostra il risultato senza spoiler** | la griglia nasce da un gruppo di giocatori in Nuova Zelanda, l'autore la aggiunge: esplosione a dicembre 2021 [F31] | **sì**: "Operazione del giorno" con risultato in emoji (§3.3) |
| **GeoGuessr** | la mappa del mondo come conversazione ("come hai fatto a capire che era il Cile?"), creatori come Rainbolt su TikTok, modalità battle royale | Rainbolt 14 milioni di visualizzazioni per una clip; picchi dopo gli streamer [F32] | **sì**: i paesi veri accendono i commenti; sfide "da creatore" (§3.10) |
| **4X mobile (Last War)** | pubblicità con minigiochi che non sono il gioco | più della metà delle impressioni pubblicitarie [F5] | **no** (ingannevole e costoso); ma la lezione è vera: *il primo secondo deve essere un minigioco comprensibile* |

### 2.2 I meccanismi, in astratto

1. **Guardabile senza giocare** (Among Us, Lethal Company, Helldivers): il gioco produce momenti che chi guarda capisce e commenta.
2. **Risultato condivisibile e confrontabile** (Wordle, Polytopia): stesso problema per tutti, risultato breve, nessuno spoiler.
3. **Accesso a costo zero** (Fortnite, agar.io, Territorial): gratis, nel browser, niente account. Archeon c'è già.
4. **Prezzo/attrito d'impulso + streamer** (Vampire Survivors, Balatro): lo streamer dice "provatelo" e il pubblico può farlo in 10 secondi.
5. **Una frase o un'immagine-meme** (Palworld, "every country" della mappa).
6. **Storia collettiva** (Helldivers): la comunità cambia il mondo, e ne parla.
7. **Sessione breve + "un'altra"** (Clash Royale, Vampire Survivors): più partite = più occasioni di condividere.
8. **Fallimento divertente** (friendslop): anche perdere è contenuto.

### 2.3 Cosa si trasferisce a un gioco di conquista sulla mappa

| Meccanismo | Trasferimento | Peso [IPOTESI] |
|---|---|---|
| Risultato condivisibile | mappa finale + stats in un'immagine; risultato del giorno in emoji | **alto** |
| Stesso mondo per tutti | seme del giorno/settimana, classifica, link di sfida | **alto** |
| Guardabile | timelapse dell'espansione (è il formato che già vive su YouTube per OpenFront/EU4), momenti cinematografici | **alto** |
| Paesi veri | "parti dall'Italia", "Italia unita in 3:12", nomi delle nazioni sulla mappa | **medio-alto** (commenti e campanilismo) |
| Streamer | voto della chat sulle carte evento, pausa per parlare, nomi dei rivali dalla chat | **medio** |
| Storia collettiva | guerra della comunità + conto alla rovescia dell'Avvento | **medio** (serve una base di giocatori) |
| Fallimento divertente | schermata "Eliminato" con il racconto della caduta (e l'immagine della mappa) | medio-basso |
| Tradimento sociale | non c'è un altro umano: si simula con diplomazia teatrale | basso |

---

## 3. Funzioni virali per Archeon (ordinate per impatto/fatica)

Ordine = impatto stimato diviso fatica, per un solista. Fatica in giorni (Nico + AI). Base tecnica già presente [CODICE]:
Phaser 3 + Vite, mappa generata da un seme (`map.seed`, generatori casuali derivati in `RunState`), aggiornamento a passi fissi
(`tickAcc` + `tick()`), mondo persistente per fronte (`world.ts`), riepilogo finale (`RunSummary`), Supabase per gli acquisti
(tabelle `wallets`, `purchases`, `grants`, `owned`), GameAnalytics (`analytics.ts`).

| # | Funzione | Impatto | Fatica | Quando |
|---|---|---|---|---|
| 1 | Cartolina di fine campagna (immagine) | alto | 2–3 g | subito |
| 2 | Timelapse da 10 s (video/GIF) | alto | 4–6 g | subito |
| 3 | Operazione del giorno (seme comune + classifica) | alto | 5–7 g | mese 1–2 |
| 4 | Link di sfida ("batti il mio mondo") | alto | 2 g (dopo 1 e 3) | mese 2 |
| 5 | Nome e insegna dell'impero | medio | 2–3 g | mese 1 |
| 6 | Momenti da clip in partita | medio-alto | 4–6 g | mese 1–2 |
| 7 | Parti dalla tua nazione / imprese per paese | medio-alto | 3–4 g | mese 2 |
| 8 | Modalità streamer + voto della chat Twitch | medio | 3–5 g | mese 2–3 |
| 9 | Guerra della comunità (meta-mappa condivisa) | medio, cresce col pubblico | 8–12 g | mese 3+ |
| 10 | Rivali "fantasma" con nomi di giocatori veri | medio-basso | 2 g (versione leggera) | mese 3 |
| 11 | Replay completo / spettatore | medio | 10–15 g | dopo |
| 12 | Invito/referral con premio | basso-medio | 2–3 g | dopo |

### 3.1 Cartolina di fine campagna
- **Cos'è**: nella schermata finale un tasto CONDIVIDI che crea un'immagine 1080×1350 (verticale, va bene su Instagram/TikTok/Reddit):
  la mappa del mondo con i colori pieni delle fazioni (non la carta a puntini), nome e insegna del tuo impero, esito ("1° · 231 province ·
  Fronte III · 20 min"), 3 numeri forti (sacche prese, imperi caduti, bottino), data/seme, logo e indirizzo del sito.
- **Perché si diffonde**: è la versione "mappa" del risultato di Wordle; le mappe del mondo ricolorate generano discussione da sole
  (paesi, confini). Costa zero condividerla, e porta l'indirizzo.
- **Come**: in `ResultScene` si disegna su una `RenderTexture`/canvas fuori schermo la carta "cotta" dei confini con `provOwner`
  colorato (lo stesso dato che usa la mappa da lontano), più testi; `canvas.toBlob()` → `navigator.share({ files })` sul telefono
  (Web Share API), download del PNG su PC, e "copia testo" con link. Su Capacitor: plugin Share. Un evento `share:card` in `analytics.ts`.
- **Fatica**: 2–3 giorni (più tempo di Nico per l'impaginazione: deve sembrare un manifesto del gioco, non uno screenshot).

### 3.2 Timelapse da 10 secondi
- **Cos'è**: un video di 8–12 s della conquista, mappa del mondo che si colora minuto per minuto, con contatore del tempo, eventi
  chiave come scritte ("Sacca di Lione — 14 province arrese", "La Lega del Nord ti dichiara guerra") e il risultato alla fine.
  Formato verticale 1080×1920 con il titolo in alto (spazio per l'interfaccia di TikTok).
- **Perché si diffonde**: è *il* formato del genere (timelapse di EU4/HOI4/OpenFront su YouTube); si capisce senza audio in 1 secondo
  come agar.io; ogni partita ne produce uno diverso; è anche il materiale per i corti di marketing di Nico (§5).
- **Come**: durante la campagna salvare **un'istantanea dei padroni delle province ogni 5 s di gioco** (array di 6.087 byte; 240
  istantanee per 20 min = ~1,5 MB in memoria, nessun salvataggio) più una lista di eventi con tempo. Alla fine si ridisegnano le
  istantanee su un canvas fuori schermo e si registra con `canvas.captureStream()` + `MediaRecorder` (WebM su Chrome/Android, MP4 su
  Safari recente); fallback: GIF piccola o sequenza di 6 immagini. Sul telefono il file si condivide con la Web Share API.
  Nota: per i "momenti" basta il registro eventi, non serve un replay deterministico.
- **Fatica**: 4–6 giorni. Il registro delle istantanee è riutilizzabile per il grafico "province nel tempo" della schermata finale
  (proposto in `ui-ricerca.md` §3.17) e per la classifica.

### 3.3 Operazione del giorno (seme comune)
- **Cos'è**: ogni giorno alle 00:00 UTC un mondo uguale per tutti: stesso seme, stessa partenza, stessi rivali, Fronte e durata fissi
  (10 min, per farla anche da telefono), **un tentativo valido** (gli altri sono allenamento). Classifica per province a fine tempo
  (pareggi: tempo della vittoria anticipata). Risultato condivisibile come testo con emoji alla Wordle, per esempio:
  `ARCHEON · Operazione 142 · 🥇 1° · 231 prov. · ⏱ 10:00 · 🔥3 sacche · ☠️2 imperi` più il link.
  Variante settimanale con un "modificatore" (niente navi, nebbia totale, imperi alleati tra loro), come le sfide settimanali di Polytopia [F18].
- **Perché si diffonde**: confronto equo tra amici e in Discord ("io l'ho chiusa con 260"); appuntamento quotidiano (aiuta D7, vedi
  `economia.md` §5.4); materiale per i creatori ("ho provato l'operazione di oggi").
- **Come**: il seme del giorno = hash della data; `camp.ts` oggi usa `randomSeed()`, basta passare un seme fisso e opzioni fisse e
  **non** usare il mondo persistente di `world.ts` né i potenziamenti dell'HQ (o usare un HQ "standard" uguale per tutti, così la
  classifica è giusta e non pagabile col Lume). Supabase: tabella `daily_runs(day, user_id|anon_id, name, provinces, time_ms,
  outcome, summary_json, created_at)` con politica di sola insert via funzione `api/daily.ts` e lettura pubblica della top 100 e della
  propria posizione. Anti-imbroglio leggero: controlli di plausibilità lato server (province ≤ massimo raggiungibile, tempo ≥ minimo),
  limite di un invio per giorno; il replay di verifica verrà dopo (§3.11). Giocabile senza account (id anonimo nel salvataggio),
  account con email (già c'è per il Lume) per comparire col nome.
- **Fatica**: 5–7 giorni. Attenzione: `RunState` va a passi fissi ma alcune parti usano il tempo reale (`moveBoats(dt)`): non è un
  problema per la classifica, lo è per un replay esatto.

### 3.4 Link di sfida
- **Cos'è**: dalla cartolina o dall'Operazione: "Sfida un amico su questo mondo" → `archeon.xyz/s/AB12CD` apre lo stesso seme con la
  tua bandierina e il tuo punteggio da battere; alla fine "Hai battuto Nico di 14 province" e il rilancio.
- **Perché**: trasforma ogni condivisione in un invito a giocare *quella* partita (è il passaggio da "guarda" a "prova" che fa il
  K-factor). Nessun bisogno di multigiocatore.
- **Come**: la riga della partita in Supabase (stesso schema di §3.3, tabella `challenges`), codice corto, pagina che legge il parametro
  e salta il menu fino alla Sala Operazioni già compilata. **Niente dati personali nell'indirizzo**: solo il codice.
- **Fatica**: 2 giorni dopo 3.1 e 3.3.

### 3.5 Nome e insegna dell'impero
- **Cos'è**: oltre al nome del comandante (già presente), il nome dell'impero ("Repubblica di Ardesia") e un'insegna composta da
  3–4 scelte (forma, colore, simbolo, motto). Compare sulla mappa, nella cartolina e nella classifica.
- **Perché**: identità = condivisione ("il mio impero"); gli stemmi sono anche un ottimo prodotto estetico per il Lume (`PREMIUM.cosmetics`
  è vuoto: forme e simboli rari, mai potere).
- **Come**: generatore di stemmi con le icone già in `src/assets/icons` e una manciata di forme; salvato nel profilo.
- **Fatica**: 2–3 giorni.

### 3.6 Momenti da clip in partita
Ogni campagna deve produrre 2–3 momenti "da raccontare". Oggi esistono già come regole [CODICE], vanno messi in scena:
- **Sacca che si arrende** (`encircleTick`): breve rallentamento (0,5 s), contorno della sacca che si chiude come un cappio, le
  province che cambiano colore a cascata, cartello "SACCA DI LIONE — 14 PROVINCE ARRESE", suono grave. È il momento "Balatro" della
  conquista.
- **Tradimento / dichiarazione di guerra**: telegramma a tutto schermo con la faccia del capo rivale (ritratti già generati),
  frase cattiva, la pausa si attiva da sola. Funziona come il colpo di scena di Among Us, ma contro l'IA.
- **Capitale caduta**: bandiera che si strappa, scritta "BERLINO È CADUTA", l'impero rivale cambia nome o si sfalda in milizie.
- **Bombardamento**: lampo bianco freddo (il Lume), onda d'urto, cerchio di caselle che tornano neutrali.
- **Rimonta**: se al minuto 15 sei 2° e finisci 1°, cartello "SORPASSO".
- Ogni momento entra nel registro del timelapse (§3.2) e nella schermata finale ("Il momento della partita").
- **Fatica**: 4–6 giorni insieme (molto è "juice", vedi §4.4).

### 3.7 I paesi veri come conversazione
- **Cos'è**: (a) "Parti dalla tua nazione": prima campagna e Operazione del giorno partono vicino al paese della lingua del telefono
  (solo dalla lingua del browser, **niente geolocalizzazione**), o scelta libera; (b) imprese per paese: "Italia unita", "Hai preso
  tutta la Scandinavia", "Il Mediterraneo è un lago tuo", con tempo record personale.
- **Perché**: nei video di mappe i commenti esplodono su "e la mia nazione?"; il campanilismo è il motore dei video "every country"
  e di GeoGuessr [F32]. Domande per i corti: "Quanto ci metti a unificare l'Italia?".
- **Rischio**: guerre vere tra nazioni vere sono un tema delicato (conflitti in corso, regioni contese). Il gioco ha già la difesa
  giusta: le fazioni sono **potenze inventate** (Imperium, Republica…) e la mappa è "riconoscibile ma alterata". Mantenere: niente
  bandiere nazionali reali, nessun riferimento a conflitti attuali, nomi delle nazioni solo come geografia. [IPOTESI di prudenza]
- **Fatica**: 3–4 giorni (le nazioni sono già nei dati della mappa).

### 3.8 Modalità streamer e voto della chat
- **Cos'è**: un interruttore "Modalità streamer": testi grandi, nessun dato personale a schermo (email nascosta), musica senza
  diritti, e **la chat di Twitch vota le carte evento** (2 scelte ogni ~90 s, finestra di 20 s, "!1" / "!2"), può dare il nome a un
  impero rivale e decidere una dichiarazione di guerra a sorpresa (con conferma dello streamer).
- **Perché**: le carte evento sono già un formato a 2 scelte perfetto per il voto; lo streamer di strategia ha tempi morti, la chat
  li riempie; i giochi con interazione della chat vengono scelti dagli streamer piccoli e medi, che sono quelli raggiungibili.
- **Come**: lettura anonima della chat Twitch dal browser via IRC su WebSocket (`wss://irc-ws.chat.twitch.tv`, accesso in sola
  lettura senza credenziali), nessun server. Il nome del canale lo scrive lo streamer. YouTube dopo.
- **Fatica**: 3–5 giorni.

### 3.9 Guerra della comunità (alla Helldivers)
- **Cos'è**: una carta del mondo condivisa per stagione (4–6 settimane): ogni campagna vinta da qualunque giocatore "libera" punti nella
  regione dove si è giocata; la comunità sposta il fronte contro la Corruzione. Il **conto alla rovescia dell'Avvento** (lore: il
  Segnale è un conto alla rovescia) diventa un evento reale: a fine stagione si svela un frammento di lore in base all'esito.
- **Perché**: storia collettiva, motivo per parlarne su Discord e Reddit, materiale per post settimanali ("la comunità ha perso
  l'Africa"); è ciò che ha reso Helldivers 2 una conversazione continua [F27].
- **Come**: una tabella di contatori per regione in Supabase, aggiornata dalla stessa funzione che registra le partite; pagina della
  Sala Radar (oggi "fuori MVP") con la carta. Un "Game Master" è Nico che scrive i bollettini.
- **Fatica**: 8–12 giorni. **Solo quando ci sono almeno qualche centinaio di giocatori al giorno**: con 20 giocatori una mappa
  condivisa sembra vuota.

### 3.10 Rivali "fantasma" e versione leggera
- **Versione leggera** (2 giorni): gli imperi rivali dell'Operazione del giorno prendono il nome dei 3 migliori di ieri ("L'Impero di
  Marco_92"). Riconoscimento sociale a costo zero.
- **Versione piena** (3–4 settimane, dopo): l'IA rigioca le *scelte* di un altro giocatore (ordini registrati) sulla tua mappa. Serve
  un replay deterministico (§3.11). Rimandata.

### 3.11 Replay e spettatore
- Registrare gli ordini del giocatore con il numero di passo e rigiocarli sullo stesso seme. Richiede rendere deterministiche le parti
  che oggi usano il tempo reale (navi) e un controllo su browser diversi. Serve per verificare le classifiche e per "guarda la partita
  del primo". **10–15 giorni**, dopo il lancio.

### 3.12 Invito con premio
- "Invita un amico: quando finisce la sua prima campagna ricevete entrambi un'insegna rara". **Solo estetica**: premi di risorse
  spingono allo spam. Bassa priorità: per un gioco gratuito nel browser l'attrito è già nullo, conta di più il link di sfida.

---

## 4. Dipendenza sana e soddisfazione ("game feel")

### 4.1 Il ciclo di Archeon contro i cicli che funzionano

| Ciclo | Archeon oggi [CODICE/CLAUDE.md] | Modello | Divario |
|---|---|---|---|
| **"Un'altra partita"** | campagna 10/20/30 min, poi HQ | Vampire Survivors/Balatro: 15–30 min, fine con numeri enormi, rivincita in un tocco | la rivincita c'è; manca il **picco finale** e il "per poco" visibile |
| **Ricompensa variabile** | eventi ~90 s, province, bottino; premio raro assente (`economia.md` §5.1) | Clash Royale: forzieri di rarità diversa | proposto in `economia.md`; qui solo la messa in scena |
| **"Per poco" (near-miss)** | il 2° posto vede solo "fine delle operazioni" | Balatro: "ti mancavano 40 punti"; Clash: corona per corona | mostrare **di quanto** e **dove** (§4.3) |
| **Progressione visibile** | livelli dell'HQ, fronti I–VI | Clash: barra dei trofei; Polytopia: punteggio | serve una **barra unica di carriera** (fronte + stelle) sempre visibile nella home |
| **Juice** | molto già fatto (pedine, scritte, lampi) | Vlambeer/"Juice it or lose it" [F33] | manca la **scala**: le cose grandi devono sembrare più grandi delle piccole |
| **Sessione** | 20 min = sessione da PC | mobile 5–8 min (vedi `economia.md` §2.1) | Operazione del giorno da 10 min |
| **Ritmo interno** | primo impero a 2:30–4:40, confine a 6–9 min, poi crescita costante | Clash Royale: doppio elisir nell'ultimo minuto; battle royale: cerchio che si stringe | **minuti 8–15 piatti**, finale senza crescendo |

### 4.2 Primi 5 minuti, prima sessione, prima settimana

**Primi 5 minuti (decidono la Basic Launch di CrazyGames)**
- **Secondo 0–10**: niente menu né nome: si apre sulla mappa, un tocco conquista la prima provincia con suono pieno. Il nome si chiede
  dopo la prima vittoria (oggi dopo la run guidata: bene) [CODICE].
- **Secondo 10–60**: espansione velocissima in terra libera (8–12 province), contatore che sale con suono a tono crescente (come i
  moltiplicatori di Balatro), primo cartello "10 PROVINCE".
- **Minuto 1–3**: primo contatto con una milizia (assalto con anello), prima carta evento, prima sacca *guidata* (la sacca è il momento
  più bello del gioco: va insegnata presto).
- **Minuto 3–5**: vittoria della run guidata, **cartolina già pronta** ("la tua prima conquista"), poi la base con un cantiere che
  finisce in 1 minuto.
- Misure: tempo alla prima provincia (< 5 s), al primo cartello (< 60 s), abbandono nei primi 3 minuti (eventi `analytics.ts`).

**Prima sessione (20–40 min)**
- Run guidata → primo upgrade → prima campagna vera da **10 minuti** (non 20: la prima campagna lunga è un rischio) → schermata
  finale con cartolina e "domani c'è l'Operazione n. X".
- Chiudere la sessione con **un filo aperto**: spedizione notturna, cantiere da 1 ora, frammento di lore a metà ("il telex si
  interrompe…").

**Prima settimana**
- Giorno 1–2: fronte II, prima ricerca della Caduta (lore), prima Operazione del giorno.
- Giorno 3–5: primo muro (Fronte III) superato con l'HQ: è il momento in cui il ciclo "base → campagna" deve farsi sentire. Mostrare
  la differenza ("con l'Arsenale 3 la tua artiglieria batte i loro bunker").
- Giorno 7: prima settimana di serie dell'Operazione → insegna estetica. Ritmo dei numeri: vedi `economia.md` §3.3.

### 4.3 Modifiche concrete al ciclo (in ordine)

| # | Modifica | Perché | Fatica |
|---|---|---|---|
| 1 | **Ultimi 2 minuti in crescendo** ("Ultima offensiva"): musica che cambia, rendita ×2, assalti più rapidi per tutti, classifica in grande al centro alto, ultimi 10 s con conto alla rovescia | crea il picco finale e i sorpassi (il "doppio elisir" di Clash Royale); ogni partita finisce in tensione | 1–2 g |
| 2 | **Primo minuto esplosivo** (vedi §4.2) | il primo minuto decide la ritenzione dei portali | 1–2 g di taratura |
| 3 | **"Per poco" visibile**: "2° a 9 province dal primo: bastava la sacca di Varsavia" con la provincia evidenziata sulla mappa finale; mezza puntata restituita (regola in `economia.md` §5.3) | il near-miss spinge alla rivincita solo se è leggibile e *onesto* | 1–2 g |
| 4 | **Rivincita sullo stesso mondo** in 1 tocco ("Rigioca questo mondo") accanto a "Nuova campagna" | Vampire Survivors/Balatro: "ora so cosa fare" | 0,5 g |
| 5 | **Minuti 8–15**: un obiettivo secondario a sorpresa ogni ~4 min ("prendi Il Cairo entro 2 min: +bottino"), visibile sulla mappa | riempie la fase piatta con micro-obiettivi a tempo | 2–3 g |
| 6 | **Barra di carriera** nella home: fronte, stelle, prossimo sblocco, % al prossimo fronte | progressione sempre visibile (Clash: trofei) | 1 g |
| 7 | **Frammenti di lore come premio variabile**: 1 campagna su ~8 trova un documento dell'archivio (già nel caricamento) | ricompensa variabile *non monetaria*, motivo di discussione ("cosa sono gli Alati?") | 1–2 g + testi di Nico |
| 8 | **Sconfitta raccontata**: "La caduta della tua Repubblica" con timelapse e la frase del vincitore | anche perdere produce una storia condivisibile (lezione friendslop) | 1 g (dopo §3.2) |

### 4.4 Juice: dove manca la scala

Principio (Jonasson/Purho, Nijman [F33]): ogni azione deve avere una risposta visiva+sonora **proporzionata**. Oggi molte cose hanno
una risposta, ma una provincia libera e la caduta di un impero sono troppo simili. Scala proposta:

| Evento | Visivo | Suono | Telefono |
|---|---|---|---|
| provincia libera | lampo piccolo, +1 che sale | tic a tono crescente se in serie | — |
| provincia nemica vinta | onda di colore dal punto d'attacco, scritta "+3 truppe" | colpo secco | vibrazione 10 ms |
| provincia completa / cartello | stendardo (c'è) + contatore che rimbalza | accordo | 20 ms |
| sacca arresa | rallentamento, cappio, cascata (§3.6) | basso grave + eco | 2×30 ms |
| capitale / impero caduto | camera che si sposta sul posto, tremolio, bandiera strappata | tema breve | 60 ms |
| vittoria | mappa intera che si accende nel tuo colore, bottino che vola nell'HQ | fanfara fredda (Lume) | — |

Regole: tremolio della camera solo sugli eventi grandi (e disattivabile), suoni corti e senza fatica d'ascolto su 20 minuti, scritte
che salgono **raggruppate** (troppe scritte uguali = rumore). Skill `game-feel` già nel progetto per l'implementazione.

### 4.5 Limiti etici (non negoziabili)

- **Mai casse a sorpresa a pagamento** (regola già scritta). Nessun premio casuale comprabile, nemmeno indirettamente.
- **La puntata non deve diventare gioco d'azzardo con soldi veri.** Oggi il Lume compra risorse (300 per 30 Lume) e le risorse si
  possono puntare: **soldi veri → esito incerto**. Anche senza incasso (quindi probabilmente non "gioco d'azzardo" per legge nella
  maggior parte dei paesi [IPOTESI, non è un parere legale]) è la forma che autorità e genitori guardano con sospetto (Belgio, Paesi
  Bassi, linee guida PEGI sugli acquisti). Proposte:
  1. **Solo le risorse guadagnate giocando si possono puntare**; quelle comprate col Lume vanno in un saldo separato non puntabile
     (oppure il pacchetto di risorse non esiste e il Lume serve solo per tempo ed estetica).
  2. Niente immagini da casinò (fiches, carte, slot): la puntata è "**dotazione della campagna**" o "**rischio dell'operazione**",
     con la stima di vittoria accanto (`economia.md` §5.3).
  3. Nessuna offerta a pagamento **dopo una sconfitta** o durante una serie negativa ("recupera la puntata per 0,99 €": mai).
  4. Nessun "per poco" falsificato: il near-miss mostra numeri veri.
  5. Nessun timer che scade se non paghi (i timer non bloccano mai le campagne: regola già scritta) e nessuna offerta "solo per 10 minuti".
- **Classifiche e Operazione del giorno non pagabili**: HQ standard uguale per tutti (§3.3).
- **Minori**: il pubblico web è giovane. Acquisti solo con conferma esplicita, nessuna spinta all'acquisto nelle prime sessioni, tetto di
  spesa visibile (`economia.md` §4.4).
- **Benessere**: dopo 3 campagne di fila un messaggio discreto "il fronte può aspettare"; nessuna notifica notturna.

---

## 5. Piano dei prossimi 3 mesi (budget ~0)

### 5.1 Cosa costruire, in ordine

**Mese 1 — "Pronto per gli sconosciuti"**
1. Primo minuto esplosivo + ultimi 2 minuti in crescendo + "per poco" visibile (§4.3, 1–3). *~5 g*
2. Cartolina di fine campagna (§3.1). *~3 g*
3. Registro delle istantanee + timelapse (§3.2). *~5 g*
4. Nome e insegna dell'impero (§3.5). *~2 g*
5. Eventi di analisi: `funnel:first_province`, `funnel:first_milestone`, `run:start/end` con durata ed esito, `share:card/video/text`,
   `challenge:open/start/finish`, `daily:start/finish`. *~1 g*
6. Test con 20 amici (obiettivo CLAUDE.md: D7 > 20%).
7. In parallelo, Nico: account TikTok + YouTube + Discord + pagina itch.io; 3 corti a settimana (§5.3).

**Mese 2 — "Si condivide e si torna"**
1. Operazione del giorno con classifica e testo emoji (§3.3). *~6 g*
2. Link di sfida (§3.4). *~2 g*
3. Momenti da clip (§3.6). *~5 g*
4. Parti dalla tua nazione / imprese per paese (§3.7). *~3 g*
5. **Build CrazyGames** (SDK, niente Lume, niente link esterni se richiesto) → Basic Launch (7–21 giorni di dati su sconosciuti) [F23].
6. Lancio sul proprio sito + itch.io; primi post su Reddit.

**Mese 3 — "Streamer e Steam"**
1. Modalità streamer + voto della chat (§3.8). *~4 g*
2. Iterazione sui dati di CrazyGames (primi 5 minuti, durata).
3. Pagina Steam "Prossimamente" per raccogliere wishlist (capsule con l'arte già generata, trailer dalla pipeline del timelapse);
   scegliere il Next Fest a cui puntare (con demo pubblica **più di un mese prima**) [F14].
4. Se ci sono > 300 giocatori al giorno: progettare la guerra della comunità (§3.9) per il mese 4.
5. Candidatura a Poki se la Basic Launch di CrazyGames va bene.

### 5.2 Dove lanciare
- **Sito proprio** (dominio corto ~10–15 €/anno): punto d'arrivo di tutti i link, Lume attivo.
- **CrazyGames**: test e traffico; **Poki**: candidatura con i numeri in mano.
- **itch.io**: devlog e comunità indie.
- **Reddit** (rispettando le regole di autopromozione di ciascun sub, di solito max 1 post su 10 propri): r/WebGames, r/IndieGaming,
  r/incremental_games (no: è un altro genere), r/4Xgaming, r/strategygames, r/MapPorn (solo timelapse belli, non pubblicità), r/italygames
  e community italiane; post nel formato "ho fatto un gioco dove…" con GIF, non "giocate al mio gioco".
- **Discord**: server con canale `#operazione-del-giorno` dove un webhook pubblica la classifica di ieri (gratis, Supabase + funzione
  Vercel programmata), canale screenshot, canale teorie sulla lore.
- **Steam**: pagina dal mese 3, demo dal mese 4–5.

### 5.3 TikTok / YouTube Shorts / streamer
- **Formato che funziona per le mappe**: timelapse verticale 15–30 s, gancio scritto nel primo secondo, finale chiaro. Ganci da provare
  (uno per video, 3 a settimana, si misura la visualizzazione completa):
  "Ho conquistato il mondo in 20 minuti", "L'Italia unita in 3 minuti?", "La Francia mi ha tradito al minuto 14",
  "Cosa succede se nessuno attacca il Brasile", "Commenta un paese: parto da lì" (e poi il video di risposta).
- **Devlog brevi** (presskit.gg e i casi di Mortal Rite, The Matriarch: i video "sto facendo un gioco dove…" hanno lo storico migliore;
  la pubblicità a pagamento su TikTok quasi mai rende per gli indie) [F24].
- **Serie lore**: 20 s di telex sopra un'immagine ("Rapporto n. 7: l'Alato di Sevastopol") → spinge le teorie.
- **Streamer**: puntare su piccoli e medi (50–2.000 spettatori) che giocano OpenFront, Territorial, HOI4, Polytopia, GeoGuessr; mail
  personale con link diretto, la modalità chat-vota e un seme preparato per loro ("la loro" Operazione). Lo stesso schema di
  Among Us/Vampire Survivors: non serve un grande streamer, serve che più streamer medi lo giochino nella stessa settimana [F25, F19].
- **YouTuber del genere OpenFront/Territorial** (il canale più vicino al nostro pubblico, vedi il picco di OpenFront al lancio [F17]).

### 5.4 Metriche da guardare

| Metrica | Obiettivo 3 mesi [IPOTESI] | Dove |
|---|---|---|
| Tempo alla prima provincia | < 5 s per il 90% | GameAnalytics (`analytics.ts`) |
| Abbandono nei primi 3 minuti | < 35% | GameAnalytics |
| Completamento della run guidata | > 75% | GameAnalytics |
| D1 / D7 / D30 | 35% / 12–15% / 4–5% (fasce in `economia.md` §2.1) | GameAnalytics, CrazyGames |
| Campagne per giocatore al giorno | ≥ 1,5 | GameAnalytics |
| **Tasso di condivisione** (condivisioni / campagne finite) | 5–10% | evento `share:*` |
| Click sui link condivisi → partita iniziata | > 30% | evento `challenge:open/start` |
| **K-factor** (nuovi giocatori portati da ciascuno) | 0,1–0,3 (sopra 1 = virale vero) | link di sfida |
| Partecipazione all'Operazione del giorno | 20% dei giocatori del giorno (Polytopia: ~10% sui tornei [F18]) | Supabase |
| Giocatori collegati insieme (CCU), giocatori al giorno | crescita settimanale | sito + portali |
| Visualizzazione completa dei corti | > 50% sui 15 s | analisi TikTok/YouTube |
| Wishlist Steam (dal mese 3) | 2.000 prima del primo Next Fest [F14] | Steamworks |

### 5.5 Budget
- Dominio ~15 €/anno; Vercel, Supabase, GameAnalytics, CrazyGames, itch.io, Discord: **gratis** nei limiti di oggi.
- Steam Direct: 100 $ (recuperabili), solo quando si apre la pagina.
- Facoltativo: 50–150 € per 2–3 streamer piccoli in una stessa settimana, solo dopo che la Basic Launch ha numeri decenti.
- Tutto il resto è tempo: la pipeline del timelapse è anche la fabbrica dei video di marketing.

---

## Fonti

1. Newzoo, mercato 2025 — GamesBeat: https://gamesbeat.com/global-game-revenues-hit-196-7b-in-2025-up-7-4-newzoo/ ; Pocketgamer.biz: https://www.pocketgamer.biz/the-global-games-market-is-forecast-to-reach-197bn-in-2025
2. (stime di mercato "strategia" di società di ricerca, molto discordanti: 7,6–19,3 mld $) https://www.marketresearch.com/VPA-Research-v4245/Strategy-Games-Size-Share-Outlook-40859955 ; https://www.wiseguyreports.com/reports/strategy-game-market
3. Sensor Tower, State of Gaming 2026 / mobile 2025: https://sensortower.com/blog/state-of-gaming-2026 ; https://gameworldobserver.com/2026/01/21/in-2025-the-revenue-of-the-mobile-gaming-market-grew-but-only-slightly-analysis ; https://www.deconstructoroffun.com/blog/2026/2/2/state-of-mobile-2026
4. Pocketgamer.biz, strategia 1° semestre 2025: https://www.pocketgamer.biz/strategy-games-surge-as-rpg-revenue-tumbles-h1-2025s-top-genres-revealed
5. Naavik, Last War: https://naavik.co/digest/how-last-war-is-winning-the-4x-game/ ; 36Kr: https://www.36kr.com/p/3165154033035779
6. Appfigures, agosto 2025: https://appfigures.com/resources/insights/highest-earning-mobile-games-august-2025-worldwide
7. GameDiscoverCo, ricavi Steam per genere: https://gamedevreports.substack.com/p/gamediscoverco-steam-revenue-distribution
8. GameDiscoverCo, generi dei successi PC 2021→2025: https://newsletter.gamediscover.co/p/how-have-the-genres-of-hit-pc-games
9. Kotaku, più venduti Steam 2025: https://kotaku.com/steam-top-selling-2025-friendslop-rpgs-sales-2000654157 ; Game World Observer (ricavi stimati): https://gameworldobserver.com/?p=28636 ; Insider Gaming, Schedule I: https://insider-gaming.com/schedule-1-is-a-sleeper-indie-hit-dominating-steam-with-nearly-half-a-million-concurrent-players/
10. Quantic Foundry: https://quanticfoundry.com/2016/03/02/4x-strategy/ ; calo della motivazione strategica: https://pushsquare.com/news/2024/05/bombshell-report-finds-players-becoming-less-interested-in-deep-strategy-games ; https://www.gamedeveloper.com/business/beyond-50-50-breaking-down-the-percentage-of-female-gamers-by-genre
11. Poki, anno 2025 e State of Web Gaming 2026: https://poki.com/blog/2025-at-poki-a-year-in-review ; https://poki.com/blog/state-of-web-gaming-report-2026 ; https://www.gamedeveloper.com/press-release/new-study-reveals-the-growth-engagement-discoverability-and-value-driving-web-gaming-to-outperform-gaming-giants-and-social-media
12. CrazyGames, pubblico e pubblicità: https://tech-insider.org/crazygames-vs-poki-vs-coolmath-games-2026/ ; https://google.co.jp/ads/publisher/stories/crazy_games
13. Poki, intervista al cofondatore: https://mobidictum.com/pokis-web-gaming-interview-michiel-van-amerongen
14. Chris Zukowski (How To Market A Game), Next Fest: https://howtomarketagame.com/2025/03/26/archive-january-2026-benchmarks-how-many-wishlists-can-i-get-from-steam-next-fest/ ; https://howtomarketagame.com/2025/10/20/steam-next-fest-october-2025-checking-in-on-the-games-that-broke-through/ ; GameDiscoverCo: https://newsletter.gamediscover.co/p/who-won-october-2025s-steam-next
15. Successi strategici di piccoli team: Tangy TD https://kotaku.com/tangy-td-cakez-twitch-steam-pc-indie-success-story-2000679960 ; Gnomes https://www.gamesradar.com/games/strategy/2-devs-spent-10-months-making-a-roguelike-tower-defense-game-and-its-soaked-up-over-usd360-000-on-steam-as-players-construct-impossibly-dense-labyrinths-for-the-gnome-gods ; Dawnfolk https://www.gamepressure.com/newsroom/minecraft-meets-civilization-dawnfolk-sells-10000-copies/z579b3
16. Territorial.io (installazioni Android, stime): https://appgoblin.info/apps/territorial.io ; https://www.speedrun.com/news/m25p01v1-wolfhowl-s-game-of-the-week-territorial-io
17. OpenFront: https://streamscharts.com/games/openfront/release-stats ; https://activeplayer.io/openfront/ ; https://raijin.gg/app/3560670/OpenFront ; https://www.twitchmetrics.net/c/1328299909-openfrontmasters
18. Polytopia: https://www.pocketgamer.biz/the-battle-of-polytopia-surpasses-25m-downloads-on-mobile ; sfide settimanali https://www.pocketgamer.com/the-battle-of-polytopia/introduces-weekly-challenges ; tornei giornalieri https://www.challengermode.com/customer-stories/midjiwan
19. Vampire Survivors: https://www.gamesradar.com/games/roguelike/vampire-survivors-developer-working-on-15-projects-not-15-games-after-the-hit-roguelike-reached-27-million-players-and-spawned-a-whole-subgenre/ ; https://theconversation.com/vampire-survivors-how-developers-used-gambling-psychology-to-create-a-bafta-winning-game-203613 ; https://howtomarketagame.com/2022/01/31/vampire-survivors-success-an-opportunity-in-the-steam-marketplace/
20. Balatro: https://newsletter.gamediscover.co/p/how-balatro-hit-1-million-sales-in ; https://gigazine.net/gsc_news/en/20250207-balatro-successful-launch-strategy ; https://shacknews.com/article/142804/balatro-5-million-copies-sold
21. Fortnite: https://www.thedailybeast.com/how-fortnite-became-the-biggest-game-on-the-internet ; https://www.tomsguide.com/us/why-is-fortnite-so-popular,news-26921.html
22. Marvel Rivals: https://videogameschronicle.com/news/marvel-rivals-gets-10-million-players-in-its-first-three-days
23. CrazyGames, requisiti e fasi di lancio: https://docs.crazygames.com/requirements/intro/ ; https://docs.crazygames.com/resources/basic-launch-metrics/ ; termini https://files.crazygames.com/documents/developer_terms_20250818.pdf
24. TikTok per indie: https://presskit.gg/field-guides/tiktok-indie-game-marketing ; https://www.gamedeveloper.com/game-platforms/from-400-to-20-000-wishlists-with-1-video-how-tiktok-can-make-your-game-go-viral ; https://newsletter.gamediscover.co/p/this-game-used-tiktok-to-get-120m ; https://howtomarketagame.com/2022/02/07/seven-great-tips-for-marketing-your-indie-game-on-tiktok/
25. Among Us: https://pcgamer.com/how-among-us-became-so-popular ; https://www.cnbc.com/2020/10/14/how-among-us-became-a-mega-hit-thanks-to-amazon-twitch.html ; https://streamscharts.com/news/phenomena-2020-among-us
26. Lethal Company: https://pcgamer.com/lethal-company-is-a-viral-hit-in-no-small-part-thanks-to-all-the-intense-shouting ; https://streamscharts.com/games/lethal-company
27. Helldivers 2: https://pcgamer.com/games/third-person-shooter/helldivers-2s-themes-are-bleeding-into-its-community-management-and-creating-a-new-standard-in-live-storytelling ; https://kotaku.com/helldivers-2-malevelon-creek-lost-planet-1851294327 ; https://www.theloadout.com/helldivers-2/tiktok-memes
28. Palworld: https://pcgamer.com/palworld-is-2024s-first-breakout-hit-why-is-it-so-popular ; https://www.bloomberg.com/news/articles/2024-01-22/what-is-palworld-pokemon-like-game-with-guns-goes-viral-irks-nintendo-fans ; https://www.pocketgamer.biz/how-palworld-went-viral-and-made-its-way-to-version-1/
29. Clash Royale: https://www.gamedeveloper.com/business/deconstructing-clash-royale ; https://www.deconstructoroffun.com/blog//2016/02/clash-royale-next-billion-dollar-game.html ; https://pocketgamer.biz/mobile-mavens/62792/mavens-discuss-clash-royales-success/
30. agar.io / slither.io: https://en.wikipedia.org/wiki/.io_games ; https://gamesbeat.com/the-surprising-momentum-behind-io-games-like-agar-io/ ; https://www.vice.com/en/article/a-browser-game-called-agario-got-googled-more-in-2015-than-fallout-4
31. Wordle: https://www.buzzfeednews.com/article/stefficao/how-wordle-went-viral-strategy ; https://www.smithsonianmag.com/smart-news/heres-why-the-word-game-wordle-went-viral-180979439/
32. GeoGuessr / Rainbolt: https://www.tubefilter.com/2024/09/16/location-obsessed-creators-put-geoguessr-on-the-map/ ; https://en.wikipedia.org/wiki/Trevor_Rainbolt ; https://omr.com/de/daily/geoguessr-game-google-maps-georainbolt
33. Game feel: "Juice it or lose it" (Jonasson, Purho, 2012) e "The Art of Screenshake" (Nijman) — https://Www.wikipedia.org/wiki/Game_feel ; https://kenney.nl/learn/must-see-videos-for-indie-developers ; https://gamedeveloper.com/design/vlambeer-co-founder-shares-advice-on-building-better-action-games

*Cosa non ho trovato (e quindi è segnato come ipotesi)*: dati ufficiali su giocatori mensili di Territorial, Call of War (su Steam
~270–320 giocatori medi collegati, ma la maggior parte gioca sul suo sito: https://gamecharts.org/steam/call-of-war) e OpenFront sul web;
percentuale di ricavo dei portali; regola esatta di CrazyGames su link esterni e pagamenti propri (da leggere nei requisiti prima della build).
