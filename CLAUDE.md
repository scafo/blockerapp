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
Universo parallelo, militarmente vago, tra gli anni '40 e '70 (radio a valvole, telex, schede perforate, dirigibili, corazzate).
Prima c'era **la Concordia**: un secolo di pace. Poi **la Caduta** (Anno Zero): dal cielo scesero figure alate e luminose (gli Alati);
dove caddero la terra "gelò e cambiò" e scoppiò **la Corruzione** (viola, fredda). Restano i **Frammenti** (le anomalie sulla mappa),
che emettono **il Segnale** e danno **il Lume**, la luce fredda: la nuova tecnologia. Le potenze se la contendono per dominare il mondo.
La Caduta non fu una punizione ma **una Prova** prima di un evento celeste, **l'Avvento**: il Segnale è un conto alla rovescia.
Chi riuscirà a dominare il mondo? Il mistero si svela poco alla volta (eventi rari, archivio del Laboratorio, schermate di caricamento).
Temi ricorrenti: angeli, luce fredda, corruzione, classi dirigenti. Tono: freddo ma intenso, rapporti operativi e intercettazioni.
Niente ironia da cartone. Enfasi sulle **classi dirigenti** e sulla divisione politica delle potenze (testi in `src/data/civs.json`).

## Civiltà (sistemi politici, non nazioni)
- **Imperium** — ordine e dominio · impero militare, classe dirigente: lo Stato Maggiore (il Trono e i generali)
- **Republica** — senato e stabilità · repubblica senatoria, classe dirigente: il Senato (senatori e alti funzionari)
- **Aristocrazia** — cultura, tecnologia e degrado · oligarchia delle Casate, classe dirigente: le Grandi Casate (nobiltà e accademie)
- **Cabal** — lavori nell'ombra ed economia · consiglio occulto, classe dirigente: il Consiglio Ombra (banchieri e servizi)
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
Notte, centri di comando, radar, operazioni speciali, toppe/insegne di reparto. **Non troppo retrò** (Nico): niente effetto monitor/CRT,
niente scanline, niente verde terminale. Stile moderno da sala operativa: blu notte e acciaio, oro pallido per gli accenti, font
Barlow Semi Condensed + Oswald. Immagini drammatiche del Figma per le potenze e i caricamenti. Leggibilità prima di tutto: colori fazione
forti + simboli (daltonismo).

