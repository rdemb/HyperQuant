import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HlStream } from '../hl/stream';
import { ProStore } from '../store/proStore';

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
  });

  afterEach(() => {
    store.stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function boot() {
    store.start();
    FakeWs.last!.open();
    await vi.waitFor(() => expect(store.loadState).toBe('ready'));
    const ws = FakeWs.last!;
    ws.msg({ channel: 'subscriptionResponse', data: { method: 'subscribe', subscription: { type: 'trades', coin: 'BTC' } } });
    return ws;
  }

  it('ładuje świece interwału i subskrybuje transakcje, kontekst i świecę', async () => {
    const ws = await boot();
    expect(store.bars()).toHaveLength(3);
    const subs = ws.sent.map((s) => JSON.parse(s).subscription.type);
    expect(subs).toEqual(expect.arrayContaining(['trades', 'activeAssetCtx', 'candle']));
  });

  it('transakcje tworzą footprint świecy; świeca otwarta w trakcie nagrania jest niepełna', async () => {
    const ws = await boot();
    ws.msg({ channel: 'trades', data: [trade(now - 1000, 81025, 0.5, 'B', 1), trade(now - 500, 81024, 0.2, 'A', 2)] });
    const bars = store.bars();
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
    now = next + 60_000;
    vi.setSystemTime(now);
    ws.msg({ channel: 'trades', data: [trade(next + 1000, 81030, 1, 'B', 3)] });
    candles = [];
    ws.msg({ channel: 'candle', data: candle(next, 81030, 81031, 1) });
    const last = store.bars().at(-1)!;
    expect(last.t).toBe(next);
    expect(last.complete).toBe(true);
    expect(last.fp?.delta).toBeCloseTo(1);
  });

  it('spóźniona transakcja przelicza bieżącą świecę z taśmy', async () => {
    const ws = await boot();
    ws.msg({ channel: 'trades', data: [trade(now - 1000, 81025, 1, 'B', 1)] });
    ws.msg({ channel: 'trades', data: [trade(now - 3000, 81020, 2, 'A', 2)] });
    const fp = store.bars()[2].fp!;
    expect(fp.delta).toBeCloseTo(-1);
    expect(fp.open).toBe(81020);
    expect(fp.minDelta).toBeCloseTo(-2);
  });

  it('niezmienione świece zachowują referencję między wywołaniami', async () => {
    const ws = await boot();
    const a = store.bars();
    ws.msg({ channel: 'trades', data: [trade(now - 1000, 81025, 1, 'B', 1)] });
    const b = store.bars();
    expect(b[0]).toBe(a[0]);
    expect(b[1]).toBe(a[1]);
    expect(b[2]).not.toBe(a[2]);
  });

  it('zmiana interwału przelicza footprint z taśmy dla nowych świec', async () => {
    const ws = await boot();
    ws.msg({ channel: 'trades', data: [trade(now - 1000, 81025, 1, 'B', 1), trade(now - 900, 81025, 1, 'B', 2)] });
    const M1 = 60_000;
    const t1 = Math.floor((now - 1000) / M1) * M1;
    candles = [{ ...candle(t1, 81020, 81025, 3), i: '1m' }];
    await store.setInterval('1m');
    const bar = store.bars().find((b) => b.t === t1)!;
    expect(bar.fp?.buyVol).toBeCloseTo(2);
    ws.msg({ channel: 'trades', data: [trade(now - 100, 81026, 1, 'A', 3)] });
    expect(store.bars().find((b) => b.t === t1)!.fp?.delta).toBeCloseTo(1);
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
    expect(store.bars().at(-1)!.complete).toBe(false);
  });

  it('początek nagrania z migawki po subskrypcji, w zegarze giełdy (zegar przeglądarki spóźniony o 2 min)', async () => {
    const ws = await boot();
    const server = now + 120_000;
    ws.msg({ channel: 'trades', data: [trade(server - 9000, 81020, 0.3, 'A', 1), trade(server - 2000, 81025, 0.5, 'B', 2)] });
    expect(store.coverage.covers(now, server - 2000)).toBe(false);
    expect(store.coverage.covers(server - 2000, server)).toBe(true);
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
});
