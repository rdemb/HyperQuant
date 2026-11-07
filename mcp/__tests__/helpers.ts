/**
 * Wspólne narzędzia testów paczki MCP: fałszywy `fetch` (mapa URL → odpowiedź, bez sieci), źródła ze stałym zegarem,
 * klient MCP w pamięci i syntetyczne świece w formacie `candleSnapshot` Hyperliquid.
 */
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { Candle } from '../../src/charts/pro/hl/parse';
import { createServer } from '../src/server';
import { Sources, configFromEnv, type SourcesConfig } from '../src/sources';

export const MIN = 60_000;
export const HL_INFO = 'https://api.hyperliquid.xyz/info';
export const DATA_BASE = 'https://raw.githubusercontent.com/rdemb/hyperquant-data/main';
/** Gałąź `history` tego samego repo (jak `HISTORY_BASE` strony). */
export const HISTORY_BASE = 'https://raw.githubusercontent.com/rdemb/hyperquant-data/history';
export const MAPS_URL = 'https://hyperquant.tech/blog/maps.json';

export interface FakeRequest {
  url: string;
  method: string;
  body: string | null;
  headers: Headers;
  signal: AbortSignal | null;
}

/** Odpowiedź trasy: JSON (domyślnie 200), surowy tekst, bajty (np. plik gzip) albo błąd sieci (odrzucenie `fetch`). */
export type Reply = { status?: number; json?: unknown; text?: string; bytes?: Uint8Array } | Error;
export type Route = Reply | ((req: FakeRequest) => Reply | Promise<Reply>);

/** `fetch` z mapy URL → odpowiedź; adres spoza mapy dostaje 404, więc test nigdy nie wychodzi do sieci. */
export function fakeFetch(routes: Record<string, Route>): { fetch: typeof fetch; calls: FakeRequest[] } {
  const calls: FakeRequest[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const req: FakeRequest = {
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : null,
      headers: new Headers(init?.headers),
      signal: init?.signal ?? null,
    };
    calls.push(req);
    const route = routes[url];
    const reply = typeof route === 'function' ? await route(req) : route;
    if (reply === undefined) return new Response('not found', { status: 404 });
    if (reply instanceof Error) throw reply;
    if (reply.bytes) return new Response(new Uint8Array(reply.bytes), { status: reply.status ?? 200, headers: { 'content-type': 'application/octet-stream' } });
    const body = reply.text ?? JSON.stringify(reply.json);
    return new Response(body, { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: impl as typeof fetch, calls };
}

/** Źródła z domyślną konfiguracją, fałszywym `fetch` i zegarem przestawianym w teście (`clock.now`). */
export function testSources(routes: Record<string, Route>, now: number, extra: Partial<SourcesConfig> = {}) {
  const f = fakeFetch(routes);
  const clock = { now };
  const cfg: SourcesConfig = { ...configFromEnv({}, f.fetch), now: () => clock.now, ...extra };
  return { src: new Sources(cfg), calls: f.calls, clock };
}

/** Serwer i klient MCP połączone w pamięci (prawdziwy protokół, bez stdio). */
export async function connect(src: Sources): Promise<{ client: Client; close: () => Promise<void> }> {
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  const server = createServer(src);
  const client = new Client({ name: 'hq-test', version: '0.0.0' });
  await server.connect(serverEnd);
  await client.connect(clientEnd);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Świece 1m od `from` do `to` (bez `to`) w płaskim kanale `lo`–`hi`; `spikes` podmienia high/low wybranych minut. */
export function flatBars(from: number, to: number, lo: number, hi: number, spikes: Record<number, { h?: number; l?: number }> = {}): Bar[] {
  const out: Bar[] = [];
  const mid = (lo + hi) / 2;
  for (let t = from; t < to; t += MIN) {
    const s = spikes[t] ?? {};
    out.push({ t, o: mid, h: s.h ?? hi, l: s.l ?? lo, c: mid, v: 1.5 });
  }
  return out;
}

/**
 * Trasa `candleSnapshot`: świece z `bars` w zakresie [startTime, endTime] z treści żądania, w formacie API (liczby jako
 * tekst). Z `clock` — jak prawdziwe API: tylko świece rozpoczęte do chwili żądania. Inny typ żądania — 400.
 */
export function hlRoute(bars: readonly Bar[], clock?: { now: number }): (req: FakeRequest) => Reply {
  return hlCandles({ '1m': bars, '5m': bars, '1h': bars }, clock, MIN);
}

export const HOUR = 60 * MIN;
const STEP = { '1m': MIN, '5m': 5 * MIN, '1h': HOUR } as const;
export type Interval = keyof typeof STEP;

/**
 * Trasa `candleSnapshot` z osobnymi świecami każdego interwału (interwał bez świec — pusta lista), poza tym jak `hlRoute`.
 * `span` — długość świecy w polu `T` (domyślnie długość interwału).
 */
export function hlCandles(byInterval: Partial<Record<Interval, readonly Bar[]>>, clock?: { now: number }, span?: number): (req: FakeRequest) => Reply {
  return (req) => {
    const body = JSON.parse(req.body ?? '{}') as { type?: string; req?: { coin?: string; interval?: string; startTime?: number; endTime?: number } };
    const iv = body.req?.interval;
    if (body.type !== 'candleSnapshot' || body.req?.coin !== 'BTC' || iv === undefined || !(iv in STEP)) return { status: 400, json: { error: 'bad request' } };
    const from = body.req.startTime ?? 0;
    const to = Math.min(body.req.endTime ?? Number.POSITIVE_INFINITY, clock?.now ?? Number.POSITIVE_INFINITY);
    const len = span ?? STEP[iv as Interval];
    const json = (byInterval[iv as Interval] ?? [])
      .filter((b) => b.t >= from && b.t <= to)
      .map((b) => ({ t: b.t, T: b.t + len - 1, s: 'BTC', i: iv, o: String(b.o), c: String(b.c), h: String(b.h), l: String(b.l), v: String(b.v), n: 12 }));
    return { json };
  };
}

/**
 * `n` świec co `stepMs`, ostatnia rozpoczęta w pełnym kroku ≤ `end`: błądzenie losowe wokół 100 000 z generatora
 * Parka–Millera (ziarno `seed`), więc przy każdym uruchomieniu te same świece; wolumen 50–150.
 */
export function walkBars(n: number, stepMs: number, end: number, sigma: number, seed = 1): Bar[] {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const last = Math.floor(end / stepMs) * stepMs;
  let px = 100_000;
  return Array.from({ length: n }, (_, k) => {
    const o = px;
    const c = o * Math.exp(sigma * (rnd() - 0.5) * 3.4);
    px = c;
    return { t: last - (n - 1 - k) * stepMs, o, h: Math.max(o, c) * (1 + sigma * rnd()), l: Math.min(o, c) * (1 - sigma * rnd()), c, v: 50 + 100 * rnd() };
  });
}

/** Świece w kształcie `Candle` strony (jak po `parseCandles`) — do porównań z funkcjami strony na tych samych danych. */
export const asCandles = (bars: readonly Bar[]): Candle[] => bars.map((b) => ({ ...b, n: 12 }));
