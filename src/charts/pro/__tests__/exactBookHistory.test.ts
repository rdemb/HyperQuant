import { describe, expect, it } from 'vitest';
import { HIST_PART_MS, decodeBook, encodeBook } from '../../../utils/tapeHistory';
import { HlStream } from '../hl/stream';
import { ProStore } from '../store/proStore';
import { toBookFrame } from '../store/serverHistory';

const H0 = Date.UTC(2026, 9, 31, 10, 0, 0);

describe('arkusz dokładny z nagrania serwera', () => {
  const file = encodeBook('BTC', H0, H0 + HIST_PART_MS, [[H0, H0 + HIST_PART_MS]], [
    { t: H0 + 1000, step: 10, bids: [80_000, 3, 2], asks: [80_010, 1, 1] },
    { t: H0 + 1000, step: 1, bids: [80_000, 1, 1, 79_999, 2, 1], asks: [80_001, 1, 1], exact: true },
    { t: H0 + 6000, step: 1, bids: [80_002, 1, 1], asks: [80_003, 1, 1], exact: true },
  ]);

  it('format: znacznik dokładnej migawki w obie strony; inny piąty element — migawka pominięta', () => {
    expect(decodeBook(file)!.frames.map((f) => f.exact ?? false)).toEqual([false, true, true]);
    expect(decodeBook({ ...file, frames: [[H0, 1, [80_000, 1, 1], [80_001, 1, 1], 2]] })!.frames).toEqual([]);
  });

  it('historia i powtórka: migawki dokładne do arkusza dokładnego, zagregowane do swoich kroków', () => {
    const frames = decodeBook(file)!.frames.map(toBookFrame);
    const s = new ProStore(new HlStream({ wsFactory: () => ({}) as WebSocket }));
    // Kroki arkusza z ceny BTC (bliski 10 USD > tick): osobny kanał arkusza dokładnego
    (s as unknown as { ensureBookSubs(p: number): void }).ensureBookSubs(80_000);
    s.restoreHistory({ trades: null, frames });
    expect(s.exactBook()!.list().map((f) => f.t)).toEqual([H0 + 1000, H0 + 6000]);
    expect(s.book('near')!.list().map((f) => [f.t, f.step])).toEqual([[H0 + 1000, 10]]);
    const r = new ProStore(new HlStream({ wsFactory: () => ({}) as WebSocket }));
    (r as unknown as { ensureBookSubs(p: number): void }).ensureBookSubs(80_000);
    r.feedReplay({ trades: null, frames });
    expect(r.exactBook()!.list().map((f) => f.t)).toEqual([H0 + 1000, H0 + 6000]);
    expect(r.book('near')!.list()).toHaveLength(1);
  });
});
