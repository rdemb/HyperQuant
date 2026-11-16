import { describe, expect, it } from 'vitest';
import { TAPE_MIN_OPTIONS, tapeMinUsdOf } from '../core/tapeFilter';

describe('próg taśmy w skali rynku', () => {
  it('BTC: progi bez zmian', () => {
    expect(TAPE_MIN_OPTIONS.map((v) => tapeMinUsdOf(v, 1))).toEqual([0, 10_000, 50_000, 100_000, 250_000, 1_000_000]);
  });

  it('rynek mniejszy (złoto, skala 0,12): „od 10 tys.” to 1,2 tys. USD, więc drobne zlecenia złota są na taśmie', () => {
    expect(tapeMinUsdOf(10_000, 0.12)).toBeCloseTo(1_200);
    expect(tapeMinUsdOf(0, 0.12)).toBe(0);
  });

  it('skala spoza (0, 1] albo nieliczbowa: jak BTC (bez cichego zera)', () => {
    expect(tapeMinUsdOf(10_000, Number.NaN)).toBe(10_000);
    expect(tapeMinUsdOf(10_000, 0)).toBe(10_000);
    expect(tapeMinUsdOf(10_000, 3)).toBe(10_000);
  });
});
