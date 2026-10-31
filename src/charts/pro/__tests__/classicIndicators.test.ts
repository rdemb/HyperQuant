import { describe, expect, it, vi } from 'vitest';
import type { Candle } from '../hl/parse';
import type { BookFrame } from '../core/book';
import { ofiEvent, olsFit } from '../../../utils/microMechanics';
import { Bocpd } from '../../../utils/bocpd';
import { OlsWindow, RegimeDetector, RobustLine, Window, Wma, ema, medianInPlace, rma } from '../indicators/primitives';
import { IndicatorEngine } from '../indicators/engine';
import {
  FlowContext,
  INDICATORS,
  INDICATOR_COLORS,
  IndicatorId,
  IndicatorInstance,
  MAX_INDICATORS,
  OFI_MAX_GAP,
  OFI_MIN_R2,
  REGIME_PRIOR,
  addIndicator,
  bookFlow,
  copyIndicator,
  indicatorDef,
  indicatorLabel,
  indicatorsFromLink,
  indicatorsLink,
  memoryCandles,
  parseIndicators,
  parseParams,
  plotShift,
  quantileSorted,
  regimePrior,
} from '../indicators/registry';

const M5 = 300_000;

/** Dane spoza świec w testach: bez odczytów, z podanymi polami. */
const flowCtx = (c: Partial<FlowContext>): FlowContext => ({
  oiAt: () => null,
  book: () => [],
  orders: () => [],
  orderCount: () => 0,
  now: Number.POSITIVE_INFINITY,
  ...c,
});

/** Generator z ziarnem (mulberry32) — powtarzalne serie losowe. */
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

/** Błądzenie losowe świec wokół `px` (ceny rzędu BTC). */
function walk(n: number, seed: number, px = 80_000): Candle[] {
  const r = rng(seed);
  const out: Candle[] = [];
  let c = px;
  for (let i = 0; i < n; i++) {
    const o = c;
    c = o + (r() - 0.5) * 200;
    const h = Math.max(o, c) + r() * 60;
    const l = Math.min(o, c) - r() * 60;
    out.push({ t: i * M5, o, h, l, c, v: 1 + r() * 10, n: 1 });
  }
  return out;
}

const closeOnly = (closes: readonly number[]): Candle[] => closes.map((c, i) => ({ t: i * M5, o: c, h: c, l: c, c, v: 1, n: 1 }));
const bars = (cs: readonly Candle[]) => cs.map((candle) => ({ t: candle.t, candle }));

const inst = (id: IndicatorId, params: Record<string, number> = {}): IndicatorInstance => ({
  iid: `${id}1`,
  id,
  params: parseParams(indicatorDef(id), params),
  color: '#3987e5',
  alpha: 1,
  width: 2,
  labels: true,
  visible: true,
});

/** Wartości plotów instancji po przeliczeniu świec od zera (tablice zwykłych liczb, NaN = brak). */
function run(x: IndicatorInstance, cs: readonly Candle[]): number[][] {
  const e = new IndicatorEngine();
  e.setInstances([x]);
  e.sync(bars(cs));
  return e.runs[0].out.map((a) => Array.from(a.subarray(0, cs.length)));
}

// ───────────── niezależne wzory „wsadowe” (pętle po tablicach, bez stanu przyrostowego) ─────────────

const sma = (xs: readonly number[], n: number) => xs.map((_, i) => (i < n - 1 ? NaN : xs.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n));

function smoothed(xs: readonly number[], n: number, alpha: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (i < n - 1) out.push(NaN);
    else if (i === n - 1) out.push(xs.slice(0, n).reduce((a, b) => a + b, 0) / n);
    else out.push(alpha * xs[i] + (1 - alpha) * out[i - 1]);
  }
  return out;
}

function stdevPop(xs: readonly number[], n: number): number[] {
  return xs.map((_, i) => {
    if (i < n - 1) return NaN;
    const w = xs.slice(i - n + 1, i + 1);
    const m = w.reduce((a, b) => a + b, 0) / n;
    return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / n);
  });
}

function rsiBatch(closes: readonly number[], n: number): number[] {
  const d = closes.slice(1).map((c, i) => c - closes[i]);
  const u = smoothed(d.map((x) => Math.max(x, 0)), n, 1 / n);
  const w = smoothed(d.map((x) => Math.max(-x, 0)), n, 1 / n);
  return [NaN, ...u.map((a, i) => (Number.isNaN(a) ? NaN : w[i] === 0 ? 100 : a === 0 ? 0 : 100 - 100 / (1 + a / w[i])))];
}

function atrBatch(cs: readonly Candle[], n: number): number[] {
  const tr = cs.map((c, i) => (i === 0 ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - cs[i - 1].c), Math.abs(c.l - cs[i - 1].c))));
  return smoothed(tr, n, 1 / n);
}

function expectClose(a: readonly number[], b: readonly number[], rel = 1e-9): void {
  expect(a.length).toBe(b.length);
  a.forEach((x, i) => {
    if (Number.isNaN(b[i])) expect(x, `indeks ${i}`).toBeNaN();
    else expect(Math.abs(x - b[i]), `indeks ${i}: ${x} vs ${b[i]}`).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(b[i])));
  });
}

describe('klocki wskaźników', () => {
  it('RMA i EMA: brak wartości do n-tej, na niej średnia prosta, dalej wygładzanie', () => {
    const r = rma(3); // α = 1/3
    const v = [1, 2, 3, 4].map((x) => r.next(x, true));
    expect(v.slice(0, 3)).toEqual([NaN, NaN, 2]);
    expect(v[3]).toBeCloseTo((2 * 2 + 4) / 3, 14);
    const e = ema(3); // α = 0,5
    expect([1, 2, 3, 4].map((x) => e.next(x, true))).toEqual([NaN, NaN, 2, 3]);
  });

  it('podgląd nie zmienia stanu', () => {
    const a = rma(3);
    const b = rma(3);
    for (const x of [5, 6, 7]) {
      a.next(x, true);
      b.next(x, true);
    }
    a.next(1000, false);
    a.next(-50, false);
    expect(a.next(8, true)).toBe(b.next(8, true));
    const w = new Window(2);
    w.next(1, true);
    w.next(99, false);
    w.next(3, true);
    expect([w.mean, w.sd]).toEqual([2, 1]);
  });

  it('odchylenie Bollingera jest populacyjne (dzielnik n, nie n − 1)', () => {
    const w = new Window(4);
    for (const x of [1, 2, 3, 4]) w.next(x, true);
    expect(w.mean).toBe(2.5);
    expect(w.sd).toBeCloseTo(Math.sqrt(1.25), 12); // próbkowe dałoby √(5/3) ≈ 1,29
  });

  it('okno przy cenach rzędu 10^5 i tysiącach świec: bez utraty precyzji (porównanie ze wzorem dwuprzebiegowym)', () => {
    const xs = walk(5000, 7, 100_000).map((c) => c.c);
    const w = new Window(20);
    const mean: number[] = [];
    const sd: number[] = [];
    for (const x of xs) {
      w.next(x, true);
      mean.push(w.mean);
      sd.push(w.sd);
    }
    expectClose(mean, sma(xs, 20), 1e-12);
    expectClose(sd, stdevPop(xs, 20), 1e-7);
  });
});

describe('wskaźniki: wzory TradingView', () => {
  const cs = walk(600, 42);
  const closes = cs.map((c) => c.c);

  it('EMA: rozbieg średnią prostą, α = 2/(n+1)', () => {
    expectClose(run(inst('ema', { length: 21 }), cs)[0], smoothed(closes, 21, 2 / 22));
  });

  it('Bollinger: średnia prosta ± k·σ populacyjnej', () => {
    const [basis, upper, lower] = run(inst('bb', { length: 20, mult: 2.5 }), cs);
    const m = sma(closes, 20);
    const s = stdevPop(closes, 20);
    expectClose(basis, m);
    expectClose(upper, m.map((x, i) => x + 2.5 * s[i]), 1e-9);
    expectClose(lower, m.map((x, i) => x - 2.5 * s[i]), 1e-9);
  });

  it('RSI: średnie Wildera wzrostów i spadków, pierwsza wartość na świecy n', () => {
    const rsi = run(inst('rsi', { length: 14 }), cs)[0];
    expectClose(rsi, rsiBatch(closes, 14));
    expect(rsi.slice(0, 14).every(Number.isNaN)).toBe(true);
    expect(rsi[14]).not.toBeNaN();
  });

  it('RSI: przykład Wildera z podręcznika (StockCharts, 14 okresów)', () => {
    const closes = [
      44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931, 46.0328, 45.614, 46.282, 46.282, 46.0028,
      46.0328, 46.4116, 46.2222, 45.6439, 46.2122, 46.2521, 45.7137, 46.4515, 45.7835, 45.3548, 44.0288, 44.1783, 44.2181, 44.5672, 43.4205,
      42.6628, 43.1314,
    ];
    const rsi = run(inst('rsi', { length: 14 }), closeOnly(closes))[0];
    expect(rsi.slice(14).map((x) => Number(x.toFixed(2)))).toEqual([
      70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38, 54.71, 50.42, 39.99, 41.46, 41.87, 45.46, 37.3, 33.08, 37.77,
    ]);
  });

  it('RSI: same wzrosty → 100, same spadki → 0, stała cena → 100 (D = 0, jak w Pine)', () => {
    const up = run(inst('rsi', { length: 3 }), closeOnly([1, 2, 3, 4, 5]))[0];
    expect(up.slice(3)).toEqual([100, 100]);
    expect(run(inst('rsi', { length: 3 }), closeOnly([5, 4, 3, 2, 1]))[0].slice(3)).toEqual([0, 0]);
    expect(run(inst('rsi', { length: 3 }), closeOnly([7, 7, 7, 7]))[0][3]).toBe(100);
  });

  it('ATR: RMA z true range, pierwsza świeca H − L', () => {
    expectClose(run(inst('atr', { length: 14 }), cs)[0], atrBatch(cs, 14));
    const two: Candle[] = [
      { t: 0, o: 10, h: 12, l: 9, c: 11, v: 1, n: 1 },
      { t: M5, o: 11, h: 11.5, l: 6, c: 7, v: 1, n: 1 },
    ];
    // TR: 3 (H − L), potem max(5.5, |11.5 − 11|, |6 − 11|) = 5.5
    expect(run(inst('atr', { length: 2 }), two)[0]).toEqual([NaN, 4.25]);
  });

  it('stała cena: ATR 0, Bollinger równy cenie', () => {
    const flat = closeOnly(new Array(30).fill(80_000));
    expect(run(inst('atr', { length: 14 }), flat)[0].slice(13).every((x) => x === 0)).toBe(true);
    const [basis, upper, lower] = run(inst('bb'), flat);
    expect([basis[29], upper[29], lower[29]]).toEqual([80_000, 80_000, 80_000]);
  });

  it('przesunięcie ceny o stałą przesuwa EMA i Bollingera, nie zmienia RSI ani ATR; skala ×k mnoży ATR', () => {
    const shifted = cs.map((c) => ({ ...c, o: c.o + 5000, h: c.h + 5000, l: c.l + 5000, c: c.c + 5000 }));
    const scaled = cs.map((c) => ({ ...c, o: c.o * 3, h: c.h * 3, l: c.l * 3, c: c.c * 3 }));
    expectClose(run(inst('ema'), shifted)[0], run(inst('ema'), cs)[0].map((x) => x + 5000));
    expectClose(run(inst('bb'), shifted)[2], run(inst('bb'), cs)[2].map((x) => x + 5000), 1e-8);
    expectClose(run(inst('rsi'), shifted)[0], run(inst('rsi'), cs)[0], 1e-8);
    expectClose(run(inst('rsi'), scaled)[0], run(inst('rsi'), cs)[0], 1e-8);
    expectClose(run(inst('atr'), shifted)[0], run(inst('atr'), cs)[0], 1e-8);
    expectClose(run(inst('atr'), scaled)[0], run(inst('atr'), cs)[0].map((x) => x * 3), 1e-9);
  });
});

