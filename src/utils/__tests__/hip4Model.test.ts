import { describe, expect, it } from 'vitest';
import { horizonSigmas, modelProbabilities } from '../hip4Model';
import { buildVolModel, type RangeBar } from '../volatility';
import type { BtcOutcome } from '../hip4';

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.UTC(2026, 9, 22, 12, 0);

function bars(n: number, stepMs: number, end: number, sigma: number, seed = 1): RangeBar[] {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let px = 100_000;
  return Array.from({ length: n }, (_, k) => {
    const t = end - (n - k) * stepMs;
    const o = px;
    const c = o * Math.exp(sigma * (rnd() - 0.5) * 3.4);
    px = c;
    return { time: t, open: o, high: Math.max(o, c) * (1 + sigma * rnd()), low: Math.min(o, c) * (1 - sigma * rnd()), close: c };
  });
}

const q = (id: number, kind: 'above' | 'touch', K: number, expiry: number): BtcOutcome => ({
  id,
  kind,
  K,
  expiry,
  source: 'mark',
  seconds: null,
  recurring: false,
  coin: `#${id * 10}`,
  description: '',
});

describe('modelProbabilities — prawdopodobieństwa modelu dla rynków HIP-4', () => {
  const model = buildVolModel(bars(1200, HOUR, NOW, 0.004), bars(2000, 5 * MIN, NOW, 0.0015, 7), NOW)!;

  it('krótki horyzont ma dokładną długość: wariancja ∝ minutom (ostatni krok częściowy, nie zaokrąglony do 5 min)', () => {
    const now = NOW - 2 * HOUR + 10 * MIN; // w obrębie jednej godziny prognozy (stała wariancja godzinowa)
    const v = (h: number) => horizonSigmas(model, now, h).reduce((a, s) => a + s * s, 0);
    expect(v(2) / v(5)).toBeCloseTo(0.4, 9);
    expect(v(7) / v(5)).toBeCloseTo(1.4, 9);
    expect(v(8) / v(5)).toBeCloseTo(1.6, 9);
  });

  it('bez modelu albo ceny → same null', () => {
    expect(modelProbabilities([q(1, 'above', 100_000, NOW + HOUR)], null, 100_000, NOW)).toEqual([null]);
    expect(modelProbabilities([q(1, 'above', 100_000, NOW + HOUR)], model, 0, NOW)).toEqual([null]);
  });

  it('w zasięgu (≤ 14 dni) — wartości w (0, 1), malejące z progiem; dalej — null', () => {
    const p = modelProbabilities(
      [q(1, 'above', 99_000, NOW + 18 * HOUR), q(2, 'above', 101_000, NOW + 18 * HOUR), q(3, 'touch', 105_000, NOW + 20 * 24 * HOUR)],
      model,
      100_000,
      NOW
    );
    expect(p[0]!).toBeGreaterThan(p[1]!);
    expect(p[0]!).toBeLessThan(1);
    expect(p[1]!).toBeGreaterThan(0);
    expect(p[2]).toBeNull();
  });
});
