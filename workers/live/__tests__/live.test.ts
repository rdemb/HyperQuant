import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { type Env, LiveTail, MAX_BYTES, STALE_MS, handle } from '../src/tail.ts';

const TOKEN = 'a'.repeat(64);
const URL_ = 'https://hyperquant-live.example.workers.dev';

/** Przestrzeń obiektów jak w Cloudflare: jeden obiekt na nazwę, z własnym zegarem. */
function env(clock = { t: Date.UTC(2026, 10, 27, 22, 0, 0) }): { env: Env; clock: { t: number } } {
  const objects = new Map<string, LiveTail>();
  return {
    clock,
    env: {
      LIVE_PUSH_TOKEN: TOKEN,
      TAIL: {
        idFromName: (name: string) => name,
        get: (id: unknown) => {
          const name = String(id);
          if (!objects.has(name)) objects.set(name, new LiveTail(undefined, undefined, () => clock.t));
          return objects.get(name)!;
        },
      },
    },
  };
}

const put = (coin: string, body: Uint8Array<ArrayBuffer>, token = TOKEN) =>
  new Request(`${URL_}/v1/tail/${encodeURIComponent(coin)}`, { method: 'PUT', headers: { authorization: `Bearer ${token}` }, body });
const get = (coin: string) => new Request(`${URL_}/v1/tail/${encodeURIComponent(coin)}`);
const gz = (v: unknown): Uint8Array<ArrayBuffer> => new Uint8Array(gzipSync(JSON.stringify(v)));

describe('przekaźnik ogona — zapis tylko z tokenem, odczyt publiczny', () => {
  it('PUT bez tokenu albo z błędnym — 401; z tokenem — 204, a GET oddaje te same bajty bez pamięci podręcznej', async () => {
    const { env: e } = env();
    const body = gz({ v: 1, coin: 'BTC', asOf: 1, parts: [] });
    expect((await handle(put('BTC', body, ''), e)).status).toBe(401);
    expect((await handle(put('BTC', body, 'b'.repeat(64)), e)).status).toBe(401);
    expect((await handle(put('BTC', body), e)).status).toBe(204);
    const res = await handle(get('BTC'), e);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(body);
  });

  it('rynki osobno (xyz:GOLD w adresie zakodowany); brak ogona — 404', async () => {
    const { env: e } = env();
    expect((await handle(put('xyz:GOLD', gz({ coin: 'xyz:GOLD' })), e)).status).toBe(204);
    expect((await handle(get('xyz:GOLD'), e)).status).toBe(200);
    expect((await handle(get('BTC'), e)).status).toBe(404);
  });

  it('treść nie-gzip — 400; za duża — 413; zła ścieżka albo rynek — 404/400; inna metoda — 405', async () => {
    const { env: e } = env();
    expect((await handle(put('BTC', new TextEncoder().encode('{"v":1}')), e)).status).toBe(400);
    const big = new Request(`${URL_}/v1/tail/BTC`, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}`, 'content-length': String(MAX_BYTES + 1) }, body: gz({}) });
    expect((await handle(big, e)).status).toBe(413);
    expect((await handle(new Request(`${URL_}/v1/other`), e)).status).toBe(404);
    expect((await handle(get('BTC/../x'), e)).status).toBe(400);
    expect((await handle(new Request(`${URL_}/v1/tail/BTC`, { method: 'DELETE' }), e)).status).toBe(405);
  });

  it('ogon starszy niż STALE_MS nie jest wydawany (skaner przestał wysyłać)', async () => {
    const { env: e, clock } = env();
    await handle(put('BTC', gz({})), e);
    clock.t += STALE_MS;
    expect((await handle(get('BTC'), e)).status).toBe(200);
    clock.t += 1;
    expect((await handle(get('BTC'), e)).status).toBe(404);
  });

  it('OPTIONS: zgoda na GET z dowolnej strony (dane publiczne, bez ciasteczek)', async () => {
    const { env: e } = env();
    const res = await handle(new Request(`${URL_}/v1/tail/BTC`, { method: 'OPTIONS' }), e);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toBe('GET');
  });
});
