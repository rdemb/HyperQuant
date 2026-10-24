import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from '../chart/settings';

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

  it('nieznany interwał → domyślny', () => {
    expect(parseSettings({ interval: '2m' }).interval).toBe(DEFAULT_SETTINGS.interval);
  });
});
