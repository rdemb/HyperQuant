import { describe, expect, it } from 'vitest';
import type { Candle } from '../hl/parse';
import { FootprintBuilder } from '../core/footprintBar';
import { IndicatorBar, dayLevels, initialBalances, liqLevels, volumeProfile, vwapSeries } from '../core/indicators';
import { DAY } from '../core/time';
import type { LiqMap } from '../../../utils/liqMap';

const M5 = 300_000;
const utc = (s: string) => Date.parse(s);

function c(t: number, o: number, h: number, l: number, cl: number, v: number): Candle {
  return { t, o, h, l, c: cl, v, n: 1 };
}

const bar = (candle: Candle): IndicatorBar => ({ t: candle.t, candle });

describe('vwapSeries', () => {
  it('średnia ceny typowej ważona wolumenem i odchylenie ważone wolumenem', () => {
    const t0 = utc('2026-10-24T10:00:00Z');
    const bars = [c(t0, 100, 102, 98, 100, 1), c(t0 + M5, 100, 112, 108, 110, 3)].map(bar);
    const [a, b] = vwapSeries(bars, 'day');
    expect(a).toEqual({ vwap: 100, sd: 0, start: true });
    // Ceny typowe 100 (v=1) i 110 (v=3): VWAP 107.5, wariancja (1·7.5² + 3·2.5²)/4 = 18.75
    expect(b!.vwap).toBeCloseTo(107.5, 9);
    expect(b!.sd).toBeCloseTo(Math.sqrt(18.75), 9);
    expect(b!.start).toBe(false);
  });

  it('zeruje się z nowym dniem UTC i nową sesją', () => {
    const t0 = utc('2026-10-23T23:55:00Z');
    const bars = [c(t0, 100, 100, 100, 100, 1), c(t0 + M5, 200, 200, 200, 200, 1)].map(bar);
    const day = vwapSeries(bars, 'day');
    expect(day[1]).toEqual({ vwap: 200, sd: 0, start: true });
    const london = utc('2026-10-23T07:00:00Z'); // BST: Londyn 08:00 = 07:00 UTC
    const ses = vwapSeries([c(london - M5, 100, 100, 100, 100, 1), c(london, 300, 300, 300, 300, 1)].map(bar), 'session');
    expect(ses[1]!.start).toBe(true);
    expect(ses[1]!.vwap).toBe(300);
  });

  it('świeca bez wolumenu na początku okresu nie zaczyna linii', () => {
    const t0 = utc('2026-10-24T00:00:00Z');
    const out = vwapSeries([c(t0, 100, 100, 100, 100, 0), c(t0 + M5, 105, 105, 105, 105, 2)].map(bar), 'day');
    expect(out[0]).toBeNull();
    expect(out[1]).toEqual({ vwap: 105, sd: 0, start: true });
  });

  it('precyzja przy cenach rzędu 100 tys. USD', () => {
    const t0 = utc('2026-10-24T00:00:00Z');
    const bars = Array.from({ length: 288 }, (_, i) => bar(c(t0 + i * M5, 110_000, 110_000.5 + (i % 2), 109_999.5 + (i % 2), 110_000 + (i % 2), 1000)));
    const last = vwapSeries(bars, 'day').at(-1)!;
    expect(last.vwap).toBeCloseTo(110_000.5, 6);
    expect(last.sd).toBeCloseTo(0.5, 6);
  });
});

