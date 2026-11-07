import { describe, expect, it } from 'vitest';
import type { BlogMap, BlogMapsState } from '../../../state/useBlogMaps';
import type { Candle } from '../hl/parse';
import { DEFAULT_SETTINGS } from '../chart/settings';
import { LAYERS_OFF } from '../chart/templates';
import { fmtPx } from '../chart/layout';
import { blogEdgeTags, blogMapMarks, blogMapModel, levelsDrawn, levelsInsteadOfMap, levelsLegend } from '../chart/blogMapLayer';
import { priceLayerCount, stationById, stationPanel } from '../chart/stations';
import { LAYER_SOURCE, WAIT_TEXT, blogMapScan, layerBadge, legendChips } from '../chart/layerSources';
import { TAG_H, edgeTagsIn, placeTags } from '../chart/overlay';
import { PRO } from '../chart/theme';
import { fmtDayTime, fmtDm, fmtHm } from '../core/time';

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
const TODAY = Date.UTC(2026, 10, 7);
const PUB = TODAY + 7 * H + 12 * MIN + 20_000;
// Pół godziny po wpisie: ten sam dzień lokalny w każdej strefie czasowej
const NOW = PUB + 30 * MIN;

const MAP: BlogMap = {
  id: '2026-11-07-mapa-dnia',
  title: 'BTC 75 696 przed Londynem',
  kind: 'dzien',
  publishedAt: PUB,
  price: 75_696,
  levels: [
    { label: 'PDL', price: 75_189 },
    { label: 'Szczyt Azji', price: 76_400, note: 'z nocy' },
    { label: 'VWAP dnia', price: 75_896 },
  ],
  url: 'blog/2026-11-07-mapa-dnia/',
};
const NO_MARKS = { settled: null, note: null };

describe('model warstwy mapy z bloga', () => {
  it('poziomy od najwyższej ceny z podpisem autora i ceną; jedna etykieta z rodzajem mapy i godziną wpisu', () => {
    const m = blogMapModel(MAP, { now: NOW, marks: NO_MARKS });
    expect(m.levels.map((l) => l.price)).toEqual([76_400, 75_896, 75_189]);
    expect(m.levels.map((l) => l.text)).toEqual([`Szczyt Azji ${fmtPx(76_400)}`, `VWAP dnia ${fmtPx(75_896)}`, `PDL ${fmtPx(75_189)}`]);
    expect(m.levels.every((l) => !l.touched)).toBe(true);
    expect(m.tag).toBe(`Mapa dnia ${fmtHm(PUB)}`);
  });

  it('mapa z innego dnia: data przy godzinie; inne rodzaje map mają własną nazwę', () => {
    expect(blogMapModel(MAP, { now: NOW + 2 * DAY, marks: NO_MARKS }).tag).toBe(`Mapa dnia ${fmtDm(PUB)} ${fmtHm(PUB)}`);
    expect(fmtDayTime(PUB, NOW)).toBe(fmtHm(PUB));
    expect(fmtDayTime(PUB, NOW + 2 * DAY)).toBe(`${fmtDm(PUB)} ${fmtHm(PUB)}`);
    const tag = (kind: BlogMap['kind']) => blogMapModel({ ...MAP, kind }, { now: NOW, marks: NO_MARKS }).tag;
    expect(tag('ny')).toBe(`Mapa przed NY ${fmtHm(PUB)}`);
    expect(tag('otwarcie')).toBe(`Otwarcie sesji ${fmtHm(PUB)}`);
    expect(tag('aktualizacja')).toBe(`Aktualizacja ${fmtHm(PUB)}`);
    expect(tag('inne')).toBe(`Mapa z bloga ${fmtHm(PUB)}`);
  });

  it('rozliczenie: poziom dotknięty ma „✓ HH:MM” i jest wyróżniony, niedotknięty bez znacznika; uwaga w etykiecie mapy', () => {
    const t1 = TODAY + 9 * H + 31 * MIN;
    const settled = [
      { label: 'PDL', price: 75_189, touchedAt: null },
      { label: 'Szczyt Azji', price: 76_400, touchedAt: t1 },
      { label: 'VWAP dnia', price: 75_896, touchedAt: null },
    ];
    const m = blogMapModel(MAP, { now: NOW, marks: { settled, note: null } });
    expect(m.levels[0]).toEqual({ price: 76_400, text: `Szczyt Azji ${fmtPx(76_400)} ✓ ${fmtHm(t1)}`, touched: true });
    expect(m.levels[2]).toEqual({ price: 75_189, text: `PDL ${fmtPx(75_189)}`, touched: false });
    expect(blogMapModel(MAP, { now: NOW, marks: { settled: null, note: 'bez rozliczenia' } }).tag).toBe(`Mapa dnia ${fmtHm(PUB)} · bez rozliczenia`);
  });
});

