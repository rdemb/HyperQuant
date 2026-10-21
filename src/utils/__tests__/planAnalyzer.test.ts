import { describe, expect, it } from 'vitest';
import {
  analyzePlan,
  barrierHitProbability,
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
