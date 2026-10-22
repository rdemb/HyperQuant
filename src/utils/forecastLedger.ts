import { PLAN_MODEL_VERSION, PlanDirection } from './planAnalyzer';

/**
 * Dziennik trafności prognoz Analizatora planu — lokalny i prywatny (tylko localStorage tej przeglądarki).
 * Każdy zapisany plan jest później rozstrzygany na świecach: cel / stop / żadne (upływ horyzontu).
 * Metryki: Brier (wieloklasowy i binarny dla P_T), log score, wykres niezawodności (10 koszyków).
 */

export const LEDGER_KEY = 'hq.ledger.v1';
export const LEDGER_LIMIT = 500;
/** Po tylu dniach od końca horyzontu plan bez świec z okresu trwania oznaczamy „brak danych”. */
const NODATA_AFTER_MS = 7 * 24 * 3600 * 1000;

export type LedgerOutcome = 'target' | 'stop' | 'none';
// 'nofill' = cena nie doszła do wejścia przed końcem horyzontu (plan niewykonany — poza metrykami)
export type LedgerStatus = 'pending' | LedgerOutcome | 'nodata' | 'nofill';

export interface LedgerEntry {
  id: string;
  createdAt: number;
  direction: PlanDirection;
  entry: number;
  stop: number;
  target: number;
  horizonMin: number;
  pTarget: number;
  pStop: number;
  pNeither: number;
  /** P(wejście dotknięte w horyzoncie) z modelu; brak w starszych wpisach (plan-gbm-bgk-v1) */
  pFill?: number;
  modelVersion: string;
  source?: string;
  status: LedgerStatus;
  resolvedAt?: number;
}

export interface LedgerBar {
  time: number;
  high: number;
  low: number;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // brak Web Crypto — zapasowy identyfikator niżej
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function makeEntry(
  f: Pick<LedgerEntry, 'direction' | 'entry' | 'stop' | 'target' | 'horizonMin' | 'pTarget' | 'pStop' | 'pNeither'> & {
    source?: string;
    pFill?: number;
  },
  now: number
): LedgerEntry {
  return { ...f, id: newId(), createdAt: now, modelVersion: PLAN_MODEL_VERSION, status: 'pending' };
}

/** Dopisuje wpis; przy przekroczeniu limitu odpadają najstarsze. */
export function appendEntry(entries: LedgerEntry[], e: LedgerEntry, limit: number = LEDGER_LIMIT): LedgerEntry[] {
  const out = [...entries, e];
  return out.length > limit ? out.slice(out.length - limit) : out;
}

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const STATUSES: LedgerStatus[] = ['pending', 'target', 'stop', 'none', 'nodata', 'nofill'];

function isEntry(v: unknown): v is LedgerEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    (e.direction === 'LONG' || e.direction === 'SHORT') &&
    ['createdAt', 'entry', 'stop', 'target', 'horizonMin', 'pTarget', 'pStop', 'pNeither'].every((k) => num(e[k])) &&
    STATUSES.includes(e.status as LedgerStatus)
  );
}

export function loadLedger(storage: StorageLike | null = defaultStorage()): LedgerEntry[] {
  try {
    const raw = storage?.getItem(LEDGER_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isEntry)
      .slice(-LEDGER_LIMIT)
      .map((e) => {
        // Uszkodzone pFill odpada, wpis zostaje (metryki wyniku go nie potrzebują)
        if (e.pFill === undefined || (num(e.pFill) && e.pFill >= 0 && e.pFill <= 1)) return e;
        const { pFill: _drop, ...rest } = e;
        return rest;
      });
  } catch {
    return [];
  }
}

