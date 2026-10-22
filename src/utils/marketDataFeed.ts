import { normCdf } from './stats';
import { RangeBar, VolModel, buildVolModel, horizonStepSigmas } from './volatility';
import type { VBar } from './auction';
import { runTouchMonteCarlo } from './touchMc';

export { runTouchMonteCarlo };
import {
  AggrTradeTick,
  BackendQuantTelemetry,
  ExchangeId,
  ExchangeVolumeBreakdown,
  L2OrderbookLevel,
  OHLCVBar,
  WhaleOrderNode,
} from '../types/trading';

const ALL_EXCHANGES: ExchangeId[] = [
  'HYPERLIQUID',
  'BINANCE_FUTURES',
  'BINANCE',
  'BYBIT',
  'COINBASE',
  'OKEX',
  'BITFINEX',
  'DERIBIT',
  'KRAKEN',
  'BITMEX',
  'BITSTAMP',
];

export interface HyperliquidHTFLevels {
  pwh: number;
  pwl: number;
  pwh2: number;
  pwl2: number;
  pdh: number;
  pdl: number;
  dHi: number;
  dLo: number;
}

function createEmptyExchangeBreakdown(): Record<ExchangeId, ExchangeVolumeBreakdown> {
  const rec = {} as Record<ExchangeId, ExchangeVolumeBreakdown>;
  for (const ex of ALL_EXCHANGES) {
    rec[ex] = { vbuy: 0, vsell: 0 };
  }
  return rec;
}

/**
 * Udział wolumenu kupna metodą Bulk Volume Classification (Easley, López de Prado, O'Hara 2012):
 * V_buy / V = Φ(ΔP / σ_ΔP). Świeca HL nie zawiera strony agresora, więc to estymata, nie pomiar.
 */
export function bvcBuyShare(priceChange: number, deltaSigma: number): number {
  if (!(deltaSigma > 0) || !Number.isFinite(priceChange)) return 0.5;
  return normCdf(priceChange / deltaSigma);
}

/**
 * Buduje świecę wyłącznie z realnych danych Hyperliquid (perp): wolumen USD = v·close,
 * podział kupno/sprzedaż estymowany BVC. Brak danych spot, innych giełd i likwidacji → zera.
 */
export function buildHyperliquidBar(
  open: number,
  high: number,
  low: number,
  close: number,
  volumeBtc: number,
  tradeCount: number,
  time: number,
  deltaSigma: number
): OHLCVBar {
  const buyShare = bvcBuyShare(close - open, deltaSigma);
  const usdVol = Number.isFinite(volumeBtc) ? Math.max(0, volumeBtc * close) : 0;
  const vbuy = Math.round(usdVol * buyShare);
  const vsell = Math.round(usdVol * (1 - buyShare));
  const cbuy = Math.round(Math.max(0, tradeCount) * buyShare);

  const exchanges = createEmptyExchangeBreakdown();
  exchanges.HYPERLIQUID = { vbuy, vsell };

  return {
    time,
    open,
    high,
    low,
    close,
    vbuy,
    vsell,
    spotVbuy: 0,
    spotVsell: 0,
    perpVbuy: vbuy,
    perpVsell: vsell,
    lbuy: 0,
    lsell: 0,
    cbuy,
    csell: Math.max(0, Math.round(tradeCount) - cbuy),
    exchanges,
    cvdTotal: 0,
    cvdSpot: 0,
    cvdPerp: 0,
    deltaSpot: 0,
    deltaPerp: 0,
    spotHighVol: false,
    perpHighVol: false,
    keltnerUpper: 0,
    keltnerBasis: 0,
    keltnerLower: 0,
    kalmanEstimate: close,
    kalmanVelocity: 0,
    atr: 0,
  };
}

/** Odchylenie standardowe zmian ceny w świecy (close − open) — σ_ΔP dla BVC. */
function stdOfBodyChanges(rows: { o: number; c: number }[]): number {
  if (rows.length < 2) return 0;
  const d = rows.map((r) => r.c - r.o);
  const m = d.reduce((a, b) => a + b, 0) / d.length;
  return Math.sqrt(d.reduce((a, b) => a + (b - m) * (b - m), 0) / (d.length - 1));
}

