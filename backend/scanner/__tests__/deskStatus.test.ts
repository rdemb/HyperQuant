import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MarketRecorder } from '../history.ts';
import type { HlCtx } from '../hl.ts';
import { ctxExpectedOf, deskMarketsStatus, loadNyseCalendar } from '../deskStatus.ts';

const SEC = 1000;
const MIN = 60_000;
/** Poniedziałek 16.11.2026 10:00 ET (15:00 UTC): złoto i S&P 500 notują, NYSE otwarta */
const MON = Date.UTC(2026, 10, 16, 15, 0, 0);
/** Niedziela 15.11.2026 12:00 ET: rynek bazowy zamknięty do 18:00 ET (23:00 UTC) */
const SUN = Date.UTC(2026, 10, 15, 17, 0, 0);
const CAL = loadNyseCalendar();

const ctx = (mark: number, oracle: number | null, impact: [number, number] | null = [mark - 0.5, mark + 0.5]): HlCtx => ({
  markPx: mark,
  oiBtc: 1000,
  dayNtlVlm: 1e8,
  funding: 1e-5,
  oraclePx: oracle,
  midPx: mark,
  impactPxs: impact,
  premium: 0,
});

/** Arkusz dalekiej agregacji złota (krok 10 USD przy 3840): po 3 poziomy na stronę. */
const farBook = [
  [3840, 3830, 3810].map((px) => ({ px: String(px), sz: '2', n: 1 })),
  [3850, 3870, 3900].map((px) => ({ px: String(px), sz: '1', n: 1 })),
];

function gold(t0: number, n: number, mark: (i: number) => number, oracle: (i: number) => number | null) {
  const dir = mkdtempSync(join(tmpdir(), 'hq-desk-'));
  const r = new MarketRecorder('xyz:GOLD', dir, { ctxExpected: ctxExpectedOf('xyz:GOLD', CAL) });
  r.onState(true, t0);
  r.onTrades([{ coin: 'xyz:GOLD', side: 'B', px: '3840', sz: '1', time: t0, tid: 1 }]);
  for (let i = 0; i < n; i++) {
    r.onCtx(ctx(mark(i), oracle(i)), t0 + i * 5 * SEC);
    r.onBook(t0 + i * 5 * SEC, farBook);
  }
  return r;
}

describe('sekcja `deskMarkets` w status.json (projekt 60, Q7)', () => {
  it('kalendarz NYSE z repozytorium wczytany na serwerze; kontekst oczekiwany tylko przy notującym rynku bazowym', () => {
    expect(CAL?.years['2026']).toBeDefined();
    expect(ctxExpectedOf('xyz:GOLD', CAL)(MON)).toBe(true);
    expect(ctxExpectedOf('xyz:GOLD', CAL)(SUN)).toBe(false);
    expect(ctxExpectedOf('BTC', CAL)(SUN)).toBe(true);
    // Rynek spoza desku (np. ETH z dawnej listy): jak BTC, zawsze
    expect(ctxExpectedOf('ETH', CAL)(SUN)).toBe(true);
  });

  it('rynek desku z nagraniem: jakość, stan rynku bazowego, puls kanałów i miary z godziny; rynek bez nagrania albo spoza desku — bez klucza', () => {
    // 720 próbek (godzina): rozjazd 1 pb, co dziesiąta 20 pb (p95 = 20 pb); spread impact 1 USD (2,6 pb)
    const r = gold(MON - 60 * MIN + 5 * SEC, 720, () => 3840, (i) => (i % 10 === 0 ? 3840 / (1 + 20e-4) : 3840 / (1 + 1e-4)));
    const eth = new MarketRecorder('ETH', mkdtempSync(join(tmpdir(), 'hq-desk-')));
    const now = MON + 2 * SEC;
    const st = deskMarketsStatus([r, eth], now, CAL);
    expect(Object.keys(st)).toEqual(['gold']);
    const g = st.gold;
    expect(g).toMatchObject({ coin: 'xyz:GOLD', quality: 'good', reasons: [], underlying: { state: 'open' }, lastTradeAt: MON - 60 * MIN + 5 * SEC, gaps24h: 0 });
    expect(g.lastCtxAt).toBe(MON);
    expect(g.lastBookAt).toBe(MON);
    expect(g.markOracleBpP95_1h).toBeCloseTo(20, 1);
    expect(g.impactSpreadBpP50_1h).toBeCloseTo((1 / 3840) * 1e4, 1);
    // Głębokość ±0,5% od mid 3845 (3825,8–3864,2) z arkusza dalekiego: bidy 3840 i 3830 po 2, ask 3850 po 1
    expect(g.depthUsdP50_1h).toBe(Math.round(2 * 3840 + 2 * 3830 + 3850));
    // Rynek bazowy notuje do piątku 17:00 ET; najbliższa zmiana: przerwa o 17:00 ET (22:00 UTC)
    expect(g.underlying.next).toBe(Date.UTC(2026, 10, 16, 22, 0, 0));
  });

  it('niedziela: „cena platformy” z godziną otwarcia; stary kontekst → jakość nieznana z powodem; bez próbek — null, nie zero', () => {
    const r = gold(SUN, 10, () => 3840, () => 3840);
    const g = deskMarketsStatus([r], SUN + 50 * SEC, CAL).gold;
    expect(g).toMatchObject({ quality: 'platform', reasons: ['platform'], underlying: { state: 'closed', next: Date.UTC(2026, 10, 15, 23, 0, 0) } });
    const stale = deskMarketsStatus([r], SUN + 10 * MIN, CAL).gold;
    expect([stale.quality, stale.reasons]).toEqual(['na', ['no-ctx']]);
    const empty = new MarketRecorder('xyz:SP500', mkdtempSync(join(tmpdir(), 'hq-desk-')));
    expect(deskMarketsStatus([empty], MON, CAL).sp500).toEqual({
      coin: 'xyz:SP500',
      quality: 'na',
      reasons: ['no-ctx'],
      underlying: { state: 'open', next: expect.any(Number) },
      lastTradeAt: null,
      lastBookAt: null,
      lastCtxAt: null,
      markOracleBpP95_1h: null,
      impactSpreadBpP50_1h: null,
      depthUsdP50_1h: null,
      gaps24h: 0,
    });
  });
});
