import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildVolModel, type RangeBar } from '../../../src/utils/volatility.ts';
import { isDeskLedgerSummary } from '../../../src/utils/deskLedger.ts';
import { LedgerRunner, type LedgerData } from '../ledgerRunner.ts';
import { LedgerStore } from '../ledgerStore.ts';
import { canonicalJson } from '../ledger.ts';
import { AB_DESIGN } from '../../../src/utils/abTest.ts';

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
    px: 100_000,
    bookTime: null,
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
    // Ensemble: brak wcześniejszych rozstrzygnięć → równy pooling logarytmiczny, p_e zapisane przy wydaniu
    expect(mkt[0].ens).toEqual({ a: 0, bm: 0.5, bk: 0.5, n: 0 });
    expect(mkt[0].rec).toEqual({ a: 0, bm: 0, bk: 1, n: 0 });
    expect(typeof mkt[0].pe).toBe('number');
    expect(mkt[0].pr).toBeCloseTo(0.475, 4); // rynek bez zmian (prior)
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

describe('LedgerRunner — model vs rynek: bez prognoz głównych slotu nie ma rekordu rynku', () => {
  it('brak ceny na początku slotu (skip) → w 5–10 min rynek nie jest pobierany ani zapisywany (bez konfliktu skip/prognoza)', async () => {
    let calls = 0;
    const asked: number[] = [];
    const { r, dir } = runner({
      markPx: () => (calls++ === 0 ? null : 100_000),
      markets: async (expiry) => (asked.push(expiry), { outcome: 1, K: 100_000, expiry, src: 'mark' as const, px: 100_000, bookTime: expiry - 9 * MIN, quote: null }),
    });
    r.init(SLOT0);
    await r.tick(SLOT0 + 30_000); // brak ceny → prognozy główne nie wydane
    await r.tick(SLOT0 + 6 * MIN);
    await r.tick(SLOT0 + 16 * MIN); // następny slot: skip dla SLOT0
    expect(asked).toEqual([]);
    const all = lines(dir, '2026-10-22');
    expect(all.filter((l) => l.kind === 'mkt')).toEqual([]);
    expect(all.filter((l) => l.k === 's').map((l) => l.slot)).toEqual([SLOT0]);
  });
});

describe('prerejestracja katalogu w dzienniku', () => {
  it('pierwsza rejestracja dopisuje rekord p; ten sam hash po restarcie → czas z dziennika, bez nowego rekordu', async () => {
    const { r, store, dir } = runner();
    expect(r.init(SLOT0).ok).toBe(true);
    const body = { id: 'lab-v1', catalogHash: 'a'.repeat(64), catalog: { version: 'lab-v1', x: [1, 2] } };
    const t1 = SLOT0 + 3 * MIN;
    const first = r.register(body, t1)!;
    expect(first).toMatchObject({ at: t1, added: true });
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.register(body, t1 + MIN)).toEqual({ at: t1, added: false, hash: first.hash });
    const recs = lines(dir, '2026-10-22').filter((o) => o.k === 'p');
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ k: 'p', id: 'lab-v1', t: t1, catalogHash: 'a'.repeat(64) });
    // Zmieniony katalog = nowa rejestracja
    expect(r.register({ ...body, catalogHash: 'b'.repeat(64) }, t1 + 2 * MIN)).toMatchObject({ at: t1 + 2 * MIN, added: true });

    const again = new LedgerRunner({ coin: 'BTC', data: fakeData(), store: new LedgerStore({ dir, coin: 'BTC' }), repo: null, markPx: () => 100_000 });
    expect(again.init(SLOT0 + HOUR).ok).toBe(true);
    expect(again.register(body, SLOT0 + HOUR)).toEqual({ at: t1, added: false, hash: first.hash });
    // Odczyt rejestracji wprost z plików (dziennik jeszcze niegotowy po restarcie)
    expect(new LedgerStore({ dir, coin: 'BTC' }).findPrereg('a'.repeat(64))).toEqual({ at: t1, hash: first.hash });
    expect(new LedgerStore({ dir, coin: 'BTC' }).findPrereg('9'.repeat(64))).toBeNull();
    expect(store.lines).toBeGreaterThanOrEqual(2);
  });
  it('rekord prerejestracji nie psuje ładowania ani łańcucha; dziennik zatwierdza zmianę przy najbliższym przebiegu', async () => {
    const { r, dir } = runner();
    r.init(SLOT0);
    r.register({ id: 'lab-v1', catalogHash: 'c'.repeat(64), catalog: {} }, SLOT0 + MIN);
    const res = await r.tick(SLOT0 + 2 * MIN);
    expect(res.appended).toBeGreaterThanOrEqual(0);
    const st = new LedgerStore({ dir, coin: 'BTC' }).load(SLOT0 + 3 * MIN);
    expect(st.ok).toBe(true);
    expect(st.preregs.map((p) => p.catalogHash)).toEqual(['c'.repeat(64)]);
  });
});

