import { expect, it, vi } from 'vitest';
import { rangeProfileLabel, rangeProfileRows, SmcRangeProfileLayer } from '../chart/smcRangeProfileLayer';
import { Coverage } from '../core/coverage';
import { Tape } from '../core/tape';

it('formats archived values, signs, zero and missing values distinctly', () => {
  expect(rangeProfileLabel(11_006_916.08411, false)).toBe('11,01M');
  expect(rangeProfileLabel(-4_880_485.19257, true)).toBe('−4,88M');
  expect(rangeProfileLabel(100, true)).toBe('+100');
  expect(rangeProfileLabel(-0.001, true)).toBe('−<0,01');
  expect(rangeProfileLabel(0, true)).toBe('0');
  expect(rangeProfileLabel(null, true)).toBe('—');
});

it('only combines rows that lack space and sums both values before drawing', () => {
  const rows = rangeProfileRows([
    { price: 100, turnoverUsd: 300, deltaMicros: 100_000_000n },
    { price: 101, turnoverUsd: 303, deltaMicros: -303_000_000n },
    { price: 102, turnoverUsd: 204, deltaMicros: 0n },
    { price: 106, turnoverUsd: 106, deltaMicros: 106_000_000n },
    { price: 110, turnoverUsd: 110, deltaMicros: -110_000_000n },
  ], 1, 106, p => 78 - (p - 100) * 8);
  expect(rows).toEqual([
    { low: 106, high: 107, top: 22, bottom: 30, labelY: 30, turnoverUsd: 106, deltaUsd: 106 },
    { low: 100, high: 103, top: 54, bottom: 78, labelY: 66, turnoverUsd: 807, deltaUsd: -203 },
  ]);
});

it('keeps separately visible price bins and their signs at normal row height', () => {
  const rows = rangeProfileRows([
    { price: 100, turnoverUsd: 300, deltaMicros: 100_000_000n },
    { price: 101, turnoverUsd: 303, deltaMicros: -303_000_000n },
    { price: 102, turnoverUsd: 204, deltaMicros: 0n },
  ], 1, 120, p => 106 - (p - 100) * 26);
  expect(rows.map(r => [r.labelY, rangeProfileLabel(r.turnoverUsd, false), rangeProfileLabel(r.deltaUsd, true)])).toEqual([
    [41, '204', '0'], [67, '303', '−303'], [93, '300', '+100'],
  ]);
});

it('keeps the labels below the compact chart legend and column titles', () => {
  const rows = rangeProfileRows([{ price: 100, turnoverUsd: 300, deltaMicros: 100_000_000n }], 1, 100, p => 50 - (p - 100) * 20, 24);
  expect(rows).toEqual([{ low: 100, high: 101, top: 44, bottom: 50, labelY: 54, turnoverUsd: 300, deltaUsd: 100 }]);
});

it('retains a sub-cent difference through visual grouping beyond the safe integer range', () => {
  const large = 2n ** 60n;
  const project = (px: number) => 90 - (px - 100) * 5;
  for (const residual of [0n, 10n, -10n]) {
    const rows = rangeProfileRows([
      { price: 100, turnoverUsd: 2e12, deltaMicros: large },
      { price: 101, turnoverUsd: 2e12, deltaMicros: -large + residual },
    ], 1, 100, project);
    expect(rows).toHaveLength(1);
    expect(rows[0].deltaUsd).toBe(Number(residual) / 1_000_000);
  }
});

it('closes an unmatched window on the live clock and reopens it when replay moves back', () => {
  vi.useFakeTimers();
  try {
    let now = 40_000;
    const tape = new Tape();
    tape.insert([{ t: 10_000, px: 100, sz: 1, side: 1, tid: 1 }, { t: 41_000, px: 100, sz: .5, side: -1, tid: 2 }]);
    const layer = new SmcRangeProfileLayer(tape, new Coverage([[1, Infinity]]), () => ({ from: 1, to: now }),
      false, () => [], new Coverage(), () => now);
    const info = vi.fn();
    layer.onInfo = info;
    layer.setLayout({ kind: 'axis', inset: 0 });
    layer.attached({
      chart: { paneSize: () => ({ width: 500, height: 200 }) },
      series: { coordinateToPrice: (y: number) => 110 - y / 10, priceToCoordinate: (p: number) => (110 - p) * 10 },
      requestUpdate: () => layer.updateAllViews(),
    } as Parameters<typeof layer.attached>[0]);
    layer.updateAllViews();
    const snapshot = (deltaMicros: bigint, buy: { pendingUsd: number; missingUsd: number }, to: number) =>
      expect.objectContaining({ to, active: expect.objectContaining({
        low: 100, high: 105, visits: { count: 1, deltaMicros, partial: true },
        reaction: expect.objectContaining({ buy: expect.objectContaining(buy) }),
      }) });
    expect(info).toHaveBeenLastCalledWith(snapshot(100_000_000n, { pendingUsd: 100, missingUsd: 0 }, 40_000));
    now = 45_000;
    vi.advanceTimersByTime(5_000);
    expect(info).toHaveBeenLastCalledWith(snapshot(50_000_000n, { pendingUsd: 0, missingUsd: 100 }, 45_000));
    layer.setCutoff(40_000);
    expect(info).toHaveBeenLastCalledWith(snapshot(100_000_000n, { pendingUsd: 100, missingUsd: 0 }, 40_000));
    layer.detached();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
