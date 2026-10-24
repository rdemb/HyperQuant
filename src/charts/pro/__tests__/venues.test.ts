import { afterEach, describe, expect, it, vi } from 'vitest';
import { cvdLine, oiChangeLine } from '../core/flow';
import { HOUR_MS, OiLog } from '../core/stats';
import { intervalById } from '../core/time';
import {
  parseBinanceFunding,
  parseBinanceFundingHist,
  parseBinanceFundingInfo,
  parseBinanceKlineMsg,
  parseBinanceKlines,
  parseBinanceOi,
  parseBinanceOiHist,
  parseBybitOi,
  parseBybitTicker,
  parseBybitTrades,
  per8h,
} from '../venues/parse';
import { MinuteFlow, VenueStore, acquireVenues } from '../venues/venueStore';

const M1 = 60_000;

// Próbki odpowiedzi z 24.10.2026 (Binance USDT-M, Binance Spot, Bybit Linear)
const PERP_ROW = [1792859940000, '79648.50', '79695.60', '79647.90', '79695.60', '20.044', 1792859999999, '1596860.57450', 1206, '13.526', '1077609.82930', '0'];
const SPOT_ROW = [1792859940000, '79692.80000000', '79735.94000000', '79692.79000000', '79735.94000000', '3.97545000', 1792859999999, '316871.17287350', 722, '1.59879000', '127438.32211340', '0'];

describe('parsery Binance i Bybit', () => {
  it('świece Binance REST: wolumen i kupno biorców z pól 5 i 9, błędne wiersze pomijane', () => {
    const bars = parseBinanceKlines([PERP_ROW, SPOT_ROW, ['x'], null]);
    expect(bars).toEqual([
      { t: 1792859940000, v: 20.044, buy: 13.526 },
      { t: 1792859940000, v: 3.97545, buy: 1.59879 },
    ]);
    expect(parseBinanceKlines({ code: -1121 })).toEqual([]);
  });

  it('świeca z WebSocketu Binance, także opakowana w {stream, data}', () => {
    const msg = {
      e: 'kline',
      E: 1792860106747,
      s: 'BTCUSDT',
      k: { t: 1792860060000, T: 1792860119999, s: 'BTCUSDT', i: '1m', o: '79733.80', c: '79766.90', v: '220.879', V: '160.359', x: false },
    };
    const want = { symbol: 'BTCUSDT', interval: '1m', bar: { t: 1792860060000, v: 220.879, buy: 160.359 } };
    expect(parseBinanceKlineMsg(msg)).toEqual(want);
    expect(parseBinanceKlineMsg({ stream: 'btcusdt@kline_1m', data: msg })).toEqual(want);
    expect(parseBinanceKlineMsg({ e: 'markPriceUpdate', s: 'BTCUSDT' })).toBeNull();
  });

  it('transakcje Bybit: strona biorcy z pola S', () => {
    const msg = {
      topic: 'publicTrade.BTCUSDT',
      type: 'snapshot',
      ts: 1792860146624,
      data: [
        { T: 1792860146623, s: 'BTCUSDT', S: 'Sell', v: '0.001', p: '79764.00' },
        { T: 1792860146624, s: 'BTCUSDT', S: 'Buy', v: '0.5', p: '79765.00' },
        { T: 1792860146624, s: 'BTCUSDT', S: '?', v: '1', p: '79765.00' },
      ],
    };
    expect(parseBybitTrades(msg)).toEqual({
      symbol: 'BTCUSDT',
      trades: [
        { t: 1792860146623, sz: 0.001, buy: false },
        { t: 1792860146624, sz: 0.5, buy: true },
      ],
    });
    expect(parseBybitTrades({ topic: 'tickers.BTCUSDT', data: {} })).toBeNull();
  });

  it('ticker Bybit: pełny stan i delta tylko ze zmienionymi polami', () => {
    const full = { topic: 'tickers.BTCUSDT', type: 'snapshot', ts: 1792860100000, data: { symbol: 'BTCUSDT', openInterest: '64887.048', fundingRate: '0.00003163', fundingIntervalHour: '8' } };
    expect(parseBybitTicker(full)).toEqual({ symbol: 'BTCUSDT', time: 1792860100000, oi: 64887.048, funding: 0.00003163, intervalH: 8 });
    const delta = { topic: 'tickers.BTCUSDT', type: 'delta', ts: 1792860106529, data: { symbol: 'BTCUSDT', indexPrice: '79817.15' } };
    expect(parseBybitTicker(delta)).toEqual({ symbol: 'BTCUSDT', time: 1792860106529 });
  });

  it('historia OI: Binance rosnąco, Bybit od najnowszych → rosnąco', () => {
    expect(parseBinanceOiHist([{ sumOpenInterest: '95608.078', sumOpenInterestValue: '7611879581.34', timestamp: 1792859400000 }])).toEqual([[1792859400000, 95608.078]]);
    const bybit = { retCode: 0, result: { list: [{ openInterest: '64887.048', timestamp: '1792860000000' }, { openInterest: '64800', timestamp: '1792859700000' }], nextPageCursor: 'x' } };
    expect(parseBybitOi(bybit)).toEqual([
      [1792859700000, 64800],
      [1792860000000, 64887.048],
    ]);
    expect(parseBinanceOi({ openInterest: '95207.696', time: 1792860000000 })).toEqual([1792860000000, 95207.696]);
  });

  it('finansowanie: stopa Binance, okresy niestandardowe i przeliczenie na 8 h', () => {
    expect(parseBinanceFunding({ markPrice: '79776.67', lastFundingRate: '-0.00000024' })).toBe(-0.00000024);
    expect(parseBinanceFunding({})).toBeNull();
    expect(
      parseBinanceFundingHist([
        { symbol: 'BTCUSDT', fundingTime: 1761292800001, fundingRate: '0.00002113', markPrice: '110000' },
        { symbol: 'BTCUSDT', fundingTime: 1761264000000, fundingRate: '-0.00001' },
        { fundingTime: 'x', fundingRate: '1' },
      ])
    ).toEqual([
      { time: 1761264000000, rate: -0.00001 },
      { time: 1761292800001, rate: 0.00002113 },
    ]);
    expect(parseBinanceFundingHist({})).toEqual([]);
    expect(parseBinanceFundingInfo([{ symbol: 'HYPEUSDT', fundingIntervalHours: 4 }, { symbol: 'X' }]).get('HYPEUSDT')).toBe(4);
    // Hyperliquid co godzinę: 0,00125% / h = 0,01% / 8 h
    expect(per8h(0.0000125, 1)).toBeCloseTo(0.0001, 12);
    expect(per8h(0.0001, 4)).toBeCloseTo(0.0002, 12);
  });
});

