import { describe, expect, it } from 'vitest';
import { BookHistory, toFrame } from '../../../charts/pro/core/book';
import { Coverage } from '../../../charts/pro/core/coverage';
import { Tape } from '../../../charts/pro/core/tape';
import { bookMemory, bookQuote, readDomTrades } from '../domWorkspaceModel';

const sample = (time: number, size = 1) => toFrame({
  time, bids: [{ px: 99, sz: size, n: 2 }, { px: 97, sz: 1, n: 1 }],
  asks: [{ px: 101, sz: size, n: 3 }, { px: 103, sz: 1, n: 1 }],
}, 1);

describe('pamięć arkusza', () => {
  it('układa cztery obserwacje do kursora, bez przejścia przez przerwę', () => {
    const history = new BookHistory(1);
    for (const time of [100, 200, 300, 400, 500, 600]) history.add(sample(time));
    expect(bookMemory(history, new Coverage([[100, 1000]]), 500).map(frame => frame?.t))
      .toEqual([200, 300, 400, 500]);
    const split = new Coverage([[100, 350], [400, 1000]]);
    expect(bookMemory(history, split, 501).map(frame => frame?.t))
      .toEqual([undefined, undefined, 400, 500]);
    expect(bookMemory(history, split, 399).every(frame => frame === null)).toBe(true);
    expect(bookMemory(history, new Coverage([[100, 100_000]]), 31_000).every(frame => frame === null)).toBe(true);
  });

  it('odróżnia pusty poziom w zasięgu, poziom poza zasięgiem i liczbę zleceń', () => {
    expect(bookQuote(sample(100, 2), 99)).toEqual({ bid: 198, ask: 0, bidOrders: 2, askOrders: 0 });
    expect(bookQuote(sample(100), 100)).toEqual({ bid: 0, ask: 0, bidOrders: 0, askOrders: 0 });
    expect(bookQuote(sample(100), 96)).toBeNull();
  });
});

it('liczy obrót i cztery odcinki po 5 s do kursora, oznaczając niepełne okno', () => {
  const tape = new Tape();
  const t = 200_000;
  tape.insert([
    { t: t - 120_000, tid: 1, px: 100, sz: 5, side: 1 },
    { t: t - 19_999, tid: 2, px: 100, sz: 1, side: 1 },
    { t: t - 5_000, tid: 3, px: 100, sz: 2, side: -1 },
    { t, tid: 4, px: 100, sz: 3, side: 1 },
    { t: t + 1, tid: 5, px: 100, sz: 9, side: 1 },
  ]);
  const full = readDomTrades(tape, new Coverage([[0, t + 1]]), t, 5);
  expect(full.rows.get(100)).toMatchObject({ volume: 600_000_000n, slices: [100_000_000n, 0n, -200_000_000n, 300_000_000n], recent: 300_000_000n });
  const gap = readDomTrades(tape, new Coverage([[0, t - 17_000], [t - 16_000, t + 1]]), t, 5);
  expect(gap.coverage).toMatchObject({ volume: false, slices: [false, true, true, true], recent: true });
});
