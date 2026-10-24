/**
 * Walidacja surowych danych publicznego API Hyperliquid (REST `/info` i WebSocket).
 * Każdy parser zwraca null albo pomija rekord z niepoprawnym polem — nigdy liczby zastępczej.
 */

/** Strona agresora: 1 = agresywne kupno (zdejmuje ask, `side: 'B'`), −1 = agresywna sprzedaż (uderza w bid, `side: 'A'`). */
export type Side = 1 | -1;

/** Pojedyncze wypełnienie z taśmy (kanał `trades`). */
export interface Fill {
  /** Czas bloku (ms, zegar serwera). */
  time: number;
  px: number;
  /** Wielkość w jednostkach bazowych (BTC). */
  sz: number;
  side: Side;
  tid: number;
  /** Hash transakcji; wypełnienia jednego zlecenia agresora dzielą hash. */
  hash: string;
  /** Adres agresora (biorcy) — tylko w pamięci, do złożenia zlecenia; nigdy nie jest zapisywany ani pokazywany. */
  taker: string;
}

export interface Candle {
  /** Początek świecy (ms). */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** Wolumen (BTC). */
  v: number;
  /** Liczba transakcji. */
  n: number;
}

export interface BookLevel {
  px: number;
  sz: number;
  /** Liczba zleceń na poziomie. */
  n: number;
}

export interface BookSnapshot {
  time: number;
  bids: BookLevel[];
  asks: BookLevel[];
}

export interface AssetCtx {
  markPx: number;
  oraclePx: number;
  midPx: number;
  /** Stawka finansowania za godzinę (ułamek). */
  funding: number;
  /** Open interest (BTC). */
  openInterest: number;
  premium: number;
  /** Wolumen 24 h (USD). */
  dayNtlVlm: number;
  prevDayPx: number;
}

export interface FundingPoint {
  time: number;
  /** Stawka godzinowa (ułamek). */
  rate: number;
  premium: number;
}

const ZERO_HASH = /^0x0+$/;

/** Liczba z pola API (liczba albo tekst); NaN, gdy pole nie jest skończoną liczbą. */
export function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : Number.NaN;
  if (typeof v === 'string' && v.trim() !== '') {
    const x = Number(v);
    return Number.isFinite(x) ? x : Number.NaN;
  }
  return Number.NaN;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Czy hash identyfikuje transakcję (hash zerowy mają m.in. wypełnienia TWAP — nie łączymy po nim). */
export function isUsableHash(hash: string): boolean {
  return hash.length > 2 && !ZERO_HASH.test(hash);
}

/** Wypełnienie z kanału `trades`; null dla niepełnego rekordu albo innej monety. */
export function parseFill(raw: unknown, coin: string): Fill | null {
  if (!isRecord(raw)) return null;
  if (raw.coin !== undefined && raw.coin !== coin) return null;
  const px = num(raw.px);
  const sz = num(raw.sz);
  const time = num(raw.time);
  const tid = num(raw.tid);
  if (!(px > 0) || !(sz > 0) || !(time > 0) || !Number.isFinite(tid)) return null;
  let side: Side;
  if (raw.side === 'B') side = 1;
  else if (raw.side === 'A') side = -1;
  else return null;
  const hash = typeof raw.hash === 'string' ? raw.hash : '';
  let taker = '';
  if (Array.isArray(raw.users) && raw.users.length === 2) {
    // users = [kupujący, sprzedający]; agresorem jest strona zgodna z `side`
    const u = side === 1 ? raw.users[0] : raw.users[1];
    if (typeof u === 'string') taker = u;
  }
  return { time, px, sz, side, tid, hash, taker };
}

export function parseFills(raw: unknown, coin: string): Fill[] {
  if (!Array.isArray(raw)) return [];
  const out: Fill[] = [];
  for (const r of raw) {
    const f = parseFill(r, coin);
    if (f) out.push(f);
  }
  return out;
}

/** Świeca z `candleSnapshot` lub kanału `candle`. */
export function parseCandle(raw: unknown): Candle | null {
  if (!isRecord(raw)) return null;
  const c: Candle = {
    t: num(raw.t),
    o: num(raw.o),
    h: num(raw.h),
    l: num(raw.l),
    c: num(raw.c),
    v: num(raw.v),
    n: num(raw.n),
  };
  if (!(c.t > 0) || !(c.o > 0) || !(c.h > 0) || !(c.l > 0) || !(c.c > 0) || !(c.v >= 0)) return null;
  if (c.h < c.l) return null;
  if (!Number.isFinite(c.n)) c.n = Number.NaN;
  return c;
}

/** Lista świec posortowana rosnąco po czasie, bez duplikatów (późniejszy rekord wygrywa). */
export function parseCandles(raw: unknown): Candle[] {
  if (!Array.isArray(raw)) return [];
  const byT = new Map<number, Candle>();
  for (const r of raw) {
    const c = parseCandle(r);
    if (c) byT.set(c.t, c);
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

function parseLevels(raw: unknown): BookLevel[] {
  if (!Array.isArray(raw)) return [];
  const out: BookLevel[] = [];
  for (const r of raw) {
    if (!isRecord(r)) continue;
    const px = num(r.px);
    const sz = num(r.sz);
    const n = num(r.n);
    if (px > 0 && sz >= 0) out.push({ px, sz, n: Number.isFinite(n) ? n : Number.NaN });
  }
  return out;
}

/** Migawka arkusza (`l2Book`): bidy malejąco, aski rosnąco — tak jak w API. */
export function parseBook(raw: unknown, coin: string): BookSnapshot | null {
  if (!isRecord(raw) || !Array.isArray(raw.levels)) return null;
  if (raw.coin !== undefined && raw.coin !== coin) return null;
  const time = num(raw.time);
  const bids = parseLevels(raw.levels[0]);
  const asks = parseLevels(raw.levels[1]);
  if (!(time > 0) || (bids.length === 0 && asks.length === 0)) return null;
  return { time, bids, asks };
}

/** Kontekst rynku z kanału `activeAssetCtx` (`data.ctx`) lub z `metaAndAssetCtxs`. */
export function parseAssetCtx(raw: unknown): AssetCtx | null {
  if (!isRecord(raw)) return null;
  const ctx: AssetCtx = {
    markPx: num(raw.markPx),
    oraclePx: num(raw.oraclePx),
    midPx: num(raw.midPx),
    funding: num(raw.funding),
    openInterest: num(raw.openInterest),
    premium: num(raw.premium),
    dayNtlVlm: num(raw.dayNtlVlm),
    prevDayPx: num(raw.prevDayPx),
  };
  if (!(ctx.markPx > 0)) return null;
  return ctx;
}

/** Kontekst monety z odpowiedzi `metaAndAssetCtxs` ([meta, ctxs], indeks z `meta.universe`). */
export function pickAssetCtx(raw: unknown, coin: string): AssetCtx | null {
  if (!Array.isArray(raw) || raw.length < 2 || !isRecord(raw[0]) || !Array.isArray(raw[1])) return null;
  const universe = raw[0].universe;
  if (!Array.isArray(universe)) return null;
  const i = universe.findIndex((u) => isRecord(u) && u.name === coin);
  return i >= 0 ? parseAssetCtx(raw[1][i]) : null;
}

export function parseFundingHistory(raw: unknown): FundingPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: FundingPoint[] = [];
  for (const r of raw) {
    if (!isRecord(r)) continue;
    const time = num(r.time);
    const rate = num(r.fundingRate);
    if (time > 0 && Number.isFinite(rate)) out.push({ time, rate, premium: num(r.premium) });
  }
  return out.sort((a, b) => a.time - b.time);
}
