#!/usr/bin/env node
// Potok danych publicznych bez kluczy API (Node 20+, zero zależności, globalny fetch).
// Uruchomienie: `node scripts/fetch-public-data.mjs` → public/data/feeds/*.json
// Każdy plik: { generatedAt, source, attribution, data, parts }, gdzie parts[nazwa] = { ok, asOf, error? }
// mówi, kiedy dana część była naprawdę pobrana (przy fallbacku — data poprzedniej wersji z Pages).
// Każde źródło jest niezależne: błąd jednego nie przerywa reszty. Celowo NIE używamy: FRED, DefiLlama,
// Yahoo ani giełd CEX (warunki licencyjne / zakaz republikacji).
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const USER_AGENT = 'HyperQuant-data (+https://github.com/rdemb/HyperQuant)';
export const PAGES_BASE = 'https://rdemb.github.io/HyperQuant/data/feeds/';
const TIMEOUT_MS = 15000;
const NEWS_MAX = 60;
const DAY_MS = 86400000;

export const NEWS_FEEDS = [
  { source: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', category: 'crypto' },
  { source: 'Cointelegraph', url: 'https://cointelegraph.com/rss', category: 'crypto' },
  { source: 'Decrypt', url: 'https://decrypt.co/feed', category: 'crypto' },
  { source: 'The Block', url: 'https://www.theblock.co/rss.xml', category: 'crypto' },
  { source: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/feed', category: 'crypto' },
  { source: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml', category: 'macro' },
  { source: 'BLS', url: 'https://www.bls.gov/feed/bls_latest.rss', category: 'macro' },
  { source: 'SEC', url: 'https://www.sec.gov/news/pressreleases.rss', category: 'regulation' },
];

// ───────────────────────── HTTP ─────────────────────────

/** Pobieranie z limitem czasu 15 s i jawnym User-Agent; błąd HTTP = wyjątek. */
export function makeGetter(fetchImpl, timeoutMs = TIMEOUT_MS) {
  return async function get(url, as = 'text', waitMs = timeoutMs) {
    const res = await fetchImpl(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: as === 'json' ? 'application/json' : 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      },
      signal: AbortSignal.timeout(waitMs),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return as === 'json' ? res.json() : res.text();
  };
}

// ───────────────────────── RSS / Atom ─────────────────────────

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const stripCdata = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

// Tekst elementu (bez samozamykających tagów), z CDATA, encjami (także podwójnie kodowanymi) i bez znaczników HTML
function tagText(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?(?<!/)>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return '';
  const decoded = decodeEntities(decodeEntities(stripCdata(m[1])));
  return decoded.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function atomLink(block) {
  const tags = block.match(/<link\b[^>]*>/gi) ?? [];
  for (const t of tags) {
    const rel = t.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1];
    const href = t.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (href && (!rel || rel === 'alternate')) return decodeEntities(href);
  }
  return '';
}

/** Usuwa parametry utm_*; zwraca null dla adresów innych niż http(s). */
export function cleanLink(raw) {
  try {
    const u = new URL(String(raw).trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return null;
  }
}

const REG_STRICT = /\b(SEC|CFTC|MiCA|DOJ|ESMA|FCA)\b/;
const REG_LOOSE = /\b(regulat\w*|lawsuit|su(?:e|es|ed)|court|enforcement|legislat\w*|senate|congress|sanction\w*|judge)\b/i;

/** Kategoria nagłówka: domyślna kanału, chyba że tytuł/kategorie RSS wskazują regulacje. */
export function categorize(text, fallback) {
  return REG_STRICT.test(text) || REG_LOOSE.test(text) ? 'regulation' : fallback;
}

/**
 * Mini-parser RSS 2.0 (<item>) i Atom (<entry>). Zapisuje WYŁĄCZNIE tytuł, link, źródło, czas
 * i kategorię — bez opisów i obrazków (prawa autorskie wydawców).
 */
export function parseRss(xml, feed, perFeed = 30) {
  const blocks = String(xml).match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  const out = [];
  for (const b of blocks) {
    const title = tagText(b, 'title').slice(0, 300);
    const link = cleanLink(tagText(b, 'link') || atomLink(b));
    const dateText = tagText(b, 'pubDate') || tagText(b, 'dc:date') || tagText(b, 'published') || tagText(b, 'updated');
    const time = Date.parse(dateText);
    if (!title || !link || !Number.isFinite(time)) continue;
    const cats = [...b.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)].map((m) => stripCdata(m[1])).join(' ');
    out.push({ title, link, source: feed.source, time, category: categorize(`${title} ${cats}`, feed.category) });
    if (out.length >= perFeed) break;
  }
  return out;
}

const normTitle = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const normLink = (l) => l.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '').toLowerCase();

/**
 * Scalanie kanałów: deduplikacja (link lub tytuł), odrzucenie dat z przyszłości, sortowanie malejąco,
 * limit z kwotami kategorii (60% krypto / 20% makro / 20% regulacje), żeby rzadkie komunikaty
 * Fed/BLS/SEC nie zostały wypchnięte przez kanały krypto. Wolne miejsca dopełniają najnowsze.
 */
export function mergeNews(items, max = NEWS_MAX, nowMs = Date.now()) {
  const sorted = items.filter((i) => i.time <= nowMs + 15 * 60000).sort((a, b) => b.time - a.time);
  const seen = new Set();
  const uniq = [];
  for (const it of sorted) {
    const kl = `l:${normLink(it.link)}`;
    const kt = `t:${normTitle(it.title)}`;
    if (seen.has(kl) || seen.has(kt)) continue;
    seen.add(kl);
    seen.add(kt);
    uniq.push(it);
  }
  const quota = { crypto: Math.round(max * 0.6), macro: Math.round(max * 0.2), regulation: max - Math.round(max * 0.6) - Math.round(max * 0.2) };
  const picked = [];
  const rest = [];
  for (const it of uniq) {
    if ((quota[it.category] ?? 0) > 0) {
      quota[it.category]--;
      picked.push(it);
    } else rest.push(it);
  }
  return [...picked, ...rest.slice(0, Math.max(0, max - picked.length))].sort((a, b) => b.time - a.time);
}

// ───────────────────────── Makro (Treasury, FiscalData, NY Fed) ─────────────────────────

const ymd = (d) => d.toISOString().slice(0, 10);
const round = (v, k = 3) => Math.round(v * 10 ** k) / 10 ** k;
const num = (v) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  return v === null || v === '' || v === 'null' || !Number.isFinite(n) ? null : n;
};

/** Bieżący i poprzedni miesiąc w formacie YYYYMM (parametr field_tdr_date_value_month). */
export function treasuryMonths(now) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const prev = new Date(Date.UTC(y, m - 1, 1));
  const f = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return [f(new Date(Date.UTC(y, m, 1))), f(prev)];
}

