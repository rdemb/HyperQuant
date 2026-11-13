import { describe, expect, it } from 'vitest';
import type { ScannedPosition } from '../../../src/utils/liqMap.ts';
import { buildLiqTape, isLiqTape } from '../../../src/utils/liqTape.ts';
import { LiqConfirmer } from '../liqDetect.ts';

/**
 * Taśma likwidacji: kandydat żyje 24 h (nie 30 min), kolejka w kolejności wartości, tempo zależne od długości kolejki,
 * a przy sumach udział niepotwierdzonych, opóźnienie potwierdzeń i znacznik niepełnej sumy z ostatniej godziny.
 */
const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const addr = (i: number) => `0x${String(i).padStart(40, '0')}`;
const pos = (szi: number, liqPx = 95_000, scannedAt = T0): ScannedPosition => ({ szi, entryPx: 100_000, liqPx, scannedAt });
const liqFill = (tid: number, sz: string, time: number) => ({ coin: 'BTC', px: '95000', sz, time, tid, liquidation: { markPx: 94_990, method: 'market' } });

function fakeRest(answer: (body: { user: string }) => unknown) {
  const calls: { user: string }[] = [];
  return {
    calls,
    info: async (body: unknown) => {
      calls.push(body as { user: string });
      return answer(body as { user: string });
    },
    charge: () => {},
  };
}

describe('LiqConfirmer: czas życia, kolejność, tempo', () => {
  it('kandydat żyje 24 h: sprawdzony po 5 h (gdy wcześniej nie było budżetu); po 24 h nieudany bez zapytania', async () => {
    const rest = fakeRest(() => [liqFill(1, '2', T0 + MIN)]);
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 3 });
    c.enqueue({ addr: addr(1), prev: pos(2), from: T0, to: T0 + 2 * MIN });
    c.enqueue({ addr: addr(2), prev: pos(2), from: T0, to: T0 + 2 * MIN });
    await c.process({ ...rest, healthy: () => false }, T0 + 3 * MIN);
    expect(await c.process(rest, T0 + 5 * HOUR)).toBe(2);
    expect(c.events()).toHaveLength(1);
    c.enqueue({ addr: addr(3), prev: pos(2), from: T0, to: T0 + 2 * MIN });
    expect(await c.process(rest, T0 + 25 * HOUR)).toBe(0);
    expect(c.checks(T0 + 25 * HOUR).failed).toBe(1);
  });

  it('kolejka w kolejności wartości pozycji (rozmiar × cena likwidacji), nie kolejności wpisu', async () => {
    const rest = fakeRest(() => []);
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 1 });
    c.enqueue({ addr: addr(1), prev: pos(0.1), from: T0, to: T0 + MIN });
    c.enqueue({ addr: addr(2), prev: pos(30), from: T0, to: T0 + MIN });
    c.enqueue({ addr: addr(3), prev: pos(-2, 105_000), from: T0, to: T0 + MIN });
    await c.process(rest, T0 + 2 * MIN);
    expect(rest.calls.map((b) => b.user)).toEqual([addr(2)]);
    await c.process(rest, T0 + 3 * MIN + 1);
    await c.process(rest, T0 + 4 * MIN + 2);
    expect(rest.calls.map((b) => b.user)).toEqual([addr(2), addr(3), addr(1)]);
  });

  it('tempo rośnie z długością kolejki (kolejka na ~10 min), najwyżej 12 zapytań na minutę', async () => {
    const rest = fakeRest(() => []);
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 3 });
    for (let i = 0; i < 60; i++) c.enqueue({ addr: addr(i), prev: pos(1 + i), from: T0, to: T0 + MIN });
    expect(await c.process(rest, T0 + 2 * MIN)).toBe(6);
    for (let i = 60; i < 300; i++) c.enqueue({ addr: addr(i), prev: pos(1), from: T0, to: T0 + MIN });
    expect(await c.process(rest, T0 + 3 * MIN + 1)).toBe(12);
    // krótka kolejka: tempo bazowe
    const d = new LiqConfirmer({ coin: 'BTC', maxPerMin: 3 });
    for (let i = 0; i < 5; i++) d.enqueue({ addr: addr(i), prev: pos(1), from: T0, to: T0 + MIN });
    expect(await d.process(rest, T0 + 2 * MIN)).toBe(3);
  });

  it('przepełniona kolejka (500) odrzuca najmniejszą wartość, nie najstarszego kandydata', () => {
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 3 });
    c.enqueue({ addr: addr(0), prev: pos(50), from: T0, to: T0 + MIN });
    for (let i = 1; i <= 500; i++) c.enqueue({ addr: addr(i), prev: pos(1), from: T0, to: T0 + MIN + i });
    expect(c.pending).toBe(500);
    expect(c.backlog()).toEqual({ pending: 500, pendingUsd: 50 * 95_000 + 499 * 95_000 });
  });
});

