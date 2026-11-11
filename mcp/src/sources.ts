/**
 * Źródła danych publicznych serwera MCP: pliki repo `hyperquant-data` (skaner na gałęzi `main`, nagrania taśmy na gałęzi
 * `history`), `blog/maps.json` strony i świece `candleSnapshot` Hyperliquid (oraz model zmienności HAR z tych świec). Każde
 * żądanie z limitem czasu i nagłówkiem paczki (bez danych użytkownika), treść odpowiedzi z limitem rozmiaru (`readCapped`),
 * wynik w pamięci procesu przez TTL. Błąd sieci, kod HTTP, za duża odpowiedź, zły JSON albo kształt to `{ ok: false, why }`,
 * nigdy wyjątek.
 */
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { type Candle, parseCandles } from '../../src/charts/pro/hl/parse';
import { tr } from '../../src/i18n';
import { type BlogMapsState, parseBlogMaps } from '../../src/utils/blogMaps';
import { toVBars } from '../../src/utils/auction';
import { historyBaseOf } from '../../src/utils/tapeHistory';
import { type VolModel, buildVolModel } from '../../src/utils/volatility';
import { guardedCut } from './envelope';
import { cutLevels } from './external';

const gunzipAsync = promisify(gunzip);

/** Wersja paczki (test pilnuje zgodności z `mcp/package.json`). */
export const VERSION = '0.1.3';

const DATA_BASE = 'https://raw.githubusercontent.com/rdemb/hyperquant-data/main';
const SITE_BASE = 'https://hyperquant.tech';
const HL_INFO = 'https://api.hyperliquid.xyz/info';

/** Limit czasu jednego żądania. */
export const TIMEOUT_MS = 10_000;
/**
 * Pamięć podręczna: pliki skanera, mapy z bloga, świece, model zmienności; nieudane żądanie (błąd sieci, limit czasu, kod
 * HTTP, zły JSON) przez `failed`, odpowiedź 429 przez `rateLimited` — kolejne wywołania nie ponawiają go od razu.
 */
export const TTL = { published: 60_000, maps: 5 * 60_000, candles: 60_000, volModel: 15 * 60_000, historyClosed: 15 * 60_000, failed: 30_000, rateLimited: 60_000 } as const;
/** Hyperliquid oddaje najwyżej tyle świec na jedno żądanie `candleSnapshot`. */
export const MAX_CANDLES = 5000;
/** Najwięcej części jednego okna świec (20 000 świec; HL i tak przechowuje ~5000 ostatnich na interwał). */
const MAX_PARTS = 4;
/**
 * Najwięcej bajtów treści odpowiedzi: plik skanera albo `maps.json` (dziś do kilkudziesięciu KB) i jedno żądanie świec
 * Hyperliquid (5000 świec to ok. 0,7 MB).
 */
export const MAX_BYTES = { published: 4 << 20, candles: 2 << 20 } as const;
/** Najwięcej bajtów pliku z gałęzi `history` przed rozpakowaniem i po nim (plik godzinowy taśmy BTC ma setki KB). */
export const MAX_UNZIP_BYTES = 16 << 20;
/** Łącznie najwięcej bajtów treści (po rozpakowaniu) spisu i plików nagrań taśmy na jedno wywołanie `twaps`. */
export const TWAPS_MAX_BYTES = 32 << 20;

const INTERVAL_MS = { '1m': 60_000, '5m': 300_000, '1h': 3_600_000 } as const;
export type CandleInterval = keyof typeof INTERVAL_MS;

export interface SourcesConfig {
  dataBase: string;
  historyBase: string;
  siteBase: string;
  hlInfo: string;
  fetch: typeof fetch;
  now: () => number;
  version: string;
  /** Limit czasu żądania (ms); domyślnie `TIMEOUT_MS`. Krótszy tylko w testach. */
  timeoutMs?: number;
  /** Limit rozmiaru pliku z gałęzi `history` (bajty); domyślnie `MAX_UNZIP_BYTES`. Mniejszy tylko w testach. */
  maxUnzipBytes?: number;
  /** Łączny limit bajtów jednego wywołania `twaps`; domyślnie `TWAPS_MAX_BYTES`. Inny tylko w testach. */
  twapsMaxBytes?: number;
}

/**
 * Łączny limit bajtów kilku pobrań jednego wywołania narzędzia: każdy plik zużywa tyle bajtów, ile ma jego treść (po
 * rozpakowaniu), także plik z pamięci podręcznej (wynik nie zależy od tego, co było pobrane wcześniej). Pobranie z limitem
 * czyta najwyżej tyle, ile z niego zostało w chwili startu.
 */
