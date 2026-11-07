import { describe, expect, it } from 'vitest';
import type { Candle } from '../hl/parse';
import type { BookFrame } from '../core/book';
import type { BlogMap } from '../../../state/useBlogMaps';
import { type InputScan, type InputSeries, type InputStore, RETRY_MS, readInputs, sessionExpectedOf } from '../chart/layoutInputs';
import { isAbsent, layoutNumbers, toVBars } from '../chart/layoutNumbers';
import { currentTradeSession, expectedRange, previousSameSession } from '../../../utils/sessionDay';
import { reviewRows } from '../../../utils/sessionReview';
import { defaultFrameTitle } from '../chart/frame';
import type { VolModel } from '../../../utils/volatility';

const MIN = 60_000;
const M5 = 5 * MIN;
const at = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
/** 3.11.2026 16:20 UTC — sesja NY w toku (14:30–24:00 UTC) */
const IN_NY = at(2026, 11, 3, 16, 20);
const NY = currentTradeSession(IN_NY)!;

const SCAN: InputScan = {
  model: null,
  volStatus: 'error',
  liq: { status: 'loading', map: null },
  whales: null,
  whalesConfigured: true,
  blog: { state: { status: 'loading', maps: [] }, map: null },
};

/** Model zmienności nie wczytał się (błąd): budżet z σ Parkinsona. */
const NO_MODEL = { status: 'error', model: null } as const;

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

  it('oczekiwany zakres sesji do rozliczenia: w toku — na teraz; zamknięta — sprzed jej otwarcia (ex ante), także z modelem HAR', () => {
    // Spokojnie (zakres świecy 10) do otwarcia NY 3.11, w sesji NY nerwowo (200), potem znów spokojnie
    const range = (t: number) => (t >= NY.start && t < NY.end ? 200 : 10);
    const live = bars5m(at(2026, 11, 2, 14, 30), IN_NY, range);
    expect(sessionExpectedOf(fakeStore({ now: IN_NY, series: { '5m': { list: live } } }), NO_MODEL, NY, true, 100_000)).toEqual(expectedRange(null, toVBars(live), NY, IN_NY, 100_000));

    const asia = at(2026, 11, 4, 2);
    const all = bars5m(at(2026, 11, 2, 14, 30), asia, range);
    const got = sessionExpectedOf(fakeStore({ now: asia, series: { '5m': { list: all } } }), NO_MODEL, NY, false, 100_000);
    const exAnte = expectedRange(null, toVBars(all), NY, NY.start, 100_000)!;
    const atNow = expectedRange(null, toVBars(all), NY, asia, 100_000)!;
    expect(got).toEqual(exAnte);
    // Ze świec sprzed sesji (spokojnych) oczekiwanie jest mniejsze niż z ostatniej doby, w której była już nerwowa sesja
    expect(exAnte.usd).toBeLessThan(atNow.usd / 5);
    expect(exAnte.method).toBe('parkinson');
    // Model HAR zna tylko dzisiejszy poziom zmienności: zamkniętą sesję i tak ocenia Parkinson sprzed jej otwarcia
    const har = {} as VolModel;
    expect(sessionExpectedOf(fakeStore({ now: asia, series: { '5m': { list: all } } }), { status: 'ready', model: har }, NY, false, 100_000)).toEqual(exAnte);
    // Model w drodze też nie zmienia oceny zamkniętej sesji
    expect(sessionExpectedOf(fakeStore({ now: asia, series: { '5m': { list: all } } }), { status: 'loading', model: null }, NY, false, 100_000)).toEqual(exAnte);
    // 5m jeszcze się wczytują — undefined (czekamy), nie liczba zastępcza
    expect(sessionExpectedOf(fakeStore({ now: asia, series: { '5m': { state: 'loading' } } }), NO_MODEL, NY, false, 100_000)).toBeUndefined();
  });

  it('zamknięta sesja bez świec 5m sprzed otwarcia: powód to ocena ex ante, nie „Bez modelu HAR” (także z wczytanym modelem)', () => {
    const asia = at(2026, 11, 4, 2);
    // Świece 5m dopiero od otwarcia NY — z doby przed sesją ani jednej
    const late = bars5m(NY.start, asia, () => 10);
    for (const vol of [{ status: 'ready', model: {} as VolModel }, NO_MODEL] as const) {
      const got = sessionExpectedOf(fakeStore({ now: asia, series: { '5m': { list: late } } }), vol, NY, false, 100_000);
      expect(got).toEqual({ why: 'Ocena ex ante (Parkinson sprzed otwarcia): za mało zamkniętych świec 5m z doby przed sesją (min. 12)' });
    }
    // Sesja w toku bez modelu — tu „Bez modelu HAR” jest prawdą
    const live = sessionExpectedOf(fakeStore({ now: IN_NY, series: { '5m': { list: [] } } }), NO_MODEL, NY, true, 100_000);
    expect(live).toEqual({ why: 'Bez modelu HAR, a za mało zamkniętych świec 5m z ostatniej doby (min. 12)' });
  });

  it('sesja w toku do rozliczenia: model HAR w drodze — czekamy (undefined), bez Parkinsona w zastępstwie; błąd modelu — Parkinson', () => {
    const live = bars5m(at(2026, 11, 2, 14, 30), IN_NY, () => 10);
    const store = () => fakeStore({ now: IN_NY, series: { '5m': { list: live } } });
    expect(sessionExpectedOf(store(), { status: 'loading', model: null }, NY, true, 100_000)).toBeUndefined();
    expect(sessionExpectedOf(store(), NO_MODEL, NY, true, 100_000)).toMatchObject({ method: 'parkinson' });
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
    expect(x.mapHits).toEqual({ kind: 'dzien', publishedAt: pub, touched: 1, total: 2, complete: true, from: pub, to: NY.end });
    // Świece 1m od początku okna mapy (wykres doczytuje starsze, jak warstwa)
    expect(store.older['1m']).toContain(pub);
    // Luka w środku okna: dotknięcie zostaje, rozliczenie niepełne
    const gap = fakeStore({ now: IN_NY, series: { '1m': { list: ones.filter((c) => c.t < at(2026, 11, 3, 12) || c.t >= at(2026, 11, 3, 12, 5)) } } });
    expect(readInputs('review', gap, { ...SCAN, blog: { state: { status: 'ready', maps: [map] }, map } }).mapHits).toMatchObject({ touched: 1, complete: false });
    // Bez mapy: powód z legendy warstwy; mapa tygodnia — bez rozliczenia; inny rynek — tylko BTC
    expect(readInputs('review', store, { ...SCAN, blog: { state: { status: 'missing', maps: [] }, map: null } }).mapHits).toEqual({ why: 'Brak map z bloga' });
    expect(readInputs('review', store, { ...SCAN, blog: { state: { status: 'ready', maps: [map] }, map: { ...map, kind: 'inne' } } }).mapHits).toMatchObject({
      why: expect.stringContaining('bez rozliczenia'),
    });
    // Świece 1m nie sięgają wpisu: starsze w drodze — czekamy (undefined); historia wyczerpana — powód; nieudane doczytanie —
    // powód z ponowną próbą (brak ✓ nigdy nie znaczy „nie dotknięto”)
    const late = (o: Partial<Spec>) => fakeStore({ now: IN_NY, series: { '1m': { list: ones.filter((c) => c.t >= at(2026, 11, 3, 8)), ...o } } });
    const blog = { ...SCAN, blog: { state: { status: 'ready' as const, maps: [map] }, map } };
    expect(readInputs('review', late({}), blog).mapHits).toBeUndefined();
    expect(readInputs('review', late({ exhausted: true }), blog).mapHits).toMatchObject({ why: expect.stringContaining('nie sięgają wpisu') });
    expect(readInputs('review', late({ olderFailed: true }), blog).mapHits).toEqual({ why: 'Nie udało się pobrać starszych świec 1m — kolejna próba za ≤ 30 s' });
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

  describe('budżet zakresu: jedna metoda albo jej nazwa na liczbie', () => {
    // Świece 1m od godziny przed otwarciem NY i 5m z ostatniej doby: Parkinson miałby z czego liczyć
    const ones: Candle[] = [];
    for (let t = NY.start - 60 * MIN; t <= IN_NY; t += MIN) ones.push({ t, o: 100_000, h: 100_100, l: 99_900, c: 100_000, v: 1, n: 1 });
    const store = (coin = 'BTC') => fakeStore({ now: IN_NY, coin, series: { '1m': { list: ones }, '5m': { list: bars5m(at(2026, 11, 2, 14, 30), IN_NY, () => 40) } } });

    it('BTC, model HAR w drodze: „—” z powodem „czekam na model zmienności (HAR)”, nie liczba z Parkinsona', () => {
      for (const id of ['cockpit', 'auction-open'] as const) {
        const x = readInputs(id, store(), { ...SCAN, volStatus: 'loading' });
        expect(x.session, id).toMatchObject({ s: NY });
        expect(x.expected, id).toBeUndefined();
        const b = layoutNumbers(id, x)[1];
        expect(b, id).toMatchObject({ label: 'Budżet · NY', value: '—', badge: 'MODEL' });
        expect(b.hint, id).toBe('MODEL · HAR: Czekam na model zmienności (HAR)…');
      }
    });

    it('BTC, model nie wczytał się: Parkinson z nazwą metody na etykiecie (telefon: „Budżet (P)”)', () => {
      const x = readInputs('cockpit', store(), { ...SCAN, volStatus: 'error' });
      expect(x.expected).toMatchObject({ method: 'parkinson' });
      const b = layoutNumbers('cockpit', x)[1];
      expect(b).toMatchObject({ label: 'Budżet · NY · Parkinson', short: 'Budżet (P)', badge: 'MODEL' });
      expect(b.value).toMatch(/^\d+%$/);
      expect(b.hint).toMatch(/^MODEL · Parkinson: /);
    });

    it('ETH: zawsze Parkinson z nazwą metody, także gdy model BTC jeszcze się wczytuje albo jest gotowy', () => {
      for (const vol of [
        { model: null, volStatus: 'loading' },
        { model: {} as VolModel, volStatus: 'ready' },
        { model: null, volStatus: 'error' },
      ] as const) {
        const x = readInputs('cockpit', store('ETH'), { ...SCAN, ...vol });
        expect(x.expected, vol.volStatus).toMatchObject({ method: 'parkinson' });
        expect(layoutNumbers('cockpit', x)[1], vol.volStatus).toMatchObject({ label: 'Budżet · NY · Parkinson', short: 'Budżet (P)', value: expect.stringMatching(/^\d+%$/) });
      }
    });

    it('domyślny tytuł Klatki niesie nazwę metody, gdy budżet liczy Parkinson', () => {
      const nums = layoutNumbers('cockpit', readInputs('cockpit', store(), { ...SCAN, volStatus: 'error' }));
      expect(defaultFrameTitle('Kokpit?', nums)).toMatch(/; Budżet · NY · Parkinson: \d+% \(MODEL\); /);
      // Model w drodze: w tytule „—”, nie liczba z innej metody
      const wait = layoutNumbers('cockpit', readInputs('cockpit', store(), { ...SCAN, volStatus: 'loading' }));
      expect(defaultFrameTitle('Kokpit?', wait)).toContain('; Budżet · NY: — (brak danych); ');
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
