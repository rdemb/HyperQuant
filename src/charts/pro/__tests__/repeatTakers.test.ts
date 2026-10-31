import { describe, expect, it } from 'vitest';
import type { Side } from '../hl/parse';
import { IndicatorEngine } from '../indicators/engine';
import { type FlowContext, indicatorDef, indicatorLabel, indicatorsFromLink, takerPersistence, tfAllowed } from '../indicators/registry';

type Order = { time: number; side: Side; notional: number; taker: string };
const o = (time: number, side: Side, notional: number, taker: string): Order => ({ time, side, notional, taker });
const M = 60_000;
const H = 3_600_000;

describe('powracający i nowi biorcy', () => {
  it('udziały z wartości wejść w świecy: ta sama strona, tylko przeciwna, nowe konto; razem 1', () => {
    const before = [o(1, 1, 5, 'a'), o(2, -1, 5, 'b'), o(3, -1, 5, 'a'), o(4, 1, 5, '')];
    const r = takerPersistence(before, [o(10, 1, 300, 'a'), o(11, 1, 100, 'b'), o(12, -1, 600, 'c'), o(13, 1, 50, '')]);
    expect(r.back).toBeCloseTo(0.3, 12);
    expect(r.flip).toBeCloseTo(0.1, 12);
    expect(r.fresh).toBeCloseTo(0.6, 12);
    // Konto po obu stronach w oknie wraca po każdej z nich
    expect(takerPersistence(before, [o(10, -1, 1, 'a')]).back).toBe(1);
    expect(takerPersistence(before, [o(10, 1, 1, '')]).back).toBeNaN();
  });

  it('okno przed świecą; w historii serwera tylko w jednej godzinie, na żywo także przez pełną godzinę', () => {
    const def = indicatorDef('repeat');
    expect(def.range).toEqual([0, 1]);
    expect(tfAllowed(def)).toBe(false);
    const x = indicatorsFromLink('repeat(15)')[0];
    expect(indicatorLabel(x)).toBe('Powroty 15');
    const run = (list: Order[], t0: number) => {
      const inRange = (a: number, b: number) => list.filter((q) => q.time >= a && q.time < b);
      const ctx: FlowContext = {
        oiAt: () => null,
        book: () => [],
        exactBook: () => [],
        orders: inRange,
        orderCount: (a, b) => inRange(a, b).length,
        identified: () => true,
        makers: () => null,
        now: t0 + 10 * M,
      };
      const c = { o: 1, h: 1, l: 1, c: 1, v: 1, n: 1 };
      const e = new IndicatorEngine();
      e.setInstances([x]);
      e.sync([{ candle: { ...c, t: t0 } }], 5 * M, () => [], ctx);
      return e.runs[0].out;
    };
    // Świeca 10:30, okno 10:15–10:30 w tej samej godzinie
    const t = 10 * H + 30 * M;
    expect(run([o(t - 10 * M, 1, 1, '~h:1'), o(t + M, 1, 1, '~h:1')], t)[0][0]).toBe(1);
    // Świeca 11:05: okno sięga 10:50, numery kont z historii nie łączą się między godzinami
    const u = 11 * H + 5 * M;
    expect(run([o(u - 10 * M, 1, 1, '~10:1'), o(u + M, 1, 1, '~11:1')], u)[0][0]).toBeNaN();
    // Na żywo (adresy) okno przez pełną godzinę jest w porządku
    expect(run([o(u - 10 * M, 1, 1, '0xa'), o(u + M, 1, 1, '0xa')], u)[0][0]).toBe(1);
  });
});
