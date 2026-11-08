import { describe, expect, it } from 'vitest';
import { completeHourly, computeAuctionContext, hourlyStale, mergeMinute, minuteFrom } from '../useAuctionContext';
import { prevSessionProfile } from '../../utils/sessionFacts';
import { isAbsent } from '../../utils/sessionText';
import type { VBar } from '../../utils/auction';

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;
const TODAY = Date.UTC(2026, 9, 22);

/** Świece o stałym zakresie ±5 USD wokół `mid` (wolumen 1) od `from` przez `n` interwałów. */
function flat(from: number, n: number, step: number, mid: number): VBar[] {
  return Array.from({ length: n }, (_, i) => ({ time: from + i * step, open: mid, high: mid + 5, low: mid - 5, close: mid, volume: 1 }));
}

describe('świece 1h: tylko zamknięte; odświeżenie po zmianie dnia UTC', () => {
  it('świeca godziny jeszcze trwającej w chwili pobrania jest odrzucana', () => {
    const bars = flat(TODAY - 2 * H, 3, H, 100_000); // 22:00, 23:00, 00:00
    expect(completeHourly(bars, TODAY - 20 * MIN).map((b) => b.time)).toEqual([TODAY - 2 * H]); // 23:00 trwa
    expect(completeHourly(bars, TODAY + H).map((b) => b.time)).toEqual([TODAY - 2 * H, TODAY - H, TODAY]);
  });
  it('pamięć 1h nieaktualna po 30 min albo po północy UTC (wczorajsza sesja musi być kompletna)', () => {
    expect(hourlyStale(null, TODAY)).toBe(true);
    expect(hourlyStale(TODAY - 20 * MIN, TODAY + 5 * MIN)).toBe(true); // pobrane 23:40, teraz 00:05
    expect(hourlyStale(TODAY + MIN, TODAY + 20 * MIN)).toBe(false);
    expect(hourlyStale(TODAY + MIN, TODAY + 40 * MIN)).toBe(true);
  });
});

describe('świece 1m: dociąganie końcówki zamiast całej doby', () => {
  it('nowe świece zastępują ostatnią (trwającą); starsze niż początek poprzedniej sesji odpadają', () => {
    const cache = flat(TODAY - D - 2 * MIN, 5, MIN, 100_000); // dwie sprzed poprzedniej sesji
    const fresh = [{ ...cache[4], close: 100_050, high: 100_060 }, ...flat(cache[4].time + MIN, 2, MIN, 100_100)];
    const merged = mergeMinute(cache, fresh, TODAY - D);
    expect(merged.map((b) => b.time)).toEqual([TODAY - D, TODAY - D + MIN, TODAY - D + 2 * MIN, TODAY - D + 3 * MIN, TODAY - D + 4 * MIN]);
    expect(merged[2]).toEqual(fresh[0]);
  });
});

// 22.10.2026: Londyn w BST (08:00 = 07:00 UTC), NY w EDT (09:30 = 13:30 UTC)
const LON = 7 * H;
const NY = 13.5 * H;
/** 40 pełnych dób 1h przed dniem `TODAY` po 100 000 */
const history = Array.from({ length: 40 }, (_, d) => flat(TODAY - (40 - d) * D, 24, H, 100_000)).flat();

