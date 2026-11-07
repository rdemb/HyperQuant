import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwapPlanCache } from '../store/twapCache';

const T0 = 1_000_000_000;
const activated = (twapId: number, timestamp: number) => ({ time: Math.floor(timestamp / 1000), twapId, status: { status: 'activated' }, state: { coin: 'BTC', side: 'B', sz: '1.0', minutes: 60, reduceOnly: false, randomize: false, timestamp } });

describe('TwapPlanCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it('jedno zapytanie naraz z odstępem, bez powtórek w kolejce, bez pseudonimów z zapisu serwera', async () => {
    const calls: string[] = [];
    const cache = new TwapPlanCache('BTC', async (u) => (calls.push(u), [activated(7, T0 - 60_000)]), () => Date.now(), 2000);
    cache.want('a', 60_000);
    cache.want('a', 60_000);
    cache.want('b', 60_000);
    cache.want('~k3', 60_000);
    cache.want(`~d${T0}:3`, 60_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(['a']);
    expect(cache.get('a')).toMatchObject({ pending: false, at: T0 });
    expect(cache.get('a')?.plans?.map((p) => p.id)).toEqual([7]);
    expect(cache.get('b')?.pending).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toEqual(['a', 'b']);
    expect(cache.get('~k3')).toBeUndefined();
    expect(cache.get(`~d${T0}:3`)).toBeUndefined();
  });

  it('świeża odpowiedź nie jest pobierana ponownie, starsza niż maxAge tak; błąd = plans null', async () => {
    let fail = false;
    const calls: string[] = [];
    const cache = new TwapPlanCache('BTC', async (u) => {
      calls.push(u);
      if (fail) throw new Error('sieć');
      return [];
    }, () => Date.now(), 2000);
    cache.want('a', 60_000);
    await vi.advanceTimersByTimeAsync(30_000);
    cache.want('a', 60_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    fail = true;
    await vi.advanceTimersByTimeAsync(31_000);
    cache.want('a', 60_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    expect(cache.get('a')).toMatchObject({ plans: null, pending: false });
  });
});
