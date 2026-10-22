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

  it('zagranie z ostatnich dni: MAE/MFE w R i odległość od VWAP w σ przy wejściu', async () => {
    const minute = [...hl(TODAY - D, 1440, MIN, 100_000), ...hl(TODAY, 60, MIN, 100_000), ...hl(TODAY + H, 60, MIN, 100_050), ...hl(TODAY + 2 * H, 60, MIN, 100_100)];
    const hourly = [...Array.from({ length: 2 }, (_, d) => hl(TODAY - (2 - d) * D, 24, H, 100_000)).flat(), ...hl(TODAY, 3, H, 100_000)];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const req = JSON.parse(init.body).req;
        return { ok: true, json: async () => (req.interval === '1m' ? minute : hourly) };
      })
    );
    const t: Trade = {
      id: 'x', setupId: null, dir: 'LONG', entryT: TODAY + 2 * H + 30_000, entryPx: 100_100, stopPx: 100_050,
      exitT: TODAY + 2 * H + 30 * MIN, exitPx: 100_100, sizeBtc: null, note: '', mae: null, mfe: null, ctx: null,
    };
    const e = await enrichTrade(t, TODAY + 3 * H);
    expect(e.mae).toBeCloseTo(-0.1, 9); // min low 100 095 → −5 / 50
    expect(e.mfe).toBeCloseTo(0.1, 9); // max high 100 105 → +5 / 50
    expect(e.ctx!.vwapZ).not.toBeNull();
    expect(e.ctx!.ib).toBe('wybity ↑'); // po 01:00 cena nad IB (100 005)
  });

  it('zagranie starsze niż ~3,5 doby → bez MAE/MFE i kontekstu (brak świec 1m w API)', async () => {
    const t = { id: 'y', setupId: null, dir: 'LONG', entryT: TODAY - 5 * D, entryPx: 1, stopPx: 0.5, exitT: null, exitPx: null, sizeBtc: null, note: '', mae: null, mfe: null, ctx: null } as Trade;
    expect(await enrichTrade(t, TODAY)).toEqual({ mae: null, mfe: null, ctx: null });
  });
});
