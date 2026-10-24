import { describe, expect, it } from 'vitest';
import type { Candle } from '../hl/parse';
import { TPO_PERIOD_MS, tpoInterval, tpoPocPx, tpoProfiles, tpoSingles } from '../core/tpo';
import { DAY } from '../core/time';

const D0 = 20_000 * DAY;
const bar = (t: number, l: number, h: number) => ({ t, candle: { t, o: l, h, l, c: h, v: 1, n: 1 } as Candle });

describe('TPO', () => {
  it('litery okresów w wierszach, POC, value area i initial balance z dwóch pierwszych okresów', () => {
    const P = TPO_PERIOD_MS;
    const bars = [
      // A: 100–103, B: 101–102 (dwie świece 15m), C: 102–102, D: 99–100
      bar(D0, 100, 103),
      bar(D0 + P, 101, 101.5),
      bar(D0 + P + P / 2, 101.2, 102),
      bar(D0 + 2 * P, 102, 102.4),
      bar(D0 + 3 * P, 99, 100),
      // Następna doba zamyka profil
      bar(D0 + DAY, 100, 101),
    ];
    const [p, next] = tpoProfiles(bars, 1);
    expect(p.day).toBe(D0);
    expect(p.complete).toBe(true);
    expect(next.complete).toBe(false);
    expect(p.lo).toBe(99);
    // Wiersze 99..103: D | A D | A B | A B C | A
    expect(p.rows).toEqual([[3], [0, 3], [0, 1], [0, 1, 2], [0]]);
    expect(p.poc).toBe(3);
    expect(tpoPocPx(p)).toBe(102.5);
    expect(p.ib).toEqual({ lo: 100, hi: 103 });
    expect(p.vaLo).toBeLessThanOrEqual(p.poc);
    expect(p.vaHi).toBeGreaterThanOrEqual(p.poc);
    expect(p.from).toBe(0);
    expect(p.to).toBe(4);
  });

  it('pojedyncze wydruki w środku i ogon z co najmniej dwóch wierszy na skraju', () => {
    const P = TPO_PERIOD_MS;
    const bars = [bar(D0, 100, 101), bar(D0 + P, 100, 101), bar(D0 + 2 * P, 100, 106), bar(D0 + 3 * P, 104, 105)];
    const [p] = tpoProfiles(bars, 1);
    // Wiersze 100..106: ABC ABC C C CD CD C
    const { singles, tails } = tpoSingles(p);
    expect(singles).toEqual([false, false, true, true, false, false, false]);
    // Jeden pojedynczy wiersz na górze to jeszcze nie ogon
    expect(tails).toEqual([false, false, false, false, false, false, false]);
    const [q] = tpoProfiles([...bars, bar(D0 + 4 * P, 104, 105)].slice(0, 3), 1);
    // Wiersze 100..106: AB AB B B B B B → ogon od 102 w górę
    expect(tpoSingles(q).tails).toEqual([false, false, true, true, true, true, true]);
  });

  it('tylko interwały równo dzielące 30 minut', () => {
    expect(tpoInterval(60_000)).toBe(true);
    expect(tpoInterval(3 * 60_000)).toBe(true);
    expect(tpoInterval(30 * 60_000)).toBe(true);
    expect(tpoInterval(3_600_000)).toBe(false);
  });
});
