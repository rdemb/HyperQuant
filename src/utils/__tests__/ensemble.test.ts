import { describe, expect, it } from 'vitest';
import { ENS_PRIOR, fitEnsemble, logit, poolProb, type EnsPair } from '../ensemble';
import { mulberry32 } from '../pathEngine';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 22);
const sig = (z: number) => 1 / (1 + Math.exp(-z));

/** Pary (model, rynek, wynik) z prawdziwym logit P = a + bm·logit pm + bk·logit pk */
function gen(seed: number, n: number, truth: { a: number; bm: number; bk: number }): EnsPair[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: n }, (_, i) => {
    const pm = 0.05 + 0.9 * rnd();
    const pk = Math.min(0.97, Math.max(0.03, pm + 0.3 * (rnd() - 0.5)));
    const p = sig(truth.a + truth.bm * logit(pm) + truth.bk * logit(pk));
    return { pm, pk, y: rnd() < p ? 1 : 0, t: NOW - (n - i) * 15 * 60_000 };
  });
}

describe('pooling logarytmiczny', () => {
  it('prior = równy pooling logarytmiczny: σ(½ logit pm + ½ logit pk)', () => {
    expect(poolProb(ENS_PRIOR, 0.7, 0.6)).toBeCloseTo(sig(0.5 * logit(0.7) + 0.5 * logit(0.6)), 12);
    expect(poolProb(ENS_PRIOR, 0.5, 0.5)).toBeCloseTo(0.5, 12);
    expect(poolProb({ a: 0, bm: 1, bk: 0, n: 0 }, 0.8, 0.1)).toBeCloseTo(0.8, 12);
  });
  it('logit odporny na 0 i 1 (obcięcie)', () => {
    expect(Number.isFinite(logit(0))).toBe(true);
    expect(Number.isFinite(logit(1))).toBe(true);
  });
});

describe('dopasowanie wag z dziennika', () => {
  it('za mało par → prior (z liczbą par)', () => {
    const w = fitEnsemble(gen(1, 30, { a: 0, bm: 1, bk: 0 }), NOW);
    expect(w).toEqual({ ...ENS_PRIOR, n: 30 });
  });
  it('odzyskuje wagi z danych (rynek lepiej skalibrowany niż model)', () => {
    const w = fitEnsemble(gen(2, 6000, { a: 0.1, bm: 0.2, bk: 1.0 }), NOW, { halfLifeDays: 1e9 });
    expect(w.n).toBe(6000);
    expect(w.bk).toBeGreaterThan(0.75);
    expect(w.bk).toBeLessThan(1.25);
    expect(w.bm).toBeLessThan(0.45);
    expect(Math.abs(w.a - 0.1)).toBeLessThan(0.2);
  });
  it('tylko pary rozstrzygnięte przed chwilą dopasowania (bez zaglądania w przyszłość)', () => {
    const past = gen(3, 200, { a: 0, bm: 0.5, bk: 0.5 });
    const future = gen(4, 5000, { a: 2, bm: 0, bk: 0 }).map((p, i) => ({ ...p, t: NOW + (i + 1) * 60_000 }));
    const w = fitEnsemble([...past, ...future], NOW);
    expect(w.n).toBe(200);
    expect(Math.abs(w.a)).toBeLessThan(0.5);
  });
  it('pary bezużyteczne (wynik niezależny od p) → wagi ściągane do zera, nie wybuchają', () => {
    const rnd = mulberry32(5);
    const pairs: EnsPair[] = Array.from({ length: 400 }, (_, i) => ({ pm: 0.05 + 0.9 * rnd(), pk: 0.05 + 0.9 * rnd(), y: rnd() < 0.5 ? 1 : 0, t: NOW - (i + 1) * 60_000 }));
    const w = fitEnsemble(pairs, NOW);
    expect(Math.abs(w.bm)).toBeLessThan(0.6);
    expect(Math.abs(w.bk)).toBeLessThan(0.6);
    expect([w.a, w.bm, w.bk].every(Number.isFinite)).toBe(true);
  });
  it('wagi zanikające w czasie: nowy reżim przeważa nad starym', () => {
    const old = gen(6, 3000, { a: 0, bm: 1, bk: 0 }).map((p, i) => ({ ...p, t: NOW - 120 * DAY + i * 60_000 }));
    const recent = gen(7, 3000, { a: 0, bm: 0, bk: 1 }).map((p, i) => ({ ...p, t: NOW - 5 * DAY + i * 60_000 }));
    const w = fitEnsemble([...old, ...recent], NOW, { halfLifeDays: 14 });
    expect(w.bk).toBeGreaterThan(w.bm);
  });
});
