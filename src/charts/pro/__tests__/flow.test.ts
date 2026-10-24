import { describe, expect, it } from 'vitest';
import { FootprintBuilder } from '../core/footprintBar';
import { cvdCandles, deltaCandle, deltaFromExtremes } from '../core/flow';

const DAY = 86_400_000;

function fp(t: number, deltas: number[]) {
  const b = new FootprintBuilder(t, 1);
  let i = 0;
  for (const d of deltas) b.add(t + ++i, 100, Math.abs(d), d >= 0 ? 1 : -1);
  return b.build()!;
}

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
