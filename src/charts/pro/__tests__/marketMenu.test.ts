import { describe, expect, it } from 'vitest';
import { DEFAULT_MARKETS, type ChartMarket } from '../../../utils/marketRegistry';
import { expiredNotice, isListed, marketGroups, marketTitle, nextMarket } from '../chart/marketMenu';

const m = (coin: string, scanner: 'full' | 'none' = 'none'): ChartMarket => ({
  coin,
  dex: coin.includes(':') ? coin.split(':')[0] : '',
  szDecimals: 2,
  maxLeverage: 10,
  scanner,
});
/** Kolejność rejestru: według otwartych pozycji (pomiar 11.11.2026) */
const LIST = [m('BTC', 'full'), m('ETH'), m('HYPE'), m('xyz:SP500'), m('xyz:NVDA'), m('ZEC'), m('SOL'), m('io:ANTH'), m('kPEPE')];

describe('wybór rynku', () => {
  it('dwie grupy: krypto i giełdy HIP-3 (rynki tradycyjne), w każdej kolejność rejestru', () => {
    const g = marketGroups(LIST, '');
    expect(g.map((x) => x.id)).toEqual(['crypto', 'hip3']);
    expect(g[0].title).toBe('Krypto');
    expect(g[1].title).toBe('Rynki tradycyjne (HIP-3)');
    expect(g[0].markets.map((x) => x.coin)).toEqual(['BTC', 'ETH', 'HYPE', 'ZEC', 'SOL', 'kPEPE']);
    expect(g[1].markets.map((x) => x.coin)).toEqual(['xyz:SP500', 'xyz:NVDA', 'io:ANTH']);
  });

  it('waluty HIP-3 (xyz:JPY, xyz:EUR) w grupie rynków tradycyjnych: tytuł nie wymienia samych akcji, indeksów i surowców', () => {
    const g = marketGroups([...LIST, m('xyz:JPY'), m('xyz:EUR')], 'xyz:');
    expect(g.map((x) => x.id)).toEqual(['hip3']);
    expect(g[0].markets.map((x) => x.coin)).toEqual(['xyz:SP500', 'xyz:NVDA', 'xyz:JPY', 'xyz:EUR']);
    expect(g[0].title).not.toMatch(/surowce$/);
    expect(g[0].title).toContain('HIP-3');
  });

  it('wyszukiwanie bez wielkości liter, po nazwie i po giełdzie; pusta grupa znika', () => {
    expect(marketGroups(LIST, 'nvda').flatMap((x) => x.markets.map((y) => y.coin))).toEqual(['xyz:NVDA']);
    expect(marketGroups(LIST, ' XYZ ').map((x) => x.id)).toEqual(['hip3']);
    expect(marketGroups(LIST, 'pepe')[0].markets.map((x) => x.coin)).toEqual(['kPEPE']);
    expect(marketGroups(LIST, 'zzz')).toEqual([]);
  });

  it('4 rynki domyślne bez rejestru: sama grupa krypto', () => {
    expect(marketGroups(DEFAULT_MARKETS, '').map((x) => [x.id, x.markets.length])).toEqual([['crypto', 4]]);
  });

  it('klawisz M: następny rynek listy, po ostatnim pierwszy; rynek spoza listy → pierwszy', () => {
    expect(nextMarket(LIST, 'BTC')).toBe('ETH');
    expect(nextMarket(LIST, 'kPEPE')).toBe('BTC');
    expect(nextMarket(LIST, 'DOGE')).toBe('BTC');
  });

  it('podpis rynku: perp Hyperliquid, HIP-3 z nazwą giełdy', () => {
    expect(marketTitle(m('BTC'))).toBe('BTC-PERP · Hyperliquid');
    expect(marketTitle(m('xyz:NVDA'))).toBe('NVDA-PERP · Hyperliquid HIP-3, giełda xyz');
  });

  it('rynek wygasły: spoza listy, jedno zdanie z nazwą rynku i BTC', () => {
    expect(isListed('xyz:NVDA', LIST)).toBe(true);
    expect(isListed('xyz:OLD', LIST)).toBe(false);
    const t = expiredNotice('xyz:OLD');
    expect(t).toContain('xyz:OLD');
    expect(t).toContain('BTC');
    expect(t.split(/[.!?](\s|$)/).filter((s) => s.trim().length > 0)).toHaveLength(1);
  });
});
