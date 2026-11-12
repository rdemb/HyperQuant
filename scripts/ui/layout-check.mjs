#!/usr/bin/env node
// Pomiar układu ekranu W sesji w Chrome bez okna (CDP), na zbudowanej stronie (`vite preview`):
//  1. udział panelu ceny w wysokości okna (1440 × 900 bez i z kolumną DOM, 390 × 844, tryb skupienia, telefon poziomo),
//  2. elementy DOM nad polem świec (poza legendą w jednej linii i krzyżem),
//  3. pary nachodzących na siebie etykiet na wykresie i osi ceny (powtórka nagranej doby z kopii przy lekcjach),
//  4. dostępność funkcji paska w najwyżej dwóch kliknięciach i działanie skrótów klawiszowych,
//  5. zachowanie ustawień użytkownika w localStorage (klucze hq.*),
//  6. widoczne pozycje listy wskaźników na telefonie,
// oraz liczby obiektów na płótnach (podpisy, bąble, prostokąty) na widok jako punkt odniesienia (scripts/ui/baseline.json).
// Domyślnie bez sieci: API Hyperliquid z danych stałych (scripts/ui/fixtures.mjs), zegar strony stoi w nagranej dobie
// 24.10.2026, strefa Europe/Warsaw — wynik nie zależy od pory dnia ani od rynku. `--live` — prawdziwa sieć i zegar.
// Użycie: npm run ui:check  (albo: node scripts/ui/layout-check.mjs --port 4408 [--serve] [--shots katalog] [--label po]
//         [--strict] [--live] [--update-baseline])
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launch, sleep } from './cdp.mjs';
import { INIT, PROBE, fixtureInit } from './probe.mjs';
import { FIXED_NOW, createFixtures } from './fixtures.mjs';
import { compareBaseline, margin, metricsOf } from './baseline.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const PORT = Number(opt('port', '4408'));
const BASE = `http://127.0.0.1:${PORT}/`;
const LABEL = opt('label', 'run');
const OUT = path.resolve(opt('out', 'ui-check'));
const SHOTS = opt('shots', null);
const STRICT = flag('strict');
const LIVE = flag('live');
const UPDATE = flag('update-baseline');
const BASELINE = path.resolve('scripts/ui/baseline.json');
/** Chwila strony: w trybie danych stałych zegar stoi (FIXED_NOW). */
const PAGE_NOW = LIVE ? Date.now() : FIXED_NOW;

/** Progi testów akceptacyjnych. */
const LIMITS = { desktop: 0.62, desktopDom: 0.6, phone: 0.6, focus: 0.8 };

/** Stały użytkownik: dymki pierwszej wizyty zamknięte (karta pierwszego kontaktu nie zmienia pomiaru). */
const RETURNING = { 'hq.onboarding.v1': JSON.stringify({ firstAt: PAGE_NOW - 8 * 86_400_000, done: true }) };

/**
 * Żądania strony w trybie danych stałych: pliki strony z serwera podglądu (bez danych publicznych z public/data/feeds,
 * których w repozytorium nie ma), API Hyperliquid z danych stałych, cała reszta sieci — błąd jak bez połączenia.
 */
function fixtureIntercept(fx) {
  const origin = new URL(BASE).origin;
  return (req) => {
    if (/^(data|blob):/.test(req.url)) return 'continue';
    const u = new URL(req.url);
    if (u.origin === origin) return u.pathname.includes('/data/feeds/') ? { status: 404, body: '', type: 'text/plain' } : 'continue';
    if (u.hostname === 'api.hyperliquid.xyz' && u.pathname === '/info') {
      if (req.method === 'OPTIONS') return { status: 204, body: '' };
      let body = {};
      try {
        body = JSON.parse(req.postData ?? '{}');
      } catch {
        // pusta albo nieczytelna treść — pusta odpowiedź
      }
      return { body: JSON.stringify(fx.respond(body)) };
    }
    return 'fail';
  };
}

/** Powtórka nagranej doby z kopii przy lekcjach (pliki w public/lessons/replay): stałe dane do testu etykiet. */
const REPLAY = '#charts?replay=lessons&m=BTC&i=5m&v=candles&t=2026-10-24T19:30:00Z&layers=vwap,heatmap,bubbles,clashes,lots,profile,levels,sessions';

/**
 * Wskaźnik „Strefy absorpcji i pudełka Effort” na nagranej dobie: powtórka 24.10 o 19:30, BTC 5m, Kokpit z zapisem, w którym
 * wskaźnik jest włączony (bez innych warstw). Liczba prostokątów z wyboru warstwy (`effortSelect`, atrybut wykresu
 * `data-effort-rects`), nie z pikseli.
 */
const EFFORT_REPLAY = '#charts?replay=lessons&m=BTC&i=5m&v=candles&t=2026-10-24T19:30:00Z&layers=vwap';
const EFFORT_STORE = {
  'hq.charts.v1.cockpit': JSON.stringify({
    coin: 'BTC',
    interval: '5m',
    view: 'candles',
    layersV: 2,
    indicators: [{ iid: 'effort', id: 'effort', params: {}, color: '#E9548D', alpha: 1, width: 1, labels: true, visible: true }],
  }),
};
/**
 * Ściany i serie: Kokpit 1m na powtórce 24.10 o 19:30 (warstwy bąbli i ścian). Na stałych danych na żywo taśmy nie ma
 * (atrapa strumienia nie wysyła transakcji), więc ścian i serii tam nie byłoby — dlatego powtórka nagranej doby. Liczba
 * z wyboru warstwy (`selectClashes`, atrybut `data-clash-objects`), limit 25 (bezpiecznik warstwy: 12 + 3 ściany i 10
 * serii; zmierzone maksima na 140 świecach: 11 ścian i 9 serii).
 */
const CLASH_REPLAY = '#charts?replay=lessons&m=BTC&i=1m&v=candles&t=2026-10-24T19:30:00Z&station=cockpit&layers=bubbles,clashes';
const CLASH_MAX = 25;
/**
 * Bąble zleceń: Kokpit 1m na powtórce 24.10 o 19:30, tylko warstwa bąbli. Mierzone na powtórce, bo na stałych danych
 * na żywo taśmy nie ma (atrapa strumienia nie wysyła transakcji) i bąbli by nie było. Liczba z wyboru warstwy
 * (`selectBubbles`, atrybut `data-bubbles`, bez serii): na 1440 od 5 do 40, na 390 najwyżej 15 (reguła 2 największych
 * z 20 świec, na telefonie największe; na taśmie 4–11.11 mediana 17 i 2, maksimum 33 i 13).
 */
