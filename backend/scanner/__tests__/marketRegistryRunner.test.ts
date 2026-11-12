import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isMarketRegistry, type MarketRegistry } from '../../../src/utils/marketRegistry.ts';
import type { InfoClient } from '../liqDetect.ts';
import { MARKET_REGISTRY_EVERY_MS, MarketRegistryRunner, REGISTRY_START_WINDOW } from '../marketRegistryRunner.ts';

const H = 3_600_000;
const DAY = 24 * H;
const T0 = Date.UTC(2026, 10, 1, 0, 30);

/** Fikstury w kształcie odpowiedzi API (dokumentacja „Info endpoint”, perpDexs i metaAndAssetCtxs z polem dex) */
const DEXES = [null, { name: 'xyz', fullName: 'XYZ', deployer: '0x' + 'ab'.repeat(20), oracleUpdater: null, feeRecipient: null }];
const MAIN = [
  {
    universe: [
      { name: 'BTC', szDecimals: 5, maxLeverage: 40 },
      { name: 'ETH', szDecimals: 4, maxLeverage: 25 },
      { name: 'SOL', szDecimals: 2, maxLeverage: 20 },
      { name: 'HYPE', szDecimals: 2, maxLeverage: 10 },
      { name: 'ZEC', szDecimals: 2, maxLeverage: 10 },
      { name: 'OLD', szDecimals: 0, maxLeverage: 3, isDelisted: true },
    ],
    marginTables: [],
    collateralToken: 0,
  },
  [
    { openInterest: '30000', markPx: '100000' },
    { openInterest: '500000', markPx: '3500' },
    { openInterest: '4000000', markPx: '150' },
    { openInterest: '20000000', markPx: '40' },
    { openInterest: '1000000', markPx: '300' },
    { openInterest: '9e9', markPx: '1' },
  ],
];
const XYZ = [
  { universe: [{ name: 'xyz:NVDA', szDecimals: 3, maxLeverage: 20 }, { name: 'xyz:GOLD', szDecimals: 4, maxLeverage: 20 }], marginTables: [], collateralToken: 0 },
  [
    { openInterest: '2000000', markPx: '180' },
    { openInterest: '0', markPx: '4000' },
  ],
];

interface Call {
  body: { type: string; dex?: string };
  weight: number;
}

function api(over: { main?: unknown; xyz?: unknown; dexes?: unknown } = {}) {
  const calls: Call[] = [];
  const rest: InfoClient = {
    async info(body: unknown, weight: number) {
      const b = body as Call['body'];
      calls.push({ body: b, weight });
      if (b.type === 'perpDexs') return 'dexes' in over ? over.dexes : DEXES;
      if (b.type === 'metaAndAssetCtxs') {
        if (b.dex === 'xyz') return 'xyz' in over ? over.xyz : XYZ;
        if (b.dex === undefined || b.dex === '') return 'main' in over ? over.main : MAIN;
      }
      return null;
    },
  };
  return { rest, calls };
}

function setup(over: Parameters<typeof api>[0] = {}, dir = mkdtempSync(join(tmpdir(), 'hq-markets-'))) {
  const { rest, calls } = api(over);
  const waits: number[] = [];
  const runner = new MarketRegistryRunner({
    rest,
    statePath: join(dir, 'markets-state.json'),
    outPath: join(dir, 'out', 'markets.json'),
    scannerCoins: ['BTC'],
    // Okno startu w slocie sprawdza osobny test; tu takt w dowolnej chwili
    startWindow: [0, 15 * 60_000],
    wait: async (ms) => {
      waits.push(ms);
    },
  });
  const file = () => JSON.parse(readFileSync(join(dir, 'out', 'markets.json'), 'utf8')) as MarketRegistry;
  return { runner, calls, waits, dir, file };
}

