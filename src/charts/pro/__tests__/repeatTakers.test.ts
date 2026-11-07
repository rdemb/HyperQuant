import { afterEach, describe, expect, it, vi } from 'vitest';
import { HIST_PART_MS, type HistTrade, type IdScope, decodeTrades, encodeTrades } from '../../../utils/tapeHistory';
import type { Side } from '../hl/parse';
import { HlStream } from '../hl/stream';
import { IndicatorEngine } from '../indicators/engine';
import { type FlowContext, accountScopeKey, indicatorDef, indicatorLabel, indicatorsFromLink, takerPersistence, tfAllowed } from '../indicators/registry';
import { ProStore } from '../store/proStore';
import { toFills } from '../store/serverHistory';

type Order = { time: number; side: Side; notional: number; taker: string };
const o = (time: number, side: Side, notional: number, taker: string): Order => ({ time, side, notional, taker });
const M = 60_000;
const H = 3_600_000;
const DAY = 24 * H;

describe('powracający i nowi biorcy', () => {
  it('udziały z wartości wejść w świecy: ta sama strona, tylko przeciwna, nowe konto; razem 1', () => {
    const before = [o(1, 1, 5, 'a'), o(2, -1, 5, 'b'), o(3, -1, 5, 'a'), o(4, 1, 5, '')];
    const r = takerPersistence(before, [o(10, 1, 300, 'a'), o(11, 1, 100, 'b'), o(12, -1, 600, 'c'), o(13, 1, 50, '')]);
    expect(r.back).toBeCloseTo(0.3, 12);
    expect(r.flip).toBeCloseTo(0.1, 12);
    expect(r.fresh).toBeCloseTo(0.6, 12);
    // Konto po obu stronach w oknie wraca po każdej z nich
    expect(takerPersistence(before, [o(10, -1, 1, 'a')]).back).toBe(1);
    expect(takerPersistence(before, [o(10, 1, 1, '')]).back).toBeNaN();
  });

  it('okno przed świecą; w historii serwera tylko w jednej godzinie, na żywo także przez pełną godzinę', () => {
    const def = indicatorDef('repeat');
    expect(def.range).toEqual([0, 1]);
    expect(tfAllowed(def)).toBe(false);
    const x = indicatorsFromLink('repeat(15)')[0];
    expect(indicatorLabel(x)).toBe('Powroty 15');
    const run = (list: Order[], t0: number) => {
      const inRange = (a: number, b: number) => list.filter((q) => q.time >= a && q.time < b);
      const ctx: FlowContext = {
        oiAt: () => null,
        book: () => [],
        exactBook: () => [],
        orders: inRange,
        orderCount: (a, b) => inRange(a, b).length,
        identified: () => true,
        makers: () => null,
        now: t0 + 10 * M,
      };
      const c = { o: 1, h: 1, l: 1, c: 1, v: 1, n: 1 };
      const e = new IndicatorEngine();
      e.setInstances([x]);
      e.sync([{ candle: { ...c, t: t0 } }], 5 * M, () => [], ctx);
      return e.runs[0].out;
    };
    // Świeca 10:30, okno 10:15–10:30 w tej samej godzinie
    const t = 10 * H + 30 * M;
    expect(run([o(t - 10 * M, 1, 1, '~h:1'), o(t + M, 1, 1, '~h:1')], t)[0][0]).toBe(1);
    // Świeca 11:05: okno sięga 10:50, numery kont z historii nie łączą się między godzinami
    const u = 11 * H + 5 * M;
    expect(run([o(u - 10 * M, 1, 1, '~10:1'), o(u + M, 1, 1, '~11:1')], u)[0][0]).toBeNaN();
    // Na żywo (adresy) okno przez pełną godzinę jest w porządku
    expect(run([o(u - 10 * M, 1, 1, '0xa'), o(u + M, 1, 1, '0xa')], u)[0][0]).toBe(1);
    // Powracający, nowy i odwracający po 1 USD
    expect(run([o(u - 10 * M, 1, 1, 'acct-1'), o(u + M, 1, 1, 'acct-1'), o(u + M, 1, 1, 'acct-2'), o(u + 2 * M, -1, 1, 'acct-1')], u)[0][0]).toBeCloseTo(1 / 3, 12);
    // Numer dobowy łączy się przez pełną godzinę, ale nie z numerem innej doby ani z kontem na żywo
    const d = Date.UTC(2026, 10, 7);
    expect(run([o(u - 10 * M, 1, 1, `~d${d}:1`), o(u + M, 1, 1, `~d${d}:1`)], u)[0][0]).toBe(1);
    expect(run([o(u - 10 * M, 1, 1, `~d${d - DAY}:1`), o(u + M, 1, 1, `~d${d}:1`)], u)[0][0]).toBeNaN();
    expect(run([o(u - 10 * M, 1, 1, `~d${d}:1`), o(u + M, 1, 1, 'acct-1')], u)[0][0]).toBeNaN();
    // Okno w jednej godzinie z kontami z historii i na żywo (godzina otwarcia strony): numer nie łączy się z adresem
    expect(run([o(t - 10 * M, 1, 1, `~${10 * H}:1`), o(t + M, 1, 1, 'acct-1')], t)[0][0]).toBeNaN();
    // Zlecenia bez konta nie zmieniają zakresu
    expect(run([o(u - 10 * M, 1, 1, `~d${d}:1`), o(u - 5 * M, 1, 1, ''), o(u + M, 1, 1, `~d${d}:1`)], u)[0][0]).toBe(1);
  });

  it('okno przez pełną godzinę bez zleceń przed świecą (numeracja godzinowa): wszyscy nowi — świadoma zmiana wobec 1b', () => {
    const run = (list: Order[], t0: number) => {
      const inRange = (a: number, b: number) => list.filter((q) => q.time >= a && q.time < b);
      const ctx: FlowContext = { oiAt: () => null, book: () => [], exactBook: () => [], orders: inRange, orderCount: (a, b) => inRange(a, b).length, identified: () => true, makers: () => null, now: t0 + 10 * M };
      const e = new IndicatorEngine();
      e.setInstances(indicatorsFromLink('repeat(15)'));
      e.sync([{ candle: { t: t0, o: 1, h: 1, l: 1, c: 1, v: 1, n: 1 } }], 5 * M, () => [], ctx);
      return e.runs[0].out;
    };
    const u = 11 * H + 5 * M;
    // Okno 10:50–11:05 z taśmą z kontami, ale bez zleceń; w świecy konta z jednej godziny — jeden zakres, więc nowi
    const [back, flip, fresh] = run([o(u + M, 1, 1, `~${11 * H}:1`), o(u + 2 * M, -1, 1, `~${11 * H}:2`)], u);
    expect([back[0], flip[0], fresh[0]]).toEqual([0, 0, 1]);
    // Godzina przejściowa: numer godzinowy w oknie i dobowy w świecy to dwie przestrzenie kluczy — brak wartości
    const d = Date.UTC(2026, 10, 7);
    expect(run([o(u - 10 * M, 1, 1, `~${10 * H}:1`), o(u + M, 1, 1, `~d${d}:1`)], u)[2][0]).toBeNaN();
  });
});

