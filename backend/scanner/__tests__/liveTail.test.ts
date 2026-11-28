import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { TailFile } from '../../../src/utils/tapeHistory.ts';
import { TAIL_MAX_BYTES, pushTail, tailPusher } from '../liveTail.ts';

const T = Date.UTC(2026, 10, 27, 22, 0, 0);
const tail = (coin: string): TailFile => ({ v: 1, coin, asOf: T, parts: [] });
const cfg = { url: 'https://live.example.workers.dev', token: 'sekret' };

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

describe('pushTail — ogon do przekaźnika', () => {
  it('PUT na adres rynku (zakodowany), token w nagłówku, treść to JSON w gzip', async () => {
    const r = recorder();
    expect(await pushTail(cfg, tail('xyz:GOLD'), r.fn)).toBe(true);
    const { url, init } = r.calls[0];
    expect(url).toBe('https://live.example.workers.dev/v1/tail/xyz%3AGOLD');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sekret');
    expect(JSON.parse(gunzipSync(init.body as Buffer).toString('utf8'))).toEqual(tail('xyz:GOLD'));
  });

  it('odmowa albo błąd sieci — false, bez wyjątku; za duży ogon nie jest wysyłany', async () => {
    expect(await pushTail(cfg, tail('BTC'), recorder(401).fn)).toBe(false);
    expect(await pushTail(cfg, tail('BTC'), recorder(200, true).fn)).toBe(false);
    const big = recorder();
    // Losowe bajty (szesnastkowo) nie kompresują się: ponad limit także po gzip
    const noise = Array.from({ length: TAIL_MAX_BYTES / 4 }, () => Math.random().toString(16).slice(2)).join('');
    expect(await pushTail(cfg, { ...tail('BTC'), coin: noise }, big.fn)).toBe(false);
    expect(big.calls).toHaveLength(0);
  });
});

describe('tailPusher — takt wysyłki', () => {
  it('ogon każdego rynku; brak ogona — bez wysyłki; wynik w onResult', async () => {
    const r = recorder();
    const results: [string, boolean][] = [];
    const tick = tailPusher(cfg, [{ coin: 'BTC', tail: () => tail('BTC') }, { coin: 'xyz:SP500', tail: () => null }], (c, ok) => results.push([c, ok]), r.fn);
    await tick(T);
    expect(r.calls.map((c) => c.url)).toEqual(['https://live.example.workers.dev/v1/tail/BTC']);
    expect(results).toEqual([['BTC', true]]);
  });

  it('wolny przekaźnik: kolejny takt nie wysyła drugi raz tego samego rynku, zanim pierwszy się skończy', async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    // Pierwsza wysyłka czeka na bramkę, kolejne kończą się od razu
    const slow = (async () => {
      if (calls++ === 0) await gate;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const tick = tailPusher(cfg, [{ coin: 'BTC', tail: () => tail('BTC') }], () => {}, slow);
    const first = tick(T);
    await tick(T + 3000);
    expect(calls).toBe(1);
    release();
    await first;
    await tick(T + 6000);
    expect(calls).toBe(2);
  });
});
