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
    const w = fitEnsemble(gen(2, 2800, { a: 0.1, bm: 0.2, bk: 1.0 }), NOW, { halfLifeDays: 1e9 }); // 2800 × 15 min < 30 dni
    expect(w.n).toBe(2800);
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

describe('odporność dopasowania (recenzja: rozbieżny Newton)', () => {
  it('skrajne logity z błędnym wynikiem nie wysadzają wag: kontrola kroku i spadek celu', () => {
    const pairs: EnsPair[] = [];
    let t = NOW - 1000 * 60_000;
    for (let i = 0; i < 50; i++) {
      const p = [0.2, 0.5, 0.8][i % 3];
      pairs.push({ pm: p, pk: p, y: (i * 7919) % 100 < p * 100 ? 1 : 0, t: (t += 60_000) });
    }
    for (let i = 0; i < 3; i++) pairs.push({ pm: 0, pk: 0.03, y: 1, t: (t += 60_000) });
    const w = fitEnsemble(pairs, NOW);
    expect(Math.abs(w.bm)).toBeLessThan(2);
    expect(Math.abs(w.bk)).toBeLessThan(2);
    expect(poolProb(w, 0.6, 0.55)).toBeLessThan(0.9);
    expect(poolProb(w, 0.4, 0.45)).toBeGreaterThan(0.1);
  });
  it('fuzzing: model z p = 0/1 mylący się w 5% pytań — wagi zawsze skończone i umiarkowane', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = mulberry32(seed);
      const pairs: EnsPair[] = Array.from({ length: 50 + Math.floor(rnd() * 400) }, (_, i) => {
        const pk = 0.05 + 0.9 * rnd();
        const y: 0 | 1 = rnd() < pk ? 1 : 0;
        const wrong = rnd() < 0.05;
        const pm = wrong ? 1 - y : Math.min(1, Math.max(0, pk + 0.2 * (rnd() - 0.5)));
        return { pm, pk, y, t: NOW - (i + 1) * 60_000 };
      });
      const w = fitEnsemble(pairs, NOW);
      expect([w.a, w.bm, w.bk].every((v) => Number.isFinite(v) && Math.abs(v) < 5)).toBe(true);
    }
  });
  it('tylko okno 30 dni przed chwilą dopasowania (niezależne od czasu działania skanera)', () => {
    const old = gen(8, 500, { a: 3, bm: 0, bk: 0 }).map((p, i) => ({ ...p, t: NOW - 40 * DAY + i * 60_000 }));
    const recent = gen(9, 100, { a: 0, bm: 0.5, bk: 0.5 });
    const w = fitEnsemble([...old, ...recent], NOW);
    expect(w.n).toBe(100);
    expect(Math.abs(w.a)).toBeLessThan(1);
  });
  it('rekalibracja samego rynku: a + bk·logit(rynek), waga modelu zawsze 0 (punkt odniesienia dla ensemble)', () => {
    const w = fitEnsemble(gen(10, 3000, { a: 0.2, bm: 0, bk: 1.3 }), NOW, { mode: 'market', halfLifeDays: 1e9 });
    expect(w.bm).toBe(0);
    expect(w.bk).toBeGreaterThan(1.05);
    expect(w.bk).toBeLessThan(1.55);
    expect(fitEnsemble(gen(11, 10, { a: 0, bm: 0, bk: 1 }), NOW, { mode: 'market' })).toEqual({ a: 0, bm: 0, bk: 1, n: 10 });
  });
});
