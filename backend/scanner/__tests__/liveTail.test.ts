import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeTailFrames } from '../../../src/utils/tailFrames.ts';
import type { TailFile } from '../../../src/utils/tapeHistory.ts';
import { FILES_FULL_EVERY, TAIL_MAX_BYTES, pushTails, tailPusher } from '../liveTail.ts';

const T = Date.UTC(2026, 10, 27, 22, 0, 0);
const tail = (coin: string): TailFile => ({ v: 1, coin, asOf: T, parts: [] });
const cfg = { url: 'https://live.example.workers.dev', token: 'sekret', everyS: 5 };

/** fetch zapisujący żądania; `status` — odpowiedź, `fail` — błąd sieci. */
function recorder(status = 200, fail = false) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (fail) throw new Error('sieć');
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { calls, fn };
}

/** Treść paczki → [rynek, ogon] (rozpakowane). */
const unpack = (body: unknown) => decodeTailFrames(body as Uint8Array)!.map(([coin, gz]) => [coin, JSON.parse(gunzipSync(gz).toString('utf8'))]);

describe('pushTails — paczka ogonów do przekaźnika', () => {
  it('jeden PUT na /v1/tails z ogonami wszystkich rynków (każdy JSON w gzip), token w nagłówku', async () => {
    const r = recorder();
    expect(await pushTails(cfg, [tail('BTC'), tail('xyz:GOLD')], r.fn)).toBe(true);
    expect(r.calls).toHaveLength(1);
    const { url, init } = r.calls[0];
    expect(url).toBe('https://live.example.workers.dev/v1/tails');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sekret');
    expect(unpack(init.body)).toEqual([['BTC', tail('BTC')], ['xyz:GOLD', tail('xyz:GOLD')]]);
  });

  it('odmowa albo błąd sieci — false, bez wyjątku; za duży ogon pominięty, reszta idzie', async () => {
    expect(await pushTails(cfg, [tail('BTC')], recorder(401).fn)).toBe(false);
    expect(await pushTails(cfg, [tail('BTC')], recorder(200, true).fn)).toBe(false);
    // Losowe bajty (szesnastkowo) nie kompresują się: ponad limit także po gzip
    const noise = { ...tail('ETH'), parts: [{ start: T, trades: Array.from({ length: TAIL_MAX_BYTES / 4 }, () => Math.random().toString(16).slice(2)).join(''), book: null }] } as unknown as TailFile;
    const mixed = recorder();
    expect(await pushTails(cfg, [noise, tail('BTC')], mixed.fn)).toBe(true);
    expect(unpack(mixed.calls[0].init.body).map(([c]) => c)).toEqual(['BTC']);
    const only = recorder();
    expect(await pushTails(cfg, [noise], only.fn)).toBe(false);
    expect(only.calls).toHaveLength(0);
    // Plik o nazwie spoza wzorca przekaźnika pominięty — inaczej przekaźnik odrzuciłby całą paczkę z ogonami
    const named = recorder();
    const gzText = (t: string) => new Uint8Array(gzipSync(t));
    expect(await pushTails(cfg, [tail('BTC')], named.fn, [['liq-map/xyz:GOLD.json', gzText('{}')], ['status.json', gzText('{}')]])).toBe(true);
    expect(decodeTailFrames(named.calls[0].init.body as Uint8Array)!.map(([n]) => n)).toEqual(['BTC', 'f:status.json']);
  });
});

describe('tailPusher — takt wysyłki', () => {
  it('jedna paczka na takt; rynek bez ogona pominięty; nic do wysłania — bez żądania; wynik w onResult', async () => {
    const r = recorder();
    const results: boolean[] = [];
    let eth: TailFile | null = null;
    const tick = tailPusher(cfg, [{ tail: () => tail('BTC') }, { tail: () => eth }], (ok) => results.push(ok), r.fn);
    await tick(T);
    eth = tail('ETH');
    await tick(T + 5000);
    expect(r.calls.map((c) => unpack(c.init.body).map(([coin]) => coin))).toEqual([['BTC'], ['BTC', 'ETH']]);
    expect(results).toEqual([true, true]);
    const idle = recorder();
    await tailPusher(cfg, [{ tail: () => null }], () => results.push(false), idle.fn)(T);
    expect(idle.calls).toHaveLength(0);
    expect(results).toHaveLength(2);
  });

  it('wolny przekaźnik: kolejny takt nie wysyła drugiej paczki, zanim pierwsza się skończy', async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    // Pierwsza wysyłka czeka na bramkę, kolejne kończą się od razu
    const slow = (async () => {
      if (calls++ === 0) await gate;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const tick = tailPusher(cfg, [{ tail: () => tail('BTC') }, { tail: () => tail('ETH') }], () => {}, slow);
    const first = tick(T);
    await tick(T + 5000);
    expect(calls).toBe(1);
    release();
    await first;
    await tick(T + 10_000);
    expect(calls).toBe(2);
  });
});

describe('pliki skanera w paczce (kanał na żywo)', () => {
  /** Nazwy ramek z każdej wysłanej paczki. */
  const names = (r: ReturnType<typeof recorder>) => r.calls.map((c) => decodeTailFrames(c.init.body as Uint8Array)!.map(([n]) => n));

  it('ramki f:<ścieżka> obok ogonów; niezmieniony plik nie idzie drugi raz; zmieniony — tak; same pliki bez ogonów też wysyłane', async () => {
    const r = recorder();
    let tape = '{"asOf":1}';
    const files = () => [['liq-tape/BTC.json', tape], ['status.json', '{"asOf":1}']] as [string, string][];
    const tick = tailPusher(cfg, [{ tail: () => tail('BTC') }], () => {}, r.fn, files);
    await tick(T);
    await tick(T + 5000);
    tape = '{"asOf":2}';
    const noTails = tailPusher(cfg, [], () => {}, r.fn, () => [['whales.json', '{"asOf":1}']]);
    await tick(T + 10_000);
    await noTails(T);
    expect(names(r)).toEqual([['BTC', 'f:liq-tape/BTC.json', 'f:status.json'], ['BTC'], ['BTC', 'f:liq-tape/BTC.json'], ['f:whales.json']]);
    const body = decodeTailFrames(r.calls[2].init.body as Uint8Array)!.find(([n]) => n === 'f:liq-tape/BTC.json')![1];
    expect(gunzipSync(body).toString('utf8')).toBe('{"asOf":2}');
  });

  it(`nieudana wysyłka: pliki idą ponownie w następnym takcie; co ${FILES_FULL_EVERY} taktów wszystkie (przekaźnik po restarcie)`, async () => {
    let fail = true;
    const calls: string[][] = [];
    const fn = (async (_url: string, init: RequestInit) => {
      calls.push(decodeTailFrames(init.body as Uint8Array)!.map(([n]) => n));
      return new Response(null, { status: fail ? 503 : 204 });
    }) as unknown as typeof fetch;
    const tick = tailPusher(cfg, [], () => {}, fn, () => [['status.json', '{"asOf":1}']]);
    await tick(T);
    fail = false;
    await tick(T + 5000);
    for (let i = 2; i < FILES_FULL_EVERY + 1; i++) await tick(T + i * 5000);
    // takt 0 (nieudany), takt 1 (ponowienie), potem cisza do taktu 12 (pełny zestaw)
    expect(calls).toEqual([['f:status.json'], ['f:status.json'], ['f:status.json']]);
  });
});
