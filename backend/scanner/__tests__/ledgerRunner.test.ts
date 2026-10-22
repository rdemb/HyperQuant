import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildVolModel, type RangeBar } from '../../../src/utils/volatility.ts';
import { isDeskLedgerSummary } from '../../../src/utils/deskLedger.ts';
import { LedgerRunner, type LedgerData } from '../ledgerRunner.ts';
import { LedgerStore } from '../ledgerStore.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const SLOT0 = Date.UTC(2026, 9, 22, 21, 0, 0);

/** Syntetyczne świece (błądzenie losowe) do zbudowania modelu zmienności. */
function bars(n: number, stepMs: number, end: number, sigma: number, seed = 1): RangeBar[] {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let px = 100_000;
  const out: RangeBar[] = [];
  for (let i = n; i > 0; i--) {
    const t = end - i * stepMs;
    const o = px;
    const c = o * Math.exp(sigma * (rnd() - 0.5) * 3.4);
    out.push({ time: t, open: o, high: Math.max(o, c) * (1 + sigma * rnd()), low: Math.min(o, c) * (1 - sigma * rnd()), close: c });
    px = c;
  }
  return out;
}

function fakeData(): LedgerData & { candles: RangeBar[] } {
  const model = buildVolModel(bars(1200, HOUR, SLOT0, 0.004), bars(2000, 5 * MIN, SLOT0, 0.0015, 7), SLOT0)!;
  const d = {
    model,
    modelAt: SLOT0,
    sigma1h: 0.004,
    levels: { pdh: 101_000, pdl: 99_000, day: Math.floor(SLOT0 / DAY) * DAY - DAY },
    candles: bars(800, MIN, SLOT0 + 12 * HOUR, 0.0006, 3),
    refreshModel: async () => {},
    refreshLevels: async () => {},
    minuteCandles: async (from: number, now: number) => d.candles.filter((b) => b.time >= from - MIN && b.time < now),
  };
  return d;
}

