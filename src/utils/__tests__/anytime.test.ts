import { describe, expect, it } from 'vitest';
import { bettingEProcess, bhQValues, eBH, effectCS, type BernEvent } from '../anytime';
import { mulberry32 } from '../pathEngine';

/** Zdarzenia z p0 losowym w [0,2; 0,8] i sukcesem z prawdopodobieństwem p0 + efekt (obcięte do [0, 1]). */
function simulate(seed: number, n: number, effect: number): BernEvent[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: n }, () => {
    const p0 = 0.2 + 0.6 * rnd();
    const p = Math.min(1, Math.max(0, p0 + effect));
    return { x: rnd() < p ? 1 : 0, p0 };
  });
}

describe('proces zakładów (e-wartości)', () => {
  it('pod H0 nierówność Ville’a: odsetek ścieżek z sup E ≥ 10 nie przekracza 10%', () => {
    let hits = 0;
    for (let s = 0; s < 200; s++) if (Math.max(...bettingEProcess(simulate(1000 + s, 300, 0))) >= 10) hits++;
    expect(hits / 200).toBeLessThanOrEqual(0.1);
  });
  it('przy efekcie +15 pp e-wartość po 300 zdarzeniach przekracza 100 w większości ścieżek', () => {
    let strong = 0;
    for (let s = 0; s < 50; s++) if (bettingEProcess(simulate(5000 + s, 300, 0.15)).at(-1)! >= 100) strong++;
    expect(strong / 50).toBeGreaterThanOrEqual(0.8);
  });
  it('pierwsze zdarzenie bez zakładu, e-wartość dodatnia, efekt przeciwny nie buduje dowodu', () => {
    const e = bettingEProcess(simulate(7, 300, -0.2));
    expect(e[0]).toBe(1);
    expect(Math.min(...e)).toBeGreaterThan(0);
    expect(e.at(-1)!).toBeLessThanOrEqual(1);
  });
});

describe('kontrola FDR', () => {
  it('e-BH: odrzuca k największych e-wartości z e₍ₖ₎ ≥ K/(α·k)', () => {
    expect(eBH([200, 15, 12, 1, 0.5], 0.1)).toEqual([true, false, false, false, false]);
    expect(eBH([30, 30, 30, 30, 30], 0.1)).toEqual([true, true, true, true, true]);
    expect(eBH([5, 3], 0.1)).toEqual([false, false]);
  });
  it('q-wartości Benjaminiego–Hochberga (monotoniczne, w kolejności wejścia)', () => {
    const q = bhQValues([0.01, 0.04, 0.03, 0.5]);
    expect(q[0]).toBeCloseTo(0.04, 10);
    expect(q[1]).toBeCloseTo(0.04 * 4 / 3, 10);
    expect(q[2]).toBeCloseTo(0.04 * 4 / 3, 10);
    expect(q[3]).toBeCloseTo(0.5, 10);
  });
});

describe('sekwencja ufności efektu', () => {
  it('pod H0 obejmuje 0 w ≥ 90% ścieżek', () => {
    let cover = 0;
    for (let s = 0; s < 100; s++) {
      const cs = effectCS(simulate(9000 + s, 300, 0), 0.1);
      if (cs && cs.lo <= 0 && cs.hi >= 0) cover++;
    }
    expect(cover / 100).toBeGreaterThanOrEqual(0.9);
  });
  it('przy efekcie +15 pp i 600 zdarzeniach wyklucza 0 i zawiera prawdziwy efekt; zawęża się z n', () => {
    const ev = simulate(42, 600, 0.15);
    const cs = effectCS(ev, 0.1)!;
    expect(cs.lo).toBeGreaterThan(0.03);
    expect(cs.lo).toBeLessThanOrEqual(0.15);
    expect(cs.hi).toBeGreaterThanOrEqual(0.15);
    const early = effectCS(ev.slice(0, 100), 0.1)!;
    expect(cs.hi - cs.lo).toBeLessThan(early.hi - early.lo);
  });
  it('brak zdarzeń → null', () => {
    expect(effectCS([], 0.1)).toBeNull();
  });
});
