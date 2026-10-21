import type { AggrTradeTick } from '../../types/trading';
import { bucketIndex } from './footprint';
import { HistQuantile } from './quantile';

/**
 * Magazyn danych order flow (bez Reacta, singleton): realny arkusz L2 Hyperliquid próbkowany
 * do kolumn co 1 s (heatmapa), realne transakcje agresorów (footprint per świeca, bąble, CVD).
 * Wszystko istnieje od momentu otwarcia strony — historia arkusza nie jest dostępna w publicznym API.
 * Duże bufory to typed arrays (pierścienie), żeby nie tworzyć obiektów per komórka.
 */

/** Kubełek footprintu (USD). */
export const FP_TICK = 5;
/** Kubełek bąbli (USD). */
export const BUBBLE_TICK = 10;
/** Przerwa do 5 s między snapshotami = arkusz bez zmian (HL wysyła l2Book przy zmianie). */
const FILL_GAP_SEC = 5;
const WS_URL = 'wss://api.hyperliquid.xyz/ws';
const SIDE_BUY = 1;
const SIDE_SELL = 0;

export interface FpCell {
  buy: number; // BTC, agresywne kupno (zdejmuje ask)
  sell: number; // BTC, agresywna sprzedaż (uderza w bid)
  nBuy: number;
  nSell: number;
}

export interface FpCandle {
  t: number;
  buy: number;
  sell: number;
  nBuy: number;
  nSell: number;
  minIdx: number;
  maxIdx: number;
  firstTs: number;
  lastTs: number;
  cells: Map<number, FpCell>;
}

export interface BookLevelIn {
  px: string | number;
  sz: string | number;
}

export type BookStatus = 'off' | 'connecting' | 'live' | 'reconnecting';
/**
 * Próg bąbli: 'auto' = top 2% LUB ≥ $50K (niższy z progów), 'top2' = 98. percentyl bąbli
 * z ostatnich 30 min, liczba = stała kwota USD.
 */
export type BubbleMode = 'auto' | 'top2' | number;

export interface OrderFlowStoreOptions {
  heatCap?: number;
  maxLevels?: number;
  tradeCap?: number;
  retentionMs?: number;
  bubbleCap?: number;
  wsFactory?: (url: string) => WebSocket;
}

/**
 * Liczba cyfr znaczących dla l2Book, przy której kubełki mają ~10 USD
 * (5 cyfr ceny → 4, 6 cyfr → 5). Histereza ±0.3% przy granicy rzędu wielkości.
 */
export function pickSigFigs(mid: number, current: number): number {
  if (!(mid > 0)) return current;
  const digits = (p: number) => Math.floor(Math.log10(p)) + 1;
  const a = digits(mid * 0.997);
  if (a !== digits(mid * 1.003)) return current;
  return Math.min(5, Math.max(2, a - 1));
}

export class OrderFlowStore {
  // ── Heatmapa: pierścień kolumn 1 s ──
  readonly heatCap: number;
  readonly maxLevels: number;
  readonly colSec: Float64Array;
  readonly colCount: Uint8Array;
  readonly colMid: Float64Array;
  readonly colStep: Float32Array;
  readonly lvPx: Float32Array;
  readonly lvSz: Float32Array;
  readonly lvSide: Uint8Array; // 0 = bid, 1 = ask
  lastBookSec = -1;
  firstBookSec = -1;

  // ── Surowe transakcje (do przeliczenia footprintu po zmianie interwału) ──
  readonly tradeCap: number;
  readonly retentionMs: number;
  private readonly tTs: Float64Array;
  private readonly tPx: Float64Array;
  private readonly tBtc: Float32Array;
  private readonly tSide: Uint8Array;
  private tradeHead = 0;
  tradeCount = 0;

  // ── Footprint per świeca ──
  tfMs = 300_000;
  readonly candles = new Map<number, FpCandle>();

  // ── Bąble: (sekunda, kubełek 10 USD, strona) ──
  readonly bubbleCap: number;
  readonly bSec: Float64Array;
  readonly bPxSum: Float64Array; // Σ cena × BTC (VWAP = bPxSum / bBtc)
  readonly bBtc: Float64Array;
  readonly bUsd: Float64Array;
  readonly bSide: Uint8Array; // 1 = kupno, 0 = sprzedaż
  readonly bBorn: Float64Array; // Date.now() przy utworzeniu (animacja wejścia)
  bubbleHead = 0;
  bubbleCount = 0;
  private readonly bubbleKeys = new Map<number, number>();
  private readonly hist = new HistQuantile(0, 10, 1000);
  private thrCache = { at: -Infinity, value: 50_000 };

