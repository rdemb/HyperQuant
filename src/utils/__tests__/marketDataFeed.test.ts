import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyLiveTradesToBars,
  applyRealFlowSplit,
  applyVenueFlow,
  buildHyperliquidBar,
  fetchRealHyperliquidMarketData,
  mapHyperliquidTrade,
  parkinsonSigma,
  parseL2Levels,
  recalculateIndicatorSeries,
  resetHtfCacheForTests,
  runMertonMonteCarloEngine,
} from '../marketDataFeed';
import { normCdf } from '../stats';
import { OHLCVBar } from '../../types/trading';

// Deterministyczny generator (Mulberry32) + Box-Muller — testy muszą być powtarzalne
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

function makeBars(count: number, start = 100000, tfSec = 300, seed = 7): OHLCVBar[] {
  const rng = makeRng(seed);
  const sigBar = 0.45 * Math.sqrt(tfSec / (365 * 24 * 3600));
  const bars: OHLCVBar[] = [];
  let p = start;
  for (let i = 0; i < count; i++) {
    const path = [p];
    for (let k = 0; k < 20; k++) {
      path.push(path[path.length - 1] * Math.exp((sigBar / Math.sqrt(20)) * rng.n()));
    }
    const close = path[path.length - 1];
    bars.push(
      buildHyperliquidBar(p, Math.max(...path), Math.min(...path), close, 40, 500, i * tfSec * 1000, sigBar * start)
    );
    p = close;
  }
  return recalculateIndicatorSeries(bars);
}

describe('buildHyperliquidBar — uczciwa świeca HL', () => {
  it('wolumen = realny wolumen HL w USD (bez ×3.8), brak wymyślonego spot i likwidacji', () => {
    const bar = buildHyperliquidBar(100000, 100100, 99900, 100050, 12.5, 400, 0, 60);
    expect(bar.vbuy + bar.vsell).toBeCloseTo(12.5 * 100050, -1);
    expect(bar.spotVbuy + bar.spotVsell).toBe(0);
    expect(bar.lbuy + bar.lsell).toBe(0);
    expect(bar.perpVbuy).toBe(bar.vbuy);
    expect(bar.exchanges.HYPERLIQUID.vbuy).toBe(bar.vbuy);
    expect(bar.exchanges.BINANCE_FUTURES.vbuy + bar.exchanges.BINANCE_FUTURES.vsell).toBe(0);
    expect(bar.cbuy + bar.csell).toBe(400);
  });

  it('podział BVC: Φ(ΔP/σ) — świeca wzrostowa > 50%, doji = 50%', () => {
    const up = buildHyperliquidBar(100000, 100100, 99950, 100060, 10, 100, 0, 60);
    expect(up.vbuy / (up.vbuy + up.vsell)).toBeCloseTo(normCdf(1), 3);
    const doji = buildHyperliquidBar(100000, 100100, 99900, 100000, 10, 100, 0, 60);
    expect(doji.vbuy).toBe(doji.vsell);
  });
});

describe('parseL2Levels — bez mnożnika ×3.2', () => {
  it('rozmiar poziomu = px·sz z API', () => {
    const { bids, asks } = parseL2Levels(
      [{ px: '100000', sz: '2', n: 5 }, { px: '99999', sz: '1', n: 1 }],
      [{ px: '100001', sz: '0.5', n: 2 }]
    );
    expect(bids[0].sizeUsd).toBe(200000);
    expect(bids[0].sizeBtc).toBe(2);
    expect(bids[1].cumulativeUsd).toBe(200000 + 99999);
    expect(asks[0].sizeUsd).toBe(Math.round(100001 * 0.5));
    expect(bids[0].exchangeCount).toBe(5);
  });
});

describe('mapHyperliquidTrade — bez podłogi $2 500', () => {
  it('mała transakcja zachowuje realny rozmiar', () => {
    const t = mapHyperliquidTrade({ px: '100000', sz: '0.001', side: 'B', time: 1000 });
    expect(t?.sizeUsd).toBe(100);
    expect(t?.side).toBe('buy');
    expect(t?.isSynthetic).toBeFalsy();
  });
  it('strona A = sprzedaż, śmieciowe dane = null', () => {
    expect(mapHyperliquidTrade({ px: '1', sz: '1', side: 'A', time: 1 })?.side).toBe('sell');
    expect(mapHyperliquidTrade({ px: 'x', sz: '1', side: 'B', time: 1 })).toBeNull();
  });
});