describe('computeAuctionContext — sesja Londynu: poziomy i stan ze świec', () => {
  const now = TODAY + LON + 3 * H + 30 * MIN; // 10:30 UTC
  // Wczoraj cała doba po 100 000, dziś Azja po 100 100 (nie wchodzi do sesji), Londyn od 07:00 po 100 300
  const minute = [...flat(TODAY - D, 1440, MIN, 100_000), ...flat(TODAY, 420, MIN, 100_100), ...flat(TODAY + LON, 210, MIN, 100_300)];
  const hourly = [...history, ...flat(TODAY, 10, H, 100_300)];
  const ctx = computeAuctionContext(minute, hourly, now);

  it('sesja Londyn w toku; VWAP tylko ze świec 1m sesji (bez Azji); IB z pierwszej godziny sesji', () => {
    expect(ctx.status).toBe('ready');
    expect(ctx.session).toEqual({ id: 'london', start: TODAY + LON, end: TODAY + NY, ibEnd: TODAY + LON + H, closed: false });
    expect(ctx.next).toBeNull();
    expect(ctx.vwap!.vwap).toBeCloseTo(100_300, 6);
    expect(ctx.ib).toEqual({ hi: 100_305, lo: 100_295, done: true });
  });

  it('poprzednia sesja = Londyn wczoraj (profil z 1m); stan sesji w regułach statystyki; częstości tylko z Londynu', () => {
    expect(ctx.prev!.high).toBe(100_005);
    expect(ctx.prev!.low).toBe(99_995);
    expect(ctx.today!.start).toBe(TODAY + LON);
    expect(ctx.today!.openLoc).toBe('above');
    expect(ctx.today!.prev1h.high).toBe(100_005);
    expect(ctx.stats!.n).toBe(39); // 40 pełnych sesji Londynu → 39 par
  });

  it('IB w trakcie przez pierwszą godzinę sesji (nie 00:00–01:00 UTC)', () => {
    const early = computeAuctionContext([...flat(TODAY - D, 1440, MIN, 100_000), ...flat(TODAY, 420, MIN, 100_100), ...flat(TODAY + LON, 30, MIN, 100_300)], hourly, TODAY + LON + 30 * MIN);
    expect(early.ib).toEqual({ hi: 100_305, lo: 100_295, done: false });
    expect(early.today!.ibDone).toBe(false);
  });

  it('niepełna poprzednia sesja w 1m (< 95% minut) → bez profilu zamiast profilu z dziurą', () => {
    const partial = computeAuctionContext([...flat(TODAY - D + 10 * H, 840, MIN, 100_000), ...flat(TODAY, 420, MIN, 100_100), ...flat(TODAY + LON, 210, MIN, 100_300)], hourly, now);
    expect(partial.prev).toBeNull();
  });
});

describe('computeAuctionContext — sesja NY i sesja azjatycka', () => {
  it('NY w toku: poprzednia sesja = NY wczoraj, częstości z sesji NY', () => {
    const now = TODAY + NY + 2 * H; // 15:30 UTC
    const minute = [...flat(TODAY - D, 1440, MIN, 100_000), ...flat(TODAY, 810, MIN, 100_100), ...flat(TODAY + NY, 120, MIN, 100_500)];
    const ctx = computeAuctionContext(minute, [...history, ...flat(TODAY, 15, H, 100_100)], now);
    expect(ctx.session).toMatchObject({ id: 'ny', start: TODAY + NY, closed: false });
    expect(ctx.vwap!.vwap).toBeCloseTo(100_500, 6);
    expect(ctx.ib).toEqual({ hi: 100_505, lo: 100_495, done: true });
    expect(ctx.prev!.high).toBe(100_005);
    expect(ctx.today!.openLoc).toBe('above');
    expect(ctx.stats!.n).toBe(39);
  });

  it('w Azji: ostatnia zamknięta sesja (NY poprzedniej doby) oznaczona jako zamknięta i otwarcie następnej', () => {
    const now = TODAY + 2 * H;
    const minute = [
      ...flat(TODAY - 2 * D, 1440 + 810, MIN, 100_000), // przedwczoraj i wczoraj do 13:29
      ...flat(TODAY - D + NY, 630, MIN, 100_400), // NY wczoraj 13:30–24:00
      ...flat(TODAY, 120, MIN, 100_100), // Azja dziś
    ];
    const hourly = [...history.filter((b) => b.time < TODAY - D), ...flat(TODAY - D, 13, H, 100_000), ...flat(TODAY - D + 13 * H, 11, H, 100_400), ...flat(TODAY, 2, H, 100_100)];
    const ctx = computeAuctionContext(minute, hourly, now);
    expect(ctx.session).toEqual({ id: 'ny', start: TODAY - D + NY, end: TODAY, ibEnd: TODAY - D + NY + H, closed: true });
    expect(ctx.next).toMatchObject({ id: 'london', start: TODAY + LON });
    expect(ctx.vwap!.vwap).toBeCloseTo(100_400, 6); // VWAP zamkniętej sesji, nie Azji
    expect(ctx.ib).toEqual({ hi: 100_405, lo: 100_395, done: true });
    expect(ctx.prev!.high).toBe(100_005); // NY przedwczoraj z 1m
    expect(ctx.today!.openLoc).toBe('above');
    expect(ctx.stats!.n).toBe(38); // NY wczoraj (sesja pokazywana) nie wchodzi do historii
  });

  it('przez otwarcie NY: 13:29 UTC jeszcze Londyn, 13:31 NY z IB w trakcie, VWAP i częstości tylko z NY', () => {
    const minute = [...flat(TODAY - D, 1440, MIN, 100_000), ...flat(TODAY, 420, MIN, 100_100), ...flat(TODAY + LON, 390, MIN, 100_300), ...flat(TODAY + NY, 2, MIN, 100_500)];
    const hourly = [...history, ...flat(TODAY, 13, H, 100_200)];
    const before = computeAuctionContext(minute, hourly, TODAY + NY - MIN);
    expect(before.session).toMatchObject({ id: 'london', start: TODAY + LON, closed: false });
    expect(before.vwap!.vwap).toBeCloseTo(100_300, 6);
    expect(before.ib!.done).toBe(true);
    expect(before.stats!.n).toBe(39);
    const after = computeAuctionContext(minute, hourly, TODAY + NY + MIN);
    expect(after.session).toMatchObject({ id: 'ny', start: TODAY + NY, ibEnd: TODAY + NY + H, closed: false });
    expect(after.vwap!.vwap).toBeCloseTo(100_500, 6); // tylko świeca 13:30 (13:31 jeszcze trwa)
    expect(after.ib).toEqual({ hi: 100_505, lo: 100_495, done: false });
    expect(after.today).toMatchObject({ start: TODAY + NY, ibDone: false, openLoc: 'above' });
    expect(after.prev!.high).toBe(100_005); // NY wczoraj
    expect(after.stats!.n).toBe(39); // 40 sesji NY w historii
  });

  it('świece 1m pobierane od początku poprzedniej sesji tego samego typu', () => {
    expect(minuteFrom(TODAY + LON + 3 * H)).toBe(TODAY - D + LON);
    expect(minuteFrom(TODAY + NY + H)).toBe(TODAY - D + NY);
    expect(minuteFrom(TODAY + 2 * H)).toBe(TODAY - 2 * D + NY); // w Azji: NY sprzed zamkniętej NY
  });
});

