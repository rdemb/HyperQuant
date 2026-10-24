import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseLayout, parseSettings, panelKey } from '../chart/settings';
import { BUILT_IN_TEMPLATES, MAX_TEMPLATES, applyTemplate, parseTemplates, saveAs, templateOf } from '../chart/templates';

describe('szablony wykresu', () => {
  it('szablon nie zmienia rynku ani wysokości wiersza', () => {
    const s = { ...DEFAULT_SETTINGS, coin: 'ETH' as const, rowStep: 0.5, interval: '5m' };
    const clean = BUILT_IN_TEMPLATES.find((t) => t.id === 'clean')!;
    const out = applyTemplate(s, clean.s);
    expect(out.coin).toBe('ETH');
    expect(out.rowStep).toBe(0.5);
    expect(out.view).toBe('candles');
    expect(out.showHeatmap).toBe(false);
    expect(out.showVolume).toBe(true);
  });

  it('wbudowane szablony przechodzą walidację ustawień bez zmian', () => {
    for (const t of BUILT_IN_TEMPLATES) {
      const s = { ...DEFAULT_SETTINGS, ...t.s };
      expect(parseSettings(s)).toEqual(s);
    }
  });

  it('zapis własnego: ta sama nazwa zastępuje poprzedni, pusta nazwa nic nie dodaje, limit liczby', () => {
    let list = saveAs([], '  Mój 1m  ', { ...DEFAULT_SETTINGS, interval: '1m' }, 1);
    list = saveAs(list, 'Mój 1m', { ...DEFAULT_SETTINGS, interval: '3m' }, 2);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Mój 1m');
    expect(list[0].s.interval).toBe('3m');
    expect(saveAs(list, '   ', DEFAULT_SETTINGS)).toHaveLength(1);
    for (let i = 0; i < MAX_TEMPLATES + 3; i++) list = saveAs(list, `t${i}`, DEFAULT_SETTINGS, i);
    expect(list).toHaveLength(MAX_TEMPLATES);
  });

  it('odczyt z zapisu: uszkodzone wpisy pomijane, pola ustawień walidowane', () => {
    const ok = { id: 'a', name: 'X', s: { ...templateOf(DEFAULT_SETTINGS), interval: 'zły', showTape: true } };
    const out = parseTemplates([ok, { id: 'b', name: '' }, null, 'x']);
    expect(out).toHaveLength(1);
    expect(out[0].builtIn).toBe(false);
    expect(out[0].s.interval).toBe(DEFAULT_SETTINGS.interval);
    expect(out[0].s.showTape).toBe(true);
    expect(parseTemplates({})).toEqual([]);
  });
});

describe('układ wykresów', () => {
  it('tylko 1, 2 albo 4; klucz pierwszego panelu bez zmian', () => {
    expect(parseLayout(2)).toBe(2);
    expect(parseLayout(4)).toBe(4);
    expect(parseLayout(3)).toBe(1);
    expect(parseLayout(Number.NaN)).toBe(1);
    expect(panelKey(0)).toBe('hq.charts.v1');
    expect(panelKey(2)).toBe('hq.charts.v1.p2');
  });
});
