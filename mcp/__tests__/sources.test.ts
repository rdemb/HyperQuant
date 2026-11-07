import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BLOCK_MARK } from '../src/envelope';
import { configFromEnv } from '../src/sources';
import { toVBars } from '../../src/utils/auction';
import { buildVolModel } from '../../src/utils/volatility';
import { DATA_BASE, HL_INFO, HOUR, MAPS_URL, MIN, type FakeRequest, asCandles, fakeFetch, flatBars, hlCandles, hlRoute, testSources, walkBars } from './helpers';

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

  it('login, hasło, zapytanie albo kotwica w adresie bazowym — błąd startu z nazwą zmiennej, bez wartości w komunikacie', () => {
    const bad = ['https://user:s3cret-word@example.test/data', 'https://user@example.test/data', 'https://example.test/data?token=s3cret-word', 'https://example.test/data?', 'https://example.test/data#s3cret-word'];
    for (const v of bad) {
      let msg = '';
      try {
        configFromEnv({ HQ_DATA_BASE: v }, f);
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg, v).toContain('HQ_DATA_BASE');
      expect(msg, v).not.toContain('s3cret-word');
    }
    expect(() => configFromEnv({ HQ_SITE_BASE: 'https://a:b@site.test' }, f)).toThrow(/HQ_SITE_BASE/);
    // Adres lokalny do testów: nazwa hosta, nie IP (IP w `sources[].url` zablokowałby każdą odpowiedź)
    expect(configFromEnv({ HQ_DATA_BASE: 'http://localhost:8080/data' }, f).dataBase).toBe('http://localhost:8080/data');
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

  it('fetch odrzuca — {ok:false, why}, bez wyjątku; porażka w pamięci 30 s, potem nowe żądanie', async () => {
    const { src, calls, clock } = testSources({ [FILE]: new Error('ECONNRESET') }, NOW);
    const r = await src.published('BTC/test.json', isV);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.why).toBeTruthy();
    expect(r.url).toBe(FILE);
    clock.now = NOW + 29_000;
    const again = await src.published('BTC/test.json', isV);
    expect(again.ok).toBe(false);
    expect(calls).toHaveLength(1);
    clock.now = NOW + 31_000;
    await src.published('BTC/test.json', isV);
    expect(calls).toHaveLength(2);
  });

  it('HTTP 5xx — porażka w pamięci 30 s', async () => {
    const { src, calls, clock } = testSources({ [FILE]: { status: 503, json: {} } }, NOW);
    await src.published('BTC/test.json', isV);
    clock.now = NOW + 29_000;
    await src.published('BTC/test.json', isV);
    expect(calls).toHaveLength(1);
    clock.now = NOW + 30_000;
    await src.published('BTC/test.json', isV);
    expect(calls).toHaveLength(2);
  });

  it('HTTP 429 — porażka w pamięci 60 s: drugie wywołanie w tym czasie bez żądania, po 60 s nowe', async () => {
    const { src, calls, clock } = testSources({ [HL_INFO]: { status: 429, json: {} } }, NOW);
    const a = await src.candles('1m', NOW - 60 * MIN);
    expect(!a.ok && a.why).toContain('429');
    clock.now = NOW + 59_000;
    const b = await src.candles('1m', NOW - 60 * MIN);
    expect(!b.ok && b.why).toContain('429');
    expect(calls).toHaveLength(1);
    clock.now = NOW + 60_000;
    await src.candles('1m', NOW - 60 * MIN);
    expect(calls).toHaveLength(2);
  });

  it('błąd sieci z adresem na granicy przycięcia: powód bez ciągu ≥ 20 znaków hex, z blokadą treści', async () => {
    // Komunikat z adresem od znaku 116: przycięcie przed sprawdzeniem zostawiłoby „0x” i 30 znaków hex
    const filler = 'awaria '.repeat(16) + 'zzzz';
    expect(filler).toHaveLength(116);
    const { src } = testSources({ [FILE]: new Error(filler + '0x' + 'b'.repeat(40)) }, NOW);
    const r = await src.published('BTC/test.json', isV);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.why).not.toMatch(/[0-9a-fA-F]{20,}/);
    expect(r.why).toContain(BLOCK_MARK);
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

  it('okno ponad 4 części (20 000 świec) — {ok:false} bez żadnego żądania', async () => {
    const { src, calls } = testSources({ [HL_INFO]: hlRoute([]) }, NOW);
    const r = await src.candles('1m', NOW - 20_001 * MIN);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.why).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('jawne `to`: endTime w żądaniu, świece po `to` odrzucone', async () => {
    const from = NOW - 120 * MIN;
    const to = NOW - 60 * MIN;
    const { src, calls } = testSources({ [HL_INFO]: hlRoute(flatBars(from, NOW, 79_900, 80_100)) }, NOW);
    const r = await src.candles('1m', from, to);
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '1m', startTime: from, endTime: to } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(61);
    expect(r.value[0].t).toBe(from);
    expect(r.value[r.value.length - 1].t).toBe(to);
  });

  it('nieudane żądanie którejkolwiek części — {ok:false}', async () => {
    const { src } = testSources({ [HL_INFO]: { status: 500, json: {} } }, NOW);
    const r = await src.candles('5m', NOW - 600 * MIN);
    expect(r.ok).toBe(false);
  });
});

