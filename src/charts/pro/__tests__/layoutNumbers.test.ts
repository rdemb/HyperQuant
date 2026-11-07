import { describe, expect, it } from 'vitest';
import type { Candle } from '../hl/parse';
import { STATIONS } from '../chart/stations';
import { vwapSigma } from '../chart/marketState';
import {
  type LayoutInputs,
  dayVwapOf,
  failedNumbers,
  layoutNumbers,
  liqNearestOf,
  nakedPocOf,
  prevDayOf,
  profileStep,
  rvolOf,
  sessionNowOf,
  twapShareOf,
  whaleBalanceOf,
} from '../chart/layoutNumbers';
import { profile } from '../../../utils/auction';
import { currentTradeSession, previousSameSession } from '../../../utils/sessionDay';

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
const at = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
/** 3.11.2026, NY w toku (14:30–24:00 UTC), IB zamknięty o 15:30 */
const NOW = at(2026, 11, 3, 16, 20);
const NY = currentTradeSession(NOW)!;

const c = (t: number, o: number, h: number, l: number, cl: number, v = 1): Candle => ({ t, o, h, l, c: cl, v, n: 1 });

const cockpit = (patch: Partial<LayoutInputs> = {}): LayoutInputs => ({
  coin: 'BTC',
  now: NOW,
  price: 100_120,
  dayVwap: { vwap: 100_000, sd: 100 },
  session: { s: NY, hi: 100_500, lo: 99_880, close: 100_120, ibHi: 100_300, ibLo: 99_900, ibDone: true, vwap: { vwap: 100_040, sd: 160 } },
  expected: { usd: 1_000, method: 'har' },
  rvol: { value: 1.84, n: 20, hour: at(2026, 11, 3, 16) },
  ...patch,
});

describe('vwapSigma (z faktu VWAP w Stanie rynku)', () => {
  it('odległość w σ zaokrąglona do 0,1; σ z szumu albo brak liczby → null', () => {
    expect(vwapSigma(100_120, 100_000, 100)).toBe(1.2);
    expect(vwapSigma(99_954, 100_000, 100)).toBe(-0.5);
    expect(vwapSigma(100_000, 100_000, 1e-9)).toBeNull();
    expect(vwapSigma(Number.NaN, 100_000, 100)).toBeNull();
  });
});

