/**
 * Publiczne dane Binance (USDT-M i Spot) i Bybit (Linear) dla paneli „CVD giełd” i „ΔOI giełd”: symbole, okresy
 * historii i czyste parsery odpowiedzi REST oraz wiadomości WebSocket (kształty sprawdzone na żywo 24.10.2026).
 */

/** Giełdy z deltą świec: Binance perp i spot ze świec, Bybit perp z transakcji na żywo. */
export type FlowVenue = 'binance' | 'binanceSpot' | 'bybit';
/** Giełdy z otwartymi pozycjami i finansowaniem. */
export type OiVenue = 'binance' | 'bybit';

/** Wolumen świecy i kupno biorców (jednostki rynku); delta = 2 × kupno − wolumen. */
export interface VenueBar {
  t: number;
  v: number;
  buy: number;
}

export interface VenueTrade {
  t: number;
  sz: number;
  /** Biorca kupuje. */
  buy: boolean;
}

/** Odczyt otwartych pozycji: [czas, pozycje w jednostkach rynku]. */
export type OiPoint = [number, number];

export const symbolOf = (coin: string): string => `${coin}USDT`;

const MIN = 60_000;

/** Okres historii OI Binance (`openInterestHist`) dla interwału wykresu — najkrótszy dostępny to 5 min, najdłuższy 1 dzień. */
export const BINANCE_OI_PERIOD: Record<string, string> = { '1m': '5m', '3m': '5m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1d', '1M': '1d' };
/** Okres historii OI Bybit (`open-interest`) w nazwach Bybit. */
export const BYBIT_OI_PERIOD: Record<string, string> = { '5m': '5min', '15m': '15min', '30m': '30min', '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1d', '1M': '1d' };
export const OI_PERIOD_MS: Record<string, number> = { '5m': 5 * MIN, '15m': 15 * MIN, '30m': 30 * MIN, '1h': 60 * MIN, '4h': 240 * MIN, '1d': 1440 * MIN };
/** Historia OI giełd co 5 min i dłużej: odczyt do dwóch okresów wstecz nadal opisuje świecę interwału. */
export const oiMaxAge = (interval: string): number => 2 * OI_PERIOD_MS[BINANCE_OI_PERIOD[interval]];

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : Number.NaN);

function bar(t: number, v: number, buy: number): VenueBar | null {
  return Number.isFinite(t) && t > 0 && v >= 0 && buy >= 0 ? { t, v, buy } : null;
}

/** Świece Binance REST: [openTime, o, h, l, c, wolumen, closeTime, obrót, transakcje, kupno biorców, …], rosnąco. */
export function parseBinanceKlines(raw: unknown): VenueBar[] {
  if (!Array.isArray(raw)) return [];
  const out: VenueBar[] = [];
  for (const r of raw) {
    const b = Array.isArray(r) ? bar(num(r[0]), num(r[5]), num(r[9])) : null;
    if (b) out.push(b);
  }
  return out;
}

/** Świeca z WebSocketu Binance (`<symbol>@kline_<interwał>`, także opakowana w {stream, data}). */
export function parseBinanceKlineMsg(msg: unknown): { symbol: string; interval: string; bar: VenueBar } | null {
  const d = isRec(msg) && isRec(msg.data) ? msg.data : msg;
  if (!isRec(d) || d.e !== 'kline' || !isRec(d.k)) return null;
  const k = d.k;
  const b = bar(num(k.t), num(k.v), num(k.V));
  return b && typeof k.s === 'string' && typeof k.i === 'string' ? { symbol: k.s, interval: k.i, bar: b } : null;
}

/** Transakcje Bybit (`publicTrade.<symbol>`): S to strona biorcy. */
export function parseBybitTrades(msg: unknown): { symbol: string; trades: VenueTrade[] } | null {
  if (!isRec(msg) || typeof msg.topic !== 'string' || !msg.topic.startsWith('publicTrade.') || !Array.isArray(msg.data)) return null;
  const trades: VenueTrade[] = [];
  for (const x of msg.data) {
    if (!isRec(x)) continue;
    const t = num(x.T);
    const sz = num(x.v);
    if (Number.isFinite(t) && sz > 0 && (x.S === 'Buy' || x.S === 'Sell')) trades.push({ t, sz, buy: x.S === 'Buy' });
  }
  return { symbol: msg.topic.slice('publicTrade.'.length), trades };
}

