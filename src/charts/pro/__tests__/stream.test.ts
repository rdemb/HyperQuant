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
    expect(parseSubscription({ type: 'bbo', coin: 'BTC' })).toBeNull();
  });
});
