# Archeon — economia, progressione e monetizzazione

*23 novembre 2026. Analisi e proposta di numeri. Nessun file in `src/` è stato toccato: le proposte vanno applicate a mano in
`src/config/balance.ts` e `src/config/premium.ts` (più qualche piccola modifica di codice, segnata come tale).*

**Legenda delle fonti dei numeri**
- **[MISURATO-SIM]**: uscito dal simulatore senza grafica (`docs/econ/simecon.ts`, stesso giocatore di `scripts/sim.ts`, 1 tocco/s, pedine, avanzate, costruzioni, diplomazia). 37 campagne in tutto, 3–6 per gruppo: **campioni piccoli, valori indicativi**.
- **[CODICE]**: letto da `balance.ts`, `premium.ts`, `camp.ts`, `tech.ts`, `RunState.summary()`, `progress.ts`.
- **[MODELLO]**: calcolato con `docs/econ/journey.mjs`, un modello del percorso del giocatore (sessioni fisse, spesa avida, 1 cantiere + 1 laboratorio, capienza del Deposito, probabilità di vittoria tarata sulla sim).
- **[BENCHMARK]**: dati di settore da fonti esterne (elenco in fondo). Sono medie di mercato, non previsioni per Archeon.
- **[IPOTESI]**: scelta mia, da validare con i tester.

File di lavoro: `docs/econ/simecon.ts` (sim), `docs/econ/run-batch.sh` (lancia 12 gruppi in parallelo), `docs/econ/out/*.jsonl` (risultati grezzi),
`docs/econ/analyze.mjs` (tabelle), `docs/econ/costs.ts` (somme di costi e tempi), `docs/econ/journey.mjs` (percorso giorno per giorno; `K=2 node docs/econ/journey.mjs proposed 2`).

---

## 0. In una pagina

1. **Tutto il contenuto dell'HQ costa 13.355 risorse e 3,9 ore di timer** [CODICE]. Una campagna standard vinta al Fronte I porta a casa
   ~2.350 risorse senza puntata, ~4.750 con la puntata massima [MISURATO-SIM]. **Ogni singolo livello costa meno di mezza campagna.**
   Nel modello un giocatore con 2 campagne al giorno ha il Centro di Comando al massimo **la sera del giorno 1** (dopo 4 campagne) e
   tutto al massimo al **giorno 7** [MODELLO]. Dopo non resta niente da comprare: il Deposito trabocca (1,5 milioni di risorse perse nel modello a 60 giorni).
2. **I timer non creano un motivo per tornare**: il più lungo è 30 minuti, più corto di una campagna. Quindi il Lume per finire i timer vale
   quasi nulla: finire *tutti* i 57 timer del gioco costa ~285 Lume (minimo 5 a timer), cioè **3–6 €**.
3. **La puntata non è una scommessa: conviene sempre la massima.** Con le regole di oggi il guadagno atteso della puntata 450 è
   positivo anche se vinci 1 volta su 5 (+1.700 risorse). Nessun rischio, quindi nessuna tensione "da poker".
4. **La campagna breve è un'opzione morta** (41 risorse/minuto contro 92 della standard) e **la lunga si vince meno** (0 vittorie su 3 al Fronte I) [MISURATO-SIM].
5. **I Fronti V e VI non si vincono nemmeno con l'HQ al massimo** (0 su 6 nella sim) mentre l'indicatore "potenza consigliata" dice il
   contrario (110 e 150, raggiungibili). Il muro vero è al Fronte II–III senza potenziamenti e al V con tutto.
6. **Proposta**: costi ×~40 con crescita geometrica (×2,5–5 a livello), timer da 1 minuto a 24 ore (crescita ×3–4 come Clash), Deposito
   che sale con loro, fronti che rendono meno in progressione (×1→×2,5 invece di ×3,5), puntata con pareggio al 40% di vittorie,
   rendita e ordini del giorno accesi. Risultato del modello: **2 campagne al giorno → Comando 5 al giorno 12, Fronte VI al 13, tutto al massimo al giorno 28–31**;
   1 campagna al giorno → giorno ~60; 4 al giorno → giorno ~21 (limitato dai timer, dove il Lume ha senso).
7. **Soldi**: con il catalogo di oggi il tetto di spesa di un giocatore è ~10 €. Con i timer proposti finire tutto vale ~1.340 Lume (15–27 €),
   più pacchetti e oggetti estetici: tetto ~40–60 €, simile al modello "onesto" di Polytopia (tetto ~35 $). Scenario centrale a 10.000 giocatori
   attivi al mese: **~1.700–1.800 € netti al mese**; a 1.000 giocatori ~170 €; a 100.000 ~17.000 € [IPOTESI su benchmark].

---

## 1. Stato attuale

### 1.1 Fonti di risorse

| Fonte | Come funziona | Quanto rende | Origine |
|---|---|---|---|
| **Campagna** (bottino nello zaino) | Ogni provincia produce ogni minuto (terreno × ricchezza × rifornimento; fabbrica ×2), premio alla provincia completata, tributi, saccheggi; la scorta di guerra iniziale (40/30/40) non conta | Fronte I, 20 min: **1.834 grezze** in media (1.283–2.123) | [MISURATO-SIM] |
| Moltiplicatori di fine campagna | durata (×0,7 / ×1 / ×1,4) × fronte (×1 → ×3,5) × esito (vittoria ×1,5, fine tempo ×1, ritirata ×0,75, eliminato ×0,3 con Deposito 0) | vedi 1.3 | [CODICE] `RunState.summary` |
| **Puntata** | 0/60/180/450 dal Deposito; il guadagno oltre la puntata ×1,25/×1,6/×2 | +600/+1.430/+2.400 a campagna (F1, 20 min) | [MISURATO-SIM] + formula |
| **Spedizioni** | breve 30 min gratis, media 4 h (15 cibo), lunga 8 h (30 cibo) | ~35 / ~170 / ~330 risorse | [CODICE] |
| Bottino delle rovine, lavoratori | dentro la campagna (già incluso sopra) | — | [CODICE] |
| **Lume → risorse** | 300 di ogni risorsa per 30 Lume, anche oltre la capienza | 900 risorse = 0,34–0,60 € | [CODICE] `premium.ts` |
| Rendita, ordini del giorno, stelle, medaglie | **spenti** (`features.*: false`) | 0 | [CODICE] |

