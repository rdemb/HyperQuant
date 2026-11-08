import { describe, expect, it, vi } from 'vitest';
import { BLOG_MAPS_URL, type BlogMap, type BlogMapsState, fetchBlogMaps, nextBlogMaps, parseBlogMaps, pickMap } from '../useBlogMaps';

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
const TODAY = Date.UTC(2026, 10, 7);
const NOW = TODAY + 10 * H;

const map = (id: string, kind: BlogMap['kind'], publishedAt: number): BlogMap => ({
  id,
  title: `Wpis ${id}`,
  kind,
  publishedAt,
  price: 75_000,
  levels: [{ label: 'PDH', price: 76_000 }],
  url: `blog/${id}/`,
});

describe('pickMap: domyślnie najnowsza „Mapa dnia” z bieżącej doby UTC', () => {
  it('wybiera najnowszą Mapę dnia z dzisiejszej doby, nie nowszy wpis innego rodzaju; kolejność w pliku bez znaczenia', () => {
    const maps = [
      map('2026-11-07-aktualizacja-08', 'aktualizacja', TODAY + 8 * H),
      map('2026-11-07-mapa-dnia-2', 'dzien', TODAY + 7.5 * H),
      map('2026-11-07-mapa-dnia', 'dzien', TODAY + 7 * H),
      map('2026-11-06-mapa-dnia', 'dzien', TODAY - 17 * H),
    ];
    expect(pickMap(maps, NOW)?.id).toBe('2026-11-07-mapa-dnia-2');
    expect(pickMap([...maps].reverse(), NOW)?.id).toBe('2026-11-07-mapa-dnia-2');
  });

  it('bez Mapy dnia z bieżącej doby — null (bez sięgania po wczorajszą)', () => {
    const maps = [map('2026-11-07-otwarcie-londynu', 'otwarcie', TODAY + 8 * H), map('2026-11-06-mapa-dnia', 'dzien', TODAY - 17 * H)];
    expect(pickMap(maps, NOW)).toBeNull();
    expect(pickMap([], NOW)).toBeNull();
  });

  it('mapa sprzed 2 dni nie jest wybierana domyślnie', () => {
    expect(pickMap([map('2026-11-05-mapa-dnia', 'dzien', TODAY - 2 * DAY + 7 * H)], NOW)).toBeNull();
  });

  it('granice doby UTC: 00:00 dziś tak, minuta przed północą nie; wpis późniejszy niż chwila wykresu (powtórka) nie', () => {
    expect(pickMap([map('2026-11-07-mapa-dnia', 'dzien', TODAY)], NOW)?.id).toBe('2026-11-07-mapa-dnia');
    expect(pickMap([map('2026-11-06-mapa-dnia', 'dzien', TODAY - MIN)], NOW)).toBeNull();
    expect(pickMap([map('2026-11-07-mapa-dnia', 'dzien', NOW + MIN)], NOW)).toBeNull();
  });

  it('wybór ręczny: znany identyfikator daje tę mapę (każdy rodzaj, także starszą), nieznany — wybór domyślny', () => {
    const maps = [
      map('2026-11-07-mapa-dnia', 'dzien', TODAY + 7 * H),
      map('2026-11-06-mapa-przed-nowym-jorkiem', 'ny', TODAY - 10 * H),
      map('2026-11-05-mapa-na-weekend', 'inne', TODAY - 40 * H),
    ];
    expect(pickMap(maps, NOW, '2026-11-05-mapa-na-weekend')?.id).toBe('2026-11-05-mapa-na-weekend');
    expect(pickMap(maps, NOW, '2026-11-06-mapa-przed-nowym-jorkiem')?.kind).toBe('ny');
    expect(pickMap(maps, NOW, '2026-11-01-nie-ma')?.id).toBe('2026-11-07-mapa-dnia');
    expect(pickMap(maps, NOW)?.id).toBe('2026-11-07-mapa-dnia');
    // Wybrana mapa opublikowana po chwili wykresu (powtórka) liczy się jak nieznana: domyślna z tej doby jeszcze nie istnieje
    expect(pickMap(maps, TODAY + 6 * H, '2026-11-07-mapa-dnia')).toBeNull();
  });
});

const FILE = {
  v: 1,
  asOf: NOW,
  maps: [
    {
      id: '2026-11-06-mapa-dnia',
      title: 'BTC 75 696 po spadku o 6,41%',
      kind: 'dzien',
      publishedAt: TODAY - 17 * H,
      price: 75_696,
      levels: [
        { label: 'Szczyt Azji', price: 76_400 },
        { label: 'PDL', price: 75_189, note: 'wczoraj' },
      ],
      url: 'blog/2026-11-06-mapa-dnia/',
    },
    {
      id: '2026-11-07-mapa-dnia',
      title: 'BTC 74 900 przed Londynem',
      kind: 'dzien',
      publishedAt: TODAY + 7 * H,
      price: 74_900,
      levels: [{ label: 'VWAP dnia', price: 75_000 }],
      url: 'blog/2026-11-07-mapa-dnia/',
    },
  ],
};

