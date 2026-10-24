import {
  BINANCE_OI_PERIOD,
  BYBIT_OI_PERIOD,
  OiPoint,
  VenueBar,
  parseBinanceFunding,
  parseBinanceFundingInfo,
  parseBinanceKlines,
  parseBinanceOi,
  parseBinanceOiHist,
  parseBybitOi,
  symbolOf,
} from './parse';

/**
 * Zapytania REST do publicznych API Binance i Bybit (bez kluczy, CORS dozwolony). Przeglądarka nie widzi nagłówków
 * zużytej wagi, więc tempo trzyma magazyn: historia tylko przy wczytaniu i przewinięciu, odczyty bieżące co 30 s.
 */

const FAPI = 'https://fapi.binance.com';
/** Domena Binance tylko z danymi rynku (te same świece co api.binance.com). */
const SPOT = 'https://data-api.binance.vision';
const BYBIT = 'https://api.bybit.com';

/** Najwięcej świec w jednym zapytaniu: perp 1500, spot 1000. */
export const KLINE_LIMIT = { binance: 1500, binanceSpot: 1000 } as const;
export const BINANCE_OI_LIMIT = 500;
export const BYBIT_OI_LIMIT = 200;

/** GET z limitem czasu 8 s; błąd sieci albo kod ≠ 2xx → null. */
async function getJson(url: string): Promise<unknown> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** Świece kończące się na `endTime` (najnowsze `limit` sztuk), rosnąco; pusta lista = brak starszych, null = błąd. */
export async function fetchBinanceKlines(venue: 'binance' | 'binanceSpot', coin: string, interval: string, endTime: number): Promise<VenueBar[] | null> {
  const base = venue === 'binance' ? `${FAPI}/fapi/v1/klines` : `${SPOT}/api/v3/klines`;
  const q = `symbol=${symbolOf(coin)}&interval=${interval}&endTime=${Math.floor(endTime)}&limit=${KLINE_LIMIT[venue]}`;
  const raw = await getJson(`${base}?${q}`);
  return raw === null ? null : parseBinanceKlines(raw);
}

/** Historia OI Binance kończąca się na `endTime` (najwyżej 30 dni wstecz); null = błąd. */
export async function fetchBinanceOiHist(coin: string, interval: string, endTime: number): Promise<OiPoint[] | null> {
  const q = `symbol=${symbolOf(coin)}&period=${BINANCE_OI_PERIOD[interval]}&endTime=${Math.floor(endTime)}&limit=${BINANCE_OI_LIMIT}`;
  const raw = await getJson(`${FAPI}/futures/data/openInterestHist?${q}`);
  return raw === null ? null : parseBinanceOiHist(raw);
}

/** Historia OI Bybit kończąca się na `endTime`; interwał wykresu krótszy niż 5 min dostaje okres 5 min. Null = błąd. */
export async function fetchBybitOi(coin: string, interval: string, endTime: number): Promise<OiPoint[] | null> {
  const period = BYBIT_OI_PERIOD[BINANCE_OI_PERIOD[interval]];
  const q = `category=linear&symbol=${symbolOf(coin)}&intervalTime=${period}&endTime=${Math.floor(endTime)}&limit=${BYBIT_OI_LIMIT}`;
  const raw = await getJson(`${BYBIT}/v5/market/open-interest?${q}`);
  // Bybit zgłasza błąd kodem w treści (retCode ≠ 0) przy statusie 200
  return raw !== null && typeof raw === 'object' && (raw as { retCode?: unknown }).retCode === 0 ? parseBybitOi(raw) : null;
}

export async function fetchBinanceOi(coin: string): Promise<OiPoint | null> {
  return parseBinanceOi(await getJson(`${FAPI}/fapi/v1/openInterest?symbol=${symbolOf(coin)}`));
}

export async function fetchBinanceFunding(coin: string): Promise<number | null> {
  return parseBinanceFunding(await getJson(`${FAPI}/fapi/v1/premiumIndex?symbol=${symbolOf(coin)}`));
}

export async function fetchBinanceFundingInfo(): Promise<Map<string, number>> {
  return parseBinanceFundingInfo(await getJson(`${FAPI}/fapi/v1/fundingInfo`));
}
