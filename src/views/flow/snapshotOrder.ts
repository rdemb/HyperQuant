import { readBookLevel, type BookFrame } from '../../charts/pro/core/book';
import type { Coverage } from '../../charts/pro/core/coverage';
import type { TradeRow } from '../../charts/pro/core/tape';
import type { BookSide } from './orderFlowDesk';

type Sample = { t: number; size: number };
export type DepthDrop = { price: number; side: BookSide; before: Sample; after: Sample };
export type MissingBook = 'snapshot' | 'level' | 'side-change' | 'book-gap' | 'no-drop';
export type DropChoices = { drops: DepthDrop[]; missing: ReadonlySet<MissingBook> };

function occupied(frame: BookFrame, side: BookSide, price: number): boolean {
  const reading = readBookLevel(frame, side, price);
  return reading.kind === 'observed' && reading.size > 0;
}

export function depthDrops(frames: readonly BookFrame[], bookCoverage: Coverage, price: number, through: number, sizeDecimals: number): DropChoices {
  const drops: DepthDrop[] = [];
  const missing = new Set<MissingBook>();
  const scale = 10 ** sizeDecimals;
  let before: BookFrame | undefined;
  for (const after of frames) {
    if (after.t >= through) break;
    if (before && before.exact === true && after.exact === true && Number.isSafeInteger(before.t)
      && Number.isSafeInteger(after.t) && before.t < after.t) {
      if (!bookCoverage.covers(before.t, after.t + 1)) {
        missing.add('book-gap');
      } else {
        for (const side of ['bid', 'ask'] as const) {
          const a = readBookLevel(before, side, price);
          const b = readBookLevel(after, side, price);
          if (a.kind === 'missing' || b.kind === 'missing') {
            const other = side === 'bid' ? 'ask' : 'bid';
            const changedSide = (a.kind === 'observed' && a.size > 0 && occupied(after, other, price))
              || (b.kind === 'observed' && b.size > 0 && occupied(before, other, price));
            missing.add(changedSide ? 'side-change' : 'level');
          } else if (Math.round(a.size * scale) - Math.round(b.size * scale) >= 1) {
            drops.push({ price, side, before: { t: before.t, size: a.size }, after: { t: after.t, size: b.size } });
          } else {
            missing.add('no-drop');
          }
        }
      }
    } else {
      missing.add('snapshot');
    }
    before = after;
  }
  if (!before) missing.add('snapshot');
  return { drops, missing };
}

export type DepthOrder =
  | { kind: 'earlier' | 'later' }
  | { kind: 'undetermined'; reason: 'between' | 'clock' | 'tape-gap' | 'different-price' };

export function compareTradeToDrop(drop: DepthDrop, trade: TradeRow, tapeCoverage: Coverage, clocks: {
  book: string | null;
  tape: string | null;
}): DepthOrder {
  if (trade.px !== drop.price) return { kind: 'undetermined', reason: 'different-price' };
  if (!clocks.book || clocks.tape !== clocks.book || !Number.isSafeInteger(trade.t)) return { kind: 'undetermined', reason: 'clock' };
  if (!tapeCoverage.covers(trade.t, trade.t + 1)) return { kind: 'undetermined', reason: 'tape-gap' };
  if (trade.t < drop.before.t) return { kind: 'earlier' };
  if (trade.t > drop.after.t) return { kind: 'later' };
  return { kind: 'undetermined', reason: 'between' };
}
