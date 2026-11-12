import { describe, expect, it } from 'vitest';
import type { VBar } from '../auction';
import { bootstrapMedian80, nyClock, rvolHour, rvolSeries } from '../rvol';
import { hourWidth, hourWidthSample, nextSessionHour } from '../fourNumbers';

/**
 * RVOL według godziny zegarowej w Nowym Jorku: koszyk = godzina America/New_York, dni robocze i weekend osobno (data w tej
 * strefie), baza = mediana tej samej godziny z 20 ostatnich dni tego samego typu, mniej niż 10 — brak wartości.
 */

const H = 3_600_000;
const DAY = 24 * H;
const NY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', weekday: 'short' });
const nyHour = (t: number) => Number(NY.formatToParts(new Date(t)).find((p) => p.type === 'hour')!.value);
const nyWeekend = (t: number) => ['Sat', 'Sun'].includes(NY.formatToParts(new Date(t)).find((p) => p.type === 'weekday')!.value);

/** Wolumen: godzina otwarcia NY (9:00–10:00 czasu NY) 1000 w dni robocze i 10 w weekend; reszta 100 (weekend 30). */
const vol = (t: number) => (nyHour(t) === 9 ? (nyWeekend(t) ? 10 : 1000) : nyWeekend(t) ? 30 : 100);
const series = (from: number, to: number, v: (t: number) => number = vol): VBar[] => {
  const out: VBar[] = [];
  for (let t = from; t < to; t += H) out.push({ time: t, open: 1, high: 1 + v(t) / 1e4, low: 1, close: 1, volume: v(t) });
  return out;
};

describe('RVOL: godzina otwarcia NY przed zmianą czasu w USA i po niej ma tę samą bazę', () => {
  it('1.11.2026 (koniec czasu letniego): godzina 9:00 NY to 13:00 UTC przed zmianą i 14:00 UTC po niej', () => {
    expect(nyHour(Date.UTC(2026, 9, 30, 13))).toBe(9);
    expect(nyHour(Date.UTC(2026, 10, 12, 14))).toBe(9);
    // Czwartek 12.11, 9:30 czasu NY: połowa godziny z połową typowego wolumenu
    const start = Date.UTC(2026, 10, 12, 14);
    const bars = [...series(Date.UTC(2026, 8, 1), start), { time: start, open: 1, high: 1, low: 1, close: 1, volume: 500 }];
    const r = rvolHour(bars, start + H / 2);
    expect(r.n).toBe(20);
    // Baza z tej samej godziny lokalnej: także dni sprzed zmiany czasu (13:00 UTC), wszystkie po 1000
    expect(r.base).toHaveLength(20);
    expect(new Set(r.base)).toEqual(new Set([1000]));
    expect(r.value).toBe(1);
  });

  it('8.03.2026 (początek czasu letniego): zamknięta świeca otwarcia NY po zmianie ma RVOL 1 na wykresie', () => {
    const bars = series(Date.UTC(2026, 0, 1), Date.UTC(2026, 2, 13));
    const r = rvolSeries(bars, H);
    const i = bars.findIndex((b) => b.time === Date.UTC(2026, 2, 12, 13)); // czwartek 12.03, 9:00 EDT
    expect(nyHour(bars[i].time)).toBe(9);
    expect(r[i]).toBe(1);
    // Ta sama godzina UTC (13:00) przed zmianą to 8:00 NY: zwykła godzina, też 1
    const j = bars.findIndex((b) => b.time === Date.UTC(2026, 2, 5, 13));
    expect(r[j]).toBe(1);
  });
});

describe('RVOL: weekend osobno', () => {
  it('weekend nie wchodzi do bazy dnia roboczego, a dzień roboczy do bazy weekendu', () => {
    const wd = Date.UTC(2026, 10, 12, 14); // czwartek, 9:00 NY
    const r = rvolHour([...series(Date.UTC(2026, 6, 1), wd), { time: wd, open: 1, high: 1, low: 1, close: 1, volume: 500 }], wd + H / 2);
    expect(r.base.every((v) => v === 1000)).toBe(true);
    const sat = Date.UTC(2026, 10, 14, 14); // sobota, 9:00 NY
    const s = rvolHour([...series(Date.UTC(2026, 6, 1), sat), { time: sat, open: 1, high: 1, low: 1, close: 1, volume: 5 }], sat + H / 2);
    expect(s.n).toBe(20);
    expect(s.base.every((v) => v === 10)).toBe(true);
    expect(s.value).toBe(1);
  });

  it('wykres: świeca weekendowa liczona wobec weekendów', () => {
    const bars = series(Date.UTC(2026, 6, 1), Date.UTC(2026, 10, 15));
    const r = rvolSeries(bars, H);
    const i = bars.findIndex((b) => b.time === Date.UTC(2026, 10, 14, 14));
    expect(r[i]).toBe(1);
  });
});

