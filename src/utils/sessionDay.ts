/**
 * Sesja jako jednostka dnia tradera (spec §7.11): Londyn od 08:00 czasu londyńskiego do otwarcia NY, Nowy Jork od 09:30
 * czasu nowojorskiego do 00:00 UTC — granice (z czasem letnim) z `charts/pro/core/sessions`. IB = pierwsza godzina sesji.
 * Sesja azjatycka nie jest sesją handlową w tym sensie; doba UTC to tylko podsumowanie.
 *
 * Oczekiwany zakres sesji (MODEL) i budżet zakresu: ile oczekiwanego zakresu high-low sesja już zużyła.
 */
import { sessionOpens, utcDayStart } from '../charts/pro/core/sessions';
import { horizonStepSigmas, type VolModel } from './volatility';
import { parkinsonSigma } from './marketDataFeed';
import type { VBar } from './auction';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const FIVE_MIN = 5 * MIN;

export type TradeSessionId = 'london' | 'ny';

export type TradeSession = {
  id: TradeSessionId;
  start: number;
  end: number;
  /** Koniec Initial Balance: start + 1 h */
  ibEnd: number;
};

/** Sesja Londynu albo NY doby UTC zaczynającej się o `day` (początek doby). */
export function tradeSessionOn(day: number, id: TradeSessionId): TradeSession {
  const [, london, ny] = sessionOpens(day);
  const start = id === 'london' ? london : ny;
  return { id, start, end: id === 'london' ? ny : day + DAY, ibEnd: start + HOUR };
}

/** Sesja Londynu albo NY trwająca w chwili `now`; w sesji azjatyckiej (00:00 UTC do otwarcia Londynu) null. */
export function currentTradeSession(now: number): TradeSession | null {
  if (!Number.isFinite(now)) return null;
  const day = utcDayStart(now);
  for (const id of ['london', 'ny'] as const) {
    const s = tradeSessionOn(day, id);
    if (now >= s.start && now < s.end) return s;
  }
  return null;
}

/** `n` ostatnich zamkniętych sesji (koniec ≤ now), od najstarszej do najnowszej. */
export function lastClosedSessions(now: number, n: number): TradeSession[] {
  const out: TradeSession[] = [];
  if (!(n > 0) || !Number.isFinite(n) || !Number.isFinite(now)) return out;
  for (let day = utcDayStart(now); out.length < n; day -= DAY) {
    for (const id of ['ny', 'london'] as const) {
      const s = tradeSessionOn(day, id);
      if (s.end <= now && out.length < n) out.push(s);
    }
  }
  return out.reverse();
}

/** Ta sama sesja dnia poprzedniego (Londyn ← Londyn wczoraj, NY ← NY wczoraj) — odniesienie reguły 80% i ekstremów. */
export function previousSameSession(s: TradeSession): TradeSession {
  return tradeSessionOn(utcDayStart(s.start) - DAY, s.id);
}

/** Najbliższa sesja Londynu albo NY otwierana ściśle po chwili `now`. */
export function nextTradeSession(now: number): TradeSession {
  const day = utcDayStart(now);
  for (const s of [tradeSessionOn(day, 'london'), tradeSessionOn(day, 'ny')]) if (s.start > now) return s;
  return tradeSessionOn(day + DAY, 'london');
}

/**
 * Okno sesji w świecach 1h: świeca należy do sesji, w której się zaczyna, czyli [pełna godzina ≥ start, pełna godzina ≥
 * end). IB NY ze świec 1h to świeca od pełnej godziny po 09:30 (10:00–11:00 czasu NY), a ostatnia świeca Londynu obejmuje
 * pierwsze 30 min NY — przybliżenie statystyki historycznej (świece 1m bieżącej sesji liczą dokładne granice).
 */
export function hourlyWindow(s: TradeSession): { start: number; end: number } {
  const ceil = (t: number) => Math.ceil(t / HOUR) * HOUR;
  return { start: ceil(s.start), end: ceil(s.end) };
}

/** E[high − low] ruchu Browna = sqrt(8/π) · σ (Feller 1951). */
const RANGE_K = Math.sqrt(8 / Math.PI);

/**
 * Oczekiwany zakres high-low sesji w USD (MODEL): sqrt(8/π) · σ_sesji · cena. Z modelem σ_sesji² = Σ σ² kroków
 * `horizonStepSigmas` od początku sesji przez całą jej długość; bez modelu σ Parkinsona z ostatnich zamkniętych świec 5m
 * przeskalowane do długości sesji. Brak danych, zerowa zmienność albo cena niepoprawna → null (nigdy liczba zastępcza).
 */
export function expectedRange(
  model: VolModel | null,
  bars5m: VBar[],
  s: TradeSession,
  now: number,
  price: number
): { usd: number; method: 'har' | 'parkinson' } | null {
  if (!(Number.isFinite(price) && price > 0)) return null;
  const durMin = (s.end - s.start) / MIN;
  if (!(durMin > 0)) return null;
  let sigma: number;
  let method: 'har' | 'parkinson';
  if (model) {
    sigma = Math.sqrt(horizonStepSigmas(model, s.start, durMin).reduce((a, x) => a + x * x, 0));
    method = 'har';
  } else {
    // Tylko świece zamknięte przed `now` — trwająca zaniżałaby albo zawyżała zakres
    const closed = bars5m.filter((b) => b.time + FIVE_MIN <= now);
    sigma = parkinsonSigma(closed, durMin * 60, FIVE_MIN / 1000);
    method = 'parkinson';
  }
  const usd = RANGE_K * sigma * price;
  return Number.isFinite(usd) && usd > 0 ? { usd, method } : null;
}

/** Budżet zakresu: (high − low) / oczekiwany zakres; może przekroczyć 1. Brak oczekiwanego zakresu → NaN (widok: „—”). */
export function rangeBudget(hi: number, lo: number, expected: number): number {
  if (![hi, lo, expected].every(Number.isFinite) || !(expected > 0)) return Number.NaN;
  return (hi - lo) / expected;
}
