import { describe, expect, it } from 'vitest';
import {
  analyzePlan,
  attachMarketModel,
  barrierHitProbability,
  costLadder,
  isolatedLiquidationPrice,
  liquidationBufferWarning,
  quarterKelly,
  sizeFromRisk,
  simulateBarrierPaths,
  validatePlan,
  walkBook,
  wilsonLowerBound,
  PlanInput,
} from '../planAnalyzer';
import { L2OrderbookLevel } from '../../types/trading';

// Arkusz pomocniczy: poziomy w kolejności od najlepszej ceny
function levels(rows: [number, number][]): L2OrderbookLevel[] {
  let cum = 0;
  return rows.map(([price, sizeBtc]) => {
    const sizeUsd = price * sizeBtc;
    cum += sizeUsd;
    return { price, sizeBtc, sizeUsd, cumulativeUsd: cum, exchangeCount: 1 };
  });
}

const BOOK = {
  bids: levels([
    [99990, 1],
    [99980, 2],
  ]),
  asks: levels([
    [100010, 1],
    [100020, 2],
  ]),
};

// Przypadek 1:3 w cenie (stop −0.5%, cel +1.5%) przy dużej σ — prawie wszystkie ścieżki rozstrzygają się w horyzoncie
const ONE_TO_THREE = {
  direction: 'LONG' as const,
  entry: 100000,
  stop: 99500,
  target: 101500,
  sigmaHorizon: 0.05,
  horizonMin: 240,
};
const A = Math.log(100000 / 99500);
const B = Math.log(101500 / 100000);

describe('barrierHitProbability — formuła zamknięta (dwie bariery, ruch Browna z dryfem)', () => {
  it('bez dryfu: P(cel pierwszy) = a/(a+b) ≈ 25% dla 1:3', () => {
    const r = barrierHitProbability(ONE_TO_THREE);
    expect(r.pTarget).toBeCloseTo(A / (A + B), 10);
    expect(Math.abs(r.pTarget - 0.25)).toBeLessThan(0.01);
    expect(r.pTarget + r.pStop).toBeCloseTo(1, 12);
  });

  it('dryf → 0 zbiega do przypadku bez dryfu (ciągłość)', () => {
    const r = barrierHitProbability({ ...ONE_TO_THREE, driftPerHorizon: 1e-12 });
    expect(r.pTarget).toBeCloseTo(A / (A + B), 6);
  });

  it('dodatni dryf zwiększa P(cel) dla longa i zmniejsza dla shorta', () => {
    const base = barrierHitProbability(ONE_TO_THREE).pTarget;
    expect(barrierHitProbability({ ...ONE_TO_THREE, driftPerHorizon: 0.01 }).pTarget).toBeGreaterThan(base);
    const short = { direction: 'SHORT' as const, entry: 100000, stop: 100500, target: 98500, sigmaHorizon: 0.05 };
    const sBase = barrierHitProbability(short).pTarget;
    expect(barrierHitProbability({ ...short, driftPerHorizon: 0.01 }).pTarget).toBeLessThan(sBase);
  });

  it('symetria long/short w log-cenie (także z dryfem przeciwnego znaku)', () => {
    const long = { direction: 'LONG' as const, entry: 100000, stop: 99000, target: 102000, sigmaHorizon: 0.02 };
    const short = {
      direction: 'SHORT' as const,
      entry: 100000,
      stop: 100000 ** 2 / 99000,
      target: 100000 ** 2 / 102000,
      sigmaHorizon: 0.02,
    };
    expect(barrierHitProbability(short).pTarget).toBeCloseTo(barrierHitProbability(long).pTarget, 10);
    expect(barrierHitProbability({ ...short, driftPerHorizon: -0.004 }).pTarget).toBeCloseTo(
      barrierHitProbability({ ...long, driftPerHorizon: 0.004 }).pTarget,
      10
    );
  });
});

