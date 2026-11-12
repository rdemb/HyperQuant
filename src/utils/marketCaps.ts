import { tr } from '../i18n';
import type { ChartMarket } from './marketRegistry';

/**
 * Zdolności rynku: które warstwy wykresu i liczby mają dane dla danego rynku. Jedyne miejsce, które wie, że skaner,
 * prognozy, mapy z bloga i rynki HIP-4 nie są dla każdego rynku; reszta kodu pyta tutaj zamiast porównywać nazwę z BTC
 * (test statyczny `btcCompare.test.ts`). Czysta funkcja: lista rynków przychodzi z rejestru `markets.json` albo z 4 rynków
 * domyślnych (`src/state/markets.ts`).
 */

/** Rynek wykresu, gdy link albo zapis wskazuje rynek spoza rejestru (i rynek startowy strony). */
export const HOME_MARKET = 'BTC';

export interface MarketCaps {
  /**
   * Warstwy skanera kont (`scanner: "full"` w rejestrze): mapa i taśma likwidacji, kohorty, konta makerów, TWAP-y
   * i nagranie taśmy na serwerze (szybka powtórka).
   */
  scanner: boolean;
  /** Prognozy z dziennika desku (stożek): rekord rejestru `full` obejmuje prognozy (`ScannerLevel`). */
  forecasts: boolean;
  /** Mapy z bloga: blog opisuje BTC (decyzja projektu, jak Przed sesją, Po sesji i MCP). */
  blog: boolean;
  /** Rynki HIP-4 (udział „Tak” na cenie): Hyperliquid notuje je tylko na cenie BTC. */
  outcomes: boolean;
}

export function marketCaps(coin: string, markets: readonly ChartMarket[]): MarketCaps {
  const full = markets.some((m) => m.coin === coin && m.scanner === 'full');
  // Blog i rynki HIP-4 opisują BTC niezależnie od rejestru
  const home = coin === 'BTC';
  return { scanner: full, forecasts: full, blog: home, outcomes: home };
}

/** Dopisek „—” przy warstwie skanera na rynku bez skanera (legenda, nagłówek układu, kafle). */
export const NO_SCANNER_NOTE = tr('bez skanera', 'no scanner');
/** Plakietka warstwy skanera na rynku bez skanera. */
export const NO_SCANNER_BADGE = tr('—, bez skanera', '—, no scanner');

/** Powód „—” warstwy skanera albo prognoz na rynku `coin`: które rynki mają dziś pełny skaner. */
export function noScannerWhy(coin: string, markets: readonly ChartMarket[]): string {
  const full = markets.filter((m) => m.scanner === 'full').map((m) => m.coin);
  const list = full.length > 0 ? full.join(', ') : '—';
  return tr(
    `Skaner HyperQuant nie śledzi kont na rynku ${coin}: mapa i taśma likwidacji, kohorty, konta makerów, TWAP-y i prognozy są dla rynków z pełnym skanerem (dziś ${list}). Wykres, taśma i arkusz działają na każdym rynku.`,
    `The HyperQuant scanner does not track accounts on ${coin}: the liquidation map and tape, cohorts, maker accounts, TWAPs and forecasts exist for markets with the full scanner (today ${list}). The chart, tape and book work on every market.`
  );
}

/** Dopisek „—” przy stożku prognoz na rynku bez prognoz w dzienniku (powód: `noScannerWhy`). */
export const NO_FORECASTS_NOTE = tr('bez prognoz', 'no forecasts');
export const NO_FORECASTS_BADGE = tr('—, bez prognoz', '—, no forecasts');

/** Dopisek i plakietka „—” przy mapach z bloga i rynkach HIP-4 na innym rynku niż BTC. */
export const BTC_ONLY_NOTE = tr('tylko BTC', 'BTC only');
export const BTC_ONLY_BADGE = tr('—, tylko BTC', '—, BTC only');
export const BLOG_ONLY_WHY = tr('Tylko BTC: mapy z bloga opisują BTC', 'BTC only: the blog maps describe BTC');
/** Dopisek i powód „—” przy rynkach HIP-4 na innym rynku niż BTC. */
export const OUTCOMES_ONLY_WHY = tr('Tylko BTC: rynki HIP-4 są notowane na cenie BTC', 'BTC only: HIP-4 markets are listed on the BTC price');
