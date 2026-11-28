import { decodeTailFrames } from '../../../src/utils/tailFrames.ts';

/**
 * Przekaźnik na żywo HyperQuant (Cloudflare Worker + Durable Object): gorący ogon nagrania skanera.
 * Skaner co kilka sekund wysyła jedną paczkę PUT /v1/tails z ogonami wszystkich nagrywanych rynków (ramki
 * `src/utils/tailFrames.ts`, treść każdej to JSON w gzip, token w nagłówku). Przeglądarka przy starcie wykresu pobiera
 * GET /v1/tail/:coin i dostaje brakujące minuty między ostatnią opublikowaną częścią historii (repo danych, pamięć CDN
 * do 5 min) a własnym strumieniem na żywo. Jeden obiekt trzyma ostatnie ogony w pamięci — bez bazy. Jedna paczka na takt
 * do jednego obiektu mieści całość w darmowym planie Cloudflare (dobowy limit żądań na konto, wspólny z `workers/alerts`).
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

/** Jedyny obiekt: ostatni ogon każdego rynku (bajty gzip, tak jak przyszły) i chwila przyjęcia. */
export class LiveTail {
  private readonly tails = new Map<string, { body: Uint8Array<ArrayBuffer>; at: number }>();

  constructor(_state?: unknown, _env?: unknown, private readonly now: () => number = Date.now) {}

  async fetch(req: Request): Promise<Response> {
    const t = this.now();
    if (req.method === 'PUT') {
      const buf = new Uint8Array(await req.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX_BUNDLE) return reply(413);
      const frames = decodeTailFrames(buf);
      // Cała paczka albo nic: zły rynek albo treść wskazuje na błąd po stronie skanera
      if (!frames || frames.some(([coin, body]) => !COIN.test(coin) || !isGzip(body) || body.length > MAX_BYTES)) return reply(400);
      for (const [coin, { at }] of this.tails) if (t - at > STALE_MS) this.tails.delete(coin);
      // Kopia: bez niej każdy ogon trzymałby w pamięci cały bufor paczki
      for (const [coin, body] of frames) this.tails.set(coin, { body: body.slice(), at: t });
      return reply(204);
    }
    const tail = this.tails.get(decodeURIComponent(new URL(req.url).pathname.slice(1)));
    if (!tail || t - tail.at > STALE_MS) return reply(404);
    // Bajty gzip bez Content-Encoding: przeglądarka rozpakowuje sama (gzJson), pośrednicy nie zmieniają treści
    return new Response(tail.body, { headers: { ...PUBLIC, 'content-type': 'application/octet-stream' } });
  }
}