describe('simulateBarrierPaths — Monte Carlo z horyzontem i korektą mostu Browna', () => {
  const corrected = simulateBarrierPaths({ ...ONE_TO_THREE, paths: 4000, seed: 11, bridge: true });
  const naive = simulateBarrierPaths({ ...ONE_TO_THREE, paths: 4000, seed: 11, bridge: false });
  const formula = A / (A + B);

  it('1:3 bez dryfu: MC z korektą ≈ formuła (±2.5 pp przy 4000 ścieżek)', () => {
    expect(corrected.pNeither).toBeLessThan(0.01);
    expect(Math.abs(corrected.pTarget - formula)).toBeLessThan(0.025);
    expect(corrected.pTarget + corrected.pStop + corrected.pNeither).toBeCloseTo(1, 12);
  });

  it('korekta mostu jest bliżej formuły niż dyskretny monitoring', () => {
    expect(Math.abs(corrected.pTarget - formula)).toBeLessThan(Math.abs(naive.pTarget - formula));
  });

  it('korekta mostu nigdy nie zmniejsza P(dotknięcia którejkolwiek bariery) — te same ścieżki', () => {
    expect(corrected.pTarget + corrected.pStop).toBeGreaterThanOrEqual(naive.pTarget + naive.pStop);
    // Krótki horyzont: istotna masa „żadne” — tu efekt korekty widać wyraźniej
    const p = { direction: 'LONG' as const, entry: 100000, stop: 99000, target: 102000, sigmaHorizon: 0.008, horizonMin: 60 };
    const c = simulateBarrierPaths({ ...p, paths: 3000, seed: 5, bridge: true });
    const n = simulateBarrierPaths({ ...p, paths: 3000, seed: 5, bridge: false });
    expect(c.pTarget + c.pStop).toBeGreaterThan(n.pTarget + n.pStop);
    expect(c.pNeither).toBeGreaterThan(0.1);
  });

  it('deterministyczny seed: ten sam wynik przy tych samych parametrach', () => {
    const again = simulateBarrierPaths({ ...ONE_TO_THREE, paths: 4000, seed: 11, bridge: true });
    expect(again.pTarget).toBe(corrected.pTarget);
    expect(again.samples.paths[3].points).toEqual(corrected.samples.paths[3].points);
  });

  it('symetria long/short (lustrzane bariery w log-cenie)', () => {
    const long = { direction: 'LONG' as const, entry: 100000, stop: 99000, target: 102000, sigmaHorizon: 0.02, horizonMin: 120 };
    const short = { ...long, direction: 'SHORT' as const, stop: 100000 ** 2 / 99000, target: 100000 ** 2 / 102000 };
    const l = simulateBarrierPaths({ ...long, paths: 4000, seed: 3 });
    const s = simulateBarrierPaths({ ...short, paths: 4000, seed: 4 });
    expect(Math.abs(l.pTarget - s.pTarget)).toBeLessThan(0.025);
    expect(Math.abs(l.pStop - s.pStop)).toBeLessThan(0.025);
  });

  it('próbki do wizualizacji: ~18 ścieżek, punkty co ≥ 5 min, pasmo kwantyli i percentyle czasu dojścia', () => {
    expect(corrected.samples.paths).toHaveLength(18);
    expect(corrected.samples.times[1] - corrected.samples.times[0]).toBeGreaterThanOrEqual(5);
    expect(corrected.samples.band).toHaveLength(corrected.samples.times.length);
    for (const b of corrected.samples.band) {
      expect(b.p10).toBeLessThanOrEqual(b.p50);
      expect(b.p50).toBeLessThanOrEqual(b.p90);
    }
    const last = corrected.samples.hitByTime[corrected.samples.hitByTime.length - 1];
    expect(last.target).toBeCloseTo(corrected.pTarget, 12);
    expect(last.stop).toBeCloseTo(corrected.pStop, 12);
    expect(corrected.samples.hitByTime[0]).toEqual({ target: 0, stop: 0 });
    const t = corrected.timeToStop!;
    expect(t.p25).toBeLessThanOrEqual(t.p50);
    expect(t.p50).toBeLessThanOrEqual(t.p75);
    expect(t.p75).toBeLessThanOrEqual(240);
  });

  it('mnożnik zdarzeń zwiększa P(rozstrzygnięcia) w krótkim horyzoncie', () => {
    const p = { direction: 'LONG' as const, entry: 100000, stop: 99000, target: 102000, sigmaHorizon: 0.008, horizonMin: 60 };
    const calm = simulateBarrierPaths({ ...p, paths: 3000, seed: 9 });
    const event = simulateBarrierPaths({ ...p, paths: 3000, seed: 9, eventMultiplier: 2 });
    expect(event.pNeither).toBeLessThan(calm.pNeither);
  });
});

