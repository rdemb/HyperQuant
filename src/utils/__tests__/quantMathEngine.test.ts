import { describe, expect, it } from 'vitest';
import {
  computeOrderFlowImbalanceHeatmap,
  computeQuantMetrics,
  computeVpinBvc,
  hurstAnisLloyd,
  HURST_TREND_THRESHOLD,
  kyleEstimate,
  kyleLambdaOls,
  regimeEstimate,
  t975,
  vpinEstimate,
} from '../quantMathEngine';
import { buildHyperliquidBar, parseL2Levels, recalculateIndicatorSeries } from '../marketDataFeed';
import { OHLCVBar, ShaakuniState } from '../../types/trading';

function makeRng(seed: number) {
  let s = seed;
  const u = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
  return { u, n };
}

function randomWalkBars(count: number, seed: number, start = 100000): OHLCVBar[] {
  const rng = makeRng(seed);
  const sig = 0.45 * Math.sqrt(300 / (365 * 24 * 3600));
  const bars: OHLCVBar[] = [];
  let p = start;
  for (let i = 0; i < count; i++) {
    const path = [p];
    for (let k = 0; k < 10; k++) path.push(path[path.length - 1] * Math.exp((sig / Math.sqrt(10)) * rng.n()));
    const c = path[path.length - 1];
    bars.push(buildHyperliquidBar(p, Math.max(...path), Math.min(...path), c, 30, 300, i * 300000, sig * start));
    p = c;
  }
  return recalculateIndicatorSeries(bars);
}

const shaakuniStub = (over: Partial<ShaakuniState> = {}): ShaakuniState => ({
  pwh: null,
  pwl: null,
  weq: null,
  pwh2: null,
  pwl2: null,
  pdh: null,
  pdl: null,
  deq: null,
  pdhStatus: 'Active',
  pdlStatus: 'Active',
  nySession: 'No Active Session',
  nyTimeFormatted: '00:00 NY',
  atr14: 100,
  orderBlocks: [],
  ...over,
});

describe('Hurst R/S z korektą Anis-Lloyd', () => {
  it('na białym szumie reżim trendowy pojawia się rzadko (≤ 8%)', () => {
    const rng = makeRng(42);
    let hits = 0;
    const T = 2000;
    for (let t = 0; t < T; t++) {
      const r = Array.from({ length: 45 }, () => rng.n());
      if (hurstAnisLloyd(r)! > HURST_TREND_THRESHOLD) hits++;
    }
    expect(hits / T).toBeLessThan(0.08);
  });
  it('silnie trendowy szereg (skumulowany szum) daje H powyżej progu', () => {
    const rng = makeRng(3);
    let acc = 0;
    const r = Array.from({ length: 45 }, () => (acc += rng.n()));
    expect(hurstAnisLloyd(r)).toBeGreaterThan(HURST_TREND_THRESHOLD);
  });
});

describe('VPIN (BVC, kubełki wolumenowe)', () => {
  it('na błądzeniu losowym mediana < 0.4 (stary kod: 0.79)', () => {
    const vals: number[] = [];
    for (let s = 1; s <= 60; s++) vals.push(computeVpinBvc(randomWalkBars(145, s))!);
    vals.sort((a, b) => a - b);
    expect(vals[30]).toBeLessThan(0.4);
  });
  it('kończy się dla dużych wolumenów (regresja: pętla bez postępu przez błąd zmiennoprzecinkowy)', () => {
    const bars = randomWalkBars(145, 12).map((b, i) => ({ ...b, vbuy: 1.234567e9 + i * 7.7, vsell: 9.87654e8 + i * 3.3 }));
    const t0 = Date.now();
    const v = computeVpinBvc(bars);
    expect(Date.now() - t0).toBeLessThan(200);
    expect(v).toBeGreaterThan(0);
  });
  it('jednostronny przepływ daje wysoki VPIN', () => {
    const bars = randomWalkBars(145, 9).map((b) => ({ ...b, vbuy: (b.vbuy + b.vsell) * 0.95, vsell: (b.vbuy + b.vsell) * 0.05 }));
    expect(computeVpinBvc(bars)).toBeGreaterThan(0.8);
  });
});

