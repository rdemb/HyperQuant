/**
 * Połączenie WebSocket z publicznym API Hyperliquid dla wykresu Pro: zestaw subskrypcji odtwarzany
 * po każdym ponownym połączeniu, ping co 30 s (serwer zamyka po 60 s ciszy), wykrywanie martwego
 * połączenia i ponowne łączenie z narastającym odstępem.
 *
 * Koniec połączenia (`onClosed`) ma czas ostatniej wiadomości z transakcjami, nie chwilę wykrycia: po uśpieniu karty
 * albo komputera strażnik budzi się po kilku minutach i czas snu nie może liczyć się jako nagrany. Wybudzenie (przerwa
 * w wiadomościach dłuższa niż `staleMs`, także gdy pierwszą rzeczą po wybudzeniu jest wiadomość z bufora) zamyka
 * połączenie i łączy od nowa; osobno cisza samego kanału transakcji przy płynących innych kanałach (próg zależny od rynku: co najmniej
 * `tradesStaleMs`, dłuższy przy rzadkim strumieniu transakcji).
 */

export const HL_WS_URL = 'wss://api.hyperliquid.xyz/ws';

export type Subscription =
  | { type: 'trades'; coin: string }
  | { type: 'l2Book'; coin: string; nSigFigs?: number }
  | { type: 'bbo'; coin: string }
  | { type: 'candle'; coin: string; interval: string }
  | { type: 'activeAssetCtx'; coin: string };

export type StreamStatus = 'idle' | 'connecting' | 'open' | 'reconnecting';

export interface StreamHandlers {
  /** Wiadomość z danymi (bez odpowiedzi na ping i potwierdzeń). `recvAt` = zegar klienta. */
  onMessage?: (channel: string, data: unknown, recvAt: number) => void;
  /** Serwer potwierdził subskrypcję (od tej chwili kanał płynie). */
  onSubscribed?: (sub: Subscription, recvAt: number) => void;
  /** Połączenie zamknięte (każda subskrypcja przestaje płynąć). */
  onClosed?: (at: number) => void;
  onStatus?: (status: StreamStatus) => void;
}

export interface StreamOptions {
  url?: string;
  wsFactory?: (url: string) => WebSocket;
  now?: () => number;
  pingMs?: number;
  /** Brak jakiejkolwiek wiadomości przez tyle ms przy otwartym połączeniu = połączenie martwe (albo karta spała). */
  staleMs?: number;
  /**
   * Dolna granica progu ciszy kanału transakcji (domyślnie 120 s). Próg = większa z tej wartości i
   * `TRADES_STALE_GAP_MULT` × mediana odstępu między ostatnimi `TRADES_GAP_WINDOW` wiadomościami z transakcjami
   * na bieżącym połączeniu (rynki z rzadkim strumieniem mają dłuższe naturalne przerwy); przed zebraniem tylu
   * odstępów sama ta wartość.
   */
  tradesStaleMs?: number;
  maxBackoffMs?: number;
}

const OPEN = 1;

/** Liczba ostatnich odstępów między wiadomościami z transakcjami, z których liczona jest mediana. */
export const TRADES_GAP_WINDOW = 50;
/** Krotność mediany odstępu, po której cisza kanału transakcji uznawana jest za martwy kanał. */
export const TRADES_STALE_GAP_MULT = 20;

/** Mediana niepustej listy. */
function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Klucz subskrypcji niezależny od kolejności pól. */
export function subKey(s: Subscription): string {
  switch (s.type) {
    case 'trades':
    case 'activeAssetCtx':
    case 'bbo':
      return `${s.type}|${s.coin}`;
    case 'l2Book':
      return `l2Book|${s.coin}|${s.nSigFigs ?? ''}`;
    case 'candle':
      return `candle|${s.coin}|${s.interval}`;
  }
}

