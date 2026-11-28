import { afterEach, describe, expect, it } from 'vitest';
import { APP_MARKETS, DEFAULT_MARKETS, type MarketRegistry, appMarkets } from '../../utils/marketRegistry';
import { capsOf, chartMarkets, ensureUniverse, marketOf, marketsState, publishMarkets, resetMarketsForTest, universeMarkets, universeReadTime } from '../markets';

const entry = (coin: string, rank: number, extra: Partial<MarketRegistry['markets'][number]> = {}) => ({
  coin,
  dex: coin.includes(':') ? coin.split(':')[0] : '',
  oiUsd7d: 1e9 / rank,
  rank,
  szDecimals: 2,
  maxLeverage: 10,
  since: '2026-11-10',
  scanner: coin === 'BTC' ? ('full' as const) : ('none' as const),
  ...extra,
});
const REG: MarketRegistry = {
  asOf: 1,
  rule: 'reg-v1',
  markets: [entry('BTC', 1), entry('ETH', 2), entry('HYPE', 3), entry('xyz:NVDA', 4, { szDecimals: 3 }), entry('SOL', 5), entry('kPEPE', 6, { szDecimals: 0 })],
};

afterEach(() => resetMarketsForTest());

describe('lista rynków strony', () => {
  it('przed odpowiedzią rejestru: 4 rynki domyślne, lista nierozstrzygnięta', () => {
    expect(chartMarkets()).toBe(DEFAULT_MARKETS);
    expect(marketsState().ready).toBe(false);
    expect(capsOf('BTC').scanner).toBe(true);
  });

  it('rejestr z pliku: rynki według miejsca, parametry rynku i zdolności z pola scanner', () => {
    publishMarkets(REG);
    expect(marketsState().ready).toBe(true);
    // Rejestr według miejsca; rynki aplikacji spoza rejestru (złoto, S&P 500) dopisane na końcu, żeby ich wykres działał
    expect(chartMarkets().map((m) => m.coin)).toEqual(['BTC', 'ETH', 'HYPE', 'xyz:NVDA', 'SOL', 'kPEPE', 'xyz:GOLD', 'xyz:SP500']);
    expect(marketOf('xyz:NVDA')).toMatchObject({ dex: 'xyz', szDecimals: 3 });
    expect(capsOf('xyz:NVDA').scanner).toBe(false);
  });

  it('brak pliku albo zły format: 4 rynki domyślne i rynki aplikacji, lista rozstrzygnięta', () => {
    publishMarkets(null);
    expect(marketsState().ready).toBe(true);
    expect(marketsState().markets.map((m) => m.coin)).toEqual([...DEFAULT_MARKETS.map((m) => m.coin), 'xyz:GOLD', 'xyz:SP500']);
    const a = marketsState().markets;
    publishMarkets({ asOf: 1, rule: 'inna', markets: [] });
    expect(marketsState().markets).toBe(a);
  });

  it('rynki do wyboru w aplikacji: z konfiguracji, parametry z rejestru, gdy w nim są', () => {
    publishMarkets({ ...REG, markets: [...REG.markets, entry('xyz:GOLD', 7, { szDecimals: 4, maxLeverage: 20 })] });
    expect(appMarkets(chartMarkets()).map((m) => [m.coin, m.maxLeverage, m.class])).toEqual([
      ['BTC', 10, 'crypto'],
      ['xyz:GOLD', 20, 'commodity'],
      ['xyz:SP500', 50, 'index'],
    ]);
    expect(appMarkets([])).toEqual(APP_MARKETS);
  });

  it('ta sama lista drugi raz nie zmienia stanu (bez zbędnych odświeżeń widoków)', () => {
    publishMarkets(REG);
    const a = marketsState();
    publishMarkets(structuredClone(REG));
    expect(marketsState()).toBe(a);
  });
});