/** Parser poziomów L2 z Hyperliquid (REST i WS) — rozmiary dokładnie z API, bez mnożników. */
export function parseL2Levels(
  rawBids: { px: string; sz: string; n: number }[],
  rawAsks: { px: string; sz: string; n: number }[],
  depth: number = 18
): { bids: L2OrderbookLevel[]; asks: L2OrderbookLevel[] } {
  const parse = (rows: { px: string; sz: string; n: number }[]) => {
    let cum = 0;
    const out: L2OrderbookLevel[] = [];
    for (const r of rows.slice(0, depth)) {
      const price = parseFloat(r.px);
      const sizeBtc = parseFloat(r.sz);
      if (!Number.isFinite(price) || !Number.isFinite(sizeBtc)) continue;
      const sizeUsd = Math.round(price * sizeBtc);
      cum += sizeUsd;
      out.push({ price, sizeBtc, sizeUsd, cumulativeUsd: cum, exchangeCount: Math.max(1, r.n) });
    }
    return out;
  };
  return { bids: parse(rawBids), asks: parse(rawAsks) };
}

/**
 * Duże poziomy arkusza (≥ 1.2 BTC albo ≥ 10 zleceń) z 15 najlepszych po każdej stronie — do sceny 3D.
 * Wzorzec to etykieta heurystyczna (liczba zleceń / rozmiar), nie wykrycie zleceń ukrytych: publiczny arkusz ich nie pokazuje.
 */
export function collectWhaleNodes(rawBids: { px: string; sz: string; n: number }[], rawAsks: { px: string; sz: string; n: number }[]): WhaleOrderNode[] {
  const out: WhaleOrderNode[] = [];
  const collect = (rows: { px: string; sz: string; n: number }[], side: 'BID' | 'ASK') => {
    for (const r of rows.slice(0, 15)) {
      const px = parseFloat(r.px);
      const sz = parseFloat(r.sz);
      if (!Number.isFinite(px) || !Number.isFinite(sz)) continue;
      if (sz >= 1.2 || r.n >= 10) {
        out.push({
          price: px,
          side,
          sizeBtc: Number(sz.toFixed(3)),
          sizeUsd: Math.round(px * sz),
          orderCount: r.n,
          pattern: r.n >= 18 ? 'Institutional Iceberg' : sz >= 3.5 ? 'Passive Whale Wall' : 'Liquidity Shield',
        });
      }
    }
  };
  collect(rawBids, 'BID');
  collect(rawAsks, 'ASK');
  return out;
}