/** Świece 1m od `from` przez `n` minut w zakresie [lo, hi]. */
const flat = (from: number, n: number, lo: number, hi: number): Candle[] => Array.from({ length: n }, (_, i) => ({ t: from + i * MIN, o: lo, h: hi, l: lo, c: hi, v: 1, n: 1 }));

describe('blogMapMarks: znaczniki dotknięcia tylko w układzie Rozliczenie', () => {
  // Od 07:00 do 10:00 zakres 75 800–76 000, o 09:31 świeca do 76 450; przed wpisem (07:05) świeca do 75 100 — przed wpisem się nie liczy
  const candles = flat(TODAY + 7 * H, 180, 75_800, 76_000).map((c) =>
    c.t === TODAY + 9 * H + 31 * MIN ? { ...c, h: 76_450 } : c.t === TODAY + 7 * H + 5 * MIN ? { ...c, l: 75_100 } : c
  );

  // Chwila wykresu 10:00:30: ostatnia pełna minuta to 09:59, świece sięgają do niej bez przerw
  const T10 = TODAY + 10 * H + 30_000;
  const touches = (r: ReturnType<typeof blogMapMarks>) => r.settled!.map((x) => [x.label, x.touchedAt]);

  it('poza Rozliczeniem bez znaczników i bez pobierania świec 1m', () => {
    let asked = 0;
    expect(
      blogMapMarks(
        MAP,
        () => {
          asked++;
          return candles;
        },
        T10,
        false
      )
    ).toEqual(NO_MARKS);
    expect(asked).toBe(0);
  });

  it('dotknięcie w oknie mapy (od wpisu do końca sesji NY): minuta pierwszej świecy 1m, kolejność poziomów z mapy', () => {
    let from = 0;
    const r = blogMapMarks(
      MAP,
      (f) => {
        from = f;
        return candles;
      },
      T10,
      true
    );
    expect(from).toBe(PUB);
    expect(r.note).toBeNull();
    expect(touches(r)).toEqual([
      ['PDL', null],
      ['Szczyt Azji', TODAY + 9 * H + 31 * MIN],
      ['VWAP dnia', TODAY + 7 * H + 13 * MIN],
    ]);
  });

  it('mapa weekendu albo tygodnia (bez okna): bez znaczników, z uwagą „bez rozliczenia”', () => {
    expect(blogMapMarks({ ...MAP, kind: 'inne' }, () => candles, T10, true)).toEqual({ settled: null, note: 'bez rozliczenia' });
  });

  it('świece 1m jeszcze nie sięgają wpisu: bez znaczników (brak ✓ nie znaczy „nie dotknięto”), z uwagą o czekaniu', () => {
    const r = blogMapMarks(MAP, () => flat(TODAY + 8 * H, 60, 75_800, 76_000), T10, true);
    expect(r).toEqual({ settled: null, note: 'czekam na świece 1m' });
    expect(blogMapMarks(MAP, () => [], T10, true)).toEqual({ settled: null, note: 'czekam na świece 1m' });
    // Pierwsza świeca w oknie to minuta po wpisie (07:13): świeca 07:12 zaczęła się przed wpisem i nie jest potrzebna;
    // świece 07:13–08:12 bez przerw do ostatniej pełnej minuty przed 08:13:30
    const r2 = blogMapMarks(MAP, () => flat(TODAY + 7 * H + 13 * MIN, 60, 75_800, 76_000), TODAY + 8 * H + 13 * MIN + 30_000, true);
    expect([r2.settled === null, r2.note]).toEqual([false, null]);
  });

  it('luka w świecach w środku okna: dotknięcia znalezione zostają, reszta nierozliczona, jedna uwaga w etykiecie', () => {
    // Brak świec 08:00–08:09; PDL dotknięty tylko w luce (o 08:05, tej świecy nie ma) — bez ✓, uwaga mówi, że to nie „nie dotknięto”
    const withPdl = candles.map((c) => (c.t === TODAY + 8 * H + 5 * MIN ? { ...c, l: 75_100 } : c));
    expect(touches(blogMapMarks(MAP, () => withPdl, T10, true))[0]).toEqual(['PDL', TODAY + 8 * H + 5 * MIN]);
    const gap = withPdl.filter((c) => c.t < TODAY + 8 * H || c.t >= TODAY + 8 * H + 10 * MIN);
    const r = blogMapMarks(MAP, () => gap, T10, true);
    expect(r.note).toBe('luka w świecach 1m');
    expect(touches(r)).toEqual([
      ['PDL', null],
      ['Szczyt Azji', TODAY + 9 * H + 31 * MIN],
      ['VWAP dnia', TODAY + 7 * H + 13 * MIN],
    ]);
    expect(blogMapModel(MAP, { now: NOW, marks: r }).tag).toBe(`Mapa dnia ${fmtHm(PUB)} · luka w świecach 1m`);
  });

  it('świece kończą się przed chwilą wykresu (nieaktualny koniec): uwaga o luce, dotknięcia sprzed końca zostają', () => {
    // Świece do 09:00, chwila wykresu 10:00:30 — minuty 09:01–09:59 brakują (dotknięcie szczytu o 09:31 jest w tej części)
    const stale = candles.filter((c) => c.t <= TODAY + 9 * H);
    const r = blogMapMarks(MAP, () => stale, T10, true);
    expect(r.note).toBe('luka w świecach 1m');
    expect(touches(r)).toEqual([
      ['PDL', null],
      ['Szczyt Azji', null],
      ['VWAP dnia', TODAY + 7 * H + 13 * MIN],
    ]);
    // Świeca bieżącej, niepełnej minuty nie jest wymagana: chwila 09:01:20, świece do 09:00 — bez uwagi
    expect(blogMapMarks(MAP, () => stale, TODAY + 9 * H + MIN + 20_000, true).note).toBeNull();
  });

  it('świece późniejsze niż chwila wykresu (powtórka) się nie liczą', () => {
    // Chwila 09:00:30: dotknięcie szczytu o 09:31 jeszcze się nie wydarzyło
    const r = blogMapMarks(MAP, () => candles, TODAY + 9 * H + 30_000, true);
    expect(r.note).toBeNull();
    expect(touches(r)).toEqual([
      ['PDL', null],
      ['Szczyt Azji', null],
      ['VWAP dnia', TODAY + 7 * H + 13 * MIN],
    ]);
  });
});

