import { describe, expect, it } from 'vitest';
import { computeAuctionContext } from '../useAuctionContext';
import type { VBar } from '../../utils/auction';

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;
const TODAY = Date.UTC(2026, 9, 22);

/** Świece o stałym zakresie ±5 USD wokół `mid` (wolumen 1) od `from` przez `n` interwałów. */
function flat(from: number, n: number, step: number, mid: number): VBar[] {
  return Array.from({ length: n }, (_, i) => ({ time: from + i * step, open: mid, high: mid + 5, low: mid - 5, close: mid, volume: 1 }));
}

describe('computeAuctionContext — poziomy i stan sesji ze świec', () => {
  const now = TODAY + 3 * H + 30 * MIN;
  const minute = [...flat(TODAY - D, 1440, MIN, 100_000), ...flat(TODAY, 210, MIN, 100_300)];
  const hourly = [...Array.from({ length: 40 }, (_, d) => flat(TODAY - (40 - d) * D, 24, H, 100_000)).flat(), ...flat(TODAY, 4, H, 100_300)];
  const ctx = computeAuctionContext(minute, hourly, now);

  it('VWAP bieżącej sesji z 1m; IB z pierwszej godziny i zamknięty po 01:00 UTC', () => {
    expect(ctx.status).toBe('ready');
    expect(ctx.vwap!.vwap).toBeCloseTo(100_300, 6);
    expect(ctx.ib).toEqual({ hi: 100_305, lo: 100_295, done: true });
  });

  it('profil poprzedniej sesji z 1m (pełny dzień) i stan dzisiejszy w regułach statystyki (1h)', () => {
    expect(ctx.prev!.high).toBe(100_005);
    expect(ctx.prev!.low).toBe(99_995);
    expect(ctx.today!.openLoc).toBe('above');
    expect(ctx.today!.prev1h.high).toBe(100_005);
    expect(ctx.stats!.n).toBe(39); // 40 pełnych sesji → 39 par
  });

  it('niepełna poprzednia sesja w 1m (< 23 h danych) → bez profilu zamiast profilu z dziurą', () => {
    const partial = computeAuctionContext([...flat(TODAY - 10 * H, 600, MIN, 100_000), ...flat(TODAY, 210, MIN, 100_300)], hourly, now);
    expect(partial.prev).toBeNull();
  });
});
