import { describe, expect, it } from 'vitest';
import { AB_BLOCK_DAYS, AB_DESIGN, AB_EPOCH, AB_GRACE_MIN, AB_HAC_LAG, AB_MIN_N, abBlocks, fixedBCrit, neweyWest } from '../abTest';
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

describe('wartość krytyczna fixed-b (Kiefer & Vogelsang 2005, Bartlett, dwustronnie 95%)', () => {
  it('b → 0 daje 1,96; rośnie z udziałem opóźnienia w próbie', () => {
    expect(fixedBCrit(0)).toBeCloseTo(1.96, 9);
    expect(fixedBCrit(0.1)).toBeCloseTo(1.96 + 0.29694 + 0.00416 - 0.0005324, 6);
    expect(fixedBCrit(0.5)).toBeGreaterThan(fixedBCrit(0.1));
  });
  it(`pokrycie przedziału przy silnej autokorelacji (AR(1), φ = 0,9) i n = ${AB_MIN_N} bliskie 95%`, () => {
    const rnd = mulberry32(77);
    const g = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const reps = 300;
    let cover = 0;
    for (let k = 0; k < reps; k++) {
      let x = g() / Math.sqrt(1 - 0.81);
      const pts = [];
      for (let i = 0; i < AB_MIN_N; i++) {
        x = 0.9 * x + g();
        pts.push({ slot: i * SLOT, d: x });
      }
      const nw = neweyWest(pts)!;
      const cv = fixedBCrit((AB_HAC_LAG + 1) / AB_MIN_N);
      if (Math.abs(nw.mean) <= cv * nw.se) cover++;
    }
    expect(cover / reps).toBeGreaterThan(0.88);
  });
});

describe('A/B w z góry ustalonych okresach 14 dni od AB_EPOCH', () => {
  const rows = (from: number, to: number, f: (i: number) => { crpsA: number; crpsB: number }) => {
    const out = [];
    for (let s = from, i = 0; s < to; s += SLOT, i++) out.push({ slot: s, ...f(i) });
    return out;
  };
  const len = AB_BLOCK_DAYS * DAY;
  const grace = AB_GRACE_MIN * 60_000;
  it('przed AB_EPOCH — brak okresów; rekordy sprzed AB_EPOCH nie wchodzą do oceny', () => {
    expect(abBlocks([], AB_EPOCH - 1)).toEqual({ current: null, closing: null, last: null });
    const r = abBlocks(rows(AB_EPOCH - DAY, AB_EPOCH + DAY, () => ({ crpsA: 1, crpsB: 2 })), AB_EPOCH + 2 * DAY);
    expect(r.current).toMatchObject({ start: AB_EPOCH, end: AB_EPOCH + len, n: 96, diff: null });
    expect(r.closing).toBeNull();
    expect(r.last).toBeNull();
  });
  it('zapas na rozstrzygnięcia: horyzont + unieważnienie po 6 h + 15 min', () => {
    expect(AB_GRACE_MIN).toBe(60 + 6 * 60 + 15);
  });
  it('w toku i w rozliczaniu — bez przedziału (bez podglądania); zakończony — z przedziałem HAC fixed-b', () => {
    const rnd = mulberry32(11);
    const all = rows(AB_EPOCH, AB_EPOCH + len + 3 * DAY, () => {
      const a = 0.002 + 0.0005 * rnd();
      return { crpsA: a, crpsB: a - 0.0001 + 0.0002 * (rnd() - 0.5) };
    });
    // Koniec okresu minął, ale bez pełnego zapasu na rozstrzygnięcia — okres „w rozliczaniu”, nadal widoczny
    const early = abBlocks(all, AB_EPOCH + len + grace - 1);
    expect(early.last).toBeNull();
    expect(early.closing).toMatchObject({ start: AB_EPOCH, n: AB_BLOCK_DAYS * 96, diff: null });
    expect(early.current).toMatchObject({ start: AB_EPOCH + len });
    const r = abBlocks(all, AB_EPOCH + len + 3 * DAY);
    expect(r.closing).toBeNull();
    expect(r.last).toMatchObject({ start: AB_EPOCH, end: AB_EPOCH + len, n: AB_BLOCK_DAYS * 96 });
    expect(r.last!.diff!.d).toBeCloseTo(-0.0001, 4);
    expect(r.last!.diff!.hi).toBeLessThan(0);
    expect(r.last!.diff!.lo).toBeLessThan(r.last!.diff!.d);
    // Szerokość = 2 · cv(b) · se, b = (L + 1) / n
    const nw = neweyWest(all.filter((x) => x.slot < AB_EPOCH + len).map((x) => ({ slot: x.slot, d: x.crpsB - x.crpsA })))!;
    const cv = fixedBCrit((AB_HAC_LAG + 1) / (AB_BLOCK_DAYS * 96));
    expect(r.last!.diff!.hi - r.last!.diff!.lo).toBeCloseTo(2 * cv * nw.se, 7);
    expect(r.current).toMatchObject({ start: AB_EPOCH + len, n: 3 * 96, diff: null });
    expect(r.current!.crpsB).toBeLessThan(r.current!.crpsA!);
  });
  it(`zakończony okres z mniej niż ${AB_MIN_N} parami (7 dni) — średnie bez przedziału i bez wniosku`, () => {
    expect(AB_MIN_N).toBe(7 * 96);
    const r = abBlocks(rows(AB_EPOCH, AB_EPOCH + 6 * DAY, () => ({ crpsA: 1, crpsB: 1.1 })), AB_EPOCH + len + DAY);
    expect(r.last).toMatchObject({ n: 6 * 96, diff: null });
    expect(r.last!.crpsB).toBeCloseTo(1.1, 8);
  });
  it('plan A/B do prerejestracji: zwykły JSON ze stałymi oceny', () => {
    expect(AB_DESIGN).toMatchObject({ id: 'ab-v1', h: 60, epoch: AB_EPOCH, blockDays: AB_BLOCK_DAYS, hacLag: AB_HAC_LAG, minN: AB_MIN_N, graceMin: AB_GRACE_MIN });
    expect(JSON.parse(JSON.stringify(AB_DESIGN))).toEqual(AB_DESIGN);
  });
});
