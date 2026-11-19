import { expect, it, vi } from 'vitest';
import { Coverage } from '../../../charts/pro/core/coverage';
import { Tape, type TradeRow } from '../../../charts/pro/core/tape';
import { readDeltaMoment } from '../deltaMoment';

const from = Date.UTC(2026, 10, 17, 7, 0, 30);
const to = from + 30_000;
const fill = (offset: number, tid: number, px: number, sz: number, side: TradeRow['side'] = 1): TradeRow => ({ t: from + offset, tid, px, sz, side });
const tapeWith = (rows: TradeRow[]) => { const tape = new Tape(); tape.insert(rows); return tape; };
const read = (tape: Tape, through = to, precision = 5, coverage = new Coverage([[from, through]])) =>
  readDeltaMoment(tape, coverage, through, precision, new AbortController().signal);

it.each([1, -1] as const)('wybiera największy wkład netto po stronie znaku %s, z obu stron i wszystkich cen', async side => {
  const other = side === 1 ? -1 : 1;
  const repeated = fill(0, 1, 100, 1, side);
  const tape = tapeWith([repeated, repeated, fill(0, 2, 200, 1, side), fill(0, 3, 250, .1, other),
    fill(29_999, 1, 250, 1, other), fill(-1, 4, 900, 1), fill(30_000, 5, 900, 1)]);
  expect(await read(tape)).toMatchObject({
    kind: 'comparison', verdict: 'reversed', delta: BigInt(side) * 25_000_000n, remaining: BigInt(other) * 250_000_000n, ties: 1,
    moment: { t: from, count: 3, buy: BigInt(side === 1 ? 300 : 25) * 1_000_000n, sell: BigInt(side === 1 ? 25 : 300) * 1_000_000n },
    rows: [{ tid: 1 }, { tid: 2 }, { tid: 3 }],
  });
});

it('rozpoznaje dokładny remis i wybiera najwcześniejszą chwilę', async () => {
  const result = await read(tapeWith([fill(5, 1, 64670, .003), fill(10, 2, 64670, .001), fill(10, 3, 64670, .002)]));
  expect(result).toMatchObject({ kind: 'comparison', verdict: 'retained', ties: 2,
    delta: 388_020_000n, remaining: 194_010_000n, moment: { t: from + 5, count: 1 } });
});

it('odróżnia ciszę, lukę, neutralne wykonania, jedną milisekundę i zejście do zera', async () => {
  expect(await read(tapeWith([]))).toMatchObject({ kind: 'quiet' });
  expect(await read(tapeWith([]), to, 5, new Coverage([[from, to - 1]]))).toMatchObject({ kind: 'gap', coveredMs: 29_999 });
  expect(await read(tapeWith([fill(5, 1, 64670, .003), fill(10, 2, 64670, .001, -1), fill(10, 3, 64670, .002, -1)])))
    .toMatchObject({ kind: 'neutral', moments: 2, count: 3, delta: 0n });
  expect(await read(tapeWith([fill(5, 1, 10, .003), fill(5, 2, 10, .002, -1)]))).toMatchObject({ kind: 'single', delta: 10_000n, remaining: 0n });
  expect(await read(tapeWith([fill(5, 1, 10, .003), fill(5, 2, 10, .003, -1)]))).toMatchObject({ kind: 'single', delta: 0n });
  expect(await read(tapeWith([fill(5, 1, 10, 1), fill(10, 2, 20, 1), fill(10, 3, 20, 1, -1)])))
    .toMatchObject({ kind: 'comparison', verdict: 'zero', delta: 10_000_000n, remaining: 0n });
});

it.each([{ size: 4, price: 3700.01, plus: 3700.02, qty: .0001 }, { size: 3, price: 740.001, plus: 740.002, qty: .001 }])
  ('zachowuje jednostkę 0,000001 USD przy precyzji instrumentu $size', async ({ size, price, plus, qty }) => {
    expect(await read(tapeWith([fill(1, 1, plus, qty), fill(2, 2, price, qty, -1)]), to, size))
      .toMatchObject({ kind: 'comparison', delta: 1n, verdict: 'reversed' });
  });

it('przypięty zakres i wykonania nie zmieniają się po nadejściu nowych danych', async () => {
  const coverage = new Coverage([[from, to + 1_000]]);
  const tape = tapeWith([fill(1000, 1, 100, 1)]);
  const snapshot = await read(tape, to, 5, coverage);
  tape.insert([fill(1000, 2, 100, 2), fill(30_000, 3, 200, 1, -1)]);
  expect(snapshot).toMatchObject({ to, kind: 'single', delta: 100_000_000n, rows: [{ tid: 1 }] });
  expect(await read(tape, to + 1000, 5, coverage))
    .toMatchObject({ to: to + 1000, kind: 'comparison', delta: 100_000_000n, remaining: -200_000_000n });
});

it('czyta oba kawałki minuty, a koniec okna jest wyłączony', async () => {
  const tape = tapeWith([fill(14_999, 1, 999, 1), fill(15_000, 2, 90, 1),
    fill(30_000, 2, 40, 1, -1), fill(44_999, 3, 50, 1, -1), fill(45_000, 4, 900, 1)]);
  expect(await read(tape, to + 15_000)).toMatchObject({ kind: 'neutral', delta: 0n, moments: 3, count: 3 });
});

it('oddaje sterowanie gęstemu oknu i wycofuje wynik po anulowaniu albo wstawieniu do okna', async () => {
  const tape = tapeWith(Array.from({ length: 6000 }, (_, i) => fill(i, i, 100, .01)));
  const coverage = new Coverage([[from, to]]);
  let clock = 0;
  const time = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 7));
  const controller = new AbortController();
  try {
    setTimeout(() => controller.abort(), 0);
    expect(await readDeltaMoment(tape, coverage, to, 5, controller.signal)).toBeNull();
    setTimeout(() => tape.insert([fill(512, 6001, 200, 1)]), 0);
    expect(await read(tape)).toMatchObject({ kind: 'changed' });
  } finally {
    time.mockRestore();
  }
  expect(await read(tape)).toMatchObject({ kind: 'comparison', delta: 6_200_000_000n });
});
