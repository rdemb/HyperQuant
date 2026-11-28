import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeTailFrames } from '../../../src/utils/tailFrames.ts';
import type { TailFile } from '../../../src/utils/tapeHistory.ts';
import { TAIL_MAX_BYTES, pushTails, tailPusher } from '../liveTail.ts';

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
