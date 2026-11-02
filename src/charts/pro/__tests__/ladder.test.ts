import { describe, expect, it } from 'vitest';
import type { BookFrame } from '../core/book';
import { bucketOf, heatHistory, ladderRows, tradedAt } from '../core/ladder';

const frame = (t: number, bids: [number, number, number][], asks: [number, number, number][], step = 10): BookFrame => {
  const all = [...bids, ...asks];
  return { t, step, px: Float64Array.from(all.map((l) => l[0])), sz: Float64Array.from(all.map((l) => l[1])), n: Float64Array.from(all.map((l) => l[2])), nBids: bids.length };
};

describe('ladderRows', () => {
  it('stała siatka od najlepszych cen: puste ceny w zasięgu = 0, dalej poza zasięgiem = NaN', () => {
    const f = frame(0, [[100, 5, 3], [80, 2, 1]], [[110, 1, 1], [120, 4, 2]]);
    const { asks, bids } = ladderRows(f, 4);
    expect(bids.map((r) => [r.px, r.sz, r.n])).toEqual([
      [100, 5, 3],
      [90, 0, Number.NaN],
      [80, 2, 1],
      [70, Number.NaN, Number.NaN],
    ]);
    expect(asks.map((r) => [r.px, r.sz])).toEqual([
      [110, 1],
      [120, 4],
      [130, Number.NaN],
      [140, Number.NaN],
    ]);
    expect(bids.every((r) => r.bid) && asks.every((r) => !r.bid)).toBe(true);
  });

  it('krok ułamkowy bez błędu zmiennoprzecinkowego', () => {
    const f = frame(0, [[0.3, 1, 1], [0.1, 1, 1]], [[0.4, 1, 1]], 0.1);
    expect(ladderRows(f, 3).bids.map((r) => [r.px, r.sz])).toEqual([
      [0.3, 1],
      [0.2, 0],
      [0.1, 1],
    ]);
  });
});

describe('bucketOf i tradedAt', () => {
  it('bid w dół, ask w górę; sprzedający agresor zdejmuje bidy, kupujący aski', () => {
    expect(bucketOf(105, 10, true)).toBe(100);
    expect(bucketOf(105, 10, false)).toBe(110);
    expect(bucketOf(110, 10, false)).toBe(110);
    const m = tradedAt(
      (_a, _b, fn) => {
        fn(1, 105, 2, -1);
        fn(2, 105, 1, 1);
        fn(3, 101, 1, -1);
      },
      0,
      10,
      10
    );
    expect(m.get('b100')).toBeCloseTo(105 * 2 + 101);
    expect(m.get('a110')).toBeCloseTo(105);
  });
});

describe('heatHistory', () => {
  it('kolumna bierze migawkę obowiązującą w jej środku; brak migawki albo przerwa = NaN, cena w zasięgu bez zleceń = 0', () => {
    const f0 = frame(0, [[100, 5, 1], [80, 1, 1]], [[110, 2, 1]]);
    const f1 = frame(20, [[100, 7, 1], [80, 1, 1]], [[110, 3, 1]]);
    const rows = ladderRows(f1, 3).bids; // 100, 90, 80
    // Okno [0, 40) w 4 kolumnach: środki 5, 15 (f0), 25, 35 (f1)
    const h = heatHistory([f0, f1], rows, 0, 40, 4, 100);
    expect(Array.from(h.slice(0, 4))).toEqual([5, 5, 7, 7]);
    expect(Array.from(h.slice(4, 8))).toEqual([0, 0, 0, 0]);
    // Przerwa dłuższa niż maxGap: kolumny po 30 ms od migawki puste
    const g = heatHistory([f0], rows, 0, 40, 4, 10);
    expect(Number.isNaN(g[2]) && Number.isNaN(g[3])).toBe(true);
    // Przed pierwszą migawką — NaN
    const early = heatHistory([f1], rows, 0, 40, 4, 100);
    expect(Number.isNaN(early[0]) && early[3] === 7).toBe(true);
  });
});
