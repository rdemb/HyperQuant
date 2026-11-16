import { describe, expect, it } from 'vitest';
import { tpoTimeLevels } from '../core/tpoValue';
import { tpoDay, tpoPocPx } from '../core/tpo';
import { rowTip } from '../chart/tpoLayer';

const P = 30 * 60_000;
const bars = [
  { t: 0, candle: { l: 100, h: 100.1 } },
  { t: P, candle: { l: 100.06, h: 100.1 } },
  { t: 2 * P, candle: { l: 100.06, h: 100.1 } },
];
describe('TPO: stała siatka wartości', () => {
  it('liczy okres tylko raz i wybiera POC czasu na siatce 5 pb', () => {
    const a = tpoTimeLevels(bars, null)!;
    expect(a.poc).toBeCloseTo(100 * Math.exp(0.00075), 8);
    expect(a.val).toBeCloseTo(100 * Math.exp(0.0005), 8);
    expect(a.vah).toBeCloseTo(100 * Math.exp(0.001), 8);
    expect(tpoTimeLevels([bars[0], { ...bars[0], t: 60_000 }, ...bars.slice(1)], null)).toEqual(a);
  });
  it('bez danych nie wymyśla poziomów', () => {
    expect(tpoTimeLevels([], null)).toBeNull();
  });
  it('przy remisie wybiera koszyk najbliższy środkowi zakresu ceny', () => {
    const p = tpoTimeLevels([{ t: 0, candle: { l: 100, h: 120 } }], null)!;
    expect(Math.abs(p.poc - 110)).toBeLessThan(110 * 0.0005);
  });
  it('zmiana siatki rysowania nie zmienia linii POC, a wolumen ma osobny podpis', () => {
    const input = bars.map((b) => ({ ...b, candle: { ...b.candle, t: b.t, o: b.candle.l, c: b.candle.h, v: 10, n: 1 } }));
    const value = tpoTimeLevels(bars, null)!;
    const a = { ...tpoDay(input, 0, 2, 0.01, true)!, value };
    const b = { ...tpoDay(input, 0, 2, 0.1, true)!, value };
    expect(tpoPocPx(a)).toBe(tpoPocPx(b));
    expect(tpoPocPx({ ...a, value: { poc: 100.08, val: 100.07, vah: 100.09 } })).toBe(100.08);
    expect(rowTip({ ...a, valueKind: 'POC / VA (wolumen) MODEL' }, 0).join(' ')).toContain('(wolumen) MODEL');
    expect(tpoPocPx({ ...a, value: null })).toBeNaN();
  });
});
