/**
 * Źródła danych publicznych serwera MCP: pliki repo `hyperquant-data` (skaner na gałęzi `main`, nagrania taśmy na gałęzi
 * `history`), `blog/maps.json` strony i świece `candleSnapshot` Hyperliquid (oraz model zmienności HAR z tych świec). Każde
 * żądanie z limitem czasu i nagłówkiem paczki (bez danych użytkownika), wynik w pamięci procesu przez TTL. Błąd sieci, kod
 * HTTP, zły JSON albo kształt to `{ ok: false, why }`, nigdy wyjątek.
 */
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { type Candle, parseCandles } from '../../src/charts/pro/hl/parse';
import { tr } from '../../src/i18n';
import { type BlogMapsState, parseBlogMaps } from '../../src/state/useBlogMaps';
import { toVBars } from '../../src/utils/auction';
import { historyBaseOf } from '../../src/utils/tapeHistory';
import { type VolModel, buildVolModel } from '../../src/utils/volatility';
import { guardedCut } from './envelope';

const gunzipAsync = promisify(gunzip);

/** Wersja paczki (test pilnuje zgodności z `mcp/package.json`). */
export const VERSION = '0.1.0';

const DATA_BASE = 'https://raw.githubusercontent.com/rdemb/hyperquant-data/main';
const SITE_BASE = 'https://hyperquant.tech';
const HL_INFO = 'https://api.hyperliquid.xyz/info';

/** Limit czasu jednego żądania. */
export const TIMEOUT_MS = 10_000;
/**
 * Pamięć podręczna: pliki skanera, mapy z bloga, świece, model zmienności; nieudane żądanie (błąd sieci, limit czasu, kod
 * HTTP, zły JSON) przez `failed`, odpowiedź 429 przez `rateLimited` — kolejne wywołania nie ponawiają go od razu.
 */
export const TTL = { published: 60_000, maps: 5 * 60_000, candles: 60_000, volModel: 15 * 60_000, failed: 30_000, rateLimited: 60_000 } as const;
/** Hyperliquid oddaje najwyżej tyle świec na jedno żądanie `candleSnapshot`. */
export const MAX_CANDLES = 5000;
/** Najwięcej części jednego okna świec (20 000 świec; HL i tak przechowuje ~5000 ostatnich na interwał). */
const MAX_PARTS = 4;
/** Najwięcej bajtów pliku z gałęzi `history` przed rozpakowaniem i po nim (plik godzinowy taśmy BTC ma kilka MB). */
export const MAX_UNZIP_BYTES = 64 << 20;

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

type Raw = { ok: true; raw: unknown; at: number } | { ok: false; why: string; status?: number };
type Text = { ok: true; text: string } | { ok: false; why: string };

