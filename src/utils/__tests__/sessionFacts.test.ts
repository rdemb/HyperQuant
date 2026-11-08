import { describe, expect, it } from 'vitest';
import type { VBar } from '../auction';
import { currentTradeSession, expectedRange, previousSameSession } from '../sessionDay';
import { classifyDay } from '../dayType';
import { dayTypeOf, expectedBasis, expectedFrom, reviewSession, sessionFacts, sessionNowOf } from '../sessionFacts';
import type { VolModel } from '../volatility';
import { fmtHm } from '../../charts/pro/core/time';
import * as layoutNumbers from '../../charts/pro/chart/layoutNumbers';

const MIN = 60_000;
const H = 60 * MIN;
const at = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
/** 3.11.2026, NY w toku (14:30–24:00 UTC), IB zamknięty o 15:30 */
const NOW = at(2026, 11, 3, 16, 20);
const NY = currentTradeSession(NOW)!;

const minutes = (from: number, to: number, px: (t: number) => number): VBar[] => {
  const out: VBar[] = [];
  for (let t = from; t < to; t += MIN) out.push({ time: t, open: px(t), high: px(t) + 20, low: px(t) - 20, close: px(t), volume: 1 });
  return out;
};

describe('expectedBasis: reguła metody oczekiwanego zakresu sesji do rozliczenia (karta strony i session_review serwera MCP)', () => {
  const har = {} as VolModel;
  it('zamknięta sesja: zawsze ex ante — Parkinson (bez modelu) na chwilę jej otwarcia, także z wczytanym modelem HAR', () => {
    const later = NOW + 10 * H;
    expect(expectedBasis(NY, false, har, later)).toEqual({ model: null, asOf: NY.start });
    expect(expectedBasis(NY, false, null, later)).toEqual({ model: null, asOf: NY.start });
  });

  it('sesja w toku: model HAR, gdy jest, inaczej Parkinson — oba na teraz', () => {
    expect(expectedBasis(NY, true, har, NOW)).toEqual({ model: har, asOf: NOW });
    expect(expectedBasis(NY, true, null, NOW)).toEqual({ model: null, asOf: NOW });
  });
});

describe('sessionFacts: jedno źródło faktów sesji (nagłówek Rozliczenia i karty)', () => {
  // Od NY poprzedniego dnia (14:30 2.11) do teraz, cena 100 000; w bieżącej sesji NY po IB wyżej
  const bars = minutes(at(2026, 11, 2, 14, 30), NOW + MIN, (t) => (t >= NY.ibEnd ? 100_600 : 100_000));

  it('sesja w toku ze świec 1m: IB, zakres z minutami ekstremów, pierwsze wybicie, VA tej i poprzedniej sesji NY', () => {
    const f = sessionFacts(bars, NY, NOW);
    if ('why' in f) throw new Error(f.why);
    expect(f).toMatchObject({ s: NY, ibHi: 100_020, ibLo: 99_980, hi: 100_620, lo: 99_980, close: 100_600, ibDone: true, breakAt: NY.ibEnd, hiAt: NY.ibEnd, loAt: NY.start });
    expect(f.prev).toEqual(previousSameSession(NY));
    expect(f.prevVa!.vah).toBeLessThanOrEqual(100_030);
    expect(f.va!.vah).toBeGreaterThan(100_500);
  });

  it('w Azji: ostatnia zamknięta sesja (NY), bez „w toku”', () => {
    const asia = at(2026, 11, 4, 2);
    expect(reviewSession(NOW)).toEqual({ s: NY, inProgress: true });
    expect(reviewSession(asia)).toEqual({ s: NY, inProgress: false });
    const later = [...bars, ...minutes(NOW + MIN, asia, () => 100_600)];
    const f = sessionFacts(later, NY, asia);
    if ('why' in f) throw new Error(f.why);
    expect(f.close).toBe(100_600);
  });

  it('świece bez otwarcia sesji albo z mniej niż 95% minut — powód; bez poprzedniej sesji — prevVa null', () => {
    expect(sessionFacts(bars.filter((b) => b.time > NY.start + H), NY, NOW)).toMatchObject({ why: expect.stringContaining('nie obejmują całej sesji NY') });
    const holes = bars.filter((b, i) => b.time < NY.start || i % 10 !== 0);
    expect(sessionFacts(holes, NY, NOW)).toMatchObject({ why: expect.any(String) });
    const f = sessionFacts(bars.filter((b) => b.time >= NY.start), NY, NOW);
    if ('why' in f) throw new Error(f.why);
    expect(f.prevVa).toBeNull();
  });
});

