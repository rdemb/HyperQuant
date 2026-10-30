import { createECDH, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { signedMessage } from '../../../src/utils/alertsServer.ts';
import { type D1, type D1Stmt, type Env, MAX_RULES, cleanup, handle } from '../src/box.ts';

/** D1 na SQLite z Node: te same zapytania i paczki w jednej transakcji. */
function memoryD1(): { db: DatabaseSync; d1: D1 } {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  type Run = D1Stmt & { exec(): unknown };
  const stmt = (sql: string, params: unknown[] = []): Run => {
    const p = () => db.prepare(sql);
    const args = params as (string | number | null)[];
    return {
      bind: (...v: unknown[]) => stmt(sql, v),
      first: async <T,>() => (p().get(...args) as T | undefined) ?? null,
      all: async <T,>() => ({ results: p().all(...args) as T[] }),
      run: async () => p().run(...args),
      exec: () => p().run(...args),
    };
  };
  const d1: D1 = {
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try {
        const out = list.map((s) => (s as Run).exec());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return { db, d1 };
}

const T0 = 1_800_000_000_000;
const BASE = 'https://hyperquant-alerts.example.workers.dev';
const ORIGIN = 'https://rdemb.github.io';
const server = generateKeyPairSync('ed25519');
const serverPub = (server.publicKey.export({ format: 'jwk' }) as { x: string }).x;

function sub(n = 1) {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  return { endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, n).toString('base64url') } };
}

const rule = (id: string, over: Record<string, unknown> = {}) => ({ id, coin: 'BTC', price: 65_000, kind: 'touch', dir: 1, until: T0 + 3_600_000, created: T0 - 1000, ...over });

function call(env: Env, method: string, path: string, opts: { body?: unknown; token?: string; signed?: boolean; now?: number; time?: number } = {}) {
  const now = opts.now ?? T0;
  const text = opts.body === undefined ? '' : JSON.stringify(opts.body);
  const headers: Record<string, string> = { origin: ORIGIN };
  if (text) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.signed) {
    const time = opts.time ?? now;
    headers['x-hq-time'] = String(time);
    headers['x-hq-sig'] = sign(null, Buffer.from(signedMessage(method, path, time, text)), server.privateKey).toString('base64url');
  }
  return handle(new Request(BASE + path, { method, headers, body: text || undefined }), env, now);
}

