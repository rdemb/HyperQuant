import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Span } from '../core/coverage';
import type { Fill } from '../hl/parse';
import { HlStream } from '../hl/stream';
import { ProStore, RETENTION_MS } from '../store/proStore';
import { StoredMinute, TapeKv, TapePersistence, mergeMinute, mergeSpans } from '../store/tapeDb';

/** Magazyn w pamięci o semantyce IndexedDB z tapeDb. */
class MemKv implements TapeKv {
  minutes = new Map<number, StoredMinute>();
  spans: Span[] = [];
  puts = 0;
  async minutesSince(from: number) {
    return [...this.minutes.values()].filter((m) => m.minute >= Math.floor(from / 60_000) * 60_000);
  }
  async getMinutes(list: number[]) {
    return list.map((m) => this.minutes.get(m));
  }
  async putMinutes(list: StoredMinute[]) {
    this.puts += list.length;
    for (const m of list) this.minutes.set(m.minute, m);
  }
  async deleteBefore(minute: number) {
    for (const k of [...this.minutes.keys()]) if (k < minute) this.minutes.delete(k);
  }
  async getSpans() {
    return this.spans.map((s) => [...s] as Span);
  }
  async putSpans(spans: Span[]) {
    this.spans = spans.map((s) => [...s] as Span);
  }
}

const T0 = 1_792_850_000_000 - (1_792_850_000_000 % 60_000);

function fill(time: number, px: number, sz: number, side: 1 | -1, tid: number): Fill {
  return { time, px, sz, side, tid, hash: `0x${tid}`, taker: '0xabc', maker: '0xdef' };
}

function newStore(): ProStore {
  return new ProStore(new HlStream({ wsFactory: () => ({}) as WebSocket }));
}

describe('TapePersistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 5 * 60_000);
  });
  afterEach(() => vi.useRealTimers());

  it('zapis i odtworzenie: te same transakcje i pokrycie do chwili sprzed zapasu, bez adresów', async () => {
    const kv = new MemKv();
    const a = newStore();
    a.coverage.open(T0);
    a.ingestFills([fill(T0 + 1000, 81000, 0.5, 1, 1), fill(T0 + 61_000, 81001, 0.25, -1, 2), fill(T0 + 62_000, 81002, 1, 1, 3)]);
    await new TapePersistence(a, kv).save();

    expect(kv.minutes.size).toBe(2);
    const stored = kv.minutes.get(T0 + 60_000)!;
    expect(Object.keys(stored).sort()).toEqual(['minute', 'px', 'side', 'sz', 't', 'tid']);
    expect(Array.from(stored.side)).toEqual([-1, 1]);
    expect(kv.spans).toEqual([[T0, T0 + 5 * 60_000 - 3000]]);

    const b = newStore();
    const n = await new TapePersistence(b, kv).restore();
    expect(n).toBe(3);
    expect(b.tape.count).toBe(3);
    expect(b.coverage.covers(T0, T0 + 4 * 60_000)).toBe(true);
    expect(b.coverage.isOpen).toBe(false);
  });

  it('kolejny zapis wysyła tylko zmienione minuty', async () => {
    const kv = new MemKv();
    const s = newStore();
    s.coverage.open(T0);
    s.ingestFills([fill(T0 + 1000, 81000, 0.5, 1, 1), fill(T0 + 61_000, 81001, 0.25, -1, 2)]);
    const p = new TapePersistence(s, kv);
    await p.save();
    expect(kv.puts).toBe(2);
    s.ingestFills([fill(T0 + 62_000, 81002, 1, 1, 3)]);
    await p.save();
    expect(kv.puts).toBe(3);
    await p.save();
    expect(kv.puts).toBe(3);
  });

  it('dwie karty: ta sama minuta jest sumą obu zapisów, a pokrycie łączy odcinki', async () => {
    const kv = new MemKv();
    const a = newStore();
    a.coverage.open(T0);
    a.ingestFills([fill(T0 + 1000, 81000, 0.5, 1, 1), fill(T0 + 2000, 81001, 0.5, 1, 2)]);
    await new TapePersistence(a, kv).save();

    vi.setSystemTime(T0 + 8 * 60_000);
    const b = newStore();
    b.coverage.open(T0 + 6 * 60_000);
    b.ingestFills([fill(T0 + 2000, 81001, 0.5, 1, 2), fill(T0 + 3000, 81002, 0.5, -1, 3)]);
    await new TapePersistence(b, kv).save();

    expect(Array.from(kv.minutes.get(T0)!.tid)).toEqual([1, 2, 3]);
    expect(kv.spans).toEqual([
      [T0, T0 + 5 * 60_000 - 3000],
      [T0 + 6 * 60_000, T0 + 8 * 60_000 - 3000],
    ]);
  });

  it('usuwa zapis starszy niż doba', async () => {
    const kv = new MemKv();
    const s = newStore();
    s.coverage.open(T0);
    s.ingestFills([fill(T0 + 1000, 81000, 0.5, 1, 1)]);
    await new TapePersistence(s, kv).save();
    vi.setSystemTime(T0 + RETENTION_MS + 5 * 60_000);
    const later = newStore();
    later.coverage.open(T0 + RETENTION_MS + 60_000);
    later.ingestFills([fill(T0 + RETENTION_MS + 120_000, 81000, 0.5, 1, 9)]);
    await new TapePersistence(later, kv).save();
    expect([...kv.minutes.keys()]).toEqual([T0 + RETENTION_MS + 120_000]);
    expect(kv.spans.every(([, b]) => b > T0 + 5 * 60_000)).toBe(true);
  });
});

describe('mergeMinute / mergeSpans', () => {
  const m = (t: number[], tid: number[]): StoredMinute => ({
    minute: T0,
    t: Float64Array.from(t),
    px: Float64Array.from(t.map(() => 1)),
    sz: Float64Array.from(t.map(() => 1)),
    side: Int8Array.from(t.map(() => 1)),
    tid: Float64Array.from(tid),
  });

  it('łączy rosnąco i odrzuca duplikaty (czas + tid)', () => {
    const r = mergeMinute(m([1, 3, 5], [10, 30, 50]), m([2, 3, 3], [20, 30, 31]));
    expect(Array.from(r.t)).toEqual([1, 2, 3, 3, 5]);
    expect(Array.from(r.tid)).toEqual([10, 20, 30, 31, 50]);
  });

  it('scala nakładające się i stykające odcinki', () => {
    expect(
      mergeSpans([
        [5, 7],
        [1, 3],
        [3, 4],
        [8, 9],
        [6, 8],
      ])
    ).toEqual([
      [1, 4],
      [5, 9],
    ]);
  });
});