describe('sessionNowOf poza modułami wykresu', () => {
  it('import ze starego miejsca (nagłówek układu) daje tę samą funkcję', () => {
    expect(layoutNumbers.sessionNowOf).toBe(sessionNowOf);
  });
});

describe('dayTypeOf: typ dnia z faktów sesji (nagłówek Rozliczenie, karta, serwer MCP)', () => {
  it('po IB — typ z classifyDay; IB w budowie albo zakres IB zerowy — powód', () => {
    const f = sessionFacts(minutes(at(2026, 11, 2, 14, 30), NOW + MIN, (t) => (t >= NY.ibEnd ? 100_600 : 100_000)), NY, NOW);
    if ('why' in f) throw new Error(f.why);
    expect(dayTypeOf(f)).toBe(classifyDay(f));
    expect(dayTypeOf(f)).toBe('trend');
    expect(dayTypeOf({ ...f, ibDone: false })).toEqual({ why: `IB w budowie do ${fmtHm(NY.ibEnd)}` });
    expect(dayTypeOf({ ...f, ibHi: f.ibLo })).toEqual({ why: 'zakres IB zerowy albo brak liczb' });
  });
});

/** Model ze stałą wariancją godziny `v` (profil płaski, HAR = stała). */
const flatModel = (v: number, nextHourStartMs: number): VolModel => ({
  builtAt: nextHourStartMs,
  profile: { factors: Array(24).fill(1), counts: Array(24).fill(0) },
  har: { coef: [Math.log(v), 0, 0, 0], smear: 1, smearByH: [], n: 0, r2: 0, oos: null, lastY: Array(168).fill(Math.log(v)) },
  residuals: new Float64Array(0),
  jump: null,
  lmJumps: { count: 0, days: 0, maxAbsMovePct: 0 },
  hourlyBars: 0,
  fiveMinBars: 0,
  nextHourStartMs,
});

describe('expectedFrom: oczekiwany zakres albo powód braku (nagłówek układu, karta Rozliczenia, serwer MCP)', () => {
  /** `n` zamkniętych świec 5m kończących się `end`. */
  const fiveMin = (n: number, end: number): VBar[] =>
    Array.from({ length: n }, (_, i) => ({ time: end - (n - i) * 5 * MIN, open: 100_000, high: 100_200, low: 100_000, close: 100_000, volume: 1 }));

  it('z modelem HAR — wynik expectedRange; model bez zmienności dla sesji — powód modelu', () => {
    const m = flatModel(1e-5, at(2026, 11, 3, 16));
    expect(expectedFrom(m, [], NY, NOW, NOW, 100_000)).toEqual(expectedRange(m, [], NY, NOW, 100_000));
    expect(expectedFrom(m, [], NY, NOW, NOW, 0)).toEqual({ why: 'Model HAR nie daje zmienności dla tej sesji' });
  });

  it('bez modelu: Parkinson ze świec 5m; za mało świec — powód na żywo, a dla sesji zamkniętej (asOf < now) ex ante', () => {
    const bars = fiveMin(20, NOW);
    expect(expectedFrom(null, bars, NY, NOW, NOW, 100_000)).toEqual(expectedRange(null, bars, NY, NOW, 100_000));
    expect(expectedFrom(null, bars, NY, NOW, NOW, 100_000)).toMatchObject({ method: 'parkinson' });
    expect(expectedFrom(null, fiveMin(5, NOW), NY, NOW, NOW, 100_000)).toEqual({ why: 'Bez modelu HAR, a za mało zamkniętych świec 5m z ostatniej doby (min. 12)' });
    expect(expectedFrom(null, fiveMin(5, NY.start), NY, NOW, NY.start, 100_000)).toEqual({
      why: 'Ocena ex ante (Parkinson sprzed otwarcia): za mało zamkniętych świec 5m z doby przed sesją (min. 12)',
    });
  });
});
