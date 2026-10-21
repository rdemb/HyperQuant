import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aggregateSmallTrades,
  binanceFuturesAdapter,
  binanceSpotAdapter,
  bybitAdapter,
  CEX_ADAPTERS,
  coinbaseAdapter,
  OKX_BTC_SWAP_CT_VAL,
  okxAdapter,
  tickTradeCount,
} from '../cexAdapters';
import { cexReconnectDelayMs, startCexFeeds } from '../../state/useCexFeeds';
import { AggrTradeTick } from '../../types/trading';

// Fixture'y odwzorowują przykłady z oficjalnej dokumentacji giełd (stan: 2026-10), z cenami BTC.

describe('Binance USDⓈ-M futures (combined stream /market)', () => {
  it('aggTrade: m=true (kupujący jest makerem) ⇒ agresor SELL', () => {
    const msg = {
      stream: 'btcusdt@aggTrade',
      data: {
        e: 'aggTrade',
        E: 1761060000123,
        s: 'BTCUSDT',
        a: 2876543210,
        p: '108250.40',
        q: '0.512',
        nq: '0.512',
        f: 6543210001,
        l: 6543210004,
        T: 1761060000120,
        m: true,
      },
    };
    const [t, ...rest] = binanceFuturesAdapter.parse(msg);
    expect(rest).toHaveLength(0);
    expect(t).toMatchObject({
      exchange: 'BINANCE_FUTURES',
      isPerp: true,
      side: 'sell',
      price: 108250.4,
      sizeBtc: 0.512,
      sizeUsd: 55424,
      timestamp: 1761060000120,
      isLiquidation: false,
      tier: 'threshold',
    });
    expect(t.isSynthetic).toBeUndefined();
    expect(t.id).toContain('2876543210');
  });

  it('aggTrade: m=false ⇒ agresor BUY', () => {
    const msg = { stream: 'btcusdt@aggTrade', data: { e: 'aggTrade', s: 'BTCUSDT', a: 1, p: '100000', q: '0.01', T: 1, m: false } };
    expect(binanceFuturesAdapter.parse(msg)[0].side).toBe('buy');
  });

  it('forceOrder: S=SELL ⇒ likwidacja longa (side sell), rozmiar z wypełnienia i ceny średniej', () => {
    const msg = {
      stream: 'btcusdt@forceOrder',
      data: {
        e: 'forceOrder',
        E: 1761060001000,
        o: {
          s: 'BTCUSDT',
          S: 'SELL',
          o: 'LIMIT',
          f: 'IOC',
          q: '1.250',
          p: '108000.00',
          ap: '108120.50',
          X: 'FILLED',
          l: '0.400',
          z: '1.250',
          T: 1761060000998,
        },
      },
    };
    const [t] = binanceFuturesAdapter.parse(msg);
    expect(t).toMatchObject({
      exchange: 'BINANCE_FUTURES',
      side: 'sell',
      isLiquidation: true,
      price: 108120.5,
      sizeBtc: 1.25,
      sizeUsd: 135151,
      tier: 'huge',
      timestamp: 1761060000998,
    });
  });

  it('forceOrder: S=BUY ⇒ likwidacja shorta (side buy); inny symbol pomijany', () => {
    const base = { e: 'forceOrder', E: 1, o: { s: 'BTCUSDT', S: 'BUY', q: '0.2', p: '100000', ap: '100000', z: '0.2', T: 5 } };
    expect(binanceFuturesAdapter.parse({ stream: 'btcusdt@forceOrder', data: base })[0]).toMatchObject({ side: 'buy', isLiquidation: true });
    const eth = { ...base, o: { ...base.o, s: 'ETHUSDT' } };
    expect(binanceFuturesAdapter.parse({ stream: 'x', data: eth })).toEqual([]);
  });

  it('URL używa ścieżki /market (stare /stream wyłączone 2026-04-23)', () => {
    expect(binanceFuturesAdapter.url).toBe('wss://fstream.binance.com/market/stream?streams=btcusdt@aggTrade/btcusdt@forceOrder');
    expect(binanceFuturesAdapter.pingPayload).toBeUndefined();
  });

  it('wiadomość bez znanego zdarzenia ⇒ pusto', () => {
    expect(binanceFuturesAdapter.parse({ result: null, id: 1 })).toEqual([]);
    expect(binanceFuturesAdapter.parse(null)).toEqual([]);
  });
});

