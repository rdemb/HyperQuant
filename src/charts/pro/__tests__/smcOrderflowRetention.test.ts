import { expect, it } from 'vitest';
import { ObservationJournal } from '../core/smcObservation';
import { SmcOrderflow, type FlowElement } from '../core/smcOrderflow';
import { flowAlignment } from '../chart/smcOrderflowAdapter';
const e: FlowElement = { id: 'ob', kind: 'ob', known: 0, lo: 99, hi: 101, dir: 1, atr: 1, expiresAt: 1e10 };

it('preserves a long contact accumulator and bounds raw data, states and exact prices', () => {
  const j = new ObservationJournal('BTC', { trades: 10, books: 2 }); j.open(0, 0); const m = new SmcOrderflow(j);
  m.update([e], [], 'up', 0);
  for (let i = 1; i <= 4000; i++) {
    j.trades([{ time: i * 10000, tid: i, px: 100, sz: 1, side: 1 }], i * 10000);
    m.update([e], [], 'up', i * 10000);
  }
  expect(m.current('ob')?.since.volume).toBe(4000); expect(m.current('ob')?.complete).toBe(true);
  expect(j.stats().trades).toBe(10); expect(m.events('ob')).toHaveLength(256);
  expect(m.at('ob', 1)).toBeNull(); expect(m.events('ob')[0].observedAt).toBeGreaterThanOrEqual(10000);
  expect(m.events('ob').some(x => x.kind === 'contact')).toBe(true);
  expect(m.events('ob').find(x => x.kind === 'contact')?.snapshot.recent[0].flow.buy).toBe(1);
  expect(j.bins.stats().minutes).toBeLessThanOrEqual(360);
  const state = m.current('ob')!; state.zone.buy = -1;
  expect(m.current('ob')?.zone.buy).toBe(4000);
  expect(Object.isFrozen(m.events('ob')[0].snapshot.since)).toBe(true);
});

it('reports buffer loss to a starved consumer and latches incomplete anchored flow', () => {
  const j = new ObservationJournal('BTC', { trades: 3, books: 2 }); j.open(0, 0); const m = new SmcOrderflow(j);
  m.update([e], [], 'up', 0);
  j.trades([{ time: 1, tid: 1, px: 100, sz: 1, side: 1 }], 1); m.update([e], [], 'up', 1);
  for (let i = 2; i <= 10; i++) j.trades([{ time: i, tid: i, px: 100, sz: 1, side: 1 }], i);
  m.update([e], [], 'up', 10);
  expect(m.current('ob')?.complete).toBe(false); expect(m.current('ob')?.reason).toBe('buffer');
  expect(flowAlignment(m.current('ob')!)).toBe('unavailable');
});

it('does not create another contact inside the zone after the six-bar timeout', () => {
  const j = new ObservationJournal('BTC'); j.open(0, 0); const m = new SmcOrderflow(j, 60000);
  m.update([e], [], 'up', 0);
  j.trades([{ time: 1, tid: 1, px: 100, sz: 1, side: -1 }], 1); m.update([e], [], 'up', 1);
  const bars = Array.from({ length: 7 }, (_, i) => ({ t: i * 60000, o: 100, h: 100, l: 100, c: 100 }));
  m.update([e], bars, 'up', 420000);
  expect(m.current('ob')?.recent[0].result).toBe('expired');
  j.trades([{ time: 420001, tid: 2, px: 100, sz: 1, side: -1 }], 420001); m.update([e], bars, 'up', 420001);
  expect(m.current('ob')?.contacts).toBe(1);
  j.trades([{ time: 420002, tid: 3, px: 101.1, sz: 1, side: 1 }, { time: 420003, tid: 4, px: 100, sz: 1, side: -1 }], 420003);
  m.update([e], bars, 'up', 420003); expect(m.current('ob')?.contacts).toBe(2);
});

it('requires an observed level test rather than an assumed retest between prints', () => {
  const j = new ObservationJournal('BTC'); j.open(0, 0); const m = new SmcOrderflow(j, 60000, .1);
  const sweep: FlowElement = { ...e, kind: 'sweep', lo: 100, hi: 100 };
  m.update([sweep], [], 'down', 0);
  for (const [i, px] of [99, 101, 99, 100].entries()) {
    j.trades([{ time: i + 1, tid: i, px, sz: 1, side: -1 }], i + 1); m.update([sweep], [], 'down', i + 1);
    expect(m.current('ob')?.sweep?.retest).toBe(i === 3 ? 4 : null);
  }
});

