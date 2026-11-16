import { describe, expect, it } from 'vitest';
import { USUAL_BAND_MIN, quantile7, usualBand } from '../indicators/primitives';

describe('pasmo zwykłości (plan 59, H1)', () => {
  it('kwantyl typu 7 (interpolacja liniowa) jak w R i NumPy', () => {
    const a = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(quantile7(a, 0.1)).toBeCloseTo(1.9);
    expect(quantile7(a, 0.9)).toBeCloseTo(9.1);
    expect(quantile7(a, 0.5)).toBeCloseTo(5.5);
  });

  it('p10–p90 z ostatnich N zamkniętych świec (bez świecy w toku), NaN pomijane', () => {
    const v = new Float64Array(1200).fill(Number.NaN);
    for (let i = 0; i < 1100; i++) v[i] = i % 100; // 0..99 powtarzane
    v[1199] = 1e9; // świeca w toku: poza pasmem
    const b = usualBand(v, 1199, 1000);
    expect(b).not.toBeNull();
    expect(b!.n).toBe(1000);
    expect(b!.lo).toBeCloseTo(9.9, 1);
    expect(b!.hi).toBeCloseTo(89.1, 1);
  });

  it('progi Pioniera: 199 świec — brak pasma; 200 — krótka próba; 500 — pełne pasmo', () => {
    const v = (n: number) => Float64Array.from({ length: n }, (_, i) => i);
    expect(usualBand(v(199), 199, 10_000)).toEqual({ lo: Number.NaN, hi: Number.NaN, n: 199, short: true });
    const krotka = usualBand(v(200), 200, 10_000);
    expect(krotka.short).toBeUndefined();
    expect(krotka.brief).toBe(true);
    expect(krotka.lo).toBeCloseTo(19.9);
    const pelna = usualBand(v(500), 500, 10_000);
    expect(pelna.brief).toBeUndefined();
    expect(pelna.short).toBeUndefined();
    expect(USUAL_BAND_MIN).toBe(200);
  });

  it('miara łączona (szerokość: kupujący + sprzedający; TWAP: kupno + |sprzedaż|)', () => {
    const buy = Float64Array.from({ length: 600 }, () => 2);
    const sell = Float64Array.from({ length: 600 }, () => -3);
    const b = usualBand([buy, sell], 600, 600, 'sumAbs');
    expect(b.brief).toBeUndefined();
    expect(b!.lo).toBeCloseTo(5);
    expect(b!.hi).toBeCloseTo(5);
  });
});

describe('pasmo zwykłości w rejestrze', () => {
  it('8 wskaźników z planu 59 ma pasmo; szerokość i TWAP jako miara łączona; RVOL i Hawkes bez pasma', async () => {
    const { indicatorDef } = await import('../indicators/registry');
    for (const id of ['absorption', 'ofi', 'oiflow', 'repeat', 'slippage', 'regime'] as const) expect(indicatorDef(id).usualBand).toEqual({});
    for (const id of ['breadth', 'twap'] as const) expect(indicatorDef(id).usualBand).toEqual({ combine: 'sumAbs' });
    for (const id of ['rvol', 'hawkes'] as const) expect(indicatorDef(id).usualBand).toBeUndefined();
  });
});
