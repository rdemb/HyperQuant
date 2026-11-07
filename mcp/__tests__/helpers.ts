/**
 * Wspólne narzędzia testów paczki MCP: fałszywy `fetch` (mapa URL → odpowiedź, bez sieci), źródła ze stałym zegarem,
 * klient MCP w pamięci i syntetyczne świece w formacie `candleSnapshot` Hyperliquid.
 */
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../src/server';
import { Sources, configFromEnv, type SourcesConfig } from '../src/sources';

export const MIN = 60_000;
export const HL_INFO = 'https://api.hyperliquid.xyz/info';
export const DATA_BASE = 'https://raw.githubusercontent.com/rdemb/hyperquant-data/main';
export const MAPS_URL = 'https://hyperquant.tech/blog/maps.json';

export interface FakeRequest {
  url: string;
  method: string;
  body: string | null;
  headers: Headers;
  signal: AbortSignal | null;
}

/** Odpowiedź trasy: JSON (domyślnie 200), surowy tekst albo błąd sieci (odrzucenie `fetch`). */
export type Reply = { status?: number; json?: unknown; text?: string } | Error;
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
  return (req) => {
    const body = JSON.parse(req.body ?? '{}') as { type?: string; req?: { coin?: string; interval?: string; startTime?: number; endTime?: number } };
    if (body.type !== 'candleSnapshot' || body.req?.coin !== 'BTC') return { status: 400, json: { error: 'bad request' } };
    const from = body.req.startTime ?? 0;
    const to = Math.min(body.req.endTime ?? Number.POSITIVE_INFINITY, clock?.now ?? Number.POSITIVE_INFINITY);
    const json = bars
      .filter((b) => b.t >= from && b.t <= to)
      .map((b) => ({ t: b.t, T: b.t + MIN - 1, s: 'BTC', i: body.req?.interval, o: String(b.o), c: String(b.c), h: String(b.h), l: String(b.l), v: String(b.v), n: 12 }));
    return { json };
  };
}
