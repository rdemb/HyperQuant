import { useEffect, useMemo, useRef, useState } from 'react';
import { useDesk } from '../../state/DeskContext';
import { BadgeTone } from '../../ui';
import { parkinsonSigma } from '../../utils/marketDataFeed';
import { MACRO_EVENTS, MacroEvent, eventVolMultiplier, eventsBetween } from '../../data/macroCalendar';

/** Wartość opóźniona o `ms` od ostatniej zmiany — ciężkie przeliczenia nie blokują pisania. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Wartość aktualizowana najwyżej raz na `ms` (pierwsza od razu, ostatnia zawsze dociera). */
export function useThrottled<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const wait = last.current + ms - Date.now();
    if (wait <= 0) {
      last.current = Date.now();
      setV(value);
      return;
    }
    const id = window.setTimeout(() => {
      last.current = Date.now();
      setV(value);
    }, wait);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Pole liczbowe zapamiętane w localStorage (np. kapitał) — bez storage działa tylko w tej sesji. */
export function useStoredString(key: string, fallback: string): [string, (v: string) => void] {
  const [v, setV] = useState<string>(() => {
    try {
      return window.localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  });
  const set = (next: string) => {
    setV(next);
    try {
      window.localStorage.setItem(key, next);
    } catch {
      // tryb prywatny / zablokowany storage — wartość tylko w tej sesji
    }
  };
  return [v, set];
}

/** Liczba z pola tekstowego: akceptuje przecinek dziesiętny i spacje tysięcy; pusta/niepoprawna → NaN. */
export function parseNum(s: string): number {
  const t = s.replace(/[\s $]/g, '').replace(',', '.');
  if (t === '') return Number.NaN;
  const v = Number(t);
  return Number.isFinite(v) ? v : Number.NaN;
}

export const HORIZONS = [
  { value: 30, label: '30m' },
  { value: 60, label: '1h' },
  { value: 120, label: '2h' },
  { value: 240, label: '4h' },
  { value: 1440, label: '24h' },
];

export function fmtMinutes(m: number): string {
  if (!Number.isFinite(m)) return '—';
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

export interface PlanMarket {
  price: number;
  sigma: number;
  /** Pochodzenie σ i wyniku: realne świece (MODEL), zastępcze (SIM), nieświeże (STALE) */
  source: { tone: BadgeTone; label: string; title: string };
  events: MacroEvent[];
  eventMultiplier: number;
  /** false = tabela kalendarza pusta — brak zdarzeń nie oznacza „spokojnie” */
  calendarLoaded: boolean;
  book: { bids: ReturnType<typeof useDesk>['feed']['bids']; asks: ReturnType<typeof useDesk>['feed']['asks'] };
  bars: ReturnType<typeof useDesk>['feed']['bars'];
  timeframeSec: number;
  /** true = świece pochodzą z API (nie zastępcze) — warunek rozstrzygania dziennika */
  realBars: boolean;
}

/**
 * Wspólne wejścia rynkowe Analizatora: σ z Parkinsona na horyzont, zdarzenia makro w oknie, arkusz L2.
 * Świece i arkusz są dławione (co 3 s), żeby Monte Carlo nie liczyło się przy każdym ticku.
 */
/** Ostatnia data CPI w tabeli kalendarza — granica, do której brak zdarzeń znaczy „brak publikacji”. */
const CALENDAR_COVERAGE_END_MS = MACRO_EVENTS.filter((e) => e.kind === 'CPI').reduce((m, e) => Math.max(m, e.timeUtcMs), 0);

export function usePlanMarket(horizonMin: number): PlanMarket {
  const { feed } = useDesk();
  const bars = useThrottled(feed.bars, 3000);
  const bids = useThrottled(feed.bids, 3000);
  const asks = useThrottled(feed.asks, 3000);
  const price = useThrottled(feed.currentPrice, 3000);
  // Stabilna referencja arkusza — nowy obiekt przy każdym renderze restartował debounce analizy
  const book = useMemo(() => ({ bids, asks }), [bids, asks]);
  const sigma = parkinsonSigma(bars, horizonMin * 60, feed.timeframeSec);
  const now = feed.nowTick;
  const events = eventsBetween(now, now + horizonMin * 60_000);
  const eventMultiplier = Math.max(1, ...events.map((e) => eventVolMultiplier(e)));
  const tf = `${Math.round(feed.timeframeSec / 60)}m`;
  const source: PlanMarket['source'] =
    feed.dataStatus === 'SYNTH'
      ? { tone: 'sim', label: 'SIM', title: 'Świece zastępcze — wynik poglądowy do czasu synchronizacji z Hyperliquid' }
      : feed.dataStatus === 'STALE'
      ? { tone: 'stale', label: 'STALE', title: 'Dane nieświeże — σ i arkusz mogą być nieaktualne' }
      : { tone: 'model', label: 'MODEL', title: `Model GBM + Monte Carlo; σ Parkinsona z 60 świec ${tf} Hyperliquid` };
  return {
    price,
    sigma,
    source,
    events,
    eventMultiplier,
    // Kalendarz „pokrywa” okno tylko gdy tabela sięga dalej niż koniec horyzontu (inaczej brak zdarzeń ≠ brak publikacji)
    calendarLoaded: CALENDAR_COVERAGE_END_MS >= now + horizonMin * 60_000,
    book,
    bars,
    timeframeSec: feed.timeframeSec,
    realBars: feed.lastSyncOkAt !== null,
  };
}
