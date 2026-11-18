import type { BookFrame } from './book';
import type { Coverage } from './coverage';
import { btcNotionalMicros, type ProfileSpan } from './smcRangeProfile';
import { minuteOf, type Tape } from './tape';

export interface PriceBucket { low: number; high: number }
export interface ProfileVisit { deltaMicros: bigint; partial: boolean }
export interface VisitSummary extends ProfileVisit { count: number }

export function summarizeVisits(visits: readonly ProfileVisit[]): VisitSummary | null {
  if (visits.length === 0) return null;
  return {
    count: visits.length,
    deltaMicros: visits.reduce((sum, visit) => sum + visit.deltaMicros, 0n),
    partial: visits.some(visit => visit.partial),
  };
}

export function priceBuckets(step: number, merged: readonly PriceBucket[]) {
  const key = `${step}/${merged.map(b => `${b.low}:${b.high}`).join(',')}`;
  const lowOf = (price: number): number => merged.find(b => price >= b.low && price < b.high)?.low ?? Math.floor(price / step) * step;
  const bucketAt = (low: number): PriceBucket => merged.find(b => b.low === low) ?? { low, high: low + step };
  return { key, lowOf, bucketAt };
}

type Buckets = ReturnType<typeof priceBuckets>;
type VisitState = {
  byPrice: Map<number, ProfileVisit[]>;
  last: { low: number; time: number } | null;
};

function cloneVisits(state: VisitState): VisitState {
  return { last: state.last, byPrice: new Map([...state.byPrice].map(([key, values]) => [key, values.map(v => ({ ...v }))])) };
}

export class RangeVisits {
  private base: { key: string; end: number; signature: string; state: VisitState } | null = null;

  constructor(private readonly tape: Tape, private readonly coverage: Coverage) {}

  read({ from, to }: ProfileSpan, bins: Buckets) {
    const end = Math.max(from, minuteOf(Math.min(to, this.tape.lastTime + 1)));
    const key = `${bins.key}/${from}`;
    const signature = (until: number) => `${this.tape.signature(from, until)}/${this.coverage.list()
      .filter(([a, b]) => a < until && b > from).map(([a, b]) => `${Math.max(a, from)}:${Math.min(b, until)}`).join(',')}`;
    const base = this.base;
    const canExtend = base?.key === key && base.end <= end && base.signature === signature(base.end);
    if (!canExtend || base.end < end) {
      const state = canExtend ? base.state : { byPrice: new Map(), last: null };
      this.append(state, canExtend ? base.end : from, end, bins);
      this.base = { key, end, signature: signature(end), state };
    }
    const state = cloneVisits(this.base?.state ?? { byPrice: new Map(), last: null });
    this.append(state, end, to, bins);
    const last = state.last;
    if (last && !this.coverage.covers(last.time, to)) {
      const visit = state.byPrice.get(last.low)?.at(-1);
      if (visit) visit.partial = true;
    }
    return { byPrice: state.byPrice, lastBucket: last ? bins.bucketAt(last.low) : null };
  }

  private append(state: VisitState, from: number, to: number, bins: Buckets): void {
    const spans = this.coverage.list();
    let cursor = 0;
    const segment = (t: number): number => {
      while (cursor < spans.length && spans[cursor][1] <= t) cursor++;
      return cursor * 2 + (cursor < spans.length && spans[cursor][0] <= t ? 1 : 0);
    };
    let previousSegment = state.last ? segment(state.last.time) : -1;
    this.tape.forEach(from, to, (t, px, size, side) => {
      const usd = px * size;
      if (!(usd > 0) || !Number.isFinite(usd)) return;
      const micros = btcNotionalMicros(px, size);
      const deltaMicros = side === 1 ? micros : -micros;
      const low = bins.lowOf(px);
      const currentSegment = segment(t);
      const sameSegment = currentSegment === previousSegment;
      const last = state.last;
      if (last && !sameSegment) {
        const previousVisit = state.byPrice.get(last.low)?.at(-1);
        if (previousVisit) previousVisit.partial = true;
      }
      let visits = state.byPrice.get(low);
      if (!visits) state.byPrice.set(low, visits = []);
      const visit = visits.at(-1);
      if (last?.low === low && sameSegment && visit) {
        visit.deltaMicros += deltaMicros;
      } else {
        visits.push({ deltaMicros, partial: !sameSegment || currentSegment % 2 === 0 });
        if (visits.length > 3) visits.shift();
      }
      state.last = { low, time: t };
      previousSegment = currentSegment;
    });
  }
}

export interface SideReaction {
  mean: number | null;
  totalUsd: number;
  matchedUsd: number;
  pendingUsd: number;
  missingUsd: number;
}

export interface PriceReaction { buy: SideReaction; sell: SideReaction; nextDeadline: number | null }

const HORIZON = 30_000;
const DEADLINE = 35_000;

function exactMid(frame: BookFrame): number | null {
  const ask = frame.px[frame.nBids];
  const bid = frame.px[0];
  return frame.exact && frame.nBids > 0 && bid > 0 && ask > bid && Number.isFinite(ask) &&
    frame.sz[0] > 0 && frame.sz[frame.nBids] > 0 ? bid + (ask - bid) / 2 : null;
}

export function priceReaction(tape: Tape, span: ProfileSpan, bucket: PriceBucket, frames: readonly BookFrame[], coverage: Coverage): PriceReaction {
  type Totals = Omit<SideReaction, 'mean'> & { weighted: number };
  const totals = (): Totals => ({ totalUsd: 0, matchedUsd: 0, pendingUsd: 0, missingUsd: 0, weighted: 0 });
  const buy = totals(), sell = totals();
  let cursor = 0;
  let mid: number | null = null;
  let nextDeadline: number | null = null;
  tape.forEach(span.from, span.to, (t, px, size, side) => {
    if (px < bucket.low || px >= bucket.high) return;
    const usd = px * size;
    if (!(usd > 0) || !Number.isFinite(usd)) return;
    const total = side === 1 ? buy : sell;
    total.totalUsd += usd;
    while (cursor < frames.length) {
      const f = frames[cursor];
      mid = f.t >= t + HORIZON && f.t <= span.to ? exactMid(f) : null;
      if (mid !== null || f.t > span.to) break;
      cursor++;
    }
    const f = frames[cursor];
    const deadline = t + DEADLINE;
    if (f && mid !== null && f.t <= deadline && coverage.covers(t, f.t)) {
      total.matchedUsd += usd;
      total.weighted += usd * (mid - px);
    } else if (span.to < deadline) {
      total.pendingUsd += usd;
      nextDeadline ??= deadline;
    } else total.missingUsd += usd;
  });
  const result = ({ weighted, ...side }: Totals): SideReaction =>
    ({ ...side, mean: side.matchedUsd > 0 ? weighted / side.matchedUsd : null });
  return { buy: result(buy), sell: result(sell), nextDeadline };
}
