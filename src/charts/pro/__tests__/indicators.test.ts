import { describe, expect, it } from 'vitest';
import type { Candle } from '../hl/parse';
import { FootprintBuilder } from '../core/footprintBar';
import { IndicatorBar, dayLevels, developingProfile, indicatorScope, initialBalances, liqLevels, nakedPocs, periodRanges, volumeProfile, vwapFrom, vwapSeries } from '../core/indicators';
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

describe('vwapFrom — VWAP ze świec 1m na każdym interwale', () => {
  const M1 = 60_000;
  const t0 = utc('2026-10-25T00:00:00Z');
  // Świece 1m od 00:00 UTC: cena rośnie o 1 na minutę, wolumen zmienny
  const fine = Array.from({ length: 30 }, (_, i) => c(t0 + i * M1, 100 + i, 101 + i, 99 + i, 100 + i, 1 + (i % 3)));
  /** Świece interwału `ms` sklejone z tych samych świec 1m (jak świece z API). */
  const merged = (ms: number) => {
    const out: Candle[] = [];
    for (const f of fine) {
      const t = Math.floor(f.t / ms) * ms;
      const last = out.at(-1);
      if (last?.t === t) out[out.length - 1] = c(t, last.o, Math.max(last.h, f.h), Math.min(last.l, f.l), f.c, last.v + f.v);
      else out.push({ ...f, t });
    }
    return out.map(bar);
  };

  it('na końcu świecy 5m i 15m ten sam VWAP i σ co na 1m', () => {
    const one = vwapFrom(fine.map(bar), fine, M1, 'day');
    const five = vwapFrom(merged(M5), fine, M5, 'day');
    const fifteen = vwapFrom(merged(3 * M5), fine, 3 * M5, 'day');
    expect(five[2]).toEqual({ ...one[14]!, start: false });
    expect(fifteen[1]).toEqual({ ...one[29]!, start: false });
    expect(five[0]!.start).toBe(true);
    // Ze świec 5m (bez źródła 1m) wychodzi inaczej — to różnica, którą usuwa źródło 1m
    expect(vwapSeries(merged(M5), 'day')[2]!.vwap).not.toBeCloseTo(one[14]!.vwap, 6);
  });

  it('okres, którego początku nie ma w świecach 1m, liczony ze świec wykresu; bez źródła — jak dotąd', () => {
    const prev = [c(t0 - 2 * M5, 50, 50, 50, 50, 1), c(t0 - M5, 60, 60, 60, 60, 1)].map(bar);
    const bars = [...prev, ...merged(M5)];
    const out = vwapFrom(bars, fine, M5, 'day');
    expect(out.slice(0, 2)).toEqual(vwapSeries(prev, 'day'));
    expect(out[2]!.start).toBe(true);
    expect(vwapFrom(bars, [], M5, 'day')).toEqual(vwapSeries(bars, 'day'));
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

describe('developingProfile', () => {
  it('POC i value area po każdej świecy od początku okresu; na końcu jak profil całego okresu', () => {
    const bars = [c(0, 100, 104, 100, 101, 1), c(M5, 105, 109, 105, 106, 8), c(2 * M5, 110, 114, 110, 111, 9)].map(bar);
    const d = developingProfile(bars, 0, 2, 5);
    expect(d).toHaveLength(3);
    // Po pierwszej świecy cały wolumen w wierszu [100, 105)
    expect(d[0]).toEqual({ poc: 102.5, vah: 105, val: 100 });
    // Po drugiej POC przechodzi do [105, 110), value area 70% = sam ten wiersz (8 z 9)
    expect(d[1]).toEqual({ poc: 107.5, vah: 110, val: 105 });
    // Po trzeciej POC w [110, 115); 70% z 18 wymaga też wiersza [105, 110)
    const p = volumeProfile(bars, 0, 2, 5)!;
    expect(d[2]).toEqual({ poc: (p.lo + p.poc + 0.5) * 5, vah: (p.lo + p.vaHi + 1) * 5, val: (p.lo + p.vaLo) * 5 });
    expect(d[2]).toEqual({ poc: 112.5, vah: 115, val: 105 });
  });

  it('pusty zakres albo zły krok', () => {
    expect(developingProfile([], 0, 3, 5)).toEqual([]);
    expect(developingProfile([bar(c(0, 1, 1, 1, 1, 1))], 0, 0, 0)).toEqual([]);
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

describe('periodRanges i nakedPocs', () => {
  const H1 = 3_600_000;
  const d0 = utc('2026-10-20T00:00:00Z');

  it('dzieli świece na doby UTC; ostatnia doba nie jest zamknięta', () => {
    const bars = [0, 1, 24, 25, 48].map((h) => bar(c(d0 + h * H1, 100, 101, 99, 100, 1)));
    expect(periodRanges(bars, 'day')).toEqual([
      { start: d0, from: 0, to: 1, complete: true },
      { start: d0 + DAY, from: 2, to: 3, complete: true },
      { start: d0 + 2 * DAY, from: 4, to: 4, complete: false },
    ]);
  });

  it('POC nagi, dopóki żadna późniejsza świeca go nie dotknie', () => {
    // Doba 1: POC 100. Doba 2: handel 110–120. Doba 3: zejście do 99 dotyka POC doby 1, ale nie POC doby 2.
    const bars = [
      bar(c(d0, 100, 101, 99, 100, 5)),
      bar(c(d0 + DAY, 110, 120, 110, 115, 5)),
      bar(c(d0 + 2 * DAY, 109, 109, 99, 100, 5)),
    ];
    const periods = [
      { to: 0, complete: true, pocPx: 100 },
      { to: 1, complete: true, pocPx: 115 },
      { to: 2, complete: false, pocPx: 104 },
    ];
    expect(nakedPocs(bars, periods)).toEqual([false, true, false]);
    expect(nakedPocs(bars.slice(0, 2), periods.slice(0, 2).map((p, i) => ({ ...p, complete: i === 0 })))).toEqual([true, false]);
  });

  it('okres profili zależy od interwału', () => {
    expect(indicatorScope(60_000).periodProfile).toBe('session');
    expect(indicatorScope(H1).periodProfile).toBe('day');
    expect(indicatorScope(DAY).periodProfile).toBeNull();
  });
});
