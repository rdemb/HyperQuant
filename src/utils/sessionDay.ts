/**
 * Sesja jako jednostka dnia tradera (spec §7.11): Londyn od 08:00 czasu londyńskiego do otwarcia NY, Nowy Jork od 09:30
 * czasu nowojorskiego do 00:00 UTC — granice (z czasem letnim) z `charts/pro/core/sessions`. IB = pierwsza godzina sesji.
 * Sesja azjatycka nie jest sesją handlową w tym sensie; doba UTC to tylko podsumowanie.
 *
 * Oczekiwany zakres sesji (MODEL „profil × poziom” ze świec 1h) i budżet zakresu: ile oczekiwanego zakresu high-low
 * sesja już zużyła.
 */
import { sessionOpens, utcDayStart } from '../charts/pro/core/sessions';
import type { VBar } from './auction';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

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
 * Stałe oczekiwanego zakresu sesji (profil godzin × świeży poziom), dopasowane na sesjach 2020–2023 i sprawdzone na
 * 2024–2026: skala 0,97 i wykładnik poziomu 0,60 wspólne dla Londynu i NY; mediana zakresu to ok. 0,87 średniego.
 */
export const EXPECTED_SCALE = 0.97;
export const LEVEL_BETA = 0.6;
export const TYPICAL_RATIO = 0.87;
/** Profil: 20 wcześniejszych dni tego samego typu (robocze albo sobota i niedziela UTC), szukane do 80 dni wstecz */
export const PROFILE_DAYS = 20;
export const PROFILE_LOOKBACK_DAYS = 80;
/** Poziom: 24 zamknięte godziny przed godziną startu sesji, x przycięte do ±1,5 */
export const LEVEL_HOURS = 24;
export const LEVEL_MIN_HOURS = 20;
const LEVEL_CLIP = 1.5;

/** Najwcześniejsza świeca 1h potrzebna do oceny sesji `s` (profil godzin poziomu sięga 80 dni przed dobą przed startem). */
export const expectedCandlesFrom = (s: TradeSession): number => Math.floor(s.start / HOUR) * HOUR - (PROFILE_LOOKBACK_DAYS + 1) * DAY;

/** Brak oczekiwanego zakresu: brak ceny sprzed otwarcia, za mało dni profilu albo godzin poziomu (tekst powodu: `expectedFrom`). */
export type ExpectationMissing = { missing: 'price' } | { missing: 'profile'; weekend: boolean } | { missing: 'level'; hours: number };

/** Oczekiwany zakres sesji: względny (`rel`), w USD od ceny sprzed otwarcia (`open`), typowy dzień, poziom `x`, wariancja `v`. */
export type SessionExpectation = { rel: number; usd: number; typical: number; open: number; x: number; v: number; method: 'profile' };

const isWeekend = (t: number) => {
  const d = new Date(t).getUTCDay();
  return d === 0 || d === 6;
};

/** Wariancja Parkinsona świecy: ln(H/L)² / (4 ln 2); świeca bez poprawnych cen → null. */
function pvOf(b: VBar | undefined): number | null {
  if (!b || !(b.low > 0) || !(b.high >= b.low)) return null;
  const r = Math.log(b.high / b.low);
  return (r * r) / (4 * Math.LN2);
}

/**
 * Oczekiwany zakres high-low sesji (MODEL „profil × poziom”), tylko ze świec 1h zamkniętych przed godziną startu sesji `a`:
 * 1. pv(u) = ln(H/L)² / (4 ln 2);
 * 2. profil prof(u) = średnia pv tej samej godziny UTC z 20 ostatnich wcześniejszych dni tego samego typu (sobota
 *    i niedziela UTC to weekend), szukane do 80 dni wstecz; mniej niż 20 → brak;
 * 3. poziom x = clip(½ ln(Σ pv / Σ prof), ±1,5) po 24 zamkniętych godzinach przed godziną zawierającą `a`;
 * 4. V = Σ w(h) · prof(h) po godzinach zegarowych sesji, w(h) — część godziny w sesji (NY: pierwsza z wagą 0,5);
 * 5. E = 0,97 · √(8/π) · √V · exp(0,60 · x), w USD razy cena sprzed otwarcia (zamknięcie ostatniej świecy przed godziną
 *    startu; dla NY pół godziny przed otwarciem), typowy dzień 0,87 · E.
 * Świece od godziny startu dalej są pomijane, więc E sesji nie zmienia się w jej trakcie ani po jej końcu.
 */
export function expectedSessionRange(candles1h: readonly VBar[], s: TradeSession): SessionExpectation | ExpectationMissing {
  const a0 = Math.floor(s.start / HOUR) * HOUR;
  const byHour = new Map<number, VBar>();
  for (const b of candles1h) if (b.time % HOUR === 0 && b.time + HOUR <= a0) byHour.set(b.time, b);
  const profCache = new Map<number, number | null>();
  const prof = (u: number): number | null => {
    if (profCache.has(u)) return profCache.get(u)!;
    const we = isWeekend(u);
    let sum = 0;
    let n = 0;
    for (let k = 1; k <= PROFILE_LOOKBACK_DAYS && n < PROFILE_DAYS; k++) {
      const t = u - k * DAY;
      if (isWeekend(t) !== we) continue;
      const v = pvOf(byHour.get(t));
      if (v === null) continue;
      sum += v;
      n++;
    }
    const out = n >= PROFILE_DAYS ? sum / n : null;
    profCache.set(u, out);
    return out;
  };
  const noProfile: ExpectationMissing = { missing: 'profile', weekend: isWeekend(s.start) };

  const last = byHour.get(a0 - HOUR);
  if (!last || !(last.close > 0)) return { missing: 'price' };

  let v = 0;
  for (let h = a0; h < s.end; h += HOUR) {
    const w = (Math.min(h + HOUR, s.end) - Math.max(h, s.start)) / HOUR;
    if (!(w > 0)) continue;
    const p = prof(h);
    if (p === null) return noProfile;
    v += w * p;
  }

  let sumPv = 0;
  let sumProf = 0;
  let hours = 0;
  for (let i = 1; i <= LEVEL_HOURS; i++) {
    const u = a0 - i * HOUR;
    const pv = pvOf(byHour.get(u));
    const p = prof(u);
    if (pv === null || p === null) continue;
    sumPv += pv;
    sumProf += p;
    hours++;
  }
  if (hours < LEVEL_MIN_HOURS || !(sumProf > 0)) return { missing: 'level', hours };
  const x = Math.max(-LEVEL_CLIP, Math.min(LEVEL_CLIP, 0.5 * Math.log(sumPv / sumProf)));
  const rel = EXPECTED_SCALE * RANGE_K * Math.sqrt(v) * Math.exp(LEVEL_BETA * x);
  if (!(Number.isFinite(rel) && rel > 0)) return noProfile;
  const usd = rel * last.close;
  return { rel, usd, typical: TYPICAL_RATIO * usd, open: last.close, x, v, method: 'profile' };
}

/** Budżet zakresu: (high − low) / oczekiwany zakres; może przekroczyć 1. Brak oczekiwanego zakresu → NaN (widok: „—”). */
export function rangeBudget(hi: number, lo: number, expected: number): number {
  if (![hi, lo, expected].every(Number.isFinite) || !(expected > 0)) return Number.NaN;
  return (hi - lo) / expected;
}
