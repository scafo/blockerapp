# Ashen Atlas

Gioco mobile single player di conquista sulla mappa del mondo, stile analogico anni '40–'70 dopo "il Silenzio".
La specifica completa (feeling, lore, MVP, milestone) è in [CLAUDE.md](CLAUDE.md).

## Avvio

```bash
npm install
npm run dev        # http://localhost:5173 (--host: apribile dal telefono sulla stessa rete, in orizzontale)
npm run build      # build di produzione in dist/
npm run typecheck
npm run check:land # verifica la maschera terra contro d3 geoContains (se cambi la griglia)
npx vite-node scripts/sim.ts 1 6   # simula run senza grafica per tarare balance.ts
```

- `?seed=abc123` nell'URL → mappa riproducibile.
- Controlli: tap = attacca, trascina = sposta, pinch/rotella = zoom.

## Stato

| Milestone | Stato |
|---|---|
| 1. Mappa + conquista a tap | ✅ |
| 2. IA + combattimento + unità | IA e combattimento ✅ · unità ⏳ |
| 3. Zaino, ritirata, tempesta, schermata finale | — |
| 4. Accampamento + eventi | — |
| 5. Juice, onboarding, estetica placeholder | — |
| 6. Analytics + build Capacitor + test Android | — |