describe('Binance spot', () => {
  it('aggTrade spot: isPerp false, próg spot', () => {
    const msg = {
      stream: 'btcusdt@aggTrade',
      data: { e: 'aggTrade', E: 1761060000200, s: 'BTCUSDT', a: 3456789012, p: '108240.01', q: '0.06000', f: 1, l: 2, T: 1761060000199, m: false, M: true },
    };
    const [t] = binanceSpotAdapter.parse(msg);
    expect(t).toMatchObject({ exchange: 'BINANCE', isPerp: false, side: 'buy', sizeUsd: 6494, tier: 'threshold' });
    expect(binanceSpotAdapter.isPerp).toBe(false);
  });
});

describe('Bybit v5 linear', () => {
  it('publicTrade: S to strona agresora; wiele transakcji w jednej wiadomości', () => {
    const msg = {
      topic: 'publicTrade.BTCUSDT',
      type: 'snapshot',
      ts: 1761060000500,
      data: [
        { T: 1761060000498, s: 'BTCUSDT', S: 'Buy', v: '0.010', p: '108255.10', L: 'PlusTick', i: '20f43950-d8dd-5b31-9112-a178eb6023af', BT: false, RPI: false, seq: 1783284617 },
        { T: 1761060000499, s: 'BTCUSDT', S: 'Sell', v: '2.500', p: '108254.90', L: 'MinusTick', i: '8c5ab3ab-3c41-5d21-a2a1-5b3e7e4e6f01', BT: false, seq: 1783284618 },
      ],
    };
    const ticks = bybitAdapter.parse(msg);
    expect(ticks).toHaveLength(2);
    expect(ticks[0]).toMatchObject({ exchange: 'BYBIT', isPerp: true, side: 'buy', sizeUsd: 1083, tier: 'normal', isLiquidation: false });
    expect(ticks[1]).toMatchObject({ side: 'sell', sizeBtc: 2.5, sizeUsd: 270637, tier: 'threshold' });
    expect(ticks[0].id).not.toBe(ticks[1].id);
  });

  it('allLiquidation: S=Buy oznacza zlikwidowany LONG ⇒ wymuszona sprzedaż (side sell)', () => {
    const msg = {
      topic: 'allLiquidation.BTCUSDT',
      type: 'snapshot',
      ts: 1761060002000,
      data: [{ T: 1761060001990, s: 'BTCUSDT', S: 'Buy', v: '0.300', p: '107900.00' }],
    };
    const [t] = bybitAdapter.parse(msg);
    expect(t).toMatchObject({ side: 'sell', isLiquidation: true, sizeUsd: 32370, tier: 'threshold', price: 107900 });
    const short = { ...msg, data: [{ ...msg.data[0], S: 'Sell' }] };
    expect(bybitAdapter.parse(short)[0].side).toBe('buy');
  });

  it('pong i potwierdzenie subskrypcji ⇒ pusto; konfiguracja subskrypcji i pingu', () => {
    expect(bybitAdapter.parse({ success: true, ret_msg: 'pong', conn_id: 'abc', op: 'ping' })).toEqual([]);
    expect(bybitAdapter.parse({ success: true, ret_msg: '', conn_id: 'abc', req_id: '', op: 'subscribe' })).toEqual([]);
    expect(bybitAdapter.subscribe).toEqual([{ op: 'subscribe', args: ['publicTrade.BTCUSDT', 'allLiquidation.BTCUSDT'] }]);
    expect(bybitAdapter.pingIntervalMs).toBe(20000);
    expect(JSON.parse(bybitAdapter.pingPayload!)).toEqual({ op: 'ping' });
  });
});

