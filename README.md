# Ashen Atlas

Gioco single player di conquista sulla mappa del mondo. Dopo **la Caduta**, un cataclisma che ha cambiato il mondo, le potenze
(Imperium, Republica, Aristocrazia, Cabal) si contendono il dominio dopo la scoperta di una nuova tecnologia.
Campagne sulla mappa → risorse (cibo, metallo, benzina) → l'HQ cresce → la campagna dopo è diversa.
Visione completa nel Figma di Nico e in [CLAUDE.md](CLAUDE.md). **Prima si valida su browser**, poi app.

## Avvio

```bash
npm install
npm run dev        # http://localhost:5173 (--host: apribile dal telefono sulla stessa rete)
npm run build      # build di produzione in dist/
npx cap sync android # copia la build web nell'app Android (APK: GitHub Actions, vedi TESTING.md)
npm run build:single # una sola pagina HTML con il gioco inline (dist-single/), per artifact e hosting semplice
npm run typecheck
npm run check:land # verifica la maschera terra contro d3 geoContains (se cambi la griglia)
npx vite-node scripts/sim.ts 1 6 1 # simula run senza grafica per tarare balance.ts
```

- `?seed=abc123` nell'URL → salta l'accampamento e apre quella mappa.
- Controlli: tocco vicino = attacca, tocco lontano = avanzata, trascina dal tuo territorio = dipingi, trascina altrove / due dita = sposta e zoom.
- Pedine: tocca una carta → un tuo territorio; tocca una pedina → una destinazione.

## Stato

| Milestone | Stato |
|---|---|
| 1. Mappa + conquista a tap | ✅ |
| 2. IA + combattimento + unità | ✅ (pedine sulla mappa) |
| 3. Zaino, ritirata, fine campagna a tempo, schermata finale | ✅ |
| 4. Accampamento + eventi | ✅ |
| 5. Juice, onboarding, estetica placeholder | ✅ |
| 6. Analytics + build Capacitor + test Android | ✅ codice · test sul campo: vedi [TESTING.md](TESTING.md) |
