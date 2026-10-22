import { mkdtempSync, readFileSync } from 'node:fs';
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
    const hi = Math.max(o, c) * (1 + sigma * rnd());
    const lo = Math.min(o, c) * (1 - sigma * rnd());
    out.push({ time: t, open: o, high: hi, low: lo, close: c });
    px = c;
  }
  return out;
}

function fakeData(): LedgerData & { candles: RangeBar[] } {
  const model = buildVolModel(bars(1200, HOUR, SLOT0, 0.004), bars(2000, 5 * MIN, SLOT0, 0.0015, 7), SLOT0)!;
  const candles = bars(400, MIN, SLOT0 + 6 * HOUR, 0.0006, 3).map((b) => ({ ...b }));
  return {
    model,
    sigma1h: 0.004,
    levels: { pdh: 101_000, pdl: 99_000, day: Math.floor(SLOT0 / DAY) * DAY - DAY },
    candles,
    refreshModel: async () => {},
    refreshLevels: async () => {},
    minuteCandles: async function (this: { candles: RangeBar[] }, from: number, now: number) {
      return this.candles.filter((b) => b.time >= from - MIN && b.time < now);
    },
  };
}

describe('LedgerRunner — wydawanie, rozstrzyganie, kotwiczenie', () => {
  it('slot 15 min: 3 prognozy raz; rozstrzygnięcie po horyzoncie; podsumowanie poprawne; ACI z rozstrzygnięć', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-runner-'));
    const store = new LedgerStore({ dir, coin: 'BTC' });
    const data = fakeData();
    const r = new LedgerRunner({ coin: 'BTC', data, store, repo: null, markPx: () => 100_000 });
    expect(r.init(SLOT0).ok).toBe(true);
    expect((await r.tick(SLOT0 + 30_000)).appended).toBe(3);
    expect((await r.tick(SLOT0 + 90_000)).appended).toBe(0); // ten sam slot — bez duplikatów
    expect((await r.tick(SLOT0 + 6 * MIN)).appended).toBe(0); // slot minął > 5 min — bez wydawania wstecz
    const res = await r.tick(SLOT0 + 62 * MIN);
    expect(res.appended).toBeGreaterThanOrEqual(1 + 2); // rozstrzygnięcie ret60 + prognozy slotu 22:00 (ret60, ret240, touch)
    const summary = JSON.parse(readFileSync(join(dir, 'BTC', 'summary.json'), 'utf8'));
    expect(isDeskLedgerSummary(summary)).toBe(true);
    expect(summary.scores.ret['60'].n).toBe(1);
    expect(summary.head.lines).toBe(store.lines);
  });

  it('brak ceny lub modelu → nic nie jest wydawane (brak danych ≠ prognoza)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-runner-'));
    const store = new LedgerStore({ dir, coin: 'BTC' });
    const data = fakeData();
    const r = new LedgerRunner({ coin: 'BTC', data, store, repo: null, markPx: () => null });
    r.init(SLOT0);
    expect((await r.tick(SLOT0 + 30_000)).appended).toBe(0);
  });

  it('prognoza bez danych do rozstrzygnięcia po 6 h → jawnie unieważniona (nie znika po cichu)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-runner-'));
    const store = new LedgerStore({ dir, coin: 'BTC' });
    const data = fakeData();
    data.candles = [];
    const r = new LedgerRunner({ coin: 'BTC', data, store, repo: null, markPx: () => 100_000 });
    r.init(SLOT0);
    await r.tick(SLOT0 + 30_000);
    await r.tick(SLOT0 + 10 * HOUR + 7 * MIN); // > 6 h po horyzoncie także dla ret240
    const lines = readFileSync(join(dir, 'BTC', '2026-10-23.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.filter((l) => l.void === 'no-data').length).toBe(3);
  });

  it('po 00:10 UTC wczorajszy plik jest kotwiczony (OpenTimestamps) raz; indeks trafia do podsumowania', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-runner-'));
    const store = new LedgerStore({ dir, coin: 'BTC' });
    const data = fakeData();
    let stamps = 0;
    const stamp = async () => {
      stamps++;
      return { ots: new Uint8Array([1, 2, 3]), calendars: ['a', 'b'] };
    };
    const r = new LedgerRunner({ coin: 'BTC', data, store, repo: null, markPx: () => 100_000, stamp });
    r.init(SLOT0);
    await r.tick(SLOT0 + 30_000); // 2026-10-22 21:00
    const nextDay = Date.UTC(2026, 9, 23, 0, 12, 0);
    await r.tick(nextDay);
    await r.tick(nextDay + MIN);
    expect(stamps).toBe(1);
    expect(readFileSync(join(dir, 'BTC', 'ots', '2026-10-22.jsonl.ots'))).toEqual(Buffer.from([1, 2, 3]));
    const summary = JSON.parse(readFileSync(join(dir, 'BTC', 'summary.json'), 'utf8'));
    expect(summary.ots).toEqual([{ day: '2026-10-22', file: 'ots/2026-10-22.jsonl.ots', calendars: 2, stampedAt: nextDay }]);
  });
});