describe('Lambda Kyle’a (OLS na realnym przepływie)', () => {
  it('null gdy < 10 świec z realnym przepływem (BVC byłby kołowy)', () => {
    expect(kyleLambdaOls(randomWalkBars(60, 1))).toBeNull();
  });
  it('odtwarza znane λ = 2 $ na $1M', () => {
    const rng = makeRng(5);
    const bars = randomWalkBars(60, 2);
    let price = 100000;
    const withFlow = bars.map((b) => {
      const q = rng.n() * 3e6;
      price += (2 * q) / 1e6;
      return { ...b, close: price, vbuy: 1e7 + q / 2, vsell: 1e7 - q / 2, realFlow: true };
    });
    expect(kyleLambdaOls(withFlow)).toBeCloseTo(2, 3);
  });
});

describe('computeQuantMetrics — brak zmyślonych wartości i heurystyk', () => {
  it('OU bez powrotu do średniej: θ = 0, t½ = ∞ (nie 10.7 świec)', () => {
    // Cena ucieka od równowagi: x_{t-1} − EQ > 0 i dx > 0
    const bars = randomWalkBars(60, 4).map((b, i) => ({ ...b, close: 100000 + i * 50 }));
    const q = computeQuantMetrics(bars, shaakuniStub({ deq: 99000, weq: 99000 }));
    expect(q.ouTheta).toBe(0);
    expect(q.ouHalfLifeBars).toBe(Infinity);
  });
  it('wynik bez pól heurystyk (Hawkes ze stałymi, entropia, magnes, trajektoria, reguły reżimu)', () => {
    const q = computeQuantMetrics(randomWalkBars(60, 6), shaakuniStub());
    expect(Object.keys(q).sort()).toEqual(
      ['hurstExponent', 'kyle', 'liquidityProfile', 'ouEquilibriumPrice', 'ouHalfLifeBars', 'ouTheta', 'ouZScore', 'pocPrice', 'regime', 'vahPrice', 'valPrice', 'vpin'].sort()
    );
    for (const b of q.liquidityProfile) expect(b).not.toHaveProperty('gravityPotential');
  });
});

/** Zwroty o znanym σ (rozkład normalny) jako zamknięcia od 100. */
function closesFrom(sigmas: number[], seed: number): number[] {
  const rng = makeRng(seed);
  const out = [100];
  for (const s of sigmas) out.push(out[out.length - 1] * Math.exp(s * rng.n()));
  return out;
}

/** Losowanie Gamma(k, 1) dla całkowitego k (suma wykładniczych) i Beta(a, b) z dwóch Gamma. */
function beta(rng: ReturnType<typeof makeRng>, a: number, b: number): number {
  const g = (k: number) => {
    let s = 0;
    for (let i = 0; i < k; i++) s -= Math.log(rng.u() + 1e-12);
    return s;
  };
  const x = g(a);
  return x / (x + g(b));
}

