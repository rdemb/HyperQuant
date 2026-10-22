import { describe, expect, it } from 'vitest';
import { cascadeCurve, cascadeOutcome, impactFraction } from '../cascade';
import { LiqBucket, LiqMap } from '../liqMap';

const M = 100_000;
const P = { y: 1, sigmaDaily: 0.02, dayVolumeUsd: 2e9 };

function map(longs: LiqBucket[] = [], shorts: LiqBucket[] = []): LiqMap {
  return {
    v: 1,
    coin: 'BTC',
    asOf: 0,
    markPx: M,
    stepUsd: 100,
    longs,
    shorts,
    coverage: { positions: 0, addresses: 0, scannedBtc: 0, longBtc: 0, shortBtc: 0, wrongSide: 0, oiBtc: 0, share: 0 },
    ageMin: { p50: 0, p90: 0, ntlP50: 0 },
    ctxAt: 0,
    method: 'test',
  };
}
// Kubełek na zadanym odchyleniu od ceny (dolna krawędź), nominał w USD
const at = (pct: number, ntlUsd: number): LiqBucket => ({ px: Math.round(M * (1 + pct)) - 50, ntlUsd, n: 1 });

describe('impactFraction — prawo pierwiastka kwadratowego', () => {
  it('Y·σ·√(Q/V); 4× większe zlecenie → 2× większy wpływ', () => {
    expect(impactFraction(50e6, P)).toBeCloseTo(1 * 0.02 * Math.sqrt(50e6 / 2e9), 12);
    expect(impactFraction(200e6, P) / impactFraction(50e6, P)).toBeCloseTo(2, 12);
  });
  it('zerowy wolumen, σ albo zlecenie → 0, nie NaN', () => {
    expect(impactFraction(1e6, { ...P, dayVolumeUsd: 0 })).toBe(0);
    expect(impactFraction(1e6, { ...P, sigmaDaily: 0 })).toBe(0);
    expect(impactFraction(0, P)).toBe(0);
  });
});

describe('cascadeOutcome — punkt stały szok → likwidacje → wpływ', () => {
  it('pusta mapa: ruch końcowy = szok, A = 1', () => {
    const r = cascadeOutcome(map(), -0.01, P);
    expect(r.finalPct).toBeCloseTo(-0.01, 12);
    expect(r.amplification).toBeCloseTo(1, 12);
    expect(r.liquidatedUsd).toBe(0);
  });

  it('klaster longów poza zasięgiem szoku nie dokłada ruchu; w zasięgu — dokłada (A > 1)', () => {
    const m = map([at(-0.012, 80e6)]);
    expect(cascadeOutcome(m, -0.01, P).amplification).toBeCloseTo(1, 12);
    const hit = cascadeOutcome(m, -0.013, P);
    expect(hit.liquidatedUsd).toBe(80e6);
    expect(hit.finalPct).toBeLessThan(-0.013);
    expect(hit.amplification).toBeGreaterThan(1);
  });

  it('domino: szok ledwie dotykający pierwszego klastra uruchamia kolejne', () => {
    const m = map([at(-0.01, 300e6), at(-0.015, 300e6), at(-0.02, 300e6)]);
    const r = cascadeOutcome(m, -0.0101, P);
    expect(r.liquidatedUsd).toBe(900e6);
    expect(r.finalPct).toBeLessThan(-0.02);
    expect(r.rounds).toBeGreaterThan(2);
    expect(r.rounds).toBeLessThanOrEqual(100);
  });

  it('wzrost: shorty likwidowane powyżej ceny, wpływ w górę', () => {
    const r = cascadeOutcome(map([], [at(0.008, 100e6)]), 0.009, P);
    expect(r.liquidatedUsd).toBe(100e6);
    expect(r.finalPct).toBeGreaterThan(0.009);
  });

  it('szok zerowy → brak ruchu', () => {
    const r = cascadeOutcome(map([at(-0.001, 1e9)]), 0, P);
    expect(r.finalPct).toBe(0);
    expect(r.amplification).toBe(1);
  });
});

describe('cascadeCurve', () => {
  it('jeden wynik na szok, w kolejności', () => {
    const c = cascadeCurve(map([at(-0.01, 100e6)]), [-0.02, -0.005, 0.005], P);
    expect(c.map((x) => x.shockPct)).toEqual([-0.02, -0.005, 0.005]);
    expect(c[0].amplification).toBeGreaterThan(1);
    expect(c[1].amplification).toBeCloseTo(1, 12);
  });
});

describe('cascadeOutcome — zabezpieczenia', () => {
  it('ogromny nominał przy znikomym obrocie: wpływ ograniczony, cena nie schodzi poniżej zera', () => {
    const r = cascadeOutcome(map([at(-0.001, 1e12)]), -0.01, { ...P, dayVolumeUsd: 1 });
    expect(r.finalPct).toBeGreaterThan(-1);
    expect(Number.isFinite(r.amplification)).toBe(true);
  });
  it('kubełki po złej stronie ceny (nieaktualne odczyty) nie uruchamiają kaskady', () => {
    const r = cascadeOutcome(map([{ px: M + 150, ntlUsd: 30e6, n: 1 }]), -0.0025, P);
    expect(r.amplification).toBeCloseTo(1, 12);
    expect(r.liquidatedUsd).toBe(0);
  });
  it('liczba rund ograniczona liczbą kubełków (punkt stały osiągany bez cichego ucięcia)', () => {
    const buckets = Array.from({ length: 150 }, (_, i) => at(-0.01 - i * 0.0001, 200e6));
    const r = cascadeOutcome(map(buckets), -0.0101, P);
    expect(r.rounds).toBeLessThanOrEqual(buckets.length + 1);
    expect(r.liquidatedUsd).toBe(150 * 200e6);
  });
});
