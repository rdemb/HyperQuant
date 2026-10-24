import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HIST_HOUR_MS, HIST_PART_MS, type HistFrame, type HistTrade, encodeBook, encodeTrades, historyPath } from '../../../utils/tapeHistory';
import { WallTracker } from '../core/clashes';
import { BookHistory } from '../core/book';
import { type AggressorOrder, OrderLog } from '../core/orders';
import { OiLog } from '../core/stats';
import { HlStream } from '../hl/stream';
import { ProStore } from '../store/proStore';
import { ServerHistory, toFills } from '../store/serverHistory';

const H0 = Date.UTC(2026, 9, 24, 10, 0, 0);
const NOW = H0 + 2 * HIST_HOUR_MS + 20 * 60_000;
const BASE = 'https://data.example/history';

/** Transakcje co 30 s w [from, to): dwie z jednego zlecenia agresora (ten sam numer `o`), maker 7. */
function tradesIn(from: number, to: number, tid0: number): HistTrade[] {
  const out: HistTrade[] = [];
  let tid = tid0;
  for (let t = from; t < to; t += 30_000) {
    const o = (t - from) / 30_000;
    out.push({ t, px: 80_000, sz: 1, side: 'B', tid: tid++, o, k: 1, m: 7 });
    out.push({ t: t + 1, px: 80_010, sz: 1, side: 'B', tid: tid++, o, k: 1, m: 7 });
  }
  return out;
}

const frameAt = (t: number): HistFrame => ({ t, step: 10, bids: [79_990, 2, 3, 79_980, 1, 1], asks: [80_020, 1, 2] });

function files(units: { start: number; part: boolean }[]): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const u of units) {
    const end = u.start + (u.part ? HIST_PART_MS : HIST_HOUR_MS);
    m.set(historyPath('BTC', u.start, 'trades', u.part), encodeTrades('BTC', u.start, end, [[u.start, end]], tradesIn(u.start, end, u.start / 1000), [{ t: u.start, oi: 30_000, funding: 1e-5, mark: 80_000 }]));
    m.set(historyPath('BTC', u.start, 'book', u.part), encodeBook('BTC', u.start, end, [[u.start, end]], [frameAt(u.start + 1000)]));
  }
  return m;
}

function fakeFetch(m: Map<string, unknown>, index: unknown) {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    const rel = url.slice(BASE.length + 1);
    calls.push(rel);
    if (rel === 'index.json') return new Response(JSON.stringify(index));
    const v = m.get(rel);
    return v ? new Response(new Uint8Array(gzipSync(JSON.stringify(v)))) : new Response('', { status: 404 });
  };
  return { calls, fetcher };
}

const index = (asOf: number, hours: number[], parts: number[]) => ({ v: 1, asOf, keepDays: 7, partMs: HIST_PART_MS, markets: { BTC: { hours, parts } } });

describe('ServerHistory — historia z serwera do magazynu wykresu', () => {
  let store: ProStore;
  let h: ServerHistory | null = null;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
    store = new ProStore(new HlStream({ wsFactory: () => ({}) as WebSocket }));
  });

  afterEach(() => {
    h?.stop();
    vi.useRealTimers();
  });

  it('godziny z plików godzinowych, bieżąca z części; nowsze niż opublikowane pomijane, drugi przebieg bez pobrań', async () => {
    const units = [
      { start: H0, part: false },
      { start: H0 + HIST_HOUR_MS, part: false },
      ...[0, 1, 2].map((k) => ({ start: H0 + 2 * HIST_HOUR_MS + k * HIST_PART_MS, part: true })),
    ];
    const f = fakeFetch(files(units), index(NOW - 30_000, [H0, H0 + HIST_HOUR_MS], units.filter((u) => u.part).map((u) => u.start)));
    h = new ServerHistory(store, BASE, f.fetcher);
    await h.ensure(H0 + 10 * 60_000);
    expect(f.calls[0]).toBe('index.json');
    expect(f.calls.filter((c) => c.endsWith('.trades.json.gz')).sort()).toEqual(units.map((u) => historyPath('BTC', u.start, 'trades', u.part)).sort());
    // Taśma i pokrycie od H0 do końca ostatniej części
    const end = H0 + 2 * HIST_HOUR_MS + 3 * HIST_PART_MS;
    expect(store.coverage.covers(H0, end)).toBe(true);
    expect(store.tape.count).toBe(((end - H0) / 30_000) * 2);
    // Zlecenia agresora złożone z numerów: dwa wypełnienia na zlecenie, biorca bez adresu
    const orders = store.orders.range(H0, end);
    expect(orders).toHaveLength((end - H0) / 30_000);
    expect(orders[0]).toMatchObject({ fills: 2, levels: 2, makers: 1, taker: `~${H0}:1` });
    // Ściana makera 7 na cenie 80 000: wchłaniała co 30 s (przerwa = WALL_GAP_MS nie zrywa), bez góry lodowej
    expect(store.walls.walls(H0, end, 1).every((w) => !w.iceberg)).toBe(true);
    // Arkusz z ostatnich 12 h w kroku 10
    const book = (store as unknown as { books: Map<number, BookHistory> }).books.get(10)!;
    expect(book.length).toBe(units.length);
    expect(book.latest()!.nBids).toBe(2);
    // Wszystko wczytane — kolejny przebieg nie pyta nawet o spis
    const n = f.calls.length;
    await h.round();
    expect(f.calls.length).toBe(n);
  });

  it('część spoza nieaktualnego spisu jest zgadywana; brak pliku — ponowienie w następnym przebiegu', async () => {
    const p = H0 + 2 * HIST_HOUR_MS + 2 * HIST_PART_MS;
    const m = files([{ start: p - HIST_PART_MS, part: true }]);
    const f = fakeFetch(m, index(p - 5 * 60_000, [], [p - HIST_PART_MS]));
    h = new ServerHistory(store, BASE, f.fetcher);
    await h.ensure(p - HIST_PART_MS);
    // Część p nie jest w spisie (spis sprzed jej publikacji) — pobrana na próbę, jeszcze jej nie ma
    expect(f.calls).toContain(historyPath('BTC', p, 'trades', true));
    expect(store.coverage.covers(p - HIST_PART_MS, p)).toBe(true);
    expect(store.coverage.covers(p, p + HIST_PART_MS)).toBe(false);
    for (const [k, v] of files([{ start: p, part: true }])) m.set(k, v);
    vi.setSystemTime(NOW + 61_000); // spis do odświeżenia
    await h.round();
    expect(store.coverage.covers(p, p + HIST_PART_MS)).toBe(true);
  });

  it('świeży spis bez pliku — serwer nie nagrywał, plik nie jest pobierany', async () => {
    const f = fakeFetch(new Map(), index(NOW - 10_000, [], []));
    h = new ServerHistory(store, BASE, f.fetcher);
    await h.ensure(H0 + 2 * HIST_HOUR_MS);
    expect(f.calls).toEqual(['index.json']);
  });
});

