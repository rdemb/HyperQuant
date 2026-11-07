import { describe, expect, it } from 'vitest';
import * as layoutNumbers from '../../charts/pro/chart/layoutNumbers';
import * as marketState from '../../charts/pro/chart/marketState';
import type { Candle } from '../../charts/pro/hl/parse';
import { dayVwapOf, vwapSigma } from '../dayVwap';

const MIN = 60_000;
const DAY0 = Date.UTC(2026, 10, 4);
const NOW = DAY0 + 15 * 60 * MIN;

const c = (t: number, px: number, v = 1): Candle => ({ t, o: px, h: px + 10, l: px - 10, c: px, v, n: 1 });

describe('dayVwap: VWAP doby UTC i odległość w σ poza modułami wykresu', () => {
  it('import ze starego miejsca (nagłówek układu, Stan rynku) daje tę samą funkcję', () => {
    expect(layoutNumbers.dayVwapOf).toBe(dayVwapOf);
    expect(marketState.vwapSigma).toBe(vwapSigma);
  });

  it('dayVwapOf: tylko świece od 00:00 UTC do teraz, ważone wolumenem; bez początku doby — powód', () => {
    // Świeca sprzed doby i po `now` nie wchodzą; 100 000 × 1 i 100 300 × 2 → (100 000 + 200 600) / 3 = 100 200
    const bars = [c(DAY0 - MIN, 90_000), c(DAY0, 100_000, 1), c(DAY0 + MIN, 100_300, 2), c(NOW + MIN, 120_000)];
    const v = dayVwapOf(bars, NOW);
    if ('why' in v) throw new Error(v.why);
    expect(v.vwap).toBeCloseTo(100_200, 6);
    expect(v.sd).toBeGreaterThan(0);
    expect(dayVwapOf(bars.slice(2), NOW)).toMatchObject({ why: expect.stringContaining('00:00 UTC') });
    expect(dayVwapOf([], NOW)).toMatchObject({ why: expect.any(String) });
  });

  it('vwapSigma: odległość w σ zaokrąglona do 0,1; σ z szumu albo brak liczby — null', () => {
    expect(vwapSigma(100_120, 100_000, 100)).toBe(1.2);
    expect(vwapSigma(99_954, 100_000, 100)).toBe(-0.5);
    expect(vwapSigma(100_000, 100_000, 1e-9)).toBeNull();
    expect(vwapSigma(Number.NaN, 100_000, 100)).toBeNull();
  });
});
