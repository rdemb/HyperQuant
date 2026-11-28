import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodeTailFrames } from '../../../src/utils/tailFrames.ts';
import { type Env, LiveTail, MAX_BUNDLE, MAX_BYTES, STALE_MS, handle } from '../src/tail.ts';

const TOKEN = 'a'.repeat(64);
const URL_ = 'https://hyperquant-live.example.workers.dev';

/** Przestrzeń obiektów jak w Cloudflare: jeden obiekt na nazwę, z własnym zegarem; `names` — użyte nazwy. */
function env(clock = { t: Date.UTC(2026, 10, 27, 22, 0, 0) }) {
  const objects = new Map<string, LiveTail>();
  const e: Env = {
    LIVE_PUSH_TOKEN: TOKEN,
    TAIL: {
      idFromName: (name: string) => name,
      get: (id: unknown) => {
        const name = String(id);
        if (!objects.has(name)) objects.set(name, new LiveTail(undefined, undefined, () => clock.t));
        return objects.get(name)!;
      },
    },
  };
  return { env: e, clock, names: () => [...objects.keys()] };
}

const gz = (v: unknown): Uint8Array<ArrayBuffer> => new Uint8Array(gzipSync(JSON.stringify(v)));
const bundle = (entries: [string, Uint8Array][]) => encodeTailFrames(entries);
const put = (body: Uint8Array, token = TOKEN) =>
  new Request(`${URL_}/v1/tails`, { method: 'PUT', headers: { authorization: `Bearer ${token}` }, body: new Uint8Array(body) });
const get = (coin: string) => new Request(`${URL_}/v1/tail/${encodeURIComponent(coin)}`);

describe('przekaźnik ogona — paczka z tokenem, odczyt publiczny', () => {
  it('PUT bez tokenu albo z błędnym — 401; z tokenem — 204, a GET każdego rynku oddaje jego bajty bez pamięci podręcznej', async () => {
    const { env: e } = env();
    const btc = gz({ v: 1, coin: 'BTC', asOf: 1, parts: [] });
    const gold = gz({ v: 1, coin: 'xyz:GOLD', asOf: 1, parts: [] });
    const body = bundle([['BTC', btc], ['xyz:GOLD', gold]]);
    expect((await handle(put(body, ''), e)).status).toBe(401);
    expect((await handle(put(body, 'b'.repeat(64)), e)).status).toBe(401);
    expect((await handle(put(body), e)).status).toBe(204);
    const res = await handle(get('BTC'), e);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(btc);
    expect(new Uint8Array(await (await handle(get('xyz:GOLD'), e)).arrayBuffer())).toEqual(gold);
    expect((await handle(get('ETH'), e)).status).toBe(404);
  });

  it('wszystkie rynki w jednym obiekcie (jedno żądanie do obiektu na paczkę); rynek spoza kolejnej paczki zostaje', async () => {
    const { env: e, names } = env();
    await handle(put(bundle([['BTC', gz(1)], ['ETH', gz(1)]])), e);
    await handle(put(bundle([['BTC', gz(2)]])), e);
    await handle(get('ETH'), e);
    expect(names()).toEqual(['tails']);
    expect((await handle(get('ETH'), e)).status).toBe(200);
    expect(new Uint8Array(await (await handle(get('BTC'), e)).arrayBuffer())).toEqual(gz(2));
  });

  it('zła paczka, rynek albo treść nie-gzip — 400 dla całej paczki; za duża — 413; zła ścieżka — 404/400; inna metoda — 405', async () => {
    const { env: e } = env();
    const ok = bundle([['BTC', gz({})]]);
    expect((await handle(put(ok.subarray(0, ok.length - 1)), e)).status).toBe(400);
    expect((await handle(put(bundle([['BTC', gz({})], ['ETH', new TextEncoder().encode('{"v":1}')]])), e)).status).toBe(400);
    expect((await handle(put(bundle([['BTC/../x', gz({})]])), e)).status).toBe(400);
    expect((await handle(put(bundle([['BTC', new Uint8Array(MAX_BYTES + 1).fill(0x1f)]])), e)).status).toBe(400);
    expect((await handle(get('BTC'), e)).status).toBe(404);
    const big = new Request(`${URL_}/v1/tails`, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}`, 'content-length': String(MAX_BUNDLE + 1) }, body: ok });
    expect((await handle(big, e)).status).toBe(413);
    expect((await handle(new Request(`${URL_}/v1/other`), e)).status).toBe(404);
    expect((await handle(get('BTC/../x'), e)).status).toBe(400);
    expect((await handle(new Request(`${URL_}/v1/tail/BTC`, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}` }, body: gz({}) }), e)).status).toBe(405);
    expect((await handle(new Request(`${URL_}/v1/tails`), e)).status).toBe(405);
  });

  it('ogon starszy niż STALE_MS nie jest wydawany (skaner przestał wysyłać rynek)', async () => {
    const { env: e, clock } = env();
    await handle(put(bundle([['BTC', gz({})]])), e);
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
