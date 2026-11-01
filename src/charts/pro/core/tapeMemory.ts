import type { Side } from '../hl/parse';
import { type OrderClass, classify } from './clashes';
import type { AggressorOrder } from './orders';
import type { TradeScan } from './ladder';

/**
 * Taśma z pamięcią: zlecenia agresora z taśmy, a podzlecenia TWAP (hash zerowy) tego samego biorcy i strony sklejone
 * w jeden wiersz, który rośnie z każdym plasterkiem (Hyperliquid wykonuje TWAP co 30 s, pomiar 31.10). Wiersz TWAP
 * przechodzi filtr wartości sumą, więc widać TWAP złożony z drobnych plasterków. Biorca powtarzający zlecenia w oknie
 * dostaje licznik. Adres biorcy zostaje w pamięci strony (klucz), wiersz go nie pokazuje.
 */

export type TapeRow =
  | { kind: 'order'; order: AggressorOrder; cls: OrderClass | null; repeat: number }
  | { kind: 'twap'; side: Side; first: number; last: number; slices: number; sz: number; usd: number; vwap: number; latest: AggressorOrder; taker: string };

/** Kolejny plasterek należy do tego samego TWAP, gdy od poprzedniego minęło najwyżej tyle ms (2,5 taktu po 30 s). */
export const TWAP_GAP_MS = 75_000;
/** Okno licznika powtórzeń biorcy. */
export const REPEAT_MS = 15 * 60_000;

/**
 * Wiersze taśmy z `orders` (od najnowszego), najwyżej `limit`, od wartości `minUsd`. Zlecenia bez biorcy (historia bez
 * kolumn kont) liczą się pojedynczo. `now` — chwila odniesienia okna powtórzeń.
 */
export function tapeRows(orders: readonly AggressorOrder[], minUsd: number, bigUsd: number, limit: number, now: number): TapeRow[] {
  const repeats = new Map<string, number>();
  for (const o of orders) {
    if (now - o.time > REPEAT_MS) break;
    if (o.taker && !o.zero) repeats.set(o.taker, (repeats.get(o.taker) ?? 0) + 1);
  }
  const rows: TapeRow[] = [];
  // Otwarte sklejenia TWAP po biorcy i stronie (przeglądamy od najnowszych, więc rośnie wstecz w czasie)
  const twaps = new Map<string, Extract<TapeRow, { kind: 'twap' }>>();
  const shown = new Set<Extract<TapeRow, { kind: 'twap' }>>();
  for (const o of orders) {
    if (o.zero && o.taker) {
      const k = `${o.taker}|${o.side}`;
      const g = twaps.get(k);
      if (g && g.first - o.time <= TWAP_GAP_MS) {
        g.vwap = (g.vwap * g.sz + o.vwap * o.sz) / (g.sz + o.sz);
        g.sz += o.sz;
        g.usd += o.notional;
        g.slices++;
        g.first = o.time;
      } else {
        const ng: Extract<TapeRow, { kind: 'twap' }> = { kind: 'twap', side: o.side, first: o.time, last: o.time, slices: 1, sz: o.sz, usd: o.notional, vwap: o.vwap, latest: o, taker: o.taker };
        twaps.set(k, ng);
        rows.push(ng);
      }
      continue;
    }
    if (o.notional < minUsd) continue;
    rows.push({ kind: 'order', order: o, cls: classify(o, bigUsd), repeat: o.taker && !o.zero ? (repeats.get(o.taker) ?? 0) : 0 });
    if (rows.length >= limit * 2) break;
  }
  const out: TapeRow[] = [];
  for (const r of rows) {
    if (r.kind === 'twap') {
      if (r.usd < minUsd || shown.has(r)) continue;
      shown.add(r);
    }
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

export interface TapePace {
  /** Wartość transakcji w ostatniej minucie (USD) i udział kupujących agresorów. */
  usd1m: number;
  buyShare: number;
  /** Mediana wartości minutowej z okna (USD); NaN przy zbyt krótkim nagraniu. */
  median: number;
  minutes: number;
}

/** Tempo taśmy: ostatnia minuta wobec mediany pełnych minut z ostatniej godziny (tylko minuty z nagraniem). */
export function tapePace(scan: TradeScan, now: number, covered: (from: number, to: number) => boolean): TapePace {
  let usd1m = 0;
  let buy = 0;
  scan(now - 60_000, now + 1, (_t, px, sz, side) => {
    usd1m += px * sz;
    if (side === 1) buy += px * sz;
  });
  const mins: number[] = [];
  const end = Math.floor(now / 60_000) * 60_000;
  for (let m = end - 60 * 60_000; m < end; m += 60_000) {
    if (!covered(m, m + 60_000)) continue;
    let v = 0;
    scan(m, m + 60_000, (_t, px, sz) => {
      v += px * sz;
    });
    mins.push(v);
  }
  mins.sort((a, b) => a - b);
  const median = mins.length >= 10 ? mins[Math.floor(mins.length / 2)] : Number.NaN;
  return { usd1m, buyShare: usd1m > 0 ? buy / usd1m : 0.5, median, minutes: mins.length };
}
