# Aggiornamento di qualità di vita

Dalla prova della Sandbox di Nico (25 novembre 2026): «è molto divertente, servono modifiche semplici».
Due aree: come funziona il gioco (truppe, bot, velocità) e l'ottimizzazione (risorse, strutture, mappe).
Ogni punto ha uno stato: ☐ da fare · ◐ in corso · ☑ fatto.

## A. Come funziona il gioco

### Bot e mondo
- ☑ **Bot alla OpenFront**: pochi imperi forti e tanti bot deboli. All'inizio i deboli prendono un po' di terra; i forti li mangiano piano piano. Poco dopo l'inizio non c'è quasi più terra libera.

### Truppe: schierare
- ☑ **Schieramento multiplo**: tocchi la carta del reparto, compare «Click where to deploy». Ogni clic su una tua città ne schiera uno, finché hai truppe; ESC o clic destro per finire.
- ☑ **Città evidenziate** mentre schieri: si vede dove puoi mettere i reparti.
- ☑ **Costo e scheda sulla carta**: barre come in Call of War (vita, attacco, velocità), chi batte e chi teme, cosa costa (truppe + la sua risorsa).

### Truppe: muovere
- ☑ **Corridoi visibili**: zoomando si vede il percorso di ogni reparto in marcia, fino alla meta.
- ☑ **Movimento fluido**: niente più scatti in avanti; il reparto scivola da una casella all'altra.
- ☑ **Velocità ripensate**: ricognitori veloci, fanteria media, artiglieria lenta, corazzati veloci in pianura; tutte leggibili sulla carta.
- ☑ **Avanzata che segue la freccia**: i reparti seguono il tracciato disegnato e non si fermano o confondono a metà.

### Truppe: linee e gruppi
- ☑ **Linee colorate**: disegni una linea da A a B (un tratto solo, niente tappe), le assegni i reparti; la linea ha un colore e i suoi reparti prendono quel colore e diventano il suo gruppo.
- ☑ **Più linee** sul tuo territorio, ognuna col suo colore, che si sostengono.
- ☑ **Un reparto mandato su una linea** entra nel suo gruppo.
- ☑ **Attacca nazione**: col gruppo selezionato le altre nazioni si evidenziano; clic su una e il gruppo la attacca lungo tutto il confine, finché non è distrutta. Niente micromanagement sulle piccole.

### Chiarezza a ogni clic
- ☑ **Barra delle istruzioni**: dice sempre cosa puoi fare adesso («Click where to deploy», «Click a nation to attack», «Drag the line»), con ESC per annullare.

## B. Risorse, strutture e mappe

### Strutture
- ☑ **Costi ed effetti ripensati**: oggi un deposito di rifornimenti copre un'area enorme e una fortificazione un quadratino, allo stesso prezzo. Ogni struttura deve valere quello che costa.
- ☑ **Livelli** per le fabbriche (e le altre che ha senso migliorare).
- ☑ **Costruire città**: una struttura che trasforma una provincia in città (produce di più, arruola reparti).
- ☑ **Modalità costruzione chiara**: resta aperta mentre costruisci, mostra costo ed effetto prima di costruire; icone migliori e della stessa misura sullo schermo a ogni zoom.

### Risorse
- ☑ **Ecosistema di risorse**: ogni reparto costa truppe più la sua risorsa (es. fanteria cibo, artiglieria metallo, corazzati benzina) e il sasso-carta-forbice si intreccia con le risorse, così devi bilanciare economia ed esercito.
- ☑ **Costi sempre visibili** prima di schierare o costruire.

### Mappe
- ☑ **Mappa costruzioni** che mostra dove puoi costruire e cosa c'è già.
- ☑ **Mappa terreno** leggibile: colori del terreno e difesa.
- ☑ **Mappa logistica** con il rifornimento a sfumatura e il raggio dei depositi.
- ☑ **Zoom in più**: al massimo zoom ancora un livello, con una mappa sotto più dettagliata.

## Come è stato fatto (25 novembre 2026)
- Bot: 150 milizie (erano 56) che si allargano 3 province alla volta fino a 18 passi da casa; imperi e milizie pagano poco la terra
  libera (×0,2 e ×0,5); gli imperi assorbono i vicini più deboli da 2 minuti (rapporto 1,5). Sim (`scripts/world-sim.ts`): attorno
  alla partenza terra libera 62% a 1 min, 25% a 2 min, 10% a 3 min; a 20 min un impero ha 1.300 province e le milizie sono 102.
