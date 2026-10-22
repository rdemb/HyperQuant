import { describe, expect, it } from 'vitest';
import { marketSnapshot } from '../marketQuotes.ts';

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 22, 12, 56);
const EXP = Date.UTC(2026, 9, 22, 13, 0);
const out = (outcome: number, desc: string) => ({ outcome, name: 'template:binaryPrice', description: desc, sideSpecs: [] });
const meta = (...o: unknown[]) => ({ outcomes: o });
const MARK = (k: number) => `perp:BTC|priceDescription:BTC-USDC perp mark|seconds:60|threshold:${k}|time:20261022-1300`;
const lv = (px: number, sz: number) => ({ px: String(px), sz: String(sz), n: 1 });
const book = { coin: '#157170', time: NOW - 2_000, levels: [[lv(0.48, 500)], [lv(0.5, 500)]] };

function client(meta: unknown, b: unknown, mids: unknown = { BTC: '81700.5' }) {
  return {
    info: async (body: { type: string }) => (body.type === 'outcomeMeta' ? meta : body.type === 'l2Book' ? b : body.type === 'allMids' ? mids : null),
  };
}

describe('marketSnapshot — aktywny 15-minutowy rynek BTC', () => {
  it('jedyny rynek „perp mark” z terminem = koniec slotu; notowanie, czas arkusza i świeży środek ceny BTC', async () => {
    const s = await marketSnapshot(client(meta(out(15717, MARK(81713)), out(15710, 'perp:BTC|priceDescription:the Hyperliquid BTC perp trade|seconds:90|threshold:81761|time:20261022-1300')), book), EXP, NOW);
    expect(s).toMatchObject({ outcome: 15717, K: 81713, expiry: EXP, src: 'mark', px: 81700.5, bookTime: NOW - 2_000 });
    expect(s!.quote).toMatchObject({ bid: 0.48, ask: 0.5 });
  });
  it('niejednoznaczność (dwa pasujące rynki), inne źródło („1-minute candle”), błąd arkusza albo ceny → null (ponowna próba w slocie)', async () => {
    expect(await marketSnapshot(client(meta(out(1, MARK(81_000)), out(2, MARK(82_000))), book), EXP, NOW)).toBeNull();
    expect(await marketSnapshot(client(meta(out(3, 'perp:BTC|priceDescription:1-minute candle|threshold:81000|time:20261022-1300')), book), EXP, NOW)).toBeNull();
    expect(await marketSnapshot(client(meta(out(15717, MARK(81713))), null), EXP, NOW)).toBeNull();
    expect(await marketSnapshot(client(meta(out(15717, MARK(81713))), book, null), EXP, NOW)).toBeNull();
  });
});
