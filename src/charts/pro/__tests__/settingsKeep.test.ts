import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, migrateSaved, parseSettings, settingsJson } from '../chart/settings';

/**
 * Ustawienia użytkownika zapisane przed odchudzeniem paska (klucze hq.charts.*) czyta się bez zmian: każde zapisane pole
 * ma po odczycie i ponownym zapisie tę samą wartość, a nowe pola (zwinięty Stan rynku, gęstość etykiet) są tylko
 * dopisywane — i to dopiero wtedy, gdy użytkownik je ustawi.
 */
const SAVED = {
  coin: 'ETH',
  interval: '15m',
  view: 'candles',
  fpStyle: 'delta',
  rowStep: 5,
  imbalanceRatio: 2.5,
  imbalanceMinUsd: 10_000,
  stackedMin: 4,
  showVolume: false,
  showDelta: true,
  showCvd: false,
  cvdReset: 'day',
  showVenueCvd: true,
  showVenueOi: false,
  showStats: true,
  statGroups: ['hl', 'tape', 'who'],
  showState: false,
  showVwap: true,
  showVwapBands: true,
  showSessionVwap: true,
  showProfile: false,
  showPeriodProfiles: true,
  showDevPoc: true,
  showTpo: false,
  showTpoOi: false,
  showLevels: true,
  showBlogMap: false,
  showSessions: false,
  showIb: true,
  showLiq: true,
  showWhales: true,
  showZones: true,
  showAuctions: true,
  showHeatmap: true,
  showBubbles: true,
  showClashes: true,
  showLots: true,
  bigTradeUsd: 250_000,
  showTape: true,
  tapeMinUsd: 50_000,
  tapeSound: true,
  indicators: [],
  layersV: 2,
};

/** Każde pole `a` jest w `b` z tą samą wartością (b może mieć pola dodatkowe). */
function superset(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') return Object.keys(a).every((k) => superset((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  return false;
}

describe('zapis ustawień wykresu po zmianie paska', () => {
  it('odczyt i ponowny zapis zostawiają każde zapisane pole bez zmian', () => {
    const read = parseSettings(migrateSaved(structuredClone(SAVED)), DEFAULT_SETTINGS);
    const again = JSON.parse(settingsJson(read));
    expect(superset(SAVED, again)).toBe(true);
  });

  it('nowe pola nie pojawiają się w zapisie, dopóki użytkownik ich nie ustawi', () => {
    const again = JSON.parse(settingsJson(parseSettings(migrateSaved(structuredClone(SAVED)), DEFAULT_SETTINGS)));
    expect(Object.keys(again).filter((k) => !(k in SAVED))).toEqual([]);
  });

  it('ustawiony przez użytkownika Stan rynku rozwinięty jest czytany z zapisu; błędna wartość — pole pominięte', () => {
    expect(parseSettings({ ...SAVED, stateOpen: true }).stateOpen).toBe(true);
    expect(parseSettings({ ...SAVED, stateOpen: false }).stateOpen).toBe(false);
    expect('stateOpen' in parseSettings({ ...SAVED, stateOpen: 'tak' })).toBe(false);
  });
});
