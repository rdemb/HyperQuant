import { describe, expect, it } from 'vitest';
import { smcValueContext } from '../chart/smcLayer';
import type { SmcPremium } from '../chart/smcSelect';
import type { ValueRef } from '../core/valueReference';
const pd: SmcPremium = { lo: 100, hi: 200, eqLo: 147.5, eqHi: 152.5, pct: 0.2, zone: 'discount', known: 1, t: 1, hiT: 0, loT: 0 };
const ref: ValueRef = { kind: 'day', from: 0, to: 86400000, poc: 125, val: 110, vah: 140, source: 'candles', tapeShare: 0, bars: 288, through: 86400000, complete: true };
describe('SMC: wartość doby wobec stref', () => {
  it('odróżnia VA od POC i jawnie oznacza źródło', () => {
    expect(smcValueContext(pd, ref)).toContain('discount');
    expect(smcValueContext(pd, ref)).toContain('MODEL');
    expect(smcValueContext(pd, { ...ref, val: 110, vah: 180, poc: 175, source: 'tape' })).toMatch(/przecina strefy.*POC: premium.*LIVE/);
  });
  it('rozróżnia brak danych i wartości poza zakresem', () => {
    expect(smcValueContext(pd, null)).toContain('—');
    expect(smcValueContext(pd, { ...ref, poc: 210 })).toContain('POC: poza zakresem swingu');
  });
});
