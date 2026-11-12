import { describe, expect, it } from 'vitest';
import type { Candle, Side } from '../hl/parse';
import { type BookFrame, toFrame } from '../core/book';
import { hlTick } from '../core/footprintBar';
import { aggregateCandles, intervalById } from '../core/time';
import { IndicatorEngine } from '../indicators/engine';
import { effortZones } from '../core/effortZones';
import { ranges } from '../core/pbRanges';
import { type FlowContext, INDICATORS, type IndicatorInstance, indicatorDef, parseParams } from '../indicators/registry';

/**
 * Test akceptacyjny M1 (rynki z rejestru): każdy wskaźnik z rejestru wskaźników rysuje się na wzorcu 500 świec dla HYPE,
 * kPEPE i xyz:NVDA — bez wyjątku i bez NaN po rozbiegu. Wzorzec: świece 1h z błądzenia losowego wokół ceny rynku
 * (krok ceny z szDecimals rynku), taśma (zlecenia agresora co świecę, delta footprintu), arkusz co świecę i otwarte pozycje.
 */

const H = 3_600_000;
const N = 500;
const T0 = Date.UTC(2026, 9, 1);

/** Rynki z rejestru o skrajnych cenach: HYPE ~40 USD, kPEPE poniżej 0,01 USD (szDecimals 0), xyz:NVDA ~190 USD (HIP-3). */
const MARKETS = [
  { coin: 'HYPE', px: 40, szDecimals: 2 },
  { coin: 'kPEPE', px: 0.0045, szDecimals: 0 },
  { coin: 'xyz:NVDA', px: 190, szDecimals: 3 },
] as const;

/** Generator z ziarnem (mulberry32) — powtarzalny wzorzec. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Order {
  time: number;
  side: Side;
  notional: number;
  taker: string;
}

interface Fixture {
  candles: Candle[];
  deltas: number[];
  frames: BookFrame[];
  /** Rosnąco po czasie */
  orders: Order[];
}

/** Świece z taśmą i arkuszem nagranymi od otwarcia strony: ostatnie tyle świec (gęsta taśma i migawki arkusza co 10 s). */
const LIVE_BARS = 48;

/**
 * 500 świec 1h: zmiana do ±0,8% na świecę, knoty do 0,4%, ceny na siatce ticku rynku (szDecimals), wolumen ok. 2 mln USD
 * na świecę, delta footprintu zgodna z kierunkiem świecy (z szumem). Każda świeca ma kilka zleceń agresora; ostatnie
 * `LIVE_BARS` świec — 150 zleceń w ostatnim kwadransie (Hawkes) i migawki arkusza co 10 s (OFI, koszt zlecenia).
 */
function fixture(px0: number, szDecimals: number, seed: number): Fixture {
  const r = rng(seed);
  const round = (p: number) => {
    const tick = hlTick(p, szDecimals);
    return Math.round(p / tick) * tick;
  };
  const candles: Candle[] = [];
  const deltas: number[] = [];
  const frames: BookFrame[] = [];
  const orders: Order[] = [];
  const order = (time: number) => orders.push({ time, side: r() < 0.5 ? 1 : -1, notional: 1e3 + r() * 5e5, taker: `0x${Math.floor(r() * 60).toString(16)}` });
  let c = px0;
  for (let i = 0; i < N; i++) {
    const t = T0 + i * H;
    const o = c;
    const move = (r() - 0.5) * 0.016;
    c = round(o * (1 + move));
    const h = round(Math.max(o, c) * (1 + r() * 0.004));
    const l = round(Math.min(o, c) * (1 - r() * 0.004));
    const v = (2e6 * (0.5 + r())) / c;
    candles.push({ t, o, h, l, c, v, n: 50 + Math.floor(r() * 200) });
    deltas.push(v * (move * 20 + (r() - 0.5) * 0.2));
    const live = i >= N - LIVE_BARS;
    for (let k = 0; k < 6; k++) order(t + k * 540_000 + Math.floor(r() * 60_000));
    if (live) {
      const ts = Array.from({ length: 150 }, () => t + H - 900_000 + Math.floor(r() * 899_000)).sort((a, b) => a - b);
      for (const x of ts) order(x);
      const step = hlTick(c, szDecimals) * 10;
      for (let s = 5_000; s < H; s += 10_000) {
        const mid = o + ((c - o) * s) / H;
        const bids = Array.from({ length: 20 }, (_, k) => ({ px: round(mid - (k + 1) * step), sz: (1e4 + r() * 1e5) / c, n: 1 + Math.floor(r() * 9) }));
        const asks = Array.from({ length: 20 }, (_, k) => ({ px: round(mid + (k + 1) * step), sz: (1e4 + r() * 1e5) / c, n: 1 + Math.floor(r() * 9) }));
        frames.push(toFrame({ time: t + s, bids, asks }, step));
      }
    }
  }
  orders.sort((a, b) => a.time - b.time);
  return { candles, deltas, frames, orders };
}

