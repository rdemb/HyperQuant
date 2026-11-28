import { useEffect, useSyncExternalStore } from 'react';
import { type MarketCaps, marketCaps, noScannerWhy, usdScale } from '../utils/marketCaps';
import { type ChartMarket, DEFAULT_MARKETS, isMarketRegistry, marketsOrDefault, withAppMarkets } from '../utils/marketRegistry';
import { type UniverseMarket, chartMarketsOf, parsePerpDexs, universeOf, withUniverse } from '../utils/hlUniverse';
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
  /**
   * Uniwersum wszystkich rynków Hyperliquid (`utils/hlUniverse`), ładowane leniwie (`ensureUniverse`): wyszukiwarka rynków
   * albo link do rynku spoza rejestru. `idle` — jeszcze nie pytane; rynek spoza listy jest wygasły dopiero po `ready`/`error`.
   */
  universe: UniverseStatus;
}

export type UniverseStatus = 'idle' | 'loading' | 'ready' | 'error';

const INITIAL: MarketsState = { markets: DEFAULT_MARKETS, ready: false, universe: 'idle' };
let state: MarketsState = INITIAL;
/** Lista z rejestru (z rynkami aplikacji) i rynki uniwersum — `state.markets` to ich złączenie (`withUniverse`). */
let registryList: readonly ChartMarket[] = DEFAULT_MARKETS;
let universeList: readonly ChartMarket[] = [];
let universeRows: readonly UniverseMarket[] = [];
/** Giełdy z rynkami w ostatnim odczycie (odświeżanie pyta tylko je) i chwila tego odczytu. */
let universeDexes: string[] = [];
let universeReadAt = Number.NEGATIVE_INFINITY;
let universeAt = Number.NEGATIVE_INFINITY;
const listeners = new Set<() => void>();

const sameList = (a: readonly ChartMarket[], b: readonly ChartMarket[]) =>
  a.length === b.length &&
  a.every((m, i) => m.coin === b[i].coin && m.dex === b[i].dex && m.szDecimals === b[i].szDecimals && m.maxLeverage === b[i].maxLeverage && m.scanner === b[i].scanner && m.oiUsd7d === b[i].oiUsd7d && m.class === b[i].class);

/** Odpowiedź rejestru (null = brak pliku albo nieudane pobranie): lista z pliku albo 4 rynki domyślne. */
export function publishMarkets(raw: unknown): void {
  registryList = withAppMarkets(marketsOrDefault(raw));
  const markets = withUniverse(registryList, universeList);
  if (state.ready && sameList(state.markets, markets)) return;
  state = { ...state, markets: sameList(state.markets, markets) ? state.markets : markets, ready: true };
  listeners.forEach((fn) => fn());
}

/** Po błędzie uniwersum kolejna próba najwcześniej po tylu ms (każda kosztuje wagi API giełdy). */
const UNIVERSE_RETRY_MS = 60_000;
/** Zapytania `metaAndAssetCtxs` uniwersum naraz (giełd jest kilkanaście, wagi 20 każda). */
const UNIVERSE_CONCURRENCY = 4;
/** Odświeżenie odczytu (przegląd wszystkich rynków) najwcześniej po tylu ms — jak strona Rynki. */
export const UNIVERSE_REFRESH_MS = 60_000;

export interface UniverseDeps {
  perpDexs: () => Promise<unknown>;
  metaCtxs: (dex: string) => Promise<unknown>;
  now: () => number;
}

/** Transport przeglądarki ładowany dopiero przy pierwszym użyciu (moduł listy rynków jest w pakiecie wejściowym). */
const browserUniverse: UniverseDeps = {
  perpDexs: async () => (await import('../utils/marketDataFeed')).postInfo({ type: 'perpDexs' }),
  metaCtxs: async (dex) => (await import('../charts/pro/hl/rest')).fetchMetaAndCtxs(dex),
  now: () => Date.now(),
};

const setUniverse = (universe: UniverseStatus) => {
  state = { ...state, universe, markets: withUniverse(registryList, universeList) };
  listeners.forEach((fn) => fn());
};