// ───────────── partia A: wzory wbudowanych skryptów TradingView przepisane wprost na tablice ─────────────

/** `ta.ema` / `ta.rma` na serii z `na` na początku: rozbieg średnią prostą od pierwszej liczby. */
function smoothedFrom(xs: readonly number[], n: number, alpha: number): number[] {
  const f = xs.findIndex((x) => !Number.isNaN(x));
  return f < 0 ? xs.map(() => NaN) : [...xs.slice(0, f).map(() => NaN), ...smoothed(xs.slice(f), n, alpha)];
}

const highest = (xs: readonly number[], n: number) => xs.map((_, i) => (i < n - 1 ? NaN : Math.max(...xs.slice(i - n + 1, i + 1))));
const lowest = (xs: readonly number[], n: number) => xs.map((_, i) => (i < n - 1 ? NaN : Math.min(...xs.slice(i - n + 1, i + 1))));

function dmiBatch(cs: readonly Candle[], len: number, lensig: number): number[][] {
  const tr = cs.map((c, i) => (i === 0 ? NaN : Math.max(c.h - c.l, Math.abs(c.h - cs[i - 1].c), Math.abs(c.l - cs[i - 1].c))));
  const up = cs.map((c, i) => (i === 0 ? NaN : c.h - cs[i - 1].h));
  const down = cs.map((c, i) => (i === 0 ? NaN : cs[i - 1].l - c.l));
  const pdm = up.map((u, i) => (Number.isNaN(u) ? NaN : u > down[i] && u > 0 ? u : 0));
  const mdm = down.map((d, i) => (Number.isNaN(d) ? NaN : d > up[i] && d > 0 ? d : 0));
  const trur = smoothedFrom(tr, len, 1 / len);
  const fixnan = (xs: number[]) => xs.map((x, i, a) => (Number.isNaN(x) && i > 0 ? (a[i] = a[i - 1]) : x));
  const plus = fixnan(smoothedFrom(pdm, len, 1 / len).map((x, i) => (100 * x) / trur[i]));
  const minus = fixnan(smoothedFrom(mdm, len, 1 / len).map((x, i) => (100 * x) / trur[i]));
  const dx = plus.map((p, i) => Math.abs(p - minus[i]) / (p + minus[i] === 0 ? 1 : p + minus[i]));
  return [smoothedFrom(dx, lensig, 1 / lensig).map((x) => 100 * x), plus, minus];
}

/** `ta.supertrend(factor, atrPeriod)` z dokumentacji Pine, krok po kroku. */
function supertrendBatch(cs: readonly Candle[], factor: number, period: number): { line: number[]; dir: number[] } {
  const atr = atrBatch(cs, period);
  const lower: number[] = [];
  const upper: number[] = [];
  const line: number[] = [];
  const dir: number[] = [];
  const nz = (x: number) => (Number.isNaN(x) ? 0 : x);
  cs.forEach((c, i) => {
    const src = (c.h + c.l) / 2;
    let lb = src - factor * atr[i];
    let ub = src + factor * atr[i];
    const pl = nz(lower[i - 1] ?? NaN);
    const pu = nz(upper[i - 1] ?? NaN);
    const pc = i > 0 ? cs[i - 1].c : NaN;
    lb = lb > pl || pc < pl ? lb : pl;
    ub = ub < pu || pc > pu ? ub : pu;
    let d: number;
    if (i === 0 || Number.isNaN(atr[i - 1])) d = 1;
    else if (line[i - 1] === pu) d = c.c > ub ? -1 : 1;
    else d = c.c < lb ? 1 : -1;
    lower.push(Number.isNaN(atr[i]) ? NaN : lb);
    upper.push(Number.isNaN(atr[i]) ? NaN : ub);
    dir.push(Number.isNaN(atr[i]) ? NaN : d);
    line.push(Number.isNaN(atr[i]) ? NaN : d === -1 ? lb : ub);
  });
  return { line, dir };
}

describe('wskaźniki: partia A (wzory TradingView)', () => {
  const cs = walk(700, 9);
  const closes = cs.map((c) => c.c);
  const highs = cs.map((c) => c.h);
  const lows = cs.map((c) => c.l);

  it('MA: średnia prosta z n zamknięć', () => {
    expectClose(run(inst('sma', { length: 9 }), cs)[0], sma(closes, 9));
  });

  it('Stochastic: %K = SMA(100·(C − min L)/(max H − min L)), %D = SMA(%K)', () => {
    const [k, d] = run(inst('stoch', { length: 14, smooth: 3, d: 3 }), cs);
    const hh = highest(highs, 14);
    const ll = lowest(lows, 14);
    const raw = closes.map((c, i) => (100 * (c - ll[i])) / (hh[i] - ll[i]));
    const kb = sma(raw, 3);
    expectClose(k, kb);
    expectClose(d, sma(kb, 3));
    expect(k.filter((x) => !Number.isNaN(x)).every((x) => x >= 0 && x <= 100)).toBe(true);
    // Domyślne TradingView: %K bez wygładzania, pierwsza %D na świecy 15
    const [k1, d1] = run(inst('stoch'), cs);
    expect(Number.isNaN(k1[12]) && !Number.isNaN(k1[13]) && Number.isNaN(d1[14]) && !Number.isNaN(d1[15])).toBe(true);
  });

  it('Stochastic przy zakresie zerowym: `ta.sma` pomija `na`, więc %K trzyma ostatnią wartość', () => {
    const flat = (t: number): Candle => ({ t, o: 100, h: 100, l: 100, c: 100, v: 1, n: 1 });
    const two = [...cs.slice(0, 40), ...[1, 2, 3, 4].map((k) => flat(cs[39].t + k * M5))];
    const [k, d] = run(inst('stoch', { length: 2, smooth: 1, d: 3 }), two);
    // Od świecy 41 obie świece zakresu są płaskie: max H = min L
    expect(k[40]).not.toBeNaN();
    expect([k[41], k[42], k[43]]).toEqual([k[40], k[40], k[40]]);
    // %D dostaje z %K liczby, więc liczy dalej: na świecy 43 trzy razy ta sama wartość
    expect(d[41]).toBeCloseTo((k[39] + 2 * k[40]) / 3, 9);
    expect(d[43]).toBeCloseTo(k[40], 9);
    const w = new Window(2);
    for (const x of [1, NaN, 3, NaN]) w.next(x, true);
    expect(w.mean).toBe(2);
  });

  it('MACD: EMA 12 − EMA 26, sygnał EMA 9 od pierwszej wartości MACD, słupki = różnica', () => {
    const [m, sig, hist] = run(inst('macd'), cs);
    const mb = smoothed(closes, 12, 2 / 13).map((x, i) => x - smoothed(closes, 26, 2 / 27)[i]);
    const sb = smoothedFrom(mb, 9, 0.2);
    expectClose(m, mb, 1e-9);
    expectClose(sig, sb, 1e-9);
    expectClose(hist, mb.map((x, i) => x - sb[i]), 1e-9);
    expect(Number.isNaN(sig[32]) && !Number.isNaN(sig[33])).toBe(true);
  });

  it('DMI: ADX, +DI i −DI jak we wbudowanym skrypcie (ta.tr bez pierwszej świecy, fixnan)', () => {
    const got = run(inst('dmi'), cs);
    const want = dmiBatch(cs, 14, 14);
    got.forEach((ys, p) => expectClose(ys, want[p], 1e-8));
    expect(Number.isNaN(got[0][26]) && !Number.isNaN(got[0][27])).toBe(true);
    expect(got[0].filter((x) => !Number.isNaN(x)).every((x) => x >= 0 && x <= 100)).toBe(true);
  });

  it('Supertrend: ta.supertrend krok po kroku; linia pod zamknięciem w trendzie −1, nad nim w trendzie 1', () => {
    const [down, up] = run(inst('supertrend'), cs);
    const { line, dir } = supertrendBatch(cs, 3, 10);
    expectClose(down, line.map((x, i) => (dir[i] === -1 ? x : NaN)), 1e-9);
    expectClose(up, line.map((x, i) => (dir[i] === 1 ? x : NaN)), 1e-9);
    expect(dir.filter((d) => d === -1).length).toBeGreaterThan(50);
    expect(dir.filter((d) => d === 1).length).toBeGreaterThan(50);
    cs.forEach((c, i) => {
      if (dir[i] === -1) expect(c.c).toBeGreaterThanOrEqual(down[i]);
      if (dir[i] === 1) expect(c.c).toBeLessThanOrEqual(up[i]);
    });
  });

  it('Keltner: EMA 20 ± 2 × ATR 10; Donchian: kanał zawiera każdą świecę okna', () => {
    const [basis, upper, lower] = run(inst('keltner'), cs);
    const e = smoothed(closes, 20, 2 / 21);
    const a = atrBatch(cs, 10);
    expectClose(basis, e);
    expectClose(upper, e.map((x, i) => x + 2 * a[i]), 1e-9);
    expectClose(lower, e.map((x, i) => x - 2 * a[i]), 1e-9);
    const [mid, hi, lo] = run(inst('donchian'), cs);
    expectClose(hi, highest(highs, 20));
    expectClose(lo, lowest(lows, 20));
    expectClose(mid, highest(highs, 20).map((h, i) => (h + lowest(lows, 20)[i]) / 2));
  });

  it('OBV: suma wolumenu ze znakiem zmiany zamknięcia', () => {
    const obv = run(inst('obv'), cs)[0];
    let sum = 0;
    const want = closes.map((c, i) => (i === 0 ? NaN : (sum += Math.sign(c - closes[i - 1]) * cs[i].v)));
    expectClose(obv, want, 1e-12);
  });

  it('przesunięcie ceny: MACD, Stochastic, DMI bez zmian; MA, Keltner, Donchian i Supertrend przesunięte', () => {
    const shifted = cs.map((c) => ({ ...c, o: c.o + 5000, h: c.h + 5000, l: c.l + 5000, c: c.c + 5000 }));
    for (const id of ['macd', 'stoch', 'dmi'] as const) run(inst(id), shifted).forEach((ys, p) => expectClose(ys, run(inst(id), cs)[p], 1e-7));
    for (const id of ['sma', 'keltner', 'donchian', 'supertrend'] as const)
      run(inst(id), shifted).forEach((ys, p) => expectClose(ys, run(inst(id), cs)[p].map((x) => x + 5000), 1e-9));
  });
});