/** Mapuje surową transakcję z kanału WS `trades` na tick — realny rozmiar, bez podłóg. */
export function mapHyperliquidTrade(tr: {
  px: string;
  sz: string;
  side: string;
  time: number;
  tid?: number | string;
}): AggrTradeTick | null {
  const px = parseFloat(tr.px);
  const sz = parseFloat(tr.sz);
  if (!Number.isFinite(px) || !Number.isFinite(sz) || px <= 0 || sz <= 0) return null;
  const sizeUsd = Math.round(px * sz);
  return {
    // tid z API pozwala odrzucić duplikaty (np. powtórzenie po ponownym połączeniu)
    id: tr.tid !== undefined ? `hl-${tr.time}-${tr.tid}` : `hl-${tr.time}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: tr.time || Date.now(),
    exchange: 'HYPERLIQUID',
    market: 'BTC-USD-PERP',
    isPerp: true,
    side: tr.side === 'B' ? 'buy' : 'sell',
    price: px,
    sizeUsd,
    sizeBtc: Number(sz.toFixed(4)),
    isLiquidation: false,
    tier: classifyAggrThresholdTier(sizeUsd, true, false),
  };
}

/**
 * Dokłada transakcje z WS do świec z rolloverem: transakcja po granicy interwału otwiera
 * nową świecę (OHLC = cena). Transakcje spóźnione trafiają do swojej świecy, jeśli istnieje.
 * Zwraca nową tablicę (bez mutacji wejścia) z przeliczonymi wskaźnikami.
 */
export function applyLiveTradesToBars(
  bars: OHLCVBar[],
  ticks: AggrTradeTick[],
  timeframeSec: number,
  maxBars: number = 145,
  options: { updatePrice?: boolean } = {}
): OHLCVBar[] {
  // updatePrice=false: ticki z innych giełd (CEX) dokładają wolumen, ale nie zmieniają OHLC świecy HL
  const updatePrice = options.updatePrice ?? true;
  if (bars.length === 0 || ticks.length === 0) return bars;
  const tfMs = timeframeSec * 1000;
  const updated = [...bars];
  const touched = new Set<number>();

  for (const tick of ticks) {
    const barTime = Math.floor(tick.timestamp / tfMs) * tfMs;
    let idx = updated.length - 1;
    if (barTime > updated[idx].time) {
      const exchanges = createEmptyExchangeBreakdown();
      // Nowa świeca z tickiem CEX: OHLC = ostatnie zamknięcie HL (cena innej giełdy nie wchodzi do świecy)
      const px = updatePrice ? tick.price : updated[idx].close;
      updated.push({
        ...updated[idx],
        time: barTime,
        open: px,
        high: px,
        low: px,
        close: px,
        vbuy: 0,
        vsell: 0,
        spotVbuy: 0,
        spotVsell: 0,
        perpVbuy: 0,
        perpVsell: 0,
        lbuy: 0,
        lsell: 0,
        cbuy: 0,
        csell: 0,
        exchanges,
        realFlow: false,
      });
      idx = updated.length - 1;
      touched.add(idx);
    } else {
      while (idx > 0 && updated[idx].time > barTime) idx--;
      if (updated[idx].time !== barTime) continue;
    }

    if (!touched.has(idx)) {
      updated[idx] = { ...updated[idx], exchanges: { ...updated[idx].exchanges } };
      touched.add(idx);
    }
    const bar = updated[idx];
    const isLast = idx === updated.length - 1;
    if (updatePrice) {
      if (isLast) bar.close = tick.price;
      if (tick.price > bar.high) bar.high = tick.price;
      if (tick.price < bar.low) bar.low = tick.price;
    }

    // Likwidacje są też w strumieniu transakcji giełdy — liczymy je tylko w lbuy/lsell (bez podwójnego wolumenu)
    if (tick.isLiquidation) {
      if (tick.side === 'buy') bar.lbuy += tick.sizeUsd;
      else bar.lsell += tick.sizeUsd;
      continue;
    }

    const ex = { ...(bar.exchanges[tick.exchange] ?? { vbuy: 0, vsell: 0 }) };
    if (tick.side === 'buy') {
      bar.vbuy += tick.sizeUsd;
      bar.cbuy += 1;
      if (tick.isPerp) bar.perpVbuy += tick.sizeUsd;
      else bar.spotVbuy += tick.sizeUsd;
      ex.vbuy += tick.sizeUsd;
    } else {
      bar.vsell += tick.sizeUsd;
      bar.csell += 1;
      if (tick.isPerp) bar.perpVsell += tick.sizeUsd;
      else bar.spotVsell += tick.sizeUsd;
      ex.vsell += tick.sizeUsd;
    }
    bar.exchanges[tick.exchange] = ex;
  }

  return recalculateIndicatorSeries(updated.slice(-maxBars));
}

/**
 * Nakłada realny podział agresora (zebrany z WS dla danej świecy) na pełny wolumen świecy z REST.
 * Świece bez danych z WS zostają z estymatą BVC.
 */
export function applyRealFlowSplit(
  bars: OHLCVBar[],
  flowByBarTime: Map<number, { buy: number; sell: number }>
): OHLCVBar[] {
  if (flowByBarTime.size === 0) return bars;
  const out = bars.map((b) => {
    const f = flowByBarTime.get(b.time);
    if (!f || f.buy + f.sell <= 0) return b;
    const total = b.vbuy + b.vsell;
    const share = f.buy / (f.buy + f.sell);
    const vbuy = Math.round(total * share);
    const vsell = Math.round(total - vbuy);
    return {
      ...b,
      vbuy,
      vsell,
      perpVbuy: vbuy,
      perpVsell: vsell,
      exchanges: { ...b.exchanges, HYPERLIQUID: { vbuy, vsell } },
      realFlow: true,
    };
  });
  return recalculateIndicatorSeries(out);
}

/**
 * Computes exact AggrBTCv5 indicator series across OHLCV bars:
 * - CVD Total, CVD BTC Spot, CVD BTC Perp
 * - Delta Spot & Delta Perps with exact AggrBTCv5 variance threshold:
 *   a = sma(Math.pow(volume,2), 14)
 *   b = Math.pow(sum(volume,14),2) / Math.pow(14,2)
 *   stdev = Math.sqrt(a - b)
 *   threshold = sma(volume, 14) + stdev
 * - Keltner Channel (EMA basis + mult * SMA(range))
 * - 2D Kalman Filter State-Space Estimate & Velocity
 * - RMA(14) ATR for Shaakuni Order Blocks
 */
/** Przepływ z innych giełd per świeca i giełda (realne ticki CEX, opt-in). */
export type VenueFlowMap = Map<
  number,
  Map<ExchangeId, { buy: number; sell: number; isPerp: boolean; liqBuy?: number; liqSell?: number }>
>;

/**
 * Dokłada realny przepływ z innych giełd do świec z REST (które zawierają tylko wolumen HL),
 * żeby odświeżenie REST nie kasowało danych CEX. Zwraca nowe obiekty świec.
 */
export function applyVenueFlow(bars: OHLCVBar[], venueFlow: VenueFlowMap): OHLCVBar[] {
  if (venueFlow.size === 0) return bars;
  const out = bars.map((b) => {
    const venues = venueFlow.get(b.time);
    if (!venues || venues.size === 0) return b;
    const nb: OHLCVBar = { ...b, exchanges: { ...b.exchanges } };
    venues.forEach((f, ex) => {
      nb.lbuy += f.liqBuy ?? 0;
      nb.lsell += f.liqSell ?? 0;
      nb.vbuy += f.buy;
      nb.vsell += f.sell;
      if (f.isPerp) {
        nb.perpVbuy += f.buy;
        nb.perpVsell += f.sell;
      } else {
        nb.spotVbuy += f.buy;
        nb.spotVsell += f.sell;
      }
      const prev = nb.exchanges[ex] ?? { vbuy: 0, vsell: 0 };
      nb.exchanges[ex] = { vbuy: prev.vbuy + f.buy, vsell: prev.vsell + f.sell };
    });
    return nb;
  });
  return recalculateIndicatorSeries(out);
}

export function recalculateIndicatorSeries(bars: OHLCVBar[]): OHLCVBar[] {
  if (bars.length === 0) return bars;
  let cvdTotal = 0;
  let cvdSpot = 0;
  let cvdPerp = 0;
  let emaClose = bars[0].close;
  let atr = Math.max(15, bars[0].high - bars[0].low);

  let kalmanX = bars[0].close;
  let kalmanV = 0;
  let p00 = 10;
  let p01 = 0;
  let p10 = 0;
  let p11 = 1;

  const length = 14;
  const keltnerLen = Math.min(40, bars.length);

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const deltaSpot = b.spotVbuy - b.spotVsell;
    const deltaPerp = b.perpVbuy - b.perpVsell;
    const deltaTotal = b.vbuy - b.vsell;

    cvdTotal += deltaTotal;
    cvdSpot += deltaSpot;
    cvdPerp += deltaPerp;

    b.deltaSpot = deltaSpot;
    b.deltaPerp = deltaPerp;
    b.cvdTotal = cvdTotal;
    b.cvdSpot = cvdSpot;
    b.cvdPerp = cvdPerp;

    const prevClose = i > 0 ? bars[i - 1].close : b.open;
    const tr = Math.max(
      b.high - b.low,
      Math.abs(b.high - prevClose),
      Math.abs(b.low - prevClose)
    );
    atr = i === 0 ? tr : (atr * 13 + tr) / 14;
    b.atr = Math.max(12, atr);

    const winStart = Math.max(0, i - length + 1);
    const winCount = i - winStart + 1;
    let sumSpotVol = 0;
    let sumSpotVol2 = 0;
    let sumPerpVol = 0;
    let sumPerpVol2 = 0;

    for (let j = winStart; j <= i; j++) {
      const sVol = bars[j].spotVbuy + bars[j].spotVsell;
      const pVol = bars[j].perpVbuy + bars[j].perpVsell;
      sumSpotVol += sVol;
      sumSpotVol2 += sVol * sVol;
      sumPerpVol += pVol;
      sumPerpVol2 += pVol * pVol;
    }

    const spotA = sumSpotVol2 / winCount;
    const spotB = (sumSpotVol * sumSpotVol) / (winCount * winCount);
    const spotStdev = Math.sqrt(Math.max(0, spotA - spotB));
    const spotThreshold = sumSpotVol / winCount + spotStdev;
    b.spotHighVol = b.spotVbuy + b.spotVsell > spotThreshold;

    const perpA = sumPerpVol2 / winCount;
    const perpB = (sumPerpVol * sumPerpVol) / (winCount * winCount);
    const perpStdev = Math.sqrt(Math.max(0, perpA - perpB));
    const perpThreshold = sumPerpVol / winCount + perpStdev;
    b.perpHighVol = b.perpVbuy + b.perpVsell > perpThreshold;

    const kAlpha = 2 / (keltnerLen + 1);
    emaClose = i === 0 ? b.close : b.close * kAlpha + emaClose * (1 - kAlpha);
    b.keltnerBasis = emaClose;
    b.keltnerUpper = emaClose + b.atr * 2.35;
    b.keltnerLower = emaClose - b.atr * 2.35;

    // Predykcja: F = [[1, 1], [0, φ]], P' = F·P·Fᵀ + Q (tłumienie φ także w kowariancji)
    const phi = 0.92;
    const predX = kalmanX + kalmanV;
    const predV = kalmanV * phi;
    const a00 = p00 + p01 + p10 + p11 + 1.5;
    const a01 = phi * (p01 + p11);
    const a10 = phi * (p10 + p11);
    const a11 = phi * phi * p11 + 0.4;

    const rNoise = Math.max(10, b.atr * 0.35);
    const sInnov = a00 + rNoise;
    const k0 = a00 / sInnov;
    const k1 = a10 / sInnov;
    const yDiff = b.close - predX;

    kalmanX = predX + k0 * yDiff;
    kalmanV = predV + k1 * yDiff;
    // Aktualizacja P = (I − K·H)·P' liczona wyłącznie z wartości predykcji (bez nadpisywania w trakcie)
    p00 = (1 - k0) * a00;
    p01 = (1 - k0) * a01;
    p10 = a10 - k1 * a00;
    p11 = a11 - k1 * a01;

    b.kalmanEstimate = kalmanX;
    b.kalmanVelocity = kalmanV;
  }

  return bars;
}

/**
 * Zmienność logarytmiczna w zadanym horyzoncie z estymatora Parkinsona (high/low):
 * σ²_bar = ln(H/L)² / (4·ln2), skalowane do horyzontu √(horizon / tf).
 */
export function parkinsonSigma(
  bars: OHLCVBar[],
  horizonSec: number,
  timeframeSec: number,
  lookback: number = 60
): number {
  const slice = bars.slice(-lookback).filter((b) => b.high > 0 && b.low > 0 && b.high >= b.low);
  if (slice.length === 0) return 0;
  const varBar =
    slice.reduce((acc, b) => acc + Math.log(b.high / b.low) ** 2, 0) / (4 * Math.LN2 * slice.length);
  return Math.sqrt(varBar * (horizonSec / timeframeSec));
}

const HL_INFO_URL = 'https://api.hyperliquid.xyz/info';
const HTF_CACHE_TTL_MS = 5 * 60 * 1000;
let htfCache: { at: number; daily: unknown; weekly: unknown } | null = null;

/** Tylko dla testów: czyści cache świec 1d/1w. */
export function resetHtfCacheForTests(): void {
  htfCache = null;
}

export function postInfo(body: unknown): Promise<unknown> {
  // Limit czasu 8 s — wiszące zapytanie nie blokuje kolejnych synchronizacji
  const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(8000) : undefined;
  return fetch(HL_INFO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}

/** Liczba skończona z pola API albo NaN — bez podmiany zera na wartość domyślną. */
function finiteOrNaN(v: unknown): number {
  const x = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(x) ? x : Number.NaN;
}

/** Świece `candleSnapshot` → RangeBar; rekordy z nieskończonymi polami są pomijane. */
export function parseHlCandles(raw: unknown): RangeBar[] {
  if (!Array.isArray(raw)) return [];
  const out: RangeBar[] = [];
  for (const c of raw as Record<string, unknown>[]) {
    const b = { time: finiteOrNaN(c?.t), open: finiteOrNaN(c?.o), high: finiteOrNaN(c?.h), low: finiteOrNaN(c?.l), close: finiteOrNaN(c?.c) };
    if ([b.time, b.open, b.high, b.low, b.close].every(Number.isFinite)) out.push(b);
  }
  return out;
}

/** Jak `parseHlCandles`, z wolumenem świecy (BTC, pole `v`); rekord bez skończonego wolumenu jest pomijany. */
export function parseHlCandlesV(raw: unknown): VBar[] {
  if (!Array.isArray(raw)) return [];
  const out: VBar[] = [];
  for (const c of raw as Record<string, unknown>[]) {
    const b = {
      time: finiteOrNaN(c?.t),
      open: finiteOrNaN(c?.o),
      high: finiteOrNaN(c?.h),
      low: finiteOrNaN(c?.l),
      close: finiteOrNaN(c?.c),
      volume: finiteOrNaN(c?.v),
    };
    if ([b.time, b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite)) out.push(b);
  }
  return out;
}

/** Świece BTC z wolumenem od `fromMs` (interwał HL: '1m', '1h'…; API zwraca najwyżej ~5000 ostatnich). Błąd → pusta lista. */
export async function loadCandlesV(interval: string, fromMs: number): Promise<VBar[]> {
  return parseHlCandlesV(await postInfo({ type: 'candleSnapshot', req: { coin: 'BTC', interval, startTime: fromMs } }));
}

/**
 * Świece BTC 1m od `fromMs` (do rozstrzygania dziennika niezależnie od interwału wykresu; API zwraca najwyżej ~5000
 * ostatnich ≈ 3.5 dnia). Błąd lub brak danych → pusta lista.
 */
export async function loadMinuteCandles(fromMs: number): Promise<RangeBar[]> {
  return parseHlCandles(await postInfo({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '1m', startTime: fromMs } }));
}

/** Hyperliquid zwraca najwyżej ~5000 ostatnich świec na interwał (≈ 208 dni 1h, ≈ 17 dni 5m). */
const VOL_CANDLES = 5000;

/**
 * Dane modelu zmienności: BTC 1h i 5m z `candleSnapshot` (waga ≈ 20 + 5000/60 każde) → `buildVolModel`.
 * Brak lub za mało danych → null (desk wraca wtedy do σ Parkinsona i to oznacza).
 */
export async function loadVolModel(nowMs: number = Date.now()): Promise<VolModel | null> {
  const [h, f] = await Promise.all([
    postInfo({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '1h', startTime: nowMs - VOL_CANDLES * 3_600_000 } }),
    postInfo({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '5m', startTime: nowMs - VOL_CANDLES * 300_000 } }),
  ]);
  return buildVolModel(parseHlCandles(h), parseHlCandles(f), nowMs);
}

/**
 * Pobiera z publicznego API Hyperliquid: świece, poziomy HTF (1d/1w, cache 5 min), opcjonalnie L2
 * oraz `metaAndAssetCtxs`. Brak danych = null — nigdy zakodowane „live” wartości zastępcze.
 */
export async function fetchRealHyperliquidMarketData(
  timeframeSec: number = 300,
  options: { includeL2Book?: boolean; volModel?: VolModel | null } = {}
): Promise<{
  bars: OHLCVBar[];
  htfLevels: HyperliquidHTFLevels | null;
  l2Book: { bids: L2OrderbookLevel[]; asks: L2OrderbookLevel[] } | null;
  liveTelemetry: BackendQuantTelemetry | null;
}> {
  const includeL2Book = options.includeL2Book ?? true;
  const intervalMap: Record<number, string> = {
    60: '1m',
    300: '5m',
    900: '15m',
    3600: '1h',
    14400: '4h',
  };
  const hlInterval = intervalMap[timeframeSec] ?? '5m';
  const now = Date.now();
  const startTime = now - timeframeSec * 1000 * 165;
  const htfFresh = htfCache !== null && now - htfCache.at < HTF_CACHE_TTL_MS;

  const [candlesRes, dailyFetched, weeklyFetched, l2Res, metaCtxRes] = await Promise.all([
    postInfo({ type: 'candleSnapshot', req: { coin: 'BTC', interval: hlInterval, startTime } }),
    htfFresh
      ? Promise.resolve(null)
      : postInfo({
          type: 'candleSnapshot',
          req: { coin: 'BTC', interval: '1d', startTime: now - 86400 * 1000 * 10 },
        }),
    htfFresh
      ? Promise.resolve(null)
      : postInfo({
          type: 'candleSnapshot',
          req: { coin: 'BTC', interval: '1w', startTime: now - 86400 * 1000 * 35 },
        }),
    includeL2Book ? postInfo({ type: 'l2Book', coin: 'BTC' }) : Promise.resolve(null),
    postInfo({ type: 'metaAndAssetCtxs' }),
  ]);

  if (!htfFresh && Array.isArray(dailyFetched) && Array.isArray(weeklyFetched)) {
    htfCache = { at: now, daily: dailyFetched, weekly: weeklyFetched };
  }
  const dailyRes = htfFresh ? htfCache!.daily : dailyFetched;
  const weeklyRes = htfFresh ? htfCache!.weekly : weeklyFetched;

  let parsedBars: OHLCVBar[] = [];
  if (Array.isArray(candlesRes) && candlesRes.length > 15) {
    const rows = (candlesRes as { t: number; o: string; h: string; l: string; c: string; v: string; n: number }[])
      .slice(-145)
      .map((c) => ({
        t: c.t,
        o: finiteOrNaN(c.o),
        h: finiteOrNaN(c.h),
        l: finiteOrNaN(c.l),
        c: finiteOrNaN(c.c),
        v: finiteOrNaN(c.v),
        n: Number.isFinite(c.n) ? c.n : 0,
      }))
      .filter((r) => Number.isFinite(r.o) && Number.isFinite(r.h) && Number.isFinite(r.l) && Number.isFinite(r.c));
    const deltaSigma = stdOfBodyChanges(rows);
    parsedBars = recalculateIndicatorSeries(
      rows.map((r) => buildHyperliquidBar(r.o, r.h, r.l, r.c, r.v, r.n, r.t, deltaSigma))
    );
  }

  let htfLevels: HyperliquidHTFLevels | null = null;
  if (
    Array.isArray(dailyRes) &&
    dailyRes.length >= 2 &&
    Array.isArray(weeklyRes) &&
    weeklyRes.length >= 2
  ) {
    const todayCandle = dailyRes[dailyRes.length - 1];
    const prevDayCandle = dailyRes[dailyRes.length - 2];
    const prevWeekCandle = weeklyRes[weeklyRes.length - 2];
    const prevWeek2Candle =
      weeklyRes.length >= 3 ? weeklyRes[weeklyRes.length - 3] : prevWeekCandle;

    const levels: HyperliquidHTFLevels = {
      pdh: finiteOrNaN(prevDayCandle.h),
      pdl: finiteOrNaN(prevDayCandle.l),
      dHi: finiteOrNaN(todayCandle.h),
      dLo: finiteOrNaN(todayCandle.l),
      pwh: finiteOrNaN(prevWeekCandle.h),
      pwl: finiteOrNaN(prevWeekCandle.l),
      pwh2: finiteOrNaN(prevWeek2Candle.h),
      pwl2: finiteOrNaN(prevWeek2Candle.l),
    };
    if (Number.isFinite(levels.pdh) && Number.isFinite(levels.pdl)) htfLevels = levels;
  }

  let l2Book: { bids: L2OrderbookLevel[]; asks: L2OrderbookLevel[] } | null = null;
  const whaleNodes: WhaleOrderNode[] = [];

  const l2 = l2Res as { levels?: { px: string; sz: string; n: number }[][] } | null;
  if (l2 && Array.isArray(l2.levels) && l2.levels.length === 2) {
    const rawBids = l2.levels[0] || [];
    const rawAsks = l2.levels[1] || [];
    const parsed = parseL2Levels(rawBids, rawAsks);

    whaleNodes.push(...collectWhaleNodes(rawBids, rawAsks));

    if (parsed.bids.length > 0 && parsed.asks.length > 0) {
      l2Book = parsed;
    }
  }

  // Telemetria tylko z kompletnych, realnych danych: kontekst BTC + świece + poziomy HTF
  let btcCtx: Record<string, unknown> | null = null;
  const meta = metaCtxRes as [{ universe?: { name: string }[] }, Record<string, unknown>[]] | null;
  if (Array.isArray(meta) && meta.length >= 2 && Array.isArray(meta[0]?.universe) && Array.isArray(meta[1])) {
    const btcIdx = meta[0].universe!.findIndex((u) => u.name === 'BTC');
    if (btcIdx >= 0 && meta[1][btcIdx]) btcCtx = meta[1][btcIdx];
  }

  let liveTelemetry: BackendQuantTelemetry | null = null;
  if (btcCtx && parsedBars.length > 20 && htfLevels) {
    const markPrice = finiteOrNaN(btcCtx.markPx);
    const oraclePrice = finiteOrNaN(btcCtx.oraclePx);
    const midPrice = Number.isFinite(finiteOrNaN(btcCtx.midPx)) ? finiteOrNaN(btcCtx.midPx) : markPrice;
    const openInterestBtc = finiteOrNaN(btcCtx.openInterest);
    const funding1h = finiteOrNaN(btcCtx.funding);
    const dayVolumeUsd = finiteOrNaN(btcCtx.dayNtlVlm);

    if ([markPrice, oraclePrice, openInterestBtc, funding1h].every(Number.isFinite)) {
      const basisBps = Number((((markPrice - oraclePrice) / oraclePrice) * 10000).toFixed(2));
      const deq = (htfLevels.pdh + htfLevels.pdl) * 0.5;
      const sigma2h = parkinsonSigma(parsedBars, 7200, timeframeSec);

      liveTelemetry = {
        timestamp: now,
        markPrice,
        oraclePrice,
        midPrice,
        openInterestBtc: Number(openInterestBtc.toFixed(2)),
        openInterestUsd: Math.round(openInterestBtc * markPrice),
        dayVolumeUsd: Number.isFinite(dayVolumeUsd) ? Math.round(dayVolumeUsd) : 0,
        funding1hPct: Number((funding1h * 100).toFixed(5)),
        fundingAnnualizedPct: Number((funding1h * 24 * 365 * 100).toFixed(2)),
        basisBps,
        whaleNodes: whaleNodes.slice(0, 12),
        monteCarlo: runTouchMonteCarlo(midPrice, htfLevels.pdh, htfLevels.pdl, deq, sigma2h, {
          stepSigmas: options.volModel ? horizonStepSigmas(options.volModel, now, 120) : undefined,
          residuals: options.volModel?.residuals ?? null,
          nowMs: now,
        }),
      };
    }
  }

  return { bars: parsedBars, htfLevels, l2Book, liveTelemetry };
}

export function classifyAggrThresholdTier(
  sizeUsd: number,
  isPerp: boolean,
  isLiquidation: boolean
): AggrTradeTick['tier'] {
  if (isLiquidation) {
    if (sizeUsd >= 500000) return 'rare';
    if (sizeUsd >= 100000) return 'huge';
    if (sizeUsd >= 50000) return 'significant';
    if (sizeUsd >= 10000) return 'threshold';
    return 'normal';
  }
  if (isPerp) {
    if (sizeUsd >= 2000000) return 'rare';
    if (sizeUsd >= 930000) return 'huge';
    if (sizeUsd >= 430000) return 'significant';
    if (sizeUsd >= 48000) return 'threshold';
    return 'normal';
  } else {
    if (sizeUsd >= 433000) return 'rare';
    if (sizeUsd >= 93000) return 'huge';
    if (sizeUsd >= 43000) return 'significant';
    if (sizeUsd >= 5000) return 'threshold';
    return 'normal';
  }
}