describe('taśma: udział niepotwierdzonych, opóźnienie potwierdzeń, niepełna suma 1 h', () => {
  it('udział niepotwierdzonych = (czekające + nieudane) / (kandydaci + czekające); suma 1 h niepełna przy kolejce', () => {
    const tape = buildLiqTape([], { coin: 'BTC', asOf: T0, since: T0 - 30 * HOUR, checks: { candidates: 18, confirmed: 15, rejected: 2, failed: 1 }, backlog: { pending: 2, pendingUsd: 380_000 } });
    expect(tape.unconfirmed).toEqual({ pending: 2, pendingUsd: 380_000, failed: 1, share: 3 / 20, h1Complete: false });
    expect(isLiqTape(tape)).toBe(true);
    const done = buildLiqTape([], { coin: 'BTC', asOf: T0, since: T0 - 30 * HOUR, checks: { candidates: 0, confirmed: 0, rejected: 0, failed: 0 }, backlog: { pending: 0, pendingUsd: 0 } });
    expect(done.unconfirmed).toEqual({ pending: 0, pendingUsd: 0, failed: 0, share: null, h1Complete: true });
  });

  it('opóźnienie: od czasu likwidacji do potwierdzenia (mediana i p90, min); czas potwierdzenia nie jest publikowany w zdarzeniu', async () => {
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 12 });
    const delays = [5, 10, 20, 40, 300];
    delays.forEach((d, i) => c.enqueue({ addr: addr(i), prev: pos(2, 95_000, T0 - 2 * HOUR), from: T0 - 2 * HOUR, to: T0 - HOUR + i }));
    // potwierdzenia przychodzą w różnych chwilach: każde w swoim przebiegu
    for (const [i, d] of delays.entries()) {
      const rest = fakeRest((b) => (b.user === addr(i) ? [liqFill(100 + i, '2', T0 - d * MIN)] : []));
      const solo = new LiqConfirmer({ coin: 'BTC', maxPerMin: 12 });
      solo.enqueue({ addr: addr(i), prev: pos(2, 95_000, T0 - 6 * HOUR), from: T0 - 6 * HOUR, to: T0 - d * MIN });
      await solo.process(rest, T0);
      c.events().push(...solo.events());
    }
    const tape = buildLiqTape(c.events(), { coin: 'BTC', asOf: T0, since: T0 - 30 * HOUR, checks: c.checks(T0), backlog: c.backlog() });
    expect(tape.delay).toEqual({ n: 5, medMin: 20, p90Min: 196 });
    for (const e of tape.events) expect(Object.keys(e)).not.toContain('foundAt');
    // stan na dysk zachowuje chwilę potwierdzenia (bez adresów)
    const back = LiqConfirmer.fromJSON(JSON.parse(JSON.stringify(c.toJSON())), { coin: 'BTC', maxPerMin: 3 });
    expect(buildLiqTape(back.events(), { coin: 'BTC', asOf: T0, since: T0 - 30 * HOUR, checks: back.checks(T0) }).delay).toEqual({ n: 5, medMin: 20, p90Min: 196 });
  });

  it('dawny plik bez nowych pól nadal przechodzi strażnika (dotychczasowi czytelnicy działają)', () => {
    const tape = buildLiqTape([], { coin: 'BTC', asOf: T0, since: T0, checks: { candidates: 0, confirmed: 0, rejected: 0, failed: 0 } });
    const { unconfirmed: _u, delay: _d, ...old } = tape;
    expect(isLiqTape(old)).toBe(true);
    expect(isLiqTape({ ...tape, unconfirmed: { pending: 'x' } })).toBe(false);
  });
});