describe('prevSessionProfile: profil poprzedniej sesji (Kontekst aukcji Przed sesją i serwer MCP)', () => {
  const lonNow = TODAY + LON + 3 * H + 30 * MIN;
  const asiaNow = TODAY + 2 * H;
  // Wczoraj Londyn płasko po 100 200, NY wczoraj po 100 400, NY przedwczoraj po 100 000
  const minute = [
    ...flat(TODAY - 2 * D, 1440, MIN, 100_000),
    ...flat(TODAY - D, 420, MIN, 100_000),
    ...flat(TODAY - D + LON, 390, MIN, 100_200),
    ...flat(TODAY - D + NY, 630, MIN, 100_400),
    ...flat(TODAY, 420, MIN, 100_100),
    ...flat(TODAY + LON, 210, MIN, 100_300),
  ];

  it('ten sam wynik co poziomy „poprz. sesji” Kontekstu aukcji (Londyn w toku i Azja)', () => {
    for (const now of [lonNow, asiaNow]) {
      const bars = minute.filter((b) => b.time < now);
      const ctx = computeAuctionContext(bars, [], now);
      const s = ctx.session!;
      const p = prevSessionProfile(bars, s);
      if (isAbsent(p)) throw new Error(p.why);
      expect(p).toEqual(ctx.prev);
    }
    const p = prevSessionProfile(minute, computeAuctionContext(minute, [], lonNow).session!);
    expect(p).toMatchObject({ high: 100_205, low: 100_195 });
  });

  it('mniej niż 95% minut poprzedniej sesji — powód z nazwą i datą sesji; świece bez wolumenu — powód', () => {
    const s = computeAuctionContext(minute, [], lonNow).session!;
    const holes = minute.filter((b, i) => b.time < TODAY - D + LON || b.time >= TODAY - D + NY || i % 10 !== 0);
    expect(prevSessionProfile(holes, s)).toEqual({ why: expect.stringContaining('nie obejmują poprzedniej sesji Londyn') });
    const silent = minute.map((b) => ({ ...b, volume: 0 }));
    expect(prevSessionProfile(silent, s)).toEqual({ why: expect.stringContaining('wolumen') });
  });
});