// ───────────── partia B: wzory wbudowanych skryptów TradingView przepisane wprost na tablice ─────────────

/** Wzór na części serii od pierwszej liczby (rozbieg `na` na początku pomijany, jak w funkcjach `ta.*`). */
function onFinite(xs: readonly number[], f: (ys: number[]) => number[]): number[] {
  const k = xs.findIndex((x) => !Number.isNaN(x));
  return k < 0 ? xs.map(() => NaN) : [...xs.slice(0, k).map(() => NaN), ...f(xs.slice(k))];
}

const wma = (xs: readonly number[], n: number) =>
  xs.map((_, i) => (i < n - 1 ? NaN : xs.slice(i - n + 1, i + 1).reduce((a, x, k) => a + (k + 1) * x, 0) / ((n * (n + 1)) / 2)));

describe('wskaźniki: partia B (wzory TradingView)', () => {
  const cs = walk(700, 21);
  const closes = cs.map((c) => c.c);
  const highs = cs.map((c) => c.h);
  const lows = cs.map((c) => c.l);
  const vols = cs.map((c) => c.v);
  const tp = cs.map((c) => (c.h + c.l + c.c) / 3);

  it('WMA: wagi n…1 od najnowszej, bez utraty precyzji na długiej serii', () => {
    const xs = walk(5000, 3, 100_000).map((c) => c.c);
    const w = new Wma(200);
    expectClose(xs.map((x) => w.next(x, true)), wma(xs, 200), 1e-11);
  });

  it('HMA: WMA(2·WMA(n/2) − WMA(n), ⌊√n⌋); stała cena daje tę cenę', () => {
    const inner = wma(closes, 4).map((a, i) => 2 * a - wma(closes, 9)[i]);
    expectClose(run(inst('hma', { length: 9 }), cs)[0], onFinite(inner, (ys) => wma(ys, 3)));
    const flat = cs.slice(0, 40).map((c) => ({ ...c, o: 100, h: 100, l: 100, c: 100 }));
    expect(run(inst('hma', { length: 9 }), flat)[0].slice(10).every((x) => Math.abs(x - 100) < 1e-9)).toBe(true);
  });

  it('VWMA: SMA(C·V) / SMA(V)', () => {
    const pv = sma(closes.map((c, i) => c * vols[i]), 20);
    const v = sma(vols, 20);
    expectClose(run(inst('vwma'), cs)[0], pv.map((a, i) => a / v[i]));
  });

  it('CCI: (hlc3 − SMA) / (0,015 · średnie odchylenie bezwzględne)', () => {
    const m = sma(tp, 20);
    const want = tp.map((x, i) => {
      if (Number.isNaN(m[i])) return NaN;
      const dev = tp.slice(i - 19, i + 1).reduce((a, y) => a + Math.abs(y - m[i]), 0) / 20;
      return (x - m[i]) / (0.015 * dev);
    });
    expectClose(run(inst('cci'), cs)[0], want, 1e-8);
  });

  it('Williams %R: 100·(C − max H)/(max H − min L) w [−100, 0]', () => {
    const hh = highest(highs, 14);
    const ll = lowest(lows, 14);
    const got = run(inst('wpr'), cs)[0];
    expectClose(got, closes.map((c, i) => (100 * (c - hh[i])) / (hh[i] - ll[i])));
    expect(got.filter((x) => !Number.isNaN(x)).every((x) => x >= -100 && x <= 0)).toBe(true);
  });

  it('Stoch RSI: stochastyk na RSI 14 (od pierwszej wartości RSI), %K = SMA 3, %D = SMA 3', () => {
    const [k, d] = run(inst('stochrsi'), cs);
    const kb = onFinite(rsiBatch(closes, 14), (r) => {
      const hh = highest(r, 14);
      const ll = lowest(r, 14);
      return sma(r.map((x, i) => (100 * (x - ll[i])) / (hh[i] - ll[i])), 3);
    });
    expectClose(k, kb, 1e-8);
    expectClose(d, onFinite(kb, (ys) => sma(ys, 3)), 1e-8);
    expect(Number.isNaN(k[28]) && !Number.isNaN(k[29]) && Number.isNaN(d[30]) && !Number.isNaN(d[31])).toBe(true);
  });

  it('CHOP: 100·log10(Σ TR / (max H − min L)) / log10(n), TR pierwszej świecy H − L', () => {
    const tr = cs.map((c, i) => (i === 0 ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - cs[i - 1].c), Math.abs(c.l - cs[i - 1].c))));
    const sum = sma(tr, 14).map((x) => x * 14);
    const hh = highest(highs, 14);
    const ll = lowest(lows, 14);
    const got = run(inst('chop'), cs)[0];
    expectClose(got, sum.map((x, i) => (100 * Math.log10(x / (hh[i] - ll[i]))) / Math.log10(14)), 1e-8);
    expect(got.filter((x) => !Number.isNaN(x)).every((x) => x >= 0 && x <= 100)).toBe(true);
  });

  it('CMF: Σ(((C − L) − (H − C))/(H − L)·V) / ΣV w [−1, 1]', () => {
    const ad = cs.map((c) => ((2 * c.c - c.l - c.h) / (c.h - c.l)) * c.v);
    const got = run(inst('cmf'), cs)[0];
    expectClose(got, sma(ad, 20).map((a, i) => a / sma(vols, 20)[i]));
    expect(got.filter((x) => !Number.isNaN(x)).every((x) => x >= -1 && x <= 1)).toBe(true);
  });

  it('MFI: ta.mfi na hlc3 (pierwsza świeca bez zmiany w obu sumach, jak w Pine)', () => {
    const f = tp.map((x, i) => x * vols[i]);
    const up = sma(f.map((x, i) => (i > 0 && tp[i] - tp[i - 1] <= 0 ? 0 : x)), 14);
    const down = sma(f.map((x, i) => (i > 0 && tp[i] - tp[i - 1] >= 0 ? 0 : x)), 14);
    const got = run(inst('mfi'), cs)[0];
    expectClose(got, up.map((u, i) => 100 - 100 / (1 + u / down[i])));
    expect(got.filter((x) => !Number.isNaN(x)).every((x) => x >= 0 && x <= 100)).toBe(true);
  });

  it('przesunięcie ceny: CCI, %R, Stoch RSI, CHOP i CMF bez zmian; HMA i VWMA przesunięte', () => {
    const shifted = cs.map((c) => ({ ...c, o: c.o + 5000, h: c.h + 5000, l: c.l + 5000, c: c.c + 5000 }));
    for (const id of ['cci', 'wpr', 'stochrsi', 'chop', 'cmf'] as const) run(inst(id), shifted).forEach((ys, p) => expectClose(ys, run(inst(id), cs)[p], 1e-6));
    for (const id of ['hma', 'vwma'] as const) run(inst(id), shifted).forEach((ys, p) => expectClose(ys, run(inst(id), cs)[p].map((x) => x + 5000), 1e-9));
  });
});

const H1 = 3_600_000;
const D1 = 86_400_000;

/** Świece interwału `ms` ze świec wykresu: wcześniejsze bez zmian (ten sam obiekt), ostatnia złożona od nowa (nowy obiekt, jak z API). */
function rollup(prev: readonly Candle[], chart: readonly Candle[], ms: number): Candle[] {
  const last = chart[chart.length - 1];
  const t = Math.floor(last.t / ms) * ms;
  const part = chart.filter((c) => c.t >= t);
  const c: Candle = { t, o: part[0].o, h: Math.max(...part.map((x) => x.h)), l: Math.min(...part.map((x) => x.l)), c: last.c, v: part.reduce((a, x) => a + x.v, 0), n: 1 };
  return [...prev.filter((x) => x.t < t), c];
}