const BUBBLE_REPLAY = '#charts?replay=lessons&m=BTC&i=1m&v=candles&t=2026-10-24T19:30:00Z&station=cockpit&layers=bubbles';
const BUBBLES = { min: 5, max: 40, phoneMax: 15 };
const bubbleCount = `(() => { const c = window.__hq.chart(); const host = c && c.root.closest('[data-bubbles]'); return host ? Number(host.dataset.bubbles) : null; })()`;
/**
 * Zakres początkowy sesji (initial balance): „Aukcja i otwarcie” (5m) i „Rozliczenie doby” (30m) na danych stałych
 * (zegar 24.10 21:29 UTC, sesja nowojorska), 1440 i 390. Liczba z wyboru warstwy (`selectIbs`, atrybut
 * `data-ib-objects`), limit 7 (bieżąca sesja z rozszerzeniami po jednej stronie i linie poprzedniej).
 */
const IB_VIEWS = [
  ['auction', '#charts', { 'hq.charts.phaseActive.v1': JSON.stringify({ before: 'day-map', session: 'auction-open', after: 'review' }), 'hq.charts.tabs.v1': JSON.stringify({ v: 2, tabs: [], active: 'auction-open' }) }],
  ['review', '#after', {}],
];
const IB_MAX = 7;
/**
 * Poziomy dnia i linie otwarć sesji na danych stałych: „Mapa dnia” (komputer: 4h z poziomami dnia i 30m z TPO) i
 * „Rozliczenie doby” (30m z liniami sesji), 1440 i 390. Liczby z wyboru warstwy (`selectDays`, `selectSessions`; atrybuty
 * `data-level-lines`, `data-session-lines`, interwał w `data-interval-ms`) — największe z widocznych wykresów układu, osobno
 * dla wykresów od 4h. Limity z projektu: na 4h najwyżej 3 linie poziomów, linii sesji najwyżej 6; poniżej 4h poziomy dwóch
 * dni — najwyżej 6.
 */
const LEVEL_VIEWS = [
  ['dayMap', '#before', {}],
  ['review', '#after', {}],
];
const LEVELS_MAX = { h4: 3, lines: 6, sessions: 6 };
/**
 * Rynki wynikowe HIP-4: Kokpit 5m z zapisem, w którym wskaźnik jest włączony, na danych stałych z 14 płynnymi rynkami BTC
 * (progi co 250 USD wokół ceny, `fixtures.mjs`), 1440 i 390. Liczba progów wybranych na wykres (`selectOutcomes`, atrybut
 * `data-hip4-lines`; także poza widoczną skalą ceny). Limity z projektu: komputer 6 (3 nad ceną i 3 pod), telefon 1.
 */
const HIP4_STORE = {
  'hq.charts.v1.cockpit': JSON.stringify({
    coin: 'BTC',
    interval: '5m',
    view: 'candles',
    layersV: 2,
    indicators: [{ iid: 'outcomes', id: 'outcomes', params: {}, color: '#F5A524', alpha: 1, width: 1, labels: true, visible: true }],
  }),
};
const HIP4_MAX = { desktop: 6, phone: 1 };
const hip4Count = `(() => { const c = window.__hq.chart(); const host = c && c.root.closest('[data-hip4-lines]'); return host ? Number(host.dataset.hip4Lines) : null; })()`;
const levelCounts = `(() => {
  const hosts = [...document.querySelectorAll('.tv-lightweight-charts')].filter((r) => r.getBoundingClientRect().width > 0).map((r) => r.closest('[data-level-lines]')).filter(Boolean);
  if (hosts.length === 0) return null;
  const max = (list, k) => (list.length ? Math.max(...list.map((h) => Number(h.dataset[k]))) : null);
  const long = hosts.filter((h) => Number(h.dataset.intervalMs) >= 4 * 3600000);
  return { levels: max(hosts, 'levelLines'), sessions: max(hosts, 'sessionLines'), levels4h: max(long, 'levelLines') };
})()`;
const ibCount = `(() => { const c = window.__hq.chart(); const host = c && c.root.closest('[data-ib-objects]'); return host ? Number(host.dataset.ibObjects) : null; })()`;
/**
 * Profile dób na danych stałych: „Mapa dnia” (komputer: 4h z profilami dób i 30m z TPO; telefon: 30m z TPO) i „Rozliczenie
 * doby” (30m z TPO), 1440 i 390. Liczby z warstw (atrybuty `data-tpo-objects`, `data-tpo-area`, `data-period-objects`,
 * `data-period-area`): obiekty i udział pola pod słupkami w %. Limity z projektu: TPO najwyżej 20 obiektów na komputerze,
 * pole pod słupkami najwyżej 12% na komputerze i 20% na telefonie; profile dób — limit pola (starsza doba to zawsze POC
 * i pasek value area, więc ich liczba rośnie z liczbą dób w widoku; pilnuje jej punkt odniesienia).
 */
const PROFILE_VIEWS = [
  ['dayMap', '#before', { 'hq.charts.phaseActive.v1': JSON.stringify({ before: 'day-map', session: 'cockpit', after: 'review' }) }],
  ['review', '#after', {}],
];
const PROFILE_MAX = { objects: 20, area1440: 12, area390: 20 };
const profileCounts = `(() => {
  const vis = (e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
  // Wykres z włączoną warstwą: pierwszy widoczny z niezerową liczbą (pozostałe wykresy układu mają warstwę wyłączoną)
  const pick = (key, areaKey) => {
    const hosts = [...document.querySelectorAll('.tv-lightweight-charts')].filter(vis).map((r) => r.closest('[data-' + key + ']')).filter(Boolean);
    const h = hosts.find((x) => Number(x.dataset[areaKey.c]) > 0 || Number(x.dataset[areaKey.a]) > 0);
    return h ? { objects: Number(h.dataset[areaKey.c]), area: Number(h.dataset[areaKey.a]) } : null;
  };
  return { tpo: pick('tpo-objects', { c: 'tpoObjects', a: 'tpoArea' }), periods: pick('period-objects', { c: 'periodObjects', a: 'periodArea' }) };
})()`;
const clashCount = `(() => { const c = window.__hq.chart(); const host = c && c.root.closest('[data-clash-objects]'); return host ? Number(host.dataset.clashObjects) : null; })()`;
/**
 * Strefy nierównowagi i niedokończone aukcje: układ „Aukcja i otwarcie” na powtórce 24.10 o 19:30, 5m footprint, warstwy
 * stref i aukcji włączone. Liczby z wyboru warstwy (`selectZones`, atrybuty `data-zone-rects` i `data-auction-lines`).
 */
const ZONES_REPLAY = '#charts?replay=lessons&m=BTC&i=5m&v=footprint&t=2026-10-24T19:30:00Z&station=auction-open&layers=zones,auctions';
const ZONES_MAX = { rects: 4, lines: 2 };
const zoneCounts = `(() => { const c = window.__hq.chart(); const host = c && c.root.closest('[data-zone-rects]'); return host ? { rects: Number(host.dataset.zoneRects), lines: Number(host.dataset.auctionLines) } : null; })()`;
/** Limity z projektu szlifu: komputer najwyżej 7 prostokątów, telefon najwyżej 3. */
const EFFORT_MAX = { desktop: 7, phone: 3 };
const effortRects = `(() => { const c = window.__hq.chart(); const host = c && c.root.closest('[data-effort-rects]'); return host ? Number(host.dataset.effortRects) : null; })()`;

