import { describe, expect, it } from 'vitest';
import { branchingRatio, simulateCascade, type CascadeSimParams } from '../cascadeSim';
import type { LiqMap } from '../liqMap';

const MARK = 80_000;

function map(longs: [number, number][], shorts: [number, number][] = [], share = 0.5): LiqMap {
  return {
    v: 1,
    coin: 'BTC',
    asOf: 0,
    markPx: MARK,
    stepUsd: 50,
    longs: longs.map(([px, ntlUsd]) => ({ px, ntlUsd, n: 1 })),
    shorts: shorts.map(([px, ntlUsd]) => ({ px, ntlUsd, n: 1 })),
    coverage: { positions: 1, addresses: 1, scannedBtc: 1, longBtc: 1, shortBtc: 1, wrongSide: 0, oiBtc: 1, share },
    ageMin: { p50: 1, p90: 1, ntlP50: 1 },
    ctxAt: 0,
    method: 'x',
  };
}

const deep: CascadeSimParams = { bids: { d10: 20e6, d20: 50e6 }, asks: { d10: 20e6, d20: 50e6 }, resilienceMin: 5, paths: 300, seed: 7 };

describe('symulator kaskady 2.0', () => {
  it('pusta mapa: ruch szczytowy = szok, bez likwidacji, n = 0', () => {
    const r = simulateCascade(map([]), -0.01, deep);
    expect(r.move.p50).toBeCloseTo(-0.01, 9);
    expect(r.liquidated.p50).toBe(0);
    expect(branchingRatio(map([]), 'down', deep)).toBe(0);
  });
  it('gęsty klaster tuż pod ceną: wzmocnienie szoku, pasma uporządkowane, likwidacje > 0', () => {
    // Szok −1% (do 79 200) przechodzi przez pierwszy klaster; kolejne uruchamia dopiero wpływ likwidacji
    const m = map([
      [79_500, 30e6],
      [79_100, 40e6],
      [78_800, 60e6],
    ]);
    const r = simulateCascade(m, -0.01, deep);
    expect(r.move.p50).toBeLessThan(-0.01);
    expect(r.move.p10).toBeLessThanOrEqual(r.move.p50);
    expect(r.move.p50).toBeLessThanOrEqual(r.move.p90);
    expect(r.liquidated.p50).toBeGreaterThan(0);
    expect(r.pAmplify2).toBeGreaterThanOrEqual(0);
    expect(r.pAmplify2).toBeLessThanOrEqual(1);
  });
  it('płytszy arkusz → większe wzmocnienie; mniejsze pokrycie mapy → więcej nieznanych likwidacji', () => {
    const m = map([
      [79_500, 30e6],
      [79_100, 40e6],
    ]);
    const thin = { ...deep, bids: { d10: 4e6, d20: 10e6 } };
    expect(simulateCascade(m, -0.01, thin).move.p50).toBeLessThan(simulateCascade(m, -0.01, deep).move.p50);
    const lowCov = map(
      [
        [79_500, 30e6],
        [79_100, 40e6],
      ],
      [],
      0.2
    );
    expect(simulateCascade(lowCov, -0.01, deep).liquidated.p50).toBeGreaterThan(simulateCascade(m, -0.01, deep).liquidated.p50);
  });
  it('kierunek: szok w górę uruchamia tylko shorty (aski), w dół tylko longi (bidy)', () => {
    const m = map([[79_650, 50e6]], [[80_300, 50e6]]);
    const up = simulateCascade(m, 0.005, deep);
    const down = simulateCascade(m, -0.005, deep);
    expect(up.move.p50).toBeGreaterThan(0.005);
    expect(down.move.p50).toBeLessThan(-0.005);
    const onlyShorts = map([], [[80_300, 50e6]]);
    expect(simulateCascade(onlyShorts, -0.005, deep).liquidated.p50).toBe(0);
  });
  it('współczynnik rozgałęzienia: rośnie z gęstością likwidacji przy cenie i spada z głębokością arkusza', () => {
    const sparse = map([[79_800, 5e6]]);
    const dense = map(Array.from({ length: 10 }, (_, i) => [79_960 - i * 50, 30e6] as [number, number]));
    const nSparse = branchingRatio(sparse, 'down', deep);
    const nDense = branchingRatio(dense, 'down', deep);
    expect(nDense).toBeGreaterThan(nSparse);
    expect(branchingRatio(dense, 'down', { ...deep, bids: { d10: 2e6, d20: 5e6 } })).toBeGreaterThan(nDense);
  });
  it('deterministyczne dla tego samego ziarna', () => {
    const m = map([[79_500, 30e6]]);
    expect(simulateCascade(m, -0.01, deep)).toEqual(simulateCascade(m, -0.01, deep));
  });
});
