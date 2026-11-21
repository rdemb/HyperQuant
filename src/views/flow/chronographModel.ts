import type { Coverage } from '../../charts/pro/core/coverage';
import type { Tape, TradeRow } from '../../charts/pro/core/tape';
import { visibleExecutions } from './hip3Flow';
import { tradeNotionalMicros } from './momentLensModel';

export const TAPE_MINIMUMS = [0, 1_000, 10_000, 25_000, 50_000, 100_000, 200_000, 500_000, 1_000_000];
export const CHRONOGRAPH_REPLAY_MARKET = 'BTC';

interface Crossing {
  minimum: number;
  delta: number;
  tid: number;
  time: number;
}

/** Grupujemy identyczne nominały. Zero nie jest zmianą znaku. */
export function readSizeThreshold(tape: Tape, coverage: Coverage, from: number, to: number, minimum: number, sizeDecimals: number) {
  if (!coverage.covers(from, to)) return { kind: 'gap' } as const;
  const scale = 10 ** sizeDecimals;
  const floor = BigInt(Math.round(minimum * 1_000_000));
  let full = 0n;
  let filtered = 0n;
  let count = 0;
  const groups = new Map<bigint, { size: bigint; print: TradeRow }>();
  const rows = visibleExecutions(tape, to - 1, 0, Infinity, from);
  for (const row of rows) {
    const usd = tradeNotionalMicros(row.px, row.sz, sizeDecimals);
    if (usd === null) return { kind: 'precision' } as const;
    const size = BigInt(Math.round(row.sz * scale)) * BigInt(row.side);
    full += size;
    if (usd >= floor) {
      filtered += size;
      count++;
    } else {
      const group = groups.get(usd);
      if (group) group.size += size;
      else groups.set(usd, { size, print: row });
    }
  }
  let crossing: Crossing | null = null;
  let delta = filtered;
  if (filtered !== 0n) {
    for (const [usd, group] of [...groups].sort(([a], [b]) => a > b ? -1 : a < b ? 1 : 0)) {
      delta += group.size;
      if (delta * filtered < 0n) {
        crossing = { minimum: Number(usd) / 1_000_000, delta: Number(delta) / scale, tid: group.print.tid, time: group.print.t };
        break;
      }
    }
  }
  return { kind: 'covered', full: Number(full) / scale, filtered: Number(filtered) / scale,
    count, total: rows.length, crossing } as const;
}

export function levelTrial(tape: Tape, coverage: Coverage, from: number, to: number, price: number) {
  if (!coverage.covers(from, to)) return { kind: 'gap' } as const;
  const rows = visibleExecutions(tape, to - 1, 0, Infinity, from).reverse();
  const firstBelow = rows.find(row => row.px < price) ?? null;
  const sells = rows.filter(row => row.px === price && row.side === -1);
  const beforeRows = firstBelow ? sells.filter(row => row.t < firstBelow.t) : sells;
  const ambiguous = firstBelow && sells.some(row => row.t === firstBelow.t);
  const returned = firstBelow ? rows.find(row => row.t > firstBelow.t && row.px >= price) ?? null : null;
  return { kind: 'covered', firstBelow, returned, rows: firstBelow ? [...beforeRows, firstBelow] : beforeRows,
    before: ambiguous ? null : { count: beforeRows.length, size: beforeRows.reduce((sum, row) => sum + row.sz, 0) } } as const;
}
