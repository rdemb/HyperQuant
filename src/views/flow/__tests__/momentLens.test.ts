import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BookHistory, toFrame } from '../../../charts/pro/core/book';
import { Coverage } from '../../../charts/pro/core/coverage';
import { Tape } from '../../../charts/pro/core/tape';
import { amountsAt, bookAtMoment, lensTapePage, lensTapeRange, momentAt, notionalBand, readMomentWindow } from '../momentLensModel';
import { LensPriceMatrix } from '../LensPriceMatrix';

describe('Przekrój chwili', () => {
  it('rozdziela progi nominału bez nakładania granic', () => {
    for (const [i, usd] of [1_000, 10_000, 50_000, 100_000, 500_000, 1_000_000].entries()) {
      const threshold = BigInt(usd) * 1_000_000n;
      expect(notionalBand(threshold - 1n)).toBe(i);
      expect(notionalBand(threshold)).toBe(i + 1);
    }
  });

  it('używa 120 s, nie dubluje wykonania i pokazuje obie strony przy zerowej delcie', () => {
    const tape = new Tape();
    tape.insert([
      { t: 79_999, px: 5000, sz: 1, side: 1, tid: 1 },
      { t: 80_000, px: 5000, sz: 1, side: 1, tid: 1 },
      { t: 150_000, px: 5000, sz: 2, side: 1, tid: 1 },
      { t: 150_000, px: 5000, sz: 2, side: 1, tid: 1 },
      { t: 150_000, px: 5000, sz: 2, side: -1, tid: 2 },
      { t: 200_000, px: 5000, sz: 2, side: 1, tid: 1 },
    ]);
    const coverage = new Coverage([[80_000, 200_000]]);
    const window = readMomentWindow(tape, coverage, 200_000, 4);
    expect(window.times).toEqual([80_000, 150_000]);
    expect(window.peak).toBe(150_000);
    expect(window.coveredMs).toBe(120_000);
    expect(window.totals).toEqual([0, 1, 2, 0, 0, 0, 0]);
    const point = momentAt(tape, coverage, 150_000, 4);
    expect(point.prices.map(row => row.px)).toEqual([5000]);
    for (const side of ['buy', 'sell'] as const) {
      expect(amountsAt(point.prices[0], 2, side, point.covered)).toEqual({ count: 1, units: 20_000n, usd: 10_000_000_000n });
      expect(amountsAt(point.prices[0], 1, side, point.covered)).toEqual({ count: 0, units: 0n, usd: 0n });
    }
    expect(momentAt(tape, coverage, 150_001, 4).covered).toBe(true);
    expect(momentAt(tape, coverage, 200_000, 4).covered).toBe(false);
  });

  it('zostawia prawdziwą liczbę zleceń, odcina przyszłą migawkę i nie przechodzi przez lukę', () => {
    const history = new BookHistory(1);
    const frame = (time: number, n: number) => toFrame({ time, bids: [{ px: 100, sz: 2, n }], asks: [{ px: 101, sz: 1, n: Number.NaN }] }, 1);
    history.add(frame(1000, 3));
    history.add(frame(4000, 5));
    const coverage = new Coverage([[1000, 2000], [4000, 5000]]);
    expect(bookAtMoment(history, coverage, 999)).toBeNull();
    expect(bookAtMoment(history, coverage, 1999)?.n).toEqual(new Float64Array([3, Number.NaN]));
    expect(bookAtMoment(history, coverage, 2000)).toBeNull();
    expect(bookAtMoment(history, coverage, 3999)).toBeNull();
    expect(bookAtMoment(history, coverage, 4000)?.n[0]).toBe(5);
    expect(bookAtMoment(history, new Coverage([[1000, 50_000]]), 40_000)).toBeNull();
  });

  it('pokazuje właściwą stronę i identyfikatory w taśmie po zawężeniu ceny i klasy', () => {
    const tape = new Tape();
    tape.insert([
      { t: 1001, px: 5000, sz: 1, side: 1, tid: 11 },
      { t: 1002, px: 5000, sz: 2, side: -1, tid: 12 },
      { t: 1003, px: 5000, sz: 3, side: 1, tid: 13 },
      { t: 1004, px: 5001, sz: 2, side: 1, tid: 14 },
      { t: 1005, px: 5000, sz: 2, side: 1, tid: 15 },
    ]);
    const coverage = new Coverage([[1001, 1002], [1003, 1005]]);
    const page = (requested: number) => lensTapePage(tape, coverage, { from: 1001, to: 1005 }, 3, { px: 5000, band: 2 }, requested, 1);
    expect(page(0)).toMatchObject({ total: 2, page: 0, rows: [{ t: 1003, tid: 13, side: 1 }] });
    expect(page(9)).toMatchObject({ total: 2, page: 1, rows: [{ t: 1002, tid: 12, side: -1 }] });
    expect(readMomentWindow(tape, coverage, 1005, 3)).toMatchObject({ coveredMs: 3, peak: 1001 });
    const gap = momentAt(tape, coverage, 1002, 3);
    expect(gap.covered).toBe(false);
    expect(lensTapePage(tape, coverage, { from: 1002, to: 1003 }, 3, { px: null, band: null }, 0, 1))
      .toMatchObject({ rows: [{ tid: 12, side: -1 }], coveredMs: 0 });
    expect(amountsAt(gap.prices[0], 2, 'sell', gap.covered)).toBeNull();
  });

  it('liczy wszystkie klasy jednocześnie dla każdej rzeczywistej ceny', () => {
    const tape = new Tape();
    tape.insert([
      ...[0.1, 2, 20, 100, 200, 1000, 2000].map((sz, tid) => ({ t: 1001, px: 500, sz, side: -1 as const, tid })),
      { t: 1001, px: 500, sz: 2, side: 1, tid: 8 },
      { t: 1001, px: 501, sz: 2, side: 1, tid: 9 },
    ]);
    const point = momentAt(tape, new Coverage([[1001, 1002]]), 1001, 3);
    expect(point.prices.map(p => p.px)).toEqual([501, 500]);
    expect(point.prices[1].bands).toHaveLength(7);
    expect(point.prices[1].bands.map((_, band) => amountsAt(point.prices[1], band, 'sell', point.covered)?.count)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(amountsAt(point.prices[1], 1, 'buy', point.covered)).toEqual({ count: 1, units: 2000n, usd: 1_000_000_000n });
    expect(amountsAt(point.prices[1], null, 'sell', point.covered)).toEqual({ count: 7, units: 3_322_100n, usd: 1_661_050_000_000n });
    expect(amountsAt(point.prices[0], 1, 'sell', point.covered)?.count).toBe(0);
  });

  it('wybiera cenę ostatniego wykonania tej chwili niezależnie od wielkości ceny i kolejności dostaw', () => {
    const tape = new Tape();
    tape.insert([
      { t: 1001, px: 501, sz: 2, side: 1, tid: 21 },
      { t: 1001, px: 502, sz: 2, side: -1, tid: 20 },
      { t: 1002, px: 503, sz: 2, side: 1, tid: 22 },
    ]);
    const coverage = new Coverage([[1000, 1010]]);
    expect(momentAt(tape, coverage, 1001, 3).lastPrice).toBe(501);
    expect(momentAt(tape, coverage, 1000, 3).lastPrice).toBeNull();
  });

  it('zawęża ślad do tej samej ceny i klasy co taśmę, a kursor i pokrycie zachowuje dla całego kontekstu', () => {
    const tape = new Tape();
    tape.insert([
      { t: 150_000, px: 5000, sz: 2, side: 1, tid: 1 },
      { t: 150_000, px: 5000, sz: 3, side: -1, tid: 2 },
      { t: 150_000, px: 5001, sz: 2, side: -1, tid: 3 },
      { t: 151_000, px: 5000, sz: 1, side: 1, tid: 4 },
      { t: 200_000, px: 5000, sz: 2, side: 1, tid: 5 },
    ]);
    const coverage = new Coverage([[80_000, 170_000], [190_000, 200_000]]);
    const pin = { px: 5000, band: 2 };
    const context = readMomentWindow(tape, coverage, 200_000, 3, pin);
    expect(context).toMatchObject({ times: [150_000, 151_000], peak: 150_000, coveredMs: 100_000 });
    expect(context.totals).toEqual([0, 0, 2, 0, 0, 0, 0]);
    expect(context.lanes[2].slice(140, 144)).toEqual(new Float64Array([10_000, 15_000, 0, 0]));
    const fills = lensTapePage(tape, coverage, lensTapeRange(80_000, 150_000), 3, pin, 0, 4);
    expect(fills.rows.map(row => row.tid)).toEqual([2, 1]);
    const sell = { ...pin, side: -1 as const };
    expect(lensTapePage(tape, coverage, lensTapeRange(80_000, 150_000), 3, sell, 0, 4).rows.map(row => row.tid)).toEqual([2]);
    expect(readMomentWindow(tape, coverage, 200_000, 3, sell).lanes[2].slice(140, 142)).toEqual(new Float64Array([0, 15_000]));
    expect(lensTapePage(tape, coverage, { from: 151_000, to: 151_001 }, 3, { ...sell, band: 1 }, 0, 4))
      .toMatchObject({ total: 0, coveredMs: 1, durationMs: 1 });
  });

  it('liczy ślady klas z pokrytej części pełnego rynku, zachowując otrzymane wykonania do nawigacji', () => {
    const tape = new Tape();
    tape.insert([
      { t: 80_000, px: 5000, sz: 0.1, side: 1, tid: 1 },
      { t: 100_000, px: 5000, sz: 2, side: -1, tid: 2 },
      { t: 150_000, px: 5100, sz: 2, side: -1, tid: 3 },
    ]);
    const coverage = new Coverage([[80_000, 100_000], [140_000, 200_000]]);
    const context = readMomentWindow(tape, coverage, 200_000, 3);
    expect(context.coveredMs).toBe(80_000);
    expect(context.times).toEqual([80_000, 100_000, 150_000]);
    expect(context.totals).toEqual([1, 0, 1, 0, 0, 0, 0]);
    expect(context.lanes[2][41]).toBe(0);
    expect(context.lanes[2][141]).toBe(10_200);
  });

  it('taśma kończy się po milisekundzie kursora i przycina początek do pełnych dwóch minut', () => {
    const tape = new Tape();
    tape.insert([80_000, 80_001, 200_000, 200_001].map((t, tid) => ({ t, px: 500, sz: 1, side: 1 as const, tid })));
    const range = lensTapeRange(60_000, 200_000);
    expect(range).toEqual({ from: 80_001, to: 200_001 });
    const coverage = new Coverage([[80_000, 100_000], [150_000, 200_001], [200_002, 250_000]]);
    const page = (number: number) => lensTapePage(tape, coverage, range, 3, { px: null, band: null }, number, 1);
    expect(page(0)).toMatchObject({ rows: [{ t: 200_000 }], total: 2, page: 0, durationMs: 120_000, coveredMs: 70_000 });
    expect(page(1)).toMatchObject({ rows: [{ t: 80_001 }], total: 2, page: 1, coveredMs: 70_000 });
    expect(lensTapeRange(120_000, 120_005)).toEqual({ from: 120_000, to: 120_006 });
    expect(lensTapeRange(300_000, 200_000)).toEqual({ from: 200_001, to: 200_001 });
  });

  it('renderuje siedem klas, obie strony oraz rozróżnia zmierzone zera od luki', () => {
    const tape = new Tape();
    tape.insert([{ t: 1001, px: 500, sz: 2, side: 1, tid: 1 }]);
    const point = momentAt(tape, new Coverage([[1001, 1002]]), 1001, 3);
    const render = (covered: boolean) => renderToStaticMarkup(createElement(LensPriceMatrix, {
      row: point.prices[0], covered, pin: { px: 500, band: 1, side: 1 }, onSelect: () => {},
      context: readMomentWindow(tape, new Coverage(covered ? [[1001, 1002]] : []), 1002, 3), cursor: 1001,
    }));
    const measured = render(true);
    expect(measured.match(/data-ml-band=/g)).toHaveLength(7);
    expect(measured.match(/class="ml-cell-measure/g)).toHaveLength(14);
    expect(measured.match(/data-count="0" data-micros="0"/g)).toHaveLength(13);
    expect(measured).toContain('data-count="1" data-micros="1000000000"');
    expect(measured.match(/class="ml-band-trace"/g)).toHaveLength(7);
    expect(measured.match(/data-ml-context-count="\d+"/g)).toHaveLength(7);
    const gap = render(false);
    expect(gap.match(/class="ml-cell-measure/g)).toHaveLength(14);
    expect(gap).not.toContain('data-micros=');
    expect(gap).not.toContain('data-ml-context-count=');
  });
});
