import type { BookFrame } from '../core/book';
import type { VerifiedReplay } from './archive';

export function latestExactArchiveBookAt(replay: VerifiedReplay, cursorMs: number): BookFrame | null {
  if (replay.book.kind !== 'verified') return null;
  let latest: BookFrame | null = null;
  for (const frame of replay.data.frames) {
    if (frame.exact === true && frame.t <= cursorMs && (latest === null || frame.t > latest.t)) {
      latest = frame;
    }
  }
  return latest;
}