describe('applyLiveTradesToBars — rollover świecy', () => {
  const tf = 300;
  const base = makeBars(30, 100000, tf);
  const lastT = base[base.length - 1].time;
  const tick = (ms: number, price: number) =>
    mapHyperliquidTrade({ px: String(price), sz: '1', side: 'B', time: ms })!;

  it('transakcja w obrębie świecy aktualizuje ostatni bar', () => {
    const out = applyLiveTradesToBars(base, [tick(lastT + 299_000, 123456)], tf);
    expect(out.length).toBe(base.length);
    expect(out[out.length - 1].close).toBe(123456);
  });

  it('transakcja po granicy otwiera nową świecę z OHLC = cena', () => {
    const out = applyLiveTradesToBars(base, [tick(lastT + 300_000, 111111)], tf);
    const nb = out[out.length - 1];
    expect(out.length).toBe(base.length + 1);
    expect(nb.time).toBe(lastT + 300_000);
    expect([nb.open, nb.high, nb.low, nb.close]).toEqual([111111, 111111, 111111, 111111]);
    expect(nb.vbuy).toBe(111111);
  });

  it('limit długości historii', () => {
    const out = applyLiveTradesToBars(base, [tick(lastT + 300_000, 1)], tf, 30);
    expect(out.length).toBe(30);
  });

  it('nie mutuje wejścia', () => {
    const before = base[base.length - 1].close;
    applyLiveTradesToBars(base, [tick(lastT + 1, 1)], tf);
    expect(base[base.length - 1].close).toBe(before);
  });
});

describe('applyRealFlowSplit — realny podział agresora na wolumenie REST', () => {
  it('stosuje proporcję z WS do całkowitego wolumenu świecy', () => {
    const bars = makeBars(25);
    const t = bars[24].time;
    const total = bars[24].vbuy + bars[24].vsell;
    const out = applyRealFlowSplit(bars, new Map([[t, { buy: 300, sell: 100 }]]));
    expect(out[24].vbuy).toBeCloseTo(total * 0.75, 0);
    expect(out[24].vsell).toBeCloseTo(total * 0.25, 0);
    expect(out[24].realFlow).toBe(true);
    expect(out[23].realFlow).toBeFalsy();
  });
});

describe('Kalman (recalculateIndicatorSeries)', () => {
  it('zgodny z referencyjnym filtrem: P = F·P·Fᵀ + Q, update (I−KH)P', () => {
    const bars = makeBars(140);
    // Referencja — ten sam model (x' = x + v, v' = 0.92 v), poprawna algebra
    const phi = 0.92;
    let x = bars[0].close;
    let v = 0;
    let p00 = 10, p01 = 0, p10 = 0, p11 = 1;
    for (const b of bars) {
      const xp = x + v;
      const vp = phi * v;
      const a = p00 + p01 + p10 + p11 + 1.5;
      const bb = phi * (p01 + p11);
      const c = phi * (p10 + p11);
      const d = phi * phi * p11 + 0.4;
      const r = Math.max(10, b.atr * 0.35);
      const k0 = a / (a + r);
      const k1 = c / (a + r);
      const y = b.close - xp;
      x = xp + k0 * y;
      v = vp + k1 * y;
      p00 = (1 - k0) * a;
      p01 = (1 - k0) * bb;
      p10 = c - k1 * a;
      p11 = d - k1 * bb;
      expect(Math.abs(p01 - p10)).toBeLessThan(1e-9);
      expect(b.kalmanEstimate).toBeCloseTo(x, 6);
      expect(b.kalmanVelocity).toBeCloseTo(v, 6);
    }
  });
});

describe('parkinsonSigma', () => {
  it('odtwarza zmienność GBM 45% rocznie w horyzoncie 2h (±25%)', () => {
    const bars = makeBars(140);
    const s = parkinsonSigma(bars, 7200, 300);
    const truth = 0.45 * Math.sqrt(7200 / (365 * 24 * 3600));
    expect(s).toBeGreaterThan(truth * 0.75);
    expect(s).toBeLessThan(truth * 1.25);
  });
});

describe('Monte Carlo first-passage', () => {
  const S = 100000;
  const sigma2h = 0.45 * Math.sqrt(7200 / (365 * 24 * 3600)); // ≈0.68%

  it('P(dotknięcia PDH +1.2% w 2h) zgodne z zasadą odbicia (~7–8%)', () => {
    // Średnia z kilku przebiegów ogranicza szum 600 ścieżek
    let acc = 0;
    for (let i = 0; i < 6; i++) {
      acc += runMertonMonteCarloEngine(S, S * 1.012, S * 0.9, S, sigma2h).probTouchPDH2h;
    }
    const p = acc / 6;
    const reflection = 2 * (1 - normCdf(Math.log(1.012) / sigma2h)) * 100;
    expect(reflection).toBeGreaterThan(7);
    expect(p).toBeGreaterThan(4.5);
    expect(p).toBeLessThan(11);
  });

  it('brak sztucznej podłogi 42% dla D-EQ', () => {
    const mc = runMertonMonteCarloEngine(S, S * 1.2, S * 0.8, S * 0.95, sigma2h);
    expect(mc.probTouchDEQ2h).toBeLessThan(5);
  });

  it('null zamiast zmyślonych minut, gdy żadna ścieżka nie dotknie poziomu', () => {
    const mc = runMertonMonteCarloEngine(S, S * 1.5, S * 0.5, S * 0.5, sigma2h);
    expect(mc.probTouchPDH2h).toBe(0);
    expect(mc.expectedMinsToPDH).toBeNull();
    expect(mc.expectedMinsToPDL).toBeNull();
  });
});

