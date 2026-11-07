/**
 * Sesja jako jednostka dnia tradera (spec §7.11): Londyn od 08:00 czasu londyńskiego do otwarcia NY, Nowy Jork od 09:30
 * czasu nowojorskiego do 00:00 UTC — granice (z czasem letnim) z `charts/pro/core/sessions`. IB = pierwsza godzina sesji.
 * Sesja azjatycka nie jest sesją handlową w tym sensie; doba UTC to tylko podsumowanie.
 *
 * Oczekiwany zakres sesji (MODEL) i budżet zakresu: ile oczekiwanego zakresu high-low sesja już zużyła.
 */
import { sessionOpens, utcDayStart } from '../charts/pro/core/sessions';
import { forecastHourlyVariances, isValidBar, parkinsonVar, stepSigmas, VOL_STEP_MIN, type VolModel } from './volatility';
import type { VBar } from './auction';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const FIVE_MIN = 5 * MIN;
/** Zapas Parkinsona: najmniej 12 zamkniętych świec 5m (1 h) z ostatniej doby, z najwyżej 60 ostatnich (5 h) */
const PARKINSON_MIN_BARS = 12;
const PARKINSON_LOOKBACK = 60;

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

const utcHour = (t: number) => new Date(t).getUTCHours();

/**
 * Wariancje kolejnych godzin zegarowych sesji od pełnej godziny ≤ start: godziny od pierwszej godziny prognozy h0
 * (`nextHourStartMs`) z prognozy HAR, godziny wcześniejsze (już minione, także cała sesja zamknięta przed h0) z poziomu
 * pierwszej godziny prognozy przeniesionego profilem sezonowym: hourVars[0] · f[godzina] / f[godzina h0]. Bez tego minione
 * godziny dostawałyby wariancję godziny h0 (obcięcie indeksu w `stepSigmas`), a wynik skakałby co godzinę.
 */
function sessionHourVars(m: VolModel, s: TradeSession): { first: number; vars: number[] } {
  const h0 = m.nextHourStartMs;
  const first = Math.floor(s.start / HOUR) * HOUR;
  const hours = Math.ceil((s.end - first) / HOUR);
  const fwd = forecastHourlyVariances(m.har, m.profile, h0, Math.max(1, Math.ceil((s.end - h0) / HOUR)));
  const f = m.profile.factors;
  const level = fwd[0] / f[utcHour(h0)];
  const vars: number[] = [];
  for (let k = 0; k < hours; k++) {
    const t = first + k * HOUR;
    vars.push(t < h0 ? level * f[utcHour(t)] : fwd[Math.round((t - h0) / HOUR)]);
  }
  return { first, vars };
}

/** σ Parkinsona sesji ze świec 5m: zamknięte przed `now`, z ostatniej doby, ≥ 12 (inaczej null), najwyżej 60 ostatnich. */
function parkinsonSessionSigma(bars5m: VBar[], now: number, durMin: number): number | null {
  const ok = bars5m.filter((b) => isValidBar(b) && b.time + FIVE_MIN <= now && b.time >= now - DAY).sort((a, b) => a.time - b.time);
  if (ok.length < PARKINSON_MIN_BARS) return null;
  const last = ok.slice(-PARKINSON_LOOKBACK);
  const varBar = last.reduce((a, b) => a + parkinsonVar(b), 0) / last.length;
  return Math.sqrt(varBar * (durMin / 5));
}

/**
 * Oczekiwany zakres high-low sesji w USD (MODEL): sqrt(8/π) · σ_sesji · cena. Z modelem σ_sesji² = Σ σ² kroków 5 min
 * od początku do końca sesji, z wariancji godzin `sessionHourVars` (prognoza HAR, minione godziny z profilem sezonowym);
 * bez modelu σ Parkinsona z ostatnich zamkniętych świec 5m (≥ 12 z ostatniej doby) przeskalowane do długości sesji.
 * Brak danych, zerowa zmienność albo cena niepoprawna → null (nigdy liczba zastępcza).
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
  let sigma: number | null;
  let method: 'har' | 'parkinson';
  if (model) {
    const { first, vars } = sessionHourVars(model, s);
    sigma = Math.sqrt(stepSigmas(vars, first, s.start, durMin, VOL_STEP_MIN).reduce((a, x) => a + x * x, 0));
    method = 'har';
  } else {
    sigma = parkinsonSessionSigma(bars5m, now, durMin);
    method = 'parkinson';
  }
  if (sigma === null) return null;
  const usd = RANGE_K * sigma * price;
  return Number.isFinite(usd) && usd > 0 ? { usd, method } : null;
}

/** Budżet zakresu: (high − low) / oczekiwany zakres; może przekroczyć 1. Brak oczekiwanego zakresu → NaN (widok: „—”). */
export function rangeBudget(hi: number, lo: number, expected: number): number {
  if (![hi, lo, expected].every(Number.isFinite) || !(expected > 0)) return Number.NaN;
  return (hi - lo) / expected;
}
