import { afterEach, describe, expect, it } from 'vitest';
import type { Envelope, Num } from '../src/envelope';
import { Sources } from '../src/sources';
import { DISCLAIMER } from '../src/envelope';
import { HL_INFO, MAPS_URL, MIN, type Route, connect, flatBars, hlRoute, testSources } from './helpers';

// Środa 4.11.2026, 15:00 UTC (sesja NY w toku); Mapa dnia wyszła o 07:00 UTC
const NOW = Date.UTC(2026, 10, 4, 15, 0);
const PUB = Date.UTC(2026, 10, 4, 7, 0);
const TOUCH = Date.UTC(2026, 10, 4, 10, 30);
const ADDR = '0x' + 'a'.repeat(40);

interface DayMapData {
  map: {
    id: string;
    kind: string;
    publishedAt: string;
    postUrl: string;
    levels: { label: string; price: Num; touched: boolean | null; touchedAt: string | null }[];
  } | null;
  why: string | null;
  coverage: Num;
}

function mapsFile(labels: [string, string] = ['opór', 'wsparcie']) {
  return {
    json: {
      v: 1,
      asOf: PUB + MIN,
      maps: [
        {
          id: '2026-11-04-mapa-dnia',
          title: 'Mapa dnia',
          kind: 'dzien',
          publishedAt: PUB,
          price: 80_000,
          levels: [
            { label: labels[0], price: 80_500 },
            { label: labels[1], price: 79_000 },
          ],
          url: 'blog/2026-11-04-mapa-dnia/',
        },
      ],
    },
  };
}

// Kanał 79 900–80 100 od wpisu do teraz; o 10:30 jedna świeca sięga 80 600 (dotyka poziomu 80 500)
const BARS = flatBars(PUB, NOW, 79_900, 80_100, { [TOUCH]: { h: 80_600 } });

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

async function call(src: Sources) {
  const c = await connect(src);
  close = c.close;
  const res = await c.client.callTool({ name: 'day_map', arguments: {} });
  return { res, env: res.structuredContent as unknown as Envelope<DayMapData> | undefined, client: c.client };
}

const run = (routes: Record<string, Route>) => call(testSources(routes, NOW).src);

