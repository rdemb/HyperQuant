import { VALUE_BIN_BP } from './valueReference';

export interface TpoLevels { poc: number; val: number; vah: number }

/** Stałe koszyki log-ceny 5 pb od minimum doby, jak valueReference; niezależne od zoomu. */
export function tpoTimeLevels(bars: readonly { t: number; candle: { l: number; h: number } }[], previous: number | null): TpoLevels | null {
  const periods = new Map<number, { l: number; h: number }>();
  for (const b of bars) {
    if (!(b.candle.l > 0 && b.candle.h >= b.candle.l && Number.isFinite(b.candle.h))) continue;
    const k = Math.floor(b.t / 1_800_000);
    const old = periods.get(k);
    periods.set(k, { l: Math.min(old?.l ?? b.candle.l, b.candle.l), h: Math.max(old?.h ?? b.candle.h, b.candle.h) });
  }
  if (!periods.size) return null;
  const low = Math.min(...[...periods.values()].map((p) => p.l));
  const high = Math.max(...[...periods.values()].map((p) => p.h));
  const base = Math.log(low), step = VALUE_BIN_BP / 1e4;
  const bin = (px: number) => Math.floor((Math.log(px) - base) / step);
  const n = bin(high) + 1;
  if (n > 4000) return null;
  const counts = new Array<number>(n).fill(0);
  for (const p of periods.values()) for (let k = bin(p.l); k <= bin(p.h); k++) counts[k]++;
  const edge = (k: number) => Math.exp(base + step * k);
  const v = tpoValue(counts, previous === null ? null : (Math.log(previous) - base) / step - 0.5, (i) => Math.abs(edge(i + 0.5) - (low + high) / 2));
  return { poc: edge(v.poc + 0.5), val: edge(v.lo), vah: edge(v.hi + 1) };
}

/** POC czasu: remis bliżej środka zakresu; VA 70% rozszerzana parami wierszy. */
export function tpoValue(counts: readonly number[], previous: number | null = null, distanceFromMiddle = (i: number) => Math.abs(i - (counts.length - 1) / 2)): { poc: number; lo: number; hi: number } {
  let poc = 0;
  for (let i = 1; i < counts.length; i++) {
    if (counts[i] > counts[poc] || (counts[i] === counts[poc] && distanceFromMiddle(i) < distanceFromMiddle(poc))) poc = i;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  let lo = poc, hi = poc, sum = counts[poc] ?? 0;
  while (sum < total * 0.7 && (lo > 0 || hi < counts.length - 1)) {
    const up = (counts[hi + 1] ?? 0) + (counts[hi + 2] ?? 0);
    const down = (counts[lo - 1] ?? 0) + (counts[lo - 2] ?? 0);
    const preferUp = previous === null || previous >= poc;
    if (hi < counts.length - 1 && (lo === 0 || up > down || (up === down && preferUp))) {
      for (let k = 0; k < 2 && hi < counts.length - 1; k++) sum += counts[++hi];
    } else {
      for (let k = 0; k < 2 && lo > 0; k++) sum += counts[--lo];
    }
  }
  return { poc, lo, hi };
}
