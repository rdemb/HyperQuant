import { describe, expect, it } from 'vitest';
import { HIST_PART_MS, type HistTrade, decodeTrades, encodeTrades } from '../../../utils/tapeHistory';
import { parseFill } from '../hl/parse';
import { HlStream } from '../hl/stream';
import { IndicatorEngine } from '../indicators/engine';
import { type FlowContext, indicatorDef, indicatorLabel, indicatorsFromLink, tfAllowed, twapCount } from '../indicators/registry';
import { ProStore } from '../store/proStore';
import { toFills } from '../store/serverHistory';

const ZERO = `0x${'0'.repeat(64)}`;
const H0 = Date.UTC(2026, 9, 31, 10, 0, 0);
const M = 60_000;

describe('hash zerowy na taśmie', () => {
  it('strumień: wypełnienie z hashem zerowym oznaczone, z innym — nie', () => {
    const raw = { coin: 'BTC', side: 'B', px: '80000', sz: '0.1', time: H0, tid: 1, users: ['0xa', '0xb'] };
    expect(parseFill({ ...raw, hash: ZERO }, 'BTC')!.zero).toBe(true);
    expect(parseFill({ ...raw, hash: `0x${'1'.repeat(64)}` }, 'BTC')!.zero).toBeUndefined();
  });

  it('historia: kolumna `z` → wypełnienia i zlecenia z hashem zerowym, pokrycie tylko z plików z kolumną; zła kolumna — plik odrzucony', () => {
    const tr = (t: number, tid: number, z: boolean): HistTrade => ({ t, px: 80_000, sz: 0.5, side: 'A', tid, o: tid, k: 1, m: 2, ...(z ? { z: true as const } : {}) });
    const file = encodeTrades('BTC', H0, H0 + HIST_PART_MS, [[H0, H0 + HIST_PART_MS]], [tr(H0 + 1000, 1, false), tr(H0 + 2000, 2, true)], []);
    const f = decodeTrades(file)!;
    expect(f.zeroKnown).toBe(true);
    const fills = toFills(f.trades, H0);
    expect(fills.map((x) => x.zero === true)).toEqual([false, true]);
    expect(decodeTrades({ ...file, z: [2] })).toBeNull();
    expect(decodeTrades({ ...file, z: [1, 0] })).toBeNull();
    expect(decodeTrades({ ...file, z: undefined })!.zeroKnown).toBe(false);

    const s = new ProStore(new HlStream({ wsFactory: () => ({}) as WebSocket }));
    const spans: [number, number][] = [[H0, H0 + HIST_PART_MS]];
    s.restoreHistory({ trades: { from: H0, to: H0 + HIST_PART_MS, spans, zeroSpans: spans, fills, oi: [] }, frames: [] });
    expect(s.zeroKnown.covers(H0, H0 + HIST_PART_MS)).toBe(true);
    expect(s.orders.range(H0, H0 + HIST_PART_MS).map((o) => o.zero === true)).toEqual([false, true]);
    // Plik bez kolumny: taśma i konta są, oznaczenia nie
    const s2 = new ProStore(new HlStream({ wsFactory: () => ({}) as WebSocket }));
    s2.restoreHistory({ trades: { from: H0, to: H0 + HIST_PART_MS, spans, fills, oi: [] }, frames: [] });
    expect(s2.addressed.covers(H0, H0 + HIST_PART_MS)).toBe(true);
    expect(s2.zeroKnown.covers(H0, H0 + HIST_PART_MS)).toBe(false);
  });
});

describe('udział TWAP w taśmie', () => {
  type Order = ReturnType<FlowContext['orders']>[number];
  const order = (time: number, side: 1 | -1, notional: number, taker: string, zero = false): Order => ({ time, side, notional, taker, ...(zero ? { zero: true as const } : {}) });
  const list: Order[] = [
    // Świeca 0: 1000 USD, z tego TWAP kupna 100 (dwa podzlecenia jednego konta) i sprzedaży 50
    order(H0 + 1000, 1, 600, 'a'),
    order(H0 + 2000, 1, 60, 'x', true),
    order(H0 + 32_000, 1, 40, 'x', true),
    order(H0 + 3000, -1, 50, 'y', true),
    order(H0 + 4000, -1, 250, 'b'),
    // Świeca 1: bez TWAP; świeca 2: bez transakcji
    order(H0 + M + 1000, -1, 300, 'b'),
  ];
  const ctx = (known: (a: number, b: number) => boolean): FlowContext => ({
    oiAt: () => null,
    book: () => [],
    exactBook: () => [],
    orders: (a, b) => list.filter((o) => o.time >= a && o.time < b),
    orderCount: () => 0,
    identified: () => true,
    zeroKnown: known,
    makers: () => null,
    now: H0 + 3 * M,
  });
  const bars = [0, 1, 2].map((k) => ({ candle: { t: H0 + k * M, o: 1, h: 1, l: 1, c: 1, v: 1, n: 1 } }));

  it('udział wartości po obu stronach w procentach i liczba kont z podzleceniami', () => {
    const def = indicatorDef('twap');
    expect(def.group).toBe('hyperquant');
    expect(tfAllowed(def)).toBe(false);
    const x = indicatorsFromLink('twap()')[0];
    expect(indicatorLabel(x)).toBe('TWAP');
    const e = new IndicatorEngine();
    e.setInstances([x]);
    e.sync(bars, M, () => [], ctx(() => true));
    const [buy, sell, count] = e.runs[0].out;
    expect([buy[0], sell[0], count[0]]).toEqual([10, -5, 2]);
    expect([buy[1], sell[1], count[1]]).toEqual([0, 0, 0]);
    expect(Object.is(sell[1], 0)).toBe(true);
    expect(buy[2]).toBeNaN();
  });

  it('TWAP-y: konto i strona, faza w siatce 30 s z tolerancją 2 s (także przez koniec siatki)', () => {
    // Jedno konto: dwa TWAP-y kupna w fazach 1,5 s i 16,5 s (podzlecenia ±0,3 s) i jeden sprzedaży
    const m = new Map([
      ['1|a', [1500, 16_500, 1800, 16_200]],
      ['-1|a', [7000]],
    ]);
    expect(twapCount(m)).toBe(3);
    // Fazy 29,5 s i 0,5 s to ta sama siatka
    expect(twapCount(new Map([['1|b', [29_500, 500, 29_900]]]))).toBe(1);
    expect(twapCount(new Map())).toBe(0);
  });

  it('bez oznaczonych hashy w całej świecy albo na interwale powyżej godziny — brak wartości', () => {
    const e = new IndicatorEngine();
    e.setInstances(indicatorsFromLink('twap()'));
    e.sync(bars, M, () => [], ctx((a) => a >= H0 + M));
    expect(e.runs[0].out[0][0]).toBeNaN();
    expect(e.runs[0].out[0][1]).toBe(0);
    const e2 = new IndicatorEngine();
    e2.setInstances(indicatorsFromLink('twap()'));
    e2.sync([{ candle: { ...bars[0].candle, t: H0 } }], 4 * 60 * M, () => [], ctx(() => true));
    expect(e2.runs[0].out[0][0]).toBeNaN();
  });
});
