import { describe, expect, it } from 'vitest';
import { SIZE_BINS_PER_DECADE, indicatorDef, ksFloor, ofiMinR2, signedKs, takerBreadth, type FlowContext } from '../indicators/registry';

/** Poprawki metodologii rejestru z planu 59 (D1–D4): progi z hipotezy zerowej, KS dwóch prób, OI w świecy, równomierność. */

function rng(seed: number) {
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

describe('D1: próg R² OFI zależny od okna', () => {
  it('t² / (t² + n − 2) jak w planie: 30 → 0,130, 20 → 0,197, 100 → 0,039', () => {
    expect(ofiMinR2(30)).toBeCloseTo(0.13, 3);
    expect(Math.abs(ofiMinR2(20) - 0.197)).toBeLessThanOrEqual(0.002);
    expect(ofiMinR2(100)).toBeCloseTo(0.039, 3);
  });

  it('OFI i Δp niezależne (n = 30, 2000 okien): R² ponad próg w ≤ 6% okien', () => {
    const r = rng(59);
    let over = 0;
    for (let k = 0; k < 2000; k++) {
      const x = Array.from({ length: 30 }, r.n);
      const y = Array.from({ length: 30 }, r.n);
      const mx = x.reduce((a, b) => a + b, 0) / 30;
      const my = y.reduce((a, b) => a + b, 0) / 30;
      let sxy = 0;
      let sxx = 0;
      let syy = 0;
      for (let i = 0; i < 30; i++) {
        sxy += (x[i] - mx) * (y[i] - my);
        sxx += (x[i] - mx) ** 2;
        syy += (y[i] - my) ** 2;
      }
      if ((sxy * sxy) / (sxx * syy) >= ofiMinR2(30)) over++;
    }
    expect(over / 2000).toBeLessThanOrEqual(0.06);
  });
});

describe('D2: KS dwóch prób z progiem 1%', () => {
  const bins = (xs: number[]) => {
    const h = new Float64Array(8 * SIZE_BINS_PER_DECADE);
    for (const x of xs) h[Math.min(h.length - 1, Math.max(0, Math.floor(SIZE_BINS_PER_DECADE * Math.log10(x))))]++;
    return h;
  };
  const sample = (r: ReturnType<typeof rng>, n: number, med: number) => Array.from({ length: n }, () => med * Math.exp(0.5 * r.n()));

  it('próg 1,628·√((n + m)/(n·m))', () => {
    expect(ksFloor(40, 4000)).toBeCloseTo(1.628 * Math.sqrt(4040 / 160000), 12);
  });

  // Moc zależy od rozrzutu wielkości zleceń: przy σ log-wielkości 0,5 przesunięcie mediany ×1,5 to 0,8σ
  it('ten sam rozkład (n 40, m 4000): ponad próg w ≤ 1,5%; mediana ×1,5: ≥ 80%', () => {
    const r = rng(7);
    const base = bins(sample(r, 4000, 10_000));
    let same = 0;
    let shifted = 0;
    for (let k = 0; k < 2000; k++) {
      if (Math.abs(signedKs(bins(sample(r, 40, 10_000)), 40, base, 4000)) > ksFloor(40, 4000)) same++;
      if (Math.abs(signedKs(bins(sample(r, 40, 15_000)), 40, base, 4000)) > ksFloor(40, 4000)) shifted++;
    }
    expect(same / 2000).toBeLessThanOrEqual(0.015);
    expect(shifted / 2000).toBeGreaterThanOrEqual(0.8);
  });
});

describe('D3: zmiana OI tylko z próbek w świecy', () => {
  it('próbki OI co 2 min, świece 1m: bez próbki młodszej niż świeca — NaN, a nie zmiana z sąsiedniej świecy', () => {
    const MIN = 60_000;
    const samples = [0, 2, 4, 6].map((m) => ({ t: m * MIN, v: 1000 + m * 10 }));
    // Jak atWithin w magazynie: ostatnia próbka nie później niż t i nie starsza niż maxAgeMs (najwyżej 3 min)
    const oiAt = (t: number, maxAgeMs = 3 * MIN) => {
      const s = [...samples].reverse().find((x) => x.t <= t);
      return s && t - s.t <= Math.min(3 * MIN, maxAgeMs) ? s.v : null;
    };
    const ctx = { oiAt, now: 10 * MIN } as unknown as FlowContext;
    const def = indicatorDef('oiflow')!;
    const out = [Number.NaN, Number.NaN];
    const bar = (t: number) => ({ candle: { t, o: 1, h: 1, l: 1, c: 1, v: 1 }, complete: true, fp: { delta: 5 } }) as never;
    def.flow!(bar(1 * MIN), MIN, ctx, out as never);
    expect(Number.isNaN(out[0])).toBe(true);
    // Na 5m te same próbki wystarczają: początek 0 i koniec 4 min (świeca 0–5 min, koniec z próbki 4 min)
    def.flow!(bar(0), 5 * MIN, ctx, out as never);
    expect(out[0]).toBe(40);
  });
});

describe('D4: równomierność biorców niezależna od ich liczby', () => {
  const o = (time: number, side: 1 | -1, notional: number, taker: string) => ({ time, side, notional, taker });
  it('5 kont po równo → 1; jedno konto 96% i cztery po 1% → < 0,3', () => {
    expect(takerBreadth(['a', 'b', 'c', 'd', 'e'].map((k, i) => o(i, 1, 100, k))).evenness).toBeCloseTo(1, 12);
    expect(takerBreadth([o(1, 1, 96, 'a'), o(2, 1, 1, 'b'), o(3, 1, 1, 'c'), o(4, 1, 1, 'd'), o(5, 1, 1, 'e')]).evenness).toBeLessThan(0.3);
    expect(takerBreadth([]).evenness).toBeNaN();
  });
});

describe('E3, E6: opis skali mapy ciepła i progów klastrów w plakietce', () => {
  it('podpowiedź LIVE mapy ciepła i klastrów likwidacji mówi o skali i progach', async () => {
    const { layerBadge } = await import('../chart/layerSources');
    expect(layerBadge('showHeatmap', { coin: 'BTC', now: 0 }).hint).toMatch(/60\. do 99,5\. percentyla|60th to the 99.5th/);
    expect(layerBadge('showLiq', { coin: 'BTC', now: 1_000, scan: { asOf: 1_000 } }).hint).toMatch(/3 największe przedziały|3 largest bins/);
  });
});
