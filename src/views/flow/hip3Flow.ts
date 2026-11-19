import type { BookFrame } from '../../charts/pro/core/book';
import type { Coverage } from '../../charts/pro/core/coverage';
import type { Tape, TradeRow } from '../../charts/pro/core/tape';
import type { Side } from '../../charts/pro/hl/parse';

export { isHip3DeskMarket as isHip3DeskFlow } from '../../config/deskMarkets';

export function hip3TapeFilters(coin: string): readonly number[] {
  return coin === 'xyz:GOLD' ? [0, 100, 500, 2_000, 10_000] : [0, 500, 2_000, 10_000, 50_000];
}

/** Odczyt wstecz z istniejącej taśmy, bez kopiowania pełnej historii. */
export function visibleExecutions(tape: Tape, through: number, minUsd: number, limit: number, from = -Infinity, side?: Side, price?: number): Array<TradeRow & { usd: number }> {
  const out: Array<TradeRow & { usd: number }> = [];
  for (const minute of tape.minutes().reverse()) {
    if (minute > through) continue;
    const c = tape.chunk(minute);
    if (!c) continue;
    for (let i = c.t.length - 1; i >= 0; i--) {
      if (out.length >= limit) return out;
      if (c.t[i] < from) return out;
      const usd = c.px[i] * c.sz[i];
      if (c.t[i] > through || usd < minUsd || (side !== undefined && c.side[i] !== side) || (price !== undefined && c.px[i] !== price)) continue;
      out.push({ t: c.t[i], px: c.px[i], sz: c.sz[i], side: c.side[i], tid: c.tid[i], usd });
    }
  }
  return out;
}

export function bookMetrics(frame: BookFrame) {
  const side = (start: number, end: number) => {
    let totalUsd = 0;
    let totalSize = 0;
    return Array.from({ length: end - start }, (_, i) => {
      const at = start + i;
      const px = frame.px[at], size = frame.sz[at], usd = px * size;
      totalSize += size;
      totalUsd += usd;
      return { px, size, usd, totalSize, totalUsd, orders: frame.n[at] };
    });
  };
  const bids = side(0, frame.nBids);
  const asks = side(frame.nBids, frame.px.length);
  const bid = bids[0]?.px, ask = asks[0]?.px;
  const spread = bid !== undefined && ask !== undefined && ask >= bid ? ask - bid : null;
  const spreadBp = spread !== null && bid !== undefined && ask !== undefined ? 10_000 * spread / ((ask + bid) / 2) : null;
  return { bids, asks, spread, spreadBp };
}

export function executionWindow(tape: Tape, coverage: Coverage, from: number, to: number) {
  if (!coverage.covers(from, to)) return null;
  let count = 0, size = 0, buyUsd = 0, sellUsd = 0;
  const levels = new Map<number, { px: number; buyUsd: number; sellUsd: number }>();
  tape.forEach(from, to, (_t, px, sz, side) => {
    const usd = px * sz;
    const level = levels.get(px) ?? { px, buyUsd: 0, sellUsd: 0 };
    if (side === 1) {
      buyUsd += usd;
      level.buyUsd += usd;
    } else {
      sellUsd += usd;
      level.sellUsd += usd;
    }
    levels.set(px, level);
    size += sz;
    count++;
  });
  const turnoverUsd = buyUsd + sellUsd;
  const profile = [...levels.values()]
    .sort((a, b) => (b.buyUsd + b.sellUsd) - (a.buyUsd + a.sellUsd) || b.px - a.px)
    .slice(0, 6);
  return { count, turnoverUsd, deltaUsd: buyUsd - sellUsd, buyUsd, sellUsd, vwap: size > 0 ? turnoverUsd / size : null, profile };
}

/** Widoczna płynność pierwszych pięciu poziomów po każdej stronie w USD. */
export function topBookDepth(book: ReturnType<typeof bookMetrics> | null) {
  const bid = book?.bids[4]?.totalUsd;
  const ask = book?.asks[4]?.totalUsd;
  if (bid === undefined || ask === undefined || bid + ask <= 0) return null;
  return { total: bid + ask, imbalancePct: 100 * (bid - ask) / (bid + ask) };
}