describe('podpisy mapy przy prawej krawędzi razem z etykietami wskaźników', () => {
  const PANE_H = 300;
  const model = blogMapModel(MAP, { now: NOW, marks: { settled: [{ label: 'PDL', price: 75_189, touchedAt: null }, { label: 'Szczyt Azji', price: 76_400, touchedAt: NOW }, { label: 'VWAP dnia', price: 75_896, touchedAt: null }], note: null } });
  const edge = blogEdgeTags(model);
  /** Cena → y panelu: 76 400 → 60, 75 896 → 160,8, 75 189 → 302,2 (pod panelem). */
  const Y = (p: number) => (76_700 - p) / 5;
  const gaps = (ys: number[]) => ys.slice(1).map((y, i) => y - ys[i]);

  it('podpis każdego widocznego poziomu (pasek w kolorze mapy, tekst w kolorze tuszu) i etykieta mapy tuż nad najwyższym', () => {
    expect(edge.color).toBe(PRO.blogMap);
    const tags = edgeTagsIn(edge, Y, PANE_H);
    expect(tags.map((t) => [t.text, t.y])).toEqual([
      [model.tag, 60 - (TAG_H + 1)],
      [model.levels[0].text, 60],
      [model.levels[1].text, 160.8],
    ]);
    expect(tags.every((t) => t.color === PRO.blogMap)).toBe(true);
    // Etykieta mapy i dotknięty poziom jaśniejszym tuszem
    expect(tags.map((t) => t.ink)).toEqual([PRO.ink1, PRO.ink1, PRO.ink2]);
    // Żaden poziom w widoku — nic, także bez etykiety mapy
    expect(edgeTagsIn(edge, (p) => Y(p) + 1_000, PANE_H)).toEqual([]);
  });

  it('rozsunięcie razem z etykietami wskaźników: bez nakładania, nigdy poza widoczną częścią panelu', () => {
    // Poziomy przy dolnej krawędzi (296, 298) i etykieta VWAP z nakładki na 294; najwyższy poziom przy górnej krawędzi
    const near = (p: number) => (p > 76_000 ? 2 : p > 75_500 ? 296 : 298);
    const all = [...edgeTagsIn({ ...edge, items: [...edge.items, { price: 75_000, text: 'x', ink: PRO.ink2 }] }, near, PANE_H), { y: 294, text: 'VWAP', color: PRO.vwap }];
    const { tags, ys } = placeTags(all, PANE_H);
    expect(tags.length).toBe(6);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(TAG_H / 2);
    expect(Math.max(...ys)).toBeLessThanOrEqual(PANE_H - TAG_H / 2);
    expect(Math.min(...gaps(ys))).toBeGreaterThanOrEqual(TAG_H + 1);
    // Etykieta mapy (przyciśnięta do górnej granicy) zostaje nad najwyższym poziomem
    expect(tags.map((t) => t.text).slice(0, 2)).toEqual([model.tag, model.levels[0].text]);
    // Podpis spoza panelu (y > H) odpada przed rozsunięciem
    expect(placeTags([{ y: PANE_H + 5, text: 'poza', color: PRO.blogMap }], PANE_H).tags).toEqual([]);
  });
});

