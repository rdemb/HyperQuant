import { describe, expect, it } from 'vitest';
import type { Side } from '../hl/parse';
import { IndicatorEngine } from '../indicators/engine';
import { type FlowContext, indicatorDef, indicatorLabel, indicatorsFromLink, takerBreadth, tfAllowed } from '../indicators/registry';

type Order = { time: number; side: Side; notional: number; taker: string };
const o = (time: number, side: Side, notional: number, taker: string): Order => ({ time, side, notional, taker });

describe('szerokość agresji: efektywna liczba biorców', () => {
  it('jedno konto daje 1, n kont po równo daje n, przewaga kilku — mniej niż liczba kont', () => {
    expect(takerBreadth([o(1, 1, 100, 'a'), o(2, 1, 300, 'a')]).buy).toBe(1);
    expect(takerBreadth(['a', 'b', 'c', 'd'].map((k, i) => o(i, -1, 250, k))).sell).toBeCloseTo(4, 12);
    // Udziały 0,7 / 0,1 / 0,1 / 0,1: HHI 0,52
    const r = takerBreadth([o(1, 1, 700, 'a'), o(2, 1, 100, 'b'), o(3, 1, 100, 'c'), o(4, 1, 100, 'd')]);
    expect(r.buy).toBeCloseTo(1 / 0.52, 12);
    expect(r.sell).toBeNaN();
  });

  it('własność: 1 ≤ N_eff ≤ liczba kont po stronie', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 50; k++) {
      const list = Array.from({ length: 1 + Math.floor(rnd() * 60) }, (_, i) => o(i, 1, 10 ** (1 + 4 * rnd()), `k${Math.floor(30 * rnd() ** 3)}`));
      const n = new Set(list.map((x) => x.taker)).size;
      const { buy } = takerBreadth(list);
      expect(buy).toBeGreaterThanOrEqual(1 - 1e-12);
      expect(buy).toBeLessThanOrEqual(n + 1e-9);
    }
  });

  it('wyścig: różni biorcy po tej samej stronie w tym samym bloku; zlecenia bez konta pominięte', () => {
    const r = takerBreadth([o(5, 1, 1, 'a'), o(5, 1, 1, 'b'), o(5, 1, 1, 'b'), o(5, -1, 1, 'c'), o(5, 1, 1, ''), o(6, 1, 1, 'c')]);
    expect(r.race).toBe(2);
    // Kupno: a 1, b 2, c 1 → 16 / 6
    expect(r.buy).toBeCloseTo(16 / 6, 12);
    expect(takerBreadth([o(1, 1, 5, '')]).race).toBeNaN();
  });

  it('świece do 1 h z kontami w całości; dłuższe i bez kont — brak', () => {
    const def = indicatorDef('breadth');
    expect(def.group).toBe('hyperquant');
    expect(def.log).toBe(true);
    expect(tfAllowed(def)).toBe(false);
    const x = indicatorsFromLink('breadth()')[0];
    expect(indicatorLabel(x)).toBe('Szerokość');
    const H = 3_600_000;
    const list = [o(1000, 1, 100, 'a'), o(2000, 1, 100, 'b'), o(H + 1000, -1, 100, 'a')];
    const inRange = (a: number, b: number) => list.filter((q) => q.time >= a && q.time < b);
    const ctx = (identified: (a: number, b: number) => boolean): FlowContext => ({
      oiAt: () => null,
      book: () => [],
      exactBook: () => [],
      orders: inRange,
      orderCount: (a, b) => inRange(a, b).length,
      identified,
      makers: () => null,
      now: 2 * H,
    });
    const c = { o: 1, h: 1, l: 1, c: 1, v: 1, n: 1 };
    const run = (ms: number, idf: (a: number, b: number) => boolean) => {
      const e = new IndicatorEngine();
      e.setInstances([x]);
      e.sync([0, 1].map((k) => ({ candle: { ...c, t: k * ms } })), ms, () => [], ctx(idf));
      return e.runs[0].out;
    };
    const [buy, sell, race] = run(H, () => true);
    expect(buy[0]).toBeCloseTo(2, 12);
    expect(race[0]).toBe(1);
    expect(sell[1]).toBe(1);
    // Bez kont w drugiej godzinie
    expect(run(H, (a) => a < H)[2][1]).toBeNaN();
    // Świeca 4 h łączyłaby numery kont z różnych godzin
    expect(run(4 * H, () => true)[0][0]).toBeNaN();
  });
});
