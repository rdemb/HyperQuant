import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HlStream } from '../hl/stream';
import { CandleSeries, ProStore, dropStore, openStores, storeFor } from '../store/proStore';
import { discardRecording } from '../store/recording';
import { cvdCandles } from '../core/flow';

class FakeWs {
  static last: FakeWs | null = null;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeWs.last = this;
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  msg(o: unknown) {
    this.onmessage?.({ data: JSON.stringify(o) });
  }
}

const M5 = 300_000;
const T0 = Math.floor(1_792_850_000_000 / M5) * M5;

function candle(t: number, o: number, c: number, v: number) {
  return { t, T: t + M5 - 1, s: 'BTC', i: '5m', o: String(o), c: String(c), h: String(Math.max(o, c) + 5), l: String(Math.min(o, c) - 5), v: String(v), n: 10 };
}

function trade(time: number, px: number, sz: number, side: 'B' | 'A', tid: number, taker = '0x01', hash = `0x${tid.toString(16)}`) {
  return { coin: 'BTC', side, px: String(px), sz: String(sz), time, hash, tid, users: side === 'B' ? [taker, '0x99'] : ['0x99', taker] };
}

describe('ProStore', () => {
  let now = T0 + 2 * M5 + 30_000;
  let store: ProStore;
  let series: CandleSeries;
  let candles: unknown[];

  beforeEach(() => {
    vi.useFakeTimers();
    now = T0 + 2 * M5 + 30_000;
    vi.setSystemTime(now);
    candles = [candle(T0, 81000, 81010, 5), candle(T0 + M5, 81010, 81020, 6), candle(T0 + 2 * M5, 81020, 81030, 2)];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body);
        const json = body.type === 'candleSnapshot' ? candles : body.type === 'metaAndAssetCtxs' ? null : null;
        return { ok: true, json: async () => json };
      })
    );
    store = new ProStore(new HlStream({ wsFactory: () => new FakeWs() as unknown as WebSocket, now: () => Date.now() }));
    series = store.series('5m');
  });

  afterEach(() => {
    store.stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function boot() {
    store.start();
    FakeWs.last!.open();
    await vi.waitFor(() => expect(series.loadState).toBe('ready'));
    const ws = FakeWs.last!;
    ws.msg({ channel: 'subscriptionResponse', data: { method: 'subscribe', subscription: { type: 'trades', coin: 'BTC' } } });
    return ws;
  }

  it('ładuje świece interwału i subskrybuje transakcje, kontekst i świecę', async () => {
    const ws = await boot();
    expect(series.bars()).toHaveLength(3);
    const subs = ws.sent.map((s) => JSON.parse(s).subscription.type);
    expect(subs).toEqual(expect.arrayContaining(['trades', 'activeAssetCtx', 'candle']));
  });

  it('transakcje tworzą footprint świecy; świeca otwarta w trakcie nagrania jest niepełna', async () => {
    const ws = await boot();
    ws.msg({ channel: 'trades', data: [trade(now - 1000, 81025, 0.5, 'B', 1), trade(now - 500, 81024, 0.2, 'A', 2)] });
    const bars = series.bars();
    expect(bars[0].fp).toBeNull();
    const live = bars[2];
    expect(live.fp?.buyVol).toBeCloseTo(0.5);
    expect(live.fp?.sellVol).toBeCloseTo(0.2);
    expect(live.share).toBeCloseTo(0.7 / 2);
    expect(live.complete).toBe(false); // nagrywanie od połowy świecy
  });

  it('świeca w całości po starcie nagrania jest pełna', async () => {
    const ws = await boot();
    ws.msg({ channel: 'trades', data: [trade(now - 1000, 81025, 0.1, 'B', 1)] }); // migawka po subskrypcji
    const next = T0 + 3 * M5;
    // Połączenie żyje bez przerwy (wiadomości co minutę); przerwa dłuższa niż strażnik byłaby wybudzeniem karty
    while (now < next) {
      now += 60_000;
      vi.setSystemTime(now);
      ws.msg({ channel: 'pong' });
    }
    now = next + 60_000;
    vi.setSystemTime(now);
    ws.msg({ channel: 'trades', data: [trade(next + 1000, 81030, 1, 'B', 3)] });
    candles = [];
    ws.msg({ channel: 'candle', data: candle(next, 81030, 81031, 1) });
    const last = series.bars().at(-1)!;
    expect(last.t).toBe(next);
    expect(last.complete).toBe(true);
    expect(last.fp?.delta).toBeCloseTo(1);
  });

  it('spóźniona transakcja przelicza bieżącą świecę z taśmy', async () => {
    const ws = await boot();
    ws.msg({ channel: 'trades', data: [trade(now - 1000, 81025, 1, 'B', 1)] });
    ws.msg({ channel: 'trades', data: [trade(now - 3000, 81020, 2, 'A', 2)] });
    const fp = series.bars()[2].fp!;
    expect(fp.delta).toBeCloseTo(-1);
    expect(fp.open).toBe(81020);
    expect(fp.minDelta).toBeCloseTo(-2);
  });

  it('niezmienione świece zachowują referencję między wywołaniami', async () => {
    const ws = await boot();
    const a = series.bars();
    ws.msg({ channel: 'trades', data: [trade(now - 1000, 81025, 1, 'B', 1)] });
    const b = series.bars();
    expect(b[0]).toBe(a[0]);
    expect(b[1]).toBe(a[1]);
    expect(b[2]).not.toBe(a[2]);
  });

  it('drugi interwał tego rynku liczy footprint z tej samej taśmy (panele układu)', async () => {
    const ws = await boot();
    ws.msg({ channel: 'trades', data: [trade(now - 1000, 81025, 1, 'B', 1), trade(now - 900, 81025, 1, 'B', 2)] });
    const M1 = 60_000;
    const t1 = Math.floor((now - 1000) / M1) * M1;
    candles = [{ ...candle(t1, 81020, 81025, 3), i: '1m' }];
    const m1 = store.series('1m');
    await m1.load();
    const bar = m1.bars().find((b) => b.t === t1)!;
    expect(bar.fp?.buyVol).toBeCloseTo(2);
    ws.msg({ channel: 'trades', data: [trade(now - 100, 81026, 1, 'A', 3)] });
    expect(m1.bars().find((b) => b.t === t1)!.fp?.delta).toBeCloseTo(1);
    // Seria 5m tego rynku nadal liczy swoje świece z tej samej taśmy
    expect(series.bars().at(-1)!.fp?.buyVol).toBeCloseTo(2);
  });

  it('wypełnienia jednego zlecenia agresora trafiają do dziennika jako jedno zlecenie', async () => {
    const ws = await boot();
    ws.msg({ channel: 'trades', data: [trade(now - 1000, 81025, 1, 'B', 1, '0x07', '0xfeed'), trade(now - 1000, 81026, 2, 'B', 2, '0x07', '0xfeed')] });
    now += 3000;
    vi.setSystemTime(now);
    vi.advanceTimersByTime(2000);
    const [o] = store.orders.latest(1);
    expect(o.sz).toBeCloseTo(3);
    expect(o.fills).toBe(2);
    expect(o.levels).toBe(2);
  });

  it('zerwanie połączenia domyka pokrycie — świeca z luką nie jest pełna', async () => {
    const ws = await boot();
    ws.msg({ channel: 'trades', data: [trade(now - 1000, 81025, 0.1, 'B', 1)] });
    const next = T0 + 3 * M5;
    now = next + 10_000;
    vi.setSystemTime(now);
    ws.close();
    now = next + 20_000;
    vi.setSystemTime(now);
    vi.advanceTimersByTime(2000);
    const ws2 = FakeWs.last!;
    ws2.open();
    ws2.msg({ channel: 'subscriptionResponse', data: { method: 'subscribe', subscription: { type: 'trades', coin: 'BTC' } } });
    ws2.msg({ channel: 'trades', data: [trade(next + 21_000, 81030, 1, 'B', 9)] });
    ws2.msg({ channel: 'candle', data: candle(next, 81030, 81031, 1) });
    expect(store.coverage.covers(next, next + 30_000)).toBe(false);
    expect(series.bars().at(-1)!.complete).toBe(false);
  });

  it('uśpienie karty na 10 min w środku świecy: pokrycie do ostatniej transakcji, świeca niepełna, po wybudzeniu luka zostaje do dociągnięcia', async () => {
    const ws = await boot();
    ws.msg({ channel: 'trades', data: [trade(now - 2000, 81025, 0.1, 'B', 1), trade(now - 1000, 81026, 0.1, 'B', 2)] });
    const lastTrade = now - 1000;
    // uśpienie: zegar idzie 10 min, timery stoją; po wybudzeniu strażnik połączenia
    now += 10 * 60_000;
    vi.setSystemTime(now);
    vi.advanceTimersByTime(10_000);
    now += 10_000;
    expect(store.coverage.covers(lastTrade, lastTrade + 60_000)).toBe(false);
    // nowe połączenie: migawka z transakcjami po wybudzeniu, więc luka zostaje (dociągnie ją historia serwera)
    vi.advanceTimersByTime(2000);
    now += 2000;
    const ws2 = FakeWs.last!;
    expect(ws2).not.toBe(ws);
    ws2.open();
    ws2.msg({ channel: 'subscriptionResponse', data: { method: 'subscribe', subscription: { type: 'trades', coin: 'BTC' } } });
    ws2.msg({ channel: 'trades', data: [trade(now - 3000, 81100, 0.2, 'A', 50), trade(now - 1000, 81101, 0.2, 'B', 51)] });
    expect(store.coverage.covers(lastTrade, now - 3000)).toBe(false);
    expect(store.coverage.covers(now - 2999, now)).toBe(true);
    expect(series.bars().find((b) => b.t === T0 + 2 * M5)!.complete).toBe(false);
  });

  /** Uśpienie karty jak wyżej; zwraca czas ostatniej transakcji przed snem i chwilę po ponownym połączeniu. */
  async function sleepTab() {
    const ws = await boot();
    ws.msg({ channel: 'trades', data: [trade(now - 2000, 81025, 0.1, 'B', 1), trade(now - 1000, 81026, 0.1, 'B', 2)] });
    const lastTrade = now - 1000;
    now += 10 * 60_000;
    vi.setSystemTime(now);
    vi.advanceTimersByTime(12_000);
    now += 12_000;
    const ws2 = FakeWs.last!;
    ws2.open();
    ws2.msg({ channel: 'subscriptionResponse', data: { method: 'subscribe', subscription: { type: 'trades', coin: 'BTC' } } });
    ws2.msg({ channel: 'trades', data: [trade(now - 3000, 81100, 0.2, 'A', 50), trade(now - 1000, 81101, 0.2, 'B', 51)] });
    return { lastTrade, woke: now - 3000 };
  }
  const restore = (from: number, to: number) =>
    store.restoreHistory({ trades: { from, to, spans: [[from, to]], zeroSpans: [], fills: [], oi: [] }, frames: [] });
  const sleptBar = () => series.bars().findIndex((b) => b.t === T0 + 2 * M5);

  it('dociągnięcie luki po uśpieniu: historia serwera obejmująca lukę daje świecę pełną i CVD bez przerwy', async () => {
    const { woke } = await sleepTab();
    const i = sleptBar();
    expect(series.bars()[i].complete).toBe(false);
    expect(cvdCandles(series.bars(), 'day')[i]).toBeNull();
    restore(T0, woke);
    expect(series.bars()[i].complete).toBe(true);
    expect(cvdCandles(series.bars(), 'day')[i]).not.toBeNull();
  });

  it('historia obejmująca tylko część luki: świeca zostaje niepełna', async () => {
    const { lastTrade } = await sleepTab();
    restore(T0, lastTrade + 60_000);
    expect(series.bars()[sleptBar()].complete).toBe(false);
  });

  it('początek nagrania z migawki po subskrypcji, w zegarze giełdy (zegar przeglądarki spóźniony o 2 min)', async () => {
    const ws = await boot();
    const server = now + 120_000;
    ws.msg({ channel: 'trades', data: [trade(server - 9000, 81020, 0.3, 'A', 1), trade(server - 2000, 81025, 0.5, 'B', 2)] });
    expect(store.coverage.covers(now, server - 2000)).toBe(false);
    expect(store.coverage.covers(server - 2000, server)).toBe(true);
    // Migawka to ostatnie transakcje z rzędu: taśma kompletna od milisekundy po najstarszej z nich
    expect(store.coverage.covers(server - 8999, server)).toBe(true);
    expect(store.coverage.covers(server - 9000, server)).toBe(false);
  });

  it('migawka bez transakcji nowszych niż zerwanie połączenia zachowuje ciągłość nagrania', async () => {
    const ws = await boot();
    ws.msg({ channel: 'trades', data: [trade(now - 5000, 81025, 0.1, 'B', 1)] });
    ws.msg({ channel: 'trades', data: [trade(now - 1000, 81026, 0.2, 'B', 2)] });
    ws.close();
    now += 5000;
    vi.setSystemTime(now);
    vi.advanceTimersByTime(2000);
    const ws2 = FakeWs.last!;
    ws2.open();
    ws2.msg({ channel: 'subscriptionResponse', data: { method: 'subscribe', subscription: { type: 'trades', coin: 'BTC' } } });
    // Ta sama migawka co przed zerwaniem: w przerwie nie było transakcji, więc nic nie przepadło
    ws2.msg({ channel: 'trades', data: [trade(now - 10_000, 81025, 0.1, 'B', 1), trade(now - 6000, 81026, 0.2, 'B', 2)] });
    expect(store.coverage.covers(now - 10_000, now)).toBe(true);
  });

  it('nieudane pobranie starszej strony to nie koniec historii: ponowna próba najwcześniej po 30 s; pusta strona — koniec', async () => {
    await boot();
    let fail = true;
    let calls = 0;
    const older = [candle(T0 - M5, 80990, 81000, 3)];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        // Liczymy tylko zapytania o świece (po doczytaniu seria pyta też o funding)
        if (JSON.parse(init.body).type !== 'candleSnapshot') return { ok: true, json: async () => [] };
        calls++;
        return fail ? { ok: false, json: async () => null } : { ok: true, json: async () => older };
      })
    );
    const failedAt = Date.now();
    await series.loadOlder();
    expect([series.historyExhausted, series.olderFailed, calls]).toEqual([false, true, 1]);
    // Przed upływem 30 s od błędu bez kolejnego zapytania (zegar testu: od chwili błędu)
    vi.setSystemTime(failedAt + 29_000);
    await series.loadOlder();
    expect(calls).toBe(1);
    // Po 30 s ponowna próba, tym razem udana: starsza świeca dołączona, błąd zapomniany
    fail = false;
    vi.setSystemTime(failedAt + 30_000);
    await series.loadOlder();
    expect([series.candles[0].t, series.olderFailed, series.historyExhausted, calls]).toEqual([T0 - M5, false, false, 2]);
    // Prawdziwie pusta odpowiedź (limit historii API) kończy doczytywanie
    older.length = 0;
    await series.loadOlder();
    expect([series.historyExhausted, series.olderFailed]).toEqual([true, false]);
  });

  it('po nieudanej starszej stronie zegar sam budzi odbiorców po 30 s (bez czekania na kolejny render)', async () => {
    await boot();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => (JSON.parse(init.body).type === 'candleSnapshot' ? { ok: false, json: async () => null } : { ok: true, json: async () => [] }))
    );
    await series.loadOlder();
    expect(series.olderFailed).toBe(true);
    const bumps: number[] = [];
    const off = store.subscribe(() => bumps.push(Date.now()));
    vi.advanceTimersByTime(29_000);
    expect(bumps).toEqual([]);
    vi.advanceTimersByTime(1_100);
    expect(bumps.length).toBeGreaterThan(0);
    off();
  });

  it('w trakcie ponownej próby to nie „błąd” (bez „kolejna próba” przy zapytaniu w drodze); nowy błąd wraca po odpowiedzi', async () => {
    await boot();
    let answer: (v: unknown) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        if (JSON.parse(init.body).type !== 'candleSnapshot') return { ok: true, json: async () => [] };
        return new Promise((r) => (answer = r));
      })
    );
    const first = series.loadOlder();
    answer({ ok: false, json: async () => null });
    await first;
    expect(series.olderFailed).toBe(true);
    vi.setSystemTime(Date.now() + 30_000);
    const retry = series.loadOlder();
    expect([series.loadingOlder, series.olderFailed]).toEqual([true, false]);
    answer({ ok: false, json: async () => null });
    await retry;
    expect([series.loadingOlder, series.olderFailed]).toEqual([false, true]);
  });
});

describe('rynek spoza rejestru z linku', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('przełączenie na BTC zamyka magazyn tej nazwy i usuwa jej bazę taśmy (bez pustych baz w przeglądarce)', async () => {
    const deleted: string[] = [];
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('bez zapisu w teście');
      },
      deleteDatabase: (name: string) => {
        deleted.push(name);
        const r: { onsuccess?: () => void } = {};
        setTimeout(() => r.onsuccess?.(), 0);
        return r;
      },
    });
    const s = storeFor('xyz:OLD');
    const stop = vi.spyOn(s, 'stop');
    expect(openStores()).toContain(s);
    expect(dropStore('xyz:OLD')).toBe(s);
    expect(stop).toHaveBeenCalled();
    expect(openStores()).not.toContain(s);
    expect(storeFor('xyz:OLD')).not.toBe(s);
    dropStore('xyz:OLD');
    await discardRecording(s);
    expect(deleted).toEqual(['hq-pro-tape-xyz-OLD']);
    expect(dropStore('xyz:NONE')).toBeNull();
  });
});
