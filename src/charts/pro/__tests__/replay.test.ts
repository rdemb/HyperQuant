import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HIST_HOUR_MS, HIST_PART_MS, type HistTrade, encodeBook, encodeTrades, historyPath } from '../../../utils/tapeHistory';
import type { Candle } from '../hl/parse';
import { recordedRange, replayUnits } from '../replay/data';
import { linkPatch, parseReplayLink, replayHash } from '../replay/link';
import { ReplaySession } from '../replay/session';

const H0 = Date.UTC(2026, 9, 24, 16, 0, 0);
const M5 = 5 * 60_000;
const BASE = 'https://data.example/history';

const index = (hours: number[], parts: number[], coin = 'BTC') => ({ v: 1, asOf: H0 + 3 * HIST_HOUR_MS, keepDays: 7, partMs: HIST_PART_MS, markets: { [coin]: { hours, parts } } });

/** Transakcja co 30 s w [from, to) po cenie rosnącej o 1 USD na minutę (jedno zlecenie na transakcję). */
function tradesIn(from: number, to: number): HistTrade[] {
  const out: HistTrade[] = [];
  for (let t = from; t < to; t += 30_000) out.push({ t, px: 80_000 + Math.floor((t - H0) / 60_000), sz: 1, side: 'B', tid: t / 1000, o: (t - from) / 30_000, k: 1, m: 2 });
  return out;
}

function files(units: { start: number; part: boolean }[]): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const u of units) {
    const end = u.start + (u.part ? HIST_PART_MS : HIST_HOUR_MS);
    const ctx = [{ t: u.start, oi: 30_000, funding: 1e-5, mark: 80_000 }];
    m.set(historyPath('BTC', u.start, 'trades', u.part), encodeTrades('BTC', u.start, end, [[u.start, end]], tradesIn(u.start, end), ctx));
    m.set(historyPath('BTC', u.start, 'book', u.part), encodeBook('BTC', u.start, end, [[u.start, end]], [{ t: u.start + 1000, step: 10, bids: [79_990, 2, 3], asks: [80_020, 1, 2] }]));
  }
  return m;
}

/** `plain` — serwer wysyła pliki .json.gz z Content-Encoding: gzip, więc przeglądarka oddaje je już rozpakowane. */
function fakeFetch(m: Map<string, unknown>, idx: unknown, plain = false) {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    const rel = url.slice(BASE.length + 1);
    calls.push(rel);
    if (rel === 'index.json') return idx ? new Response(JSON.stringify(idx)) : new Response('', { status: 404 });
    const v = m.get(rel);
    if (!v) return new Response('', { status: 404 });
    return new Response(plain ? JSON.stringify(v) : new Uint8Array(gzipSync(JSON.stringify(v))));
  };
  return { calls, fetcher };
}

/** Świece 5m z API od początku nagrania: pełny ruch świecy (także po chwili odtwarzania), jak zwraca Hyperliquid. */
function fakeCandles() {
  const calls: string[] = [];
  const load = async (coin: string, interval: string, from: number, to: number): Promise<Candle[]> => {
    calls.push(`${coin}:${interval}`);
    if (interval !== '5m') return [];
    const out: Candle[] = [];
    for (let t = Math.max(H0, Math.ceil(from / M5) * M5); t < Math.min(to, H0 + 2 * HIST_HOUR_MS); t += M5) out.push({ t, o: 1, h: 9e9, l: 1, c: 2, v: 999, n: 99 });
    return out;
  };
  return { calls, load };
}

describe('nagranie do powtórki — pliki i zakres', () => {
  it('godzina z pliku godzinowego, bez niego jej części; zakres od pierwszego pliku do końca ostatniego', () => {
    const idx = index([H0, H0 + HIST_HOUR_MS], [H0 + 2 * HIST_HOUR_MS, H0 + 2 * HIST_HOUR_MS + HIST_PART_MS]);
    expect(recordedRange(idx, 'BTC')).toEqual({ from: H0, to: H0 + 2 * HIST_HOUR_MS + 2 * HIST_PART_MS });
    expect(recordedRange(idx, 'ETH')).toBeNull();
    expect(replayUnits(idx, 'BTC', H0 + 30 * 60_000, H0 + 2 * HIST_HOUR_MS + 1)).toEqual([
      { start: H0, part: false },
      { start: H0 + HIST_HOUR_MS, part: false },
      { start: H0 + 2 * HIST_HOUR_MS, part: true },
    ]);
  });
});

