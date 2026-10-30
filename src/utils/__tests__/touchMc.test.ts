import { describe, expect, it } from 'vitest';
import { crossedLevels, forecastReturnQuantiles } from '../touchMc';
import { normInv } from '../forecastScore';

describe('forecastReturnQuantiles — kwantyle log-zwrotu z kroków σ', () => {
  it('innowacje normalne, stała σ: kwantyle ≈ −½σ² + σ·z_τ (martyngał ceny)', () => {
    const steps = Array(12).fill(0.002); // 12 kroków po 5 min, σ całkowite ≈ 0.69%
    const sTot = Math.sqrt(12) * 0.002;
    const taus = [0.025, 0.5, 0.975];
    const q = forecastReturnQuantiles(steps, null, taus, { paths: 20_000, seed: 7 });
    expect(q[1]).toBeCloseTo(-0.5 * sTot * sTot, 3);
    expect(q[2] / (sTot * normInv(0.975))).toBeGreaterThan(0.97);
    expect(q[2] / (sTot * normInv(0.975))).toBeLessThan(1.03);
    expect(q[0]).toBeLessThan(q[1]);
  });

  it('deterministyczne dla tego samego ziarna; kwantyle niemalejące', () => {
    const steps = Array(48).fill(0.0015);
    const taus = [0.05, 0.25, 0.5, 0.75, 0.95];
    const a = forecastReturnQuantiles(steps, null, taus, { seed: 42 });
    expect(forecastReturnQuantiles(steps, null, taus, { seed: 42 })).toEqual(a);
    for (let i = 1; i < a.length; i++) expect(a[i]).toBeGreaterThanOrEqual(a[i - 1]);
  });

  it('reszty FHS o grubszych ogonach dają szersze skrajne kwantyle przy tej samej σ', () => {
    const steps = Array(12).fill(0.002);
    // reszty standaryzowane (średnia 0, wariancja 1) z grubymi ogonami: mieszanina
    const fat = Float64Array.from({ length: 2000 }, (_, i) => (i % 20 === 0 ? (i % 40 === 0 ? 3.5 : -3.5) : ((i % 7) - 3) * 0.35));
    const m = fat.reduce((a, b) => a + b, 0) / fat.length;
    const sd = Math.sqrt(fat.reduce((a, b) => a + (b - m) ** 2, 0) / fat.length);
    const std = Float64Array.from(fat, (x) => (x - m) / sd);
    const qn = forecastReturnQuantiles(steps, null, [0.001, 0.999], { paths: 20_000, seed: 3 });
    const qf = forecastReturnQuantiles(steps, std, [0.001, 0.999], { paths: 20_000, seed: 3 });
    expect(qf[1] - qf[0]).toBeGreaterThan(qn[1] - qn[0]);
  });
});

describe('poziom już przekroczony: bez pozornej szansy dotknięcia', () => {
  it('cena nad PDH albo pod PDL (także równo na poziomie) oznacza przekroczenie', () => {
    expect(crossedLevels(80_000, 78_000, 79_000)).toEqual({ pdh: false, pdl: false });
    expect(crossedLevels(80_000, 78_000, 80_500)).toEqual({ pdh: true, pdl: false });
    expect(crossedLevels(80_000, 78_000, 78_000)).toEqual({ pdh: false, pdl: true });
  });

  it('brak poziomów albo ceny: nic nie jest przekroczone', () => {
    expect(crossedLevels(null, undefined, 79_000)).toEqual({ pdh: false, pdl: false });
    expect(crossedLevels(80_000, 78_000, Number.NaN)).toEqual({ pdh: false, pdl: false });
    expect(crossedLevels(80_000, 78_000, 0)).toEqual({ pdh: false, pdl: false });
  });
});
