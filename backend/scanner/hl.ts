import type { WeightLimiter } from './rateLimiter.ts';

/** Publiczne API Hyperliquid — bez kluczy i kont. */
const INFO_URL = 'https://api.hyperliquid.xyz/info';
const WS_URL = 'wss://api.hyperliquid.xyz/ws';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Zapytania `/info` w ramach własnego budżetu wag; 429/5xx/timeout → null (bez wyjątku, skaner próbuje później). */
export class HlRest {
  private readonly limiter: WeightLimiter;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly wait: (ms: number) => Promise<void>;
  errors = 0;
  requests = 0;

  constructor(limiter: WeightLimiter, fetchFn: typeof fetch = fetch, now: () => number = Date.now, wait: (ms: number) => Promise<void> = sleep) {
    this.limiter = limiter;
    this.fetchFn = fetchFn;
    this.now = now;
    this.wait = wait;
  }

  async info(body: unknown, weight: number): Promise<unknown | null> {
    const delay = this.limiter.reserve(weight, this.now());
    if (delay > 0) await this.wait(delay);
    this.requests++;
    try {
      const res = await this.fetchFn(INFO_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 429) {
        this.limiter.penalize(this.now());
        this.errors++;
        return null;
      }
      if (!res.ok) {
        this.errors++;
        return null;
      }
      return await res.json();
    } catch {
      this.errors++;
      return null;
    }
  }
}

export interface HlTrade {
  coin: string;
  px: string;
  sz: string;
  time: number;
  users?: [string, string];
}

export interface HlCtx {
  markPx: number;
  /** Open interest w jednostkach rynku (jedna strona) */
  oiBtc: number;
  dayNtlVlm: number;
}

/**
 * WebSocket `trades` (z adresami kupującego i sprzedającego) i `activeAssetCtx` (mark, OI, obrót) dla jednego rynku.
 * Ping co 50 s (serwer zamyka ciche połączenia), ponowne łączenie z narastającą przerwą 1 s → 60 s.
 */
export class HlStream {
  private readonly coin: string;
  private readonly onTrades: (t: HlTrade[]) => void;
  private readonly onCtx: (c: HlCtx) => void;
  private ws: WebSocket | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private backoff = 1000;
  private stopped = false;
  connected = false;

  constructor(coin: string, onTrades: (t: HlTrade[]) => void, onCtx: (c: HlCtx) => void) {
    this.coin = coin;
    this.onTrades = onTrades;
    this.onCtx = onCtx;
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.ping) clearInterval(this.ping);
    this.ws?.close();
  }

  private open(): void {
    const ws = new WebSocket(WS_URL);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.backoff = 1000;
      for (const type of ['trades', 'activeAssetCtx']) {
        ws.send(JSON.stringify({ method: 'subscribe', subscription: { type, coin: this.coin } }));
      }
      this.ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('{"method":"ping"}'), 50_000);
    };
    ws.onmessage = (ev) => {
      let msg: { channel?: string; data?: unknown };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.channel === 'trades' && Array.isArray(msg.data)) this.onTrades(msg.data as HlTrade[]);
      else if (msg.channel === 'activeAssetCtx') {
        const ctx = (msg.data as { ctx?: Record<string, unknown> } | undefined)?.ctx;
        const c = { markPx: Number(ctx?.markPx), oiBtc: Number(ctx?.openInterest), dayNtlVlm: Number(ctx?.dayNtlVlm) };
        if (Number.isFinite(c.markPx) && Number.isFinite(c.oiBtc)) this.onCtx(c);
      }
    };
    ws.onclose = () => {
      this.connected = false;
      if (this.ping) clearInterval(this.ping);
      if (this.stopped) return;
      setTimeout(() => this.open(), this.backoff);
      this.backoff = Math.min(60_000, this.backoff * 2);
    };
    ws.onerror = () => ws.close();
  }
}