describe('skrzynka alarmów (Worker + D1)', () => {
  const { db, d1 } = memoryD1();
  const env: Env = { DB: d1, DATA_BASE_URL: 'https://data.example/main/', ORIGINS: `${ORIGIN},http://localhost:5173` };
  const fetches: string[] = [];
  beforeAll(() => {
    vi.stubGlobal('fetch', async (u: string) => (fetches.push(String(u)), new Response(JSON.stringify({ server: serverPub, vapid: 'x' }))));
  });
  afterAll(() => vi.unstubAllGlobals());

  let dev = { id: '', token: '' };

  it('rejestracja: subskrypcja tylko z usług push, alarmy oczyszczone, token zapisany jako skrót', async () => {
    expect((await call(env, 'POST', '/v1/devices', { body: { sub: { ...sub(), endpoint: 'https://evil.example/x' }, rules: [] } })).status).toBe(400);
    expect((await call(env, 'POST', '/v1/devices', { body: { sub: { ...sub(), keys: { p256dh: 'AAAA', auth: 'BBBB' } }, rules: [] } })).status).toBe(400);
    const many = Array.from({ length: 40 }, (_, i) => rule(`r${i}`));
    const res = await call(env, 'POST', '/v1/devices', { body: { sub: sub(), lang: 'en', rules: [rule('doge', { coin: 'DOGE' }), { id: 'broken' }, ...many] } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const out = (await res.json()) as { id: string; token: string; rules: { id: string }[] };
    expect(out.id).toMatch(/^[\w-]{22}$/);
    expect(out.rules.map((r) => r.id)).toEqual(many.slice(0, MAX_RULES).map((r) => r.id));
    const row = db.prepare('SELECT token, lang FROM devices WHERE id = ?').get(out.id) as { token: string; lang: string };
    expect(row.token).not.toBe(out.token);
    expect(row.lang).toBe('en');
    dev = out;
  });

  it('CORS tylko dla strony desku; zapytanie preflight bez treści', async () => {
    const pre = await handle(new Request(`${BASE}/v1/devices`, { method: 'OPTIONS', headers: { origin: ORIGIN } }), env, T0);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toContain('PUT');
    const other = await handle(new Request(`${BASE}/v1/health`, { headers: { origin: 'https://evil.example' } }), env, T0);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('zmiana alarmów tylko z tokenem urządzenia', async () => {
    expect((await call(env, 'PUT', `/v1/devices/${dev.id}`, { body: { rules: [] }, token: 'zly' })).status).toBe(404);
    const res = await call(env, 'PUT', `/v1/devices/${dev.id}`, {
      body: { lang: 'pl', since: T0, rules: [rule('a'), rule('b', { kind: 'close', pair: 'p' }), rule('c', { kind: 'reclaim', pair: 'p' }), rule('d', { after: 'a' })] },
      token: dev.token,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { rules: { id: string }[] }).rules.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('serwer: tylko z podpisem klucza z repo danych, aktualnym czasem i nietkniętą treścią', async () => {
    expect((await call(env, 'GET', '/v1/sync?cursor=0')).status).toBe(401);
    expect((await call(env, 'GET', '/v1/sync?cursor=0', { signed: true, time: T0 - 120_000 })).status).toBe(401);
    const res = await call(env, 'GET', '/v1/sync?cursor=0', { signed: true });
    expect(res.status).toBe(200);
    expect(fetches[0]).toBe('https://data.example/main/alerts/keys.json');
    const out = (await res.json()) as { cursor: string; more: boolean; devices: { id: string; lang: string; rules: { id: string }[] }[] };
    expect(out.devices).toHaveLength(1);
    expect(out.devices[0]).toMatchObject({ id: dev.id, lang: 'pl' });
    expect(out.devices[0].rules.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    // Od kursora: bez zmian nic nowego
    const again = (await (await call(env, 'GET', `/v1/sync?cursor=${out.cursor}`, { signed: true })).json()) as { devices: unknown[]; cursor: string };
    expect(again.devices).toEqual([]);
    expect(again.cursor).toBe(out.cursor);
    // Podpis innej treści nie przechodzi
    const time = T0;
    const forged = await handle(
      new Request(`${BASE}/v1/report`, {
        method: 'POST',
        headers: { 'x-hq-time': String(time), 'x-hq-sig': sign(null, Buffer.from(signedMessage('POST', '/v1/report', time, '{}')), server.privateKey).toString('base64url') },
        body: JSON.stringify({ gone: [dev.id] }),
      }),
      env,
      T0
    );
    expect(forged.status).toBe(401);
  });

  it('raport serwera: uruchomiony alarm i anulowany z pary znikają, start z łańcucha zapisany, historia wraca do przeglądarki', async () => {
    const fired = { device: dev.id, type: 'fire', rule: rule('a'), at: T0 + 5000, px: 65_001, facts: null };
    const cancelled = { device: dev.id, type: 'cancel', rule: rule('c', { kind: 'reclaim', pair: 'p' }), at: T0 + 5000, px: 65_001, facts: null };
    const res = await call(env, 'POST', '/v1/report', { body: { events: [fired, cancelled], starts: [{ device: dev.id, id: 'd', created: T0 + 5000, from: T0 + 5000 }] }, signed: true, now: T0 + 6000 });
    expect(res.status).toBe(200);
    const stored = JSON.parse((db.prepare('SELECT rules FROM devices WHERE id = ?').get(dev.id) as { rules: string }).rules) as { id: string; after: string; created: number }[];
    expect(stored.map((r) => r.id)).toEqual(['b', 'd']);
    expect(stored[1]).toMatchObject({ after: '', created: T0 + 5000 });
    // Przeglądarka wraca z nieaktualną listą: zakończone alarmy nie wracają, start z łańcucha przyjęty, historia od `since`
    const put = await call(env, 'PUT', `/v1/devices/${dev.id}`, { body: { lang: 'pl', since: T0, rules: [rule('a'), rule('b'), rule('d', { after: 'a' }), rule('e')] }, token: dev.token, now: T0 + 9000 });
    const out = (await put.json()) as { rules: { id: string; after: string }[]; events: { type: string; rule: { id: string } }[] };
    expect(out.rules.map((r) => [r.id, r.after])).toEqual([
      ['b', ''],
      ['d', ''],
      ['e', ''],
    ]);
    expect(out.events.map((e) => [e.type, e.rule.id])).toEqual([
      ['fire', 'a'],
      ['cancel', 'c'],
    ]);
  });

  it('wygasła subskrypcja i wyłączenie przez użytkownika usuwają urządzenie (serwer dostaje pusty wpis)', async () => {
    const second = (await (await call(env, 'POST', '/v1/devices', { body: { sub: sub(2), rules: [rule('x')] } })).json()) as { id: string; token: string };
    const before = ((await (await call(env, 'GET', '/v1/sync?cursor=0', { signed: true })).json()) as { cursor: string }).cursor;
    await call(env, 'POST', '/v1/report', { body: { gone: [second.id] }, signed: true });
    expect((await call(env, 'DELETE', `/v1/devices/${dev.id}`, { token: dev.token })).status).toBe(200);
    const out = (await (await call(env, 'GET', `/v1/sync?cursor=${before}`, { signed: true })).json()) as { devices: { id: string; rules: unknown; endpoint: string }[] };
    expect(out.devices.map((d) => [d.id, d.rules, d.endpoint]).sort()).toEqual([
      [dev.id, null, ''],
      [second.id, null, ''],
    ].sort());
    expect((await call(env, 'PUT', `/v1/devices/${dev.id}`, { body: { rules: [] }, token: dev.token })).status).toBe(404);
    expect((db.prepare('SELECT COUNT(*) AS n FROM events WHERE device = ?').get(dev.id) as { n: number }).n).toBe(0);
  });

  it('sprzątanie: urządzenie bez kontaktu 30 dni, puste wpisy po 2 dniach, zdarzenia po 7 dniach', async () => {
    const idle = (await (await call(env, 'POST', '/v1/devices', { body: { sub: sub(3), rules: [rule('y')] }, now: T0 })).json()) as { id: string };
    db.prepare("INSERT INTO events (device, rule, kind, at, body) VALUES (?, 'y', 'fire', ?, '{}')").run(idle.id, T0);
    await cleanup(env, T0 + 31 * 86_400_000);
    const rows = db.prepare('SELECT id, deleted FROM devices ORDER BY id').all() as { id: string; deleted: number }[];
    expect(rows.find((r) => r.id === idle.id)?.deleted).toBe(1);
    expect(rows.every((r) => r.id === idle.id)).toBe(true);
    expect((db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n).toBe(0);
  });
});

describe('skrzynka alarmów: limit rejestracji i urządzenia bez synchronizacji', () => {
  const { db, d1 } = memoryD1();
  const env: Env = { DB: d1, DATA_BASE_URL: 'https://data.example/main/', ORIGINS: ORIGIN };
  const HOUR = 3_600_000;
  const reg = (n: number, ip: string, now: number) =>
    handle(
      new Request(`${BASE}/v1/devices`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ sub: sub(n), rules: [] }) }),
      env,
      now
    );

  it('najwyżej 10 rejestracji z jednego adresu w godzinie; inny adres i następna godzina bez blokady; w bazie bez adresu', async () => {
    const t = T0 - (T0 % HOUR) + 60_000;
    for (let i = 0; i < 10; i++) expect((await reg(100 + i, '203.0.113.7', t + i)).status).toBe(200);
    expect((await reg(120, '203.0.113.7', t + 20)).status).toBe(429);
    expect((await reg(121, '198.51.100.4', t + 21)).status).toBe(200);
    expect((await reg(122, '203.0.113.7', t + HOUR)).status).toBe(200);
    const keys = db.prepare('SELECT k FROM regs').all() as { k: string }[];
    expect(keys.length).toBeGreaterThan(0);
    expect(JSON.stringify(keys)).not.toMatch(/203\.0\.113|198\.51\.100/);
    // Liczniki starsze niż 2 h znikają przy kolejnej rejestracji
    expect((await reg(123, '192.0.2.1', t + 3 * HOUR + 1000)).status).toBe(200);
    expect((db.prepare('SELECT COUNT(*) AS n FROM regs').get() as { n: number }).n).toBe(1);
  });

  it('urządzenie bez żadnej synchronizacji znika po 7 dniach, zsynchronizowane zostaje', async () => {
    const t = T0 + 10 * 86_400_000;
    const lone = (await (await reg(200, '', t)).json()) as { id: string };
    const used = (await (await reg(201, '', t)).json()) as { id: string; token: string };
    expect((await call(env, 'PUT', `/v1/devices/${used.id}`, { body: { rules: [rule('a')] }, token: used.token, now: t + 1000 })).status).toBe(200);
    await cleanup(env, t + 6 * 86_400_000);
    const alive = (id: string) => (db.prepare('SELECT deleted FROM devices WHERE id = ?').get(id) as { deleted: number }).deleted === 0;
    expect(alive(lone.id)).toBe(true);
    await cleanup(env, t + 8 * 86_400_000);
    expect(alive(lone.id)).toBe(false);
    expect(alive(used.id)).toBe(true);
    expect(db.prepare('SELECT id FROM fresh WHERE id IN (?, ?)').all(lone.id, used.id)).toEqual([]);
  });
});
