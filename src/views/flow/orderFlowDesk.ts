import type { BookFrame, BookHistory } from '../../charts/pro/core/book';
import type { Coverage } from '../../charts/pro/core/coverage';
import type { Tape } from '../../charts/pro/core/tape';
import { DESK_MARKETS } from '../../config/deskMarkets';
import { visibleExecutions } from './hip3Flow';

const SUPPORTED_MARKETS = new Set(['btc', 'gold', 'sp500']);
export const ORDER_FLOW_MARKETS = DESK_MARKETS.filter(market => market.enabled && SUPPORTED_MARKETS.has(market.slug));
export const FLOW_WINDOW_MS = 30_000;
export const MAX_BOOK_AGE_MS = 5_000;
export const BOOK_HIDE_AFTER_MS = 30_000;
export const PIN_MIN_MS = 10_000;
export const PIN_MAX_MS = 15_000;
export const PIN_TAPE_LIMIT = 20;
const BOOK_REFERENCE_TOLERANCE_MS = 7_000;

export type BookSide = 'bid' | 'ask';

export function deskMarketFromHash(hash: string): string {
  const [view, query] = hash.split('?', 2);
  const requested = view === '#orderflow' ? new URLSearchParams(query).get('m') : null;
  return ORDER_FLOW_MARKETS.find(market => market.coin === requested)?.coin ?? 'BTC';
}

/** Poza widocznym zakresem nie wiadomo, czy stoi tam płynność. */
export function depthAtPrice(frame: BookFrame | null, price: number): number | null {
  if (!frame || !Number.isFinite(price) || frame.nBids === 0 || frame.nBids === frame.px.length) return null;
  if (price < frame.px[frame.nBids - 1] || price > frame.px[frame.px.length - 1]) return null;
  let total = 0;
  for (let i = 0; i < frame.px.length; i++) {
    if (frame.px[i] === price) total += frame.sz[i] * price;
  }
  return total;
}

export function depthChangeAtPrice(
  current: BookFrame | null,
  previous: BookFrame | null,
  price: number,
  coverage: Coverage,
  side?: BookSide,
): number | null {
  if (!current || !previous || current.t <= previous.t || !coverage.covers(previous.t, current.t)) return null;
  const before = side ? depthOnSide(previous, price, side) : depthAtPrice(previous, price);
  const after = side ? depthOnSide(current, price, side) : depthAtPrice(current, price);
  return before !== null && after !== null ? after - before : null;
}

/** Najbliższa spójna migawka w tolerancji kadencji. Pierwszeństwo ma starsza przy remisie. */
export function referenceBook(history: BookHistory, end: number, period: number, coverage: Coverage): BookFrame | null {
  const target = end - period;
  const tolerance = BOOK_REFERENCE_TOLERANCE_MS;
  let closest: BookFrame | null = null;
  let bestDistance = tolerance + 1;
  for (const frame of history.range(target - tolerance, Math.min(end, target + tolerance + 1))) {
    const distance = Math.abs(frame.t - target);
    if (frame.t < end && distance <= tolerance && distance < bestDistance && coverage.covers(frame.t, end)) {
      closest = frame;
      bestDistance = distance;
    }
  }
  return closest;
}

export function tradeActivity(tape: Tape, coverage: Coverage, from: number, to: number) {
  if (!(to > from) || !coverage.covers(from, to)) return null;
  let buyUsd = 0;
  let sellUsd = 0;
  let buySize = 0;
  let sellSize = 0;
  let count = 0;
  const atPrice = new Map<number, { buyUsd: number; sellUsd: number; buySize: number; sellSize: number }>();
  tape.forEach(from, to, (_time, price, size, side) => {
    const usd = price * size;
    const totals = atPrice.get(price) ?? { buyUsd: 0, sellUsd: 0, buySize: 0, sellSize: 0 };
    if (side === 1) {
      buyUsd += usd;
      buySize += size;
      totals.buyUsd += usd;
      totals.buySize += size;
    } else {
      sellUsd += usd;
      sellSize += size;
      totals.sellUsd += usd;
      totals.sellSize += size;
    }
    atPrice.set(price, totals);
    count++;
  });
  return { buyUsd, sellUsd, buySize, sellSize, count, atPrice };
}

function depthOnSide(frame: BookFrame, price: number, side: BookSide): number | null {
  const bid = side === 'bid';
  const from = bid ? 0 : frame.nBids;
  const to = bid ? frame.nBids : frame.px.length;
  if (from === to || (bid ? price < frame.px[to - 1] : price > frame.px[to - 1])) return null;
  for (let i = from; i < to; i++) {
    if (frame.px[i] === price) return price * frame.sz[i];
  }
  return 0;
}

interface LevelCapture {
  price: number;
  side: BookSide;
  current: BookFrame | null;
  previous: BookFrame | null;
  bookCoverage: Coverage;
  tape: Tape;
  tapeCoverage: Coverage;
}

/** Przypięty odczyt jest niezmienny. Kwota z taśmy dotyczy tylko strony agresora i przedziału (od, do]. */
export function captureLevel({ price, side, current, previous, bookCoverage, tape, tapeCoverage }: LevelCapture) {
  const elapsed = current && previous ? current.t - previous.t : 0;
  const anchor = current && previous && elapsed >= PIN_MIN_MS && elapsed <= PIN_MAX_MS && bookCoverage.covers(previous.t, current.t)
    ? previous : null;
  const through = current?.t ?? null;
  const after = current ? depthOnSide(current, price, side) : null;
  const before = anchor ? depthOnSide(anchor, price, side) : null;
  const from = anchor?.t ?? null;
  let executions: { count: number; usd: number; rows: ReturnType<typeof visibleExecutions> } | null = null;
  if (from !== null && through !== null && tapeCoverage.covers(from + 1, through + 1)) {
    const aggressor = side === 'ask' ? 1 : -1;
    let count = 0;
    let usd = 0;
    tape.forEach(from + 1, through + 1, (_time, px, size, direction) => {
      if (px !== price || direction !== aggressor) return;
      count++;
      usd += px * size;
    });
    executions = { count, usd, rows: visibleExecutions(tape, through, 0, PIN_TAPE_LIMIT, from + 1, aggressor, price) };
  }
  return { price, side, from, through, before, after, executions };
}

export type PinnedLevel = ReturnType<typeof captureLevel>;
