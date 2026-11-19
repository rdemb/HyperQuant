import { useSyncExternalStore } from 'react';
import { HIST_HOUR_MS, type HistoryIndex } from '../utils/tapeHistory';

export type PublishedHistory = { kind: 'unknown' | 'unlisted' } | { kind: 'listed'; from: number; to: number };

export function publishedHistoryRange(index: HistoryIndex | null, coin: string): PublishedHistory {
  if (!index) return { kind: 'unknown' };
  const market = index.markets[coin];
  if (!market) return { kind: 'unlisted' };
  const units = [...market.hours.map(t => [t, t + HIST_HOUR_MS]), ...market.parts.map(t => [t, t + index.partMs])];
  if (!units.length) return { kind: 'unlisted' };
  return { kind: 'listed', from: Math.min(...units.map(unit => unit[0])), to: Math.max(...units.map(unit => unit[1])) };
}

let publishedIndex: HistoryIndex | null = null;
const listeners = new Set<() => void>();
const currentIndex = () => publishedIndex;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** Karta rynku i stopka korzystają z indeksu pobranego przez wykres. */
export function acceptHistoryIndex(index: HistoryIndex): void {
  if (publishedIndex && index.asOf <= publishedIndex.asOf) return;
  publishedIndex = index;
  listeners.forEach(listener => listener());
}

export function usePublishedHistory(coin: string): PublishedHistory {
  return publishedHistoryRange(useSyncExternalStore(subscribe, currentIndex, () => null), coin);
}
