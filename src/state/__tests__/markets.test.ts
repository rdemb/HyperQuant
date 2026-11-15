import { afterEach, describe, expect, it } from 'vitest';
import { APP_MARKETS, DEFAULT_MARKETS, type MarketRegistry, appMarkets } from '../../utils/marketRegistry';
import { capsOf, chartMarkets, marketOf, marketsState, publishMarkets, resetMarketsForTest } from '../markets';

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
