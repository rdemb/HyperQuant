import { describe, expect, it } from 'vitest';
import type { Candle } from '../hl/parse';
import type { BookFrame } from '../core/book';
import type { BlogMap } from '../../../state/useBlogMaps';
import { type InputScan, type InputSeries, type InputStore, RETRY_MS, readInputs, sessionExpectedOf } from '../chart/layoutInputs';
import { isAbsent, layoutNumbers, toVBars } from '../chart/layoutNumbers';
import { currentTradeSession, expectedCandlesFrom, previousSameSession } from '../../../utils/sessionDay';
import { expectedFrom } from '../../../utils/sessionFacts';
import { reviewRows } from '../../../utils/sessionReview';
import { defaultFrameTitle } from '../chart/frame';

const MIN = 60_000;
const M5 = 5 * MIN;
const at = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
/** 3.11.2026 16:20 UTC — sesja NY w toku (14:30–24:00 UTC) */
const IN_NY = at(2026, 11, 3, 16, 20);
const NY = currentTradeSession(IN_NY)!;

const SCAN: InputScan = {
  liq: { status: 'loading', map: null },
  whales: null,
  whalesConfigured: true,
  blog: { state: { status: 'loading', maps: [] }, map: null },
};


/** Seria atrapy: stan wczytania, świece, historia wyczerpana (limit API) albo nieudane doczytanie starszej strony. */
type Spec = { state?: InputSeries['loadState']; list?: Candle[]; exhausted?: boolean; olderFailed?: boolean };

/** Atrapa magazynu rynku: serie świec według interwału, migawka arkusza, taśma; `now` można przesuwać. */
function fakeStore(o: { now: number; coin?: string; price?: number; series?: Record<string, Spec>; book?: BookFrame | null }) {
  const loads: Record<string, number> = {};
  const older: Record<string, number[]> = {};
  const made = new Map<string, InputSeries>();
  const st: InputStore & { now: number; loads: Record<string, number>; older: Record<string, number[]> } = {
    now: o.now,
    loads,
    older,
    coin: o.coin ?? 'BTC',
    serverNow: () => st.now,
    lastPrice: () => o.price ?? 100_000,
    series(id: string): InputSeries {
      let s = made.get(id);
      if (!s) {
        const spec = o.series?.[id] ?? { state: 'loading' };
        s = {
          loadState: spec.state ?? 'ready',
          load: async () => {
            loads[id] = (loads[id] ?? 0) + 1;
          },
          candlesNow: () => spec.list ?? [],
          historyExhausted: spec.exhausted ?? false,
          olderFailed: spec.olderFailed ?? false,
        };
        made.set(id, s);
      }
      return s;
    },
    indicatorCandles(id: string, from: number) {
      (older[id] ??= []).push(from);
      return st.series(id).candlesNow();
    },
    exactBook: () => (o.book === undefined ? null : { latest: () => o.book ?? null }),
    zeroKnown: { covers: () => false },
    orders: { range: () => [] },
  };
  return st;
}

/** Świece 1h od `from` do `to` z zakresem high−low `range(t)` wokół 100 000. */
const bars1h = (from: number, to: number, range: (t: number) => number): Candle[] => {
  const out: Candle[] = [];
  for (let t = Math.floor(from / 3_600_000) * 3_600_000; t < to; t += 3_600_000) out.push({ t, o: 100_000, h: 100_000 + range(t) / 2, l: 100_000 - range(t) / 2, c: 100_000, v: 1, n: 1 });
  return out;
};

/** Świece 5m od `from` do `to` z zakresem high−low `range(t)` wokół 100 000. */
const bars5m = (from: number, to: number, range: (t: number) => number): Candle[] => {
  const out: Candle[] = [];
  for (let t = from; t < to; t += M5) out.push({ t, o: 100_000, h: 100_000 + range(t) / 2, l: 100_000 - range(t) / 2, c: 100_000, v: 1, n: 1 });
  return out;
};