describe('prerejestracja a trwający przebieg dziennika', () => {
  it('w trakcie przebiegu (np. czekanie na świece przez północ UTC) → null, bez dopisywania', async () => {
    const { r, dir } = runner();
    r.init(SLOT0);
    const p = r.tick(SLOT0 + MIN);
    expect(r.register({ id: 'lab-v1', catalogHash: 'd'.repeat(64), catalog: {} }, SLOT0 + MIN)).toBeNull();
    await p;
    expect(lines(dir, '2026-10-22').filter((o) => o.k === 'p')).toHaveLength(0);
    expect(r.register({ id: 'lab-v1', catalogHash: 'd'.repeat(64), catalog: {} }, SLOT0 + 2 * MIN)).toMatchObject({ added: true });
  });
});

describe('A/B wersji modelu: wariant B z reżimem BOCPD', () => {
  it('przy świeżym reżimie wydaje ret60b w tej samej partii co A; B nie zmienia ACI wersji A; podsumowanie ma sekcję ab', async () => {
    const data = fakeData() as ReturnType<typeof fakeData> & { regime?: unknown; regimeAt?: number; refreshRegime?: (now: number) => Promise<void> };
    data.regime = { sigma5: 0.0015, run: 40, pChange: 0.01 };
    data.regimeAt = SLOT0;
    data.refreshRegime = async () => {};
    const { r, dir, published } = runner({ data });
    r.init(SLOT0);
    await r.tick(SLOT0 + MIN);
    const day = lines(dir, '2026-10-22');
    const a = day.find((l) => l.id === `${SLOT0}-ret60`);
    const b = day.find((l) => l.id === `${SLOT0}-ret60b`);
    expect(b).toMatchObject({ variant: 'B', model: 'ledger-har-fhs-bocpd-v1', ti: a.ti, t: a.t, h: 60 });
    // B zaraz po A (ta sama partia pokwitowania slotu)
    expect(day.findIndex((l) => l.id === `${SLOT0}-ret60b`)).toBeGreaterThan(day.findIndex((l) => l.id === `${SLOT0}-ret60`));
    // Rozstrzygnięcie po horyzoncie: ACI wersji A zmienia tylko rozstrzygnięcie A
    await r.tick(SLOT0 + 2 * HOUR);
    const summary = JSON.parse(published.at(-1)!);
    expect(summary.ab).toMatchObject({ h: 60, model: 'ledger-har-fhs-bocpd-v1' });
    expect(summary.ab.latest.regime).toEqual(data.regime);
    expect(isDeskLedgerSummary(summary)).toBe(true);
  });
  it('błąd pobrania reżimu nie wstrzymuje wersji A — slot bez wariantu B', async () => {
    const data = fakeData() as ReturnType<typeof fakeData> & { regime?: unknown; regimeAt?: number; refreshRegime?: (now: number) => Promise<void> };
    data.regime = { sigma5: 0.0015, run: 40, pChange: 0.01 };
    data.regimeAt = SLOT0;
    data.refreshRegime = async () => {
      throw new Error('HTTP 429');
    };
    const { r, dir } = runner({ data });
    r.init(SLOT0);
    await r.tick(SLOT0 + MIN);
    const day = lines(dir, '2026-10-22');
    expect(day.some((l) => l.id === `${SLOT0}-ret60`)).toBe(true);
    expect(day.some((l) => String(l.id).endsWith('ret60b'))).toBe(false);
  });
  it('plan oceny A/B prerejestrowany raz w łańcuchu (hash kanonicznego planu); podsumowanie podaje czas rejestracji', async () => {
    const data = fakeData() as ReturnType<typeof fakeData> & { regime?: unknown; regimeAt?: number; refreshRegime?: (now: number) => Promise<void> };
    data.regime = { sigma5: 0.0015, run: 40, pChange: 0.01 };
    data.regimeAt = SLOT0;
    data.refreshRegime = async () => {};
    const { r, dir, published } = runner({ data });
    r.init(SLOT0);
    await r.tick(SLOT0 + MIN);
    await r.tick(SLOT0 + 16 * MIN);
    const p = lines(dir, '2026-10-22').filter((l) => l.k === 'p');
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ id: 'ab-v1', catalog: AB_DESIGN });
    expect(p[0].catalogHash).toBe(createHash('sha256').update(canonicalJson(AB_DESIGN)).digest('hex'));
    expect(JSON.parse(published.at(-1)!).ab.registeredAt).toBe(p[0].t);
    // ponowne uruchomienie: plan już w dzienniku — bez drugiego rekordu
    const again = new LedgerRunner({ coin: 'BTC', data, store: new LedgerStore({ dir, coin: 'BTC' }), repo: null, markPx: () => 100_000, publish: () => {} });
    expect(again.init(SLOT0 + 20 * MIN).ok).toBe(true);
    await again.tick(SLOT0 + 31 * MIN);
    expect(lines(dir, '2026-10-22').filter((l) => l.k === 'p')).toHaveLength(1);
  });
  it('reżim z poprzedniego slotu (nawet sprzed 5 min) albo brak — bez wariantu B', async () => {
    for (const at of [SLOT0 - 5 * MIN, SLOT0 - HOUR, undefined]) {
      const data = fakeData() as ReturnType<typeof fakeData> & { regime?: unknown; regimeAt?: number };
      data.regime = at === undefined ? null : { sigma5: 0.0015, run: 40, pChange: 0.01 };
      data.regimeAt = at;
      const { r, dir } = runner({ data });
      r.init(SLOT0);
      await r.tick(SLOT0 + MIN);
      expect(lines(dir, '2026-10-22').some((l) => String(l.id).endsWith('ret60b'))).toBe(false);
    }
  });
});