function runner(over: Partial<ConstructorParameters<typeof LedgerRunner>[0]> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hq-runner-'));
  const store = new LedgerStore({ dir, coin: 'BTC' });
  const published: string[] = [];
  const r = new LedgerRunner({ coin: 'BTC', data: fakeData(), store, repo: null, markPx: () => 100_000, publish: (j) => published.push(j), ...over });
  return { r, store, dir, published };
}
const lines = (dir: string, day: string) =>
  existsSync(join(dir, 'BTC', `${day}.jsonl`))
    ? readFileSync(join(dir, 'BTC', `${day}.jsonl`), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
    : [];

describe('LedgerRunner — wydawanie bez podglądania, rozstrzyganie, jawne braki', () => {
  it('slot: 3 prognozy raz; początek horyzontu = pełna minuta po wydaniu; rozstrzygnięcie od tej chwili', async () => {
    const { r, store, dir, published } = runner();
    expect(r.init(SLOT0).ok).toBe(true);
    expect((await r.tick(SLOT0 + 30_000)).appended).toBe(3);
    const f = lines(dir, '2026-10-22')[0];
    expect(f).toMatchObject({ slot: SLOT0, ti: SLOT0 + 30_000, t: SLOT0 + MIN });
    expect((await r.tick(SLOT0 + 90_000)).appended).toBe(0); // ten sam slot — bez duplikatów
    expect((await r.tick(SLOT0 + 6 * MIN)).appended).toBe(0); // okno minęło — bez wydawania wstecz
    const res = await r.tick(SLOT0 + 63 * MIN);
    // 3 pominięte sloty (21:15, 21:30, 21:45 — „przerwa”), 3 prognozy slotu 22:00, rozstrzygnięcie ret60
    expect(res.appended).toBe(7);
    const summary = JSON.parse(published[published.length - 1]);
    expect(isDeskLedgerSummary(summary)).toBe(true);
    expect(summary.scores.ret['60'].n).toBe(1);
    expect(summary.participation).toMatchObject({ issued: 2, skipped: 3 });
    expect(summary.head.lines).toBe(store.lines);
    expect(existsSync(join(dir, 'BTC', 'summary.json'))).toBe(false); // podsumowanie nie trafia do historii gałęzi ledger
  });

  it('brak ceny → nic nie jest wydawane, a slot dostaje jawny skip z powodem', async () => {
    const { r, dir } = runner({ markPx: () => null });
    r.init(SLOT0);
    expect((await r.tick(SLOT0 + 30_000)).appended).toBe(0);
    await r.tick(SLOT0 + 16 * MIN);
    expect(lines(dir, '2026-10-22')).toEqual([expect.objectContaining({ k: 's', slot: SLOT0, reason: 'no-price' })]);
  });

  it('model starszy niż 3 h → bez wydania (no-model)', async () => {
    const data = fakeData();
    data.modelAt = SLOT0 - 4 * HOUR;
    const { r, dir } = runner({ data });
    r.init(SLOT0);
    await r.tick(SLOT0 + 30_000);
    await r.tick(SLOT0 + 16 * MIN);
    expect(lines(dir, '2026-10-22')[0]).toMatchObject({ k: 's', reason: 'no-model' });
  });

  it('prognoza bez danych do rozstrzygnięcia po 6 h → jawnie unieważniona (nie znika po cichu)', async () => {
    const data = fakeData();
    data.candles = [];
    const { r, dir } = runner({ data });
    r.init(SLOT0);
    await r.tick(SLOT0 + 30_000);
    await r.tick(SLOT0 + 10 * HOUR + 7 * MIN);
    expect(lines(dir, '2026-10-23').filter((l) => l.void === 'no-data').length).toBe(3);
  });

  it('po wydaniu: pokwitowanie OTS głowy łańcucha; po 00:10 UTC — kotwica zakończonego dnia (raz)', async () => {
    const digests: string[] = [];
    const stamp = async (d: Uint8Array) => {
      digests.push(Buffer.from(d).toString('hex'));
      return { ots: new Uint8Array([1, 2, 3]), calendars: ['a', 'b'] };
    };
    const { r, store, dir, published } = runner({ stamp });
    r.init(SLOT0);
    await r.tick(SLOT0 + 30_000);
    expect(digests[0]).toBe(store.head); // głowa po dopisaniu prognoz slotu
    expect(existsSync(join(dir, 'BTC', 'ots', 'slots', '2026-10-22', `${SLOT0}.ots`))).toBe(true);
    const nextDay = Date.UTC(2026, 9, 23, 0, 12, 0);
    await r.tick(nextDay);
    await r.tick(nextDay + MIN);
    const fileDigest = createHash('sha256').update(readFileSync(join(dir, 'BTC', '2026-10-22.jsonl'))).digest('hex');
    expect(digests.filter((d) => d === fileDigest)).toHaveLength(1);
    const summary = JSON.parse(published[published.length - 1]);
    expect(summary.ots).toEqual([{ day: '2026-10-22', file: 'ots/2026-10-22.jsonl.ots', calendars: 2, stampedAt: nextDay }]);
    expect(summary.slotStamps).toBeGreaterThanOrEqual(1);
  });

  it('restart po przerwie: sloty z przerwy dostają skip „outage”; ACI odtworzone z α zapisanego przy wydaniu', async () => {
    const { r, dir, store } = runner();
    r.init(SLOT0);
    await r.tick(SLOT0 + 30_000);
    const again = new LedgerRunner({ coin: 'BTC', data: fakeData(), store: new LedgerStore({ dir, coin: 'BTC' }), repo: null, markPx: () => 100_000 });
    expect(again.init(SLOT0 + HOUR).ok).toBe(true);
    await again.tick(SLOT0 + HOUR + 30_000);
    const skips = lines(dir, '2026-10-22').filter((l) => l.k === 's');
    expect(skips.map((s) => s.slot)).toEqual([SLOT0 + 15 * MIN, SLOT0 + 30 * MIN, SLOT0 + 45 * MIN]);
    expect(skips.every((s) => s.reason === 'outage')).toBe(true);
    expect(store.lines).toBeGreaterThan(0);
  });
});

describe('LedgerRunner — pokwitowania i długie przerwy', () => {
  it('nieudane znakowanie slotu jest ponawiane tym samym skrótem (hash ostatniej prognozy slotu)', async () => {
    const digests: string[] = [];
    let fail = true;
    const stamp = async (d: Uint8Array) => {
      digests.push(Buffer.from(d).toString('hex'));
      if (fail) return null;
      return { ots: new Uint8Array([1]), calendars: ['a'] };
    };
    const { r, store, dir } = runner({ stamp });
    r.init(SLOT0);
    await r.tick(SLOT0 + 30_000);
    const head = store.head;
    fail = false;
    await r.tick(SLOT0 + 90_000);
    expect(digests).toEqual([head, head]);
    expect(existsSync(join(dir, 'BTC', 'ots', 'slots', '2026-10-22', `${SLOT0}.ots`))).toBe(true);
  });

  it('kalendarze niedostępne przez kilka slotów → po powrocie dorabiane wszystkie zaległe pokwitowania (kolejka)', async () => {
    let fail = true;
    const stamp = async () => (fail ? null : { ots: new Uint8Array([1]), calendars: ['a'] });
    const { r, dir } = runner({ stamp });
    r.init(SLOT0);
    for (const k of [0, 1, 2]) await r.tick(SLOT0 + k * 15 * MIN + 30_000);
    const receipt = (s: number) => existsSync(join(dir, 'BTC', 'ots', 'slots', '2026-10-22', `${s}.ots`));
    expect([0, 1, 2].some((k) => receipt(SLOT0 + k * 15 * MIN))).toBe(false);
    fail = false;
    await r.tick(SLOT0 + 31 * MIN);
    expect([0, 1, 2].every((k) => receipt(SLOT0 + k * 15 * MIN))).toBe(true);
  });

  it('restart: slot z prognozą bez pokwitowania trafia do kolejki przy starcie (skrót = hash ostatniej prognozy slotu)', async () => {
    const { r, dir, store } = runner({ stamp: async () => null });
    r.init(SLOT0);
    await r.tick(SLOT0 + 30_000);
    const head = store.head;
    const digests: string[] = [];
    const again = new LedgerRunner({
      coin: 'BTC',
      data: fakeData(),
      store: new LedgerStore({ dir, coin: 'BTC' }),
      repo: null,
      markPx: () => 100_000,
      stamp: async (d) => (digests.push(Buffer.from(d).toString('hex')), { ots: new Uint8Array([1]), calendars: ['a'] }),
    });
    expect(again.init(SLOT0 + 2 * MIN).ok).toBe(true);
    await again.tick(SLOT0 + 2 * MIN);
    expect(digests).toEqual([head]);
    expect(existsSync(join(dir, 'BTC', 'ots', 'slots', '2026-10-22', `${SLOT0}.ots`))).toBe(true);
  });

  it('przerwa 40 dni: zakresowy skip nie znika z podsumowania (przycinanie po końcu zakresu, nie po początku)', async () => {
    const data = fakeData();
    const { r, published } = runner({ data });
    r.init(SLOT0);
    await r.tick(SLOT0 + 30_000);
    data.modelAt = SLOT0 + 40 * DAY; // model odświeżony po powrocie
    await r.tick(SLOT0 + 40 * DAY + 30_000);
    const summary = JSON.parse(published[published.length - 1]);
    // Okno 30 dni: sloty od pierwszego pełnego slotu w oknie do ostatniego przed bieżącym
    expect(summary.participation).toMatchObject({ issued: 1, skipped: 2879 });
    expect(summary.participation.gaps).toEqual([{ slot: SLOT0 + 15 * MIN, until: SLOT0 + 40 * DAY - 15 * MIN, reason: 'outage' }]);
  });

  it('przerwa dłuższa niż doba → jeden rekord zakresowy skip (od–do), a nie tysiące linii', async () => {
    const { r, dir } = runner();
    r.init(SLOT0);
    await r.tick(SLOT0 + 30_000);
    await r.tick(SLOT0 + 3 * DAY + 30_000);
    const all = [...lines(dir, '2026-10-22'), ...lines(dir, '2026-10-25')];
    const skips = all.filter((l) => l.k === 's');
    expect(skips).toHaveLength(1);
    expect(skips[0]).toMatchObject({ slot: SLOT0 + 15 * MIN, until: SLOT0 + 3 * DAY - 15 * MIN, reason: 'outage' });
  });
});

describe('LedgerRunner — model vs rynek (HIP-4)', () => {
  const snapFor = (expiry: number) => ({
    outcome: 15711,
    K: 100_000,
    expiry,
    src: 'mark' as const,
    quote: { bid: 0.45, ask: 0.5, mid: 0.475, spread: 0.05, depthBid: 100, depthAsk: 100, liquid: true },
  });

  it('rekord rynku tylko 5–10 min po początku slotu, raz; osobne pokwitowanie <slot>-m.ots ze skrótem = hash rekordu', async () => {
    const asked: number[] = [];
    const digests: string[] = [];
    const stamp = async (d: Uint8Array) => (digests.push(Buffer.from(d).toString('hex')), { ots: new Uint8Array([1]), calendars: ['a'] });
    const { r, dir, store } = runner({ stamp, markets: async (expiry) => (asked.push(expiry), snapFor(expiry)) });
    r.init(SLOT0);
    await r.tick(SLOT0 + 30_000); // prognozy główne
    await r.tick(SLOT0 + 3 * MIN); // za wcześnie na rynek
    expect(asked).toEqual([]);
    await r.tick(SLOT0 + 6 * MIN);
    await r.tick(SLOT0 + 7 * MIN); // już wydane — bez ponownego pobrania
    expect(asked).toEqual([SLOT0 + 15 * MIN]);
    const mkt = lines(dir, '2026-10-22').filter((l) => l.kind === 'mkt');
    expect(mkt).toHaveLength(1);
    expect(mkt[0]).toMatchObject({ id: `${SLOT0}-mkt15711`, K: 100_000, expiry: SLOT0 + 15 * MIN, bid: 0.45, ask: 0.5, liquid: true, ti: SLOT0 + 6 * MIN, t: SLOT0 + 7 * MIN, h: 8 });
    expect(existsSync(join(dir, 'BTC', 'ots', 'slots', '2026-10-22', `${SLOT0}-m.ots`))).toBe(true);
    expect(digests).toContain(mkt[0].hash);
    expect(store.head).toBe(mkt[0].hash);
  });

  it('rozstrzygnięcie po terminie ze świecy 1m i wynik w podsumowaniu (market.scores, market.latest)', async () => {
    const { r, dir, published } = runner({ markets: async (expiry) => snapFor(expiry) });
    r.init(SLOT0);
    await r.tick(SLOT0 + 30_000);
    await r.tick(SLOT0 + 6 * MIN);
    await r.tick(SLOT0 + 18 * MIN);
    const res = lines(dir, '2026-10-22').find((l) => l.k === 'r' && String(l.id).includes('mkt'));
    expect(res).toMatchObject({ id: `${SLOT0}-mkt15711` });
    expect(typeof res.c1).toBe('number');
    expect(res.y).toBe(res.c1 >= 100_000 ? 1 : 0);
    const summary = JSON.parse(published[published.length - 1]);
    expect(summary.market.latest).toMatchObject({ K: 100_000, expiry: SLOT0 + 15 * MIN });
    expect(summary.market.scores.n + summary.market.scores.near + summary.market.scores.illiquid).toBe(1);
  });

  it('restart: brak pokwitowania partii „m” → kolejka przy starcie', async () => {
    const { r, dir } = runner({ markets: async (expiry) => snapFor(expiry) }); // bez znakowania
    r.init(SLOT0);
    await r.tick(SLOT0 + 30_000);
    await r.tick(SLOT0 + 6 * MIN);
    const digests: string[] = [];
    const again = new LedgerRunner({
      coin: 'BTC', data: fakeData(), store: new LedgerStore({ dir, coin: 'BTC' }), repo: null, markPx: () => 100_000,
      stamp: async (d) => (digests.push(Buffer.from(d).toString('hex')), { ots: new Uint8Array([1]), calendars: ['a'] }),
    });
    again.init(SLOT0 + 8 * MIN);
    await again.tick(SLOT0 + 8 * MIN);
    expect(existsSync(join(dir, 'BTC', 'ots', 'slots', '2026-10-22', `${SLOT0}.ots`))).toBe(true);
    expect(existsSync(join(dir, 'BTC', 'ots', 'slots', '2026-10-22', `${SLOT0}-m.ots`))).toBe(true);
    expect(digests).toHaveLength(2);
  });
});