describe('ProStore.restoreHistory — bez dublowania zleceń', () => {
  const store = () => new ProStore(new HlStream({ wsFactory: () => ({}) as WebSocket }));
  const batch = (fills: ReturnType<typeof toFills>, from: number, to: number) => ({ trades: { from, to, spans: [[from, to]] as [number, number][], fills, oi: [] }, frames: [] });

  it('ten sam plik drugi raz (część, potem godzina) nie dubluje zleceń', () => {
    const s = store();
    const fills = toFills(tradesIn(H0, H0 + HIST_PART_MS, 1), H0);
    s.restoreHistory(batch(fills, H0, H0 + HIST_PART_MS));
    expect(s.orders.length).toBe(10);
    s.restoreHistory(batch(toFills(tradesIn(H0, H0 + HIST_HOUR_MS, 1), H0), H0, H0 + HIST_HOUR_MS));
    expect(s.orders.length).toBe(HIST_HOUR_MS / 30_000);
  });

  it('od początku strumienia na żywo zlecenia tylko z transakcji, których strumień nie widział (luka połączenia)', () => {
    const s = store();
    const live = H0 + 2 * 60_000;
    (s as unknown as { liveFrom: number }).liveFrom = live;
    // Strumień widział transakcje od `live` do +1 min (taśma ma je bez zleceń z historii)
    const seen = tradesIn(live, live + 60_000, 1 + (live - H0) / 15_000);
    s.ingestFills(toFills(seen, H0));
    const before = s.orders.length;
    s.restoreHistory(batch(toFills(tradesIn(H0, H0 + HIST_PART_MS, 1), H0), H0, H0 + HIST_PART_MS));
    // Nowe: 4 zlecenia sprzed strumienia i 4 po minucie widzianej na żywo (luka)
    expect(s.orders.length - before).toBe(HIST_PART_MS / 30_000 - 2);
  });
});

describe('scalanie historii w strukturach wykresu', () => {
  it('OrderLog: duża paczka starszych zleceń scalona po czasie', () => {
    const log = new OrderLog();
    const o = (time: number) => ({ time }) as AggressorOrder;
    log.add([o(1000), o(2000)]);
    log.add(Array.from({ length: 100 }, (_, i) => o(1500 - i)));
    const times = log.range(0, 5000).map((x) => x.time);
    expect(times).toHaveLength(102);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('OiLog i BookHistory: próbki z historii przed bieżącymi, ta sama chwila — zostaje istniejąca', () => {
    const oi = new OiLog();
    oi.push(5000, 2);
    oi.restore([
      [1000, 1],
      [5000, 9],
    ]);
    expect([oi.at(1000), oi.at(4999), oi.at(5000)]).toEqual([1, 1, 2]);
    const b = new BookHistory(10);
    const fr = (t: number, sz: number) => ({ t, step: 10, px: Float64Array.of(100), sz: Float64Array.of(sz), n: Float64Array.of(1), nBids: 1 });
    b.add(fr(5000, 2));
    b.restore([fr(1000, 1), fr(5000, 9)]);
    expect(b.range(0, 10_000).map((f) => [f.t, f.sz[0]])).toEqual([
      [1000, 1],
      [5000, 2],
    ]);
  });

  it('WallTracker.pushHistory: ściana z historii bez góry lodowej', () => {
    const w = new WallTracker();
    w.pushHistory(toFills(tradesIn(H0, H0 + 3 * 30_000, 1), H0).map((f) => ({ ...f, side: -1 as const })));
    const walls = w.walls(H0, H0 + HIST_HOUR_MS, 1);
    expect(walls.map((x) => [x.px, x.hits, x.iceberg])).toEqual([
      [80_000, 3, false],
      [80_010, 3, false],
    ]);
  });
});
