import { describe, expect, it } from 'vitest';
import { completeHourly, computeAuctionContext, hourlyStale, mergeMinute } from '../useAuctionContext';
import type { VBar } from '../../utils/auction';

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;
const TODAY = Date.UTC(2026, 9, 22);

/** Świece o stałym zakresie ±5 USD wokół `mid` (wolumen 1) od `from` przez `n` interwałów. */
function flat(from: number, n: number, step: number, mid: number): VBar[] {
  return Array.from({ length: n }, (_, i) => ({ time: from + i * step, open: mid, high: mid + 5, low: mid - 5, close: mid, volume: 1 }));
}

describe('świece 1h: tylko zamknięte; odświeżenie po zmianie dnia UTC', () => {
  it('świeca godziny jeszcze trwającej w chwili pobrania jest odrzucana', () => {
    const bars = flat(TODAY - 2 * H, 3, H, 100_000); // 22:00, 23:00, 00:00
    expect(completeHourly(bars, TODAY - 20 * MIN).map((b) => b.time)).toEqual([TODAY - 2 * H]); // 23:00 trwa
    expect(completeHourly(bars, TODAY + H).map((b) => b.time)).toEqual([TODAY - 2 * H, TODAY - H, TODAY]);
  });
  it('pamięć 1h nieaktualna po 30 min albo po północy UTC (wczorajsza sesja musi być kompletna)', () => {
    expect(hourlyStale(null, TODAY)).toBe(true);
    expect(hourlyStale(TODAY - 20 * MIN, TODAY + 5 * MIN)).toBe(true); // pobrane 23:40, teraz 00:05
    expect(hourlyStale(TODAY + MIN, TODAY + 20 * MIN)).toBe(false);
    expect(hourlyStale(TODAY + MIN, TODAY + 40 * MIN)).toBe(true);
  });
});

describe('świece 1m: dociąganie końcówki zamiast całej doby', () => {
  it('nowe świece zastępują ostatnią (trwającą); starsze niż początek poprzedniej sesji odpadają', () => {
    const cache = flat(TODAY - D - 2 * MIN, 5, MIN, 100_000); // dwie sprzed poprzedniej sesji
    const fresh = [{ ...cache[4], close: 100_050, high: 100_060 }, ...flat(cache[4].time + MIN, 2, MIN, 100_100)];
    const merged = mergeMinute(cache, fresh, TODAY - D);
    expect(merged.map((b) => b.time)).toEqual([TODAY - D, TODAY - D + MIN, TODAY - D + 2 * MIN, TODAY - D + 3 * MIN, TODAY - D + 4 * MIN]);
    expect(merged[2]).toEqual(fresh[0]);
  });
});

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
