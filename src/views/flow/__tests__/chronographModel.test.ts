import { describe, expect, it } from 'vitest';
import { Coverage } from '../../../charts/pro/core/coverage';
import { Tape, type TradeRow } from '../../../charts/pro/core/tape';
import { levelTrial, readSizeThreshold, TAPE_MINIMUMS } from '../chronographModel';
import { tradeActivity } from '../orderFlowDesk';
import { demoWindows, LEVEL_TEST_PRICE, openChronographClip } from '../chronographHistory';

const fill = (t: number, px: number, sz: number, side: TradeRow['side'], tid: number): TradeRow =>
  ({ t, px, sz, side, tid });

describe('Chronograph', () => {
  it('grupuje identyczne nominały przed sprawdzeniem znaku delty', () => {
    const tape = new Tape();
    tape.insert([
      fill(10, 100, 1000, 1, 1),
      fill(11, 100, 800, -1, 2),
      fill(12, 100, 800, 1, 3),
      fill(13, 100, 600, -1, 4),
      fill(14, 100, 600, -1, 5),
      fill(15, 100, 600, -1, 6),
    ]);
    const coverage = new Coverage([[10, 20]]);
    const totals = tradeActivity(tape, coverage, 10, 20);
    expect(readSizeThreshold(tape, coverage, 10, 20, 100_000, 5)).toEqual({
      kind: 'covered', full: -800, filtered: 1000, count: 1, total: 6,
      crossing: { minimum: 60_000, delta: -800, tid: 6, time: 15 },
    });
    expect(tradeActivity(tape, coverage, 10, 20)).toEqual(totals);
    expect(TAPE_MINIMUMS).toEqual([0, 1_000, 10_000, 25_000, 50_000, 100_000, 200_000, 500_000, 1_000_000]);
  });

  it('wyłącza wnioskowanie o delcie i przejściu przez cenę przy luce', () => {
    const tape = new Tape();
    const coverage = new Coverage([[10, 20], [21, 22]]);
    expect(readSizeThreshold(tape, coverage, 10, 22, 1000, 5)).toEqual({ kind: 'gap' });
    expect(levelTrial(tape, coverage, 10, 22, 100)).toEqual({ kind: 'gap' });
  });

  it('zachowuje kolejność czasową i nie rozstrzyga kolejności w tej samej milisekundzie', () => {
    const tape = new Tape();
    tape.insert([fill(10, 100, 2, -1, 1), fill(12, 99, 1, -1, 2), fill(15, 100, .5, 1, 3)]);
    const coverage = new Coverage([[10, 20]]);
    expect(levelTrial(tape, coverage, 10, 20, 100)).toMatchObject({
      kind: 'covered', before: { size: 2, count: 1 }, firstBelow: { t: 12, px: 99 }, returned: { t: 15, px: 100 },
    });
    tape.insert([fill(12, 100, 3, -1, 4)]);
    expect(levelTrial(tape, coverage, 10, 20, 100)).toMatchObject({
      kind: 'covered', before: null, firstBelow: { t: 12 }, returned: { t: 15 },
    });
  });
});

it('odtwarza oba okna poziomu i zmianę znaku delty z publicznego nagrania BTC', () => {
  const [first, second] = demoWindows('level');
  const level = openChronographClip('level', second, false);
  expect(levelTrial(level.tape, level.coverage, first - 5000, first, LEVEL_TEST_PRICE)).toMatchObject({
    kind: 'covered', before: { count: 15 }, firstBelow: null,
  });
  const read = levelTrial(level.tape, level.coverage, second - 5000, second, LEVEL_TEST_PRICE);
  expect(read).toMatchObject({ kind: 'covered', before: { count: 5 }, firstBelow: { t: second - 4806, px: 61_609 }, returned: null });
  if (read.kind === 'covered') expect(read.before?.size).toBeCloseTo(2.31139, 8);
  const [through] = demoWindows('flip');
  const flip = openChronographClip('flip', through, false);
  expect(flip.book?.t).toBe(through - 7_947);
  expect(readSizeThreshold(flip.tape, flip.coverage, through - 120_000, through, 100_000, 5)).toMatchObject({
    kind: 'covered', full: -34.28485, filtered: 1.44807, total: 392, crossing: { minimum: 92_811, delta: -0.05193 },
  });
});
