import { describe, expect, it } from 'vitest';
import { kyleFit } from '../indicators/registry';

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

describe('λ Kyle’a: wpływ przepływu agresora na cenę (Pionier §3.1)', () => {
  it('odtwarza znane λ = 2 pb na 1 mln USD i asymetrię kupna i sprzedaży', () => {
    const r = rng(1);
    const n = 120;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = gauss(r) * 3;
      // kupno rusza ceną mocniej (3 pb) niż sprzedaż (1 pb) na 1 mln USD
      ys[i] = (xs[i] > 0 ? 3 : 1) * xs[i] + gauss(r) * 2;
    }
    const f = kyleFit(xs, ys, n)!;
    expect(f.r2).toBeGreaterThan(f.floor);
    expect(f.lambda).toBeGreaterThan(1.5);
    expect(f.lambda).toBeLessThan(2.5);
    expect(f.buy!).toBeCloseTo(3, 0);
    expect(f.sell!).toBeCloseTo(1, 0);
  });

  it('dane SIM (losowy znak przepływu, bez wpływu): λ w granicach szumu w ≥ 95% okien', () => {
    const r = rng(20261116);
    const n = 60;
    let shown = 0;
    const windows = 2000;
    for (let w = 0; w < windows; w++) {
      const xs = Float64Array.from({ length: n }, () => gauss(r));
      const ys = Float64Array.from({ length: n }, () => gauss(r));
      const f = kyleFit(xs, ys, n);
      if (f && Number.isFinite(f.shown)) shown++;
    }
    expect(shown / windows).toBeLessThanOrEqual(0.06);
  });

  it('za mało świec z przepływem albo brak zmienności: brak wyniku', () => {
    expect(kyleFit(new Float64Array(10), new Float64Array(10), 10)).toBeNull();
    const xs = Float64Array.from({ length: 40 }, () => 1);
    expect(kyleFit(xs, Float64Array.from({ length: 40 }, (_, i) => i), 40)).toBeNull();
  });
});