/** Treasury Daily Par Yield Curve (Atom XML, OData): d:NEW_DATE, d:BC_2YEAR, d:BC_10YEAR. */
export function parseTreasuryYieldXml(xml) {
  const field = (b, name) => {
    const m = b.match(new RegExp(`<d:${name}\\b[^>]*?(?:/>|>([^<]*)</d:${name}>)`, 'i'));
    return m && m[1] !== undefined ? num(m[1]) : null;
  };
  const rows = [];
  for (const b of String(xml).match(/<entry\b[\s\S]*?<\/entry>/gi) ?? []) {
    const date = b.match(/<d:NEW_DATE\b[^>]*>(\d{4}-\d{2}-\d{2})/i)?.[1];
    if (!date) continue;
    rows.push({ date, y2: field(b, 'BC_2YEAR'), y10: field(b, 'BC_10YEAR') });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/** FiscalData DTS: wiersz „TGA Closing Balance”, wartość w open_today_bal ($ mln) → $ mld, rosnąco. */
export function parseTga(json) {
  const rows = (json?.data ?? [])
    .filter((r) => r.account_type === 'Treasury General Account (TGA) Closing Balance')
    .map((r) => ({ date: String(r.record_date).slice(0, 10), value: num(r.open_today_bal) }))
    .filter((r) => r.value !== null)
    .map((r) => ({ date: r.date, value: round(r.value / 1000) }));
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/** NY Fed: operacje reverse repo, suma totalAmtAccepted ($) per dzień → $ mld, rosnąco. */
export function parseRrp(json) {
  const byDate = new Map();
  for (const op of json?.repo?.operations ?? []) {
    const amt = num(op.totalAmtAccepted);
    const date = String(op.operationDate ?? '').slice(0, 10);
    if (amt === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    byDate.set(date, (byDate.get(date) ?? 0) + amt);
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, value: round(v / 1e9) }));
}

// ───────────────────────── CFTC TFF (Bitcoin CME 133741) ─────────────────────────

/** Pozycje netto (long − short) w kontraktach po 5 BTC; dane wtorkowe, publikacja w piątek 15:30 ET. */
export function parseCot(json) {
  const rows = [];
  for (const r of Array.isArray(json) ? json : []) {
    const date = String(r.report_date_as_yyyy_mm_dd ?? '').slice(0, 10);
    const v = (k) => num(r[k]);
    const lev = [v('lev_money_positions_long'), v('lev_money_positions_short')];
    const am = [v('asset_mgr_positions_long'), v('asset_mgr_positions_short')];
    const dl = [v('dealer_positions_long_all'), v('dealer_positions_short_all')];
    const oi = v('open_interest_all');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || [...lev, ...am, ...dl, oi].some((x) => x === null)) continue;
    rows.push({ date, levNet: lev[0] - lev[1], assetMgrNet: am[0] - am[1], dealerNet: dl[0] - dl[1], oi });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

// ───────────────────────── Sentyment ─────────────────────────

/** alternative.me Fear & Greed (wymagana atrybucja „alternative.me” obok danych). */
export function parseFng(json) {
  return (json?.data ?? [])
    .map((d) => ({ time: (num(d.timestamp) ?? NaN) * 1000, value: num(d.value), classification: String(d.value_classification ?? '') }))
    .filter((d) => Number.isFinite(d.time) && d.value !== null)
    .sort((a, b) => a.time - b.time);
}

/** GDELT DOC 2.0 TimelineTone → średni ton godzinowy (dane 15-minutowe). */
export function parseGdeltTone(json) {
  const series = json?.timeline?.[0]?.data ?? [];
  const byHour = new Map();
  for (const p of series) {
    const m = String(p.date ?? '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})/);
    const v = num(p.value);
    if (!m || v === null) continue;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4]);
    const acc = byHour.get(t) ?? { s: 0, n: 0 };
    acc.s += v;
    acc.n += 1;
    byHour.set(t, acc);
  }
  return [...byHour.entries()].sort(([a], [b]) => a - b).map(([time, { s, n }]) => ({ time, tone: round(s / n) }));
}

// ───────────────────────── mempool.space ─────────────────────────

export function parseMempoolFees(json) {
  const keys = ['fastestFee', 'halfHourFee', 'hourFee', 'economyFee', 'minimumFee'];
  const out = Object.fromEntries(keys.map((k) => [k, num(json?.[k])]));
  if (out.fastestFee === null) throw new Error('mempool: brak fastestFee');
  return out;
}

export function parseDifficulty(json) {
  const out = {
    progressPercent: num(json?.progressPercent),
    difficultyChange: num(json?.difficultyChange),
    remainingBlocks: num(json?.remainingBlocks),
    estimatedRetargetDate: num(json?.estimatedRetargetDate),
  };
  if (out.difficultyChange === null) throw new Error('mempool: brak difficultyChange');
  return out;
}

export function parseHashrate(json) {
  return (json?.hashrates ?? [])
    .map((h) => ({ time: (num(h.timestamp) ?? NaN) * 1000, hashrate: num(h.avgHashrate) }))
    .filter((h) => Number.isFinite(h.time) && h.hashrate !== null)
    .sort((a, b) => a.time - b.time);
}

// ───────────────────────── BEA — harmonogram publikacji ─────────────────────────

/**
 * BEA release_dates.json: { "Gross Domestic Product": { release_dates: [ISO] }, "Personal Income and Outlays": {...} }.
 * Publikacje PKB i PCE w tej samej chwili łączone w jedno zdarzenie GDP_PCE (kształt MacroEvent).
 */
export function parseBeaReleaseDates(json, nowMs) {
  const slots = new Map();
  const add = (key, tag) => {
    for (const s of json?.[key]?.release_dates ?? []) {
      const t = Date.parse(s);
      if (!Number.isFinite(t) || t < nowMs - DAY_MS) continue;
      const set = slots.get(t) ?? new Set();
      set.add(tag);
      slots.set(t, set);
    }
  };
  add('Gross Domestic Product', 'GDP');
  add('Personal Income and Outlays', 'PCE');
  return [...slots.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, tags]) => ({
      id: `GDP_PCE-${new Date(t).toISOString().slice(0, 10)}`,
      kind: 'GDP_PCE',
      name: tags.size === 2 ? 'PKB + PCE (dochody i wydatki) — BEA' : tags.has('GDP') ? 'PKB — BEA' : 'PCE (dochody i wydatki osobiste) — BEA',
      timeUtcMs: t,
      importance: 'medium',
      source: 'BEA — release_dates.json',
      sourceUrl: 'https://www.bea.gov/news/schedule',
    }));
}

