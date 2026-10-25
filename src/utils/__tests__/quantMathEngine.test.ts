import { describe, expect, it } from 'vitest';
import {
  computeOrderFlowImbalanceHeatmap,
  computeQuantMathAndNeuralForecast,
  computeVpinBvc,
  hurstAnisLloyd,
  HURST_TREND_THRESHOLD,
  kyleLambdaOls,
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
      if (hurstAnisLloyd(r) > HURST_TREND_THRESHOLD) hits++;
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
    for (let s = 1; s <= 60; s++) vals.push(computeVpinBvc(randomWalkBars(145, s)));
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

describe('computeQuantMathAndNeuralForecast — brak zmyślonych wartości', () => {
  it('OU bez powrotu do średniej: θ = 0, t½ = ∞ (nie 10.7 świec)', () => {
    // Cena ucieka od równowagi: x_{t-1} − EQ > 0 i dx > 0
    const bars = randomWalkBars(60, 4).map((b, i) => ({ ...b, close: 100000 + i * 50 }));
    const q = computeQuantMathAndNeuralForecast(bars, shaakuniStub({ deq: 99000, weq: 99000 }), [], [], [], []);
    expect(q.ouTheta).toBe(0);
    expect(q.ouHalfLifeBars).toBe(Infinity);
  });
  it('Hawkes η = null, głębokość arkusza bez mnożników', () => {
    const bars = randomWalkBars(60, 6);
    const { bids, asks } = parseL2Levels([{ px: '99999', sz: '1', n: 1 }], [{ px: '100001', sz: '2', n: 1 }]);
    const q = computeQuantMathAndNeuralForecast(bars, shaakuniStub(), [], [], bids, asks);
    expect(q.hawkesBranchingRatio).toBeNull();
    expect(q.bookDepthBidUsd).toBe(99999);
    expect(q.bookDepthAskUsd).toBe(200002);
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
