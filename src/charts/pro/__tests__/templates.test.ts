import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseLayout, parseSettings, panelKey } from '../chart/settings';
import * as templates from '../chart/templates';
import { LAYERS_OFF, MAX_TEMPLATES, applyTemplate, inds, parseTemplates, saveAs, templateOf } from '../chart/templates';

describe('szablony wykresu', () => {
  it('szablon nie zmienia rynku ani wysokości wiersza', () => {
    const s = { ...DEFAULT_SETTINGS, coin: 'ETH' as const, rowStep: 0.5, interval: '5m' };
    const clean = { ...templateOf(DEFAULT_SETTINGS), ...LAYERS_OFF, view: 'candles' as const, showDelta: false, showCvd: false };
    const out = applyTemplate(s, clean);
    expect(out.coin).toBe('ETH');
    expect(out.rowStep).toBe(0.5);
    expect(out.view).toBe('candles');
    expect(out.showHeatmap).toBe(false);
    expect(out.showVolume).toBe(true);
  });

  it('bez wbudowanych szablonów i zestawów kart MTF', () => {
    for (const name of ['BUILT_IN_TEMPLATES', 'TEMPLATE_QUESTIONS', 'TEMPLATE_PHONE', 'MTF_SETS']) expect(name in templates, name).toBe(false);
  });

  it('lista wskaźników wzorca: identyfikatory jak z menu, kolejne kolory, parametry przechodzą walidację', () => {
    const list = inds(['sma', { length: 20 }], ['sma', { length: 50 }], ['twap'], ['hv', { length: 10 }, { visible: false }]);
    expect(list.map((x) => x.iid)).toEqual(['sma1', 'sma2', 'twap1', 'hv1']);
    expect(new Set(list.map((x) => x.color)).size).toBe(4);
    expect(list[3].visible).toBe(false);
    const s = { ...DEFAULT_SETTINGS, indicators: list };
    expect(parseSettings(s)).toEqual(s);
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

  it('własny szablon zachowuje wskaźniki z interwałem (tf); zapis JSON wraca bez zmian', () => {
    const s = { ...DEFAULT_SETTINGS, indicators: inds(['ema', { length: 20 }, { tf: '1h' }], ['macd', { fast: 12, slow: 26, signal: 9 }, { tf: '4h' }]) };
    const list = saveAs([], 'Trzy ekrany', s, 1);
    const back = parseTemplates(JSON.parse(JSON.stringify(list)));
    expect(back.map((t) => t.s)).toEqual(list.map((t) => t.s));
    expect(applyTemplate({ ...DEFAULT_SETTINGS, coin: 'ETH' }, back[0].s).indicators.map((x) => x.tf)).toEqual(['1h', '4h']);
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
