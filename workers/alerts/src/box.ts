import { ALERT_MARKETS, type AlertEvent, type AlertRule, parseRules } from '../../../src/utils/alertRules.ts';
import { pushHostOk, signedMessage } from '../../../src/utils/alertsServer.ts';

/**
 * Skrzynka alarmów HyperQuant (Cloudflare Worker + D1) dla powiadomień przy zamkniętej stronie.
 *
 * Przeglądarka z włączonym „24/7” zapisuje tu swoją subskrypcję push i alarmy (bez konta: losowy identyfikator i token
 * urządzenia). Serwer powiadomień na VPS co kilka sekund pobiera zmienione urządzenia, sam pilnuje alarmów na taśmie
 * Hyperliquid i odsyła zdarzenia. Serwer podpisuje zapytania kluczem Ed25519, którego część publiczną publikuje w repo
 * danych (`alerts/keys.json`); skrzynka nie ma żadnego wspólnego sekretu z serwerem. Bez adresów IP i bez e-maili
 * (limit rejestracji liczy tylko skróty adresu z solą i godziną, kasowane po 2 h).
 */

/** Minimalne typy D1 (bez pakietu typów Cloudflare). */
export interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface D1 {
  prepare(sql: string): D1Stmt;
  batch(list: D1Stmt[]): Promise<unknown[]>;
}

export interface Env {
  DB: D1;
  /** Publiczny adres danych skanera (repo danych): klucze serwera powiadomień w `alerts/keys.json`. */
  DATA_BASE_URL: string;
  /** Strony, które mogą rozmawiać ze skrzynką (po przecinku). */
  ORIGINS: string;
}

/** Alarmy jednego urządzenia, urządzenia w skrzynce, rozmiar zapytania. */
export const MAX_RULES = 30;
const MAX_DEVICES = 20_000;
const MAX_BODY = 48_000;
const SYNC_PAGE = 500;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Rejestracje z jednego adresu na godzinę (z zapasem na wspólny adres sieci komórkowej albo firmy). */
const REG_PER_HOUR = 10;
/** Urządzenie bez ani jednej synchronizacji z przeglądarki po rejestracji znika po tym czasie. */
const FRESH_MS = 7 * DAY;
const LOG_MS = 7 * DAY;
const IDLE_MS = 30 * DAY;
const TOMBSTONE_MS = 2 * DAY;
/** Dopuszczalna różnica zegarów przy podpisie serwera. */
const SKEW_MS = 60_000;

interface DeviceRow {
  id: string;
  token: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  lang: string;
  rules: string;
  seen: number;
  version: number;
  deleted: number;
}

interface Sub {
  endpoint: string;
  p256dh: string;
  auth: string;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const enc = new TextEncoder();
const b64u = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function fromB64u(s: string): Uint8Array<ArrayBuffer> {
  try {
    return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array(0);
  }
}
const randomId = (bytes: number): string => b64u(crypto.getRandomValues(new Uint8Array(bytes)));
async function sha256(s: string): Promise<string> {
  return b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
}

/** Licznik wersji: każda zmiana urządzenia dostaje kolejny numer (w tej samej paczce zapytań D1). */
const bump = (db: D1): D1Stmt => db.prepare("UPDATE meta SET v = v + 1 WHERE k = 'version'");
const VER = "(SELECT v FROM meta WHERE k = 'version')";

/** Subskrypcja z przeglądarki (PushSubscription.toJSON()): tylko usługi push przeglądarek i klucze właściwej długości. */
export function parseSub(v: unknown): Sub | null {
  const s = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!s || typeof s.endpoint !== 'string' || s.endpoint.length > 1000 || !pushHostOk(s.endpoint)) return null;
  const p = s.keys?.p256dh;
  const a = s.keys?.auth;
  if (typeof p !== 'string' || typeof a !== 'string') return null;
  const pk = fromB64u(p);
  if (pk.length !== 65 || pk[0] !== 4 || fromB64u(a).length !== 16) return null;
  return { endpoint: s.endpoint, p256dh: p, auth: a };
}

