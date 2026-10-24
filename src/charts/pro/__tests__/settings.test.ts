import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, NARROW_PATCH, hashFor, migrateSaved, parseSettings, phoneSettings, settingsFromHash } from '../chart/settings';

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

describe('grupy Tablicy liczb', () => {
  it('stała kolejność bez powtórzeń; pusta albo błędna lista → domyślna', () => {
    expect(parseSettings({ statGroups: ['bybit', 'hl', 'bybit', 'x'] }).statGroups).toEqual(['hl', 'bybit']);
    expect(parseSettings({ statGroups: [] }).statGroups).toEqual(DEFAULT_SETTINGS.statGroups);
    expect(parseSettings({ statGroups: 'hl' }).statGroups).toEqual(['hl', 'tape']);
    // Zapis sprzed grup: dawne wiersze tabeli (Hyperliquid i taśma)
    expect(parseSettings({ showStats: true }).statGroups).toEqual(['hl', 'tape']);
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

describe('warstwy startowe', () => {
  it('na starcie bez warstw z podpisami, które zasłaniają świece', () => {
    for (const k of ['showHeatmap', 'showBubbles', 'showWhales', 'showLots', 'showClashes', 'showZones', 'showAuctions', 'showIb', 'showPeriodProfiles', 'showStats'] as const)
      expect(DEFAULT_SETTINGS[k]).toBe(false);
    const phone = { ...DEFAULT_SETTINGS, ...NARROW_PATCH };
    expect(phone.showBubbles || phone.showHeatmap || phone.showDelta).toBe(false);
    expect(phone.showVwap && phone.showVolume && phone.showCvd).toBe(true);
  });

  it('telefon: najwyżej jeden panel pod wykresem (pierwszy włączony), bez tablicy; zapis bez zmian', () => {
    const saved = { ...DEFAULT_SETTINGS, interval: '1m', showVolume: true, showDelta: true, showCvd: true, showVenueOi: true, showStats: true, showHeatmap: true };
    const p = phoneSettings(saved);
    expect([p.showCvd, p.showDelta, p.showVenueCvd, p.showVenueOi, p.showStats]).toEqual([true, false, false, false, false]);
    expect([p.showVolume, p.showHeatmap, p.interval]).toEqual([true, true, '1m']);
    expect(saved.showDelta && saved.showStats).toBe(true);
    const delta = phoneSettings({ ...saved, showCvd: false });
    expect([delta.showCvd, delta.showDelta, delta.showVenueOi]).toEqual([false, true, false]);
    const none = phoneSettings({ ...saved, showCvd: false, showDelta: false, showVenueOi: false });
    expect([none.showCvd, none.showDelta, none.showVenueCvd, none.showVenueOi]).toEqual([false, false, false, false]);
  });

  it('zapis sprzed zmiany: warstwy o nowej wartości startowej wracają do niej, reszta zostaje', () => {
    const old = { interval: '1m', showWhales: true, showLots: true, showStats: true, showVwap: false, showTpo: true };
    const s = parseSettings(migrateSaved(old));
    expect(s.interval).toBe('1m');
    expect(s.showWhales).toBe(false);
    expect(s.showLots).toBe(false);
    expect(s.showStats).toBe(false);
    // Wartość startowa VWAP i TPO się nie zmieniła, więc zostaje wybór z zapisu
    expect(s.showVwap).toBe(false);
    expect(s.showTpo).toBe(true);
    // Zapis w nowej wersji nie jest zmieniany
    const fresh = { ...old, layersV: 2 };
    expect(parseSettings(migrateSaved(fresh)).showWhales).toBe(true);
    expect(migrateSaved(null)).toBeNull();
  });
});
