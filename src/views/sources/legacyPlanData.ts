import { LEDGER_KEY, loadLedger } from '../../utils/forecastLedger';
import { plForm } from '../../ui/format';
import { tr } from '../../i18n';

const EQUITY_KEY = 'hq.plan.equity';

function read(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** Liczba wpisów w surowym zapisie hq.ledger.v1; null — zapis nie jest tablicą JSON. */
function rawCount(raw: string): number | null {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.length : null;
  } catch {
    return null;
  }
}

export interface LegacyPlanSummary {
  /** Plany, które odczyta eksport JSON. */
  plans: number;
  /** Zapisany kapitał (hq.plan.equity). */
  hasEquity: boolean;
  /** Zapis hq.ledger.v1 jest, ale części albo całości nie da się odczytać (zły JSON, nie tablica, odrzucone wpisy). */
  unreadable: boolean;
}

/** Co z dawnego Analizatora leży w tej przeglądarce (hq.ledger.v1, hq.plan.equity). Tylko odczyt. */
export function legacyPlanSummary(storage: Storage): LegacyPlanSummary {
  const plans = loadLedger(storage).length;
  const raw = read(storage, LEDGER_KEY);
  const n = raw === null || raw === '' ? 0 : rawCount(raw);
  return { plans, hasEquity: read(storage, EQUITY_KEY) !== null, unreadable: n === null || n > plans };
}

/** „1 zapisany plan”, „2 zapisane plany”, „5 zapisanych planów” (EN: „1 plan”, „2 plans”). */
export const plansLabel = (n: number): string =>
  tr(`${n} ${plForm(n, 'zapisany plan', 'zapisane plany', 'zapisanych planów')}`, `${n} ${n === 1 ? 'plan' : 'plans'}`);

/**
 * Plik eksportu dawnego Analizatora: `{ key, exportedAt, entries, equity }` — plany z hq.ledger.v1 (jak dawny przycisk
 * w dzienniku planów) i kapitał z hq.plan.equity jako zapisany napis (null, gdy go nie ma). Tylko odczyt.
 */
export function legacyPlanJson(storage: Storage, now: number = Date.now()): string {
  return JSON.stringify({ key: LEDGER_KEY, exportedAt: new Date(now).toISOString(), entries: loadLedger(storage), equity: read(storage, EQUITY_KEY) }, null, 2);
}

/** Surowy zapis hq.ledger.v1 bez żadnej zmiany (null, gdy go nie ma). Tylko odczyt. */
export function legacyRawText(storage: Storage): string | null {
  return read(storage, LEDGER_KEY);
}

function download(text: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const today = () => new Date().toISOString().slice(0, 10);

/** Pobranie danych dawnego Analizatora (plany i kapitał) jako plik JSON z `legacyPlanJson`. */
export function downloadLegacyPlanData(storage: Storage): void {
  download(legacyPlanJson(storage), `hyperquant-dziennik-${today()}.json`, 'application/json');
}

/** Pobranie surowego zapisu hq.ledger.v1 (gdy nie da się go odczytać) jako plik tekstowy; zapis zostaje nietknięty. */
export function downloadLegacyRaw(storage: Storage): void {
  const raw = legacyRawText(storage);
  if (raw !== null) download(raw, `hyperquant-dziennik-surowy-${today()}.txt`, 'text/plain');
}
