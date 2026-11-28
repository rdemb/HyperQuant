import { LIVE_FILE_NAME, LIVE_FILE_PREFIX, decodeTailFrames, encodeTailFrames } from '../../../src/utils/tailFrames.ts';

/**
 * Przekaźnik na żywo HyperQuant (Cloudflare Worker + Durable Object): gorący ogon nagrania skanera.
 * Skaner co kilka sekund wysyła jedną paczkę PUT /v1/tails z ogonami wszystkich nagrywanych rynków (ramki
 * `src/utils/tailFrames.ts`, treść każdej to JSON w gzip, token w nagłówku). Przeglądarka przy starcie wykresu pobiera
 * GET /v1/tail/:coin i dostaje brakujące minuty między ostatnią opublikowaną częścią historii (repo danych, pamięć CDN
 * do 5 min) a własnym strumieniem na żywo. Jeden obiekt trzyma ostatnie ogony w pamięci — bez bazy. Jedna paczka na takt
 * do jednego obiektu mieści całość w darmowym planie Cloudflare (dobowy limit żądań na konto, wspólny z `workers/alerts`).
 *
 * Kanał na żywo: ta sama paczka niesie pliki skanera (ramki `f:<ścieżka>`, np. `f:liq-tape/BTC.json`: likwidacje, wieloryby,
 * kohorty, mapy, status). Przeglądarka łączy się przez WebSocket z GET /v1/live, dostaje od razu bieżące pliki, a potem
 * każdą zmianę — zamiast czekać minuty na publikację w repo danych i pamięć CDN. Gniazda w trybie hibernacji: wiadomości
 * wysyłane do przeglądarek są w Cloudflare bezpłatne, połączenie to jedno żądanie, bezczynny obiekt nie liczy czasu.
 */

export interface DurableStub {
  fetch(req: Request): Promise<Response>;
}

export interface Env {
  /** Sekret Workera (wrangler secret put LIVE_PUSH_TOKEN); ten sam w HQ_LIVE_TOKEN skanera */
  LIVE_PUSH_TOKEN: string;
  TAIL: { idFromName(name: string): unknown; get(id: unknown): DurableStub };
}

/** Najwięcej bajtów ogona jednego rynku (po gzip); skaner nie wysyła większych (backend/scanner/liveTail.ts). */
export const MAX_BYTES = 4 << 20;
/** Najwięcej bajtów całej paczki. */
export const MAX_BUNDLE = 16 << 20;
/** Ogon starszy niż tyle ms nie jest wydawany (skaner przestał wysyłać — strona korzysta z samej historii). */
export const STALE_MS = 5 * 60_000;
const COIN = /^[A-Za-z0-9:_-]{1,24}$/;
/** Najwięcej gniazd przeglądarek naraz (ochrona obiektu; ponad limit — 503, strona korzysta z repo danych) */
export const MAX_SOCKETS = 2000;
const PUBLIC = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
/** Nazwa jedynego obiektu z ogonami. */
const OBJECT = 'tails';

const reply = (status: number, body: string | null = null) => new Response(body, { status, headers: PUBLIC });
const isGzip = (b: Uint8Array) => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;

/** Porównanie tokenów w czasie niezależnym od miejsca pierwszej różnicy. */
function sameToken(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Wejście Workera: trasa, rynek, autoryzacja zapisu; stan w jedynym obiekcie. */
export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...PUBLIC, 'access-control-allow-methods': 'GET', 'access-control-max-age': '86400' } });
  }
  const path = new URL(req.url).pathname;
  const stub = () => env.TAIL.get(env.TAIL.idFromName(OBJECT));
  if (path === '/v1/live') {
    if (req.method !== 'GET') return reply(405);
    if ((req.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') return reply(426, 'websocket');
    return stub().fetch(req);
  }
  if (path === '/v1/tails') {
    if (req.method !== 'PUT') return reply(405);
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    if (!env.LIVE_PUSH_TOKEN || !sameToken(token, env.LIVE_PUSH_TOKEN)) return reply(401);
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BUNDLE) return reply(413);
    return stub().fetch(new Request('https://tail/', { method: 'PUT', body: await req.arrayBuffer() }));
  }
  const m = path.match(/^\/v1\/tail\/([^/]+)$/);
  if (!m) return reply(404);
  if (req.method !== 'GET') return reply(405);
  let coin: string;
  try {
    coin = decodeURIComponent(m[1]);
  } catch {
    return reply(400);
  }
  if (!COIN.test(coin)) return reply(400);
  return stub().fetch(new Request(`https://tail/${encodeURIComponent(coin)}`, { method: 'GET' }));
}