/**
 * Uniwersum wszystkich rynków (raz na sesję; po błędzie — ponowienie najwcześniej po UNIVERSE_RETRY_MS): `perpDexs`,
 * potem `metaAndAssetCtxs` każdej giełdy. Giełda bez odpowiedzi nie zatrzymuje pozostałych; bez żadnej — `error`.
 * `refresh` (przegląd wszystkich rynków, co UNIVERSE_REFRESH_MS): nowy odczyt tylko giełd z rynkami; nieudany albo
 * niepełny — zostaje poprzedni odczyt z jego godziną (bez mieszania chwil odczytu).
 */
export async function ensureUniverse(deps: UniverseDeps = browserUniverse, refresh = false): Promise<void> {
  if (state.universe === 'loading') return;
  const had = state.universe === 'ready';
  if (had && !(refresh && deps.now() - universeReadAt >= UNIVERSE_REFRESH_MS)) return;
  if (state.universe === 'error' && deps.now() - universeAt < UNIVERSE_RETRY_MS) return;
  universeAt = deps.now();
  if (!had) setUniverse('loading');
  let dexes: string[] = had ? universeDexes : [''];
  if (!had) {
    try {
      dexes = parsePerpDexs(await deps.perpDexs());
    } catch {
      // Sama giełda główna
    }
  }
  const rows: UniverseMarket[] = [];
  let answered = 0;
  for (let i = 0; i < dexes.length; i += UNIVERSE_CONCURRENCY) {
    const chunk = dexes.slice(i, i + UNIVERSE_CONCURRENCY);
    // Błąd transportu (wyjątek albo null zamiast odpowiedzi) to giełda bez odpowiedzi
    const got = await Promise.all(chunk.map((dex) => deps.metaCtxs(dex).then((raw) => (raw === null ? null : universeOf(dex, raw)), () => null)));
    for (const list of got) if (list) {
      answered++;
      rows.push(...list);
    }
  }
  const complete = had ? answered === dexes.length : answered > 0;
  if (complete && rows.length > 0) {
    universeRows = rows;
    universeList = chartMarketsOf(rows);
    universeDexes = [...new Set(rows.map((r) => r.dex))];
    universeReadAt = deps.now();
    setUniverse('ready');
  } else setUniverse(had ? 'ready' : 'error');
}

/** Wiersze uniwersum (cena, OI, wolumen, finansowanie z chwili odczytu) — przegląd wszystkich rynków. */
export const universeMarkets = (): readonly UniverseMarket[] => universeRows;
/** Chwila ostatniego udanego odczytu uniwersum; null przed nim. */
export const universeReadTime = (): number | null => (universeRows.length > 0 ? universeReadAt : null);

export const marketsState = (): MarketsState => state;
export const chartMarkets = (): readonly ChartMarket[] => state.markets;
export const marketOf = (coin: string): ChartMarket | undefined => state.markets.find((m) => m.coin === coin);
/** Rynki, dla których Binance i Bybit odpowiedziały w tej sesji „nie ma symbolu” (panele giełd „—”, bez zapytań). */
const noCex = new Set<string>();

/** Obie giełdy nie mają kontraktu rynku `coin`: zdolność `cex` gaśnie do końca sesji (subskrybenci listy dostają zmianę). */
export function markNoCex(coin: string): void {
  if (noCex.has(coin)) return;
  noCex.add(coin);
  state = { ...state };
  listeners.forEach((fn) => fn());
}

/** Zdolności rynku według bieżącej listy (`utils/marketCaps`). */
export const capsOf = (coin: string): MarketCaps => marketCaps(coin, state.markets, noCex);
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
  registryList = DEFAULT_MARKETS;
  universeList = [];
  universeRows = [];
  universeDexes = [];
  universeReadAt = Number.NEGATIVE_INFINITY;
  universeAt = Number.NEGATIVE_INFINITY;
  noCex.clear();
}

/** Rynki strony: pobiera rejestr (wspólny mechanizm danych publicznych) i zwraca bieżącą listę. */
export function useMarkets(): MarketsState {
  const pub = usePublished('markets.json', isMarketRegistry);
  useEffect(() => {
    if (!pub.configured || pub.value || pub.failed) publishMarkets(pub.value);
  }, [pub]);
  return useSyncExternalStore(subscribeMarkets, marketsState);
}
