import type { FootprintBar } from './footprintBar';
import { ResetMode, periodStart } from './sessions';

/**
 * Świece delty i CVD z footprintu. Świeca delty: otwarcie 0, maksimum i minimum delty w trakcie świecy,
 * zamknięcie = delta. Świeca CVD: to samo przesunięte o CVD z początku świecy. CVD zeruje się na początku
 * okresu (sesja, doba, tydzień) i po świecy bez taśmy — suma nie przeskakuje luki, której nie widzieliśmy.
 */

export interface Ohlc {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface FlowInput {
  t: number;
  fp: FootprintBar | null;
}

export function deltaCandle(fp: FootprintBar): Ohlc {
  return { open: 0, high: fp.maxDelta, low: fp.minDelta, close: fp.delta };
}

/** Świece CVD (null dla świecy bez taśmy) — wejście rosnąco po czasie. */
export function cvdCandles(bars: readonly FlowInput[], mode: ResetMode): (Ohlc | null)[] {
  const out: (Ohlc | null)[] = [];
  let acc = 0;
  let period = Number.NaN;
  let broken = true;
  for (const b of bars) {
    const p = periodStart(b.t, mode);
    if (p !== period) {
      period = p;
      acc = 0;
    }
    if (!b.fp) {
      out.push(null);
      broken = true;
      continue;
    }
    if (broken) {
      acc = 0;
      broken = false;
    }
    const fp = b.fp;
    out.push({ open: acc, high: acc + fp.maxDelta, low: acc + fp.minDelta, close: acc + fp.delta });
    acc += fp.delta;
  }
  return out;
}

/** Delta od ostatniego szczytu i od ostatniego dołka ceny do zamknięcia świecy (jednostki rynku). */
export function deltaFromExtremes(fp: FootprintBar): { fromHigh: number; fromLow: number } {
  return { fromHigh: fp.delta - fp.deltaAtHigh, fromLow: fp.delta - fp.deltaAtLow };
}
