import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INDICATORS, MENU_GROUPS, menuEntries, parseIndicators } from '../indicators/registry';
import { LAYER_SOURCE } from '../chart/layerSources';
import { visibleEntries } from '../chart/menuSelection';
import { DROPPED_NOTICE_KEY, parseSettings, startSettings } from '../chart/settings';

// Grupy według pytań tradera (plan 59, G1)
const GROUPS = [
  ['presja', ['absorption', 'effres', 'ofi', 'kyle', 'oiflow']],
  ['sklad', ['breadth', 'repeat', 'makers', 'ordersize', 'twap', 'hawkes', 'premium']],
  ['ruch', ['rvol', 'regime', 'slippage', 'cone']],
  ['poziomy', ['pbrange', 'effort', 'ivb', 'outcomes']],
  ['struktura', ['smc']],
] as const;
const FRONT = GROUPS.flatMap(([, ids]) => ids) as string[];
const SECOND: string[] = [];
const CLASSIC = ['ema', 'sma', 'atr', 'bb', 'pivots', 'hv'];

describe('menu wskaźników', () => {
  it('przybliżenia wolumenu usunięte z rejestru', () => {
    for (const id of ['obv', 'cmf', 'mfi', 'netvol']) expect(INDICATORS.find((d) => d.id === id)).toBeUndefined();
  });

  it('grupy menu według pytań: kolejność grup i wskaźników; każdy wskaźnik grupy ma źródło (LIVE albo MODEL)', () => {
    expect(MENU_GROUPS.map((g) => [g.id, [...g.ids]])).toEqual(GROUPS.map(([id, ids]) => [id, [...ids]]));
    for (const id of FRONT) expect(LAYER_SOURCE[id], id).toMatch(/^(LIVE|MODEL)$/);
    expect(menuEntries('search').map((d) => d.id)).toEqual(expect.arrayContaining(['vwma', 'keltner']));
  });

  it('warstwy menu: front (grupy), second pusta i classic w ustalonej kolejności', () => {
    expect(menuEntries('front').map((d) => d.id)).toEqual(FRONT);
    expect(menuEntries('second').map((d) => d.id)).toEqual(SECOND);
    expect(menuEntries('classic').map((d) => d.id).sort()).toEqual([...CLASSIC].sort());
  });

  it('każdy wskaźnik ma warstwę, reszta to search', () => {
    const named = new Set([...FRONT, ...SECOND, ...CLASSIC]);
    expect(INDICATORS.every((d) => ['front', 'second', 'classic', 'search'].includes(d.tier))).toBe(true);
    expect(menuEntries('search').map((d) => d.id).sort()).toEqual(INDICATORS.filter((d) => !named.has(d.id)).map((d) => d.id).sort());
  });

  it('parseIndicators zwraca listę pominiętych identyfikatorów', () => {
    const r = parseIndicators([{ iid: 'a', id: 'obv' }, { iid: 'b', id: 'ema', params: { length: 20 } }]);
    expect(r.dropped).toEqual(['obv']);
    expect(r.list).toHaveLength(1);
    expect(r.list[0].id).toBe('ema');
  });
});

describe('Klasyczne zwinięte nie podpowiadają niewidocznych wierszy', () => {
  const entries = [
    ...menuEntries('classic').map((d) => ({ key: d.id, section: 'classic', tier: 'classic', words: d.id, label: d.id })),
    { key: 'oiflow', section: 'hl', tier: 'front', words: 'oiflow', label: 'oiflow' },
  ];
  const o = { q: '', section: 'classic', classicOpen: false, favs: [], hlOrder: ['oiflow'], norm: (t: string) => t.toLowerCase() };
  it('zwinięte bez zapytania: pusto; rozwinięte: sześć; z zapytaniem: wyniki', () => {
    expect(visibleEntries(entries, o)).toEqual([]);
    expect(visibleEntries(entries, { ...o, classicOpen: true })).toHaveLength(6);
    expect(visibleEntries(entries, { ...o, q: 'ema' }).map((e) => e.key)).toEqual(['ema']);
    expect(visibleEntries(entries, { ...o, section: 'hl' }).map((e) => e.key)).toEqual(['oiflow']);
  });
});

describe('jednorazowa informacja o usuniętych wskaźnikach', () => {
  const store = new Map<string, string>();
  const real = globalThis.localStorage;
  beforeEach(() => {
    store.clear();
    globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as Storage;
  });
  afterEach(() => {
    globalThis.localStorage = real;
  });
  const saved = (id: string) => ({ indicators: [{ iid: 'a', id }] });
  it('obv ustawia pending', () => {
    parseSettings(saved('obv'), startSettings());
    expect(store.get(DROPPED_NOTICE_KEY)).toBe('pending');
  });
  it('nieznany xyz nie ustawia', () => {
    parseSettings(saved('xyz'), startSettings());
    expect(store.has(DROPPED_NOTICE_KEY)).toBe(false);
  });
  it('done nie jest nadpisane', () => {
    store.set(DROPPED_NOTICE_KEY, 'done');
    parseSettings(saved('mfi'), startSettings());
    expect(store.get(DROPPED_NOTICE_KEY)).toBe('done');
  });
});

describe('wyszukiwanie po wielu słowach', () => {
  const all = INDICATORS.map((d) => ({ key: d.id, section: 'x', words: `${d.short} ${d.name} ${d.aliases}`.toLowerCase(), label: d.name, badge: d.short }));
  const o = { section: 'hl', classicOpen: false, favs: [], hlOrder: [], norm: (t: string) => t.toLowerCase() };
  const find = (q: string) => visibleEntries(all, { ...o, q }).map((e) => e.key);
  it('kolejność słów nie ma znaczenia', () => {
    expect(find('open interest')).toContain('oiflow');
    expect(find('interest open')).toContain('oiflow');
  });
  it('zapytanie z literą s nie jest dzielone po niej', () => {
    expect(find('slippage')).toContain('slippage');
    expect(find('koszt cost')).toContain('slippage');
  });
});