  // ── Delta agresora per sekunda (CVD od startu zapisu) ──
  private readonly secCap: number;
  private readonly sSec: Float64Array;
  private readonly sDelta: Float64Array;
  private cvdBase = 0;
  firstTradeSec = -1;
  lastTradeSec = -1;

  // ── Stan ogólny ──
  startedAt: number | null = null;
  /** Cena ostatniej (najnowszej) realnej transakcji; NaN przed pierwszą. */
  lastTradePx = Number.NaN;
  tradesSince: number | null = null;
  bookSince: number | null = null;
  version = 0;
  clockOffsetMs = 0;
  bookStatus: BookStatus = 'off';
  sigFigs = 4;

  private readonly listeners = new Set<() => void>();
  private readonly seen = new Map<string, number>();
  private maxTradeTs = -Infinity;
  private sincePrune = 0;

  // ── WebSocket arkusza ──
  private readonly wsFactory: (url: string) => WebSocket;
  private ws: WebSocket | null = null;
  private bookRefs = 0;
  private wsAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private offsetInit = false;

  constructor(o: OrderFlowStoreOptions = {}) {
    this.heatCap = o.heatCap ?? 7200; // 2 h po 1 s
    this.maxLevels = o.maxLevels ?? 48; // HL: do 20 poziomów na stronę
    this.colSec = new Float64Array(this.heatCap).fill(-1);
    this.colCount = new Uint8Array(this.heatCap);
    this.colMid = new Float64Array(this.heatCap);
    this.colStep = new Float32Array(this.heatCap);
    this.lvPx = new Float32Array(this.heatCap * this.maxLevels);
    this.lvSz = new Float32Array(this.heatCap * this.maxLevels);
    this.lvSide = new Uint8Array(this.heatCap * this.maxLevels);

    this.tradeCap = o.tradeCap ?? 200_000;
    this.retentionMs = o.retentionMs ?? 6 * 3600_000;
    this.tTs = new Float64Array(this.tradeCap);
    this.tPx = new Float64Array(this.tradeCap);
    this.tBtc = new Float32Array(this.tradeCap);
    this.tSide = new Uint8Array(this.tradeCap);

    this.bubbleCap = o.bubbleCap ?? 100_000;
    this.bSec = new Float64Array(this.bubbleCap);
    this.bPxSum = new Float64Array(this.bubbleCap);
    this.bBtc = new Float64Array(this.bubbleCap);
    this.bUsd = new Float64Array(this.bubbleCap);
    this.bSide = new Uint8Array(this.bubbleCap);
    this.bBorn = new Float64Array(this.bubbleCap);

    this.secCap = Math.ceil(this.retentionMs / 1000);
    this.sSec = new Float64Array(this.secCap).fill(-1);
    this.sDelta = new Float64Array(this.secCap);

    this.wsFactory = o.wsFactory ?? ((url) => new WebSocket(url));
  }