**Bottino dentro la campagna minuto per minuto** (Fronte I, media di 6 campagne da 20 min, grezzo) [MISURATO-SIM]:

| minuto | 2 | 4 | 6 | 8 | 10 | 12 | 14 | 16 | 18 | 19 |
|---|---|---|---|---|---|---|---|---|---|---|
| risorse | 47 | 189 | 325 | 474 | 716 | 890 | 1.096 | 1.314 | 1.619 | 1.619+ |

La curva accelera (convessa): i primi 5 minuti rendono ~50/min, gli ultimi 5 ~110/min. Bene per "restare fino alla fine", male per la campagna breve.

### 1.2 Bottino per fronte, livello e durata [MISURATO-SIM]

"liv 0" = nessun potenziamento, solo fanteria; "liv 1" = HQ a metà (Addestramento, ricognitori, artiglieria, corazzati, +15% vita/attacco, ecc.);
"liv 2" = HQ quasi al massimo (definiti in `scripts/sim.ts`). "A casa" = formula del gioco senza puntata, media sugli esiti.

| Fronte | HQ | Durata | Vittorie | Grezzo medio (min–max) | Metallo/Benzina/Cibo | Province max | A casa (senza puntata) |
|---|---|---|---|---|---|---|---|
| I | 0 | 10 min | 2/4 | 593 (388–852) | 51/20/29% | 210 | **546** |
| I | 0 | 20 min | 3/6 | 1.834 (1.283–2.123) | 43/26/31% | 296 | **2.350** |
| I | 0 | 30 min | **0/3** | 2.325 (1.673–3.017) | 42/30/28% | 235 | **3.255** |
| II | 0 | 20 | 0/3 | 1.315 | 52/25/23% | 223 | 1.710 |
| II | 1 | 20 | 2/3 | 2.581 | 58/22/20% | 951 | 4.513 |
| III | 0 | 20 | 0/3 (1 eliminato a 3:11) | 656 | 64/19/17% | 103 | 1.095 |
| III | 1 | 20 | 2/3 | 2.374 | 40/22/39% | 544 | 5.678 |
| IV | 1 | 20 | 0/3 | 1.911 | 56/21/24% | 388 | 4.203 |
| IV | 2 | 20 | 3/3 | 3.647 | 43/4/53% | 810 | 12.035 |
| V | 2 | 20 | **0/3** | 2.174 | 50/16/34% | 358 | 6.087 |
| VI | 2 | 20 | **0/3** (1 eliminato a 5:09) | 1.622 | 56/8/36% | 286 | 5.467 |

Il primo impero (15 province) arriva tra 0:26 e 1:15 in tutti i gruppi (il dato vecchio di CLAUDE.md, 2:30–4:40, è superato).
Variabilità: il grezzo al Fronte I standard ha un coefficiente di variazione di **0,17** (basso); "a casa" includendo vittoria/sconfitta **0,36**.

### 1.3 Uscite di risorse (pozzi) [CODICE]

| Pozzo | Totale | Tempo | Note |
|---|---|---|---|
| Centro di Comando 5 livelli | 2.015 | 39 min | 45 → 150 → 340 → 600 → 880 (crescita ×3,3 → ×1,47) |
| Arsenale 6 livelli | 3.130 | 69 min | 50 → 160 → 340 → 580 → 840 → 1.160 (×3,2 → ×1,38) |
| Deposito 3 livelli | 710 | 11 min | 70 → 200 → 440 |
| Laboratorio 3 livelli | 880 | 11 min | 110 → 270 → 500 |
| Sala Radar 3 livelli | 530 | 9 min | 60 → 160 → 310 |
| **Postazioni** | **7.265** | **2,3 h** | timer più lungo 30 min |
| **Ricerche (26)** | **6.090** | **1,6 h** | 40–580 l'una, 45 s – 6 min |
| **TOTALE** | **13.355** (metallo 7.970 = 60%, benzina 3.350 = 25%, cibo 2.035 = 15%) | **3,9 h** | |
| Puntata persa | 25% della puntata a fine tempo senza vittoria | | max 112 risorse |
| Reparti in campagna | resCost 4–10 dallo zaino + mantenimento | già netto nel grezzo | |
| Mercato | scambio 50→30; rifornimenti 70–80 a campagna; finire subito 8 metallo/min | | |
| Spedizioni | 0/15/30 cibo | | |

**Tre squilibri strutturali**
- **I costi crescono più piano delle entrate.** I costi a livello passano da ×3,3 a ×1,4; le entrate crescono ×3,5 coi fronti (più ×1,5 della vittoria e ×2 della puntata).
  In Clash il rapporto si inverte: il costo cresce più del bottino disponibile, così il tempo per livello sale.
- **Mix sbagliato**: i costi sono 60% metallo, 15% cibo; il bottino è ~48% metallo, ~30% cibo. Il cibo si accumula, il metallo è il collo di bottiglia.
- **Capienza**: Deposito 0 = 500 per risorsa. Una vittoria al Fronte I con puntata 450 porta ~4.750 risorse, ~2.300 di metallo: **si perdono ~1.800 risorse
  se non hai speso prima**. Ma il Deposito 1 costa 70: il muro sparisce in un minuto. La capienza non fa nessun lavoro di design.

### 1.4 Timer

| | Attuale | Effetto |
|---|---|---|
| Timer più lungo | 30 min (Arsenale 6) | più corto di una campagna standard: finisce sempre mentre giochi |
| Somma postazioni | 2,3 h | |
| Somma ricerche | 1,6 h | |
| Cantieri / laboratori | 1 + 1 in parallelo | |
| Finire subito col metallo | 8 metallo/min: 30 min = 240 metallo (~10% di una campagna) | rende inutile il Lume |
| Finire subito col Lume | 1 Lume/10 min, minimo 5 | ogni timer del gioco costa 5 Lume (0,06–0,10 €) |

