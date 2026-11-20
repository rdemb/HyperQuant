import type { BookHistory } from '../../charts/pro/core/book';
import type { Coverage } from '../../charts/pro/core/coverage';
import { MINUTE, minuteOf, type MinuteChunk, type Tape, type TradeRow } from '../../charts/pro/core/tape';
import { BOOK_HIDE_AFTER_MS } from './orderFlowDesk';

export const LENS_MS = 120_000;
const MICROS = 1_000_000n;
export const NOMINAL_BANDS = ['<1k', '1–10k', '10–50k', '50–100k', '100–500k', '500k–1M', '≥1M'];
const bounds = [1_000n, 10_000n, 50_000n, 100_000n, 500_000n, 1_000_000n].map(value => value * MICROS);

export function notionalBand(micros: bigint): number {
  const index = bounds.findIndex(bound => micros < bound);
  return index < 0 ? bounds.length : index;
}

function atoms(value: number, scale: number) {
  const units = Math.round(value * scale);
  return Number.isSafeInteger(units) && units > 0 && units / scale === value ? units : null;
}

export function tradeNotionalMicros(px: number, sz: number, szDecimals: number): bigint | null {
  const price = atoms(px, 10 ** (6 - szDecimals));
  const size = atoms(sz, 10 ** szDecimals);
  return price === null || size === null ? null : BigInt(price) * BigInt(size);
}

export type LensDelta =
  | { kind: 'exact'; micros: bigint }
  | { kind: 'coverage'; coveredMs: number }
  | { kind: 'precision' };

const DELTA_BLOCK = 256;
type DeltaSum = { micros: bigint; invalid: number };
type DeltaMinute = { version: number; prefixes: DeltaSum[] };

/** Sumy co 256 wykonań. Kursor czyta typowo tylko dwa niepełne brzegi na minutę. */
export class LensDeltaIndex {
  private readonly minutes = new Map<MinuteChunk, DeltaMinute>();

  constructor(private readonly tape: Tape, private readonly szDecimals: number) {}

  read(coverage: Coverage, cursor: number): LensDelta {
    const to = cursor + 1;
    const from = to - LENS_MS;
    if (!coverage.covers(from, to)) return { kind: 'coverage', coveredMs: coverage.coveredMs(from, to) };
    const total: DeltaSum = { micros: 0n, invalid: 0 };
    for (let minute = minuteOf(from); minute < to; minute += MINUTE) {
      const chunk = this.tape.chunk(minute);
      if (!chunk) continue;
      const first = timeIndex(chunk.t, from);
      const limit = timeIndex(chunk.t, to);
      if (first === limit) continue;
      const startBlock = Math.ceil(first / DELTA_BLOCK);
      const endBlock = Math.floor(limit / DELTA_BLOCK);
      if (endBlock <= startBlock) {
        this.add(chunk, first, limit, total);
        continue;
      }
      const prefix = this.prefixes(chunk, endBlock);
      total.micros += prefix[endBlock].micros - prefix[startBlock].micros;
      total.invalid += prefix[endBlock].invalid - prefix[startBlock].invalid;
      this.add(chunk, first, startBlock * DELTA_BLOCK, total);
      this.add(chunk, endBlock * DELTA_BLOCK, limit, total);
    }
    return total.invalid > 0 ? { kind: 'precision' } : { kind: 'exact', micros: total.micros };
  }

  private prefixes(chunk: MinuteChunk, endBlock: number): DeltaSum[] {
    let cached = this.minutes.get(chunk);
    this.minutes.delete(chunk);
    if (cached?.version !== chunk.version) cached = { version: chunk.version, prefixes: [{ micros: 0n, invalid: 0 }] };
    this.minutes.set(chunk, cached);
    // Zachowaj mały zapas przy cofaniu kursora. Nie zatrzymuj starej taśmy.
    if (this.minutes.size > 4) {
      const oldest = this.minutes.keys().next();
      if (!oldest.done) this.minutes.delete(oldest.value);
    }
    const { prefixes } = cached;
    for (let block = prefixes.length; block <= endBlock; block++) {
      const next = { ...prefixes[block - 1] };
      this.add(chunk, (block - 1) * DELTA_BLOCK, block * DELTA_BLOCK, next);
      prefixes.push(next);
    }
    return prefixes;
  }

