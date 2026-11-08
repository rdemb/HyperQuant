import { utcDayStart } from '../charts/pro/core/sessions';
import { type MapKind, isMapId } from './mapSettlement';

/**
 * Mapy z bloga HyperQuant (`blog/maps.json` z builda bloga, ta sama domena co aplikacja): poziomy z tekstu wpisów
 * z ostatnich 3 dni, od najnowszego. To tekst autora, nie wynik modelu — warstwa „Mapa z bloga” rysuje je na wykresie BTC.
 * Czyste typy i funkcje bez Reacta: korzysta z nich strona (hook `useBlogMaps`) i serwer MCP.
 */

export interface BlogMapLevel {
  label: string;
  price: number;
  note?: string;
}

export interface BlogMap {
  /** Identyfikator wpisu (np. 2026-11-07-mapa-dnia). */
  id: string;
  title: string;
  kind: MapKind;
  /** Chwila publikacji wpisu (ms UTC). */
  publishedAt: number;
  /** Cena BTC przy wpisie. */
  price: number;
  levels: BlogMapLevel[];
  /** Adres wpisu względem strony (blog/<id>/). */
  url: string;
}

export type BlogMapsStatus = 'loading' | 'ready' | 'missing';

export interface BlogMapsState {
  status: BlogMapsStatus;
  maps: BlogMap[];
}

/** Plik map względem aplikacji (w `npm run dev` go nie ma — warstwa wtedy po cichu nie rysuje się). */
export const BLOG_MAPS_URL = './blog/maps.json';

const KINDS: readonly MapKind[] = ['dzien', 'ny', 'otwarcie', 'aktualizacja', 'inne'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const price = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const text = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

function parseLevel(v: unknown): BlogMapLevel | null {
  if (!isObj(v) || !text(v.label) || !price(v.price)) return null;
  return typeof v.note === 'string' && v.note !== '' ? { label: v.label, price: v.price, note: v.note } : { label: v.label, price: v.price };
}

function parseMap(v: unknown): BlogMap | null {
  if (!isObj(v)) return null;
  const { id, title, kind, publishedAt, url } = v;
  if (!isMapId(id) || !text(title) || !KINDS.includes(kind as MapKind)) return null;
  if (typeof publishedAt !== 'number' || !Number.isFinite(publishedAt) || !price(v.price) || typeof url !== 'string' || !Array.isArray(v.levels)) return null;
  const levels = v.levels.map(parseLevel).filter((l): l is BlogMapLevel => l !== null);
  if (levels.length === 0) return null;
  return { id, title, kind: kind as MapKind, publishedAt, price: v.price, levels, url };
}

/** Mapy z pliku (wersja 1), od najnowszej; błędne wpisy i poziomy odpadają pojedynczo. Zły format pliku — null. */
export function parseBlogMaps(raw: unknown): BlogMap[] | null {
  if (!isObj(raw) || raw.v !== 1 || !Array.isArray(raw.maps)) return null;
  return raw.maps
    .map(parseMap)
    .filter((m): m is BlogMap => m !== null)
    .sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * Mapa do narysowania w chwili `now`: wybrana ręcznie (`id`), gdy jest w pliku; inaczej najnowsza „Mapa dnia” opublikowana
 * w bieżącej dobie UTC, bez sięgania po starsze. Wpis późniejszy niż `now` (powtórka) się nie liczy. Brak — null.
 */
export function pickMap(maps: readonly BlogMap[], now: number, id?: string | null): BlogMap | null {
  if (id) for (const m of maps) if (m.id === id && m.publishedAt <= now) return m;
  const day = utcDayStart(now);
  let best: BlogMap | null = null;
  for (const m of maps) if (m.kind === 'dzien' && m.publishedAt >= day && m.publishedAt <= now && (!best || m.publishedAt > best.publishedAt)) best = m;
  return best;
}

/**
 * Stan po pobraniu: plik — ready; brak pliku przy pierwszym pobraniu — missing; nieudane odświeżenie zostawia poprzednie mapy.
 * Bez zmiany (kolejny brak pliku, ten sam plik) — ten sam obiekt, więc wykresy nie przeliczają się co 10 min.
 */
export function nextBlogMaps(prev: BlogMapsState, got: BlogMap[] | null): BlogMapsState {
  if (!got) return prev.status === 'loading' ? { status: 'missing', maps: [] } : prev;
  // Plik ma kilkanaście map bez treści wpisów — porównanie raz na 10 min jest tanie
  if (prev.status === 'ready' && JSON.stringify(prev.maps) === JSON.stringify(got)) return prev;
  return { status: 'ready', maps: got };
}
