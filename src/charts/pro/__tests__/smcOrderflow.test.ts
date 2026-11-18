import { expect, it } from 'vitest';
import { ObservationJournal } from '../core/smcObservation';
import { formationProfile, SmcOrderflow, type FlowElement } from '../core/smcOrderflow';

const element = (patch: Partial<FlowElement> = {}): FlowElement => ({ id: 'ob:1', kind: 'ob', known: 0, lo: 99, hi: 101, dir: 1, atr: 10, expiresAt: 1e9, ...patch });
it('anchors exact zone/since delta and VWAP, without participants or duplicate volume', () => {
  const j = new ObservationJournal('BTC'); j.open(0, 0);
  const m = new SmcOrderflow(j); m.update([element()], [], 'up', 0);
  const ts = [{ time: 1, tid: 1, px: 100, sz: 2, side: 1 as const }, { time: 2, tid: 2, px: 101, sz: 1, side: -1 as const }, { time: 3, tid: 3, px: 102, sz: 3, side: 1 as const }];
  j.trades(ts, 4); j.trades(ts, 5); m.update([element()], [], 'up', 5);
  const s = m.current('ob:1')!;
  expect(s.zone.delta).toBe(1); expect(s.since.delta).toBe(4);
  expect(s.zone.pv / s.zone.volume).toBeCloseTo(301 / 3);
  expect(s.since.pv / s.since.volume).toBeCloseTo(607 / 6);
  expect(m.at('ob:1', 0)?.anchor).toBeNull();
  expect(m.at('ob:1', 5)?.since.count).toBe(3);
});

it('compares completed contacts, mirrors direction and does not count ticks as contacts', () => {
  for (const dir of [1, -1] as const) {
    const j = new ObservationJournal('BTC'); j.open(0, 0); const m = new SmcOrderflow(j);
    const e = element({ dir, lo: 1000, hi: 1100, atr: 100 }); m.update([e], [], 'mixed', 0);
    const px = (penetration: number) => dir === 1 ? 1100 - penetration : 1000 + penetration;
    let time = 0;
    for (const [p, sz] of [[20, 100], [30, 90]]) {
      j.trades([{ time: ++time, tid: time, px: px(p), sz, side: dir === 1 ? -1 : 1 }], time);
      m.update([e], [], 'mixed', time);
      expect(m.current(e.id)?.defense).not.toBe('weakening');
      j.trades([{ time: ++time, tid: time, px: dir === 1 ? 1220 - 3 * p : 880 + 3 * p, sz: 1, side: dir }], time);
      m.update([e], [], 'mixed', time);
    }
    expect(m.current(e.id)?.contacts).toBe(2);
    expect(m.current(e.id)?.defense).toBe('weakening');
  }
});

it('records late observations and gaps at receipt time, preserving previous replay snapshots', () => {
  const j = new ObservationJournal('BTC'); j.open(0, 0); const m = new SmcOrderflow(j); const e = element();
  m.update([e], [], 'up', 0);
  j.trades([{ time: 10, tid: 1, px: 100, sz: 1, side: 1 }], 10); m.update([e], [], 'up', 10);
  const old = JSON.stringify(m.at(e.id, 10));
  j.close(11, 30, 'disconnect'); m.update([e], [], 'down', 30);
  expect(m.current(e.id)?.complete).toBe(false);
  expect(JSON.stringify(m.at(e.id, 10))).toBe(old);
  expect(m.at(e.id, 10)?.structure).toBe('up');
});

