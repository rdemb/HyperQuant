import { describe, expect, it } from 'vitest';
import { allMarketRows } from '../allMarkets';
import type { UniverseMarket } from '../hlUniverse';

const m = (coin: string, oiUsd: number, volume24hUsd: number, funding: number | null, markPx = 10): UniverseMarket => ({
  coin,
  dex: coin.includes(':') ? coin.split(':')[0] : '',
  szDecimals: 2,
  maxLeverage: 20,
  markPx,
  oiUsd,
  volume24hUsd,
  funding,
});
const LIST = [m('BTC', 2e9, 3e9, 0.0000125, 60_000), m('xyz:TSLA', 5e7, 9e7, -0.00005, 400), m('DOGE', 8e7, 1e7, 0.0001, 0.2), m('io:ANTH', 1e6, 5e5, null)];

describe('przegląd wszystkich rynków Hyperliquid', () => {
  it('sortowanie: otwarte pozycje, wolumen 24 h, skrajne finansowanie (wartość bezwzględna) na górze', () => {
    expect(allMarketRows(LIST, 'oi', '').map((r) => r.coin)).toEqual(['BTC', 'DOGE', 'xyz:TSLA', 'io:ANTH']);
    expect(allMarketRows(LIST, 'volume', '').map((r) => r.coin)).toEqual(['BTC', 'xyz:TSLA', 'DOGE', 'io:ANTH']);
    expect(allMarketRows(LIST, 'funding', '').map((r) => r.coin)).toEqual(['DOGE', 'xyz:TSLA', 'BTC', 'io:ANTH']);
  });

  it('teksty: nazwa bez giełdy, giełda, OI i wolumen w USD, finansowanie roczne ze znakiem, brak stawki — „—”', () => {
    const [btc] = allMarketRows(LIST, 'oi', 'btc');
    expect(btc).toMatchObject({ name: 'BTC', venue: 'Hyperliquid', oi: expect.stringContaining('$'), funding: '+11.0%', fundingSign: 1, leverage: '20×' });
    const [tsla] = allMarketRows(LIST, 'oi', 'tsla');
    expect(tsla).toMatchObject({ name: 'TSLA', venue: 'xyz', funding: '−43.8%', fundingSign: -1 });
    expect(allMarketRows(LIST, 'oi', 'anth')[0]).toMatchObject({ funding: '—', fundingSign: 0 });
  });

  it('wyszukiwanie po nazwie i giełdzie, każde słowo zapytania', () => {
    expect(allMarketRows(LIST, 'oi', 'xyz').map((r) => r.coin)).toEqual(['xyz:TSLA']);
    expect(allMarketRows(LIST, 'oi', 'hyperliquid doge').map((r) => r.coin)).toEqual(['DOGE']);
    expect(allMarketRows(LIST, 'oi', 'zzz')).toEqual([]);
  });
});
