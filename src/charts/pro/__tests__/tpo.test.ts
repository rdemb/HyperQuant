import { describe, expect, it } from 'vitest';
import type { Candle } from '../hl/parse';
import { FootprintBuilder } from '../core/footprintBar';
import { TPO_PERIOD_MS, tpoDays, tpoInterval, tpoPocPx, tpoProfiles, tpoSingles } from '../core/tpo';
import { DAY } from '../core/time';
import { deltaLevel, rowTip } from '../chart/tpoLayer';

const D0 = 20_000 * DAY;
const P = TPO_PERIOD_MS;
const bar = (t: number, l: number, h: number) => ({ t, candle: { t, o: l, h, l, c: h, v: 1, n: 1 } as Candle });

describe('profil aukcji doby (TPO + wolumen + agresja)', () => {
  it('okresy w wierszach (czas), POC i value area z wolumenu, initial balance z dwóch pierwszych okresów', () => {
    const bars = [
      // A: 100–103, B: 101–102 (dwie świece 15m), C: 102–102,4, D: 99–100
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
    // Czas, wiersze 99..103: D | A D | A B | A B C | A — najwięcej okresów w wierszu 102
    expect(p.rows).toEqual([[3], [0, 3], [0, 1], [0, 1, 2], [0]]);
    // Wolumen (każda świeca 1, równo na swój zakres): 99: 1, 100: 1/3, 101: 1/3 + 1 + 1, 102: 1/3 + 1, 103: 0
    expect([...p.vol].map((v) => +v.toFixed(3))).toEqual([1, 0.333, 2.333, 1.333, 0]);
    expect(p.total).toBeCloseTo(5);
    expect(p.max).toBeCloseTo(7 / 3);
    // POC wolumenu w wierszu 101 (inny niż POC czasu), VA 70%: 101 i 102
    expect(p.poc).toBe(2);
    expect(tpoPocPx(p)).toBe(101.5);
    expect([p.vaLo, p.vaHi]).toEqual([2, 3]);
    // Bez taśmy: brak podziału na strony
    expect([...p.buy, ...p.sell].every((v) => v === 0)).toBe(true);
    expect(p.ib).toEqual({ lo: 100, hi: 103 });
    expect(p.from).toBe(0);
    expect(p.to).toBe(4);
  });

  it('taśma: wolumen na cenach transakcji z kupnem i sprzedażą; reszta wolumenu świecy poza taśmą rozłożona na zakres', () => {
    const fpOf = (t: number, trades: [number, number, 1 | -1][]) => {
      const b = new FootprintBuilder(t, 1);
      trades.forEach(([px, sz, side], i) => b.add(t + i, px, sz, side));
      return b.build();
    };
    const fp = fpOf(D0, [
      [100.5, 2, 1],
      [101.5, 3, -1],
      [101.2, 1, 1],
    ]);
    const bars = [
      { ...bar(D0, 100, 102), fp, complete: true },
      // Luka w nagraniu: z wolumenu świecy 6 taśma ma 4 (kupno na 101), reszta 2 rozłożona na 100–102 bez stron
      { ...bar(D0 + P, 100, 102), candle: { t: D0 + P, o: 100, h: 102, l: 100, c: 102, v: 6, n: 2 }, fp: fpOf(D0 + P, [[101, 4, 1]]), complete: false },
      // Świeca sprzed nagrania: cały wolumen 1 rozłożony na 100–102
      bar(D0 + 2 * P, 100, 102),
    ];
    const [p] = tpoProfiles(bars, 1);
    expect(p.complete).toBe(false);
    // Wiersze 100..102
    expect([...p.buy]).toEqual([2, 5, 0]);
    expect([...p.sell]).toEqual([0, 3, 0]);
    expect([...p.vol]).toEqual([3.5, 9.5, 0]);
    expect(p.total).toBe(13);
    expect(p.poc).toBe(1);
  });

  it('pojedyncze wydruki w środku i ogon z co najmniej dwóch wierszy na skraju', () => {
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

  it('doby UTC w świecach i tylko interwały równo dzielące 30 minut', () => {
    expect(tpoDays([bar(D0, 1, 2), bar(D0 + P, 1, 2), bar(D0 + DAY, 1, 2)])).toEqual([
      { from: 0, to: 1, complete: true },
      { from: 2, to: 2, complete: false },
    ]);
    expect(tpoDays([])).toEqual([]);
    expect(tpoInterval(60_000)).toBe(true);
    expect(tpoInterval(3 * 60_000)).toBe(true);
    expect(tpoInterval(30 * 60_000)).toBe(true);
    expect(tpoInterval(3_600_000)).toBe(false);
  });

  it('odcień agresji z udziału strony i liczby wiersza pod krzyżem', () => {
    // |kupno − sprzedaż| / (kupno + sprzedaż): 0,05 → 0, 0,1 → 1, 0,25 → 2, 0,4 → 3, 0,6 → 4
    expect([deltaLevel(52.5, 47.5), deltaLevel(55, 45), deltaLevel(62.5, 37.5), deltaLevel(30, 70), deltaLevel(20, 80), deltaLevel(0, 0)]).toEqual([0, 1, 2, 3, 4, 0]);
    const fp = new FootprintBuilder(D0, 1);
    fp.add(D0, 100.5, 2, 1);
    fp.add(D0 + 1, 100.6, 1, -1);
    const [p] = tpoProfiles([{ ...bar(D0, 100, 101), fp: fp.build(), complete: true }, bar(D0 + P, 100, 100.5)], 1);
    // Wiersz 100: taśma 3 z 4 (druga świeca bez taśmy)
    expect(rowTip(p, 0).slice(1)).toEqual(['Wolumen 4,00 · 100,0% doby', 'Kupno 67% · sprzedaż 33% (taśma 75%)', 'Czas: 2 × 30 min']);
    const [q] = tpoProfiles([bar(D0, 100, 100.5)], 1);
    expect(rowTip(q, 0)[2]).toBe('Bez taśmy: wolumen ze świec');
  });
});