it('compares both directions after two completed episodes and uses all anchored flow for alignment', () => {
  for (const dir of [1, -1] as const) {
    const j = new ObservationJournal('BTC'); j.open(0, 0); const m = new SmcOrderflow(j, 60000, .01);
    const zone = { ...e, dir }; m.update([zone], [], dir === 1 ? 'up' : 'down', 0);
    let t = 0;
    for (const size of [100, 120]) {
      j.trades([{ time: ++t, tid: t, px: 100, sz: size, side: dir === 1 ? -1 : 1 }], t); m.update([zone], [], 'up', t);
      j.trades([{ time: ++t, tid: t, px: dir === 1 ? 102 : 98, sz: 500, side: dir }], t); m.update([zone], [], dir === 1 ? 'up' : 'down', t);
    }
    expect(m.current('ob')?.defense).toBe('absorption');
    expect(flowAlignment(m.current('ob')!)).toBe('aligned');
    m.update([zone], [], dir === 1 ? 'down' : 'up', t + 1);
    expect(flowAlignment(m.current('ob')!)).toBe('divergent');
  }
});

it('does not lose a received print when the adjusted server clock briefly moves backwards', () => {
  const j = new ObservationJournal('BTC'); j.open(0, 0); const m = new SmcOrderflow(j); m.update([e], [], 'up', 0);
  j.trades([{ time: 10, tid: 1, px: 100, sz: 2, side: 1 }], 12, 100);
  m.update([e], [], 'up', 11); m.update([e], [], 'up', 20);
  expect(m.current('ob')?.since.volume).toBe(2); expect(j.tradesAfter(0)[0].receivedAt).toBe(100);
});

it('does not invent an old contact from the tail of an evicted raw buffer', () => {
  const j = new ObservationJournal('BTC', { trades: 2, books: 2 }); j.open(0, 0);
  for (let t = 1; t <= 5; t++) j.trades([{ time: t, tid: t, px: 100, sz: 1, side: 1 }], t);
  const m = new SmcOrderflow(j); m.update([e], [], 'up', 6);
  expect(m.current('ob')?.anchor).toBeNull(); expect(m.current('ob')?.contacts).toBe(0);
});

it('produces the same final contact in batch and incremental delivery across a candle close', () => {
  const zone = { ...e, endAt: 60000 };
  const bar = { t: 0, o: 100, h: 100, l: 98, c: 98 };
  const trades = [{ time: 1, tid: 1, px: 100, sz: 1, side: -1 as const }, { time: 90000, tid: 2, px: 102, sz: 1, side: 1 as const }];
  const run = (batch: boolean) => {
    const j = new ObservationJournal('BTC'); j.open(0, 0); const m = new SmcOrderflow(j, 60000); m.update([zone], [], 'up', 0);
    if (batch) { j.trades(trades, 90000); m.update([zone], [bar], 'up', 90000); }
    else for (const t of trades) { j.trades([t], t.time); m.update([zone], t.time >= 60000 ? [bar] : [], 'up', t.time); }
    const s = m.current('ob')!; return { contacts: s.contacts, result: s.recent[0].result, volume: s.since.volume, ended: s.ended };
  };
  expect(run(true)).toEqual(run(false)); expect(run(true)).toEqual({ contacts: 1, result: 'broken', volume: 1, ended: true });
});

it('does not turn a delayed print from an ended contact into a new contact', () => {
  const j = new ObservationJournal('BTC'); j.open(0, 0); const m = new SmcOrderflow(j); m.update([e], [], 'up', 0);
  j.trades([{ time: 1, tid: 1, px: 100, sz: 1, side: -1 }, { time: 3, tid: 3, px: 102, sz: 1, side: 1 }], 3); m.update([e], [], 'up', 3);
  const before = JSON.stringify(m.at('ob', 3));
  j.trades([{ time: 2, tid: 2, px: 100, sz: 2, side: -1 }], 10); m.update([e], [], 'up', 10);
  expect(m.current('ob')?.contacts).toBe(1); expect(m.current('ob')?.since.volume).toBe(4);
  expect(JSON.stringify(m.at('ob', 3))).toBe(before); expect(m.current('ob')?.defense).toBe('unknown');
});