describe('wskaźniki: partia C (pivoty, interwał wskaźnika)', () => {
  /** Wartości instancji na świecach wykresu ze świecami interwałów z `src`. */
  function runTf(x: IndicatorInstance, chart: readonly Candle[], ms: number, src: Record<string, readonly Candle[]>): number[][] {
    const e = new IndicatorEngine();
    e.setInstances([x]);
    e.sync(bars(chart), ms, (tf) => src[tf] ?? []);
    return e.runs[0].out.map((a) => Array.from(a.subarray(0, chart.length)));
  }

  it('pivoty Traditional: przykład liczbowy (H 120, L 90, C 105) i wzory z poprzedniej doby UTC', () => {
    const days: Candle[] = [
      { t: 0, o: 100, h: 120, l: 90, c: 105, v: 1, n: 1 },
      { t: D1, o: 105, h: 111, l: 99, c: 103, v: 1, n: 1 },
      { t: 2 * D1, o: 103, h: 104, l: 102, c: 103, v: 1, n: 1 },
    ];
    const chart = closeOnly(new Array(4 * 24).fill(100)).map((c, i) => ({ ...c, t: i * H1 }));
    const out = runTf(inst('pivots'), chart, H1, { '1d': days });
    // Doba 1 z doby 0: P 105, R1 120, S1 90, R2 135, S2 75, R3 150, S3 60 — od pierwszej do ostatniej godziny
    for (const i of [24, 30, 47]) expect(out.map((ys) => ys[i])).toEqual([105, 120, 90, 135, 75, 150, 60]);
    const { h, l, c } = days[1];
    const p = (h + l + c) / 3;
    expectClose(
      out.map((ys) => ys[48]),
      [p, 2 * p - l, 2 * p - h, p + (h - l), p - (h - l), h + 2 * (p - l), l - 2 * (h - p)]
    );
    // Pierwsza doba historii bez poprzedniej; doba bez swojej świecy 1D (jeszcze nie dotarła) bez poziomów, nie z doby wcześniej
    expect(out[0][23]).toBeNaN();
    expect(out[0][72]).toBeNaN();
    // Przesunięcie cen o stałą przesuwa poziomy o tę stałą
    const up = days.map((d) => ({ ...d, o: d.o + 50, h: d.h + 50, l: d.l + 50, c: d.c + 50 }));
    runTf(inst('pivots'), chart, H1, { '1d': up }).forEach((ys, k) => expectClose(ys.slice(24, 72), out[k].slice(24, 72).map((v) => v + 50)));
  });

  it('interwał wskaźnika: świeca wykresu ma wartość ostatniej świecy interwału zamkniętej do jej końca', () => {
    const hours = walk(60, 31).map((c, i) => ({ ...c, t: i * H1 }));
    const chart = walk(60 * 12, 32).map((c, i) => ({ ...c, t: i * M5 }));
    const own = run(inst('ema', { length: 5 }), hours)[0];
    const ys = runTf({ ...inst('ema', { length: 5 }), tf: '1h' }, chart, M5, { '1h': hours })[0];
    chart.forEach((b, i) => {
      const j = Math.floor((b.t + M5) / H1) - 1;
      expect(ys[i]).toBe(j >= 0 ? own[j] : NaN);
    });
    // Zmiana wartości tylko na ostatniej świecy 5m w godzinie
    for (let i = 1; i < chart.length; i++) if (ys[i] !== ys[i - 1] && !Number.isNaN(ys[i - 1])) expect((i + 1) % 12).toBe(0);
    // Interwał równy wykresowi: te same wartości co bez interwału
    const same = runTf({ ...inst('rsi', { length: 7 }), tf: '1h' }, hours, H1, { '1h': hours })[0];
    expect(same).toEqual(run(inst('rsi', { length: 7 }), hours)[0]);
  });

  it('na żywo (świece wykresu i interwałów rosną): zgłoszony indeks obejmuje każdą zmianę, wynik jak przeliczenie od zera', () => {
    const list = [{ ...inst('rsi', { length: 5 }), tf: '4h' }, { ...inst('ema', { length: 3 }), tf: '1d' }, inst('pivots'), inst('sma', { length: 5 })];
    const src = walk(24 * 6, 41).map((c, i) => ({ ...c, t: i * H1 }));
    const e = new IndicatorEngine();
    e.setInstances(list);
    let chart: Candle[] = [];
    let h4: Candle[] = [];
    let d1: Candle[] = [];
    const shown = list.map((x) => indicatorDef(x.id).plots.map(() => [] as number[]));
    const candlesOf = (tf: string) => (tf === '4h' ? h4 : tf === '1d' ? d1 : []);
    const push = () => {
      const from = e.sync(bars(chart), H1, candlesOf);
      e.runs.forEach((r, k) => r.out.forEach((a, p) => {
        shown[k][p].length = chart.length;
        for (let i = from; i < chart.length; i++) shown[k][p][i] = a[i];
      }));
    };
    const r = rng(9);
    for (const c of src) {
      // Nowa świeca (świece interwałów dochodzą chwilę później), potem dwie transakcje na niej
      let cur = c;
      chart = [...chart, cur];
      push();
      h4 = rollup(h4, chart, 4 * H1);
      d1 = rollup(d1, chart, D1);
      push();
      for (let k = 0; k < 2; k++) {
        const px = cur.c + (r() - 0.5) * 30;
        cur = { ...cur, c: px, h: Math.max(cur.h, px), l: Math.min(cur.l, px) };
        chart = [...chart.slice(0, -1), cur];
        h4 = rollup(h4, chart, 4 * H1);
        d1 = rollup(d1, chart, D1);
        push();
      }
      // Poprawka starszej świecy interwału z API (świece wykresu bez zmian)
      if (r() < 0.25 && d1.length > 1) {
        const j = Math.floor(r() * (h4.length - 1));
        const k = Math.floor(r() * (d1.length - 1));
        h4 = h4.map((x, i) => (i === j ? { ...x, c: x.c + 3 } : x));
        d1 = d1.map((x, i) => (i === k ? { ...x, h: x.h + 3 } : x));
        push();
      }
    }
    const fresh = new IndicatorEngine();
    fresh.setInstances(list);
    fresh.sync(bars(chart), H1, candlesOf);
    fresh.runs.forEach((run, k) => run.out.forEach((a, p) => expect(shown[k][p]).toEqual(Array.from(a.subarray(0, chart.length)))));
    // Wartości są: RSI z 4h, EMA z doby i pivoty od drugiej doby
    expect(fresh.runs.every((run) => Number.isFinite(run.out[0][chart.length - 1]))).toBe(true);
  });

  it('podpis, link i zapis z interwałem; pivoty bez interwału', () => {
    const [rsi, piv] = parseIndicators([
      { id: 'rsi', params: { length: 14 }, tf: '1h' },
      { id: 'pivots', tf: '4h' },
      { id: 'ema', tf: '7m' },
    ]);
    expect(indicatorLabel(rsi)).toBe('RSI 14 1h');
    expect(piv.tf).toBeUndefined();
    expect(indicatorLabel(piv)).toBe('Pivots');
    const list = parseIndicators([{ id: 'rsi', params: { length: 14 }, tf: '1h' }, { id: 'ema', tf: '7m' }, { id: 'pivots' }, { id: 'bb', tf: '1d' }]);
    expect(list[1].tf).toBeUndefined();
    expect(indicatorsLink(list)).toBe('rsi(14)@1h;ema(9);pivots();bb(20,2)@1d');
    const back = indicatorsFromLink('rsi(14)@1h;ema(9);pivots()@1d;bb(20,2)@1d;sma(5)@2h');
    expect(back.map((x) => [x.id, x.tf])).toEqual([
      ['rsi', '1h'],
      ['ema', undefined],
      ['pivots', undefined],
      ['bb', '1d'],
      ['sma', undefined],
    ]);
    expect(indicatorLabel(indicatorsFromLink('bb(20,2)@1d')[0])).toBe('BB 20 2 1D');
  });
});

describe('wskaźniki: partia D (Parabolic SAR, kanał regresji, HV, Net Volume)', () => {
  const cs = walk(600, 51);
  const closes = cs.map((c) => c.c);

  it('Parabolic SAR: przykład liczony ręcznie (start, nowy szczyt, odwrócenie) i zawsze poza zakresem świecy', () => {
    const mk = (h: number, l: number, c: number, i: number): Candle => ({ t: i * M5, o: c, h, l, c, v: 1, n: 1 });
    const five = [mk(10, 8, 9, 0), mk(11, 9, 10.5, 1), mk(12, 10, 11.5, 2), mk(12.5, 11, 12, 3), mk(12, 7, 7.5, 4)];
    // Doba 1: SAR = min(8 + 0,02·(11 − 8), L[1] 8) = 8; doba 2: przyspieszenie 0,04, SAR obcięty do L[2] 8;
    // doba 3: 8 + 0,04·(12 − 8) = 8,16; doba 4: 8,16 + 0,06·(12,5 − 8,16) > L 7 → odwrócenie na max(H 12, szczyt 12,5)
    expectClose(run(inst('psar'), five)[0], [NaN, 8, 8, 8.16, 12.5], 1e-12);
    const sar = run(inst('psar'), cs)[0];
    sar.slice(1).forEach((v, k) => {
      const c = cs[k + 1];
      expect(v <= c.l || v >= c.h, `świeca ${k + 1}`).toBe(true);
    });
    // Po obu stronach ceny: trend w górę i w dół
    expect(sar.some((v, i) => v < cs[i].l) && sar.some((v, i) => v > cs[i].h)).toBe(true);
  });

  it('kanał regresji: prosta najmniejszych kwadratów przez ostatnie n zamknięć i odchylenie reszt z dzielnikiem n − 1, wcześniej bez wartości', () => {
    const n = 50;
    const [mid, up, down] = run(inst('linreg', { length: n, up: 2, down: 1.5 }), cs);
    const end = cs.length - 1;
    // Prosta z zwykłej regresji y = a + b·t po indeksie świecy
    const ts = Array.from({ length: n }, (_, k) => end - n + 1 + k);
    const ys = ts.map((t) => closes[t]);
    const mt = ts.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    const b = ts.reduce((a, t, k) => a + (t - mt) * (ys[k] - my), 0) / ts.reduce((a, t) => a + (t - mt) ** 2, 0);
    const fit = ts.map((t) => my + b * (t - mt));
    const sd = Math.sqrt(ys.reduce((a, y, k) => a + (y - fit[k]) ** 2, 0) / (n - 1));
    expectClose(mid.slice(end - n + 1), fit, 1e-9);
    expectClose(up.slice(end - n + 1), fit.map((f) => f + 2 * sd), 1e-9);
    expectClose(down.slice(end - n + 1), fit.map((f) => f - 1.5 * sd), 1e-9);
    expect(mid.slice(0, end - n + 1).every(Number.isNaN)).toBe(true);
    // Za mało świec: bez kanału
    expect(run(inst('linreg', { length: n }), cs.slice(0, n - 1))[0].every(Number.isNaN)).toBe(true);
  });

  it('HV: odchylenie populacyjne logarytmicznych zmian × √365 jak TradingView, na każdym interwale', () => {
    const lr = closes.map((c, i) => (i === 0 ? NaN : Math.log(c / closes[i - 1])));
    const sd = [NaN, ...stdevPop(lr.slice(1), 10)];
    const want = sd.map((x) => 100 * x * Math.sqrt(365));
    expectClose(run(inst('hv', { length: 10 }), cs)[0], want, 1e-9);
    const days = cs.map((c, i) => ({ ...c, t: i * 86_400_000 }));
    expectClose(run(inst('hv', { length: 10 }), days)[0], want, 1e-9);
  });

  it('Net Volume: wolumen ze znakiem zmiany zamknięcia, pierwsza świeca i brak zmiany 0', () => {
    const flat = cs.slice(0, 30).map((c, i) => (i === 10 ? { ...c, c: cs[9].c } : c));
    const want = flat.map((c, i) => (i === 0 ? 0 : c.c > flat[i - 1].c ? c.v : c.c < flat[i - 1].c ? -c.v : 0));
    expect(run(inst('netvol'), flat)[0]).toEqual(want);
    expect(want[10]).toBe(0);
  });

  it('na żywo z indeksem zmian każdej instancji osobno: kanał przesuwa się z nową świecą, wynik jak przeliczenie od zera', () => {
    const list = [inst('linreg', { length: 20 }), inst('psar'), inst('hv'), inst('netvol'), { ...inst('ema', { length: 3 }), tf: '4h' }];
    const src = walk(24 * 3, 61).map((c, i) => ({ ...c, t: i * H1 }));
    const e = new IndicatorEngine();
    e.setInstances(list);
    let chart: Candle[] = [];
    let h4: Candle[] = [];
    const shown = list.map((x) => indicatorDef(x.id).plots.map(() => [] as number[]));
    const candlesOf = (tf: string) => (tf === '4h' ? h4 : []);
    const push = () => {
      e.sync(bars(chart), H1, candlesOf);
      e.runs.forEach((r, k) =>
        r.out.forEach((a, p) => {
          shown[k][p].length = chart.length;
          for (let i = r.from; i < chart.length; i++) shown[k][p][i] = a[i];
        })
      );
    };
    const r = rng(19);
    for (const c of src) {
      let cur = c;
      chart = [...chart, cur];
      h4 = rollup(h4, chart, 4 * H1);
      push();
      for (let k = 0; k < 2; k++) {
        const px = cur.c + (r() - 0.5) * 30;
        cur = { ...cur, c: px, h: Math.max(cur.h, px), l: Math.min(cur.l, px) };
        chart = [...chart.slice(0, -1), cur];
        h4 = rollup(h4, chart, 4 * H1);
        push();
      }
    }
    const fresh = new IndicatorEngine();
    fresh.setInstances(list);
    fresh.sync(bars(chart), H1, candlesOf);
    fresh.runs.forEach((run, k) => run.out.forEach((a, p) => expect(shown[k][p]).toEqual(Array.from(a.subarray(0, chart.length)))));
    // Bez zmian świec: żadna instancja nie zgłasza zmiany
    e.sync(bars(chart), H1, candlesOf);
    expect(e.runs.every((run) => run.from === chart.length)).toBe(true);
  });
});

