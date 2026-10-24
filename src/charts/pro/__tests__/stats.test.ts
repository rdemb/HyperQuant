import { describe, expect, it } from 'vitest';
import type { Candle } from '../hl/parse';
import { FootprintBuilder } from '../core/footprintBar';
import { FundingBook, HOUR_MS, OiLog, barStat, fundingApr } from '../core/stats';

const M1 = 60_000;
const candle = (t: number, v: number): Candle => ({ t, o: 100, h: 101, l: 99, c: 100, v, n: 1 });

describe('otwarte pozycje', () => {
  it('stan na chwilę: ostatnia próbka nie późniejsza, null przed pierwszą; stare próbki odrzucane', () => {
    const oi = new OiLog();
    oi.push(1000, 10);
    oi.push(2000, 12);
    oi.push(1500, 99);
    expect(oi.at(999)).toBeNull();
    expect(oi.at(1999)).toBe(10);
    expect(oi.at(5000)).toBe(12);
    oi.prune(2500);
    // Ostatnia próbka sprzed granicy zostaje jako stan początkowy
    expect(oi.at(2600)).toBe(12);
  });
});

describe('finansowanie', () => {
  it('stawka godziny świecy z historii, bieżąca godzina z prognozy, średnia dla świecy wielogodzinnej', () => {
    const f = new FundingBook();
    // Wypłata o 01:00 dotyczy godziny 00:00–01:00
    f.add(
      [
        { time: HOUR_MS + 3, rate: 0.0001, premium: 0 },
        { time: 2 * HOUR_MS + 2, rate: 0.0003, premium: 0 },
      ],
      0
    );
    const now = 2 * HOUR_MS + 10 * M1;
    expect(f.rate(30 * M1, M1, now, null)).toBe(0.0001);
    expect(f.rate(2 * HOUR_MS + M1, M1, now, 0.0005)).toBe(0.0005);
    expect(f.rate(2 * HOUR_MS + M1, M1, now, null)).toBeNull();
    expect(f.rate(0, 2 * HOUR_MS, now, null)).toBeCloseTo(0.0002);
    expect(fundingApr(0.0000125)).toBeCloseTo(10.95);
  });
});

describe('statystyki świecy', () => {
  it('delta, delta %, tempo, ΔOI z taśmy i próbek; bez taśmy brak zamiast zera', () => {
    const fp = new FootprintBuilder(M1, 1);
    fp.add(M1 + 1, 100, 3, 1);
    fp.add(M1 + 2, 100, 1, -1);
    const oi = new OiLog();
    oi.push(M1 - 5, 500);
    oi.push(M1 + 30_000, 520);
    const s = barStat({ t: M1, candle: candle(M1, 9), fp: fp.build() }, M1, 10 * M1, oi, new FundingBook(), 0.0000125);
    expect(s.vol).toBe(9);
    expect(s.delta).toBe(2);
    expect(s.deltaPct).toBe(50);
    expect(s.trades).toBe(2);
    expect(s.speed).toBeCloseTo(2 / 60);
    expect(s.doi).toBe(20);
    expect(s.funding).toBeCloseTo(10.95);
    const bare = barStat({ t: M1, candle: candle(M1, 9), fp: null }, M1, 10 * M1, new OiLog(), new FundingBook(), null);
    expect([bare.delta, bare.trades, bare.speed, bare.doi, bare.funding]).toEqual([null, null, null, null, null]);
  });

  it('bieżąca świeca: tempo i ΔOI do teraz', () => {
    const fp = new FootprintBuilder(M1, 1);
    fp.add(M1 + 1, 100, 1, 1);
    const oi = new OiLog();
    oi.push(M1, 100);
    oi.push(M1 + 20_000, 103);
    const s = barStat({ t: M1, candle: candle(M1, 1), fp: fp.build() }, M1, M1 + 10_000, oi, new FundingBook(), null);
    expect(s.speed).toBeCloseTo(0.1);
    expect(s.doi).toBe(0);
  });
});
