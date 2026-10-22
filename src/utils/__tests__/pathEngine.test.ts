import { describe, expect, it } from 'vitest';
import { makeInnovation, mulberry32, seedFrom } from '../pathEngine';

describe('pathEngine — RNG i innowacje', () => {
  it('innowacje z reszt losują tylko wartości z próbki (bootstrap FHS)', () => {
    const draw = makeInnovation(mulberry32(5), [-1, 1]);
    for (let i = 0; i < 1000; i++) expect([-1, 1]).toContain(draw());
  });

  it('bez reszt: rozkład normalny — średnia ≈ 0, wariancja ≈ 1', () => {
    const draw = makeInnovation(mulberry32(5), null);
    let s = 0;
    let s2 = 0;
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      const z = draw();
      s += z;
      s2 += z * z;
    }
    const m = s / n;
    expect(Math.abs(m)).toBeLessThan(0.02);
    expect(s2 / n - m * m).toBeGreaterThan(0.97);
    expect(s2 / n - m * m).toBeLessThan(1.03);
  });

  it('seedFrom jest deterministyczny i rozróżnia wejścia', () => {
    expect(seedFrom(100000, 99000, 1)).toBe(seedFrom(100000, 99000, 1));
    expect(seedFrom(100000, 99000, 1)).not.toBe(seedFrom(100000, 99000, 2));
  });
});
