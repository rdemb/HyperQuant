import type { Coverage } from '../../charts/pro/core/coverage';
import { MINUTE, minuteOf, type MinuteChunk, type Tape, type TradeRow } from '../../charts/pro/core/tape';
import { FLOW_WINDOW_MS } from './orderFlowDesk';

type Window = { from: number; to: number };
type Moment = { t: number; count: number; buy: bigint; sell: bigint; net: bigint };
type Selected = { delta: bigint; remaining: bigint; moment: Moment; ties: number; rows: TradeRow[] };
export type DeltaMoment = Window & (
  | { kind: 'gap'; coveredMs: number }
  | { kind: 'quiet' | 'changed' | 'precision' }
  | { kind: 'neutral'; count: number; moments: number; delta: 0n }
  | ({ kind: 'single' } & Selected)
  | ({ kind: 'comparison'; verdict: 'reversed' | 'zero' | 'retained' } & Selected)
);

function lowerBound(times: readonly number[], t: number): number {
  let lo = 0, hi = times.length;
  while (lo < hi) {
    const middle = Math.floor((lo + hi) / 2);
    if (times[middle] < t) lo = middle + 1;
    else hi = middle;
  }
  return lo;
}

type Span = { chunk: MinuteChunk | undefined; lo: number; hi: number };

function spans(tape: Tape, from: number, to: number): Span[] {
  const parts: Span[] = [];
  for (let minute = minuteOf(from); minute < to; minute += MINUTE) {
    const chunk = tape.chunk(minute);
    const times = chunk?.t ?? [];
    parts.push({ chunk, lo: lowerBound(times, from), hi: lowerBound(times, to) });
  }
  return parts;
}

function atoms(value: number, scale: number): number | null {
  const n = Math.round(value * scale);
  return Number.isSafeInteger(n) && n > 0 && n / scale === value ? n : null;
}

function newMoment(t: number): Moment {
  return { t, count: 0, buy: 0n, sell: 0n, net: 0n };
}

const yieldToPage = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Zamraża zakończone [to − 30 s, to). Jednostką rachunku dla kontraktów Hyperliquid jest 0,000001 USD. */
export async function readDeltaMoment(
  tape: Tape, coverage: Coverage, to: number, sizeDecimals: number | undefined, abort: AbortSignal,
): Promise<DeltaMoment | null> {
  const from = to - FLOW_WINDOW_MS;
  const window = { from, to };
  if (abort.aborted) return null;
  const coveredMs = coverage.coveredMs(from, to);
  if (coveredMs < FLOW_WINDOW_MS) return { ...window, kind: 'gap', coveredMs };
  if (sizeDecimals === undefined || !Number.isInteger(sizeDecimals) || sizeDecimals < 0 || sizeDecimals > 6) {
    return { ...window, kind: 'precision' };
  }
  const priceScale = 10 ** (6 - sizeDecimals);
  const sizeScale = 10 ** sizeDecimals;
  const original = spans(tape, from, to);
  // Nowe transakcje od granicy „to” nie zmieniają uchwyconych wierszy. Wstawienie do okna zmienia granice indeksów.
  const sameRows = () => spans(tape, from, to).every(({ chunk, lo, hi }, i) =>
    hi === lo && original[i].hi === original[i].lo
      || chunk === original[i].chunk && lo === original[i].lo && hi === original[i].hi)
    && coverage.covers(from, to);
  let current: Moment | undefined;
  let high: Moment | undefined, low: Moment | undefined;
  let highTies = 0, lowTies = 0, moments = 0, count = 0;
  let delta = 0n;
  function finish(moment: Moment) {
    moment.net = moment.buy - moment.sell;
    delta += moment.net;
    moments++;
    if (!high || moment.net > high.net) { high = moment; highTies = 1; }
    else if (moment.net === high.net) highTies++;
    if (!low || moment.net < low.net) { low = moment; lowTies = 1; }
    else if (moment.net === low.net) lowTies++;
  }

  let sliceStart = performance.now();
  for (const { chunk, lo, hi } of original) {
    if (!chunk) continue;
    for (let i = lo; i < hi; i++) {
      if ((i - lo) % 512 === 0 && performance.now() - sliceStart >= 6) {
        await yieldToPage();
        if (abort.aborted) return null;
        if (!sameRows()) return { ...window, kind: 'changed' };
        sliceStart = performance.now();
      }
      const t = chunk.t[i];
      if (current?.t !== t) {
        if (current) finish(current);
        current = newMoment(t);
      }
      const price = atoms(chunk.px[i], priceScale);
      const size = atoms(chunk.sz[i], sizeScale);
      if (price === null || size === null) return { ...window, kind: 'precision' };
      const usd = BigInt(price) * BigInt(size);
      if (chunk.side[i] === 1) current.buy += usd;
      else current.sell += usd;
      current.count++;
      count++;
    }
  }
  if (!current) return { ...window, kind: 'quiet' };
  finish(current);
  if (delta === 0n && moments > 1) return { ...window, kind: 'neutral', count, moments, delta };
  const moment = (delta < 0n ? low : high) ?? current;
  const ties = delta < 0n ? lowTies : highTies;
  const remaining = delta - moment.net;
  const rows: TradeRow[] = [];
  const chunk = tape.chunk(minuteOf(moment.t));
  if (chunk) {
    const start = lowerBound(chunk.t, moment.t);
    for (let i = start; i < start + moment.count; i++) {
      if ((i - start) % 512 === 0 && performance.now() - sliceStart >= 6) {
        await yieldToPage();
        if (abort.aborted) return null;
        if (!sameRows()) return { ...window, kind: 'changed' };
        sliceStart = performance.now();
      }
      rows.push({ t: chunk.t[i], px: chunk.px[i], sz: chunk.sz[i], side: chunk.side[i], tid: chunk.tid[i] });
    }
  }
  const result = { ...window, delta, remaining, moment, ties, rows };
  if (moments === 1) return { ...result, kind: 'single' };
  const verdict = remaining === 0n ? 'zero' : (remaining > 0n) === (delta > 0n) ? 'retained' : 'reversed';
  return { ...result, kind: 'comparison', verdict };
}
