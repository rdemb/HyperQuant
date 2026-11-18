import type { Coverage } from './coverage';
import { MINUTE, minuteOf, type Tape } from './tape';

export type ProfileSpan = { from: number; to: number };
export interface RangeProfileRow { price: number; turnoverUsd: number; deltaUsd: number }
export interface RangeProfile {
  rows: RangeProfileRow[];
  turnoverUsd: number;
  deltaUsd: number;
  coveredMs: number;
  spanMs: number;
}

const MAX_CACHED_MINUTES = 1440;
type Rows = Map<number, RangeProfileRow>;

export function rangeProfileStep(lo: number, hi: number, height: number): number {
  const target = Math.max(1, (hi - lo) / Math.max(1, Math.min(72, Math.floor(height / 10))));
  const unit = 10 ** Math.floor(Math.log10(target));
  const ratio = target / unit;
  return unit * (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10);
}

function add(rows: Rows, price: number, turnoverUsd: number, deltaUsd: number): void {
  const row = rows.get(price);
  if (row) {
    row.turnoverUsd += turnoverUsd;
    row.deltaUsd += deltaUsd;
  } else rows.set(price, { price, turnoverUsd, deltaUsd });
}

function merge(into: Rows, from: Rows): void {
  for (const row of from.values()) add(into, row.price, row.turnoverUsd, row.deltaUsd);
}

/** Wspólna taśma usuwa duplikaty archiwum, zapisu przeglądarki i strumienia. Granice okna liczymy z dokładnością taśmy. */
export class SmcRangeProfile {
  private step = 0;
  private readonly minutes = new Map<number, { version: number; rows: Rows }>();
  private body: { key: string; rows: Rows } | null = null;

  constructor(private readonly tape: Tape) {}

  read(span: ProfileSpan, step: number, coverage: Coverage): RangeProfile {
    const { from, to } = span;
    if (step !== this.step) {
      this.step = step;
      this.minutes.clear();
      this.body = null;
    }
    const rows: Rows = new Map();
    const left = Math.max(from, minuteOf(this.tape.firstTime));
    const right = Math.min(to, this.tape.lastTime + 1);
    if (left < right && Number.isFinite(step) && step > 0) {
      const a = Math.ceil(left / MINUTE) * MINUTE;
      const b = minuteOf(right);
      if (a > b) this.prints(rows, left, right);
      else {
        this.prints(rows, left, a);
        if (a < b) merge(rows, this.fullMinutes(a, b));
        this.prints(rows, b, right);
      }
    }
    const result: RangeProfile = { rows: [...rows.values()].sort((a, b) => a.price - b.price), turnoverUsd: 0, deltaUsd: 0,
      coveredMs: coverage.coveredMs(from, to), spanMs: Math.max(0, to - from) };
    for (const row of result.rows) {
      result.turnoverUsd += row.turnoverUsd;
      result.deltaUsd += row.deltaUsd;
    }
    return result;
  }

  private prints(rows: Rows, from: number, to: number): void {
    this.tape.forEach(from, to, (_t, price, size, side) => {
      const usd = price * size;
      if (!(usd > 0) || !Number.isFinite(usd)) return;
      add(rows, Math.floor(price / this.step) * this.step, usd, side * usd);
    });
  }

  private fullMinutes(from: number, to: number): Rows {
    const key = `${from}:${to}:${this.tape.signature(from, to)}`;
    if (this.body?.key === key) return this.body.rows;
    const rows: Rows = new Map();
    for (let m = from; m < to; m += MINUTE) {
      const chunk = this.tape.chunk(m);
      if (!chunk) continue;
      let minute = this.minutes.get(m);
      if (minute?.version !== chunk.version) {
        minute = { version: chunk.version, rows: new Map() };
        this.prints(minute.rows, m, m + MINUTE);
        this.minutes.set(m, minute);
        if (this.minutes.size > MAX_CACHED_MINUTES) {
          const oldest = this.minutes.keys().next();
          if (!oldest.done) this.minutes.delete(oldest.value);
        }
      }
      merge(rows, minute.rows);
    }
    this.body = { key, rows };
    return rows;
  }
}
