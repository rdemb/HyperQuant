import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { Coverage } from '../../../charts/pro/core/coverage';
import { Tape } from '../../../charts/pro/core/tape';
import { ProStore } from '../../../charts/pro/store/proStore';
import { Hip3PublicFlow } from '../Hip3PublicFlow';
import { executionWindow, visibleExecutions } from '../hip3Flow';

vi.mock('../../../charts/pro/store/useStoreVersion', () => ({ useStoreVersion: () => 0 }));

it('uses full trade coverage, actual price levels and quantity-weighted VWAP', () => {
  const tape = new Tape();
  tape.insert([
    { t: 9, px: 10, sz: 15, side: 1, tid: 1 },
    { t: 11, px: 10, sz: 2, side: 1, tid: 2 },
    { t: 12, px: 12, sz: 3, side: -1, tid: 3 },
    { t: 13, px: 10, sz: 1, side: -1, tid: 4 },
    { t: 20, px: 12, sz: 99, side: 1, tid: 5 },
  ]);
  const covers = new Coverage([[10, 20]]);
  expect(executionWindow(tape, covers, 10, 20)).toEqual({
    count: 3, turnoverUsd: 66, deltaUsd: -26, buyUsd: 20, sellUsd: 46, vwap: 11,
    profile: [{ px: 12, buyUsd: 0, sellUsd: 36 }, { px: 10, buyUsd: 20, sellUsd: 10 }],
  });
  expect(executionWindow(tape, new Coverage([[10, 14], [15, 20]]), 10, 20)).toBeNull();
  expect(executionWindow(tape, covers, 14, 20)).toMatchObject({ count: 0, vwap: null, profile: [] });
  expect(visibleExecutions(tape, 19, 25, 10, 10, -1).map(fill => fill.tid)).toEqual([3]);
});

it('shows an independent date and warning for old settled funding with a fresh market context', () => {
  const now = Date.UTC(2026, 10, 19, 12);
  const store = new ProStore(undefined, 'xyz:GOLD');
  store.serverNow = () => now;
  store.status = 'open';
  store.ctxReceivedAt = now;
  store.ctx = { markPx: 3700, oraclePx: 3700, midPx: 3700, funding: 0.00001, openInterest: 2, dayNtlVlm: 100, prevDayPx: 3700, premium: 0 };
  const settlement = now - 2 * 86400000;
  store.funding.add([{ time: settlement, rate: 0.00002, premium: 0 }], settlement);
  const render = () => renderToStaticMarkup(<Hip3PublicFlow store={store} tab="market" onTab={() => {}} />);
  expect(render()).toMatch(/datetime="2026-11-17T12:00:00\.000Z"/i);
  expect(render()).toMatch(/Historia fundingu nieaktualna|Funding history out of date/);

  store.funding.add([{ time: now, rate: 0, premium: 0 }], settlement);
  expect(render()).toMatch(/datetime="2026-11-19T12:00:00\.000Z"/i);
  expect(render()).not.toMatch(/Historia fundingu nieaktualna|Funding history out of date/);
});
