import { describe, expect, it } from 'vitest';
import { DEFAULT_MARKETS, type ChartMarket } from '../marketRegistry';
import { marketCaps, noScannerWhy, NO_SCANNER_NOTE } from '../marketCaps';

const nvda: ChartMarket = { coin: 'xyz:NVDA', dex: 'xyz', szDecimals: 3, maxLeverage: 20, scanner: 'none' };
const ethFull: ChartMarket = { coin: 'ETH', dex: '', szDecimals: 4, maxLeverage: 25, scanner: 'full' };

describe('marketCaps — zdolności rynku', () => {
  it('BTC z 4 rynków domyślnych: skaner, prognozy, mapy z bloga i rynki HIP-4', () => {
    expect(marketCaps('BTC', DEFAULT_MARKETS)).toEqual({ scanner: true, forecasts: true, blog: true, outcomes: true });
  });

  it('rynek bez skanera (ETH, HYPE, xyz:NVDA): tylko wykres ze strumienia', () => {
    for (const coin of ['ETH', 'HYPE']) expect(marketCaps(coin, DEFAULT_MARKETS)).toEqual({ scanner: false, forecasts: false, blog: false, outcomes: false });
    expect(marketCaps('xyz:NVDA', [...DEFAULT_MARKETS, nvda]).scanner).toBe(false);
  });

  it('skaner i prognozy z pola `scanner` rejestru, nie z nazwy rynku', () => {
    const list = [ethFull, { ...DEFAULT_MARKETS[0], scanner: 'none' as const }];
    expect(marketCaps('ETH', list)).toMatchObject({ scanner: true, forecasts: true, blog: false, outcomes: false });
    expect(marketCaps('BTC', list)).toMatchObject({ scanner: false, forecasts: false, blog: true, outcomes: true });
  });

  it('rynek spoza listy nie ma żadnej warstwy skanera', () => {
    expect(marketCaps('kPEPE', DEFAULT_MARKETS)).toEqual({ scanner: false, forecasts: false, blog: false, outcomes: false });
  });

  it('powód „—” przy rynku bez skanera wymienia rynki z pełnym skanerem', () => {
    expect(NO_SCANNER_NOTE).toBe('bez skanera');
    const why = noScannerWhy('xyz:NVDA', [...DEFAULT_MARKETS, nvda, ethFull]);
    expect(why).toContain('xyz:NVDA');
    expect(why).toContain('BTC, ETH');
  });
});
