import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, NARROW_PATCH, parseSettings } from '../chart/settings';
import { STATIONS, clearStation, loadStation, loadStationLayout, saveStationLayout, stationById, stationKey, stationKeys, stationPanel } from '../chart/stations';

/** Pamięć przeglądarki w testach (środowisko node). */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe('stacje robocze', () => {
  it('Start: wzorzec = ustawienia startowe (na telefonie z NARROW_PATCH) i klucze zapisu sprzed stacji', () => {
    const start = stationById('start');
    expect(stationPanel(start, 0, false)).toEqual(DEFAULT_SETTINGS);
    expect(stationPanel(start, 0, true)).toEqual({ ...DEFAULT_SETTINGS, ...NARROW_PATCH });
    expect(stationKey('start', 0)).toBe('hq.charts.v1');
    expect(stationKey('start', 3)).toBe('hq.charts.v1.p3');
    expect(stationKey('scalp', 0)).toBe('hq.charts.v1.scalp');
    expect(stationKey('auction', 1)).toBe('hq.charts.v1.auction.p1');
  });

  it('każdy wzorzec przechodzi walidację ustawień bez zmian, na komputerze i na telefonie', () => {
    for (const st of STATIONS)
      for (const narrow of [false, true])
        for (let p = 0; p < 4; p++) {
          const s = stationPanel(st, p, narrow);
          expect(parseSettings(s)).toEqual(s);
        }
    expect(new Set(STATIONS.map((s) => s.id)).size).toBe(STATIONS.length);
  });

  it('wzorce odpowiadają pytaniom stacji', () => {
    const scalp = stationPanel(stationById('scalp'), 0, false);
    expect([scalp.interval, scalp.view, scalp.showHeatmap, scalp.showTape, scalp.showBubbles]).toEqual(['1m', 'footprint', true, true, true]);
    const venues = stationPanel(stationById('venues'), 0, false);
    expect([venues.showVenueCvd, venues.showStats, venues.statGroups]).toEqual([true, true, ['hl', 'binance', 'bybit']]);
    // Telefon: liczby w karcie „Liczby”, nie w panelu pod wykresem
    expect(stationPanel(stationById('venues'), 0, true).showStats).toBe(false);
    const auction = stationById('auction');
    expect(auction.layout).toBe(2);
    expect([stationPanel(auction, 0, false).showTpo, stationPanel(auction, 1, false).interval]).toEqual([true, '4h']);
    // Płynność na telefonie bez ścian i dużych zleceń w arkuszu
    expect(stationPanel(stationById('liquidity'), 0, true).showClashes).toBe(false);
  });

  it('panel spoza wzorca: wygląd pierwszego, wyższy interwał, bez tablicy i taśmy', () => {
    const s = stationPanel(stationById('scalp'), 2, false);
    expect(s.interval).toBe('1h');
    expect(s.showHeatmap).toBe(true);
    expect([s.showStats, s.showTape]).toEqual([false, false]);
  });

  it('nieznana stacja → Start', () => {
    expect(stationById('x').id).toBe('start');
    expect(stationById(null).id).toBe('start');
  });
});

describe('zapis stacji', () => {
  const real = globalThis.localStorage;
  beforeEach(() => {
    globalThis.localStorage = memoryStorage();
  });
  afterEach(() => {
    globalThis.localStorage = real;
  });

  it('aktywna stacja sprzed kart i układ: wzorzec bez zapisu, potem wersja użytkownika; przywrócenie usuwa tylko tę stację', () => {
    expect(loadStation().id).toBe('start');
    localStorage.setItem('hq.charts.station.v1', 'auction');
    expect(loadStation().id).toBe('auction');
    const auction = stationById('auction');
    expect(loadStationLayout(auction)).toBe(2);
    saveStationLayout('auction', 4);
    expect(loadStationLayout(auction)).toBe(4);
    localStorage.setItem(stationKey('auction', 1), '{}');
    localStorage.setItem(stationKey('start', 0), '{}');
    clearStation('auction');
    expect(loadStationLayout(auction)).toBe(2);
    expect(localStorage.getItem(stationKey('auction', 1))).toBeNull();
    expect(localStorage.getItem(stationKey('start', 0))).toBe('{}');
  });

  it('Start czyta układ zapisany przed stacjami', () => {
    localStorage.setItem('hq.charts.layout.v1', '4');
    expect(loadStationLayout(stationById('start'))).toBe(4);
  });

  it('karta układu: klucze zapisu pod jej id, układ z wzorca stacji do pierwszego zapisu', () => {
    expect(stationKeys('k1')).toEqual(['hq.charts.v1.k1', 'hq.charts.v1.k1.p1', 'hq.charts.v1.k1.p2', 'hq.charts.v1.k1.p3', 'hq.charts.layout.v1.k1']);
    const auction = stationById('auction');
    expect(loadStationLayout(auction, 'k1')).toBe(2);
    saveStationLayout('k1', 1);
    expect([loadStationLayout(auction, 'k1'), loadStationLayout(auction)]).toEqual([1, 2]);
  });
});
