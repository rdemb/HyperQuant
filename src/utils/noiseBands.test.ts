import { describe, expect, it } from 'vitest';
import { HURST_NOISE, OU_HALF_LIFE_MAX_BARS, hurstSide, ouReversionShown } from './noiseBands';
import { HURST_TREND_THRESHOLD } from './quantMathEngine';

describe('pasma szumu', () => {
  it('Hurst: wartości w paśmie 90% szumu nie są cechą rynku', () => {
    expect(hurstSide(0.5)).toBe('noise');
    expect(hurstSide(0.4)).toBe('noise');
    expect(hurstSide(0.59)).toBe('noise');
    expect(hurstSide(0.39)).toBe('anti');
    expect(hurstSide(0.6)).toBe('persist');
  });

  it('próg trendu reżimu leży poza pasmem szumu', () => {
    expect(HURST_TREND_THRESHOLD).toBeGreaterThan(HURST_NOISE.p95);
  });

  it('OU: t½ pokazany dopiero powyżej 95. percentyla θ pod błądzeniem', () => {
    expect(ouReversionShown(0)).toBe(false);
    expect(ouReversionShown(0.05)).toBe(false);
    expect(ouReversionShown(0.133)).toBe(false);
    expect(ouReversionShown(0.2)).toBe(true);
    expect(ouReversionShown(Number.NaN)).toBe(false);
    expect(OU_HALF_LIFE_MAX_BARS).toBeCloseTo(5.21, 2);
  });
});
