import { describe, expect, it } from 'vitest';
import { AddressBook } from '../addressBook.ts';
import { loadConfig } from '../config.ts';
import type { HlRest } from '../hl.ts';
import { LiqConfirmer } from '../liqDetect.ts';
import { simulateReads } from '../readBudgetSim.ts';
import { Scanner } from '../scanner.ts';

const MIN = 60_000;
const pos = (szi: number, at = 0) => ({ szi, entryPx: 100_000, liqPx: 50_000, scannedAt: at });

describe('budżet odczytów (a): osobne limitery dla potwierdzeń likwidacji i prognoz', () => {
  const base = { HQ_STATE_DIR: '/s', HQ_OUT_DIR: '/o' };
  it('domyślnie 90 wag/min na potwierdzenia i 120 na prognozy i archiwum; razem z pozycjami i wielorybami ≤ 800', () => {
    const r = loadConfig(base);
    expect(r.ok && [r.config.weightPerMin, r.config.liqWeightPerMin, r.config.forecastWeightPerMin]).toEqual([240, 90, 120]);
    const w = loadConfig({ ...base, HQ_WHALE_TOP: '200', HQ_WHALE_WEIGHT_PER_MIN: '200' });
    expect(w.ok).toBe(true);
    const over = loadConfig({ ...base, HQ_WHALE_TOP: '200', HQ_WHALE_WEIGHT_PER_MIN: '400', HQ_FORECAST_WEIGHT_PER_MIN: '200' });
    expect(over.ok).toBe(false);
    expect(!over.ok && over.errors.join(' ')).toMatch(/razem najwyżej 800 wag\/min/);
  });

  it('potwierdzenia likwidacji idą przez własny klient (własny limiter), nie przez budżet skanu pozycji', async () => {
    const calls: string[] = [];
    const client = (name: string) => ({ info: async (b: { type: string }) => (calls.push(`${name}:${b.type}`), []), charge: () => {}, healthy: () => true, errors: 0 }) as unknown as HlRest;
    const confirmer = new LiqConfirmer({ coin: 'BTC', maxPerMin: 3 });
    const now = 10 * MIN;
    confirmer.enqueue({ addr: '0xa', prev: pos(1, 0), from: 0, to: now - MIN });
    const s = new Scanner({ coin: 'BTC', book: new AddressBook(), rest: client('pozycje'), liqRest: client('likwidacje'), outDir: '/tmp/x', r2: null, now: () => now, confirmer, tapeSince: 0 });
    expect(await s.confirmLiquidations()).toBe(1);
    expect(calls).toEqual(['likwidacje:userFillsByTime']);
  });
});

describe('budżet odczytów (b): kolejka kont po transakcji według wartości; zapas budżetu', () => {
  it('pozycja, której właściciel handlował, ma pierwszeństwo wg nominału przed małymi spóźnionymi pozycjami', () => {
    const b = new AddressBook();
    for (const a of ['0xs1', '0xs2', '0xs3', '0xbig']) {
      b.recordTrade([a, '0xz'], 1, 0);
      b.updatePosition(a, a === '0xbig' ? pos(50) : pos(0.1), 0); // 5 mln USD i 10 tys. USD
    }
    b.updatePosition('0xz', null, 0);
    // 5 h później: małe pozycje mocno po terminie (30 min), duża handluje (i nowe małe konto)
    const t = 300 * MIN;
    b.updatePosition('0xbig', pos(50, t - MIN), t - MIN); // duża czytana minutę temu — jeszcze przed terminem
    b.recordTrade(['0xbig', '0xnew'], 5_000, t);
    const due = b.due(t, 2);
    expect(due).toContain('0xbig');
    // konta po transakcji: większa wartość (pozycja albo obrót) pierwsza
    expect(b.due(t, 10).filter((a) => a === '0xbig' || a === '0xnew')).toEqual(['0xbig', '0xnew']);
  });

  it('zapas budżetu (fill): pozycje przed terminem w kolejności wiek × √nominał; bez fill tylko należne', () => {
    const b = new AddressBook();
    for (const a of ['0xbig', '0xmid', '0xsmall']) b.recordTrade([a, '0xz'], 1, 0);
    b.updatePosition('0xz', null, 0);
    b.updatePosition('0xbig', pos(20), 0); // 2 mln, interwał 2 min
    b.updatePosition('0xmid', pos(2), 0); // 200 tys., 10 min
    b.updatePosition('0xsmall', pos(0.1), 0); // 10 tys., 30 min
    b.updatePosition('0xbig', pos(20, MIN), MIN);
    // po 2,5 min nic nie jest należne (duża czytana 1,5 min temu); zapas budżetu: wiek × √nominał
    expect(b.due(2.5 * MIN, 10)).toEqual([]);
    // big 1,5 min × √2 mln ≈ 2121, mid 2,5 × √200 tys. ≈ 1118, small 2,5 × √10 tys. = 250
    expect(b.due(2.5 * MIN, 10, undefined, { fill: true })).toEqual(['0xbig', '0xmid', '0xsmall']);
    expect(b.due(2.5 * MIN, 1, undefined, { fill: true })).toEqual(['0xbig']);
  });
});

describe('budżet odczytów: model obciążenia (24 h, skala 1/5: 6 tys. pozycji zamiast 30 tys.)', () => {
  // Kalibracja (readBudgetSim.ts): rozkład nominałów Pareto α 1,1 daje dla dawnego harmonogramu i budżetu (~45 odczytów/min,
  // w skali 9) medianę ważoną ~27 min — jak zmierzono na serwerze (28–34 min). Po (a) pozycje mają cały budżet 240 wag =
  // 120 odczytów/min (w skali 24), po (b) kolejność według wartości i zapas budżetu.
  const OPTS = { positions: 6000, minutes: 24 * 60 + 120, warmupMin: 120, alpha: 1.1, readsPerMin: 24 };

  it('ageNtlP50Min poniżej 10 min w każdej minucie 24 h przy 120 odczytach/min (po a i b)', () => {
    const r = simulateReads({ ...OPTS, tradersPerMin: 20 });
    expect(r.ntlP50).toHaveLength(24 * 60);
    expect(r.max).toBeLessThan(10);
  }, 120_000);

  it('dwa razy więcej kont handlujących na minutę (kolejka po transakcji dłuższa): nadal poniżej 10 min', () => {
    const r = simulateReads({ ...OPTS, tradersPerMin: 40 });
    expect(r.max).toBeLessThan(10);
  }, 120_000);
});