describe('volumeProfile', () => {
  it('świeca z API rozkłada wolumen równo na zakres H–L', () => {
    const p = volumeProfile([bar(c(0, 100, 110, 100, 105, 10))], 0, 0, 5)!;
    expect(p.lo).toBe(20);
    expect(Array.from(p.vol)).toEqual([5, 5, 0]);
    expect(p.total).toBeCloseTo(10);
  });

  it('świeca w całości z taśmy oddaje wolumen na cenach transakcji', () => {
    const b = new FootprintBuilder(0, 1);
    b.add(1, 101, 2, 1);
    b.add(2, 108, 0.5, -1);
    const fpBar: IndicatorBar = { t: 0, candle: c(0, 100, 110, 100, 105, 2.5), fp: b.build(), complete: true };
    const p = volumeProfile([fpBar], 0, 0, 5)!;
    expect(Array.from(p.vol)).toEqual([2, 0.5, 0]);
    expect(p.poc).toBe(0);
  });

  it('POC i value area 70% wokół POC', () => {
    const bars = [c(0, 100, 104, 100, 101, 1), c(M5, 105, 109, 105, 106, 8), c(2 * M5, 110, 114, 110, 111, 1)].map(bar);
    const p = volumeProfile(bars, 0, 2, 5)!;
    expect(p.poc).toBe(1);
    expect(p.vaLo).toBe(1);
    expect(p.vaHi).toBe(1);
    expect(p.max).toBeCloseTo(8);
  });

  it('pusty zakres albo zły krok', () => {
    expect(volumeProfile([], 0, 10, 5)).toBeNull();
    expect(volumeProfile([bar(c(0, 1, 1, 1, 1, 1))], 0, 0, 0)).toBeNull();
  });
});

describe('dayLevels', () => {
  it('PDH i PDL z poprzedniej świecy dziennej i otwarcie dnia; luka w danych pomija dzień', () => {
    const d0 = utc('2026-10-20T00:00:00Z');
    const daily = [c(d0, 100, 120, 90, 110, 1), c(d0 + DAY, 110, 130, 105, 125, 1), c(d0 + 3 * DAY, 126, 140, 120, 130, 1)];
    expect(dayLevels(daily)).toEqual([{ t: d0 + DAY, open: 110, pdh: 120, pdl: 90 }]);
  });
});

describe('initialBalances', () => {
  it('zakres pierwszej godziny każdej sesji objętej świecami', () => {
    const start = utc('2026-10-23T06:00:00Z');
    const bars: IndicatorBar[] = [];
    for (let i = 0; i < 36; i++) {
      const t = start + i * M5;
      bars.push(bar(c(t, 100, 100 + i, 90 - i, 100, 1)));
    }
    // Świece 06:00–08:55 UTC: Azja zaczęła się przed nimi, Londyn o 07:00 UTC (BST)
    const ib = initialBalances(bars, M5);
    expect(ib).toHaveLength(1);
    expect(ib[0].session.id).toBe('london');
    expect(ib[0].hi).toBe(100 + 23); // ostatnia świeca IB 07:55 = indeks 23
    expect(ib[0].lo).toBe(90 - 23);
    expect(ib[0].complete).toBe(true);
  });

  it('IB w toku nie jest ostateczny', () => {
    const london = utc('2026-10-23T07:00:00Z');
    const ib = initialBalances([bar(c(london, 100, 105, 99, 101, 1)), bar(c(london + M5, 101, 107, 100, 106, 1))], M5);
    expect(ib).toEqual([expect.objectContaining({ hi: 107, lo: 99, complete: false })]);
  });
});

describe('liqLevels', () => {
  const map = {
    markPx: 100_000,
    stepUsd: 100,
    longs: [
      { px: 99_000, ntlUsd: 2e6, n: 3 },
      { px: 99_100, ntlUsd: 1.5e6, n: 2 },
      { px: 98_000, ntlUsd: 0.5e6, n: 1 },
    ],
    shorts: [
      { px: 101_500, ntlUsd: 4e6, n: 5 },
      { px: 99_500, ntlUsd: 9e6, n: 1 },
    ],
  } as unknown as LiqMap;

  it('łączy kubełki w przedziały ~0,25% ceny, odrzuca małe i po złej stronie ceny', () => {
    // Przedział 250 USD: 99 000 i 99 100 (środki 99 050, 99 150) wpadają do [99 000, 99 250)
    expect(liqLevels(map)).toEqual([
      { px: 99_125, ntlUsd: 3.5e6, side: 'long' },
      { px: 101_625, ntlUsd: 4e6, side: 'short' },
    ]);
  });
});
