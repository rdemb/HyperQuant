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