describe('przedziały VPIN i λ Kyle’a (plan 59, B4 i B5)', () => {
  const flowBars = (shares: number[]): OHLCVBar[] =>
    shares.map((p, i) => ({ ...randomWalkBars(2, 1)[1], time: i * 300_000, vbuy: p * 1000, vsell: (1 - p) * 1000, realFlow: true }));

  it('t₀,₉₇₅: przybliżenie Cornisha–Fishera zgodne z tablicą', () => {
    expect(t975(9)).toBeCloseTo(2.262, 2);
    expect(t975(28)).toBeCloseTo(2.048, 2);
    expect(t975(100)).toBeCloseTo(1.984, 2);
  });

  it('VPIN: przedział 95% ze średnich partii pokrywa prawdziwą wartość w 92–98% (udział kupna ~ Beta(20, 20))', () => {
    const rng = makeRng(20261115);
    // E|2p − 1| dla p ~ Beta(20, 20): duża próba Monte Carlo
    let truth = 0;
    const M = 200_000;
    for (let i = 0; i < M; i++) truth += Math.abs(2 * beta(rng, 20, 20) - 1);
    truth /= M;
    let cover = 0;
    const R = 1000;
    for (let r = 0; r < R; r++) {
      // 50 świec o równym wolumenie: każda świeca to jeden kubełek
      const v = vpinEstimate(flowBars(Array.from({ length: 50 }, () => beta(rng, 20, 20))))!;
      expect(v.full).toBe(50);
      if (v.lo <= truth && truth <= v.hi) cover++;
    }
    expect(cover / R).toBeGreaterThanOrEqual(0.92);
    expect(cover / R).toBeLessThanOrEqual(0.98);
  });

  it('VPIN przy stałym udziale 0,5: 0 i przedział [0, 0]', () => {
    const v = vpinEstimate(flowBars(Array.from({ length: 50 }, () => 0.5)))!;
    expect([v.value, v.lo, v.hi]).toEqual([0, 0, 0]);
  });

  it('λ: przedział t pokrywa znane λ w 93–97% (n = 30); bez zależności „nieodróżnialne od zera” w ≥ 94%', () => {
    const rng = makeRng(7);
    const make = (lambda: number) => {
      const bars: OHLCVBar[] = [];
      let px = 100_000;
      for (let i = 0; i <= 30; i++) {
        const q = rng.n() * 2;
        px += lambda * q + 5 * rng.n();
        bars.push({ ...randomWalkBars(2, 1)[1], time: i * 300_000, close: px, vbuy: Math.max(0, q) * 1e6, vsell: Math.max(0, -q) * 1e6, realFlow: true });
      }
      return bars;
    };
    let cover = 0;
    let zero = 0;
    const R = 1000;
    for (let r = 0; r < R; r++) {
      const k = kyleEstimate(make(3))!;
      expect(k.n).toBe(30);
      if (k.lo <= 3 && 3 <= k.hi) cover++;
      if (kyleEstimate(make(0))!.zeroInside) zero++;
    }
    expect(cover / R).toBeGreaterThanOrEqual(0.93);
    expect(cover / R).toBeLessThanOrEqual(0.97);
    expect(zero / R).toBeGreaterThanOrEqual(0.94);
  });
});

describe('reżim zmienności BOCPD w Badaniach (plan 59, B1)', () => {
  it('skok σ z 0,1% do 0,4%: P(zmiana w ostatnich 5 świecach) > 0,5 po 4 świecach nowego reżimu; przy stałym σ < 0,2', () => {
    const calm = Array.from({ length: 300 }, () => 0.001);
    const jump = closesFrom([...calm, ...Array.from({ length: 4 }, () => 0.004)], 3);
    expect(regimeEstimate(jump)!.pRecent5).toBeGreaterThan(0.5);
    const flat = closesFrom([...calm, ...Array.from({ length: 4 }, () => 0.001)], 3);
    expect(regimeEstimate(flat)!.pRecent5).toBeLessThan(0.2);
    expect(regimeEstimate(flat)!.sigma).toBeGreaterThan(0.0007);
    expect(regimeEstimate(flat)!.sigma).toBeLessThan(0.0014);
  });

  it('mniej niż 101 zwrotów → null (bez wartości zastępczej)', () => {
    expect(regimeEstimate(closesFrom(Array.from({ length: 100 }, () => 0.001), 1))).toBeNull();
  });
});

describe('OFI — tylko realne transakcje', () => {
  it('bez transakcji brak stanów wyczerpania i bias zrównoważony', () => {
    const bars = randomWalkBars(30, 8);
    const px = bars[bars.length - 1].close;
    const raw = (side: number) =>
      Array.from({ length: 12 }, (_, i) => ({ px: String(px + side * (i + 1)), sz: String(1 + (i % 3)), n: 2 }));
    const { bids, asks } = parseL2Levels(raw(-1), raw(1));
    const ofi = computeOrderFlowImbalanceHeatmap(bids, asks, [], bars, px);
    expect(ofi.ticks.every((t) => t.exhaustionState === 'NONE')).toBe(true);
    expect(ofi.exhaustionBias).toBe('BALANCED_EQUILIBRIUM');
    expect(ofi.ticks.every((t) => t.aggressiveBuyUsd === 0 && t.aggressiveSellUsd === 0)).toBe(true);
    expect(ofi.exhaustionIndex).toBe(0);
    expect(ofi.overallOfiPct).toBe(0);
    // Brak przepływu to nie równowaga — notka mówi o braku danych
    expect(ofi.exhaustionNote).toMatch(/Mało transakcji/);
  });
});