describe('plakietka mapy z bloga w legendzie', () => {
  const ready = (maps: BlogMap[]): BlogMapsState => ({ status: 'ready', maps });

  it('źródło LIVE: tekst autora z bloga, w podpowiedzi „nie model” i godzina wpisu', () => {
    expect(LAYER_SOURCE.showBlogMap).toBe('LIVE');
    const b = layerBadge('showBlogMap', { coin: 'BTC', now: NOW, scan: { asOf: PUB } });
    expect([b.tone, b.text]).toEqual(['live', 'LIVE']);
    expect(b.hint).toMatch(/^LIVE: mapa autora z bloga/);
    expect(b.hint).toContain('nie model HyperQuant');
    expect(b.hint).toContain(fmtHm(PUB));
  });

  it('stan pliku: wczytywanie, brak map, brak Mapy dnia z dziś — „—” z powodem; wybrana mapa — chwila wpisu', () => {
    expect(blogMapScan({ status: 'loading', maps: [] }, null)).toEqual({ why: WAIT_TEXT });
    expect(blogMapScan({ status: 'missing', maps: [] }, null)).toEqual({ why: 'Brak map z bloga' });
    expect(blogMapScan(ready([]), null)).toMatchObject({ why: expect.stringContaining('Mapy dnia') });
    expect(blogMapScan(ready([MAP]), MAP)).toEqual({ asOf: PUB });
    const why = layerBadge('showBlogMap', { coin: 'BTC', now: NOW, scan: blogMapScan({ status: 'missing', maps: [] }, null) });
    expect([why.tone, why.text, why.hint]).toEqual(['stale', '—', 'Brak map z bloga']);
  });

  it('poza BTC: „—, tylko BTC”', () => {
    expect(layerBadge('showBlogMap', { coin: 'ETH', now: NOW, scan: { asOf: PUB } })).toMatchObject({ tone: 'neutral', text: '—, tylko BTC' });
  });

  it('legendChips: „Mapa z bloga” na interwałach poniżej 1D', () => {
    const s = { ...DEFAULT_SETTINGS, ...LAYERS_OFF, showBlogMap: true };
    const chips = legendChips(s, { coin: 'BTC', now: NOW, intervalMs: 30 * MIN, scan: { showBlogMap: { asOf: PUB } } });
    expect(chips.map((c) => [c.key, c.label, c.text])).toEqual([['showBlogMap', 'Mapa z bloga', 'LIVE']]);
    expect(legendChips(s, { coin: 'BTC', now: NOW, intervalMs: DAY, scan: {} })).toEqual([]);
  });
});

