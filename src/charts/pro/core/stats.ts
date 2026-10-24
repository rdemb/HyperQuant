import type { Candle, FundingPoint } from '../hl/parse';
import type { FootprintBar } from './footprintBar';

/**
 * Tablica liczb (tabela pod wykresem): wolumen z API, delta i jej ekstrema, liczba transakcji i tempo taśmy
 * z nagrania, zmiana otwartych pozycji z kanału activeAssetCtx (od otwarcia strony) i finansowanie z historii API
 * (bieżąca godzina — stawka prognozowana), a w grupach Binance i Bybit delta, ΔOI i finansowanie tych giełd.
 * Brak danych to null, nie zero.
 */

export const HOUR_MS = 3_600_000;

/** Średnia stawka godzinowa → % na 8 h (jak na Binance i Bybit; Hyperliquid rozlicza co godzinę). */
export const fundingPct8h = (hourly: number) => hourly * 8 * 100;

/** Grupy wierszy Tablicy liczb: Hyperliquid, taśma Hyperliquid, Binance, Bybit. */
export type StatGroup = 'hl' | 'tape' | 'binance' | 'bybit';
export const STAT_GROUPS: readonly StatGroup[] = ['hl', 'tape', 'binance', 'bybit'];
/** Grupy z danymi giełd scentralizowanych (połączenia przeglądarki czytelnika, tylko gdy grupa jest włączona). */
export const VENUE_GROUPS: readonly StatGroup[] = ['binance', 'bybit'];

/** Próbki otwartych pozycji (w jednostkach monety) rosnąco po czasie. */
export class OiLog {
  private t: number[] = [];
  private v: number[] = [];

  push(time: number, oi: number): void {
    if (!(oi > 0) || !(time > 0)) return;
    const n = this.t.length;
    if (n > 0 && time <= this.t[n - 1]) {
      if (time === this.t[n - 1]) this.v[n - 1] = oi;
      return;
    }
    this.t.push(time);
    this.v.push(oi);
  }

  /** Próbki z historii serwera, scalone po czasie (ta sama chwila — zostaje istniejąca). */
  restore(points: readonly (readonly [number, number])[]): void {
    if (points.length === 0) return;
    const m = new Map<number, number>();
    for (const [t, v] of points) if (v > 0 && t > 0) m.set(t, v);
    for (let i = 0; i < this.t.length; i++) m.set(this.t[i], this.v[i]);
    this.t = [...m.keys()].sort((a, b) => a - b);
    this.v = this.t.map((t) => m.get(t)!);
  }

  /** Ostatnia próbka nie późniejsza niż `time`; null przed pierwszą. */
  at(time: number): number | null {
    const k = this.indexAt(time);
    return k >= 0 ? this.v[k] : null;
  }

  /** Jak `at`, ale próbka starsza niż `maxAgeMs` względem `time` się nie liczy (przerwa w danych). */
  atWithin(time: number, maxAgeMs: number): number | null {
    const k = this.indexAt(time);
    return k >= 0 && time - this.t[k] <= maxAgeMs ? this.v[k] : null;
  }

  private indexAt(time: number): number {
    let lo = 0;
    let hi = this.t.length - 1;
    let k = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.t[mid] <= time) {
        k = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return k;
  }

  prune(before: number): void {
    // Zostawiamy ostatnią próbkę sprzed granicy — jest stanem na początku zachowanego okresu
    let i = 0;
    while (i + 1 < this.t.length && this.t[i + 1] <= before) i++;
    if (i > 0) {
      this.t = this.t.slice(i);
      this.v = this.v.slice(i);
    }
  }
}

/**
 * Stawki finansowania z historii API po początku godziny, której dotyczą (wypłata na koniec godziny). Giełda
 * rozliczająca co kilka godzin (Binance co 8 albo 4 h) dopisuje stawkę godzinową każdej godziny okresu (`addPeriods`).
 */
export class FundingBook {
  private readonly byHour = new Map<number, number>();
  /** Najwcześniejsza godzina pobrana z API. */
  from = Number.POSITIVE_INFINITY;
  /** Ostatnia godzina z rozliczoną stawką. */
  latest = Number.NEGATIVE_INFINITY;
  /** Okres rozliczenia (ms): godziny po ostatniej wypłacie, ale z okresu jeszcze nierozliczonego, dostają prognozę. */
  periodMs = HOUR_MS;

  add(points: readonly FundingPoint[], from: number): void {
    for (const p of points) {
      // Czas wypłaty bywa kilka ms po pełnej godzinie — zaokrąglamy do najbliższej
      const h = Math.round(p.time / HOUR_MS) * HOUR_MS - HOUR_MS;
      this.byHour.set(h, p.rate);
      this.latest = Math.max(this.latest, h);
    }
    this.from = Math.min(this.from, from);
  }

