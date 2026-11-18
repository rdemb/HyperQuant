import { expect, it, vi } from 'vitest';
import { ObservationJournal } from '../core/smcObservation';
import { SmcOrderflow, formationProfile, type FlowElement } from '../core/smcOrderflow';

const base: FlowElement = { id: 'review', kind: 'ob', known: 0, lo: 99, hi: 101, dir: 1, atr: 10, expiresAt: 1e9 };
for (const dir of [1, -1] as const) {
  it(`A03 ended ${dir}: latches lost unprocessed sequence and preserves old replay`, () => {
    const j = new ObservationJournal('BTC', { trades: 2, books: 2 }); j.open(0, 0);
    const e = { ...base, dir, endAt: 100 }, m = new SmcOrderflow(j);
    m.update([e], [], 'up', 0);
    j.trades([{ time: 10, tid: 1, px: 100, sz: 1, side: dir }], 10); m.update([e], [], 'up', 10);
    m.update([e], [], 'up', 100); const old = JSON.stringify(m.at(e.id, 100));
    j.trades([2, 3, 4].map(tid => ({ time: 20, tid, px: 100, sz: 1, side: dir })), 200);
    m.update([e], [], 'up', 200);
    const s = m.current(e.id)!;
    expect(s.complete).toBe(false); expect(s.reason).toBe('buffer'); expect(s.defense).toBe('unknown');
    expect(s.recent.every(c => !c.complete)).toBe(true);
    expect(JSON.stringify(m.at(e.id, 100))).toBe(old);
    j.trades([{ time: 30, tid: 5, px: 100, sz: 1, side: dir }], 201); m.update([e], [], 'up', 201);
    expect(m.current(e.id)?.complete).toBe(false);
  });
  it(`A03 ended ${dir}: processed raw eviction keeps exact anchored sums complete`, () => {
    const j = new ObservationJournal('BTC', { trades: 2, books: 2 }); j.open(0, 0);
    const e = { ...base, dir, endAt: 100 }, m = new SmcOrderflow(j); m.update([e], [], 'up', 0);
    for (let n = 1; n <= 8; n++) {
      const observedAt = n <= 2 ? n * 10 : 100 + n;
      if (n === 3) m.update([e], [], 'up', 100);
      j.trades([{ time: n * 10, tid: n, px: 100, sz: 1, side: dir }], observedAt);
      m.update([e], [], 'up', observedAt);
    }
    const s = m.current(e.id)!;
    expect(s.since.volume).toBe(8); expect(s.since.delta).toBe(8 * dir);
    expect(s.complete).toBe(true); expect(s.reason).toBeNull(); expect(j.stats().trades).toBe(2);
  });
  for (const ended of [false, true]) it(`A02 dir${dir} ended${ended}: chronological L2 refreshes once at receipt`, () => {
    const j = new ObservationJournal('BTC'); j.open(0, 0); const end = 125 * 60000, origin = 110 * 60000;
    const book = (time: number) => ({ time, bids: [{ px: 99, sz: 1 }, { px: 98, sz: 1 }], asks: [{ px: 101, sz: 1 }, { px: 102, sz: 1 }] });
    for (let t = 0; t < end; t += 5000) {
      j.trades([{ time: t, tid: t, px: 100, sz: t >= origin ? 100 : 1, side: dir }], t);
      if (t < end - 10000) j.book(book(t), t, 1);
    }
    const e: FlowElement = { ...base, kind: 'fvg', dir, known: end, originFrom: origin, endAt: ended ? end : undefined };
    const m = new SmcOrderflow(j); m.update([e], [], 'up', end);
    const old = JSON.stringify(m.at(e.id, end)); expect(m.current(e.id)?.fvg?.depthUsd).toBeNull();
    j.book(book(end - 10000), end + 1, 1); m.update([e], [], 'up', end + 1);
    expect(m.current(e.id)?.fvg?.depthUsd).toBe(200);
    expect(m.current(e.id)?.fvg).toEqual(formationProfile(j, e, 300000, end + 1));
    expect(JSON.stringify(m.at(e.id, end))).toBe(old);
    const revision = j.revision, events = m.events(e.id).length;
    j.book(book(end - 10000), end + 2, 1); m.update([e], [], 'up', end + 2);
    expect(j.revision).toBe(revision); expect(m.events(e.id)).toHaveLength(events);
    const depth = vi.spyOn(j.bins, 'depth'), profile = JSON.stringify(m.current(e.id)?.fvg);
    j.book(book(end + 5000), end + 5001, 1); m.update([e], [], 'up', end + 5001);
    expect(depth).not.toHaveBeenCalled(); expect(JSON.stringify(m.current(e.id)?.fvg)).toBe(profile);
    depth.mockRestore();
  });
}
