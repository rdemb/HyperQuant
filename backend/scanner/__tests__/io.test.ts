import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.ts';
import { putObject } from '../r2.ts';
import { HlRest, HlStream } from '../hl.ts';
import { WeightLimiter } from '../rateLimiter.ts';
import { AddressBook } from '../addressBook.ts';
import { Scanner } from '../scanner.ts';
import { isLiqMap } from '../../../src/utils/liqMap.ts';

const R2 = { R2_ACCOUNT_ID: 'acc', R2_BUCKET: 'bkt', R2_ACCESS_KEY_ID: 'kid', R2_SECRET_ACCESS_KEY: 'sec' };

describe('loadConfig — wyłącznie zmienne środowiskowe', () => {
  it('wymaga katalogów stanu i wyjścia; wartości domyślne dla reszty', () => {
    expect(loadConfig({}).ok).toBe(false);
    const r = loadConfig({ HQ_STATE_DIR: '/s', HQ_OUT_DIR: '/o' });
    expect(r.ok && r.config).toMatchObject({ coin: 'BTC', weightPerMin: 240, publishEveryS: 60, maxAddresses: 50000, seedTop: 5000, seedMinUsd: 100000, r2: null });
    expect(loadConfig({ HQ_STATE_DIR: '/s', HQ_OUT_DIR: '/o', HQ_SEED_TOP: '0' }).ok).toBe(true);
    expect(loadConfig({ HQ_STATE_DIR: '/s', HQ_OUT_DIR: '/o', HQ_SEED_TOP: '99999' }).ok).toBe(false);
  });

  it('R2 tylko komplet czterech zmiennych; budżet i okres w bezpiecznym zakresie', () => {
    expect(loadConfig({ HQ_STATE_DIR: '/s', HQ_OUT_DIR: '/o', R2_BUCKET: 'b' }).ok).toBe(false);
    const ok = loadConfig({ HQ_STATE_DIR: '/s', HQ_OUT_DIR: '/o', ...R2 });
    expect(ok.ok && ok.config.r2).toEqual({ accountId: 'acc', bucket: 'bkt', accessKeyId: 'kid', secretAccessKey: 'sec' });
    expect(loadConfig({ HQ_STATE_DIR: '/s', HQ_OUT_DIR: '/o', HQ_WEIGHT_PER_MIN: '900' }).ok).toBe(false);
    expect(loadConfig({ HQ_STATE_DIR: '/s', HQ_OUT_DIR: '/o', HQ_PUBLISH_EVERY_S: '5' }).ok).toBe(false);
  });

  it('publikacja przez git: zdalne repo SSH wymaga klucza; okres ≥ 60 s; repo lokalne bez klucza', () => {
    const base = { HQ_STATE_DIR: '/s', HQ_OUT_DIR: '/o' };
    expect(loadConfig({ ...base, HQ_GIT_REMOTE: 'git@github.com:x/y.git' }).ok).toBe(false);
    const ok = loadConfig({ ...base, HQ_GIT_REMOTE: 'git@github.com:x/y.git', HQ_GIT_SSH_KEY: '/k' });
    expect(ok.ok && ok.config.git).toEqual({ remote: 'git@github.com:x/y.git', sshKey: '/k', everyS: 120 });
    expect(loadConfig({ ...base, HQ_GIT_REMOTE: '/tmp/bare', HQ_GIT_EVERY_S: '30' }).ok).toBe(false);
    const r = loadConfig(base);
    expect(r.ok && r.config.git).toBeNull();
  });
});