describe('simulateBarrierPaths — σ kroków (FHS) i faza wypełnienia', () => {
  // LONG: stop −1%, cel +1.5%, σ = 1% na 2 h
  const base = { direction: 'LONG' as const, entry: 100000, stop: 99000, target: 101500, sigmaHorizon: 0.01, horizonMin: 120 };
  const flat = Array(24).fill(0.01 / Math.sqrt(24));

  it('stałe σ kroków 5 min bez reszt ≈ dotychczasowe kroki 1 min (±2.5 pp)', () => {
    const old = simulateBarrierPaths({ ...base, paths: 8000, seed: 3 });
    const neu = simulateBarrierPaths({ ...base, paths: 8000, seed: 3, stepSigmas: flat, stepMin: 5, residuals: null });
    expect(Math.abs(neu.pTarget - old.pTarget)).toBeLessThan(0.025);
    expect(Math.abs(neu.pStop - old.pStop)).toBeLessThan(0.025);
    expect(neu.stepMin).toBe(5);
    expect(old.stepMin).toBe(1);
    expect(neu.sigmaEff).toBeCloseTo(0.01, 10);
    expect(neu.samples.times[neu.samples.times.length - 1]).toBe(120);
  });

  it('wejście w granicy 1 bp od rynku = zlecenie rynkowe: pFill = 1', () => {
    const r = simulateBarrierPaths({ ...base, startPrice: 100000 * (1 + 0.9e-4), stepSigmas: flat, stepMin: 5, residuals: null, seed: 2 });
    expect(r.pFill).toBe(1);
    const limit = simulateBarrierPaths({ ...base, startPrice: 100000 * (1 + 3e-4), stepSigmas: flat, stepMin: 5, residuals: null, seed: 2 });
    expect(limit.pFill).toBeLessThan(1);
  });

  it('cena startowa = wejście → pFill = 1, bez fillRare', () => {
    const r = simulateBarrierPaths({ ...base, startPrice: 100000, stepSigmas: flat, stepMin: 5, residuals: null, seed: 2 });
    expect(r.pFill).toBe(1);
    expect(r.fillRare).toBe(false);
  });

  it('wejście 1σ pod rynkiem: część ścieżek się wypełnia, wynik warunkowy sumuje się do 1, więcej „żadne” niż przy natychmiastowym wejściu', () => {
    const start = 100000 * Math.exp(0.01);
    const r = simulateBarrierPaths({ ...base, startPrice: start, stepSigmas: flat, stepMin: 5, residuals: null, paths: 4000, seed: 1 });
    const now = simulateBarrierPaths({ ...base, stepSigmas: flat, stepMin: 5, residuals: null, paths: 4000, seed: 1 });
    expect(r.pFill).toBeGreaterThan(0.2);
    expect(r.pFill).toBeLessThan(0.45);
    expect(r.fillRare).toBe(false);
    expect(r.pTarget + r.pStop + r.pNeither).toBeCloseTo(1, 9);
    expect(r.pNeither).toBeGreaterThan(now.pNeither);
  });

  it('symetria wypełnienia: LONG z rynkiem nad wejściem ≈ lustrzany SHORT (±3 pp)', () => {
    const d = 0.006;
    const long = simulateBarrierPaths({ ...base, startPrice: 100000 * Math.exp(d), stepSigmas: flat, stepMin: 5, residuals: null, paths: 4000, seed: 9 });
    const short = simulateBarrierPaths({
      ...base,
      direction: 'SHORT',
      stop: 100000 * Math.exp(Math.log(100000 / 99000)),
      target: 100000 * Math.exp(-Math.log(101500 / 100000)),
      startPrice: 100000 * Math.exp(-d),
      stepSigmas: flat,
      stepMin: 5,
      residuals: null,
      paths: 4000,
      seed: 9,
    });
    expect(Math.abs(long.pFill - short.pFill)).toBeLessThan(0.03);
    expect(Math.abs(long.pTarget - short.pTarget)).toBeLessThan(0.03);
  });

  it('wejście 8σ od rynku: fillRare i skończone prawdopodobieństwa z założenia natychmiastowego wejścia', () => {
    const r = simulateBarrierPaths({ ...base, startPrice: 100000 * Math.exp(0.08), stepSigmas: flat, stepMin: 5, residuals: null, seed: 4 });
    expect(r.fillRare).toBe(true);
    expect(r.pFill).toBeLessThan(0.1);
    expect(Number.isFinite(r.pTarget)).toBe(true);
    expect(r.pTarget + r.pStop + r.pNeither).toBeCloseTo(1, 9);
  });

  it('reszty FHS: ten sam seed → identyczny wynik', () => {
    const res = [-2.5, -0.5, -0.2, 0, 0.1, 0.4, 0.6, 2.1];
    const a = simulateBarrierPaths({ ...base, stepSigmas: flat, stepMin: 5, residuals: res, seed: 6 });
    const b = simulateBarrierPaths({ ...base, stepSigmas: flat, stepMin: 5, residuals: res, seed: 6 });
    expect(a.pTarget).toBe(b.pTarget);
    expect(a.pStop).toBe(b.pStop);
  });

  it('analyzePlan przekazuje model zmienności i cenę startową do symulacji', () => {
    const r = analyzePlan(
      {
        ...base,
        sizeUsd: 10000,
        book: BOOK,
        eventMultiplier: 1,
        vol: { stepMin: 5, stepSigmas: flat, residuals: null },
        startPrice: 100000 * Math.exp(0.01),
      },
      { paths: 2000, seed: 3 }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mc.pFill).toBeLessThan(0.6);
      expect(r.mc.stepMin).toBe(5);
    }
  });
});

