import { describe, expect, it } from 'vitest';
import { fitBranching, MIN_EVENTS, N_MAX } from '../core/hawkes';
import { IndicatorEngine } from '../indicators/engine';
import { type FlowContext, indicatorDef, indicatorLabel, indicatorsFromLink, tfAllowed } from '../indicators/registry';
import type { Side } from '../hl/parse';

/** Generator z ziarnem (mulberry32). */
function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Proces Hawkesa z jądrem wykładniczym na [0, T) metodą przerzedzania Ogaty (intensywność maleje między zdarzeniami). */
function simulate(mu: number, n: number, beta: number, T: number, r: () => number): Float64Array {
  const out: number[] = [];
  let t = 0;
  let s = 0;
  for (;;) {
    const bar = mu + n * beta * s;
    const w = -Math.log(1 - r()) / bar;
    t += w;
    s *= Math.exp(-beta * w);
    if (t >= T) break;
    if (r() * bar <= mu + n * beta * s) {
      out.push(t);
      s += 1;
    }
  }
  return Float64Array.from(out);
}

describe('endogeniczność taśmy: n Hawkesa z przedziałem', () => {
  it('symulacja z n 0,3 / 0,6 / 0,9: prawdziwe n w przedziale 95% w co najmniej 90% powtórzeń', () => {
    for (const n of [0.3, 0.6, 0.9]) {
      const r = rng(1000 + n * 10);
      let hit = 0;
      let sum = 0;
      const R = 50;
      for (let k = 0; k < R; k++) {
        // Okno 15 min, ok. 1 zdarzenia na sekundę, półokres pobudzenia ok. 3,5 s (jak na taśmie BTC)
        const f = fitBranching(simulate(1 - n, n, 0.2, 900, r), 900)!;
        expect(f.lo).toBeLessThanOrEqual(f.n);
        expect(f.hi).toBeGreaterThanOrEqual(f.n);
        if (f.lo <= n && n <= f.hi) hit++;
        sum += f.n;
      }
      expect(hit / R).toBeGreaterThanOrEqual(0.9);
      expect(Math.abs(sum / R - n)).toBeLessThan(0.05);
    }
  });

  it('bez pobudzenia (Poisson): przedział od 0; za mało zdarzeń — brak', () => {
    const r = rng(7);
    const ts: number[] = [];
    for (let t = -Math.log(1 - r()); t < 900; t += -Math.log(1 - r())) ts.push(t);
    const f = fitBranching(Float64Array.from(ts), 900)!;
    expect(f.lo).toBe(0);
    expect(f.hi).toBeLessThan(0.5);
    expect(f.hi).toBeLessThanOrEqual(N_MAX);
    expect(fitBranching(Float64Array.from(ts.slice(0, MIN_EVENTS - 1)), 900)).toBeNull();
  });

  it('wskaźnik: okno kończy się z końcem świecy (bieżąca — z ostatnią pełną minutą), okno bez taśmy z kontami — brak', () => {
    const def = indicatorDef('hawkes');
    expect(def.group).toBe('hyperquant');
    expect(def.band).toEqual([1, 2]);
    expect(tfAllowed(def)).toBe(false);
    const x = indicatorsFromLink('hawkes(15)')[0];
    expect(indicatorLabel(x)).toBe('Hawkes 15');
    const M = 60_000;
    const t0 = 100 * M;
    // Zlecenia z symulacji (2 zlecenia w niektórych blokach — liczą się raz) przez 20 minut
    const times = Array.from(simulate(0.4, 0.6, 0.2, 1200, rng(3)), (s) => t0 + Math.round(s * 1000));
    const list = times.flatMap((t, k) => Array.from({ length: k % 3 === 0 ? 2 : 1 }, () => ({ time: t, side: 1 as Side, notional: 1, taker: 'a' })));
    const inRange = (a: number, b: number) => list.filter((o) => o.time >= a && o.time < b);
    const ctx = (now: number, from: number): FlowContext => ({
      oiAt: () => null,
      book: () => [],
      exactBook: () => [],
      orders: inRange,
      orderCount: (a, b) => inRange(a, b).length,
      identified: (a) => a >= from,
      makers: () => null,
      now,
    });
    const c = { o: 1, h: 1, l: 1, c: 1, v: 1, n: 1 };
    const bars = Array.from({ length: 20 }, (_, k) => ({ candle: { ...c, t: t0 + k * M } }));
    const e = new IndicatorEngine();
    e.setInstances([x]);
    e.sync(bars, M, () => [], ctx(t0 + 19 * M + 30_000, t0));
    const [n, lo, hi] = e.runs[0].out;
    const end = t0 + 15 * M;
    const ts = Float64Array.from(new Set(times.filter((t) => t < end).map((t) => (t - t0) / 1000)));
    const f = fitBranching(ts, 900)!;
    // Świeca 14:00–15:00 (indeks 14): okno 0–15 min
    expect(n[14]).toBeCloseTo(f.n, 12);
    expect(lo[14]).toBeCloseTo(f.lo, 12);
    expect(hi[14]).toBeCloseTo(f.hi, 12);
    expect(n[13]).toBeNaN();
    expect(n[18]).toBeGreaterThan(0);
    // Bieżąca świeca 1 m: okno do ostatniej pełnej minuty, czyli jej początku — to samo co poprzedniej świecy
    expect(n[19]).toBe(n[18]);
    // Taśma z kontami dopiero od 2. minuty: okno pierwszej świecy z wartością nie jest pełne
    const e2 = new IndicatorEngine();
    e2.setInstances([x]);
    e2.sync(bars, M, () => [], ctx(t0 + 19 * M + 30_000, t0 + 2 * M));
    expect(e2.runs[0].out[0][14]).toBeNaN();
    expect(e2.runs[0].out[0][16]).toBeGreaterThan(0);
  });
});
