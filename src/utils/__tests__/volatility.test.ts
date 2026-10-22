import { describe, expect, it } from 'vitest';
import {
  RangeBar,
  SeasonalProfile,
  bipowerVariation,
  buildVolModel,
  fhsResiduals,
  fitSeasonalHar,
  forecastHourlyVariances,
  garmanKlassVar,
  horizonStepSigmas,
  isValidBar,
  jumpShareByDay,
  leeMyklandJumps,
  logReturns,
  parkinsonVar,
  qlike,
  realizedVariance,
  rogersSatchellVar,
  seasonalProfile,
  stepSigmas,
  yangZhangVar,
} from '../volatility';

// Deterministyczny RNG testów (Mulberry32) + Box–Muller
function rng(seed: number) {
  let s = seed | 0;
  const u = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = () => Math.sqrt(-2 * Math.log(u() + 1e-300)) * Math.cos(2 * Math.PI * u());
  return { u, n };
}

/** Świece z GBM bez dryfu: `sub` podkroków o odchyleniu `sig` na świecę, otwarcie = poprzednie zamknięcie. */
function gbmBars(count: number, sub: number, sig: number, seed: number, barMs = 300_000, t0 = 0): RangeBar[] {
  const { n } = rng(seed);
  const out: RangeBar[] = [];
  let p = 100;
  for (let i = 0; i < count; i++) {
    const open = p;
    let hi = p;
    let lo = p;
    for (let k = 0; k < sub; k++) {
      p *= Math.exp(sig * n());
      if (p > hi) hi = p;
      if (p < lo) lo = p;
    }
    out.push({ time: t0 + i * barMs, open, high: hi, low: lo, close: p });
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('estymatory zakresowe na jednej świecy', () => {
  const bar: RangeBar = { time: 0, open: 100, high: 110, low: 95, close: 105 };

  it('Parkinson = ln(H/L)²/(4 ln 2)', () => {
    expect(parkinsonVar(bar)).toBeCloseTo(Math.log(110 / 95) ** 2 / (4 * Math.LN2), 12);
  });

  it('Garman–Klass = ½ln(H/L)² − (2ln2−1)ln(C/O)²', () => {
    expect(garmanKlassVar(bar)).toBeCloseTo(0.5 * Math.log(110 / 95) ** 2 - (2 * Math.LN2 - 1) * Math.log(1.05) ** 2, 12);
  });

  it('Rogers–Satchell = ln(H/C)ln(H/O) + ln(L/C)ln(L/O)', () => {
    const v = Math.log(110 / 105) * Math.log(110 / 100) + Math.log(95 / 105) * Math.log(95 / 100);
    expect(rogersSatchellVar(bar)).toBeCloseTo(v, 12);
  });

  it('świeca bez zakresu (H = L) daje 0, nie NaN', () => {
    const flat: RangeBar = { time: 0, open: 100, high: 100, low: 100, close: 100 };
    expect(parkinsonVar(flat)).toBe(0);
    expect(garmanKlassVar(flat)).toBe(0);
    expect(rogersSatchellVar(flat)).toBe(0);
  });
});

describe('isValidBar', () => {
  it('odrzuca H < L, cenę 0, NaN i zamknięcie poza zakresem', () => {
    expect(isValidBar({ time: 0, open: 100, high: 99, low: 101, close: 100 })).toBe(false);
    expect(isValidBar({ time: 0, open: 0, high: 101, low: 99, close: 100 })).toBe(false);
    expect(isValidBar({ time: 0, open: 100, high: Number.NaN, low: 99, close: 100 })).toBe(false);
    expect(isValidBar({ time: 0, open: 100, high: 101, low: 99, close: 102 })).toBe(false);
    expect(isValidBar({ time: 0, open: 100, high: 101, low: 99, close: 100.5 })).toBe(true);
  });
});

describe('estymatory na symulowanym GBM', () => {
  // 1000 podkroków: obciążenie dyskretnego maksimum ~2% (przy 20 podkrokach ~30% — test badałby symulację, nie kod)
  const sig = 0.0002;
  const bars = gbmBars(1000, 1000, sig, 42);
  const truth = 1000 * sig * sig;

  it('Garman–Klass (średnia) w ±10% od wariancji świecy', () => {
    const gk = mean(bars.map(garmanKlassVar));
    expect(gk / truth).toBeGreaterThan(0.9);
    expect(gk / truth).toBeLessThan(1.1);
  });

  it('Yang–Zhang w ±10% od wariancji świecy', () => {
    const yz = yangZhangVar(bars);
    expect(yz / truth).toBeGreaterThan(0.9);
    expect(yz / truth).toBeLessThan(1.1);
  });

  it('Yang–Zhang dla < 2 świec to NaN', () => {
    expect(Number.isNaN(yangZhangVar(bars.slice(0, 1)))).toBe(true);
  });
});

describe('RV, wariancja dwupotęgowa i skoki', () => {
  const { n } = rng(11);
  const r = Array.from({ length: 5000 }, () => 0.001 * n());

  it('logReturns liczy ln(C_i/C_{i−1})', () => {
    expect(logReturns([100, 110, 99])).toEqual([Math.log(1.1), Math.log(99 / 110)]);
  });

  it('bez skoków BV ≈ RV (stosunek w [0.95, 1.05])', () => {
    const ratio = bipowerVariation(r) / realizedVariance(r);
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.05);
  });

  it('udział skoków z dni UTC ≈ J²/RV (±25%) po wstrzyknięciu skoku 0.03', () => {
    const day = 86_400_000;
    const barMs = 300_000;
    const per = day / barMs; // 288 świec dziennie
    const { n: n2 } = rng(5);
    const rets = Array.from({ length: per * 10 }, () => 0.001 * n2());
    rets[per * 4 + 100] += 0.03;
    let p = 100;
    const bars: RangeBar[] = rets.map((x, i) => {
      const open = p;
      p *= Math.exp(x);
      return { time: i * barMs, open, high: Math.max(open, p), low: Math.min(open, p), close: p };
    });
    const js = jumpShareByDay(bars, barMs);
    expect(js).not.toBeNull();
    expect(js!.days).toBe(10);
    const rv = rets.reduce((a, x) => a + x * x, 0);
    const expected = 0.03 ** 2 / rv;
    expect(js!.share / expected).toBeGreaterThan(0.75);
    expect(js!.share / expected).toBeLessThan(1.25);
  });

  it('udział skoków pomija niepełne dni; brak pełnych dni → null', () => {
    const bars: RangeBar[] = Array.from({ length: 100 }, (_, i) => ({ time: i * 300_000, open: 100, high: 101, low: 99, close: 100 }));
    expect(jumpShareByDay(bars, 300_000)).toBeNull();
  });

  it('Lee–Mykland wykrywa wstrzyknięty skok', () => {
    const withJump = [...r];
    withJump[2500] += 0.03;
    expect(leeMyklandJumps(withJump)).toContain(2500);
  });

  it('Lee–Mykland na czystym szumie: ≤ 2 fałszywe alarmy', () => {
    const { n: n7 } = rng(7);
    const noise = Array.from({ length: 5000 }, () => 0.001 * n7());
    expect(leeMyklandJumps(noise).length).toBeLessThanOrEqual(2);
  });
});

const HOUR = 3_600_000;
const FLAT: SeasonalProfile = { factors: Array(24).fill(1), counts: Array(24).fill(0) };

/** Świeca, której Garman–Klass równa się dokładnie `v` (O = C, ln(H/L) = √(2v)). */
function barWithGk(time: number, v: number): RangeBar {
  const u = Math.sqrt(2 * v);
  return { time, open: 100, high: 100 * Math.exp(u / 2), low: 100 * Math.exp(-u / 2), close: 100 };
}

/** Log-HAR: y_{t+1} = b0 + b1·y_t + b2·D_t + b3·W_t + s·ε (D = średnia 24, W = średnia 168). */
function simulateLogHar(n: number, coef: [number, number, number, number], s: number, seed: number): number[] {
  const { n: z } = rng(seed);
  const [b0, b1, b2, b3] = coef;
  const yStar = b0 / (1 - b1 - b2 - b3);
  const y: number[] = Array(168).fill(yStar);
  while (y.length < n + 168) {
    const t = y.length - 1;
    const D = y.slice(t - 23, t + 1).reduce((a, x) => a + x, 0) / 24;
    const W = y.slice(t - 167, t + 1).reduce((a, x) => a + x, 0) / 168;
    y.push(b0 + b1 * y[t] + b2 * D + b3 * W + s * z());
  }
  return y.slice(168);
}

describe('profil sezonowy godzin UTC', () => {
  it('godzina z 3× wariancją ma współczynnik ~3× większy; średnia współczynników = 1', () => {
    const { n } = rng(3);
    const bars: RangeBar[] = [];
    let p = 100;
    for (let i = 0; i < 24 * 200; i++) {
      const t = i * HOUR;
      const sig = new Date(t).getUTCHours() === 14 ? 0.001 * Math.sqrt(3) : 0.001;
      const open = p;
      let hi = p;
      let lo = p;
      for (let k = 0; k < 200; k++) {
        p *= Math.exp(sig * n());
        hi = Math.max(hi, p);
        lo = Math.min(lo, p);
      }
      bars.push({ time: t, open, high: hi, low: lo, close: p });
    }
    const prof = seasonalProfile(bars);
    expect(prof.factors).toHaveLength(24);
    expect(mean(prof.factors)).toBeCloseTo(1, 9);
    const ratio = prof.factors[14] / prof.factors[3];
    expect(ratio).toBeGreaterThan(2.5);
    expect(ratio).toBeLessThan(3.5);
    expect(prof.counts[14]).toBe(200);
  });
});

describe('sezonowy log-HAR', () => {
  const coef: [number, number, number, number] = [-1.15, 0.4, 0.3, 0.2];
  const y = simulateLogHar(5000, coef, 0.3, 21);
  const bars = y.map((yt, i) => barWithGk(i * HOUR, Math.exp(yt)));
  const m = fitSeasonalHar(bars, FLAT);

  it('odzyskuje współczynniki symulowanego procesu (±0.08)', () => {
    expect(m).not.toBeNull();
    expect(Math.abs(m!.coef[1] - 0.4)).toBeLessThan(0.08);
    expect(Math.abs(m!.coef[2] - 0.3)).toBeLessThan(0.08);
    expect(Math.abs(m!.coef[3] - 0.2)).toBeLessThan(0.08);
    expect(m!.lastY).toHaveLength(168);
    expect(m!.smear).toBeGreaterThan(1);
  });

  it('poza próbą HAR ma niższy QLIKE niż naiwna średnia 24 h', () => {
    expect(m!.oos).not.toBeNull();
    expect(m!.oos!.qlikeHar).toBeLessThan(m!.oos!.qlikeNaive);
    expect(m!.oos!.n).toBeGreaterThan(1000);
  });

  it('prognoza iterowana zbiega do poziomu bezwarunkowego exp(b0/(1−Σb))·smear', () => {
    const [b0, b1, b2, b3] = m!.coef;
    const f = forecastHourlyVariances(m!, FLAT, 0, 2000);
    const level = Math.exp(b0 / (1 - b1 - b2 - b3)) * m!.smear;
    expect(f[1999] / level).toBeGreaterThan(0.95);
    expect(f[1999] / level).toBeLessThan(1.05);
  });

  it('za mało godzin (< 500 wierszy regresji) → null', () => {
    expect(fitSeasonalHar(bars.slice(0, 600), FLAT)).toBeNull();
  });

  it('świece bez zakresu (H = L) nie psują współczynników', () => {
    const withFlat = bars.map((b, i) => (i % 97 === 0 ? { ...b, high: 100, low: 100 } : b));
    const mf = fitSeasonalHar(withFlat, FLAT);
    expect(mf).not.toBeNull();
    expect(mf!.coef.every(Number.isFinite)).toBe(true);
  });
});

describe('QLIKE i σ kroków', () => {
  it('QLIKE = 0 przy trafnej prognozie i > 0 przy chybionej', () => {
    expect(qlike(2, 2)).toBe(0);
    expect(qlike(1, 2)).toBeGreaterThan(0);
  });

  it('horyzont od :30 bierze po pół wariancji z dwóch godzin', () => {
    const s = stepSigmas([1e-4, 4e-4], 0, 30 * 60_000, 60, 5);
    expect(s).toHaveLength(12);
    const total = s.reduce((a, x) => a + x * x, 0);
    expect(total).toBeCloseTo(0.5e-4 + 2e-4, 12);
  });
});

describe('innowacje FHS', () => {
  it('średnia 0, wariancja 1, a zmiana reżimu zmienności znika po standaryzacji', () => {
    const { n } = rng(9);
    const bars: RangeBar[] = [];
    let p = 100;
    for (let i = 0; i < 4000; i++) {
      const sig = i < 2000 ? 0.0005 : 0.001;
      const open = p;
      let hi = p;
      let lo = p;
      for (let k = 0; k < 50; k++) {
        p *= Math.exp(sig * n());
        hi = Math.max(hi, p);
        lo = Math.min(lo, p);
      }
      bars.push({ time: i * 300_000, open, high: hi, low: lo, close: p });
    }
    const z = Array.from(fhsResiduals(bars, FLAT));
    const m = mean(z);
    const v = mean(z.map((x) => (x - m) ** 2));
    expect(Math.abs(m)).toBeLessThan(0.02);
    expect(v).toBeGreaterThan(0.98);
    expect(v).toBeLessThan(1.02);
    // Pierwsza i druga połowa (σ różne 2×) mają po standaryzacji podobną wariancję
    const half = Math.floor(z.length / 2);
    const v1 = mean(z.slice(0, half - 400).map((x) => x * x));
    const v2 = mean(z.slice(half + 400).map((x) => x * x));
    expect(v1 / v2).toBeGreaterThan(0.8);
    expect(v1 / v2).toBeLessThan(1.25);
  });
});

describe('buildVolModel', () => {
  const now = 1_800_000_000_000;
  const hourStart = Math.floor(now / HOUR) * HOUR;
  const y = simulateLogHar(1300, [-1.15, 0.4, 0.3, 0.2], 0.3, 4);
  // Ostatnia świeca 1h zaczyna się w bieżącej godzinie → w toku, do odrzucenia
  const hourly = y.map((yt, i) => barWithGk(hourStart - (y.length - 1 - i) * HOUR, Math.exp(yt)));
  const fiveMin = gbmBars(2000, 20, 0.0005, 8, 300_000, hourStart - 1999 * 300_000);

  it('odrzuca świece w toku i buduje model', () => {
    const m = buildVolModel(hourly, fiveMin, now);
    expect(m).not.toBeNull();
    expect(m!.hourlyBars).toBe(hourly.length - 1);
    expect(m!.fiveMinBars).toBe(fiveMin.length - 1);
    expect(m!.nextHourStartMs).toBe(hourStart);
    expect(m!.residuals.length).toBeGreaterThan(1000);
  });

  it('za mało danych → null', () => {
    expect(buildVolModel(hourly.slice(-900), fiveMin, now)).toBeNull();
    expect(buildVolModel(hourly, fiveMin.slice(-1200), now)).toBeNull();
  });

  it('σ kroków horyzontu: 24 kroki po 5 min na 2 h, skończone i dodatnie', () => {
    const m = buildVolModel(hourly, fiveMin, now)!;
    const s = horizonStepSigmas(m, now, 120);
    expect(s).toHaveLength(24);
    expect(s.every((x) => Number.isFinite(x) && x > 0)).toBe(true);
  });
});