describe('MarketRegistryRunner', () => {
  it('jedno zapytanie perpDexs i jedno metaAndAssetCtxs na giełdę, waga 20 każde; plik poprawny z HIP-3', async () => {
    const { runner, calls, waits, file } = setup();
    const r = await runner.tick(T0);
    expect(r).toMatchObject({ ran: true, dexes: 2 });
    expect(calls.map((c) => c.body)).toEqual([{ type: 'perpDexs' }, { type: 'metaAndAssetCtxs' }, { type: 'metaAndAssetCtxs', dex: 'xyz' }]);
    expect(calls.reduce((a, c) => a + c.weight, 0)).toBe(60);
    // Zapytania giełd rozłożone w czasie (nie zabierają naraz całego wiadra wspólnego budżetu)
    expect(waits).toEqual([20_000]);
    const f = file();
    expect(isMarketRegistry(f)).toBe(true);
    expect(f.asOf).toBe(T0);
    expect(f.markets.map((m) => m.coin)).toEqual(['BTC', 'ETH', 'HYPE', 'SOL']);
    expect(f.markets[0]).toMatchObject({ coin: 'BTC', dex: '', oiUsd7d: 3e9, rank: 1, scanner: 'full', since: '2026-11-01' });
    // Publikacja bez adresów (pola giełd z perpDexs nie trafiają do pliku)
    expect(JSON.stringify(f)).not.toMatch(/0x[0-9a-f]{40}/i);
  });

  it('raz na godzinę: kolejny takt w ciągu godziny nic nie pobiera', async () => {
    const { runner, calls } = setup();
    await runner.tick(T0);
    const n = calls.length;
    expect(await runner.tick(T0 + MARKET_REGISTRY_EVERY_MS - 1)).toEqual({ ran: false });
    expect(calls).toHaveLength(n);
    expect((await runner.tick(T0 + MARKET_REGISTRY_EVERY_MS)).ran).toBe(true);
  });

  it('po 3 dniach rynki z pierwszej 20 (także HIP-3) wchodzą; since = dzień wejścia', async () => {
    const { runner, file } = setup();
    for (let t = T0; t <= T0 + 3 * DAY; t += H) await runner.tick(t);
    const f = file();
    expect(f.markets.map((m) => m.coin)).toEqual(['BTC', 'ETH', 'HYPE', 'SOL', 'xyz:NVDA', 'ZEC']);
    expect(f.markets.find((m) => m.coin === 'xyz:NVDA')).toMatchObject({ dex: 'xyz', since: '2026-11-04', szDecimals: 3, maxLeverage: 20, scanner: 'none' });
    // Wycofany i zerowe OI nie wchodzą
    expect(f.markets.some((m) => m.coin === 'OLD' || m.coin === 'xyz:GOLD')).toBe(false);
  });

  it('restart: nowy proces z tym samym stanem kontynuuje serie dni', async () => {
    const a = setup();
    for (let t = T0; t <= T0 + 2 * DAY; t += 6 * H) await a.runner.tick(t);
    expect(a.file().markets.map((m) => m.coin)).not.toContain('ZEC');
    const b = setup({}, a.dir);
    // Ten sam dzień, w ciągu godziny od ostatniej próbki poprzedniego procesu — bez zapytań
    expect(await b.runner.tick(T0 + 2 * DAY + 30 * 60_000)).toEqual({ ran: false });
    await b.runner.tick(T0 + 3 * DAY);
    expect(b.file().markets.map((m) => m.coin)).toContain('ZEC');
  });

  it('uszkodzony plik stanu → stan od nowa, bez wyjątku', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-markets-'));
    writeFileSync(join(dir, 'markets-state.json'), '{"v":1,"rule":"reg-v1"');
    const { runner, file } = setup({}, dir);
    expect((await runner.tick(T0)).ran).toBe(true);
    expect(file().markets).toHaveLength(4);
  });

  it('brak giełdy głównej albo listy giełd → błąd, stan bez zmian, ponowna próba w następnym takcie', async () => {
    const bad = setup({ main: null });
    const r = await bad.runner.tick(T0);
    expect(r.ran).toBe(false);
    expect(r.error).toMatch(/główn/);
    expect(() => bad.file()).toThrow();
    const noList = setup({ dexes: { error: 'x' } });
    expect((await noList.runner.tick(T0)).error).toMatch(/perpDexs/);
    // Kolejny takt (bez czekania godziny) próbuje od nowa
    const good = setup({}, bad.dir);
    expect((await good.runner.tick(T0 + 5 * 60_000)).ran).toBe(true);
  });

  it('niedostępna giełda HIP-3 nie wstrzymuje rejestru (rynki giełdy głównej zapisane)', async () => {
    const { runner, file } = setup({ xyz: null });
    const r = await runner.tick(T0);
    expect(r).toMatchObject({ ran: true, dexes: 1 });
    expect(r.error).toMatch(/xyz/);
    expect(file().markets.map((m) => m.coin)).toEqual(['BTC', 'ETH', 'HYPE', 'SOL']);
  });

  it('API w wycofaniu po błędach → takt pominięty bez zapytań', async () => {
    const { rest, calls } = api();
    const dir = mkdtempSync(join(tmpdir(), 'hq-markets-'));
    const runner = new MarketRegistryRunner({ rest: { ...rest, healthy: () => false }, statePath: join(dir, 's.json'), outPath: join(dir, 'm.json'), scannerCoins: ['BTC'], wait: async () => {} });
    expect(await runner.tick(T0)).toEqual({ ran: false });
    expect(calls).toHaveLength(0);
  });

  it('start tylko od 3. do 8. minuty 15-minutowego slotu (bez kolizji z wydaniem prognoz); takt co 5 min trafia w okno', async () => {
    expect(REGISTRY_START_WINDOW).toEqual([3 * 60_000, 8 * 60_000]);
    const { rest, calls } = api();
    const dir = mkdtempSync(join(tmpdir(), 'hq-markets-'));
    const runner = new MarketRegistryRunner({ rest, statePath: join(dir, 's.json'), outPath: join(dir, 'm.json'), scannerCoins: ['BTC'], wait: async () => {} });
    const slot = Date.UTC(2026, 10, 1, 10, 15);
    expect(await runner.tick(slot)).toEqual({ ran: false });
    expect(await runner.tick(slot + 2 * 60_000 + 59_000)).toEqual({ ran: false });
    expect(await runner.tick(slot + 8 * 60_000)).toEqual({ ran: false });
    expect(calls).toHaveLength(0);
    expect((await runner.tick(slot + 3 * 60_000)).ran).toBe(true);
    // Każde przesunięcie timera co 5 min ma w slocie dokładnie jeden takt w oknie
    for (let off = 0; off < 5 * 60_000; off += 30_000) {
      const inWin = [0, 1, 2].map((k) => (off + k * 5 * 60_000) % (15 * 60_000)).filter((m) => m >= 3 * 60_000 && m < 8 * 60_000);
      expect(inWin).toHaveLength(1);
    }
  });
});