describe('Sources.volModel', () => {
  const h1 = walkBars(1200, HOUR, NOW, 0.004, 3);
  const m5 = walkBars(2000, 5 * MIN, NOW, 0.0015, 7);

  it('model HAR ze świec 1h i 5m (po ≤ 5000, jedno żądanie na interwał) przez buildVolModel; w TTL 15 min bez nowych żądań', async () => {
    const { src, calls, clock } = testSources({ [HL_INFO]: hlCandles({ '1h': h1, '5m': m5 }) }, NOW);
    const r = await src.volModel();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ref = buildVolModel(toVBars(asCandles(h1)), toVBars(asCandles(m5)), NOW);
    expect(ref).not.toBeNull();
    expect(r.value?.har.coef).toEqual(ref?.har.coef);
    expect(r.value?.nextHourStartMs).toBe(ref?.nextHourStartMs);
    expect(calls.map((c) => JSON.parse(c.body ?? '{}').req)).toEqual([
      { coin: 'BTC', interval: '1h', startTime: Math.floor((NOW - 4999 * HOUR) / HOUR) * HOUR },
      { coin: 'BTC', interval: '5m', startTime: Math.floor((NOW - 4999 * 5 * MIN) / (5 * MIN)) * 5 * MIN },
    ]);
    clock.now = NOW + 14 * MIN;
    await src.volModel();
    expect(calls).toHaveLength(2);
    clock.now = NOW + 16 * MIN;
    await src.volModel();
    expect(calls).toHaveLength(4);
  });

  it('Hyperliquid odrzuca — {ok:false} z powodem; modelu nie ma w pamięci, świece z porażką 30 s, potem nowe żądania', async () => {
    const { src, calls, clock } = testSources({ [HL_INFO]: { status: 502, json: {} } }, NOW);
    const r = await src.volModel();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.why).toContain('502');
    clock.now = NOW + 20_000;
    expect((await src.volModel()).ok).toBe(false);
    expect(calls).toHaveLength(2);
    clock.now = NOW + 31_000;
    await src.volModel();
    expect(calls).toHaveLength(4);
  });

  it('za mało świec na model — value null (bez pamięci modelu: kolejne wywołanie po TTL świec buduje znowu)', async () => {
    const { src, calls, clock } = testSources({ [HL_INFO]: hlCandles({ '1h': h1.slice(-600), '5m': m5 }) }, NOW);
    const r = await src.volModel();
    expect(r.ok && r.value).toBeNull();
    clock.now = NOW + 2 * MIN;
    await src.volModel();
    expect(calls).toHaveLength(4);
  });
});