describe('parseBlogMaps: plik map z bloga (v 1)', () => {
  it('poprawny plik: mapy od najnowszej, poziomy z notatką autora', () => {
    const maps = parseBlogMaps(FILE)!;
    expect(maps.map((m) => m.id)).toEqual(['2026-11-07-mapa-dnia', '2026-11-06-mapa-dnia']);
    expect(maps[1]).toEqual(FILE.maps[0]);
    expect(parseBlogMaps({ v: 1, asOf: NOW, maps: [] })).toEqual([]);
  });

  it('błędne wpisy i poziomy odpadają pojedynczo; mapa bez poprawnych poziomów odpada', () => {
    const good = FILE.maps[0];
    const raw = {
      v: 1,
      asOf: NOW,
      maps: [
        good,
        { ...good, id: '2026-11-06-rodzaj', kind: 'tydzien' },
        { ...good, id: 'mapa-dnia' },
        { ...good, id: '2026-11-06-czas', publishedAt: Number.NaN },
        { ...good, id: '2026-11-06-cena', price: 0 },
        { ...good, id: '2026-11-06-tytul', title: 7 },
        { ...good, id: '2026-11-06-bez-poziomow', levels: 'x' },
        { ...good, id: '2026-11-06-zle-poziomy', levels: [{ label: '', price: 75_000 }, { label: 'PDH', price: -1 }, null] },
        {
          ...good,
          id: '2026-11-06-czesc-poziomow',
          levels: [{ label: 'PDH', price: Number.POSITIVE_INFINITY }, { label: 'PDL', price: 75_189, note: 5 }, { label: 'VAL', price: 75_202 }],
        },
        'x',
        null,
      ],
    };
    const maps = parseBlogMaps(raw)!;
    expect(maps.map((m) => m.id)).toEqual(['2026-11-06-mapa-dnia', '2026-11-06-czesc-poziomow']);
    // Notatka nie-tekstowa odpada, poziom zostaje
    expect(maps[1].levels).toEqual([
      { label: 'PDL', price: 75_189 },
      { label: 'VAL', price: 75_202 },
    ]);
  });

  it('zły format pliku → null', () => {
    for (const bad of [null, 'x', 7, {}, { v: 2, maps: [] }, { v: 1, maps: 'x' }, [FILE]]) expect(parseBlogMaps(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe('pobieranie maps.json z tej samej domeny co aplikacja', () => {
  const json = (body: unknown, status = 200, type = 'application/json') => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } });

  it('czyta ./blog/maps.json bez pamięci podręcznej przeglądarki', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => json(FILE));
    expect(BLOG_MAPS_URL).toBe('./blog/maps.json');
    expect((await fetchBlogMaps(f))?.map((m) => m.id)).toEqual(['2026-11-07-mapa-dnia', '2026-11-06-mapa-dnia']);
    expect(f.mock.calls[0][0]).toBe('./blog/maps.json');
    expect(f.mock.calls[0][1]?.cache).toBe('no-cache');
  });

  it('404, strona HTML zamiast pliku (np. npm run dev), zły plik albo błąd sieci → null', async () => {
    expect(await fetchBlogMaps(async () => json('nie ma', 404, 'text/plain'))).toBeNull();
    expect(await fetchBlogMaps(async () => json('<!doctype html><html></html>', 200, 'text/html'))).toBeNull();
    expect(await fetchBlogMaps(async () => json({ v: 9 }))).toBeNull();
    expect(
      await fetchBlogMaps(async () => {
        throw new TypeError('offline');
      })
    ).toBeNull();
  });
});

describe('stan map z bloga', () => {
  it('pierwsze pobranie: ready z mapami albo missing; nieudane odświeżenie zostawia poprzednie mapy', () => {
    const m = map('2026-11-07-mapa-dnia', 'dzien', TODAY + 7 * H);
    const loading: BlogMapsState = { status: 'loading', maps: [] };
    expect(nextBlogMaps(loading, null)).toEqual({ status: 'missing', maps: [] });
    const ready = nextBlogMaps(loading, [m]);
    expect(ready).toEqual({ status: 'ready', maps: [m] });
    expect(nextBlogMaps(ready, null)).toBe(ready);
    expect(nextBlogMaps({ status: 'missing', maps: [] }, [m])).toEqual({ status: 'ready', maps: [m] });
    // Blog bez map z ostatnich 3 dni: plik jest, map nie ma
    expect(nextBlogMaps(ready, [])).toEqual({ status: 'ready', maps: [] });
  });

  it('bez zmian ten sam obiekt stanu (bez odświeżania wykresów co 10 min): kolejny brak pliku i ten sam plik', () => {
    const m = map('2026-11-07-mapa-dnia', 'dzien', TODAY + 7 * H);
    const missing = nextBlogMaps({ status: 'loading', maps: [] }, null);
    expect(nextBlogMaps(missing, null)).toBe(missing);
    const ready = nextBlogMaps(missing, [m]);
    // Ten sam plik pobrany ponownie (nowe obiekty z tą samą treścią)
    expect(nextBlogMaps(ready, [structuredClone(m)])).toBe(ready);
    // Zmieniona treść — nowy stan
    const moved = nextBlogMaps(ready, [{ ...m, levels: [{ label: 'PDH', price: 76_100 }] }]);
    expect(moved).not.toBe(ready);
    expect(moved.maps[0].levels[0].price).toBe(76_100);
  });
});

describe('podział: czyste funkcje map w src/utils/blogMaps.ts, hook z Reactem osobno', () => {
  it('hook re-eksportuje te same funkcje i adres pliku; moduł utils nie importuje Reacta (bundle serwera MCP z niego korzysta)', async () => {
    const utils = await import('../../utils/blogMaps');
    expect(parseBlogMaps).toBe(utils.parseBlogMaps);
    expect(pickMap).toBe(utils.pickMap);
    expect(nextBlogMaps).toBe(utils.nextBlogMaps);
    expect(BLOG_MAPS_URL).toBe(utils.BLOG_MAPS_URL);
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../utils/blogMaps.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from ['"]react/);
    expect(src).not.toMatch(/from ['"][./]*state\//);
  });
});
