import { describe, expect, it } from 'vitest';
import { LiqMap } from '../liqMap';
import { liqMapFreshness, nearestClusters, rebin, stopNearCluster } from '../liqMapView';

const T = 1_800_000_000_000;
const map: LiqMap = {
  v: 1,
  coin: 'BTC',
  asOf: T,
  markPx: 83000,
  stepUsd: 100,
  longs: [
    { px: 79000, ntlUsd: 5e6, n: 4 },
    { px: 80000, ntlUsd: 0.5e6, n: 2 },
    { px: 81000, ntlUsd: 2e6, n: 3 },
  ],
  shorts: [
    { px: 84000, ntlUsd: 0.3e6, n: 1 },
    { px: 86000, ntlUsd: 3e6, n: 5 },
  ],
  coverage: { positions: 15, addresses: 40, scannedBtc: 10, oiBtc: 100, share: 0.05 },
  ageMin: { p50: 2, p90: 8 },
  method: 'hl-clearinghouse-v1',
};

describe('liqMapFreshness', () => {
  it('do 10 min od asOf — aktualna; starsza — nieświeża (nigdy jako LIVE)', () => {
    expect(liqMapFreshness(map, T + 9 * 60_000)).toBe('ready');
    expect(liqMapFreshness(map, T + 11 * 60_000)).toBe('stale');
  });
});

describe('nearestClusters — najbliższy istotny klaster pod i nad ceną', () => {
  it('pomija kubełki poniżej progu; odległość liczona od środka kubełka', () => {
    const c = nearestClusters(map, 1e6);
    expect(c.below).toEqual({ px: 81050, ntlUsd: 2e6, distPct: 81050 / 83000 - 1 });
    expect(c.above).toEqual({ px: 86050, ntlUsd: 3e6, distPct: 86050 / 83000 - 1 });
  });
  it('brak istotnych klastrów → null', () => {
    expect(nearestClusters(map, 1e9)).toEqual({ below: null, above: null });
  });
});

describe('stopNearCluster — stop w strefie klastra likwidacji (ryzyko przestrzelenia)', () => {
  it('LONG: longi likwidowane w paśmie ±0.2% wokół stopu', () => {
    expect(stopNearCluster(map, 'LONG', 81000)).toEqual({ ntlUsd: 2e6, positions: 3 });
  });
  it('SHORT: shorty wokół stopu; poniżej progu → null', () => {
    expect(stopNearCluster(map, 'SHORT', 86100)).toEqual({ ntlUsd: 3e6, positions: 5 });
    expect(stopNearCluster(map, 'SHORT', 84000)).toBeNull();
    expect(stopNearCluster(map, 'LONG', 83000)).toBeNull();
  });
});

describe('rebin — agregacja kubełków do histogramu', () => {
  it('N przedziałów w ±zakresie wokół ceny; suma nominału w zakresie zachowana', () => {
    const r = rebin(map.longs, map.markPx, 0.05, 10);
    expect(r).toHaveLength(10);
    const total = r.reduce((a, b) => a + b.ntlUsd, 0);
    expect(total).toBeCloseTo(7.5e6, 6);
    expect(r[0].from).toBeCloseTo(83000 * 0.95, 6);
    expect(r[9].to).toBeCloseTo(83000 * 1.05, 6);
  });
});