// ───────────────────────── Budowanie plików ─────────────────────────

async function buildNews(get, now) {
  const errors = [];
  const lists = await Promise.all(
    NEWS_FEEDS.map(async (f) => {
      try {
        return parseRss(await get(f.url), f);
      } catch (err) {
        errors.push(`${f.source}: ${shortError(err)}`);
        return [];
      }
    })
  );
  const items = mergeNews(lists.flat(), NEWS_MAX, now.getTime());
  if (!items.length && errors.length) throw new Error(errors.join('; '));
  return items;
}

// home.treasury.gov odpowiada po ok. 17 s (pomiar 25.10.2026), więc ogólny limit 15 s zawsze go przerywał
const TREASURY_TIMEOUT_MS = 45000;

async function buildUst(get, now) {
  const base = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=';
  const months = await Promise.allSettled(treasuryMonths(now).map(async (m) => parseTreasuryYieldXml(await get(base + m, 'text', TREASURY_TIMEOUT_MS))));
  const byDate = new Map();
  for (const r of months) if (r.status === 'fulfilled') for (const row of r.value) byDate.set(row.date, row);
  if (!byDate.size && months[0].status === 'rejected') throw months[0].reason;
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-40);
}

async function buildTga(get, now) {
  const from = ymd(new Date(now.getTime() - 60 * DAY_MS));
  const url = `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance?filter=record_date:gte:${from}&sort=-record_date&page[size]=200`;
  return parseTga(await get(url, 'json'));
}

