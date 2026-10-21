/* Service worker HyperQuant (ręczny, bez Workbox).
 * - Nawigacja: network-first, offline → zcache'owany index.html (powłoka aplikacji).
 * - ./assets/* (nazwy z hashem): cache-first.
 * - ./data/feeds/*.json: stale-while-revalidate.
 * - Wszystko spoza własnego originu (api.hyperliquid.xyz, giełdy CEX, fonty) przechodzi bez cache.
 *   WebSockety w ogóle nie trafiają do zdarzenia fetch.
 * Wersja cache = parametr ?v=<hash bundla> z rejestracji, więc każdy build ma własny cache.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `hq-${VERSION}`;
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './icons/icon-192.png', './icons/apple-touch-icon.png'];

/** Powłoka + zasoby wskazane w index.html (bundle i CSS z hashem), żeby offline działał już po pierwszej wizycie. */
async function precache() {
  const cache = await caches.open(CACHE);
  // cache: 'reload' omija cache HTTP (Pages max-age), żeby nie zapisać starego index.html
  await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
  const html = await (await cache.match('./index.html')).text();
  const assets = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map((m) => `./${m[1]}`);
  await cache.addAll([...new Set(assets)]);
}

self.addEventListener('install', (event) => {
  // Bez automatycznego skipWaiting — nowa wersja czeka na zgodę użytkownika (baner w UI)
  event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('hq-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/** Zapis do cache tylko dla poprawnych odpowiedzi z własnego originu. */
function store(cache, key, res) {
  if (res && res.ok && res.type === 'basic') cache.put(key, res.clone());
  return res;
}

async function networkFirstShell(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    // Jako powłokę zapisujemy tylko dokument HTML (np. otwarty w karcie obrazek nie nadpisze index.html)
    if ((res.headers.get('content-type') || '').includes('text/html')) store(cache, './index.html', res);
    return res;
  } catch {
    return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  return store(cache, request, await fetch(request));
}

async function staleWhileRevalidate(request, key) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(key);
  const refresh = fetch(request)
    .then((res) => store(cache, key, res))
    .catch(() => null);
  return hit || (await refresh) || Response.error();
}

async function networkWithFallback(request) {
  const cache = await caches.open(CACHE);
  try {
    return await fetch(request);
  } catch {
    return (await cache.match(request, { ignoreSearch: true })) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Cudze originy (HL API, CEX, Google Fonts…) — bez respondWith, przeglądarka obsługuje normalnie
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request));
    return;
  }
  const rel = url.pathname.startsWith(SCOPE_PATH) ? url.pathname.slice(SCOPE_PATH.length) : url.pathname;
  if (rel.startsWith('assets/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (rel.startsWith('data/feeds/') && rel.endsWith('.json')) {
    // Klucz bez query (?t=… do omijania cache HTTP), żeby nie mnożyć wpisów
    event.respondWith(staleWhileRevalidate(request, url.origin + url.pathname));
    return;
  }
  event.respondWith(networkWithFallback(request));
});
