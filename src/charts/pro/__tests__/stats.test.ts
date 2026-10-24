import { describe, expect, it } from 'vitest';
import type { Candle } from '../hl/parse';
import { FootprintBuilder } from '../core/footprintBar';
import { FundingBook, HOUR_MS, OiLog, VenueReads, barStat, fundingPct8h } from '../core/stats';
import { STAT_HEAD_PX, STAT_PAD_PX, STAT_ROW_PX, tableHeight, tableLines } from '../chart/statsTable';

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
    expect(fundingPct8h(0.0000125)).toBeCloseTo(0.01);
  });

  it('po pełnej godzinie poprzednia godzina ma prognozę do czasu rozliczenia, potem stawkę z API', () => {
    const f = new FundingBook();
    f.add([{ time: HOUR_MS + 3, rate: 0.0001, premium: 0 }], 0);
    // 02:00:20 — wypłata za 01:00–02:00 jeszcze nie dotarła
    const now = 2 * HOUR_MS + 20_000;
    expect(f.rate(HOUR_MS + 30 * M1, M1, now, 0.0004)).toBe(0.0004);
    // Starsza godzina bez wypłaty nie dostaje prognozy
    expect(f.rate(30 * M1 - HOUR_MS, M1, now, 0.0004)).toBeNull();
    f.add([{ time: 2 * HOUR_MS + 5, rate: 0.0002, premium: 0 }], 0);
    expect(f.latest).toBe(HOUR_MS);
    expect(f.rate(HOUR_MS + 30 * M1, M1, now, 0.0004)).toBe(0.0002);
  });
});