it('corrects a completed sweep at receipt time and keeps its earlier interpretation immutable', () => {
  const j = new ObservationJournal('BTC'); j.open(0, 0); const m = new SmcOrderflow(j, 60000);
  const sweep = { ...e, kind: 'sweep' as const, lo: 100, hi: 100 };
  m.update([sweep], [], 'down', 0);
  j.trades([{ time: 1, tid: 1, px: 99, sz: 10, side: -1 }], 1);
  const bars = [0, 60000, 120000].map(t => ({ t, o: 99, h: 99, l: 99, c: 99 }));
  m.update([sweep], bars, 'down', 180000);
  expect(m.current('ob')?.sweep?.state).toBe('initiative');
  const old = JSON.stringify(m.at('ob', 180000));
  j.trades([{ time: 180001, tid: 3, px: 99, sz: 1, side: -1 }, { time: 2, tid: 2, px: 99, sz: 100, side: 1 }], 200000);
  m.update([sweep], bars, 'down', 200000);
  expect(m.current('ob')?.sweep?.state).toBe('return-only');
  expect(JSON.stringify(m.at('ob', 180000))).toBe(old);
  expect(m.current('ob')?.sweep?.below?.buy).toBe(100);
});

it('does not confirm a three-bar interpretation if a closed candle is missing', () => {
  const j = new ObservationJournal('BTC'); j.open(0, 0); const m = new SmcOrderflow(j, 60000);
  const sweep = { ...e, kind: 'sweep' as const, lo: 100, hi: 100 };
  m.update([sweep], [], 'down', 0);
  j.trades([{ time: 1, tid: 1, px: 99, sz: 10, side: -1 }], 1);
  m.update([sweep], [{ t: 0, o: 99, h: 99, l: 99, c: 99 }], 'down', 180000);
  expect(m.current('ob')?.sweep?.state).toBe('unknown');
});

it('keeps confirmed OB boundaries and ATR fixed when more candle history arrives', () => {
  const j = new ObservationJournal('BTC'); j.open(0, 0); const m = new SmcOrderflow(j); m.update([e], [], 'up', 0);
  m.update([{ ...e, lo: 50, hi: 150, atr: 100 }], [], 'up', 10);
  j.trades([{ time: 11, tid: 11, px: 120, sz: 1, side: 1 }], 11); m.update([{ ...e, lo: 50, hi: 150, atr: 100 }], [], 'up', 11);
  expect(m.current('ob')?.anchor).toBeNull(); expect(m.current('ob')?.atr).toBe(1);
});

it('caps elements at 64 and preserves exact totals through a large packet and duplicate reconnect', () => {
  const j = new ObservationJournal('BTC'), m = new SmcOrderflow(j); j.open(0, 0);
  const elements = Array.from({ length: 128 }, (_, i) => ({ ...e, id: `${i}` })); m.update(elements, [], 'up', 0);
  const burst = Array.from({ length: 10000 }, (_, i) => ({ time: i + 1, tid: i + 1, px: 100, sz: 1, side: 1 as const }));
  j.trades(burst, 10000); m.update(elements, [], 'up', 10000);
  expect(m.stats().elements).toBe(64); expect(m.current('0')?.since.volume).toBe(10000);
  j.close(10000, 10001, 'disconnect'); j.open(10000, 10002); j.trades(burst, 10002); m.update(elements, [], 'up', 10002);
  expect(m.current('0')?.since.volume).toBe(10000); expect(m.current('0')?.complete).toBe(false);
});

it('invalidates a completed interval if a subsequently detected gap overlaps it', () => {
  const j = new ObservationJournal('BTC'); j.open(0, 0); const m = new SmcOrderflow(j); const zone = { ...e, endAt: 10 };
  m.update([zone], [], 'up', 0); j.trades([{ time: 1, tid: 1, px: 100, sz: 1, side: 1 }], 1); m.update([zone], [], 'up', 1);
  m.update([zone], [], 'up', 10); const old = JSON.stringify(m.at('ob', 10));
  j.close(5, 20, 'disconnect'); m.update([zone], [], 'up', 20);
  expect(m.current('ob')?.complete).toBe(false); expect(JSON.stringify(m.at('ob', 10))).toBe(old);
});