/** Subskrypcja z potwierdzenia serwera (`subscriptionResponse`), null gdy nie rozpoznana. */
export function parseSubscription(raw: unknown): Subscription | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const coin = typeof r.coin === 'string' ? r.coin : null;
  if (!coin) return null;
  if (r.type === 'trades' || r.type === 'activeAssetCtx' || r.type === 'bbo') return { type: r.type, coin };
  if (r.type === 'candle' && typeof r.interval === 'string') return { type: 'candle', coin, interval: r.interval };
  if (r.type === 'l2Book') {
    const n = r.nSigFigs;
    return typeof n === 'number' ? { type: 'l2Book', coin, nSigFigs: n } : { type: 'l2Book', coin };
  }
  return null;
}

export class HlStream {
  status: StreamStatus = 'idle';
  private readonly subs = new Map<string, Subscription>();
  private readonly handlers = new Set<StreamHandlers>();
  private readonly url: string;
  private readonly wsFactory: (url: string) => WebSocket;
  private readonly now: () => number;
  private readonly pingMs: number;
  private readonly staleMs: number;
  private readonly tradesStaleMs: number;
  private readonly maxBackoffMs: number;
  private ws: WebSocket | null = null;
  private running = false;
  private attempt = 0;
  private lastMsgAt = 0;
  private lastPingAt = 0;
  /** Ostatnia wiadomość z transakcjami (zegar klienta); 0 = żadnej. Koniec nagrania przy zamknięciu połączenia. */
  private lastTradesAt = 0;
  /** Ostatnie odstępy (ms) między wiadomościami z transakcjami na bieżącym połączeniu, najstarszy pierwszy. */
  private tradeGaps: number[] = [];
  private openedAt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(o: StreamOptions = {}) {
    this.url = o.url ?? HL_WS_URL;
    this.wsFactory = o.wsFactory ?? ((u) => new WebSocket(u));
    this.now = o.now ?? (() => Date.now());
    this.pingMs = o.pingMs ?? 30_000;
    this.staleMs = o.staleMs ?? 75_000;
    this.tradesStaleMs = o.tradesStaleMs ?? 120_000;
    this.maxBackoffMs = o.maxBackoffMs ?? 15_000;
  }

