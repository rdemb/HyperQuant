import { expect, it } from 'vitest';
import { LevelControlTrial, ordinaryControl } from '../core/smcControlReplay';
import type { ObservedPrint } from '../core/smcObservation';
import { ObservationJournal } from '../core/smcObservation';
import { SmcOrderflow } from '../core/smcOrderflow';
const p = (time: number, px: number, observedAt = time): ObservedPrint => ({ time, px, observedAt, receivedAt: observedAt, seq: time, tid: time, side: 1, sz: 1, late: false });
const cfg = { selectedAt: 10, horizonMs: 20, atr: 10, dir: 1 as const, target: { lo: 99, hi: 101 }, control: { lo: 109, hi: 111 }, maxGapMs: 12000 };
it('registers contacts and paired terminal reactions only once their endpoints are observed', () => {
  const trial = new LevelControlTrial(cfg);
  trial.observe([p(11, 100), p(12, 110), p(30, 120)], 30, true);
  expect(trial.snapshot().n).toBe(0);
  trial.observe([p(32, 130)], 32, true);
  expect(trial.snapshot()).toMatchObject({ n: 1, nSmc: 1, nControl: 1, differenceAtr: 0 });
  const a = trial.snapshot(); trial.observe([p(99, 1000)], 99, true);
  expect(trial.snapshot()).toEqual(a);
});
it('keeps no-control and interrupted outcomes as real missing trials', () => {
  const trial = new LevelControlTrial({ ...cfg, control: null });
  trial.observe([p(11, 100), p(32, 120)], 32, false);
  expect(trial.snapshot()).toMatchObject({ n: 0, nSmc: 0, nControl: 0, differenceAtr: null });
});
it('ignores future and pre-registration prints and does not extrapolate an unconfirmed endpoint', () => {
  const trial = new LevelControlTrial(cfg);
  trial.observe([p(5, 100), p(11, 100, 50)], 30, true);
  expect(trial.snapshot().nSmc).toBe(0);
  trial.observe([p(12, 100)], 100, true);
  expect(trial.snapshot().nSmc).toBe(0);
});
it('selects a nonoverlapping ordinary candle level using closed history only', () => {
  const bars = [{ t: 0, o: 100, h: 110, l: 90, c: 100 }, { t: 10, o: 100, h: 100.1, l: 99.9, c: 100 }];
  const out = ordinaryControl({ lo: 108, hi: 110, atr: 10 }, bars, 10, 10);
  // Current, not-yet-closed candle cannot provide a closer control.
  expect(out).toBeNull();
});
it('wires preregistered controls through model snapshots without changing past replay', () => {
  const j = new ObservationJournal('BTC'); j.open(0, 0);
  const m = new SmcOrderflow(j, 10), e = { id: 'o', kind: 'ob' as const, known: 0, lo: 99, hi: 101, dir: 1 as const, atr: 10, expiresAt: 10000 };
  const bars = [-20, -10].map(t => ({ t, o: 105, h: 110, l: 90, c: 105 }));
  m.update([e], bars, 'mixed', 0);
  expect(m.current('o')!.comparison?.control).toEqual({ lo: 109, hi: 111 });
  const before = JSON.stringify(m.at('o', 0));
  j.trades([p(1, 100), p(2, 110), p(30, 120), p(32, 130)], 32);
  m.update([e], bars, 'mixed', 32);
  expect(m.current('o')!.comparison).toMatchObject({ n: 1, differenceAtr: 0 });
  expect(JSON.stringify(m.at('o', 0))).toBe(before);
});
