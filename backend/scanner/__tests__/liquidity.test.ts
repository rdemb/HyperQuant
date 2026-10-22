import { describe, expect, it } from 'vitest';
import { bookSnap, liquidityProfile, minuteRows, type MinuteRow } from '../liquidity.ts';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 22, 10, 0);
const lv = (px: number, sz: number) => ({ px: String(px), sz: String(sz), n: 1 });

describe('migawka płynności', () => {
  it('głębokość USD po obu stronach w ±10 i ±20 bp od środka', () => {
    // środek 100 000: ±10 bp = ±100 USD, ±20 bp = ±200 USD
    const s = bookSnap(T0, [
      [lv(99_990, 1), lv(99_900, 2), lv(99_850, 4)],
      [lv(100_010, 1), lv(100_150, 3), lv(100_300, 5)],
    ])!;
    expect(s.mid).toBe(100_000);
    expect(s.b10).toBeCloseTo(99_990 + 2 * 99_900, 6);
    expect(s.b20).toBeCloseTo(99_990 + 2 * 99_900 + 4 * 99_850, 6);
    expect(s.a10).toBeCloseTo(100_010, 6);
    expect(s.a20).toBeCloseTo(100_010 + 3 * 100_150, 6);
    expect(bookSnap(T0, [[], [lv(1, 1)]])).toBeNull();
    expect(bookSnap(T0, [[lv(101, 1)], [lv(100, 1)]])).toBeNull(); // skrzyżowany
  });

  it('wiersze minutowe = mediany migawek; minuta w toku pominięta', () => {
    const snaps = [0, 5_000, 10_000, 61_000].map((dt, i) => ({ t: T0 + dt, mid: 100_000 + i, b10: 10 * (i + 1), a10: 1, b20: 2, a20: 2 }));
    const rows = minuteRows(snaps, T0 + 90_000);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ t: T0, n: 3, b10: 20, mid: 100_001 });
  });
});

describe('profil płynności', () => {
  const row = (t: number, d10: number, mid = 100_000): MinuteRow => ({ t, n: 12, mid, b10: d10 / 2, a10: d10 / 2, b20: d10, a20: d10 });

  it('mediana głębokości wg godziny UTC; bieżąca minuta względem normy jej godziny', () => {
    const rows = [...Array.from({ length: 60 }, (_, i) => row(T0 + i * MIN, 1_000_000)), ...Array.from({ length: 60 }, (_, i) => row(T0 + 3_600_000 + i * MIN, 500_000))];
    const p = liquidityProfile(rows, 'BTC', T0 + 2 * 3_600_000);
    expect(p.byHour[10]).toMatchObject({ h: 10, d10: 1_000_000, n: 60 });
    expect(p.byHour[11]).toMatchObject({ d10: 500_000, n: 60 });
    expect(p.byHour[3]).toMatchObject({ d10: null, n: 0 });
    expect(p.now).toMatchObject({ d10: 500_000, ratio10: 1 });
  });

  it('odporność: po ruchu ≥ 15 bp liczba minut do powrotu głębokości do 80% mediany z poprzedniej godziny', () => {
    const rows: MinuteRow[] = Array.from({ length: 60 }, (_, i) => row(T0 + i * MIN, 1_000_000));
    rows.push(row(T0 + 60 * MIN, 200_000, 100_200)); // skok 20 bp, płynność wycofana
    rows.push(row(T0 + 61 * MIN, 300_000, 100_200));
    rows.push(row(T0 + 62 * MIN, 900_000, 100_200)); // powrót po 2 min
    const p = liquidityProfile(rows, 'BTC', T0 + 70 * MIN);
    expect(p.resilience).toEqual({ events: 1, medianMin: 2, unrecovered: 0 });
  });
});

import { LiquidityRecorder } from '../liquidity.ts';

describe('LiquidityRecorder', () => {
  const book = (mid: number, sz: number) => [[lv(mid - 5, sz)], [lv(mid + 5, sz)]];
  it('zamyka pełne minuty raz (bez duplikatów); minuta w toku czeka', () => {
    const r = new LiquidityRecorder('BTC');
    r.onBook(T0 + 1_000, book(100_000, 1));
    r.onBook(T0 + 30_000, book(100_000, 3));
    r.onBook(T0 + 61_000, book(100_000, 2));
    const first = r.flush(T0 + 90_000);
    expect(first.map((x) => x.t)).toEqual([T0]);
    expect(r.flush(T0 + 95_000)).toEqual([]);
    expect(r.flush(T0 + 125_000).map((x) => x.t)).toEqual([T0 + MIN]);
  });
  it('wczytanie stanu: tylko ostatnie 30 dni; profil z datą początku historii', () => {
    const r = new LiquidityRecorder('BTC');
    const old = { t: T0 - 40 * 24 * 3_600_000, n: 1, mid: 1, b10: 1, a10: 1, b20: 1, a20: 1 };
    const recent = { t: T0 - 5 * MIN, n: 1, mid: 100_000, b10: 10, a10: 10, b20: 20, a20: 20 };
    r.load([old, recent], T0);
    const p = r.profile(T0);
    expect(p.minutes).toBe(1);
    expect(p.since).toBe(recent.t);
    expect(p.coin).toBe('BTC');
  });
});