// ───────────────────────── funkcje paska (dzisiejsze ikony i przełączniki) ─────────────────────────
const DESKTOP_FUNCS = {
  indicators: 'Wskaźniki',
  drawing: 'Narzędzia rysowania|rysowania',
  tape: 'Taśma zleceń|taśmę zleceń',
  alerts: 'Alarmy cenowe',
  settings: 'Ustawienia wykresu',
  layout1: 'Jeden wykres',
  layout2: 'Dwa wykresy',
  layout4: 'Cztery wykresy',
  scrollNow: 'Przewiń do bieżącej',
  resetScale: 'Przywróć skalę',
  replay: 'Powtórka nagranej',
  link: 'Kopiuj link',
  screenshot: 'Zrzut ekranu',
  frame: 'Klatka',
  keys: 'Skróty klawiszowe',
  fullscreen: 'Pełny ekran',
  marketEth: '\\bETH\\b',
  interval15m: '(^|[^0-9])15m\\b',
  interval1D: '\\b1D\\b',
  footprint: 'Footprint',
  fpDelta: 'Delta wiersza',
  newTab: 'Nowa karta|Pusta karta',
  restorePreset: 'Przywróć wzorzec',
  dock: 'Kolumna DOM',
  tabAuction: 'Aukcja i otwarcie',
  stateWhy: 'skąd\\?',
  lang: '\\bEN\\b|English',
  pause: 'Wstrzymaj strumień',
  sync: 'Synchronizuj',
  sound: 'dźwięk taśmy',
  lessons: 'Lekcje',
  research: 'Badania',
  sources: 'Źródła',
};
/** Funkcje, których build bez VITE_DATA_BASE_URL nie ma (przed zmianą też nie). */
const OPTIONAL = ['replay'];
const PHONE_FUNCS = {
  indicators: 'Wskaźniki',
  alerts: 'Alarmy cenowe',
  settings: 'Ustawienia wykresu',
  drawing: 'Narzędzia rysowania|rysowania',
  scrollNow: 'Przewiń do bieżącej',
  resetScale: 'Przywróć skalę',
  screenshot: 'Zrzut ekranu',
  frame: 'Klatka',
  link: 'Kopiuj link',
  fullscreen: 'Pełny ekran',
  tabTape: '^\\s*\\|\\s*\\|\\s*Taśma\\s*$',
  tabDom: '^\\s*\\|\\s*\\|\\s*DOM\\s*$',
  tabNumbers: 'Liczby',
  marketEth: '\\bETH\\b',
  interval15m: '(^|[^0-9])15m\\b',
  // Footprint jako pozycja listy rodzaju wykresu („Bid × Ask”, „FP Delta”…)
  footprint: 'Footprint|Bid × Ask',
  tabAuction: 'Aukcja i otwarcie',
  lang: '\\bEN\\b|English',
  pause: 'Wstrzymaj strumień',
  lessons: 'Lekcje',
  sources: 'Źródła',
};