  // ───────────────────────── subskrypcja ─────────────────────────

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private bump(): void {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  /** Czas serwera HL (zegar klienta skorygowany o przesunięcie z bloków arkusza). */
  nowMs(): number {
    return Date.now() + this.clockOffsetMs;
  }

  private markStart(ts: number): void {
    if (this.startedAt === null || ts < this.startedAt) this.startedAt = ts;
  }

  // ───────────────────────── heatmapa ─────────────────────────

  slotOf(sec: number): number {
    return ((sec % this.heatCap) + this.heatCap) % this.heatCap;
  }

  hasColumn(sec: number): boolean {
    return sec >= 0 && this.colSec[this.slotOf(sec)] === sec;
  }

  /** Najstarsza sekunda, której kolumna może jeszcze istnieć w pierścieniu (−1 = brak). */
  oldestBookSec(): number {
    if (this.lastBookSec < 0) return -1;
    return Math.max(this.firstBookSec, this.lastBookSec - this.heatCap + 1);
  }

  private clearColumn(sec: number): void {
    const slot = this.slotOf(sec);
    this.colSec[slot] = -1;
    this.colCount[slot] = 0;
  }

  private copyColumn(fromSlot: number, sec: number): void {
    const to = this.slotOf(sec);
    const n = this.colCount[fromSlot];
    const a = fromSlot * this.maxLevels;
    const b = to * this.maxLevels;
    this.lvPx.copyWithin(b, a, a + n);
    this.lvSz.copyWithin(b, a, a + n);
    this.lvSide.copyWithin(b, a, a + n);
    this.colSec[to] = sec;
    this.colCount[to] = n;
    this.colMid[to] = this.colMid[fromSlot];
    this.colStep[to] = this.colStep[fromSlot];
  }

  /** Snapshot arkusza → kolumna sekundy (ostatni snapshot w danej sekundzie wygrywa). */
  ingestBook(timeMs: number, bids: readonly BookLevelIn[], asks: readonly BookLevelIn[]): void {
    const sec = Math.floor(timeMs / 1000);
    if (!Number.isFinite(sec) || sec < this.lastBookSec) return;

    if (this.lastBookSec >= 0 && sec > this.lastBookSec + 1) {
      const gap = sec - this.lastBookSec;
      const prevSlot = this.slotOf(this.lastBookSec);
      const end = Math.min(sec - 1, this.lastBookSec + this.heatCap);
      for (let s = this.lastBookSec + 1; s <= end; s++) {
        if (gap <= FILL_GAP_SEC) this.copyColumn(prevSlot, s);
        else this.clearColumn(s);
      }
    }

    const slot = this.slotOf(sec);
    const base = slot * this.maxLevels;
    const half = this.maxLevels >> 1;
    let n = 0;
    let bestBid = -Infinity;
    let bestAsk = Infinity;
    let step = Infinity;
    for (let side = 0; side < 2; side++) {
      const rows = side === 0 ? bids : asks;
      let prev = Number.NaN;
      const lim = Math.min(rows.length, half);
      for (let i = 0; i < lim; i++) {
        const px = Number(rows[i].px);
        const sz = Number(rows[i].sz);
        if (!(px > 0) || !(sz >= 0)) continue;
        this.lvPx[base + n] = px;
        this.lvSz[base + n] = sz;
        this.lvSide[base + n] = side;
        n++;
        if (side === 0 && px > bestBid) bestBid = px;
        if (side === 1 && px < bestAsk) bestAsk = px;
        const d = Math.abs(px - prev);
        if (d > 0 && d < step) step = d;
        prev = px;
      }
    }
    if (n === 0) return;

    this.colSec[slot] = sec;
    this.colCount[slot] = n;
    this.colMid[slot] =
      Number.isFinite(bestBid) && Number.isFinite(bestAsk) ? (bestBid + bestAsk) / 2 : Number.isFinite(bestBid) ? bestBid : bestAsk;
    this.colStep[slot] = Number.isFinite(step) ? step : 10;
    if (this.firstBookSec < 0) this.firstBookSec = sec;
    if (this.bookSince === null) this.bookSince = timeMs;
    this.markStart(timeMs);
    this.lastBookSec = sec;
    this.bump();
  }

  /** Poziom arkusza w komórce (sekunda, cena) — do tooltipa; null gdy brak danych. */
  bookAt(sec: number, price: number): { px: number; sz: number; side: 'bid' | 'ask' } | null {
    if (!this.hasColumn(sec)) return null;
    const slot = this.slotOf(sec);
    const half = this.colStep[slot] / 2;
    const base = slot * this.maxLevels;
    for (let i = 0; i < this.colCount[slot]; i++) {
      const px = this.lvPx[base + i];
      if (price >= px - half && price < px + half) {
        return { px, sz: this.lvSz[base + i], side: this.lvSide[base + i] === 0 ? 'bid' : 'ask' };
      }
    }
    return null;
  }

  // ───────────────────────── transakcje ─────────────────────────

  /** Realne transakcje agresorów HL (z useDeskFeed). Ticki syntetyczne i CEX są pomijane. */
  ingestTrades(ticks: readonly AggrTradeTick[]): void {
    const prevMax = this.maxTradeTs;
    let changed = false;
    let batch: string[] | null = null;
    for (const t of ticks) {
      if (t.exchange !== 'HYPERLIQUID' || t.isSynthetic) continue;
      const btc = t.sizeBtc > 0 ? t.sizeBtc : t.price > 0 ? t.sizeUsd / t.price : 0;
      if (!(btc > 0) || !(t.price > 0) || !Number.isFinite(t.timestamp)) continue;
      // Powtórki (np. snapshot po ponownym połączeniu WS) — tylko dla transakcji nie nowszych niż już widziane
      const sig = `${t.timestamp}|${t.price}|${btc}|${t.side}`;
      if (t.timestamp <= prevMax && this.seen.has(sig)) continue;
      (batch ??= []).push(sig);
      this.recordTrade(t.timestamp, t.price, btc, t.sizeUsd > 0 ? t.sizeUsd : t.price * btc, t.side === 'buy' ? SIDE_BUY : SIDE_SELL);
      changed = true;
    }
    if (!changed) return;
    for (const s of batch ?? []) this.seen.set(s, this.maxTradeTs);
    if (this.seen.size > 2000) {
      const cut = this.maxTradeTs - 60_000;
      this.seen.forEach((ts, k) => {
        if (ts < cut) this.seen.delete(k);
      });
    }
    this.bump();
  }

  private recordTrade(ts: number, px: number, btc: number, usd: number, side: number): void {
    const i = this.tradeHead;
    this.tTs[i] = ts;
    this.tPx[i] = px;
    this.tBtc[i] = btc;
    this.tSide[i] = side;
    this.tradeHead = (i + 1) % this.tradeCap;
    if (this.tradeCount < this.tradeCap) this.tradeCount++;
    if (ts >= this.maxTradeTs) {
      this.maxTradeTs = ts;
      this.lastTradePx = px;
    }
    if (this.tradesSince === null || ts < this.tradesSince) this.tradesSince = ts;
    this.markStart(ts);

    this.addFootprint(ts, px, btc, side);
    this.addBubble(ts, px, btc, usd, side);
    this.addSecDelta(ts, btc, side);

    if (++this.sincePrune >= 1000) {
      this.sincePrune = 0;
      const cut = this.maxTradeTs - this.retentionMs;
      this.candles.forEach((_c, t) => {
        if (t + this.tfMs < cut) this.candles.delete(t);
      });
    }
  }

  private addFootprint(ts: number, px: number, btc: number, side: number): void {
    const ct = Math.floor(ts / this.tfMs) * this.tfMs;
    let c = this.candles.get(ct);
    if (!c) {
      c = { t: ct, buy: 0, sell: 0, nBuy: 0, nSell: 0, minIdx: Infinity, maxIdx: -Infinity, firstTs: ts, lastTs: ts, cells: new Map() };
      this.candles.set(ct, c);
    }
    const idx = bucketIndex(px, FP_TICK);
    let cell = c.cells.get(idx);
    if (!cell) {
      cell = { buy: 0, sell: 0, nBuy: 0, nSell: 0 };
      c.cells.set(idx, cell);
    }
    if (side === SIDE_BUY) {
      cell.buy += btc;
      cell.nBuy++;
      c.buy += btc;
      c.nBuy++;
    } else {
      cell.sell += btc;
      cell.nSell++;
      c.sell += btc;
      c.nSell++;
    }
    if (idx < c.minIdx) c.minIdx = idx;
    if (idx > c.maxIdx) c.maxIdx = idx;
    if (ts < c.firstTs) c.firstTs = ts;
    if (ts > c.lastTs) c.lastTs = ts;
  }

  /** Zmiana interwału świec → footprint przeliczony z surowych transakcji (≤ 6 h / 200k). */
  setTimeframe(tfSec: number): void {
    const tfMs = Math.round(tfSec * 1000);
    if (!(tfMs > 0) || tfMs === this.tfMs) return;
    this.tfMs = tfMs;
    this.candles.clear();
    const cut = this.maxTradeTs - this.retentionMs;
    const start = (this.tradeHead - this.tradeCount + this.tradeCap) % this.tradeCap;
    for (let k = 0; k < this.tradeCount; k++) {
      const i = (start + k) % this.tradeCap;
      if (this.tTs[i] < cut) continue;
      this.addFootprint(this.tTs[i], this.tPx[i], this.tBtc[i], this.tSide[i]);
    }
    this.bump();
  }

  candleAt(t: number): FpCandle | undefined {
    return this.candles.get(t);
  }

  /** POC świecy: indeks kubełka FP_TICK o największym wolumenie (remis → niższa cena). */
  candlePoc(c: FpCandle): number {
    let best = Number.NaN;
    let max = -1;
    c.cells.forEach((cell, idx) => {
      const v = cell.buy + cell.sell;
      if (v > max || (v === max && idx < best)) {
        max = v;
        best = idx;
      }
    });
    return best;
  }

  // ───────────────────────── bąble ─────────────────────────

  private bubbleKey(sec: number, bucket: number, side: number): number {
    return (sec % 100_000) * 2_000_000 + (bucket % 1_000_000) * 2 + side;
  }

  private addBubble(ts: number, px: number, btc: number, usd: number, side: number): void {
    const sec = Math.floor(ts / 1000);
    const key = this.bubbleKey(sec, bucketIndex(px, BUBBLE_TICK), side);
    let i = this.bubbleKeys.get(key);
    if (i === undefined || this.bSec[i] !== sec) {
      i = this.bubbleHead;
      this.bubbleHead = (i + 1) % this.bubbleCap;
      if (this.bubbleCount < this.bubbleCap) this.bubbleCount++;
      this.bSec[i] = sec;
      this.bPxSum[i] = 0;
      this.bBtc[i] = 0;
      this.bUsd[i] = 0;
      this.bSide[i] = side;
      this.bBorn[i] = Date.now();
      this.bubbleKeys.set(key, i);
      if (this.bubbleKeys.size > 4096) {
        this.bubbleKeys.forEach((idx, k) => {
          if (this.bSec[idx] < sec - 10) this.bubbleKeys.delete(k);
        });
      }
    }
    this.bPxSum[i] += px * btc;
    this.bBtc[i] += btc;
    this.bUsd[i] += usd;
  }

  bubbleIndexOf(sec: number, price: number, side: 'buy' | 'sell'): number {
    const i = this.bubbleKeys.get(this.bubbleKey(sec, bucketIndex(price, BUBBLE_TICK), side === 'buy' ? SIDE_BUY : SIDE_SELL));
    return i !== undefined && this.bSec[i] === sec ? i : -1;
  }

  /** Indeks bąbla k-tego od najnowszego (0 = najnowszy). */
  bubbleAt(k: number): number {
    return (this.bubbleHead - 1 - k + this.bubbleCap * 2) % this.bubbleCap;
  }

  /** Próg kwoty bąbla (USD): stały, 98. percentyl z ostatnich 30 min (cache 3 s) albo auto. */
  bubbleThreshold(mode: BubbleMode, nowMs: number): number {
    if (typeof mode === 'number') return mode;
    const p98 = this.bubbleP98(nowMs);
    return mode === 'auto' ? Math.min(p98, 50_000) : p98;
  }

  private bubbleP98(nowMs: number): number {
    if (nowMs - this.thrCache.at < 3000 && nowMs >= this.thrCache.at) return this.thrCache.value;
    const h = this.hist;
    h.reset();
    const minSec = Math.floor((nowMs - 30 * 60_000) / 1000);
    for (let k = 0; k < this.bubbleCount; k++) {
      const i = this.bubbleAt(k);
      if (this.bSec[i] < minSec - 10) break;
      if (this.bSec[i] >= minSec && this.bUsd[i] > 0) h.add(Math.log10(this.bUsd[i]));
    }
    const q = h.quantile(0.98);
    const value = Number.isFinite(q) ? Math.max(10_000, 10 ** q) : 50_000;
    this.thrCache = { at: nowMs, value };
    return value;
  }

  // ───────────────────────── CVD per sekunda ─────────────────────────

  private addSecDelta(ts: number, btc: number, side: number): void {
    const sec = Math.floor(ts / 1000);
    if (this.lastTradeSec >= 0 && sec <= this.lastTradeSec - this.secCap) return;
    const slot = sec % this.secCap;
    if (this.sSec[slot] !== sec) {
      if (this.sSec[slot] >= 0) this.cvdBase += this.sDelta[slot];
      this.sSec[slot] = sec;
      this.sDelta[slot] = 0;
    }
    this.sDelta[slot] += side === SIDE_BUY ? btc : -btc;
    if (this.firstTradeSec < 0 || sec < this.firstTradeSec) this.firstTradeSec = sec;
    if (sec > this.lastTradeSec) this.lastTradeSec = sec;
  }

  /** Delta agresora (BTC) w danej sekundzie; 0 gdy brak transakcji. */
  secDelta(sec: number): number {
    const slot = sec % this.secCap;
    return this.sSec[slot] === sec ? this.sDelta[slot] : 0;
  }

  /** CVD (BTC) od startu zapisu do początku sekundy `sec`. */
  cvdBefore(sec: number): number {
    if (this.firstTradeSec < 0) return 0;
    let acc = this.cvdBase;
    const from = Math.max(this.firstTradeSec, this.lastTradeSec - this.secCap + 1);
    const to = Math.min(sec, this.lastTradeSec + 1);
    for (let s = from; s < to; s++) acc += this.secDelta(s);
    return acc;
  }

  // ───────────────────────── WebSocket arkusza ─────────────────────────

  /** Start strumienia l2Book (licznik referencji). Zwraca funkcję zatrzymania. */
  startBook(): () => void {
    this.bookRefs++;
    if (this.bookRefs === 1) this.connect();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.bookRefs--;
      if (this.bookRefs === 0) this.disconnect();
    };
  }

