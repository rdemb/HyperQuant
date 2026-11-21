import { describe, expect, it } from 'vitest';
import { BookHistory, type BookFrame } from '../../../charts/pro/core/book';
import { Coverage } from '../../../charts/pro/core/coverage';
import { Tape } from '../../../charts/pro/core/tape';
import { captureLevel, deskMarketFromHash, depthAtPrice, depthChangeAtPrice, referenceBook, tradeActivity } from '../orderFlowDesk';
import { visibleExecutions } from '../hip3Flow';

function frame(px: number[], sizes: number[], t: number): BookFrame {
  return { t, step: 1, px: Float64Array.from(px), sz: Float64Array.from(sizes), n: Float64Array.from(px, () => 2), nBids: 2 };
}

describe('samodzielny panel order flow', () => {
  it('otwiera wyłącznie dostępne rynki i nie przejmuje parametrów wykresu', () => {
    expect(deskMarketFromHash('#orderflow?m=xyz%3AGOLD')).toBe('xyz:GOLD');
    expect(deskMarketFromHash('#orderflow?m=xyz:SP500')).toBe('xyz:SP500');
    expect(deskMarketFromHash('#orderflow?m=ETH')).toBe('BTC');
    expect(deskMarketFromHash('#charts?m=xyz:GOLD')).toBe('BTC');
  });

  it('odróżnia pustą cenę wewnątrz widocznej głębokości od ceny poza migawką', () => {
    const book = frame([99, 97, 101, 103], [2, 5, 3, 6], 40_000);
    expect(depthAtPrice(book, 99)).toBe(198);
    expect(depthAtPrice(book, 100)).toBe(0);
    expect(depthAtPrice(book, 96)).toBeNull();
    expect(depthAtPrice(null, 99)).toBeNull();
  });

  it('nie liczy zmiany głębokości przez przerwę lub poza zasięgiem migawki', () => {
    const now = frame([99, 97, 101, 103], [2, 5, 3, 6], 40_000);
    const past = frame([99, 97, 101, 103], [1, 5, 3, 2], 10_000);
    expect(depthChangeAtPrice(now, past, 103, new Coverage([[10_000, 40_001]]))).toBe(412);
    expect(depthChangeAtPrice(now, past, 95, new Coverage([[10_000, 40_001]]))).toBeNull();
    expect(depthChangeAtPrice(now, past, 99, new Coverage([[10_000, 17_000], [23_000, 40_001]]))).toBeNull();
  });

  it('wybiera najbliższą migawkę porównawczą i nie przeskakuje przez lukę arkusza', () => {
    const history = new BookHistory(1);
    for (const t of [12_000, 24_000, 36_000, 48_000]) {
      history.add(frame([99, 97, 101, 103], [2, 5, 3, 6], t));
    }
    const coverage = new Coverage([[12_000, 48_001]]);
    expect(referenceBook(history, 48_000, 30_000, coverage)?.t).toBe(12_000);
    expect(referenceBook(history, 48_000, 27_000, coverage)?.t).toBe(24_000);
    expect(referenceBook(history, 48_000, 30_000, new Coverage([[12_000, 20_000], [24_000, 48_001]]))?.t).toBe(24_000);
    expect(referenceBook(history, 48_000, 30_000, new Coverage([[36_000, 48_001]]))).toBeNull();
  });

  it('liczy obroty i deltę w oknie [od, do), a brak pokrycia oznacza jawnie', () => {
    const tape = new Tape();
    tape.insert([
      { t: 999, px: 100, sz: 9, side: 1, tid: 1 },
      { t: 1_000, px: 100, sz: 2, side: 1, tid: 2 },
      { t: 1_500, px: 100, sz: 1, side: -1, tid: 3 },
      { t: 2_000, px: 101, sz: 8, side: 1, tid: 4 },
    ]);
    const covered = new Coverage([[1_000, 2_000]]);
    const read = tradeActivity(tape, covered, 1_000, 2_000);
    expect(read).toMatchObject({ count: 2, buyUsd: 200, sellUsd: 100 });
    expect(read?.atPrice.get(100)).toEqual({ buyUsd: 200, sellUsd: 100, buySize: 2, sellSize: 1 });
    expect(read?.atPrice.has(101)).toBe(false);
    expect(tradeActivity(tape, covered, 1_000, 2_001)).toBeNull();
    expect(tradeActivity(new Tape(), covered, 1_000, 2_000)?.count).toBe(0);
    expect(visibleExecutions(tape, 2_000, 0, 20, 1_000, undefined, 100).map(row => row.tid)).toEqual([3, 2]);
  });

  it('przypina stronę i czasy migawek, a wykonania liczy od pierwszej wyłącznie do drugiej włącznie', () => {
    const previous = frame([99, 97, 101, 103], [2, 1, 3, 1], 10_000);
    const latest = frame([101, 99, 103, 105], [8, 2, 3, 1], 22_000);
    const tape = new Tape();
    tape.insert([
      { t: 10_000, px: 101, sz: 4, side: 1, tid: 1 },
      { t: 10_001, px: 101, sz: 2, side: 1, tid: 2 },
      { t: 20_000, px: 101, sz: 9, side: -1, tid: 3 },
      { t: 22_000, px: 101, sz: 1, side: 1, tid: 4 },
      { t: 22_001, px: 101, sz: 5, side: 1, tid: 5 },
    ]);
    const observed = new Coverage([[10_000, 22_001]]);
    const input = { price: 101, side: 'ask' as const, current: latest, previous, bookCoverage: observed, tape, tapeCoverage: observed };
    const pinned = captureLevel(input);
    expect(pinned).toMatchObject({ price: 101, side: 'ask', from: 10_000, through: 22_000, before: 303, after: 0, executions: { count: 2, usd: 303 } });
    expect(pinned.executions?.rows.map(row => row.tid)).toEqual([4, 2]);
    expect(captureLevel({ ...input, tapeCoverage: new Coverage([[10_001, 22_000]]) }).executions).toBeNull();
    expect(captureLevel({ ...input, bookCoverage: new Coverage() })).toMatchObject({ from: null, before: null, through: 22_000, after: 0, executions: null });
  });
});
