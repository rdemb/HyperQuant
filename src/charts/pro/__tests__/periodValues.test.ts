import { describe, expect, it } from 'vitest';
import type { Candle } from '../hl/parse';
import type { InputSeries, InputStore } from '../chart/layoutInputs';
import { PeriodValues } from '../chart/periodValues';
import { valuePeriod, valueReference } from '../core/valueReference';

const MIN = 60_000;
const DAY = 86_400_000;
const D = Date.UTC(2026, 10, 16);
const NOW = D + 15 * 3_600_000 + 2 * MIN;

/** Świece 5m od `from` do `to` wokół 100 000 (wolumen zależny od świecy). */
const candles = (from: number, to: number): Candle[] => {
  const out: Candle[] = [];
  for (let t = from, i = 0; t < to; t += 5 * MIN, i++) {
    const c = 100_000 + 300 * Math.sin(i / 20);
    out.push({ t, o: c, h: c + 30, l: c - 30, c, v: 1 + (i % 5), n: 1 });
  }
  return out;
};

function store(list: Candle[]) {
  let asked = Number.POSITIVE_INFINITY;
  const series: InputSeries = { loadState: 'ready', load: async () => {}, candlesNow: () => list };
  const st: InputStore = {
    coin: 'BTC',
    serverNow: () => NOW,
    lastPrice: () => 100_000,
    series: () => series,
    indicatorCandles: (_id, from) => {
      asked = Math.min(asked, from);
      return list;
    },
    exactBook: () => null,
    zeroKnown: { covers: () => false },
    orders: { range: () => [] },
  };
  return { st, asked: () => asked };
}

describe('Profile okresów: POC i value area z jednego źródła wartości', () => {
  it('doba i sesja z tymi samymi liczbami co `valueReference` na świecach 5m; okres poza zasięgiem — brak', () => {
    const list = candles(D - 20 * DAY, NOW);
    const { st, asked } = store(list);
    const pv = new PeriodValues(st);
    pv.update(D - 30 * DAY, NOW);
    // Świece 5m najdalej 14 dób wstecz (limit API), nie od początku wykresu
    expect(asked()).toBe(D - 14 * DAY);
    const src = { bars: list.filter((c) => c.t >= D - 14 * DAY && c.t + 5 * MIN <= NOW).map((c) => ({ t: c.t, l: c.l, h: c.h, v: c.v })), ms: 5 * MIN };
    expect(pv.of('day', D - DAY)).toEqual(valueReference('day', D - DAY, src, NOW));
    const london = valuePeriod('session', D + 9 * 3_600_000);
    expect(pv.of('session', london.from)).toMatchObject({ kind: 'session', session: 'london', from: london.from, complete: true });
    expect(pv.of('day', D - 20 * DAY)).toBeNull();
  });

  it('bez świec 5m — brak wartości (warstwa bierze profil świec wykresu)', () => {
    const { st } = store([]);
    const pv = new PeriodValues(st);
    pv.update(D - DAY, NOW);
    expect(pv.of('day', D - DAY)).toBeNull();
  });
});
