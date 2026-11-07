import { describe, expect, it } from 'vitest';
import type { BlogMap, BlogMapsState } from '../../../state/useBlogMaps';
import type { Candle } from '../hl/parse';
import { DEFAULT_SETTINGS } from '../chart/settings';
import { LAYERS_OFF } from '../chart/templates';
import { fmtPx } from '../chart/layout';
import { blogMapMarks, blogMapModel } from '../chart/blogMapLayer';
import { LAYER_SOURCE, WAIT_TEXT, blogMapScan, layerBadge, legendChips } from '../chart/layerSources';
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

  it('poza Rozliczeniem bez znaczników i bez pobierania świec 1m', () => {
    let asked = 0;
    expect(
      blogMapMarks(
        MAP,
        () => {
          asked++;
          return candles;
        },
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
      true
    );
    expect(from).toBe(PUB);
    expect(r.note).toBeNull();
    expect(r.settled!.map((x) => [x.label, x.touchedAt])).toEqual([
      ['PDL', null],
      ['Szczyt Azji', TODAY + 9 * H + 31 * MIN],
      ['VWAP dnia', TODAY + 7 * H + 13 * MIN],
    ]);
  });

  it('mapa weekendu albo tygodnia (bez okna): bez znaczników, z uwagą „bez rozliczenia”', () => {
    expect(blogMapMarks({ ...MAP, kind: 'inne' }, () => candles, true)).toEqual({ settled: null, note: 'bez rozliczenia' });
  });

  it('świece 1m jeszcze nie sięgają wpisu: bez znaczników (brak ✓ nie znaczy „nie dotknięto”), z uwagą o czekaniu', () => {
    const r = blogMapMarks(MAP, () => flat(TODAY + 8 * H, 60, 75_800, 76_000), true);
    expect(r).toEqual({ settled: null, note: 'czekam na świece 1m' });
    expect(blogMapMarks(MAP, () => [], true)).toEqual({ settled: null, note: 'czekam na świece 1m' });
    // Pierwsza świeca w oknie to minuta po wpisie (07:13): świeca 07:12 zaczęła się przed wpisem i nie jest potrzebna
    expect(blogMapMarks(MAP, () => flat(TODAY + 7 * H + 13 * MIN, 60, 75_800, 76_000), true).settled).not.toBeNull();
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
