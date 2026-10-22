import { describe, expect, it } from 'vitest';
import {
  aciStep,
  quantileAtExt,
  brier,
  crpsQuantiles,
  isotonic,
  kupiec,
  normInv,
  normalSf,
  pinball,
  pitFromQuantiles,
  quantileAt,
  reliability,
  vennAbers,
} from '../forecastScore';

describe('rozkład normalny', () => {
  it('normInv odwraca dystrybuantę (Acklam, błąd względny < 1.2e-9)', () => {
    expect(normInv(0.5)).toBeCloseTo(0, 9);
    expect(normInv(0.975)).toBeCloseTo(1.959964, 5);
    expect(normInv(0.025)).toBeCloseTo(-1.959964, 5);
    expect(normInv(1e-6)).toBeCloseTo(-4.753424, 4);
  });
  it('normalSf zgodne z normInv', () => {
    expect(normalSf(normInv(0.9))).toBeCloseTo(0.1, 6); // erfc ~1e-7
  });
});

describe('reguły oceny kwantyli', () => {
  it('pinball: τ·(y−q) nad kwantylem, (1−τ)·(q−y) pod', () => {
    expect(pinball(0, 1, 0.9)).toBeCloseTo(0.9, 12);
    expect(pinball(0, -1, 0.9)).toBeCloseTo(0.1, 12);
  });

  it('CRPS z gęstej siatki kwantyli N(0,1) przy y = 0 ≈ 2φ(0) − 1/√π', () => {
    const taus = Array.from({ length: 199 }, (_, i) => (i + 1) / 200);
    const qs = taus.map(normInv);
    const exact = 2 / Math.sqrt(2 * Math.PI) - 1 / Math.sqrt(Math.PI);
    expect(crpsQuantiles(taus, qs, 0)).toBeCloseTo(exact, 2);
    expect(crpsQuantiles(taus, qs, 0)).toBeLessThan(crpsQuantiles(taus, qs, 2));
  });

  it('PIT: interpolacja liniowa po siatce, ogony przycięte do połowy skrajnego τ', () => {
    const taus = [0.1, 0.5, 0.9];
    const qs = [-1, 0, 1];
    expect(pitFromQuantiles(taus, qs, 0)).toBeCloseTo(0.5, 12);
    expect(pitFromQuantiles(taus, qs, 0.5)).toBeCloseTo(0.7, 12);
    expect(pitFromQuantiles(taus, qs, -5)).toBeCloseTo(0.05, 12);
    expect(pitFromQuantiles(taus, qs, 5)).toBeCloseTo(0.95, 12);
  });

  it('quantileAt: interpolacja i przycięcie do siatki', () => {
    expect(quantileAt([0.1, 0.9], [-1, 1], 0.5)).toBeCloseTo(0, 12);
    expect(quantileAt([0.1, 0.9], [-1, 1], 0.01)).toBe(-1);
  });
});

describe('kalibracja przedziałów', () => {
  it('Kupiec POF: zgodność z nominałem → p = 1, wyraźne przekroczenie → p bardzo małe', () => {
    expect(kupiec(1000, 100, 0.1)).toBeCloseTo(1, 9);
    expect(kupiec(1000, 150, 0.1)).toBeLessThan(1e-5);
    expect(kupiec(0, 0, 0.1)).toBeNull();
  });

  it('ACI: chybienie obniża α_t (szerszy przedział), trafienie lekko je podnosi; α_t może być ujemne', () => {
    // α_{t+1} = α_t + γ(α − err_t); err = 1 (chybienie) → α maleje → szerszy przedział
    expect(aciStep(0.1, 0.1, true, 0.01)).toBeCloseTo(0.1 + 0.01 * (0.1 - 1), 12);
    expect(aciStep(0.1, 0.1, false, 0.01)).toBeCloseTo(0.101, 12);
    // α_t może zejść poniżej 0 (przedział nieskończony — zawsze pokrywa; Gibbs & Candès) — bez przycinania do 0
    expect(aciStep(0.001, 0.1, true, 0.5)).toBeCloseTo(0.001 + 0.5 * (0.1 - 1), 12);
    expect(aciStep(-0.99, 0.1, true, 0.5)).toBe(-1); // zakres [−1, 2] chroni przed dryfem
  });
});

describe('prawdopodobieństwa zdarzeń', () => {
  it('isotonic (PAV): niemalejące dopasowanie z łączeniem naruszeń', () => {
    const fit = isotonic([1, 0, 1, 1, 0]);
    expect(fit.map((v) => Number(v.toFixed(4)))).toEqual([0.5, 0.5, 0.6667, 0.6667, 0.6667]);
  });

  it('Venn–Abers: przedział [p0, p1] obejmuje częstość w dobrze skalibrowanym zbiorze; scalone p w środku', () => {
    let seed = 5;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const cal = Array.from({ length: 4000 }, () => {
      const p = rnd();
      return { p, y: (rnd() < p ? 1 : 0) as 0 | 1 };
    });
    const r = vennAbers(cal, 0.3);
    expect(r.p0).toBeLessThanOrEqual(r.p1);
    expect(r.p0).toBeGreaterThan(0.2);
    expect(r.p1).toBeLessThan(0.4);
    expect(r.p).toBeGreaterThanOrEqual(r.p0);
    expect(r.p).toBeLessThanOrEqual(r.p1);
  });

  it('Venn–Abers: przy systematycznie zawyżonych p kalibracja je obniża', () => {
    const cal = Array.from({ length: 2000 }, (_, i) => ({ p: 0.6, y: (i % 5 === 0 ? 1 : 0) as 0 | 1 })); // faktycznie 20%
    const r = vennAbers(cal, 0.6);
    expect(r.p).toBeLessThan(0.3);
  });

  it('Brier i niezawodność w koszykach 10%', () => {
    const pairs: { p: number; y: 0 | 1 }[] = [
      { p: 0.05, y: 0 },
      { p: 0.15, y: 0 },
      { p: 0.95, y: 1 },
      { p: 0.92, y: 0 },
    ];
    expect(brier(pairs)).toBeCloseTo((0.05 ** 2 + 0.15 ** 2 + 0.05 ** 2 + 0.92 ** 2) / 4, 12);
    const rel = reliability(pairs, 10);
    expect(rel).toHaveLength(10);
    expect(rel[9]).toMatchObject({ n: 2, freq: 0.5 });
    expect(rel[0]).toMatchObject({ n: 1, freq: 0 });
    expect(rel[5]).toMatchObject({ n: 0, freq: null });
    expect(brier([])).toBeNull();
  });
});

describe('quantileAtExt — kwantyle poza siatką (ogony gaussowskie)', () => {
  const taus = [0.025, 0.05, 0.5, 0.95, 0.975];
  const qs = taus.map(normInv);
  it('w siatce = interpolacja; poza siatką ekstrapolacja w skali normalnej; τ ≤ 0 → −∞, τ ≥ 1 → +∞', () => {
    expect(quantileAtExt(taus, qs, 0.5)).toBeCloseTo(0, 9);
    expect(quantileAtExt(taus, qs, 0.005)).toBeCloseTo(normInv(0.005), 2);
    expect(quantileAtExt(taus, qs, 0.995)).toBeCloseTo(normInv(0.995), 2);
    expect(quantileAtExt(taus, qs, 0)).toBe(Number.NEGATIVE_INFINITY);
    expect(quantileAtExt(taus, qs, -0.1)).toBe(Number.NEGATIVE_INFINITY);
    expect(quantileAtExt(taus, qs, 1)).toBe(Number.POSITIVE_INFINITY);
  });
});