describe('link do chwili w powtórce', () => {
  it('adres → link → adres bez zmian; nieznane wartości pomijane', () => {
    const hash = '#charts?replay=lessons&m=ETH&i=1m&v=footprint&from=2026-10-24T16:00:00Z&to=2026-10-24T22:00:00Z&t=2026-10-24T18:30:00Z&layers=vwap,profile&zone=75200-75000';
    const l = parseReplayLink(hash)!;
    expect(l).toMatchObject({ source: 'lessons', coin: 'ETH', interval: '1m', view: 'footprint', t: Date.UTC(2026, 9, 24, 18, 30), layers: ['showVwap', 'showProfile'], zone: [75_000, 75_200], station: null });
    expect(replayHash(l)).toBe(hash.replace('zone=75200-75000', 'zone=75000-75200'));
    expect(parseReplayLink('#charts?m=BTC')).toBeNull();
    expect(parseReplayLink('#desk?replay=history')).toBeNull();
    expect(parseReplayLink('#charts?replay=history&m=XRP&i=2m&v=x&t=wczoraj&station=nie&zone=1')).toMatchObject({ coin: 'BTC', interval: null, view: null, t: null, station: null, zone: null, layers: null });
  });

  it('warstwy z linku: wymienione włączone, pozostałe wyłączone; bez warstw — ustawienia bez zmian', () => {
    const p = linkPatch(parseReplayLink('#charts?replay=history&m=BTC&i=5m&layers=heatmap')!);
    expect(p).toMatchObject({ coin: 'BTC', interval: '5m', showHeatmap: true, showVwap: false, showProfile: false });
    expect(Object.keys(linkPatch(parseReplayLink('#charts?replay=history&m=BTC')!))).toEqual(['coin']);
  });
});