/** Alarmy z przeglądarki: poprawne, na rynkach desku, najwyżej MAX_RULES. */
const cleanRules = (raw: unknown, now: number): AlertRule[] =>
  parseRules(raw, now)
    .filter((r) => (ALERT_MARKETS as readonly string[]).includes(r.coin))
    .slice(0, MAX_RULES);

async function readJson(req: Request): Promise<{ text: string; data: Record<string, unknown> }> {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'too large');
  if (!text) return { text, data: {} };
  try {
    const data = JSON.parse(text) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return { text, data: data as Record<string, unknown> };
  } catch {
    throw new HttpError(400, 'bad json');
  }
}

// ───────────────────────── podpis serwera powiadomień ─────────────────────────

let serverKey: { key: CryptoKey | null; at: number } = { key: null, at: 0 };

/** Klucz publiczny serwera z repo danych (pamiętany 10 min; odświeżenie najwyżej raz na minutę). */
async function loadServerKey(env: Env, now: number, force: boolean): Promise<CryptoKey | null> {
  const age = now - serverKey.at;
  if (serverKey.at > 0 && (age < 600_000 || (force && age < 60_000))) return serverKey.key;
  serverKey = { key: serverKey.key, at: now };
  try {
    const res = await fetch(`${env.DATA_BASE_URL.replace(/\/+$/, '')}/alerts/keys.json`, { headers: { 'cache-control': 'no-cache' } });
    const raw = res.ok ? fromB64u(String(((await res.json()) as { server?: unknown }).server ?? '')) : new Uint8Array(0);
    if (raw.length === 32) serverKey.key = await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
  } catch {
    // Repo danych chwilowo niedostępne: zostaje poprzedni klucz
  }
  return serverKey.key;
}

async function serverOk(env: Env, req: Request, url: URL, body: string, now: number): Promise<boolean> {
  const time = Number(req.headers.get('x-hq-time'));
  if (!(Math.abs(now - time) < SKEW_MS)) return false;
  const sig = fromB64u(req.headers.get('x-hq-sig') ?? '');
  if (sig.length !== 64) return false;
  const msg = enc.encode(signedMessage(req.method, url.pathname + url.search, time, body));
  for (const force of [false, true]) {
    const key = await loadServerKey(env, now, force);
    if (key && (await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, msg))) return true;
  }
  return false;
}

// ───────────────────────── urządzenia (przeglądarka) ─────────────────────────