// ───────────────────────── serwer ─────────────────────────
async function up() {
  try {
    return (await fetch(BASE)).ok;
  } catch {
    return false;
  }
}
let server = null;
async function ensureServer() {
  if (await up()) return;
  if (!flag('serve')) throw new Error(`Brak serwera na ${BASE} — uruchom „npx vite preview --port ${PORT} --strictPort” albo dodaj --serve`);
  server = spawn(process.execPath, [path.resolve('node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
  if (!(await up())) throw new Error('vite preview nie wystartował');
}
function stopServer() {
  if (!server) return;
  server.kill();
  server = null;
}

// ───────────────────────── pomocnicze ─────────────────────────
/** Otwiera stronę z danym localStorage (zapis na tym samym pochodzeniu przed wczytaniem aplikacji). */
async function open(page, hash, store = {}) {
  await page.go(`${BASE}robots.txt`, 300);
  await page.ev(`(() => { localStorage.clear(); const s = ${JSON.stringify({ ...RETURNING, ...store })}; for (const k in s) localStorage.setItem(k, s[k]); return true; })()`);
  await page.go(`${BASE}${hash}`, 500);
  await page.waitFor(`!!document.querySelector('.tv-lightweight-charts canvas')`, 30000);
  // Świece i warstwy dochodzą przez kilka sekund (API, nagranie serwera)
  await sleep(6000);
  // Chwilowy błąd API świec (limit zapytań): ponowienie, zanim cokolwiek zmierzymy
  for (let i = 0; i < 3; i++) {
    const retried = await page.ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Spróbuj ponownie'); if (!b) return false; b.click(); return true; })()`);
    if (!retried) break;
    await sleep(5000);
  }
  await page.ev(PROBE);
  await page.mouseAway();
  await sleep(400);
}
const probe = async (page, expr) => {
  await page.ev(`window.__hq || ${PROBE}`);
  return page.ev(expr);
};
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.shot(path.join(SHOTS, `${LABEL}-${name}.png`));
};

/** Funkcje dostępne w ≤ 2 kliknięciach: widoczne od razu (1) albo w menu otwartym jednym kliknięciem (2). */
async function reach(page, funcs) {
  const res = {};
  const direct = await probe(page, `__hq.findAll(${JSON.stringify(funcs)})`);
  for (const k of Object.keys(funcs)) {
    if (direct[k] === 'direct') res[k] = 1;
    else if (direct[k] === 'select') res[k] = 2;
  }
  let missing = Object.fromEntries(Object.entries(funcs).filter(([k]) => res[k] === undefined));
  const list = await probe(page, `__hq.togglers()`);
  for (const t of list) {
    if (Object.keys(missing).length === 0) break;
    const fresh = await probe(page, `__hq.togglers()`);
    const same = fresh.filter((x) => x.name === t.name);
    const nth = list.filter((x) => x.name === t.name).indexOf(t);
    const target = same[nth] ?? same[0];
    if (!target) continue;
    await probe(page, `__hq.clickProbe(${target.i})`);
    await sleep(350);
    const found = await probe(page, `__hq.findAll(${JSON.stringify(missing)})`);
    for (const [k, how] of Object.entries(found)) {
      res[k] = how === 'direct' ? `2 (${t.name.split('|').map((s) => s.trim()).find(Boolean)})` : 3;
      if (how === 'direct') delete missing[k];
    }
    await page.key('Escape');
    await sleep(150);
    await page.mouseAway();
    await page.click(2, 2);
    await sleep(200);
  }
  // Funkcje zależne od konfiguracji buildu (powtórka doby wymaga adresu danych skanera): brak w ogóle — „n/a”, nie błąd
  for (const k of Object.keys(missing)) if (res[k] === undefined) res[k] = OPTIONAL.includes(k) ? 'n/a' : '>2';
  const bad = Object.entries(res).filter(([, v]) => !(v === 1 || v === 2 || v === 'n/a' || (typeof v === 'string' && v.startsWith('2 ('))));
  return { ok: bad.length === 0, missing: bad.map(([k, v]) => `${k}:${v}`), map: res };
}

/** Skróty klawiszowe: skutek każdego skrótu z listy „?”. */
async function shortcuts(page) {
  const box = await probe(page, `(() => { const c = __hq.chart(); const r = c.pane.getBoundingClientRect(); return [r.left + r.width * 0.4, r.top + r.height * 0.5]; })()`);
  await page.click(box[0], box[1]);
  await sleep(300);
  const hash = () => page.ev('location.hash');
  const cockpit = () => page.ev(`JSON.parse(localStorage.getItem('hq.charts.v1.cockpit') || '{}')`);
  const out = {};
  const check = async (name, fn) => {
    try {
      out[name] = !!(await fn());
    } catch (e) {
      out[name] = false;
    }
  };
  await check('digit→interval', async () => {
    await page.key('4');
    await sleep(500);
    const ok = /i=15m/.test(await hash());
    await page.key('1');
    await sleep(500);
    return ok && /i=1m/.test(await hash());
  });
  await check('c→view', async () => {
    const before = (await hash()).match(/v=(\w+)/)?.[1];
    await page.key('c');
    await sleep(400);
    const after = (await hash()).match(/v=(\w+)/)?.[1];
    await page.key('c');
    await sleep(400);
    return before && after && before !== after;
  });
  await check('m→market', async () => {
    await page.key('m');
    await sleep(500);
    const ok = /m=ETH/.test(await hash());
    for (let i = 0; i < 3; i++) await page.key('m');
    await sleep(500);
    return ok && /m=BTC/.test(await hash());
  });
  await check('t→tape', async () => {
    const a = (await cockpit()).showTape;
    await page.key('t');
    await sleep(400);
    const b = (await cockpit()).showTape;
    await page.key('t');
    await sleep(300);
    return a !== b;
  });
  await check('a→autoscale', async () => {
    const q = `document.querySelector('[aria-label="Autoskala ceny"]')?.getAttribute('aria-pressed')`;
    const a = await page.ev(q);
    await page.key('a');
    await sleep(400);
    const b = await page.ev(q);
    await page.key('a');
    await sleep(300);
    return a !== null && a !== b;
  });
  await check('?→keys', async () => {
    await page.key('?', { code: 'Slash', shift: true });
    await sleep(400);
    const ok = await page.ev(`[...document.querySelectorAll('kbd')].some((k) => k.textContent === 'Alt+1 … 6')`);
    await page.key('Escape');
    await sleep(300);
    return ok;
  });
  await check('/→indicators', async () => {
    await page.key('/', { code: 'Slash' });
    await sleep(500);
    const ok = await page.ev(`!!document.querySelector('[role=dialog] input[aria-label="Szukaj wskaźnika"]')`);
    await page.key('Escape');
    await sleep(300);
    return ok;
  });
  await check('d→dock', async () => {
    const q = `!!document.querySelector('aside[aria-label="DOM i taśma"]')`;
    const a = await page.ev(q);
    await page.key('d');
    await sleep(500);
    const b = await page.ev(q);
    await page.key('d');
    await sleep(500);
    return a !== b;
  });
  await check('Alt+digit→layout', async () => {
    await page.key('4', { alt: true });
    await sleep(1500);
    const a = await page.ev(`JSON.parse(localStorage.getItem('hq.charts.tabs.v1') || '{}').active`);
    await page.key('3', { alt: true });
    await sleep(1500);
    const b = await page.ev(`JSON.parse(localStorage.getItem('hq.charts.tabs.v1') || '{}').active`);
    return a === 'auction-open' && b === 'cockpit';
  });
  return { ok: Object.values(out).every(Boolean), map: out };
}

/** Ustawienia użytkownika: zapisane klucze zostają, a ich pola mają te same wartości (wolno tylko dopisać nowe). */
const SEED = {
  'hq.lang': 'pl',
  'hq.charts.legend.v1': JSON.stringify({ single: false, multi: true }),
  'hq.charts.dock.v1': '0',
  'hq.charts.v1.cockpit': JSON.stringify({ coin: 'BTC', interval: '5m', view: 'candles', showVwapBands: true, showHeatmap: true, showBubbles: true, showState: true, bigTradeUsd: 250000, layersV: 2 }),
  'hq.charts.indicators.fav.v1': JSON.stringify(['ema']),
  'hq.flow.v1': JSON.stringify({ step: 'auto', minUsd: 25000, sound: false }),
};
function sameOrSuperset(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') return Object.keys(a).every((k) => sameOrSuperset(a[k], b[k]));
  return false;
}
async function persistence(page) {
  await open(page, '#charts', SEED);
  // Kilka zwykłych czynności: menu, zmiana interwału i z powrotem
  await page.click(2, 2);
  await sleep(300);
  const after = await probe(page, `__hq.storage()`);
  const lost = [];
  for (const [k, v] of Object.entries(SEED)) {
    if (!(k in after)) {
      lost.push(`${k}: brak`);
      continue;
    }
    let a;
    let b;
    try {
      a = JSON.parse(v);
      b = JSON.parse(after[k]);
    } catch {
      a = v;
      b = after[k];
    }
    if (!sameOrSuperset(a, b)) lost.push(`${k}: zmieniony`);
  }
  const added = Object.keys(after).filter((k) => !(k in SEED) && !(k in RETURNING));
  return { ok: lost.length === 0, lost, added };
}

// ───────────────────────── scenariusze ─────────────────────────
async function main() {
  await ensureServer();
  fs.mkdirSync(OUT, { recursive: true });
  const fx = LIVE ? null : createFixtures(process.cwd());
  const page = await launch({
    port: Number(opt('cdp', '9338')),
    init: fx ? [INIT, fixtureInit(FIXED_NOW, fx.stream())] : [INIT],
    intercept: fx ? fixtureIntercept(fx) : null,
    timezone: fx ? 'Europe/Warsaw' : null,
    locale: fx ? 'pl-PL' : null,
  });
  const report = { label: LABEL, at: new Date().toISOString(), base: BASE };
  try {
    // 1. Komputer 1440 × 900 bez kolumny DOM
    await page.viewport(1440, 900, false);
    await open(page, '#charts', { 'hq.charts.dock.v1': '0' });
    report.desktop = { ...(await probe(page, '__hq.paneShare()')), over: await probe(page, '__hq.overCandles()'), labels: await probe(page, '__hq.labels()'), objects: await probe(page, '__hq.objects()') };
    await shot(page, '1440');
    report.desktopReach = await reach(page, DESKTOP_FUNCS);
    report.desktopKeys = await shortcuts(page);

    // 1b. Z kolumną DOM (domyślnie włączona od 1280 px)
    await open(page, '#charts', { 'hq.charts.dock.v1': '1' });
    report.desktopDom = { ...(await probe(page, '__hq.paneShare()')), over: await probe(page, '__hq.overCandles()'), objects: await probe(page, '__hq.objects()') };
    // Kolumna DOM: widoczne poziomy drabiny (drabina rysuje tyle, ile się mieści) i pojemność listy taśmy w wierszach
    // (taśma na żywo w świeżej przeglądarce bywa jeszcze krótka, więc liczymy miejsce, nie zlecenia)
    report.domColumn = await page.ev(`(() => {
      const a = document.querySelector('aside[aria-label="DOM i taśma"]');
      if (!a) return null;
      const box = a.getBoundingClientRect();
      const ladder = [...a.querySelectorAll('section[aria-label="Drabina arkusza zleceń"] div.relative.grid.font-mono.items-center')].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= box.top && r.bottom <= box.bottom + 1; }).length;
      const tape = a.querySelector('section[aria-label="Taśma z pamięcią"] .overflow-y-auto');
      const rowH = tape?.querySelector('button')?.getBoundingClientRect().height || 24;
      return { ladderRows: ladder, tapeRowsFit: tape ? Math.floor(tape.clientHeight / rowH) : null, tapeRowH: Math.round(rowH) };
    })()`);
    await shot(page, '1440-dom');

    // 2. Telefon 390 × 844
    await page.viewport(390, 844, true);
    await open(page, '#charts');
    report.phone = { ...(await probe(page, '__hq.paneShare()')), over: await probe(page, '__hq.overCandles()'), labels: await probe(page, '__hq.labels()'), objects: await probe(page, '__hq.objects()') };
    report.phoneTargets = await probe(page, `__hq.smallTargets('[data-chart-bar]', 44)`);
    await shot(page, '390');
    // Listy paska: rogi panelu widoczne (nie ucięte przez kartę ani okno); zrzut z otwartą listą „Warstwy”
    report.phoneMenus = await probe(page, '__hq.menuCorners()');
    await page.ev(`[...document.querySelectorAll('[data-chart-bar] button[aria-haspopup]')].find((b) => /^Warstwy/.test(b.getAttribute('aria-label') || ''))?.click()`);
    await sleep(400);
    await shot(page, '390-warstwy');
    await page.key('Escape');
    await sleep(200);
    // Tryb skupienia: dotknięcie wykresu
    const c = await probe(page, `(() => { const r = __hq.chart().pane.getBoundingClientRect(); return [r.left + r.width * 0.45, r.top + r.height * 0.55]; })()`);
    await page.tap(c[0], c[1]);
    await sleep(900);
    report.phoneFocus = { ...(await probe(page, '__hq.paneShare()')), over: await probe(page, '__hq.overCandles()') };
    await shot(page, '390-focus');
    report.phoneReach = await (async () => {
      await page.tap(c[0], c[1]);
      await sleep(700);
      return reach(page, PHONE_FUNCS);
    })();
    // Tryb skupienia włączony z karty „Liczby” (menu „⋯”): widać wykres i przycisk wyjścia, Escape kończy skupienie
    await open(page, '#charts');
    report.focusFromNumbers = await (async () => {
      const tab = await page.ev(`(() => { const t = [...document.querySelectorAll('[role=tab]')].find((x) => x.textContent === 'Liczby'); if (!t) return false; t.click(); return true; })()`);
      await sleep(400);
      await page.ev(`[...document.querySelectorAll('[data-chart-bar] button[aria-haspopup]')].find((b) => /^Więcej/.test(b.getAttribute('aria-label') || ''))?.click()`);
      await sleep(400);
      const item = await page.ev(`(() => { const m = [...document.querySelectorAll('[role=menu] [role^=menuitem]')].find((b) => /Tryb skupienia/.test(b.textContent || '')); if (!m) return false; m.click(); return true; })()`);
      await sleep(900);
      const exit = await page.ev(`(() => { const b = document.querySelector('button[aria-label^="Zamknij tryb skupienia"]'); if (!b) return false; const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!el && b.contains(el); })()`);
      const share = await probe(page, '__hq.paneShare()');
      const chartShown = await page.ev(`(() => { const r = __hq.chart().pane.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!el && el.tagName === 'CANVAS'; })()`);
      await shot(page, '390-skupienie-z-liczb');
      await page.key('Escape');
      await sleep(600);
      const back = await page.ev(`!document.querySelector('button[aria-label^="Zamknij tryb skupienia"]') && !!document.querySelector('[data-chart-bar]')`);
      return { tab, item, exit, chartShown, share: share?.share ?? null, escape: back, ok: !!(tab && item && exit && chartShown && back) };
    })();
    // Lista wskaźników: ile pozycji widać na ekranie
    await open(page, '#charts');
    // Wskaźniki: przed zmianą ikona w pasku, po zmianie pozycja menu „⋯”
    const direct = await page.ev(`(() => { const b = [...document.querySelectorAll('button')].find((b) => /^Wskaźniki/.test(b.getAttribute('aria-label') || '')); if (b) { b.click(); return true; } return false; })()`);
    if (!direct) {
      await page.ev(`[...document.querySelectorAll('[data-chart-bar] button[aria-haspopup]')].find((b) => /^Więcej/.test(b.getAttribute('aria-label') || ''))?.click()`);
      await sleep(400);
      await page.ev(`[...document.querySelectorAll('[role=menu] [role^=menuitem]')].find((b) => /^Wskaźniki/.test(b.textContent || ''))?.click()`);
    }
    await sleep(800);
    report.phoneIndicators = await page.ev(
      `(() => { const nav = [...document.querySelectorAll('nav')].find((n) => getComputedStyle(n).position === 'fixed'); const lim = nav ? nav.getBoundingClientRect().top : innerHeight; return [...document.querySelectorAll('[role=dialog] [role=option]')].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= lim; }).length; })()`
    );
    await shot(page, '390-wskazniki');
    // Telefon poziomo
    await page.viewport(844, 390, true);
    await open(page, '#charts');
    report.phoneLandscape = await probe(page, '__hq.paneShare()');
    await shot(page, '844-poziomo');

    // 3. Etykiety na nagranej dobie (powtórka z kopii przy lekcjach)
    await page.viewport(1440, 900, false);
    await open(page, REPLAY);
    await sleep(4000);
    await page.mouseAway();
    await sleep(600);
    report.replayDesktop = { labels: await probe(page, '__hq.labels()'), over: await probe(page, '__hq.overCandles()'), objects: await probe(page, '__hq.objects()') };
    await shot(page, '1440-powtorka');
    await page.viewport(390, 844, true);
    await open(page, REPLAY);
    await sleep(4000);
    report.replayPhone = { labels: await probe(page, '__hq.labels()'), objects: await probe(page, '__hq.objects()') };
    await shot(page, '390-powtorka');

    // Szlif 1: wskaźnik Effort na powtórce 24.10 (390, potem 1440)
    report.effort = {};
    await open(page, EFFORT_REPLAY, EFFORT_STORE);
    await sleep(4000);
    report.effort.phone = await probe(page, effortRects);
    await shot(page, '390-effort');
    await page.viewport(1440, 900, false);
    await open(page, EFFORT_REPLAY, EFFORT_STORE);
    await sleep(4000);
    await page.mouseAway();
    await sleep(400);
    report.effort.desktop = await probe(page, effortRects);
    await shot(page, '1440-effort');

    // Szlif 3: ściany i serie w Kokpicie 1m na powtórce (1440)
    report.clashes = {};
    await open(page, CLASH_REPLAY);
    await sleep(4000);
    await page.mouseAway();
    await sleep(400);
    report.clashes.desktop = await probe(page, clashCount);
    await shot(page, '1440-sciany');
    // Szlif 4: bąble zleceń w Kokpicie 1m na powtórce (1440, potem 390)
    report.bubbles = {};
    await open(page, BUBBLE_REPLAY);
    await sleep(4000);
    await page.mouseAway();
    await sleep(400);
    report.bubbles.desktop = await probe(page, bubbleCount);
    await shot(page, '1440-bable');
    await page.viewport(390, 844, true);
    await open(page, BUBBLE_REPLAY);
    await sleep(4000);
    report.bubbles.phone = await probe(page, bubbleCount);
    await shot(page, '390-bable');
    await page.viewport(1440, 900, false);
    // Szlif 2: strefy nierównowagi i aukcje w „Aukcja i otwarcie” (1440, potem 390)
    report.zones = {};
    await open(page, ZONES_REPLAY);
    await sleep(4000);
    await page.mouseAway();
    await sleep(400);
    report.zones.desktop = await probe(page, zoneCounts);
    await shot(page, '1440-strefy');
    await page.viewport(390, 844, true);
    await open(page, ZONES_REPLAY);
    await sleep(4000);
    report.zones.phone = await probe(page, zoneCounts);
    await shot(page, '390-strefy');
    await page.viewport(1440, 900, false);

    // Szlif 5: zakres początkowy sesji w „Aukcja i otwarcie” i „Rozliczenie doby” (1440, potem 390)
    report.ib = {};
    for (const [name, hash, store] of IB_VIEWS) {
      report.ib[name] = {};
      await page.viewport(1440, 900, false);
      await open(page, hash, store);
      await page.mouseAway();
      await sleep(400);
      report.ib[name].desktop = await probe(page, ibCount);
      await shot(page, `1440-zakres-${name}`);
      await page.viewport(390, 844, true);
      await open(page, hash, store);
      await sleep(400);
      report.ib[name].phone = await probe(page, ibCount);
      await shot(page, `390-zakres-${name}`);
    }
    await page.viewport(1440, 900, false);
    // Szlif 6: profile dób w „Mapie dnia” i „Rozliczeniu doby” (1440, potem 390)
    report.profiles = {};
    for (const [name, hash, store] of PROFILE_VIEWS) {
      report.profiles[name] = {};
      await page.viewport(1440, 900, false);
      await open(page, hash, store);
      await page.mouseAway();
      await sleep(400);
      report.profiles[name].desktop = await probe(page, profileCounts);
      await shot(page, `1440-profile-${name}`);
      await page.viewport(390, 844, true);
      await open(page, hash, store);
      await sleep(400);
      report.profiles[name].phone = await probe(page, profileCounts);
      await shot(page, `390-profile-${name}`);
    }
    await page.viewport(1440, 900, false);

    // Szlif 9: progi rynków HIP-4 w Kokpicie 5m (1440, potem 390)
    report.hip4 = {};
    await page.viewport(1440, 900, false);
    await open(page, '#charts', HIP4_STORE);
    await page.mouseAway();
    await sleep(400);
    report.hip4.desktop = await probe(page, hip4Count);
    await shot(page, '1440-hip4');
    await page.viewport(390, 844, true);
    await open(page, '#charts', HIP4_STORE);
    await sleep(400);
    report.hip4.phone = await probe(page, hip4Count);
    await shot(page, '390-hip4');
    await page.viewport(1440, 900, false);

    // Szlif 7: poziomy dnia i linie sesji w „Mapie dnia” i „Rozliczeniu doby” (1440, potem 390)
    report.levels = {};
    for (const [name, hash, store] of LEVEL_VIEWS) {
      report.levels[name] = {};
      await page.viewport(1440, 900, false);
      await open(page, hash, store);
      await page.mouseAway();
      await sleep(400);
      report.levels[name].desktop = await probe(page, levelCounts);
      await shot(page, `1440-poziomy-${name}`);
      await page.viewport(390, 844, true);
      await open(page, hash, store);
      await sleep(400);
      report.levels[name].phone = await probe(page, levelCounts);
      await shot(page, `390-poziomy-${name}`);
    }
    await page.viewport(1440, 900, false);

    // 4. Ustawienia użytkownika
    await page.viewport(1440, 900, false);
    report.storage = await persistence(page);

    // Inne ekrany ze wspólnymi komponentami: Przed sesją, Po sesji, Aukcja i otwarcie, Wielkie ręce
    for (const [name, hash, store] of [
      ['przed', '#before', {}],
      ['po', '#after', {}],
      ['aukcja', '#charts', { 'hq.charts.phaseActive.v1': JSON.stringify({ before: 'day-map', session: 'auction-open', after: 'review' }), 'hq.charts.tabs.v1': JSON.stringify({ v: 2, tabs: [], active: 'auction-open' }) }],
      ['wielkie-rece', '#charts', { 'hq.charts.phaseActive.v1': JSON.stringify({ before: 'day-map', session: 'big-hands', after: 'review' }), 'hq.charts.tabs.v1': JSON.stringify({ v: 2, tabs: [], active: 'big-hands' }) }],
    ]) {
      await open(page, hash, store);
      report[`view-${name}`] = { ...(await probe(page, '__hq.paneShare()')), over: await probe(page, '__hq.overCandles()'), objects: await probe(page, '__hq.objects()'), errors: page.errors.splice(0) };
      await shot(page, `1440-${name}`);
    }
    report.network = { mode: LIVE ? 'live' : 'fixtures', served: page.intercepted.served, blocked: page.intercepted.failed.length, blockedSample: [...new Set(page.intercepted.failed.map((u) => new URL(u).hostname))].sort() };
  } finally {
    page.close();
    stopServer();
  }

  // ───────────────────────── wynik ─────────────────────────
  const r = report;
  const pct = (x) => (x ? `${(x.share * 100).toFixed(1)}%` : '—');
  const ok = (b) => (b ? 'OK' : 'NIE');
  const t1 = r.desktop?.share >= LIMITS.desktop && r.desktopDom?.share >= LIMITS.desktopDom;
  const t2 = r.phone?.share >= LIMITS.phone && r.phoneFocus?.share >= LIMITS.focus && !!r.focusFromNumbers?.ok;
  const t3 = [r.desktop, r.desktopDom, r.phone].every((x) => x?.over?.count === 0);
  const lab = (x) => (x?.labels ? x.labels.pane.n + x.labels.axis.n : Number.NaN);
  const t4 = [r.replayDesktop, r.replayPhone, r.desktop, r.phone].every((x) => lab(x) === 0);
  const t5 = r.desktopReach?.ok && r.phoneReach?.ok && r.desktopKeys?.ok && r.phoneMenus?.cut?.length === 0;
  const t6 = r.storage?.ok;
  // Szlif 1 (Effort): limit prostokątów wskaźnika; bez atrybutu (wersja sprzed wyboru warstwy) — brak liczby
  const s1 = typeof r.effort?.desktop === 'number' && typeof r.effort?.phone === 'number' && r.effort.desktop <= EFFORT_MAX.desktop && r.effort.phone <= EFFORT_MAX.phone;
  const s3 = typeof r.clashes?.desktop === 'number' && r.clashes.desktop <= CLASH_MAX;
  const zoneOk = (x) => !!x && x.rects <= ZONES_MAX.rects && x.lines <= ZONES_MAX.lines;
  const s2 = zoneOk(r.zones?.desktop) && zoneOk(r.zones?.phone);
  const s4 =
    typeof r.bubbles?.desktop === 'number' &&
    typeof r.bubbles?.phone === 'number' &&
    r.bubbles.desktop >= BUBBLES.min &&
    r.bubbles.desktop <= BUBBLES.max &&
    r.bubbles.phone <= BUBBLES.phoneMax;
  const s5 = IB_VIEWS.every(([name]) => [r.ib?.[name]?.desktop, r.ib?.[name]?.phone].every((n) => typeof n === 'number' && n <= IB_MAX));
  // Szlif 6: każda warstwa profili, która jest na ekranie, w limitach; TPO musi być w obu układach
  const tpoOk = (v) => !!v?.desktop?.tpo && !!v?.phone?.tpo && v.desktop.tpo.objects <= PROFILE_MAX.objects && v.desktop.tpo.area <= PROFILE_MAX.area1440 && v.phone.tpo.area <= PROFILE_MAX.area390;
  const periodsOk = (v) => (!v?.desktop?.periods || v.desktop.periods.area <= PROFILE_MAX.area1440) && (!v?.phone?.periods || v.phone.periods.area <= PROFILE_MAX.area390);
  const s6 = PROFILE_VIEWS.every(([name]) => tpoOk(r.profiles?.[name]) && periodsOk(r.profiles?.[name]));
  // Szlif 7: „Mapa dnia” na komputerze ma wykres 4h z poziomami (najwyżej 3); wszędzie najwyżej 6 linii poziomów i 6 linii sesji
  const lvOk = (d) => !d || (d.levels <= LEVELS_MAX.lines && d.sessions <= LEVELS_MAX.sessions);
  const s7 =
    typeof r.levels?.dayMap?.desktop?.levels4h === 'number' &&
    r.levels.dayMap.desktop.levels4h <= LEVELS_MAX.h4 &&
    typeof r.levels?.review?.desktop?.sessions === 'number' &&
    LEVEL_VIEWS.every(([name]) => lvOk(r.levels?.[name]?.desktop) && lvOk(r.levels?.[name]?.phone));
  // Szlif 9: linie progów HIP-4 w limitach; fikstura ma 14 płynnych rynków, więc na komputerze co najmniej jedna, na telefonie dokładnie jedna
  const s9 = typeof r.hip4?.desktop === 'number' && typeof r.hip4?.phone === 'number' && r.hip4.desktop >= 1 && r.hip4.desktop <= HIP4_MAX.desktop && r.hip4.phone === HIP4_MAX.phone;
  r.summary = { t1, t2, t3, t4, t5, t6, s1, s2, s3, s4, s5, s6, s7, s9 };
  const lines = [
    `Pomiar „${LABEL}” (${BASE})`,
    `1. Panel ceny 1440×900: ${pct(r.desktop)} (próg 62%, zapas ${margin(r.desktop?.share ?? 0, LIMITS.desktop)}), z kolumną DOM: ${pct(r.desktopDom)} (próg 60%, zapas ${margin(r.desktopDom?.share ?? 0, LIMITS.desktopDom)}) — ${ok(t1)}`,
    `2. Panel ceny 390×844: ${pct(r.phone)} (próg 60%, zapas ${margin(r.phone?.share ?? 0, LIMITS.phone)}), tryb skupienia: ${pct(r.phoneFocus)} (próg 80%, zapas ${margin(r.phoneFocus?.share ?? 0, LIMITS.focus)}), poziomo 844×390: ${pct(r.phoneLandscape)} — ${ok(t2)}`,
    `3. Elementy DOM nad świecami: 1440 ${r.desktop?.over?.count}, z DOM ${r.desktopDom?.over?.count}, 390 ${r.phone?.over?.count} — ${ok(t3)}`,
    `4. Nachodzące etykiety (wykres + oś): powtórka 1440 ${lab(r.replayDesktop)}, powtórka 390 ${lab(r.replayPhone)}, na żywo 1440 ${lab(r.desktop)}, 390 ${lab(r.phone)} — ${ok(t4)}`,
    `5. Funkcje w ≤ 2 kliknięciach: komputer ${r.desktopReach?.ok ? 'wszystkie' : r.desktopReach?.missing.join(', ')}, telefon ${r.phoneReach?.ok ? 'wszystkie' : r.phoneReach?.missing.join(', ')}; skróty ${r.desktopKeys?.ok ? 'działają' : JSON.stringify(r.desktopKeys?.map)} — ${ok(t5)}`,
    `   Listy paska 390×844: sprawdzone ${r.phoneMenus?.checked ?? '—'}, z uciętym panelem: ${r.phoneMenus ? r.phoneMenus.cut.length || 'brak' : '—'}${r.phoneMenus?.cut?.length ? ` (${r.phoneMenus.cut.join(', ')})` : ''}; skupienie z karty Liczby: ${r.focusFromNumbers ? (r.focusFromNumbers.ok ? `wykres i wyjście widoczne, Escape kończy (panel ceny ${(r.focusFromNumbers.share * 100).toFixed(1)}%)` : JSON.stringify(r.focusFromNumbers)) : '—'}`,
    `6. Ustawienia w localStorage: ${r.storage?.ok ? 'zachowane' : r.storage?.lost.join(', ')} — ${ok(t6)}`,
    `   Lista wskaźników na telefonie: ${r.phoneIndicators} pozycji na ekranie; cele dotyku < 44 px w pasku: ${r.phoneTargets?.length ?? '—'}`,
    `   Kolumna DOM 1440×900: poziomy drabiny ${r.domColumn?.ladderRows ?? '—'}, wiersze taśmy (miejsce) ${r.domColumn?.tapeRowsFit ?? '—'}`,
  ];
  // Obiekty na płótnach panelu ceny na widok (punkt odniesienia szlifów) i porównanie z baseline.json dla tego systemu
  const obj = (x) => (x?.objects ? `podpisy ${x.objects.labels}, bąble ${x.objects.bubbles}, prostokąty ${x.objects.rects}, podpisy osi ${x.objects.axisLabels}` : '—');
  lines.push(
    `   Obiekty na płótnie panelu ceny — na żywo 1440: ${obj(r.desktop)}; z DOM: ${obj(r.desktopDom)}; 390: ${obj(r.phone)}`,
    `   Obiekty — powtórka 24.10 1440: ${obj(r.replayDesktop)}; powtórka 390: ${obj(r.replayPhone)}`,
    `Szlif 2. Strefy nierównowagi / linie aukcji („Aukcja i otwarcie”, powtórka 24.10 19:30, 5m): 1440 ${r.zones?.desktop ? `${r.zones.desktop.rects} / ${r.zones.desktop.lines}` : '—'}, 390 ${r.zones?.phone ? `${r.zones.phone.rects} / ${r.zones.phone.lines}` : '—'} (limit ${ZONES_MAX.rects} / ${ZONES_MAX.lines}) — ${ok(s2)}`,
    `Szlif 3. Ściany i serie (Kokpit 1m, powtórka 24.10 19:30): 1440 ${r.clashes?.desktop ?? '—'} (limit ${CLASH_MAX}) — ${ok(s3)}`,
    `Szlif 4. Bąble zleceń (Kokpit 1m, powtórka 24.10 19:30): 1440 ${r.bubbles?.desktop ?? '—'}, 390 ${r.bubbles?.phone ?? '—'} (1440: ${BUBBLES.min}–${BUBBLES.max}, 390: do ${BUBBLES.phoneMax}) — ${ok(s4)}`,
    `Szlif 5. Zakres początkowy sesji (dane stałe): „Aukcja i otwarcie” 5m 1440 ${r.ib?.auction?.desktop ?? '—'}, 390 ${r.ib?.auction?.phone ?? '—'}; „Rozliczenie doby” 30m 1440 ${r.ib?.review?.desktop ?? '—'}, 390 ${r.ib?.review?.phone ?? '—'} (limit ${IB_MAX}) — ${ok(s5)}`,
    `Szlif 6. Profile dób (dane stałe; obiekty / pole %): ${PROFILE_VIEWS.map(([name]) => {
      const v = r.profiles?.[name];
      const f = (c) => (c ? `${c.objects} / ${c.area}%` : '—');
      return `${name}: TPO 1440 ${f(v?.desktop?.tpo)}, 390 ${f(v?.phone?.tpo)}; profile okresów 1440 ${f(v?.desktop?.periods)}`;
    }).join('; ')} (limit TPO ${PROFILE_MAX.objects} obiektów; pole ${PROFILE_MAX.area1440}% / ${PROFILE_MAX.area390}%) — ${ok(s6)}`,
    `Szlif 9. Progi rynków HIP-4 (Kokpit 5m, dane stałe, 14 płynnych rynków): 1440 ${r.hip4?.desktop ?? '—'}, 390 ${r.hip4?.phone ?? '—'} (limit ${HIP4_MAX.desktop} / ${HIP4_MAX.phone}) — ${ok(s9)}`,
    `Szlif 7. Poziomy dnia / linie sesji (dane stałe): „Mapa dnia” 1440: 4h ${r.levels?.dayMap?.desktop?.levels4h ?? '—'}, wszystkie wykresy ${r.levels?.dayMap?.desktop ? `${r.levels.dayMap.desktop.levels} / ${r.levels.dayMap.desktop.sessions}` : '—'}; „Rozliczenie doby” 30m 1440 ${r.levels?.review?.desktop ? `${r.levels.review.desktop.levels} / ${r.levels.review.desktop.sessions}` : '—'}, 390 ${r.levels?.review?.phone ? `${r.levels.review.phone.levels} / ${r.levels.review.phone.sessions}` : '—'} (limit: 4h ${LEVELS_MAX.h4} poziomy, sesje ${LEVELS_MAX.sessions}) — ${ok(s7)}`,
    `Szlif 1. Prostokąty wskaźnika Effort (powtórka 24.10 19:30, BTC 5m): 1440 ${r.effort?.desktop ?? '—'} (limit ${EFFORT_MAX.desktop}), 390 ${r.effort?.phone ?? '—'} (limit ${EFFORT_MAX.phone}) — ${ok(s1)}`
  );
  const metrics = metricsOf(r);
  let baseDiff = [];
  if (!LIVE) {
    const file = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : { platforms: {} };
    if (UPDATE) {
      file.platforms[process.platform] = metrics;
      fs.writeFileSync(BASELINE, `${JSON.stringify(file, null, 2)}\n`);
      lines.push(`   Punkt odniesienia zapisany dla ${process.platform} (${Object.keys(metrics).length} liczb) w scripts/ui/baseline.json`);
    } else if (file.platforms[process.platform]) {
      baseDiff = compareBaseline(metrics, file.platforms[process.platform]);
      lines.push(`   Punkt odniesienia (${process.platform}): ${baseDiff.length === 0 ? 'zgodny' : `różnice: ${baseDiff.join('; ')}`}`);
    } else lines.push(`   Punkt odniesienia: brak zapisu dla ${process.platform} — porównanie pominięte (zapis: --update-baseline)`);
  }
  lines.push(`   Sieć: ${r.network?.mode === 'live' ? 'prawdziwa' : `dane stałe (zegar ${new Date(FIXED_NOW).toISOString()}, API Hyperliquid z scripts/ui/fixtures.mjs), zablokowane hosty: ${r.network?.blockedSample?.join(', ') || 'brak'}`}`);
  r.metrics = metrics;
  r.baselineDiff = baseDiff;
  console.log(lines.join('\n'));
  fs.writeFileSync(path.join(OUT, `${LABEL}.json`), JSON.stringify(r, null, 2));
  if (STRICT && (!Object.values(r.summary).every(Boolean) || baseDiff.length > 0)) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  stopServer();
  process.exitCode = 2;
});
