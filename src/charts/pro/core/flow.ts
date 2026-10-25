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

/**
 * Linia CVD z delty każdej świecy (`deltaAt(i)`, null = świeca bez danych): wartość na zamknięcie świecy, ten sam
 * podział na okresy i zerowanie po luce co świece CVD.
 */
export function cvdLine(times: readonly number[], deltaAt: (i: number) => number | null, mode: ResetMode): (number | null)[] {
  const out: (number | null)[] = [];
  let acc = 0;
  let period = Number.NaN;
  let broken = true;
  for (let i = 0; i < times.length; i++) {
    const p = periodStart(times[i], mode);
    if (p !== period) {
      period = p;
      acc = 0;
    }
    const d = deltaAt(i);
    if (d === null) {
      out.push(null);
      broken = true;
      continue;
    }
    if (broken) {
      acc = 0;
      broken = false;
    }
    acc += d;
    out.push(acc);
  }
  return out;
}

/**
 * Zmiana otwartych pozycji od początku okresu (sesja, doba, tydzień) na zamknięcie każdej świecy [t, t + ms), bieżąca
 * do `now`. `oiAt(chwila)` null = brak odczytu; po luce linia liczy od stanu na początku pierwszej świecy z odczytem.
 */
export function oiChangeLine(times: readonly number[], ms: number, now: number, oiAt: (time: number) => number | null, mode: ResetMode): (number | null)[] {
  const out: (number | null)[] = [];
  let base = Number.NaN;
  let period = Number.NaN;
  for (const t of times) {
    const p = periodStart(t, mode);
    if (p !== period) {
      period = p;
      base = Number.NaN;
    }
    const v = oiAt(Math.min(t + ms, now));
    if (v === null) {
      out.push(null);
      base = Number.NaN;
      continue;
    }
    if (Number.isNaN(base)) base = oiAt(t) ?? v;
    out.push(v - base);
  }
  return out;
}

/** Delta od ostatniego szczytu i od ostatniego dołka ceny do zamknięcia świecy (jednostki rynku). */
export function deltaFromExtremes(fp: FootprintBar): { fromHigh: number; fromLow: number } {
  return { fromHigh: fp.delta - fp.deltaAtHigh, fromLow: fp.delta - fp.deltaAtLow };
}

/**
 * Czy zmienione punkty serii wymagają pełnego `setData`: LWC 5.2 przy `update(punkt, true)`, który zamienia pusty punkt
 * (whitespace) starszej świecy na wartość, nadpisuje następny wiersz serii zamiast wstawić nowy — świece Delty i CVD
 * znikały, gdy historia taśmy dochodziła do starszych świec. Ostatnia świeca (zwykła aktualizacja) jest bezpieczna.
 */
export function flipsEmpty(changed: readonly number[], prevLen: number, emptyBefore: (i: number) => boolean, emptyNow: (i: number) => boolean): boolean {
  return changed.some((i) => i < prevLen - 1 && emptyBefore(i) !== emptyNow(i));
}
