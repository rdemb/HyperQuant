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
import { DATA_BASE_URL, FIXED_NOW, createFixtures, registry } from './fixtures.mjs';
import { MARTWE_GNIAZDO, PLIKI_APLIKACJI, TEKST_BEZ_ETYKIET, cyfryPozaEtykietami, noweWidoki } from './pustyStan.mjs';
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

/** Rejestr rynków z danych stałych (`markets.json`) podawany stronie — włączany przed przebiegiem rynków. */
let serveRegistry = false;

/**
 * Żądania strony w trybie danych stałych: pliki strony z serwera podglądu (bez danych publicznych z public/data/feeds,
 * których w repozytorium nie ma), API Hyperliquid z danych stałych, rejestr rynków z adresu danych buildu pomiaru
 * (`scripts/ui/build.mjs`), cała reszta sieci — błąd jak bez połączenia.
 */
/** Plik strony blokowany w przebiegu „przeładowanie po wdrożeniu” (stary plik leniwego modułu po podmianie strony). */
let blokuj = null;
/** Przebieg „pusty stan”: API giełdy i dane skanera niedostępne (widok bez danych). */
let bezDanych = false;

function fixtureIntercept(fx) {
  const origin = new URL(BASE).origin;
  const data = new URL(DATA_BASE_URL);
  return (req) => {
    if (/^(data|blob):/.test(req.url)) return 'continue';
    const u = new URL(req.url);
    if (u.origin === origin && blokuj && u.pathname.endsWith(blokuj)) return 'fail';
    if (bezDanych && (u.origin !== origin || !PLIKI_APLIKACJI.test(u.pathname))) return 'fail';
    if (u.origin === origin) return u.pathname.includes('/data/feeds/') ? { status: 404, body: '', type: 'text/plain' } : 'continue';
    // Dane skanera: tylko rejestr rynków i tylko w przebiegu rynków (wcześniej strona ma 4 rynki domyślne, jak bez pliku)
    if (u.origin === data.origin) return serveRegistry && u.pathname === `${data.pathname}/markets.json` ? { body: JSON.stringify(registry()) } : 'fail';
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
/**
 * Zakresy P/b (Nill): Kokpit 5m z zapisem, w którym wskaźnik jest włączony, na danych stałych (wskaźnik działa na żywo,
 * w powtórce jest wyłączony), 1440 i 390. Liczby z wyboru warstwy (`pbSelect`, atrybuty `data-pb-boxes`, `data-pb-lines`,
 * `data-pb-marks`). Limity z projektu: najwyżej 2 pudełka, 4 linie poziomów i 3 znaczniki 👀.
 */
const PB_STORE = {
  'hq.charts.v1.cockpit': JSON.stringify({
    coin: 'BTC',
    interval: '5m',
    view: 'candles',
    layersV: 2,
    indicators: [{ iid: 'pbrange', id: 'pbrange', params: {}, color: '#7C8CFF', alpha: 1, width: 1, labels: true, visible: true }],
  }),
};
const PB_MAX = { boxes: 2, lines: 4, marks: 3 };
const pbCounts = `(() => { const c = window.__hq.chart(); const host = c && c.root.closest('[data-pb-boxes]'); return host ? { boxes: Number(host.dataset.pbBoxes), lines: Number(host.dataset.pbLines), marks: Number(host.dataset.pbMarks) } : null; })()`;
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

// ───────────────────────── inne rynki (M1: HYPE i rynek HIP-3) ─────────────────────────
/**
 * Rynki poza BTC na danych stałych (minuty BTC przeskalowane do ceny rynku, rejestr rynków z xyz:NVDA), 1440 bez kolumny
 * DOM i 390: te same limity obiektów co na BTC (elementy DOM nad świecami, nachodzące etykiety), bez wyjątków i
 * `console.error` strony, bez „NaN” w tekście, właściwy rynek w legendzie (na telefonie legenda nie ma symbolu — pole
 * wyboru rynku w pasku). Warstwy skanera pokazują tam „—”, więc szlify zależne od skanera i powtórki BTC są pominięte.
 */
const MARKETS = ['HYPE', 'xyz:NVDA'];
const marketShown = `(() => {
  const legend = [...document.querySelectorAll('[data-chart-legend]')].map((e) => ((e.textContent || '').match(/([A-Za-z0-9]+(?::[A-Za-z0-9]+)?)-PERP/) || [])[1]).filter(Boolean);
  const sel = document.querySelector('select[aria-label="Rynek"]');
  const btn = document.querySelector('button[aria-label^="Rynek: "]');
  return { legend, picker: sel ? sel.value : btn ? btn.getAttribute('aria-label').slice(7) : null };
})()`;
const nanText = `(() => [...document.body.innerText.matchAll(/.{0,24}\\b(NaN|Infinity)\\b.{0,24}/g)].map((m) => m[0].trim()).slice(0, 5))()`;

// ───────────────────────── widok „Rynki” (#markets) ─────────────────────────
/**
 * Tabela rynków na danych stałych z rejestrem (`registry()`): 1440 × 900, 1024 × 768 i 390 × 844. Wiersz dla każdego rynku
 * rejestru z odczytem LIVE w mniej niż 3 s od wejścia, bez poziomego przewijania strony (tabela przewija się w swoim
 * pudełku), bez wyjątków, `console.error` i „NaN”. Nagłówek (komputer): żadna liczba rynku nie jest ucięta przy prawej
 * krawędzi (pozycja, która się nie mieści, znika cała), cena widoczna w całości. Telefon: „Rynki” w menu „Więcej”.
 */
const RYNKI_VIEWPORTS = [
  ['1440', 1440, 900, false],
  ['1024', 1024, 768, false],
  ['390', 390, 844, true],
];
const RYNKI_MAX_MS = 3000;
/** Etykieta Wall Street xyz:NVDA (klasa akcji w rejestrze danych stałych) przy zegarze stałych danych: sobota 24.10.2026. */
const RYNKI_WALL_STREET = 'zamknięta';
const rynkiRows = `(() => { const rows = [...document.querySelectorAll('[data-market-row]')]; return rows.length > 0 && rows.every((r) => /LIVE/.test(r.textContent)) ? rows.length : 0; })()`;
const headerCut = `(() => {
  const t = document.querySelector('[data-header-ticker]');
  if (!t || t.getBoundingClientRect().width === 0) return null;
  const right = t.getBoundingClientRect().right + 0.5;
  const shown = [...t.querySelectorAll('button, [data-ticker-item]')].filter((e) => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && e.getBoundingClientRect().width > 0; });
  return { shown: shown.map((e) => (e.textContent || '').trim().slice(0, 16)), cut: shown.filter((e) => e.getBoundingClientRect().right > right).map((e) => (e.textContent || '').trim().slice(0, 16)) };
})()`;

// ───────────────────────── nowy wygląd (?ui=nowy) ─────────────────────────
/**
 * Nowa powłoka (przełącznik hq.ui.v1): 1440 × 900, 1024 × 768 i 390 × 844. Atrybut data-ui, dokładnie jedna nawigacja
 * (szyna na komputerze, dolny pasek na telefonie), bez przewijania strony i nagłówka w bok, cena w całości na ekranie,
 * nagłówki fontem nowego wyglądu (nie Outfit), paleta ⌘K otwiera się i zamyka Escape, bez błędów i NaN. Osobno od progów
 * starej powłoki (punkt odniesienia bez zmian); udział panelu ceny zapisany do porównań kolejnych etapów.
 */
const NOWY_VIEWPORTS = [
  ['1440', 1440, 900, false],
  // 1280: najciaśniejszy nagłówek (od xl liczby rynku, wybór wykresu i język)
  ['1280', 1280, 800, false],
  ['1024', 1024, 768, false],
  ['390', 390, 844, true],
];
const NOWY_PROBE = `(() => {
  const vis = (e) => { if (!e) return false; const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const head = document.querySelector('[data-app-header]');
  const row = head?.firstElementChild;
  const cena = head?.querySelector('button[aria-expanded]');
  const cr = cena?.getBoundingClientRect();
  const marka = document.querySelector('[data-marka]');
  const wykres = [...document.querySelectorAll('[data-view-root] .font-mono')].find(vis);
  return {
    ui: document.documentElement.dataset.ui ?? null,
    nawigacje: [...document.querySelectorAll('[data-szyna], [data-app-nav]')].filter(vis).length,
    szyna: vis(document.querySelector('[data-szyna]')),
    overflowX: document.documentElement.scrollWidth - innerWidth,
    naglowekX: row ? row.scrollWidth - row.clientWidth : null,
    cena: cr ? cr.left >= 0 && cr.right <= innerWidth + 0.5 && cr.width > 0 : false,
    // Cena niczym niezasłonięta (środek i prawa krawędź przycisku należą do niego)
    cenaOdkryta: cr ? [[cr.left + cr.width / 2, cr.top + cr.height / 2], [cr.right - 2, cr.top + cr.height / 2]].every(([x, y]) => { const el = document.elementFromPoint(x, y); return !!el && cena.contains(el); }) : false,
    // Widoczne kontrolki nagłówka, które na siebie nachodzą (pary)
    nakladanie: (() => {
      const els = [...(row?.querySelectorAll('a, button, label, select, [role="group"], [data-testid]') ?? [])].filter((e) => vis(e) && !e.closest('[role="group"] button, label select') && !e.parentElement?.closest('a, button, label, [role="group"]'));
      const out = [];
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
        const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect();
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push((els[i].textContent || els[i].getAttribute('aria-label') || '').trim().slice(0, 12) + ' × ' + (els[j].textContent || els[j].getAttribute('aria-label') || '').trim().slice(0, 12));
      }
      return out;
    })(),
    font: marka ? getComputedStyle(marka).fontFamily.split(',')[0].replace(/["']/g, '').trim() : null,
    // Wykresy i widoki bez zmian: font mono w widoku taki sam jak w obecnej powłoce
    fontWidoku: wykres ? getComputedStyle(wykres).fontFamily.split(',')[0].replace(/["']/g, '').trim() : null,
    panel: window.__hq?.paneShare?.()?.share ?? null,
  };
})()`;

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
    // Szlif 8: zakresy P/b w Kokpicie 5m (1440, potem 390)
    report.pb = {};
    await page.viewport(1440, 900, false);
    await open(page, '#charts', PB_STORE);
    await page.mouseAway();
    await sleep(400);
    report.pb.desktop = await probe(page, pbCounts);
    await shot(page, '1440-pb');
    await page.viewport(390, 844, true);
    await open(page, '#charts', PB_STORE);
    await sleep(400);
    report.pb.phone = await probe(page, pbCounts);
    await shot(page, '390-pb');
    await page.viewport(1440, 900, false);

    // M1: HYPE i xyz:NVDA z rejestrem rynków (1440 bez kolumny DOM, potem 390); tylko w trybie danych stałych
    if (fx) {
      serveRegistry = true;
      report.markets = {};
      for (const coin of MARKETS) {
        report.markets[coin] = {};
        for (const [key, w, h, mobile, store] of [['desktop', 1440, 900, false, { 'hq.charts.dock.v1': '0' }], ['phone', 390, 844, true, {}]]) {
          await page.viewport(w, h, mobile);
          const [e0, c0] = [page.errors.length, page.consoleErrors.length];
          await open(page, `#charts?m=${coin}`, store);
          report.markets[coin][key] = {
            ...(await probe(page, '__hq.paneShare()')),
            over: await probe(page, '__hq.overCandles()'),
            labels: await probe(page, '__hq.labels()'),
            objects: await probe(page, '__hq.objects()'),
            shown: await probe(page, marketShown),
            nan: await probe(page, nanText),
            errors: page.errors.slice(e0),
            consoleErrors: page.consoleErrors.slice(c0),
          };
          await shot(page, `${w}-rynek-${coin.replace(':', '-')}`);
        }
      }
      // Widok „Rynki” z tym samym rejestrem
      report.rynkiView = {};
      for (const [key, w, h, mobile] of RYNKI_VIEWPORTS) {
        await page.viewport(w, h, mobile);
        const [e0, c0] = [page.errors.length, page.consoleErrors.length];
        await page.go(`${BASE}robots.txt`, 300);
        await page.ev(`(() => { localStorage.clear(); const s = ${JSON.stringify(RETURNING)}; for (const k in s) localStorage.setItem(k, s[k]); return true; })()`);
        const t0 = Date.now();
        await page.go(`${BASE}#markets`);
        const rows = await page.waitFor(rynkiRows, 20000, 50);
        const ms = Date.now() - t0;
        await sleep(1500);
        await page.mouseAway();
        report.rynkiView[key] = {
          rows: rows ?? 0,
          want: registry().markets.length,
          ms,
          overflowX: await page.ev('document.documentElement.scrollWidth - innerWidth'),
          header: mobile ? null : await page.ev(headerCut),
          // Etykieta Wall Street rynku klasy akcji (xyz:NVDA); zegar stałych danych to sobota 24.10, więc „zamknięta”
          wallStreet: await page.ev(`document.querySelector('[data-market-row="xyz:NVDA"] [data-wall-street]')?.dataset.wallStreet ?? null`),
          nan: await probe(page, nanText),
          errors: page.errors.slice(e0),
          consoleErrors: page.consoleErrors.slice(c0),
        };
        if (mobile) {
          await page.ev(`document.querySelector('[data-app-nav] button[aria-expanded]')?.click()`);
          await sleep(400);
          report.rynkiView[key].phoneMenu = await page.ev(`!!document.querySelector('[data-app-nav] a[href="#markets"]')`);
          await page.key('Escape');
        }
        await shot(page, `${w}-rynki`);
      }
      serveRegistry = false;
      await page.viewport(1440, 900, false);
    }

    // Nowy wygląd za przełącznikiem (hq.ui.v1 = nowy): jedna nawigacja, nagłówek bez przewijania w bok, fonty, paleta ⌘K
    report.nowy = {};
    for (const [key, w, h, mobile] of NOWY_VIEWPORTS) {
      await page.viewport(w, h, mobile);
      const [e0, c0] = [page.errors.length, page.consoleErrors.length];
      await page.go(`${BASE}robots.txt`, 300);
      await page.ev(`(() => { localStorage.clear(); const s = ${JSON.stringify({ ...RETURNING, 'hq.ui.v1': 'nowy' })}; for (const k in s) localStorage.setItem(k, s[k]); return true; })()`);
      await page.go(`${BASE}#charts`, 500);
      await page.waitFor(`!!document.querySelector('[data-nowa-powloka]') && !!document.querySelector('.tv-lightweight-charts canvas')`, 30000);
      await sleep(4000);
      await page.ev(PROBE);
      await page.mouseAway();
      const x = await page.ev(NOWY_PROBE);
      await page.ev(`document.querySelector('[data-app-header] button[aria-label="Otwórz paletę poleceń"], [data-app-header] button[aria-label="Open command palette"]')?.click()`);
      await sleep(500);
      const paletaOtwarta = await page.ev(`!!document.querySelector('[role="dialog"][aria-modal="true"] [role="combobox"]')`);
      await shot(page, `${w}-nowy-paleta`);
      await page.key('Escape');
      await sleep(500);
      const paletaZamknieta = await page.ev(`!document.querySelector('[role="dialog"][aria-modal="true"]')`);
      report.nowy[key] = { ...x, paleta: paletaOtwarta && paletaZamknieta, nan: await probe(page, nanText), errors: page.errors.slice(e0), consoleErrors: page.consoleErrors.slice(c0) };
      await shot(page, `${w}-nowy`);
    }
    await page.viewport(1440, 900, false);

    // Pusty stan: każdy widok nowego wyglądu (src/nowy/widoki.ts) bez API giełdy, danych skanera, strumienia i danych
    // z tej samej strony (lekcje, powtórki) pokazuje „—” z powodem: żadnej cyfry poza elementami [data-etykieta]
    report.pustyStan = {};
    {
      const widoki = noweWidoki(fs.readFileSync(path.resolve('src/nowy/widoki.ts'), 'utf8'));
      bezDanych = true;
      // Po atrapie strumienia z danych stałych (fixtureInit): gniazdo bez danych
      const { identifier: gniazdo } = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: MARTWE_GNIAZDO });
      for (const id of widoki) {
        await page.go(`${BASE}robots.txt`, 300);
        await page.ev(`(() => { localStorage.clear(); const s = ${JSON.stringify({ ...RETURNING, 'hq.ui.v1': 'nowy' })}; for (const k in s) localStorage.setItem(k, s[k]); return true; })()`);
        await page.go(`${BASE}#${id}`, 500);
        await sleep(6000);
        const tekst = (await page.ev(TEKST_BEZ_ETYKIET)) ?? '';
        report.pustyStan[id] = { dlugosc: tekst.trim().length, liczby: cyfryPozaEtykietami(tekst) };
        await shot(page, `1440-pusty-${id}`);
      }
      bezDanych = false;
      await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: gniazdo });
      page.errors.splice(0);
      page.consoleErrors.splice(0);
    }

    // Przeładowanie po wdrożeniu: plik leniwego widoku (Lekcje) niedostępny jak po podmianie strony. Oczekiwane dokładnie
    // jedno przeładowanie (vite:preloadError), potem ekran błędu bez pętli.
    {
      const man = JSON.parse(fs.readFileSync(path.resolve('dist/.vite/manifest.json'), 'utf8'));
      const plik = man['src/views/LessonsView.tsx']?.file ?? null;
      await open(page, '#charts');
      const { identifier } = await page.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `sessionStorage.setItem('ui-check-loads', String(Number(sessionStorage.getItem('ui-check-loads') || 0) + 1));`,
      });
      await page.ev(`(() => { sessionStorage.removeItem('hq.preloadReload.v1'); sessionStorage.setItem('ui-check-loads', '0'); return true; })()`);
      blokuj = plik ? `/${plik}` : null;
      await page.ev(`(() => { location.hash = '#lessons'; return true; })()`);
      await sleep(6000);
      const stan = `({ loads: Number(sessionStorage.getItem('ui-check-loads')), marker: !!sessionStorage.getItem('hq.preloadReload.v1'), alert: !!document.querySelector('[role="alert"]') })`;
      const po = await page.ev(stan);
      await sleep(3000);
      const pozniej = await page.ev(stan);
      blokuj = null;
      await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
      report.przeladowanie = { plik, ...po, loadsLater: pozniej.loads };
      await shot(page, '1440-przeladowanie');
      // Błędy celowo wywołane w tym przebiegu nie liczą się do kolejnych pomiarów
      page.errors.splice(0);
      page.consoleErrors.splice(0);
    }

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
  const pbOk = (c) => !!c && c.boxes <= PB_MAX.boxes && c.lines <= PB_MAX.lines && c.marks <= PB_MAX.marks;
  const s8 = pbOk(r.pb?.desktop) && pbOk(r.pb?.phone);
  r.summary = { t1, t2, t3, t4, t5, t6, s1, s2, s3, s4, s5, s6, s7, s8, s9 };
  // M1: na każdym rynku i w obu układach bez elementów nad świecami i nachodzących etykiet, bez błędów strony i NaN, właściwy rynek
  const marketOk = (coin, key) => {
    const x = r.markets?.[coin]?.[key];
    return !!x && x.over?.count === 0 && lab(x) === 0 && x.shown?.picker === coin && (key === 'phone' || x.shown?.legend?.[0] === coin) && x.nan?.length === 0 && x.errors.length === 0 && x.consoleErrors.length === 0;
  };
  if (!LIVE) r.summary.m1 = MARKETS.every((coin) => marketOk(coin, 'desktop') && marketOk(coin, 'phone'));
  // Widok „Rynki”: wszystkie rynki rejestru z odczytem LIVE w < 3 s, bez przewijania strony w bok, błędów i NaN, nagłówek bez uciętych liczb
  const rynkiOk = (key) => {
    const x = r.rynkiView?.[key];
    return (
      !!x &&
      x.rows === x.want &&
      x.ms < RYNKI_MAX_MS &&
      x.overflowX <= 0 &&
      x.nan?.length === 0 &&
      x.errors.length === 0 &&
      x.consoleErrors.length === 0 &&
      x.wallStreet === RYNKI_WALL_STREET &&
      (key === '390' ? x.phoneMenu === true : x.header?.cut?.length === 0 && /PERP/.test(x.header?.shown?.[0] ?? ''))
    );
  };
  if (!LIVE) r.summary.rynki = RYNKI_VIEWPORTS.every(([key]) => rynkiOk(key));
  // Nowy wygląd: jedna nawigacja właściwa dla ekranu, bez przewijania w bok, cena w całości, font nagłówków nie Outfit
  const nowyOk = (key) => {
    const x = r.nowy?.[key];
    return (
      !!x &&
      x.ui === 'nowy' &&
      x.nawigacje === 1 &&
      x.szyna === (key !== '390') &&
      x.overflowX <= 0 &&
      (x.naglowekX ?? 1) <= 0 &&
      x.cena === true &&
      x.cenaOdkryta === true &&
      x.nakladanie?.length === 0 &&
      x.font === 'Bricolage Grotesque Variable' &&
      x.fontWidoku === 'IBM Plex Mono' &&
      x.paleta === true &&
      x.nan?.length === 0 &&
      x.errors.length === 0 &&
      x.consoleErrors.length === 0
    );
  };
  r.summary.nowy = NOWY_VIEWPORTS.every(([key]) => nowyOk(key));
  r.summary.pustyStan = Object.values(r.pustyStan ?? {}).every((x) => x.dlugosc > 0 && x.liczby.length === 0);
  const prz = r.przeladowanie;
  r.summary.przeladowanie = !!prz?.plik && prz.loads === 1 && prz.marker === true && prz.alert === true && prz.loadsLater === 1;
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
    `Szlif 8. Zakresy P/b (Kokpit 5m, dane stałe; pudełka / linie / 👀): 1440 ${r.pb?.desktop ? `${r.pb.desktop.boxes} / ${r.pb.desktop.lines} / ${r.pb.desktop.marks}` : '—'}, 390 ${r.pb?.phone ? `${r.pb.phone.boxes} / ${r.pb.phone.lines} / ${r.pb.phone.marks}` : '—'} (limit ${PB_MAX.boxes} / ${PB_MAX.lines} / ${PB_MAX.marks}) — ${ok(s8)}`,
    `Szlif 6. Profile dób (dane stałe; obiekty / pole %): ${PROFILE_VIEWS.map(([name]) => {
      const v = r.profiles?.[name];
      const f = (c) => (c ? `${c.objects} / ${c.area}%` : '—');
      return `${name}: TPO 1440 ${f(v?.desktop?.tpo)}, 390 ${f(v?.phone?.tpo)}; profile okresów 1440 ${f(v?.desktop?.periods)}`;
    }).join('; ')} (limit TPO ${PROFILE_MAX.objects} obiektów; pole ${PROFILE_MAX.area1440}% / ${PROFILE_MAX.area390}%) — ${ok(s6)}`,
    `Szlif 9. Progi rynków HIP-4 (Kokpit 5m, dane stałe, 14 płynnych rynków): 1440 ${r.hip4?.desktop ?? '—'}, 390 ${r.hip4?.phone ?? '—'} (limit ${HIP4_MAX.desktop} / ${HIP4_MAX.phone}) — ${ok(s9)}`,
    `Szlif 7. Poziomy dnia / linie sesji (dane stałe): „Mapa dnia” 1440: 4h ${r.levels?.dayMap?.desktop?.levels4h ?? '—'}, wszystkie wykresy ${r.levels?.dayMap?.desktop ? `${r.levels.dayMap.desktop.levels} / ${r.levels.dayMap.desktop.sessions}` : '—'}; „Rozliczenie doby” 30m 1440 ${r.levels?.review?.desktop ? `${r.levels.review.desktop.levels} / ${r.levels.review.desktop.sessions}` : '—'}, 390 ${r.levels?.review?.phone ? `${r.levels.review.phone.levels} / ${r.levels.review.phone.sessions}` : '—'} (limit: 4h ${LEVELS_MAX.h4} poziomy, sesje ${LEVELS_MAX.sessions}) — ${ok(s7)}`,
    `Szlif 1. Prostokąty wskaźnika Effort (powtórka 24.10 19:30, BTC 5m): 1440 ${r.effort?.desktop ?? '—'} (limit ${EFFORT_MAX.desktop}), 390 ${r.effort?.phone ?? '—'} (limit ${EFFORT_MAX.phone}) — ${ok(s1)}`
  );
  if (r.markets) {
    const one = (x) =>
      x
        ? `rynek ${x.shown?.legend?.[0] ?? x.shown?.picker ?? '—'}, panel ceny ${pct(x)}, nad świecami ${x.over?.count}, nachodzące etykiety ${lab(x)}, ${obj(x)}, błędy strony ${x.errors.length + x.consoleErrors.length}${x.errors.length + x.consoleErrors.length ? ` (${[...x.errors, ...x.consoleErrors].map((e) => e.split('\n')[0]).join(' | ')})` : ''}, NaN ${x.nan?.length ?? '—'}${x.nan?.length ? ` (${x.nan.join(' | ')})` : ''}`
        : '—';
    for (const coin of MARKETS) lines.push(`M1. ${coin} (dane stałe, rejestr rynków): 1440 ${one(r.markets[coin]?.desktop)}; 390 ${one(r.markets[coin]?.phone)} — ${ok(marketOk(coin, 'desktop') && marketOk(coin, 'phone'))}`);
  }
  if (r.rynkiView) {
    const one = (key) => {
      const x = r.rynkiView[key];
      if (!x) return '—';
      const errs = [...x.errors, ...x.consoleErrors].map((e) => e.split('\n')[0]);
      const head = key === '390' ? `„Rynki” w menu telefonu: ${x.phoneMenu ? 'tak' : 'nie'}` : `nagłówek: ${x.header ? `widoczne ${x.header.shown.join(' | ')}, ucięte ${x.header.cut.length ? x.header.cut.join(' | ') : 'brak'}` : '—'}`;
      return `${key}: wiersze ${x.rows}/${x.want} w ${x.ms} ms, przewijanie strony w bok ${x.overflowX} px, ${head}, Wall Street xyz:NVDA „${x.wallStreet ?? '—'}”, błędy ${errs.length}${errs.length ? ` (${errs.join(' | ')})` : ''}, NaN ${x.nan?.length ?? '—'} — ${ok(rynkiOk(key))}`;
    };
    lines.push(`Rynki (#markets, dane stałe, limit ${RYNKI_MAX_MS} ms): ${RYNKI_VIEWPORTS.map(([key]) => one(key)).join('; ')}`);
  }
  if (r.nowy) {
    const one = (key) => {
      const x = r.nowy[key];
      if (!x) return '—';
      const errs = [...x.errors, ...x.consoleErrors].map((e) => e.split('\n')[0]);
      return `${key}: data-ui ${x.ui}, nawigacje ${x.nawigacje} (${x.szyna ? 'szyna' : 'dolny pasek'}), w bok strona ${x.overflowX} px / nagłówek ${x.naglowekX} px, cena ${x.cena ? 'w całości' : 'UCIĘTA'}${x.cenaOdkryta ? '' : ' i ZASŁONIĘTA'}, nakładanie ${x.nakladanie?.length ? x.nakladanie.join(' | ') : 'brak'}, font marki ${x.font}, font mono widoku ${x.fontWidoku}, paleta ⌘K ${x.paleta ? 'tak' : 'NIE'}, panel ceny ${x.panel != null ? `${(x.panel * 100).toFixed(1)}%` : '—'}, błędy ${errs.length}${errs.length ? ` (${errs.join(' | ')})` : ''}, NaN ${x.nan?.length ?? '—'} — ${ok(nowyOk(key))}`;
    };
    lines.push(`Nowy wygląd (?ui=nowy): ${NOWY_VIEWPORTS.map(([key]) => one(key)).join('; ')}`);
  }
  if (r.pustyStan) {
    const ids = Object.keys(r.pustyStan);
    lines.push(`Pusty stan (nowy wygląd, bez API i danych skanera): ${ids.length === 0 ? 'brak widoków w src/nowy/widoki.ts' : ids.map((id) => `#${id} ${r.pustyStan[id].liczby.length ? `cyfry poza etykietami: ${r.pustyStan[id].liczby.join(' | ')}` : r.pustyStan[id].dlugosc > 0 ? 'bez cyfr poza [data-etykieta]' : 'PUSTY'}`).join('; ')} — ${ok(r.summary.pustyStan)}`);
  }
  if (r.przeladowanie) {
    const x = r.przeladowanie;
    lines.push(`Przeładowanie po wdrożeniu (zablokowany ${x.plik ?? '—'}): wczytania po błędzie ${x.loads} (po 3 s ${x.loadsLater}), znacznik ${x.marker ? 'tak' : 'nie'}, ekran błędu ${x.alert ? 'tak' : 'nie'} — ${ok(r.summary.przeladowanie)}`);
  }
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