it('confirms initiative only after three full closed bars; no tick means no retest', () => {
  const j = new ObservationJournal('BTC'); j.open(0, 0); const m = new SmcOrderflow(j, 60000);
  const e = element({ id: 'sweep:1', kind: 'sweep', lo: 100, hi: 100, dir: 1 }); m.update([e], [], 'down', 0);
  j.trades([{ time: 1, tid: 1, px: 99, sz: 10, side: -1 }], 2);
  const bars = [0, 60000, 120000].map(t => ({ t, o: 99, h: 99.5, l: 98, c: 99 }));
  m.update([e], bars.slice(0, 2), 'down', 120000);
  expect(m.current(e.id)?.sweep?.state).toBe('observing');
  m.update([e], bars, 'down', 180000);
  expect(m.current(e.id)?.sweep?.state).toBe('initiative');
  expect(m.current(e.id)?.sweep?.retest).toBeNull();
});

it('has positive 5m FVG evidence after 125 minutes, even after raw trade/depth eviction', () => {
  const j = new ObservationJournal('BTC', { trades: 10, books: 10 }); j.open(0, 0);
  const origin = 110 * 60000, end = 125 * 60000;
  for (let t = 0; t < end; t += 5000) {
    const large = t >= origin;
    j.trades([{ time: t, tid: t, px: 100, sz: large ? 100 : 1, side: 1 }], t);
    j.book({ time: t, bids: [{ px: 99, sz: large ? 1 : 10 }, { px: 98, sz: 1 }],
      asks: [{ px: 101, sz: large ? 1 : 10 }, { px: 102, sz: 1 }] }, t, 1);
  }
  const e = element({ kind: 'fvg', originFrom: origin, known: end });
  const f = formationProfile(j, e, 300000, end);
  expect(f.flowReferences).toBe(20); expect(f.depthReferences).toBe(20);
  expect(f.strongFlow).toBe(true); expect(f.lowLiquidity).toBe(true);
  expect(f.share).toBe(1); expect(j.stats().trades).toBe(10);
  const outside = formationProfile(j, { ...e, lo: 90 }, 300000, end);
  expect(outside.lowLiquidity).toBeNull();
  const frozen = JSON.stringify(f);
  j.trades([{ time: end + 1, tid: end + 1, px: 100, sz: 1e9, side: -1 }], end + 1);
  expect(JSON.stringify(formationProfile(j, e, 300000, end + 2))).toBe(frozen);
  const m = new SmcOrderflow(j); const filled = { ...e, endAt: end + 1000 };
  m.update([filled], [], 'up', end + 2); m.update([filled], [], 'up', end + 1000);
  expect(m.current(e.id)?.ended).toBe(true);
  const old = JSON.stringify(m.at(e.id, end + 1000));
  j.book({ time: end - 5000, bids: [{ px: 99, sz: 999 }, { px: 98, sz: 1 }], asks: [{ px: 101, sz: 999 }, { px: 102, sz: 1 }] }, end + 2000, 1);
  m.update([filled], [], 'up', end + 2000);
  expect(m.current(e.id)?.fvg?.lowLiquidity).toBeNull();
  expect(JSON.stringify(m.at(e.id, end + 1000))).toBe(old);
});

it('does not force flow and liquidity into exclusive causes, in either impulse direction', () => {
  for (const dir of [1, -1] as const) for (const [flow, low] of [[true, false], [false, true], [false, false]]) {
    const j = new ObservationJournal('BTC'); j.open(0, 0); const start = 110 * 60000, end = 125 * 60000;
    for (let t = 0; t < end; t += 5000) {
      const origin = t >= start;
      j.trades([{ time: t, tid: t, px: 100, sz: origin ? flow ? 100 : 1 : 10, side: dir }], t);
      const sz = origin ? low ? 1 : 100 : 10;
      j.book({ time: t, bids: [{ px: 99, sz }, { px: 98, sz: 1 }], asks: [{ px: 101, sz }, { px: 102, sz: 1 }] }, t, 1);
    }
    const f = formationProfile(j, element({ kind: 'fvg', dir, known: end, originFrom: start }), 300000, end);
    expect(f.strongFlow).toBe(flow); expect(f.lowLiquidity).toBe(low); expect(f.impulseShare).toBe(1);
  }
});
