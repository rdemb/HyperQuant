import type { L2OrderbookLevel } from '../types/trading';

/** Poziomy strony w głębokości arkusza (jak `bookDepth*Usd` w quantMathEngine). */
export const DEPTH_LEVELS = 12;

/** Głębokość arkusza w USD po stronach i udział bidów (null przy zerowej sumie). */
export interface BookDepth {
  bid: number;
  ask: number;
  bidShare: number | null;
}

/**
 * Głębokość arkusza z migawki L2: suma wartości 12 najbliższych poziomów każdej strony. Bez migawki (żadnego poziomu po
 * obu stronach) — null: widok pokazuje „—” z powodem, nigdy $0. Z migawką strona bez poziomów to prawdziwe 0.
 */
export function bookDepth(bids: readonly L2OrderbookLevel[], asks: readonly L2OrderbookLevel[]): BookDepth | null {
  if (bids.length === 0 && asks.length === 0) return null;
  const sum = (side: readonly L2OrderbookLevel[]) => Math.round(side.slice(0, DEPTH_LEVELS).reduce((a, l) => a + (Number.isFinite(l.sizeUsd) ? l.sizeUsd : 0), 0));
  const bid = sum(bids);
  const ask = sum(asks);
  return { bid, ask, bidShare: bid + ask > 0 ? bid / (bid + ask) : null };
}
