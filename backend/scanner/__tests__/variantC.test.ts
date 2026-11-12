import { describe, expect, it } from 'vitest';
import { TAUS, buildSummary, makeRetForecastC, type Forecast, type Resolution, type RetForecast } from '../forecaster.ts';
import { AB_DESIGN_C, AB_EPOCH, abFirstBlock } from '../../../src/utils/abTest.ts';
import { rvLevel, scaleMixQuantiles } from '../../../src/utils/rvMix.ts';
import { isAbC, isDeskLedgerSummary } from '../../../src/utils/deskLedger.ts';
import ref from '../../../src/utils/__tests__/fixtures/rvMixReference.json';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const p = ref.przypadki[2];
const A = (slot: number): RetForecast => ({
  k: 'f',
  id: `${slot}-ret60`,
  slot,
  ti: slot + 20_000,
  t: slot + MIN,
  kind: 'ret',
  h: 60,
  px0: 100_000,
  taus: TAUS,
  q: p.qA,
  bq: TAUS.map((t) => (t - 0.5) / 50),
  aci: 0.1,
  model: 'ledger-har-fhs-v1',
});

describe('rekord wariantu C', () => {
  it('pola wspólne równe A, kwantyle według wzoru planu (6 miejsc), stałe i wielkości do odtworzenia', () => {
    const a = A(AB_EPOCH);
    const c = makeRetForecastC(a, p.rv60)!;
    for (const k of ['slot', 'ti', 't', 'h', 'px0', 'aci', 'taus', 'bq', 'kind'] as const) expect(c[k]).toEqual(a[k]);
    expect(c).toMatchObject({ id: `${a.id}c`, variant: 'C', model: AB_DESIGN_C.modelC, kappa: 0.5, c: -0.05, tau: 0.5, rv60: p.rv60 });
    // Przekształcenie z wartości zapisanych w rekordzie (σA, x zaokrąglone), więc weryfikator liczy to samo
    const lvl = rvLevel(a.q, a.taus, p.rv60, 0.5, -0.05)!;
    expect(c.sigmaA).toBe(Math.round(lvl.sigmaA * 1e8) / 1e8);
    expect(c.q).toEqual(scaleMixQuantiles(a.q.map((v) => v * Math.exp(-0.05 + 0.5 * c.x!)), a.taus, 0.5).map(r6));
    c.q.forEach((v, i) => expect(Math.abs(v - p.qC[i])).toBeLessThan(1e-5));
    expect(Math.abs(c.x! - p.x)).toBeLessThan(1e-6);
    expect(c.sigmaA).toBeCloseTo(p.sigmaA, 8);
  });
  it('brak C: kwantyle A nierosnące, rv60 niepoprawne, horyzont inny niż 1 h albo rekord wariantu', () => {
    const a = A(AB_EPOCH);
    expect(makeRetForecastC({ ...a, q: [...a.q].reverse() }, p.rv60)).toBeNull();
    expect(makeRetForecastC(a, Number.NaN)).toBeNull();
    expect(makeRetForecastC({ ...a, h: 240 }, p.rv60)).toBeNull();
    expect(makeRetForecastC({ ...a, variant: 'B' }, p.rv60)).toBeNull();
  });
});

describe('podsumowanie: sekcja abC', () => {
  const res = (f: RetForecast, y: number, crps: number): Resolution => ({ k: 'r', id: f.id, t: f.t + HOUR, c0: 1, c1: 1, y, crps, crpsB: 0.002, pit: 0.5, in90: 1, in60: y === 0 ? 1 : 0, inAci: 1 });
  function ledger(withC: boolean) {
    const fs = new Map<string, Forecast>();
    const rs = new Map<string, Resolution>();
    for (let i = 0; i < 20 * 96; i++) {
      const slot = AB_EPOCH + 14 * DAY + i * 15 * MIN;
      const a = A(slot);
      fs.set(a.id, a);
      rs.set(a.id, res(a, 0, 0.0012));
      if (withC) {
        const c = makeRetForecastC(a, p.rv60)!;
        fs.set(c.id, c);
        rs.set(c.id, res(c, i % 3 === 0 ? 0.01 : 0, 0.0011 + (i % 5) * 1e-5));
      }
    }
    return { fs, rs };
  }
  it('dziennik bez C: brak pola abC, ab bez zmian', () => {
    const { fs, rs } = ledger(false);
    const s = buildSummary({ coin: 'BTC', now: AB_EPOCH + 40 * DAY, head: { hash: 'h', lines: 1 }, forecasts: fs, resolutions: rs, aci: {}, ots: [] });
    expect('abC' in s).toBe(false);
    expect(s.ab).toMatchObject({ model: 'ledger-har-fhs-bocpd-v1', latest: null });
  });
  it('okresy od pierwszej granicy po rejestracji; w zakończonym okresie C − A z przedziałem i kalibracja na próbie rozłącznej', () => {
    const { fs, rs } = ledger(true);
    const reg = AB_EPOCH + 10 * DAY;
    expect(abFirstBlock(reg)).toBe(AB_EPOCH + 14 * DAY);
    expect(abFirstBlock(AB_EPOCH + 14 * DAY)).toBe(AB_EPOCH + 14 * DAY);
    const s = buildSummary({ coin: 'BTC', now: AB_EPOCH + 30 * DAY, head: { hash: 'h', lines: 1 }, forecasts: fs, resolutions: rs, aci: {}, ots: [], abCRegisteredAt: reg });
    expect(isDeskLedgerSummary(s)).toBe(true);
    expect(isAbC(s.abC)).toBe(true);
    const c = s.abC!;
    expect(c.firstBlock).toBe(AB_EPOCH + 14 * DAY);
    expect(c.last).toMatchObject({ start: AB_EPOCH + 14 * DAY, n: 14 * 96 });
    expect(c.last!.diff!.hi).toBeLessThan(0);
    expect(c.last!.cal).toEqual({ n: 14 * 24, cov60: expect.any(Number), cov90: 1 });
    expect(c.last!.cal!.cov60).toBeCloseTo(2 / 3, 1);
    expect(c.current).toMatchObject({ start: AB_EPOCH + 28 * DAY });
    // Rejestracja w trakcie okresu: okres, w którym zarejestrowano plan, nie jest oceniany
    const late = buildSummary({ coin: 'BTC', now: AB_EPOCH + 30 * DAY, head: { hash: 'h', lines: 1 }, forecasts: fs, resolutions: rs, aci: {}, ots: [], abCRegisteredAt: AB_EPOCH + 15 * DAY }).abC!;
    expect(late.firstBlock).toBe(AB_EPOCH + 28 * DAY);
    expect(late.last).toBeNull();
    // Bez planu w dzienniku: sekcja jest (rekordy C rozliczone), ale nic nie jest oceniane
    const none = buildSummary({ coin: 'BTC', now: AB_EPOCH + 30 * DAY, head: { hash: 'h', lines: 1 }, forecasts: fs, resolutions: rs, aci: {}, ots: [] }).abC!;
    expect(none).toMatchObject({ registeredAt: null, firstBlock: null, current: null, last: null });
  });
});