describe('day_map', () => {
  it('tools/list zawiera day_map z tytułem i opisem', async () => {
    const c = await connect(testSources({}, NOW).src);
    close = c.close;
    const { tools } = await c.client.listTools();
    const t = tools.find((x) => x.name === 'day_map');
    expect(t).toBeDefined();
    expect(t?.description).toBeTruthy();
  });

  it('mapa z dwoma poziomami: dotknięty ma touched:true i touchedAt ISO, drugi false; pokrycie 100%', async () => {
    const { res, env } = await run({ [MAPS_URL]: mapsFile(), [HL_INFO]: hlRoute(BARS) });
    expect(res.isError).toBeFalsy();
    expect(env?.disclaimer).toBe(DISCLAIMER);
    expect(env?.tool).toBe('day_map');
    expect(env?.asOf).toBe('2026-11-04T15:00:00.000Z');
    const m = env?.data.map;
    expect(m).toMatchObject({ id: '2026-11-04-mapa-dnia', kind: 'dzien', publishedAt: '2026-11-04T07:00:00.000Z', postUrl: 'https://hyperquant.tech/blog/2026-11-04-mapa-dnia/' });
    expect(m?.levels).toHaveLength(2);
    const [hit, miss] = m!.levels;
    expect(hit).toMatchObject({ label: 'opór', touched: true, touchedAt: '2026-11-04T10:30:00.000Z' });
    expect(hit.price).toMatchObject({ value: 80_500, unit: 'price', badge: 'LIVE' });
    expect(miss).toMatchObject({ label: 'wsparcie', touched: false, touchedAt: null });
    expect(env?.data.coverage).toMatchObject({ value: 100, unit: 'pct', badge: 'LIVE' });
    expect(env?.data.why).toBeNull();
    expect(env?.sources.map((s) => s.url)).toEqual([MAPS_URL, HL_INFO]);
    expect(env?.sources.every((s) => s.asOf === null || s.asOf.endsWith('Z'))).toBe(true);
  });

  it('luka w świecach 1m: dotknięcie zostaje, brak dotknięcia to null (nie false), pokrycie < 100 z uwagą', async () => {
    const gap = BARS.filter((b) => b.t < Date.UTC(2026, 10, 4, 12, 0) || b.t >= Date.UTC(2026, 10, 4, 12, 10));
    const { res, env } = await run({ [MAPS_URL]: mapsFile(), [HL_INFO]: hlRoute(gap) });
    expect(res.isError).toBeFalsy();
    expect(env?.data.map?.levels.map((l) => l.touched)).toEqual([true, null]);
    expect(env?.data.why).toBeTruthy();
    const cov = env?.data.coverage;
    // 480 pełnych minut 07:00–14:59, bez 10 — 470/480 = 97,9% (w dół)
    expect(cov).toMatchObject({ value: 97.9, unit: 'pct', badge: 'LIVE' });
    expect(cov?.note).toBeTruthy();
  });

  it('brak maps.json (404): map null z powodem, bez isError', async () => {
    const { res, env } = await run({ [HL_INFO]: hlRoute(BARS) });
    expect(res.isError).toBeFalsy();
    expect(env?.data.map).toBeNull();
    expect(env?.data.why).toBeTruthy();
    expect(env?.data.coverage.value).toBeNull();
    expect(env?.data.coverage.why).toBeTruthy();
  });

  it('Review Focus 1: Hyperliquid odrzuca — poziomy touched:null, pokrycie null z powodem, bez isError', async () => {
    const { res, env } = await run({ [MAPS_URL]: mapsFile(), [HL_INFO]: new Error('ETIMEDOUT') });
    expect(res.isError).toBeFalsy();
    const levels = env?.data.map?.levels ?? [];
    expect(levels).toHaveLength(2);
    for (const l of levels) {
      expect(l.touched).toBeNull();
      expect(l.touchedAt).toBeNull();
      // Poziom pochodzi z wpisu, nie z Hyperliquid — zostaje
      expect(l.price.value).not.toBeNull();
    }
    expect(env?.data.coverage.value).toBeNull();
    expect(env?.data.coverage.why).toBeTruthy();
    expect(env?.data.why).toBeTruthy();
    expect(env?.sources.find((s) => s.url === HL_INFO)?.asOf).toBeNull();
  });

  it('Review Focus 1: mapy i świece pobierane równolegle (jeden limit czasu na całość, nie suma dwóch)', async () => {
    // Plik map odpowiada dopiero, gdy przyszło żądanie świec: przy pobieraniu po kolei mapy czekałyby do limitu czasu
    let hlSeen = () => {};
    const seen = new Promise<void>((resolve) => (hlSeen = resolve));
    const routes: Record<string, Route> = {
      [MAPS_URL]: (req) =>
        Promise.race([
          seen.then(() => mapsFile()),
          new Promise<never>((_, reject) => req.signal?.addEventListener('abort', () => reject(req.signal?.reason), { once: true })),
        ]),
      [HL_INFO]: (req) => {
        hlSeen();
        return hlRoute(BARS)(req);
      },
    };
    const { res, env } = await call(testSources(routes, NOW, { timeoutMs: 2_000 }).src);
    expect(res.isError).toBeFalsy();
    expect(env?.data.map?.levels.map((l) => l.touched)).toEqual([true, false]);
  });

  it('Review Focus 1: HTTP 429 z Hyperliquid — to samo, bez isError', async () => {
    const { res, env } = await run({ [MAPS_URL]: mapsFile(), [HL_INFO]: { status: 429, json: {} } });
    expect(res.isError).toBeFalsy();
    expect(env?.data.map?.levels.every((l) => l.touched === null)).toBe(true);
    expect(env?.data.coverage.value).toBeNull();
  });

  it('Review Focus 5: etykieta poziomu z adresem — isError z blokadą treści, adres nie wychodzi', async () => {
    const { res } = await run({ [MAPS_URL]: mapsFile([`opór ${ADDR}`, 'wsparcie']), [HL_INFO]: hlRoute(BARS) });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res)).not.toContain(ADDR);
    expect(JSON.stringify(res.content)).toContain('blokada treści');
  });

  it('wyjątek w narzędziu — isError z „błąd narzędzia”, serwer działa dalej', async () => {
    class Broken extends Sources {
      override async blogMaps(): Promise<never> {
        throw new Error('awaria testowa');
      }
    }
    const base = testSources({}, NOW).src;
    const { res, client } = await call(new Broken(base.cfg));
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('błąd narzędzia');
    const again = await client.listTools();
    expect(again.tools.length).toBeGreaterThan(0);
  });
});
