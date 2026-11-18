import { expect, it } from 'vitest';
import { MinuteBins } from '../core/smcObservationBins';

it('preserves exact closed-window totals and price ranges beyond the raw buffer', () => {
  const b = new MinuteBins();
  for (let m = 0; m < 125; m++) {
    b.trade({ time: m * 60000, px: 100, sz: 2, side: 1 }, m * 60000);
    b.trade({ time: m * 60000 + 1, px: 102, sz: 1, side: -1 }, m * 60000 + 1);
  }
  expect(b.flow(0, 15 * 60000)?.volume).toBe(45);
  expect(b.flow(0, 15 * 60000)?.delta).toBe(15);
  expect(b.flow(0, 15 * 60000, { lo: 99, hi: 101 })?.volume).toBe(30);
  expect(b.flow(0, 15 * 60000, { lo: 99, hi: 101 })?.pv).toBe(3000);
});

it('bounds histograms separately; losing price detail does not erase total volume', () => {
  const b = new MinuteBins(5, 2);
  for (let m = 0; m < 5; m++) b.trade({ time: m * 60000, px: 100 + m, sz: 1, side: 1 }, m * 60000);
  expect(b.flow(0, 300000)?.volume).toBe(5);
  expect(b.flow(0, 300000, { lo: 90, hi: 200 })).toBeNull();
  expect(b.stats().priceCells).toBeLessThanOrEqual(2);
});

it('compares only covered, equally aggregated sampled L2 intervals', () => {
  const b = new MinuteBins();
  for (let t = 0; t < 180000; t += 5000) b.book({ time: t, observedAt: t, step: 1,
    bids: [{ px: 99, sz: 2 }, { px: 98, sz: 3 }], asks: [{ px: 101, sz: 1 }, { px: 102, sz: 2 }] });
  expect(b.depth(0, 180000, { lo: 99, hi: 101 })?.usd).toBe(299);
  expect(b.depth(0, 180000, { lo: 90, hi: 101 })).toBeNull();
  b.book({ time: 179999, observedAt: 180000, step: 10, bids: [{ px: 90, sz: 1 }], asks: [{ px: 110, sz: 1 }] });
  expect(b.depth(0, 180000, { lo: 99, hi: 101 })).toBeNull();
});
