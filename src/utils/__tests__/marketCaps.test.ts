import { describe, expect, it } from 'vitest';
import { DEFAULT_MARKETS, type ChartMarket } from '../marketRegistry';
import { NO_CEX_NOTE, marketCaps, maxLeverageOf, noCexWhy, noScannerWhy, NO_SCANNER_NOTE, usdScale } from '../marketCaps';

const nvda: ChartMarket = { coin: 'xyz:NVDA', dex: 'xyz', szDecimals: 3, maxLeverage: 20, scanner: 'none' };
const ethFull: ChartMarket = { coin: 'ETH', dex: '', szDecimals: 4, maxLeverage: 25, scanner: 'full' };

describe('marketCaps — zdolności rynku', () => {
  it('BTC z 4 rynków domyślnych: skaner, prognozy, mapy z bloga i rynki HIP-4', () => {
    expect(marketCaps('BTC', DEFAULT_MARKETS)).toEqual({ scanner: true, forecasts: true, blog: true, outcomes: true, cex: true });
  });

  it('rynek bez skanera (ETH, HYPE, xyz:NVDA): tylko wykres ze strumienia', () => {
    for (const coin of ['ETH', 'HYPE']) expect(marketCaps(coin, DEFAULT_MARKETS)).toEqual({ scanner: false, forecasts: false, blog: false, outcomes: false, cex: true });
    expect(marketCaps('xyz:NVDA', [...DEFAULT_MARKETS, nvda]).scanner).toBe(false);
  });

  it('skaner i prognozy z pola `scanner` rejestru, nie z nazwy rynku', () => {
    const list = [ethFull, { ...DEFAULT_MARKETS[0], scanner: 'none' as const }];
    expect(marketCaps('ETH', list)).toMatchObject({ scanner: true, forecasts: true, blog: false, outcomes: false });
    expect(marketCaps('BTC', list)).toMatchObject({ scanner: false, forecasts: false, blog: true, outcomes: true });
  });

  it('rynek spoza listy nie ma żadnej warstwy skanera', () => {
    expect(marketCaps('kPEPE', DEFAULT_MARKETS)).toEqual({ scanner: false, forecasts: false, blog: false, outcomes: false, cex: false });
  });

  it('powód „—” przy rynku bez skanera wymienia rynki z pełnym skanerem', () => {
    expect(NO_SCANNER_NOTE).toBe('bez skanera');
    const why = noScannerWhy('xyz:NVDA', [...DEFAULT_MARKETS, nvda, ethFull]);
    expect(why).toContain('xyz:NVDA');
    expect(why).toContain('BTC, ETH');
  });
});

/** Rejestr z OI 7 dni (BTC 3 mld USD). */
const REG: ChartMarket[] = [
  { ...DEFAULT_MARKETS[0], oiUsd7d: 3e9 },
  { ...DEFAULT_MARKETS[1], oiUsd7d: 1.4e9 },
  { ...nvda, oiUsd7d: 5e8 },
  { coin: 'kPEPE', dex: '', szDecimals: 0, maxLeverage: 10, scanner: 'none', oiUsd7d: 7e7 },
  { coin: 'xyz:JPY', dex: 'xyz', szDecimals: 0, maxLeverage: 10, scanner: 'none', oiUsd7d: 1e6 },
  { coin: 'ZEC', dex: '', szDecimals: 2, maxLeverage: 10, scanner: 'none' },
];

describe('usdScale — progi w USD zależne od rynku', () => {
  it('BTC: skala 1 (progi jak dotąd), z rejestrem i bez', () => {
    expect(usdScale('BTC', DEFAULT_MARKETS)).toBe(1);
    expect(usdScale('BTC', REG)).toBe(1);
  });

  it('ETH, SOL i HYPE: skala z tabeli (progi dobrane ręcznie), nie z OI', () => {
    expect(usdScale('ETH', REG)).toBe(0.5);
    expect(usdScale('SOL', DEFAULT_MARKETS)).toBe(0.25);
    expect(usdScale('HYPE', DEFAULT_MARKETS)).toBe(0.25);
  });

  it('inny rynek: OI 7 dni wobec BTC zaokrąglone w dół do 1, 2 albo 5 × 10^k, najmniej 0,01', () => {
    expect(usdScale('xyz:NVDA', REG)).toBe(0.1); // 5e8 / 3e9 = 0,167
    expect(usdScale('kPEPE', REG)).toBe(0.02); // 7e7 / 3e9 = 0,023
    expect(usdScale('xyz:JPY', REG)).toBe(0.01); // 0,0003 → najmniej 0,01
  });

  it('bez OI w rejestrze albo rynek spoza listy: najmniejsza skala', () => {
    expect(usdScale('ZEC', REG)).toBe(0.01);
    expect(usdScale('xyz:NVDA', [...DEFAULT_MARKETS, nvda])).toBe(0.01);
    expect(usdScale('DOGE', REG)).toBe(0.01);
  });
});

describe('maxLeverageOf — dźwignia z rejestru', () => {
  it('BTC 40 jak dotąd; inny rynek z pola maxLeverage rejestru', () => {
    expect(maxLeverageOf('BTC', DEFAULT_MARKETS)).toBe(40);
    expect(maxLeverageOf('ETH', DEFAULT_MARKETS)).toBe(25);
    expect(maxLeverageOf('xyz:NVDA', REG)).toBe(20);
  });
  it('rynek spoza listy: dźwignia BTC (link spoza rejestru otwiera BTC)', () => {
    expect(maxLeverageOf('DOGE', DEFAULT_MARKETS)).toBe(40);
  });
});

describe('panele giełd (Binance i Bybit)', () => {
  it('rynek HIP-3 (dwukropek) i rynek z przedrostkiem k (kPEPE) nie mają odpowiednika USDT', () => {
    expect(marketCaps('xyz:NVDA', REG).cex).toBe(false);
    expect(marketCaps('xyz:JPY', REG).cex).toBe(false);
    expect(marketCaps('kPEPE', REG).cex).toBe(false);
    expect(marketCaps('kBONK', REG).cex).toBe(false);
  });
  it('BTC, ETH, ZEC i rynek zaczynający się od K bez wielkiej litery po nim mają panel', () => {
    for (const c of ['BTC', 'ETH', 'ZEC', 'KAITO']) expect(marketCaps(c, REG).cex).toBe(true);
  });
  it('powód „—” po polsku z nazwą rynku', () => {
    expect(NO_CEX_NOTE).toBe('brak na Binance i Bybit');
    expect(noCexWhy('xyz:NVDA')).toContain('xyz:NVDA');
    expect(noCexWhy('kPEPE')).toMatch(/Binance i Bybit/);
  });
});