describe('wskaźniki: Ichimoku', () => {
  const cs = walk(400, 71);
  const mid = (n: number) => {
    const hi = highest(cs.map((c) => c.h), n);
    const lo = lowest(cs.map((c) => c.l), n);
    return hi.map((h, i) => (h + lo[i]) / 2);
  };

  it('linie jak we wbudowanym Ichimoku TradingView: środki zakresu 9, 26 i 52 świec, Senkou A jako ich średnia, Chikou to zamknięcie', () => {
    const [conv, base, lag, a, b] = run(inst('ichimoku'), cs);
    expectClose(conv, mid(9), 1e-12);
    expectClose(base, mid(26), 1e-12);
    expect(lag).toEqual(cs.map((c) => c.c));
    expectClose(a, mid(9).map((v, i) => (v + mid(26)[i]) / 2), 1e-12);
    expectClose(b, mid(52), 1e-12);
    expect(b.slice(0, 51).every(Number.isNaN)).toBe(true);
  });

  it('przesunięcie jak w TradingView: przy 26 chmura o 25 świec w przód, Chikou o 25 wstecz; bez parametru „Interwał”', () => {
    const x = inst('ichimoku');
    const def = indicatorDef('ichimoku');
    expect(def.plots.map((p) => plotShift(x, p))).toEqual([0, 0, -25, 25, 25]);
    expect(def.plots.map((p) => plotShift(inst('ichimoku', { disp: 1 }), p))).toEqual([0, 0, 0, 0, 0]);
    expect(def.cloud).toEqual([3, 4]);
    expect(indicatorLabel(x)).toBe('Ichimoku 9 26 52 26');
    expect(indicatorsFromLink('ichimoku(9,26,52,26)@1h')[0].tf).toBeUndefined();
    expect(parseIndicators([{ id: 'ichimoku', tf: '1h' }])[0].tf).toBeUndefined();
  });
});

describe('wskaźniki: zmiana OI i delta', () => {
  const cs = walk(6, 81);
  const t0 = cs[0].t;
  /** Odczyty OI co minutę (jak z kontekstu rynku), bez odczytów w czwartej świecy (przerwa w danych). */
  const oi = new Map<number, number>();
  for (let k = 0; k <= 30; k++) if (k < 15 || k > 19) oi.set(t0 + k * 60_000, 1000 + k * k);
  const oiAt = (t: number) => {
    const m = t0 + Math.floor((t - t0) / 60_000) * 60_000;
    return oi.get(m) ?? null;
  };
  const deltas = [5, -3, 0, 7, -2, 4];
  // Druga świeca bez pełnego nagrania, trzecia bez taśmy
  const tape = cs.map((candle, i) => ({ candle, fp: i === 2 ? null : { delta: deltas[i] }, complete: i !== 1 }));
  const now = t0 + 5 * M5 + 2 * 60_000;
  const sync = (e: IndicatorEngine, list = tape, at = oiAt) => e.sync(list, M5, () => [], flowCtx({ oiAt: at, now }));

  it('słupek to zmiana OI od początku do zamknięcia świecy (bieżąca: do teraz), druga wartość to delta; bez taśmy, pełnego nagrania albo odczytu OI — brak', () => {
    const e = new IndicatorEngine();
    e.setInstances([inst('oiflow')]);
    sync(e);
    const [d, delta] = e.runs[0].out.map((a) => Array.from(a.subarray(0, cs.length)));
    const ch = (k: number, z: number) => oiAt(t0 + z * 60_000)! - oiAt(t0 + k * 60_000)!;
    expect(d).toEqual([ch(0, 5), Number.NaN, Number.NaN, Number.NaN, ch(20, 25), ch(25, 27)]);
    expect(delta).toEqual([5, Number.NaN, Number.NaN, Number.NaN, -2, 4]);
  });

  it('kolor słupka ze znaku delty, delta tylko w legendzie; bez parametru „Interwał” i we własnej sekcji okna', () => {
    const def = indicatorDef('oiflow');
    expect(def.plots).toEqual([
      { hist: true, signOf: 1, title: 'ΔOI' },
      { hist: true, hidden: true, title: 'Delta' },
    ]);
    expect(def.group).toBe('hyperquant');
    expect(indicatorLabel(inst('oiflow'))).toBe('OI × Delta');
    expect(indicatorsLink([inst('oiflow')])).toBe('oiflow()');
    const fromLink = indicatorsFromLink('oiflow()@1h')[0];
    expect(fromLink.id).toBe('oiflow');
    expect(fromLink.tf).toBeUndefined();
    expect(parseIndicators([{ id: 'oiflow', tf: '1h' }])[0].tf).toBeUndefined();
  });

  it('przeliczenie zwraca pierwszą zmienioną świecę: bez zmian — liczba świec, nowy odczyt OI starszej świecy — jej indeks, doczytana historia z lewej — 0', () => {
    const e = new IndicatorEngine();
    e.setInstances([inst('oiflow')]);
    expect(sync(e)).toBe(0);
    expect(sync(e)).toBe(cs.length);
    const late = (t: number) => (t >= t0 + 15 * 60_000 && t < t0 + 20 * 60_000 ? 1500 : oiAt(t));
    expect(sync(e, tape, late)).toBe(3);
    const older = { candle: { ...cs[0], t: t0 - M5 }, fp: null, complete: false };
    expect(sync(e, [older, ...tape], late)).toBe(0);
  });
});

describe('wskaźniki: absorpcja', () => {
  const sortedMedian = (xs: readonly number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  /** Theil–Sen i MAD wprost z sortowania (niezależnie od wyboru Hoare'a w silniku). */
  const batchLine = (xs: readonly number[], ys: readonly number[]) => {
    const slopes: number[] = [];
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) if (xs[j] !== xs[i]) slopes.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
    const beta = sortedMedian(slopes);
    const alpha = sortedMedian(ys.map((y, i) => y - beta * xs[i]));
    return { alpha, beta, scale: 1.4826 * sortedMedian(ys.map((y, i) => Math.abs(y - alpha - beta * xs[i]))) };
  };
  /** Świece z taśmą: ruch w świecy = 2 USD na jednostkę delty plus szum; co siódma bez pełnego nagrania. */
  function tapeBars(n: number, seed: number) {
    const r = rng(seed);
    return walk(n, seed).map((c, i) => {
      const delta = Math.round((r() - 0.5) * 400) / 10;
      const close = c.o + 2 * delta + (r() - 0.5) * 30;
      return { candle: { ...c, c: close }, fp: { delta }, complete: i % 7 !== 3 };
    });
  }
  type TapeBar = ReturnType<typeof tapeBars>[number];
  /** Wartości z definicji: okno `span` poprzednich świec z pełną taśmą, reszta w stronę agresji przez rozrzut. */
  function batch(bs: readonly TapeBar[], span: number): number[] {
    const ok = bs.map((b) => b.complete);
    return bs.map((b, i) => {
      if (!ok[i]) return Number.NaN;
      const prev = bs.slice(0, i).filter((_, j) => ok[j]).slice(-span);
      if (prev.length < span) return Number.NaN;
      const f = batchLine(
        prev.map((p) => p.fp.delta),
        prev.map((p) => p.candle.c - p.candle.o)
      );
      if (!(f.beta > 0) || !(f.scale > 0)) return Number.NaN;
      return (Math.sign(b.fp.delta) * (b.candle.c - b.candle.o - f.alpha - f.beta * b.fp.delta)) / f.scale;
    });
  }
  const runOn = (bs: readonly TapeBar[], span = 30) => {
    const e = new IndicatorEngine();
    e.setInstances([inst('absorption', { length: span })]);
    e.sync(bs);
    return e;
  };

  it('mediana wyborem Hoare’a jak z sortowania (parzyste i nieparzyste liczby, powtórzenia)', () => {
    const r = rng(5);
    for (const n of [1, 2, 3, 4, 7, 10, 101, 1000]) {
      const xs = Array.from({ length: n }, () => Math.round(r() * 20));
      expect(medianInPlace(Float64Array.from(xs), n)).toBe(sortedMedian(xs));
    }
  });

  it('prosta Theila–Sena odporna: 10% skrajnych punktów nie przestawia nachylenia, jak z sortowania', () => {
    const r = rng(9);
    const xs = Array.from({ length: 120 }, () => (r() - 0.5) * 100);
    const ys = xs.map((x, i) => (i % 10 === 0 ? -800 : 3 * x + 5 + (r() - 0.5) * 4));
    const f = new RobustLine(120).fit(xs, ys, 120)!;
    expect(Math.abs(f.beta - 3)).toBeLessThan(0.1);
    const b = batchLine(xs, ys);
    expect(f.beta).toBe(b.beta);
    expect(f.alpha).toBe(b.alpha);
    expect(f.scale).toBe(b.scale);
    expect(new RobustLine(3).fit([1, 1, 1], [1, 2, 3], 3)).toBeNull();
  });

  it('wartości jak z definicji: reszta świecy względem prostej z poprzednich świec z pełną taśmą, ze znakiem strony agresji', () => {
    const bs = tapeBars(300, 21);
    const [z, delta] = runOn(bs).runs[0].out.map((a) => Array.from(a.subarray(0, bs.length)));
    const want = batch(bs, 30);
    expectClose(z, want, 1e-9);
    expect(want.filter((v) => !Number.isNaN(v)).length).toBeGreaterThan(200);
    expect(delta).toEqual(want.map((v, i) => (Number.isNaN(v) ? Number.NaN : bs[i].fp.delta)));
  });

  it('duża delta kupna bez ruchu ceny daje mocno ujemny słupek w kolorze kupna; delta tylko w legendzie, bez interwału', () => {
    const bs = tapeBars(120, 33);
    const last = bs[bs.length - 1];
    bs[bs.length - 1] = { ...last, candle: { ...last.candle, c: last.candle.o }, fp: { delta: 40 }, complete: true };
    const [z] = runOn(bs).runs[0].out;
    expect(z[bs.length - 1]).toBeLessThan(-3);
    const def = indicatorDef('absorption');
    expect(def.plots[0]).toMatchObject({ hist: true, signOf: 1 });
    expect(def.plots[1]).toMatchObject({ hidden: true });
    expect(def.levels).toEqual([-2, 0, 2]);
    expect(indicatorsLink([inst('absorption')])).toBe('absorption(120)');
    expect(parseIndicators([{ id: 'absorption', tf: '1h' }])[0].tf).toBeUndefined();
  });

  it('przeliczanie przyrostowe: żywa świeca, nowe świece, doczytana godzina taśmy w środku i historia z lewej — jak od zera', () => {
    const src = tapeBars(400, 44);
    // Taśma tylko od świecy 150 (jak po otwarciu strony), potem historia dochodzi do 100–149 i do 60–99
    const noTape = (b: TapeBar) => ({ ...b, complete: false });
    const view = (k: number, from: number) => src.slice(0, k).map((b, i) => (i < from ? noTape(b) : b));
    const e = new IndicatorEngine();
    e.setInstances([inst('absorption', { length: 30 })]);
    const check = (bs: readonly TapeBar[]) => {
      const fresh = runOn(bs).runs[0].out[0];
      expect(Array.from(e.runs[0].out[0].subarray(0, bs.length))).toEqual(Array.from(fresh.subarray(0, bs.length)));
    };
    let bs = view(300, 150);
    e.sync(bs);
    check(bs);
    // Żywa świeca: nowy obiekt ostatniej, przeliczona tylko ona
    const live = bs[bs.length - 1];
    bs = [...bs.slice(0, -1), { ...live, fp: { delta: live.fp.delta + 3 } }];
    expect(e.sync(bs)).toBe(bs.length - 1);
    check(bs);
    // Doczytana godzina taśmy: świece 100–149 dostają taśmę; zwrócony indeks to pierwsza zmieniona wartość (rozbieg
    // okna: świece tuż po 100 mają za mało poprzednich świec z taśmą i dalej są bez wartości)
    const before = Array.from(e.runs[0].out[0].subarray(0, bs.length));
    bs = [...bs.slice(0, 100), ...src.slice(100, 150), ...bs.slice(150)];
    const changed = e.sync(bs);
    check(bs);
    expect(changed).toBe(before.findIndex((v, i) => !Object.is(v, e.runs[0].out[0][i])));
    expect(changed).toBeGreaterThan(100);
    bs = [...bs.slice(0, 60), ...src.slice(60, 100), ...bs.slice(100)];
    e.sync(bs);
    check(bs);
    // Nowe świece i historia z lewej (inne indeksy)
    bs = [...bs, ...src.slice(300, 330)];
    e.sync(bs);
    check(bs);
    // Historia z lewej (czasy przed pierwszą świecą), z taśmą, razem ze zmianą żywej świecy: wartości przesunięte, a para
    // liczona tylko dla nowych świec i żywej
    const point = vi.spyOn(indicatorDef('absorption').sample!, 'point');
    const older = tapeBars(40, 7).map((b, i) => ({ ...b, candle: { ...b.candle, t: bs[0].candle.t - (40 - i) * M5 } }));
    const end = bs[bs.length - 1];
    bs = [...older, ...bs.slice(0, -1), { ...end, fp: { delta: -end.fp.delta } }];
    expect(e.sync(bs)).toBe(0);
    expect(point).toHaveBeenCalledTimes(41);
    point.mockRestore();
    check(bs);
    // Inny początek bez wspólnej świecy: liczenie od zera
    bs = tapeBars(200, 9);
    expect(e.sync(bs)).toBe(0);
    check(bs);
  });
});

