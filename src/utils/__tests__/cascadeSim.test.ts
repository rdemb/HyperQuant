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
    coverage: { positions: 1, addresses: 1, scannedBtc: 2 * share, longBtc: share, shortBtc: share, wrongSide: 0, oiBtc: 1, share },
    ageMin: { p50: 1, p90: 1, ntlP50: 1 },
    ctxAt: 0,
    method: 'x',
  };
}

const deep: CascadeSimParams = { bids: { d10: 20e6, d20: 50e6 }, asks: { d10: 20e6, d20: 50e6 }, resilienceMin: 5, paths: 300, seed: 7 };

describe('symulator kaskady 2.0', () => {
  it('pusta mapa: ruch szczytowy = szok, bez likwidacji, n = 0', () => {
    const r = simulateCascade(map([]), -0.01, deep)!;
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
    const r = simulateCascade(m, -0.01, deep)!;
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
    expect(simulateCascade(m, -0.01, thin)!.move.p50).toBeLessThan(simulateCascade(m, -0.01, deep)!.move.p50);
    const lowCov = map(
      [
        [79_500, 30e6],
        [79_100, 40e6],
      ],
      [],
      0.2
    );
    expect(simulateCascade(lowCov, -0.01, deep)!.liquidated.p50).toBeGreaterThan(simulateCascade(m, -0.01, deep)!.liquidated.p50);
  });
  it('kierunek: szok w górę uruchamia tylko shorty (aski), w dół tylko longi (bidy)', () => {
    const m = map([[79_650, 50e6]], [[80_300, 50e6]]);
    const up = simulateCascade(m, 0.005, deep)!;
    const down = simulateCascade(m, -0.005, deep)!;
    expect(up.move.p50).toBeGreaterThan(0.005);
    expect(down.move.p50).toBeLessThan(-0.005);
    const onlyShorts = map([], [[80_300, 50e6]]);
    expect(simulateCascade(onlyShorts, -0.005, deep)!.liquidated.p50).toBe(0);
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

describe('kaskada 2.0 — dynamika czasu, wyzwalanie po mark, niepewność (recenzja)', () => {
  const m = map([
    [79_500, 30e6],
    [79_150, 40e6],
    [78_850, 60e6],
    [78_550, 60e6],
  ]);
  const thinBook: CascadeSimParams = { bids: { d10: 6e6, d20: 15e6 }, asks: { d10: 6e6, d20: 15e6 }, resilienceMin: 5, paths: 300, seed: 3 };
  it('wolniejsza odbudowa arkusza → większy ruch (czas ma znaczenie)', () => {
    const fast = simulateCascade(m, -0.01, { ...thinBook, resilienceMin: 0.5 })!;
    const slow = simulateCascade(m, -0.01, { ...thinBook, resilienceMin: 60 })!;
    expect(slow.move.p50).toBeLessThan(fast.move.p50);
  });
  it('horyzont: bez czasu na propagację (0 min) kaskada mniejsza niż w 60 min', () => {
    const now = simulateCascade(m, -0.01, { ...thinBook, horizonMin: 0 })!;
    const hour = simulateCascade(m, -0.01, thinBook)!;
    expect(hour.liquidated.p50).toBeGreaterThan(now.liquidated.p50);
  });
  it('pokrycie osobno dla longów i shortów (longBtc/oiBtc, shortBtc/oiBtc)', () => {
    const base = map([[79_650, 50e6]], [[80_300, 50e6]]);
    base.coverage = { ...base.coverage, oiBtc: 100, longBtc: 60, shortBtc: 25, share: 0.425 };
    const down = simulateCascade(base, -0.005, thinBook)!;
    const up = simulateCascade(base, 0.005, thinBook)!;
    // ten sam nominał na mapie, ale shorty widziane w 25% → więcej nieznanych likwidacji w górę
    expect(up.liquidated.p50).toBeGreaterThan(down.liquidated.p50);
  });
  it('brak głębokości strony → wynik null (nie „brak kaskady”)', () => {
    expect(simulateCascade(m, -0.01, { ...thinBook, bids: { d10: 0, d20: null } })).toBeNull();
  });
  it('wzmocnienie lokalne (sieczna): największy stosunek wpływu likwidacji uruchomionych ruchem δ do δ, δ ≤ 50 bp', () => {
    const far = map([[79_500, 60e6]]); // ~60 bp od ceny — poza oknem
    expect(branchingRatio(far, 'down', thinBook)).toBe(0);
    const near = map([[79_700, 60e6]]); // ~35 bp
    const n = branchingRatio(near, 'down', thinBook);
    expect(n).toBeGreaterThan(0);
    expect(Number.isFinite(n)).toBe(true);
  });
});

import { cascadeDepth } from '../cascadeSim';
import type { LiquidityProfile } from '../liquidity';

describe('kaskada 2.0 — głębokość stron z rejestratora', () => {
  const T = Date.UTC(2026, 9, 22, 17, 30);
  const hour = (n: number, extra: Partial<LiquidityProfile['byHour'][number]> = {}) => ({ h: 17, d10: 60e6, d20: 100e6, n, days: 1, ...extra });
  const prof = (now: LiquidityProfile['now'], h17: LiquidityProfile['byHour'][number]): LiquidityProfile =>
    ({
      v: 1,
      coin: 'BTC',
      asOf: T,
      since: T - 3_600_000,
      last: T,
      days: 1,
      minutes: 100,
      byHour: Array.from({ length: 24 }, (_, h) => (h === 17 ? h17 : { h, d10: null, d20: null, n: 0, days: 0 })),
      now,
      resilience: { events: 0, medianMin: null, unrecovered: 0, censored: 0, noDrop: 0 },
    }) as LiquidityProfile;
  it('świeża minuta ze stronami → bidy i aski wprost z niej', () => {
    const d = cascadeDepth(prof({ t: T - 60_000, d10: 1e6, d20: 2e6, ratio10: null, b10: 3e5, a10: 7e5, b20: 8e5, a20: 1.2e6 }, hour(10)), true, T)!;
    expect(d).toMatchObject({ source: 'now', split: 'now' });
    expect(d.params.bids.d10).toBeCloseTo(3e5, 6);
    expect(d.params.asks.d10).toBeCloseTo(7e5, 6);
    expect(d.params.bids.d20).toBeCloseTo(8e5, 6);
    expect(d.params.asks.d20).toBeCloseTo(1.2e6, 6);
  });
  it('minuta bez stron (starszy profil): podział z mediany godziny, gdy ≥ 30 min danych; inaczej po połowie — oznaczone', () => {
    const now = { t: T - 60_000, d10: 1e6, d20: 2e6, ratio10: null };
    const byHour = cascadeDepth(prof(now, hour(40, { b10: 20e6, a10: 40e6, b20: 40e6, a20: 60e6 })), true, T)!;
    expect(byHour.split).toBe('hour');
    expect(byHour.params.bids.d10).toBeCloseTo(1e6 / 3, 3);
    expect(byHour.params.bids.d20).toBeCloseTo(2e6 * 0.4, 3);
    const assumed = cascadeDepth(prof(now, hour(18, { b10: 20e6, a10: 40e6 })), true, T)!;
    expect(assumed.split).toBe('assumed');
    expect(assumed.params.bids.d10).toBeCloseTo(5e5, 6);
  });
  it('minuta nieświeża → mediana godziny; bez danych godziny → null', () => {
    const stale = { t: T - 3_600_000, d10: 1e6, d20: 2e6, ratio10: null, b10: 3e5, a10: 7e5, b20: null, a20: null };
    const d = cascadeDepth(prof(stale, hour(40, { b10: 30e6, a10: 30e6 })), true, T)!;
    expect(d).toMatchObject({ source: 'hour', split: 'hour' });
    expect(d.params.bids.d10).toBeCloseTo(30e6, 3);
    expect(cascadeDepth(prof(stale, hour(10)), true, T)).toBeNull();
  });
});