describe('nagłówek układu: trzy liczby', () => {
  it('Kokpit na znanych wejściach: VWAP w σ (LIVE), budżet zakresu sesji (MODEL · HAR), RVOL bieżącej godziny (MODEL)', () => {
    const n = layoutNumbers('cockpit', cockpit());
    expect(n.map((x) => [x.label, x.value, x.badge])).toEqual([
      ['VWAP', '+1,2σ', 'LIVE'],
      ['Budżet · NY', '62%', 'MODEL'],
      ['RVOL', '1,8×', 'MODEL'],
    ]);
    expect(n[1].hint).toMatch(/^MODEL · HAR: /);
    expect(n[2].hint).toMatch(/^MODEL · /);
    expect(n[2].hint).toContain('20 dni');
    // Bez modelu HAR budżet z σ Parkinsona — nazwa metody w podpowiedzi
    expect(layoutNumbers('cockpit', cockpit({ expected: { usd: 2_000, method: 'parkinson' } }))[1]).toMatchObject({ value: '31%', badge: 'MODEL' });
    expect(layoutNumbers('cockpit', cockpit({ expected: { usd: 2_000, method: 'parkinson' } }))[1].hint).toMatch(/^MODEL · Parkinson: /);
  });

  it('brak VWAP daje „—” z powodem, nigdy 0 ani NaN', () => {
    const missing = layoutNumbers('cockpit', cockpit({ dayVwap: { why: 'świece 1m nie obejmują początku doby UTC' } }))[0];
    expect(missing).toMatchObject({ label: 'VWAP', value: '—', badge: 'LIVE' });
    expect(missing.hint).toContain('początku doby UTC');
    // Jeszcze nie wczytane: „—” i „czekam”
    expect(layoutNumbers('cockpit', cockpit({ dayVwap: undefined }))[0].value).toBe('—');
    expect(layoutNumbers('cockpit', cockpit({ dayVwap: undefined }))[0].hint).toMatch(/Czekam/);
    // σ z szumu (jedna świeca doby)
    expect(layoutNumbers('cockpit', cockpit({ dayVwap: { vwap: 100_000, sd: 0 } }))[0].value).toBe('—');
  });

  it('każdy układ ma zawsze trzy liczby z plakietką; bez danych same „—”', () => {
    for (const st of STATIONS) {
      const n = layoutNumbers(st.id, { coin: 'BTC', now: NOW });
      expect(n, st.id).toHaveLength(3);
      for (const x of n) {
        expect(x.value, `${st.id} ${x.label}`).toBe('—');
        expect(['LIVE', 'MODEL']).toContain(x.badge);
        expect(x.label.length).toBeGreaterThan(0);
        expect(x.hint.length).toBeGreaterThan(0);
      }
    }
  });

  it('MODEL zawsze z nazwą metody w podpowiedzi, także przy braku liczby', () => {
    for (const st of STATIONS) {
      for (const x of layoutNumbers(st.id, { coin: 'BTC', now: NOW })) if (x.badge === 'MODEL') expect(x.hint, `${st.id} ${x.label}`).toMatch(/^MODEL · \S/);
    }
  });

  it('po błędzie liczenia: trzy „—” z powodem, MODEL dalej z nazwą metody', () => {
    for (const st of STATIONS) {
      const n = failedNumbers(st.id, 'BTC', NOW);
      expect(n.map((x) => x.label), st.id).toEqual(layoutNumbers(st.id, { coin: 'BTC', now: NOW }).map((x) => x.label));
      for (const x of n) {
        expect(x.value, `${st.id} ${x.label}`).toBe('—');
        expect(x.hint, `${st.id} ${x.label}`).toContain('Nie udało się policzyć liczby z bieżących danych');
        if (x.badge === 'MODEL') expect(x.hint, `${st.id} ${x.label}`).toMatch(/^MODEL · [^:]+: Nie udało się/);
      }
    }
  });

  it('sesja azjatycka: budżet, IB i VWAP sesji „—” z powodem', () => {
    const asia = at(2026, 11, 3, 2);
    const s = sessionNowOf([c(asia - 30 * MIN, 1, 2, 0.5, 1)], asia);
    expect(s).toMatchObject({ why: expect.stringContaining('Sesja azjatycka') });
    const n = layoutNumbers('auction-open', { coin: 'BTC', now: asia, price: 100_000, session: s, expected: { why: 'x' } });
    expect(n.map((x) => x.value)).toEqual(['—', '—', '—']);
    expect(n[0].hint).toContain('Sesja azjatycka');
  });

  it('Aukcja: stan IB po pierwszej godzinie (wybicie i zakres w IB), budżet, VWAP sesji w σ', () => {
    const n = layoutNumbers('auction-open', cockpit());
    expect(n.map((x) => [x.label, x.value, x.badge])).toEqual([
      ['IB · NY', 'obie strony · 1,6×', 'LIVE'],
      ['Budżet · NY', '62%', 'MODEL'],
      ['VWAP sesji', '+0,5σ', 'LIVE'],
    ]);
    const s = { s: NY, hi: 100_500, lo: 99_900, close: 100_400, ibHi: 100_300, ibLo: 99_900, ibDone: true, vwap: null };
    expect(layoutNumbers('auction-open', cockpit({ session: s }))[0].value).toBe('w górę · 1,5×');
    expect(layoutNumbers('auction-open', cockpit({ session: { ...s, hi: 100_300 } }))[0].value).toBe('w IB');
    expect(layoutNumbers('auction-open', cockpit({ session: { ...s, ibDone: false } }))[0].value).toBe('w budowie');
  });

  it('Paliwo: RVOL, najbliższy klaster likwidacji (% i USD, wiek migawki skanera), koszt zlecenia 100k', () => {
    const n = layoutNumbers('fuel', {
      coin: 'BTC',
      now: NOW,
      price: 100_000,
      rvol: { value: 0.62, n: 18, hour: at(2026, 11, 3, 16) },
      liq: { px: 99_200, ntlUsd: 42_000_000, side: 'long', asOf: NOW - 4 * MIN - 5_000 },
      cost: { ask: 1.23, bid: 1.46, at: NOW - 3_000 },
    });
    expect(n.map((x) => [x.label, x.value, x.badge, x.note ?? null])).toEqual([
      ['RVOL', '0,6×', 'MODEL', null],
      ['Klaster likw.', '−0,80% · 42M', 'LIVE', '4 min'],
      ['Koszt 100k', '1,2 / 1,5 pb', 'LIVE', null],
    ]);
    // Inny rynek: skaner mapuje tylko BTC
    const eth = layoutNumbers('fuel', { coin: 'ETH', now: NOW, price: 3_000, liq: { px: 99_200, ntlUsd: 1e7, side: 'long', asOf: NOW } })[1];
    expect(eth).toMatchObject({ value: '—', note: 'tylko BTC' });
  });

  it('Wielkie ręce: udział TWAP, Hawkes n (MODEL), saldo wielorybów z wiekiem migawki', () => {
    const n = layoutNumbers('big-hands', {
      coin: 'BTC',
      now: NOW,
      twap: { share: 0.124, buy: 0.08, sell: 0.044 },
      hawkes: { n: 0.718, lo: 0.65, hi: 0.79, mu: 1, beta: 2, events: 640 },
      whales: { long: 320e6, short: 210e6, n: 14, asOf: NOW - 60_000 },
    });
    expect(n.map((x) => [x.label, x.value, x.badge, x.note ?? null])).toEqual([
      ['TWAP 15 min', '12%', 'LIVE', null],
      ['Hawkes n', '0,72', 'MODEL', null],
      ['Saldo wielorybów', '+110M', 'LIVE', null],
    ]);
    expect(n[1].hint).toMatch(/^MODEL · Hawkes/);
  });

  it('Mapa dnia: odległość do VAH i VAL wczoraj, najbliższy nagi POC', () => {
    const d = at(2026, 11, 2, 0);
    const n = layoutNumbers('day-map', { coin: 'BTC', now: NOW, price: 105_000, prevDay: { day: d, vah: 105_420, val: 104_160 }, nakedPoc: { day: d - DAY, px: 110_000 } });
    expect(n.map((x) => [x.label, x.value, x.badge])).toEqual([
      ['VAH wczoraj', '+0,40%', 'LIVE'],
      ['VAL wczoraj', '−0,80%', 'LIVE'],
      ['Nagi POC', '+4,76%', 'LIVE'],
    ]);
  });

  it('Rozliczenie: typ dnia (MODEL · Dalton), migracja VA, poziomy mapy dotknięte (LIVE), z oznaczeniem „w toku”', () => {
    const review = {
      s: NY,
      inProgress: true,
      ibHi: 100_300,
      ibLo: 100_000,
      ibDone: true,
      hi: 100_700,
      lo: 100_000,
      hiAt: NY.start + 2 * H,
      loAt: NY.start,
      breakAt: NY.ibEnd,
      close: 100_650,
      step: 10,
      va: { vah: 100_600, val: 100_350 },
      prev: previousSameSession(NY),
      prevVa: { vah: 100_200, val: 99_800 },
    };
    const pub = at(2026, 11, 3, 7, 5);
    const mapHits = { s: NY, kind: 'dzien' as const, publishedAt: pub, touched: 3, total: 9, complete: true, from: pub, to: NY.end };
    const n = layoutNumbers('review', { coin: 'BTC', now: NOW, review, mapHits });
    expect(n.map((x) => [x.label, x.value, x.badge, x.note ?? null])).toEqual([
      ['Typ dnia · NY w toku', 'trendowy', 'MODEL', null],
      ['Migracja VA', 'wyżej', 'LIVE', null],
      ['Mapa: dotknięte', '3/9', 'LIVE', null],
    ]);
    expect(n[0].hint).toMatch(/^MODEL · Dalton/);
    expect(n[2].hint).toMatch(/^Poziomy dotknięte 3\/9: Mapa dnia .*, sesja NY 03\.11, od wpisu do teraz/);
    // Telefon: krótsze podpisy, „w toku” zostaje
    expect(n.map((x) => x.short)).toEqual(['NY w toku', 'VA', 'Mapa']);
    expect(layoutNumbers('review', { coin: 'BTC', now: NOW, review: { ...review, inProgress: false, prevVa: null } })[1].value).toBe('—');
    const closed = layoutNumbers('review', { coin: 'BTC', now: NOW, review: { ...review, inProgress: false }, mapHits });
    expect(closed[0].label).toBe('Typ dnia · NY');
    // Luka w świecach 1m: liczba dotkniętych zostaje, reszta nierozliczona — uwaga zamiast plakietki
    const gap = layoutNumbers('review', { coin: 'BTC', now: NOW, review, mapHits: { ...mapHits, complete: false } })[2];
    expect(gap).toMatchObject({ value: '3/9', note: 'luka' });
    expect(gap.hint).toContain('reszta nierozliczona: luka w świecach 1m');
    // Bez mapy: „—” z powodem
    expect(layoutNumbers('review', { coin: 'BTC', now: NOW, review, mapHits: { why: 'Brak map z bloga' } })[2]).toMatchObject({ value: '—', hint: 'Brak map z bloga' });
    // Inny rynek: mapy z bloga opisują BTC
    expect(layoutNumbers('review', { coin: 'ETH', now: NOW, review, mapHits })[2]).toMatchObject({ value: '—', note: 'tylko BTC' });
  });
});