describe('LiqConfirmer: kolejka kandydatów przetrwa restart (stan na dysku serwera)', () => {
  it('toJSON zapisuje kolejkę, fromJSON ją odtwarza; kandydat po restarcie zostaje potwierdzony, a udział niepotwierdzonych się nie zeruje', async () => {
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 3 });
    c.enqueue({ addr: addr(1), prev: pos(2), from: T0, to: T0 + 2 * MIN });
    c.enqueue({ addr: addr(2), prev: pos(3), from: T0, to: T0 + 2 * MIN });
    const back = LiqConfirmer.fromJSON(JSON.parse(JSON.stringify(c.toJSON())), { coin: 'BTC', maxPerMin: 3 });
    expect(back.backlog()).toEqual(c.backlog());
    expect(back.pending).toBe(2);
    const rest = fakeRest((b) => (b.user === addr(1) ? [liqFill(7, '2', T0 + MIN)] : []));
    expect(await back.process(rest, T0 + 10 * MIN)).toBe(2);
    expect(back.events()).toHaveLength(1);
    expect(back.pending).toBe(0);
  });

  it('przy odczycie pomija uszkodzone wpisy kolejki (adres, pozycja, okno fillów); stary stan bez kolejki działa', () => {
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 3 });
    c.enqueue({ addr: addr(1), prev: pos(2), from: T0, to: T0 + 2 * MIN });
    const j = JSON.parse(JSON.stringify(c.toJSON()));
    j.queue.push({ addr: 'nie-adres', prev: pos(1), from: T0, to: T0 + MIN, attempts: 0 });
    j.queue.push({ addr: addr(3), prev: { szi: 'x' }, from: T0, to: T0 + MIN, attempts: 0 });
    j.queue.push({ addr: addr(4), prev: pos(1), from: T0, to: Number.NaN, attempts: 0 });
    const back = LiqConfirmer.fromJSON(j, { coin: 'BTC', maxPerMin: 3 });
    expect(back.pending).toBe(1);
    const { queue: _q, ...old } = j;
    expect(LiqConfirmer.fromJSON(old, { coin: 'BTC', maxPerMin: 3 }).pending).toBe(0);
  });

  it('TTL przy odczycie: kandydat starszy niż 24 h w chwili odczytu nie wraca do kolejki i liczy się jako nieudany', () => {
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 3 });
    c.enqueue({ addr: addr(1), prev: pos(2), from: T0, to: T0 + 2 * MIN });
    c.enqueue({ addr: addr(2), prev: pos(2), from: T0 + 20 * HOUR, to: T0 + 20 * HOUR + 2 * MIN });
    const now = T0 + 25 * HOUR;
    const back = LiqConfirmer.fromJSON(JSON.parse(JSON.stringify(c.toJSON())), { coin: 'BTC', maxPerMin: 3, now });
    expect(back.pending).toBe(1);
    expect(back.backlog().pendingUsd).toBe(2 * 95_000);
    expect(back.checks(now).failed).toBe(1);
  });
});