describe('attachMarketModel — wspólne wejście Analizatora i szybkiej karty', () => {
  const base = {
    direction: 'LONG' as const,
    entry: 100000,
    stop: 99000,
    target: 101500,
    sizeUsd: 10000,
    horizonMin: 120,
    sigmaHorizon: 0.01,
    book: BOOK,
    eventMultiplier: 1,
  };

  it('dokłada model zmienności i cenę startową, gdy są dostępne', () => {
    const vol = { stepMin: 5, stepSigmas: [0.002], residuals: null };
    const r = attachMarketModel(base, { vol, price: 100100 });
    expect(r.vol).toBe(vol);
    expect(r.startPrice).toBe(100100);
  });

  it('bez modelu i bez ceny rynku — pola pominięte (zapas)', () => {
    const r = attachMarketModel(base, { vol: null, price: Number.NaN });
    expect(r.vol).toBeUndefined();
    expect(r.startPrice).toBeUndefined();
  });
});

describe('wersja modelu w wyniku — zgodna z faktycznie użytą metodą', () => {
  const p = { direction: 'LONG' as const, entry: 100000, stop: 99000, target: 101500, sigmaHorizon: 0.01, horizonMin: 60 };
  it('stała σ (zapas) → plan-gbm-fill-v2; HAR + FHS → plan-fhs-har-v2; HAR bez reszt → plan-har-normal-v2', () => {
    expect(simulateBarrierPaths(p).modelVersion).toBe('plan-gbm-fill-v2');
    const steps = Array(12).fill(0.01 / Math.sqrt(12));
    expect(simulateBarrierPaths({ ...p, stepSigmas: steps, residuals: [-1, 1] }).modelVersion).toBe('plan-fhs-har-v2');
    expect(simulateBarrierPaths({ ...p, stepSigmas: steps, residuals: null }).modelVersion).toBe('plan-har-normal-v2');
  });
});

