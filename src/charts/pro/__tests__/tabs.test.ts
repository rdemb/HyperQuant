import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChartSettings, DEFAULT_SETTINGS, loadSettings, parseSettings, saveSettings } from '../chart/settings';
import { STATIONS, saveStationLayout, stationById, stationKey, stationPanel } from '../chart/stations';
import { inds } from '../chart/templates';
import { LEGACY_STATIONS, LEGACY_TEMPLATES } from '../chart/legacyPresets';
import {
  ChartTab,
  MAX_TABS,
  TabPreset,
  TabsState,
  activeTab,
  addTab,
  blankName,
  canClose,
  canRestore,
  closeTab,
  defaultTabs,
  dismissRestoreOffer,
  insertTab,
  ladderTab,
  loadPhaseActive,
  loadTabs,
  migrateTabsV2,
  moveTab,
  newTabId,
  openCoin,
  openPreset,
  openStationTab,
  parseTabs,
  phaseTabs,
  presetName,
  presetQuestion,
  presetStation,
  renameTab,
  restoreLegacyStart,
  restoreTab,
  savePhaseActive,
  saveTabs,
  snapshotTab,
  tabIntervals,
  tabLayout,
  tabName,
  tabStation,
  tabsFull,
} from '../chart/tabs';

/** Pamięć przeglądarki w testach (środowisko node). */
function memoryStorage(init: Record<string, string> = {}): Storage {
  const m = new Map<string, string>(Object.entries(init));
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

/** Cała zawartość pamięci (porównanie przed i po). */
const dump = (s: Storage) => Object.fromEntries(Array.from({ length: s.length }, (_, i) => s.key(i)!).map((k) => [k, s.getItem(k)]));

/** Zapis ustawień jak `saveSettings` (z wersją warstw). */
const saved = (s: Partial<ChartSettings>) => JSON.stringify({ ...DEFAULT_SETTINGS, ...s, layersV: 2 });
const read = (s: Storage, key: string) => parseSettings(JSON.parse(s.getItem(key)!));

const LAYOUT_IDS = STATIONS.map((s) => s.id);
const tab = (id: string, preset: TabPreset = 'own', name: string | null = null): ChartTab => ({ id, preset, name });
const state = (ids: string[], active = ids[0]): TabsState => ({ tabs: ids.map((id) => tab(id)), active });

describe('karty: stan', () => {
  it('karty startowe: sześć układów (id = wzorzec), aktywny Kokpit', () => {
    const st = defaultTabs();
    expect(st.tabs.map((t) => t.id)).toEqual(LAYOUT_IDS);
    expect(st.tabs.map((t) => t.preset)).toEqual(LAYOUT_IDS);
    expect(st.active).toBe('cockpit');
    expect(st.tabs.map(tabName)).toEqual(STATIONS.map((s) => s.name));
  });

  it('odczyt: układy zawsze na początku w kolejności faz, własne karty po nich; błędne i powtórzone id pomijane', () => {
    const raw = {
      tabs: [
        { id: 'k1', preset: 'cockpit', name: '  Moje 1m  ' },
        { id: 'review', preset: 'review', name: 'Wieczór' },
        { id: 'k1', preset: 'fuel' },
        { id: 'Zły klucz', preset: 'own' },
        { id: 'k2', preset: 'nie-ma', name: '' },
        { id: 'k3', preset: 'own', name: 'x'.repeat(50) },
        { id: 'cockpit', preset: 'own' },
        null,
      ],
      active: 'k3',
    };
    const st = parseTabs(raw);
    expect(st.tabs.map((t) => t.id)).toEqual([...LAYOUT_IDS, 'k1', 'k2', 'k3']);
    expect(st.tabs.slice(0, 6).map((t) => t.preset)).toEqual(LAYOUT_IDS);
    expect(st.tabs.find((t) => t.id === 'review')!.name).toBe('Wieczór');
    expect(st.tabs.slice(6)).toEqual([tab('k1', 'cockpit', 'Moje 1m'), tab('k2'), tab('k3', 'own', 'x'.repeat(32))]);
    expect(st.active).toBe('k3');
    expect(parseTabs({ tabs: [{ id: 'k1' }], active: 'k9' }).active).toBe('cockpit');
    expect(parseTabs({ tabs: [] })).toEqual(defaultTabs());
    expect(parseTabs('x')).toEqual(defaultTabs());
  });

  it('limit liczy tylko karty własne: układy są zawsze', () => {
    const many = parseTabs({ tabs: Array.from({ length: MAX_TABS + 5 }, (_, i) => ({ id: `k${i}`, preset: 'own' })) });
    expect(many.tabs).toHaveLength(LAYOUT_IDS.length + MAX_TABS);
    expect(tabsFull(many)).toBe(true);
    expect(addTab(many, tab('x'))).toBe(many);
    expect(tabsFull(defaultTabs())).toBe(false);
  });

  it('nowa karta na końcu i aktywna; powtórzone id bez zmian', () => {
    const st = state(['a', 'b']);
    expect(addTab(st, tab('c'))).toEqual({ tabs: [tab('a'), tab('b'), tab('c')], active: 'c' });
    expect(addTab(st, tab('a'))).toBe(st);
  });

  it('zamknięcie: aktywna sąsiadka z prawej (ostatnia — z lewej); ostatniej karty i kart układów nie da się zamknąć', () => {
    expect(closeTab(state(['a', 'b', 'c'], 'b'), 'b')).toEqual(state(['a', 'c'], 'c'));
    expect(closeTab(state(['a', 'b', 'c'], 'c'), 'c')).toEqual(state(['a', 'b'], 'b'));
    expect(closeTab(state(['a', 'b', 'c'], 'a'), 'c')).toEqual(state(['a', 'b'], 'a'));
    const one = state(['a']);
    expect(closeTab(one, 'a')).toBe(one);
    expect(closeTab(one, 'x')).toBe(one);
    const st = addTab(defaultTabs(), tab('k1'));
    expect(closeTab(st, 'cockpit')).toBe(st);
    expect([canClose(st, st.tabs[2]), canClose(st, tab('k1')), canClose(state(['a']), tab('a'))]).toEqual([false, true, false]);
  });

  it('cofnięcie zamknięcia wstawia kartę na dawne miejsce', () => {
    const st = closeTab(state(['a', 'b', 'c'], 'b'), 'b');
    expect(insertTab(st, tab('b'), 1, true)).toEqual(state(['a', 'b', 'c'], 'b'));
    expect(insertTab(st, tab('b'), 9, false)).toEqual(state(['a', 'c', 'b'], 'c'));
  });

  it('nazwa: własna, pusta wraca do nazwy wzorca; przeciąganie nie rusza kart układów', () => {
    const st = { tabs: [tab('a', 'big-hands'), tab('b')], active: 'a' };
    const named = renameTab(st, 'a', '  Wykonanie 5m ');
    expect(tabName(named.tabs[0])).toBe('Wykonanie 5m');
    expect(tabName(renameTab(named, 'a', '   ').tabs[0])).toBe(presetName('big-hands'));
    expect(moveTab(state(['a', 'b', 'c']), 'a', 2).tabs.map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(moveTab(state(['a', 'b', 'c']), 'c', 0).tabs.map((t) => t.id)).toEqual(['c', 'a', 'b']);
    const withOwn = addTab(addTab(defaultTabs(), tab('k1')), tab('k2'));
    expect(moveTab(withOwn, 'k2', 0).tabs.map((t) => t.id)).toEqual([...LAYOUT_IDS, 'k2', 'k1']);
    expect(moveTab(withOwn, 'cockpit', 7)).toBe(withOwn);
  });

  it('wzorzec z lekcji: karta układu staje się aktywna', () => {
    const st = addTab(defaultTabs(), tab('k1', 'day-map'));
    expect(openPreset(st, 'day-map').active).toBe('day-map');
    expect(openPreset(st, 'review').active).toBe('review');
  });

  it('drabina interwałów: najbliższa karta w tę stronę paska z niższym (↓) albo wyższym (↑) interwałem, potem cały pasek', () => {
    const tf: Record<string, string> = { s5: '5m', s1: '1m', s30: '30m', d: '1d', h4: '4h', a15: '15m', b15: '15m', c5: '5m' };
    const st = state(Object.keys(tf), 'h4');
    const main = (t: ChartTab) => tf[t.id];
    const go = (from: string, dir: 1 | -1) => ladderTab({ ...st, active: from }, main, dir);
    expect([go('d', -1), go('h4', -1), go('a15', -1), go('b15', -1)]).toEqual(['h4', 'a15', 'c5', 'c5']);
    expect([go('c5', 1), go('b15', 1), go('a15', 1), go('h4', 1)]).toEqual(['b15', 'h4', 'h4', 'd']);
    expect(go('c5', -1)).toBe('s1');
    expect(go('s5', 1)).toBe('a15');
    expect([go('d', 1), go('s1', -1)]).toEqual([null, null]);
  });

  it('karta własna: jeden wykres z ustawieniami startowymi, bez wzorca do przywrócenia', () => {
    const own = presetStation('own');
    expect(own.layout).toBe(1);
    expect(stationPanel(own, 0, false)).toEqual(DEFAULT_SETTINGS);
    expect(tabName(tab('k1'))).toBe(presetName('own'));
    expect(presetName('own').length).toBeGreaterThan(0);
    expect(presetQuestion('own').length).toBeGreaterThan(5);
    expect([canRestore(tab('k1')), canRestore(tab('k1', 'fuel')), canRestore(defaultTabs().tabs[0])]).toEqual([false, true, true]);
    expect(tabStation(tab('k1', 'auction-open')).id).toBe('auction-open');
    expect(presetQuestion('review')).toBe(stationById('review').question);
  });

  it('karty fazy: układy fazy, kopia układu w fazie swojego wzorca, karty własne tylko w sesji', () => {
    expect(phaseTabs(defaultTabs(), 'before').map((t) => t.id)).toEqual(['day-map', 'fuel']);
    const st = addTab(addTab(addTab(addTab(defaultTabs(), tab('k1')), tab('k2', 'day-map')), tab('k3', 'review')), tab('k4', 'cockpit'));
    expect(phaseTabs(st, 'before').map((t) => t.id)).toEqual(['day-map', 'fuel', 'k2']);
    expect(phaseTabs(st, 'session').map((t) => t.id)).toEqual(['cockpit', 'auction-open', 'big-hands', 'k1', 'k4']);
    expect(phaseTabs(st, 'after').map((t) => t.id)).toEqual(['review', 'k3']);
  });

  it('nowa pusta karta: pierwszy wolny numer; id kart różne i bez kolizji z układami', () => {
    const st = { tabs: [tab('a'), tab('b', 'own', 'Karta 3')], active: 'a' };
    expect(blankName(st)).toBe('Karta 4');
    const ids = new Set([newTabId(1), newTabId(1), newTabId(2)]);
    expect(ids.size).toBe(3);
    for (const id of ids) {
      expect(LAYOUT_IDS.includes(id as never)).toBe(false);
      expect(parseTabs({ tabs: [{ id, preset: 'own' }] }).tabs.some((t) => t.id === id)).toBe(true);
    }
  });
});

describe('karty: zapis', () => {
  const real = globalThis.localStorage;
  beforeEach(() => {
    globalThis.localStorage = memoryStorage();
  });
  afterEach(() => {
    globalThis.localStorage = real;
  });

  it('świeża pamięć: sześć układów; potem zapisane karty; zepsuty zapis — karty startowe', () => {
    expect(loadTabs().tabs.map((t) => t.id)).toEqual(LAYOUT_IDS);
    const st = addTab(loadTabs(), tab('k1', 'own', 'Profil'));
    saveTabs(st);
    expect(loadTabs()).toEqual(st);
    localStorage.setItem('hq.charts.tabs.v1', '{zepsute');
    expect(loadTabs()).toEqual(defaultTabs());
  });

  it('podpis karty: interwały paneli z zapisu albo wzorca; układ z zapisu karty', () => {
    const t = tab('k1', 'day-map');
    expect(tabIntervals(t, 2, false)).toEqual(['4h', '30m']);
    expect(tabLayout(t)).toBe(2);
    saveSettings({ ...DEFAULT_SETTINGS, interval: '15m' }, stationKey('k1', 1));
    saveStationLayout('k1', 4);
    expect(tabIntervals(t, 4, false)).toEqual(['4h', '15m', '1h', '4h']);
    expect(tabLayout(t)).toBe(4);
    expect([tabIntervals(tab('k2'), 1, false), tabLayout(tab('k2'))]).toEqual([['5m'], 1]);
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

  it('rynek otwieranej karty: zwykłe przełączenie przenosi rynek bieżącej karty, przywrócony dawny Start ma rynki ze swojego zapisu', () => {
    saveSettings({ ...DEFAULT_SETTINGS, coin: 'SOL' }, stationKey('cockpit', 0));
    localStorage.setItem('hq.charts.v1', saved({ coin: 'ETH', interval: '15m' }));
    localStorage.setItem('hq.charts.v1.p1', saved({ coin: 'HYPE', interval: '4h' }));
    const t = restoreLegacyStart(localStorage);
    expect(openCoin('cockpit', false)).toBe('SOL');
    expect(openCoin('k-bez-zapisu', false)).toBe(DEFAULT_SETTINGS.coin);
    // Bez rynku z bieżącej karty każdy wykres przywróconej karty czyta rynek ze swojego zapisu
    expect(openCoin('cockpit', true)).toBeNull();
    expect([0, 1].map((p) => loadSettings(stationKey(t.id, p)).coin)).toEqual(['ETH', 'HYPE']);
  });

  it('przycisk lekcji otwiera kartę układu', () => {
    openStationTab('day-map');
    expect(loadTabs().active).toBe('day-map');
    openStationTab('big-hands');
    expect(activeTab(loadTabs()).preset).toBe('big-hands');
  });

  it('aktywna karta każdej fazy: domyślnie pierwszy układ fazy (w sesji Kokpit), zapis i walidacja', () => {
    expect(loadPhaseActive()).toEqual({ before: 'day-map', session: 'cockpit', after: 'review' });
    savePhaseActive({ before: 'fuel', session: 'k1', after: 'review' });
    expect(localStorage.getItem('hq.charts.phaseActive.v1')).not.toBeNull();
    expect(loadPhaseActive()).toEqual({ before: 'fuel', session: 'k1', after: 'review' });
    localStorage.setItem('hq.charts.phaseActive.v1', JSON.stringify({ before: 'cockpit', session: 'day-map', after: 7 }));
    expect(loadPhaseActive()).toEqual({ before: 'day-map', session: 'cockpit', after: 'review' });
    localStorage.setItem('hq.charts.phaseActive.v1', '{zepsute');
    expect(loadPhaseActive()).toEqual({ before: 'day-map', session: 'cockpit', after: 'review' });
  });
});

describe('migracja kart do układów faz', () => {
  const OLD_TABS = JSON.stringify({
    tabs: [
      { id: 'start', preset: 'start' },
      { id: 'scalp', preset: 'scalp' },
      { id: 'k1', preset: 'tpl:swing', name: null },
    ],
    active: 'k1',
  });
  const START = saved({ coin: 'ETH', interval: '15m', indicators: inds(['rsi']), showHeatmap: false, view: 'candles' });
  const SCALP = saved({ interval: '3m', showTape: true });
  const returning = () => memoryStorage({ 'hq.charts.tabs.v1': OLD_TABS, 'hq.charts.v1': START, 'hq.charts.v1.scalp': SCALP });
  const tabsOf = (s: Storage) => parseTabs(JSON.parse(s.getItem('hq.charts.tabs.v1')!));

  it('świeża pamięć: sześć układów, bez paska przywrócenia', () => {
    const s = memoryStorage();
    expect(migrateTabsV2(s)).toEqual({ restoreStart: false });
    expect(tabsOf(s)).toEqual(defaultTabs());
    expect(s.getItem('hq.charts.tabs.migrated.v2')).not.toBeNull();
  });

  it('powracający użytkownik: nietknięta karta startowa znika, reszta to karty własne z dawnym wyglądem, Kokpit dostaje rynek, interwał i wskaźniki', () => {
    const s = returning();
    expect(migrateTabsV2(s)).toEqual({ restoreStart: true });
    const st = tabsOf(s);
    expect(st.tabs.map((t) => t.id)).toEqual([...LAYOUT_IDS, 'scalp', 'k1']);
    expect(st.tabs.slice(6).map((t) => t.preset)).toEqual(['own', 'own']);
    expect(st.active).toBe('k1');
    // Karta bez własnej nazwy zachowuje nazwę dawnego wzorca
    expect(st.tabs.slice(6).map(tabName)).toEqual(['Skalper', 'Swing 1h']);
    // k1: wzorzec szablonu „Swing 1h” zapisany pod kluczami karty, z układem
    const swing = LEGACY_TEMPLATES.find((t) => t.id === 'swing')!;
    expect(read(s, 'hq.charts.v1.k1')).toEqual(parseSettings({ ...DEFAULT_SETTINGS, ...swing.patch }));
    expect([read(s, 'hq.charts.v1.k1').interval, read(s, 'hq.charts.v1.k1').showLiq, read(s, 'hq.charts.v1.k1').showWhales]).toEqual(['1h', true, true]);
    expect(s.getItem('hq.charts.layout.v1.k1')).toBe('1');
    // scalp: zapis użytkownika bez zmian
    expect(s.getItem('hq.charts.v1.scalp')).toBe(SCALP);
    // Kokpit: rynek, interwał i wskaźniki z dawnego Startu, warstwy z wzorca Kokpitu
    const cockpit = read(s, 'hq.charts.v1.cockpit');
    expect([cockpit.coin, cockpit.interval, cockpit.indicators.map((x) => x.id)]).toEqual(['ETH', '15m', ['rsi']]);
    const pattern = stationPanel(stationById('cockpit'), 0, false);
    expect(cockpit).toEqual({ ...pattern, coin: 'ETH', interval: '15m', indicators: cockpit.indicators });
    expect([cockpit.view, cockpit.showHeatmap, cockpit.showClashes]).toEqual(['footprint', true, true]);
    // Dawny klucz Startu nietknięty
    expect(s.getItem('hq.charts.v1')).toBe(START);
  });

  it('druga migracja nic nie zmienia (znacznik)', () => {
    const s = returning();
    migrateTabsV2(s);
    const before = dump(s);
    expect(migrateTabsV2(s)).toEqual({ restoreStart: true });
    expect(dump(s)).toEqual(before);
    // Nawet dawny zapis kart wpisany ponownie nie jest migrowany drugi raz
    s.setItem('hq.charts.tabs.v1', OLD_TABS);
    migrateTabsV2(s);
    expect(s.getItem('hq.charts.tabs.v1')).toBe(OLD_TABS);
  });

  it('kopia dawnej listy kart przed zapisem nowej, raz (istniejąca kopia zostaje)', () => {
    const s = returning();
    migrateTabsV2(s);
    expect(s.getItem('hq.charts.tabs.v1.pre-v2')).toBe(OLD_TABS);
    const kept = memoryStorage({ 'hq.charts.tabs.v1': OLD_TABS, 'hq.charts.tabs.v1.pre-v2': 'starsza kopia' });
    migrateTabsV2(kept);
    expect(kept.getItem('hq.charts.tabs.v1.pre-v2')).toBe('starsza kopia');
    const fresh = memoryStorage();
    migrateTabsV2(fresh);
    expect(fresh.getItem('hq.charts.tabs.v1.pre-v2')).toBeNull();
  });

  it('dawna karta stacji tylko obejrzana (zapis = wzorzec, inny rynek) znika; zmieniona zostaje jako własna', () => {
    const scalp = LEGACY_STATIONS.find((x) => x.id === 'scalp')!;
    const auction = LEGACY_STATIONS.find((x) => x.id === 'auction')!;
    const viewed = (st: typeof scalp, p: number, patch: Partial<ChartSettings> = {}, narrow = false) =>
      JSON.stringify({ ...stationPanel(st, p, narrow), coin: 'ETH', rowStep: 5, ...patch, layersV: 2 });
    const s = memoryStorage({
      'hq.charts.tabs.v1': JSON.stringify({
        tabs: ['scalp', 'liquidity', 'auction', 'venues', 'mtf'].map((id) => ({ id, preset: id })),
        active: 'scalp',
      }),
      // Skalper obejrzany: zapis = wzorzec (inny rynek i wysokość wiersza)
      'hq.charts.v1.scalp': viewed(scalp, 0),
      // Płynność obejrzana na telefonie: wzorzec z łatką telefonu
      'hq.charts.v1.liquidity': viewed(LEGACY_STATIONS.find((x) => x.id === 'liquidity')!, 0, {}, true),
      // Aukcja: oba panele jak we wzorcu, układ zapisany równy wzorcowi
      'hq.charts.v1.auction': viewed(auction, 0),
      'hq.charts.v1.auction.p1': viewed(auction, 1),
      'hq.charts.layout.v1.auction': '2',
      // Giełdy: zmieniony interwał
      'hq.charts.v1.venues': viewed(LEGACY_STATIONS.find((x) => x.id === 'venues')!, 0, { interval: '15m' }),
      // Dwa interwały: wzorzec, ale układ 4 zamiast 2
      'hq.charts.v1.mtf': viewed(LEGACY_STATIONS.find((x) => x.id === 'mtf')!, 0),
      'hq.charts.layout.v1.mtf': '4',
    });
    migrateTabsV2(s);
    const st = tabsOf(s);
    expect(st.tabs.slice(6).map((t) => [t.id, t.preset])).toEqual([
      ['venues', 'own'],
      ['mtf', 'own'],
    ]);
    expect(read(s, 'hq.charts.v1.venues').interval).toBe('15m');
    expect(st.active).toBe('cockpit');
  });

  it('Skalper zapisany jak wzorzec, ale z innym interwałem, zostaje jako karta własna', () => {
    const scalp = LEGACY_STATIONS.find((x) => x.id === 'scalp')!;
    const tabs = JSON.stringify({ tabs: [{ id: 'scalp', preset: 'scalp' }], active: 'scalp' });
    const pattern = (patch: Partial<ChartSettings>) => JSON.stringify({ ...stationPanel(scalp, 0, false), ...patch, layersV: 2 });
    const same = memoryStorage({ 'hq.charts.tabs.v1': tabs, 'hq.charts.v1.scalp': pattern({ coin: 'ETH' }) });
    migrateTabsV2(same);
    expect(tabsOf(same).tabs.map((t) => t.id)).toEqual(LAYOUT_IDS);
    const changed = memoryStorage({ 'hq.charts.tabs.v1': tabs, 'hq.charts.v1.scalp': pattern({ interval: '5m' }) });
    migrateTabsV2(changed);
    expect(tabsOf(changed).tabs.slice(6)).toEqual([tab('scalp', 'own', 'Skalper')]);
    expect(read(changed, 'hq.charts.v1.scalp').interval).toBe('5m');
  });

  it('pasek przywrócenia raz: po zamknięciu migracja już go nie proponuje', () => {
    const s = returning();
    migrateTabsV2(s);
    dismissRestoreOffer(s);
    expect(s.getItem('hq.charts.restoreOffer.v1')).toBe('done');
    expect(migrateTabsV2(s)).toEqual({ restoreStart: false });
  });

  it('dawny wzorzec bez zapisu: panele i układ wzorca; zapis częściowy uzupełniony, zapis użytkownika bez zmian', () => {
    const P0 = saved({ interval: '1h' });
    const s = memoryStorage({
      'hq.charts.tabs.v1': JSON.stringify({
        tabs: [
          { id: 'auction', preset: 'auction' },
          { id: 'liquidity', preset: 'liquidity', name: 'Nietknięta' },
          { id: 'k2', preset: 'tpl:squeeze', tf: '1h' },
          { id: 'k3', preset: 'mtf', name: 'Moje MTF' },
          { id: 'k4', preset: 'start', name: 'Karta 7' },
          { id: 'k5', preset: 'tpl:nie-ma' },
        ],
        active: 'auction',
      }),
      'hq.charts.v1.auction': P0,
    });
    expect(migrateTabsV2(s)).toEqual({ restoreStart: false });
    const st = tabsOf(s);
    expect(st.tabs.slice(6).map((t) => [t.id, t.preset, tabName(t)])).toEqual([
      ['auction', 'own', 'Aukcja'],
      ['k2', 'own', 'Ściśnięcie zmienności'],
      ['k3', 'own', 'Moje MTF'],
      ['k4', 'own', 'Karta 7'],
      ['k5', 'own', 'Start'],
    ]);
    expect(st.active).toBe('auction');
    const auction = LEGACY_STATIONS.find((x) => x.id === 'auction')!;
    // Zapisany panel 0 bez zmian, panel 1 i układ z dawnego wzorca
    expect(s.getItem('hq.charts.v1.auction')).toBe(P0);
    expect(read(s, 'hq.charts.v1.auction.p1')).toEqual(parseSettings({ ...DEFAULT_SETTINGS, ...auction.panels[1] }));
    expect(s.getItem('hq.charts.layout.v1.auction')).toBe('2');
    // Interwał zmieniony w karcie zestawu MTF
    expect(read(s, 'hq.charts.v1.k2').interval).toBe('1h');
    expect(read(s, 'hq.charts.v1.k2').indicators.map((x) => x.id)).toEqual(['bb', 'keltner', 'regime', 'hv']);
    // Stacja dwóch wykresów: oba panele i układ 2
    expect([read(s, 'hq.charts.v1.k3').interval, read(s, 'hq.charts.v1.k3.p1').interval, s.getItem('hq.charts.layout.v1.k3')]).toEqual(['5m', '1h', '2']);
    // Pusta karta: ustawienia startowe
    expect(read(s, 'hq.charts.v1.k4')).toEqual(DEFAULT_SETTINGS);
    expect(s.getItem('hq.charts.v1.liquidity')).toBeNull();
  });

  it('bez zapisu kart (sprzed kart): dawne stacje z zapisem zostają jako karty własne', () => {
    const LIQ = saved({ interval: '15m' });
    const s = memoryStorage({ 'hq.charts.v1.liquidity': LIQ, 'hq.charts.station.v1': 'liquidity' });
    migrateTabsV2(s);
    const st = tabsOf(s);
    expect(st.tabs.map((t) => t.id)).toEqual([...LAYOUT_IDS, 'liquidity']);
    expect(st.active).toBe('liquidity');
    expect(s.getItem('hq.charts.v1.liquidity')).toBe(LIQ);
  });

  it('istniejący zapis Kokpitu zostaje', () => {
    const COCKPIT = saved({ interval: '1m', coin: 'SOL' });
    const s = memoryStorage({ 'hq.charts.v1': START, 'hq.charts.v1.cockpit': COCKPIT });
    expect(migrateTabsV2(s)).toEqual({ restoreStart: true });
    expect(s.getItem('hq.charts.v1.cockpit')).toBe(COCKPIT);
  });

  it('20 dawnych kart z zapisem: żadna nie ginie', () => {
    const init: Record<string, string> = {
      'hq.charts.tabs.v1': JSON.stringify({ tabs: Array.from({ length: 20 }, (_, i) => ({ id: `k${i}`, preset: 'tpl:tpo' })), active: 'k0' }),
    };
    for (let i = 0; i < 20; i++) init[`hq.charts.v1.k${i}`] = saved({ interval: '30m' });
    const s = memoryStorage(init);
    migrateTabsV2(s);
    expect(tabsOf(s).tabs).toHaveLength(LAYOUT_IDS.length + 20);
  });

  it('przywrócenie dawnego Startu: karta własna z pełną zawartością dawnych kluczy; dawne klucze bez zmian', () => {
    const P1 = saved({ interval: '4h' });
    const s = memoryStorage({ 'hq.charts.v1': START, 'hq.charts.v1.p1': P1, 'hq.charts.layout.v1': '2' });
    const before = dump(s);
    const t = restoreLegacyStart(s);
    expect([t.preset, t.name]).toEqual(['own', 'Moje dawne ustawienia']);
    expect(parseTabs({ tabs: [t] }).tabs.some((x) => x.id === t.id)).toBe(true);
    expect([s.getItem(stationKey(t.id, 0)), s.getItem(stationKey(t.id, 1)), s.getItem(stationKey(t.id, 2)), s.getItem(`hq.charts.layout.v1.${t.id}`)]).toEqual([START, P1, null, '2']);
    for (const [k, v] of Object.entries(before)) expect(s.getItem(k)).toBe(v);
  });

  it('pierwsze otwarcie kart z innego miejsca (lekcje) też przechodzi przez migrację', () => {
    const real = globalThis.localStorage;
    globalThis.localStorage = returning();
    try {
      openStationTab('fuel');
      expect(localStorage.getItem('hq.charts.tabs.migrated.v2')).not.toBeNull();
      expect(read(localStorage, 'hq.charts.v1.k1').interval).toBe('1h');
      expect(loadTabs().active).toBe('fuel');
    } finally {
      globalThis.localStorage = real;
    }
  });
});