describe('linie paneli giełd', () => {
  const times = [0, M1, 2 * M1, 3 * M1, 4 * M1];

  it('CVD: suma delt, zero po luce, bez zerowania w trybie ciągłym', () => {
    const d = [1, 2, null, 3, -1];
    expect(cvdLine(times, (i) => d[i], 'none')).toEqual([1, 3, null, 3, 2]);
  });

  it('ΔOI: zmiana od stanu na początku okresu, po luce od nowa', () => {
    const T = 100 * M1;
    const oi = new OiLog();
    for (const [t, v] of [
      [T, 100],
      [T + M1, 110],
      [T + 2 * M1, 105],
      [T + 3 * M1, 120],
    ] as const)
      oi.push(t, v);
    const at = (t: number) => oi.atWithin(t, 2 * M1);
    // Świeca [T, T + 1m) kończy się stanem z T + 1m (110), początek okresu to stan z T (100)
    expect(oiChangeLine([T, T + M1, T + 2 * M1], M1, T + 10 * M1, at, 'none')).toEqual([10, 5, 20]);
    // Odczyt starszy niż 2 min nie opisuje świecy (przerwa w danych)
    expect(oiChangeLine([T + 6 * M1], M1, T + 10 * M1, at, 'none')).toEqual([null]);
  });

  it('OI: odczyt z dozwolonym wiekiem', () => {
    const oi = new OiLog();
    oi.push(1000, 5);
    expect(oi.atWithin(1500, 600)).toBe(5);
    expect(oi.atWithin(1700, 600)).toBeNull();
    expect(oi.atWithin(900, 600)).toBeNull();
  });

  it('Bybit: delta świecy nagranej w całości albo od początku nagrania, bieżąca do teraz, bez świec z przerwą', () => {
    const f = new MinuteFlow();
    f.coverage.open(M1 + 5_000);
    f.add([
      { t: M1 + 6_000, sz: 2, buy: true },
      { t: 2 * M1 + 1_000, sz: 1, buy: true },
      { t: 2 * M1 + 2_000, sz: 3, buy: false },
      { t: 3 * M1 + 1_000, sz: 4, buy: true },
    ]);
    // Świeca 1m od 1:00 zaczęła się przed nagraniem — liczy się od jego początku
    expect(f.delta(M1, M1, 10 * M1)).toBe(2);
    expect(f.delta(2 * M1, M1, 10 * M1)).toBe(-2);
    // Świeca 3m od 3:00 jest bieżąca (teraz 3:30)
    expect(f.delta(3 * M1, 3 * M1, 3 * M1 + 30_000)).toBe(4);
    f.coverage.close(3 * M1 + 40_000);
    expect(f.delta(3 * M1, M1, 10 * M1)).toBeNull();
    // Po przerwie świeca z powrotem połączenia nie ma wartości, kolejna pełna — tak
    f.coverage.open(5 * M1 + 10_000);
    f.add([{ t: 6 * M1 + 1_000, sz: 1, buy: false }]);
    expect(f.delta(5 * M1, M1, 10 * M1)).toBeNull();
    expect(f.delta(6 * M1, M1, 10 * M1)).toBe(-1);
  });
});

