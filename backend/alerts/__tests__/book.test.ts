import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { AlertEngine, type AlertRule, type AlertTrade } from '../../../src/utils/alertRules.ts';
import { handle } from '../../../workers/alerts/src/box.ts';
import { DeviceBook } from '../book.ts';
import { loadKeys } from '../keys.ts';
import { Mailbox } from '../mailbox.ts';

const T0 = 1_800_000_000_000;
const M = 60_000;
const rule = (id: string, over: Partial<AlertRule> = {}): AlertRule => ({
  id,
  coin: 'BTC',
  price: 65_000,
  kind: 'touch',
  dir: 1,
  iv: '15m',
  closes: 1,
  delta: false,
  from: 0,
  until: T0 + 3600_000,
  pair: '',
  note: '',
  after: '',
  created: T0,
  armed: false,
  streak: 0,
  ...over,
});
const dev = (id: string, rules: AlertRule[] | null) => ({ id, endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, p256dh: 'k', auth: 'a', lang: 'pl', rules });
const tr = (time: number, px: number): AlertTrade => ({ time, px, sz: 1, side: 1, key: `k${time}` });

describe('serwer powiadomień: alarmy wielu urządzeń w jednym silniku', () => {
  it('pary i łańcuchy działają tylko w obrębie urządzenia; zdarzenia wracają z identyfikatorami przeglądarki', () => {
    const book = new DeviceBook();
    book.apply(dev('A', [rule('1', { pair: 'p' }), rule('2', { price: 64_000, dir: -1, pair: 'p' }), rule('3', { price: 70_000, after: '1' })]));
    book.apply(dev('B', [rule('1', { pair: 'p', price: 66_000 }), rule('2', { price: 64_000, dir: -1, pair: 'p' })]));
    const engine = new AlertEngine();
    const before = book.rules;
    const { rules, events } = engine.onTrades(before, 'BTC', [tr(T0 + 1000, 65_100)]);
    book.rules = rules!;
    const out = book.split(events, before);
    expect(out.events.map((e) => [e.device, e.type, e.rule.id, e.rule.pair])).toEqual([
      ['A', 'fire', '1', 'p'],
      ['A', 'cancel', '2', 'p'],
    ]);
    expect(out.starts).toEqual([{ device: 'A', id: '3', created: T0 + 1000, from: T0 + 1000 }]);
    expect(book.rules.map((r) => r.id)).toEqual(['A/3', 'B/1', 'B/2']);
  });

  it('lista z przeglądarki nie cofa stanu serwera; zmieniony alarm (nowa chwila ustawienia) zaczyna od nowa', () => {
    const book = new DeviceBook();
    book.apply(dev('A', [rule('r', { kind: 'reclaim', price: 65_000, dir: 1 })]));
    const engine = new AlertEngine();
    const r1 = engine.onTrades(book.rules, 'BTC', [tr(T0 + M, 64_900)]);
    book.rules = r1.rules!;
    expect(book.rules[0].armed).toBe(true);
    book.apply(dev('A', [rule('r', { kind: 'reclaim', price: 65_000, dir: 1 }), rule('n')]));
    expect(book.rules.find((r) => r.id === 'A/r')?.armed).toBe(true);
    book.apply(dev('A', [rule('r', { kind: 'reclaim', price: 65_100, dir: 1, created: T0 + 2 * M })]));
    expect(book.rules.map((r) => [r.id, r.armed])).toEqual([['A/r', false]]);
    book.apply(dev('A', null));
    expect(book.rules).toEqual([]);
    expect(book.devices.size).toBe(0);
  });

  it('stan pilnowania przeżywa restart serwera', () => {
    const book = new DeviceBook();
    book.apply(dev('A', [rule('r', { kind: 'close', closes: 3 })]));
    book.rules = book.rules.map((r) => ({ ...r, streak: 2 }));
    const again = new DeviceBook();
    again.restore(JSON.parse(JSON.stringify(book.snapshot())));
    again.apply(dev('A', [rule('r', { kind: 'close', closes: 3 })]));
    expect(again.rules[0].streak).toBe(2);
  });
});

describe('serwer powiadomień ↔ skrzynka', () => {
  it('klucze tworzone raz (plik 0600), potem te same', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-alerts-'));
    const a = loadKeys(dir);
    const b = loadKeys(dir);
    expect(a.signPublic).toBe(b.signPublic);
    expect(a.vapid.publicKey).toBe(b.vapid.publicKey);
    expect(Buffer.from(a.vapid.publicKey, 'base64url')).toHaveLength(65);
    expect(statSync(join(dir, 'alerts-keys.json')).mode & 0o777).toBe(0o600);
    expect(Object.keys(JSON.parse(readFileSync(join(dir, 'alerts-keys.json'), 'utf8')))).toEqual(['vapid', 'sign']);
  });

  it('podpisane zapytania serwera przechodzą przez skrzynkę; obcy klucz nie', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(readFileSync(new URL('../../../workers/alerts/schema.sql', import.meta.url), 'utf8'));
    const stmt = (sql: string, p: unknown[] = []) => {
      const args = p as (string | number | null)[];
      return {
        bind: (...v: unknown[]) => stmt(sql, v),
        first: async <T,>() => (db.prepare(sql).get(...args) as T | undefined) ?? null,
        all: async <T,>() => ({ results: db.prepare(sql).all(...args) as T[] }),
        run: async () => db.prepare(sql).run(...args),
        exec: () => db.prepare(sql).run(...args),
      };
    };
    const env = { DB: { prepare: (s: string) => stmt(s), batch: async (l: unknown[]) => l.map((s) => (s as ReturnType<typeof stmt>).exec()) }, DATA_BASE_URL: 'https://data.example/main', ORIGINS: '' };
    const keys = loadKeys(mkdtempSync(join(tmpdir(), 'hq-alerts-')));
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ server: keys.signPublic })));
    const toWorker = (async (u: string, init?: RequestInit) => handle(new Request(u, init), env)) as typeof fetch;
    try {
      const box = new Mailbox('https://box.example/', keys.sign, toWorker);
      expect(await box.sync('0')).toEqual({ cursor: '0', more: false, devices: [] });
      await box.report({ events: [], starts: [], gone: ['x'] });
      const stranger = new Mailbox('https://box.example', generateKeyPairSync('ed25519').privateKey, toWorker);
      await expect(stranger.sync('0')).rejects.toThrow('HTTP 401');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