describe('wskaźniki: OFI z kalibracją', () => {
  const S = 5_000;
  const frame = (t: number, bid: number, bidSz: number, ask: number, askSz: number): BookFrame => ({
    t,
    step: 10,
    px: Float64Array.of(bid, ask),
    sz: Float64Array.of(bidSz, askSz),
    n: Float64Array.of(1, 1),
    nBids: 1,
  });
  /**
   * Migawki co 5 s, w których każda zmiana środka to dokładnie β razy OFI pary: ruch o kubełek 10 USD w górę albo w dół
   * z dobraną wielkością na nowym poziomie; bez ruchu ceny wielkości zmieniają się o szum (OFI bez zmiany środka).
   * Od `quiet` cena stoi, a zostaje sam (większy) szum.
   */
  function book(until: number, beta: number, noise: number, seed: number, quiet = Number.POSITIVE_INFINITY): BookFrame[] {
    const r = rng(seed);
    const out: BookFrame[] = [];
    let bid = 80_000;
    let bidSz = 3;
    let askSz = 3;
    for (let t = 0; t < until; t += S) {
      const u = t < quiet ? r() : 1;
      if (u < 0.2) {
        // W górę: OFI = wielkość nowego bidu + wielkość poprzedniego asku
        bidSz = 10 / beta - askSz;
        askSz = 1 + 4 * r();
        bid += 10;
      } else if (u < 0.4) {
        // W dół: OFI = −(wielkość poprzedniego bidu + wielkość nowego asku)
        askSz = 10 / beta - bidSz;
        bidSz = 1 + 4 * r();
        bid -= 10;
      } else {
        // Gdy cena stoi, szum większy (wielkości nie muszą już pasować do ruchu o kubełek)
        const a = t < quiet ? noise : 8 * noise;
        bidSz = Math.max(0.5, bidSz + a * (r() - 0.5));
        askSz = Math.max(0.5, askSz + a * (r() - 0.5));
      }
      out.push(frame(t, bid, bidSz, bid + 10, askSz));
    }
    return out;
  }
  const flowBars = (n: number) => walk(n, 4).map((candle) => ({ candle }));
  const run = (bs: readonly { candle: Candle }[], frames: readonly BookFrame[], now: number, length = 30) => {
    const e = new IndicatorEngine();
    e.setInstances([inst('ofi', { length })]);
    e.sync(bs, M5, () => [], flowCtx({ book: () => frames, now }));
    return e.runs[0].out.map((a) => Array.from(a.subarray(0, bs.length)));
  };

  it('OFI i Δp świecy to sumy par migawek, których późniejsza migawka leży w świecy; przerwa w danych arkusza — brak', () => {
    const bs = flowBars(6);
    const now = 5 * M5 + 2 * 60_000;
    const frames = book(now, 0.5, 2, 1).filter((f) => f.t < 2 * M5 + 100_000 || f.t >= 2 * M5 + 100_000 + 15_000);
    const ofi = new Float64Array(6);
    const dp = new Float64Array(6);
    bookFlow(frames, bs, M5, now, ofi, dp);
    const mid = (f: BookFrame) => (f.px[0] + f.px[1]) / 2;
    const q = (f: BookFrame) => ({ bid: f.px[0], bidSz: f.sz[0], ask: f.px[1], askSz: f.sz[1] });
    for (const i of [1, 3, 4, 5]) {
      let x = 0;
      for (let j = 1; j < frames.length; j++) if (frames[j].t >= i * M5 && frames[j].t < (i + 1) * M5) x += ofiEvent(q(frames[j - 1]), q(frames[j]));
      const inside = frames.filter((f) => f.t >= i * M5 && f.t < (i + 1) * M5);
      const before = frames.filter((f) => f.t < i * M5).at(-1)!;
      expect(ofi[i]).toBeCloseTo(x, 9);
      expect(dp[i]).toBeCloseTo(mid(inside.at(-1)!) - mid(before), 9);
    }
    // Pierwsza świeca bez migawki przed nią, trzecia z przerwą 20 s między migawkami
    expect(Number.isNaN(ofi[0]) && Number.isNaN(ofi[2]) && Number.isNaN(dp[2])).toBe(true);
    // Bieżąca świeca: ostatnia migawka dalej od teraz niż przerwa graniczna — brak
    bookFlow(frames, bs, M5, now + OFI_MAX_GAP + S, ofi, dp);
    expect(Number.isNaN(ofi[5])).toBe(true);
  });

  it('bez szumu zmiana środka to β·OFI: R² = 1, a oczekiwana zmiana równa Δp świecy; R² i oczekiwana tylko z pełnym oknem', () => {
    const bs = flowBars(80);
    const now = 80 * M5;
    const [ofi, dp, r2, expected] = run(bs, book(now, 0.4, 0, 2), now);
    // Pierwsza świeca bez pary, potem 30 świec okna
    expect(r2.slice(0, 31).every(Number.isNaN)).toBe(true);
    for (let i = 31; i < 80; i++) {
      expect(r2[i]).toBeCloseTo(1, 9);
      expect(expected[i]).toBeCloseTo(dp[i], 6);
      expect(dp[i]).toBeCloseTo(0.4 * ofi[i], 6);
    }
  });

  it('R² i oczekiwana zmiana jak regresja MNK na OFI i Δp z ostatnich zamkniętych świec z wartością (bez bieżącej); oczekiwana od R² 0,1', () => {
    const bs = flowBars(90);
    const now = 89 * M5 + 150_000;
    const frames = book(now, 0.4, 25, 3, 78 * M5).filter((f) => f.t < 40 * M5 || f.t >= 40 * M5 + 20_000);
    const [ofi, dp, r2, expected] = run(bs, frames, now, 20);
    const xs: number[] = [];
    const ys: number[] = [];
    let some = false;
    for (let i = 0; i < 90; i++) {
      const f = xs.length >= 20 && !Number.isNaN(ofi[i]) ? olsFit(xs.slice(-20), ys.slice(-20)) : null;
      if (f) {
        some ||= f.r2 < OFI_MIN_R2;
        expect(r2[i]).toBeCloseTo(f.r2, 9);
        if (f.r2 >= OFI_MIN_R2) expect(expected[i]).toBeCloseTo(f.beta * ofi[i], 6);
        else expect(Number.isNaN(expected[i])).toBe(true);
      } else expect(Number.isNaN(r2[i]) && Number.isNaN(expected[i])).toBe(true);
      if (!Number.isNaN(ofi[i]) && i < 89) {
        xs.push(ofi[i]);
        ys.push(dp[i]);
      }
    }
    expect(Number.isNaN(ofi[40])).toBe(true);
    expect(Number.isNaN(r2[89])).toBe(false);
    // Gdy cena stoi, a OFI szumi, związek słabnie: w ostatnich oknach R² poniżej progu
    expect(some).toBe(true);
  });

  it('okno MNK kroczące: to samo co regresja z ostatnich n par', () => {
    const r = rng(8);
    const w = new OlsWindow(12);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let k = 0; k < 200; k++) {
      const x = (r() - 0.5) * 100;
      xs.push(x);
      ys.push(3 + 0.7 * x + (r() - 0.5) * 40);
      w.push(xs[k], ys[k]);
      if (k < 2) continue;
      const f = olsFit(xs.slice(-12), ys.slice(-12))!;
      const g = w.fit()!;
      expect(g.beta).toBeCloseTo(f.beta, 9);
      expect(g.alpha).toBeCloseTo(f.alpha, 9);
      expect(g.r2).toBeCloseTo(f.r2, 9);
    }
    const flat = new OlsWindow(3);
    for (const x of [1, 1, 1]) flat.push(x, x * 2);
    expect(flat.fit()).toBeNull();
  });

  it('nowe migawki bez zmiany świec: przeliczenie zwraca pierwszą zmienioną świecę', () => {
    const bs = flowBars(60);
    const now = 59 * M5 + 200_000;
    const all = book(now, 0.4, 25, 5);
    const e = new IndicatorEngine();
    e.setInstances([inst('ofi', { length: 10 })]);
    const sync = (frames: readonly BookFrame[]) => e.sync(bs, M5, () => [], flowCtx({ book: () => frames, now }));
    // Historia arkusza od 30. świecy, potem z serwera wcześniejsza (pierwsza świeca z migawkami nie ma jeszcze pary)
    expect(sync(all.filter((f) => f.t >= 30 * M5))).toBe(0);
    expect(sync(all.filter((f) => f.t >= 30 * M5))).toBe(60);
    expect(sync(all.filter((f) => f.t >= 20 * M5))).toBe(21);
    // Migawka bieżącej świecy (zmieniona wielkość bidu) zmienia tylko ją
    const live = all.filter((f) => f.t >= 20 * M5);
    const last = live[live.length - 1];
    const moved = [...live.slice(0, -1), frame(last.t, last.px[0], last.sz[0] + 2, last.px[1], last.sz[1])];
    expect(sync(moved)).toBe(59);
  });

  it('słupek OFI w kolorze znaku, Δp, R² i oczekiwana w legendzie; bez parametru „Interwał” i we własnej sekcji okna', () => {
    const def = indicatorDef('ofi');
    expect(def.plots.map((p) => [!!p.hist, !!p.hidden, p.title ?? '', p.format ?? def.format])).toEqual([
      [true, false, '', 'volume'],
      [true, true, 'Δp', 'volume'],
      [false, true, 'R²', 'fixed2'],
      [true, true, 'oczek.', 'volume'],
    ]);
    expect(def.group).toBe('hyperquant');
    expect(indicatorLabel(inst('ofi'))).toBe('OFI 30');
    expect(indicatorsLink([inst('ofi')])).toBe('ofi(30)');
    expect(indicatorsFromLink('ofi(50)@1h')[0].tf).toBeUndefined();
    expect(parseIndicators([{ id: 'ofi', tf: '1h' }])[0].tf).toBeUndefined();
  });
});