  listen(h: StreamHandlers): () => void {
    this.handlers.add(h);
    return () => {
      this.handlers.delete(h);
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    // Zamknięcie także w stanie CONNECTING — inaczej stary socket dublowałby dane
    if (ws) {
      ws.onclose = null;
      ws.close();
      this.emitClosed();
    }
    this.attempt = 0;
    this.setStatus('idle');
  }

  add(sub: Subscription): void {
    const k = subKey(sub);
    if (this.subs.has(k)) return;
    this.subs.set(k, sub);
    this.send('subscribe', sub);
  }

  remove(sub: Subscription): void {
    const k = subKey(sub);
    if (!this.subs.delete(k)) return;
    this.send('unsubscribe', sub);
  }

  has(sub: Subscription): boolean {
    return this.subs.has(subKey(sub));
  }

  private send(method: 'subscribe' | 'unsubscribe', subscription: Subscription): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN) return;
    ws.send(JSON.stringify({ method, subscription }));
  }

  private setStatus(s: StreamStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.handlers.forEach((h) => h.onStatus?.(s));
  }

  /** Zamknięcie: koniec nagrania na ostatniej wiadomości z transakcjami (bez niej — na ostatniej wiadomości). */
  private emitClosed(): void {
    const at = this.lastTradesAt > 0 ? this.lastTradesAt : this.lastMsgAt > 0 ? this.lastMsgAt : this.now();
    this.handlers.forEach((h) => h.onClosed?.(at));
  }

  /**
   * Porzucenie połączenia (martwe, karta spała, cichy kanał transakcji): od razu odpięte, więc żadna spóźniona wiadomość
   * z niego nie trafia do odbiorców; zamknięcie i ponowne łączenie od pierwszej próby.
   */
  private abandon(sock: WebSocket): void {
    if (this.ws !== sock) return;
    this.ws = null;
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
    sock.onclose = null;
    sock.onmessage = null;
    try {
      sock.close();
    } catch {
      // już zamknięte
    }
    this.emitClosed();
    this.attempt = 0;
    this.scheduleReconnect();
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
  }

  private connect(): void {
    if (!this.running) return;
    this.setStatus(this.attempt > 0 ? 'reconnecting' : 'connecting');
    let sock: WebSocket;
    try {
      sock = this.wsFactory(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = sock;
    sock.onopen = () => {
      if (this.ws !== sock) return;
      this.attempt = 0;
      this.lastMsgAt = this.now();
      this.lastPingAt = this.lastMsgAt;
      this.openedAt = this.lastMsgAt;
      this.lastTradesAt = 0; // koniec nagrania liczony tylko z wiadomości tego połączenia
      this.tradeGaps = [];
      this.setStatus('open');
      this.subs.forEach((s) => this.send('subscribe', s));
      if (this.pingTimer !== null) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.tick(sock), Math.min(this.pingMs, 10_000));
    };
    sock.onmessage = (e: MessageEvent) => {
      if (this.ws !== sock) return;
      this.onRaw(e.data, sock);
    };
    sock.onclose = () => {
      if (this.ws !== sock) return;
      this.ws = null;
      if (this.pingTimer !== null) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.emitClosed();
      this.scheduleReconnect();
    };
    sock.onerror = () => {
      // Błąd zawsze kończy się zdarzeniem close — tam jest ponowne łączenie
    };
  }

  /** Ping i strażnik martwego połączenia (sprawdzane co ≤ 10 s). */
  private tick(sock: WebSocket): void {
    if (this.ws !== sock || sock.readyState !== OPEN) return;
    const now = this.now();
    // Cisza na całym połączeniu (także po uśpieniu karty) albo samego kanału transakcji przy płynących innych
    const tradesSince = Math.max(this.lastTradesAt, this.openedAt);
    if (now - this.lastMsgAt > this.staleMs || (this.hasTrades() && now - tradesSince > this.tradesStaleLimit())) {
      this.abandon(sock);
      return;
    }
    if (now - this.lastPingAt >= this.pingMs) {
      this.lastPingAt = now;
      sock.send('{"method":"ping"}');
    }
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer !== null) return;
    this.setStatus('reconnecting');
    const base = Math.min(this.maxBackoffMs, 1000 * 2 ** this.attempt);
    // Rozrzut ±20%, żeby wiele kart nie łączyło się w tej samej chwili
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** Próg ciszy kanału transakcji na tym połączeniu (patrz `StreamOptions.tradesStaleMs`). */
  private tradesStaleLimit(): number {
    if (this.tradeGaps.length < TRADES_GAP_WINDOW) return this.tradesStaleMs;
    return Math.max(this.tradesStaleMs, TRADES_STALE_GAP_MULT * median(this.tradeGaps));
  }

  private hasTrades(): boolean {
    for (const s of this.subs.values()) if (s.type === 'trades') return true;
    return false;
  }

  private onRaw(raw: unknown, sock: WebSocket): void {
    const recvAt = this.now();
    // Wiadomość po przerwie dłuższej niż strażnik (bufor po wybudzeniu karty): ciągłości nie da się potwierdzić
    if (this.lastMsgAt > 0 && recvAt - this.lastMsgAt > this.staleMs) {
      this.abandon(sock);
      return;
    }
    this.lastMsgAt = recvAt;
    let msg: { channel?: unknown; data?: unknown };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return; // uszkodzony pakiet
    }
    const channel = typeof msg.channel === 'string' ? msg.channel : '';
    if (channel === '' || channel === 'pong') return;
    if (channel === 'trades') {
      if (this.lastTradesAt > 0) {
        this.tradeGaps.push(recvAt - this.lastTradesAt);
        if (this.tradeGaps.length > TRADES_GAP_WINDOW) this.tradeGaps.shift();
      }
      this.lastTradesAt = recvAt;
    }
    if (channel === 'subscriptionResponse') {
      const d = msg.data as { method?: unknown; subscription?: unknown } | undefined;
      if (d?.method !== 'subscribe') return;
      const sub = parseSubscription(d.subscription);
      if (sub && this.subs.has(subKey(sub))) this.handlers.forEach((h) => h.onSubscribed?.(sub, recvAt));
      return;
    }
    this.handlers.forEach((h) => h.onMessage?.(channel, msg.data, recvAt));
  }
}
