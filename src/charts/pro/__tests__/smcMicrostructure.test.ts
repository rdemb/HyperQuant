import { expect, it } from 'vitest';
import { ObservationJournal, type ObservedPrint } from '../core/smcObservation';
import { sweepExcursion, equalNotional, depthRecovery, selectControl, compareReactions } from '../core/smcMicrostructure';
import { SmcOrderflow } from '../core/smcOrderflow';

const trade = (time: number, px: number, sz = 1, side: 1 | -1 = 1, observedAt = time): ObservedPrint => ({ time, px, sz, side, observedAt, receivedAt: observedAt, tid: time, seq: time, late: false });
const journal = () => { const j = new ObservationJournal('BTC'); j.open(0, 0); return j; };
const sweep = { from: 0, boundary: 100, outside: 1 as const, maxGapMs: 12000 };
it('measures sweep time and USD through return, freezes against future prints', () => {
  const j = journal(); j.trades([trade(0, 99), trade(10, 101), trade(20, 102), trade(30, 100)], 30);
  const a = sweepExcursion(j, sweep, 30);
  expect(a.outsideMs).toBe(20); expect(a.returnAt).toBe(30); expect(a.frozen).toBe(true);
  expect(a.outsideShare).toBeCloseTo(203 / 402); expect(a.timeCoverage).toBe(1);
  j.trades([trade(40, 1000), trade(15, 10000)], 40);
  expect(sweepExcursion(j, sweep, 40)).toEqual(a);
});
it('does not show sweep before observed receipt or extrapolate the last price', () => {
  const j = journal(); j.trades([trade(10, 101), trade(20, 100)], 100);
  expect(sweepExcursion(j, sweep, 99).startAt).toBeNull();
  const k = journal(); k.trades([trade(10, 101)], 10);
  expect(sweepExcursion(k, sweep, 1000).outsideMs).toBe(0);
  expect(sweepExcursion(k, sweep, 1000).timeCoverage).toBeNull();
});
it('marks long unknown intervals and missing tape instead of claiming complete turnover', () => {
  const j = journal(); j.trades([trade(0, 101), trade(13000, 100)], 13000);
  const m = sweepExcursion(j, sweep, 13000);
  expect(m.timeCoverage).toBe(0); expect(m.unknownMs).toBe(13000);
  j.close(5000, 14000, 'gap');
  // Once frozen, later gap announcements cannot rewrite that observation.
  expect(sweepExcursion(j, sweep, 14000)).toEqual(m);
  const k = journal(); k.close(1, 1, 'gap'); k.trades([trade(10, 101), trade(20, 100)], 20);
  expect(sweepExcursion(k, sweep, 20).outsideShare).toBeNull();
});
it('mirrors sweep direction and counts boundary trade in denominator', () => {
  const j = journal(); j.trades([trade(10, 99), trade(20, 100)], 20);
  const m = sweepExcursion(j, { ...sweep, outside: -1 }, 20);
  expect(m.outsideMs).toBe(10); expect(m.outsideShare).toBeCloseTo(99 / 199);
});
it('uses whole crossing print without price interpolation and excludes opposite aggressor', () => {
  const rows = [trade(1, 100, 1, -1), trade(2, 50, 100, 1), trade(3, 80, 2.5, -1)];
  const m = equalNotional(rows, { from: 0, to: 4, lo: 70, hi: 110, dir: 1, atr: 10, budgetUsd: 150, complete: true }, 4);
  expect(m.reachedAt).toBe(3); expect(m.overshootUsd).toBe(150);
  expect(m.penetration).toBe(60); expect(m.penetrationAtr).toBe(6);
});
it('does not compare notional when budget is unmet, tape missing, or future/late', () => {
  const c = { from: 0, to: 4, lo: 70, hi: 110, dir: 1 as const, atr: 10, budgetUsd: 150, complete: true };
  expect(equalNotional([trade(1, 100, 1, -1)], c, 4).penetration).toBeNull();
  expect(equalNotional([trade(1, 100, 2, -1, 8)], c, 4).reachedAt).toBeNull();
  expect(equalNotional([trade(1, 100, 2, -1)], { ...c, complete: false }, 4).penetration).toBeNull();
  expect(equalNotional([{ ...trade(1, 100, 2, -1), late: true }], c, 4).penetration).toBeNull();
});
const book = (time: number, sz: number, observedAt = time) => ({ time, observedAt, step: 1, bids: [{ px: 100, sz }, { px: 99, sz: 0 }], asks: [{ px: 101, sz: 1 }, { px: 102, sz: 1 }] });
it('uses pre-impact same-side same-price L2 with ratios above 100 percent', () => {
  const cfg = { hitAt: 10, side: 'bids' as const, lo: 100, hi: 100, maxGapMs: 12000 };
  expect(depthRecovery([book(0, 1), book(10, .5)], cfg, 10).ratio).toBe(.5);
  const m = depthRecovery([book(0, 1), book(10, .5), book(20, 1.2)], cfg, 20);
  expect(m.ratio).toBe(1.2); expect(m.baselineAt).toBe(0); expect(m.prices).toEqual([100]);
});
it('reports depth gaps, changed step, future baseline, and out-of-range prices as missing', () => {
  const cfg = { hitAt: 10, side: 'bids' as const, lo: 100, hi: 100, maxGapMs: 12000 };
  expect(depthRecovery([book(0, 1, 30), book(20, 1)], cfg, 20).ratio).toBeNull();
  expect(depthRecovery([book(0, 1), { ...book(20, 1), step: 2 }], cfg, 20).ratio).toBeNull();
  expect(depthRecovery([book(0, 1), book(13000, 1)], cfg, 13000).ratio).toBeNull();
  expect(depthRecovery([book(0, 1), { ...book(20, 1), bids: [{ px: 98, sz: 1 }] }], cfg, 20).ratio).toBeNull();
});
const target = { id: 'smc', knownAt: 0, selectedAt: 10, widthAtr: .1, distanceAtr: 1, volatility: 2 };
const tolerance = { widthAtr: .2, distanceAtr: .2, volatility: .2 };
it('chooses ordinary controls before outcome deterministically without future candidates', () => {
  const a = { ...target, id: 'ordinary-a', knownAt: 5 }, b = { ...a, id: 'ordinary-b' };
  expect(selectControl(target, [b, { ...a, id: 'future', knownAt: 11 }, a], tolerance)?.id).toBe('ordinary-a');
  expect(selectControl(target, [{ ...a, distanceAtr: 2 }], tolerance)).toBeNull();
  expect(selectControl(target, [{ ...a, selectedAt: 25 }], tolerance)).toBeNull();
});
it('invalidates L2 recovery across explicit disconnect even for short snapshot gaps', () => {
  const c = { hitAt: 10, side: 'bids' as const, lo: 100, hi: 100, maxGapMs: 12000, complete: false };
  expect(depthRecovery([book(0, 1), book(20, 1)], c, 20).ratio).toBeNull();
});
it('reports real sample counts and no result before outcome observedAt', () => {
  const pair = { selectedAt: 10, smc: { endAt: 20, observedAt: 25, reactionAtr: 2 }, control: { endAt: 20, observedAt: 21, reactionAtr: 1 } };
  expect(compareReactions([pair], 24)).toMatchObject({ n: 0, differenceAtr: null });
  expect(compareReactions([pair], 25)).toMatchObject({ n: 1, differenceAtr: 1 });
  expect(compareReactions([], 100)).toMatchObject({ n: 0, differenceAtr: null });
});
it('connects original sweep to model and retains frozen measurement after raw eviction', () => {
  const j = new ObservationJournal('BTC', { trades: 4, books: 2 }); j.open(0, 0);
  j.trades([trade(0, 99), trade(10, 101), trade(20, 102), trade(30, 100)], 30);
  const m = new SmcOrderflow(j), e = { id: 's', kind: 'sweep' as const, known: 40, originFrom: 0, lo: 100, hi: 100, dir: 1 as const, atr: 1, expiresAt: 1e9 };
  m.update([e], [], 'mixed', 40);
  const a = m.current('s')!.sweep!.excursion;
  expect(a?.outsideMs).toBe(20); expect(a?.frozen).toBe(true);
  j.trades([trade(50, 105), trade(60, 110), trade(70, 100), trade(80, 90)], 80);
  m.update([e], [], 'mixed', 80);
  expect(m.current('s')!.sweep!.excursion).toEqual(a);
  expect(m.at('s', 39)).toBeNull();
});
it('freezes equal-USD penetration and same-price L2 in a completed model contact', () => {
  const j = journal(); j.book(book(0, 1), 0, 1);
  const m = new SmcOrderflow(j, 300000, .1, 150);
  const e = { id: 'ob', kind: 'ob' as const, known: 0, lo: 99, hi: 101, dir: 1 as const, atr: 10, expiresAt: 1e9 };
  m.update([e], [], 'mixed', 0);
  j.trades([trade(10, 100, 1, -1)], 10); j.book(book(10, .5), 10, 1);
  m.update([e], [], 'mixed', 10);
  j.trades([trade(20, 99, 2, -1), trade(30, 104, 1, 1)], 30); j.book(book(20, 1.2), 20, 1);
  m.update([e], [], 'mixed', 30);
  const c = m.current('ob')!.recent[0];
  expect(c.matched?.budgetUsd).toBe(150); expect(c.matched?.penetration).toBe(2);
  expect(c.matched?.overshootUsd).toBe(148); expect(c.recovery?.baselineAt).toBe(0);
  const frozen = JSON.stringify(c);
  j.book(book(40, 100), 40, 1); m.update([e], [], 'mixed', 40);
  expect(JSON.stringify(m.current('ob')!.recent[0])).toBe(frozen);
});