/** Zwraca false, gdy zapis się nie udał (tryb prywatny, pełny storage) — dziennik działa wtedy tylko w tej sesji. */
export function saveLedger(entries: LedgerEntry[], storage: StorageLike | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(LEDGER_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

export function clearLedger(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(LEDGER_KEY);
  } catch {
    // brak dostępu do storage — nic do wyczyszczenia
  }
}

/**
 * Rozstrzyga oczekujące plany na świecach (posortowanych rosnąco po czasie otwarcia `time`).
 * Zasady:
 * - liczą się świece otwarte w [utworzenie, utworzenie + horyzont); świeca w toku przy utworzeniu jest pomijana,
 *   bo jej high/low mogą pochodzić sprzed planu (rozdzielczość = interwał świec);
 * - pierwsza świeca dotykająca celu lub stopu rozstrzyga; gdy jedna świeca dotyka obu — ostrożnie „stop”
 *   (kolejność wewnątrz świecy nieznana);
 * - brak dotknięcia i dane sięgają końca horyzontu → „none”;
 * - świece dłuższe niż 1/4 horyzontu → czekamy (za gruba rozdzielczość, np. po zmianie interwału);
 * - brak świec z początku okresu → czekamy; po 7 dniach od końca horyzontu → „nodata” (poza metrykami).
 */
export function resolvePending(entries: LedgerEntry[], bars: LedgerBar[], now: number, barMs: number): LedgerEntry[] {
  if (!(barMs > 0)) return entries;
  const first = bars[0];
  const last = bars[bars.length - 1];
  return entries.map((e) => {
    if (e.status !== 'pending') return e;
    const deadline = e.createdAt + e.horizonMin * 60_000;
    if (barMs > (e.horizonMin * 60_000) / 4) return e;
    if (!first || first.time > e.createdAt + barMs) {
      return now >= deadline + NODATA_AFTER_MS ? { ...e, status: 'nodata' as const, resolvedAt: now } : e;
    }
    const long = e.direction === 'LONG';
    // Najpierw wypełnienie: pierwsza świeca po zapisie, której zakres obejmuje cenę wejścia.
    // W świecy wypełnienia kolejność zdarzeń jest nieznana — liczymy w niej tylko stop (ostrożnie), cel od następnej.
    let filled = false;
    for (const b of bars) {
      if (b.time < e.createdAt) continue;
      if (b.time >= deadline) break;
      const hitT = long ? b.high >= e.target : b.low <= e.target;
      const hitS = long ? b.low <= e.stop : b.high >= e.stop;
      if (!filled) {
        if (b.low <= e.entry && e.entry <= b.high) {
          filled = true;
          if (hitS) return { ...e, status: 'stop' as const, resolvedAt: b.time };
        }
        continue;
      }
      if (hitS) return { ...e, status: 'stop' as const, resolvedAt: b.time };
      if (hitT) return { ...e, status: 'target' as const, resolvedAt: b.time };
    }
    if (now >= deadline && last && last.time + barMs >= deadline) {
      return filled
        ? { ...e, status: 'none' as const, resolvedAt: deadline }
        : { ...e, status: 'nofill' as const, resolvedAt: deadline };
    }
    return e;
  });
}

export function bucketIndex(p: number): number {
  return Math.min(9, Math.max(0, Math.floor(p * 10)));
}

export interface ReliabilityBin {
  lo: number;
  hi: number;
  n: number;
  /** Średnia prognoza P_T w koszyku (null gdy pusty) */
  meanForecast: number | null;
  /** Częstość „cel najpierw” w koszyku (null gdy pusty) */
  observed: number | null;
}

export interface LedgerMetrics {
  total: number;
  resolved: number;
  pending: number;
  nodata: number;
  /** Brier wieloklasowy {cel, stop, żadne}: średnia Σ(p_k − o_k)², zakres 0–2, niżej = lepiej */
  brier: number | null;
  /** Brier binarny dla P(cel przed stopem): średnia (p_T − 1[cel])², zakres 0–1 */
  brierTarget: number | null;
  /** Log score: średnia −ln p(wynik), w natach, niżej = lepiej (p obcięte do 1e-6) */
  logScore: number | null;
  targetRate: number | null;
  reliability: ReliabilityBin[];
  /** Brier dla P(wypełnienia): wpisy z pFill rozstrzygnięte (wypełnione = 1) lub „nofill” (= 0); 0–1, niżej = lepiej */
  brierFill: number | null;
  fillScored: number;
}

const isResolved = (e: LedgerEntry): e is LedgerEntry & { status: LedgerOutcome } =>
  e.status === 'target' || e.status === 'stop' || e.status === 'none';

export function ledgerMetrics(entries: LedgerEntry[]): LedgerMetrics {
  const done = entries.filter(isResolved);
  const n = done.length;
  const bins = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, n: 0, sumP: 0, hits: 0 }));
  let brier = 0;
  let brierT = 0;
  let logS = 0;
  let hits = 0;
  for (const e of done) {
    const o = { target: e.status === 'target' ? 1 : 0, stop: e.status === 'stop' ? 1 : 0, none: e.status === 'none' ? 1 : 0 };
    brier += (e.pTarget - o.target) ** 2 + (e.pStop - o.stop) ** 2 + (e.pNeither - o.none) ** 2;
    brierT += (e.pTarget - o.target) ** 2;
    const pOut = e.status === 'target' ? e.pTarget : e.status === 'stop' ? e.pStop : e.pNeither;
    logS += -Math.log(Math.max(1e-6, pOut));
    hits += o.target;
    const b = bins[bucketIndex(e.pTarget)];
    b.n++;
    b.sumP += e.pTarget;
    b.hits += o.target;
  }
  let brierFill = 0;
  let fillScored = 0;
  for (const e of entries) {
    if (e.pFill === undefined || !(isResolved(e) || e.status === 'nofill')) continue;
    brierFill += (e.pFill - (e.status === 'nofill' ? 0 : 1)) ** 2;
    fillScored++;
  }
  return {
    total: entries.length,
    resolved: n,
    pending: entries.filter((e) => e.status === 'pending').length,
    nodata: entries.filter((e) => e.status === 'nodata').length,
    brier: n > 0 ? brier / n : null,
    brierTarget: n > 0 ? brierT / n : null,
    logScore: n > 0 ? logS / n : null,
    targetRate: n > 0 ? hits / n : null,
    reliability: bins.map((b) => ({
      lo: b.lo,
      hi: b.hi,
      n: b.n,
      meanForecast: b.n > 0 ? b.sumP / b.n : null,
      observed: b.n > 0 ? b.hits / b.n : null,
    })),
    brierFill: fillScored > 0 ? brierFill / fillScored : null,
    fillScored,
  };
}

/** Liczność i trafienia celu w koszyku prognozy zawierającym `p` (do ćwierć-Kelly z dolnej granicy Wilsona). */
export function bucketStats(entries: LedgerEntry[], p: number): { n: number; hits: number } {
  const idx = bucketIndex(p);
  let n = 0;
  let hits = 0;
  for (const e of entries) {
    if (!isResolved(e) || bucketIndex(e.pTarget) !== idx) continue;
    n++;
    if (e.status === 'target') hits++;
  }
  return { n, hits };
}

export function exportLedgerJson(entries: LedgerEntry[], now: number = Date.now()): string {
  return JSON.stringify({ key: LEDGER_KEY, exportedAt: new Date(now).toISOString(), entries }, null, 2);
}
