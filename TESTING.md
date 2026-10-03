# Test MVP — Ashen Atlas

Obiettivo: **D7 > 20%** su ~20 tester. Qui: come avere l'app, come accendere le metriche, cosa controllare sul telefono economico.

## 1. Avere il gioco

**APK Android (consigliato per il test)**
1. Ogni push su GitHub compila l'APK da solo: repo → **Actions** → "APK Android (debug)" → ultimo run verde → in fondo **Artifacts** → `ashen-atlas-debug-apk` (zip con dentro `app-debug.apk`).
2. Sul telefono: apri l'APK, consenti "installa app sconosciute" per il browser/file manager, installa.
3. L'app è bloccata in orizzontale, a schermo intero, con lo schermo sempre acceso.

**Versione web (per chi ha iPhone o non vuole installare)**
- Vercel: "Add New Project" → importa il repo → Deploy (la config è in `vercel.json`). Il link si manda ai tester.
- In alternativa `npm run build:single` crea una sola pagina HTML (`dist-single/index.html`) da caricare ovunque.

## 2. Accendere le metriche (GameAnalytics, gratis)

1. Crea un account su gameanalytics.com → nuovo gioco (piattaforma Android; aggiungine una Web se usi anche il link).
2. Settings → Keys: copia **Game key** e **Secret key** in `src/config/analytics.ts`, fai push. Il prossimo APK manda i dati.
3. Senza chiavi il gioco funziona uguale e non manda niente.

| Metrica del test | Dove guardarla in GameAnalytics |
|---|---|
| Retention D1 / D7 | Dashboard → Retention (automatico dalle sessioni) |
| Durata sessioni | Dashboard → Engagement |
| Run per sessione (obiettivo ≥ 2) | evento `sessione:run_n` → valore massimo per sessione |
| % Rivincita dopo una sconfitta | `run:rivincita:eliminated` + `run:rivincita:storm` contro `run:fine:eliminated:*` + `run:fine:storm:*` |
| % che torna a ritirare una spedizione | `spedizione:ritira:*` contro `spedizione:parti:*` |
| Dove si bloccano i nuovi | `tutorial:<passo>` (tap → troops → flow → paint → unit → order → goal) |
| Come giocano | `controlli:tocchi / avanzate / pittura / pedine`, `pedina:<tipo>`, `evento:<id>:<lato>` |
| Economia | eventi risorsa: Source (run, spedizione) / Sink (edificio) per rottami, carburante, viveri |

## 3. Test sul telefono economico (Nico, prima dei tester)

Attiva il contatore: nell'accampamento tocca **5 volte** il titolo "ASHEN ATLAS" (sul web: `?fps=1` nell'URL).

- [ ] Avvio fino alla prima schermata: < 5 s
- [ ] FPS in run, zoom lontano e vicino, con 3 fazioni grandi: ≥ 30 (sotto i 25 segnalamelo con modello del telefono)
- [ ] Tempesta che avanza (8:00 a x4 = 2 min reali): niente scatti forti
- [ ] Tocchi precisi sulle caselle con lo zoom di partenza; trascinamento e due dita non si confondono
- [ ] Telefono non bollente dopo 3 run di fila
- [ ] Uscire e rientrare dall'app: la run riparte, la scorta e i cantieri restano
- [ ] Prima apertura (app appena installata): parte la run guidata e si vince in ~2 minuti

## 4. Le 3 domande ai tester (dopo una settimana)

1. Cosa ti ha annoiato?
2. Cosa vorresti sbloccare?
3. Lo consiglieresti a un amico?
