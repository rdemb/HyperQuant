import { readBookLevel } from '../core/book';
import type { Fill } from '../hl/parse';
import type { ArchiveChannel, VerifiedReplay } from './archive';
import { isReplayMs } from './availability';
import { HOME_MARKET } from '../../../utils/marketCaps';

export type ArchiveObservationAnchor = {
  version: 1;
  source: 'hyperliquid/BTC-perp';
  revision: string;
  sha256: { trades: string; book?: string };
  cursorMs: number;
  trade: { eventAtMs: number; tid: string; price: number; size: number; side: 1 | -1 };
  book?: { side: 'bid' | 'ask'; beforeMs: number; afterMs: number };
};

type Reason = 'invalid-anchor' | 'wrong-source' | 'wrong-revision' | 'trade-unavailable'
  | 'trade-missing' | 'trade-conflict' | 'after-cursor' | 'tape-gap' | 'book-gap'
  | 'book-unavailable' | 'book-missing';
type Result = { kind: 'unavailable'; reason: Reason } | {
  kind: 'resolved';
  trade: Pick<Fill, 'time' | 'tid' | 'px' | 'sz' | 'side'>;
  book: null | { before: { t: number; size: number }; after: { t: number; size: number }; side: 'bid' | 'ask' };
  continuity: 'unverified';
};

const unavailable = (reason: Reason): Result => ({ kind: 'unavailable', reason });
const declared = (channel: ArchiveChannel, from: number, to: number) =>
  channel.kind === 'verified' && channel.declaredSpans.some(([a, b]) => a <= from && b >= to);

/** Restores a pinned v1 observation in exchange-time retrospection. Cursor is inclusive. */
export function resolveArchiveObservation(replay: VerifiedReplay, anchor: ArchiveObservationAnchor): Result {
  if (anchor.version !== 1 || !isReplayMs(anchor.cursorMs) || !isReplayMs(anchor.trade.eventAtMs)) {
    return unavailable('invalid-anchor');
  }
  if (anchor.source !== 'hyperliquid/BTC-perp' || replay.manifest.coin !== HOME_MARKET) return unavailable('wrong-source');
  if (replay.revision !== anchor.revision || replay.manifest.files.trades.sha256 !== anchor.sha256.trades
    || (anchor.book && replay.manifest.files.book.sha256 !== anchor.sha256.book)) return unavailable('wrong-revision');
  const { book, cursorMs, trade: saved } = anchor;
  if (saved.eventAtMs > cursorMs || (book && book.afterMs > cursorMs)) return unavailable('after-cursor');
  if (replay.trades.kind !== 'verified') return unavailable('trade-unavailable');
  const match = replay.data.fills.find(fill => fill.time === saved.eventAtMs && String(fill.tid) === saved.tid);
  if (!match) return unavailable('trade-missing');
  const { time, tid, px, sz, side } = match;
  if (px !== saved.price || sz !== saved.size || side !== saved.side) return unavailable('trade-conflict');
  if (!declared(replay.trades, time, time + 1)) return unavailable('tape-gap');
  const trade = { time, tid, px, sz, side };
  if (!book) return { kind: 'resolved', trade, book: null, continuity: 'unverified' };
  if (!isReplayMs(book.beforeMs) || !isReplayMs(book.afterMs) || book.beforeMs >= book.afterMs
    || (book.side !== 'bid' && book.side !== 'ask')) return unavailable('invalid-anchor');
  if (replay.book.kind !== 'verified') return unavailable('book-unavailable');
  if (!declared(replay.book, book.beforeMs, book.afterMs + 1)) return unavailable('book-gap');
  const frames = replay.data.frames.filter(frame => frame.exact === true);
  const i = frames.findIndex(frame => frame.t === book.beforeMs);
  if (i < 0 || frames[i + 1]?.t !== book.afterMs) return unavailable('book-missing');
  const before = readBookLevel(frames[i], book.side, px);
  const after = readBookLevel(frames[i + 1], book.side, px);
  if (before.kind === 'missing' || after.kind === 'missing') return unavailable('book-missing');
  return { kind: 'resolved', trade, continuity: 'unverified', book: {
    side: book.side, before: { t: book.beforeMs, size: before.size }, after: { t: book.afterMs, size: after.size },
  } };
}