describe('walkBook — poślizg z przejścia po arkuszu L2', () => {
  it('kupno $200k: VWAP i bps względem mid', () => {
    const r = walkBook(BOOK, 'buy', 200000)!;
    const btc = 1 + (200000 - 100010) / 100020;
    const vwap = 200000 / btc;
    expect(r.mid).toBe(100000);
    expect(r.vwap).toBeCloseTo(vwap, 6);
    expect(r.slipBps).toBeCloseTo(((vwap - 100000) / 100000) * 1e4, 6);
    expect(r.insufficientDepth).toBe(false);
  });

  it('sprzedaż: poślizg dodatni (koszt) po stronie bid', () => {
    const r = walkBook(BOOK, 'sell', 50000)!;
    expect(r.vwap).toBeCloseTo(99990, 6);
    expect(r.slipBps).toBeCloseTo(1, 6);
  });

  it('arkusz za płytki → insufficientDepth', () => {
    const r = walkBook(BOOK, 'buy', 1_000_000)!;
    expect(r.insufficientDepth).toBe(true);
    expect(r.filledUsd).toBeCloseTo(100010 + 200040, 6);
  });

  it('pusty arkusz → null (brak danych, nie zero)', () => {
    expect(walkBook({ bids: [], asks: [] }, 'buy', 1000)).toBeNull();
  });
});

describe('isolatedLiquidationPrice — wzór z dokumentacji Hyperliquid', () => {
  it('long 10× przy BTC max 40× (l = 1/80): (E − E/lev)/(1 − l)', () => {
    const r = isolatedLiquidationPrice('LONG', 100000, 10, 40)!;
    expect(r.maintenanceRate).toBeCloseTo(0.0125, 12);
    expect(r.price).toBeCloseTo(90000 / 0.9875, 6);
  });

  it('short 10×: (E + E/lev)/(1 + l)', () => {
    const r = isolatedLiquidationPrice('SHORT', 100000, 10, 40)!;
    expect(r.price).toBeCloseTo(110000 / 1.0125, 6);
  });

  it('na cenie likwidacji kapitał = wymagany depozyt utrzymaniowy', () => {
    const E = 100000;
    const lev = 20;
    const size = 0.5;
    const r = isolatedLiquidationPrice('LONG', E, lev, 40)!;
    const equity = (size * E) / lev + size * (r.price - E);
    expect(equity).toBeCloseTo(size * r.price * r.maintenanceRate, 6);
  });

  it('long 1× nie ma ceny likwidacji (null)', () => {
    expect(isolatedLiquidationPrice('LONG', 100000, 1, 40)).toBeNull();
  });

  it('bufor: likwidacja przed stopem i stop za blisko likwidacji', () => {
    // Long 25×: liq ≈ 97 215; stop 97 000 leży za likwidacją
    const liq = isolatedLiquidationPrice('LONG', 100000, 25, 40)!.price;
    expect(liquidationBufferWarning('LONG', 97000, liq, 100000, 0.01)).toBe('liq_before_stop');
    expect(liquidationBufferWarning('LONG', 97500, liq, 100000, 0.01)).toBe('stop_near_liq');
    expect(liquidationBufferWarning('LONG', 99500, liq, 100000, 0.01)).toBeNull();
    const sliq = isolatedLiquidationPrice('SHORT', 100000, 25, 40)!.price;
    expect(liquidationBufferWarning('SHORT', 103500, sliq, 100000, 0.01)).toBe('liq_before_stop');
  });
});

