import type { DeskMarket } from '../config/deskMarkets.ts';
import { NYSE_CALENDAR, type NyseCalendar, wallStreetAt } from './wallStreet.ts';
import { underlyingAt } from './underlying.ts';

/**
 * Punkt odniesienia ruchu na Starcie (projekt 60, §8): BTC od 00:00 UTC; złoto od otwarcia bieżącej (albo ostatniej)
 * sesji CME o 18:00 ET; S&P 500 w sesji NYSE od otwarcia 9:30 ET, poza nią od ostatniego zamknięcia NYSE.
 * Czysta funkcja: czas w argumencie.
 */
export type AnchorKind = 'utc-day' | 'cme-open' | 'nyse-open' | 'nyse-close';
export interface SessionAnchor {
  t: number;
  kind: AnchorKind;
}

const MIN = 60_000;
const DAY = 86_400_000;

/** Ostatnia chwila ≤ `from`, w której `f` przeszło z wartości ≠ `want` na `want` (krok 5 min, potem minuta), do 10 dób wstecz. */
function lastEntry(from: number, f: (t: number) => boolean): number | null {
  const start = Math.floor(from / MIN) * MIN;
  const STEP = 5 * MIN;
  let t = start;
  // Gdy teraz poza stanem, najpierw cofnij się do jego ostatniego wystąpienia
  while (!f(t) && t > start - 10 * DAY) t -= STEP;
  for (; t > start - 10 * DAY; t -= STEP) {
    if (f(t - STEP)) continue;
    for (let u = t - STEP + MIN; u <= t; u += MIN) if (f(u)) return u;
    return t;
  }
  return null;
}

export function sessionAnchor(m: Pick<DeskMarket, 'underlying'>, now: number, cal: NyseCalendar | null = NYSE_CALENDAR): SessionAnchor | null {
  if (m.underlying.calendar === 'crypto') return { t: Math.floor(now / DAY) * DAY, kind: 'utc-day' };
  if (m.underlying.rth) {
    const open = (t: number) => wallStreetAt(t, cal).state === 'open';
    if (open(now)) {
      const t = lastEntry(now, open);
      return t === null ? null : { t, kind: 'nyse-open' };
    }
    // Ostatnie zamknięcie: pierwsza minuta po ostatniej minucie sesji
    const t = lastEntry(now, (x) => !open(x) && open(x - MIN));
    return t === null ? null : { t, kind: 'nyse-close' };
  }
  const t = lastEntry(now, (x) => underlyingAt(m, x, cal).state === 'open');
  return t === null ? null : { t, kind: 'cme-open' };
}