Regola di design rispettata: i timer non bloccano mai le campagne. Ma **non creano nemmeno un appuntamento**: non c'è niente che "matura stanotte".

### 1.5 Tabella di progressione attuale (giocatore con 2 campagne/giorno) [MODELLO, regole di oggi]

| Momento | Cosa ha | Campagne giocate | Ore di gioco |
|---|---|---|---|
| Giorno 1, 18:01 | Comando 1 (la run guidata lo paga sempre) | 0 | 0,1 |
| Giorno 1, 18:43 | Fronte II sbloccato | 1 | 0,4 |
| Giorno 1, 19:52 | **Comando 5 (massimo)** | 4 | 1,5 |
| Giorno 2–3 | Fronti III e IV | 8–10 | 3–3,5 |
| Giorno 4 | Arsenale 6 | 12 | 4 |
| Giorno 7 | **tutte le ricerche, potenza 183/183** | 28 | 10 |
| Dopo | niente da comprare; Fronte V+ non si vince | — | — |

Quante campagne servono per ogni passo, al Fronte I (2.350 a campagna senza puntata):

| Passo | Costo | Tempo | Campagne F1 |
|---|---|---|---|
| Comando 1 → 5 | 2.015 | 39 min | 0,9 |
| Arsenale 1 → 6 | 3.130 | 69 min | 1,3 |
| Deposito + Laboratorio + Radar | 2.120 | 31 min | 0,9 |
| 26 ricerche | 6.090 | 95 min | 2,6 |
| **Tutto** | **13.355** | **3,9 h** | **5,7** (≈ 2,9 con la puntata massima) |

### 1.6 Zone morte, muri e numeri che non tornano

| # | Problema | Dato | Gravità |
|---|---|---|---|
| 1 | Contenuto finito in ~6 campagne | 13.355 di costi contro ~2.350–4.750 a campagna | **critico** per D7/D30 |
| 2 | Timer senza appuntamento | max 30 min, totale 3,9 h | **critico** per ritorno e Lume |
| 3 | Puntata sempre conveniente | EV della puntata 450 > 0 anche con il 20% di vittorie (tabella 5.2) | alto |
| 4 | In vittoria anche la puntata prende il +50% | `kept = (min(b,S)·stakeK + …)·k`, k = 1,5 | medio (bug di design) |
| 5 | Puntate fisse 60/180/450 | al Fronte IV si portano a casa ~12.000: 450 è irrilevante | medio |
| 6 | Breve inutile | 593 × 0,7 = 415 in 10 min (41/min) contro 2.350 in 20 min | alto per mobile |
| 7 | Lunga si vince meno | 0/3 vittorie al Fronte I in 30 min (coalizione e imperi che crescono) | medio |
| 8 | Spedizioni irrilevanti | lunga 8 h = 330 risorse = 14% di una campagna; non scalano col fronte | alto (zero motivo di tornare) |
| 9 | Fronti V–VI imbattibili | 0/6 con HQ al massimo nella sim; indicatore dice 110/150 | alto (muro infinito, "potenza consigliata" falsa) |
| 10 | Fronte II senza potenziamenti già 0/3 | il muro arriva alla 2ª campagna | medio: va bene se i primi potenziamenti arrivano subito |
| 11 | Metallo collo di bottiglia, cibo in eccesso | costi 60/25/15 contro bottino ~48/22/30 | medio |
| 12 | Capienza senza ruolo | Deposito 1 a 70 risorse | basso |
| 13 | Pacchetto di risorse = tutto il gioco per < 10 € | 13.355 / 900 × 30 Lume = 445 Lume | alto (pay-to-skip: chi paga finisce il gioco) |
| 14 | Finire subito col metallo più conveniente del Lume | 240 metallo per 30 min | medio |

*Limite della sim*: il giocatore simulato è più debole di un umano bravo (compra solo il vuoto e le milizie, non usa abilità, non pianifica). I tassi di
vittoria reali saranno più alti, soprattutto ai fronti alti. Ma l'ordine di grandezza dei bottini e dei costi non cambia.

---

## 2. Curve obiettivo dai giochi che funzionano

### 2.1 Benchmark di retention e sessione [BENCHMARK]

| Metrica | Mediana mobile | Top 25% | Top 10% | Mid-core/RPG | Fonte |
|---|---|---|---|---|---|
| D1 | ~25–30% | ~30% | 40% | 44–45% | GameAnalytics 2026; AppAgent; Sensor Tower via AppAgent |
| D7 | ~4% | 6–7% | 11–12% | 20–21% | idem |
| D30 | 0,7–0,8% | 1,6–1,8% | — | 11–12% | idem |
| Durata sessione mobile | — | 5,2 min | 8 min | — | GameAnalytics 2026 |
| Sessioni al giorno mobile | — | 5,3–5,7 | ~9,6 | — | idem |
| Durata sessione PC | 18 min | > 30 min | — | — | idem |
| Sessioni al giorno PC | 1,65–1,7 | — | ~3 | — | idem |

Fasce di lavoro di AppAgent per giochi con marketing: D1 buono 35–40%, D7 18–22%, D30 8–10%.

**Lettura per Archeon**: una campagna da 20 minuti è una sessione da **PC/web** (mediana 18 min, 1,7 sessioni al giorno), non da telefono (5 min, 5 sessioni).
Sul telefono serve una campagna da 10 minuti che valga la pena (oggi no) e una visita breve all'HQ (rendita, spedizioni, timer) senza campagna.

**Obiettivi proposti** [IPOTESI]: D1 35%, D7 15% (CLAUDE.md chiede > 20% su 20 tester: realistico solo con amici), D30 5%.
Giornata tipo: 2 sessioni con campagna (20–25 min) + 1–2 visite brevi (1–2 min) all'HQ.

### 2.2 Ritmo di progressione

