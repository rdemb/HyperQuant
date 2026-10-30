import { describe, expect, it } from 'vitest';
import type { Candle } from '../hl/parse';
import { Window, ema, rma } from '../indicators/primitives';
import { IndicatorEngine } from '../indicators/engine';
import {
  INDICATORS,
  INDICATOR_COLORS,
  IndicatorId,
  IndicatorInstance,
  MAX_INDICATORS,
  addIndicator,
  copyIndicator,
  indicatorDef,
  indicatorLabel,
  indicatorsFromLink,
  indicatorsLink,
  memoryCandles,
  parseIndicators,
  parseParams,
} from '../indicators/registry';

const M5 = 300_000;

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
    let cs = src.slice(0, 50);
    expect(e.sync(bars(cs))).toBe(0);
    for (let i = 50; i < src.length; i++) {
      // Kilka zmian bieżącej świecy (nowy obiekt, jak z API), potem nowa świeca
      for (let k = 0; k < 3; k++) {
        const last = cs[cs.length - 1];
        const c = last.c + (r() - 0.5) * 40;
        cs = [...cs.slice(0, -1), { ...last, c, h: Math.max(last.h, c), l: Math.min(last.l, c) }];
        expect(e.sync(bars(cs))).toBe(cs.length - 1);
      }
      cs = [...cs, src[i]];
      expect(e.sync(bars(cs))).toBe(cs.length - 2);
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
      { iid: 'x', id: 'supertrend', params: {} },
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
    expect(indicatorsLink(indicatorsFromLink('supertrend(10,3);ema(0);bb(30);x;rsi()'))).toBe('ema(9);bb(30,2);rsi(14)');
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
      const a = def.decay!({ length: n });
      const m = memoryCandles(def, { length: n })!;
      expect((1 - a) ** m).toBeLessThan(0.001);
      expect((1 - a) ** (m - 1)).toBeGreaterThanOrEqual(0.001);
    }
    expect(memoryCandles(rsi, { length: 14 })).toBe(94);
    expect(memoryCandles(ema, { length: 1 })).toBeNull();
    expect(memoryCandles(indicatorDef('bb'), { length: 20, mult: 2 })).toBeNull();
  });
});
