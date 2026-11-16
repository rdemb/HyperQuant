import { describe, expect, it } from 'vitest';
import { effortResult } from '../indicators/registry';

/** Generator z ziarnem (mulberry32): wynik testu nie zależy od przebiegu. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

function windowOf(seed: number, n: number, impact: (x: number) => number, noise = 1) {
  const r = rng(seed);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = gauss(r) * 3;
    ys[i] = impact(xs[i]) + gauss(r) * noise;
  }
  return { xs, ys, r };
}

describe('Wysiłek a wynik v2: ruch świecy wobec ruchu oczekiwanego z λ (Pionier F-C1)', () => {
  it('ruch zgodny z λ daje wynik bliski 0; ruch dużo mniejszy — ujemny (absorpcja), większy — dodatni', () => {
    const { xs, ys } = windowOf(1, 60, (x) => 2 * x);
    const same = effortResult(3, 6, xs, ys, 60)!;
    expect(same.expected).toBeCloseTo(6, 0);
    expect(Math.abs(same.z)).toBeLessThan(1);
    expect(effortResult(3, 0, xs, ys, 60)!.z).toBeLessThan(-4);
    expect(effortResult(3, 12, xs, ys, 60)!.z).toBeGreaterThan(4);
  });

  it('strona przepływu wybiera swoje λ: sprzedaż z λ sprzedaży, nie ze wspólnego', () => {
    const { xs, ys } = windowOf(2, 120, (x) => (x > 0 ? 3 : 1) * x, 0.5);
    const sell = effortResult(-2, -2, xs, ys, 120)!;
    expect(sell.lambda).toBeCloseTo(1, 0);
    expect(Math.abs(sell.z)).toBeLessThan(1.5);
    const buy = effortResult(2, 6, xs, ys, 120)!;
    expect(buy.lambda).toBeCloseTo(3, 0);
    expect(Math.abs(buy.z)).toBeLessThan(1.5);
  });

  it('λ w granicach szumu (brak wpływu): brak wyniku', () => {
    const { xs, ys } = windowOf(3, 60, () => 0);
    // na danych bez wpływu wynik może pojawić się tylko w ok. 5% okien; to okno sprawdzone jako szum
    let none = 0;
    for (let s = 0; s < 200; s++) {
      const w = windowOf(100 + s, 60, () => 0);
      if (effortResult(1, 1, w.xs, w.ys, 60) === null) none++;
    }
    expect(none / 200).toBeGreaterThanOrEqual(0.9);
    expect(xs.length).toBe(60);
  });

  it('kalibracja na SIM ze znanym λ: |wynik| > 2 w 2–9% świec', () => {
    let big = 0;
    let shown = 0;
    for (let s = 0; s < 2000; s++) {
      const { xs, ys, r } = windowOf(5000 + s, 60, (x) => 2 * x);
      const x = gauss(r) * 3;
      const f = effortResult(x, 2 * x + gauss(r), xs, ys, 60);
      if (!f) continue;
      shown++;
      if (Math.abs(f.z) > 2) big++;
    }
    expect(shown).toBeGreaterThan(1900);
    expect(big / shown).toBeGreaterThan(0.02);
    expect(big / shown).toBeLessThan(0.09);
  });

  it('świeca bez przepływu (x = 0) i za mało świec: brak wyniku', () => {
    const { xs, ys } = windowOf(4, 60, (x) => 2 * x);
    expect(effortResult(0, 1, xs, ys, 60)).toBeNull();
    expect(effortResult(1, 1, xs, ys, 10)).toBeNull();
  });
});
