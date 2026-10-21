import { describe, expect, it } from 'vitest';
import { Frame, bucketFor, priceTickStep, priceToY, timeStep, timeToX, xToTime, yToPrice } from '../scales';

const f: Frame = { t0: 1_000_000, t1: 1_060_000, x0: 0, x1: 600, pMin: 99_900, pMax: 100_100, y0: 10, y1: 410 };

describe('skale cena ↔ piksel i czas ↔ piksel', () => {
  it('mapuje krawędzie i środek', () => {
    expect(timeToX(f, 1_000_000)).toBe(0);
    expect(timeToX(f, 1_060_000)).toBe(600);
    expect(timeToX(f, 1_030_000)).toBe(300);
    expect(priceToY(f, 100_100)).toBe(10);
    expect(priceToY(f, 99_900)).toBe(410);
    expect(priceToY(f, 100_000)).toBe(210);
  });

  it('odwzorowania są odwrotne', () => {
    for (const t of [1_000_123, 1_045_678]) expect(xToTime(f, timeToX(f, t))).toBeCloseTo(t, 6);
    for (const p of [99_912.5, 100_077]) expect(yToPrice(f, priceToY(f, p))).toBeCloseTo(p, 6);
  });
});

describe('podziałki osi', () => {
  it('krok ceny: „ładny” i z odstępem ≥ minGap', () => {
    // 200 USD na 400 px, min 36 px → ≥ 18 USD → 20
    expect(priceTickStep(200, 400, 36)).toBe(20);
    expect(priceTickStep(3000, 500, 40)).toBe(250);
  });

  it('krok czasu: 60 s na 600 px przy min 90 px → 10 s', () => {
    expect(timeStep(60_000, 600, 90)).toBe(10_000);
    expect(timeStep(2 * 3600_000, 1000, 90)).toBe(15 * 60_000);
  });

  it('kubełek wyświetlania: wielokrotność bazy z wierszem ≥ minRowPx', () => {
    // 300 USD na 520 px → 5 USD = 8.7 px < 13 → 10 USD = 17 px
    expect(bucketFor(300, 520, 13, 5)).toBe(10);
    expect(bucketFor(3000, 520, 13, 5)).toBe(100);
    expect(bucketFor(50, 520, 13, 5)).toBe(5);
  });
});
