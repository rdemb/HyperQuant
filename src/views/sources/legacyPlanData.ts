import { LEDGER_KEY, loadLedger } from '../../utils/forecastLedger';

const EQUITY_KEY = 'hq.plan.equity';

function readEquity(storage: Storage): string | null {
  try {
    return storage.getItem(EQUITY_KEY);
  } catch {
    return null;
  }
}

/** Ile planów dawnego Analizatora leży w tej przeglądarce (hq.ledger.v1) i czy zapisano kapitał (hq.plan.equity). Tylko odczyt. */
export function legacyPlanSummary(storage: Storage): { plans: number; hasEquity: boolean } {
  return { plans: loadLedger(storage).length, hasEquity: readEquity(storage) !== null };
}

/**
 * Plik eksportu dawnego Analizatora: `{ key, exportedAt, entries, equity }` — plany z hq.ledger.v1 (jak dawny przycisk
 * w dzienniku planów) i kapitał z hq.plan.equity jako zapisany napis (null, gdy go nie ma). Tylko odczyt.
 */
export function legacyPlanJson(storage: Storage, now: number = Date.now()): string {
  return JSON.stringify({ key: LEDGER_KEY, exportedAt: new Date(now).toISOString(), entries: loadLedger(storage), equity: readEquity(storage) }, null, 2);
}

/** Pobranie danych dawnego Analizatora (plany i kapitał) jako plik JSON z `legacyPlanJson`. */
export function downloadLegacyPlanData(storage: Storage): void {
  const blob = new Blob([legacyPlanJson(storage)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hyperquant-dziennik-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
