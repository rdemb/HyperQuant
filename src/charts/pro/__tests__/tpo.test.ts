import { describe, expect, it } from 'vitest';
import type { Candle } from '../hl/parse';
import { FootprintBuilder } from '../core/footprintBar';
import { TPO_PERIOD_MS, tapeDayProfile, tpoDay, tpoDays, tpoInterval, tpoPocPx, tpoProfiles, tpoSingles } from '../core/tpo';
import { OiLog } from '../core/stats';
import { Tape } from '../core/tape';
import { DAY } from '../core/time';
import { deltaLevel, posOf, posTip, rowTip } from '../chart/tpoLayer';
import type { DayProfile } from '../../../utils/dayProfile';

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

  it('doba z profilem serwera: kupno, sprzedaż i OI z pliku zamiast footprintu, reszta wolumenu świecy z wolumenu minut pliku', () => {
    const mv = new Array<number>(1440).fill(0);
    mv[0] = 4; // pierwsza świeca 30m: taśma 4 z 5, druga bez taśmy
    const file: DayProfile = { coin: 'BTC', day: D0, tick: 1, lo: 100, buy: [2, 1, 0], sell: [0, 1, 0], ob: [1, 0, 0], os: [0, 0, 0], cb: [0, 0, 0], cs: [0, 0.5, 0], mv, oiVol: 4 };
    const fp = new FootprintBuilder(D0, 1);
    fp.add(D0, 101.5, 9, -1);
    const bars = [
      { ...bar(D0, 100, 102), candle: { t: D0, o: 100, h: 102, l: 100, c: 101, v: 5, n: 1 }, fp: fp.build(), complete: true },
      { ...bar(D0 + P, 100, 102), candle: { t: D0 + P, o: 100, h: 102, l: 100, c: 101, v: 0.4, n: 1 } },
    ];
    const p = tpoDay(bars, 0, 1, 1, false, { file, ms: P })!;
    expect([...p.buy]).toEqual([2, 1, 0]);
    expect([...p.sell]).toEqual([0, 1, 0]);
    // Reszta 1 i 0,4 równo na 100–102 (wiersze 100 i 101)
    expect([...p.vol].map((v) => +v.toFixed(6))).toEqual([2.7, 2.7, 0]);
    expect(p.total).toBeCloseTo(5.4);
    expect([...p.ob, ...p.cs]).toEqual([1, 0, 0, 0, 0.5, 0]);
    expect(p.oiShare).toBe(1);
    // Wiersz 100: OI netto +1 przy taśmie 2 → nowe longi, najsilniejszy odcień; 101: −0,5 → zamykanie longów; 102 bez taśmy
    expect(posOf(p, 0)).toMatchObject({ kind: 1, level: 4, net: 1, known: true });
    expect(posOf(p, 1)).toMatchObject({ kind: 4, level: 3, known: true });
    expect(posOf(p, 2)).toMatchObject({ kind: 0, known: false });
    expect(posTip(p, 0)).toEqual(['OI +1,00 · nowe longi', 'OI rośnie: przy kupnie 1,00 · przy sprzedaży 0', 'OI spada: przy kupnie 0 · przy sprzedaży 0']);
    // Za mało taśmy w minutach z odczytem OI — bez koloru pozycji
    const q = tpoDay(bars, 0, 1, 1, false, { file: { ...file, oiVol: 1 }, ms: P })!;
    expect(posOf(q, 0).known).toBe(false);
    expect(posTip(q, 0)).toEqual(['Pozycje: bez danych OI']);
  });

  it('doba bez pliku: kupno i sprzedaż z footprintu świec, OI z profilu taśmy w pamięci (odczyt OI na koniec minuty)', () => {
    const tape = new Tape();
    tape.insert([
      { t: D0 + 1_000, px: 100.5, sz: 2, side: 1, tid: 1 },
      { t: D0 + 2_000, px: 101.5, sz: 2, side: 1, tid: 2 },
      { t: D0 + 60_000 + 1_000, px: 100.5, sz: 1, side: -1, tid: 3 },
      { t: D0 + 120_000 + 1_000, px: 100.5, sz: 1, side: 1, tid: 4 },
    ]);
    const oi = new OiLog();
    // Z serwera: odczyt minuty opisany jej początkiem (stan na koniec minuty); na żywo — chwilą odczytu
    oi.restore([
      [D0 - 60_000, 1000],
      [D0, 1004],
    ]);
    oi.push(D0 + 60_000 + 30_000, 1003);
    const flow = tapeDayProfile(tape, oi, 'BTC', D0, 1)!;
    // Minuta 0: OI +4 na wolumenie 4 przy kupnie; minuta 1: −1 przy sprzedaży; minuta 2: brak odczytu po jej początku
    expect(Array.from(flow.ob)).toEqual([2, 2]);
    expect(Array.from(flow.cs)).toEqual([1, 0]);
    expect(flow.oiVol).toBe(5);
    const fp = new FootprintBuilder(D0, 1);
    fp.add(D0 + 1_000, 100.5, 2, 1);
    fp.add(D0 + 2_000, 101.5, 2, 1);
    fp.add(D0 + 61_000, 100.5, 1, -1);
    fp.add(D0 + 121_000, 100.5, 1, 1);
    const bars = [{ ...bar(D0, 100, 101.5), candle: { t: D0, o: 100, h: 101.5, l: 100, c: 101, v: 6, n: 4 }, fp: fp.build(), complete: true }];
    const p = tpoDay(bars, 0, 0, 1, false, { flow, ms: P })!;
    expect([...p.buy]).toEqual([3, 2]);
    expect([...p.sell]).toEqual([1, 0]);
    expect([...p.ob]).toEqual([2, 2]);
    expect(p.oiShare).toBeCloseTo(5 / 6);
  });
});
