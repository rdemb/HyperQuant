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
import { isLiqTape } from '../../../src/utils/liqTape.ts';
import { isCohortFlow } from '../../../src/utils/cohorts.ts';
import { CohortEngine } from '../cohortEngine.ts';

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
    const fills: Record<string, unknown[]> = {};
    const bodies: Record<string, unknown>[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url.includes('r2.cloudflarestorage.com')) return new Response(null, { status: 200 });
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (fail) {
        failing.calls++;
        return new Response('', { status: 503 });
      }
      if (body.type === 'userFillsByTime') return new Response(JSON.stringify(fills[body.user] ?? []), { status: 200 });
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
    return { scanner, out, calls, failing, states, fills, book, bodies };
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
      'https://a.r2.cloudflarestorage.com/b/liq-tape/BTC.json',
      'https://a.r2.cloudflarestorage.com/b/status.json',
    ]);
  });

  it('z silnikiem kohort publikuje cohorts/BTC.json (agregaty bez adresów, tylko kubełki obserwowane w całości)', async () => {
    const out = mkdtempSync(join(tmpdir(), 'hq-'));
    const book = new AddressBook();
    const cohorts = new CohortEngine({ coin: 'BTC', isWhale: (a) => book.isWhale(a) });
    for (let i = 0; i < 6; i++) cohorts.onTrade({ users: [`0x${'a'.repeat(39)}${i}`, `0x${'b'.repeat(39)}${i}`], side: 'B', px: 83_000, sz: 1, time: i });
    // publikowane są tylko kubełki zamknięte (15 min) — publikacja po zamknięciu pierwszego
    const scanner = new Scanner({
      coin: 'BTC',
      book,
      rest: new HlRest(new WeightLimiter(240), (async () => new Response('null')) as unknown as typeof fetch, () => 0, async () => {}),
      outDir: out,
      r2: null,
      now: () => 16 * 60_000,
      tapeSince: 0,
      cohorts,
    });
    scanner.setCtx({ markPx: 83000, oiBtc: 20, dayNtlVlm: 2e9 });
    expect(await scanner.publish()).toBe(true);
    const txt = readFileSync(join(out, 'cohorts', 'BTC.json'), 'utf8');
    expect(txt).not.toMatch(/0x[0-9a-f]{40}/i);
    const flow = JSON.parse(txt);
    expect(isCohortFlow(flow)).toBe(true);
    expect(flow.since).toBe(0);
    expect(flow.totals.h24.rest.buy).toBe(500_000); // 6 × 83 000 zaokrąglone do 10 tys.
  });

  it('likwidacja śledzonej pozycji: kandydat po zniknięciu pozycji przy cenie likwidacji, potwierdzenie fillem, taśma bez adresów', async () => {
    let now = 120_000;
    const { scanner, out, states, fills, book, bodies } = setup(false, () => now);
    await scanner.scanDue(10);
    // Cena spada do ceny likwidacji longa 0xaaa (75 000); pozycja znika, adres handlował
    now = 4 * 60_000;
    scanner.recordTrade(74_990, now - 30_000);
    states['0xaaa'] = { assetPositions: [] };
    fills['0xaaa'] = [
      { coin: 'BTC', px: '74980', sz: '10', side: 'A', time: now - 30_000, tid: 42, liquidation: { markPx: 74_995, method: 'market' } },
    ];
    book.recordTrade(['0xaaa', '0xccc'], 1, now - 30_000);
    states['0xccc'] = { assetPositions: [] };
    await scanner.scanDue(10);
    expect(await scanner.confirmLiquidations()).toBe(1);
    scanner.setCtx({ markPx: 75_000, oiBtc: 20, dayNtlVlm: 2e9 });
    expect(await scanner.publish()).toBe(true);
    const txt = readFileSync(join(out, 'liq-tape', 'BTC.json'), 'utf8');
    expect(txt).not.toMatch(/0x[0-9a-f]{3}/i);
    const tape = JSON.parse(txt);
    expect(isLiqTape(tape)).toBe(true);
    expect(tape.events).toHaveLength(1);
    expect(tape.events[0]).toMatchObject({ side: 'long', sz: 10, method: 'market', mapLiqPx: 75000 });
    expect(tape.checks).toEqual({ candidates: 1, confirmed: 1, rejected: 0, failed: 0 });
    const status = JSON.parse(readFileSync(join(out, 'status.json'), 'utf8'));
    expect(status).toMatchObject({ liq24h: 1, liqPending: 0 });
    // Okno fillów od minuty pierwszego dotknięcia ceny likwidacji (minus minuta), nie wcześniej niż poprzedni odczyt
    const fillsCall = bodies.find((b) => b.type === 'userFillsByTime');
    expect(fillsCall).toMatchObject({ user: '0xaaa', startTime: 120_000 - 1000, endTime: 240_000 + 1000 });
    // Przerwa w danych: obserwacja od nowa, starsze zdarzenia nie udają ciągłości
    now = 10 * 60_000;
    scanner.resetObservation(now);
    scanner.setCtx({ markPx: 75_000, oiBtc: 20, dayNtlVlm: 2e9 });
    await scanner.publish();
    const after = JSON.parse(readFileSync(join(out, 'liq-tape', 'BTC.json'), 'utf8'));
    expect(after.since).toBe(now);
    expect(after.events).toEqual([]);
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

  it('transakcje powtórzone po ponownym połączeniu (ten sam czas i tid) są pomijane', () => {
    FakeWs.instances = [];
    const got: number[] = [];
    const s = new HlStream('BTC', (ts) => got.push(...ts.map((t) => t.tid as number)), () => {}, FakeWs as unknown as typeof WebSocket);
    s.start();
    const ws = FakeWs.instances[0];
    ws.open();
    const msg = (tids: number[]) => ({ data: JSON.stringify({ channel: 'trades', data: tids.map((tid) => ({ coin: 'BTC', side: 'B', px: '1', sz: '1', time: 1000, tid })) }) });
    ws.onmessage?.(msg([1, 2]));
    ws.onmessage?.(msg([2, 3])); // np. migawka po ponownej subskrypcji
    s.stop();
    expect(got).toEqual([1, 2, 3]);
  });

  it('opcjonalny arkusz: subskrypcja l2Book zagregowanego do 4 cyfr znaczących i przekazanie migawek (czas, poziomy)', () => {
    FakeWs.instances = [];
    const got: { t: number; levels: unknown }[] = [];
    const s = new HlStream('BTC', () => {}, () => {}, FakeWs as unknown as typeof WebSocket, (t, levels) => got.push({ t, levels }));
    s.start();
    const ws = FakeWs.instances[0];
    ws.open();
    const subs = ws.sent.map((x) => JSON.parse(x).subscription).filter(Boolean);
    expect(subs).toContainEqual({ type: 'l2Book', coin: 'BTC', nSigFigs: 4 });
    ws.onmessage?.({ data: JSON.stringify({ channel: 'l2Book', data: { coin: 'BTC', time: 1234, levels: [[{ px: '1', sz: '1', n: 1 }], []] } }) });
    s.stop();
    expect(got).toEqual([{ t: 1234, levels: [[{ px: '1', sz: '1', n: 1 }], []] }]);
    // zmiana agregacji (cena przekroczyła próg): wypisanie starej subskrypcji i zapis nowej
    const s3 = new HlStream('BTC', () => {}, () => {}, FakeWs as unknown as typeof WebSocket, () => {});
    s3.start();
    const ws3 = FakeWs.instances[FakeWs.instances.length - 1];
    ws3.open();
    ws3.sent.length = 0;
    s3.setBookAgg({ nSigFigs: 5, mantissa: 2 });
    expect(ws3.sent.map((x) => JSON.parse(x))).toEqual([
      { method: 'unsubscribe', subscription: { type: 'l2Book', coin: 'BTC', nSigFigs: 4 } },
      { method: 'subscribe', subscription: { type: 'l2Book', coin: 'BTC', nSigFigs: 5, mantissa: 2 } },
    ]);
    s3.setBookAgg({ nSigFigs: 5, mantissa: 2 }); // bez zmian — bez wiadomości
    expect(ws3.sent).toHaveLength(2);
    s3.stop();
    // bez callbacku — bez subskrypcji arkusza
    FakeWs.instances = [];
    const s2 = new HlStream('BTC', () => {}, () => {}, FakeWs as unknown as typeof WebSocket);
    s2.start();
    FakeWs.instances[0].open();
    expect(FakeWs.instances[0].sent.some((x) => x.includes('l2Book'))).toBe(false);
    s2.stop();
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