describe('putObject — zapis do R2', () => {
  it('PUT na <konto>.r2.cloudflarestorage.com/<bucket>/<klucz> z podpisem, hashem treści i Cache-Control', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
    const ok = await putObject(
      { accountId: 'acc', bucket: 'bkt', accessKeyId: 'kid', secretAccessKey: 'sec' },
      'liq-map/BTC.json',
      '{"a":1}',
      { contentType: 'application/json', cacheControl: 'public, max-age=30', now: Date.UTC(2026, 9, 22), fetchFn }
    );
    expect(ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://acc.r2.cloudflarestorage.com/bkt/liq-map/BTC.json');
    const h = init.headers as Record<string, string>;
    expect(init.method).toBe('PUT');
    expect(h.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=kid\/20261022\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(h['x-amz-content-sha256']).toBe('015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862');
    expect(h['cache-control']).toBe('public, max-age=30');
  });

  it('odpowiedź inna niż 2xx albo błąd sieci → false', async () => {
    const cfg = { accountId: 'a', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's' };
    expect(await putObject(cfg, 'k', 'x', { fetchFn: vi.fn(async () => new Response(null, { status: 403 })) })).toBe(false);
    expect(await putObject(cfg, 'k', 'x', { fetchFn: vi.fn(async () => Promise.reject(new Error('net'))) })).toBe(false);
  });
});

describe('HlRest — zapytania info z budżetem', () => {
  it('200 → JSON; 429 → null i kara w limiterze', async () => {
    const limiter = new WeightLimiter(240);
    const ok = new HlRest(limiter, vi.fn(async () => new Response('{"x":1}', { status: 200 })), () => 0, async () => {});
    expect(await ok.info({ type: 'clearinghouseState', user: '0x1' }, 2)).toEqual({ x: 1 });
    const busy = new HlRest(limiter, vi.fn(async () => new Response('', { status: 429 })), () => 1000, async () => {});
    expect(await busy.info({ type: 'clearinghouseState', user: '0x1' }, 2)).toBeNull();
    expect(limiter.perMinAt(2000)).toBe(120);
    expect(limiter.reserve(2, 2000)).toBeGreaterThanOrEqual(29_000);
  });
});

describe('Scanner — cykl skanu i publikacji', () => {
  function setup(r2 = false, nowFn: () => number = () => 120_000, fail = false) {
    const failing = { calls: 0 };
    const out = mkdtempSync(join(tmpdir(), 'hq-'));
    const book = new AddressBook();
    book.recordTrade(['0xaaa', '0xbbb'], 1e6, 0);
    const states: Record<string, unknown> = {
      '0xaaa': { assetPositions: [{ position: { coin: 'BTC', szi: '10', entryPx: '83000', liquidationPx: '75000' } }] },
      '0xbbb': { assetPositions: [{ position: { coin: 'BTC', szi: '-4', entryPx: '83000', liquidationPx: '90000' } }] },
    };
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url.includes('r2.cloudflarestorage.com')) return new Response(null, { status: 200 });
      const body = JSON.parse(String(init?.body));
      if (fail) {
        failing.calls++;
        return new Response('', { status: 503 });
      }
      return new Response(JSON.stringify(states[body.user]), { status: 200 });
    });
    const scanner = new Scanner({
      coin: 'BTC',
      book,
      rest: new HlRest(new WeightLimiter(240), fetchFn as unknown as typeof fetch, () => 0, async () => {}),
      outDir: out,
      r2: r2 ? { accountId: 'a', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's' } : null,
      fetchFn: fetchFn as unknown as typeof fetch,
      now: nowFn,
    });
    scanner.setCtx({ markPx: 83000, oiBtc: 20, dayNtlVlm: 2e9 });
    return { scanner, out, calls, failing };
  }

  it('skanuje adresy z taśmy i zapisuje mapę oraz status bez adresów', async () => {
    const { scanner, out } = setup();
    expect(await scanner.scanDue(10)).toBe(2);
    expect(await scanner.publish()).toBe(true);
    const map = JSON.parse(readFileSync(join(out, 'liq-map', 'BTC.json'), 'utf8'));
    expect(isLiqMap(map)).toBe(true);
    expect(map.coverage.share).toBeCloseTo(14 / 40, 12);
    expect(map.longs[0].px).toBe(75000);
    const statusTxt = readFileSync(join(out, 'status.json'), 'utf8');
    expect(statusTxt).not.toMatch(/0x/);
    expect(JSON.parse(statusTxt)).toMatchObject({ coin: 'BTC', addresses: 2, positions: 2, seeded: 0 });
  });

  it('kontekst rynku starszy niż 5 min: brak publikacji (stara cena nie udaje aktualnej)', async () => {
    let now = 120_000;
    const { scanner } = setup(false, () => now);
    now += 6 * 60_000;
    expect(await scanner.publish()).toBe(false);
  });

  it('nieudany odczyt oznacza adres jako wstrzymany na minutę', async () => {
    const { scanner, failing } = setup(false, () => 120_000, true);
    expect(await scanner.scanDue(10)).toBe(0);
    expect(failing.calls).toBe(2);
    expect(await scanner.scanDue(10)).toBe(0);
    expect(failing.calls).toBe(2);
  });

  it('bez ceny mark i OI nic nie publikuje (brak danych ≠ zero)', async () => {
    const { scanner, out } = setup();
    scanner.setCtx({ markPx: Number.NaN, oiBtc: 20, dayNtlVlm: 1 });
    expect(await scanner.publish()).toBe(false);
    expect(existsSync(join(out, 'liq-map', 'BTC.json'))).toBe(false);
  });

  it('z konfiguracją R2 wysyła mapę i status do bucketu', async () => {
    const { scanner, calls } = setup(true);
    await scanner.scanDue(10);
    await scanner.publish();
    expect(calls.filter((c) => c.includes('r2.cloudflarestorage.com'))).toEqual([
      'https://a.r2.cloudflarestorage.com/b/liq-map/BTC.json',
      'https://a.r2.cloudflarestorage.com/b/status.json',
    ]);
  });
});