describe('poziomy dnia w zastępstwie mapy z bloga (weekend, rano przed wpisem, inny rynek)', () => {
  const dayMap = stationPanel(stationById('day-map'), 1, false);
  const review = stationPanel(stationById('review'), 0, false);
  const READY: BlogMapsState['status'] = 'ready';

  it('wzorce z mapą zamiast poziomów dnia: bez mapy na wykresie — PDH i PDL; z mapą — sama mapa', () => {
    for (const [name, p] of [
      ['day-map 30m', dayMap],
      ['day-map telefon', stationPanel(stationById('day-map'), 0, true)],
      ['review', review],
      ['review telefon', stationPanel(stationById('review'), 0, true)],
    ] as const) {
      expect([p.showBlogMap, p.showLevels], name).toEqual([true, false]);
      expect(levelsInsteadOfMap(p, 'BTC', READY, null), name).toBe(true);
      expect(levelsInsteadOfMap(p, 'BTC', 'missing', null), name).toBe(true);
      expect(levelsInsteadOfMap(p, 'BTC', READY, MAP), name).toBe(false);
      // Inny rynek: mapy z bloga są tylko o BTC
      expect(levelsInsteadOfMap(p, 'ETH', 'loading', null), name).toBe(true);
      // Plik map w drodze: jeszcze bez poziomów (bez mignięcia przed mapą)
      expect(levelsInsteadOfMap(p, 'BTC', 'loading', null), name).toBe(false);
      // Rysunek zamienia warstwę na warstwę: liczba warstw ceny bez zmian (mapa i poziomy nigdy razem)
      expect(priceLayerCount(levelsDrawn(p, true)), name).toBe(priceLayerCount(p));
      expect(priceLayerCount(levelsDrawn(p, true)), name).toBeLessThanOrEqual(5);
      expect(levelsDrawn(p, true), name).toMatchObject({ showLevels: true, showBlogMap: false });
      expect(levelsDrawn(p, false), name).toBe(p);
    }
  });

  it('poza tymi wzorcami bez zmian: poziomy już włączone albo mapa wyłączona', () => {
    expect(levelsInsteadOfMap({ showLevels: true, showBlogMap: true }, 'BTC', READY, null)).toBe(false);
    expect(levelsInsteadOfMap({ showLevels: false, showBlogMap: false }, 'BTC', READY, null)).toBe(false);
    expect(levelsInsteadOfMap(stationPanel(stationById('day-map'), 0, false), 'BTC', READY, null)).toBe(false);
  });

  it('legenda: przy zastępstwie plakietka poziomów dnia i mapa „—” z powodem', () => {
    const chips = legendChips(levelsLegend(dayMap, true), { coin: 'BTC', now: NOW, intervalMs: 30 * MIN, scan: { showBlogMap: blogMapScan({ status: 'ready', maps: [] }, null) } });
    expect(chips.filter((c) => c.key === 'showLevels' || c.key === 'showBlogMap').map((c) => [c.key, c.text])).toEqual([
      ['showLevels', 'LIVE'],
      ['showBlogMap', '—'],
    ]);
    expect(legendChips(levelsLegend(dayMap, false), { coin: 'BTC', now: NOW, intervalMs: 30 * MIN, scan: {} }).some((c) => c.key === 'showLevels')).toBe(false);
  });
});
