import { Coverage } from '../../charts/pro/core/coverage';
import { Tape } from '../../charts/pro/core/tape';
import { BookHistory } from '../../charts/pro/core/book';
import { toBookFrame } from '../../charts/pro/store/serverHistory';
import { referenceBook, FLOW_WINDOW_MS } from './orderFlowDesk';
import archive from './chronographArchive.json';

export type ChronographDemo = 'flip' | 'level';
export const LEVEL_TEST_PRICE = 61_611;
export const ARCHIVE_WINDOW_MS = 120_000;
export const demoSource = archive.source;
export const demoWindows = (kind: ChronographDemo) => archive[kind].windows;
export const nextDemoSnapshot = (kind: ChronographDemo, through: number) =>
  archive[kind].books.find(frame => frame.t >= through)?.t;

/** Wyłącznie publiczna taśma i dokładne migawki z archiwum, bez danych o uczestnikach. */
export function openChronographClip(kind: ChronographDemo, through: number, gap: boolean) {
  const clip = archive[kind];
  const gapStart = kind === 'flip' ? through - 24_000 : through - 4_000;
  const gapEnd = kind === 'flip' ? through - 13_000 : through - 2_000;
  const coverage = new Coverage(gap ? [[clip.fromMs, gapStart], [gapEnd, clip.toMs]] : [[clip.fromMs, clip.toMs]]);
  const tape = new Tape();
  clip.trades.forEach(([t, px, sz, side], tid) => {
    if (typeof t !== 'number' || typeof px !== 'number' || typeof sz !== 'number' || (side !== 'A' && side !== 'B')) return;
    if (t < through && (!gap || t < gapStart || t >= gapEnd)) tape.insert([{ t, px, sz, side: side === 'B' ? 1 : -1, tid }]);
  });
  const bookCoverage = new Coverage([[clip.fromMs, clip.toMs]]);
  const history = new BookHistory(1);
  for (const frame of clip.books) {
    if (frame.t >= through) break;
    history.add(toBookFrame({ ...frame, exact: frame.exact === true ? true : undefined }));
  }
  const book = history.latest();
  const previous = book ? referenceBook(history, book.t, FLOW_WINDOW_MS, bookCoverage) : null;
  return { tape, coverage, book, previous, bookCoverage, bookAge: book ? through - book.t : null, history };
}
