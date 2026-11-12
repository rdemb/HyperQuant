import { describe, expect, it } from 'vitest';
import { FootprintBuilder } from '../core/footprintBar';
import { cvdCandles, deltaCandle, deltaFromExtremes, flipsEmpty } from '../core/flow';
import { deltaPoint, flowLegend, hlDelta } from '../chart/flowPoints';
import { PRO } from '../chart/theme';

const DAY = 86_400_000;

function fp(t: number, deltas: number[]) {
  const b = new FootprintBuilder(t, 1);
  let i = 0;
  for (const d of deltas) b.add(t + ++i, 100, Math.abs(d), d >= 0 ? 1 : -1);
  return b.build()!;
}

describe('świeca niepełna (luka w taśmie) tak samo we wszystkich panelach', () => {
  it('CVD: przerwa na świecy niepełnej i suma od zera po niej', () => {
    const bars = [
      { t: 0, fp: fp(0, [2]), complete: true },
      { t: 60_000, fp: fp(60_000, [5]), complete: false },
      { t: 120_000, fp: fp(120_000, [1]), complete: true },
    ];
    expect(cvdCandles(bars, 'day')).toEqual([{ open: 0, high: 2, low: 0, close: 2 }, null, { open: 0, high: 1, low: 0, close: 1 }]);
  });

  it('delta: świeca niepełna wyszarzona (kolor niepełnej), pełna bez koloru; CVD Hyperliquid bez delty niepełnej świecy', () => {
    const full = deltaPoint({ t: 60_000, fp: fp(60_000, [3]), complete: true });
    expect(full).toEqual({ time: 60, open: 0, high: 3, low: 0, close: 3 });
    const part = deltaPoint({ t: 60_000, fp: fp(60_000, [3]), complete: false });
    expect(part).toEqual({ time: 60, open: 0, high: 3, low: 0, close: 3, color: PRO.incomplete, borderColor: PRO.incomplete, wickColor: PRO.incomplete });
    expect(deltaPoint({ t: 60_000, fp: null, complete: false })).toEqual({ time: 60 });
    expect(hlDelta({ t: 0, fp: fp(0, [3]), complete: true })).toBe(3);
    expect(hlDelta({ t: 0, fp: fp(0, [3]), complete: false })).toBeNull();
  });

  it('legenda delty: liczba świecy niepełnej w kolorze niepełnej z dopiskiem, pełnej bez dopisku', () => {
    const part = flowLegend('Delta', 3, true);
    expect(part.at(-1)!.color).toBe(PRO.incomplete);
    expect(part.at(-1)!.text).toMatch(/niepełna|partial/);
    const full = flowLegend('Delta', 3, false);
    expect(full.map((p) => p.text).join(' ')).not.toMatch(/niepełna|partial/);
    expect(full.at(-1)!.color).toBe(PRO.buyInk);
    expect(flowLegend('Delta', null, true)).toEqual([{ text: 'Delta', color: PRO.ink3 }]);
  });
});

describe('świece delty i CVD', () => {
  it('świeca delty: otwarcie 0, maksimum i minimum w trakcie', () => {
    expect(deltaCandle(fp(0, [2, -5, 1]))).toEqual({ open: 0, high: 2, low: -3, close: -2 });
  });

  it('CVD kumuluje deltę i zeruje się na początku doby', () => {
    const bars = [
      { t: 0, fp: fp(0, [2]) },
      { t: 3_600_000, fp: fp(3_600_000, [-1, 3]) },
      { t: DAY, fp: fp(DAY, [1]) },
    ];
    const out = cvdCandles(bars, 'day');
    expect(out[0]).toEqual({ open: 0, high: 2, low: 0, close: 2 });
    expect(out[1]).toEqual({ open: 2, high: 4, low: 1, close: 4 });
    expect(out[2]).toEqual({ open: 0, high: 1, low: 0, close: 1 });
  });

  it('świeca bez taśmy przerywa CVD, a następna zaczyna od zera', () => {
    const out = cvdCandles(
      [
        { t: 0, fp: fp(0, [2]) },
        { t: 60_000, fp: null },
        { t: 120_000, fp: fp(120_000, [1]) },
      ],
      'none'
    );
    expect(out[1]).toBeNull();
    expect(out[2]).toEqual({ open: 0, high: 1, low: 0, close: 1 });
  });

  it('delta od szczytu i od dołka ceny', () => {
    const b = new FootprintBuilder(0, 1);
    b.add(1, 100, 1, 1);
    b.add(2, 102, 3, 1);
    b.add(3, 101, 6, -1);
    expect(deltaFromExtremes(b.build()!)).toEqual({ fromHigh: -6, fromLow: -3 });
  });
});

describe('flipsEmpty — kiedy pełne setData zamiast update', () => {
  const before = [null, 1, null, 2];
  it('starsza świeca pusta → z wartością (historia taśmy doszła) wymaga setData', () => {
    const now = [null, 1, 5, 2];
    expect(flipsEmpty([2], before.length, (i) => before[i] === null, (i) => now[i] === null)).toBe(true);
  });
  it('zmiana wartości bez zmiany pustości i ostatnia świeca — zwykły update', () => {
    const now = [null, 3, null, null];
    expect(flipsEmpty([1, 3], before.length, (i) => before[i] === null, (i) => now[i] === null)).toBe(false);
  });
});
