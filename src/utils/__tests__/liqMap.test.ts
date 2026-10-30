import { describe, expect, it } from 'vitest';
import { LIQ_MIN_N, ScannedPosition, buildLiqMap, isLiqMap, niceStep } from '../liqMap';

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
    const m = buildLiqMap([pos(2, 82040), pos(1, 82010), pos(0.5, 82090)], opts);
    expect(m.stepUsd).toBe(100);
    expect(m.longs).toEqual([{ px: 82000, ntlUsd: 2 * 82040 + 82010 + 0.5 * 82090, n: 3 }]);
    expect(m.shorts).toEqual([]);
  });

  it('shorty osobno; kubełki posortowane rosnąco po cenie i sumowane', () => {
    const m = buildLiqMap([pos(-1, 85010), pos(-3, 85090), pos(-2, 85050), pos(-1, 84520), pos(-1, 84530), pos(-1, 84540)], opts);
    expect(m.shorts).toEqual([
      { px: 84500, ntlUsd: 84520 + 84530 + 84540, n: 3 },
      { px: 85000, ntlUsd: 85010 + 3 * 85090 + 2 * 85050, n: 3 },
    ]);
  });

  it(`kubełek z mniej niż ${LIQ_MIN_N} pozycjami: nominał do 2 cyfr znaczących, nie dokładne |szi|·liq`, () => {
    const m = buildLiqMap([pos(2.345, 82040), pos(-1, 85010), pos(-3, 85090)], opts);
    expect(m.longs).toEqual([{ px: 82000, ntlUsd: 190_000, n: 1 }]);
    expect(m.shorts).toEqual([{ px: 85000, ntlUsd: 340_000, n: 2 }]);
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
    expect(m.ageMin).toEqual({ p50: 0, p90: 0, ntlP50: 0 });
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

describe('buildLiqMap — rzetelność danych (poprawki po recenzji)', () => {
  it('long z ceną likwidacji ≥ mark i short ≤ mark (nieaktualny odczyt) nie trafiają do kubełków, są liczone osobno', () => {
    const m = buildLiqMap([pos(2, 83100), pos(-1, 82900), pos(1, 82000)], opts);
    expect(m.longs).toEqual([{ px: 82000, ntlUsd: 82000, n: 1 }]);
    expect(m.shorts).toEqual([]);
    expect(m.coverage.wrongSide).toBe(2);
  });

  it('pokrycie rozbite na longi i shorty (samokontrola symetrii OI)', () => {
    const m = buildLiqMap([pos(3, 80000), pos(-2, 86000), pos(-1, null)], opts);
    expect(m.coverage.longBtc).toBe(3);
    expect(m.coverage.shortBtc).toBe(3);
  });

  it('wiek ważony nominałem: duża świeża pozycja przeważa nad wieloma starymi małymi', () => {
    const big = { szi: 100, entryPx: 83000, liqPx: 80000, scannedAt: T - 1 * 60_000 };
    const smalls = Array.from({ length: 9 }, () => ({ szi: 0.1, entryPx: 83000, liqPx: 80000, scannedAt: T - 60 * 60_000 }));
    const m = buildLiqMap([big, ...smalls], opts);
    expect(m.ageMin.p50).toBeCloseTo(60, 9);
    expect(m.ageMin.ntlP50).toBeCloseTo(1, 9);
  });

  it('czas kontekstu rynku (mark, OI) jest publikowany', () => {
    expect(buildLiqMap([], { ...opts, ctxAt: T - 30_000 }).ctxAt).toBe(T - 30_000);
    expect(buildLiqMap([], opts).ctxAt).toBe(T);
  });

  it('isLiqMap wymaga liczności, czasu kontekstu i wieku ważonego', () => {
    const ok = buildLiqMap([pos(1, 82000)], opts);
    expect(isLiqMap({ ...ok, coverage: { ...ok.coverage, positions: 'x' } })).toBe(false);
    expect(isLiqMap({ ...ok, ctxAt: undefined })).toBe(false);
    expect(isLiqMap({ ...ok, ageMin: { p50: 1, p90: 2 } })).toBe(false);
  });
});