describe('wejścia nagłówka z magazynu rynku', () => {
  it('sesja azjatycka przed pierwszymi świecami: powód Azji od razu, VWAP doby jeszcze się wczytuje', () => {
    const asia = at(2026, 11, 3, 2);
    const store = fakeStore({ now: asia, series: { '1m': { state: 'loading' } } });
    const x = readInputs('cockpit', store, SCAN);
    expect(x.dayVwap).toBeUndefined();
    expect(x.session).toMatchObject({ why: expect.stringContaining('Sesja azjatycka') });
    expect(x.expected).toMatchObject({ why: expect.stringContaining('Sesja azjatycka') });
    const n = layoutNumbers('cockpit', x);
    expect(n[0]).toMatchObject({ value: '—', hint: 'Czekam na dane…' });
    expect(n[1].hint).toContain('Sesja azjatycka');
    // W sesji NY przed świecami — jeszcze bez powodu (wczytywanie)
    expect(readInputs('cockpit', fakeStore({ now: IN_NY, series: { '1m': { state: 'loading' } } }), SCAN).session).toBeUndefined();
  });

  it('oczekiwany zakres sesji do rozliczenia: ten sam w toku i po zamknięciu, ze świec 1h sprzed otwarcia (od expectedCandlesFrom)', () => {
    // Spokojnie (zakres świecy 100) do otwarcia NY 3.11, w sesji NY nerwowo (2 000)
    const range = (t: number) => (t >= NY.start && t < NY.end ? 2_000 : 100);
    const from = expectedCandlesFrom(NY);
    const live = bars1h(from, IN_NY, range);
    const inStore = fakeStore({ now: IN_NY, series: { '1h': { list: live } } });
    const got = sessionExpectedOf(inStore, NY)!;
    expect(got).toEqual(expectedFrom(toVBars(live), NY));
    expect(got).toMatchObject({ method: 'profile', usd: expect.any(Number), typical: expect.any(Number) });
    expect(inStore.older['1h']).toContain(from);

    const asia = at(2026, 11, 4, 2);
    const all = bars1h(from, asia, range);
    expect(sessionExpectedOf(fakeStore({ now: asia, series: { '1h': { list: all } } }), NY)).toEqual(got);
    // Świece 1h jeszcze się wczytują — undefined (czekamy), nie liczba zastępcza
    expect(sessionExpectedOf(fakeStore({ now: asia, series: { '1h': { state: 'loading' } } }), NY)).toBeUndefined();
  });

  it('za krótka historia 1h (wyczerpana): powód zamiast liczby', () => {
    const short = bars1h(NY.start - 10 * 86_400_000, IN_NY, () => 100);
    const got = sessionExpectedOf(fakeStore({ now: IN_NY, series: { '1h': { list: short, exhausted: true } } }), NY);
    expect(got).toEqual({ why: 'Mniej niż 20 dni roboczych ze świecami 1h w 80 dniach przed sesją' });
  });

  it('nagłówek Rozliczenia i karta liczą typ dnia i migrację VA z tych samych faktów (świece 1m od poprzedniej sesji)', () => {
    // NY 2.11 płasko 99 500, potem do otwarcia NY 3.11 100 000; NY 3.11: IB 100 000–100 300, wybicie w górę do 100 700
    const px = (t: number) => (t < NY.start ? (t < at(2026, 11, 3, 0) ? 99_500 : 100_000) : t < NY.start + 30 * MIN ? 100_005 : t < NY.ibEnd ? 100_295 : 100_690);
    const ones: Candle[] = [];
    for (let t = at(2026, 11, 2, 14, 30); t <= IN_NY; t += MIN) ones.push({ t, o: px(t), h: px(t) + 5, l: px(t) - 5, c: px(t), v: 1, n: 1 });
    const store = fakeStore({ now: IN_NY, series: { '1m': { list: ones } } });
    const head = layoutNumbers('review', readInputs('review', store, SCAN));
    // Świece 1m od otwarcia poprzedniej sesji NY (migracja VA)
    expect(store.older['1m']).toContain(previousSameSession(NY).start);
    const rows = reviewRows({
      s: NY,
      inProgress: true,
      now: IN_NY,
      bars1m: toVBars(ones),
      maps: { status: 'loading', maps: [] },
      expected: undefined,
      liq: { status: 'loading', tape: null },
      cohorts: { status: 'loading', flow: null },
      ledger: { status: 'loading', summary: null },
    });
    const card = (id: string) => rows.find((r) => r.id === id)!.value;
    expect([head[0].value, head[1].value]).toEqual([card('dayType'), card('vaMigration')]);
    expect([head[0].value, head[1].value]).toEqual(['trendowy', 'wyżej']);
    // Starsze świece 1m nie dotarły: nagłówek czeka albo podaje powód, bez liczby z części danych
    const partial = (o: Partial<Spec>) => fakeStore({ now: IN_NY, series: { '1m': { list: ones.filter((c) => c.t >= NY.start - 60 * MIN), ...o } } });
    expect(readInputs('review', partial({}), SCAN).review).toBeUndefined();
    expect(readInputs('review', partial({ olderFailed: true }), SCAN).review).toEqual({ why: 'Nie udało się pobrać starszych świec 1m — kolejna próba za ≤ 30 s' });
    expect(layoutNumbers('review', readInputs('review', partial({ exhausted: true }), SCAN))[1]).toMatchObject({ value: '—', hint: expect.stringContaining('poprzedniej sesji') });
  });

  it('Rozliczenie: poziomy mapy z bloga dotknięte w oknie mapy — ta sama reguła co ✓ na wykresie (świece 1m od wpisu)', () => {
    const pub = at(2026, 11, 3, 7, 5) + 20_000;
    const map: BlogMap = {
      id: '2026-11-03-mapa-dnia',
      title: 'Mapa',
      kind: 'dzien',
      publishedAt: pub,
      price: 100_000,
      levels: [
        { label: 'A', price: 100_050 },
        { label: 'B', price: 99_000 },
      ],
      url: 'blog/2026-11-03-mapa-dnia/',
    };
    const ones: Candle[] = [];
    for (let t = at(2026, 11, 3, 7); t <= IN_NY; t += MIN) ones.push({ t, o: 100_000, h: t === at(2026, 11, 3, 9) ? 100_060 : 100_010, l: 99_990, c: 100_000, v: 1, n: 1 });
    const store = fakeStore({ now: IN_NY, series: { '5m': { list: bars5m(at(2026, 11, 2, 14, 30), IN_NY, () => 10) }, '1m': { list: ones } } });
    const x = readInputs('review', store, { ...SCAN, blog: { state: { status: 'ready', maps: [map] }, map } });
    expect(x.mapHits).toEqual({ s: NY, kind: 'dzien', publishedAt: pub, touched: 1, total: 2, complete: true, from: pub, to: NY.end });
    // Świece 1m od początku okna mapy (wykres doczytuje starsze, jak warstwa)
    expect(store.older['1m']).toContain(pub);
    // Luka w środku okna: dotknięcie zostaje, rozliczenie niepełne
    const gap = fakeStore({ now: IN_NY, series: { '1m': { list: ones.filter((c) => c.t < at(2026, 11, 3, 12) || c.t >= at(2026, 11, 3, 12, 5)) } } });
    expect(readInputs('review', gap, { ...SCAN, blog: { state: { status: 'ready', maps: [map] }, map } }).mapHits).toMatchObject({ touched: 1, complete: false });
    // Bez pliku map: powód z legendy warstwy; w sesji tylko mapa tygodnia — bez rozliczenia; bez mapy sesji — powód z sesją
    expect(readInputs('review', store, { ...SCAN, blog: { state: { status: 'missing', maps: [] }, map: null } }).mapHits).toEqual({ why: 'Brak map z bloga' });
    // Mapa bez okna sesji opublikowana w NY należy do karty NY (sessionMaps)
    const weekly = { ...map, id: 'tydzien', kind: 'inne' as const, publishedAt: at(2026, 11, 3, 15) };
    expect(readInputs('review', store, { ...SCAN, blog: { state: { status: 'ready', maps: [weekly] }, map: weekly } }).mapHits).toMatchObject({
      why: expect.stringContaining('bez rozliczenia'),
    });
    expect(readInputs('review', store, { ...SCAN, blog: { state: { status: 'ready', maps: [] }, map: null } }).mapHits).toEqual({
      why: 'Brak mapy z bloga dla sesji NY 03.11 (plik ma mapy z ostatnich 3 dni)',
    });
    // Świece 1m nie sięgają wpisu: starsze w drodze — czekamy (undefined); historia wyczerpana — powód; nieudane doczytanie —
    // powód z ponowną próbą (brak ✓ nigdy nie znaczy „nie dotknięto”)
    const late = (o: Partial<Spec>) => fakeStore({ now: IN_NY, series: { '1m': { list: ones.filter((c) => c.t >= at(2026, 11, 3, 8)), ...o } } });
    const blog = { ...SCAN, blog: { state: { status: 'ready' as const, maps: [map] }, map } };
    expect(readInputs('review', late({}), blog).mapHits).toBeUndefined();
    expect(readInputs('review', late({ exhausted: true }), blog).mapHits).toMatchObject({ why: expect.stringContaining('nie sięgają wpisu') });
    expect(readInputs('review', late({ olderFailed: true }), blog).mapHits).toEqual({ why: 'Nie udało się pobrać starszych świec 1m — kolejna próba za ≤ 30 s' });
  });

  describe('Rozliczenie w sesji azjatyckiej: typ dnia, migracja VA i mapa opisują tę samą sesję (wczorajszy NY)', () => {
    const mapOf = (id: string, kind: BlogMap['kind'], publishedAt: number, levels: BlogMap['levels']): BlogMap => ({ id, title: id, kind, publishedAt, price: 100_000, levels, url: `blog/${id}/` });
    const pub3 = at(2026, 11, 3, 7, 5) + 20_000;
    const pub4 = at(2026, 11, 4, 7, 5) + 20_000;
    // Mapa dnia 3.11: A dotknięty o 15:00 (w NY), B nie; Mapa przed NY 3.11: C dotknięty; Mapa dnia 4.11: D (dotknięty w Azji 4.11)
    const day3 = mapOf('2026-11-03-mapa-dnia', 'dzien', pub3, [
      { label: 'A', price: 100_050 },
      { label: 'B', price: 99_000 },
    ]);
    const preNy3 = mapOf('2026-11-03-przed-ny', 'ny', at(2026, 11, 3, 13), [{ label: 'C', price: 100_050 }]);
    const day4 = mapOf('2026-11-04-mapa-dnia', 'dzien', pub4, [{ label: 'D', price: 100_200 }]);
    const ones: Candle[] = [];
    for (let t = at(2026, 11, 2, 14, 30); t <= at(2026, 11, 4, 7, 30); t += MIN) {
      const h = t === at(2026, 11, 3, 15) ? 100_060 : t === at(2026, 11, 4, 7, 20) ? 100_210 : 100_010;
      ones.push({ t, o: 100_000, h, l: 99_990, c: 100_000, v: 1, n: 1 });
    }
    const maps = [day3, preNy3, day4];
    const read = (now: number, picked: BlogMap | null) =>
      readInputs('review', fakeStore({ now, series: { '1m': { list: ones.filter((c) => c.t < now) } } }), { ...SCAN, blog: { state: { status: 'ready', maps }, map: picked } });

    it('przed dzisiejszą Mapą dnia i po niej: mapa wczorajszej sesji NY, rozliczona do końca tej sesji', () => {
      for (const [now, picked] of [
        [at(2026, 11, 4, 2), null],
        [at(2026, 11, 4, 7, 30), day4],
      ] as const) {
        const x = read(now, picked);
        expect(x.review, String(now)).toMatchObject({ s: NY, inProgress: false });
        expect(x.mapHits, String(now)).toEqual({ s: NY, kind: 'dzien', publishedAt: pub3, touched: 1, total: 2, complete: true, from: pub3, to: NY.end });
        const n = layoutNumbers('review', x);
        expect(n[0].short, String(now)).toBe('Typ · NY');
        expect(n[2], String(now)).toMatchObject({ value: '1/2', badge: 'LIVE' });
        expect(n[2].hint, String(now)).toContain('sesja NY 03.11');
      }
    });

    it('mapa wybrana w ustawieniach zostaje, gdy należy do tej sesji; inna — mapa sesji', () => {
      expect(read(at(2026, 11, 4, 2), preNy3).mapHits).toMatchObject({ s: NY, kind: 'ny', touched: 1, total: 1 });
      expect(read(at(2026, 11, 4, 7, 30), day4).mapHits).toMatchObject({ kind: 'dzien', publishedAt: pub3 });
    });
  });

  it('koszt 100k: migawka arkusza starsza niż 30 s — „—” z powodem; świeża — ask i bid w pb', () => {
    const frame = (t: number): BookFrame => ({
      t,
      step: 1,
      px: Float64Array.from([99_999, 99_998, 100_001, 100_002]),
      sz: Float64Array.from([5, 5, 5, 5]),
      n: Float64Array.from([1, 1, 1, 1]),
      nBids: 2,
    });
    const stale = readInputs('fuel', fakeStore({ now: IN_NY, book: frame(IN_NY - 31_000) }), SCAN);
    expect(stale.cost).toMatchObject({ why: expect.stringContaining('nieaktualna') });
    expect(layoutNumbers('fuel', stale)[2]).toMatchObject({ value: '—' });
    const fresh = readInputs('fuel', fakeStore({ now: IN_NY, book: frame(IN_NY - 1_000) }), SCAN);
    expect(fresh.cost).toMatchObject({ at: IN_NY - 1_000 });
    if (!fresh.cost || isAbsent(fresh.cost)) throw new Error('brak kosztu');
    expect(fresh.cost.ask).toBeCloseTo(0.1, 6);
    expect(fresh.cost.bid).toBeCloseTo(0.1, 6);
    // Bez migawki — jeszcze się wczytuje
    expect(readInputs('fuel', fakeStore({ now: IN_NY }), SCAN).cost).toBeUndefined();
  });

  it('nieudane wczytanie świec: powód od razu, ponowna próba dopiero po 30 s i potem znów co 30 s', () => {
    const store = fakeStore({ now: IN_NY, series: { '1h': { state: 'error' } } });
    const x = readInputs('fuel', store, SCAN);
    expect(x.rvol).toMatchObject({ why: expect.stringContaining('Nie udało się pobrać świec 1h') });
    expect(store.loads['1h'] ?? 0).toBe(0);
    store.now += RETRY_MS - 1;
    readInputs('fuel', store, SCAN);
    expect(store.loads['1h'] ?? 0).toBe(0);
    store.now += 1;
    readInputs('fuel', store, SCAN);
    expect(store.loads['1h']).toBe(1);
    readInputs('fuel', store, SCAN);
    expect(store.loads['1h']).toBe(1);
    store.now += RETRY_MS;
    readInputs('fuel', store, SCAN);
    expect(store.loads['1h']).toBe(2);
  });

  describe('budżet zakresu: jedna metoda (profil × poziom) na każdym rynku', () => {
    const ones: Candle[] = [];
    for (let t = NY.start - 60 * MIN; t <= IN_NY; t += MIN) ones.push({ t, o: 100_000, h: 100_100, l: 99_900, c: 100_000, v: 1, n: 1 });
    const store = (coin = 'BTC', h1: Spec = { list: bars1h(expectedCandlesFrom(NY), IN_NY, () => 100) }) =>
      fakeStore({ now: IN_NY, coin, series: { '1m': { list: ones }, '1h': h1 } });

    it('BTC i ETH: ta sama metoda ze świec 1h rynku, etykieta bez nazwy metody, metoda w podpowiedzi', () => {
      for (const coin of ['BTC', 'ETH']) {
        const x = readInputs('cockpit', store(coin), SCAN);
        expect(x.expected, coin).toMatchObject({ method: 'profile' });
        const b = layoutNumbers('cockpit', x)[1];
        expect(b, coin).toMatchObject({ label: 'Budżet · NY', short: 'Budżet', badge: 'MODEL', value: expect.stringMatching(/^\d+%$/) });
        expect(b.hint, coin).toMatch(/^MODEL · profil × poziom: .*typowy dzień ok\./);
      }
    });

    it('świece 1h w drodze: „—” z powodem, w tytule Klatki „—”', () => {
      const x = readInputs('cockpit', store('BTC', { state: 'loading' }), SCAN);
      expect(x.expected).toBeUndefined();
      const nums = layoutNumbers('cockpit', x);
      expect(nums[1]).toMatchObject({ label: 'Budżet · NY', value: '—', badge: 'MODEL' });
      expect(defaultFrameTitle('Kokpit?', nums)).toContain('; Budżet · NY: — (brak danych); ');
      const ok = layoutNumbers('cockpit', readInputs('cockpit', store(), SCAN));
      expect(defaultFrameTitle('Kokpit?', ok)).toMatch(/; Budżet · NY: \d+% \(MODEL\); /);
    });
  });

  it('wieloryby i mapa likwidacji: te same powody co plakietki legendy', () => {
    const x = readInputs('big-hands', fakeStore({ now: IN_NY }), { ...SCAN, whalesConfigured: false });
    expect(x.whales).toEqual({ why: 'Warstwa wielorybów niedostępna w tej wersji strony' });
    expect(x.twap).toMatchObject({ why: expect.stringContaining('TWAP') });
    const w = { v: 2, asOf: IN_NY - 60_000, accounts: 1, candidates: 1, minPositionUsd: {}, minOrderUsd: {}, markets: { BTC: { positions: [{ id: 'a', side: 'long' as const, usd: 5e6, entry: 1, liq: null, lev: 1, at: 0 }], orders: [] } } };
    expect(readInputs('big-hands', fakeStore({ now: IN_NY }), { ...SCAN, whales: w }).whales).toEqual({ long: 5e6, short: 0, n: 1, asOf: IN_NY - 60_000 });
    expect(readInputs('fuel', fakeStore({ now: IN_NY }), { ...SCAN, liq: { status: 'unconfigured', map: null } }).liq).toEqual({ why: 'Mapa likwidacji niedostępna w tej wersji strony' });
  });
});