describe('wielkość pozycji i ćwierć-Kelly', () => {
  it('stałe ryzyko %: size = equity·r/(|E−S|/E + koszty)', () => {
    const r = sizeFromRisk({ equity: 10000, riskPct: 1, entry: 100000, stop: 99000, costFrac: 0.001 });
    expect(r).toBeCloseTo(100 / 0.011, 6);
  });

  it('dolna granica Wilsona (z = 1.96)', () => {
    expect(wilsonLowerBound(30, 50)).toBeCloseTo(0.461812, 5);
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });

  it('ćwierć-Kelly z p_L i R; ujemna przewaga → 0', () => {
    expect(quarterKelly(0.461812, 2)).toBeCloseTo(0.25 * (0.461812 - 0.538188 / 2), 6);
    expect(quarterKelly(0.2, 2)).toBe(0);
  });
});

describe('validatePlan — czytelne błędy po polsku', () => {
  const ok: PlanInput = {
    direction: 'LONG',
    entry: 100000,
    stop: 99000,
    target: 102000,
    sizeUsd: 10000,
    horizonMin: 120,
    sigmaHorizon: 0.01,
    book: BOOK,
    eventMultiplier: 1,
  };

  it('poprawny plan → brak błędów', () => {
    expect(validatePlan(ok)).toEqual([]);
  });

  it('stop/cel po złej stronie (LONG i SHORT)', () => {
    expect(validatePlan({ ...ok, stop: 101000 }).join(' ')).toMatch(/stop musi być poniżej wejścia/);
    expect(validatePlan({ ...ok, target: 98000 }).join(' ')).toMatch(/cel musi być powyżej wejścia/);
    expect(validatePlan({ ...ok, direction: 'SHORT' }).join(' ')).toMatch(/stop musi być powyżej wejścia/);
  });

  it('zerowa odległość, brak σ, zła dźwignia', () => {
    expect(validatePlan({ ...ok, stop: 100000 }).join(' ')).toMatch(/zerowa odległość/);
    expect(validatePlan({ ...ok, sigmaHorizon: 0 }).join(' ')).toMatch(/zmienności/);
    expect(validatePlan({ ...ok, leverage: 60 }).join(' ')).toMatch(/Dźwignia/);
    expect(validatePlan({ ...ok, entry: Number.NaN }).join(' ')).toMatch(/dodatnie liczby/);
  });
});

describe('analyzePlan — całość', () => {
  it('bez dryfu i bez kosztów EV ≈ 0R (model nie zakłada przewagi)', () => {
    const r = analyzePlan(
      { ...ONE_TO_THREE, sizeUsd: 10000, book: { bids: [], asks: [] }, eventMultiplier: 1, feeRateTaker: 0 },
      { paths: 4000, seed: 2 }
    );
    if (!r.ok) throw new Error(r.errors.join());
    expect(Math.abs(r.evRGross)).toBeLessThan(0.1);
    expect(r.costs.slippageKnown).toBe(false);
    expect(r.evR).toBeCloseTo(r.evRGross, 12);
  });

  it('koszty obniżają EV; poślizg i likwidacja liczone z arkusza i dźwigni', () => {
    const r = analyzePlan(
      { ...ONE_TO_THREE, sizeUsd: 50000, book: BOOK, eventMultiplier: 1, leverage: 10 },
      { paths: 2000, seed: 2 }
    );
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.R).toBeCloseTo(3, 12);
    expect(r.costs.feeUsd).toBeCloseTo(50000 * 0.00045 * 2, 9);
    expect(r.entrySlip!.slipBps).toBeGreaterThan(0);
    expect(r.evR).toBeLessThan(r.evRGross);
    expect(r.liquidation!.price).toBeCloseTo(90000 / 0.9875, 6);
    expect(r.liquidation!.warning).toBeNull();
  });

  it('błędne wejście → ok: false z listą błędów', () => {
    const r = analyzePlan({ ...ONE_TO_THREE, stop: 100500, sizeUsd: 1000, book: BOOK, eventMultiplier: 1 });
    expect(r.ok).toBe(false);
  });
});