import { isCat } from '../../../src/utils/deskLedger.ts';
import { loadCatModel } from '../forecaster.ts';
import { agg, synth } from '../../../src/utils/__tests__/schrodiSynth.ts';
import { checkCat, checkResolutions, checkTrust } from '../../../scripts/verify-ledger.mjs';
import { HOUR_DESIGN, TRUST_DESIGN } from '../../../src/utils/schrodiTrust.ts';
import { isHourTrust, isTrust } from '../../../src/utils/deskLedger.ts';
import { checkHour, checkHourTrust, checkMarket } from '../../../scripts/verify-ledger.mjs';

describe('LedgerRunner — Schrödi (kot) w partii slotu', () => {
  const m1 = synth(7, SLOT0 - 31 * DAY, 31);
  const inp = { m1, m5: agg(m1, 5 * MIN), h1: agg(m1, HOUR), d1: agg(m1, DAY), events: [] };
  const cat = loadCatModel();

  it('kot wydany z prognozami slotu (te same chwile), rozstrzygnięty po 1 h; wynik w podsumowaniu; weryfikator przelicza p', async () => {
    const data = { ...fakeData(), cat, catInput: { slot: SLOT0, inp }, refreshCat: async () => {} };
    const { r, dir, published } = runner({ data });
    r.init(SLOT0);
    // 3 prognozy desku, kot i plany oceny zaufania i godziny na żywo (prerejestrowane raz, przed prognozami slotu)
    expect((await r.tick(SLOT0 + 30_000)).appended).toBe(6);
    const recs = lines(dir, '2026-10-22');
    const c = recs.find((l) => l.kind === 'cat');
    expect(c).toMatchObject({ id: `${SLOT0}-cat`, slot: SLOT0, ti: SLOT0 + 30_000, t: SLOT0 + MIN, bar: SLOT0 - 5 * MIN });
    // Ta sama chwila wydania i partia pokwitowania co prognozy desku
    expect(recs.filter((l) => l.k === 'f').every((l) => l.slot === SLOT0 && l.ti === SLOT0 + 30_000)).toBe(true);
    await r.tick(SLOT0 + 63 * MIN);
    const all = [...recs, ...lines(dir, '2026-10-22').slice(recs.length), ...lines(dir, '2026-10-23')];
    const res = all.find((l) => l.k === 'r' && l.id === `${SLOT0}-cat`);
    expect(res).toMatchObject({ yDir: expect.any(Number), yBig: expect.any(Number) });
    const s = JSON.parse(published[published.length - 1]);
    expect(isCat(s.cat)).toBe(true);
    // Slot 22:00 bez danych kota z tego slotu: 2 sloty desku, 1 prognoza kota (brak widoczny w podsumowaniu)
    expect(s.cat).toMatchObject({ model: 'schrodi-v1', since: SLOT0 + MIN, issued: 1, slots: 2, latest: { t: SLOT0 + MIN } });
    expect(s.cat.scores.n).toBe(1);
    expect(checkResolutions(all)).toEqual([]);
    const model = JSON.parse(readFileSync(new URL('../../../public/schrodi/model-v1.json', import.meta.url), 'utf8'));
    const touch = JSON.parse(readFileSync(new URL('../../../public/schrodi/touch-v1.json', import.meta.url), 'utf8'));
    expect(c.tl.length).toBeGreaterThan(0);
    expect(checkCat(all, model, touch)).toEqual({ problems: [], checked: 1 });
    // Zmienione p albo cechy po zapisie → weryfikator wykrywa
    expect(checkCat([{ ...c, pUp: c.pUp + 0.01 }], model, touch).problems).toHaveLength(1);
    expect(checkCat([{ ...c, mh: '0'.repeat(64) }], model, touch).problems[0]).toMatch(/hash modelu/);
    // Szanse dotknięcia i stożek: zmiana po zapisie, inny model albo brak modelu → wykryte
    expect(checkCat([{ ...c, tl: c.tl.map((l: { p: number }, i: number) => (i ? l : { ...l, p: l.p + 0.01 })) }], model, touch).problems[0]).toMatch(/dotknięcie/);
    expect(checkCat([{ ...c, cone: c.cone.map((q: { up: number | null }) => ({ ...q, up: q.up === null ? null : q.up + 1 })) }], model, touch).problems[0]).toMatch(/stożek/);
    expect(checkCat([{ ...c, th: '0'.repeat(64) }], model, touch).problems[0]).toMatch(/hash modelu dotknięć/);
    expect(checkCat([c], model).problems[0]).toMatch(/brak publicznego modelu dotknięć/);
    expect(checkResolutions([c, { ...res, yBig: 1 - res.yBig }])).toHaveLength(1);
  });

  it('dane kota z innego slotu albo brak modelu → slot bez kota, reszta prognoz bez zmian', async () => {
    const data = { ...fakeData(), cat, catInput: { slot: SLOT0 - 15 * MIN, inp }, refreshCat: async () => {} };
    const { r } = runner({ data });
    r.init(SLOT0);
    expect((await r.tick(SLOT0 + 30_000)).appended).toBe(5); // 3 prognozy + plany zaufania i godziny na żywo
    const failing = { ...fakeData(), cat, refreshCat: async () => Promise.reject(new Error('429')) };
    const { r: r2 } = runner({ data: failing });
    r2.init(SLOT0);
    expect((await r2.tick(SLOT0 + 30_000)).appended).toBe(5);
  });

  it('plan zaufania w łańcuchu przed oceną (hash przypięty); ocenia pełne godziny po rejestracji, także po restarcie; weryfikator przelicza', async () => {
    // Zmiana planu = nowy identyfikator i nowy rekord; ten hash chroni przed cichą zmianą planu już zapisanego w dzienniku
    expect(createHash('sha256').update(canonicalJson(TRUST_DESIGN)).digest('hex')).toBe('08e5f569137533fba1629dc2b5a6597fcd36252717151d874b43d789f56f98f6');
    const m1b = synth(7, SLOT0 - 30 * DAY, 31);
    const inp2 = { m1: m1b, m5: agg(m1b, 5 * MIN), h1: agg(m1b, HOUR), d1: agg(m1b, DAY), events: [] };
    const data = { ...fakeData(), cat, catInput: { slot: SLOT0, inp: inp2 } as { slot: number; inp: typeof inp2 } | null, refreshCat: async () => {} };
    const { r, dir, published } = runner({ data });
    r.init(SLOT0);
    await r.tick(SLOT0 + 30_000);
    const p = lines(dir, '2026-10-22').filter((l) => l.k === 'p');
    expect(p.map((l) => l.id)).toEqual([TRUST_DESIGN.id, HOUR_DESIGN.id]);
    expect(p[0]).toMatchObject({ id: TRUST_DESIGN.id, t: SLOT0 + 30_000, catalog: JSON.parse(canonicalJson(TRUST_DESIGN)) });
    data.catInput = { slot: SLOT0 + HOUR, inp: inp2 };
    await r.tick(SLOT0 + HOUR + 30_000);
    await r.tick(SLOT0 + 2 * HOUR + 3 * MIN);
    const s = JSON.parse(published.at(-1)!);
    expect(isCat(s.cat) && isTrust(s.cat.trust)).toBe(true);
    expect(s.cat.trust.plan).toEqual({ id: TRUST_DESIGN.id, hash: p[0].hash, at: p[0].t });
    // 21:00 wydany przed rejestracją planu — poza oceną; 22:00 w ocenie; obie godziny w wynikach 30 dni
    expect(s.cat.scores.nEff).toBe(2);
    expect(s.cat.trust.big).toMatchObject({ n: 1, path: [expect.any(Number)], step: 1 });
    expect(s.cat.trust.dir.n).toBe(1);
    // Restart: godziny z całego dziennika, ta sama ocena
    const again = new LedgerRunner({ coin: 'BTC', data: { ...data, catInput: null }, store: new LedgerStore({ dir, coin: 'BTC' }), repo: null, markPx: () => 100_000, publish: () => {} });
    expect(again.init(SLOT0 + 2 * HOUR + 4 * MIN).ok).toBe(true);
    expect(JSON.parse(JSON.stringify(again.summary(s.asOf).cat!.trust))).toEqual(s.cat.trust);
    // Weryfikator: plan zgodny z kodem, ocena przeliczona z rekordów identyczna z podsumowaniem
    const all = [...lines(dir, '2026-10-22'), ...lines(dir, '2026-10-23')];
    const v = checkTrust(all);
    expect(v.problems).toEqual([]);
    expect(JSON.parse(JSON.stringify(v.trust))).toEqual(s.cat.trust);
    const forged = all.map((l) => (l.k === 'p' ? { ...l, catalog: { ...l.catalog, proof: { ...l.catalog.proof, threshold: 10 } } } : l));
    expect(checkTrust(forged).problems[0]).toMatch(/różni się od kodu/);
  });
  it('godzina na żywo: plan w łańcuchu (hash przypięty), zapisy o :15 i :30 z rekordu kota z początku godziny, wynik z godziny zegara; weryfikator przelicza', async () => {
    expect(createHash('sha256').update(canonicalJson(HOUR_DESIGN)).digest('hex')).toBe('4fe6367dfb9ae7e00787699ae863a131adea18ac974173a455430496d4b554c3');
    const m1b = synth(7, SLOT0 - 30 * DAY, 31);
    const inp2 = { m1: m1b, m5: agg(m1b, 5 * MIN), h1: agg(m1b, HOUR), d1: agg(m1b, DAY), events: [] };
    // Świece rozstrzygnięć = te same minuty co dane kota (cechy i wynik z jednego rynku)
    const rb = m1b.map((b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c }));
    const data = {
      ...fakeData(),
      cat,
      catInput: { slot: SLOT0, inp: inp2 },
      refreshCat: async () => {},
      minuteCandles: async (from: number, now: number) => rb.filter((b) => b.time >= from - MIN && b.time < now),
    };
    const { r, dir, published } = runner({ data });
    r.init(SLOT0);
    for (let k = 0; k < 8; k++) {
      data.catInput = { slot: SLOT0 + k * 15 * MIN, inp: inp2 };
      await r.tick(SLOT0 + k * 15 * MIN + 30_000);
    }
    await r.tick(SLOT0 + 2 * HOUR + 2 * MIN);
    const all = [...lines(dir, '2026-10-22'), ...lines(dir, '2026-10-23')];
    const hr = all.filter((l) => l.k === 'f' && l.kind === 'hour');
    // Tylko :15 i :30 (o :45 bez zapisu), z ceną, progiem i szansami kota z początku godziny
    expect(hr.map((l) => (l.slot - SLOT0) / MIN)).toEqual([15, 30, 75, 90]);
    const c = all.find((l) => l.id === `${SLOT0}-cat`);
    expect(hr[0]).toMatchObject({ id: `${SLOT0 + 15 * MIN}-hour`, hs: SLOT0, t: SLOT0 + 16 * MIN, h: 44, px0: c.px0, thr: c.thr, model: 'schrodi-hour-v1' });
    expect(hr[0].x[0]).toBe(15);
    expect(hr[1]).toMatchObject({ hs: SLOT0, h: 29 });
    // Rozstrzygnięcie z godziny zegara [hs, hs + 1 h): cena odniesienia = zamknięcie minuty przed jej początkiem
    const res = all.find((l) => l.k === 'r' && l.id === hr[0].id);
    const win = rb.filter((b) => b.time >= SLOT0 && b.time < SLOT0 + HOUR);
    expect(res).toMatchObject({
      c0: rb.find((b) => b.time === SLOT0 - MIN)!.close,
      c1: win.at(-1)!.close,
      hi: Math.max(...win.map((b) => b.high)),
      lo: Math.min(...win.map((b) => b.low)),
    });
    const s = JSON.parse(published.at(-1)!);
    expect(isCat(s.cat) && isHourTrust(s.cat.hour)).toBe(true);
    const p = all.find((l) => l.k === 'p' && l.id === HOUR_DESIGN.id);
    expect(s.cat.hour.plan).toEqual({ id: HOUR_DESIGN.id, hash: p.hash, at: p.t });
    // 21:00 zaczęła się przed rejestracją planu — poza oceną; 22:00 w ocenie (krok = godzina, dwa zapisy)
    expect(s.cat.hour.big).toMatchObject({ n: 1, path: [expect.any(Number)] });
    expect(s.cat.hour.dir.n).toBe(2);
    // Restart: zapisy z całego dziennika, ta sama ocena
    const again = new LedgerRunner({ coin: 'BTC', data: { ...data, catInput: null }, store: new LedgerStore({ dir, coin: 'BTC' }), repo: null, markPx: () => 100_000, publish: () => {} });
    expect(again.init(SLOT0 + 2 * HOUR + 3 * MIN).ok).toBe(true);
    expect(JSON.parse(JSON.stringify(again.summary(s.asOf).cat!.hour))).toEqual(s.cat.hour);
    // Weryfikator: p z cech i publicznego modelu, plan zgodny z kodem, ocena identyczna, ceny i cechy drogi ceny ze świec
    const hm = JSON.parse(readFileSync(new URL('../../../public/schrodi/hour-v1.json', import.meta.url), 'utf8'));
    expect(checkHour(all, hm)).toEqual({ problems: [], checked: 4 });
    expect(checkResolutions(all)).toEqual([]);
    const v = checkHourTrust(all);
    expect(v.problems).toEqual([]);
    expect(JSON.parse(JSON.stringify(v.trust))).toEqual(s.cat.hour);
    const mk = checkMarket(all, rb);
    expect(mk.problems).toEqual([]);
    expect(mk.hourFeatures).toBe(4);
    // Zmiany po zapisie → wykryte
    const h0 = hr[0];
    expect(checkHour([c, { ...h0, pBig: h0.pBig + 0.01 }], hm).problems[0]).toMatch(/pBig/);
    expect(checkHour([c, { ...h0, x: h0.x.map((v: number, i: number) => (i === 6 ? v + 0.1 : v)) }], hm).problems[0]).toMatch(/szanse startowe/);
    expect(checkHour([h0], hm).problems[0]).toMatch(/brak prognozy kota/);
    expect(checkMarket([{ ...h0, x: h0.x.map((v: number, i: number) => (i === 1 ? v + 0.01 : v)) }], rb).problems[0]).toMatch(/cechy drogi ceny/);
    const forged = all.map((l) => (l.k === 'p' && l.id === HOUR_DESIGN.id ? { ...l, catalog: { ...l.catalog, checkpoints: [15, 30, 45] } } : l));
    expect(checkHourTrust(forged).problems[0]).toMatch(/różni się od kodu/);
  });
});
