import { describe, expect, it } from 'vitest';
import { AB_BLOCK_DAYS, AB_EPOCH, AB_MIN_N, abBlocks, neweyWest } from '../abTest';
import { mulberry32 } from '../pathEngine';

const SLOT = 15 * 60_000;
const DAY = 86_400_000;
const HOUR = 3_600_000;

describe('Newey–West (Bartlett) — błąd standardowy średniej szeregu na siatce slotów', () => {
  it('bez autokorelacji ≈ σ/√n; przy dodatniej autokorelacji (MA) wyraźnie większy niż naiwny', () => {
    const rnd = mulberry32(5);
    const g = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const n = 4000;
    const white = Array.from({ length: n }, (_, i) => ({ slot: i * SLOT, d: g() }));
    const nw = neweyWest(white, 20)!;
    expect(nw.se).toBeGreaterThan(0.8 / Math.sqrt(n));
    expect(nw.se).toBeLessThan(1.2 / Math.sqrt(n));
    // MA(3): suma 4 kolejnych szoków — jak nakładające się horyzonty 1 h przy slotach 15 min
    const e = Array.from({ length: n + 3 }, g);
    const ma = Array.from({ length: n }, (_, i) => ({ slot: i * SLOT, d: e[i] + e[i + 1] + e[i + 2] + e[i + 3] }));
    const naive = Math.sqrt(ma.reduce((s, p) => s + p.d * p.d, 0) / n / n);
    const hac = neweyWest(ma, 20)!;
    // Wariancja długookresowa MA(3) = 16 vs wariancja 4 → błąd ~2× większy
    expect(hac.se / naive).toBeGreaterThan(1.6);
    expect(hac.se / naive).toBeLessThan(2.4);
  });
  it('luki w siatce: autokowariancje tylko z par istniejących slotów; za mało punktów → null', () => {
    const pts = [0, 1, 2, 5, 6, 9].map((k) => ({ slot: k * SLOT, d: k % 2 ? 1 : -1 }));
    const r = neweyWest(pts, 3)!;
    expect(r.mean).toBeCloseTo(0, 12);
    expect(Number.isFinite(r.se)).toBe(true);
    expect(neweyWest([{ slot: 0, d: 1 }], 3)).toBeNull();
  });
});

describe('A/B w z góry ustalonych okresach 14 dni od AB_EPOCH', () => {
  const rows = (from: number, to: number, f: (i: number) => { crpsA: number; crpsB: number }) => {
    const out = [];
    for (let s = from, i = 0; s < to; s += SLOT, i++) out.push({ slot: s, ...f(i) });
    return out;
  };
  it('przed AB_EPOCH — brak okresów; rekordy sprzed AB_EPOCH nie wchodzą do oceny', () => {
    expect(abBlocks([], AB_EPOCH - 1)).toEqual({ current: null, last: null });
    const r = abBlocks(rows(AB_EPOCH - DAY, AB_EPOCH + DAY, () => ({ crpsA: 1, crpsB: 2 })), AB_EPOCH + 2 * DAY);
    expect(r.current).toMatchObject({ start: AB_EPOCH, end: AB_EPOCH + AB_BLOCK_DAYS * DAY, n: 96, diff: null });
    expect(r.last).toBeNull();
  });
  it('okres w toku: liczności i średnie bez przedziału (bez podglądania); zakończony (koniec + h + 1 h) — z przedziałem HAC', () => {
    const rnd = mulberry32(11);
    const len = AB_BLOCK_DAYS * DAY;
    const all = rows(AB_EPOCH, AB_EPOCH + len + 3 * DAY, () => {
      const a = 0.002 + 0.0005 * rnd();
      return { crpsA: a, crpsB: a - 0.0001 + 0.0002 * (rnd() - 0.5) };
    });
    const early = abBlocks(all, AB_EPOCH + len + HOUR);
    // Koniec okresu minął, ale bez zapasu na rozstrzygnięcia — jeszcze nie zakończony
    expect(early.last).toBeNull();
    const r = abBlocks(all, AB_EPOCH + len + 3 * DAY);
    expect(r.last).toMatchObject({ start: AB_EPOCH, end: AB_EPOCH + len, n: AB_BLOCK_DAYS * 96 });
    expect(r.last!.diff!.d).toBeCloseTo(-0.0001, 4);
    expect(r.last!.diff!.hi).toBeLessThan(0);
    expect(r.last!.diff!.lo).toBeLessThan(r.last!.diff!.d);
    expect(r.current).toMatchObject({ start: AB_EPOCH + len, n: 3 * 96, diff: null });
    expect(r.current!.crpsB).toBeLessThan(r.current!.crpsA!);
  });
  it(`zakończony okres z mniej niż ${AB_MIN_N} parami — średnie bez przedziału i bez wniosku`, () => {
    const len = AB_BLOCK_DAYS * DAY;
    const r = abBlocks(rows(AB_EPOCH, AB_EPOCH + DAY, () => ({ crpsA: 1, crpsB: 1.1 })), AB_EPOCH + len + DAY);
    expect(r.last).toMatchObject({ n: 96, diff: null });
    expect(r.last!.crpsB).toBeCloseTo(1.1, 8);
  });
});