| Elemento | Riferimento | Obiettivo Archeon |
|---|---|---|
| Primo upgrade | Clash: i primi edifici costano pochi secondi o minuti; il primo acquisto arriva nei primi minuti | entro 1 min dalla run guidata (già così) |
| Upgrade nel giorno 1 | Clash/Clash Royale: 5–10 cose sbloccate il primo giorno | 6–8 (Comando 2–3, Arsenale 1, Deposito/Lab/Radar 1, 2–4 ricerche) |
| Crescita dei timer | Clash: da secondi a giorni; nelle fasi alte ×1,5–2 per livello. Analisi del 2014: costo in gemme lineare a tratti, 1 h = 20 gemme, 1 giorno = 260 gemme | ×3–4 per livello sui 5–6 livelli che abbiamo: 1 min → 24 h |
| Crescita dei costi | Clash: il costo cresce più del bottino disponibile; Supercell taglia spesso costi e tempi dei livelli vecchi | costo ×2,5–5 a livello, entrata ×1,25 per fronte |
| Fine del contenuto | Polytopia: niente timer, spesa massima ~35 $ | giocatore medio al massimo in ~30 giorni, poi endgame (fronti VII+, stagioni) |
| Varianza del premio | Clash Royale: forzieri a rarità variabile; Call of War: eventi | 1 premio raro ogni ~10 campagne (×2 su una provincia o un convoglio) |
| Agganci quotidiani | Clash: miniere che si riempiono, scudi; Clash Royale: forzieri a tempo, vittorie quotidiane | rendita del Comando (12 h), spedizione notturna, prima vittoria del giorno, 3 ordini del giorno |

### 2.3 Polytopia, Call of War, Territorial/OpenFront in breve [BENCHMARK]
- **Polytopia**: gratis su mobile, niente pubblicità, si pagano solo le tribù (0,99–3,99 $), tetto di spesa ~35 $. 20 milioni di download organici,
  600–700 mila giocatori al mese; stima terza ~70 mila $/mese. Il fondatore sostiene che la monetizzazione aggressiva fa scappare i giocatori fedeli.
- **Call of War**: oro come moneta premium, accusato di pay-to-win (una raccolta di recensioni riporta il 70% di menzioni negative); partite solo-oro.
  Lezione: nel multigiocatore pagare per vincere costa reputazione. In single player il problema è diverso (vedi 4.4).
- **Territorial.io / OpenFront**: partite brevi nel browser, ~2 milioni di visite al mese (Territorial), sessione media del sito ~23 min (OpenFront, stima
  Semrush); si mantengono con la pubblicità. Lezione: la partita breve da browser trattiene, ma monetizza poco.

---

## 3. Numeri proposti

### 3.1 Principio
- **Entrate**: restano grandi (i numeri grossi dopo la campagna fanno piacere), ma crescono più piano coi fronti.
- **Costi**: ×~40 sul totale, crescita geometrica. Ogni livello alto deve costare **3–6 campagne** al fronte in cui sei.
- **Timer**: brevi all'inizio (finiscono mentre giochi la campagna), poi 2–24 h (finiscono "stanotte"). È lì che il Lume ha valore.
- **Deposito**: capienza che sale con i costi, così il Deposito è un prerequisito vero (come il deposito di Clash per il municipio).
- **Puntata**: una scommessa vera, con pareggio quando vinci 2 volte su 5.

### 3.2 Tabella delle chiavi (`balance.ts` / `premium.ts`)