  private setStatus(s: BookStatus): void {
    if (this.bookStatus === s) return;
    this.bookStatus = s;
    this.bump();
  }

  private sendSub(method: 'subscribe' | 'unsubscribe', nSigFigs: number): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ method, subscription: { type: 'l2Book', coin: 'BTC', nSigFigs } }));
  }

  private connect(): void {
    if (this.bookRefs === 0) return;
    this.setStatus(this.wsAttempt > 0 ? 'reconnecting' : 'connecting');
    let sock: WebSocket;
    try {
      sock = this.wsFactory(WS_URL);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = sock;
    sock.onopen = () => {
      if (this.ws !== sock) return;
      this.wsAttempt = 0;
      this.sendSub('subscribe', this.sigFigs);
      if (this.pingTimer !== null) clearInterval(this.pingTimer);
      // Serwer zamyka połączenie po 60 s ciszy
      this.pingTimer = setInterval(() => {
        if (sock.readyState === 1) sock.send('{"method":"ping"}');
      }, 30_000);
    };
    sock.onmessage = (e: MessageEvent) => {
      if (this.ws !== sock) return;
      this.onWsMessage(e.data);
    };
    sock.onclose = () => {
      if (this.ws !== sock) return;
      this.ws = null;
      if (this.pingTimer !== null) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.bookRefs > 0) {
        this.setStatus('reconnecting');
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || this.bookRefs === 0) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.wsAttempt);
    this.wsAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private disconnect(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
    const s = this.ws;
    this.ws = null;
    // Zamknięcie także w stanie CONNECTING — inaczej stary socket dublowałby dane
    if (s) s.close();
    this.wsAttempt = 0;
    this.setStatus('off');
  }

  private onWsMessage(raw: unknown): void {
    let msg: { channel?: string; data?: { coin?: string; time?: number; levels?: BookLevelIn[][] } };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return; // uszkodzony pakiet
    }
    if (msg.channel !== 'l2Book' || !msg.data || !Array.isArray(msg.data.levels)) return;
    const d = msg.data;
    const levels = msg.data.levels;
    if (d.coin && d.coin !== 'BTC') return;
    const time = typeof d.time === 'number' && Number.isFinite(d.time) ? d.time : Date.now();
    const offset = time - Date.now();
    this.clockOffsetMs = this.offsetInit ? this.clockOffsetMs * 0.9 + offset * 0.1 : offset;
    this.offsetInit = true;
    this.ingestBook(time, levels[0] ?? [], levels[1] ?? []);
    this.setStatus('live');
    // Kubełki ~10 USD niezależnie od rzędu wielkości ceny (4 → 5 cyfr znaczących powyżej 100k)
    const mid = this.lastBookSec >= 0 ? this.colMid[this.slotOf(this.lastBookSec)] : Number.NaN;
    const want = pickSigFigs(mid, this.sigFigs);
    if (want !== this.sigFigs) {
      this.sendSub('unsubscribe', this.sigFigs);
      this.sigFigs = want;
      this.sendSub('subscribe', want);
    }
  }
}

/** Wspólny magazyn aplikacji — zasilany transakcjami z useDeskFeed i własnym WS arkusza. */
export const orderFlowStore = new OrderFlowStore();
