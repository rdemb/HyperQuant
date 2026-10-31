import { describe, expect, it } from 'vitest';
import type { BookFrame } from '../core/book';
import { IndicatorEngine } from '../indicators/engine';
import { type FlowContext, indicatorDef, indicatorLabel, indicatorsFromLink, marketCostBp, tfAllowed } from '../indicators/registry';

const M1 = 60_000;

/** Migawka: bidy malejąco, aski rosnąco, [cena, wielkość]. */
const frame = (t: number, bids: [number, number][], asks: [number, number][]): BookFrame => {
  const lv = [...bids, ...asks];
  return {
    t,
    step: 1,
    px: Float64Array.from(lv.map((l) => l[0])),
    sz: Float64Array.from(lv.map((l) => l[1])),
    n: Float64Array.from(lv.map(() => 1)),
    nBids: bids.length,
  };
};

const book = frame(0, [[99, 1], [98, 2], [97, 10]], [[101, 1], [102, 2], [103, 10]]);

describe('koszt zlecenia rynkowego po arkuszu', () => {
  it('kwota mieszcząca się w najlepszym poziomie kosztuje pół spreadu', () => {
    expect(marketCostBp(book, 50, true)).toBeCloseTo((1 / 100) * 1e4, 10);
    expect(marketCostBp(book, 50, false)).toBeCloseTo((1 / 100) * 1e4, 10);
  });

  it('większa kwota przechodzi po kolejnych poziomach: średnia cena wykonania z ilości', () => {
    // 101 USD z poziomu 101 (1 szt.) i 204 USD z poziomu 102 (2 szt.): 305 USD za 3 szt.
    expect(marketCostBp(book, 305, true)).toBeCloseTo(((305 / 3 - 100) / 100) * 1e4, 10);
    // Sprzedaż: 99 USD z 99 i 196 USD z 98: 295 USD za 3 szt.
    expect(marketCostBp(book, 295, false)).toBeCloseTo(((100 - 295 / 3) / 100) * 1e4, 10);
  });

  it('koszt nie maleje z kwotą', () => {
    let prev = 0;
    for (let usd = 10; usd <= 1300; usd += 10) {
      const c = marketCostBp(book, usd, true);
      expect(c).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = c;
    }
  });

  it('za płytki arkusz i brak strony — brak (bez zgadywania poza poziomami)', () => {
    expect(marketCostBp(book, 101 + 204 + 1030 + 1, true)).toBeNaN();
    expect(marketCostBp(frame(0, [[99, 1]], []), 10, false)).toBeNaN();
    expect(marketCostBp(frame(0, [], [[101, 1]]), 10, true)).toBeNaN();
  });

  it('świeca to średnia z jej migawek; bez migawki albo z za płytką — brak', () => {
    const def = indicatorDef('slippage');
    expect(def.group).toBe('hyperquant');
    expect(tfAllowed(def)).toBe(false);
    const x = indicatorsFromLink('slippage(2000)')[0];
    expect(indicatorLabel(x)).toBe('Koszt 2000');
    const deep = frame(0, [[99, 10], [98, 20]], [[101, 10], [102, 20]]);
    const wide = frame(0, [[98, 10], [97, 100]], [[102, 10], [103, 100]]);
    const frames = [
      { ...deep, t: 10_000 },
      { ...wide, t: 40_000 },
      // Druga świeca bez migawek, trzecia z askami za płytkimi na 2000 USD
      { ...frame(0, [[99, 50]], [[101, 1]]), t: 2 * M1 + 5_000 },
    ];
    const ctx: FlowContext = { oiAt: () => null, book: () => [], exactBook: () => frames, orders: () => [], orderCount: () => 0, now: 3 * M1 };
    const c = { o: 100, h: 100, l: 100, c: 100, v: 1, n: 1 };
    const bars = [0, 1, 2].map((k) => ({ candle: { ...c, t: k * M1 } }));
    const e = new IndicatorEngine();
    e.setInstances([x]);
    e.sync(bars, M1, () => [], ctx);
    const [buy, sell] = e.runs[0].out;
    // 2000 USD: w pierwszej migawce 1010 z 101 i 990 z 102, w drugiej 1020 z 102 i 980 z 103
    const b1 = marketCostBp(deep, 2000, true);
    const b2 = marketCostBp(wide, 2000, true);
    expect(b1).toBeCloseTo(((2000 / (10 + 990 / 102) - 100) / 100) * 1e4, 10);
    expect(buy[0]).toBeCloseTo((b1 + b2) / 2, 10);
    expect(sell[0]).toBeCloseTo((marketCostBp(deep, 2000, false) + marketCostBp(wide, 2000, false)) / 2, 10);
    expect(buy[1]).toBeNaN();
    expect(buy[2]).toBeNaN();
    expect(sell[2]).toBeGreaterThan(0);
  });
});