/** Gniazdo przeglądarki (Cloudflare `WebSocket` z hibernacji; w testach atrapa). */
export interface LiveSocket {
  send(data: ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

/** Stan obiektu potrzebny kanałowi na żywo (Cloudflare `DurableObjectState`; w testach atrapa). */
export interface LiveState {
  acceptWebSocket(ws: LiveSocket): void;
  getWebSockets(): LiveSocket[];
}

/** Para gniazd i odpowiedź 101 (Cloudflare `WebSocketPair` i `Response` z `webSocket`); podmieniane w testach. */
export interface LiveRuntime {
  pair(): [LiveSocket, LiveSocket];
  upgraded(client: LiveSocket): Response;
}

const cloudflareRuntime: LiveRuntime = {
  pair: () => {
    const p = new (globalThis as unknown as { WebSocketPair: new () => Record<0 | 1, LiveSocket> }).WebSocketPair();
    return [p[0], p[1]];
  },
  upgraded: (client) => new Response(null, { status: 101, webSocket: client } as ResponseInit),
};

/**
 * Jedyny obiekt: ostatni ogon każdego rynku i ostatnia wersja każdego pliku skanera (bajty gzip, tak jak przyszły) z chwilą
 * przyjęcia; gniazda przeglądarek kanału na żywo.
 */
export class LiveTail {
  private readonly tails = new Map<string, { body: Uint8Array<ArrayBuffer>; at: number }>();
  private readonly files = new Map<string, { body: Uint8Array<ArrayBuffer>; at: number }>();

  constructor(
    private readonly state?: LiveState,
    _env?: unknown,
    private readonly now: () => number = Date.now,
    private readonly runtime: LiveRuntime = cloudflareRuntime
  ) {}

  async fetch(req: Request): Promise<Response> {
    const t = this.now();
    if (req.method === 'PUT') {
      const buf = new Uint8Array(await req.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX_BUNDLE) return reply(413);
      const frames = decodeTailFrames(buf);
      // Cała paczka albo nic: zły rynek albo treść wskazuje na błąd po stronie skanera
      if (!frames || frames.some(([name, body]) => !(COIN.test(name) || LIVE_FILE_NAME.test(name)) || !isGzip(body) || body.length > MAX_BYTES)) return reply(400);
      for (const [coin, { at }] of this.tails) if (t - at > STALE_MS) this.tails.delete(coin);
      const changed: [string, Uint8Array<ArrayBuffer>][] = [];
      for (const [name, body] of frames) {
        // Kopia: bez niej każdy wpis trzymałby w pamięci cały bufor paczki
        const copy = body.slice();
        if (!name.startsWith(LIVE_FILE_PREFIX)) {
          this.tails.set(name, { body: copy, at: t });
          continue;
        }
        const prev = this.files.get(name)?.body;
        this.files.set(name, { body: copy, at: t });
        if (!prev || !sameBytes(prev, copy)) changed.push([name, copy]);
      }
      // Zmienione pliki jedną wiadomością do każdego gniazda (wysyłanie bezpłatne; zerwane gniazdo nie przerywa reszty)
      if (changed.length > 0) this.broadcast(encodeTailFrames(changed));
      return reply(204);
    }
    if (new URL(req.url).pathname === '/v1/live') return this.live(t);
    const tail = this.tails.get(decodeURIComponent(new URL(req.url).pathname.slice(1)));
    if (!tail || t - tail.at > STALE_MS) return reply(404);
    // Bajty gzip bez Content-Encoding: przeglądarka rozpakowuje sama (gzJson), pośrednicy nie zmieniają treści
    return new Response(tail.body, { headers: { ...PUBLIC, 'content-type': 'application/octet-stream' } });
  }

  /** Nowe gniazdo przeglądarki: przyjęte do hibernacji i od razu bieżące pliki (nie starsze niż STALE_MS). */
  private live(t: number): Response {
    if (!this.state) return reply(503);
    if (this.state.getWebSockets().length >= MAX_SOCKETS) return reply(503);
    const [client, server] = this.runtime.pair();
    this.state.acceptWebSocket(server);
    const fresh = [...this.files].filter(([, f]) => t - f.at <= STALE_MS).map(([name, f]) => [name, f.body] as [string, Uint8Array<ArrayBuffer>]);
    if (fresh.length > 0) server.send(encodeTailFrames(fresh));
    return this.runtime.upgraded(client);
  }

  private broadcast(msg: Uint8Array<ArrayBuffer>): void {
    for (const ws of this.state?.getWebSockets() ?? []) {
      try {
        ws.send(msg);
      } catch {
        // gniazdo zamknięte po drugiej stronie — Cloudflare usunie je samo
      }
    }
  }

  /** Przeglądarka nic nie wysyła: wiadomość od niej jest ignorowana (bez kosztu ponad przychodzącą wiadomość). */
  webSocketMessage(): void {}

  webSocketClose(ws: LiveSocket, code: number): void {
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye');
    } catch {
      // już zamknięte
    }
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
