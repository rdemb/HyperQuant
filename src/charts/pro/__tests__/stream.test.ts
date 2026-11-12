import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HlStream, Subscription, parseSubscription, subKey } from '../hl/stream';

class FakeWs {
  static instances: FakeWs[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeWs.instances.push(this);
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

const trades: Subscription = { type: 'trades', coin: 'BTC' };

describe('HlStream', () => {
  let now = 1_000_000;
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWs.instances = [];
    now = 1_000_000;
  });
  afterEach(() => vi.useRealTimers());

  const make = () => new HlStream({ wsFactory: (u) => new FakeWs(u) as unknown as WebSocket, now: () => now });

  it('subskrybuje po otwarciu i odtwarza subskrypcje po ponownym połączeniu', () => {
    const s = make();
    s.add(trades);
    s.start();
    const ws = FakeWs.instances[0];
    ws.open();
    expect(ws.sent).toEqual([JSON.stringify({ method: 'subscribe', subscription: trades })]);
    ws.close();
    expect(s.status).toBe('reconnecting');
    vi.advanceTimersByTime(2000);
    const ws2 = FakeWs.instances[1];
    expect(ws2).toBeDefined();
    ws2.open();
    expect(ws2.sent).toEqual([JSON.stringify({ method: 'subscribe', subscription: trades })]);
    s.stop();
  });

  it('przekazuje dane kanału i potwierdzenie subskrypcji; pong pomija', () => {
    const s = make();
    const onMessage = vi.fn();
    const onSubscribed = vi.fn();
    s.listen({ onMessage, onSubscribed });
    s.add(trades);
    s.start();
    const ws = FakeWs.instances[0];
    ws.open();
    ws.msg({ channel: 'subscriptionResponse', data: { method: 'subscribe', subscription: { type: 'trades', coin: 'BTC' } } });
    ws.msg({ channel: 'pong' });
    ws.msg({ channel: 'trades', data: [{ px: '1' }] });
    expect(onSubscribed).toHaveBeenCalledWith(trades, now);
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith('trades', [{ px: '1' }], now);
    s.stop();
  });

  it('wysyła ping co 30 s i zamyka martwe połączenie po 75 s ciszy', () => {
    const s = make();
    const onClosed = vi.fn();
    s.listen({ onClosed });
    s.start();
    const ws = FakeWs.instances[0];
    ws.open();
    now += 30_000;
    vi.advanceTimersByTime(30_000);
    expect(ws.sent).toContain('{"method":"ping"}');
    now += 50_000;
    vi.advanceTimersByTime(10_000);
    expect(ws.readyState).toBe(3);
    expect(onClosed).toHaveBeenCalled();
    s.stop();
  });

  it('uśpienie karty: zamknięcie z czasem ostatniej wiadomości z transakcjami, nie chwilą wykrycia; potem nowe połączenie', () => {
    const s = make();
    const onClosed = vi.fn();
    s.listen({ onClosed });
    s.add(trades);
    s.start();
    const ws = FakeWs.instances[0];
    ws.open();
    now += 5000;
    ws.msg({ channel: 'trades', data: [{ px: '1' }] });
    const lastTrades = now;
    now += 3000;
    ws.msg({ channel: 'activeAssetCtx', data: {} });
    // karta uśpiona 10 min: zegar idzie, timery stoją; po wybudzeniu pierwszy przebieg strażnika
    now += 10 * 60_000;
    vi.advanceTimersByTime(10_000);
    expect(onClosed).toHaveBeenCalledWith(lastTrades);
    vi.advanceTimersByTime(2000);
    expect(FakeWs.instances).toHaveLength(2);
    s.stop();
  });

  it('pierwsza wiadomość po długiej przerwie (bufor po wybudzeniu) nie idzie na stare połączenie: zamknięcie i nowe połączenie', () => {
    const s = make();
    const onClosed = vi.fn();
    const onMessage = vi.fn();
    s.listen({ onClosed, onMessage });
    s.add(trades);
    s.start();
    const ws = FakeWs.instances[0];
    ws.open();
    ws.msg({ channel: 'trades', data: [{ px: '1' }] });
    const lastTrades = now;
    now += 10 * 60_000;
    ws.msg({ channel: 'trades', data: [{ px: '2' }] });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledWith(lastTrades);
    expect(ws.readyState).toBe(3);
    vi.advanceTimersByTime(2000);
    expect(FakeWs.instances).toHaveLength(2);
    s.stop();
  });

  it('cisza samego kanału transakcji (inne kanały płyną) ponad 2 min: zamknięcie na ostatniej transakcji i nowe połączenie', () => {
    const s = make();
    const onClosed = vi.fn();
    s.listen({ onClosed });
    s.add(trades);
    s.start();
    const ws = FakeWs.instances[0];
    ws.open();
    ws.msg({ channel: 'trades', data: [{ px: '1' }] });
    const lastTrades = now;
    for (let k = 0; k < 11; k++) {
      now += 10_000;
      ws.msg({ channel: 'activeAssetCtx', data: {} });
      vi.advanceTimersByTime(10_000);
    }
    expect(onClosed).not.toHaveBeenCalled();
    now += 20_000;
    ws.msg({ channel: 'activeAssetCtx', data: {} });
    vi.advanceTimersByTime(10_000);
    expect(onClosed).toHaveBeenCalledWith(lastTrades);
    s.stop();
  });

  describe('próg ciszy kanału transakcji zależny od rynku', () => {
    /** `n` wiadomości z transakcjami co `gapMs` (n − 1 odstępów); zwraca czas ostatniej. */
    const feedTrades = (ws: FakeWs, n: number, gapMs: number): number => {
      for (let k = 0; k < n; k++) {
        if (k > 0) {
          now += gapMs;
          vi.advanceTimersByTime(gapMs);
        }
        ws.msg({ channel: 'trades', data: [{ px: String(k) }] });
      }
      return now;
    };
    /** Cisza transakcji przez `ms` przy płynącym innym kanale; strażnik sprawdza co 10 s. */
    const silence = (ws: FakeWs, ms: number) => {
      for (let t = 0; t < ms; ) {
        const d = Math.min(10_000, ms - t);
        now += d;
        t += d;
        ws.msg({ channel: 'activeAssetCtx', data: {} });
        vi.advanceTimersByTime(10_000);
      }
    };
    const openWith = (s: HlStream, onClosed: () => void) => {
      s.listen({ onClosed });
      s.add(trades);
      s.start();
      const ws = FakeWs.instances[0];
      ws.open();
      return ws;
    };

    it('gęsty strumień (odstępy 1 s): próg 120 s jak dotąd', () => {
      const s = make();
      const onClosed = vi.fn();
      const ws = openWith(s, onClosed);
      const last = feedTrades(ws, 51, 1000);
      silence(ws, 120_000);
      expect(onClosed).not.toHaveBeenCalled();
      silence(ws, 1000);
      expect(onClosed).toHaveBeenCalledWith(last);
      s.stop();
    });

    it('rzadki strumień (mediana odstępu 15 s): próg 300 s; 180 s ciszy bez ponownego łączenia, 301 s z nim', () => {
      const s = make();
      const onClosed = vi.fn();
      const ws = openWith(s, onClosed);
      const last = feedTrades(ws, 51, 15_000);
      silence(ws, 180_000);
      expect(onClosed).not.toHaveBeenCalled();
      expect(FakeWs.instances).toHaveLength(1);
      silence(ws, 120_000);
      expect(onClosed).not.toHaveBeenCalled();
      silence(ws, 1000);
      expect(onClosed).toHaveBeenCalledWith(last);
      vi.advanceTimersByTime(2000);
      expect(FakeWs.instances).toHaveLength(2);
      s.stop();
    });

    it('mniej niż 50 odstępów: próg 120 s także przy rzadkim strumieniu', () => {
      const s = make();
      const onClosed = vi.fn();
      const ws = openWith(s, onClosed);
      const last = feedTrades(ws, 50, 15_000);
      silence(ws, 120_000);
      expect(onClosed).not.toHaveBeenCalled();
      silence(ws, 1000);
      expect(onClosed).toHaveBeenCalledWith(last);
      s.stop();
    });

    it('odstępy liczone tylko na bieżącym połączeniu: po ponownym łączeniu znów 120 s', () => {
      const s = make();
      const onClosed = vi.fn();
      const ws = openWith(s, onClosed);
      feedTrades(ws, 51, 15_000);
      ws.close();
      vi.advanceTimersByTime(2000);
      const ws2 = FakeWs.instances[1];
      ws2.open();
      const last = feedTrades(ws2, 10, 15_000);
      onClosed.mockClear();
      silence(ws2, 120_000);
      expect(onClosed).not.toHaveBeenCalled();
      silence(ws2, 1000);
      expect(onClosed).toHaveBeenCalledWith(last);
      s.stop();
    });

    it('jawne tradesStaleMs to dolna granica progu: zastępuje 120 s, rzadki strumień dalej ją podnosi', () => {
      const dense = new HlStream({ wsFactory: (u) => new FakeWs(u) as unknown as WebSocket, now: () => now, tradesStaleMs: 200_000 });
      const onClosed = vi.fn();
      const ws = openWith(dense, onClosed);
      const last = feedTrades(ws, 51, 1000);
      silence(ws, 200_000);
      expect(onClosed).not.toHaveBeenCalled();
      silence(ws, 1000);
      expect(onClosed).toHaveBeenCalledWith(last);
      dense.stop();

      FakeWs.instances = [];
      const sparse = new HlStream({ wsFactory: (u) => new FakeWs(u) as unknown as WebSocket, now: () => now, tradesStaleMs: 60_000 });
      const onClosed2 = vi.fn();
      const ws2 = openWith(sparse, onClosed2);
      const last2 = feedTrades(ws2, 51, 15_000);
      silence(ws2, 300_000);
      expect(onClosed2).not.toHaveBeenCalled();
      silence(ws2, 1000);
      expect(onClosed2).toHaveBeenCalledWith(last2);
      sparse.stop();
    });
  });

  it('wypisanie wysyła unsubscribe; stop zamyka bez ponownego łączenia', () => {
    const s = make();
    s.add(trades);
    s.start();
    const ws = FakeWs.instances[0];
    ws.open();
    s.remove(trades);
    expect(ws.sent[1]).toBe(JSON.stringify({ method: 'unsubscribe', subscription: trades }));
    s.stop();
    vi.advanceTimersByTime(60_000);
    expect(FakeWs.instances).toHaveLength(1);
    expect(s.status).toBe('idle');
  });
});

describe('subKey i parseSubscription', () => {
  it('rozróżnia l2Book po nSigFigs i czyta potwierdzenia', () => {
    expect(subKey({ type: 'l2Book', coin: 'BTC', nSigFigs: 4 })).not.toBe(subKey({ type: 'l2Book', coin: 'BTC' }));
    expect(parseSubscription({ type: 'l2Book', coin: 'BTC', nSigFigs: 3 })).toEqual({ type: 'l2Book', coin: 'BTC', nSigFigs: 3 });
    expect(parseSubscription({ type: 'candle', coin: 'BTC', interval: '5m' })).toEqual({ type: 'candle', coin: 'BTC', interval: '5m' });
    expect(parseSubscription({ type: 'bbo', coin: 'BTC' })).toEqual({ type: 'bbo', coin: 'BTC' });
    expect(parseSubscription({ type: 'webData2', coin: 'BTC' })).toBeNull();
  });
});