describe('OKX v5 public', () => {
  it('ctVal BTC-USDT-SWAP = 0.01 BTC', () => {
    expect(OKX_BTC_SWAP_CT_VAL).toBe(0.01);
  });

  it('trades: sz w kontraktach × ctVal; side to strona agresora', () => {
    const msg = {
      arg: { channel: 'trades', instId: 'BTC-USDT-SWAP' },
      data: [{ instId: 'BTC-USDT-SWAP', tradeId: '1234567890', px: '108248.3', sz: '150', side: 'buy', ts: '1761060000700', count: '2', source: '0', seqId: 1234 }],
    };
    const [t] = okxAdapter.parse(msg);
    expect(t).toMatchObject({
      exchange: 'OKEX',
      isPerp: true,
      side: 'buy',
      sizeBtc: 1.5,
      sizeUsd: 162372,
      timestamp: 1761060000700,
      tier: 'threshold',
    });
  });

  it('liquidation-orders: filtr BTC-USDT-SWAP; side buy = zamknięcie shorta', () => {
    const msg = {
      arg: { channel: 'liquidation-orders', instType: 'SWAP' },
      data: [
        {
          details: [{ bkLoss: '0', bkPx: '108310.5', ccy: '', posSide: 'short', side: 'buy', sz: '20', ts: '1761060003000' }],
          instFamily: 'BTC-USDT',
          instId: 'BTC-USDT-SWAP',
          instType: 'SWAP',
          uly: 'BTC-USDT',
        },
        {
          details: [{ bkLoss: '0', bkPx: '1.057', ccy: '', posSide: 'long', side: 'sell', sz: '300', ts: '1761060003001' }],
          instFamily: 'DYDX-USDT',
          instId: 'DYDX-USDT-SWAP',
          instType: 'SWAP',
          uly: 'DYDX-USDT',
        },
      ],
    };
    const ticks = okxAdapter.parse(msg);
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toMatchObject({ exchange: 'OKEX', side: 'buy', isLiquidation: true, sizeBtc: 0.2, sizeUsd: 21662, tier: 'threshold' });
  });

  it('zdarzenia subskrypcji ⇒ pusto; ping tekstem co 25 s', () => {
    expect(okxAdapter.parse({ event: 'subscribe', arg: { channel: 'trades', instId: 'BTC-USDT-SWAP' }, connId: 'a4d3ae55' })).toEqual([]);
    expect(okxAdapter.pingPayload).toBe('ping');
    expect(okxAdapter.pingIntervalMs).toBe(25000);
    expect(okxAdapter.subscribe).toEqual([
      {
        op: 'subscribe',
        args: [
          { channel: 'trades', instId: 'BTC-USDT-SWAP' },
          { channel: 'liquidation-orders', instType: 'SWAP' },
        ],
      },
    ]);
  });
});

