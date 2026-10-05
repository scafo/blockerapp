// Wrapper GameAnalytics: un solo punto da cui passano gli eventi. Non deve MAI far crashare il gioco.
// D1/D7 e durata delle sessioni li calcola GameAnalytics dalle sessioni; qui mandiamo gli eventi di gioco
// per le metriche del test (run per sessione, rivincite dopo sconfitta, ritiro spedizioni...).
import type GameAnalyticsClass from 'gameanalytics';
import { gameanalytics } from 'gameanalytics';
import { GA_BUILD, GA_KEYS } from '../config/analytics';
import type { Bag } from '../game/resources';

// a runtime la classe sta in `gameanalytics.GameAnalytics` (il default è l'API a comandi): le typings non lo dicono
const GA = (gameanalytics as unknown as { GameAnalytics: typeof GameAnalyticsClass }).GameAnalytics;
const enabled = !!(GA_KEYS.gameKey && GA_KEYS.secretKey);
let runsThisSession = 0;

const safe = (fn: () => void) => {
  try {
    fn();
  } catch {
    /* analytics mai bloccante */
  }
};

const debug = (...a: unknown[]) => {
  if (!enabled && location.hostname === 'localhost') console.debug('[analytics]', ...a);
};

/** GameAnalytics vuole id a parti separate da ":" con caratteri semplici. */
const part = (s: string) => s.replace(/[^A-Za-z0-9_.()!?-]/g, '_').slice(0, 64);

export const analytics = {
  init() {
    if (!enabled) return debug('spento: aggiungi le chiavi in src/config/analytics.ts');
    safe(() => {
      GA.configureBuild(GA_BUILD);
      GA.configureAvailableResourceCurrencies(['metallo', 'benzina', 'cibo']);
      GA.configureAvailableResourceItemTypes(['run', 'edificio', 'spedizione']);
      GA.initialize(GA_KEYS.gameKey, GA_KEYS.secretKey);
      // app in background / di nuovo in primo piano: chiude e riapre la sessione
      document.addEventListener('visibilitychange', () => safe(() => (document.hidden ? GA.onStop() : GA.onResume())));
    });
  },

  design(id: string[], value?: number) {
    const eventId = id.map(part).join(':');
    debug(eventId, value ?? '');
    if (enabled) safe(() => (value === undefined ? GA.addDesignEvent(eventId) : GA.addDesignEvent(eventId, value)));
  },

  runStart(tutorial: boolean, seed: string) {
    runsThisSession++;
    this.design(['run', 'start', tutorial ? 'tutorial' : 'normale']);
    this.design(['sessione', 'run_n'], runsThisSession); // run per sessione = massimo di questo valore
    if (enabled) safe(() => GA.addProgressionEvent(gameanalytics.EGAProgressionStatus.Start, 'run', part(seed)));
    debug('progressione start', seed);
  },

  runEnd(outcome: string, reason: string | undefined, maxTiles: number, timeMs: number, seed: string) {
    this.design(['run', 'fine', outcome, reason ?? '-'], Math.round(timeMs / 1000));
    this.design(['run', 'territorio_max'], maxTiles);
    const status = outcome === 'victory' || outcome === 'retreat'
      ? gameanalytics.EGAProgressionStatus.Complete : gameanalytics.EGAProgressionStatus.Fail;
    if (enabled) safe(() => GA.addProgressionEvent(status, 'run', part(seed), undefined, maxTiles));
  },

  /** Grado del comandante salito (meccaniche nuove, onda 5): tier = indice in merit.tiers. */
  rank(tier: number) {
    this.design(['progressione', 'grado'], tier);
  },

  /** Ordine del giorno completato o cambiato (meccaniche nuove). */
  dailyOrder(id: string, done: boolean) {
    this.design(['giornaliero', id, done ? 'fatto' : 'cambiato']);
  },

  /** Si torna dopo un'assenza: quante ore sono passate (rapporto del mattino, meccaniche nuove). */
  returnAfter(hours: number) {
    this.design(['rientro', 'ore'], Math.round(hours));
  },

  /** Bottino portato a casa (Source) o speso nell'accampamento (Sink). */
  resources(flow: 'source' | 'sink', bag: Bag, itemType: 'run' | 'edificio' | 'spedizione' | 'ricerca', itemId: string) {
    for (const [r, v] of Object.entries(bag)) {
      if (!v) continue;
      debug('risorsa', flow, r, v, itemType, itemId);
      if (!enabled) continue;
      const f = flow === 'source' ? gameanalytics.EGAResourceFlowType.Source : gameanalytics.EGAResourceFlowType.Sink;
      safe(() => GA.addResourceEvent(f, r, v, itemType, part(itemId)));
    }
  },
};
