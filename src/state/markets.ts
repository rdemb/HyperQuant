import { useEffect, useSyncExternalStore } from 'react';
import { type MarketCaps, marketCaps, noScannerWhy, usdScale } from '../utils/marketCaps';
import { type ChartMarket, DEFAULT_MARKETS, isMarketRegistry, marketsOrDefault } from '../utils/marketRegistry';
import { usePublished } from './usePublished';

/**
 * Rynki strony z rejestru `markets.json` (repo danych, pisze skaner co godzinę) — jedna lista dla całej strony, bo magazyny
 * rynków, alarmy i zdolności rynku (`capsOf`) żyją poza Reactem. Przed odpowiedzią i bez pliku: 4 rynki domyślne.
 * `ready` — lista rozstrzygnięta (plik wczytany, brak pliku albo zły format, build bez adresu danych): dopiero wtedy rynek
 * spoza listy w linku albo w zapisie jest wygasły.
 */

export interface MarketsState {
  markets: readonly ChartMarket[];
  ready: boolean;
}

const INITIAL: MarketsState = { markets: DEFAULT_MARKETS, ready: false };
let state: MarketsState = INITIAL;
const listeners = new Set<() => void>();

const sameList = (a: readonly ChartMarket[], b: readonly ChartMarket[]) =>
  a.length === b.length &&
  a.every((m, i) => m.coin === b[i].coin && m.dex === b[i].dex && m.szDecimals === b[i].szDecimals && m.maxLeverage === b[i].maxLeverage && m.scanner === b[i].scanner && m.oiUsd7d === b[i].oiUsd7d);

/** Odpowiedź rejestru (null = brak pliku albo nieudane pobranie): lista z pliku albo 4 rynki domyślne. */
export function publishMarkets(raw: unknown): void {
  const markets = marketsOrDefault(raw);
  if (state.ready && sameList(state.markets, markets)) return;
  state = { markets: sameList(state.markets, markets) ? state.markets : markets, ready: true };
  listeners.forEach((fn) => fn());
}

export const marketsState = (): MarketsState => state;
export const chartMarkets = (): readonly ChartMarket[] => state.markets;
export const marketOf = (coin: string): ChartMarket | undefined => state.markets.find((m) => m.coin === coin);
/** Zdolności rynku według bieżącej listy (`utils/marketCaps`). */
export const capsOf = (coin: string): MarketCaps => marketCaps(coin, state.markets);
/** Skala progów w USD rynku wobec BTC (`utils/marketCaps.usdScale`; BTC = 1). */
export const usdScaleOf = (coin: string): number => usdScale(coin, state.markets);
/** Powód „—” warstwy skanera albo prognoz na rynku `coin` (rynki z pełnym skanerem z bieżącej listy). */
export const noScannerWhyOf = (coin: string): string => noScannerWhy(coin, state.markets);

export function subscribeMarkets(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Tylko dla testów: lista jak przed pierwszą odpowiedzią. */
export function resetMarketsForTest(): void {
  state = INITIAL;
}

/** Rynki strony: pobiera rejestr (wspólny mechanizm danych publicznych) i zwraca bieżącą listę. */
export function useMarkets(): MarketsState {
  const pub = usePublished('markets.json', isMarketRegistry);
  useEffect(() => {
    if (!pub.configured || pub.value || pub.failed) publishMarkets(pub.value);
  }, [pub]);
  return useSyncExternalStore(subscribeMarkets, marketsState);
}
