import { describe, expect, it } from 'vitest';
import { type BookFrame, largeLots, lotThreshold } from '../core/book';

/** Migawka: poziomy [cena, wielkość, liczba zleceń], najpierw bidy. */
const frame = (t: number, bids: [number, number, number][], asks: [number, number, number][]): BookFrame => {
  const all = [...bids, ...asks];
  return {
    t,
    step: 10,
    px: Float64Array.from(all.map((l) => l[0])),
    sz: Float64Array.from(all.map((l) => l[1])),
    n: Float64Array.from(all.map((l) => l[2])),
    nBids: bids.length,
  };
};

describe('largeLots', () => {
  it('poziom z dużym średnim zleceniem trwa od pojawienia się do zniknięcia z arkusza', () => {
    const frames = [
      frame(0, [[100, 10, 20]], [[110, 1, 1]]), // bid: 1000 USD / 20 = 50 — tłum; ask: 110 USD w 1 zleceniu
      frame(5, [[100, 10, 1]], [[110, 1, 1]]), // bid: 1000 USD w 1 zleceniu
      frame(10, [[100, 12, 2]], []), // bid: 1200 / 2 = 600 — nadal duże, wartość rośnie
      frame(15, [[100, 12, 40]], []), // bid rozbity na drobne — koniec
    ];
    const lots = largeLots(frames, 500);
    expect(lots).toEqual([{ px: 100, bid: true, from: 5, to: 15, open: false, usd: 1200, orders: 2 }]);
  });

  it('poziom w najnowszej migawce jest otwarty; strony liczone osobno', () => {
    const frames = [frame(0, [[100, 10, 1]], [[100.5, 10, 1]]), frame(5, [[100, 10, 1]], [[100.5, 10, 1]])];
    const lots = largeLots(frames, 500);
    expect(lots.map((l) => [l.bid, l.open, l.to])).toEqual([
      [true, true, 5],
      [false, true, 5],
    ]);
  });

  it('pomija poziomy bez liczby zleceń', () => {
    expect(largeLots([frame(0, [[100, 10, Number.NaN]], [])], 1)).toEqual([]);
  });
});

describe('lotThreshold', () => {
  it('kwantyl średniego zlecenia poziomu, nie niżej niż próg minimalny', () => {
    // 100 poziomów: średnie zlecenie 1…100 USD (cena 1, wielkość k, 1 zlecenie)
    const levels: [number, number, number][] = Array.from({ length: 100 }, (_, k) => [1, k + 1, 1]);
    const f = frame(0, levels.slice(0, 50), levels.slice(50));
    expect(lotThreshold([f], 10)).toBe(100);
    expect(lotThreshold([f], 10, 0.5)).toBe(51);
    expect(lotThreshold([f], 80, 0.5)).toBe(80);
  });

  it('bez migawek albo bez liczby zleceń — próg minimalny', () => {
    expect(lotThreshold([], 500)).toBe(500);
    expect(lotThreshold([frame(0, [[100, 1, Number.NaN]], [])], 500)).toBe(500);
  });
});