async function deviceAuth(env: Env, req: Request, id: string): Promise<DeviceRow> {
  const h = req.headers.get('authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const row = token ? await env.DB.prepare('SELECT * FROM devices WHERE id = ? AND deleted = 0').bind(id).first<DeviceRow>() : null;
  if (!row || row.token !== (await sha256(token))) throw new HttpError(404, 'unknown device');
  return row;
}

interface EventRow {
  rule: string;
  kind: string;
  at: number;
  body: string;
}

/** Zdarzenia serwera dla urządzenia: zakończone alarmy (do usunięcia), starty z łańcucha i historia od `since`. */
async function deviceEvents(env: Env, id: string, since: number) {
  const rows = (await env.DB.prepare('SELECT rule, kind, at, body FROM events WHERE device = ? ORDER BY at').bind(id).all<EventRow>()).results;
  const done = new Set<string>();
  const starts = new Map<string, { created: number; from: number }>();
  const log: AlertEvent[] = [];
  for (const r of rows) {
    if (r.kind === 'start') starts.set(r.rule, JSON.parse(r.body) as { created: number; from: number });
    else {
      done.add(r.rule);
      if (r.at > since) log.push(JSON.parse(r.body) as AlertEvent);
    }
  }
  return { done, starts, log: log.slice(-50) };
}

/** Lista z przeglądarki bez alarmów już zakończonych na serwerze, ze startami z łańcucha, których przeglądarka nie widziała. */
function reconcile(rules: AlertRule[], done: Set<string>, starts: Map<string, { created: number; from: number }>): AlertRule[] {
  return rules
    .filter((r) => !done.has(r.id))
    .map((r) => {
      const s = starts.get(r.id);
      return s && r.after ? { ...r, after: '', created: s.created, from: Math.max(r.from, s.from) } : r;
    });
}

/**
 * Limit rejestracji z jednego adresu (REG_PER_HOUR w godzinie zegara): zapytanie licznika do paczki rejestracji;
 * przekroczony → 429. Bez adresu (wywołanie spoza sieci Cloudflare, testy) bez limitu.
 */
async function regLimit(env: Env, ip: string, now: number): Promise<D1Stmt[]> {
  if (!ip) return [];
  const salt = await env.DB.prepare("SELECT v FROM meta WHERE k = 'salt'").first<{ v: number }>();
  const k = await sha256(`${salt?.v ?? 0}|${ip}|${Math.floor(now / HOUR)}`);
  const row = await env.DB.prepare('SELECT n FROM regs WHERE k = ?').bind(k).first<{ n: number }>();
  if ((row?.n ?? 0) >= REG_PER_HOUR) throw new HttpError(429, 'too many registrations');
  return [
    env.DB.prepare('DELETE FROM regs WHERE at < ?').bind(now - 2 * HOUR),
    env.DB.prepare('INSERT INTO regs (k, n, at) VALUES (?, 1, ?) ON CONFLICT (k) DO UPDATE SET n = n + 1').bind(k, now),
  ];
}

async function register(env: Env, data: Record<string, unknown>, now: number, ip: string) {
  const sub = parseSub(data.sub);
  if (!sub) throw new HttpError(400, 'bad subscription');
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices WHERE deleted = 0').first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_DEVICES) throw new HttpError(503, 'full');
  const limit = await regLimit(env, ip, now);
  const id = randomId(16);
  const token = randomId(32);
  const rules = cleanRules(data.rules, now);
  await env.DB.batch([
    bump(env.DB),
    ...limit,
    env.DB.prepare('INSERT INTO fresh (id, at) VALUES (?, ?)').bind(id, now),
    // Ta sama subskrypcja zapisana wcześniej (np. po wyczyszczeniu danych strony) — stary wpis znika
    env.DB.prepare(`UPDATE devices SET deleted = 1, rules = '[]', endpoint = '', p256dh = '', auth = '', seen = ?, version = ${VER} WHERE endpoint = ? AND deleted = 0`).bind(now, sub.endpoint),
    env.DB.prepare(`INSERT INTO devices (id, token, endpoint, p256dh, auth, lang, rules, seen, version, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${VER}, 0)`).bind(
      id,
      await sha256(token),
      sub.endpoint,
      sub.p256dh,
      sub.auth,
      data.lang === 'en' ? 'en' : 'pl',
      JSON.stringify(rules),
      now
    ),
  ]);
  return { id, token, rules, events: [] };
}

async function update(env: Env, row: DeviceRow, data: Record<string, unknown>, now: number) {
  const sub = data.sub === undefined ? { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth } : parseSub(data.sub);
  if (!sub) throw new HttpError(400, 'bad subscription');
  const { done, starts, log } = await deviceEvents(env, row.id, typeof data.since === 'number' ? data.since : now);
  const rules = reconcile(cleanRules(data.rules, now), done, starts);
  await env.DB.batch([
    bump(env.DB),
    env.DB.prepare('DELETE FROM fresh WHERE id = ?').bind(row.id),
    env.DB.prepare(`UPDATE devices SET endpoint = ?, p256dh = ?, auth = ?, lang = ?, rules = ?, seen = ?, version = ${VER} WHERE id = ?`).bind(
      sub.endpoint,
      sub.p256dh,
      sub.auth,
      data.lang === 'en' ? 'en' : 'pl',
      JSON.stringify(rules),
      now,
      row.id
    ),
  ]);
  return { rules, events: log };
}

async function remove(env: Env, id: string, now: number) {
  await env.DB.batch([
    bump(env.DB),
    env.DB.prepare(`UPDATE devices SET deleted = 1, rules = '[]', endpoint = '', p256dh = '', auth = '', seen = ?, version = ${VER} WHERE id = ?`).bind(now, id),
    env.DB.prepare('DELETE FROM events WHERE device = ?').bind(id),
  ]);
  return { ok: true };
}

// ───────────────────────── serwer powiadomień ─────────────────────────

/** Zmienione urządzenia od kursora `wersja.id` (strona po SYNC_PAGE wierszy). */
async function sync(env: Env, cursor: string) {
  const dot = cursor.indexOf('.');
  const v = Number(dot < 0 ? cursor : cursor.slice(0, dot)) || 0;
  const id = dot < 0 ? '' : cursor.slice(dot + 1);
  const rows = (
    await env.DB.prepare('SELECT id, endpoint, p256dh, auth, lang, rules, version, deleted FROM devices WHERE version > ? OR (version = ? AND id > ?) ORDER BY version, id LIMIT ?')
      .bind(v, v, id, SYNC_PAGE)
      .all<DeviceRow>()
  ).results;
  const last = rows.at(-1);
  return {
    cursor: last ? `${last.version}.${last.id}` : cursor,
    more: rows.length === SYNC_PAGE,
    devices: rows.map((r) => ({ id: r.id, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth, lang: r.lang, rules: r.deleted ? null : (JSON.parse(r.rules) as AlertRule[]) })),
  };
}

interface ReportEvent extends AlertEvent {
  device: string;
}

/** Zdarzenia z serwera: zakończone alarmy znikają z urządzeń, starty z łańcucha są zapisane, wygasłe subskrypcje usunięte. */
async function report(env: Env, data: Record<string, unknown>, now: number) {
  const events = (Array.isArray(data.events) ? data.events : []).slice(0, 1000) as ReportEvent[];
  const starts = (Array.isArray(data.starts) ? data.starts : []).slice(0, 1000) as { device: string; id: string; created: number; from: number }[];
  const gone = (Array.isArray(data.gone) ? data.gone : []).slice(0, 1000).filter((g): g is string => typeof g === 'string');
  const byDevice = new Map<string, { done: Set<string>; starts: Map<string, { created: number; from: number }> }>();
  const of = (d: string) => byDevice.get(d) ?? byDevice.set(d, { done: new Set(), starts: new Map() }).get(d)!;
  const stmts: D1Stmt[] = [bump(env.DB)];
  for (const e of events) {
    const [rule] = parseRules([e?.rule], now);
    if (typeof e?.device !== 'string' || !rule || (e.type !== 'fire' && e.type !== 'expire' && e.type !== 'cancel') || typeof e.at !== 'number' || typeof e.px !== 'number') continue;
    of(e.device).done.add(rule.id);
    const body: AlertEvent = { type: e.type, rule, at: e.at, px: e.px, facts: e.facts && typeof e.facts === 'object' ? e.facts : null, ...(e.gap === true ? { gap: true } : {}) };
    stmts.push(env.DB.prepare('INSERT INTO events (device, rule, kind, at, body) VALUES (?, ?, ?, ?, ?)').bind(e.device, rule.id, e.type, e.at, JSON.stringify(body)));
  }
  for (const s of starts) {
    if (typeof s?.device !== 'string' || typeof s.id !== 'string' || typeof s.created !== 'number' || typeof s.from !== 'number') continue;
    of(s.device).starts.set(s.id, { created: s.created, from: s.from });
    stmts.push(env.DB.prepare("INSERT INTO events (device, rule, kind, at, body) VALUES (?, ?, 'start', ?, ?)").bind(s.device, s.id, s.created, JSON.stringify({ created: s.created, from: s.from })));
  }
  for (const [id, ch] of byDevice) {
    const row = await env.DB.prepare('SELECT rules FROM devices WHERE id = ? AND deleted = 0').bind(id).first<{ rules: string }>();
    if (!row) continue;
    const rules = reconcile(parseRules(JSON.parse(row.rules), now), ch.done, ch.starts);
    stmts.push(env.DB.prepare(`UPDATE devices SET rules = ?, version = ${VER} WHERE id = ?`).bind(JSON.stringify(rules), id));
  }
  for (const id of gone)
    stmts.push(env.DB.prepare(`UPDATE devices SET deleted = 1, rules = '[]', endpoint = '', p256dh = '', auth = '', seen = ?, version = ${VER} WHERE id = ? AND deleted = 0`).bind(now, id));
  if (stmts.length > 1) await env.DB.batch(stmts);
  return { ok: true };
}

/**
 * Sprzątanie raz na dobę: nieużywane urządzenia (30 dni), urządzenia bez synchronizacji po rejestracji (7 dni), puste
 * wiersze po 2 dniach, zdarzenia po 7 dniach, liczniki limitu rejestracji po 2 h.
 */
export async function cleanup(env: Env, now: number): Promise<void> {
  await env.DB.batch([
    bump(env.DB),
    env.DB.prepare(`UPDATE devices SET deleted = 1, rules = '[]', endpoint = '', p256dh = '', auth = '', seen = ?, version = ${VER} WHERE deleted = 0 AND seen < ?`).bind(now, now - IDLE_MS),
    env.DB.prepare(
      `UPDATE devices SET deleted = 1, rules = '[]', endpoint = '', p256dh = '', auth = '', seen = ?, version = ${VER} WHERE deleted = 0 AND id IN (SELECT id FROM fresh WHERE at < ?)`
    ).bind(now, now - FRESH_MS),
    env.DB.prepare('DELETE FROM fresh WHERE at < ? OR id NOT IN (SELECT id FROM devices WHERE deleted = 0)').bind(now - FRESH_MS),
    env.DB.prepare('DELETE FROM regs WHERE at < ?').bind(now - 2 * HOUR),
    env.DB.prepare('DELETE FROM devices WHERE deleted = 1 AND seen < ?').bind(now - TOMBSTONE_MS),
    env.DB.prepare('DELETE FROM events WHERE at < ? OR device NOT IN (SELECT id FROM devices WHERE deleted = 0)').bind(now - LOG_MS),
  ]);
}

// ───────────────────────── trasy ─────────────────────────

function cors(env: Env, req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const ok = env.ORIGINS.split(',').map((s) => s.trim()).includes(origin);
  return ok ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, PUT, DELETE', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '86400', vary: 'origin' } : { vary: 'origin' };
}

const reply = (status: number, body: unknown, headers: Record<string, string>): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

export async function handle(req: Request, env: Env, now = Date.now()): Promise<Response> {
  const url = new URL(req.url);
  const h = cors(env, req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  try {
    const path = url.pathname.replace(/\/+$/, '');
    if (path === '/v1/health') return reply(200, { ok: true }, h);
    const dev = /^\/v1\/devices\/([A-Za-z0-9_-]{22})$/.exec(path);
    if (path === '/v1/devices' && req.method === 'POST') return reply(200, await register(env, (await readJson(req)).data, now, req.headers.get('cf-connecting-ip') ?? ''), h);
    if (dev && req.method === 'PUT') {
      const { data } = await readJson(req);
      return reply(200, await update(env, await deviceAuth(env, req, dev[1]), data, now), h);
    }
    if (dev && req.method === 'DELETE') return reply(200, await remove(env, (await deviceAuth(env, req, dev[1])).id, now), h);
    if (path === '/v1/sync' && req.method === 'GET') {
      if (!(await serverOk(env, req, url, '', now))) throw new HttpError(401, 'unauthorized');
      return reply(200, await sync(env, url.searchParams.get('cursor') ?? '0'), {});
    }
    if (path === '/v1/report' && req.method === 'POST') {
      const { text, data } = await readJson(req);
      if (!(await serverOk(env, req, url, text, now))) throw new HttpError(401, 'unauthorized');
      return reply(200, await report(env, data, now), {});
    }
    throw new HttpError(404, 'not found');
  } catch (e) {
    if (e instanceof HttpError) return reply(e.status, { error: e.message }, h);
    console.error('skrzynka:', e instanceof Error ? e.message : e);
    return reply(500, { error: 'internal' }, h);
  }
}
