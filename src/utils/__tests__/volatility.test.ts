import { describe, expect, it } from 'vitest';
import {
  RangeBar,
  bipowerVariation,
  garmanKlassVar,
  isValidBar,
  jumpShareByDay,
  leeMyklandJumps,
  logReturns,
  parkinsonVar,
  realizedVariance,
  rogersSatchellVar,
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
