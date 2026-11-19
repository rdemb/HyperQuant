import { describe, expect, it } from 'vitest';
import { toFrame } from '../../../charts/pro/core/book';
import { Coverage } from '../../../charts/pro/core/coverage';
import { Tape } from '../../../charts/pro/core/tape';
import { bookMetrics, executionWindow, hip3TapeFilters, visibleExecutions } from '../hip3Flow';

describe('publiczny przepływ HIP-3', () => {
  it('pokazuje pojedyncze, odduplikowane wykonania w jednostce rynku i USD', () => {
    const tape = new Tape();
    const gold = { t: 60_001, tid: 1, px: 3736.2, sz: 0.0034, side: -1 as const };
    const s = { t: 60_002, tid: 2, px: 3735.6, sz: 1, side: 1 as const };
    tape.insert([gold, s, gold, { ...s, t: 60_003, tid: 3 }]);
    expect(visibleExecutions(tape, 60_002, 0, 5)).toEqual([
      { ...s, usd: 3735.6 }, { ...gold, usd: expect.closeTo(12.70308, 8) },
    ]);
    expect(visibleExecutions(tape, 60_002, 100, 5)).toEqual([{ ...s, usd: 3735.6 }]);
    tape.insert([{ ...gold, t: 60_005 }]);
    expect(visibleExecutions(tape, 60_005, 0, 5).filter(fill => fill.tid === gold.tid).map(fill => fill.t)).toEqual([60_005, 60_001]);
    expect(hip3TapeFilters('xyz:GOLD')).not.toEqual(hip3TapeFilters('xyz:SP500'));
  });

  it('liczy spread i głębokość w jednostkach rynku i USD bez zgadywania drugiej strony', () => {
    const bids = [{ px: 7403.7, sz: 28.048, n: 2 }, { px: 7403.6, sz: 2, n: 1 }];
    const asks = [{ px: 7403.8, sz: 7.402, n: 3 }];
    const book = bookMetrics(toFrame({ time: 60_000, bids, asks }, 0.1));
    expect(book.spread).toBeCloseTo(0.1);
    expect(book.spreadBp).toBeCloseTo(0.1350666928);
    expect(book.bids[1].totalUsd).toBeCloseTo(222466.1776);
    expect(book.asks[0].usd).toBeCloseTo(54802.9276);
    const oneSide = bookMetrics(toFrame({ time: 60_000, bids, asks: [] }, 0.1));
    expect(oneSide.spread).toBeNull();
    expect(oneSide.asks).toEqual([]);
  });

  it('odróżnia ciszę na rynku od minuty bez pokrycia', () => {
    const tape = new Tape();
    tape.insert([{ t: 90_001, tid: 1, px: 3736.2, sz: 1, side: -1 }]);
    expect(executionWindow(tape, new Coverage([[80_000, 100_000]]), 40_000, 100_000)).toBeNull();
    expect(executionWindow(tape, new Coverage([[40_000, 100_000]]), 40_000, 100_000)).toMatchObject({ count: 1, turnoverUsd: 3736.2, deltaUsd: -3736.2 });
    expect(executionWindow(tape, new Coverage([[100_000, 160_000]]), 100_000, 160_000)).toMatchObject({ count: 0, turnoverUsd: 0, deltaUsd: 0 });
  });
});
