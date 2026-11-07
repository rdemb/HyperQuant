import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, NARROW_PATCH, PANEL_SET_IDS, parseSettings, phoneSettings } from '../chart/settings';
import { inds } from '../chart/templates';
import {
  LAYOUT_ORDER,
  LEGACY_STATION,
  PHASE_LAYOUTS,
  STATIONS,
  activePanelSet,
  clearStation,
  loadStationLayout,
  panelSetPanel,
  priceLayerCount,
  saveStationLayout,
  stationById,
  stationIdOf,
  stationKey,
  stationKeys,
  stationPanel,
  switchPanelSet,
  underPaneCount,
} from '../chart/stations';

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

describe('układy faz dnia', () => {
  it('sześć układów w kolejności faz: przed sesją, w sesji, po sesji', () => {
    expect(STATIONS.map((s) => s.id)).toEqual(['day-map', 'fuel', 'cockpit', 'auction-open', 'big-hands', 'review']);
    expect(STATIONS.map((s) => s.id)).toEqual([...PHASE_LAYOUTS.before, ...PHASE_LAYOUTS.session, ...PHASE_LAYOUTS.after]);
    for (const s of STATIONS) expect(PHASE_LAYOUTS[s.phase], s.id).toContain(s.id);
  });

  it('każdy wzorzec przechodzi walidację ustawień bez zmian, na komputerze i na telefonie', () => {
    for (const st of STATIONS)
      for (const narrow of [false, true])
        for (let p = 0; p < 4; p++) {
          const s = stationPanel(st, p, narrow);
          expect(parseSettings(s), `${st.id} ${p} ${narrow}`).toEqual(s);
        }
  });

  it('najwyżej 5 warstw na wykresie ceny w każdym panelu i zestawie paneli (wskaźniki na cenie też się liczą)', () => {
    for (const st of STATIONS)
      for (const narrow of [false, true]) {
        for (let p = 0; p < 4; p++) expect(priceLayerCount(stationPanel(st, p, narrow)), `${st.id} ${p} ${narrow}`).toBeLessThanOrEqual(5);
        for (const set of st.panelSets ?? []) expect(priceLayerCount(panelSetPanel(st, set.id, 0, narrow)), `${st.id} ${set.id} ${narrow}`).toBeLessThanOrEqual(5);
      }
    // Ustawienia startowe: VWAP, profil, poziomy dnia i otwarcia sesji; stożek na cenie +1, ukryty i we własnym panelu — nie
    expect(priceLayerCount(DEFAULT_SETTINGS)).toBe(4);
    expect(priceLayerCount({ ...DEFAULT_SETTINGS, indicators: inds(['cone'], ['rsi'], ['ema', {}, { visible: false }]) })).toBe(5);
    // Mapa dnia 30m: TPO z OI, VWAP, poziomy dnia i stożek — bez pasm VWAP
    const map30 = stationPanel(stationById('day-map'), 1, false);
    expect([map30.showVwapBands, priceLayerCount(map30)]).toEqual([false, 5]);
  });

  it('wzorce odpowiadają pytaniom układów', () => {
    const map = stationById('day-map');
    expect([map.layout, stationPanel(map, 0, false).interval, stationPanel(map, 1, false).interval]).toEqual([2, '4h', '30m']);
    expect(stationPanel(map, 1, false).indicators.map((x) => x.id)).toEqual(['cone']);
    // Telefon: 30m z TPO, bez poziomów dnia (NARROW_PATCH)
    const phone = stationPanel(map, 0, true);
    expect([phone.interval, phone.showTpo, phone.showPeriodProfiles, phone.showLevels]).toEqual(['30m', true, false, false]);
    const cockpit = stationPanel(stationById('cockpit'), 0, false);
    expect([cockpit.interval, cockpit.view, cockpit.showHeatmap, cockpit.showCvd, cockpit.showDelta]).toEqual(['1m', 'footprint', true, true, false]);
    expect([stationPanel(stationById('cockpit'), 0, true).showClashes, stationPanel(stationById('cockpit'), 0, true).showLots]).toEqual([false, false]);
    expect(stationPanel(stationById('fuel'), 0, false).indicators.map((x) => x.id)).toEqual(['slippage', 'regime']);
    expect(stationPanel(stationById('fuel'), 0, true).showWhales).toBe(false);
    const open = stationPanel(stationById('auction-open'), 0, false);
    expect([open.interval, open.fpStyle, open.cvdReset, open.showDevPoc, open.showDelta]).toEqual(['5m', 'delta', 'session', true, false]);
    expect(stationPanel(stationById('auction-open'), 0, true).showZones).toBe(false);
    expect(stationPanel(stationById('big-hands'), 0, false).indicators.map((x) => x.id)).toEqual(['twap', 'ordersize', 'hawkes']);
    expect(stationPanel(stationById('big-hands'), 0, true).indicators.map((x) => x.id)).toEqual(['twap']);
    const review = stationPanel(stationById('review'), 0, false);
    expect([review.interval, review.showTpo, review.showIb]).toEqual(['30m', true, true]);
  });

  it('pytanie każdego układu to jedno pytanie', () => {
    for (const s of STATIONS) {
      expect(s.question.endsWith('?'), s.id).toBe(true);
      expect(s.question.indexOf('?'), s.id).toBe(s.question.length - 1);
    }
    expect(stationById('cockpit').question).toBe('Kto teraz naciska, kto przyjmuje uderzenia i co stoi w kolejce?');
  });

  it('najwyżej 3 panele pod wykresem ceny w każdym panelu i zestawie paneli, na telefonie najwyżej 2', () => {
    for (const st of STATIONS) {
      for (let p = 0; p < 4; p++) expect(underPaneCount(stationPanel(st, p, false)), `${st.id} ${p}`).toBeLessThanOrEqual(3);
      expect(underPaneCount(phoneSettings(stationPanel(st, 0, true))), `${st.id} telefon`).toBeLessThanOrEqual(2);
      for (const set of st.panelSets ?? []) {
        expect(underPaneCount(panelSetPanel(st, set.id, 0, false)), `${st.id} ${set.id}`).toBeLessThanOrEqual(3);
        expect(underPaneCount(phoneSettings(panelSetPanel(st, set.id, 0, true))), `${st.id} ${set.id} telefon`).toBeLessThanOrEqual(2);
      }
    }
    // Licznik: wolumen, delta, CVD (oraz panele giełd i tablica) i widoczne wskaźniki we własnym panelu; stożek jest na wykresie ceny
    expect(underPaneCount(DEFAULT_SETTINGS)).toBe(3);
    expect(underPaneCount({ ...DEFAULT_SETTINGS, indicators: inds(['rsi'], ['cone'], ['hv', {}, { visible: false }]) })).toBe(4);
    expect(underPaneCount({ ...DEFAULT_SETTINGS, showVenueCvd: true, showStats: true })).toBe(5);
  });

  it('panele pod wykresem: Aukcja i otwarcie — CVD na sesję i 2 panele Aukcji, Absorpcja chowa CVD; Wielkie ręce — tylko 3 wskaźniki', () => {
    const st = stationById('auction-open');
    const auction = panelSetPanel(st, 'auction', 0, false);
    expect(auction).toEqual(stationPanel(st, 0, false));
    expect([auction.showVolume, auction.showDelta, auction.showCvd, auction.cvdReset]).toEqual([false, false, true, 'session']);
    expect(underPaneCount(auction)).toBe(3);
    const absorption = panelSetPanel(st, 'absorption', 0, false);
    expect(st.panelSets![1].patch).toEqual({ showCvd: false });
    expect([absorption.showCvd, absorption.indicators.map((x) => x.id), underPaneCount(absorption)]).toEqual([false, ['absorption', 'makers', 'ofi'], 3]);
    expect(parseSettings(absorption)).toEqual(absorption);
    expect(panelSetPanel(st, 'nie-ma', 0, false)).toEqual(stationPanel(st, 0, false));
    expect(panelSetPanel(stationById('cockpit'), 'absorption', 0, false)).toEqual(stationPanel(stationById('cockpit'), 0, false));
    const big = stationPanel(stationById('big-hands'), 0, false);
    expect([big.showVolume, big.showDelta, big.showCvd, underPaneCount(big)]).toEqual([false, false, false, 3]);
  });

  it('identyfikatory zestawów paneli w walidacji ustawień: te same co w układach; kolejność układów skrótów', () => {
    expect([...PANEL_SET_IDS].sort()).toEqual(STATIONS.flatMap((s) => s.panelSets?.map((p) => p.id) ?? []).sort());
    expect(LAYOUT_ORDER).toEqual(STATIONS.map((s) => s.id));
  });

  it('zestaw w użyciu: z ustawień, nieznany albo brak — pierwszy; układ bez zestawów — null', () => {
    const st = stationById('auction-open');
    const base = stationPanel(st, 0, false);
    expect(activePanelSet(st, base)?.id).toBe('auction');
    expect(activePanelSet(st, { ...base, panelSet: 'absorption' })?.id).toBe('absorption');
    expect(activePanelSet(st, { ...base, panelSet: 'nie-ma' })?.id).toBe('auction');
    expect(activePanelSet(stationById('cockpit'), { ...base, panelSet: 'absorption' })).toBeNull();
  });

  it('przełączenie zestawu: wskaźniki i łatka zestawu, zmiany użytkownika zostają', () => {
    const st = stationById('auction-open');
    for (const narrow of [false, true]) {
      const base = stationPanel(st, 0, narrow);
      // Wzorzec z pierwszym zestawem → drugi zestaw to dokładnie panelSetPanel
      expect(switchPanelSet(st, base, 'absorption', narrow)).toEqual({ ...panelSetPanel(st, 'absorption', 0, narrow), panelSet: 'absorption' });
      expect(switchPanelSet(st, switchPanelSet(st, base, 'absorption', narrow), 'auction', narrow)).toEqual({ ...base, panelSet: 'auction' });
    }
    // Zmiany użytkownika: rynek, interwał, warstwa, EMA na cenie i własny panel RSI zostają w obu zestawach
    const ema = inds(['ema'], ['rsi']);
    const user = { ...stationPanel(st, 0, false), coin: 'ETH' as const, interval: '15m', showVwap: true, indicators: [...stationPanel(st, 0, false).indicators, ...ema] };
    const abs = switchPanelSet(st, user, 'absorption', false);
    expect([abs.coin, abs.interval, abs.showVwap, abs.showCvd, abs.panelSet]).toEqual(['ETH', '15m', true, false, 'absorption']);
    expect(abs.indicators.map((x) => x.id)).toEqual(['ema', 'rsi', 'absorption', 'makers', 'ofi']);
    const back = switchPanelSet(st, abs, 'auction', false);
    expect([back.showCvd, back.panelSet, back.indicators.map((x) => x.id)]).toEqual([true, 'auction', ['ema', 'rsi', 'oiflow', 'breadth']]);
    // Wskaźnik zestawu dodany już przez użytkownika nie powtarza się
    const withOfi = { ...user, indicators: [...user.indicators, ...inds(['ofi'])] };
    expect(switchPanelSet(st, withOfi, 'absorption', false).indicators.filter((x) => x.id === 'ofi')).toHaveLength(1);
    // Ten sam albo nieznany zestaw, układ bez zestawów — bez zmian
    expect(switchPanelSet(st, abs, 'absorption', false)).toBe(abs);
    expect(switchPanelSet(st, abs, 'nie-ma', false)).toBe(abs);
    const cockpit = stationPanel(stationById('cockpit'), 0, false);
    expect(switchPanelSet(stationById('cockpit'), cockpit, 'absorption', false)).toBe(cockpit);
    expect(parseSettings(abs)).toEqual(abs);
  });

  it('Aukcja i otwarcie: dwa zestawy paneli, domyślny Aukcja', () => {
    const st = stationById('auction-open');
    expect(st.panelSets!.map((p) => p.id)).toEqual(['auction', 'absorption']);
    expect(st.panelSets!.map((p) => p.indicators.map((x) => x.id))).toEqual([
      ['oiflow', 'breadth'],
      ['absorption', 'makers', 'ofi'],
    ]);
    expect(stationPanel(st, 0, false).indicators).toEqual(st.panelSets![0].indicators);
  });

  it('panel spoza wzorca: wygląd pierwszego, wyższy interwał, bez tablicy i taśmy', () => {
    const s = stationPanel(stationById('cockpit'), 2, false);
    expect(s.interval).toBe('1h');
    expect(s.showHeatmap).toBe(true);
    expect([s.showStats, s.showTape]).toEqual([false, false]);
  });

  it('stare identyfikatory stacji prowadzą do nowych układów, nieznane — do Kokpitu', () => {
    expect(stationById('scalp').id).toBe('cockpit');
    expect(stationById('auction').id).toBe('day-map');
    expect(stationById('xyz').id).toBe('cockpit');
    expect(stationById(null).id).toBe('cockpit');
    expect(stationById('constructor').id).toBe('cockpit');
    for (const [old, now] of Object.entries(LEGACY_STATION)) expect(stationById(old).id, old).toBe(now);
    expect([stationIdOf('venues'), stationIdOf('big-hands'), stationIdOf('nie'), stationIdOf('toString'), stationIdOf(7)]).toEqual(['big-hands', 'big-hands', null, null, null]);
  });

  it('klucze zapisu: każdy układ pod swoim id, bez kluczy sprzed stacji', () => {
    expect(stationKey('cockpit', 0)).toBe('hq.charts.v1.cockpit');
    expect(stationKey('day-map', 1)).toBe('hq.charts.v1.day-map.p1');
    expect(stationKey('start', 0)).toBe('hq.charts.v1.start');
    for (const s of STATIONS) expect(stationKeys(s.id)).not.toContain('hq.charts.v1');
  });

  it('telefon: łatka NARROW_PATCH w każdym układzie', () => {
    for (const st of STATIONS) {
      const s = stationPanel(st, 0, true);
      for (const [k, v] of Object.entries(NARROW_PATCH)) expect(s[k as keyof typeof NARROW_PATCH], `${st.id} ${k}`).toBe(v);
    }
  });
});