export class ByteBudget {
  private used = 0;
  constructor(readonly max: number) {}
  get left(): number {
    return this.max - this.used;
  }
  get over(): boolean {
    return this.used > this.max;
  }
  get why(): string {
    return tr(`dane łącznie ponad ${sizeOf(this.max)} na jedno wywołanie narzędzia`, `data over ${sizeOf(this.max)} in total for one tool call`);
  }
  /** Zużywa `n` bajtów; false — limit przekroczony. */
  take(n: number): boolean {
    this.used += n;
    return !this.over;
  }
  /** Limit przekroczony bez znanej liczby bajtów (pobranie przerwane po tym, co zostało). */
  exhaust(): void {
    this.used = Math.max(this.used, this.max + 1);
  }
}

/** Mapy z bloga po limicie poziomów na mapę; `levelsCut`: id mapy → liczba jej poziomów w pliku (tylko mapy ponad limit). */
export interface BlogMapsCut extends BlogMapsState {
  levelsCut: Record<string, number>;
}

/** Wynik pobrania: wartość z czasem pobrania (`at`) i czasem danych według źródła (`asOf` pliku), albo powód braku. */
export type Fetched<T> = { ok: true; value: T; url: string; at: number; asOf?: number } | { ok: false; why: string; url: string };

/**
 * Adres bazowy ze zmiennej środowiska: tylko http(s), bez loginu i hasła (trafiłyby do `sources[].url` każdej
 * odpowiedzi), bez zapytania i kotwicy (psułyby doklejaną ścieżkę), bez końcowego ukośnika; brak — domyślny. Błąd
 * zatrzymuje start serwera z nazwą zmiennej na stderr, bez jej wartości (mogłaby zawierać hasło).
 */
