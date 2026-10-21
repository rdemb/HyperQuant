import { describe, expect, it } from 'vitest';
import { HEAT_RAMP, buildHeatLut, heatT, unpackRgba } from '../heatColor';
import { HistQuantile } from '../quantile';

describe('HistQuantile', () => {
  it('percentyl 99 z histogramu (dokładność do szerokości kubełka)', () => {
    const h = new HistQuantile(0, 10, 1000);
    for (let i = 1; i <= 100; i++) h.add(Math.log1p(i));
    // 99. wartość z 100 → log1p(99) ≈ 4.605
    expect(h.quantile(0.99)).toBeCloseTo(Math.log1p(99), 1);
    expect(h.count).toBe(100);
    h.reset();
    expect(h.count).toBe(0);
    expect(h.quantile(0.99)).toBeNaN();
  });

  it('wartości spoza zakresu trafiają do skrajnych kubełków', () => {
    const h = new HistQuantile(0, 1, 10);
    h.add(-5);
    h.add(50);
    expect(h.quantile(0)).toBeLessThanOrEqual(0.1);
    expect(h.quantile(1)).toBe(1);
  });
});

describe('normalizacja intensywności (log1p, percentyl 99, kontrast)', () => {
  const norm = Math.log1p(60); // p99 = 60 BTC
  it('0 BTC → 0; ≥ p99 → 1; monotonicznie', () => {
    expect(heatT(0, norm, 1)).toBe(0);
    expect(heatT(60, norm, 1)).toBeCloseTo(1, 9);
    expect(heatT(500, norm, 1)).toBe(1);
    expect(heatT(5, norm, 1)).toBeLessThan(heatT(10, norm, 1));
  });
  it('kontrast > 1 rozjaśnia słabsze poziomy', () => {
    expect(heatT(5, norm, 2)).toBeCloseTo(2 * heatT(5, norm, 1), 9);
  });
  it('brak normy (NaN/0) → 0 zamiast NaN', () => {
    expect(heatT(5, 0, 1)).toBe(0);
    expect(heatT(5, Number.NaN, 1)).toBe(0);
  });
});

describe('rampa heatmapy', () => {
  it('zaczyna od przezroczystości, kończy na #fff4dc (ściany)', () => {
    const lut = buildHeatLut();
    expect(lut.length).toBe(256);
    expect(unpackRgba(lut[0])[3]).toBe(0);
    expect(unpackRgba(lut[255])).toEqual([0xff, 0xf4, 0xdc, 255]);
    expect(HEAT_RAMP.map((s) => s.color)).toEqual(['#0b1019', '#121c33', '#1e4a7a', '#3fc6dd', '#e0a045', '#fff4dc']);
  });
});
