import { afterEach, describe, expect, it, vi } from 'vitest';
import { enrichTrade } from '../useJournal';
import type { Trade } from '../../utils/tradeJournal';

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;
const TODAY = Date.UTC(2026, 9, 22);

/** Świece HL (stringi) o stałym zakresie ±5 wokół `mid` co `step` od `from`. */
const hl = (from: number, n: number, step: number, mid: number) =>
  Array.from({ length: n }, (_, i) => ({ t: from + i * step, o: String(mid), h: String(mid + 5), l: String(mid - 5), c: String(mid), v: '1' }));

describe('enrichTrade — MAE/MFE i kontekst aukcji przy wejściu ze świec 1m', () => {
  afterEach(() => vi.unstubAllGlobals());

  // 22.10.2026: Londyn otwiera o 07:00 UTC (08:00 BST)
  const LON = 7 * H;
  /** Wczoraj i dziś do otwarcia Londynu po 100 000, potem trzy godziny sesji: 100 000, 100 050, 100 100. */
  const minute = [
    ...hl(TODAY - D, 1440 + 420, MIN, 100_000),
    ...hl(TODAY + LON, 60, MIN, 100_000),
    ...hl(TODAY + LON + H, 60, MIN, 100_050),
    ...hl(TODAY + LON + 2 * H, 60, MIN, 100_100),
  ];
  const hourly = [...Array.from({ length: 2 }, (_, d) => hl(TODAY - (2 - d) * D, 24, H, 100_000)).flat(), ...hl(TODAY, 10, H, 100_000)];
  const stub = () =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const req = JSON.parse(init.body).req;
        return { ok: true, json: async () => (req.interval === '1m' ? minute : hourly) };
      })
    );

  it('zagranie w sesji Londynu: MAE/MFE w R, odległość od VWAP sesji w σ i stan IB sesji przy wejściu', async () => {
    stub();
    const t: Trade = {
      id: 'x', setupId: null, dir: 'LONG', entryT: TODAY + LON + 2 * H + 30_000, entryPx: 100_100, stopPx: 100_050,
      exitT: TODAY + LON + 2 * H + 30 * MIN, exitPx: 100_100, sizeBtc: null, note: '', mae: null, mfe: null, ctx: null,
    };
    const e = await enrichTrade(t, TODAY + LON + 3 * H);
    expect(e.mae).toBeCloseTo(-0.1, 9); // min low 100 095 → −5 / 50
    expect(e.mfe).toBeCloseTo(0.1, 9); // max high 100 105 → +5 / 50
    expect(e.ctx!.vwapZ).not.toBeNull();
    expect(e.ctx!.ib).toBe('up'); // po pierwszej godzinie sesji cena nad IB (100 005)
  });

  it('zagranie w sesji azjatyckiej (bez sesji Londynu ani NY) → MAE/MFE tak, kontekst sesji nie', async () => {
    stub();
    const t: Trade = {
      id: 'a', setupId: null, dir: 'LONG', entryT: TODAY + 2 * H, entryPx: 100_000, stopPx: 99_950,
      exitT: TODAY + 3 * H, exitPx: 100_000, sizeBtc: null, note: '', mae: null, mfe: null, ctx: null,
    };
    const e = await enrichTrade(t, TODAY + LON + 3 * H);
    expect(e.mae).not.toBeNull();
    expect(e.ctx).toBeNull();
  });

  it('sesja wejścia zaczęła się przed oknem świec 1m → MAE/MFE tak, kontekst nie (VWAP z części sesji byłby fałszywy)', async () => {
    const now = TODAY + 3 * H;
    const from = now - 3.4 * D;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const req = JSON.parse(init.body).req;
        const start = Math.ceil(Math.max(req.startTime, from) / MIN) * MIN;
        const step = req.interval === '1m' ? MIN : H;
        return { ok: true, json: async () => hl(start, Math.floor((now - start) / step), step, 100_000) };
      })
    );
    const entryT = TODAY - 3.2 * D; // dzień wejścia zaczął się przed oknem 3,4 doby
    const t = { id: 'p', setupId: null, dir: 'LONG', entryT, entryPx: 100_000, stopPx: 99_900, exitT: entryT + 20 * MIN, exitPx: 100_000, sizeBtc: null, note: '', mae: null, mfe: null, ctx: null } as Trade;
    const e = await enrichTrade(t, now);
    expect(e.mae).not.toBeNull();
    expect(e.ctx).toBeNull();
  });

  it('zagranie starsze niż ~3,5 doby → bez MAE/MFE i kontekstu (brak świec 1m w API)', async () => {
    const t = { id: 'y', setupId: null, dir: 'LONG', entryT: TODAY - 5 * D, entryPx: 1, stopPx: 0.5, exitT: null, exitPx: null, sizeBtc: null, note: '', mae: null, mfe: null, ctx: null } as Trade;
    expect(await enrichTrade(t, TODAY)).toEqual({ mae: null, mfe: null, ctx: null });
  });
});
