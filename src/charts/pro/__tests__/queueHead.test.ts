import { describe, expect, it } from 'vitest';
import type { TradeScan } from '../core/ladder';
import { HEAD_DELAY_MS, HEAD_GAP_MS, QueueHead } from '../core/queueHead';
import type { Side } from '../hl/parse';

const tape =
  (rows: [number, number, number, Side][]): TradeScan =>
  (from, to, fn) => {
    for (const [t, px, sz, side] of rows) if (t >= from && t < to) fn(t, px, sz, side);
  };
const lvl = (px: number, sz: number, n = 1) => ({ px, sz, n });

describe('QueueHead', () => {
  it('ubytek czoła na tej samej cenie: transakcje sprzedających to zjedzone, reszta anulowana', () => {
    const q = new QueueHead();
    q.push(1000, lvl(100, 10), lvl(101, 5));
    q.push(1200, lvl(100, 4), lvl(101, 5));
    q.settle(1200 + HEAD_DELAY_MS, tape([[1100, 100, 2, -1]]));
    const f = q.flow(0, 10_000);
    expect(f.bid).toEqual({ eaten: 200, pulled: 400, refill: 0 });
    expect(f.ask).toEqual({ eaten: 0, pulled: 0, refill: 0 });
  });

  it('transakcje ponad ubytek to dolanie; kupujący nie zjadają bidu', () => {
    const q = new QueueHead();
    q.push(1000, lvl(100, 10), lvl(101, 5));
    q.push(1200, lvl(100, 9), lvl(101, 5));
    q.settle(5000, tape([[1100, 100, 3, -1], [1150, 100, 7, 1]]));
    expect(q.flow(0, 10_000).bid).toEqual({ eaten: 300, pulled: 0, refill: 200 });
  });

  it('bid spada niżej: stare czoło znika w całości, część zjedzona transakcjami na jego cenie', () => {
    const q = new QueueHead();
    q.push(1000, lvl(100, 10), lvl(101, 5));
    q.push(1300, lvl(99, 8), lvl(101, 5));
    q.settle(5000, tape([[1200, 100, 6, -1], [1250, 99, 1, -1]]));
    expect(q.flow(0, 10_000).bid).toEqual({ eaten: 600, pulled: 400, refill: 0 });
    // Ask idzie w górę po kupnie: tak samo jak bid w dół
    const r = new QueueHead();
    r.push(1000, lvl(100, 1), lvl(101, 5));
    r.push(1300, lvl(100, 1), lvl(102, 5));
    r.settle(5000, tape([[1200, 101, 5, 1]]));
    expect(r.flow(0, 10_000).ask).toEqual({ eaten: 505, pulled: 0, refill: 0 });
  });

  it('nowe czoło przed starym (bid wyżej) nie jest rozliczane', () => {
    const q = new QueueHead();
    q.push(1000, lvl(100, 10), lvl(102, 5));
    q.push(1300, lvl(101, 1), lvl(102, 5));
    q.settle(5000, tape([]));
    expect(q.flow(0, 10_000).bid).toEqual({ eaten: 0, pulled: 0, refill: 0 });
    expect(q.bid?.since).toBe(1300);
    expect(q.ask?.since).toBe(1000);
  });

  it('rozlicza dopiero po opóźnieniu i pomija odstęp dłuższy niż przerwa', () => {
    const q = new QueueHead();
    q.push(1000, lvl(100, 10), lvl(101, 5));
    q.push(1200, lvl(100, 4), lvl(101, 5));
    q.settle(1200 + HEAD_DELAY_MS - 1, tape([]));
    expect(q.flow(0, 10_000).bid.pulled).toBe(0);
    q.settle(1200 + HEAD_DELAY_MS, tape([]));
    expect(q.flow(0, 10_000).bid.pulled).toBe(600);
    q.push(1200 + HEAD_GAP_MS + 1, lvl(100, 1), lvl(101, 5));
    q.settle(1200 + HEAD_GAP_MS + 1 + HEAD_DELAY_MS, tape([]));
    expect(q.flow(0, 1e9).bid.pulled).toBe(600);
    // Po przerwie „stoi od” od nowa
    expect(q.bid?.since).toBe(1200 + HEAD_GAP_MS + 1);
    expect(q.from).toBe(1000);
  });

  it('pomija aktualizację starszą niż poprzednia', () => {
    const q = new QueueHead();
    q.push(2000, lvl(100, 10), lvl(101, 5));
    q.push(1500, lvl(100, 1), lvl(101, 5));
    expect(q.bid?.sz).toBe(10);
  });
});
