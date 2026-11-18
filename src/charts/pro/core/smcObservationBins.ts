import type { ObservedDepth, PublicPrint } from './smcObservation';

export interface FlowTotal { buy: number; sell: number; buyUsd: number; sellUsd: number; volume: number; delta: number; pv: number; count: number }
export interface PriceRange { lo: number; hi: number }
interface DepthBin { prices: Map<number, number> | null; samples: number; lo: number; hi: number; first: number; last: number; step: number; valid: boolean }
interface Minute { flow: FlowTotal; prices: Map<number, FlowTotal> | null; depth?: DepthBin }
export const emptyFlow = (): FlowTotal => ({ buy: 0, sell: 0, buyUsd: 0, sellUsd: 0, volume: 0, delta: 0, pv: 0, count: 0 });
export function addFlow(a: FlowTotal, b: FlowTotal): void {
  a.buy += b.buy; a.sell += b.sell; a.buyUsd += b.buyUsd; a.sellUsd += b.sellUsd;
  a.volume += b.volume; a.delta += b.delta; a.pv += b.pv; a.count += b.count;
}
export function printFlow(t: Pick<PublicPrint, 'px' | 'sz' | 'side'>): FlowTotal {
  return { buy: t.side === 1 ? t.sz : 0, sell: t.side === -1 ? t.sz : 0,
    buyUsd: t.side === 1 ? t.px * t.sz : 0, sellUsd: t.side === -1 ? t.px * t.sz : 0,
    volume: t.sz, delta: t.sz * t.side, pv: t.px * t.sz, count: 1 };
}

/** Dokładne ceny, bez interpolacji. Utrata histogramu nie usuwa sum całego okna. */
export class MinuteBins {
  private readonly rows = new Map<number, Minute>();
  private latest = -Infinity;
  private first = Infinity;
  private cells = 0;
  private depthCells = 0;
  constructor(private readonly minutes = 360, private readonly maxCells = 50_000) {}
  private minute(t: number): Minute | null {
    const key = Math.floor(t / 60000) * 60000;
    if (key <= this.latest - this.minutes * 60000) return null;
    this.latest = Math.max(this.latest, key); this.first = Math.min(this.first, key);
    let row = this.rows.get(key);
    if (!row) {
      row = { flow: emptyFlow(), prices: new Map() }; this.rows.set(key, row);
      for (const [k, r] of this.rows) if (k <= this.latest - this.minutes * 60000) {
        this.cells -= r.prices?.size ?? 0; this.depthCells -= r.depth?.prices?.size ?? 0; this.rows.delete(k);
      }
    }
    return row;
  }
  private trim(): void {
    if (this.cells <= this.maxCells && this.depthCells <= this.maxCells) return;
    for (const [, r] of [...this.rows].sort((a, b) => a[0] - b[0])) {
      if (this.cells > this.maxCells && r.prices) { this.cells -= r.prices.size; r.prices = null; }
      if (this.depthCells > this.maxCells && r.depth?.prices) { this.depthCells -= r.depth.prices.size; r.depth.prices = null; }
      if (this.cells <= this.maxCells && this.depthCells <= this.maxCells) break;
    }
  }
  trade(t: Pick<PublicPrint, 'time' | 'px' | 'sz' | 'side'>, _observedAt: number): void {
    const r = this.minute(t.time); if (!r) return;
    const f = printFlow(t); addFlow(r.flow, f);
    if (r.prices) {
      let p = r.prices.get(t.px);
      if (!p) { p = emptyFlow(); r.prices.set(t.px, p); this.cells++; }
      addFlow(p, f); this.trim();
    }
  }
  flow(from: number, to: number, range?: PriceRange): FlowTotal | null {
    if (from % 60000 || to % 60000 || from < this.first || from <= this.latest - this.minutes * 60000 || to < from) return null;
    const sum = emptyFlow();
    for (let t = from; t < to; t += 60000) {
      const r = this.rows.get(t); if (!r) continue;
      if (!range) addFlow(sum, r.flow);
      else {
        if (!r.prices) return null;
        for (const [px, f] of r.prices) if (px >= range.lo && px <= range.hi) addFlow(sum, f);
      }
    }
    return sum;
  }
  book(b: ObservedDepth): void {
    const r = this.minute(b.time); if (!r) return;
    const lo = Math.min(...b.bids.map(x => x.px)), hi = Math.max(...b.asks.map(x => x.px));
    let d = r.depth;
    if (!d) d = r.depth = { prices: new Map(), samples: 0, lo, hi, first: b.time, last: b.time, step: b.step, valid: true };
    if (d.step !== b.step || b.time < d.last || b.time - d.last > 12000) d.valid = false;
    d.lo = Math.max(d.lo, lo); d.hi = Math.min(d.hi, hi); d.last = b.time; d.samples++;
    if (d.prices) {
      for (const q of [...b.bids, ...b.asks]) {
        if (!d.prices.has(q.px)) this.depthCells++;
        d.prices.set(q.px, (d.prices.get(q.px) ?? 0) + q.px * q.sz);
      }
      this.trim();
    }
  }
  invalidateDepth(time: number): void {
    const r = this.minute(time); if (!r) return;
    if (r.depth) r.depth.valid = false;
    else r.depth = { prices: null, samples: 0, lo: Infinity, hi: -Infinity, first: time, last: time, step: 0, valid: false };
  }
  depth(from: number, to: number, range: PriceRange): { usd: number; step: number; samples: number } | null {
    if (from % 60000 || to % 60000 || to <= from) return null;
    let sum = 0, samples = 0, step: number | undefined, last: number | undefined;
    for (let t = from; t < to; t += 60000) {
      const d = this.rows.get(t)?.depth;
      if (!d?.prices || !d.valid || d.lo > range.lo || d.hi < range.hi ||
        d.first - t > 12000 || t + 60000 - d.last > 12000 ||
        last !== undefined && d.first - last > 12000 || step !== undefined && step !== d.step) return null;
      for (const [px, usd] of d.prices) if (px >= range.lo && px <= range.hi) sum += usd;
      samples += d.samples; step = d.step; last = d.last;
    }
    return samples && step !== undefined ? { usd: sum / samples, step, samples } : null;
  }
  stats(): { minutes: number; priceCells: number; depthCells: number } { return { minutes: this.rows.size, priceCells: this.cells, depthCells: this.depthCells }; }
}
