import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HIST_PART_MS, HIST_TAIL_MS, decodeBook, decodeTrades, isTailFile } from '../../../src/utils/tapeHistory.ts';
import { MarketRecorder, SETTLE_MS } from '../history.ts';
import type { HlTrade } from '../hl.ts';

const T0 = Date.UTC(2026, 10, 27, 22, 0, 0);
const MIN = 60_000;
const A = (k: number) => `0x${String(k).padStart(40, '0')}`;
const HASH = (k: number) => `0x${String(k).padStart(64, '1')}`;
const trade = (t: number, tid: number, taker: number, maker: number): HlTrade => ({
  coin: 'BTC',
  side: 'B',
  px: '60000',
  sz: '0.1',
  time: t,
  tid,
  hash: HASH(tid),
  users: [A(taker), A(maker)],
});
const levels = (px: number) => [[{ px: String(px - 10), sz: '1', n: 2 }], [{ px: String(px + 10), sz: '2', n: 3 }]];

/** Rejestrator nagrywający od T0 (migawka z transakcją w T0), z ceną do doboru agregacji arkusza. */
function recording(): MarketRecorder {
  const r = new MarketRecorder('BTC', mkdtempSync(join(tmpdir(), 'hq-tail-')));
  r.onCtx({ markPx: 60_000, oiBtc: 30_000, dayNtlVlm: 1e9, funding: 1e-5 }, T0);
  r.onState(true, T0);
  r.onTrades([trade(T0, 1, 1, 9)]);
  return r;
}

describe('MarketRecorder.tail — gorący ogon nagrania dla stron otwieranych przed publikacją części', () => {
  it('ogon obejmuje część otwartą i części już zapisane (CDN pokaże je dopiero po minutach), w tym samym formacie co pliki', () => {
    const r = recording();
    r.onTrades([trade(T0 + 2 * MIN, 2, 2, 9)]);
    r.onTrades([trade(T0 + 7 * MIN, 3, 1, 8)]);
    r.onBook(T0 + 7 * MIN, levels(60_000));
    const now = T0 + 8 * MIN;
    expect(r.flush(now)).toBe(2); // część 22:00 zapisana na dysku — w ogonie zostaje
    const tail = r.tail(now)!;
    expect(isTailFile(tail)).toBe(true);
    expect(tail.asOf).toBe(now);
    expect(tail.parts.map((p) => p.start)).toEqual([T0, T0 + HIST_PART_MS]);
    const [first, second] = tail.parts.map((p) => ({ t: decodeTrades(p.trades)!, b: decodeBook(p.book)! }));
    expect(first.t.trades.map((x) => x.tid)).toEqual([1, 2]);
    expect(first.t.spans).toEqual([[T0, T0 + HIST_PART_MS]]);
    // Część otwarta: pokrycie do chwili ogona, numeracja kont taka sama jak w plikach doby (1 → 0, 9 → 1, 2 → 2, 8 → 3)
    expect(second.t.spans).toEqual([[T0 + HIST_PART_MS, now]]);
    expect(second.t.trades.map((x) => [x.tid, x.o, x.k, x.m])).toEqual([[3, 2, 0, 3]]);
    expect(second.b.frames.map((f) => f.t)).toEqual([T0 + 7 * MIN]);
  });

  it('okno HIST_TAIL_MS: starsze części poza ogonem, pokrycie przycięte do początku okna', () => {
    const r = recording();
    const now = T0 + HIST_TAIL_MS + 3 * MIN;
    for (let t = T0 + MIN; t < now; t += MIN) r.onTrades([trade(t, t / MIN, 1, 9)]);
    r.flush(now);
    const tail = r.tail(now)!;
    const from = now - HIST_TAIL_MS;
    expect(tail.parts[0].start).toBe(Math.floor(from / HIST_PART_MS) * HIST_PART_MS);
    expect(decodeTrades(tail.parts[0].trades)!.spans[0][0]).toBe(from);
    for (const p of tail.parts) for (const x of decodeTrades(p.trades)!.trades) expect(x.t).toBeGreaterThanOrEqual(from);
    expect(tail.parts.at(-1)!.start).toBe(Math.floor(now / HIST_PART_MS) * HIST_PART_MS);
  });

  it('przerwa połączenia zostaje luką; bez nagrania w oknie — brak ogona', () => {
    const r = recording();
    r.onState(false, T0 + MIN);
    r.onState(true, T0 + 2 * MIN);
    r.onTrades([trade(T0 + 3 * MIN, 2, 1, 9)]);
    const spans = decodeTrades(r.tail(T0 + 4 * MIN)!.parts[0].trades)!.spans;
    expect(spans).toEqual([[T0, T0 + MIN], [T0 + 3 * MIN, T0 + 4 * MIN]]);
    const idle = new MarketRecorder('BTC', mkdtempSync(join(tmpdir(), 'hq-tail-')));
    expect(idle.tail(T0)).toBeNull();
  });

  it('pamięć ogona sprzątana przy zapisie części, także gdy nikt nie pyta o ogon', () => {
    const r = recording();
    const late = T0 + 3 * HIST_TAIL_MS;
    r.onTrades([trade(late, 2, 1, 9)]);
    r.flush(late + SETTLE_MS);
    expect(r.tailSize()).toEqual({ trades: 1, frames: 0 });
  });
});
