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

  /** Dopłata wag po odpowiedzi (waga zależna od liczby zwróconych pozycji). */
  charge(weight: number): void {
    this.limiter.charge(weight, this.now());
  }

  /** Czy API działa w pełnym tempie (bez wycofania po błędach i bez pauzy po 429). */
  healthy(): boolean {
    return this.limiter.healthy(this.now());
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
        this.limiter.fail(this.now(), '429');
        this.errors++;
        return null;
      }
      if (!res.ok) {
        this.limiter.fail(this.now(), 'error');
        this.errors++;
        return null;
      }
      const json = await res.json();
      this.limiter.success(this.now());
      return json;
    } catch {
      this.limiter.fail(this.now(), 'error');
      this.errors++;
      return null;
    }
  }
}

export interface HlTrade {
  coin: string;
  /** Strona agresora: B = kupujący (users[0]) jest biorcą, A = sprzedający (users[1]) */
  side?: string;
  px: string;
  sz: string;
  time: number;
  /** Identyfikator transakcji (unikalny razem z czasem i rynkiem) */
  tid?: number;
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
 * Ping co 50 s. Strażnik: brak jakiejkolwiek wiadomości przez 90 s = zawieszone połączenie → zamknięcie i ponowne łączenie.
 * Transakcje deduplikowane po (czas, tid) — powtórzenia po ponownej subskrypcji nie liczą się podwójnie.
 * Przerwa przed ponownym łączeniem rośnie 1 s → 60 s i wraca do 1 s dopiero po 60 s stabilnego połączenia
 * (połączenie zrywane zaraz po otwarciu nie zasypuje serwera próbami — IP jest współdzielone z innymi usługami).
 */
export class HlStream {
  private readonly coin: string;
  private readonly onTrades: (t: HlTrade[]) => void;
  private readonly onCtx: (c: HlCtx) => void;
  private readonly WS: typeof WebSocket;
  private ws: WebSocket | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private backoff = 1000;
  private lastMsgAt = 0;
  private stopped = false;
  /** Ostatnio widziane transakcje (czas:tid) — po ponownej subskrypcji API może powtórzyć niedawne transakcje */
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  connected = false;

  constructor(coin: string, onTrades: (t: HlTrade[]) => void, onCtx: (c: HlCtx) => void, wsCtor: typeof WebSocket = WebSocket) {
    this.coin = coin;
    this.onTrades = onTrades;
    this.onCtx = onCtx;
    this.WS = wsCtor;
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close();
  }

  private clearTimers(): void {
    for (const t of this.timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    this.timers = [];
  }

  private open(): void {
    const ws = new this.WS(WS_URL);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.lastMsgAt = Date.now();
      for (const type of ['trades', 'activeAssetCtx']) {
        ws.send(JSON.stringify({ method: 'subscribe', subscription: { type, coin: this.coin } }));
      }
      this.timers.push(
        setInterval(() => ws.readyState === this.WS.OPEN && ws.send('{"method":"ping"}'), 50_000),
        setInterval(() => {
          if (Date.now() - this.lastMsgAt > 90_000) ws.close();
        }, 10_000),
        setTimeout(() => {
          this.backoff = 1000;
        }, 60_000)
      );
    };
    ws.onmessage = (ev) => {
      this.lastMsgAt = Date.now();
      let msg: { channel?: string; data?: unknown };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.channel === 'trades' && Array.isArray(msg.data)) {
        const fresh = (msg.data as HlTrade[]).filter((t) => {
          if (t?.tid === undefined) return true;
          const key = `${t.time}:${t.tid}`;
          if (this.seen.has(key)) return false;
          this.seen.add(key);
          this.seenOrder.push(key);
          if (this.seenOrder.length > 20_000) for (const k of this.seenOrder.splice(0, 5_000)) this.seen.delete(k);
          return true;
        });
        if (fresh.length > 0) this.onTrades(fresh);
      }
      else if (msg.channel === 'activeAssetCtx') {
        const ctx = (msg.data as { ctx?: Record<string, unknown> } | undefined)?.ctx;
        const c = { markPx: Number(ctx?.markPx), oiBtc: Number(ctx?.openInterest), dayNtlVlm: Number(ctx?.dayNtlVlm) };
        if (Number.isFinite(c.markPx) && Number.isFinite(c.oiBtc)) this.onCtx(c);
      }
    };
    ws.onclose = () => {
      this.connected = false;
      this.clearTimers();
      if (this.stopped) return;
      this.timers.push(setTimeout(() => this.open(), this.backoff));
      this.backoff = Math.min(60_000, this.backoff * 2);
    };
    ws.onerror = () => ws.close();
  }
}