const buildRrp = async (get) => parseRrp(await get('https://markets.newyorkfed.org/api/rp/reverserepo/all/results/last/30.json', 'json'));

const buildCot = async (get) =>
  parseCot(
    await get(
      'https://publicreporting.cftc.gov/resource/gpe5-46if.json?cftc_contract_market_code=133741&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=52',
      'json'
    )
  );

const buildFng = async (get) => parseFng(await get('https://api.alternative.me/fng/?limit=30&format=json', 'json'));

// GDELT bywa zawodny; jedno zapytanie na przebieg (zasada min. 5 s odstępu między zapytaniami spełniona)
const buildGdelt = async (get) =>
  parseGdeltTone(
    await get(
      'https://api.gdeltproject.org/api/v2/doc/doc?query=(bitcoin%20OR%20btc)%20sourcelang:english&mode=TimelineTone&timespan=7d&format=json',
      'json'
    )
  );

const MEMPOOL = 'https://mempool.space/api/v1';
const buildFees = async (get) => parseMempoolFees(await get(`${MEMPOOL}/fees/recommended`, 'json'));
const buildDifficulty = async (get) => parseDifficulty(await get(`${MEMPOOL}/difficulty-adjustment`, 'json'));
const buildHashrate = async (get) => parseHashrate(await get(`${MEMPOOL}/mining/hashrate/3m`, 'json'));

const buildBea = async (get, now) => parseBeaReleaseDates(await get('https://apps.bea.gov/API/signup/release_dates.json', 'json'), now.getTime());

export const FILES = [
  {
    file: 'news.json',
    source: `RSS: ${NEWS_FEEDS.map((f) => f.source).join(', ')}`,
    attribution:
      'Nagłówki i linki z publicznych kanałów RSS wydawców. Treść należy do wydawców — zapisujemy wyłącznie tytuł, źródło, czas i link.',
    parts: { items: buildNews },
  },
  {
    file: 'macro.json',
    source:
      'U.S. Treasury — Daily Treasury Par Yield Curve Rates; U.S. Treasury FiscalData — Daily Treasury Statement (Operating Cash Balance); Federal Reserve Bank of New York — Reverse Repo Operations',
    attribution: 'Dane publiczne rządu USA: home.treasury.gov, fiscaldata.treasury.gov, markets.newyorkfed.org. Kwoty w $ mld.',
    parts: { ust: buildUst, tga: buildTga, rrp: buildRrp },
  },
  {
    file: 'cot.json',
    source: 'CFTC — Traders in Financial Futures (Futures Only), Bitcoin CME (kod 133741)',
    attribution: 'U.S. Commodity Futures Trading Commission (publicreporting.cftc.gov). Dane na wtorek, publikacja w piątek 15:30 ET.',
    parts: { btc: buildCot },
  },
  {
    file: 'sentiment.json',
    source: 'alternative.me — Crypto Fear & Greed Index; GDELT Project — DOC 2.0 Timeline Tone',
    attribution:
      'Fear & Greed Index: alternative.me (https://alternative.me/crypto/fear-and-greed-index/). Ton mediów: GDELT Project (https://www.gdeltproject.org/).',
    parts: { fng: buildFng, gdeltTone: buildGdelt },
  },
  {
    file: 'onchain.json',
    source: 'mempool.space REST API',
    attribution: 'Dane: mempool.space (https://mempool.space).',
    parts: { fees: buildFees, difficulty: buildDifficulty, hashrate: buildHashrate },
  },
  {
    file: 'calendar.json',
    source: 'BEA — release_dates.json',
    attribution: 'U.S. Bureau of Economic Analysis — harmonogram publikacji (https://www.bea.gov/news/schedule).',
    parts: { bea: buildBea },
  },
];

