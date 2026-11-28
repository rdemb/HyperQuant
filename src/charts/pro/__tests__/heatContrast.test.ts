import { describe, expect, it } from 'vitest';
import { HEAT_CONTRAST, heatT } from '../chart/liquidity';
import { DEFAULT_SETTINGS, parseSettings } from '../chart/settings';

describe('kontrast mapy ciepła', () => {
  const norm = { lo: 10, span: 90 };

  it('poniżej progu przezroczysto, od górnego percentylu pełne nasycenie', () => {
    expect(heatT(5, norm, 1.6)).toBe(0);
    expect(heatT(100, norm, 1.6)).toBe(1);
    expect(heatT(500, norm, 1.6)).toBe(1);
    expect(heatT(50, { lo: 0, span: 0 }, 1.6)).toBe(0);
  });

  it('krzywa γ > 1 przygasza typowe poziomy, a ściany zostają jasne', () => {
    const mid = heatT(55, norm, 1); // połowa skali
    expect(mid).toBeCloseTo(0.5, 6);
    expect(heatT(55, norm, HEAT_CONTRAST.med.gamma)).toBeLessThan(0.35);
    expect(heatT(55, norm, HEAT_CONTRAST.soft.gamma)).toBeLessThan(heatT(55, norm, HEAT_CONTRAST.med.gamma));
    expect(heatT(97, norm, HEAT_CONTRAST.med.gamma)).toBeGreaterThan(0.9);
  });

  it('„mocny” to dawna skala (liniowa od 60. percentylu); słabsze kontrasty malują mniej poziomów', () => {
    expect(HEAT_CONTRAST.strong).toEqual({ loQ: 0.6, gamma: 1 });
    expect(HEAT_CONTRAST.med.loQ).toBeGreaterThan(HEAT_CONTRAST.strong.loQ);
    expect(HEAT_CONTRAST.soft.loQ).toBeGreaterThan(HEAT_CONTRAST.med.loQ);
  });
});

describe('ustawienie kontrastu w zapisie wykresu', () => {
  it('zapis bez pola: domyślny (średni) kontrast, bez dopisywania pola', () => {
    expect(parseSettings({}).heatContrast).toBeUndefined();
    expect('heatContrast' in parseSettings(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)))).toBe(false);
  });

  it('czyta znane wartości i pomija nieznane', () => {
    expect(parseSettings({ heatContrast: 'soft' }).heatContrast).toBe('soft');
    expect(parseSettings({ heatContrast: 'strong' }).heatContrast).toBe('strong');
    expect(parseSettings({ heatContrast: 'loud' }).heatContrast).toBeUndefined();
  });
});
