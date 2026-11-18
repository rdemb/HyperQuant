import { describe, expect, it } from 'vitest';
import { ObservationJournal } from '../core/smcObservation';

describe('shared public SMC observations', () => {
  const trade = (time: number, tid = time) => ({ time, tid, px: 100, sz: 2, side: 1 as const });
  it('deduplicates by provider identity and discards participant fields', () => {
    const j = new ObservationJournal('BTC');
    j.open(1, 10);
    const withParticipants = { ...trade(2), taker: 'private', hash: 'private' };
    j.trades([withParticipants], 11);
    j.trades([trade(2)], 12);
    expect(j.tradesAfter(0)).toHaveLength(1);
    expect(JSON.stringify(j.tradesAfter(0))).not.toContain('private');
    expect(j.complete(1, 3, 12)).toBe(true);
    j.trades([{ ...trade(2), sz: 3 }], 13);
    expect(j.complete(1, 3, 13)).toBe(false);
  });
  it('retains exchange and receive times and does not backdate late data', () => {
    const j = new ObservationJournal('BTC');
    j.open(1, 1);
    j.trades([trade(20)], 21);
    j.trades([trade(10)], 30);
    const rows = j.tradesAfter(0);
    expect(rows.map(x => [x.time, x.observedAt, x.late])).toEqual([[20, 21, false], [10, 30, true]]);
    expect(j.range(1, 22, 22).map(x => x.time)).toEqual([20]);
    expect(j.range(1, 22, 30).map(x => x.time)).toEqual([10, 20]);
  });
  it('records disconnect gaps without rewriting the previously observed screen', () => {
    const j = new ObservationJournal('BTC');
    j.open(1, 1); j.trades([trade(5)], 5);
    j.close(5, 20, 'disconnect'); j.open(25, 26);
    expect(j.complete(1, 10, 10)).toBe(true);
    expect(j.complete(1, 10, 20)).toBe(false);
    expect(j.complete(25, 30, 30)).toBe(true);
    expect(j.gaps()).toHaveLength(1);
  });
  it('bounds retention and cannot reinsert evicted snapshot trades', () => {
    const j = new ObservationJournal('BTC', { trades: 3, books: 2 });
    j.open(1, 1);
    for (let t = 2; t < 8; t++) j.trades([trade(t)], t);
    j.trades([trade(2)], 9);
    expect(j.tradesAfter(0).map(x => x.time)).toEqual([5, 6, 7]);
    expect(j.complete(1, 7, 10)).toBe(false);
    expect(j.stats().trades).toBe(3);
  });
  it('does not count duplicate book snapshots and rejects invalid numbers', () => {
    const j = new ObservationJournal('BTC');
    const b = { time: 10, bids: [{ px: 99, sz: 2 }], asks: [{ px: 101, sz: 3 }] };
    j.book(b, 11, 1); j.book(b, 12, 1);
    expect(j.bookRows()).toHaveLength(1);
    j.trades([{ ...trade(20), px: NaN }], 20);
    expect(j.tradesAfter(0)).toEqual([]);
  });
  it('does not expose aggregate corrections to a query from before their receipt', () => {
    const j = new ObservationJournal('BTC'); j.open(0, 0);
    j.trades([trade(10)], 10);
    expect(j.flow(0, 60000, 60000)?.volume).toBe(2);
    j.trades([{ ...trade(20), sz: 100 }], 70000);
    expect(j.flow(0, 60000, 60000)?.volume).toBe(2);
    expect(j.flow(0, 60000, 70000)?.volume).toBe(102);
  });
  it('invalidates an L2 window when a known snapshot lacks one visible side', () => {
    const j = new ObservationJournal('BTC');
    for (let t = 0; t < 60000; t += 5000) j.book({ time: t, bids: [{ px: 99, sz: 1 }], asks: [{ px: 101, sz: 1 }] }, t, 1);
    expect(j.bins.depth(0, 60000, { lo: 99, hi: 101 })).not.toBeNull();
    j.book({ time: 30000, bids: [], asks: [{ px: 101, sz: 1 }] }, 70000, 1);
    expect(j.bins.depth(0, 60000, { lo: 99, hi: 101 })).toBeNull();
  });
});