describe('RVOL: weekend jak przerwa CME — od piątku 17:00 do niedzieli 18:00 czasu NY', () => {
  // Listopad 2026 (EST, UTC−5): piątek 13.11, niedziela 15.11
  it('piątek 16:00 NY dzień handlu, piątek 17:00 weekend', () => {
    expect(nyClock(Date.UTC(2026, 10, 13, 21)).weekend).toBe(false);
    expect(nyClock(Date.UTC(2026, 10, 13, 22)).weekend).toBe(true);
  });
  it('sobota cała weekend; niedziela 17:00 NY weekend, niedziela 18:00 dzień handlu', () => {
    expect(nyClock(Date.UTC(2026, 10, 14, 15)).weekend).toBe(true);
    expect(nyClock(Date.UTC(2026, 10, 15, 22)).weekend).toBe(true);
    expect(nyClock(Date.UTC(2026, 10, 15, 23)).weekend).toBe(false);
  });
  it('świeca dzienna poniedziałku UTC (start w niedzielę wieczorem NY) dzień handlu, soboty UTC (piątek wieczorem NY) weekend', () => {
    expect(nyClock(Date.UTC(2026, 10, 16)).weekend).toBe(false);
    expect(nyClock(Date.UTC(2026, 10, 14)).weekend).toBe(true);
    expect(nyClock(Date.UTC(2026, 10, 15)).weekend).toBe(true);
  });
  it('czas letni (EDT, UTC−4): granice o tej samej godzinie lokalnej', () => {
    // piątek 6.03.2026 przed zmianą (EST) i piątek 13.03.2026 po zmianie (EDT)
    expect(nyClock(Date.UTC(2026, 2, 6, 22)).weekend).toBe(true);
    expect(nyClock(Date.UTC(2026, 2, 13, 21)).weekend).toBe(true);
    expect(nyClock(Date.UTC(2026, 2, 13, 20)).weekend).toBe(false);
    expect(nyClock(Date.UTC(2026, 2, 15, 22)).weekend).toBe(false);
  });
});

describe('RVOL: mniej niż 10 dni tego samego typu', () => {
  it('9 dni roboczych historii: brak wartości z liczbą dni', () => {
    const start = Date.UTC(2026, 10, 12, 14);
    // Od piątku 30.10, 8:00 czasu NY: przed czwartkiem 12.11 jest 9 dni roboczych z godziną 9:00 NY
    const bars = [...series(Date.UTC(2026, 9, 30, 12), start), { time: start, open: 1, high: 1, low: 1, close: 1, volume: 500 }];
    const r = rvolHour(bars, start + H / 2);
    expect(r.n).toBe(9);
    expect(r.value).toBeNull();
    const s = rvolSeries(bars.slice(0, -1), H);
    expect(s[s.length - 1]).toBeNull();
  });
});

describe('Typowa szerokość godziny sesji: dni robocze i weekend osobno', () => {
  it('godzina otwarcia NY w dzień roboczy: próba tylko z dni roboczych (20), mediana z nich', () => {
    // Zakres świecy: dni robocze 100, weekend 10 (w jednostkach ceny ×1e4 — high = 1 + v/1e4)
    const now = Date.UTC(2026, 10, 12, 13, 50); // czwartek, przed otwarciem NY
    const at = nextSessionHour(now);
    expect(at.s.id).toBe('ny');
    const bars = series(Date.UTC(2026, 7, 1), now, (t) => (nyWeekend(t) ? 10 : 100));
    const xs = hourWidthSample(bars, at, now);
    expect(xs).toHaveLength(20);
    expect(xs.every((x) => Math.abs(x - 0.01) < 1e-12)).toBe(true);
    expect(hourWidth(bars, at, now)).toEqual({ median: expect.closeTo(0.01, 12), n: 20 });
  });

  it('mniej niż 10 dni tego samego typu: mediana null', () => {
    const now = Date.UTC(2026, 10, 12, 13, 50);
    const at = nextSessionHour(now);
    expect(hourWidth(series(Math.floor((now - 11 * DAY) / H) * H, now), at, now)).toEqual({ median: null, n: 8 });
  });
});

describe('Przedział 80% mediany z bootstrapu po dniach (1000 losowań, mulberry32, ziarno 20261111)', () => {
  it('stała próba: przedział zdegenerowany; ta sama próba — te same granice', () => {
    expect(bootstrapMedian80([5, 5, 5, 5, 5, 5, 5, 5, 5, 5])).toEqual([5, 5]);
    const xs = Array.from({ length: 20 }, (_, i) => 100 + ((i * 37) % 23));
    const a = bootstrapMedian80(xs)!;
    expect(bootstrapMedian80([...xs].reverse())).toEqual(a);
    expect(a[0]).toBeLessThanOrEqual(a[1]);
    const sorted = [...xs].sort((p, q) => p - q);
    const med = (sorted[9] + sorted[10]) / 2;
    expect(a[0]).toBeLessThanOrEqual(med);
    expect(a[1]).toBeGreaterThanOrEqual(med);
    expect(a[0]).toBeGreaterThanOrEqual(sorted[0]);
    expect(a[1]).toBeLessThanOrEqual(sorted[19]);
  });
});