describe('zakres numeracji kont z historii serwera', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('klucz zakresu: godzina dla `~godzina:`, doba dla `~ddoba:`, null dla konta na żywo', () => {
    const h = Date.UTC(2026, 10, 7, 11);
    const d = Date.UTC(2026, 10, 7);
    expect(accountScopeKey(`~${h}:3`)).toBe(`h:${h}`);
    expect(accountScopeKey(`~${h}:o3`)).toBe(`h:${h}`);
    expect(accountScopeKey(`~d${d}:3`)).toBe(`d:${d}`);
    expect(accountScopeKey(`~d${d}:o12`)).toBe(`d:${d}`);
    expect(accountScopeKey('acct-1')).toBeNull();
  });

  const store = () => new ProStore(new HlStream({ wsFactory: () => ({}) as WebSocket }));
  const H11 = Date.UTC(2026, 10, 7, 11);
  const D1 = Date.UTC(2026, 10, 8);

  /**
   * Części 5-minutowe [from, to) z plików rejestratora w zakresie `idScope` (bez — plik sprzed pola): co minutę biorca 1
   * kupuje, a co 30 s biorca 2 sprzedaje, maker 3 przyjmuje obie strony; jedno zlecenie na transakcję, numery `o` w dobie.
   */
  function loadParts(s: ProStore, from: number, to: number, idScope?: IdScope): void {
    for (let p = from; p < to; p += HIST_PART_MS) {
      const trades: HistTrade[] = [];
      for (let t = p; t < p + HIST_PART_MS; t += 30_000) {
        const n = (t % DAY) / 30_000;
        trades.push({ t, px: 80_000, sz: 1, side: n % 2 ? 'A' : 'B', tid: t / 1000, o: n, k: n % 2 ? 2 : 1, m: 3 });
      }
      const f = decodeTrades(encodeTrades('BTC', p, p + HIST_PART_MS, [[p, p + HIST_PART_MS]], trades, [], true, idScope))!;
      s.restoreHistory({ trades: { from: p, to: p + HIST_PART_MS, spans: f.spans, zeroSpans: f.spans, fills: toFills(f.trades, p, f.idScope), oi: [] }, frames: [] });
    }
  }

  /** Kontekst wskaźników z magazynu jak na wykresie (controller.ts). */
  const flowOf = (s: ProStore, now: number): FlowContext => ({
    oiAt: () => null,
    book: () => [],
    exactBook: () => [],
    orders: (a, b) => s.orders.range(a, b),
    orderCount: (a, b) => s.orders.count(a, b),
    identified: (a, b) => s.addressed.covers(a, b),
    zeroKnown: (a, b) => s.zeroKnown.covers(a, b),
    makers: (a, b) => s.makerSplit(a, b),
    now,
  });

  const runOn = (s: ProStore, link: string, t: number, ms: number) => {
    const e = new IndicatorEngine();
    e.setInstances(indicatorsFromLink(link));
    e.sync([{ candle: { t, o: 1, h: 1, l: 1, c: 1, v: 1, n: 1 } }], ms, () => [], flowOf(s, t + ms + 10 * M));
    return e.runs[0].out;
  };
  const repeatAt = (s: ProStore, t: number) => runOn(s, 'repeat(15)', t, 5 * M)[0][0];

  it('pliki „day”: świeca 11:00–11:05 z oknem 15 min (od 10:45) ma wartość', () => {
    const s = store();
    loadParts(s, H11 - 15 * M, H11 + 5 * M, 'day');
    expect(s.orders.range(H11, H11 + 5 * M)[0].taker).toBe(`~d${Date.UTC(2026, 10, 7)}:1`);
    expect(repeatAt(s, H11)).toBe(1);
  });

  it('pliki bez pola (numeracja godzinowa): to samo okno przez pełną godzinę — brak wartości jak dotąd', () => {
    const s = store();
    loadParts(s, H11 - 25 * M, H11 + 5 * M);
    expect(repeatAt(s, H11)).toBeNaN();
    // Okno 10:40–10:55 i świeca 10:55–11:00 w jednej godzinie — wartość jak dotąd
    expect(repeatAt(s, H11 - 5 * M)).toBe(1);
  });

  it('pliki „day”: okno przez 00:00 UTC nie łączy numerów dwóch dób; okno w nowej dobie — wartość', () => {
    const s = store();
    loadParts(s, D1 - 15 * M, D1 + 20 * M, 'day');
    expect(repeatAt(s, D1)).toBeNaN();
    expect(repeatAt(s, D1 + 15 * M)).toBe(1);
  });

  it('szerokość, makerzy i TWAP na plikach „day”: świeca do 1 h ma wartość jak dotąd, świeca 2 h — nie', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(H11 + 2 * H);
    const s = store();
    loadParts(s, H11 - H, H11 + H, 'day');
    const [buy, sell] = runOn(s, 'breadth()', H11, 5 * M);
    expect([buy[0], sell[0]]).toEqual([1, 1]);
    const [mm, rest] = runOn(s, 'makers()', H11, 5 * M);
    // Maker 3 co minutę po obu stronach — animator; kupno i sprzedaż po równo
    expect([mm[0], rest[0]]).toEqual([0, 0]);
    expect(runOn(s, 'makers()', H11, 5 * M)[2][0]).toBe(1);
    expect(runOn(s, 'twap()', H11, 5 * M)[0][0]).toBe(0);
    for (const link of ['breadth()', 'makers()', 'twap()']) expect(runOn(s, link, H11 - H, 2 * H)[0][0]).toBeNaN();
  });
});