describe('HlStream — odporność połączenia', () => {
  class FakeWs {
    static OPEN = 1;
    static instances: FakeWs[] = [];
    readyState = 0;
    sent: string[] = [];
    closed = false;
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public url: string) {
      FakeWs.instances.push(this);
    }
    send(s: string) {
      this.sent.push(s);
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      this.readyState = 3;
      this.onclose?.();
    }
    open() {
      this.readyState = 1;
      this.onopen?.();
    }
  }

  it('połączenie zrywane zaraz po otwarciu: przerwy rosną 1 s → 2 s → 4 s (bez resetu przy samym otwarciu)', () => {
    vi.useFakeTimers();
    FakeWs.instances = [];
    const s = new HlStream('BTC', () => {}, () => {}, FakeWs as unknown as typeof WebSocket);
    s.start();
    const delays: number[] = [];
    for (let k = 0; k < 3; k++) {
      const ws = FakeWs.instances[FakeWs.instances.length - 1];
      ws.open();
      ws.close();
      const before = FakeWs.instances.length;
      let waited = 0;
      while (FakeWs.instances.length === before && waited < 120_000) {
        vi.advanceTimersByTime(500);
        waited += 500;
      }
      delays.push(waited);
    }
    s.stop();
    vi.useRealTimers();
    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it('strażnik: brak wiadomości przez 90 s zamyka połączenie (zawieszony socket nie udaje „ok”)', () => {
    vi.useFakeTimers();
    FakeWs.instances = [];
    const s = new HlStream('BTC', () => {}, () => {}, FakeWs as unknown as typeof WebSocket);
    s.start();
    const ws = FakeWs.instances[0];
    ws.open();
    expect(s.connected).toBe(true);
    vi.advanceTimersByTime(60_000);
    ws.onmessage?.({ data: '{"channel":"pong"}' });
    vi.advanceTimersByTime(80_000);
    expect(ws.closed).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect(ws.closed).toBe(true);
    expect(s.connected).toBe(false);
    s.stop();
    vi.useRealTimers();
  });
});
