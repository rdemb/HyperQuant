import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { HREL_DESIGN, HREL_WEIGHTS, type HourBar, type HrelRow, hourIndex, hrelForecast, hrelFeatures, hrelOutcome, hrelProbs, hrelSummary, hrelThreshold } from '../hourRel';

/**
 * Prognoza `hrel-v1` (projekt B): duży ruch „jak na tę godzinę”. Wzorce policzone niezależnie w Pythonie na 3 648
 * świecach 1h (czerwiec–październik 2026) z celową luką całej doby 28.10: sześć chwil z oczekiwanymi cechami, progami,
 * szansami, zakresami i wynikami oraz dwie chwile bez prognozy.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

interface Fixture {
  weights: Record<string, number[]>;
  candles: [number, number, number][];
  cases: { hs: number; utc: string; x: number[]; thr: number[]; p: number[]; rng: number[]; y: number[] }[];
  brak: { hs: number; powod: string; oczekiwane: null }[];
}

const fx = JSON.parse(readFileSync(new URL('./fixtures/hrel-v1.json', import.meta.url), 'utf8')) as Fixture;
const bars: HourBar[] = fx.candles.map(([t, h, l]) => ({ t, h, l }));
const all = hourIndex(bars);

describe('hrel-v1: wzorce z Pythona', () => {
  it('wagi w planie = wagi wzorcowe', () => {
    expect(HREL_WEIGHTS).toEqual([0, 1, 2, 3].map((j) => fx.weights[String(j)]));
    expect(HREL_DESIGN.weights).toEqual(HREL_WEIGHTS);
  });

  it.each(fx.cases.map((c) => [c.utc, c] as const))('%s: x do 1e-6, thr i p do 1e-4, rng do 1e-4, y dokładnie', (_, c) => {
    const f = hrelForecast(all, c.hs);
    expect(f).not.toBeNull();
    f!.x.forEach((v, i) => expect(Math.abs(v - c.x[i])).toBeLessThanOrEqual(1e-6 + 1e-12));
    f!.thr.forEach((v, i) => expect(Math.abs(v - c.thr[i])).toBeLessThanOrEqual(1e-4 + 1e-12));
    f!.p.forEach((v, i) => expect(Math.abs(v - c.p[i])).toBeLessThanOrEqual(1e-4 + 1e-12));
    // Szanse z cech zapisanych
    expect(hrelProbs(f!.x)).toEqual(f!.p);
    const o = hrelOutcome(all, c.hs, f!.thr);
    o.rng.forEach((v, i) => expect(Math.abs(v! - c.rng[i])).toBeLessThanOrEqual(1e-4 + 1e-12));
    expect(o.y).toEqual(c.y);
  });

  it.each(fx.brak.map((b) => [b.powod, b.hs] as const))('brak prognozy: %s', (_, hs) => {
    expect(hrelForecast(all, hs)).toBeNull();
  });

  it('próg: dzień bez świecy pominięty, mniej niż 20 dni tego samego typu → null', () => {
    // 2026-10-29 08:00 (czwartek): luka 28.10 → 20 dni roboczych sprzed niej, bez 28.10
    const u = Date.UTC(2026, 9, 29, 8);
    const want: number[] = [];
    for (let k = 1; want.length < 20; k++) {
      const v = u - k * DAY;
      const wd = new Date(v).getUTCDay();
      const b = all.get(v);
      if (wd !== 0 && wd !== 6 && b) want.push(Math.log(b.h / b.l) * 1e4);
    }
    want.sort((a, b) => a - b);
    expect(hrelThreshold(all, u)).toBeCloseTo((want[9] + want[10]) / 2, 10);
    // 10 dni historii: za mało
    expect(hrelThreshold(all, Date.UTC(2026, 5, 11, 8))).toBeNull();
  });
});

describe('hrel-v1: bez wglądu w przyszłość', () => {
  it('świece od hs (dopisane albo zmienione) nie zmieniają x, thr ani p', () => {
    for (const c of fx.cases) {
      const before = hrelForecast(hourIndex(bars.filter((b) => b.t < c.hs)), c.hs);
      const changed = bars.map((b) => (b.t >= c.hs ? { ...b, h: b.h * 1.05 } : b));
      const extra = Array.from({ length: 48 }, (_, i) => ({ t: fx.candles.at(-1)![0] + (i + 1) * HOUR, h: 80_000, l: 70_000 }));
      expect(hrelForecast(hourIndex([...changed, ...extra]), c.hs)).toEqual(before);
      expect(before).toEqual(hrelForecast(all, c.hs));
    }
  });

  it('cechy z 24 godzin przed hs: brak jednej świecy → null; hs nie na pełnej godzinie → null', () => {
    const c = fx.cases[0];
    expect(hrelFeatures(all, c.hs)).not.toBeNull();
    const m = new Map(all);
    m.delete(c.hs - 24 * HOUR);
    expect(hrelFeatures(m, c.hs)).toBeNull();
    expect(hrelForecast(all, c.hs + 15 * MIN)).toBeNull();
  });

  it('z: przy zakresie 0 wartość −1,5; ln(rng/thr) przycięte do ±1,5', () => {
    const c = fx.cases[0];
    const m = new Map(all);
    const u = c.hs - HOUR;
    const b = m.get(u)!;
    m.set(u, { t: u, h: b.l, l: b.l });
    expect(hrelFeatures(m, c.hs)!.x[0]).toBe(-1.5);
    m.set(u, { t: u, h: b.l * 1.5, l: b.l });
    expect(hrelFeatures(m, c.hs)!.x[0]).toBe(1.5);
  });

  it('wynik: brak świecy godziny docelowej → null dla tej godziny', () => {
    const c = fx.cases[0];
    const m = new Map(all);
    m.delete(c.hs + 2 * HOUR);
    const o = hrelOutcome(m, c.hs, c.thr);
    expect(o.rng[2]).toBeNull();
    expect(o.y).toEqual([c.y[0], c.y[1], null, c.y[3]]);
  });
});

describe('hrelSummary', () => {
  const plan = { at: Date.UTC(2026, 10, 1), hash: 'h' };
  /** Deterministyczne wiersze: p z LCG, y ~ Bernoulli(p) dla wyprzedzenia j */
  function rows(n: number, seed: number, from: number): HrelRow[] {
    let s = seed;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    return Array.from({ length: n }, (_, i) => {
      const p = [0, 1, 2, 3].map(() => Math.round((0.1 + 0.8 * r()) * 1e4) / 1e4);
      return { t: from + i * HOUR, p, y: p.map((q) => (r() < q ? 1 : 0) as 0 | 1) };
    });
  }

  it('cztery wyprzedzenia: liczność, Brier, BSS wobec 0,5 z przedziałem, AUC, kwintyle; bloki 14 dni z t Neweya–Westa', () => {
    const rs = rows(30 * 24, 42, plan.at);
    const now = plan.at + 30 * DAY;
    const s = hrelSummary(rs, plan, now, null);
    expect(s.plan).toEqual(plan);
    expect(s.leads).toHaveLength(4);
    for (const [j, l] of s.leads.entries()) {
      const pp = rs.filter((x) => x.t >= now - 30 * DAY).map((x) => ({ p: x.p[j], y: x.y[j] as 0 | 1 }));
      expect(l.j).toBe(j);
      expect(l.n).toBe(pp.length);
      const brier = pp.reduce((a, x) => a + (x.p - x.y) ** 2, 0) / pp.length;
      expect(l.brier).toBeCloseTo(brier, 12);
      expect(l.bss.value).toBeCloseTo(1 - brier / 0.25, 4);
      expect(l.bss.lo).not.toBeNull();
      expect(l.bss.lo!).toBeLessThan(l.bss.hi!);
      expect(l.auc).toBeGreaterThan(0.6);
      expect(l.quintiles).toHaveLength(5);
      expect(l.quintiles.reduce((a, q) => a + q.n, 0)).toBe(pp.length);
      // kwintyle rosnąco po p
      expect(l.quintiles.map((q) => q.meanP!)).toEqual([...l.quintiles.map((q) => q.meanP!)].sort((a, b) => a - b));
    }
    // Bloki wyprzedzenia 1 h: oba zakończone (koniec + zapas), z t; łącznie po bloku 2
    expect(s.blocks).toHaveLength(2);
    const b1 = s.blocks[0];
    expect(b1.start).toBe(plan.at);
    expect(b1.end).toBe(plan.at + 14 * DAY);
    expect(b1.n).toBe(14 * 24);
    const d = rs.filter((x) => x.t >= b1.start && x.t < b1.end).map((x) => (x.p[1] - x.y[1]!) ** 2 - (0.5 - x.y[1]!) ** 2);
    expect(b1.mean).toBeCloseTo(d.reduce((a, x) => a + x, 0) / d.length, 12);
    expect(b1.t).toBeLessThan(-2.24);
    expect(s.pooled).not.toBeNull();
    expect(s.pooled!.n).toBe(28 * 24);
    expect(s.pooled!.t!).toBeLessThan(b1.t!);
  });

  it('blok w toku bez wyniku; za mało godzin w bloku → t null', () => {
    const rs = rows(10 * 24, 7, plan.at);
    const s = hrelSummary(rs, plan, plan.at + 10 * DAY, null);
    expect(s.blocks).toEqual([]);
    expect(s.pooled).toBeNull();
    const few = hrelSummary(rows(200, 7, plan.at), plan, plan.at + 15 * DAY, null);
    expect(few.blocks).toHaveLength(1);
    expect(few.blocks[0].n).toBe(200);
    expect(few.blocks[0].t).toBeNull();
  });

  it('godziny bez wyniku (null) i sprzed planu nie wchodzą do oceny', () => {
    const rs = rows(20 * 24, 9, plan.at - 5 * DAY).map((x, i) => (i % 10 === 0 ? { ...x, y: [x.y[0], null, x.y[2], x.y[3]] } : x));
    const s = hrelSummary(rs, plan, plan.at + 15 * DAY, null);
    const inBlock = rs.filter((x) => x.t >= plan.at && x.t < plan.at + 14 * DAY && x.y[1] !== null).length;
    expect(s.blocks[0].n).toBe(inBlock);
    expect(s.leads[1].n).toBe(rs.filter((x) => x.y[1] !== null && x.t >= plan.at + 15 * DAY - 30 * DAY).length);
  });
});