  /** Wypłaty co `hours` godzin (czas wypłaty, stawka okresu): każda godzina okresu dostaje stawkę / `hours`. */
  addPeriods(points: readonly { time: number; rate: number }[], hours: number, from: number): void {
    this.periodMs = hours * HOUR_MS;
    const hourly: FundingPoint[] = [];
    for (const p of points) for (let k = 0; k < hours; k++) hourly.push({ time: p.time - k * HOUR_MS, rate: p.rate / hours, premium: 0 });
    this.add(hourly, from);
  }

  /**
   * Średnia stawka godzin, które obejmuje świeca [t, t + ms). Godzina bez wypłaty — bieżąca albo poprzednia, której rozliczenie
   * jeszcze nie dotarło — dostaje stawkę prognozowaną `predicted`. null, gdy żadna godzina świecy nie ma stawki.
   */
  rate(t: number, ms: number, now: number, predicted: number | null): number | null {
    let sum = 0;
    let n = 0;
    const end = Math.min(t + ms, now);
    for (let h = Math.floor(t / HOUR_MS) * HOUR_MS; h < Math.max(end, t + 1); h += HOUR_MS) {
      const pending = h + HOUR_MS > now || (h > this.latest && h + this.periodMs + HOUR_MS > now);
      const r = this.byHour.get(h) ?? (pending && predicted !== null ? predicted : undefined);
      if (r === undefined) continue;
      sum += r;
      n++;
    }
    return n > 0 ? sum / n : null;
  }
}

export interface BarStat {
  vol: number;
  delta: number | null;
  /** Delta jako % wolumenu z taśmy. */
  deltaPct: number | null;
  maxDelta: number | null;
  minDelta: number | null;
  trades: number | null;
  /** Transakcje na sekundę w czasie świecy (bieżąca: od początku do teraz). */
  speed: number | null;
  /** Zmiana otwartych pozycji w świecy (jednostki monety). */
  doi: number | null;
  /** Finansowanie, % na 8 h. */
  funding: number | null;
  /** Binance: delta perp i spot, zmiana OI, finansowanie (% na 8 h). */
  bnDelta: number | null;
  bnSpotDelta: number | null;
  bnDoi: number | null;
  bnFunding: number | null;
  /** Bybit: delta (z transakcji od otwarcia strony) i zmiana OI. */
  byDelta: number | null;
  byDoi: number | null;
}

export type StatKey = keyof BarStat;

export interface StatBar {
  t: number;
  candle: Candle;
  fp: FootprintBar | null;
}

/** Odczyty Binance i Bybit dla świecy o początku `t` (null bez danych); `funding` — średnia stawka godzinowa świecy. */
export interface VenueReads {
  delta(venue: 'binance' | 'binanceSpot' | 'bybit', t: number): number | null;
  oi(venue: 'binance' | 'bybit', t: number): number | null;
  funding(t: number): number | null;
}

const oiChange = (oiAt: (t: number) => number | null, t: number, end: number): number | null => {
  const o0 = oiAt(t);
  const o1 = o0 !== null && end > t ? oiAt(end) : null;
  return o0 !== null && o1 !== null ? o1 - o0 : null;
};

export function barStat(b: StatBar, ms: number, now: number, oi: OiLog, funding: FundingBook, predicted: number | null, venue: VenueReads | null = null): BarStat {
  const fp = b.fp;
  const tapeVol = fp ? fp.buyVol + fp.sellVol : 0;
  const end = Math.min(b.t + ms, now);
  const secs = (end - b.t) / 1000;
  const rate = funding.rate(b.t, ms, now, predicted);
  const bnRate = venue ? venue.funding(b.t) : null;
  return {
    vol: b.candle.v,
    delta: fp ? fp.delta : null,
    deltaPct: fp && tapeVol > 0 ? (fp.delta / tapeVol) * 100 : null,
    maxDelta: fp ? fp.maxDelta : null,
    minDelta: fp ? fp.minDelta : null,
    trades: fp ? fp.trades : null,
    speed: fp && secs > 0 ? fp.trades / secs : null,
    doi: oiChange((t) => oi.at(t), b.t, end),
    funding: rate === null ? null : fundingPct8h(rate),
    bnDelta: venue ? venue.delta('binance', b.t) : null,
    bnSpotDelta: venue ? venue.delta('binanceSpot', b.t) : null,
    bnDoi: venue ? oiChange((t) => venue.oi('binance', t), b.t, end) : null,
    bnFunding: bnRate === null ? null : fundingPct8h(bnRate),
    byDelta: venue ? venue.delta('bybit', b.t) : null,
    byDoi: venue ? oiChange((t) => venue.oi('bybit', t), b.t, end) : null,
  };
}