describe('historia finansowania Binance w Tablicy liczb', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('kilka ostatnich świec: okres 8 h z dwóch wypłat sprzed świec, bez ponownych zapytań przed końcem okresu', async () => {
    // Wypłaty co 8 h (00, 08, 16 UTC), teraz 19:30 — świece 1h od 16:00 należą do okresu jeszcze nierozliczonego
    const day = Date.UTC(2026, 9, 24);
    const now = day + 19.5 * HOUR_MS;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const paid = [0, 8, 16].map((h, i) => ({ fundingTime: day + h * HOUR_MS + 3, fundingRate: String((i + 1) * 0.0001) }));
    const asked: number[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      const q = new URL(url).searchParams;
      let body: unknown = [];
      if (url.includes('/fundingRate')) {
        asked.push(Number(q.get('startTime')));
        body = paid.filter((p) => p.fundingTime >= Number(q.get('startTime')));
      }
      return { ok: true, json: async () => body };
    });
    const s = new VenueStore('BTC');
    s.setFunding('binance', 0.0008);
    const iv = intervalById('1h');
    s.ensure(iv, day + 16 * HOUR_MS);
    await vi.waitFor(() => expect(s.binanceFunding.latest).toBe(day + 15 * HOUR_MS));
    const r = s.reads(iv, now);
    // Okres rozliczony o 16:00 obejmuje 08–16, każda godzina 1/8 stawki; świece od 16:00 — stawka prognozowana na godzinę
    expect(r.funding(day + 15 * HOUR_MS)).toBeCloseTo(0.0003 / 8, 12);
    for (const h of [16, 17, 18, 19]) expect(r.funding(day + h * HOUR_MS)).toBeCloseTo(0.0001, 12);
    s.ensure(iv, day + 16 * HOUR_MS);
    s.ensureFunding();
    await Promise.resolve();
    expect(asked).toEqual([day]);
  });
});

describe('połączenia giełd', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('zmiana interwału nie zrywa połączenia Bybit; zwolnienie ostatniego wykresu zamyka je po chwili', async () => {
    vi.useFakeTimers();
    const sockets: { url: string; closed: boolean }[] = [];
    class FakeSocket {
      static OPEN = 1;
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: (() => void) | null = null;
      onclose: (() => void) | null = null;
      private readonly rec: { url: string; closed: boolean };
      constructor(url: string) {
        this.rec = { url, closed: false };
        sockets.push(this.rec);
      }
      send(): void {}
      close(): void {
        this.rec.closed = true;
      }
    }
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => [] }));
    const bybit = () => sockets.filter((x) => x.url.includes('bybit'));
    const release1h = acquireVenues('BTC', intervalById('1h'));
    expect(bybit().map((x) => x.closed)).toEqual([false]);
    // Kontroler zwalnia stary interwał przed pobraniem nowego
    release1h();
    const release15m = acquireVenues('BTC', intervalById('15m'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(bybit().map((x) => x.closed)).toEqual([false]);
    release15m();
    await vi.advanceTimersByTimeAsync(1000);
    expect(bybit()[0].closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1500);
    expect(bybit()[0].closed).toBe(true);
  });
});
