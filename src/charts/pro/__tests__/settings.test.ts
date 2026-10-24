import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, hashFor, parseSettings, settingsFromHash } from '../chart/settings';

describe('parseSettings', () => {
  it('brak lub śmieci → wartości domyślne', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('x')).toEqual(DEFAULT_SETTINGS);
  });

  it('zachowuje poprawne pola i odrzuca błędne pojedynczo', () => {
    const s = parseSettings({ interval: '1h', view: 'candles', fpStyle: 'zły', rowStep: -5, imbalanceRatio: 4, showCvd: false, cvdReset: 'week' });
    expect(s.interval).toBe('1h');
    expect(s.view).toBe('candles');
    expect(s.fpStyle).toBe(DEFAULT_SETTINGS.fpStyle);
    expect(s.rowStep).toBe(DEFAULT_SETTINGS.rowStep);
    expect(s.imbalanceRatio).toBe(4);
    expect(s.showCvd).toBe(false);
    expect(s.cvdReset).toBe('week');
  });

  it('próg dużego zlecenia i filtr taśmy: liczby w zakresie, reszta domyślna', () => {
    const s = parseSettings({ bigTradeUsd: 250_000, tapeMinUsd: -1, tapeSound: 'tak', showTape: true });
    expect(s.bigTradeUsd).toBe(250_000);
    expect(s.tapeMinUsd).toBe(DEFAULT_SETTINGS.tapeMinUsd);
    expect(s.tapeSound).toBe(false);
    expect(s.showTape).toBe(true);
    expect(parseSettings({ bigTradeUsd: 1e12 }).bigTradeUsd).toBe(0);
  });

  it('nieznany interwał → domyślny', () => {
    expect(parseSettings({ interval: '2m' }).interval).toBe(DEFAULT_SETTINGS.interval);
  });

  it('rynek tylko z listy, domyślnie BTC', () => {
    expect(parseSettings({ coin: 'ETH' }).coin).toBe('ETH');
    expect(parseSettings({ coin: 'DOGE' }).coin).toBe('BTC');
  });
});

describe('link do widoku', () => {
  it('rynek, interwał i rodzaj wykresu w obie strony; nieznane wartości pomijane', () => {
    const s = { ...DEFAULT_SETTINGS, coin: 'SOL' as const, interval: '5m', view: 'candles' as const };
    expect(hashFor(s)).toBe('#charts?m=SOL&i=5m&v=candles');
    expect(settingsFromHash(hashFor(s))).toEqual({ coin: 'SOL', interval: '5m', view: 'candles' });
    expect(settingsFromHash('#charts?m=DOGE&i=7m&v=x')).toEqual({});
    expect(settingsFromHash('#charts')).toEqual({});
  });
});