const isEmpty = (v) => v === null || v === undefined || (Array.isArray(v) && v.length === 0);
// Krótki opis błędu (z kodem przyczyny undici, np. ENOTFOUND / UND_ERR_CONNECT_TIMEOUT)
const shortError = (e) => `${e?.message ?? e}${e?.cause?.code ? ` (${e.cause.code})` : ''}`.slice(0, 200);

/**
 * Przebieg potoku. `fetchImpl` i `write` są wstrzykiwane (testy „dry-run” bez sieci).
 * Część, która zawiodła, bierzemy z poprzedniej wersji opublikowanej na Pages (z jej oryginalną datą asOf);
 * gdy i to zawiedzie — null. Plik bez żadnych danych nie jest zapisywany. `changedFiles` — zapisane pliki, których dane
 * (bez dat pobrania) różnią się od wersji na Pages: przebieg z harmonogramu bez zmian nie musi wdrażać strony.
 */
export async function runPipeline({ fetchImpl = globalThis.fetch, now = new Date(), write, log = console.log }) {
  const get = makeGetter(fetchImpl);
  const nowIso = now.toISOString();
  const writtenFiles = [];
  const skippedFiles = [];
  const failedParts = [];
  const changedFiles = [];

  await Promise.all(
    FILES.map(async (spec) => {
      let prevPromise = null;
      const prev = () => (prevPromise ??= get(PAGES_BASE + spec.file, 'json').catch(() => null));
      const names = Object.keys(spec.parts);
      const results = await Promise.all(
        names.map(async (name) => {
          try {
            const value = await spec.parts[name](get, now);
            if (isEmpty(value)) throw new Error('puste dane');
            return { value, meta: { ok: true, asOf: nowIso } };
          } catch (err) {
            const error = shortError(err);
            failedParts.push(`${spec.file}:${name}`);
            const p = await prev();
            const pv = p?.data?.[name];
            if (!isEmpty(pv)) return { value: pv, meta: { ok: false, asOf: p.parts?.[name]?.asOf ?? p.generatedAt ?? null, error } };
            return { value: null, meta: { ok: false, asOf: null, error } };
          }
        })
      );
      if (results.every((r) => isEmpty(r.value))) {
        skippedFiles.push(spec.file);
        log(`✗ ${spec.file}: brak danych (${results.map((r) => r.meta.error).join('; ')})`);
        return;
      }
      const data = Object.fromEntries(names.map((n, i) => [n, results[i].value]));
      const parts = Object.fromEntries(names.map((n, i) => [n, results[i].meta]));
      await write(spec.file, { generatedAt: nowIso, source: spec.source, attribution: spec.attribution, data, parts });
      writtenFiles.push(spec.file);
      if (JSON.stringify((await prev())?.data ?? null) !== JSON.stringify(data)) changedFiles.push(spec.file);
      log(`✓ ${spec.file}: ${names.map((n, i) => `${n}=${results[i].meta.ok ? 'ok' : results[i].value ? 'fallback' : 'brak'}`).join(', ')}`);
    })
  );
  return { writtenFiles, skippedFiles, failedParts, changedFiles };
}

async function main() {
  const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'feeds');
  await mkdir(outDir, { recursive: true });
  const summary = await runPipeline({
    write: (file, obj) => writeFile(path.join(outDir, file), `${JSON.stringify(obj)}\n`, 'utf8'),
  });
  console.log(`Zapisano ${summary.writtenFiles.length}/${FILES.length} plików do ${outDir}`);
  if (summary.failedParts.length) console.log(`Części z błędem: ${summary.failedParts.join(', ')}`);
  console.log(summary.changedFiles.length ? `Zmienione względem Pages: ${summary.changedFiles.join(', ')}` : 'Dane bez zmian względem Pages');
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${summary.changedFiles.length > 0}\n`);
  if (summary.writtenFiles.length === 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
