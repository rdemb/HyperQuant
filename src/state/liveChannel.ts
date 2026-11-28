import { LIVE_FILE_PREFIX, decodeTailFrames } from '../utils/tailFrames';

/**
 * Kanał na żywo z przekaźnika (`workers/live`, GET /v1/live przez WebSocket): po połączeniu bieżące pliki skanera, potem
 * każda ich zmiana (status, mapy, taśma likwidacji, kohorty, wieloryby) — co kilka sekund zamiast minut przez repo danych
 * i pamięć CDN. Wiadomość to ramki `src/utils/tailFrames.ts` z nazwą `f:<ścieżka>` i JSON-em w gzip. Jedno połączenie na
 * kartę; zerwane wraca po 5 s, potem co dłużej (do 60 s). Bez połączenia strona działa jak dotąd, z repo danych.
 */

/** Gniazdo w przeglądarce (WebSocket) — tylko to, czego kanał używa; w testach atrapa. */
export interface LiveWs {
  binaryType: string;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  close(): void;
}

export interface LiveDeps {
  open: (url: string) => LiveWs;
  /** Bajty gzip → tekst */
  gunzip: (bytes: Uint8Array) => Promise<string>;
  setTimeout: (fn: () => void, ms: number) => unknown;
}

export const LIVE_RETRY_MIN_MS = 5_000;
export const LIVE_RETRY_MAX_MS = 60_000;

/** Adres kanału z adresu przekaźnika: https → wss, http → ws. */
export const liveUrl = (base: string): string => `${base.replace(/^http/, 'ws').replace(/\/+$/, '')}/v1/live`;

/** Pliki z wiadomości kanału: [ścieżka, JSON]; ramki bez przedrostka `f:` i nieczytelne pominięte, zła wiadomość — nic. */
export async function filesOf(data: ArrayBuffer | Uint8Array, gunzip: LiveDeps['gunzip']): Promise<[string, unknown][]> {
  const frames = decodeTailFrames(data instanceof Uint8Array ? data : new Uint8Array(data));
  if (!frames) return [];
  const out: [string, unknown][] = [];
  for (const [name, body] of frames) {
    if (!name.startsWith(LIVE_FILE_PREFIX)) continue;
    try {
      out.push([name.slice(LIVE_FILE_PREFIX.length), JSON.parse(await gunzip(body))]);
    } catch {
      // uszkodzona ramka nie psuje pozostałych
    }
  }
  return out;
}

export class LiveChannel {
  private ws: LiveWs | null = null;
  private started = false;
  private retryMs = LIVE_RETRY_MIN_MS;

  constructor(
    private readonly url: string,
    private readonly onFile: (path: string, json: unknown) => void,
    private readonly deps: LiveDeps
  ) {}

  /** Otwiera połączenie (raz; kolejne wywołania nic nie robią). */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.connect();
  }

  private connect(): void {
    let ws: LiveWs;
    try {
      ws = this.deps.open(this.url);
    } catch {
      this.retry();
      return;
    }
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.retryMs = LIVE_RETRY_MIN_MS;
    };
    ws.onmessage = (ev) => {
      if (!(ev.data instanceof ArrayBuffer)) return;
      void filesOf(ev.data, this.deps.gunzip).then((files) => {
        for (const [path, json] of files) this.onFile(path, json);
      });
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.retry();
    };
  }

  private retry(): void {
    const ms = this.retryMs;
    this.retryMs = Math.min(LIVE_RETRY_MAX_MS, this.retryMs * 2);
    this.deps.setTimeout(() => this.connect(), ms);
  }
}

/** Zależności przeglądarki: WebSocket i DecompressionStream. */
export const browserLiveDeps = (): LiveDeps => ({
  open: (url) => new WebSocket(url) as unknown as LiveWs,
  gunzip: (bytes) => new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'))).text(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
});
