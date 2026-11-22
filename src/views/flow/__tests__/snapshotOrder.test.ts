import { describe, expect, it } from 'vitest';
import { Coverage } from '../../../charts/pro/core/coverage';
import { toFrame } from '../../../charts/pro/core/book';
import { parseBook } from '../../../charts/pro/hl/parse';
import { visibleExecutions } from '../hip3Flow';
import { demoWindows, LEVEL_TEST_PRICE, openChronographClip } from '../chronographHistory';
import { compareTradeToDrop, depthDrops } from '../snapshotOrder';

const through = demoWindows('level')[1];
const clip = openChronographClip('level', through, false);
const clock = { book: 'exchange', tape: 'exchange' };
const recorded = visibleExecutions(clip.tape, through - 1, 0, Infinity, through - 120_000, -1, LEVEL_TEST_PRICE);
const frames = clip.history.list();
const drop = depthDrops(frames, clip.bookCoverage, LEVEL_TEST_PRICE, through, 5).drops.find(pair =>
  pair.side === 'bid' && pair.before.t === Date.parse('2026-11-20T07:29:41.528Z'));
if (!drop) throw new Error('Brak publicznej pary BID przy 61 611 USD');

describe('kolejność zapisanej transakcji i spadku ilości L2', () => {
  it.each([
    ['2026-11-20T07:29:39.196Z', 'earlier'],
    ['2026-11-20T07:29:42.058Z', 'undetermined'],
    ['2026-11-20T07:30:07.264Z', 'later'],
  ])('wykonanie %s daje %s', (iso, result) => {
    const trade = recorded.find(row => row.t === Date.parse(iso));
    expect(trade).toBeDefined();
    if (!trade) return;
    expect(drop.before.size).toBe(39.66225);
    expect(drop.after.size).toBe(7.40276);
    expect(compareTradeToDrop(drop, trade, clip.coverage, clock).kind).toBe(result);
  });

  it('obie granice i czasy w środku są nierozstrzygnięte, sąsiednie milisekundy rozstrzygają', () => {
    for (const [t, expected] of [
      [drop.before.t - 1, 'earlier'], [drop.before.t, 'undetermined'],
      [drop.after.t, 'undetermined'], [drop.after.t + 1, 'later'],
    ] as const) {
      expect(compareTradeToDrop(drop, { ...recorded[0], t }, clip.coverage, clock).kind).toBe(expected);
    }
  });

  it('nie wyprzedza kursora ani nie pomija niedokładnej migawki w parze', () => {
    const date = drop.after.t;
    expect(depthDrops(frames, clip.bookCoverage, LEVEL_TEST_PRICE, date, 5).drops).not.toContainEqual(drop);
    expect(depthDrops(frames, clip.bookCoverage, LEVEL_TEST_PRICE, date + 1, 5).drops).toContainEqual(drop);
    const withInexact = frames.flatMap(frame => frame.t === date
      ? [{ ...frame, t: date - 1, exact: undefined }, frame] : [frame]);
    expect(depthDrops(withInexact, clip.bookCoverage, LEVEL_TEST_PRICE, through, 5).drops).not.toContainEqual(drop);
  });

  it('luki L2 i taśmy, brak poziomu oraz rozbieżne zegary są rozróżnialne', () => {
    const book = new Coverage([[drop.before.t, drop.after.t]]);
    expect(depthDrops(frames, book, LEVEL_TEST_PRICE, through, 5).missing.has('book-gap')).toBe(true);
    expect(depthDrops(frames, clip.bookCoverage, 10, through, 5).drops).toHaveLength(0);
    expect(compareTradeToDrop(drop, recorded[0], new Coverage(), clock)).toEqual({ kind: 'undetermined', reason: 'tape-gap' });
    expect(compareTradeToDrop(drop, recorded[0], clip.coverage, { ...clock, tape: 'receipt' })).toEqual({ kind: 'undetermined', reason: 'clock' });
  });

  it('wykrywa spadek do zera tylko z kompletną stroną, nie przy wadliwym wierszu', () => {
    const sample = (time: number, middle: { px: number; sz: string }[]) => {
      const snapshot = parseBook({
        time,
        levels: [[{ px: 103, sz: '1' }, ...middle, { px: 101, sz: '1' }], [{ px: 105, sz: '1' }]],
      }, 'BTC');
      if (!snapshot) throw new Error('Brak syntetycznej migawki');
      return { ...toFrame(snapshot, 1), exact: true as const };
    };
    const coverage = new Coverage([[1, 4]]);
    const before = sample(1, [{ px: 102, sz: '1' }]);
    const missing = sample(2, [{ px: 102, sz: 'błąd' }]);
    const empty = sample(2, []);
    expect(depthDrops([before, missing], coverage, 102, 4, 5).drops).toEqual([]);
    expect(depthDrops([before, empty], coverage, 102, 4, 5).drops).toEqual([
      { price: 102, side: 'bid', before: { t: 1, size: 1 }, after: { t: 2, size: 0 } },
    ]);
  });
});
