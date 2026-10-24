import type { Candle, FundingPoint } from '../hl/parse';
import type { FootprintBar } from './footprintBar';

/**
 * Statystyki świec (tabela pod wykresem): wolumen z API, delta i jej ekstrema, liczba transakcji i tempo taśmy
 * z nagrania, zmiana otwartych pozycji z kanału activeAssetCtx (od otwarcia strony) i finansowanie z historii API
 * (bieżąca godzina — stawka prognozowana). Brak danych to null, nie zero.
 */

export const HOUR_MS = 3_600_000;

/** Stawka godzinowa → % w skali roku (jak w desku). */
export const fundingApr = (rate: number) => rate * 24 * 365 * 100;

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

  /** Ostatnia próbka nie późniejsza niż `time`; null przed pierwszą. */
  at(time: number): number | null {
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
    return k >= 0 ? this.v[k] : null;
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

/** Stawki finansowania z historii API po początku godziny, której dotyczą (wypłata na koniec godziny). */
export class FundingBook {
  private readonly byHour = new Map<number, number>();
  /** Najwcześniejsza godzina pobrana z API. */
  from = Number.POSITIVE_INFINITY;

  add(points: readonly FundingPoint[], from: number): void {
    // Czas wypłaty bywa kilka ms po pełnej godzinie — zaokrąglamy do najbliższej
    for (const p of points) this.byHour.set(Math.round(p.time / HOUR_MS) * HOUR_MS - HOUR_MS, p.rate);
    this.from = Math.min(this.from, from);
  }

  /**
   * Średnia stawka godzin, które obejmuje świeca [t, t + ms); godzina bez wypłaty (bieżąca) — stawka prognozowana `predicted`.
   * null, gdy żadna godzina świecy nie ma stawki.
   */
  rate(t: number, ms: number, now: number, predicted: number | null): number | null {
    let sum = 0;
    let n = 0;
    const end = Math.min(t + ms, now);
    for (let h = Math.floor(t / HOUR_MS) * HOUR_MS; h < Math.max(end, t + 1); h += HOUR_MS) {
      const r = this.byHour.get(h) ?? (h + HOUR_MS > now && predicted !== null ? predicted : undefined);
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
  /** Finansowanie, % w skali roku. */
  funding: number | null;
}

export type StatKey = keyof BarStat;

export interface StatBar {
  t: number;
  candle: Candle;
  fp: FootprintBar | null;
}

export function barStat(b: StatBar, ms: number, now: number, oi: OiLog, funding: FundingBook, predicted: number | null): BarStat {
  const fp = b.fp;
  const tapeVol = fp ? fp.buyVol + fp.sellVol : 0;
  const end = Math.min(b.t + ms, now);
  const secs = (end - b.t) / 1000;
  const o0 = oi.at(b.t);
  const o1 = o0 !== null && end > b.t ? oi.at(end) : null;
  const rate = funding.rate(b.t, ms, now, predicted);
  return {
    vol: b.candle.v,
    delta: fp ? fp.delta : null,
    deltaPct: fp && tapeVol > 0 ? (fp.delta / tapeVol) * 100 : null,
    maxDelta: fp ? fp.maxDelta : null,
    minDelta: fp ? fp.minDelta : null,
    trades: fp ? fp.trades : null,
    speed: fp && secs > 0 ? fp.trades / secs : null,
    doi: o0 !== null && o1 !== null ? o1 - o0 : null,
    funding: rate === null ? null : fundingApr(rate),
  };
}