describe('finansowanie Binance (rozliczenia co kilka godzin)', () => {
  it('godziny okresu dostają stawkę / liczbę godzin; godziny bieżącego okresu — prognozę', () => {
    const f = new FundingBook();
    // Wypłaty o 08:00 i 16:00 (okres 8 h)
    f.addPeriods(
      [
        { time: 8 * HOUR_MS, rate: 0.0008 },
        { time: 16 * HOUR_MS + 4, rate: -0.0016 },
      ],
      8,
      0
    );
    expect(f.periodMs).toBe(8 * HOUR_MS);
    expect(f.latest).toBe(15 * HOUR_MS);
    const now = 21 * HOUR_MS;
    expect(f.rate(HOUR_MS, HOUR_MS, now, null)).toBeCloseTo(0.0001);
    expect(f.rate(10 * HOUR_MS, 5 * 60_000, now, null)).toBeCloseTo(-0.0002);
    // 17:00–21:00 — okres jeszcze nierozliczony: prognoza (stawka godzinowa)
    expect(f.rate(17 * HOUR_MS, HOUR_MS, now, 0.00005)).toBe(0.00005);
    expect(f.rate(17 * HOUR_MS, HOUR_MS, now, null)).toBeNull();
    expect(fundingPct8h(f.rate(HOUR_MS, HOUR_MS, now, null)!)).toBeCloseTo(0.08);
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
    expect(s.funding).toBeCloseTo(0.01);
    const bare = barStat({ t: M1, candle: candle(M1, 9), fp: null }, M1, 10 * M1, new OiLog(), new FundingBook(), null);
    expect([bare.delta, bare.trades, bare.speed, bare.doi, bare.funding]).toEqual([null, null, null, null, null]);
  });

  it('grupy Binance i Bybit z odczytów giełd; bez odczytów brak zamiast zera', () => {
    const bn = new OiLog();
    bn.push(M1, 1000);
    bn.push(2 * M1, 1015);
    const reads: VenueReads = {
      delta: (venue, t) => (t === M1 ? { binance: 4, binanceSpot: -2, bybit: null }[venue] : null),
      oi: (venue, t) => (venue === 'binance' ? bn.at(t) : null),
      funding: () => 0.0000125,
    };
    const b = { t: M1, candle: candle(M1, 9), fp: null };
    const s = barStat(b, M1, 10 * M1, new OiLog(), new FundingBook(), null, reads);
    expect([s.bnDelta, s.bnSpotDelta, s.byDelta, s.bnDoi, s.byDoi]).toEqual([4, -2, null, 15, null]);
    expect(s.bnFunding).toBeCloseTo(0.01);
    const none = barStat(b, M1, 10 * M1, new OiLog(), new FundingBook(), null);
    expect([none.bnDelta, none.bnSpotDelta, none.bnDoi, none.bnFunding, none.byDelta, none.byDoi]).toEqual([null, null, null, null, null, null]);
  });

  it('grupa Kto handluje z podziału wejść; bez podziału brak zamiast zera', () => {
    const b = { t: M1, candle: candle(M1, 9), fp: null };
    const s = barStat(b, M1, 10 * M1, new OiLog(), new FundingBook(), null, null, (t) =>
      t === M1 ? { big: 3, rest: -1, bigUsd: 500, usd: 800, bigShare: 62.5, complete: true } : null
    );
    expect([s.bigDelta, s.restDelta, s.bigShare]).toEqual([3, -1, 62.5]);
    const none = barStat(b, M1, 10 * M1, new OiLog(), new FundingBook(), null, null, () => null);
    expect([none.bigDelta, none.restDelta, none.bigShare]).toEqual([null, null, null]);
  });

  it('świeca częściowa: taśma albo konta tylko z części świecy', () => {
    const fp = new FootprintBuilder(M1, 1);
    fp.add(M1 + 1, 100, 1, 1);
    const at = (complete: boolean | undefined, who: boolean | null) =>
      barStat({ t: M1, candle: candle(M1, 1), fp: fp.build(), complete }, M1, 10 * M1, new OiLog(), new FundingBook(), null, null, () =>
        who === null ? null : { big: 0, rest: 1, bigUsd: 0, usd: 100, bigShare: 0, complete: who }
      ).partial;
    expect([at(true, null), at(undefined, null), at(false, null), at(true, true), at(true, false)]).toEqual([false, false, true, false, true]);
    // Świeca bez taśmy nie jest częściowa — jej liczb z taśmy po prostu nie ma
    expect(barStat({ t: M1, candle: candle(M1, 1), fp: null, complete: false }, M1, 10 * M1, new OiLog(), new FundingBook(), null).partial).toBe(false);
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

describe('Tablica liczb', () => {
  it('bez grupy giełdy: wiersze Hyperliquid i taśmy bez nagłówków (dawne 9 wierszy)', () => {
    const lines = tableLines(['hl', 'tape']);
    expect(lines.every((l) => l.row !== null)).toBe(true);
    expect(lines.map((l) => l.row!.key)).toEqual(['vol', 'delta', 'doi', 'funding', 'deltaPct', 'maxDelta', 'minDelta', 'trades', 'speed']);
    expect(tableHeight(['hl', 'tape'])).toBe(9 * STAT_ROW_PX + STAT_PAD_PX);
  });

  it('z grupą giełdy każda grupa ma nagłówek; kolejność grup stała', () => {
    const lines = tableLines(['bybit', 'hl', 'binance']);
    expect(lines.filter((l) => !l.row).map((l) => l.group)).toEqual(['hl', 'binance', 'bybit']);
    expect(lines.filter((l) => l.row).map((l) => l.row!.key)).toEqual(['vol', 'delta', 'doi', 'funding', 'bnDelta', 'bnSpotDelta', 'bnDoi', 'bnFunding', 'byDelta', 'byDoi']);
    expect(tableHeight(['hl', 'binance', 'bybit'])).toBe(10 * STAT_ROW_PX + 3 * STAT_HEAD_PX + STAT_PAD_PX);
  });

  it('Kto handluje ma nagłówek grupy i stoi po taśmie, przed giełdami', () => {
    const lines = tableLines(['who', 'tape']);
    expect(lines.filter((l) => !l.row).map((l) => l.group)).toEqual(['tape', 'who']);
    expect(lines.filter((l) => l.row && l.group === 'who').map((l) => l.row!.key)).toEqual(['bigDelta', 'restDelta', 'bigShare']);
    expect(tableHeight(['who'])).toBe(3 * STAT_ROW_PX + STAT_HEAD_PX + STAT_PAD_PX);
  });
});
