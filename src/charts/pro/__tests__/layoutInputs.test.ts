import { describe, expect, it } from 'vitest';
import type { Candle } from '../hl/parse';
import type { BookFrame } from '../core/book';
import { type InputScan, type InputSeries, type InputStore, RETRY_MS, readInputs } from '../chart/layoutInputs';
import { isAbsent, layoutNumbers, toVBars } from '../chart/layoutNumbers';
import { currentTradeSession, expectedRange } from '../../../utils/sessionDay';

const MIN = 60_000;
const M5 = 5 * MIN;
const at = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
/** 3.11.2026 16:20 UTC — sesja NY w toku (14:30–24:00 UTC) */
const IN_NY = at(2026, 11, 3, 16, 20);
const NY = currentTradeSession(IN_NY)!;

const SCAN: InputScan = { model: null, liq: { status: 'loading', map: null }, whales: null, whalesConfigured: true };

type Spec = { state?: InputSeries['loadState']; list?: Candle[] };

/** Atrapa magazynu rynku: serie świec według interwału, migawka arkusza, taśma; `now` można przesuwać. */
function fakeStore(o: { now: number; price?: number; series?: Record<string, Spec>; book?: BookFrame | null }) {
  const loads: Record<string, number> = {};
  const made = new Map<string, InputSeries>();
  const st: InputStore & { now: number; loads: Record<string, number> } = {
    now: o.now,
    loads,
    coin: 'BTC',
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
        };
        made.set(id, s);
      }
      return s;
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

  it('Rozliczenie: sesja w toku — oczekiwany zakres na teraz; zamknięta — sprzed jej otwarcia (ex ante)', () => {
    // Spokojnie (zakres świecy 10) do otwarcia NY 3.11, w sesji NY nerwowo (200), potem znów spokojnie
    const range = (t: number) => (t >= NY.start && t < NY.end ? 200 : 10);
    const live = bars5m(at(2026, 11, 2, 14, 30), IN_NY, range);
    const inProgress = readInputs('review', fakeStore({ now: IN_NY, series: { '5m': { list: live } } }), SCAN);
    if (!inProgress.review || isAbsent(inProgress.review)) throw new Error('brak sesji');
    expect(inProgress.review.inProgress).toBe(true);
    expect(inProgress.reviewExpected).toEqual(expectedRange(null, toVBars(live), NY, IN_NY, inProgress.review.close));

    const asia = at(2026, 11, 4, 2);
    const all = bars5m(at(2026, 11, 2, 14, 30), asia, range);
    const closed = readInputs('review', fakeStore({ now: asia, series: { '5m': { list: all } } }), SCAN);
    if (!closed.review || isAbsent(closed.review) || !closed.reviewExpected || isAbsent(closed.reviewExpected)) throw new Error('brak sesji');
    expect(closed.review).toMatchObject({ inProgress: false, s: NY });
    const exAnte = expectedRange(null, toVBars(all), NY, NY.start, closed.review.close)!;
    const atNow = expectedRange(null, toVBars(all), NY, asia, closed.review.close)!;
    expect(closed.reviewExpected).toEqual(exAnte);
    // Ze świec sprzed sesji (spokojnych) oczekiwanie jest mniejsze niż z ostatniej doby, w której była już nerwowa sesja
    expect(exAnte.usd).toBeLessThan(atNow.usd / 5);
    expect(exAnte.method).toBe('parkinson');
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

  it('wieloryby i mapa likwidacji: te same powody co plakietki legendy', () => {
    const x = readInputs('big-hands', fakeStore({ now: IN_NY }), { ...SCAN, whalesConfigured: false });
    expect(x.whales).toEqual({ why: 'Warstwa wielorybów niedostępna w tej wersji strony' });
    expect(x.twap).toMatchObject({ why: expect.stringContaining('TWAP') });
    const w = { v: 2, asOf: IN_NY - 60_000, accounts: 1, candidates: 1, minPositionUsd: {}, minOrderUsd: {}, markets: { BTC: { positions: [{ id: 'a', side: 'long' as const, usd: 5e6, entry: 1, liq: null, lev: 1, at: 0 }], orders: [] } } };
    expect(readInputs('big-hands', fakeStore({ now: IN_NY }), { ...SCAN, whales: w }).whales).toEqual({ long: 5e6, short: 0, n: 1, asOf: IN_NY - 60_000 });
    expect(readInputs('fuel', fakeStore({ now: IN_NY }), { ...SCAN, liq: { status: 'unconfigured', map: null } }).liq).toEqual({ why: 'Mapa likwidacji niedostępna w tej wersji strony' });
  });
});
