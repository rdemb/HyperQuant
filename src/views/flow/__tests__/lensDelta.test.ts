import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Coverage } from '../../../charts/pro/core/coverage';
import { Tape } from '../../../charts/pro/core/tape';
import { LensCellDetail, LensPriceTotals } from '../LensPriceMatrix';
import { LENS_MS, LensDeltaIndex, momentAt, priceDelta } from '../momentLensModel';

const cursor = 239_999;
const from = cursor + 1 - LENS_MS;
const full = new Coverage([[from, cursor + 100]]);
const execution = (t: number, tid: number, px: number, sz: number, side: 1 | -1 = 1) => ({ t, tid, px, sz, side });

describe('Delty Przekroju chwili', () => {
  it('liczy obie strony wybranej ceny wyłącznie w danej milisekundzie', () => {
    const tape = new Tape();
    tape.insert([
      execution(cursor - 1, 1, 2, 1),
      execution(cursor, 2, 2, 2),
      execution(cursor, 3, 2, 1, -1),
      execution(cursor, 4, 3, 2, -1),
      execution(cursor, 5, 4, 1),
      execution(cursor, 6, 4, 1, -1),
      execution(cursor, 7, 5.01, 1),
    ]);
    const point = momentAt(tape, full, cursor, 5);
    const at = (px: number) => priceDelta(point.prices.find(row => row.px === px), point.covered);
    expect(at(2)).toEqual({ kind: 'exact', micros: 2_000_000n });
    expect(at(3)).toEqual({ kind: 'exact', micros: -6_000_000n });
    expect(at(4)).toEqual({ kind: 'exact', micros: 0n });
    expect(at(5.01)).toEqual({ kind: 'precision' });
    expect(priceDelta(undefined, true)).toEqual({ kind: 'exact', micros: 0n });
    expect(priceDelta(undefined, false)).toEqual({ kind: 'coverage', coveredMs: 0 });
  });

  it('przyjmuje obie krawędzie okna do kursora i odcina następny wydruk przy przewijaniu', () => {
    const tape = new Tape();
    tape.insert([
      execution(from - 1, 1, 10, 1),
      execution(from, 2, 20, 1),
      execution(cursor, 3, 30, 1, -1),
      execution(cursor, 3, 30, 1, -1),
      execution(cursor + 1, 4, 40, 1),
    ]);
    const coverage = new Coverage([[from - 1, cursor + 100]]);
    const index = new LensDeltaIndex(tape, 5);
    expect(index.read(coverage, cursor)).toEqual({ kind: 'exact', micros: -10_000_000n });
    expect(index.read(coverage, cursor + 1)).toEqual({ kind: 'exact', micros: 10_000_000n });
    expect(index.read(coverage, cursor - 1)).toEqual({ kind: 'exact', micros: 30_000_000n });
    expect(index.read(coverage, cursor)).toEqual({ kind: 'exact', micros: -10_000_000n });
  });

  it('rozróżnia pełną ciszę, luki, rozgrzewkę i brak precyzji', () => {
    const tape = new Tape();
    const index = new LensDeltaIndex(tape, 5);
    expect(index.read(full, cursor)).toEqual({ kind: 'exact', micros: 0n });
    tape.insert([execution(cursor, 1, 10.01, 1)]);
    expect(index.read(full, cursor)).toEqual({ kind: 'precision' });
    expect(index.read(new Coverage([[from, cursor - 4], [cursor - 2, cursor + 1]]), cursor))
      .toEqual({ kind: 'coverage', coveredMs: LENS_MS - 2 });
    expect(index.read(new Coverage([[cursor - 999, cursor + 1]]), cursor))
      .toEqual({ kind: 'coverage', coveredMs: 1000 });
    expect(index.read(new Coverage(), cursor)).toEqual({ kind: 'coverage', coveredMs: 0 });
  });

  it('zachowuje jeden mikrodolar przy dużych kwotach i uwzględnia spóźnione wstawienia', () => {
    const tape = new Tape();
    const runs = Array.from({ length: 1_200 }, (_, i) => execution(from + i + 10, i, 65_000, 1000, i % 2 ? 1 : -1));
    tape.insert([...runs, execution(cursor, 1, 0.1, 0.00001)]);
    const index = new LensDeltaIndex(tape, 5);
    expect(index.read(full, cursor)).toEqual({ kind: 'exact', micros: 1n });
    expect(index.read(full, cursor)).toEqual({ kind: 'exact', micros: 1n });
    tape.insert([execution(from + 259, 2_000, 0.2, 0.00001, -1)]);
    expect(index.read(full, cursor)).toEqual({ kind: 'exact', micros: -1n });
    tape.prune(from + 60_000);
    const pruned = new Coverage([[from + 60_000, cursor + 100]]);
    expect(index.read(pruned, cursor)).toEqual({ kind: 'coverage', coveredMs: 60_000 });
  });

  it.each([4, 3])('obsługuje dokładność kontraktów HIP-3 (%i)', (decimals) => {
    const tape = new Tape();
    tape.insert([
      execution(cursor, 1, 12.345, 1),
      execution(cursor, 2, 12.34, 1, -1),
    ].map(row => ({ ...row, px: decimals === 4 ? Math.round(row.px * 100) / 100 : row.px })));
    expect(new LensDeltaIndex(tape, decimals).read(full, cursor))
      .toEqual({ kind: 'exact', micros: decimals === 4 ? 10_000n : 5_000n });
  });

  it('pokazuje dostępne bez najechania dokładne delty oraz jawny brak danych', () => {
    const render = (covered: boolean, marketDelta: ReturnType<LensDeltaIndex['read']>) =>
      renderToStaticMarkup(createElement(LensPriceTotals, { row: undefined, covered, marketDelta }));
    expect(render(true, { kind: 'exact', micros: 12_345_678_000_000n })).toMatch(/\+12\s345\s678 USD/);
    expect(render(true, { kind: 'exact', micros: 0n })).toContain('data-ml-delta="price" data-delta-micros="0"');
    const gap = render(false, { kind: 'coverage', coveredMs: 23_500 });
    expect(gap).toContain('23,5/120 s');
    expect(gap).not.toContain('data-delta-micros=');
    expect(render(true, { kind: 'precision' })).toContain('precision');
  });

  it.each([[-1n, '−0,000001'], [4_999n, '+0,004999'], [-5_000n, '−0,005'], [9_999n, '+0,009999']])(
    'pokazuje od razu dokładną podpisaną deltę poniżej centa (%s µUSD)', (micros, formatted) => {
      const markup = renderToStaticMarkup(createElement(LensPriceTotals, { row: undefined, covered: true, marketDelta: { kind: 'exact', micros } }));
      expect(markup).toContain(`<span>Δ rynku · 120 s</span><span>USD</span></small><strong>${formatted}</strong>`);
      expect(markup).not.toContain('<details');
    },
  );

  it('w szczegółach liczy deltę obu stron wybranej klasy mimo filtra kupna', () => {
    const tape = new Tape();
    tape.insert([
      execution(cursor, 1, 200, 6),
      execution(cursor, 2, 200, 7, -1),
      execution(cursor, 3, 200, 1),
    ]);
    const point = momentAt(tape, full, cursor, 5);
    const details = (band: number | null, covered: boolean) => renderToStaticMarkup(createElement(LensCellDetail, {
      selection: { px: 200, band, side: 1 }, row: point.prices[0], covered, fmtPx: String, unit: 'BTC', decimals: 5,
    }));
    expect(details(1, true)).toContain('Δ klasy · 1 ms · −200 USD');
    expect(details(1, true)).not.toContain('data-ml-detail-side="sell"');
    expect(details(2, true)).toContain('Δ klasy · 1 ms · 0 USD');
    expect(details(null, true)).not.toContain('Δ klasy');
    expect(details(1, false)).toContain('Δ klasy · 1 ms · — USD · Brak pokrycia');
  });
});
