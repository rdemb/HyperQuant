import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, NARROW_PATCH, parseLayout, parseSettings, panelKey, phoneSettings } from '../chart/settings';
import { BUILT_IN_TEMPLATES, MAX_TEMPLATES, TEMPLATE_PHONE, TEMPLATE_QUESTIONS, applyTemplate, parseTemplates, saveAs, templateOf } from '../chart/templates';
import { indicatorDef } from '../indicators/registry';

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

describe('szablony z metodologii (pytanie, wskaźniki, telefon)', () => {
  const ownPanes = (s: { indicators: { id: Parameters<typeof indicatorDef>[0]; visible: boolean }[] }) => s.indicators.filter((x) => x.visible && indicatorDef(x.id).pane === 'own').length;

  it('szablon zachowuje wskaźniki z interwałem (tf), parametrami i stylem; zapis JSON wraca bez zmian', () => {
    for (const t of BUILT_IN_TEMPLATES) {
      const s = applyTemplate({ ...DEFAULT_SETTINGS, coin: 'ETH', rowStep: 5 }, t.s);
      expect([s.coin, s.rowStep, s.interval, s.view]).toEqual(['ETH', 5, t.s.interval, t.s.view]);
      expect(s.indicators, t.id).toEqual(t.s.indicators);
    }
    const back = parseTemplates(JSON.parse(JSON.stringify(BUILT_IN_TEMPLATES)));
    expect(back.map((t) => t.s)).toEqual(BUILT_IN_TEMPLATES.map((t) => t.s));
    expect(BUILT_IN_TEMPLATES.find((t) => t.id === 'triple')!.s.indicators.map((x) => x.tf)).toEqual(['1h', '4h']);
  });

  it('id unikalne; każdy szablon ma pytanie i najwyżej 2 panele wskaźników, a na telefonie najwyżej 1', () => {
    const ids = BUILT_IN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of BUILT_IN_TEMPLATES) {
      const phone = phoneSettings(applyTemplate(DEFAULT_SETTINGS, { ...t.s, ...(TEMPLATE_PHONE[t.id] ?? NARROW_PATCH) }));
      expect(ownPanes(t.s), t.id).toBeLessThanOrEqual(2);
      expect(ownPanes(phone), t.id).toBeLessThanOrEqual(1);
    }
    for (const id of ids.filter((x) => !['orderflow', 'scalp', 'swing', 'clean'].includes(x))) expect(TEMPLATE_QUESTIONS[id], id).toBeTruthy();
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
