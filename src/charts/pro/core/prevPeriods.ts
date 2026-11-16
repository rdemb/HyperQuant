import type { Candle } from '../hl/parse';
import { dayLevels } from './indicators';
import { utcDayStart, utcWeekStart } from './sessions';
import { DAY } from './time';

/**
 * Poprzednie maksima i minima doby, tygodnia i miesiąca UTC dla wskaźnika
 * „Struktura i płynność (SMC+HL)”. Tylko z okresów zamkniętych: wartość okresu jest znana od jego końca (`known` = koniec
 * okresu = początek bieżącego), więc świeca dzienna w trakcie nic nie zmienia. Doba z tej samej funkcji co warstwa
 * „Poziomy dnia” (`dayLevels`), tydzień od poniedziałku 00:00 UTC (`utcWeekStart`), miesiąc kalendarzowy UTC — oba
 * składane ze świec dziennych i tylko wtedy, gdy są wszystkie świece dzienne okresu (bez przybliżenia z części).
 */

export type PrevPeriod = 'day' | 'week' | 'month';
export const PREV_PERIODS: readonly PrevPeriod[] = ['day', 'week', 'month'];
/** Bit okresu w parametrze wskaźnika (suma bitów wybranych okresów). */
export const PREV_BIT: Readonly<Record<PrevPeriod, number>> = { day: 1, week: 2, month: 4 };
/** Skróty linii: szczyt i dołek poprzedniego okresu. */
export const PREV_NAMES: Readonly<Record<PrevPeriod, readonly [string, string]>> = { day: ['PDH', 'PDL'], week: ['PWH', 'PWL'], month: ['PMH', 'PML'] };

export interface PrevHighLow {
  period: PrevPeriod;
  /** Poprzedni okres [from, to); `to` to też chwila, od której wartości są znane. */
  from: number;
  to: number;
  hi: number;
  lo: number;
}

/** Brak wartości z powodem: brak świecy dziennej poprzedniej doby albo niepełny tydzień lub miesiąc. */
export interface PrevMissing {
  period: PrevPeriod;
  why: 'noDay' | 'partial';
  /** Świece dzienne okresu: są i powinno być. */
  have: number;
  need: number;
}

export type PrevRead = PrevHighLow | PrevMissing;

export const isPrevMissing = (r: PrevRead): r is PrevMissing => 'why' in r;

/** Okres `period` zawierający chwilę `t`. */
export function periodOf(period: PrevPeriod, t: number): { from: number; to: number } {
  if (period === 'day') {
    const from = utcDayStart(t);
    return { from, to: from + DAY };
  }
  if (period === 'week') {
    const from = utcWeekStart(t);
    return { from, to: from + 7 * DAY };
  }
  const d = new Date(t);
  return { from: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), to: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) };
}

/**
 * Szczyt i dołek okresu poprzedzającego okres z chwilą `asOf` ze świec dziennych `daily` (rosnąco, mogą kończyć się świecą
 * w trakcie — nie wchodzi, bo należy do bieżącego okresu).
 */
export function prevHighLow(daily: readonly Candle[], period: PrevPeriod, asOf: number): PrevRead {
  const cur = periodOf(period, asOf);
  const prev = periodOf(period, cur.from - 1);
  if (period === 'day') {
    // Ta sama funkcja co warstwa „Poziomy dnia”: szczyt i dołek świecy poprzedniej doby
    const d = dayLevels(daily).find((x) => x.t === cur.from);
    return d ? { period, from: prev.from, to: prev.to, hi: d.pdh, lo: d.pdl } : { period, why: 'noDay', have: 0, need: 1 };
  }
  const need = Math.round((prev.to - prev.from) / DAY);
  const seen = new Set<number>();
  let have = 0;
  let hi = Number.NEGATIVE_INFINITY;
  let lo = Number.POSITIVE_INFINITY;
  for (const c of daily) {
    if (c.t < prev.from || c.t >= prev.to) continue;
    if (seen.has(c.t) || c.t % DAY !== 0 || !(c.h >= c.l && c.l > 0)) continue;
    seen.add(c.t);
    have++;
    hi = Math.max(hi, c.h);
    lo = Math.min(lo, c.l);
  }
  if (have < need) return { period, why: 'partial', have, need };
  return { period, from: prev.from, to: prev.to, hi, lo };
}

/** Okresy z bitów parametru, tylko krótsze od interwału wykresu nie mają sensu: doba poniżej 1D, tydzień poniżej 1W. */
export function prevPeriodsOf(mask: number, chartMs: number): PrevPeriod[] {
  const len: Record<PrevPeriod, number> = { day: DAY, week: 7 * DAY, month: 28 * DAY };
  return PREV_PERIODS.filter((p) => (mask & PREV_BIT[p]) !== 0 && chartMs < len[p]);
}
