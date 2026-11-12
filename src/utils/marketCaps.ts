import { tr } from '../i18n';
import { type ChartMarket, DEFAULT_MARKETS } from './marketRegistry';

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
  /**
   * Panele giełd (CVD i ΔOI Binance i Bybit, symbol `${coin}USDT`): rynek HIP-3 (`dex:COIN`) i rynek z przedrostkiem `k`
   * (kPEPE, kBONK: 1000 jednostek na Hyperliquid) nie mają odpowiednika pod tym symbolem.
   */
  cex: boolean;
}

/** Rynek z symbolem `${coin}USDT` na Binance i Bybit: nie HIP-3 (dwukropek) i bez przedrostka `k` przed wielką literą. */
export const hasCexPair = (coin: string): boolean => !coin.includes(':') && !/^k[A-Z]/.test(coin);

export function marketCaps(coin: string, markets: readonly ChartMarket[]): MarketCaps {
  const full = markets.some((m) => m.coin === coin && m.scanner === 'full');
  // Blog i rynki HIP-4 opisują BTC niezależnie od rejestru
  const home = coin === 'BTC';
  return { scanner: full, forecasts: full, blog: home, outcomes: home, cex: hasCexPair(coin) };
}

/**
 * Skala progów w USD wobec BTC (duży gracz, próg dużego zlecenia, ściany): progi stoją pod BTC, a rynek mniejszy ma mniejsze
 * zlecenia. BTC, ETH, SOL i HYPE z tabeli (progi dobrane ręcznie, BTC = 1, więc BTC liczy jak dotąd); inny rynek z rejestru:
 * średnia otwartych pozycji z 7 dni (`oiUsd7d`) wobec BTC, zaokrąglona w dół do 2 cyfr znaczących (skala ciągła: mała zmiana OI
 * nie przeskakuje progu 2 razy, jak przy krokach 1-2-5), najmniej `MIN_USD_SCALE`
 * (także bez pola OI i dla rynku spoza listy).
 */
export const FIXED_USD_SCALE: Readonly<Record<string, number>> = { BTC: 1, ETH: 0.5, SOL: 0.25, HYPE: 0.25 };
export const MIN_USD_SCALE = 0.01;

/** Zaokrąglenie w dół do 2 cyfr znaczących (0,167 → 0,16; 0,0489 → 0,048) */
function sig2Down(v: number): number {
  const k = 10 ** (Math.floor(Math.log10(v)) - 1);
  return Number((Math.floor(v / k + 1e-9) * k).toPrecision(2));
}

export function usdScale(coin: string, markets: readonly ChartMarket[]): number {
  const fixed = FIXED_USD_SCALE[coin];
  if (fixed !== undefined) return fixed;
  const oi = markets.find((m) => m.coin === coin)?.oiUsd7d;
  const btc = markets.find((m) => m.coin === HOME_MARKET)?.oiUsd7d;
  if (!(oi !== undefined && oi > 0 && btc !== undefined && btc > 0)) return MIN_USD_SCALE;
  return Math.min(1, Math.max(MIN_USD_SCALE, sig2Down(oi / btc)));
}

/** Największa dźwignia rynku z rejestru (`maxLeverage`); rynek spoza listy — dźwignia BTC (link spoza rejestru otwiera BTC). */
export function maxLeverageOf(coin: string, markets: readonly ChartMarket[]): number {
  const m = markets.find((x) => x.coin === coin) ?? markets.find((x) => x.coin === HOME_MARKET) ?? DEFAULT_MARKETS[0];
  return m.maxLeverage;
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

/** Dopisek „—” przy panelach giełd na rynku bez odpowiednika na Binance i Bybit. */
export const NO_CEX_NOTE = tr('brak na Binance i Bybit', 'not on Binance or Bybit');
export const NO_CEX_BADGE = tr('—, brak na Binance i Bybit', '—, not on Binance or Bybit');
/** Powód „—” paneli giełd na rynku `coin` (bez zapytań do Binance i Bybit). */
export function noCexWhy(coin: string): string {
  return tr(
    `Rynek ${coin} nie ma odpowiednika na Binance i Bybit (panele giełd szukają kontraktu USDT o tej samej nazwie): bez CVD, ΔOI i fundingu giełd, wykres i dane Hyperliquid działają.`,
    `${coin} has no counterpart on Binance or Bybit (the exchange panels look for a USDT contract with the same name): no exchange CVD, ΔOI or funding; the chart and Hyperliquid data work.`
  );
}
