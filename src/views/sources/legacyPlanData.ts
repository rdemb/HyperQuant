import { exportLedgerJson, loadLedger } from '../../utils/forecastLedger';

const EQUITY_KEY = 'hq.plan.equity';

/** Ile planów dawnego Analizatora leży w tej przeglądarce (hq.ledger.v1) i czy zapisano kapitał (hq.plan.equity). Tylko odczyt. */
export function legacyPlanSummary(storage: Storage): { plans: number; hasEquity: boolean } {
  let hasEquity = false;
  try {
    hasEquity = storage.getItem(EQUITY_KEY) !== null;
  } catch {
    hasEquity = false;
  }
  return { plans: loadLedger(storage).length, hasEquity };
}

/** Pobranie danych dawnego Analizatora jako plik JSON `{ key, exportedAt, entries }` (jak dawny przycisk w dzienniku planów). */
export function downloadLegacyPlanData(storage: Storage): void {
  const blob = new Blob([exportLedgerJson(loadLedger(storage))], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hyperquant-dziennik-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
