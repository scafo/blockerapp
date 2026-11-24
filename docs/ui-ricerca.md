# Archeon: ricerca UI e piano di rifacimento "a spezzettoni"

Data: 23 novembre 2026. Richiesta di Nico: "tutta la UI va copiata a spezzettoni dagli altri giochi che fanno già bene questa cosa,
quindi Call of War, HoI4 e giochi del genere".

Regola del documento: dai donatori si copiano **struttura e comportamento** (dove sta una cosa, in che ordine si leggono le informazioni,
come si tocca), mai grafica o marchio. Il linguaggio visivo resta il nostro: vetro ardesia scuro, Helvetica/Barlow, valori bianchi,
etichette grigie, un colore per significato (`TCOL` in `src/ui/terminal.ts`, `OPS` in `src/ui/ops.ts`), azione principale ruggine.
Valgono le regole di CLAUDE.md: al massimo 5–6 scelte a schermo, mappa sempre libera al centro, comandi negli angoli in basso.
Prima il browser in orizzontale, il telefono dopo (indicato in ogni scheda come "Telefono").

Metodo e limiti delle fonti: ho letto il codice delle schermate (HudScene, CampScene, TitleScene, TreeScene, ResultScene, ops, terminal,
Button, UnitCard, EventCard) e l'HUD di OpenFront in `riferimenti/OpenFrontIO`. Sul web ho usato guide della community di Call of War,
note di rilascio Bytro, la guida all'interfaccia di HoI4 di GamePressure e i diari di sviluppo di Victoria 3. I wiki Paradox
(hoi4/eu4.paradoxwikis.com) e Game UI Database hanno bloccato la lettura automatica. Dove una posizione o un comportamento viene dalla
mia conoscenza diretta dei giochi, e non da una fonte letta, lo segno con **[diretta]**: va verificato con uno screenshot prima di
copiarlo alla lettera.

---

## 1. Inventario di quello che abbiamo oggi

### 1.1 Campagna (HUD sopra la mappa, `src/scenes/HudScene.ts`)