  private add(chunk: MinuteChunk, first: number, limit: number, total: DeltaSum) {
    for (let i = first; i < limit; i++) {
      const usd = tradeNotionalMicros(chunk.px[i], chunk.sz[i], this.szDecimals);
      if (usd === null) total.invalid++;
      else total.micros += chunk.side[i] === 1 ? usd : -usd;
    }
  }
}

type LensFilter = { px: number | null; band: number | null; side?: TradeRow['side'] };
export type LensPin = LensFilter & { px: number };

export function readMomentWindow(tape: Tape, coverage: Coverage, to: number, szDecimals: number, pin: LensPin | null = null) {
  const from = to - LENS_MS;
  const totals = NOMINAL_BANDS.map(() => 0);
  const lanes = NOMINAL_BANDS.map(() => new Float64Array(240));
  const times: number[] = [];
  let last: number | undefined;
  let count = 0;
  let max = 0;
  let peak: number | null = null;
  let unclassified = 0;
  const spans = coverage.list().map(([a, b]) => [Math.max(a, from), Math.min(b, to)]).filter(([a, b]) => b > a);
  let span = 0;
  tape.forEach(from, to, (t, px, sz, side) => {
    if (t !== last) {
      times.push(t);
      last = t;
      count = 0;
    }
    count++;
    if (count > max) {
      max = count;
      peak = t;
    }
    while (span < spans.length && spans[span][1] <= t) span++;
    if (span === spans.length || t < spans[span][0]) return;
    if (pin && (px !== pin.px || (pin.side !== undefined && side !== pin.side))) return;
    const usd = tradeNotionalMicros(px, sz, szDecimals);
    if (usd === null) {
      if (pin?.band == null) unclassified++;
      return;
    }
    const band = notionalBand(usd);
    if (pin?.band != null && band !== pin.band) return;
    const cell = 2 * Math.floor((t - from) / 1000) + (side === 1 ? 0 : 1);
    lanes[band][cell] += Number(usd) / Number(MICROS);
    totals[band]++;
  });
  const gaps: { start: number; end: number }[] = [];
  let through = from;
  for (const [start, end] of [...spans, [to, to]]) {
    if (start > through) gaps.push({ start: through, end: start });
    through = end;
  }
  return { from, to, times, peak, totals, lanes, gaps, unclassified, coveredMs: coverage.coveredMs(from, to) };
}

