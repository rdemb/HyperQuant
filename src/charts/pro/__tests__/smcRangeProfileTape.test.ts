import { expect, it } from 'vitest';
import { Coverage } from '../core/coverage';
import { readRangeTape, rangeTapeWindows } from '../core/smcRangeProfileTape';
import { Tape, type TradeRow } from '../core/tape';

const T = 120_000;
const bands = [{ low: 65_000, high: 65_010 }, { low: 65_010, high: 65_030 }];
const fill = (t: number, side: TradeRow['side'], tid: number, px = 65_000): TradeRow => ({ t, px, side, tid, sz: .00001 });
const read = (tape: Tape, coverage: Coverage, from = 90_000, to = T) =>
  readRangeTape(tape, rangeTapeWindows({ from, to }, coverage), bands);

it('składa rozłączne okna, obie strony i sąsiednie przedziały z jednej taśmy', () => {
  const tape = new Tape();
  const archive = [fill(90_000, 1, 0), fill(100_000, 1, 1), fill(100_000, -1, 2), fill(110_000, -1, 3, 65_010)];
  tape.insert(archive);
  tape.insert([archive[2], archive[3], fill(T, 1, 4, 65_029.9), fill(T, -1, 5, 65_030), fill(T + 1, -1, 6)]);
  const result = read(tape, new Coverage([[90_000, T]]));
  expect(result.byPrice.get(65_000)).toEqual([{ buy: 650_000n, sell: 650_000n }, undefined, undefined]);
  expect(result.byPrice.get(65_010)).toEqual([undefined, { buy: 0n, sell: 650_100n }, { buy: 650_299n, sell: 0n }]);
  expect(result.maxSide).toBe(650_299n);
});

it('pokazuje zmianę kolejności stron i cen przy tych samych sumach', () => {
  const tapeA = new Tape(), tapeB = new Tape();
  const coverage = new Coverage([[90_000, T]]);
  const first = fill(100_000, 1, 1), second = fill(120_000, -1, 2, 65_010);
  tapeA.insert([first, second]);
  tapeB.insert([{ ...first, t: second.t }, { ...second, t: first.t }]);
  const a = read(tapeA, coverage), b = read(tapeB, coverage);
  expect(a.maxSide).toBe(b.maxSide);
  expect(a.byPrice.get(65_000)).toEqual(b.byPrice.get(65_000)?.slice().reverse());
  expect(a.byPrice.get(65_010)).toEqual(b.byPrice.get(65_010)?.slice().reverse());
});

it('oznacza pokrycie osobno od ciszy, ogranicza się do widoku i starzeje wykonania', () => {
  const tape = new Tape();
  const coverage = new Coverage([[90_000, 101_000], [105_000, 110_000]]);
  tape.insert([fill(95_000, 1, 1), fill(100_000, -1, 2)]);
  expect(rangeTapeWindows({ from: 90_000, to: T }, coverage).map(w => w.coverage)).toEqual(['full', 'partial', 'gap']);
  expect(rangeTapeWindows({ from: 98_000, to: T }, coverage).map(w => w.coverage)).toEqual(['partial', 'partial', 'gap']);
  expect(read(tape, coverage, 98_000).byPrice.get(65_000)?.[0]).toEqual({ buy: 0n, sell: 650_000n });
  expect(read(tape, coverage, 90_000, 94_999).byPrice.size).toBe(0);
  expect(read(tape, coverage, 90_000, 129_999).byPrice.size).toBe(1);
  expect(read(tape, coverage, 90_000, 130_000).byPrice.size).toBe(0);
});

it.each([
  [20_001, 30_001, 0, 'full'],
  [20_000, 30_000, 0, 'partial'],
  [30_000, 30_001, 0, 'partial'],
  [20_001, 30_001, 30_000, 'partial'],
  [30_000, 30_001, 30_001, 'gap'],
] as const)('liczy pokrycie prawej domkniętej komórki dla [%i, %i) od %i', (start, end, from, expected) => {
  const windows = rangeTapeWindows({ from, to: 30_000 }, new Coverage([[start, end]]));
  expect(windows.at(-1)?.coverage).toBe(expected);
});