describe('fetchRealHyperliquidMarketData (zamockowane API)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetHtfCacheForTests();
  });

  const candles = (n: number, intervalMs: number) =>
    Array.from({ length: n }, (_, i) => ({
      t: i * intervalMs,
      o: String(100000 + i),
      h: String(100050 + i),
      l: String(99950 + i),
      c: String(100010 + i),
      v: '10',
      n: 100,
    }));

  function stubApi(meta: unknown, calls: string[] = []) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body);
        calls.push(body.type === 'candleSnapshot' ? `candle:${body.req.interval}` : body.type);
        let data: unknown = null;
        if (body.type === 'candleSnapshot') {
          data = candles(body.req.interval === '5m' ? 60 : 5, 1);
        } else if (body.type === 'l2Book') {
          data = { levels: [[{ px: '100000', sz: '1', n: 3 }], [{ px: '100001', sz: '2', n: 4 }]] };
        } else if (body.type === 'metaAndAssetCtxs') {
          data = meta;
        }
        return { ok: true, json: async () => data } as Response;
      })
    );
  }

  const meta = (funding: string) => [
    { universe: [{ name: 'BTC' }] },
    [{ funding, openInterest: '1000', dayNtlVlm: '5', oraclePx: '100000', markPx: '100010', midPx: '100005' }],
  ];

  it('funding = 0 z API zostaje 0 (nie 10.95% APR)', async () => {
    stubApi(meta('0.0'));
    const res = await fetchRealHyperliquidMarketData(300);
    expect(res.liveTelemetry?.fundingAnnualizedPct).toBe(0);
    expect(res.l2Book?.bids[0].sizeUsd).toBe(100000);
  });

  it('brak metaAndAssetCtxs → telemetria null zamiast zakodowanych stałych', async () => {
    stubApi(null);
    const res = await fetchRealHyperliquidMarketData(300);
    expect(res.liveTelemetry).toBeNull();
  });

  it('cache HTF i opcjonalny L2 ograniczają liczbę zapytań', async () => {
    const calls: string[] = [];
    stubApi(meta('0.0000125'), calls);
    await fetchRealHyperliquidMarketData(300);
    await fetchRealHyperliquidMarketData(300, { includeL2Book: false });
    expect(calls.filter((c) => c === 'candle:1d').length).toBe(1);
    expect(calls.filter((c) => c === 'l2Book').length).toBe(1);
  });
});

describe('applyVenueFlow — przepływ CEX przetrwa odświeżenie REST', () => {
  it('dodaje wolumen giełdy do świecy i rozdziela spot/perp', () => {
    const bars = makeBars(25);
    const t = bars[24].time;
    const before = { vbuy: bars[24].vbuy, spot: bars[24].spotVbuy };
    const flow = new Map([[t, new Map([['COINBASE' as const, { buy: 1000, sell: 400, isPerp: false }]])]]);
    const out = applyVenueFlow(bars, flow);
    expect(out[24].vbuy).toBe(before.vbuy + 1000);
    expect(out[24].spotVbuy).toBe(before.spot + 1000);
    expect(out[24].exchanges.COINBASE).toEqual({ vbuy: 1000, vsell: 400 });
    expect(bars[24].vbuy).toBe(before.vbuy);
  });
});

describe('applyLiveTradesToBars — ticki CEX i likwidacje', () => {
  const tf = 300;
  const base = makeBars(30, 100000, tf);
  const lastT = base[base.length - 1].time;
  const cex = (ms: number, price: number, liq = false) => ({
    ...mapHyperliquidTrade({ px: String(price), sz: '1', side: 'A', time: ms })!,
    exchange: 'BINANCE_FUTURES' as const,
    isLiquidation: liq,
  });

  it('tick CEX nie zmienia OHLC świecy HL, ale dokłada wolumen', () => {
    const last = base[base.length - 1];
    const out = applyLiveTradesToBars(base, [cex(lastT + 1000, 1)], tf, 145, { updatePrice: false });
    const nb = out[out.length - 1];
    expect([nb.open, nb.high, nb.low, nb.close]).toEqual([last.open, last.high, last.low, last.close]);
    expect(nb.vsell).toBe(last.vsell + 1);
  });

  it('likwidacja trafia tylko do lsell (bez podwójnego liczenia wolumenu)', () => {
    const last = base[base.length - 1];
    const out = applyLiveTradesToBars(base, [cex(lastT + 1000, 100000, true)], tf, 145, { updatePrice: false });
    const nb = out[out.length - 1];
    expect(nb.lsell).toBe(last.lsell + 100000);
    expect(nb.vsell).toBe(last.vsell);
  });
});