| Chiave | Attuale | Proposta | Perché |
|---|---|---|---|
| `camp.buildings.comando` (totale costo · tempo) | 45·1m, 150·3m, 340·5m, 600·10m, 880·20m | **45·1m, 800·15m, 4.000·2h, 12.000·8h, 30.000·24h** | Comando 5 al giorno ~12 con 2 campagne/giorno |
| `camp.buildings.arsenale` | 50·1m … 1.160·30m | **50·1m, 600·10m, 3.000·1h, 10.000·4h, 26.000·12h, 60.000·24h** | l'Arsenale è la potenza principale (8 punti/livello) |
| `camp.buildings.deposito` | 70·1,5m, 200·4m, 440·5m | **70·2m, 2.400·1h, 14.000·8h** | prerequisito della capienza per Comando 5 e Arsenale 6 |
| `camp.buildings.laboratorio` | 110·1,5m, 270·4m, 500·5m | **110·2m, 3.000·1h, 18.000·12h** | apre i gradi 2 e 3 delle ricerche |
| `camp.buildings.radar` | 60·1m, 160·3m, 310·5m | **60·1m, 1.600·45m, 9.000·6h** | |
| (mix di ogni livello) | | stesso rapporto metallo/benzina/cibo di oggi (valori esatti sotto) | |
| `camp.depositoCap` | 500, 1.000, 2.000, 4.000 | **3.000, 10.000, 24.000, 60.000** | Comando 5 vuole 16.364 metallo → Deposito 2; Arsenale 6 vuole 36.207 → Deposito 3 |
| `tech.*.cost` | 40–580 | **× grado**: Lab grado 1 ×8, grado 2 ×30, grado 3 ×80; Armamenti per livello di Arsenale 1→6: ×8, ×16, ×30, ×50, ×80, ×110 | totale ricerche 377.180 |
| `tech.*.timeSec` | 45 s – 6 min | **× grado**: Lab 1 ×15, 2 ×45, 3 ×96; Armamenti 1→6: ×20, ×20, ×48, ×72, ×120, ×160 | 15 min → 16 h; totale 118 h |
| `campaigns.breve.lootMult` | 0,7 | **1,5** | 593 × 1,5 / 10 min = 89/min ≈ standard (92/min): la breve diventa la modalità da telefono |
| `campaigns.lunga.lootMult` | 1,4 | **1,25** | 2.325 × 1,25 / 30 = 97/min: un po' di più per l'impegno, non di più per il rischio (si vince meno) |
| `fronts[].lootMult` | 1, 1,3, 1,7, 2,2, 2,8, 3,5 | **1, 1,25, 1,5, 1,8, 2,1, 2,5** | le entrate crescono più piano dei costi |
| `fronts[].power` | 0, 20, 45, 75, 110, 150 | **0, 30, 60, 100, 140, 170** | allineare l'indicatore a quello che serve davvero (sim) |
| `fronts[4..5].aiGrowthMult` | 2,44 / 2,54 | **~2,1 / ~2,25** (da verificare con `simecon.ts 4 2 20` e `5 2 20`) | oggi 0/6 vittorie con l'HQ al massimo |
| *nuovo* sblocco fronte | vittoria al fronte precedente | vittoria **e** Comando ≥ numero del fronte − 1 *(codice in `progress.ts`)* | evita Fronte VI al giorno 8 con Comando 4 |
| `stake.options` | 0, 60, 180, 450 | **0, 180, 450, 900 × fronte.lootMult × durata.lootMult** *(codice in `stakeOf`)* | la puntata resta significativa a ogni fronte |
| `stake.mult` | 1, 1,25, 1,6, 2 | **1, 1,1, 1,25, 1,5** | con le puntate sopra, pareggio al 40% di vittorie |
| `stake.lossShare` (fine tempo) | 0,25 | **1** (meno l'assicurazione del Deposito) | è una scommessa: se non vinci, la perdi |
| eliminato | puntata ×0,3 come lo zaino | **puntata persa tutta** (meno assicurazione) *(codice in `summary`)* | coerenza |
| vittoria | puntata ×1,5 | **puntata restituita ×1** (il +50% solo sul guadagno) *(codice in `summary`)* | oggi la vittoria moltiplica anche la puntata |
| *nuovo* `camp.depositoStakeInsurance` | — | **0, 0,1, 0,2, 0,3** | il Deposito protegge la puntata: pareggio dal 40% al 32% |
| `camp.expeditions` | breve 30m gratis 23–48 · media 4h 15 cibo 110–205 · lunga 8h 30 cibo 230–390 | **breve 30m gratis ~150 · media 4h 60 cibo ~600 · lunga 8h 120 cibo ~1.100**, tutto × fronte.lootMult *(codice in `startExpedition`)* | spedizione notturna = 1/3 di campagna: motivo per tornare la mattina; cibo come pozzo |
| `features.rendita` + *nuovo* `rendita.perHour` | spento | **acceso, 60/h × fronte.lootMult, tetto 12 h** | ~720–1.800 a visita: la visita breve sul telefono vale |
| `features.orders` | spento | **acceso**, 3 ordini al giorno da ~0,3 campagne l'uno | obiettivi giornalieri |
| *nuovo* `firstWinBonus` | — | **+50%** sul guadagno della prima vittoria del giorno | appuntamento quotidiano (alla Clash Royale) |
| *nuovo* `streakBonus` | — | **+10% per vittoria di fila, max +30%** | serie |
| `shop.rushPerMin` | 8 metallo/min, sempre | **8 metallo/min solo se mancano ≤ 60 min** *(codice in `rush`)* | il metallo finisce i timer corti, il Lume quelli lunghi |
| `shop.trade` | 50 → 30 | **50 → 35** | il cibo in eccesso si converte in metallo con meno perdita |
| `PREMIUM.resources` | 300 di ognuna per 30 Lume, senza limite | **500 × fronte.lootMult di ognuna per 40 Lume, 1 al giorno** | resta proporzionato e non salta tutto il gioco |
| `PREMIUM.rushMinPerLume` / `rushMin` | 10 / 5 | **invariati** | con timer fino a 24 h il prezzo diventa sensato (tabella 4.1) |
| `PREMIUM.rushMaxMinutes` | 480 | **1.440** | il timer più lungo diventa 24 h |
| `LUME_PACKS` | 100/1,99 · 330/4,99 · 875/9,99 | invariati + **benvenuto 1 volta: 150 Lume + oggetto estetico a 2,99 €** + **2.000 Lume a 19,99 €** come ancora | primo acquisto facile; un tetto chiaro |
| `PREMIUM.cosmetics` | vuoto | 6–10 oggetti da 60–150 Lume (insegne, colori della fazione, ritratto del comandante, cornici della base) | spesa che non tocca la difficoltà |

**Valori esatti proposti** (metallo/benzina/cibo, tempo), già con il mix di oggi:

| Postazione | L1 | L2 | L3 | L4 | L5 | L6 |
|---|---|---|---|---|---|---|
| Comando | 30/0/15 · 1m | 480/107/213 · 15m | 2.353/706/941 · 2h | 6.800/2.400/2.800 · 8h | 16.364/6.818/6.818 · 24h | — |
| Arsenale | 40/10/0 · 1m | 450/150/0 · 10m | 2.206/794/0 · 1h | 6.552/2.759/690 · 4h | 16.095/7.429/2.476 · 12h | 36.207/16.552/7.241 · 24h |
| Deposito | 50/0/20 · 2m | 1.680/0/720 · 1h | 8.273/1.909/3.818 · 8h | | | |
| Laboratorio | 60/30/20 · 2m | 1.667/778/556 · 1h | 10.080/4.320/3.600 · 12h | | | |
| Radar | 40/20/0 · 1m | 1.100/500/0 · 45m | 6.387/2.613/0 · 6h | | | |

Ricerche (totale costo · tempo): ricognitori 320·15m, artiglieria 1.280·30m, genio 3.900·1,6h, corazzati 5.100·2h, munizioni 5.400·2,4h,
cannoniera 12.000·4h, corazze 14.000·4,8h, ricognizione 22.400·8h, bombardamento 30.400·10h, unica 57.200·16h;
grado 1 (addestramento, strade, estrazione, trincee, segnale) 640–720·30–38m; grado 2 (élite, rifornimenti, industria, radar, frammenti) 5.400–6.000·3h;
grado 3 (assalto, ferrovie, pianificazione, fortezze, prototipo, caduta) 27.200–46.400·8–9,6h. Il dettaglio per risorsa:
`K=2 PRINT=1 node docs/econ/journey.mjs proposed 2`.

**Totale proposto**: postazioni 194.737 (104 h), ricerche 377.180 (118 h), **571.917 risorse, 222 h di timer** (oggi 13.355 e 3,9 h).
Rapporto di crescita: costi ×2,5–5 a livello, timer ×2–8 (×3–4 in media); entrate ×1,2 per fronte.

*Se Nico preferisce un gioco più corto*: `K=1` nel modello (costi a metà) → 2 campagne/giorno, tutto al massimo al giorno ~16.

### 3.3 Percorso atteso [MODELLO con la proposta, K = 2]

Ipotesi: giorno 1 = run guidata + 4 campagne dalle 18:00; poi campagne alle 8:00 e alle 20:00 e una visita alle 13:00; spesa avida (prima il Comando);
probabilità di vittoria 60% quando la potenza è pari a quella che serve, ±1,25 punti % per punto di potenza, tra 5% e 85%; puntata solo se vinci ≥ 50%.

| | 1 campagna/giorno | **2 campagne/giorno** (riferimento) | 4 campagne/giorno |
|---|---|---|---|
| Fine giorno 1 | Comando 2, Fronte II, 0 ricerche | **Comando 2, Fronte II, potenza 12** | Comando 2–3 |
| Giorno 3 | Comando 3, Fronte II | **Comando 4, Arsenale 3, 6 ricerche, Fronte IV** | Comando 4, Fronte IV |
| Giorno 7 | Comando 4, Arsenale 2, 4 ricerche, Fronte IV (potenza 66) | **Comando 4, Arsenale 4, 15 ricerche, Fronte V (potenza 128)** | Fronte V |
| Giorno 14 | Comando 4, 10 ricerche, Fronte V (109) | **Comando 5, 22 ricerche, Fronte VI (163)** | Comando 5, Fronte VI |
| Giorno 30 | Comando 5, 18 ricerche (143) | **tutto al massimo (183)** | al massimo dal giorno ~21 |
| Tutto al massimo | giorno ~60 | **giorno 28–31** | giorno ~21 (limitato dai timer) |
| Cosa limita | risorse | risorse fino al giorno ~14, poi timer | timer (qui si vende il Lume) |

Confronto con oggi (2 campagne/giorno): Comando 5 al giorno 1, tutto al giorno 7.

**Zona morta rimasta**: col riferimento, dal giorno ~14 al ~28 si sale solo con Arsenale 6 e le ultime 4 ricerche lunghe. Per D30+ serve contenuto nuovo,
non solo numeri: livelli 6–10 delle postazioni, Fronti VII+ ("L'Avvento" ripetibile con stelle), stagioni. Vedi sezione 5.4.

---

## 4. Monetizzazione

### 4.1 Valore del Lume [CODICE + calcolo]

| | Piccolo | Medio | Grande |
|---|---|---|---|
| Lume / prezzo | 100 / 1,99 € | 330 / 4,99 € | 875 / 9,99 € |
| € per Lume (lordo) | 0,0199 | 0,0151 | 0,0114 |
| 10 minuti di timer | 0,020 € | 0,015 € | 0,011 € |

| Timer | Lume | € (pacchetto piccolo → grande) | Clash (1 h = 20 gemme, 1 g = 260, ~5 $ per 500 gemme) |
|---|---|---|---|
| 30 min (oggi il più lungo) | 5 | 0,06–0,10 | ~0,10 $ |
| 2 h | 12 | 0,14–0,24 | ~0,40 $ |
| 8 h | 48 | 0,55–0,96 | ~1,10 $ |
| 24 h | 144 | 1,64–2,87 | ~2,60 $ |
| **tutti i timer di oggi** (57 × minimo 5) | 285 | **3,25–5,70** | |
| **tutti i timer proposti** (222 h) | ~1.340 | **15–27** | |

Il prezzo per minuto del Lume è già in linea con Clash (un po' più basso); il problema era solo la lunghezza dei timer.

**Pacchetto di risorse**: oggi 900 risorse per 30 Lume = 0,34–0,60 €; tutto il gioco (13.355) = 445 Lume = **5–9 €**. Chi paga 10 € finisce il gioco
il primo giorno e poi se ne va: è la forma peggiore di pay-to-win in single player (*pay-to-skip*). Con la proposta un pacchetto vale ~0,6 campagne,
uno al giorno: aiuta, non salta il gioco.

### 4.2 Commissioni [BENCHMARK + calcolo]
Ipotesi: prezzi IVA inclusa, IVA 22% (Italia; nel resto dell'UE 17–27% con OSS). Stripe: 1,5% + 0,25 € per carta UE standard (dal 2023; carte
business 1,9% + 0,25 €). Google Play: 15% sul primo milione di $ l'anno, calcolato sul prezzo senza IVA (Google versa l'IVA nell'UE).

| Pacchetto | Senza IVA | Netto web (Stripe) | % | Netto Google Play | % |
|---|---|---|---|---|---|
| 1,99 € | 1,63 | **1,35** | 68% | 1,39 | 70% |
| 2,99 € (benvenuto) | 2,45 | **2,16** | 72% | 2,08 | 70% |
| 4,99 € | 4,09 | **3,77** | 75% | 3,48 | 70% |
| 9,99 € | 8,19 | **7,79** | 78% | 6,96 | 70% |
| 19,99 € | 16,39 | **15,83** | 79% | 13,93 | 70% |

Sul web i 25 centesimi fissi pesano sul pacchetto piccolo: conviene spingere il medio (badge "più scelto"). Mix ipotizzato 50/30/20 (piccolo/medio/grande)
→ **netto web 75%**, **Play 70%**. Nota: nell'app Android oggi il Lume è spento perché Google Play impone il suo sistema di pagamento per i beni digitali.

### 4.3 Conversione e scenari [BENCHMARK + IPOTESI]
Dati di settore: strategia/4X/costruzione base ARPDAU 0,10–0,35 $ (fasce compilate da Juego Studio su dati AppsFlyer, GameAnalytics, Liftoff, Appodeal);
conversione a pagante ~1,5% per RPG e strategia (Segwise), fino al 2,5% giornaliero nei migliori giochi di strategia (GameAnalytics 2018–19);
ARPPU nei migliori giochi ~20 $, 27–31 $ per azione e RPG (stesso studio); meno del 5% dei giocatori mobile compra mai qualcosa (AppsFlyer).
I numeri alti vengono da 4X multigiocatore con "balene": un single player indie senza pubblicità sta molto sotto.

"Giocatori" = attivi al mese (MAU). Ricavo mensile = MAU × conversione mensile × ARPPU mensile × netto.

| Scenario | Conversione | ARPPU/mese | 1.000 MAU lordo → netto web / Play | 10.000 MAU | 100.000 MAU |
|---|---|---|---|---|---|
| **A — catalogo di oggi** (tetto ~10 €) | 1,0% | 5 € | 50 € → 37 / 35 € | 500 € → 375 / 349 € | 5.000 € → 3.745 / 3.485 € |
| **B — proposta** (timer lunghi, benvenuto, estetica) | 2,0% | 12 € | 240 € → 180 / 167 € | 2.400 € → **1.798 / 1.673 €** | 24.000 € → 17.976 / 16.728 € |
| **C — B + pass di stagione 4,99 €** | 3,5% | 18 € | 630 € → 472 / 439 € | 6.300 € → 4.719 / 4.391 € | 63.000 € → 47.187 / 43.911 € |

Controllo con l'ARPDAU: B a 10.000 MAU, DAU/MAU 15% [IPOTESI] → 1.500 al giorno → 0,053 € ARPDAU, sotto la fascia "strategia" (0,10–0,35 $), come ci si aspetta per un single player.
Costi: Supabase e Vercel gratis fino a decine di migliaia di utenti, poi ~45 €/mese (piani Pro); Google Play 25 $ una volta. Tasse sul reddito escluse.
**Valore per installazione** (B, nella vita del giocatore, 2,5% paganti × ~15 €): ~0,37 € lordi → con un costo per installazione di 1–3 € sulla pubblicità a pagamento
**non si rientra**: crescita organica (web, community, contenuti) o niente.

### 4.4 Cosa vendere, cosa no
- **Sì**: finire timer lunghi (≥ 1 h); pacchetto di benvenuto una volta; estetica (insegne, colori, ritratti, cornici della base, temi della carta);
  un pass di stagione con premi estetici e risorse moderate; un secondo cantiere permanente (come il "builder" di Clash, prezzo ~500 Lume una volta): vale tanto e non rompe la difficoltà.
- **Con limiti**: risorse (1 pacchetto al giorno, proporzionato al fronte); rifornimenti di campagna.
- **No**: Lume → puntata diretta (comprare risorse con soldi veri e puntarle su un esito casuale avvicina il gioco alle regole su azzardo e loot box in Belgio e Paesi Bassi;
  qui l'esito dipende soprattutto dall'abilità e le risorse non si incassano, quindi il rischio è basso, ma conviene non mostrare "compra Lume" nella schermata della puntata);
  vittorie o fronti a pagamento; casse a sorpresa (già vietate dalle regole di design).
- **Pay-to-win**: in single player nessuno perde contro chi paga, il rischio è che chi paga si annoi. Regola: **il Lume compra tempo, non decisioni**. Con la proposta, rushare tutto (15–27 €) toglie ~4 settimane di attesa ma non le ~100 campagne da vincere.

### 4.5 Multigiocatore

| | Asincrono | In tempo reale (alla OpenFront) |
|---|---|---|
| Cosa | Operazione della settimana: stessa mappa (seme) per tutti, classifica per province/tempo/bottino; "fantasmi" dei rivali; classifiche della Sala Radar | partite 8–40 giocatori + bot sulla stessa carta |
| Costo di sviluppo | 2–4 settimane (Supabase c'è già; `RunState` è deterministico col seme) | 3–6 mesi per una persona: server autorevole (Node con `RunState` lato server), sincronizzazione a 500 ms, matchmaking, riconnessione, anti-cheat, moderazione |
| Costo di esercizio | ~0 (righe in un database) | 20–200 €/mese in piccolo, poi a salire |
| Massa critica | nessuna | servono ~200+ giocatori connessi insieme per lobby piene in < 1 min; a 1.000–10.000 MAU le lobby sono vuote → bot |
| Effetto su retention | classifiche e sfide settimanali: motivo per tornare ogni settimana [IPOTESI] | i giochi sociali e competitivi stanno nella fascia mid-core (D30 11–12%) contro 1–2% della mediana [BENCHMARK, non causale] |
| Effetto su ricavi | estetica per la classifica (insegne), pass legato alla stagione | più alto, ma il pay-to-win diventa un problema vero (Call of War) |
| **Raccomandazione** | **sì, dopo il bilanciamento** | **solo sopra ~20.000 MAU** |

**Economia: single player contro multigiocatore**
- In single player ogni risorsa nasce dal nulla (rubinetto senza fondo): l'inflazione si controlla solo coi pozzi (costi, capienza, puntata persa). È il motivo della proposta sopra.
- In multigiocatore la puntata diventerebbe un piatto vero (chi vince prende dagli altri): poker a somma zero. Più tensione, ma con risorse comprabili diventa una questione legale da evitare.
  Nel multigiocatore i premi della classifica vanno tenuti estetici.

---

## 5. Ricompense, rischio e soddisfazione

### 5.1 Calendario delle ricompense di una campagna (oggi) [MISURATO-SIM + CODICE]
- **Continue**: province (immediate se libere, 3–15 s se assalti), cartelli a 10/25/50/100/200 province, provincia completa (+truppe, +bottino).
- **A tempo**: eventi ~ogni 90 s, offensive nemiche, primo impero a 0:26–1:15.
- **Finale**: schermata con bottino ×1,5 in vittoria. Varianza del bottino a casa: CV 0,36 (quasi tutto dall'esito vittoria/non vittoria).
- **Fuori campagna**: un upgrade da 1–30 min, che finisce prima della campagna successiva.
Manca: un premio raro (varianza "a sorpresa"), le serie, un appuntamento quotidiano, un "quasi" (near-miss) visibile.

### 5.2 La puntata: valore atteso [calcolo dalla formula di `RunState.summary`, G = 1.800 grezze, Fronte I, 20 min]

Guadagno atteso della puntata rispetto a non puntare, a seconda della probabilità di vittoria p (eliminazione = 15% delle non vittorie):

| p | **Oggi** 60 / 180 / 450 | **Proposta** 180 / 450 / 900 | Proposta con Deposito 3 (assicurazione 30%) |
|---|---|---|---|
| 0,2 | **+437 / +1.042 / +1.714** | −90 / −225 / −450 | −47 / −117 / −234 |
| 0,3 | (sempre positivo) | −45 / −112 / −225 | −7 / −18 / −36 |
| 0,4 | +504 / +1.209 / +2.017 | **0 / 0 / 0** (pareggio) | +32 / +81 / +162 |
| 0,5 | +537 / +1.293 / +2.168 | +45 / +113 / +225 (+2/+5/+10% del bottino) | +72 / +180 / +360 |
| 0,7 | +604 / +1.460 / +2.471 | +135 / +337 / +675 (+6/+14/+28%) | +151 / +378 / +756 |
| 0,85 | +655 / +1.585 / +2.698 | +203 / +506 / +1.013 (+8/+20/+40%) | +211 / +527 / +1.053 |

Oggi la puntata massima raddoppia il bottino a qualsiasi livello di bravura: non c'è scelta. Con la proposta la regola è leggibile:
**"punta se vinci più di 2 volte su 5"**, e il Deposito sposta il pareggio al 32%.
Formula proposta: vittoria = puntata + guadagno × 1,5 × mult; fine tempo = puntata × assicurazione + guadagno; eliminato = puntata × assicurazione + guadagno × (1 − perdita del Deposito).
Pareggio: p* = S·(1−a) / (S·(1−a) + 1,5·G·(m−1)); con S = G·(m−1) e a = 0 → p* = 0,4.

### 5.3 Avversione alla perdita
Le perdite pesano circa il doppio dei guadagni (λ ≈ 2,25, Tversky e Kahneman 1992). Valore *percepito* della puntata 900 con la proposta:
0,5 × 1.350 − 2,25 × 0,5 × 900 = **−337** a p = 0,5; pareggio percepito a **p ≈ 0,6**. Quindi i giocatori punteranno forte solo quando si sentono sicuri:
è una decisione vera. Per non scoraggiarla:
- mostrare nella preparazione **la stima di vittoria** (potenza tua contro consigliata, tarata sulla sim) accanto alla puntata;
- **"quasi vittoria"**: secondo posto a meno del 10% delle province del primo → metà della puntata torna (near-miss che spinge a riprovare);
- dopo 2 sconfitte di fila l'assicurazione sale del 20% per una campagna (rete di sicurezza contro la frustrazione).

### 5.4 Correzioni al ciclo
| Correzione | Numero | Perché |
|---|---|---|
| Prima vittoria del giorno | +50% sul guadagno | appuntamento quotidiano |
| Serie di vittorie | +10% a vittoria, max +30%; si azzera con una sconfitta | tensione sulla serie, alla Clash Royale |
| Premio raro | 1 campagna su ~10: un convoglio o giacimento ×2 sulla mappa (evento) | ricompensa a rapporto variabile, CV più alto senza toccare la media |
| Rendita del Comando | 60/h × fronte, tetto 12 h | la visita breve sul telefono rende |
| Spedizione notturna | lunga 8 h ≈ 1/3 di campagna | si torna la mattina |
| Ordini del giorno (3) | ~0,3 campagne ciascuno | obiettivi piccoli, sessioni brevi |
| Fine contenuto | livelli 6–10, Fronti VII+ ripetibili con stelle (`features.stars`), stagioni | D30 e oltre |
| Breve da telefono | lootMult 1,5 | sessione da 10 min che vale |

---

## Fonti
- GameAnalytics, benchmark mobile e PC 2026 (riassunto): https://gamedevreports.substack.com/p/gameanalytics-mobile-and-pc-game
- GameAnalytics 2025 (PDF): https://investgame.net/wp-content/uploads/2025/02/2025-GameAnalytics-Mobile-Gaming-Benchmarks.pdf
- AppAgent, benchmark di retention per genere: https://appagent.com/?p=61637
- Juego Studio, ARPDAU per genere e conversione: https://www.juegostudio.com/blog/arpdau-benchmarks-by-game-genre
- Playio, ARPPU e conversione (dati GameAnalytics e AppsFlyer): https://blog.playio.co/arppu-mobile-games
- AppsFlyer, monetizzazione delle app: https://www.appsflyer.com/resources/reports/app-marketing-monetization-report/
- Formula del costo in gemme di Clash of Clans (analisi 2014): https://gamedeveloper.com/business/clash-of-clans-time-monetization-formulas-demistifyed
- Supercell, riduzioni di costi e tempi (dicembre 2023): https://supercell.com/en/games/clashofclans/blog/news/cost-and-time-reductions-december-2023/
- Polytopia contro il pay-to-win: https://globalgamesforum.com/news/the-battle-of-polytopias-fight-against-pay-to-win
- Polytopia, 20 milioni di download: https://www.pocketgamer.biz/christian-lvstedt-on-the-battle-of-polytopias-journey-to-20-million-downloads
- Polytopia, monetizzazione aggressiva e abbandono: https://www.pocketgamer.biz/aggressive-mobile-game-monetisation-pushes-loyal-players-to-churn-says-battle-of-polytopia-ceo
- Polytopia, prezzi delle tribù e stime: https://adapty.io/paywall-library/the-battle-of-polytopia
- Call of War, F2PMeter: https://www.f2p.com/?p=35989
- OpenFront, caso Playwire: https://www.playwire.com/hubfs/Use%20%5BCase%20Study%5D%20OpenFront.io.pdf
- Territorial.io, traffico (Semrush): https://nl.semrush.com/website/territorial.io/overview
- Stripe, prezzi UE dal 2023: https://support.stripe.com/questions/april-2023-pricing-updates-for-businesses-based-in-europe
- Google Play, commissione 15%: https://android-developers.googleblog.com/2021/03/boosting-dev-success.html e https://support.google.com/paymentscenter/answer/112622
- Tversky e Kahneman (1992), *Advances in prospect theory*, Journal of Risk and Uncertainty 5 (λ ≈ 2,25).