describe('uniwersum wszystkich rynków Hyperliquid (leniwie)', () => {
  afterEach(() => resetMarketsForTest());
  const meta = (names: string[], px = '10') => [{ universe: names.map((name) => ({ name, szDecimals: 2, maxLeverage: 5 })) }, names.map(() => ({ markPx: px, openInterest: '100', dayNtlVlm: '1000', funding: '0.00001' }))];
  const deps = (byDex: Record<string, unknown>, now = 0) => ({
    perpDexs: async () => [null, ...Object.keys(byDex).filter((d) => d !== '').map((name) => ({ name }))],
    metaCtxs: async (dex: string) => (dex in byDex ? byDex[dex] : null),
    now: () => now,
  });

  it('rynki spoza rejestru za listą rejestru, z poziomem none (warstwy skanera z powodem „—”)', async () => {
    publishMarkets(null);
    expect(marketsState().universe).toBe('idle');
    await ensureUniverse(deps({ '': meta(['BTC', 'DOGE']), xyz: meta(['xyz:TSLA'], '400') }));
    expect(marketsState().universe).toBe('ready');
    expect(marketOf('xyz:TSLA')).toMatchObject({ dex: 'xyz', scanner: 'none' });
    expect(chartMarkets().filter((m) => m.coin === 'BTC')).toHaveLength(1);
    expect(marketOf('BTC')?.scanner).toBe('full');
    expect(capsOf('DOGE').scanner).toBe(false);
    expect(universeMarkets().map((m) => m.coin).sort()).toEqual(['BTC', 'DOGE', 'xyz:TSLA']);
    // Rejestr, który przyjdzie później, nie gubi uniwersum
    publishMarkets(null);
    expect(marketOf('xyz:TSLA')).toBeDefined();
  });

  it('giełda bez odpowiedzi nie zatrzymuje pozostałych; żadnej odpowiedzi — error i ponowienie najwcześniej po minucie', async () => {
    await ensureUniverse(deps({ '': meta(['DOGE']), xyz: null }));
    expect(marketsState().universe).toBe('ready');
    resetMarketsForTest();
    await ensureUniverse(deps({ '': null }, 0));
    expect(marketsState().universe).toBe('error');
    await ensureUniverse(deps({ '': meta(['DOGE']) }, 59_999));
    expect(marketsState().universe).toBe('error');
    await ensureUniverse(deps({ '': meta(['DOGE']) }, 60_000));
    expect(marketsState().universe).toBe('ready');
  });

  it('odświeżenie: najwcześniej po minucie, tylko giełdy z rynkami; niepełny odczyt zostawia poprzedni z jego godziną', async () => {
    const asked: string[] = [];
    const d = (now: number, byDex: Record<string, unknown>) => ({
      perpDexs: async () => [null, { name: 'xyz' }, { name: 'empty' }],
      metaCtxs: async (dex: string) => (asked.push(dex), dex in byDex ? byDex[dex] : null),
      now: () => now,
    });
    await ensureUniverse(d(0, { '': meta(['DOGE']), xyz: meta(['xyz:TSLA'], '400'), empty: meta([]) }));
    expect(universeReadTime()).toBe(0);
    asked.length = 0;
    await ensureUniverse(d(59_999, { '': meta(['DOGE']) }), true);
    expect(asked).toEqual([]);
    await ensureUniverse(d(60_000, { '': meta(['DOGE'], '20') }), true); // xyz bez odpowiedzi
    expect(asked.sort()).toEqual(['', 'xyz']);
    expect(universeReadTime()).toBe(0);
    expect(universeMarkets().find((m) => m.coin === 'DOGE')?.markPx).toBe(10);
    await ensureUniverse(d(61_000, { '': meta(['DOGE'], '20'), xyz: meta(['xyz:TSLA'], '400') }), true);
    expect(universeReadTime()).toBe(61_000);
    expect(universeMarkets().find((m) => m.coin === 'DOGE')?.markPx).toBe(20);
  });
});
