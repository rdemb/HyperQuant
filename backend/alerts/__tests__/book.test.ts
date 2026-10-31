import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { AlertEngine, type AlertRule, type AlertTrade } from '../../../src/utils/alertRules.ts';
import { handle } from '../../../workers/alerts/src/box.ts';
import { DeviceBook, readState } from '../book.ts';
import { loadKeys } from '../keys.ts';
import { Mailbox } from '../mailbox.ts';
import { quantile } from '../push.ts';

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
const candle = (t: number, h: number, l: number, c: number) => ({ t, h, l, c });

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

  it('uruchomiony alarm nie wraca z synchronizacji, zanim skrzynka przyjmie zdarzenie (także po restarcie); zmieniony wraca', () => {
    const book = new DeviceBook();
    book.apply(dev('A', [rule('1'), rule('2', { price: 70_000 })]));
    const engine = new AlertEngine();
    const before = book.rules;
    const r = engine.onTrades(before, 'BTC', [tr(T0 + 1000, 65_100)]);
    book.rules = r.rules!;
    const out = book.split(r.events, before);
    book.hold(out.events);
    // Skrzynka jeszcze bez zdarzenia oddaje urządzenie z tym samym alarmem
    book.apply(dev('A', [rule('1'), rule('2', { price: 70_000 })]));
    expect(book.rules.map((x) => x.id)).toEqual(['A/2']);
    // Po restarcie: zdarzenia z zapisanej kolejki trzymają alarm tak samo
    const fresh = new DeviceBook();
    fresh.hold(JSON.parse(JSON.stringify(out.events)));
    fresh.apply(dev('A', [rule('1'), rule('2', { price: 70_000 })]));
    expect(fresh.rules.map((x) => x.id)).toEqual(['A/2']);
    // Alarm zmieniony po zdarzeniu (nowa chwila ustawienia) to nowy alarm
    book.apply(dev('A', [rule('1', { created: T0 + 5000 }), rule('2', { price: 70_000 })]));
    expect(book.rules.map((x) => x.id)).toEqual(['A/1', 'A/2']);
    book.release(out.events);
    book.apply(dev('A', [rule('1'), rule('2', { price: 70_000 })]));
    expect(book.rules.map((x) => x.id)).toEqual(['A/1', 'A/2']);
  });
});

describe('serwer powiadomień: restart i krok', () => {
  it('restart usługi w trakcie okna: luka od zapisanej ostatniej transakcji uzupełniona przy pierwszej transakcji po starcie', () => {
    const W = { from: T0, until: T0 + 30 * M };
    const rules = () => [rule('c', { kind: 'close', iv: '5m', dir: -1, price: 64_660, closes: 2, ...W }), rule('t', { price: 64_500, dir: -1, ...W })];
    const book = new DeviceBook();
    book.apply(dev('A', rules()));
    const engine = new AlertEngine(true);
    const r = engine.onTrades(book.rules, 'BTC', [tr(T0 + M, 64_700), tr(T0 + 4 * M, 64_650), tr(T0 + 5 * M + 1000, 64_650)]);
    book.rules = r.rules ?? book.rules;
    // Zapis co 30 s i przy zatrzymaniu: stan pilnowania razem z ostatnią transakcją
    const file = JSON.parse(JSON.stringify({ v: 2, rules: book.snapshot(), last: engine.lastTrades() }));
    expect(file).toEqual({ v: 2, rules: { 'A/c': { armed: false, streak: 1 } }, last: { BTC: T0 + 5 * M + 1000 } });

    // Nowy proces: stan, luka od zapisanej chwili, alarmy ze skrzynki
    const st = readState(file);
    const again = new DeviceBook();
    again.restore(st.rules);
    const fresh = new AlertEngine(true);
    for (const [coin, t] of Object.entries(st.last)) fresh.gap(coin, t);
    again.apply(dev('A', rules()));
    expect(again.rules.find((x) => x.id === 'A/c')?.streak).toBe(1);
    // Pierwsza wiadomość: migawka z ostatnią transakcją sprzed restartu (pominięta) i nowa
    const first = fresh.onTrades(again.rules, 'BTC', [tr(T0 + 5 * M + 1000, 64_650), tr(T0 + 12 * M, 64_600)]);
    expect(first.events).toEqual([]);
    expect(fresh.hole('BTC')).toEqual({ from: T0 + 5 * M + 1000, to: T0 + 12 * M });
    const before = first.rules ?? again.rules;
    const minutes = [5, 6, 7, 8, 9, 10, 11].map((k) => candle(T0 + k * M, 64_700, k === 7 ? 64_490 : 64_630, 64_640));
    const g = fresh.fillGap(before, 'BTC', T0 + 12 * M, minutes);
    expect(g.events.map((e) => [e.type, e.rule.id, e.at, e.gap])).toEqual([
      ['fire', 'A/t', T0 + 7 * M, true],
      ['fire', 'A/c', T0 + 10 * M, true],
    ]);
    expect(again.split(g.events, before).events.map((e) => [e.device, e.rule.id])).toEqual([
      ['A', 't'],
      ['A', 'c'],
    ]);
  });

  it('zapis stanu sprzed tej wersji (same alarmy) czyta się dalej', () => {
    expect(readState({ 'A/r': { armed: true, streak: 0 } })).toEqual({ rules: { 'A/r': { armed: true, streak: 0 } }, last: {} });
    expect(readState({ v: 2, rules: {}, last: { BTC: 5, ETH: 'x', SOL: -1 } })).toEqual({ rules: {}, last: { BTC: 5 } });
    expect(readState(null)).toEqual({ rules: {}, last: {} });
  });

  it('krok nie trzyma alarmu: wraca z synchronizacji jak przed zdarzeniem', () => {
    const book = new DeviceBook();
    book.apply(dev('A', [rule('1')]));
    book.hold([{ device: 'A', type: 'step', rule: rule('1'), at: T0 + 1000, px: 65_000, facts: null, hole: { from: T0, to: T0 + 1000 } }]);
    book.apply(dev('A', [rule('1')]));
    expect(book.rules.map((x) => x.id)).toEqual(['A/1']);
  });

  it('kwantyl opóźnień: najbliższa ranga', () => {
    const l = [120, 180, 250, 300, 2400];
    expect(quantile(l, 0.5)).toBe(250);
    expect(quantile(l, 0.95)).toBe(2400);
    expect(quantile([40], 0.95)).toBe(40);
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
