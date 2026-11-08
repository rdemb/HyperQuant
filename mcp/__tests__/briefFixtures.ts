/**
 * Syntetyczne dane testów `market_brief` (przechodzą strażniki strony, bez adresów i hashy): świece 1m i 1h, mapy z bloga
 * i mapa likwidacji wokół ceny ok. 101 000; teraz 7.11.2026 06:30 UTC (sesja azjatycka). Wczorajsza Mapa dnia i przebieg
 * sesji NY 6.11 — wspólne z testami Czwórki strony (`src/utils/__tests__/fixtures/fourNumbers`).
 */
import { type BlogMap, type BlogMapsState, parseBlogMaps } from '../../src/state/useBlogMaps';
import { type VBar, toVBars } from '../../src/utils/auction';
import { dayVwapOf } from '../../src/utils/dayVwap';
import { type FourInputs, lastClosedNy, nextSessionHour, nyMap, sessionHourSamples } from '../../src/utils/fourNumbers';
import type { LiqMap } from '../../src/utils/liqMap';
import { liqMapFreshness } from '../../src/utils/liqMapView';
import { mapWindow } from '../../src/utils/mapSettlement';
import { previousSameSession } from '../../src/utils/sessionDay';
import { DAY, DAY_MAP, H, LIQ_MAP, NOW, NY, NY_MAP, at, bars, hours, px } from '../../src/utils/__tests__/fixtures/fourNumbers';
import { type Bar, DATA_BASE, HL_INFO, MAPS_URL, MIN, type Route, asCandles, hlCandles } from './helpers';

export { NOW, NY };
export const LIQ_URL = `${DATA_BASE}/liq-map/BTC.json`;
export const ADDR = '0x' + 'd'.repeat(40);

/** Poprzednia sesja Kontekstu aukcji w Azji 7.11: NY 5.11 (sesja kontekstu to zamknięta NY 6.11). */
export const PREV = previousSameSession(NY);

/**
 * Cena w minucie: w sesji NY 5.11 piła 99 500–99 795 (co godzinę od nowa), od 7.11 00:00 wzrost o 0,5 USD na minutę
 * od 100 900; poza tym jak w testach Czwórki strony (dzień trendowy NY 6.11).
 */
export const price = (t: number): number => {
  if (t >= PREV.start && t < PREV.end) return 99_500 + (((t - PREV.start) / MIN) % 60) * 5;
  if (t >= NY.end) return 100_900 + ((t - NY.end) / MIN) * 0.5;
  return px(t);
};

const toBar = (b: VBar): Bar => ({ t: b.time, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume });

/** Świece 1m od 5.11 00:00 do świecy bieżącej minuty (7.11 06:30) włącznie. */
export const M1: Bar[] = bars(at(2026, 11, 5, 0), NOW + MIN, price).map(toBar);
/** Świece 1h z 30 dni do bieżącej godziny włącznie; zakres według godziny sesji (godzina otwarcia Londynu: 100 USD). */
export const H1: Bar[] = hours(Math.floor((NOW - 30 * DAY) / H) * H, NOW).map(toBar);
/** Zamknięcie ostatniej świecy 1m (cena odpowiedzi). */
export const CLOSE = M1[M1.length - 1].c;

/** Mapa likwidacji z testów Czwórki strony przesunięta o +1000 USD: kubełki w 1% pod ceną ok. 101 095 i nad nią. */
export const LIQ: LiqMap = {
  ...LIQ_MAP,
  longs: LIQ_MAP.longs.map((b) => ({ ...b, px: b.px + 1_000 })),
  shorts: LIQ_MAP.shorts.map((b) => ({ ...b, px: b.px + 1_000 })),
};

/** Dzisiejsza Mapa dnia (7.11 05:00 UTC) z dwoma poziomami. */
export const TODAY_PUB = at(2026, 11, 7, 5);
export const todayMap = (labels: readonly [string, string] = ['Szczyt NY', 'Wsparcie']): BlogMap => ({
  id: '2026-11-07-mapa-dnia',
  title: 'BTC przed Londynem',
  kind: 'dzien',
  publishedAt: TODAY_PUB,
  price: 101_000,
  levels: [
    { label: labels[0], price: 101_400 },
    { label: labels[1], price: 100_500 },
  ],
  url: 'blog/2026-11-07-mapa-dnia/',
});
export const mapsJson = (today: BlogMap = todayMap()) => ({ v: 1, asOf: TODAY_PUB + MIN, maps: [today, NY_MAP, DAY_MAP] });

/** Trasy fałszywego `fetch`: mapy z bloga, mapa likwidacji i świece; `clock` — tylko świece rozpoczęte do chwili żądania. */
export const routes = (o: { maps?: Route; liq?: Route; hl?: Route; clock?: { now: number } } = {}): Record<string, Route> => ({
  [MAPS_URL]: o.maps ?? { json: mapsJson() },
  [LIQ_URL]: o.liq ?? { json: LIQ },
  [HL_INFO]: o.hl ?? hlCandles({ '1m': M1, '1h': H1 }, o.clock),
});

/**
 * Wejścia Czwórki tak, jak składa je strona (`readFourInputs`) z tych samych świec i plików: 1m od otwarcia ostatniej sesji NY
 * albo od wpisu jej mapy (pełna minuta), 1h od najwcześniejszej próby typowej szerokości godziny, cena — ostatnie zamknięcie 1m.
 */
export function siteInputs(now: number, liq: LiqMap = LIQ, maps: BlogMapsState = { status: 'ready', maps: parseBlogMaps(mapsJson()) ?? [] }): FourInputs {
  const live = asCandles(M1.filter((b) => b.t <= now));
  const ny = lastClosedNy(now);
  const m = maps.status === 'ready' ? nyMap(maps.maps, ny, now) : null;
  const w = m && mapWindow(m.kind, m.publishedAt);
  const from1m = Math.floor((w ? Math.min(ny.start, w.from) : ny.start) / MIN) * MIN;
  const at1h = nextSessionHour(now);
  const from1h = Math.min(at1h.hour, ...sessionHourSamples(at1h));
  return {
    coin: 'BTC',
    now,
    price: live[live.length - 1].c,
    bars1m: toVBars(live.filter((c) => c.t >= from1m)),
    maps,
    liq: { status: liqMapFreshness(liq, now), map: liq },
    bars1h: toVBars(asCandles(H1.filter((b) => b.t >= from1h && b.t <= now))),
    dayVwap: dayVwapOf(live, now),
  };
}
