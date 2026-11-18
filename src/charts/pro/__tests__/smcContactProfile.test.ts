import { expect, it } from 'vitest';
import { ObservationJournal } from '../core/smcObservation';
import { SmcOrderflow, type FlowElement } from '../core/smcOrderflow';
import { contactProfileScale, contactProfileScene } from '../chart/smcContactProfile';

const zone: FlowElement = { id: 'ob:test', kind: 'ob', known: 0, lo: 99, hi: 101, dir: 1, atr: 4, expiresAt: 1e9 };
function setup(coin = 'BTC', cap = 50000) {
  const j = new ObservationJournal(coin, { trades: cap, books: 4 });
  j.open(0, 0);
  const m = new SmcOrderflow(j, 5000, .1);
  let tid = 0;
  const update = (now: number) => m.update([zone], [], 'up', now);
  update(0);
  const print = (time: number, px: number, sz: number, side: 1 | -1, observedAt = time) => {
    const row = { time, px, sz, side, tid: ++tid };
    j.trades([row], observedAt);
    j.trades([row], observedAt);
    update(observedAt);
  };
  return { j, m, print, update };
}

it('keeps the oracle contacts disjoint and treats an observation cutoff as receipt time', () => {
  const { m, print } = setup();
  print(10, 100, 2, 1);
  print(11, 100, 1, -1, 20);
  print(21, 102, 9, 1);
  print(22, 100, 2, -1);
  const live = m.contactProfiles(zone.id, null, null, true);
  expect(live?.current).toMatchObject({ ordinal: 2, active: true, status: 'complete', turnoverUsd: 200, deltaUsd: -200 });
  expect(live?.previous).toMatchObject({ ordinal: 1, active: false, status: 'complete', turnoverUsd: 300, deltaUsd: 100 });
  const current = live?.current.bins.find(b => b.turnoverUsd > 0);
  const previous = live?.previous?.bins.find(b => b.turnoverUsd > 0);
  expect(current).toMatchObject({ turnoverUsd: 200, deltaUsd: -200 });
  expect(previous).toMatchObject({ lo: current?.lo, hi: current?.hi, turnoverUsd: 300, deltaUsd: 100 });
  expect(contactProfileScale(live!)).toBe(300);
  const [sideA, sideB] = contactProfileScene(live!, true, p => 1000 - 10 * p);
  expect(sideA.bins[0]).toMatchObject({ top: sideB.bins[0].top, bottom: sideB.bins[0].bottom, turnover: 2 / 3, delta: -2 / 3 });
  expect(sideB.bins[0]).toMatchObject({ turnover: 1, delta: 1 / 3 });
  expect(m.contactProfiles(zone.id, 19, null, true)?.current).toMatchObject({ ordinal: 1, active: true, turnoverUsd: 200, deltaUsd: 200 });
  expect(m.contactProfiles(zone.id, 20, null, false)?.current).toMatchObject({ turnoverUsd: 300, deltaUsd: 100 });
  expect(m.contactProfiles(zone.id, null, 1, true)?.previous).toBeNull();
});

it('keeps a nonzero background at zero delta and uses a shared bounded grid', () => {
  const { m, print } = setup();
  print(10, 100, 2, 1);
  print(11, 100, 2, -1);
  const row = m.contactProfiles(zone.id, null, null, false)!.current;
  expect(row).toMatchObject({ turnoverUsd: 400, deltaUsd: 0 });
  expect(row.bins.length).toBeLessThanOrEqual(16);
  expect(row.bins.filter(b => b.turnoverUsd)).toEqual([expect.objectContaining({ turnoverUsd: 400, deltaUsd: 0 })]);
  expect(contactProfileScene({ current: row, previous: null }, false, p => 1000 - p)[0].bins[0]).toMatchObject({ turnover: 1, delta: 0 });
});

it('preserves accumulated profiles after raw eviction and marks unavailable prefixes', () => {
  const { m, print } = setup('BTC', 3);
  print(10, 100, 2, 1);
  print(11, 100, 1, -1);
  print(12, 102, 1, 1);
  print(13, 100, 1, 1);
  print(14, 102, 1, 1);
  print(15, 100, 1, 1);
  expect(m.contactProfiles(zone.id, null, 1, false)?.current).toMatchObject({ status: 'complete', turnoverUsd: 300 });
  expect(m.contactProfiles(zone.id, 10, 1, false)?.current).toMatchObject({ status: 'retention', bins: [] });
});

it('marks a known gap only after it is observed and never profile-enables another market', () => {
  const { j, m, print, update } = setup();
  print(10, 100, 2, 1);
  j.close(12, 20, 'disconnect');
  update(21);
  expect(m.contactProfiles(zone.id, 19, null, false)?.current).toMatchObject({ status: 'complete', deltaUsd: 200 });
  expect(m.contactProfiles(zone.id, null, null, false)?.current).toMatchObject({ status: 'coverage', bins: [] });
  const other = setup('ETH');
  other.print(10, 100, 2, 1);
  expect(other.m.contactProfiles(zone.id, null, null, true)).toBeNull();
});