## Run (campagna sulla mappa)
- Mappa del mondo divisa in nazioni reali e **province vere alla Call of War** (forme irregolari, la provincia è l'unità di conquista),
  riconoscibile ma alterata (seed). Pausa strategica alla HOI4: il tempo si ferma, gli ordini no.
- Truppe generiche (pool) che crescono col territorio; tap/avanzata per conquistare; unità come pedine.
- Eventi a carta con 2 scelte ~ogni 90 s. Fine: allo scadere della durata scelta (10/20/30 min) vince chi ha più province, altrimenti
  "fine delle operazioni" (bottino intatto, la puntata perde il 25%). **Niente tempesta né zone tossiche** (Nico: mai chiesti). Ritirata = paghi la tassa d'uscita; eliminato = perdi il 70%.
- Vittoria: più province di tutti a fine campagna, o prima se cadono i tre imperi rivali (il 60% della regione era irraggiungibile
  sulla carta grande: tolto). L'HUD mostra la classifica ("1° · +12 sul 2°"). **Niente anomalie sulla mappa** (Nico: tolte; i Frammenti restano nella lore).
- **Terreno vero** (pianura, colline, montagne, deserto: regioni fisiche di Natural Earth) e **costruzioni nelle province**
  (Fabbrica, Bunker, Caserma, Ospedale, Radar, Porto, Aeroporto). **Fronti I–VI** di difficoltà crescente: si entra, si fa il primo
  impero con poche cose e si raccolgono risorse; poi i nemici diventano troppo forti e bisogna potenziare HQ, armi e ricerche.
- **Fazioni**: tu (col tuo nome), 3 **imperi** con nomi casuali (la potenza Imperium/Aristocrazia/Cabal/Republica è solo una loro
  caratteristica, come in Call of War) che si espandono, e ~36 **milizie provinciali** deboli (alla OpenFront) che difendono la
  loro zona. All'inizio la terra è quasi tutta libera. Partenze eque (tu e gli imperi in pianura o colline, `start.minGrowth`);
  imperi lontani al Fronte I e sempre più vicini nei fronti alti (`fronts[].aiDistance`). **Diplomazia alla HOI4**: imperi in pace finché non vi toccate (poi possono
  dichiararti guerra), milizie ostili; tocca un impero (elenco, insegna sulla mappa, sua provincia in pace o tieni premuto) → scheda
  con potenza, forza, rapporto, opinione e azioni (guerra, pace, alleanza, doni di truppe/risorse, tributo dalle milizie).
  **Accerchiamenti**: una sacca circondata da una sola fazione in guerra con lei si arrende (mai il cuore di una fazione: capitale o
  più di metà delle sue province). Pedine: nessun danno in terra libera; in pace pedine e navi non combattono e non sbarcano.
- **Puntata** (Nico: "tipo poker"): prima della campagna metti in gioco risorse del Deposito (0/60/180/450); finiscono nello zaino,
  le puoi spendere (ARRUOLA = risorse in truppe); il guadagno oltre la puntata rende ×1,25–2. Ritirata −25% (il Deposito liv. 3
  la riduce), eliminato −70%, fine campagna senza vincere = −25% della puntata (`stake.lossShare`: la puntata si può perdere),
  vittoria senza tasse. App chiusa a metà campagna = la puntata rientra come in una ritirata (`recoverStake`). **Nebbia**: nelle prime campagne copre quasi tutta la mappa;
  la Sala Radar allarga vista e zona nota attorno alla partenza.

## Tempi di gioco (calcolati con `scripts/sim.ts`, giocatore attivo)
- Run guidata: ~2–3 min di conquista (+ i passi della guida).
- Campagna standard 20 min, Fronte I (carta da 17.925 province, 3 imperi + 36 milizie): primo impero (15 province) a 2:30–4:40;
  tregua 4:00, primo confine con un impero a 6–9 min (Fronte III 3–10 min, Fronte V 1–3 min), poi possono dichiarare guerra;
  a 20:00 vince chi ha più province (90–260 tue, milizie ~8 province l'una, 10–25 sacche prese). Bottino ~580–1650.
  Breve 10 min, lunga 30.
- Muro di difficoltà (sim con giocatore che dichiara guerra se più forte, con assalti e logistica): Fronte I 4 vittorie su 4;
  Fronte III senza potenziamenti 2 su 6, con HQ a metà 4 su 4; Fronte V con HQ al massimo 2 su 5 (IA dei fronti III–VI più forti:
  crescita ×1,2/1,28/1,5/1,56). Bottino ~1000–2500 al Fronte I. HQ + tutte le ricerche costano ~13.400 risorse.

## Regole di design
- Max 5–6 scelte a schermo. Mappa sempre libera al centro, comandi negli angoli in basso.
- Ogni conquista dà soddisfazione visiva. Mai pay-to-win, mai loot box a pagamento.
- Tutti i numeri in `src/config/balance.ts`. Contenuti (eventi, unità, edifici) in JSON in `src/data/`.

## MVP (costruisci SOLO questo)
1 civiltà, 3 unità, 3 risorse, 10 eventi, 4 postazioni (Centro di Comando, Arsenale, Estrazione, Deposito), tempesta, ritirata,
rivincita, onboarding, analytics (la tempesta è stata tolta su richiesta di Nico). **Fuori dall'MVP:** multiplayer, account, acquisti, sandbox libera, stagioni, classifiche online.

## Milestone
1. Mappa + conquista a tap · 2. IA + combattimento + unità · 3. Zaino, ritirata, tempesta, schermata finale · 4. Accampamento + eventi ·
5. Juice, onboarding, estetica placeholder · 6. Analytics + build (prima web, poi Capacitor) + test.
Dopo ogni milestone Nico gioca 10 minuti prima di andare avanti. Obiettivo del test: D7 > 20% su ~20 tester.

---

## Note del developer (stato e comandi)

- **Assalti, logistica, mappa da vicino, pedine** (ultima richiesta di Nico): le province di una fazione **non si prendono
  subito**: paghi le truppe e parte un assalto di 3–15 s (`battle` in `balance.ts`, `RunState.startBattle/battlesTick`;
  anello che si riempie con le sciabole sulla mappa); alla fine si vince se il difensore non si è rinforzato oltre ~18%
  (conta solo la sua difesa, non la sovraestensione di chi attacca), altrimenti "respinti" e truppe perse. Le province libere
  restano immediate. Vale per le IA (che scelgono un altro bersaglio se uno è già sotto assalto) e per le pedine, che
  **assediano** la provincia (restano ferme, perdono vita alla fine). **Capitale e logistica alla HOI4** (`logistics`): si parte
  dalla propria capitale (doppio anello d'oro); rifornimento pieno fino a 8 passi lungo il proprio territorio, poi cala, le sacche
  tagliate fuori scendono al 25% → meno crescita e produzione (al massimo la metà), difesa più debole, attacchi da lì più cari;
  province mal rifornite più scure; se la capitale cade se ne sceglie un'altra. Rifornimento nella tabella della provincia.
  **Da vicino** (zoom ≥ 5): territorio un po' trasparente sul terreno, alone lungo il tuo fronte, ombre morbide sui confini
  delle province, grana da carta stampata. **Pedine**: scivolano alla velocità vera del terreno, colpi tracciati con vampa,
  scintille, sobbalzo e danno che sale, caduta con esplosione e scossa, anello d'arrivo sull'ordine, passano attraverso le
  amiche. Immagini nuove di Nico nei caricamenti (nave sul ghiaccio, festa della Concordia), le altre restano segnaposto
  sgranati finché non arrivano gli originali (il download da Figma è bloccato dalla rete dell'ambiente).
  Bilanciamento rifatto con i nuovi sistemi (vedi "Tempi di gioco").
- **Caricamento con la lore e tabella in fondo** (ultima richiesta di Nico): il caricamento è un documento dell'archivio che si scrive
  lettera per lettera (telescrivente legata al tempo vero, `CHAR_MS`) in font da terminale (Share Tech Mono, `FONT_MONO`, azzurro chiaro che brilla come le scritte
  sull'immagine della nave) sopra l'immagine a tutto schermo, con un flusso di dati che scorre di lato; sotto solo la barra; dura apposta 6,5–11 s (`MIN_MS`/`MAX_MS` in `LoadScene.ts`), si salta toccando
  solo a testo finito. Lore di ogni schermata in `src/data/loading.json` (`lines`). La tabella della selezione sta in fondo allo
  schermo come in Call of War (in orizzontale a sinistra, accanto a RITIRATA/pausa/velocità) e mentre è aperta carte e leve si
  fanno da parte; barra in alto della campagna più alta e opaca (entrate al minuto dentro la barra, i nomi della mappa non trasparono).
- **Mercato, schede, mappa e tabella** (ultime richieste di Nico): **Mercato** nella home (tasto accanto a RICERCA; solo risorse di
  gioco, niente soldi veri né casse a sorpresa come da regole di design): scambi 50→30 tra risorse, rifornimenti per la prossima
  campagna (truppe fresche, carte del Radar, sacchi di sabbia; uno per tipo, si consumano alla partenza: `profile.supplies`),
  cantiere e ricerca finiti subito a 8 metallo per minuto (`shop` in `balance.ts`, testi in `src/data/shop.json`). Icone delle
  risorse nuove (lingotti, tanica, scatoletta; `src/ui/resourceIcons.ts`). Schede delle postazioni con livello a tacche, costo a
  schede (serve/hai con barra) e "FINISCI ORA" sul cantiere. Mappa a zoom medio: la terra è uno strato a parte (`landLayer`) con
  forme intere, prima le province semplificate una per una lasciavano fessure scure negli angoli. **Tabella in basso alla Call of
  War** (`HudScene.renderProvince`): tocchi una provincia (tua, nemica, libera) o selezioni una pedina → padrone, rapporto, difesa,
  produzione, costruzione, costo per prenderla (o vita, attacco, gittata, passo, chi batte, stato) e azioni (ATTACCA, AVANZATA,
  SCHEDA, COSTRUISCI); il tocco conquista ancora subito. Non nella run guidata.
- **Home più viva** (Nico: "usa le skill per migliorare la home"; skill `game-ui-ux` e `game-feel` in `.claude/skills/`): GIOCA è
  l'azione principale (fondo oro e alone che respira, `Button.setPrimary`), bottoni che si abbassano al tocco e rimbalzano
  (scala attorno al centro), anello attorno alla postazione toccata, entrata della base con le postazioni che scendono una dopo
  l'altra, risorse che scorrono fino al nuovo valore al rientro da una campagna (scintille del loro colore), lavori finiti con
  lampo + scossa leggera + anello grande, margini sicuri per notch e barra dei gesti (`safeInsets` in `src/ui/screen.ts`),
  INVIO = GIOCA ed ESC = chiudi scheda su PC.
- **Bilanciamento e debug** (richiesta di Nico): partenze eque (niente avvio in montagna o nel deserto: prima la prima
  provincia di 15 arrivava tra 2:30 e 8:00 a seconda del seed), 180 truppe iniziali, Fabbrica +2 risorse/min, imperi più vicini
  nei fronti alti e un po' più forti dal III (prima al Fronte III spesso non li incontravi mai), vittoria a tempo per province
  e anticipata se cadono i tre imperi, puntata che si può perdere. Bug corretti: pedine che combattevano e conquistavano contro
  chi era in pace con te, navi che sbarcavano dopo la pace, sacca che poteva prendersi il cuore del tuo territorio, puntata persa
  chiudendo l'app a metà campagna, "+X% vittoria" mostrato anche senza vittoria, carta dell'abilità sotto RITIRATA in verticale,
  pedine delle IA che cercavano il nemico tra tutte le 460.800 caselle a ogni tick (ora tra le province). `sim.ts` mostra anche
  primo confine con un impero e sacche prese; `SIM_MIN=6` per simulare solo i primi minuti.

- **Mappa a sezioni e sottosezioni** (richiesta di Nico): celle esagonali piene senza fessure; ogni provincia (sottosezione) ha la sua
  tinta e un bordo sottile, le nazioni (sezioni) un bordo spesso lungo i lati delle celle; coste vere vettoriali. Territorio conquistato =
  un solo colore pieno per potenza con contorno chiaro (niente più celle a due toni); zoom iniziale più vicino (3,2).
  **Interfaccia di campagna**: in orizzontale una barra compatta in alto (truppe | obiettivi e tempesta | bottino) + fazioni nell'angolo;
  in verticale fazioni su due righe e PAUSA in alto a destra. Gli stendardi si rimpiccioliscono per stare nello schermo.

- **Gameplay (ultimo giro)**: tocco lontano = **avanzata su tutta la provincia** toccata (alla Call of War: si ferma quando la provincia è
  tua; le anomalie vanno attaccate apposta). **Provincia completa** = +truppe e bottino una volta (`provinceReward`) con stendardo e lampo.
  **Offensive nemiche** (`offensive`): ogni ~60 s un'IA confinante annuncia un assalto (6 s di preavviso), poi per 25 s concentra gli
  attacchi su di te con rinforzi: momento di tensione in cui servono genio e truppe in cassa. IA +15% crescita. `sim.ts`: giocatore
  attivo 6/6 vittorie (3–9 min), meno attivo 5/6. **PAUSA** in campagna (tempo fermo, riprendi o ritirata).
- **Interfaccia su PC**: tutto si ingrandisce con lo schermo (`uiScale` in `src/ui/screen.ts`, 1–1,75×, base ~900×500 punti); bottino in
  grande e colorato nella campagna e nell'HQ.

- **Armi (Arsenale a 6 livelli, Figma "Truppe")**: Fanteria → Ricognitori → Artiglieria → Corazzati + Genio → Cannoniera (nave: si schiera
  da una tua costa, si muove sul mare, copre le coste −30% costo) → abilità a ricarica Ricognizione aerea (svela una zona 15 s) e
  Bombardamento (caselle nemiche tornano neutrali, unità −40 vita) → unità unica della civiltà. Genio: +8 difesa sulle tue caselle attorno.
  Sasso-carta-forbice per classi (`beats` è una lista in `src/data/units.json`). **Mazzo** di 4 truppe scelto in "Prepara la campagna"
  (come Clash). Centro di Comando a 5 livelli (liv. 4: +1 unità in campo, liv. 5: abilità −25% ricarica). Le IA usano le truppe di terra
  che hai sbloccato. Numeri in `balance.ts` (`units`, `abilities`, `camp`).
- **Grafica (Figma "Estetica")**: mappa = celle quadrate luminose tipo heatmap (righe sfalsate come una matrice di LED), mare a puntini blu,
  coste/confini bianchi, nomi gialli e capitali rosse da terminale, anomalie magenta, bagliore (bloom) che si spegne da solo se gli FPS
  scendono sotto 40, righe di scansione, barra di stato con coordinate. HQ = planimetria tattica vista dall'alto in verde terminale
  (moduli collegati al Centro di Comando, radar che spazza, convoglio in missione, toppe di reparto). Avvio da terminale.
- **Modalità test** (HQ → `[ TEST ]`): postazioni al massimo, tutte le ricerche, risorse piene, civiltà sbloccate, cantieri/ricerche/spedizioni
  istantanei, +1000 truppe e abilità con ricarica ×0,25 in campagna (`balance.test`); si esce azzerando il profilo.
- **Nitidezza**: densità reale dello schermo fino a 3×; font Barlow Semi Condensed (dati) + Oswald (titoli) + Share Tech Mono (archivio nei caricamenti), nessun testo sotto 11 pt
  (`textSize` in `src/ui/style.ts`), pixel allineati sulle camere di interfaccia, canvas a misura CSS esatta; testi della mappa disegnati nello spazio dello schermo (`src/render/MapLabels.ts`),
  sempre nitidi a ogni zoom; mappa statica in texture a tasselli 2,6× (1,6× sui dispositivi deboli).

- **Ritmo e progressione** (ultima richiesta di Nico: gioco più lento, partite fino a 30 min, primo impero → nemici troppo forti →
  potenziare): durate 10/20/30 min (`campaigns`); crescita 0,045 per casella pesata dal terreno; **sovraestensione** (`overextension`):
  ogni provincia posseduta rende le prossime +4% più care (non i Frammenti), così l'impero cresce veloce all'inizio e poi a ritmo costante.
  **Fronti** (`fronts`, testi in `src/data/fronts.json`): crescita, truppe, armi, vita delle unità, difese, bunker, tregua e offensive
  delle IA; il successivo si sblocca vincendo (`frontMax`); nella preparazione: potenza consigliata contro la tua (`playerPower`,
  pesi in `power`), armi nemiche (in rosso quelle che non hai), briefing. **Terreno** (`terrain`, dati in `scripts/data/ne-terrain.json`
  e in `worldmap.json`): difesa ×1–1,9, crescita ×0,45–1, pedine e avanzata più lente in montagna, ogni provincia produce la risorsa
  del suo terreno ogni minuto (pianura cibo, colline e montagne metallo, deserto benzina). **Costruzioni** (`works`): tocca una tua
  provincia → scheda (terreno, difesa, produzione) e tre cantieri pagati **solo in truppe** (il prezzo sale del 20% a ogni costruzione,
  `worksPriceStep`; lo zaino resta bottino) in tempo di gioco: Fabbrica (+2 risorse/min della provincia),
  Bunker (difesa ×1,7), Caserma (+10 caselle di crescita, serve Addestramento); restano alla provincia se cambia padrone; le IA dei
  fronti alti hanno bunker. HUD: entrate al minuto sotto ogni risorsa. **Albero della ricerca** (`TreeScene`, Laboratorio e tasto
  RICERCA): ramo Armamenti (unità e abilità si ricercano, l'Arsenale decide fin dove) + Esercito/Logistica/Economia/Difesa/La Caduta
  con prerequisiti (`tech.*.req`). **HQ alla Clash**: Deposito con capienza (`depositoCap`, oltre si perde), barre di riempimento,
  potenza e fronte, cantiere e ricerca in corso, distintivi di livello e "migliorabile" sui moduli, schede postazione con illustrazione.
- **Home e mappa più belle** (ultima richiesta di Nico): la home è la base vista dall'alto, di notte (`src/ui/baseArt.ts`: terreno,
  recinto con torrette e fari, strade, edifici con tetti, ombre, luci e dettagli che crescono col livello, cantiere con gru, cenere
  che scende); nebbia più leggera e sfumata (`fog.blur`, opacità 0,7/0,26, vista iniziale più ampia); nomi delle nazioni in
  proporzione alla larghezza del paese sullo schermo, senza sovrapposizioni (max 13 pt), insegne e capitali più piccole da lontano,
  milizie solo da vicino.
- **Mappa tripla + sistemi alla HOI4** (ultime richieste di Nico): carta da **17.925 province** su griglia invisibile **960×480
  (hexSize 5/3)**, salvata in binario compatto (varint, base64 in `src/data/worldmap.ts`, 2,4 MB; `npm run build:map` la rigenera);
  vicini delle caselle calcolati al volo (`neighbors(i)`); zoom iniziale 8. **Disegno**: da vicino terra, mare, rilievo e territorio
  in una texture vettoriale a risoluzione schermo (`src/render/TerritoryLayer.ts`, si ridisegna quando cambia il territorio o si esce
  dal margine; attenzione: una RenderTexture ridimensionata in Phaser smette di disegnare, si ricrea), da lontano la carta cotta;
  confini tra potenze con ombra scura + linea chiara; acque basse in texture a bassa risoluzione. **Nebbia** = una texture con un
  pixel per casella, ingrandita e sfumata (`fog`, `camp.radarIntel`). **Pedine** in stile radar (`src/ui/unitSymbols.ts`: rettangolo
  tue, rombo nemiche, cerchio navi; segni militari essenziali) a grandezza costante sullo schermo; scintille a misura di zoom.
  **Nome** del comandante: campo HTML (`src/ui/nameInput.ts`), chiesto dopo la run guidata, si cambia toccandolo nell'HQ.
  **Fazioni** in `src/game/factions.ts` (`setupFactions`, nomi in `src/data/names.json`), milizie in `generate.ts` (`pickBots`) e
  `balance.ts` (`bots`); diplomazia in `RunState` (`relation`, `opinion`, `atWar`, `diploTick`; numeri in `diplomacy`), scheda in
  `HudScene.renderProfile`; accerchiamenti in `encircleTick` (`encircle`). Costruzioni nuove in `works` (ospedale, radar, porto,
  aeroporto). Puntata in `stake` (`camp.ts`: `stakeIndex`, `stakeOf`; formula in `RunState.summary`).
- **Mappa ancora più grande + costruzioni sistemate** (ultima richiesta di Nico: "edifici non funzionano e fai mappa ancora più
  grande"): il tocco su Fabbrica/Bunker senza risorse mandava in errore la scheda (ora si pagano in truppe, avviso chiaro se mancano,
  suggerimento a 40 s se non hai costruito). Carta da **6087 province** su griglia invisibile **640×320 (hexSize 2,5)**, stessa
  dimensione in pixel-mondo: distanze in caselle invariate (in province restano uguali), soglie di zoom ×1,4, zoom iniziale 4,6.
  `render.pixelArt: false` esplicito in `main.ts`: con lo zoom 1/DPR Phaser lo accendeva da solo e sui telefoni le texture
  ingrandite (mare, rilievo, colori) diventavano a quadretti. Sim fronte I: primo impero ~3:20, primo contatto 5:30–9:00.
- **Carta vera già pronta** (ultima richiesta di Nico: "prendi una mappa del mondo già fatta e facci delle forme dentro, molto grande"):
  `npm run build:map` (`scripts/build-map.ts`, da rilanciare solo se cambia la griglia) prende Natural Earth 1:50M (`world-atlas/countries-50m`), semplifica la
  topologia, divide ogni nazione in province con celle di Voronoi rilassate (Lloyd) e ritagliate sui confini veri (`polygon-clipping`),
  allinea i confini condivisi, ondula quelli interni, assegna le caselle e salva tutto in `src/data/worldmap.json` (~2,1 MB:
  6087 province, tratti di confine condivisi, caselle → provincia). A runtime solo decodifica (`src/map/worldAsset.ts`): niente calcoli
  su terre e nazioni all'avvio. Coste e confini veri, disegnati vettoriali; il tocco usa la sagoma vera (`provinceAtPoint`).
  **Tolte la tempesta e le zone tossiche** (Nico): la campagna finisce a tempo (`campaign.warnMs`, `campaigns.*.durationMs`,
  Centro di Comando liv. 3+ = +30 s). Sim: attivo 8/8 vittorie (2,5–8 min), passivo (0,4 tocchi/s) 0/6.
- **Province alla Call of War**: la provincia è l'unità di conquista. Griglia esagonale **invisibile** 320×160 (hexSize 5) solo per
  pedine, navi, nebbia e costi (~11 caselle per provincia).
  `RunState.provOwner` + `frontier()` per province (adiacenze in `Province.neighbors`); costo = somma delle difese delle caselle
  (`provCost`); attacco, avanzata (una provincia ogni `flow.stepMs`), IA, pedine (entrano = prendono la provincia), navi, bombardamento:
  tutto per provincia. Premio alla prima presa (`provinceReward`), capitale = truppe. Traguardi, run guidata e HUD contano province.
  Forme: `src/map/provinceShapes.ts` (anelli di tratti condivisi dalla carta pronta). Disegno: campiture statiche (mare, toni per
  nazione) in texture a tasselli; colori delle fazioni = sagome bianche in atlante tinte (`src/render/ProvinceLayer.ts`); confini
  (province, nazioni, coste, potenze), città e capitali vettoriali a spessore costante, solo nell'inquadratura. Bilanciamento (`sim.ts 1 8 0 1`): giocatore attivo 7/8 vittorie in 2,5–4 min (difesa casella 6/3/12, Frammento 160, crescita 0,08, IA `actChance` 0,12).
- **Pausa strategica (HOI4)**: ❚❚ o SPAZIO/P. Tempo fermo, mappa comandabile: tocchi e trascinamenti mettono province nel **piano**
  (`RunState.plan`, evidenziate), pedine/abilità/navi prendono ordini; alla ripresa il piano parte (attacco o avanzata, in ordine).
  Toccare il proprio territorio = alt (ferma avanzata e piano). Cornice dorata + cartello "PAUSA STRATEGICA".
- **Caricamenti e immagini** (`src/scenes/LoadScene.ts`, `src/data/loading.json`, `src/ui/images.ts`): immagini del Figma in
  `src/assets/img/` (moodboard segnaposto, da sostituire con illustrazioni definitive). Schermata a tutto schermo con viraggio freddo,
  titolo + citazione dall'archivio + fonte, telex di stato e consiglio; copre l'avvio di HQ e campagne (la scena parte sotto).
  Le potenze hanno la loro immagine: scelta potenza (classe dirigente, regime, dottrina, storia), testata della preparazione,
  sfondo dell'HQ e della schermata finale.
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
- (SUPERATO dallo stile moderno sopra) **Stile schermo di comando** (riferimento: mappa al fosforo su monitor): fondo scuro, reticolo geografico ogni 10°
  con coordinate e scala in km, esagoni con reticolo sottile, **coste e confini nazionali veri** (Natural Earth 110m, linee al fosforo con alone)
  sopra la griglia, province come linee sottili, nomi delle nazioni spaziati, niente ombre/contorni sui testi. Territorio = colore fazione
  semitrasparente + bordo chiaro. Colori in `src/config/palette.ts` (chiavi vecchie, valori nuovi); accampamento in versione notturna.
- (SUPERATO dalle province alla Call of War) **Griglia fine** (Nico: "mooolti più territori"): 200×100 esagoni (~6100 di terra, ~420 province da ~12 caselle; prima 120×60, ~170).
  Numeri riscalati in `balance.ts` per tenere lo stesso ritmo in superficie (partenza a 2 anelli, avanzata 65 ms, IA, distanze, bottino per casella);
  `sim.ts` 2 tocchi/s: 4 vittorie su 6 come prima.