describe('costLadder — drabina kosztów (te same szanse, inne wykonanie)', () => {
  // Stop 0,5% od wejścia ⇒ 1 bp = 0,02 R; EV przed kosztami 0 przy P_N·średni R żadnych = −0,05
  const BASE = {
    direction: 'LONG' as const,
    entry: 100000,
    stop: 99500,
    R: 3,
    sizeUsd: 10000,
    book: { bids: [], asks: [] },
    mc: { pTarget: 0.25, pStop: 0.7, pNeither: 0.05 },
    evRGross: 0,
    takerFee: 0.00045,
    makerFee: 0.00015,
  };

  it('koszty wierszy z opłat: taker 9 bp, limit na wejściu 6 bp, limit na wejściu i celu 5,25 bp', () => {
    const l = costLadder(BASE);
    expect(l.rPerBp).toBeCloseTo(0.02, 12);
    expect(l.rows.map((r) => r.kind)).toEqual(['taker', 'makerEntry', 'makerBoth']);
    const [t, me, mb] = l.rows;
    expect(t.costBp).toBeCloseTo(9, 12);
    expect(me.costBp).toBeCloseTo(6, 12);
    // 1,5 + 0,25·1,5 + (0,7 + 0,05)·4,5
    expect(mb.costBp).toBeCloseTo(5.25, 12);
    expect(t.costR).toBeCloseTo(0.18, 12);
    expect(t.evR).toBeCloseTo(-0.18, 12);
  });

  it('próg P(cel): przy nim EV po kosztach = 0 (ten sam udział „żadne”)', () => {
    const neitherMeanR = -1; // 0,25·3 − 0,7 + 0,05·(−1) = 0
    for (const r of costLadder(BASE).rows) {
      const pT = r.breakEvenPTarget;
      const pS = 1 - BASE.mc.pNeither - pT;
      expect(pT * BASE.R - pS + BASE.mc.pNeither * neitherMeanR - r.costR).toBeCloseTo(0, 12);
    }
    expect(costLadder(BASE).rows[0].breakEvenPTarget).toBeCloseTo(0.295, 12);
  });

  it('kolejność: rynkowe ≥ limit na wejściu ≥ limit na wejściu i celu; poślizg tylko przy wejściu rynkowym i stopie', () => {
    const l = costLadder({ ...BASE, sizeUsd: 150000, book: BOOK });
    const [t, me, mb] = l.rows;
    expect(t.costBp).toBeGreaterThan(me.costBp);
    expect(me.costBp).toBeGreaterThan(mb.costBp);
    const entrySlip = walkBook(BOOK, 'buy', 150000)!.slipBps;
    const stopSlip = walkBook(BOOK, 'sell', 150000)!.slipBps;
    expect(t.costBp).toBeCloseTo(9 + entrySlip + 0.7 * stopSlip, 12);
    expect(me.costBp).toBeCloseTo(6 + 0.7 * stopSlip, 12);
    for (const r of l.rows) expect(r.evR).toBeCloseTo(BASE.evRGross - r.costR, 12);
  });

  it('SHORT: poślizg wejścia z bidów, stopu z asków', () => {
    const l = costLadder({ ...BASE, direction: 'SHORT', stop: 100500, sizeUsd: 150000, book: BOOK });
    const entrySlip = walkBook(BOOK, 'sell', 150000)!.slipBps;
    const stopSlip = walkBook(BOOK, 'buy', 150000)!.slipBps;
    expect(l.rows[0].costBp).toBeCloseTo(9 + entrySlip + 0.7 * stopSlip, 12);
    expect(l.rPerBp).toBeCloseTo(0.02, 12);
  });

  it('analyzePlan: wiersz rynkowy drabiny = koszty i EV po kosztach z analizy', () => {
    const r = analyzePlan({ ...ONE_TO_THREE, sizeUsd: 300000, book: BOOK, eventMultiplier: 1 }, { paths: 2000, seed: 3 });
    if (!r.ok) throw new Error(r.errors.join());
    const taker = r.ladder.rows[0];
    expect(taker.kind).toBe('taker');
    expect(taker.costR).toBeCloseTo(r.costs.totalR, 12);
    expect(taker.evR).toBeCloseTo(r.evR, 12);
    expect(r.ladder.rows.map((x) => x.kind)).toEqual(['taker', 'makerEntry', 'makerBoth']);
  });
});
