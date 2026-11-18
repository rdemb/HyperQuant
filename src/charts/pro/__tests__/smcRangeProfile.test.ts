import { expect, it } from 'vitest';
import { Coverage } from '../core/coverage';
import { SmcRangeProfile, rangeProfileStep } from '../core/smcRangeProfile';
import { MINUTE, Tape } from '../core/tape';

const from = 60 * MINUTE;

it('uses executed USD before bucketing, including neutral volume and actual gaps', () => {
  const tape = new Tape();
  tape.insert([
    { t: from, tid: 1, px: 100, sz: 2, side: 1 },
    { t: from + 1, tid: 2, px: 100, sz: 1, side: -1 },
    { t: from + 2, tid: 3, px: 101, sz: 3, side: -1 },
    { t: from + 3, tid: 4, px: 102, sz: 1, side: 1 },
    { t: from + 4, tid: 5, px: 102, sz: 1, side: -1 },
    { t: from + 5, tid: 6, px: 107, sz: 1, side: 1 },
  ]);
  const profile = new SmcRangeProfile(tape);
  const coverage = new Coverage([[from, from + 4]]);
  expect(profile.read({ from, to: from + 5 }, 1, coverage)).toEqual({
    rows: [
      { price: 100, turnoverUsd: 300, deltaMicros: 100_000_000n },
      { price: 101, turnoverUsd: 303, deltaMicros: -303_000_000n },
      { price: 102, turnoverUsd: 204, deltaMicros: 0n },
    ],
    turnoverUsd: 807, deltaUsd: -203, coveredMs: 4, spanMs: 5,
  });
  expect(profile.read({ from, to: from + 6 }, 1, coverage).rows.map(row => row.price)).toEqual([100, 101, 102, 107]);
  const wide = profile.read({ from, to: from + 6 }, 5, coverage);
  expect(wide.rows).toEqual([{ price: 100, turnoverUsd: 807, deltaMicros: -203_000_000n }, { price: 105, turnoverUsd: 107, deltaMicros: 107_000_000n }]);
});

it('counts a replay boundary and merged history/live tape exactly once across minute and range changes', () => {
  const tape = new Tape();
  const profile = new SmcRangeProfile(tape);
  const coverage = new Coverage([[from, from + 2 * MINUTE]]);
  const middle = from + MINUTE;
  const shared = { t: middle, tid: 5, px: 101, sz: 3, side: -1 } as const;
  tape.insert([shared, { t: from, tid: 4, px: 100, sz: 1, side: 1 }]);
  expect(profile.read({ from, to: middle }, 1, coverage).turnoverUsd).toBe(100);
  tape.insert([shared, { t: middle + 1, tid: 6, px: 100, sz: 2, side: 1 }]);
  expect(profile.read({ from, to: middle + 1 }, 1, coverage).turnoverUsd).toBe(403);
  expect(profile.read({ from: middle, to: middle + 2 }, 1, coverage).turnoverUsd).toBe(503);
  expect(profile.read({ from, to: middle + 2 }, 1, coverage).deltaUsd).toBe(-3);
  tape.insert([{ t: from + 123, tid: 7, px: 104, sz: 1, side: 1 }]);
  expect(profile.read({ from, to: middle + 2 }, 1, coverage).turnoverUsd).toBe(707);
  tape.prune(middle);
  expect(profile.read({ from, to: middle + 2 }, 1, coverage).turnoverUsd).toBe(503);
  expect(profile.read({ from, to: middle + 2 }, 1, new Coverage()).coveredMs).toBe(0);
});

it('groups dense rows with the next 1/2/5 step and keeps empty tape empty', () => {
  expect(rangeProfileStep(64500, 65000, 14)).toBe(50);
  expect(rangeProfileStep(64500, 64930, 9)).toBe(50);
  expect(rangeProfileStep(64500, 65000, 9)).toBe(100);
  expect(rangeProfileStep(64500, 66000, 9)).toBe(200);
  expect(rangeProfileStep(100, 102, 14)).toBe(1);
  const profile = new SmcRangeProfile(new Tape());
  expect(profile.read({ from, to: from + MINUTE }, 1, new Coverage())).toEqual({
    rows: [], turnoverUsd: 0, deltaUsd: 0, coveredMs: 0, spanMs: MINUTE,
  });
});