describe('zapis układu', () => {
  const real = globalThis.localStorage;
  beforeEach(() => {
    globalThis.localStorage = memoryStorage();
  });
  afterEach(() => {
    globalThis.localStorage = real;
  });

  it('układ: wzorzec bez zapisu, potem wersja użytkownika; przywrócenie usuwa tylko ten układ', () => {
    const map = stationById('day-map');
    expect(loadStationLayout(map)).toBe(2);
    saveStationLayout('day-map', 4);
    expect(loadStationLayout(map)).toBe(4);
    localStorage.setItem(stationKey('day-map', 1), '{}');
    localStorage.setItem(stationKey('cockpit', 0), '{}');
    localStorage.setItem('hq.charts.v1', '{}');
    clearStation('day-map');
    expect(loadStationLayout(map)).toBe(2);
    expect(localStorage.getItem(stationKey('day-map', 1))).toBeNull();
    expect(localStorage.getItem(stationKey('cockpit', 0))).toBe('{}');
    expect(localStorage.getItem('hq.charts.v1')).toBe('{}');
  });

  it('karta: klucze zapisu pod jej id, układ z wzorca do pierwszego zapisu', () => {
    expect(stationKeys('k1')).toEqual(['hq.charts.v1.k1', 'hq.charts.v1.k1.p1', 'hq.charts.v1.k1.p2', 'hq.charts.v1.k1.p3', 'hq.charts.layout.v1.k1']);
    const map = stationById('day-map');
    expect(loadStationLayout(map, 'k1')).toBe(2);
    saveStationLayout('k1', 1);
    expect([loadStationLayout(map, 'k1'), loadStationLayout(map)]).toEqual([1, 2]);
  });
});
