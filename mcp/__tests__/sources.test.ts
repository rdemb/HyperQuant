import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { configFromEnv } from '../src/sources';
import { DATA_BASE, HL_INFO, MAPS_URL, MIN, type FakeRequest, fakeFetch, flatBars, hlRoute, testSources } from './helpers';

const NOW = Date.UTC(2026, 10, 4, 15, 0);
const FILE = `${DATA_BASE}/BTC/test.json`;
const isV = (x: unknown): x is { v: number } => typeof x === 'object' && x !== null && typeof (x as { v?: unknown }).v === 'number';

describe('configFromEnv', () => {
  const f = fakeFetch({}).fetch;

  it('domyślne adresy publiczne i wersja paczki', () => {
    const c = configFromEnv({}, f);
    expect(c.dataBase).toBe(DATA_BASE);
    expect(c.historyBase).toBe(`${DATA_BASE}/history`);
    expect(c.siteBase).toBe('https://hyperquant.tech');
    expect(c.hlInfo).toBe(HL_INFO);
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(c.version).toBe(pkg.version);
  });

  it('HQ_DATA_BASE i HQ_SITE_BASE nadpisują adresy (bez końcowego ukośnika)', () => {
    const c = configFromEnv({ HQ_DATA_BASE: 'https://example.test/data/', HQ_SITE_BASE: 'https://site.test/' }, f);
    expect(c.dataBase).toBe('https://example.test/data');
    expect(c.historyBase).toBe('https://example.test/data/history');
    expect(c.siteBase).toBe('https://site.test');
  });

  it('adres spoza http(s) jest odrzucany', () => {
    expect(() => configFromEnv({ HQ_DATA_BASE: 'file:///etc' }, f)).toThrow();
  });
});

describe('Sources.published', () => {
  it('drugie pobranie w TTL (60 s) nie woła fetch, po TTL woła; nagłówek User-Agent bez danych użytkownika', async () => {
    const { src, calls, clock } = testSources({ [FILE]: { json: { v: 1 } } }, NOW);
    const a = await src.published('BTC/test.json', isV);
    expect(a).toMatchObject({ ok: true, value: { v: 1 }, url: FILE, at: NOW });
    expect(calls[0].headers.get('user-agent')).toBe('hyperquant-mcp/0.1.0');
    clock.now = NOW + 59_000;
    await src.published('BTC/test.json', isV);
    expect(calls).toHaveLength(1);
    clock.now = NOW + 61_000;
    const b = await src.published('BTC/test.json', isV);
    expect(calls).toHaveLength(2);
    expect(b.ok && b.at).toBe(NOW + 61_000);
  });

  it('fetch odrzuca — {ok:false, why}, bez wyjątku; błąd nie zostaje w pamięci', async () => {
    const { src, calls } = testSources({ [FILE]: new Error('ECONNRESET') }, NOW);
    const r = await src.published('BTC/test.json', isV);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.why).toBeTruthy();
    expect(r.url).toBe(FILE);
    await src.published('BTC/test.json', isV);
    expect(calls).toHaveLength(2);
  });

  it('odpowiedź 429 — {ok:false} z kodem w powodzie', async () => {
    const { src } = testSources({ [FILE]: { status: 429, json: {} } }, NOW);
    const r = await src.published('BTC/test.json', isV);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.why).toContain('429');
  });

  it('zły JSON i kształt odrzucony przez guard — {ok:false}', async () => {
    const bad = testSources({ [FILE]: { text: '{nie json' } }, NOW);
    expect((await bad.src.published('BTC/test.json', isV)).ok).toBe(false);
    const shape = testSources({ [FILE]: { json: { x: 1 } } }, NOW);
    expect((await shape.src.published('BTC/test.json', isV)).ok).toBe(false);
  });

  it('brak odpowiedzi — limit czasu żądania kończy pobranie {ok:false}', async () => {
    const hang = (req: FakeRequest) =>
      new Promise<never>((_, reject) => req.signal?.addEventListener('abort', () => reject(req.signal?.reason), { once: true }));
    const { src } = testSources({ [FILE]: hang }, NOW, { timeoutMs: 50 });
    const t0 = performance.now();
    const r = await src.published('BTC/test.json', isV);
    expect(r.ok).toBe(false);
    expect(performance.now() - t0).toBeLessThan(2_000);
  });
});

describe('Sources.blogMaps', () => {
  it('plik map z bloga przez parseBlogMaps; zły format — {ok:false}', async () => {
    const map = { id: '2026-11-04-mapa-dnia', title: 'Mapa dnia', kind: 'dzien', publishedAt: NOW - 8 * 60 * MIN, price: 80_000, levels: [{ label: 'opór', price: 80_500 }], url: 'blog/2026-11-04-mapa-dnia/' };
    const good = testSources({ [MAPS_URL]: { json: { v: 1, asOf: NOW - MIN, maps: [map] } } }, NOW);
    const r = await good.src.blogMaps();
    expect(r.ok && r.value.status).toBe('ready');
    expect(r.ok && r.value.maps.map((m) => m.id)).toEqual(['2026-11-04-mapa-dnia']);
    expect(r.ok && r.asOf).toBe(NOW - MIN);
    const bad = testSources({ [MAPS_URL]: { json: { v: 2, maps: [] } } }, NOW);
    expect((await bad.src.blogMaps()).ok).toBe(false);
  });
});

describe('Sources.candles', () => {
  it('okno 6000 świec 1m dzielone na 2 żądania po ≤ 5000, wynik scalony rosnąco', async () => {
    const from = NOW - 6000 * MIN;
    const { src, calls } = testSources({ [HL_INFO]: hlRoute(flatBars(from, NOW, 79_900, 80_100)) }, NOW);
    const r = await src.candles('1m', from);
    expect(calls).toHaveLength(2);
    const bodies = calls.map((c) => JSON.parse(c.body ?? '{}'));
    expect(bodies[0]).toEqual({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '1m', startTime: from, endTime: from + 5000 * MIN - 1 } });
    expect(bodies[1]).toEqual({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '1m', startTime: from + 5000 * MIN } });
    expect(calls.every((c) => c.method === 'POST')).toBe(true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(6000);
    expect(r.value[0].t).toBe(from);
    expect(r.value[5999].t).toBe(NOW - MIN);
    expect(r.value.every((c, i) => i === 0 || c.t > r.value[i - 1].t)).toBe(true);
  });

  it('okno krótsze niż 5000 świec — jedno żądanie; drugie w TTL z pamięci', async () => {
    const from = NOW - 60 * MIN;
    const { src, calls } = testSources({ [HL_INFO]: hlRoute(flatBars(from, NOW, 79_900, 80_100)) }, NOW);
    expect((await src.candles('1m', from)).ok).toBe(true);
    await src.candles('1m', from);
    expect(calls).toHaveLength(1);
  });

  it('nieudane żądanie którejkolwiek części — {ok:false}', async () => {
    const { src } = testSources({ [HL_INFO]: { status: 500, json: {} } }, NOW);
    const r = await src.candles('5m', NOW - 600 * MIN);
    expect(r.ok).toBe(false);
  });
});
