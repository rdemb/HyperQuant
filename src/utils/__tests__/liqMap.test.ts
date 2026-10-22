import { describe, expect, it } from 'vitest';
import { ScannedPosition, buildLiqMap, isLiqMap, niceStep } from '../liqMap';

const T = 1_800_000_000_000;
const pos = (szi: number, liqPx: number | null, ageMin = 1): ScannedPosition => ({ szi, entryPx: 83000, liqPx, scannedAt: T - ageMin * 60_000 });
const opts = { coin: 'BTC', markPx: 83000, oiBtc: 100, asOf: T, addresses: 3 };

describe('niceStep — krok kubełków', () => {
  it('najbliższy „okrągły” krok do 0.1% ceny', () => {
    expect(niceStep(83)).toBe(100);
    expect(niceStep(31)).toBe(25);
    expect(niceStep(9)).toBe(10);
    expect(niceStep(2600)).toBe(1000);
  });
});

describe('buildLiqMap — mapa z pozycji on-chain', () => {
  it('long z ceną likwidacji 82 040 trafia do kubełka 82 000 (krok 100), nominał = |szi|·liq', () => {
    const m = buildLiqMap([pos(2, 82040)], opts);
    expect(m.stepUsd).toBe(100);
    expect(m.longs).toEqual([{ px: 82000, ntlUsd: 2 * 82040, n: 1 }]);
    expect(m.shorts).toEqual([]);
  });

  it('shorty osobno; kubełki posortowane rosnąco po cenie i sumowane', () => {
    const m = buildLiqMap([pos(-1, 85010), pos(-3, 85090), pos(-1, 84520)], opts);
    expect(m.shorts).toEqual([
      { px: 84500, ntlUsd: 84520, n: 1 },
      { px: 85000, ntlUsd: 85010 + 3 * 85090, n: 2 },
    ]);
  });

  it('ceny likwidacji poza ±15% od ceny są pomijane w kubełkach', () => {
    const m = buildLiqMap([pos(1, 60000), pos(-1, 120000)], opts);
    expect(m.longs).toEqual([]);
    expect(m.shorts).toEqual([]);
  });

  it('pozycja bez ceny likwidacji liczy się do pokrycia, nie do kubełków', () => {
    const m = buildLiqMap([pos(5, null), pos(-5, 90000)], opts);
    expect(m.longs).toEqual([]);
    expect(m.coverage.scannedBtc).toBe(10);
    expect(m.coverage.positions).toBe(2);
  });

  it('pokrycie OI = Σ|szi| / (2·OI) — OI z Hyperliquid to jedna strona rynku — i nie przekracza 1', () => {
    expect(buildLiqMap([pos(30, 80000), pos(-20, 86000)], opts).coverage.share).toBeCloseTo(0.25, 12);
    expect(buildLiqMap([pos(300, 80000)], opts).coverage.share).toBe(1);
    expect(buildLiqMap([pos(1, 80000)], { ...opts, oiBtc: 0 }).coverage.share).toBe(0);
  });

  it('wiek danych: p50 i p90 w minutach', () => {
    const m = buildLiqMap([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((a) => pos(1, 80000, a)), opts);
    expect(m.ageMin.p50).toBeCloseTo(5.5, 9);
    expect(m.ageMin.p90).toBeCloseTo(9.1, 9);
  });

  it('pusta lista → pusta mapa z zerowym pokryciem i wiekiem null-owym jako 0', () => {
    const m = buildLiqMap([], opts);
    expect(m.longs).toEqual([]);
    expect(m.coverage.share).toBe(0);
    expect(m.ageMin).toEqual({ p50: 0, p90: 0 });
    expect(m.v).toBe(1);
    expect(m.method).toBe('hl-clearinghouse-v1');
  });
});

describe('isLiqMap — walidacja danych z sieci', () => {
  it('akceptuje mapę z buildLiqMap, odrzuca złe kształty', () => {
    expect(isLiqMap(buildLiqMap([pos(1, 82000)], opts))).toBe(true);
    expect(isLiqMap(null)).toBe(false);
    expect(isLiqMap({ v: 2 })).toBe(false);
    expect(isLiqMap({ ...buildLiqMap([], opts), longs: 'x' })).toBe(false);
    expect(isLiqMap({ ...buildLiqMap([], opts), markPx: Number.NaN })).toBe(false);
  });
});
