import { describe, expect, it } from 'vitest';
import { isLiquidityProfile } from '../liquidity';

const ok = {
  v: 1,
  coin: 'BTC',
  asOf: 1,
  since: 0,
  days: 1,
  minutes: 60,
  byHour: Array.from({ length: 24 }, (_, h) => ({ h, d10: h === 3 ? null : 1e6, d20: 2e6, n: 60 })),
  now: { t: 0, d10: 1e6, d20: 2e6, ratio10: 1 },
  resilience: { events: 0, medianMin: null, unrecovered: 0 },
};

describe('isLiquidityProfile', () => {
  it('poprawny profil; brak godzin, zły typ albo NaN → odrzucony', () => {
    expect(isLiquidityProfile(ok)).toBe(true);
    expect(isLiquidityProfile({ ...ok, now: null })).toBe(true);
    expect(isLiquidityProfile({ ...ok, byHour: ok.byHour.slice(1) })).toBe(false);
    expect(isLiquidityProfile({ ...ok, now: { ...ok.now, d10: Number.NaN } })).toBe(false);
    expect(isLiquidityProfile({ ...ok, v: 2 })).toBe(false);
    expect(isLiquidityProfile(null)).toBe(false);
  });
});