describe('Coinbase Advanced Trade (market_trades, bez JWT)', () => {
  it('update: side to strona MAKERA ⇒ agresor przeciwny', () => {
    const msg = {
      channel: 'market_trades',
      client_id: '',
      timestamp: '2026-10-21T15:20:00.512345678Z',
      sequence_num: 12,
      events: [
        {
          type: 'update',
          trades: [
            { trade_id: '871234567', product_id: 'BTC-USD', price: '108230.12', size: '0.0045', side: 'SELL', time: '2026-10-21T15:20:00.501234Z' },
            { trade_id: '871234568', product_id: 'BTC-USD', price: '108229.50', size: '0.25', side: 'BUY', time: '2026-10-21T15:20:00.505Z' },
          ],
        },
      ],
    };
    const ticks = coinbaseAdapter.parse(msg);
    expect(ticks).toHaveLength(2);
    expect(ticks[0]).toMatchObject({ exchange: 'COINBASE', isPerp: false, side: 'buy', sizeUsd: 487, timestamp: Date.UTC(2026, 9, 21, 15, 20, 0, 501) });
    expect(ticks[1]).toMatchObject({ side: 'sell', sizeUsd: 27057, tier: 'threshold' });
  });

  it('snapshot (historia przy subskrypcji), heartbeats i subscriptions ⇒ pusto', () => {
    const snap = {
      channel: 'market_trades',
      events: [{ type: 'snapshot', trades: [{ trade_id: '1', product_id: 'BTC-USD', price: '1', size: '1', side: 'BUY', time: '2026-10-21T15:20:00Z' }] }],
    };
    expect(coinbaseAdapter.parse(snap)).toEqual([]);
    expect(coinbaseAdapter.parse({ channel: 'heartbeats', events: [{ current_time: 'x', heartbeat_counter: 3 }] })).toEqual([]);
    expect(coinbaseAdapter.parse({ channel: 'subscriptions', events: [{ subscriptions: { market_trades: ['BTC-USD'] } }] })).toEqual([]);
    expect(coinbaseAdapter.url).toBe('wss://advanced-trade-ws.coinbase.com');
    expect(coinbaseAdapter.subscribe?.map((s) => (s as { channel: string }).channel)).toEqual(['market_trades', 'heartbeats']);
  });
});

describe('rejestr adapterów', () => {
  it('pięć giełd, unikalne id', () => {
    const ids = CEX_ADAPTERS.map((a) => a.id);
    expect(new Set(ids).size).toBe(5);
    expect(ids).toEqual(expect.arrayContaining(['BINANCE_FUTURES', 'BINANCE', 'BYBIT', 'OKEX', 'COINBASE']));
  });
});

function tick(p: Partial<AggrTradeTick>): AggrTradeTick {
  return {
    id: `t-${Math.random()}`,
    timestamp: 1761060000000,
    exchange: 'BYBIT',
    market: 'BTCUSDT-PERP',
    isPerp: true,
    side: 'buy',
    price: 100000,
    sizeUsd: 1000,
    sizeBtc: 0.01,
    isLiquidation: false,
    tier: 'normal',
    ...p,
  };
}

describe('aggregateSmallTrades — sumowanie drobnych transakcji w paczce', () => {
  it('drobne per giełda/strona/sekunda sumowane z VWAP; duże i likwidacje pojedynczo; wolumen zachowany', () => {
    const input = [
      tick({ price: 100000, sizeBtc: 0.01, sizeUsd: 1000, timestamp: 1761060000100 }),
      tick({ price: 100010, sizeBtc: 0.03, sizeUsd: 3000, timestamp: 1761060000200 }),
      tick({ side: 'sell', price: 99990, sizeBtc: 0.02, sizeUsd: 2000, timestamp: 1761060000150 }),
      tick({ exchange: 'OKEX', price: 100005, sizeBtc: 0.01, sizeUsd: 1000, timestamp: 1761060000300 }),
      tick({ price: 100020, sizeBtc: 1, sizeUsd: 100020, tier: 'threshold', timestamp: 1761060000250 }),
      tick({ price: 99900, sizeBtc: 0.5, sizeUsd: 49950, isLiquidation: true, side: 'sell', tier: 'threshold', timestamp: 1761060000260 }),
      // Następna sekunda — osobny koszyk (nie przekracza granicy świecy)
      tick({ price: 100030, sizeBtc: 0.01, sizeUsd: 1000, timestamp: 1761060001010 }),
    ];
    const out = aggregateSmallTrades(input);
    const sum = (arr: AggrTradeTick[]) => arr.reduce((s, t) => s + t.sizeUsd, 0);
    expect(sum(out)).toBe(sum(input));
    expect(out).toHaveLength(6);

    const bybitBuy = out.find((t) => t.exchange === 'BYBIT' && t.side === 'buy' && t.tier === 'normal' && t.timestamp < 1761060001000)!;
    expect(tickTradeCount(bybitBuy)).toBe(2);
    expect(bybitBuy.sizeBtc).toBeCloseTo(0.04, 6);
    expect(bybitBuy.price).toBeCloseTo((100000 * 0.01 + 100010 * 0.03) / 0.04, 6);
    expect(bybitBuy.timestamp).toBe(1761060000200);
    expect(bybitBuy.tier).toBe('normal');

    // Pojedyncze zostają bez zmian (te same id)
    expect(out.filter((t) => tickTradeCount(t) === 1)).toHaveLength(5);
    expect(out.some((t) => t.isLiquidation && t.sizeUsd === 49950)).toBe(true);
    // Kolejność chronologiczna
    const ts = out.map((t) => t.timestamp);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });

  it('pusta paczka ⇒ pusto', () => {
    expect(aggregateSmallTrades([])).toEqual([]);
  });
});

