import { cexReconnectDelayMs } from '../../../state/useCexFeeds';

export interface LiveSocketHandlers {
  onOpen: () => void;
  onMessage: (msg: unknown) => void;
  /** Połączenie zamknięte (także przy zmianie adresu i wyłączeniu). */
  onClose: () => void;
  /** Ping aplikacyjny (Bybit zamyka połączenie bez pingu co ok. 20 s). */
  ping?: { everyMs: number; msg: object };
}

/**
 * Jedno połączenie WebSocket z adresem zależnym od subskrypcji: nowy adres → połączenie od nowa, null → zamknięcie.
 * Po zerwaniu ponowne łączenie co 1 s, 2 s, 4 s … do 30 s; licznik prób zeruje dopiero realna wiadomość.
 */
export class LiveSocket {
  private ws: WebSocket | null = null;
  private url: string | null = null;
  private attempt = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private pinger: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly h: LiveSocketHandlers) {}

  get open(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  setUrl(url: string | null): void {
    if (url === this.url) return;
    this.url = url;
    this.attempt = 0;
    this.drop();
    if (url) this.connect(url);
  }

  send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private connect(url: string): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      const ping = this.h.ping;
      if (ping) this.pinger = setInterval(() => this.send(ping.msg), ping.everyMs);
      this.h.onOpen();
    };
    ws.onmessage = (e: MessageEvent) => {
      if (typeof e.data !== 'string') return;
      this.attempt = 0;
      let msg: unknown;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      this.h.onMessage(msg);
    };
    // onerror zawsze poprzedza onclose — ponowne łączenie obsługuje onclose
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopPing();
      this.h.onClose();
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    if (!this.url || this.retry !== null) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      if (this.url) this.connect(this.url);
    }, cexReconnectDelayMs(this.attempt++));
  }

  private stopPing(): void {
    if (this.pinger !== null) clearInterval(this.pinger);
    this.pinger = null;
  }

  /** Zamyka bieżące połączenie (także w stanie CONNECTING) bez ponownego łączenia. */
  private drop(): void {
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onclose = null;
    ws.close();
    this.h.onClose();
  }
}
