import { describe, expect, it } from 'vitest';
import { whaleInks } from '../chart/overlay';
import { PRO, rgba } from '../chart/theme';

describe('wieloryby: przygaszenie starej migawki (plan 59, E8)', () => {
  it('po 2 min te same kolory stron z kryciem 0,5 (linie 0,22); świeża migawka bez zmian', () => {
    expect(whaleInks(true)).toEqual({
      long: rgba(PRO.buyInk, 0.5),
      short: rgba(PRO.sellInk, 0.5),
      longLine: rgba(PRO.buyInk, 0.22),
      shortLine: rgba(PRO.sellInk, 0.22),
      liq: rgba(PRO.warn, 0.5),
      liqLine: rgba(PRO.warn, 0.22),
    });
    expect(whaleInks(false).long).toBe(PRO.buyInk);
    expect(whaleInks(false).longLine).toBe(rgba(PRO.buyInk, 0.45));
  });
});