describe('cexReconnectDelayMs — backoff 1 → 30 s', () => {
  it('podwaja się i ma sufit', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map(cexReconnectDelayMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });
});

// Atrapa WebSocketu do testu menedżera połączeń (bez sieci)
class FakeWS {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWS[] = [];
  readyState = FakeWS.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = FakeWS.CLOSED;
    this.onclose?.();
  }
  serverOpen() {
    this.readyState = FakeWS.OPEN;
    this.onopen?.();
  }
  serverMessage(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
  serverClose() {
    this.readyState = FakeWS.CLOSED;
    this.onclose?.();
  }
}

describe('startCexFeeds — połączenia, ping, paczki, reconnect, sprzątanie', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeWS.instances = [];
  });

  it('subskrybuje po otwarciu, wysyła ping, oddaje ticki paczką po 250 ms', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWS);
    const onTicks = vi.fn();
    const status: Record<string, string> = {};
    const stop = startCexFeeds([bybitAdapter], { onTicks, onStatus: (id, s) => (status[id] = s) });

    expect(FakeWS.instances).toHaveLength(1);
    expect(status.BYBIT).toBe('connecting');
    const ws = FakeWS.instances[0];
    ws.serverOpen();
    expect(status.BYBIT).toBe('open');
    expect(JSON.parse(ws.sent[0])).toEqual(bybitAdapter.subscribe![0]);

    vi.advanceTimersByTime(20000);
    expect(ws.sent.slice(1)).toEqual([bybitAdapter.pingPayload]);

    const trade = (i: string, S: string) => ({ topic: 'publicTrade.BTCUSDT', data: [{ T: Date.now(), s: 'BTCUSDT', S, v: '1', p: '100000', i }] });
    ws.serverMessage(trade('a', 'Buy'));
    ws.serverMessage('nie-json');
    ws.serverMessage(trade('b', 'Sell'));
    expect(onTicks).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(onTicks).toHaveBeenCalledTimes(1);
    expect(onTicks.mock.calls[0][0]).toHaveLength(2);

    stop();
  });

  it('po zamknięciu łączy ponownie z backoffem; stop zamyka gniazdo w CONNECTING i nie wznawia', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWS);
    const status: Record<string, string> = {};
    const stop = startCexFeeds([okxAdapter], { onTicks: vi.fn(), onStatus: (id, s) => (status[id] = s) });

    FakeWS.instances[0].serverClose();
    expect(status.OKEX).toBe('closed');
    vi.advanceTimersByTime(999);
    expect(FakeWS.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWS.instances).toHaveLength(2);

    // Drugie zerwanie bez danych ⇒ dłuższe opóźnienie (2 s)
    FakeWS.instances[1].serverClose();
    vi.advanceTimersByTime(1999);
    expect(FakeWS.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWS.instances).toHaveLength(3);

    const connecting = FakeWS.instances[2];
    expect(connecting.readyState).toBe(FakeWS.CONNECTING);
    stop();
    expect(connecting.readyState).toBe(FakeWS.CLOSED);
    vi.advanceTimersByTime(60000);
    expect(FakeWS.instances).toHaveLength(3);
  });
});