describe('liczby nagłówka ze świec i migawek', () => {
  /** Świece 1m od `from` do `to` (bez `to`) z wolumenem 1 i stałym zakresem wokół `px`. */
  const minutes = (from: number, to: number, px: (t: number) => number) => {
    const out: Candle[] = [];
    for (let t = from; t < to; t += MIN) out.push(c(t, px(t), px(t) + 5, px(t) - 5, px(t)));
    return out;
  };

  it('sessionNowOf: zakres, IB pierwszej godziny i VWAP sesji ze świec 1m; bez otwarcia sesji w świecach — powód', () => {
    const bars = minutes(at(2026, 11, 3, 14), NOW, (t) => (t < NY.start ? 99_000 : t < NY.ibEnd ? 100_000 : 100_400));
    const s = sessionNowOf(bars, NOW);
    expect(s).toMatchObject({ hi: 100_405, lo: 99_995, close: 100_400, ibHi: 100_005, ibLo: 99_995, ibDone: true });
    if ('why' in s) throw new Error(s.why);
    expect(s.s.id).toBe('ny');
    expect(s.vwap!.vwap).toBeGreaterThan(100_000);
    expect(sessionNowOf(bars.filter((b) => b.t > NY.start), NOW)).toMatchObject({ why: expect.stringContaining('otwarcia sesji') });
  });

  it('dayVwapOf: VWAP doby UTC ze świec 1m od 00:00; świece od później — powód', () => {
    const day = at(2026, 11, 3, 0);
    const bars = minutes(day - 10 * MIN, NOW, () => 100_000);
    const v = dayVwapOf(bars, NOW);
    expect(v).toMatchObject({ vwap: 100_000 });
    expect(dayVwapOf(bars.filter((b) => b.t > day + MIN), NOW)).toMatchObject({ why: expect.stringContaining('00:00 UTC') });
    expect(dayVwapOf([], NOW)).toMatchObject({ why: expect.any(String) });
  });

  it('rvolOf: za krótka historia (poniżej 10 dni) — „za mało historii (min. 10 dni)”', () => {
    const hourly: Candle[] = [];
    for (let t = NOW - 5 * DAY - 16 * H; t <= NOW; t += H) hourly.push(c(Math.floor(t / H) * H, 1, 2, 0.5, 1, 100));
    const r = rvolOf(hourly, NOW);
    expect(r).toEqual({ why: 'za mało historii (min. 10 dni)' });
    const n = layoutNumbers('cockpit', cockpit({ rvol: r }))[2];
    expect(n).toMatchObject({ value: '—', badge: 'MODEL' });
    expect(n.hint).toContain('za mało historii (min. 10 dni)');
  });

  it('rvolOf: 20 dni historii — wolumen godziny wobec mediany przeskalowanej do upływu godziny', () => {
    const hourly: Candle[] = [];
    const h0 = Math.floor(NOW / H) * H;
    for (let t = h0 - 21 * DAY; t < h0; t += H) hourly.push(c(t, 1, 2, 0.5, 1, 120));
    // Po 20 min bieżącej godziny 80 wobec mediany 120 · 20/60 = 40 → 2×
    hourly.push(c(h0, 1, 2, 0.5, 1, 80));
    const r = rvolOf(hourly, NOW);
    expect(r).toMatchObject({ n: 20, hour: h0 });
    if ('why' in r) throw new Error(r.why);
    expect(r.value).toBeCloseTo(2, 9);
  });

  it('profileStep: koszyk profilu ok. 0,01% ceny, okrągły', () => {
    expect(profileStep(100_000)).toBe(10);
    expect(profileStep(3_500)).toBe(0.5);
    expect(profileStep(150)).toBe(0.02);
  });

  /** Doba świec 1h: 23 świece w szerokim zakresie i jedna z dużym wolumenem przy `poc`. */
  const day = (d: number, lo: number, hi: number, poc?: number): Candle[] =>
    Array.from({ length: 24 }, (_, k) => (poc !== undefined && k === 12 ? c(d + k * H, poc, poc + 4, poc - 4, poc, 500) : c(d + k * H, lo, hi, lo, hi)));

  it('prevDayOf i nakedPocOf: VA wczorajszej doby UTC i najbliższy cenie nietknięty POC zamkniętej doby (świece 1h)', () => {
    const today = at(2026, 11, 3, 0);
    const yesterday = day(today - DAY, 104_900, 105_100, 105_000);
    const h1 = [
      ...day(today - 3 * DAY, 97_900, 98_100, 98_000),
      ...day(today - 2 * DAY, 109_900, 110_100, 110_000),
      ...yesterday,
      ...Array.from({ length: 16 }, (_, k) => c(today + k * H, 104_950, 105_050, 104_950, 105_000)),
    ];
    const va = profile(yesterday.map((b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v })), 10)!;
    expect(prevDayOf(h1, NOW, 10)).toEqual({ day: today - DAY, vah: va.vah, val: va.val });
    // POC wczoraj (~105 000) dotknięty dziś, POC 98 000 i 110 000 nagie; bliżej ceny 105 000 jest 110 000
    const naked = nakedPocOf(h1, NOW, 105_000, 10);
    if ('why' in naked) throw new Error(naked.why);
    expect(naked.day).toBe(today - 2 * DAY);
    expect(Math.abs(naked.px - 110_000)).toBeLessThanOrEqual(10);
    // Niepełna wczorajsza doba (brak świecy) — powód zamiast VA
    expect(prevDayOf(h1.filter((b) => b.t !== today - DAY + 5 * H), NOW, 10)).toMatchObject({ why: expect.any(String) });
  });

  it('liqNearestOf, twapShareOf, whaleBalanceOf', () => {
    const levels = [
      { px: 97_000, ntlUsd: 8e6, side: 'long' as const },
      { px: 99_000, ntlUsd: 5e6, side: 'long' as const },
      { px: 101_500, ntlUsd: 9e6, side: 'short' as const },
    ];
    expect(liqNearestOf(levels, 100_000, NOW)).toEqual({ px: 99_000, ntlUsd: 5e6, side: 'long', asOf: NOW });
    expect(liqNearestOf([], 100_000, NOW)).toMatchObject({ why: expect.any(String) });
    expect(
      twapShareOf([
        { notional: 100, side: 1, zero: true },
        { notional: 300, side: -1 },
        { notional: 100, side: -1, zero: true },
      ])
    ).toEqual({ share: 0.4, buy: 0.2, sell: 0.2 });
    expect(twapShareOf([])).toMatchObject({ why: expect.any(String) });
    expect(
      whaleBalanceOf(
        [
          { side: 'long', usd: 300e6 },
          { side: 'long', usd: 20e6 },
          { side: 'short', usd: 210e6 },
        ],
        NOW
      )
    ).toEqual({ long: 320e6, short: 210e6, n: 3, asOf: NOW });
  });
});