/** Pola tickera Bybit (`tickers.<symbol>`): pierwsza wiadomość pełna, kolejne tylko ze zmienionymi polami. */
export interface BybitTicker {
  symbol: string;
  time: number;
  oi?: number;
  funding?: number;
  intervalH?: number;
}

export function parseBybitTicker(msg: unknown): BybitTicker | null {
  if (!isRec(msg) || typeof msg.topic !== 'string' || !msg.topic.startsWith('tickers.') || !isRec(msg.data)) return null;
  const d = msg.data;
  const out: BybitTicker = { symbol: msg.topic.slice('tickers.'.length), time: num(msg.ts) };
  const oi = num(d.openInterest);
  const funding = num(d.fundingRate);
  const h = num(d.fundingIntervalHour);
  if (oi > 0) out.oi = oi;
  if (Number.isFinite(funding)) out.funding = funding;
  if (h > 0) out.intervalH = h;
  return out;
}

/** Historia OI Binance (`/futures/data/openInterestHist`, rosnąco): sumOpenInterest w jednostkach rynku. */
export function parseBinanceOiHist(raw: unknown): OiPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: OiPoint[] = [];
  for (const x of raw) {
    if (!isRec(x)) continue;
    const t = num(x.timestamp);
    const oi = num(x.sumOpenInterest);
    if (t > 0 && oi > 0) out.push([t, oi]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Historia OI Bybit (`/v5/market/open-interest`, od najnowszych) — zwracana rosnąco. */
export function parseBybitOi(raw: unknown): OiPoint[] {
  const list = isRec(raw) && isRec(raw.result) && Array.isArray(raw.result.list) ? raw.result.list : [];
  const out: OiPoint[] = [];
  for (const x of list) {
    if (!isRec(x)) continue;
    const t = num(x.timestamp);
    const oi = num(x.openInterest);
    if (t > 0 && oi > 0) out.push([t, oi]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Bieżące OI Binance (`/fapi/v1/openInterest`). */
export function parseBinanceOi(raw: unknown): OiPoint | null {
  if (!isRec(raw)) return null;
  const t = num(raw.time);
  const oi = num(raw.openInterest);
  return t > 0 && oi > 0 ? [t, oi] : null;
}

/** Bieżąca stopa finansowania Binance (`/fapi/v1/premiumIndex`, pole lastFundingRate = stopa najbliższego rozliczenia). */
export function parseBinanceFunding(raw: unknown): number | null {
  const r = isRec(raw) ? num(raw.lastFundingRate) : Number.NaN;
  return Number.isFinite(r) ? r : null;
}

/** Rozliczenia finansowania Binance (`/fapi/v1/fundingRate`): czas wypłaty i stawka okresu, rosnąco. */
export function parseBinanceFundingHist(raw: unknown): { time: number; rate: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { time: number; rate: number }[] = [];
  for (const x of raw) {
    if (!isRec(x)) continue;
    const time = num(x.fundingTime);
    const rate = num(x.fundingRate);
    if (time > 0 && Number.isFinite(rate)) out.push({ time, rate });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Rynki Binance z niestandardowym okresem finansowania (`/fapi/v1/fundingInfo`): symbol → godziny; reszta co 8 h. */
export function parseBinanceFundingInfo(raw: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(raw)) return out;
  for (const x of raw) {
    const h = isRec(x) ? num(x.fundingIntervalHours) : Number.NaN;
    if (isRec(x) && typeof x.symbol === 'string' && h > 0) out.set(x.symbol, h);
  }
  return out;
}

/** Stopa finansowania przeliczona na 8 h (Hyperliquid rozlicza co godzinę, Binance HYPE co 4 h). */
export const per8h = (rate: number, intervalH: number): number => (rate * 8) / intervalH;