describe('LiqConfirmer: taśma tylko od since (restart z przerwą, przerwa WebSocket)', () => {
  const since = T0 + HOUR;

  it('restart z przerwą ≥ 2 min: kandydaci sprzed since usunięci bez zapytań, bez zdarzeń i bez zmiany liczników', async () => {
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 3 });
    c.enqueue({ addr: addr(1), prev: pos(2), from: T0, to: T0 + 2 * MIN });
    c.enqueue({ addr: addr(2), prev: pos(2), from: T0, to: T0 + 3 * MIN });
    const back = LiqConfirmer.fromJSON(JSON.parse(JSON.stringify(c.toJSON())), { coin: 'BTC', maxPerMin: 3, now: since });
    const before = back.checks(since + MIN);
    expect(back.dropBefore(since)).toBe(2);
    const rest = fakeRest(() => [liqFill(9, '2', T0 + MIN)]);
    expect(await back.process(rest, since + MIN)).toBe(0);
    expect(rest.calls).toHaveLength(0);
    expect(back.events()).toHaveLength(0);
    expect(back.pending).toBe(0);
    expect(back.checks(since + MIN)).toEqual(before);
  });

  it('przerwa WebSocket w biegu: to samo dla kolejki w pamięci', async () => {
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 3 });
    c.enqueue({ addr: addr(1), prev: pos(2), from: T0, to: T0 + 2 * MIN });
    expect(c.dropBefore(since)).toBe(1);
    const rest = fakeRest(() => [liqFill(9, '2', T0 + MIN)]);
    expect(await c.process(rest, since + MIN)).toBe(0);
    expect(c.checks(since + MIN)).toMatchObject({ candidates: 0, confirmed: 0, rejected: 0, failed: 0 });
  });

  it('kandydat z oknem przez granicę: fill po since daje zdarzenie; fill przed since — bez zdarzenia i bez odrzucenia', async () => {
    const after = new LiqConfirmer({ coin: 'BTC', maxPerMin: 3 });
    after.dropBefore(since);
    after.enqueue({ addr: addr(1), prev: pos(2), from: since - 30 * MIN, to: since + 5 * MIN });
    await after.process(fakeRest(() => [liqFill(11, '2', since + MIN)]), since + 6 * MIN);
    expect(after.events()).toHaveLength(1);
    const beforeCut = new LiqConfirmer({ coin: 'BTC', maxPerMin: 3 });
    beforeCut.dropBefore(since);
    beforeCut.enqueue({ addr: addr(1), prev: pos(2), from: since - 30 * MIN, to: since + 5 * MIN });
    await beforeCut.process(fakeRest(() => [liqFill(12, '2', since - 29 * MIN)]), since + 6 * MIN);
    expect(beforeCut.events()).toHaveLength(0);
    expect(beforeCut.checks(since + 6 * MIN)).toMatchObject({ candidates: 0, confirmed: 0, rejected: 0, failed: 0 });
  });

  it('isQueued: wpis bez skończonego prev.scannedAt albo z liqPx ≤ 0 odrzucony', () => {
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 3 });
    c.enqueue({ addr: addr(1), prev: pos(2), from: T0, to: T0 + 2 * MIN });
    const j = JSON.parse(JSON.stringify(c.toJSON()));
    const { scannedAt: _s, ...noScan } = j.queue[0].prev;
    j.queue.push({ ...j.queue[0], addr: addr(5), prev: noScan });
    j.queue.push({ ...j.queue[0], addr: addr(6), prev: { ...j.queue[0].prev, liqPx: 0 } });
    expect(LiqConfirmer.fromJSON(j, { coin: 'BTC', maxPerMin: 3 }).pending).toBe(1);
  });
});

describe('LiqConfirmer: przy odczycie najpierw granica okresu (since), potem TTL', () => {
  it('kandydat sprzed 25 h: restart z przerwą (nowe since) → pending 0 i failed 0; restart bez przerwy (since ciągłe) → failed 1', () => {
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 3 });
    c.enqueue({ addr: addr(1), prev: pos(2), from: T0, to: T0 + 2 * MIN });
    const j = JSON.parse(JSON.stringify(c.toJSON()));
    const now = T0 + 25 * HOUR;
    const gap = LiqConfirmer.fromJSON(j, { coin: 'BTC', maxPerMin: 3, now, since: now });
    expect(gap.pending).toBe(0);
    expect(gap.checks(now).failed).toBe(0);
    const cont = LiqConfirmer.fromJSON(j, { coin: 'BTC', maxPerMin: 3, now, since: T0 - HOUR });
    expect(cont.pending).toBe(0);
    expect(cont.checks(now).failed).toBe(1);
  });
});

