# Ashen Atlas

Gioco mobile single player di conquista sulla mappa del mondo dopo la Caduta. Solo orizzontale.
La specifica completa (feeling, stile, MVP, milestone) è in [CLAUDE.md](CLAUDE.md).

## Avvio

```bash
npm install
npm run dev          # http://localhost:5173 (--host: apribile dal telefono sulla stessa rete)
npm run build        # build di produzione in dist/
npx cap sync android # copia la build web nell'app Android (APK: GitHub Actions)
npm run build:single # una sola pagina HTML con il gioco inline (dist-single/), per artifact e hosting semplice
npm run typecheck
npm run gen:land     # rigenera la maschera terra con d3 geoContains (solo se cambi la griglia)
```

- `?seed=abc123` nell'URL → stessa mappa; `?fps=1` → contatore FPS.
- Controlli: tocco vicino al confine = ondata (25/50/100% delle truppe), trascina = sposta, due dita / rotella = zoom,
  doppio tocco = centra sul tuo territorio, TERRENO = mostra i terreni a colori.

## Stato

| Milestone | Stato |
|---|---|
| 1. Mappa + conquista a tap | ✅ (ricostruita da zero) |
| 2. IA + combattimento + unità | da fare |
| 3. Zaino, ritirata, tempesta, schermata finale | da fare |
| 4. Accampamento + eventi | da fare |
| 5. Juice, onboarding, estetica placeholder | da fare |
| 6. Analytics + build Capacitor + test | build Android pronta |

Il prototipo precedente (esagoni, M1–M6) è nel commit `cd22868`.
