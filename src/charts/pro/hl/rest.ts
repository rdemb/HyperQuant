import { postInfo } from '../../../utils/marketDataFeed';
import {
  AssetCtx,
  BookSnapshot,
  Candle,
  FundingPoint,
  parseBook,
  parseCandles,
  parseFundingHistory,
  pickAssetCtx,
} from './parse';

/**
 * Zapytania REST `/info` wykresu Pro. Wspólny klient `postInfo` desku (limit czasu 8 s, błąd → null).
 * Hyperliquid przechowuje najwyżej ~5000 ostatnich świec na interwał.
 */

export const MAX_CANDLES = 5000;

/** Świece z zakresu [startTime, endTime]; błąd sieci → pusta lista. */
export async function fetchCandles(coin: string, interval: string, startTime: number, endTime?: number): Promise<Candle[]> {
  const req: Record<string, unknown> = { coin, interval, startTime: Math.max(0, Math.floor(startTime)) };
  if (endTime !== undefined) req.endTime = Math.floor(endTime);
  return parseCandles(await postInfo({ type: 'candleSnapshot', req }));
}

export async function fetchAssetCtx(coin: string): Promise<AssetCtx | null> {
  return pickAssetCtx(await postInfo({ type: 'metaAndAssetCtxs' }), coin);
}

export async function fetchBook(coin: string, nSigFigs?: number): Promise<BookSnapshot | null> {
  const body: Record<string, unknown> = { type: 'l2Book', coin };
  if (nSigFigs !== undefined) body.nSigFigs = nSigFigs;
  return parseBook(await postInfo(body), coin);
}

/** Historia finansowania od `startTime` (API zwraca do 500 punktów na zapytanie — dociągamy kolejne strony). */
export async function fetchFunding(coin: string, startTime: number, maxPages = 6): Promise<FundingPoint[]> {
  const out: FundingPoint[] = [];
  let from = Math.floor(startTime);
  for (let page = 0; page < maxPages; page++) {
    const pts = parseFundingHistory(await postInfo({ type: 'fundingHistory', coin, startTime: from }));
    const fresh = pts.filter((p) => out.length === 0 || p.time > out[out.length - 1].time);
    out.push(...fresh);
    if (pts.length < 500 || fresh.length === 0) break;
    from = out[out.length - 1].time + 1;
  }
  return out;
}
