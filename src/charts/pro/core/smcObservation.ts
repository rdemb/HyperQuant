/** Publiczne obserwacje sesji strony. Bez pól uczestników i bez historii odtworzonej z OHLC. */
import { addFlow, emptyFlow, MinuteBins, printFlow } from './smcObservationBins';
import type { FlowTotal, PriceRange } from './smcObservationBins';
export interface PublicPrint { time: number; tid: number; px: number; sz: number; side: 1 | -1 }
export interface ObservedPrint extends PublicPrint { seq: number; observedAt: number; receivedAt: number; late: boolean }
export interface PublicDepth { time: number; bids: readonly { px: number; sz: number }[]; asks: readonly { px: number; sz: number }[] }
export interface ObservedDepth extends PublicDepth { observedAt: number; step: number }
export interface ObservationGap { id: number; from: number; observedAt: number; reason: string }
interface Span { from: number; observedAt: number; end: number | null; endObservedAt: number | null }

class Ring<T> {
  private rows: T[] = [];
  private head = 0;
  constructor(readonly cap: number) {}
  push(value: T): T | undefined {
    if (this.rows.length < this.cap) { this.rows.push(value); return undefined; }
    const old = this.rows[this.head]; this.rows[this.head] = value; this.head = (this.head + 1) % this.cap; return old;
  }
  values(): T[] { return [...this.rows.slice(this.head), ...this.rows.slice(0, this.head)]; }
  get size(): number { return this.rows.length; }
  slice(from: number, to: number): T[] {
    const out: T[] = [];
    for (let i = from; i < to; i++) out.push(this.rows[(this.head + i) % this.rows.length]);
    return out;
  }
  after(test: (x: T) => boolean): T[] {
    const out: T[] = [];
    for (let i = this.rows.length - 1; i >= 0; i--) { const row = this.rows[(this.head + i) % this.rows.length]; if (!test(row)) break; out.push(row); }
    return out.reverse();
  }
}