/** Rozmiar w MB albo KB (powód odrzucenia za dużego pliku). */
const sizeOf = (bytes: number) => (bytes >= 1 << 20 ? `${Math.round(bytes / (1 << 20))} MB` : `${Math.round(bytes / 1024)} KB`);

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

  /** Plik z repo danych (`dataBase/<path>`) sprawdzony przez `guard`; TTL 60 s. */
  published<T>(path: string, guard: (x: unknown) => x is T): Promise<Fetched<T>> {
    const url = `${this.cfg.dataBase}/${path.replace(/^\/+/, '')}`;
    return this.get(url, null, TTL.published, (raw) => (guard(raw) ? { value: raw } : null));
  }

  /**
   * Plik z gałęzi `history` repo danych (`historyBase/<path>`): JSON w gzip (rozpakowany najwyżej do 64 MB) albo zwykły JSON
   * (spis `index.json`, plik już rozpakowany przez serwer z Content-Encoding: gzip), odczytany przez `decode`; TTL 60 s.
   */
  history<T>(path: string, decode: (raw: unknown) => T | null): Promise<Fetched<T>> {
    const url = `${this.cfg.historyBase}/${path.replace(/^\/+/, '')}`;
    return this.get(
      url,
      null,
      TTL.published,
      (raw) => {
        const v = decode(raw);
        return v === null ? null : { value: v };
      },
      true
    );
  }

  /** Mapy z bloga (`<siteBase>/blog/maps.json`) przez `parseBlogMaps` strony; TTL 5 min. */
  blogMaps(): Promise<Fetched<BlogMapsState>> {
    return this.get(`${this.cfg.siteBase}/blog/maps.json`, null, TTL.maps, (raw) => {
      const maps = parseBlogMaps(raw);
      return maps ? { value: { status: 'ready', maps } } : null;
    });
  }

  /**
   * Świece BTC z `candleSnapshot` w [from, to] (bez `to` — do teraz), rosnąco i bez duplikatów, przez `parseCandles`
   * strony. Okno dłuższe niż 5000 świec idzie kolejnymi częściami (równolegle, każda z własnym limitem czasu); nieudana
   * część — całość `{ ok: false }` (niepełne świece udawałyby lukę albo brak dotknięcia). TTL 60 s.
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
      parts.push(this.get(url, body, TTL.candles, (raw) => (Array.isArray(raw) ? { value: parseCandles(raw) } : null)));
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

  private async get<T>(url: string, body: string | null, ttl: number, decode: (raw: unknown) => { value: T } | null, gz = false): Promise<Fetched<T>> {
    const r = await this.raw(url, body, ttl, gz);
    if (!r.ok) return { ok: false, why: r.why, url };
    const d = decode(r.raw);
    if (!d) return { ok: false, why: tr('nieoczekiwany format danych', 'unexpected data format'), url };
    const asOf = sourceAsOf(r.raw);
    return asOf === undefined ? { ok: true, value: d.value, url, at: r.at } : { ok: true, value: d.value, url, at: r.at, asOf };
  }

  /**
   * Surowy JSON z pamięci (w TTL wpisu) albo z sieci. Nieudane pobranie zostaje w pamięci krótko (`TTL.failed`, przy 429
   * `TTL.rateLimited`) od chwili porażki: limit zapytań albo awaria źródła nie mnoży żądań z każdym wywołaniem narzędzia.
   */
  private raw(url: string, body: string | null, ttl: number, gz: boolean): Promise<Raw> {
    const key = body === null ? url : `${url}\n${body}`;
    const now = this.now();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < hit.ttl) return hit.p;
    for (const [k, e] of this.cache) if (now - e.at >= e.ttl) this.cache.delete(k);
    const p: Promise<Raw> = this.request(url, body, now, gz).then((r) => {
      if (!r.ok && this.cache.get(key)?.p === p) this.cache.set(key, { at: this.now(), ttl: r.status === 429 ? TTL.rateLimited : TTL.failed, p });
      return r;
    });
    this.cache.set(key, { at: now, ttl, p });
    return p;
  }

  private async request(url: string, body: string | null, now: number, gz: boolean): Promise<Raw> {
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
      const t = gz ? await this.unzip(res) : { ok: true as const, text: await res.text() };
      if (!t.ok) return t;
      try {
        return { ok: true, raw: JSON.parse(t.text) as unknown, at: now };
      } catch {
        return { ok: false, why: tr('zły JSON', 'invalid JSON') };
      }
    } catch (e) {
      if (signal.aborted) return { ok: false, why: tr(`brak odpowiedzi w ${timeout / 1000} s`, `no response within ${timeout / 1000} s`) };
      return { ok: false, why: netWhy(e) };
    }
  }

  /**
   * Treść pliku z gałęzi `history`: gzip (nagłówek 1f 8b) rozpakowany z limitem `maxUnzipBytes` — także przed rozpakowaniem,
   * bo plik bez kompresji idzie wprost do `JSON.parse`; bez nagłówka gzip — tekst UTF-8 bez zmian.
   */
  private async unzip(res: Response): Promise<Text> {
    const max = this.cfg.maxUnzipBytes ?? MAX_UNZIP_BYTES;
    const tooBig: Text = { ok: false, why: tr(`plik większy niż ${sizeOf(max)} po rozpakowaniu`, `file larger than ${sizeOf(max)} after decompression`) };
    // Zadeklarowany rozmiar ponad limit — bez czytania treści
    if (Number(res.headers.get('content-length')) > max) {
      void res.body?.cancel().catch(() => undefined);
      return tooBig;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > max) return tooBig;
    if (buf[0] !== 0x1f || buf[1] !== 0x8b) return { ok: true, text: new TextDecoder().decode(buf) };
    try {
      return { ok: true, text: (await gunzipAsync(buf, { maxOutputLength: max })).toString('utf8') };
    } catch (e) {
      return isObj(e) && e.code === 'ERR_BUFFER_TOO_LARGE' ? tooBig : { ok: false, why: tr('uszkodzony plik gzip', 'corrupt gzip file') };
    }
  }
}
