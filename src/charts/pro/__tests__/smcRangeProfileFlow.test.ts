import { expect, it } from 'vitest';
import type { BookFrame } from '../core/book';
import { Coverage } from '../core/coverage';
import { priceBuckets, RangeVisits, priceReaction, summarizeVisits } from '../core/smcRangeProfileFlow';
import { Tape, type TradeRow } from '../core/tape';

function tapeOf(trades: [number, number, number, TradeRow['side']][]): Tape {
  const tape = new Tape();
  const rows = trades.map(([t, px, sz, side], i) => ({ t, px, sz, side, tid: i }));
  tape.insert(rows);
  tape.insert(rows);
  return tape;
}

function book(t: number, bid: number, ask: number, exact = true): BookFrame {
  return { t, step: 1, px: Float64Array.of(bid, ask), sz: Float64Array.of(1, 1), n: Float64Array.of(1, 1), nBids: 1,
    ...(exact ? { exact: true } : {}) };
}

it('tracks the last three visits across minutes, including zero and duplicate fills', () => {
  const tape = tapeOf([[56_000, 99, 1, -1], [58_000, 100, 2, 1], [60_000, 100, 1, -1], [61_000, 111, 1, -1],
    [62_000, 102, 3, -1], [63_000, 102, 3, 1], [64_000, 111, 1, 1], [65_000, 104, 2, -1],
    [66_000, 115, 1, 1], [67_000, 103, 1, 1]]);
  const visits = new RangeVisits(tape, new Coverage([[55_000, 68_000]]));
  const read = (to: number, step: number, groups: { low: number; high: number }[] = []) => {
    const bins = priceBuckets(step, groups);
    return visits.read({ from: 55_000, to }, bins).byPrice.get(100)?.map(v => v.deltaMicros);
  };
  expect(read(60_500, 10)).toEqual([100_000_000n]);
  expect(read(64_500, 10)).toEqual([100_000_000n, 0n]);
  expect(read(68_000, 10)).toEqual([0n, -208_000_000n, 103_000_000n]);
  expect(read(68_000, 20)).toEqual([110_000_000n]);
  expect(read(68_000, 10, [{ low: 100, high: 120 }])).toEqual([110_000_000n]);
  expect(read(60_500, 10)).toEqual([100_000_000n]);
});

it('marks clipped and interrupted fragments without inventing a visit at skipped prices', () => {
  const tape = tapeOf([[60_000, 100, 1, 1], [62_000, 100, 1, -1], [68_000, 100, 2, 1], [69_000, 130, 1, -1]]);
  const coverage = new Coverage([[60_000, 63_000], [67_000, 70_000]]);
  const visits = new RangeVisits(tape, coverage);
  const bins = priceBuckets(10, []);
  const span = { from: 61_000, to: 70_000 };
  const first = visits.read(span, bins);
  expect(first.byPrice.get(100)).toEqual([{ deltaMicros: -100_000_000n, partial: true }, { deltaMicros: 200_000_000n, partial: true }]);
  expect(first.byPrice.has(110)).toBe(false);
  expect(first.lastBucket).toEqual({ low: 130, high: 140 });
  coverage.addSpan(63_000, 67_000);
  expect(visits.read(span, bins).byPrice.get(100)).toEqual([{ deltaMicros: 100_000_000n, partial: true }]);
});

it('keeps the sum exact and distinguishes a zero visit from missing visits', () => {
  expect(summarizeVisits([])).toBeNull();
  expect(summarizeVisits([{ deltaMicros: 0n, partial: true }])).toEqual({ count: 1, deltaMicros: 0n, partial: true });
  expect(summarizeVisits([
    { deltaMicros: 847_701_000n, partial: false },
    { deltaMicros: 34_296_300n, partial: true },
    { deltaMicros: -4_822_687_650n, partial: false },
  ])).toEqual({ count: 3, deltaMicros: -3_940_690_350n, partial: true });
  const large = 2n ** 60n;
  expect(summarizeVisits([{ deltaMicros: large, partial: false }, { deltaMicros: 1n - large, partial: false }])?.deltaMicros).toBe(1n);
});

it('uses the first valid exact snapshot in 30–35 s and retains the sign on sells', () => {
  const tape = tapeOf([[1000, 100, 2, 1], [10_000, 104, 1, 1], [20_000, 102, 3, -1], [30_000, 106, 1, -1]]);
  const frames = [book(30_000, 110, 112), book(31_000, 101, 100), book(31_200, 110, 120, false),
    book(33_000, 102, 104), book(33_500, 105, 107), book(45_000, 102, 104), book(50_000, 99, 101), book(65_001, 90, 92)];
  const coverage = new Coverage([[1, 70_000]]);
  const read = (to: number) => priceReaction(tape, { from: 1, to }, { low: 100, high: 110 }, frames, coverage);
  expect(read(32_999).buy).toMatchObject({ mean: null, pendingUsd: 304, totalUsd: 304 });
  expect(read(32_999).nextDeadline).toBe(36_000);
  expect(read(33_000).buy).toMatchObject({ mean: 3, matchedUsd: 200, pendingUsd: 104 });
  expect(read(44_999).buy.matchedUsd).toBe(200);
  expect(read(45_000).buy.mean).toBeCloseTo(496 / 304, 9);
  expect(read(50_000).sell).toMatchObject({ mean: -2, matchedUsd: 306, pendingUsd: 106 });
  expect(read(65_001).sell).toMatchObject({ mean: -2, totalUsd: 412, missingUsd: 106 });
  expect(read(65_001).nextDeadline).toBeNull();
});

it('rejects a valid quote after reconnection and keeps truly unchanged prices at zero', () => {
  const tape = tapeOf([[1000, 100, 1, 1], [2_000, 110, 1, 1], [42_000, 100, 1, -1]]);
  const frames = [book(32_000, 99, 101), book(72_000, 99, 101)];
  const coverage = new Coverage([[1, 31_000], [31_500, 77_000]]);
  const read = (to: number) => priceReaction(tape, { from: 1, to }, { low: 100, high: 110 }, frames, coverage);
  expect(read(71_999).buy).toEqual({ mean: null, totalUsd: 100, matchedUsd: 0, pendingUsd: 0, missingUsd: 100 });
  expect(read(72_000).sell).toEqual({ mean: 0, totalUsd: 100, matchedUsd: 100, pendingUsd: 0, missingUsd: 0 });
});
