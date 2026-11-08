import { useEffect, useSyncExternalStore } from 'react';
import { BLOG_MAPS_URL, type BlogMap, type BlogMapsState, nextBlogMaps, parseBlogMaps } from '../utils/blogMaps';

/**
 * Hook map z bloga HyperQuant dla wykresów strony (wspólne pobieranie co 10 min). Typy i czyste funkcje map są
 * w `src/utils/blogMaps.ts` (bez Reacta, korzysta z nich też serwer MCP); tu re-eksport dla dotychczasowych importów.
 */
export type { BlogMap, BlogMapLevel, BlogMapsState, BlogMapsStatus } from '../utils/blogMaps';
export { BLOG_MAPS_URL, nextBlogMaps, parseBlogMaps, pickMap } from '../utils/blogMaps';

/** Mapy odświeżane co tyle (blog publikuje kilka wpisów na dobę). */
export const BLOG_MAPS_REFRESH_MS = 10 * 60_000;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Mapy z `./blog/maps.json`; 404, strona HTML zamiast pliku (serwer deweloperski), zły plik albo błąd sieci — null. */
export async function fetchBlogMaps(fetchImpl: FetchLike = (u, i) => fetch(u, i)): Promise<BlogMap[] | null> {
  try {
    const res = await fetchImpl(BLOG_MAPS_URL, { cache: 'no-cache', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return parseBlogMaps(await res.json());
  } catch {
    return null;
  }
}

// Jeden plik dla wszystkich wykresów strony: pobierany, dopóki któryś wykres ma włączoną warstwę
let state: BlogMapsState = { status: 'loading', maps: [] };
const listeners = new Set<() => void>();
let users = 0;
let lastAt = 0;
let inflight = false;
let timer = 0;

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const snapshot = () => state;

/** Pobranie, gdy minęło 10 min od poprzedniego; w ukrytej karcie nic (po powrocie do karty od razu, jeśli minęło). */
function run(): void {
  if (users === 0 || inflight || document.visibilityState !== 'visible' || Date.now() - lastAt < BLOG_MAPS_REFRESH_MS) return;
  inflight = true;
  lastAt = Date.now();
  void fetchBlogMaps().then((got) => {
    inflight = false;
    const next = nextBlogMaps(state, got);
    if (next === state) return;
    state = next;
    listeners.forEach((fn) => fn());
  });
}

function acquire(): () => void {
  if (users++ === 0) {
    run();
    // Sprawdzenie co minutę: kolejne pobranie po 10 min, także gdy karta była w tle
    timer = window.setInterval(run, 60_000);
    document.addEventListener('visibilitychange', run);
  }
  return () => {
    if (--users > 0) return;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', run);
  };
}

/** Mapy z bloga, wspólne dla wykresów strony; `enabled` — czy ten wykres ich potrzebuje (warstwa włączona, BTC). */
export function useBlogMaps(enabled = true): BlogMapsState {
  const s = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => (enabled ? acquire() : undefined), [enabled]);
  return s;
}
