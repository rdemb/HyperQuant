import { describe, expect, it } from 'vitest';
import { addIndicator, familyColor, indicatorDef } from '../indicators/registry';
import { inds } from '../chart/templates';

describe('kolory rodzin wskaźników (plan 59, G2)', () => {
  it('RVOL jako trzeci wskaźnik dalej dostaje fiolet zmienności (kolor znaczenia, nie kolejności)', () => {
    let list = addIndicator([], 'ema');
    list = addIndicator(list, 'sma');
    list = addIndicator(list, 'rvol');
    expect(list[2].color).toBe('#9085E9');
  });

  it('rodziny: zmienność, skład przepływu, koszt (ask i bid), poziomy; klasyczne bez koloru rodziny', () => {
    for (const id of ['rvol', 'regime', 'hawkes', 'cone'] as const) expect(familyColor(id), id).toBe('#9085E9');
    for (const id of ['repeat', 'ordersize'] as const) expect(familyColor(id), id).toBe('#5CE4D5');
    for (const id of ['pbrange', 'effort'] as const) expect(familyColor(id), id).toBe('#E0A045');
    expect(familyColor('slippage')).toBe('#B4C6DB');
    expect(indicatorDef('slippage').plots.find((p) => p.title === 'bid')?.color).toBe('#7A889C');
    expect(familyColor('ema')).toBeNull();
  });

  it('gotowe układy (inds) używają tych samych kolorów rodzin', () => {
    expect(inds(['ema'], ['rvol'], ['ordersize']).map((x) => [x.id, x.color])).toEqual([
      ['ema', expect.any(String)],
      ['rvol', '#9085E9'],
      ['ordersize', '#5CE4D5'],
    ]);
  });
});
