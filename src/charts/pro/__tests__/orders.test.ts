import { describe, expect, it } from 'vitest';
import type { Fill } from '../hl/parse';
import { OrderAggregator, orderKey } from '../core/orders';

const fill = (o: Partial<Fill>): Fill => ({ time: 1000, px: 100, sz: 1, side: 1, tid: 1, hash: '0xaa', taker: '0x01', ...o });

describe('OrderAggregator', () => {
  it('łączy wypełnienia tego samego biorcy i hasha w jedno zlecenie (zamiatanie arkusza)', () => {
    const agg = new OrderAggregator(1000);
    const done = agg.push([fill({ px: 100, sz: 1, tid: 1 }), fill({ px: 101, sz: 3, tid: 2 }), fill({ px: 101, sz: 1, tid: 3 })], 1000);
    expect(done).toEqual([]);
    const [o] = agg.flush(2500);
    expect(o.sz).toBe(5);
    expect(o.fills).toBe(3);
    expect(o.levels).toBe(2);
    expect(o.vwap).toBeCloseTo((100 + 303 + 101) / 5);
    expect(o.notional).toBeCloseTo(504);
    expect([o.pxFirst, o.pxLast]).toEqual([100, 101]);
  });

  it('różni biorcy albo różne hashe to osobne zlecenia', () => {
    const agg = new OrderAggregator(1000);
    agg.push([fill({ taker: '0x01' }), fill({ taker: '0x02', tid: 2 }), fill({ hash: '0xbb', tid: 3 })], 1000);
    expect(agg.flush(5000)).toHaveLength(3);
  });

  it('bez hasha łączy tylko wypełnienia z tej samej milisekundy; bez biorcy każde osobno', () => {
    const zero = '0x' + '0'.repeat(64);
    expect(orderKey(fill({ hash: zero }))).toBe('0x01|t1000|1');
    expect(orderKey(fill({ taker: '' }))).toBeNull();
    const agg = new OrderAggregator(1000);
    const done = agg.push([fill({ taker: '', tid: 1 }), fill({ taker: '', tid: 2 })], 1000);
    expect(done).toHaveLength(2);
  });

  it('zamyka zlecenie po czasie bez nowych wypełnień', () => {
    const agg = new OrderAggregator(1000);
    agg.push([fill({})], 1000);
    expect(agg.push([], 1500)).toHaveLength(0);
    expect(agg.push([], 2000)).toHaveLength(1);
    expect(agg.pending()).toHaveLength(0);
  });
});
