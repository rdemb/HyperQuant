import { describe, expect, it, vi } from 'vitest';
import { HlStream } from '../hl/stream';
import { ProStore } from '../store/proStore';

describe('SMC consumes the existing public stream', () => {
  it('uses WS receive time, shared subscription and disconnects, never archive receipt', () => {
    const stream = new HlStream();
    const listen = vi.spyOn(stream, 'listen');
    const add = vi.spyOn(stream, 'add');
    const store = new ProStore(stream);
    const h = listen.mock.calls[0][0];
    const raw = { coin: 'BTC', time: 10000, tid: 7, px: '100', sz: '2', side: 'B', users: ['buyer', 'seller'] };
    h.onSubscribed?.({ type: 'trades', coin: 'BTC' }, 10020);
    h.onMessage?.('trades', [raw], 10020);
    h.onMessage?.('trades', [raw], 10030);
    expect(store.observations.tradesAfter(0)).toHaveLength(1);
    expect(JSON.stringify(store.observations.tradesAfter(0))).not.toContain('buyer');
    store.ingestFills([{ time: 10010, tid: 8, px: 101, sz: 1, side: -1, hash: '', taker: '', maker: '' }], 10040);
    expect(store.observations.tradesAfter(0)).toHaveLength(1);
    h.onClosed?.(10020);
    expect(store.observations.gaps()).toHaveLength(1);
    expect(add).not.toHaveBeenCalled();
    const count = store.observations.gaps().length;
    h.onMessage?.('trades', [{ ...raw, coin: 'ETH' }], 10050);
    expect(store.observations.gaps()).toHaveLength(count);
    h.onMessage?.('trades', [{ ...raw, side: 'unknown' }], 10060);
    expect(store.observations.gaps()).toHaveLength(count + 1);
  });
});