export function timeIndex(times: readonly number[], target: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export type LensTrade = TradeRow & { usd: bigint | null; band: number | null };
type Aggressor = 'buy' | 'sell';
export type ExecutionAmounts = { count: number; units: bigint; usd: bigint };
type BandRead = Record<Aggressor, ExecutionAmounts>;
export type PriceRead = { px: number; bands: (BandRead | null)[]; missing: Set<Aggressor> };
const emptyAmounts = (): ExecutionAmounts => ({ count: 0, units: 0n, usd: 0n });

export function amountsAt(row: PriceRead | undefined, band: number | null, side: Aggressor, covered: boolean): ExecutionAmounts | null {
  if (!covered || row?.missing.has(side)) return null;
  if (band !== null) return row?.bands[band]?.[side] ?? emptyAmounts();
  const total = emptyAmounts();
  for (const cell of row?.bands ?? []) {
    if (!cell) continue;
    total.count += cell[side].count;
    total.units += cell[side].units;
    total.usd += cell[side].usd;
  }
  return total;
}

export function priceDelta(row: PriceRead | undefined, covered: boolean, band: number | null = null): LensDelta {
  if (!covered) return { kind: 'coverage', coveredMs: 0 };
  const buy = amountsAt(row, band, 'buy', true);
  const sell = amountsAt(row, band, 'sell', true);
  return buy && sell ? { kind: 'exact', micros: buy.usd - sell.usd } : { kind: 'precision' };
}

export function momentAt(tape: Tape, coverage: Coverage, t: number, szDecimals: number) {
  const prices = new Map<number, PriceRead>();
  let lastPrice: number | null = null;
  let lastTid = Number.NEGATIVE_INFINITY;
  const chunk = tape.chunk(minuteOf(t));
  const scale = 10 ** szDecimals;
  const priceScale = 10 ** (6 - szDecimals);
  if (chunk) for (let i = timeIndex(chunk.t, t); chunk.t[i] === t; i++) {
    const px = chunk.px[i];
    // W tej samej milisekundzie rozstrzyga tid, niezależnie od kolejności dostawy.
    if (chunk.tid[i] > lastTid) {
      lastTid = chunk.tid[i];
      lastPrice = px;
    }
    const sz = chunk.sz[i];
    const side = chunk.side[i];
    const quantity = atoms(sz, scale);
    const ticks = atoms(px, priceScale);
    const usd = quantity === null || ticks === null ? null : BigInt(ticks) * BigInt(quantity);
    const category = usd === null ? null : notionalBand(usd);
    let row = prices.get(px);
    if (!row) {
      row = { px, bands: NOMINAL_BANDS.map(() => null), missing: new Set() };
      prices.set(px, row);
    }
    const direction = side === 1 ? 'buy' : 'sell';
    if (category === null || quantity === null || usd === null) {
      row.missing.add(direction);
      continue;
    }
    const cell = row.bands[category] ??= { buy: emptyAmounts(), sell: emptyAmounts() };
    cell[direction].count++;
    cell[direction].units += BigInt(quantity);
    cell[direction].usd += usd;
  }
  return { prices: [...prices.values()].sort((a, b) => b.px - a.px), lastPrice, covered: coverage.covers(t, t + 1) };
}

export function bookAtMoment(history: BookHistory | null, coverage: Coverage, t: number) {
  const frame = history?.range(t, t + 1).at(-1);
  return frame && frame.t <= t && t - frame.t <= BOOK_HIDE_AFTER_MS && coverage.covers(frame.t, t + 1) ? frame : null;
}

export function lensTapeRange(availableFrom: number, cursor: number) {
  const to = cursor + 1;
  const from = Math.max(availableFrom, to - LENS_MS);
  return { from: Math.min(from, to), to };
}

export function lensTapePage(
  tape: Tape, coverage: Coverage, range: { from: number; to: number }, szDecimals: number,
  filters: LensFilter, requestedPage: number, pageSize: number,
) {
  let rows: LensTrade[] = [];
  let total = 0;
  for (let minute = minuteOf(range.to - 1); minute >= minuteOf(range.from); minute -= MINUTE) {
    const chunk = tape.chunk(minute);
    if (!chunk) continue;
    for (let i = timeIndex(chunk.t, range.to) - 1; i >= 0 && chunk.t[i] >= range.from; i--) {
      const px = chunk.px[i];
      const side = chunk.side[i];
      if (filters.px !== null && filters.px !== px) continue;
      if (filters.side !== undefined && filters.side !== side) continue;
      const page = Math.floor(total / pageSize);
      if (page > requestedPage && filters.band === null) {
        total++;
        continue;
      }
      const sz = chunk.sz[i];
      const usd = tradeNotionalMicros(px, sz, szDecimals);
      const band = usd === null ? null : notionalBand(usd);
      if (filters.band !== null && filters.band !== band) continue;
      if (page <= requestedPage) {
        if (total % pageSize === 0) rows = [];
        rows.push({ t: chunk.t[i], px, sz, side, tid: chunk.tid[i], usd, band });
      }
      total++;
    }
  }
  const page = Math.min(requestedPage, Math.max(0, Math.ceil(total / pageSize) - 1));
  return { page, rows, total, coveredMs: coverage.coveredMs(range.from, range.to), durationMs: range.to - range.from };
}