describe('LiqConfirmer: przyczyny nieudanych i wartość (udział niepotwierdzonych według USD)', () => {
  const usdOf = (szi: number) => Math.abs(szi) * 95_000;

  it('każda przyczyna osobno: przepełnienie, TTL, błąd API, obcięta odpowiedź; failed = suma przyczyn; wartość z pozycji', async () => {
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 12 });
    // Przepełnienie: 501 kandydatów, najmniejszy wypada
    for (let i = 1; i <= 501; i++) c.enqueue({ addr: addr(i), prev: pos(i === 1 ? 0.01 : 2), from: T0, to: T0 + MIN });
    let k = c.checks(T0 + 2 * MIN);
    expect(k.failedBy).toMatchObject({ overflow: 1, ttl: 0, api: 0, truncated: 0 });
    expect(k.failedUsd).toBe(usdOf(0.01));
    // TTL: reszta kolejki wygasa bez zapytań
    const ttl = new LiqConfirmer({ coin: 'BTC', maxPerMin: 3 });
    ttl.enqueue({ addr: addr(1), prev: pos(2), from: T0, to: T0 + MIN });
    await ttl.process(fakeRest(() => []), T0 + 25 * HOUR);
    expect(ttl.checks(T0 + 25 * HOUR).failedBy).toMatchObject({ ttl: 1 });
    // Błąd API po 3 próbach
    const api = new LiqConfirmer({ coin: 'BTC', maxPerMin: 12 });
    api.enqueue({ addr: addr(1), prev: pos(2), from: T0, to: T0 + MIN });
    for (let i = 0; i < 3; i++) await api.process(fakeRest(() => null), T0 + (2 + i) * MIN);
    expect(api.checks(T0 + 5 * MIN).failedBy).toMatchObject({ api: 1 });
    // Obcięta odpowiedź (≥ 2000 filli)
    const cut = new LiqConfirmer({ coin: 'BTC', maxPerMin: 12 });
    cut.enqueue({ addr: addr(1), prev: pos(3), from: T0, to: T0 + MIN });
    await cut.process(fakeRest(() => Array.from({ length: 2000 }, (_, i) => ({ coin: 'BTC', px: '95000', sz: '0.001', time: T0, tid: i }))), T0 + 2 * MIN);
    k = cut.checks(T0 + 2 * MIN);
    expect(k.failedBy).toMatchObject({ truncated: 1 });
    expect(k.failedUsd).toBe(usdOf(3));
    for (const x of [c, ttl, api, cut]) {
      const q = x.checks(T0 + 25 * HOUR + 1);
      const by = q.failedBy!;
      expect(by.overflow + by.ttl + by.api + by.truncated + by.unknown).toBe(q.failed);
    }
  });

  it('odrzucenia mają wartość (mianownik udziału według USD); stary stan bez przyczyn: „unknown”, bez wartości', async () => {
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 12 });
    c.enqueue({ addr: addr(1), prev: pos(2), from: T0, to: T0 + MIN });
    await c.process(fakeRest(() => []), T0 + 2 * MIN);
    expect(c.checks(T0 + 2 * MIN)).toMatchObject({ rejected: 1, rejectedUsd: usdOf(2) });
    const old = LiqConfirmer.fromJSON({ v: 1, events: [], log: [['failed', T0 + MIN], ['rejected', T0 + MIN]] }, { coin: 'BTC', maxPerMin: 3 });
    expect(old.checks(T0 + 2 * MIN)).toMatchObject({ failed: 1, rejected: 1, failedBy: { unknown: 1 }, failedUsd: 0, rejectedUsd: 0 });
    // Zapis i odczyt zachowują przyczynę i wartość
    const back = LiqConfirmer.fromJSON(JSON.parse(JSON.stringify(c.toJSON())), { coin: 'BTC', maxPerMin: 3 });
    expect(back.checks(T0 + 2 * MIN)).toMatchObject({ rejected: 1, rejectedUsd: usdOf(2) });
  });

  it('TTL przy odczycie stanu zapisuje przyczynę ttl z wartością', () => {
    const c = new LiqConfirmer({ coin: 'BTC', maxPerMin: 3 });
    c.enqueue({ addr: addr(1), prev: pos(2), from: T0, to: T0 + 2 * MIN });
    const now = T0 + 25 * HOUR;
    const back = LiqConfirmer.fromJSON(JSON.parse(JSON.stringify(c.toJSON())), { coin: 'BTC', maxPerMin: 3, now, since: T0 - HOUR });
    expect(back.checks(now)).toMatchObject({ failed: 1, failedBy: { ttl: 1 }, failedUsd: usdOf(2) });
  });

  it('taśma: unconfirmed.shareUsd = (czekający + nieudani) / (potwierdzeni + czekający + nieudani) według USD, bez odrzuconych; share w sztukach bez zmian', () => {
    const checks = { candidates: 4, confirmed: 2, rejected: 1, failed: 1, failedBy: { overflow: 1, ttl: 0, api: 0, truncated: 0, unknown: 0 }, failedUsd: 10_000, rejectedUsd: 40_000 };
    const ev = (t: number, usd: number) => ({ t, side: 'long' as const, sz: usd / 95_000, px: 95_000, usd, method: 'market' as const, markPx: 95_000, mapLiqPx: null, mapAgeMin: null });
    const tape = buildLiqTape([ev(T0 - 10 * MIN, 30_000), ev(T0 - 5 * MIN, 20_000)], { coin: 'BTC', asOf: T0, since: T0 - 30 * HOUR, checks, backlog: { pending: 1, pendingUsd: 0 } });
    expect(tape.unconfirmed?.share).toBeCloseTo(2 / 5, 10);
    expect(tape.unconfirmed?.failedUsd).toBe(10_000);
    expect(tape.unconfirmed?.shareUsd).toBeCloseTo(10_000 / (50_000 + 10_000), 10);
    expect(tape.unconfirmed?.shareUsdWhy).toBeUndefined();
    expect(tape.checks.failedBy).toEqual(checks.failedBy);
    expect(isLiqTape(tape)).toBe(true);
    // Stary kształt (bez nowych pól) dalej przechodzi; zły kształt nowych pól — nie
    const { failedBy: _a, failedUsd: _b, rejectedUsd: _c, ...oldChecks } = tape.checks;
    const { shareUsd: _d, failedUsd: _e, ...oldU } = tape.unconfirmed!;
    expect(isLiqTape({ ...tape, checks: oldChecks, unconfirmed: oldU })).toBe(true);
    expect(isLiqTape({ ...tape, unconfirmed: { ...tape.unconfirmed!, shareUsd: 'x' } })).toBe(false);
  });

  it('odrzuceni nie rozmywają miary: duże odrzucone nie obniżają shareUsd', () => {
    const base = { candidates: 3, confirmed: 1, rejected: 1, failed: 1, failedBy: { overflow: 1, ttl: 0, api: 0, truncated: 0, unknown: 0 }, failedUsd: 30_000 };
    const ev = { t: T0 - MIN, side: 'long' as const, sz: 1, px: 95_000, usd: 260_000, method: 'market' as const, markPx: 95_000, mapLiqPx: null, mapAgeMin: null };
    const small = buildLiqTape([ev], { coin: 'BTC', asOf: T0, since: T0 - 30 * HOUR, checks: { ...base, rejectedUsd: 0 }, backlog: { pending: 0, pendingUsd: 0 } });
    const huge = buildLiqTape([ev], { coin: 'BTC', asOf: T0, since: T0 - 30 * HOUR, checks: { ...base, rejectedUsd: 2_000_000_000 }, backlog: { pending: 0, pendingUsd: 0 } });
    expect(huge.unconfirmed?.shareUsd).toBeCloseTo(30_000 / 290_000, 10);
    expect(huge.unconfirmed?.shareUsd).toBe(small.unconfirmed?.shareUsd);
  });

  it('stan sprzed zmiany w oknie (failedBy.unknown > 0): shareUsd null z powodem; po wyjściu starego wpisu z okna — liczba', () => {
    const c = LiqConfirmer.fromJSON({ v: 1, events: [], log: [['failed', T0]] }, { coin: 'BTC', maxPerMin: 3 });
    c.enqueue({ addr: addr(1), prev: pos(0.001), from: T0, to: T0 + MIN });
    for (let i = 1; i <= 500; i++) c.enqueue({ addr: addr(i + 1), prev: pos(2), from: T0, to: T0 + MIN });
    const at = (now: number) => buildLiqTape(c.events(), { coin: 'BTC', asOf: now, since: T0 - 30 * HOUR, checks: c.checks(now), backlog: c.backlog() });
    const early = at(T0 + 2 * MIN);
    expect(early.unconfirmed?.shareUsd).toBeNull();
    expect(early.unconfirmed?.shareUsdWhy).toBe('stan sprzed zmiany, pełne po 24 h');
    expect(isLiqTape(early)).toBe(true);
    const later = at(T0 + 24 * HOUR + 30_000);
    expect(later.checks.failedBy?.unknown).toBe(0);
    expect(typeof later.unconfirmed?.shareUsd).toBe('number');
  });

  it('kwoty w publicznym pliku do 100 USD: checks.failedUsd i rejectedUsd zaokrąglone, udział z wartości dokładnych', () => {
    const checks = { candidates: 2, confirmed: 0, rejected: 1, failed: 1, failedBy: { overflow: 0, ttl: 1, api: 0, truncated: 0, unknown: 0 }, failedUsd: 12_345, rejectedUsd: 67_891 };
    const tape = buildLiqTape([], { coin: 'BTC', asOf: T0, since: T0 - 30 * HOUR, checks, backlog: { pending: 0, pendingUsd: 0 } });
    expect(tape.checks.failedUsd).toBe(12_300);
    expect(tape.checks.rejectedUsd).toBe(67_900);
    expect(tape.unconfirmed?.failedUsd).toBe(12_300);
    expect(tape.unconfirmed?.shareUsd).toBe(1);
  });
});