describe('wskaźniki: reżim zmienności (BOCPD)', () => {
  /** Zwroty z rozkładu normalnego (Box–Muller) o zadanych σ w kolejnych odcinkach. */
  function returns(seed: number, parts: { n: number; sd: number }[]): number[] {
    const r = rng(seed);
    const g = () => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
    return parts.flatMap((p) => Array.from({ length: p.n }, () => p.sd * g()));
  }
  const fromReturns = (xs: readonly number[]) => closeOnly(xs.reduce((cs, x) => [...cs, cs[cs.length - 1] * Math.exp(x)], [80_000]));

  it('silnik wskaźnika liczy to samo co BOCPD prognozy (Bocpd z utils), a podgląd nie zmienia stanu', () => {
    const xs = returns(5, [
      { n: 300, sd: 0.001 },
      { n: 60, sd: 0.004 },
      { n: 200, sd: 0.0015 },
    ]);
    const ref = new Bocpd({ hazard: 1 / 150, alpha0: 2, beta0: 1e-6, rMax: 120 });
    const d = new RegimeDetector(1 / 150, 2, 1e-6, 120, 5);
    for (const x of xs) {
      const before = d.state();
      const peek = d.peek(x);
      expect(d.state()).toEqual(before);
      ref.update(x);
      d.update(x);
      const s = ref.state();
      expect(d.state()).toEqual(peek);
      expect(d.state().pRecent).toBeCloseTo(s.pRecent5, 10);
      expect(d.state().sigma / s.sigma).toBeCloseTo(1, 10);
    }
    d.update(Number.NaN);
    expect(d.state()).toEqual(d.peek(Number.POSITIVE_INFINITY));
  });

  it('pierwsze 100 świec bez wartości (prior z pierwszych zwrotów), dalej BOCPD na log-zwrotach zamknięcia', () => {
    const xs = returns(6, [{ n: 400, sd: 0.002 }]);
    const cs = fromReturns(xs);
    const [p, sigma] = run(inst('regime', { length: 100, recent: 5 }), cs);
    expect(p.slice(0, REGIME_PRIOR).every(Number.isNaN)).toBe(true);
    const lr = cs.slice(1).map((c, i) => Math.log(c.c / cs[i].c));
    const ref = new Bocpd({ hazard: 1 / 100, alpha0: 2, beta0: regimePrior(lr.slice(0, REGIME_PRIOR)), rMax: 600 });
    lr.forEach((x, i) => {
      ref.update(x);
      if (i + 1 < REGIME_PRIOR) return;
      const s = ref.state();
      expect(p[i + 1]).toBeCloseTo(s.pRecent5, 9);
      expect(sigma[i + 1] / (100 * s.sigma)).toBeCloseTo(1, 9);
    });
  });

  it('skok zmienności ×4: nowy reżim ponad 0,5 po kilku świecach i do końca okna zmiany; przy stałym reżimie rzadko', () => {
    const xs = returns(7, [
      { n: 500, sd: 0.001 },
      { n: 60, sd: 0.004 },
    ]);
    const [p, sigma] = run(inst('regime'), fromReturns(xs));
    // Świeca i ma zwrot i − 1: skok od świecy 501
    const hit = p.findIndex((v, i) => i > 500 && v > 0.5);
    expect(hit - 501).toBeGreaterThanOrEqual(0);
    expect(hit - 501).toBeLessThan(8);
    expect(p.slice(hit, 515).every((v) => v > 0.5)).toBe(true);
    expect(p[530]).toBeLessThan(0.5);
    expect(p.slice(150, 500).filter((v) => v > 0.5).length / 350).toBeLessThan(0.02);
    // σ reżimu (%, na świecę) blisko nowego poziomu na końcu, starego przed skokiem
    expect(sigma[499]).toBeGreaterThan(0.07);
    expect(sigma[499]).toBeLessThan(0.14);
    expect(sigma[560]).toBeGreaterThan(0.25);
  });

  it('linia od 0 do 1 z poziomem 0,5, σ w legendzie; ta sama sekcja co wskaźniki z danych Hyperliquid', () => {
    const def = indicatorDef('regime');
    expect(def.range).toEqual([0, 1]);
    expect(def.levels).toEqual([0.5]);
    expect(def.plots).toEqual([{}, { hidden: true, title: 'σ%', format: 'fixed3' }]);
    expect(def.group).toBe('hyperquant');
    expect(indicatorLabel(inst('regime'))).toBe('Reżim 200 20');
    expect(indicatorsLink([inst('regime', { length: 288 })])).toBe('regime(288,20)');
  });
});

describe('wskaźniki: wielkość zleceń agresora', () => {
  type Order = { time: number; notional: number };
  /** Zlecenia co ~3 s, kwoty log-normalne wokół `med(i)` USD w świecy i. */
  function ordersOf(n: number, seed: number, med: (i: number) => number): Order[] {
    const r = rng(seed);
    const g = () => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
    const out: Order[] = [];
    for (let t = 500; t < n * M5; t += 1000 + Math.floor(4000 * r())) out.push({ time: t, notional: med(Math.floor(t / M5)) * Math.exp(1.2 * g()) });
    return out;
  }
  const ctxOf = (list: readonly Order[], now: number) => {
    const inRange = (a: number, b: number) => list.filter((o) => o.time >= a && o.time < b);
    return flowCtx({ orders: inRange, orderCount: (a, b) => inRange(a, b).length, now });
  };
  const tapeOf = (n: number, gap = -1) => walk(n, 3).map((candle, i) => ({ candle, fp: { delta: 0 }, complete: i !== gap }));

  it('kwantyle z interpolacją liniową (jak domyślne w R i numpy)', () => {
    expect(quantileSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantileSorted([10, 20, 30, 40, 50], 0.9)).toBeCloseTo(46, 12);
    expect(quantileSorted([7], 0.99)).toBe(7);
    expect(Number.isNaN(quantileSorted([], 0.5))).toBe(true);
  });

  it('percentyle świecy z jej zleceń, baza p90 z poprzednich świec (w przedziale ok. 12%), KS dodatni przy większych zleceniach', () => {
    const n = 60;
    // Od świecy 50 zlecenia dziesięć razy większe
    const list = ordersOf(n, 1, (i) => (i >= 50 ? 20_000 : 2_000));
    const bars = tapeOf(n, 30);
    const e = new IndicatorEngine();
    e.setInstances([inst('ordersize', { length: 20 })]);
    const now = n * M5 - 1000;
    e.sync(bars, M5, () => [], ctxOf(list, now));
    const [p50, p90, p99, base, ks] = e.runs[0].out.map((a) => Array.from(a.subarray(0, n)));
    const usd = (a: number, b: number) => list.filter((o) => o.time >= a && o.time < b).map((o) => o.notional).sort((x, y) => x - y);
    for (const i of [3, 40, 55]) {
      const xs = usd(i * M5, (i + 1) * M5);
      expect(p50[i]).toBeCloseTo(quantileSorted(xs, 0.5), 9);
      expect(p90[i]).toBeCloseTo(quantileSorted(xs, 0.9), 9);
      expect(p99[i]).toBeCloseTo(quantileSorted(xs, 0.99), 9);
    }
    // Świeca bez pełnego nagrania: bez wartości i poza bazą (baza świecy 45: świece 25–44 bez 30, czyli 24–44)
    expect([p50[30], base[30], ks[30]].every(Number.isNaN)).toBe(true);
    const pooled = [...usd(24 * M5, 30 * M5), ...usd(31 * M5, 45 * M5)].sort((a, b) => a - b);
    expect(base[45] / quantileSorted(pooled, 0.9)).toBeGreaterThan(1 / 1.13);
    expect(base[45] / quantileSorted(pooled, 0.9)).toBeLessThan(1.13);
    // Baza dopiero z 20 świec
    expect(base.slice(0, 20).every(Number.isNaN)).toBe(true);
    expect(Number.isNaN(base[20])).toBe(false);
    expect(Math.abs(ks[40])).toBeLessThan(0.25);
    expect(ks[50]).toBeGreaterThan(0.5);
    // Po kilkunastu świecach większe zlecenia są już w bazie
    expect(Math.abs(ks[59])).toBeLessThan(ks[50]);
  });

  it('świeca liczona od nowa tylko po zmianie: inna świeca albo inna liczba zleceń', () => {
    const n = 40;
    const list = ordersOf(n, 2, () => 3_000);
    const bars = tapeOf(n);
    const e = new IndicatorEngine();
    e.setInstances([inst('ordersize', { length: 10 })]);
    const now = n * M5 - 1000;
    const ctx = ctxOf(list, now);
    const spy = vi.spyOn(ctx, 'orders');
    expect(e.sync(bars, M5, () => [], ctx)).toBe(0);
    expect(spy).toHaveBeenCalledTimes(n);
    expect(e.sync(bars, M5, () => [], ctx)).toBe(n);
    expect(spy).toHaveBeenCalledTimes(n);
    // Nowe zlecenie w bieżącej świecy (po zamknięciu poprzednich wypełnień): tylko ona
    const more = [...list, { time: now - 500, notional: 1e6 }];
    const ctx2 = ctxOf(more, now);
    const spy2 = vi.spyOn(ctx2, 'orders');
    expect(e.sync(bars, M5, () => [], ctx2)).toBe(n - 1);
    expect(spy2).toHaveBeenCalledTimes(1);
  });

  it('skala logarytmiczna, kwoty USD, KS w legendzie w kolorze kierunku; bez parametru „Interwał”', () => {
    const def = indicatorDef('ordersize');
    expect(def.log).toBe(true);
    expect(def.format).toBe('usd');
    expect(def.plots.map((p) => p.title)).toEqual(['p50', 'p90', 'p99', 'baza p90', 'KS']);
    expect(def.plots[4]).toMatchObject({ hist: true, hidden: true, format: 'fixed2' });
    expect(def.group).toBe('hyperquant');
    expect(indicatorLabel(inst('ordersize'))).toBe('Zlecenia 100');
    expect(indicatorsFromLink('ordersize(50)@1h')[0].tf).toBeUndefined();
  });
});

