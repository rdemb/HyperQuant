import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, NARROW_PATCH, parseSettings, saveSettings } from '../chart/settings';
import { STATIONS, saveStationLayout, stationKey, stationPanel } from '../chart/stations';
import { BUILT_IN_TEMPLATES, MTF_SETS, TEMPLATE_PHONE } from '../chart/templates';
import {
  ChartTab,
  MAX_TABS,
  TabsState,
  activeTab,
  addSet,
  addTab,
  blankName,
  closeTab,
  defaultTabs,
  insertTab,
  ladderTab,
  loadTabs,
  moveTab,
  newTabId,
  openPreset,
  openStationTab,
  parseTabs,
  presetName,
  presetQuestion,
  presetStation,
  renameTab,
  restoreTab,
  saveTabs,
  setNewCount,
  snapshotTab,
  tabIntervals,
  tabLayout,
  tabName,
  tabStation,
} from '../chart/tabs';

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

const tab = (id: string, preset: ChartTab['preset'] = 'start', name: string | null = null): ChartTab => ({ id, preset, name });
const state = (ids: string[], active = ids[0]): TabsState => ({ tabs: ids.map((id) => tab(id)), active });

describe('karty układów: stan', () => {
  it('karty startowe to stacje robocze w ich kolejności, z ich zapisem', () => {
    const st = defaultTabs();
    expect(st.tabs.map((t) => [t.id, t.preset])).toEqual(STATIONS.map((s) => [s.id, s.id]));
    expect(st.active).toBe('start');
    expect(st.tabs.map(tabName)).toEqual(STATIONS.map((s) => s.name));
  });

  it('odczyt: błędne i powtórzone id pomijane, nieznany wzorzec → Start, nazwa przycięta, limit kart', () => {
    const raw = {
      tabs: [
        { id: 'k1', preset: 'scalp', name: '  Moje 1m  ' },
        { id: 'k1', preset: 'auction' },
        { id: 'Zły klucz', preset: 'start' },
        { id: 'k2', preset: 'nie-ma', name: '' },
        { id: 'k3', preset: 'tpl:swing', name: 'x'.repeat(50) },
        null,
      ],
      active: 'k3',
    };
    const st = parseTabs(raw)!;
    expect(st.tabs).toEqual([tab('k1', 'scalp', 'Moje 1m'), tab('k2', 'start'), tab('k3', 'tpl:swing', 'x'.repeat(32))]);
    expect(st.active).toBe('k3');
    expect(parseTabs({ tabs: [{ id: 'k1' }], active: 'k9' })!.active).toBe('k1');
    expect(parseTabs({ tabs: [] })).toBeNull();
    expect(parseTabs('x')).toBeNull();
    const many = parseTabs({ tabs: Array.from({ length: 20 }, (_, i) => ({ id: `k${i}`, preset: 'start' })) })!;
    expect(many.tabs).toHaveLength(MAX_TABS);
  });

  it('nowa karta na końcu i aktywna; limit kart i powtórzone id bez zmian', () => {
    const st = state(['a', 'b']);
    expect(addTab(st, tab('c'))).toEqual({ tabs: [tab('a'), tab('b'), tab('c')], active: 'c' });
    expect(addTab(st, tab('a'))).toBe(st);
    const full = state(Array.from({ length: MAX_TABS }, (_, i) => `k${i}`));
    expect(addTab(full, tab('x'))).toBe(full);
  });

  it('zamknięcie: aktywna sąsiadka z prawej (ostatnia — z lewej), ostatniej karty nie da się zamknąć', () => {
    expect(closeTab(state(['a', 'b', 'c'], 'b'), 'b')).toEqual(state(['a', 'c'], 'c'));
    expect(closeTab(state(['a', 'b', 'c'], 'c'), 'c')).toEqual(state(['a', 'b'], 'b'));
    expect(closeTab(state(['a', 'b', 'c'], 'a'), 'c')).toEqual(state(['a', 'b'], 'a'));
    const one = state(['a']);
    expect(closeTab(one, 'a')).toBe(one);
    expect(closeTab(one, 'x')).toBe(one);
  });

  it('cofnięcie zamknięcia wstawia kartę na dawne miejsce', () => {
    const st = closeTab(state(['a', 'b', 'c'], 'b'), 'b');
    expect(insertTab(st, tab('b'), 1, true)).toEqual(state(['a', 'b', 'c'], 'b'));
    expect(insertTab(st, tab('b'), 9, false)).toEqual(state(['a', 'c', 'b'], 'c'));
  });

  it('nazwa: własna, pusta wraca do nazwy wzorca; kolejność po przeciągnięciu', () => {
    const st = { tabs: [tab('a', 'scalp'), tab('b')], active: 'a' };
    const named = renameTab(st, 'a', '  Wykonanie 1m ');
    expect(tabName(named.tabs[0])).toBe('Wykonanie 1m');
    expect(tabName(renameTab(named, 'a', '   ').tabs[0])).toBe(presetName('scalp'));
    expect(moveTab(state(['a', 'b', 'c']), 'a', 2).tabs.map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(moveTab(state(['a', 'b', 'c']), 'c', 0).tabs.map((t) => t.id)).toEqual(['c', 'a', 'b']);
  });

  it('wzorzec z lekcji: istniejąca karta z tym wzorcem, a bez niej nowa (przy limicie zastępuje aktywną)', () => {
    const st = defaultTabs();
    expect(openPreset(st, 'auction', 'k1').active).toBe('auction');
    const without = closeTab(st, 'auction');
    const opened = openPreset(without, 'auction', 'k1');
    expect([opened.active, opened.tabs[opened.tabs.length - 1]]).toEqual(['k1', tab('k1', 'auction')]);
    const full = state(Array.from({ length: MAX_TABS }, (_, i) => `k${i}`), 'k3');
    const replaced = openPreset(full, 'scalp', 'n1');
    expect([replaced.tabs.length, replaced.tabs[3], replaced.active]).toEqual([MAX_TABS, tab('n1', 'scalp'), 'n1']);
  });

  it('drabina interwałów: najbliższa karta w tę stronę paska z niższym (↓) albo wyższym (↑) interwałem, potem cały pasek', () => {
    // Zestaw od wyższego interwału po kartach startowych: krok po kroku w obrębie zestawu
    const tf: Record<string, string> = { s5: '5m', s1: '1m', s30: '30m', d: '1d', h4: '4h', a15: '15m', b15: '15m', c5: '5m' };
    const st = state(Object.keys(tf), 'h4');
    const main = (t: ChartTab) => tf[t.id];
    const go = (from: string, dir: 1 | -1) => ladderTab({ ...st, active: from }, main, dir);
    expect([go('d', -1), go('h4', -1), go('a15', -1), go('b15', -1)]).toEqual(['h4', 'a15', 'c5', 'c5']);
    expect([go('c5', 1), go('b15', 1), go('a15', 1), go('h4', 1)]).toEqual(['b15', 'h4', 'h4', 'd']);
    // Bez karty w tę stronę: najbliższy interwał na całym pasku
    expect(go('c5', -1)).toBe('s1');
    expect(go('s5', 1)).toBe('a15');
    expect([go('d', 1), go('s1', -1)]).toEqual([null, null]);
  });

  it('wzorzec szablonu: jeden wykres z ustawieniami szablonu, krótka nazwa', () => {
    for (const t of BUILT_IN_TEMPLATES) {
      const st = presetStation(`tpl:${t.id}`);
      expect(st.layout).toBe(1);
      const s = stationPanel(st, 0, false);
      expect(parseSettings(s)).toEqual(s);
      expect(s.interval).toBe(t.s.interval);
      expect(stationPanel(st, 0, true)).toEqual({ ...s, ...(TEMPLATE_PHONE[t.id] ?? NARROW_PATCH) });
      expect(presetName(`tpl:${t.id}`)).not.toContain(':');
    }
    expect(presetName('tpl:swing')).toBe('Swing 1h');
    expect(presetStation('auction').id).toBe('auction');
  });

  it('telefon szablonu: własna łatka, gdy NARROW_PATCH zdejmuje sedno pytania (otwarcia sesji)', () => {
    expect(stationPanel(presetStation('tpl:open-range'), 0, true)).toEqual({ ...stationPanel(presetStation('tpl:open-range'), 0, false), ...TEMPLATE_PHONE['open-range'] });
    expect(stationPanel(presetStation('tpl:open-range'), 0, true).showSessions).toBe(true);
  });

  it('pytanie wzorca: szablon — jego pytanie, stacja — pierwsze zdanie opisu', () => {
    expect(presetQuestion('auction')).toBe(STATIONS.find((s) => s.id === 'auction')!.question.split('?')[0] + '?');
    expect(presetQuestion('tpl:context-1d').endsWith('?')).toBe(true);
    for (const t of BUILT_IN_TEMPLATES) expect(presetQuestion(`tpl:${t.id}`).length).toBeGreaterThan(5);
  });

  it('interwał zmieniony w karcie: pierwszy wykres wzorca na tym interwale; zły interwał pomijany', () => {
    expect(stationPanel(tabStation({ id: 'k1', preset: 'tpl:squeeze', name: null, tf: '1h' }), 0, false).interval).toBe('1h');
    expect(stationPanel(presetStation('tpl:squeeze', '7m'), 0, false).interval).toBe('15m');
    expect(parseTabs({ tabs: [{ id: 'k1', preset: 'tpl:squeeze', tf: '1h' }, { id: 'k2', preset: 'start', tf: 'x' }] })!.tabs).toEqual([
      { id: 'k1', preset: 'tpl:squeeze', name: null, tf: '1h' },
      tab('k2'),
    ]);
  });

  it('zestawy MTF: wzorce istnieją, karty od wyższego interwału do niższego, zaczynają od kontekstu 1D i 4H', () => {
    const rank = (p: string, tf?: string) => ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'].indexOf(stationPanel(presetStation(p as ChartTab['preset'], tf), 0, false).interval);
    for (const set of MTF_SETS) {
      expect(set.tabs.slice(0, 2).map((e) => e.preset)).toEqual(['tpl:context-1d', 'tpl:context-4h']);
      for (const e of set.tabs) expect(parseTabs({ tabs: [{ id: 'k1', preset: e.preset }] })!.tabs[0].preset).toBe(e.preset);
      const r = set.tabs.map((e) => rank(e.preset, e.tf));
      for (let i = 1; i < r.length; i++) expect(r[i], `${set.id} ${i}`).toBeLessThanOrEqual(r[i - 1]);
    }
  });

  it('zestaw dodaje brakujące karty w swojej kolejności, otwarte zostają, aktywna — pierwsza karta zestawu', () => {
    let n = 0;
    const id = () => `n${n++}`;
    const st = defaultTabs();
    const trend = MTF_SETS.find((x) => x.id === 'trend')!;
    // Skalper (stacja) jest już otwarty
    expect(setNewCount(st, 'trend')).toBe(trend.tabs.length - 1);
    const a = addSet(st, 'trend', id);
    expect(a.tabs.length).toBe(st.tabs.length + trend.tabs.length - 1);
    expect(activeTab(a).preset).toBe('tpl:context-1d');
    expect(a.tabs.slice(st.tabs.length).map((t) => t.preset)).toEqual(trend.tabs.slice(0, -1).map((e) => e.preset));
    // Drugi zestaw nie powiela kontekstu 1D i 4H
    const b = addSet(a, 'volatility', id);
    expect(b.tabs.length).toBe(a.tabs.length + 4);
    expect(activeTab(b).id).toBe(a.tabs[st.tabs.length].id);
    expect(b.tabs.find((t) => t.preset === 'tpl:squeeze')!.tf).toBe('1h');
    expect(setNewCount(b, 'volatility')).toBe(0);
    // Bez miejsca na cały zestaw — bez zmian; nieznany zestaw — bez zmian
    const full = state(Array.from({ length: MAX_TABS - 2 }, (_, i) => `k${i}`));
    expect(addSet(full, 'trend', id)).toBe(full);
    expect(addSet(st, 'nie-ma', id)).toBe(st);
  });

  it('nowa pusta karta: pierwszy wolny numer; id kart różne i bez kolizji ze stacjami', () => {
    const st = { tabs: [tab('a'), tab('b', 'start', 'Karta 3')], active: 'a' };
    expect(blankName(st)).toBe('Karta 4');
    const ids = new Set([newTabId(1), newTabId(1), newTabId(2)]);
    expect(ids.size).toBe(3);
    for (const id of ids) expect(STATIONS.some((s) => s.id === id)).toBe(false);
  });
});

describe('karty układów: zapis', () => {
  const real = globalThis.localStorage;
  beforeEach(() => {
    globalThis.localStorage = memoryStorage();
  });
  afterEach(() => {
    globalThis.localStorage = real;
  });

  it('bez zapisu kart: stacje startowe z aktywną stacją sprzed kart; potem zapisane karty', () => {
    localStorage.setItem('hq.charts.station.v1', 'liquidity');
    expect(loadTabs().active).toBe('liquidity');
    const st = addTab(loadTabs(), tab('k1', 'tpl:tpo', 'Profil'));
    saveTabs(st);
    expect(loadTabs()).toEqual(st);
    localStorage.setItem('hq.charts.tabs.v1', '{zepsute');
    expect(loadTabs()).toEqual(defaultTabs());
  });

  it('podpis karty: interwały paneli z zapisu albo wzorca; układ z zapisu karty', () => {
    const t = tab('k1', 'auction');
    expect(tabIntervals(t, 2, false)).toEqual(['30m', '4h']);
    expect(tabLayout(t)).toBe(2);
    saveSettings({ ...DEFAULT_SETTINGS, interval: '15m' }, stationKey('k1', 1));
    saveStationLayout('k1', 4);
    expect(tabIntervals(t, 4, false)).toEqual(['30m', '15m', '1h', '4h']);
    expect(tabLayout(t)).toBe(4);
  });

  it('kopia i cofnięcie zamknięcia: zapis karty przenoszony pod inne id albo przywracany', () => {
    saveSettings({ ...DEFAULT_SETTINGS, interval: '1h' }, stationKey('k1', 0));
    saveStationLayout('k1', 2);
    const snap = snapshotTab('k1');
    restoreTab('k2', snap);
    expect([tabIntervals(tab('k2'), 1, false), tabLayout(tab('k2'))]).toEqual([['1h'], 2]);
    restoreTab('k1', snapshotTab('nic'));
    expect(localStorage.getItem(stationKey('k1', 0))).toBeNull();
    restoreTab('k1', snap);
    expect(tabIntervals(tab('k1'), 1, false)).toEqual(['1h']);
  });

  it('przycisk lekcji otwiera kartę stacji (zamkniętą — jako nową na końcu)', () => {
    saveTabs(closeTab(defaultTabs(), 'auction'));
    openStationTab('auction');
    const st = loadTabs();
    expect(activeTab(st).preset).toBe('auction');
    expect(st.tabs[st.tabs.length - 1].id).toBe(st.active);
    openStationTab('scalp');
    expect(loadTabs().active).toBe('scalp');
  });
});