/** Indeks pierwszego zlecenia nie wcześniejszego niż `t`. */
function lowerBound(list: readonly Order[], t: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (list[m].time < t) lo = m + 1;
    else hi = m;
  }
  return lo;
}

const inst = (id: (typeof INDICATORS)[number]['id']): IndicatorInstance => ({
  iid: `${id}1`,
  id,
  params: parseParams(indicatorDef(id), {}),
  color: '#3987e5',
  alpha: 1,
  width: 2,
  labels: true,
  visible: true,
});

function flowOf(f: Fixture): FlowContext {
  const oiBase = 5e7 / f.candles[0].c;
  const window = (from: number, to: number) => f.orders.slice(lowerBound(f.orders, from), lowerBound(f.orders, to));
  return {
    oiAt: (t) => oiBase * (1 + 0.1 * Math.sin((t - T0) / (24 * H))),
    book: () => f.frames,
    exactBook: () => f.frames,
    identified: () => true,
    zeroKnown: () => true,
    makers: (from, to) => {
      const d = window(from, to).reduce((a, o) => a + o.side * o.notional, 0) / f.candles[0].c;
      return { mm: d * 0.6, rest: d * 0.4, mmShare: 0.6 };
    },
    orders: window,
    orderCount: (from, to) => lowerBound(f.orders, to) - lowerBound(f.orders, from),
    now: T0 + N * H,
  };
}

/** Liczby w obiekcie (rekurencyjnie): ścieżki wartości NaN albo nieskończonych. */
function badNumbers(x: unknown, path: string, out: string[]): void {
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) out.push(path);
  } else if (Array.isArray(x)) x.forEach((y, i) => badNumbers(y, `${path}[${i}]`, out));
  else if (x && typeof x === 'object' && !ArrayBuffer.isView(x)) for (const [k, y] of Object.entries(x)) badNumbers(y, `${path}.${k}`, out);
}

describe('M1: wskaźniki na rynkach z rejestru (wzorzec 500 świec)', () => {
  for (const [k, m] of MARKETS.entries()) {
    const f = fixture(m.px, m.szDecimals, 7 + k);

    it(`${m.coin}: każdy wskaźnik z wartościami świec — bez wyjątku, z wartością na końcu wzorca, bez NaN i nieskończoności poza rozbiegiem`, () => {
      const bars = f.candles.map((candle, i) => ({ t: candle.t, candle, fp: { delta: f.deltas[i] }, complete: true }));
      const candlesOf = (tf: string) => aggregateCandles(f.candles, intervalById(tf).ms);
      const all = INDICATORS.map((d) => inst(d.id));
      const e = new IndicatorEngine();
      e.setInstances(all);
      expect(() => e.sync(bars, H, candlesOf, flowOf(f))).not.toThrow();
      const report: string[] = [];
      e.runs.forEach((run, i) => {
        const def = indicatorDef(all[i].id);
        run.out.forEach((arr, p) => {
          const name = `${def.id}[${def.plots[p]?.title ?? p}]`;
          const vals = Array.from(arr.subarray(0, N));
          if (vals.some((v) => v === Number.POSITIVE_INFINITY || v === Number.NEGATIVE_INFINITY)) report.push(`${name}: ∞`);
          // Każdy plot ma wartość w ostatnich 50 świecach (SuperTrend i SAR rysują jedną stronę naraz)
          if (!vals.slice(-50).some(Number.isFinite)) report.push(`${name}: NaN na końcu wzorca`);
        });
        // Wskaźnik liczony świeca po świecy: po rozbiegu bez dziur (pierwszy plot)
        if (def.create && !def.sample && !def.period && def.plots.length > 0 && !def.plots[0].hidden) {
          const first = Array.from(run.out[0].subarray(0, N));
          const start = first.findIndex(Number.isFinite);
          const holes = start < 0 ? N : first.slice(start).filter((v) => !Number.isFinite(v)).length;
          if (def.id !== 'supertrend' && def.id !== 'psar' && holes > 0) report.push(`${def.id}: ${holes} świec bez wartości po rozbiegu`);
        }
      });
      expect(report).toEqual([]);
    });

    it(`${m.coin}: warstwy bez wartości świec (strefy Effort, zakresy P/b) liczą się bez wyjątku i bez NaN`, () => {
      const vbars = f.candles.map((c, i) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v, delta: f.deltas[i] }));
      const ez = effortZones(vbars, H);
      const bad: string[] = [];
      badNumbers({ zones: ez.zones, boxes: ez.boxes }, 'effort', bad);
      // Zakresy P/b ze świec 5m (wolumen w USD): 500 świec z tego samego błądzenia, krok co 5 min
      const b5 = f.candles.map((c, i) => ({ t: T0 + i * 300_000, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v * c.c }));
      const rs = ranges(b5);
      badNumbers(rs, 'pb', bad);
      expect(bad).toEqual([]);
      // Te same rysunki niezależnie od skali ceny: wzorzec ma i strefy, i zakresy (inaczej test niczego nie sprawdza)
      expect(ez.zones.length + ez.boxes.length).toBeGreaterThan(0);
    });
  }
});