describe('przeliczanie przyrostowe', () => {
  const all = INDICATORS.map((d) => inst(d.id, { length: 5 }));

  /** Wynik silnika na żywo równy przeliczeniu całości tych samych świec (co do bitu). */
  function sameAsFresh(e: IndicatorEngine, cs: readonly Candle[]): void {
    const fresh = new IndicatorEngine();
    fresh.setInstances(all);
    fresh.sync(bars(cs));
    e.runs.forEach((r, k) => r.out.forEach((a, p) => expect(Array.from(a.subarray(0, cs.length))).toEqual(Array.from(fresh.runs[k].out[p].subarray(0, cs.length)))));
  }

  it('transakcje na bieżącej świecy i nowe świece: to samo co przeliczenie od zera', () => {
    const r = rng(3);
    const src = walk(300, 11);
    const e = new IndicatorEngine();
    e.setInstances(all);
    // Indeks zmian wskaźników liczonych świeca po świecy (kanał regresji przelicza całe okno, a absorpcja porównuje
    // obiekty świec, które `bars` tworzy za każdym razem od nowa)
    const stepFrom = (cs: readonly Candle[]) => {
      e.sync(bars(cs));
      return Math.min(...e.runs.filter((_, k) => !indicatorDef(all[k].id).fit && !indicatorDef(all[k].id).sample).map((run) => run.from));
    };
    let cs = src.slice(0, 50);
    expect(stepFrom(cs)).toBe(0);
    for (let i = 50; i < src.length; i++) {
      // Kilka zmian bieżącej świecy (nowy obiekt, jak z API), potem nowa świeca
      for (let k = 0; k < 3; k++) {
        const last = cs[cs.length - 1];
        const c = last.c + (r() - 0.5) * 40;
        cs = [...cs.slice(0, -1), { ...last, c, h: Math.max(last.h, c), l: Math.min(last.l, c) }];
        expect(stepFrom(cs)).toBe(cs.length - 1);
      }
      cs = [...cs, src[i]];
      expect(stepFrom(cs)).toBe(cs.length - 2);
    }
    sameAsFresh(e, cs);
    expect(e.sync(bars(cs))).toBe(cs.length);
  });

  it('zmiana starszej świecy, doczytana historia z lewej i mniej świec: przeliczenie od zera', () => {
    const src = walk(200, 5);
    const e = new IndicatorEngine();
    e.setInstances(all);
    e.sync(bars(src.slice(100)));
    const older = [...src.slice(100)];
    older[10] = { ...older[10], c: older[10].c + 300 };
    expect(e.sync(bars(older))).toBe(0);
    sameAsFresh(e, older);
    expect(e.sync(bars(src))).toBe(0);
    sameAsFresh(e, src);
    expect(e.sync(bars(src.slice(0, 120)))).toBe(0);
    sameAsFresh(e, src.slice(0, 120));
  });
});

describe('lista wskaźników', () => {
  it('dodawanie: kolejne identyfikatory, wolne kolory, parametry domyślne TradingView, limit', () => {
    let list = addIndicator([], 'ema');
    list = addIndicator(list, 'ema');
    list = addIndicator(list, 'bb');
    expect(list.map((x) => x.iid)).toEqual(['ema1', 'ema2', 'bb1']);
    expect(new Set(list.map((x) => x.color)).size).toBe(3);
    expect(list.map(indicatorLabel)).toEqual(['EMA 9', 'EMA 9', 'BB 20 2']);
    expect(indicatorLabel(addIndicator([], 'rsi')[0])).toBe('RSI 14');
    expect(indicatorLabel(addIndicator([], 'atr')[0])).toBe('ATR 14');
    for (let i = 0; i < 20; i++) list = addIndicator(list, 'rsi');
    expect(list).toHaveLength(MAX_INDICATORS);
    expect(INDICATOR_COLORS).toContain(list[MAX_INDICATORS - 1].color);
  });

  it('odczyt zapisu: nieznany wskaźnik pominięty, błędny parametr domyślny, powtórzony identyfikator nowy', () => {
    const list = parseIndicators([
      { iid: 'ema1', id: 'ema', params: { length: 21 }, color: '#112233', visible: false },
      { iid: 'ema1', id: 'ema', params: { length: 2.5 }, color: 'czerwony' },
      { iid: 'x', id: 'zigzag', params: {} },
      { iid: 'bb1', id: 'bb', params: { length: 0, mult: 2.2 } },
      'śmieci',
    ]);
    expect(list.map((x) => [x.iid, x.id, x.params, x.visible])).toEqual([
      ['ema1', 'ema', { length: 21 }, false],
      ['ema2', 'ema', { length: 9 }, true],
      ['bb1', 'bb', { length: 20, mult: 2.2 }, true],
    ]);
    expect(list[0].color).toBe('#112233');
    expect(list[1].color).toMatch(/^#[0-9a-f]{6}$/);
    expect(parseIndicators('x')).toEqual([]);
    expect(parseIndicators(new Array(30).fill({ id: 'ema' }))).toHaveLength(MAX_INDICATORS);
  });

  it('styl: zapis bez stylu dostaje domyślny (wstęgi cieńsze), błędny styl domyślny', () => {
    const [ema, bb, bad] = parseIndicators([
      { id: 'ema' },
      { id: 'bb' },
      { id: 'rsi', alpha: 1.5, width: 7, labels: 'tak' },
    ]);
    expect([ema.alpha, ema.width, ema.labels]).toEqual([1, 2, true]);
    expect(bb.width).toBe(1);
    expect([bad.alpha, bad.width, bad.labels]).toEqual([1, 2, true]);
    const [kept] = parseIndicators([{ id: 'atr', alpha: 0.4, width: 3, labels: false }]);
    expect([kept.alpha, kept.width, kept.labels]).toEqual([0.4, 3, false]);
    expect(parseIndicators(addIndicator(addIndicator([], 'ema'), 'bb'))).toEqual(addIndicator(addIndicator([], 'ema'), 'bb'));
  });

  it('kopia: te same parametry i styl, nowy identyfikator i wolny kolor', () => {
    const list = parseIndicators([{ iid: 'ema1', id: 'ema', params: { length: 21 }, color: '#3987e5', width: 3, visible: false }]);
    const out = copyIndicator(list, 'ema1');
    expect(out[1]).toMatchObject({ iid: 'ema2', id: 'ema', params: { length: 21 }, width: 3, visible: true });
    expect(out[1].color).not.toBe(out[0].color);
    expect(copyIndicator(list, 'brak')).toEqual(list);
  });

  it('link: widoczne wskaźniki z parametrami w kolejności rejestru, odczyt z walidacją', () => {
    const list = parseIndicators([
      { id: 'ema', params: { length: 21 } },
      { id: 'rsi', params: { length: 14 }, visible: false },
      { id: 'bb', params: { length: 20, mult: 2.5 } },
    ]);
    expect(indicatorsLink(list)).toBe('ema(21);bb(20,2.5)');
    const back = indicatorsFromLink('ema(21);bb(20,2.5)');
    expect(back.map((x) => [x.id, x.params])).toEqual([
      ['ema', { length: 21 }],
      ['bb', { length: 20, mult: 2.5 }],
    ]);
    expect(indicatorsLink(back)).toBe('ema(21);bb(20,2.5)');
    expect(new Set(back.map((x) => x.color)).size).toBe(2);
    // Nieznany wskaźnik i śmieci pominięte, parametr spoza zakresu i brakujący — domyślny
    expect(indicatorsLink(indicatorsFromLink('zigzag(9,26);ema(0);bb(30);x;rsi()'))).toBe('ema(9);bb(30,2);rsi(14)');
    expect(indicatorsFromLink('')).toEqual([]);
  });

  it('pamięć średnich rekurencyjnych: po ilu świecach starsza historia waży mniej niż 0,1%', () => {
    const ema = indicatorDef('ema');
    const rsi = indicatorDef('rsi');
    // (1 − α)^N < 0,001 i (1 − α)^(N−1) ≥ 0,001
    for (const [def, n] of [
      [ema, 9],
      [ema, 200],
      [rsi, 14],
    ] as const) {
      const [a] = def.decay!({ length: n });
      const m = memoryCandles(def, { length: n })!;
      expect((1 - a) ** m).toBeLessThan(0.001);
      expect((1 - a) ** (m - 1)).toBeGreaterThanOrEqual(0.001);
    }
    expect(memoryCandles(rsi, { length: 14 })).toBe(94);
    expect(memoryCandles(ema, { length: 1 })).toBeNull();
    expect(memoryCandles(indicatorDef('bb'), { length: 20, mult: 2 })).toBeNull();
  });

  it('pamięć kilku średnich po sobie (MACD, DMI): waga historii starszej niż granica poniżej 0,1% (splot wag)', () => {
    for (const [id, p] of [
      ['macd', { fast: 12, slow: 26, signal: 9 }],
      ['dmi', { length: 14, adx: 14 }],
    ] as const) {
      const def = indicatorDef(id);
      const m = memoryCandles(def, p)!;
      // Wagi kolejnych średnich: a·(1 − a)^k; splot daje wagi świec wstecz w wyniku końcowym
      let w = new Float64Array(m + 1);
      w[0] = 1;
      for (const a of def.decay!(p)) {
        const next = new Float64Array(m + 1);
        for (let i = 0; i <= m; i++) for (let k = 0; k <= i; k++) next[i] += w[i - k] * a * (1 - a) ** k;
        w = next;
      }
      const inside = w.slice(0, m).reduce((x, y) => x + y, 0);
      expect(1 - inside).toBeLessThan(0.001);
    }
  });
  it('pamięć Stoch RSI: granica RSI przesunięta o okno stochastyka i obie średnie proste', () => {
    const p = { k: 3, d: 3, rsi: 14, stoch: 14 };
    expect(memoryCandles(indicatorDef('stochrsi'), p)).toBe(memoryCandles(indicatorDef('rsi'), { length: 14 })! + 14 + 3 + 3 - 3);
  });
});