**Orizzontale (PC)**
- **Barra in alto a sinistra**, due riquadri attaccati: "Esercito" (icona soldato, truppe in numero grande 28) e "Bottino"
  (tre risorse con icona colorata e numero, entrate al minuto sotto ogni risorsa; se c'è la puntata, "Bottino · puntata N" nel bordo).
- Accanto alla barra: **tasto clessidra** col tempo che manca (rosso nell'ultimo minuto). Toccato apre un pannellino "Campagna" con
  province possedute, posizione in classifica ("1° in classifica (+12)") e fine campagna. Poi il **tasto audio**.
- Dopo l'audio: **barra dei gruppi** (schede I, II, III con ×numero pedine e stato colorato; "+ GRUPPO").
- **In alto a destra**: MAPPA (tendina: politica, terreno, logistica; L = logistica) e COSTRUISCI (tendina con 7 edifici, prezzo in
  truppe e metallo, bloccati con la ricerca che serve; poi si trascina sulle province).
- **In basso a sinistra**: riquadro "Reparti" con le carte quadrate 58×58 (solo foto e icona, niente nome né costo) su due file;
  sopra, riquadro "Abilità" (ricognizione, bombardamento) con ricarica che scende.
- **In basso a destra**: RITIRATA (doppio tocco, "ESCI −25%?"), pausa ❚❚, velocità ×1 che gira a ogni tocco.
- **In basso al centro**: la **scheda della selezione** alla Call of War (provincia o pedina). Provincia: nazione come titolo, riga grigia
  con terreno, città, giacimento, padrone, rapporto, assalto in corso; una riga di dati (prezzo o assalto, esito, difesa, produzione,
  costruzione); per le tue province le tre risorse al minuto, logistica, difesa, costruzione. Link "scheda ›" per la potenza.
  Pedina: nome, vita, attacco, stato, rifornimento, chi batte, gittata, passo, tasti Linea e Offensiva.
- **In alto al centro** sotto la barra: suggerimento di contesto (testo in un riquadro).
- **Avvisi** (`toast`): bigliettini impilati in alto a destra (max 4, 3 secondi, titolo + spiegazione + icona + barretta colorata
  allarme/avviso/comunicazione). Nessun registro: passati i 3 secondi spariscono.
- **Cartelli** (`banner`): scritta grande al 36% dell'altezza, al centro, per capitali prese, guerre dichiarate, coalizioni, traguardi.
- **Scheda di un impero/milizia** (`renderProfile`): finestra al centro 380×306, ritratto del capo, tipo, province, truppe stimate,
  "più forti di te", rapporto con icona, barra dell'opinione, fino a 4 azioni (guerra/pace, alleanza, doni, tributo). Si apre toccando
  insegna, provincia in pace o tenendo premuto. L'elenco delle potenze nell'angolo è stato tolto ("non si capiva").
- **Previsione al passaggio del mouse**: riquadrino accanto al cursore "ASSALTO · 120 truppe · 8 s / esito: probabile".
- **Pausa strategica**: SPAZIO/P, cornice dorata attorno allo schermo + cartello "PAUSA STRATEGICA" in alto al centro.
- **Comandi (H)**: finestra al centro con quattro gruppi di scorciatoie.
- **Carta evento** (`src/ui/EventCard.ts`): alla Reigns, al centro, immagine, racconto, due scelte (trascina o tocca), la run si ferma.
- **Guida** (run guidata): frecce, anelli ed etichette.
- Nessuna minimappa, nessun registro degli eventi, nessun elenco di pedine/cantieri, nessuna classifica sempre visibile.

**Verticale (telefono)**: barra in alto su due righe (esercito, poi bottino), clessidra e audio a destra; pausa, MAPPA, COSTRUISCI in
colonna a destra sotto la barra; carte in fila in basso; RITIRATA sopra le carte a destra, velocità in basso a destra; la scheda della
selezione in basso nasconde carte e leve; avvisi al centro sotto la barra.

### 1.2 Base / HQ (`src/scenes/CampScene.ts`)
- **Home** alla XCOM 2: barra in alto (ritratto del comandante, ARCHEON, "nome · cambia nome", scorte con icona e numero, audio),
  montagna con tre piani di stanze illustrate che si toccano (targa: icona, nome, livello, stato, timer). A destra colonna "In corso"
  (Cantiere, Ricerca, Estrazione: righe con icona e tempo) e in fondo la **prossima operazione** (immagine del fronte, "Fronte II",
  nome, potenza tua contro consigliata) con AVVIA CAMPAGNA ruggine in basso a destra.
- **Pagine delle stanze**: foto della stanza a tutto schermo, testata (icona, titolo grande, livello, scorte, Back), fascicolo a destra
  alto quanto il contenuto: livelli, costo a schede serve/hai, azione. Schede Registro/Livelli (Radar), Ricerca/Livelli (Laboratorio).
- **Sala Operazioni (preparazione)**: testata della potenza (ritratto del capo, nome, bonus, "Cambia potenza"), riga del fronte con
  immagine ("Cambia fronte"), reparti del mazzo come carte, armi nemiche (rosse se non le hai), Durata a segmenti, Puntata a segmenti con
  rischi, AVVIA LA CAMPAGNA. Sottoviste: scelta della potenza (4 carte con immagine) e scala dei fronti.
- **Estrazione** (pagina a tutto schermo stile Figma), **Deposito**, **Arsenale**, **Radar** (registro con colonne), **Mercato**
  (sezione Lume in cima, scambi, rifornimenti, finisci subito), **Alloggi**, **Archivio**.

### 1.3 Altre schermate
- **Menu principale** (`TitleScene.ts`, appena rifatto): foto a tutto schermo, titolo in alto a sinistra, voci grandi a sinistra (GIOCA,
  BASE, RICERCA, MERCATO), a destra comandante, lavori in corso e riquadro Lume; frecce/WASD e INVIO.
- **Albero della ricerca** (`TreeScene.ts`): fasce orizzontali per ramo con nome a sinistra, carte con immagine collegate dai
  prerequisiti, si trascina; scheda di dettaglio in basso con immagine, requisiti, descrizione, costo, azione.
- **Schermata finale** (`ResultScene.ts`): rapporto, chip potenza/fronte/durata, esito grande, bollettino, due numeri (province max,
  durata), fronte sbloccato; a destra pannello del bottino (risorse, voci che lo hanno cambiato, puntata messa/portata a casa, Deposito);
  tasti in basso a sinistra (rivincita, base).
- **Caricamento** (`LoadScene.ts`): documento d'archivio a telescrivente sopra l'immagine.

### 1.4 Problemi di chiarezza che si vedono già dal codice
1. Le informazioni della partita sono sparse: truppe e bottino in alto a sinistra, classifica e province dentro un pannello che si apre
   dalla clessidra, tempo sul tasto, gruppi accanto, mappe e costruzioni a destra. Non c'è un posto unico dove leggere "come sto andando".
2. Le cose importanti che succedono durano 3 secondi e poi spariscono: non c'è modo di rileggere chi ti ha dichiarato guerra o dove.
3. Niente ti dice "cosa dovresti fare adesso" (truppe ferme in cassa, pedine inattive, cantiere libero, sacca tagliata fuori).
4. Le potenze non hanno un elenco: per sapere chi è in guerra con te devi trovare la loro insegna sulla mappa.
5. Le carte dei reparti non dicono quanto costano (il costo si scopre toccandole e leggendo l'errore).
6. Il tempo è diviso in tre tasti separati (pausa, velocità che gira, clessidra in alto) e la ritirata, che è irreversibile, sta accanto
   alla pausa.
7. Le scelte degli eventi e le azioni diplomatiche non mostrano l'effetto prima di toccarle.

---

## 2. Come lo fanno gli altri (elemento per elemento)

### 2.1 Barra delle risorse in alto
- **Hearts of Iron IV**: una barra continua in alto a sinistra con bandiera (apre la politica), poi in fila stabilità/sostegno alla guerra,
  potere politico, manodopera, fabbriche, esperienza esercito/marina/aviazione, convogli; data e velocità in alto a destra
  ([GamePressure, interfaccia HoI4](https://www.gamepressure.com/heartsofiron4/interface/z78eb8)). Ogni numero ha un tooltip con la
  ripartizione (da dove viene, dove va) **[diretta]**. Perché funziona: un'icona e un numero per risorsa, sempre nello stesso posto,
  e il dettaglio solo al passaggio del mouse.
- **Call of War**: sul telefono la barra in alto mostra l'**avanzamento verso la vittoria**, con un menu che si espande per profilo,
  coalizione e il resto ([note di rilascio CoW 2.0, luglio 2022](https://bytro.helpshift.com/hc/en/4-call-of-war/faq/233)); nel 2025
  la barra del PC è stata rifatta uguale a quella del telefono
  ([note 16 settembre 2025](https://playsupremacy.com/en/news/call-of-war-1942/cow-release-notes-20250916)). Risorse e stoccaggio con
  produzione giornaliera ([guida community](https://www.playsupremacy.com/en/forums/call-of-war-1942/call-of-war-1942-community-guides-videos/2-game-interface-and-the-chat-f99c9705)).
  Perché funziona: l'obiettivo della partita (punti vittoria) è sempre in vista accanto alle risorse.
- **Victoria 3**: tre principi dichiarati nel diario #29: l'informazione giusta al momento giusto, causa ed effetto chiari, azioni
  separate dalle informazioni; tooltip annidati per spiegare i numeri senza un tooltip enorme
  ([Dev Diary #29](https://forum.paradoxplaza.com/forum/developer-diary/victoria-3-dev-diary-29-user-experience.1506484/page-5)).
  Le voci della barra compaiono solo quando servono (i convogli solo se hai una costa)
  ([Dev Diary #74](https://www.paradoxinteractive.com/games/victoria-3/news/dev-diary-74-ux-improvements)).
- **OpenFront** (nel nostro `riferimenti`): niente barra in alto; truppe, oro e rapporto d'attacco stanno nel pannello di controllo in
  basso, con il guadagno che "salta" sopra il numero (`ControlPanel.ts`, classe `gold-gain-pop`). Classifica nella colonna di sinistra
  (`GameLeftSidebar.ts`).

### 2.2 Scheda della provincia e della pedina (selezione)
- **Call of War**: sul PC, toccata una provincia compare una barra in basso con Costruzione e Produzione a sinistra; sul telefono le
  stesse scelte stanno in cerchio attorno alla provincia ([guida community](https://www.playsupremacy.com/en/forums/call-of-war-1942/call-of-war-1942-community-guides-videos/2-game-interface-and-the-chat-f99c9705)).
  Nel 2.0 le barre di provincia e armata del telefono sono state **unificate**, si può toccare direttamente una provincia o armata nemica
  per dare l'ordine d'attacco senza prima scegliere le proprie truppe, e il pannello dell'unità ha "statistiche rapide"
  ([CoW 2.0](https://bytro.helpshift.com/hc/en/4-call-of-war/faq/233)). L'armata selezionata mostra forza, composizione, posizione
  e morale con marcia, attacco, dividi ([guida](https://www.playsupremacy.com/en/forums/call-of-war-1942/call-of-war-1942-community-guides-videos/2-game-interface-and-the-chat-f99c9705));
  la provincia mostra produzione, entrate, consumo, popolazione, morale e i punti vittoria con una stella in alto a destra
  ([guida province](https://www.playsupremacy.com/en/forums/call-of-war-1942/call-of-war-1942-community-guides-videos/7-provinces-and-buildings-946921a0)).
  Nel 2020 la barra delle armate sul telefono è passata dall'alto al basso ([note 2020](https://www.playsupremacy.com/en/forums/call-of-war-1942/call-of-war-1942-news/release-notes-2020-10-20-0e059955)).
- **HoI4**: la divisione o l'armata selezionata appare in basso a sinistra come una carta con ritratto del generale, forza e
  organizzazione in barre, e i comandi della linea del fronte **[diretta]**. La provincia si apre in un pannello a sinistra con
  edifici costruibili come pulsanti **[diretta]**.
- **Europa Universalis IV**: la finestra della provincia si apre in basso a sinistra, con schede **[diretta]**.

### 2.3 Diplomazia
- **HoI4**: due livelli. Primo: elenco dei paesi con filtri (continente, ideologia) e due valori per riga, il tuo rapporto con loro e la
  loro opinione di te. Secondo: il paese scelto, con unità nazionale, opinioni, obiettivo, e le azioni diplomatiche, "la parte più
  importante" ([GamePressure](https://www.gamepressure.com/heartsofiron4/interface/z78eb8)).
- **Victoria 3**: il pannello mostra **in anticipo se l'IA accetterà** e cosa la farebbe cambiare idea; elenca anche le azioni non
  disponibili con il motivo ([Dev Diary #74](https://www.paradoxinteractive.com/games/victoria-3/news/dev-diary-74-ux-improvements)).
- **OpenFront**: le richieste d'alleanza arrivano come avvisi **con i tasti accetta/rifiuta dentro** (`ActionableEvents.ts`), e la
  scheda del giocatore si apre dal menu radiale (`PlayerPanel.ts`, `RelationSmiley.ts`: faccina del rapporto).
- **Call of War**: diplomazia accanto al giornale, con messaggi, scambi, rapporti e informazioni sul paese
  ([guida](https://www.playsupremacy.com/en/forums/call-of-war-1942/call-of-war-1942-community-guides-videos/2-game-interface-and-the-chat-f99c9705)).

### 2.4 Produzione e coda dei cantieri
- **Call of War**: costruzione e produzione dalla provincia, e un elenco delle province che permette di produrre e costruire da un posto
  solo ([guida](https://www.playsupremacy.com/en/forums/call-of-war-1942/call-of-war-1942-community-guides-videos/2-game-interface-and-the-chat-f99c9705)).
  Conferma prima di annullare ricerca, produzione o costruzione ([CoW 2.0](https://bytro.helpshift.com/hc/en/4-call-of-war/faq/233)).
- **HoI4**: pannello produzione con le linee di produzione in fila, i mancanti in rosso; pannello costruzioni con la coda ordinabile
  ([GamePressure](https://www.gamepressure.com/heartsofiron4/interface/z78eb8)).
- **XCOM 2**: in base, la colonna a destra elenca gli eventi in arrivo ordinati per data (ricerca finita tra 3 giorni, costruzione tra 5)
  **[diretta]**; la schermata delle strutture dà la panoramica di ogni stanza
  ([wiki Avenger](https://xcom2.wiki.fextralife.com/Avenger)).

### 2.5 Albero della ricerca
- **HoI4**: schede per ramo (fanteria, supporto, corazzati...), colonne per **anno**, una ricerca "in anticipo sul suo anno" costa di più;
  in alto gli **slot di ricerca** attivi con barra; più ricerche in parallelo
  ([GamePressure](https://www.gamepressure.com/heartsofiron4/interface/z78eb8); colonne per anno **[diretta]**).
- **Call of War**: si ricercano i livelli delle unità e i livelli più alti migliorano tutte le unità di quel tipo; si possono cambiare i
  livelli per pianificare ([guida](https://www.playsupremacy.com/en/forums/call-of-war-1942/call-of-war-1942-community-guides-videos/2-game-interface-and-the-chat-f99c9705), [CoW 2.0](https://bytro.helpshift.com/hc/en/4-call-of-war/faq/233)).
- **Polytopia**: albero a raggiera piccolo, ogni nodo un'icona grande con il costo sotto; un tocco apre la descrizione con "Ricerca"
  **[diretta]**. Funziona sul telefono perché c'è poco testo.

### 2.6 Reparti, carte e armate
- **Call of War**: elenco delle armate per seguire tutte le unità, armate e province **fissabili** ("pin")
  ([CoW 2.0](https://bytro.helpshift.com/hc/en/4-call-of-war/faq/233)).
- **HoI4**: in basso a destra le carte delle armate (ritratto, numero di divisioni, stato), il riquadro "crea armata"
  ([GamePressure](https://www.gamepressure.com/heartsofiron4/interface/z78eb8)), e a destra l'**outliner** con armate, produzione,
  ricerche, comprimibile **[diretta]**. L'outliner nasce in EU3 e Paradox lo considera indispensabile
  ([diario Paradox 2009](https://forum.paradoxplaza.com/forum/threads/development-diary-29-20th-of-may-2009.405217/)).
- **Clash Royale** (citato in CLAUDE.md per il mazzo): carte in basso con il costo in elisir in un angolo della carta e la prossima carta
  in piccolo **[diretta]**.

### 2.7 Avvisi, allarmi e registro
- **HoI4**: riga di **icone d'allarme** sotto la barra in alto (ricerca libera, fabbriche libere, mancano risorse, niente obiettivo); un
  clic apre il pannello giusto ([GamePressure](https://www.gamepressure.com/heartsofiron4/interface/z78eb8)).
- **Victoria 3**: finestra delle impostazioni dei messaggi: per ogni tipo si sceglie come appare e se mette in pausa; i default sono stati
  tarati per **dimezzare** il numero di avvisi ([Dev Diary #74](https://www.paradoxinteractive.com/games/victoria-3/news/dev-diary-74-ux-improvements)).
  Avvisi importanti come striscione in alto con suono.
- **EU4 / Stellaris**: registro dei messaggi richiamabile, pausa automatica su alcuni eventi
  ([discussione Stellaris](https://steamcommunity.com/app/281990/discussions/0/3280321473017054130)); log della situazione in
  Stellaris **[diretta]**.
- **OpenFront**: registro in basso a destra (`EventsDisplay.ts`), ogni riga si tocca e **la mappa va sul giocatore o sull'unità**
  (`GoToPlayerEvent`, `GoToUnitEvent`); attacchi in arrivo e in uscita in una lista separata (`AttacksDisplay.ts`); cornice rossa
  d'allarme (`AlertFrame.ts`).

### 2.8 Tempo e pausa
- **HoI4 / EU4**: in alto a destra data, pausa e cinque velocità con + e −; SPAZIO mette in pausa e la data si sostituisce con "IN PAUSA"
  ([GamePressure, pannello del tempo](https://www.gamepressure.com/heartsofiron4/interface/z78eb8); "in pausa" **[diretta]**).
  L'uscita dalla partita sta nel menu di gioco (ESC), mai accanto alla velocità ([GamePressure](https://www.gamepressure.com/heartsofiron4/interface/z78eb8)).
- **Call of War**: tempo reale senza pausa; il cambio giorno è scritto nel giornale
  ([guida](https://www.playsupremacy.com/en/forums/call-of-war-1942/call-of-war-1942-community-guides-videos/2-game-interface-and-the-chat-f99c9705)).

### 2.9 Minimappa e modalità della carta
- **EU4**: minimappa in basso a destra con le modalità della carta in fila sopra **[diretta]**. **HoI4**: filtri della carta in basso a
  destra ([GamePressure](https://www.gamepressure.com/heartsofiron4/interface/z78eb8)). **Victoria 3**: ogni "lente" ha la sua modalità
  della carta, con dissolvenza tra le modalità ([DD #29](https://forum.paradoxplaza.com/forum/developer-diary/victoria-3-dev-diary-29-user-experience.1506484/page-5), [DD #74](https://www.paradoxinteractive.com/games/victoria-3/news/dev-diary-74-ux-improvements)).
  **Call of War**: nuovi filtri della carta e "preferiti" della mappa ([CoW 2.0](https://bytro.helpshift.com/hc/en/4-call-of-war/faq/233)).

### 2.10 Menu principale, fine partita, negozio
- **Fine partita, Call of War 2.0**: la schermata finale mostra le **statistiche della partita**, e il pannello dell'avanzamento verso la
  vittoria e dei premi è stato rifatto ([CoW 2.0](https://bytro.helpshift.com/hc/en/4-call-of-war/faq/233)). **Civilization /
  Polytopia**: grafico del punteggio nel tempo e "replay" della carta **[diretta]**. **Clash Royale**: premi che si aprono uno per volta, poi
  un tasto solo per tornare **[diretta]**.
- **Negozio, Call of War**: mercato delle risorse in gioco, oro per comprare quando nessuno vende
  ([guida](https://www.playsupremacy.com/en/forums/call-of-war-1942/call-of-war-1942-community-guides-videos/2-game-interface-and-the-chat-f99c9705)); interfaccia del negozio rifatta nel 2022
  ([note agosto 2022](https://bytro.helpshift.com/hc/en/4-call-of-war/faq/240)).
- **Menu principale, XCOM 2 / Stellaris**: voce principale in cima (Continua o Nuova partita), il resto sotto, sfondo animato
  **[diretta]**. Il nostro è già su questa linea.

---

## 3. Specifiche: per ogni nostro elemento, il donatore e come diventa

Misure in punti CSS sulla base 900×500 di `uiScale` (si ingrandisce su PC fino a 1,75×). "Telefono" = verticale.

### 3.1 Barra in alto della campagna → da HoI4 (fila di risorse) + Call of War (avanzamento vittoria)
- **Posizione**: un'unica fascia in alto, a tutta larghezza meno i margini, alta 44. Solo informazioni, nessun comando (principio
  Victoria 3: azioni separate dalle informazioni).
- **Contenuti, da sinistra**:
  1. Insegna della tua fazione e nome (toccata: la tua scheda, come la bandiera di HoI4).
  2. **Truppe** grandi con le entrate al secondo/minuto in verde piccolo accanto.
  3. Cibo, Metallo, Benzina: icona + numero + entrata al minuto sotto (già fatto in `layoutResources`); se c'è la puntata, una tacca
     sottile sotto il numero mostra quanto della risorsa è "puntata".
  4. Al centro: **Vittoria** alla Call of War: "1° · 84 province · +12 sul 2°" con una barretta che confronta te e il secondo.
     Toccata apre l'elenco delle potenze (3.4).
  5. A destra: **tempo che manca** (oggi sul tasto clessidra), in ambra sotto i 5 minuti, rosso nell'ultimo.
- **Tooltip alla HoI4/Victoria 3**: al passaggio del mouse su ogni numero, un riquadro con la ripartizione: "Metallo +14/min: province
  di colline 9, Fabbriche 4, giacimenti 1, mantenimento pedine −2". Sul telefono si apre col tocco lungo.
- **Stati**: risorsa che cala = numero rosso per 1 s e freccia giù; risorsa ferma per mantenimento mancante = icona d'allarme (3.3).
- **Cosa sparisce**: il tasto clessidra con il suo pannellino (`openMedal`) e la cornice "Bottino" separata.
- **Telefono**: due righe di 36: in alto insegna, truppe, vittoria, tempo; sotto le tre risorse. Il tocco su "Vittoria" fa lo stesso.

### 3.2 Comandi del tempo in basso a destra → da HoI4/EU4 (pannello del tempo), spostato in basso per la nostra regola
- **Posizione**: angolo in basso a destra, un solo blocco di vetro largo ~200, alto 44.
- **Contenuti**: pausa/riprendi (tasto quadrato) + velocità a segmenti **×1 ×2 ×3 visibili insieme** (non un tasto che gira: tre
  scelte leggibili, come i segmenti già usati nella Sala Operazioni). Quando è in pausa, i segmenti si spengono e al loro posto si legge
  "IN PAUSA · piano: 4 province" (come la data di HoI4 sostituita da "in pausa"). Il cartello al centro in alto sparisce: la mappa al
  centro resta libera; resta la cornice dorata sottile, che si vede bene.
- **Modalità della carta** (da EU4/HoI4, filtri in basso a destra): tre icone piccole sopra il blocco del tempo (politica, terreno,
  logistica) al posto della tendina MAPPA in alto a destra. Toccata, l'icona si accende e la legenda appare sopra le icone.
- **RITIRATA** esce da qui: va nel menu di gioco (ESC su PC, tasto ⋯ sul telefono) con conferma chiara "Ritirata: perdi il 25% del
  bottino. Conferma / Annulla", come l'uscita nel menu di HoI4. Un comando irreversibile non deve stare accanto alla pausa.
- **Tastiera**: SPAZIO pausa, 1/2/3 velocità (oggi i numeri sono usati per i gruppi: in alternativa + e − come HoI4).
- **Telefono**: stesso blocco in basso a destra, le tre velocità diventano un tasto ×N che apre i tre segmenti.

### 3.3 Riga degli allarmi → da HoI4 (icone d'allarme sotto la barra)
- **Posizione**: sotto la barra in alto, allineata a sinistra, icone quadrate 32 con un numero. Al massimo 5 visibili.
- **Allarmi (solo azionabili, in ordine di urgenza)**:
  1. "Provincia sotto assalto" (rosso) → la carta va sulla provincia.
  2. "Sacca tagliata fuori" (rosso) → la carta va sulla sacca, vista logistica accesa.
  3. "Manca benzina/cibo per le pedine" (rosso) → scheda della prima pedina che si logora.
  4. "Truppe ferme in cassa" (ambra, sopra una soglia e senza avanzata in corso) → si accendono le province comprabili.
  5. "Pedine ferme" (ambra) → seleziona le pedine senza ordini.
  6. "Puoi costruire" (grigio, dopo il minuto 1 senza edifici) → apre COSTRUISCI.
- **Interazione**: passaggio del mouse = una riga di spiegazione; tocco = porta dove serve (come gli allarmi di HoI4 aprono il
  pannello giusto). Tasto destro = nascondi quell'allarme per questa campagna.
- **Telefono**: stessa riga, icone 28, sotto la barra.

### 3.4 Elenco delle potenze e scheda diplomatica → da HoI4 (due livelli) + Victoria 3 (accettazione IA) + OpenFront (avvisi con risposta)
- **Primo livello, elenco**: si apre toccando "Vittoria" nella barra. Riquadro a sinistra sotto la barra, largo 280, una riga per
  ognuno dei 3 imperi (sempre) e per le milizie confinanti (non tutte e 36). Riga: insegna e colore, nome, province, icona del rapporto
  (guerra/pace/alleanza), opinione con la sua barretta (i due valori per riga di HoI4: rapporto e opinione). Ordinato per province.
  Tu sei una riga evidenziata. Un tocco sulla riga = la carta va sulla sua capitale; un secondo tocco = secondo livello.
- **Secondo livello, scheda** (`renderProfile`, già alla HoI4): resta al centro ma **non più al centro della mappa**: si aggancia accanto
  all'elenco, a sinistra. Contenuti in ordine: ritratto e nome; rapporto + opinione; forza (province, truppe, "più forti di te");
  **azioni con l'esito previsto** alla Victoria 3: sotto ogni azione una riga piccola "accetterebbe" in verde o "rifiuterebbe:
  opinione −20, serve +30" in rosso; le azioni non disponibili restano visibili spente con il motivo ("tregua: 1:40").
- **Proposte dell'IA** (pace, alleanza, tributo chiesto a te): avviso con i tasti **Accetta / Rifiuta** dentro, come
  `ActionableEvents` di OpenFront; se non rispondi in 20 s scade.
- **Telefono**: l'elenco occupa la metà alta dello schermo, la scheda sostituisce l'elenco con una freccia per tornare.

### 3.5 Scheda della selezione in basso al centro → da Call of War 2.0 (barra unificata provincia/armata, statistiche rapide)
- **Posizione**: in basso al centro, come oggi, larghezza 460, altezza secondo il contenuto ma con un tetto (max 150), mai sopra il 30%
  inferiore dello schermo.
- **Struttura fissa in tre fasce** (uguale per provincia e pedina, così l'occhio sa dove guardare):
  1. **Testata**: insegna del padrone, nome (nazione o reparto), riga grigia (terreno, città, padrone, rapporto), a destra la stella
     dei "punti" alla Call of War se è una capitale o una città, poi ✕.
  2. **Statistiche rapide**: al massimo 4 celle grandi (icona + valore + etichetta piccola). Provincia libera: prezzo, esito, difesa,
     produzione. Provincia nemica: forza difensiva, esito previsto, rifornimento, costruzione. Tua: le tre risorse /min e difesa
     (la logistica come colore della cella difesa, non come cella a parte). Pedina: vita (barra), attacco, rifornimento, stato.
  3. **Azioni a destra della scheda**, in colonna o in riga di al massimo 3 tasti, con **l'azione principale piena** (bianca, già
     prevista in `button(..., 'main')`): libera = PRENDI (o "servono 40 truppe" spento); milizia = ASSALTA; impero in guerra = MANDA
     REPARTI; impero in pace = SCHEDA; tua = COSTRUISCI (apre gli edifici di quella provincia, come i tasti Costruzione/Produzione
     della barra di Call of War); pedina = LINEA, OFFENSIVA.
- **Ordine diretto alla Call of War 2.0**: con una pedina selezionata, toccare una provincia nemica manda subito la pedina; senza pedine
  selezionate, toccare una provincia nemica apre la scheda con MANDA REPARTI che sceglie la pedina più vicina adatta (chi batte chi).
- **Nota per Nico**: il tasto COSTRUISCI nella scheda era stato tolto ("non serviva più"). La proposta è tenere anche la modalità a
  pennello dal tasto in alto/B, ma rimettere nella scheda della tua provincia gli edifici, perché Call of War li mette proprio lì. Da
  confermare.
- **Telefono**: la scheda sale dal basso a tutta larghezza (come la barra unificata di Call of War sul telefono) e nasconde le carte;
  le azioni vanno in una riga sotto le statistiche.

### 3.6 Carte dei reparti e abilità → da Clash Royale (costo sulla carta) + Call of War (info rapida dell'unità)
- **Posizione**: in basso a sinistra, come oggi, una sola fila se ci stanno (4 reparti + 2 abilità = 6, il massimo della regola).
- **Contenuti della carta**: foto e icona (come ora) + **costo in truppe in un angolo** (numero 11 su fondino scuro) + piccola icona
  della risorsa se serve benzina o cibo. Il numero diventa rosso se non basta: si capisce prima di toccare perché la carta è spenta.
- **Tasto rapido** stampato piccolo nell'altro angolo su PC (Q W E R, Z X per le abilità).
- **Passaggio del mouse**: riquadro sopra la carta con nome, "batte: ricognitori", vita, attacco, costo; è la "quick stats" di
  Call of War 2.0.
- **Stati**: pronta (piena), mancano truppe (costo rosso, carta al 45%), in ricarica (velo che scende, come ora), scelta (si alza di 8,
  filo bianco, come ora), bloccata (lucchetto).
- **Telefono**: fila in basso, carte più piccole, costo sempre visibile.

### 3.7 Gruppi e pedine → da HoI4 (outliner a destra) + Call of War 2.0 (elenco armate fissabile)
- **Posizione**: colonna stretta a destra (larga 200), sotto la riga degli avvisi, comprimibile con una freccia a una sola linguetta.
  Parte compressa al primo avvio; si apre da sola la prima volta che fai un gruppo.
- **Sezioni** (ognuna si comprime):
  1. **Reparti**: i gruppi I–IX (oggi nella barra dei gruppi in alto) con numero pedine, stato colorato, vita media; sotto le pedine sciolte.
     Tocco = seleziona; doppio tocco = la carta ci va (come oggi).
  2. **Assalti in corso**: provincia, secondi che mancano, esito previsto. Tocco = la carta ci va.
  3. **Cantieri**: edificio, provincia, tempo che manca.
- **Cosa sparisce**: la barra dei gruppi in alto (`drawGroupBar`), che oggi si allunga verso il centro e compete con la barra in alto.
- **Telefono**: niente colonna; un tasto "Reparti" a destra apre un foglio che sale dal basso.

### 3.8 Avvisi, cartelli e registro → da Victoria 3 (tre livelli tarati) + OpenFront (registro cliccabile) + HoI4/EU4 (registro)
- **Tre livelli fissi**, decisi per tipo di messaggio in una tabella (nuovo file dati, es. `src/data/messages.json`, oppure in `balance.ts`):
  1. **Cartello** (raro, massimo uno ogni 20 s): guerra dichiarata a te, coalizione, capitale presa o persa, alleanza, fine campagna
     vicina. Resta come oggi ma più in alto (al 22% dell'altezza, sopra la zona di gioco centrale) e più breve.
  2. **Avviso** (bigliettino a destra, 4 s): offensive, sacche, eliminazioni, tributi, doni. Con la riga che porta sul posto: tocco
     sull'avviso = la carta va lì (come `GoToPlayerEvent` di OpenFront).
  3. **Solo registro**: tutto il resto (rifiuti, pedine logorate, avanzate ferme, conquiste delle IA lontane).
- **Registro** in basso a destra sopra il blocco del tempo, chiuso di default: una linguetta "Registro (3 nuovi)". Aperto: ultime 30
  righe con ora della campagna (12:40), icona, una riga di testo, tocco = la carta va sul posto. Filtro: tutto / guerra / diplomazia.
- **Pausa automatica** su: guerra dichiarata a te, coalizione, proposta di pace dell'IA (opzione nelle impostazioni, come la pausa
  sugli eventi di Stellaris/Victoria 3).
- Obiettivo: dimezzare gli avvisi a schermo, come ha fatto Victoria 3.
- **Telefono**: avvisi al centro sotto la barra (come ora), registro da un tasto nel menu ⋯.

### 3.9 Carta evento → da HoI4 (evento con effetti) mantenendo la forma Reigns
- **Posizione**: al centro, come ora (la run è in pausa: qui la mappa può essere coperta).
- **Cambia**: sotto ogni scelta, una riga piccola con **l'effetto** ("+60 truppe · −40 metallo", "opinione dell'Imperium +20") in verde e
  rosso. In HoI4 l'effetto si legge sul tasto prima di scegliere **[diretta]**; è il principio "causa ed effetto chiari" di Victoria 3.
  Una scelta che non ti puoi permettere resta visibile ma spenta con il motivo.
- **Telefono**: uguale, scelte a tutta larghezza.

### 3.10 Previsione dell'assalto (passaggio del mouse) → da Call of War (anteprima dello scontro) e Victoria 3 (tooltip annidati)
- Già esiste. Spec: due righe fisse (prezzo e tempo; esito con la sua barretta a tre zone verde/ambra/rossa), e premendo ALT una
  terza riga con il perché ("difesa 40: colline ×1,4, bunker ×1,7"). Sul telefono non c'è passaggio del mouse: la stessa informazione
  sta nelle statistiche rapide della scheda (3.5).

### 3.11 Minimappa → da EU4, ma ridotta
- Non una minimappa vera (la carta da terminale a puntini non si legge in piccolo e ruberebbe un angolo). Al suo posto un tasto
  "Mondo" accanto alle modalità della carta che porta lo zoom al massimo per vedere tutto, e il doppio tocco su una riga del registro o
  dell'elenco per spostarsi. Priorità bassa.

### 3.12 Menu di gioco (nuovo, ESC / ⋯) → da HoI4/EU4 (menu di gioco con salva, opzioni, esci)
- Finestrella al centro, sopra la pausa: Riprendi, Comandi (oggi tasto H), Audio (oggi tasto in alto), Ritirata (con la sua conferma
  e il costo). Toglie dalla barra in alto il tasto audio e dal basso RITIRATA: meno tasti sempre a schermo.

### 3.13 Base / HQ home → da XCOM 2 (sezione e coda eventi), già scelta; rifiniture
- **Barra in alto**: uguale come struttura alla barra della campagna (3.1), stessa posizione delle risorse, così il giocatore trova i
  numeri nello stesso punto in entrambe le parti del gioco (XCOM 2 tiene la stessa barra in tutte le stanze **[diretta]**). Aggiungere la
  capienza del Deposito come barretta sotto ogni numero.
- **Colonna "In corso"** → coda di XCOM 2: righe ordinate per **quando finiscono** (la più vicina in cima), con "tra 4 min",
  barra d'avanzamento, e "libero: tocca per avviare" in ambra se il cantiere, la ricerca o l'estrazione sono fermi (allarme, come 3.3).
- **Prossima operazione** in basso a destra con AVVIA CAMPAGNA ruggine: resta.
- **Telefono**: come ora.

### 3.14 Sala Operazioni (preparazione) → da XCOM 2 (briefing con squadra) + Call of War (scelta della partita)
- Ordine delle informazioni come un briefing: 1) dove vai (fronte con immagine e difficoltà, potenza tua contro consigliata con una
  sola barra), 2) con chi (mazzo di 4 carte, armi nemiche), 3) quanto rischi (durata e puntata a segmenti, con **il bottino atteso**
  stimato accanto a ogni scelta: "×1,4 · ~1.400"), 4) AVVIA ruggine in basso a destra. Oggi c'è già quasi tutto: manca la stima del
  bottino accanto alle scelte e la barra unica della potenza.

### 3.15 Albero della ricerca → da HoI4 (schede per ramo, colonne, slot in alto) + Polytopia (nodi grandi e poco testo)
- **Testata**: lo **slot di ricerca in corso** in grande (immagine, nome, barra, tempo, FINISCI ORA), come gli slot in cima al pannello
  di HoI4.
- **Schede per ramo** in alto (Armamenti, Esercito, Logistica, Economia, Difesa, La Caduta) al posto delle fasce tutte insieme: una scheda
  alla volta, al massimo 4–6 nodi visibili, rispettando la regola delle 5–6 scelte.
- **Colonne = livello del Laboratorio** che serve (come gli anni di HoI4): una linea verticale tratteggiata segna "oltre il tuo
  livello", i nodi dopo la linea sono spenti con "Laboratorio liv. 3".
- **Nodo**: icona/immagine grande, nome, costo con icone sotto (Polytopia), stato con colore (fatta verde, in corso ambra, disponibile
  bianca, bloccata grigia).
- **Dettaglio**: in basso come ora, con l'effetto in numeri ("Fanteria +15% vita").
- **Telefono**: schede scorrevoli, nodi in colonna.

### 3.16 Menu principale → da XCOM 2 / Stellaris (voce principale in cima)
- Appena rifatto e già su questa struttura. Unica modifica: se c'è un lavoro finito da ritirare nella base, la voce BASE mostra un
  pallino con il numero (come i badge di Clash). Nient'altro.

### 3.17 Schermata finale → da Call of War 2.0 (statistiche della partita) + Civilization/Polytopia (grafico nel tempo) + Clash (premi e un tasto)
- **Sinistra**: esito grande (come ora), bollettino, poi un **grafico delle province nel tempo** con una linea per te e una per ogni
  impero (colori delle fazioni + simboli per il daltonismo), segnati i momenti chiave (prima guerra, capitale presa).
- **Sotto il grafico**: 4 numeri: province massime, battaglie vinte/perse, sacche prese, durata.
- **Destra**: bottino che si riempie voce per voce (come ora, con animazione a scatti alla Clash), puntata messa → portata a casa.
- **In basso a destra**: un'azione principale ruggine: "Torna alla base" (dopo una vittoria) o "Rivincita" (dopo una sconfitta, come
  ora), l'altra come secondaria.

### 3.18 Mercato / negozio → da Call of War (mercato risorse) + Clash Royale (sezioni)
- Schede in alto: **Lume** (se attivo), **Scambi**, **Rifornimenti**, **Velocizza**. Una sezione per volta, al massimo 6 offerte.
  Ogni offerta: immagine/icona, cosa ricevi in grande, prezzo nel tasto. Mai casse a sorpresa (regola di design).

---

## 4. Le 10 modifiche più utili (impatto sulla chiarezza e sul divertimento contro fatica)

Fatica: P = piccola (meno di mezza giornata), M = media (1–2 giorni), G = grande (3+ giorni).

1. **Barra in alto unica alla HoI4/Call of War** (truppe, tre risorse con entrata e tooltip di ripartizione, vittoria "1° · +12",
   tempo). Toglie il pannello della clessidra e mette in vista l'obiettivo. Impatto alto, fatica M.
   File: `src/scenes/HudScene.ts` (`layout`, `layoutResources`, `openMedal`/`toggleMedal`, `update`), `src/ui/terminal.ts` (tooltip),
   `src/game/RunState` per la ripartizione delle entrate.
2. **Blocco del tempo in basso a destra alla HoI4** (pausa + ×1 ×2 ×3 a segmenti, "IN PAUSA · piano N" al posto del cartello al centro)
   e **RITIRATA nel menu di gioco** con conferma. Impatto alto (chiarezza + niente uscite per sbaglio), fatica P.
   File: `HudScene.ts` (`setSpeed`, `togglePause`, `onRetreat`, `layout`), `src/ui/Button.ts` (segmenti), `src/ui/hotkeys.ts`.
3. **Riga degli allarmi azionabili alla HoI4** (assalto in corso, sacca tagliata, mantenimento, truppe ferme, pedine ferme, puoi
   costruire). Dice al giocatore cosa fare: è la cosa che manca di più. Impatto alto, fatica M.
   File: `HudScene.ts` (nuovo metodo `drawAlerts` in `update`), `src/scenes/RunScene.ts` (spostare la carta, selezionare), RunState
   (contatori).
4. **Registro eventi cliccabile + tre livelli di messaggi** (cartello / avviso / solo registro, alla Victoria 3; tocco = la carta va sul
   posto, alla OpenFront). Impatto alto, fatica M.
   File: `HudScene.ts` (`toast`, `banner`, `notify`, tutti gli `on*`), `src/ui/terminal.ts` (`termNote`), nuovo `src/data/messages.json`.
5. **Elenco delle potenze + esito previsto delle azioni diplomatiche** (HoI4 due livelli, Victoria 3 "accetterebbe"), proposte dell'IA
   con Accetta/Rifiuta. Impatto alto sulla parte "si ragiona come in HoI4", fatica M.
   File: `HudScene.ts` (`renderProfile`, nuovo `renderPowers`), RunState (`proposePeace`, `proposeAlliance`: funzione che prevede l'esito
   senza eseguire), `src/data/` per i testi.
6. **Costo visibile sulle carte dei reparti + quick stats al passaggio del mouse** (Clash Royale, Call of War 2.0). Impatto medio-alto,
   fatica P.
   File: `src/ui/UnitCard.ts` (`refresh`, nuovo testo del costo), `HudScene.ts` (`update` passa il costo, `onCard`).
7. **Effetti scritti sotto le scelte degli eventi** (HoI4). Impatto medio-alto, fatica P.
   File: `src/ui/EventCard.ts`, `src/game/events.ts` (testo dell'effetto dalla scelta), `src/data/events.json`.
8. **Scheda della selezione a tre fasce fisse con l'azione principale piena** e ordine diretto su provincia nemica (Call of War 2.0);
   edifici nella scheda della tua provincia **da confermare con Nico**. Impatto medio-alto, fatica M.
   File: `HudScene.ts` (`renderProvince`, `provCardKey`), `RunScene.ts` (ordine diretto, scelta della pedina adatta).
9. **Colonna "Reparti / Assalti / Cantieri" a destra comprimibile** al posto della barra dei gruppi (outliner HoI4, elenco armate
   Call of War). Impatto medio, fatica M–G.
   File: `HudScene.ts` (`drawGroupBar` → `drawOutliner`, `hitUi`), `RunScene.ts` (`groupList`, `selectGroup`).
10. **Schermata finale con grafico delle province nel tempo e statistiche** (Call of War 2.0, Civilization). Rende la partita un
    racconto e spinge alla rivincita. Impatto medio, fatica M.
    File: `src/scenes/ResultScene.ts`, RunState (campionare province per fazione ogni 10 s in `summary`).

Subito dopo i dieci: modalità della carta come tre icone in basso a destra (EU4/HoI4) al posto della tendina MAPPA (P, `HudScene.ts`
`toggleMenu`/`setMapMode`); albero della ricerca a schede per ramo con colonne per livello del Laboratorio (M, `src/scenes/TreeScene.ts`);
coda "In corso" dell'HQ ordinata per fine con "libero" in ambra (P, `CampScene.ts` `drawOps`, `update`); stima del bottino accanto a
durata e puntata nella Sala Operazioni (P, `CampScene.ts` `fillPrep`).

### Conteggio delle scelte a schermo dopo il rifacimento (campagna, orizzontale)
Sempre visibili: carte (fino a 6) in basso a sinistra, blocco del tempo (pausa + velocità) e modalità della carta in basso a destra.
Le icone d'allarme compaiono solo quando c'è qualcosa da fare (di solito 0–2). Barra in alto, registro ed elenco sono informazioni che
si aprono a richiesta. Rispetto a oggi spariscono dalla vista: clessidra, audio, RITIRATA, MAPPA (diventa icone), barra dei gruppi.
Il centro della mappa resta libero: niente più cartello della pausa al centro, la scheda diplomatica si aggancia a sinistra.

---

## 5. Fonti

- Call of War, guida community all'interfaccia: https://www.playsupremacy.com/en/forums/call-of-war-1942/call-of-war-1942-community-guides-videos/2-game-interface-and-the-chat-f99c9705
- Call of War, guida province ed edifici: https://www.playsupremacy.com/en/forums/call-of-war-1942/call-of-war-1942-community-guides-videos/7-provinces-and-buildings-946921a0
- Call of War 2.0, note di rilascio (barre unificate, elenco armate, statistiche di fine partita): https://bytro.helpshift.com/hc/en/4-call-of-war/faq/233
- Call of War, note agosto 2022 (barra in alto, elenchi, negozio): https://bytro.helpshift.com/hc/en/4-call-of-war/faq/240
- Call of War, note 2020 (barra delle armate spostata in basso sul telefono): https://www.playsupremacy.com/en/forums/call-of-war-1942/call-of-war-1942-news/release-notes-2020-10-20-0e059955
- Call of War, note 16 settembre 2025 (barra in alto del PC uguale al telefono): https://playsupremacy.com/en/news/call-of-war-1942/cow-release-notes-20250916
- Call of War, note 19 agosto 2025: https://www.playsupremacy.com/en/news/call-of-war-1942/cow-release-notes-20250819
- Hearts of Iron IV, guida all'interfaccia (GamePressure): https://www.gamepressure.com/heartsofiron4/interface/z78eb8
- Paradox, diario di sviluppo 2009 sull'outliner: https://forum.paradoxplaza.com/forum/threads/development-diary-29-20th-of-may-2009.405217/
- Victoria 3, Dev Diary #29 "User Experience": https://forum.paradoxplaza.com/forum/developer-diary/victoria-3-dev-diary-29-user-experience.1506484/page-5
- Victoria 3, Dev Diary #74 "UX Improvements": https://www.paradoxinteractive.com/games/victoria-3/news/dev-diary-74-ux-improvements
- Stellaris, discussione su pausa e popup degli eventi: https://steamcommunity.com/app/281990/discussions/0/3280321473017054130
- XCOM 2, wiki dell'Avenger: https://xcom2.wiki.fextralife.com/Avenger
- OpenFront (codice locale): `riferimenti/OpenFrontIO/src/client/hud/layers/` — `EventsDisplay.ts`, `ActionableEvents.ts`,
  `AttacksDisplay.ts`, `ControlPanel.ts`, `GameLeftSidebar.ts`, `PlayerPanel.ts`, `AlertFrame.ts`
- Non leggibili in automatico (bloccati): hoi4.paradoxwikis.com, eu4.paradoxwikis.com, gameuidatabase.com. Le voci segnate
  **[diretta]** vanno controllate su screenshot prima di copiarle.
