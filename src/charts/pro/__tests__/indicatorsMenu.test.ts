import { describe, expect, it } from 'vitest';
import { INDICATORS, menuEntries, parseIndicators } from '../indicators/registry';

const FRONT = ['oiflow', 'absorption', 'breadth', 'repeat', 'makers', 'twap', 'slippage', 'ofi', 'ordersize'];
const SECOND = ['cone', 'outcomes', 'regime', 'hawkes', 'pbrange'];
const CLASSIC = ['ema', 'sma', 'vwma', 'atr', 'bb', 'keltner', 'pivots'];

describe('menu wskaźników', () => {
  it('przybliżenia wolumenu usunięte z rejestru', () => {
    for (const id of ['obv', 'cmf', 'mfi', 'netvol']) expect(INDICATORS.find((d) => d.id === id)).toBeUndefined();
  });

  it('warstwy menu: front, second i classic w ustalonej kolejności', () => {
    expect(menuEntries('front').map((d) => d.id)).toEqual(FRONT);
    expect(menuEntries('second').map((d) => d.id)).toEqual(SECOND);
    expect(menuEntries('classic').map((d) => d.id).sort()).toEqual([...CLASSIC].sort());
  });

  it('każdy wskaźnik ma warstwę, reszta to search', () => {
    const named = new Set([...FRONT, ...SECOND, ...CLASSIC]);
    expect(INDICATORS.every((d) => ['front', 'second', 'classic', 'search'].includes(d.tier))).toBe(true);
    expect(menuEntries('search').map((d) => d.id).sort()).toEqual(INDICATORS.filter((d) => !named.has(d.id)).map((d) => d.id).sort());
  });

  it('parseIndicators zwraca listę pominiętych identyfikatorów', () => {
    const r = parseIndicators([{ iid: 'a', id: 'obv' }, { iid: 'b', id: 'ema', params: { length: 20 } }]);
    expect(r.dropped).toEqual(['obv']);
    expect(r.list).toHaveLength(1);
    expect(r.list[0].id).toBe('ema');
  });
});
