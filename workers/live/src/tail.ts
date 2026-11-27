/**
 * Przekaźnik na żywo HyperQuant (Cloudflare Worker + Durable Object): gorący ogon nagrania skanera.
 * Skaner co kilka sekund wysyła PUT /v1/tail/:coin (JSON w gzip, token w nagłówku), przeglądarka przy starcie wykresu
 * pobiera GET /v1/tail/:coin i dostaje brakujące minuty między ostatnią opublikowaną częścią historii (repo danych,
 * pamięć CDN do 5 min) a własnym strumieniem na żywo. Jeden obiekt na rynek trzyma ostatni ogon w pamięci — bez bazy.
 */

export interface DurableStub {
  fetch(req: Request): Promise<Response>;
}

export interface Env {
  /** Sekret Workera (wrangler secret put LIVE_PUSH_TOKEN); ten sam w HQ_LIVE_TOKEN skanera */
  LIVE_PUSH_TOKEN: string;
  TAIL: { idFromName(name: string): unknown; get(id: unknown): DurableStub };
}

/** Najwięcej bajtów ogona (po gzip); skaner nie wysyła większych (backend/scanner/liveTail.ts). */
export const MAX_BYTES = 4 << 20;
/** Ogon starszy niż tyle ms nie jest wydawany (skaner przestał wysyłać — strona korzysta z samej historii). */
export const STALE_MS = 5 * 60_000;
const COIN = /^[A-Za-z0-9:_-]{1,24}$/;
const PUBLIC = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };

const reply = (status: number, body: string | null = null) => new Response(body, { status, headers: PUBLIC });

/** Porównanie tokenów w czasie niezależnym od miejsca pierwszej różnicy. */
function sameToken(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Wejście Workera: trasa, rynek, autoryzacja zapisu; stan w obiekcie rynku. */
export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...PUBLIC, 'access-control-allow-methods': 'GET', 'access-control-max-age': '86400' } });
  }
  const m = new URL(req.url).pathname.match(/^\/v1\/tail\/([^/]+)$/);
  if (!m) return reply(404);
  let coin: string;
  try {
    coin = decodeURIComponent(m[1]);
  } catch {
    return reply(400);
  }
  if (!COIN.test(coin)) return reply(400);
  const stub = env.TAIL.get(env.TAIL.idFromName(coin));
  if (req.method === 'GET') return stub.fetch(new Request('https://tail/', { method: 'GET' }));
  if (req.method !== 'PUT') return reply(405);
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!env.LIVE_PUSH_TOKEN || !sameToken(token, env.LIVE_PUSH_TOKEN)) return reply(401);
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return reply(413);
  return stub.fetch(new Request('https://tail/', { method: 'PUT', body: await req.arrayBuffer() }));
}

/** Obiekt rynku: ostatni ogon (bajty gzip, tak jak przyszły) i chwila przyjęcia. */
export class LiveTail {
  private body: ArrayBuffer | null = null;
  private at = 0;

  constructor(_state?: unknown, _env?: unknown, private readonly now: () => number = Date.now) {}

  async fetch(req: Request): Promise<Response> {
    if (req.method === 'PUT') {
      const buf = await req.arrayBuffer();
      if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return reply(413);
      const head = new Uint8Array(buf, 0, 2);
      if (head[0] !== 0x1f || head[1] !== 0x8b) return reply(400);
      this.body = buf;
      this.at = this.now();
      return reply(204);
    }
    if (!this.body || this.now() - this.at > STALE_MS) return reply(404);
    // Bajty gzip bez Content-Encoding: przeglądarka rozpakowuje sama (gzJson), pośrednicy nie zmieniają treści
    return new Response(this.body, { headers: { ...PUBLIC, 'content-type': 'application/octet-stream' } });
  }
}
