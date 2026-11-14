import { describe, expect, it } from 'vitest';
import type { ChartMarket } from '../marketRegistry';
import { allMarkets, filterMarkets, parseDexUniverse, parsePerpDexs, type DexState } from '../marketsTable';
import { MarketsPoller } from '../../state/useMarketsTable';

const btc: ChartMarket = { coin: 'BTC', dex: '', szDecimals: 5, maxLeverage: 40, scanner: 'full', class: 'crypto' };
const nvda: ChartMarket = { coin: 'xyz:NVDA', dex: 'xyz', szDecimals: 3, maxLeverage: 10, scanner: 'none', class: 'equity' };

describe('wszystkie rynki: lista giełd i rynki giełdy', () => {
  it('perpDexs: giełda główna (null) i giełdy HIP-3 z nazwą; zła odpowiedź → null', () => {
    expect(parsePerpDexs([null, { name: 'xyz', fullName: 'XYZ' }, { name: 'flx' }, { name: 'xyz' }, { foo: 1 }, { name: 'zła nazwa!' }])).toEqual(['', 'xyz', 'flx']);
    expect(parsePerpDexs({})).toBeNull();
    expect(parsePerpDexs([])).toEqual(['']);
  });

  it('universe: przedrostek giełdy HIP-3, bez rynków wycofanych, złe wiersze pominięte', () => {
    const raw = [{ universe: [{ name: 'NVDA', szDecimals: 3, maxLeverage: 10 }, { name: 'xyz:TSLA', szDecimals: 2, maxLeverage: 10 }, { name: 'OLD', szDecimals: 1, maxLeverage: 3, isDelisted: true }, { szDecimals: 1 }] }, []];
    expect(parseDexUniverse(raw, 'xyz')).toEqual([
      { coin: 'xyz:NVDA', dex: 'xyz', szDecimals: 3, maxLeverage: 10, scanner: 'none' },
      { coin: 'xyz:TSLA', dex: 'xyz', szDecimals: 2, maxLeverage: 10, scanner: 'none' },
    ]);
    expect(parseDexUniverse([{ universe: [{ name: 'ETH', szDecimals: 4, maxLeverage: 25 }] }], '')[0].coin).toBe('ETH');
    expect(parseDexUniverse(null, '')).toBeNull();
  });

  it('tabela: najpierw rejestr, potem rynki z odczytów; giełda główna to krypto, HIP-3 spoza rejestru bez klasy', () => {
    const dexes: Record<string, DexState> = {
      '': { at: 1, ctxs: new Map(), failedAt: null, universe: [{ ...btc, class: undefined }, { coin: 'ETH', dex: '', szDecimals: 4, maxLeverage: 25, scanner: 'none' }] },
      xyz: { at: 1, ctxs: new Map(), failedAt: null, universe: [{ ...nvda, class: undefined }, { coin: 'xyz:GOLD', dex: 'xyz', szDecimals: 2, maxLeverage: 20, scanner: 'none' }] },
    };
    const all = allMarkets([btc, nvda], dexes);
    expect(all.map((m) => [m.coin, m.class])).toEqual([
      ['BTC', 'crypto'],
      ['xyz:NVDA', 'equity'],
      ['ETH', 'crypto'],
      ['xyz:GOLD', undefined],
    ]);
  });

  it('filtr: tekst (nazwa i giełda, bez wielkości liter), giełda, klasa i „bez klasy”', () => {
    const gold: ChartMarket = { coin: 'xyz:GOLD', dex: 'xyz', szDecimals: 2, maxLeverage: 20, scanner: 'none' };
    const list = [btc, nvda, gold];
    expect(filterMarkets(list, { q: 'nv', dex: null, cls: null }).map((m) => m.coin)).toEqual(['xyz:NVDA']);
    expect(filterMarkets(list, { q: 'XYZ', dex: null, cls: null }).map((m) => m.coin)).toEqual(['xyz:NVDA', 'xyz:GOLD']);
    expect(filterMarkets(list, { q: 'hyperliquid', dex: null, cls: null }).map((m) => m.coin)).toEqual(['BTC']);
    expect(filterMarkets(list, { q: '', dex: '', cls: null }).map((m) => m.coin)).toEqual(['BTC']);
    expect(filterMarkets(list, { q: '', dex: null, cls: 'equity' }).map((m) => m.coin)).toEqual(['xyz:NVDA']);
    expect(filterMarkets(list, { q: '', dex: null, cls: 'none' }).map((m) => m.coin)).toEqual(['xyz:GOLD']);
  });
});

describe('odświeżanie: lista giełd z perpDexs przed pierwszą rundą', () => {
  it('jedno zapytanie perpDexs, potem runda po giełdach rejestru i z listy; każde zapytanie w licznikach', async () => {
    const asked: string[] = [];
    let lists = 0;
    const p = new MarketsPoller({
      fetchDex: async (dex) => {
        asked.push(dex);
        return [{ universe: [{ name: dex === '' ? 'BTC' : 'NVDA', szDecimals: 2, maxLeverage: 10 }] }, [{ markPx: '1', dayNtlVlm: '1', openInterest: '1', funding: '0' }]];
      },
      fetchDexList: async () => {
        lists++;
        return [null, { name: 'xyz' }, { name: 'flx' }];
      },
      now: () => 1_000,
      visible: () => true,
      onVisibility: () => () => {},
    });
    const done = new Promise<void>((resolve) => {
      const off = p.subscribe(() => {
        off();
        resolve();
      });
    });
    p.run(['']);
    await done;
    p.stop();
    expect(lists).toBe(1);
    expect(asked.sort()).toEqual(['', 'flx', 'xyz']);
    expect(p.snapshot().requests).toBe(4);
    expect(p.meter.lastMinute(1_000)).toBe(80);
    expect(p.snapshot().dexes.xyz.universe?.map((m) => m.coin)).toEqual(['xyz:NVDA']);
  });
});
