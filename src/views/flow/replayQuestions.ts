import { readBookLevel, type BookFrame } from '../../charts/pro/core/book';
import type { Coverage, Span } from '../../charts/pro/core/coverage';

const WINDOW_MS = 30_000;
const MAX_BOOK_AGE_MS = 5_000;
type Question = { kind: 'delta' } | { kind: 'delta-and-book'; side: 'bid' | 'ask'; price: number };
type Skip = 'unread' | 'tape-gap' | 'book-snapshot' | 'book-stale' | 'book-level' | 'book-gap';
type TimeWindow = { from: number; to: number };
type WindowResult = {
  first: TimeWindow | null;
  qualified: number;
  skipped: { from: number; to: number; reasons: Skip[] }[];
};

function lastAt(frames: readonly BookFrame[], t: number): BookFrame | undefined {
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (frames[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  return frames[lo - 1];
}

export function findReplayWindows(input: TimeWindow & {
  question: Question;
  tape: Coverage;
  book: Coverage;
  frames: readonly BookFrame[];
  /** Scope that could not be read for each channel. A tape-only question ignores unread L2. */
  unread?: { tape?: readonly Span[]; book?: readonly Span[] };
}): WindowResult {
  const { question, tape, book, frames, unread } = input;
  const result: WindowResult = { first: null, qualified: 0, skipped: [] };
  if (!Number.isSafeInteger(input.from) || !Number.isSafeInteger(input.to) || input.from < 0
    || input.to - input.from > 86_400_000) return result;
  const exact = question.kind === 'delta-and-book'
    ? frames.filter(frame => frame.exact === true).sort((a, b) => a.t - b.t) : [];
  const intersects = (spans: readonly Span[] | undefined, start: number, end: number) =>
    spans?.some(([from, to]) => from < end && start < to) ?? false;

  for (let from = Math.ceil(input.from / 1000) * 1000; from + WINDOW_MS <= input.to; from += 1000) {
    const to = from + WINDOW_MS;
    const reasons: Skip[] = [];
    if (intersects(unread?.tape, from, to)) reasons.push('unread');
    else if (!tape.covers(from, to)) reasons.push('tape-gap');

    if (question.kind === 'delta-and-book') {
      const a = lastAt(exact, from);
      const b = lastAt(exact, to - 1);
      if (intersects(unread?.book, a?.t ?? from, to)) {
        if (!reasons.includes('unread')) reasons.push('unread');
      } else if (!a || !b) {
        reasons.push('book-snapshot');
      } else {
        if (from - a.t > MAX_BOOK_AGE_MS || to - 1 - b.t > MAX_BOOK_AGE_MS) reasons.push('book-stale');
        if (readBookLevel(a, question.side, question.price).kind === 'missing'
          || readBookLevel(b, question.side, question.price).kind === 'missing') reasons.push('book-level');
        if (!book.covers(a.t, to)) reasons.push('book-gap');
      }
    }

    if (reasons.length === 0) {
      result.first ??= { from, to };
      result.qualified++;
      continue;
    }
    const previous = result.skipped.at(-1);
    if (previous?.to === from && reasons.join(',') === previous.reasons.join(',')) previous.to += 1000;
    else result.skipped.push({ from, to: from + 1000, reasons });
  }
  return result;
}

export function boundMissingDelta(input: { buy: bigint; sell: bigint; volume: bigint; certified: boolean; final: boolean }) {
  const { buy, sell, volume, certified, final } = input;
  if (!certified || !final || buy < 0n || sell < 0n || volume < buy + sell) return { kind: 'unavailable' } as const;
  const missing = volume - buy - sell;
  const lower = buy - sell - missing;
  const upper = buy - sell + missing;
  return { kind: 'bounded', lower, upper, missing, sign: lower > 0n ? 'positive' : upper < 0n ? 'negative'
    : lower === 0n && upper === 0n ? 'balanced' : 'undetermined' } as const;
}