export class ObservationJournal {
  private readonly prints: Ring<ObservedPrint>;
  private readonly depth: Ring<ObservedDepth>;
  private readonly seen = new Map<string, ObservedPrint>();
  private readonly interruptions: ObservationGap[] = [];
  private readonly spans: Span[] = [];
  private next = 0;
  private nextGap = 0;
  private lastObserved = 0;
  private newestExchange = 0;
  private evictedThrough = -Infinity;
  private lastBook: string | null = null;
  private readonly bookIds = new Map<number, string>();
  private change = 0;
  private readonly corrections: { id: number; time: number; observedAt: number }[] = [];
  readonly bins = new MinuteBins();
  constructor(readonly coin: string, limits = { trades: 50_000, books: 2048 }) {
    this.prints = new Ring(Math.max(1, limits.trades)); this.depth = new Ring(Math.max(1, limits.books));
  }
  private received(t: number): number { this.lastObserved = Math.max(this.lastObserved, t); return this.lastObserved; }
  get sequence(): number { return this.next; }
  get observedNow(): number { return this.lastObserved; }
  get revision(): number { return this.change; }
  correctionsAfter(id: number) { return this.corrections.filter(c => c.id > id); }
  private corrected(time: number, observedAt: number): void {
    this.corrections.push({ id: ++this.change, time, observedAt }); if (this.corrections.length > 256) this.corrections.shift();
  }
  invalidBook(time: number, observedAt: number): void { this.bins.invalidateDepth(time); this.corrected(time, this.received(observedAt)); }
  get connected(): boolean { return this.spans.at(-1)?.end === null; }
  open(from: number, observedAt: number): void {
    if (!Number.isFinite(from) || !Number.isFinite(observedAt) || this.connected) return;
    this.spans.push({ from, observedAt: this.received(observedAt), end: null, endObservedAt: null });
    if (this.spans.length > 512) this.spans.shift();
  }
  close(at: number, observedAt: number, reason: string): void {
    const seenAt = this.received(observedAt), span = this.spans.at(-1);
    if (span?.end === null) { span.end = Math.max(span.from, at); span.endObservedAt = seenAt; }
    this.interruptions.push({ id: ++this.nextGap, from: at, observedAt: seenAt, reason });
    this.corrected(at, seenAt);
    if (this.interruptions.length > 512) this.interruptions.shift();
    this.lastBook = null;
  }
  trades(rows: readonly PublicPrint[], receivedAt: number, clientReceivedAt = receivedAt): void {
    if (!Number.isFinite(receivedAt)) return;
    const observedAt = this.received(receivedAt);
    let changedFrom = Infinity;
    for (const t of rows) {
      if (![t.time, t.tid, t.px, t.sz].every(Number.isFinite) || !(t.time >= 0 && t.px > 0 && t.sz > 0) || (t.side !== 1 && t.side !== -1)) {
        this.close(this.newestExchange, observedAt, 'invalid-print'); continue;
      }
      if (t.time <= this.evictedThrough) { this.close(t.time, observedAt, 'outside-dedup-retention'); continue; }
      const key = `${this.coin}:${t.time}:${t.tid}`, old = this.seen.get(key);
      if (old) {
        if (old.px !== t.px || old.sz !== t.sz || old.side !== t.side) this.close(t.time, observedAt, 'conflicting-id');
        continue;
      }
      const row: ObservedPrint = { time: t.time, tid: t.tid, px: t.px, sz: t.sz, side: t.side,
        seq: ++this.next, observedAt, receivedAt: clientReceivedAt, late: t.time < this.newestExchange };
      this.newestExchange = Math.max(this.newestExchange, t.time);
      if (row.late) this.corrected(t.time, observedAt);
      this.seen.set(key, row);
      changedFrom = Math.min(changedFrom, t.time);
      this.bins.trade(row, observedAt);
      const evicted = this.prints.push(row);
      if (evicted) { this.seen.delete(`${this.coin}:${evicted.time}:${evicted.tid}`); this.evictedThrough = Math.max(this.evictedThrough, evicted.time); }
    }
    if (Number.isFinite(changedFrom)) this.corrected(changedFrom, observedAt);
  }
  tradesAfter(seq: number): ObservedPrint[] { return this.prints.after(x => x.seq > seq); }
  sequenceRange(first: number, last: number): ObservedPrint[] | null {
    const oldest = this.next - this.prints.size + 1;
    if (first < oldest || last > this.next || last < first) return null;
    return this.prints.slice(first - oldest, last - oldest + 1);
  }
  range(from: number, to: number, asOf = Infinity): ObservedPrint[] {
    return this.prints.values().filter(x => from <= x.time && x.time < to && x.observedAt <= asOf).sort((a, b) => a.time - b.time || a.seq - b.seq);
  }
  complete(from: number, to: number, asOf: number): boolean {
    if (!(to >= from) || from <= this.evictedThrough || asOf < to) return false;
    return this.continuous(from, to, asOf);
  }
  continuous(from: number, to: number, asOf: number): boolean {
    if (!(to >= from) || asOf < to) return false;
    return this.spans.some(s => s.observedAt <= asOf && s.from <= from &&
      (s.endObservedAt === null || s.endObservedAt > asOf || s.end !== null && s.end >= to));
  }
  flow(from: number, to: number, asOf: number, range?: PriceRange): FlowTotal | null {
    if (!this.continuous(from, to, asOf)) return null;
    if (asOf >= this.lastObserved && from % 60000 === 0 && to % 60000 === 0) return this.bins.flow(from, to, range);
    if (!this.complete(from, to, asOf)) return null;
    const sum = emptyFlow();
    for (const t of this.range(from, to, asOf)) if (!range || t.px >= range.lo && t.px <= range.hi) addFlow(sum, printFlow(t));
    return sum;
  }
  book(b: PublicDepth, receivedAt: number, step: number): void {
    if (![b.time, receivedAt, step].every(Number.isFinite) || step <= 0) return;
    if (!b.bids.length || !b.asks.length) { this.invalidBook(b.time, receivedAt); return; }
    const clean = (xs: PublicDepth['bids']) => xs.slice(0, 20).map(x => ({ px: x.px, sz: x.sz }));
    const bids = clean(b.bids), asks = clean(b.asks);
    if ([...bids, ...asks].some(x => !Number.isFinite(x.px) || !Number.isFinite(x.sz) || x.px <= 0 || x.sz < 0)) { this.invalidBook(b.time, receivedAt); return; }
    const key = JSON.stringify([b.time, step, bids, asks]);
    if (key === this.lastBook || this.bookIds.get(b.time) === key) return;
    if (this.bookIds.has(b.time)) { this.invalidBook(b.time, receivedAt); return; }
    this.lastBook = key;
    this.bookIds.set(b.time, key);
    const row = { time: b.time, observedAt: this.received(receivedAt), step, bids, asks };
    const old = this.depth.push(row); if (old) this.bookIds.delete(old.time);
    this.bins.book(row);
    this.corrected(b.time, row.observedAt);
  }
  bookRows(): ObservedDepth[] { return this.depth.values(); }
  gaps(): readonly ObservationGap[] { return this.interruptions; }
  stats(): { trades: number; books: number; retainedAfter: number; since: number | null } {
    return { trades: this.prints.size, books: this.depth.size, retainedAfter: this.evictedThrough, since: this.spans[0]?.from ?? null };
  }
}