- Bug: le pedine delle milizie inseguivano i tuoi reparti fermi nella tua capitale e la assediavano durante la tregua (eliminato
  in 40 s). Ora inseguono solo chi entra nella loro terra; assediare una capitale costa il triplo.
- Prestazioni: logistica ricalcolata ogni mezzo secondo e non a ogni conquista, depositi raccolti in una passata, scontri tra
  pedine solo tra vicine: 2 ms per tick invece di 18.
- Movimento: la pedina scivola seguendo il passo vero del motore (niente tween); offensiva che riparte subito dopo un assedio.
- Corazzati: ×0,75 in pianura, ×1,5 in montagna. Artiglieria più lenta (720 ms a casella).
- Scheda del reparto al passaggio sulla carta: barre di vita, attacco, velocità e gittata, chi batte, chi teme, costo.
- Deposito: rifornimento pieno 2 province attorno (prima come la capitale). Fortificazione: ×1,7 qui e ×1,25 nelle tue province
  accanto. Fabbrica a 3 livelli (×3 / ×4,5 / ×6, prezzo ×1,8 a livello): si migliora costruendola di nuovo sulla stessa
  provincia. Città: 160 truppe + 30 metallo, la provincia diventa città e il posto si libera.
- COSTRUISCI resta aperto (ESC o clic destro per finire) e accende le province dove si può costruire.
- Mappa terreno a colori (pianura verde, colline oliva, montagne grigie, deserto sabbia) con difesa, marcia e risorsa in legenda.
- Strato a esagoni tolto (Nico).
- Strade tra le città tolte (non chieste). Al loro posto, alla Call of War: ogni provincia ha un centro e i reparti marciano da
  centro a centro lungo i collegamenti tra province vicine (`RunState.landPath`); la provincia si prende arrivando al centro.
  Allo zoom massimo (da 30, `camera.linksZoom`) si vedono centri e collegamenti, a puntini.
- Zoom massimo 66 (era 22): livelli di puntini più fitti da 15 (×4,5) e da 33 (×9), stesse forme.
- Regola di Nico: sulla carta si disegna DENTRO la griglia di puntini (`src/render/GridPen.ts` accende le celle del livello in
  vista, sotto la trama delle fessure). Così: collegamenti tra centri, percorsi dei reparti, linee del rifornimento, icone delle
  costruzioni (icone campionate a 9 × 9 celle, `src/ui/dotIcons.ts`, anche nel menu COSTRUISCI). Restano vettoriali, apposta,
  la linea d'attacco coi denti e la freccia fluida dell'offensiva (Nico: "spaccano, si distinguono"). Scritte che compaiono:
  come prima. Riquadro dell'assalto e costruzioni più piccoli da lontano.
- Sandbox: niente provincia tua finché non scegli, scritta grande "Choose your starting province", reparti al centro della
  provincia. Opzioni nuove a sinistra: potenza, reparti, livello delle truppe, dottrina, velocità.
- Caricamento: tolti i frammenti di dati sparsi. Comunicazioni in una chat COMMS apribile in alto a destra (le notizie dal mondo
  solo lì). Suggerimenti in un riquadro con titolo, spiegazione e tasto che fa la cosa. Nomi degli imperi sul loro pezzo di
  territorio più grande. Imperi più compatti (`ai.compact`: preferiscono chiudere i buchi e restare vicino alla capitale).
- Mappe terreno e logistica: il tuo territorio pieno col tuo confine, le costruzioni sempre visibili, linee tratteggiate dalla
  capitale ai depositi e da ogni reparto alla sua fonte di rifornimento (nel colore del rifornimento).

## Scelte prese per non fermarsi (si cambiano se Nico non è d'accordo)
- Linee: fino a 6, colori fissi (azzurro, verde, giallo pallido, viola, rosa, bianco), niente arancio.
- Attacca nazione: vale per imperi e milizie; il gruppo torna a tenere la sua linea quando la nazione è caduta.
- Prima si fa la parte A (gioco), poi la B (strutture, risorse, mappe).

## Più avanti (Nico, 25 novembre 2026)
- ☐ **Suoni d'ambiente** migliori.
- ☐ **Immagini AI** migliori.
- ☐ **Soddisfazione**: più gusto in ogni azione (conquiste, schieramenti, vittorie).