describe('ReplaySession — odtwarzanie nagrania', () => {
  let s: ReplaySession | null = null;
  afterEach(() => {
    s?.close();
    vi.useRealTimers();
  });

  const twoHours = (plain = false) => {
    const units = [
      { start: H0, part: false },
      { start: H0 + HIST_HOUR_MS, part: false },
    ];
    return fakeFetch(files(units), index([H0, H0 + HIST_HOUR_MS], []), plain);
  };
  const tradesUpTo = (t: number) => tradesIn(H0, H0 + 2 * HIST_HOUR_MS).filter((x) => x.t <= t).length;

  it('start godzinę przed końcem; taśma i świece tylko do chwili odtwarzania, bieżąca świeca z taśmy', async () => {
    const f = twoHours();
    const c = fakeCandles();
    s = new ReplaySession({ source: 'history', coin: 'BTC', from: null, to: null, t: null }, f.fetcher, c.load, BASE);
    await s.load();
    expect(s.state).toBe('ready');
    expect([s.from, s.to, s.t]).toEqual([H0, H0 + 2 * HIST_HOUR_MS, H0 + HIST_HOUR_MS]);
    const st = s.store!;
    expect(st.serverNow()).toBe(H0 + HIST_HOUR_MS);
    expect(st.tape.count).toBe(tradesUpTo(H0 + HIST_HOUR_MS));
    expect(st.coverage.covers(H0, H0 + HIST_HOUR_MS)).toBe(true);
    // Migawka drugiej godziny (17:00:01) jest już po chwili odtwarzania (17:00)
    expect(st.book('near')?.latest()?.t).toBe(H0 + 1000);

    s.seek(H0 + HIST_HOUR_MS + 7 * 60_000 + 15_000);
    const series = st.series('5m');
    await series.load();
    const bars = series.bars();
    // 12 pełnych świec pierwszej godziny i dwie z drugiej: pełna z API i bieżąca z taśmy do 17:07:15, nie z API
    expect(bars.length).toBe(14);
    expect(bars[12].candle.v).toBe(999);
    const cur = bars[13];
    expect(cur.t).toBe(H0 + HIST_HOUR_MS + M5);
    expect(cur.candle).toMatchObject({ o: 80_065, c: 80_067, v: 5, n: 5 });
    expect(cur.complete).toBe(true);
  });

  it('przewinięcie w przód dokłada do tego samego magazynu, wstecz — nowy magazyn bez ponownego pytania o świece', async () => {
    const f = twoHours();
    const c = fakeCandles();
    s = new ReplaySession({ source: 'history', coin: 'BTC', from: null, to: null, t: H0 + 10 * 60_000 }, f.fetcher, c.load, BASE);
    await s.load();
    const first = s.store!;
    await first.series('5m').load();
    s.seek(H0 + 50 * 60_000);
    expect(s.store).toBe(first);
    expect(first.tape.count).toBe(tradesUpTo(H0 + 50 * 60_000));
    const asked = c.calls.length;
    s.seek(H0 + 20 * 60_000);
    expect(s.store).not.toBe(first);
    expect(s.store!.tape.count).toBe(tradesUpTo(H0 + 20 * 60_000));
    await s.store!.series('5m').load();
    expect(s.store!.series('5m').bars().at(-1)!.t).toBe(H0 + 20 * 60_000);
    expect(c.calls.length).toBe(asked);
  });

  it('odtwarzanie w tempie 60×: 2 s na zegarze to 2 min nagrania; na końcu pauza', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
    const f = twoHours();
    s = new ReplaySession({ source: 'history', coin: 'BTC', from: null, to: null, t: H0 + 2 * HIST_HOUR_MS - 3 * 60_000 }, f.fetcher, fakeCandles().load, BASE);
    await s.load();
    s.setSpeed(60);
    s.play();
    vi.advanceTimersByTime(2000);
    expect(s.t).toBe(H0 + 2 * HIST_HOUR_MS - 60_000);
    expect(s.store!.tape.count).toBe(tradesUpTo(s.t));
    vi.advanceTimersByTime(2000);
    expect(s.t).toBe(s.to);
    expect(s.playing).toBe(false);
  });

  it('pliki już rozpakowane przez serwer — to samo nagranie co z gzip', async () => {
    s = new ReplaySession({ source: 'lessons', coin: 'BTC', from: null, to: null, t: null }, twoHours(true).fetcher, fakeCandles().load, BASE);
    await s.load();
    expect(s.state).toBe('ready');
    expect(s.store!.tape.count).toBe(tradesUpTo(H0 + HIST_HOUR_MS));
  });

  it('API bez świec 1m (starsze nagranie) — świece z taśmy, bieżąca do chwili odtwarzania', async () => {
    s = new ReplaySession({ source: 'history', coin: 'BTC', from: null, to: null, t: H0 + 30 * 60_000 + 15_000 }, twoHours().fetcher, fakeCandles().load, BASE);
    await s.load();
    const series = s.store!.series('1m');
    await series.load();
    expect(series.loadState).toBe('ready');
    const bars = series.bars();
    expect(bars.length).toBe(31);
    expect(bars[0].candle).toEqual({ t: H0, o: 80_000, h: 80_000, l: 80_000, c: 80_000, v: 2, n: 2 });
    expect(bars[29].candle).toMatchObject({ t: H0 + 29 * 60_000, o: 80_029, c: 80_029, v: 2 });
    expect(bars[30].candle).toMatchObject({ t: H0 + 30 * 60_000, v: 1, n: 1 });
  });

  it('bez spisu — błąd; rynek bez nagrania albo zakres poza nagraniem — puste', async () => {
    s = new ReplaySession({ source: 'history', coin: 'BTC', from: null, to: null, t: null }, fakeFetch(new Map(), null).fetcher, fakeCandles().load, BASE);
    await s.load();
    expect(s.state).toBe('error');
    s = new ReplaySession({ source: 'history', coin: 'BTC', from: null, to: null, t: null }, fakeFetch(new Map(), index([H0], [], 'ETH')).fetcher, fakeCandles().load, BASE);
    await s.load();
    expect(s.state).toBe('empty');
    s = new ReplaySession({ source: 'history', coin: 'BTC', from: null, to: H0 - 1, t: null }, twoHours().fetcher, fakeCandles().load, BASE);
    await s.load();
    expect(s.state).toBe('empty');
  });
});
