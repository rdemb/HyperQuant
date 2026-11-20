import type { BookFrame, BookHistory } from '../../charts/pro/core/book';
import type { Coverage } from '../../charts/pro/core/coverage';
import type { Tape } from '../../charts/pro/core/tape';
import { LENS_MS, bookAtMoment, tradeNotionalMicros } from './momentLensModel';

export const TRACE_SLICE_MS = 5_000;
export const TRACE_SLICES = 4;
export const RECENT_MS = 2_000;
export const MEMORY_SIZE = 4;

/** Migawki w tym samym pokrytym odcinku L2, rosnąco do kursora. */
export function bookMemory(history: BookHistory | null, coverage: Coverage, cursor: number) {
  const frames: (BookFrame | null)[] = Array.from({ length: MEMORY_SIZE }, () => null);
  const latest = bookAtMoment(history, coverage, cursor);
  if (!history || !latest) return frames;
  const list = history.list();
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (list[mid].t <= latest.t) lo = mid + 1;
    else hi = mid;
  }
  for (let i = 0; i < MEMORY_SIZE && i < lo; i++) {
    const frame = list[lo - 1 - i];
    if (!coverage.covers(frame.t, cursor + 1)) break;
    frames[MEMORY_SIZE - 1 - i] = frame;
  }
  return frames;
}

/** Zero wewnątrz zakresu obserwacji i brak pomiaru poza nim. */
export function bookQuote(frame: BookFrame | null, px: number) {
  if (!frame || frame.nBids === 0 || frame.nBids === frame.px.length) return null;
  if (px < frame.px[frame.nBids - 1] || px > frame.px[frame.px.length - 1]) return null;
  let bid = 0;
  let ask = 0;
  let bidOrders: number | null = 0;
  let askOrders: number | null = 0;
  frame.px.forEach((price, index) => {
    if (price !== px) return;
    const orders = Number.isFinite(frame.n[index]) ? frame.n[index] : null;
    if (index < frame.nBids) {
      bid = price * frame.sz[index];
      bidOrders = orders;
    } else {
      ask = price * frame.sz[index];
      askOrders = orders;
    }
  });
  return { bid, ask, bidOrders, askOrders };
}

type TradeLevel = {
  volume: bigint;
  slices: bigint[];
  sliceCounts: number[];
  recent: bigint;
  missingVolume: boolean;
  missingSlices: Set<number>;
  missingRecent: boolean;
};

export function readDomTrades(tape: Tape, coverage: Coverage, cursor: number, decimals: number) {
  const to = cursor + 1;
  const traceFrom = to - TRACE_SLICES * TRACE_SLICE_MS;
  const recentFrom = to - RECENT_MS;
  const rows = new Map<number, TradeLevel>();
  const dots = new Map<number, { time: number; px: number; side: 1 | -1 }>();
  const spans = coverage.list()
    .map(([a, b]) => [Math.max(a, traceFrom), Math.min(b, to)] as const)
    .filter(([a, b]) => a < b);
  let spanIndex = 0;
  const slices = Array.from({ length: TRACE_SLICES }, (_, index) => {
    const start = traceFrom + index * TRACE_SLICE_MS;
    return coverage.covers(start, start + TRACE_SLICE_MS);
  });
  const volume = coverage.covers(to - LENS_MS, to);
  let buy = 0n;
  let sell = 0n;
  let exactVolume = volume;
  const recent = coverage.covers(recentFrom, to);
  tape.forEach(volume ? to - LENS_MS : traceFrom, to, (time, px, size, side) => {
    if (time >= traceFrom) {
      while (spanIndex < spans.length && spans[spanIndex][1] <= time) spanIndex++;
      if (spanIndex < spans.length && spans[spanIndex][0] <= time) {
        dots.set(Math.floor((time - traceFrom) / 500), { time, px, side });
      }
    }
    const slice = Math.floor((time - traceFrom) / TRACE_SLICE_MS);
    if (!volume && !slices[slice] && !(recent && time >= recentFrom)) return;
    const row = rows.get(px) ?? {
      volume: 0n, slices: Array<bigint>(TRACE_SLICES).fill(0n), sliceCounts: Array<number>(TRACE_SLICES).fill(0), recent: 0n,
      missingVolume: false, missingSlices: new Set<number>(), missingRecent: false,
    };
    if (slice >= 0) row.sliceCounts[slice]++;
    const usd = tradeNotionalMicros(px, size, decimals);
    if (usd === null) {
      row.missingVolume = true;
      exactVolume = false;
      if (slice >= 0) row.missingSlices.add(slice);
      if (time >= recentFrom) row.missingRecent = true;
    } else {
      const delta = side === 1 ? usd : -usd;
      row.volume += usd;
      if (side === 1) buy += usd;
      else sell += usd;
      if (slice >= 0) row.slices[slice] += delta;
      if (time >= recentFrom) row.recent += delta;
    }
    rows.set(px, row);
  });
  return { rows, traceFrom, to, spans, dots: [...dots.values()], coverage: { volume, slices, recent },
    totals: exactVolume ? { buy: Number(buy), sell: Number(sell) } : null };
}