function baseUrl(v: string | undefined, fallback: string, name: string): string {
  const s = v?.trim();
  if (!s) return fallback;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new Error(`${name}: ${tr('nieprawidłowy adres', 'invalid URL')}`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`${name}: ${tr('tylko adres http(s)', 'http(s) URL only')}`);
  // „@” w części hosta także przy pustym loginie („https://@host”), którego `URL` nie pokazuje w `username`
  if (u.username || u.password || /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(s)) throw new Error(`${name}: ${tr('adres bez loginu i hasła', 'URL without user name or password')}`);
  // „?” i „#” w surowym tekście: puste zapytanie („…/data?”) daje `search === ''`, a i tak psuje ścieżkę
  if (u.search || u.hash || /[?#]/.test(s)) throw new Error(`${name}: ${tr('adres bez zapytania (?) i kotwicy (#)', 'URL without a query (?) or fragment (#)')}`);
  return s.replace(/\/+$/, '');
}

export function configFromEnv(env: Record<string, string | undefined>, fetchImpl: typeof fetch): SourcesConfig {
  // Baza jako IP (np. http://127.0.0.1:8080) trafiłaby do `sources[].url` i bezpiecznik prywatności („adres IP”) zablokowałby
  // każdą odpowiedź — do testów lokalnych `http://localhost:…`
  const dataBase = baseUrl(env.HQ_DATA_BASE, DATA_BASE, 'HQ_DATA_BASE');
  return {
    dataBase,
    // Gałąź `history` jak na stronie (`HISTORY_BASE`): …/main → …/history, baza bez „/main” — ten sam katalog
    historyBase: historyBaseOf(dataBase),
    siteBase: baseUrl(env.HQ_SITE_BASE, SITE_BASE, 'HQ_SITE_BASE'),
    hlInfo: HL_INFO,
    fetch: fetchImpl,
    now: () => Date.now(),
    version: VERSION,
  };
}

/** Sposób odczytu treści: limit bajtów, rozpakowanie gzip (gałąź `history`) i łączny limit wywołania narzędzia. */
interface Read {
  cap: number;
  gz?: boolean;
  budget?: ByteBudget;
}

/** Odczytany JSON z rozmiarem treści (`bytes`, po rozpakowaniu) albo powód; `overBudget` — przerwane przez łączny limit wywołania. */
type Raw = { ok: true; raw: unknown; at: number; bytes: number } | { ok: false; why: string; status?: number; overBudget?: true };
type Text = { ok: true; text: string; bytes: number } | { ok: false; why: string; overBudget?: true };

/** Rozmiar w MB albo KB (powód odrzucenia za dużego pliku). */
const sizeOf = (bytes: number) => (bytes >= 1 << 20 ? `${Math.round(bytes / (1 << 20))} MB` : `${Math.round(bytes / 1024)} KB`);

/**
 * Treść odpowiedzi, najwyżej `max` bajtów: zadeklarowany większy rozmiar (Content-Length) — bez czytania, a bez nagłówka
 * czytanie przerwane po przekroczeniu limitu; w obu przypadkach null i anulowany strumień.
 */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  if (Number(res.headers.get('content-length')) > max) {
    void res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      void reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Czas danych według pliku (`asOf` w ms albo ISO), gdy plik go podaje. */
function sourceAsOf(raw: unknown): number | undefined {
  if (!isObj(raw)) return undefined;
  const v = raw.asOf;
  const t = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : Number.NaN;
  return Number.isFinite(t) && t > 0 ? t : undefined;
}

/** Krótki opis błędu sieci (komunikat i kod przyczyny, do 140 znaków), bez treści odpowiedzi; bezpieczniki przed przycięciem. */
function netWhy(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const cause = e instanceof Error && isObj(e.cause) && typeof e.cause.code === 'string' ? ` (${e.cause.code})` : '';
  return `${tr('błąd sieci', 'network error')}: ${guardedCut(`${msg}${cause}`, 140)}`;
}

export class Sources {
  /** Klucz: URL i treść żądania. Obietnica w pamięci, więc równoległe wywołania narzędzi dzielą jedno żądanie. */
  private readonly cache = new Map<string, { at: number; ttl: number; p: Promise<Raw> }>();
  /** Model zmienności (obietnica, jak wyżej): tylko zbudowany model zostaje w pamięci przez TTL. */
  private vol: { at: number; p: Promise<Fetched<VolModel | null>> } | null = null;

  constructor(readonly cfg: SourcesConfig) {}

  now(): number {
    return this.cfg.now();
  }

  /** Plik z repo danych (`dataBase/<path>`, najwyżej 4 MB) sprawdzony przez `guard`; TTL 60 s. */
  published<T>(path: string, guard: (x: unknown) => x is T): Promise<Fetched<T>> {
    const url = `${this.cfg.dataBase}/${path.replace(/^\/+/, '')}`;
    return this.get(url, null, TTL.published, { cap: MAX_BYTES.published }, (raw) => (guard(raw) ? { value: raw } : null));
  }

  /**
   * Plik z gałęzi `history` repo danych (`historyBase/<path>`): JSON w gzip (najwyżej 16 MB przed i po rozpakowaniu) albo
   * zwykły JSON (spis `index.json`, plik już rozpakowany przez serwer z Content-Encoding: gzip), odczytany przez `decode`.
   * TTL domyślnie 60 s; zamknięte, już opublikowane pliki nagrań się nie zmieniają (`TTL.historyClosed`). `budget` —
   * łączny limit bajtów wywołania narzędzia (`ByteBudget`): po jego przekroczeniu `{ ok: false }` z powodem limitu.
   */
  history<T>(path: string, decode: (raw: unknown) => T | null, ttl: number = TTL.published, budget?: ByteBudget): Promise<Fetched<T>> {
    const url = `${this.cfg.historyBase}/${path.replace(/^\/+/, '')}`;
    return this.get(url, null, ttl, { cap: this.cfg.maxUnzipBytes ?? MAX_UNZIP_BYTES, gz: true, budget }, (raw) => {
      const v = decode(raw);
      return v === null ? null : { value: v };
    });
  }

  /**
   * Mapy z bloga (`<siteBase>/blog/maps.json`) przez `parseBlogMaps` strony, każda najwyżej z `LEVELS_MAX` poziomami
   * (pierwsze w kolejności wpisu; `levelsCut` — liczba poziomów w pliku map ponad limit, do uwagi narzędzia); TTL 5 min.
   */
  blogMaps(): Promise<Fetched<BlogMapsCut>> {
    return this.get(`${this.cfg.siteBase}/blog/maps.json`, null, TTL.maps, { cap: MAX_BYTES.published }, (raw) => {
      const maps = parseBlogMaps(raw);
      if (!maps) return null;
      const levelsCut: Record<string, number> = {};
      const capped = maps.map((m) => {
        const c = cutLevels(m.levels);
        if (c.cut === 0) return m;
        levelsCut[m.id] = m.levels.length;
        return { ...m, levels: c.levels };
      });
      return { value: { status: 'ready', maps: capped, levelsCut } };
    });
  }

  /**
   * Świece BTC z `candleSnapshot` w [from, to] (bez `to` — do teraz), rosnąco i bez duplikatów, przez `parseCandles`
   * strony. Okno dłuższe niż 5000 świec idzie kolejnymi częściami (równolegle, każda z własnym limitem czasu); nieudana
   * część — całość `{ ok: false }` (niepełne świece udawałyby lukę albo brak dotknięcia). Najwyżej 2 MB na część, TTL 60 s.
   */
  async candles(interval: CandleInterval, from: number, to?: number): Promise<Fetched<Candle[]>> {
    const url = this.cfg.hlInfo;
    const ms = INTERVAL_MS[interval];
    const start = Math.floor(from / ms) * ms;
    const end = to ?? this.now();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return { ok: false, why: tr('zły zakres czasu świec', 'invalid candle time range'), url };
    const span = MAX_CANDLES * ms;
    if (Math.ceil((end - start + 1) / span) > MAX_PARTS) return { ok: false, why: tr('okno świec za długie', 'candle window too long'), url };
    const parts: Promise<Fetched<Candle[]>>[] = [];
    for (let s = start; s <= end; s += span) {
      const last = s + span - 1 >= end;
      // Ostatnia część bez `to` — bez endTime, więc klucz pamięci nie zmienia się z każdą sekundą
      const req = last ? (to === undefined ? { coin: 'BTC', interval, startTime: s } : { coin: 'BTC', interval, startTime: s, endTime: Math.floor(to) }) : { coin: 'BTC', interval, startTime: s, endTime: s + span - 1 };
      const body = JSON.stringify({ type: 'candleSnapshot', req });
      parts.push(this.get(url, body, TTL.candles, { cap: MAX_BYTES.candles }, (raw) => (Array.isArray(raw) ? { value: parseCandles(raw) } : null)));
    }
    const got = await Promise.all(parts);
    const bad = got.find((g) => !g.ok);
    if (bad && !bad.ok) return bad;
    const byT = new Map<number, Candle>();
    let at = Number.POSITIVE_INFINITY;
    for (const g of got) {
      if (!g.ok) continue;
      at = Math.min(at, g.at);
      for (const c of g.value) if (c.t >= start && c.t <= end) byT.set(c.t, c);
    }
    return { ok: true, value: [...byT.values()].sort((a, b) => a.t - b.t), url, at };
  }

  /**
   * Model zmienności HAR BTC (`buildVolModel`) z ostatnich 5000 świec 1h i 5000 świec 5m — te same dane co model strony
   * (`loadVolModel`); jedno żądanie na interwał, oba równolegle. TTL 15 min. Nieudane pobranie — `{ ok: false }`, za mało
   * świec — `value: null`; żaden z nich nie zostaje w pamięci modelu (same świece — przez swój TTL albo TTL porażki).
   */
  volModel(): Promise<Fetched<VolModel | null>> {
    const now = this.now();
    if (this.vol && now - this.vol.at < TTL.volModel) return this.vol.p;
    const p = (async (): Promise<Fetched<VolModel | null>> => {
      // 4999 kroków wstecz: okno z bieżącą świecą mieści się w jednej części (≤ 5000 świec)
      const [h, f] = await Promise.all([this.candles('1h', now - (MAX_CANDLES - 1) * INTERVAL_MS['1h']), this.candles('5m', now - (MAX_CANDLES - 1) * INTERVAL_MS['5m'])]);
      if (!h.ok) return h;
      if (!f.ok) return f;
      const at = Math.min(h.at, f.at);
      // Model na chwilę migawki świec: świeca w toku w chwili pobrania nie liczy się jako zamknięta
      return { ok: true, value: buildVolModel(toVBars(h.value), toVBars(f.value), Math.min(now, at)), url: h.url, at };
    })();
    const entry = { at: now, p };
    this.vol = entry;
    const drop = () => {
      if (this.vol === entry) this.vol = null;
    };
    p.then((r) => (!r.ok || r.value === null ? drop() : undefined), drop);
    return p;
  }

  private async get<T>(url: string, body: string | null, ttl: number, read: Read, decode: (raw: unknown) => { value: T } | null): Promise<Fetched<T>> {
    const r = await this.raw(url, body, ttl, read);
    if (!r.ok) return { ok: false, why: r.why, url };
    // Łączny limit wywołania: każdy plik liczy się swoją treścią, także z pamięci
    if (read.budget && !read.budget.take(r.bytes)) return { ok: false, why: read.budget.why, url };
    const d = decode(r.raw);
    if (!d) return { ok: false, why: tr('nieoczekiwany format danych', 'unexpected data format'), url };
    const asOf = sourceAsOf(r.raw);
    return asOf === undefined ? { ok: true, value: d.value, url, at: r.at } : { ok: true, value: d.value, url, at: r.at, asOf };
  }

  /**
   * Surowy JSON z pamięci (w TTL wpisu) albo z sieci. Nieudane pobranie zostaje w pamięci krótko (`TTL.failed`, przy 429
   * `TTL.rateLimited`) od chwili porażki: limit zapytań albo awaria źródła nie mnoży żądań z każdym wywołaniem narzędzia.
   * Pobranie przerwane przez łączny limit jednego wywołania to nie porażka źródła: bez wpisu w pamięci.
   */
  private raw(url: string, body: string | null, ttl: number, read: Read): Promise<Raw> {
    const key = body === null ? url : `${url}\n${body}`;
    const now = this.now();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < hit.ttl) return hit.p;
    for (const [k, e] of this.cache) if (now - e.at >= e.ttl) this.cache.delete(k);
    const p: Promise<Raw> = this.request(url, body, now, read).then((r) => {
      if (!r.ok && this.cache.get(key)?.p === p) {
        if (r.overBudget) this.cache.delete(key);
        else this.cache.set(key, { at: this.now(), ttl: r.status === 429 ? TTL.rateLimited : TTL.failed, p });
      }
      return r;
    });
    this.cache.set(key, { at: now, ttl, p });
    return p;
  }

  private async request(url: string, body: string | null, now: number, read: Read): Promise<Raw> {
    const timeout = this.cfg.timeoutMs ?? TIMEOUT_MS;
    const signal = AbortSignal.timeout(timeout);
    const headers: Record<string, string> = { 'User-Agent': `hyperquant-mcp/${this.cfg.version}`, Accept: 'application/json' };
    if (body !== null) headers['Content-Type'] = 'application/json';
    try {
      const res = await this.cfg.fetch(url, { method: body === null ? 'GET' : 'POST', headers, body: body ?? undefined, signal });
      if (!res.ok) {
        void res.body?.cancel().catch(() => undefined);
        return { ok: false, status: res.status, why: res.status === 429 ? `HTTP 429 (${tr('limit zapytań', 'rate limited')})` : `HTTP ${res.status}` };
      }
      const t = await this.text(res, read);
      if (!t.ok) return t;
      try {
        return { ok: true, raw: JSON.parse(t.text) as unknown, at: now, bytes: t.bytes };
      } catch {
        return { ok: false, why: tr('zły JSON', 'invalid JSON') };
      }
    } catch (e) {
      if (signal.aborted) return { ok: false, why: tr(`brak odpowiedzi w ${timeout / 1000} s`, `no response within ${timeout / 1000} s`) };
      return { ok: false, why: netWhy(e) };
    }
  }

  /**
   * Treść odpowiedzi przez `readCapped`: najwyżej `read.cap` bajtów, a z łącznym limitem wywołania najwyżej tyle, ile z niego
   * zostało w chwili startu. Z `gz` (gałąź `history`) treść z nagłówkiem gzip (1f 8b) jest rozpakowana z tym samym limitem;
   * bez nagłówka — tekst UTF-8 bez zmian (plik już rozpakowany przez serwer z Content-Encoding: gzip, spis `index.json`).
   */
  private async text(res: Response, read: Read): Promise<Text> {
    const { cap, gz = false, budget } = read;
    const max = budget ? Math.max(0, Math.min(cap, budget.left)) : cap;
    // Limit niższy niż limit pliku przez łączny limit wywołania: przekroczenie to limit wywołania, nie za duży plik
    const over = (file: Text): Text => {
      if (!budget || max >= cap) return file;
      budget.exhaust();
      return { ok: false, why: budget.why, overBudget: true };
    };
    const buf = await readCapped(res, max);
    if (!buf) return over({ ok: false, why: tr(`odpowiedź większa niż ${sizeOf(cap)}`, `response larger than ${sizeOf(cap)}`) });
    if (!gz || buf[0] !== 0x1f || buf[1] !== 0x8b) return { ok: true, text: new TextDecoder().decode(buf), bytes: buf.byteLength };
    try {
      const out = await gunzipAsync(buf, { maxOutputLength: max });
      return { ok: true, text: out.toString('utf8'), bytes: out.byteLength };
    } catch (e) {
      if (isObj(e) && e.code === 'ERR_BUFFER_TOO_LARGE') return over({ ok: false, why: tr(`plik większy niż ${sizeOf(cap)} po rozpakowaniu`, `file larger than ${sizeOf(cap)} after decompression`) });
      return { ok: false, why: tr('uszkodzony plik gzip', 'corrupt gzip file') };
    }
  }
}
