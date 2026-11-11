import { describe, expect, it } from 'vitest';
import { TAUS, benchQuantiles, buildSummary, type Forecast, type Resolution, type RetForecast, type TouchForecast } from '../forecaster.ts';
import { isDeskLedgerSummary } from '../../../src/utils/deskLedger.ts';
import { mulberry32 } from '../../../src/utils/pathEngine.ts';
import { normalSf } from '../../../src/utils/forecastScore.ts';

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 1, 0, 0, 0);
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Dziennik syntetyczny, w którym prawdziwym procesem jest wzór odbicia: σ godziny zmienia się między slotami, poziomy
 * leżą w różnych odległościach, a wynik dotknięcia jest losowany z P = 2(1 − Φ(|d| / (σ√2))). „Model” podaje dokładnie
 * to P, więc nie wie nic ponad odległość i σ benchmarku z prognozy zwrotu 1 h tego samego slotu.
 */
function reflectionLedger(n: number) {
  const u = mulberry32(42);
  const fs = new Map<string, Forecast>();
  const rs = new Map<string, Resolution>();
  const px0 = 100_000;
  for (let i = 0; i < n; i++) {
    const slot = T0 + i * 15 * MIN;
    const sigma1h = 0.002 + 0.008 * u();
    const ret: RetForecast = {
      k: 'f',
      id: `${slot}-ret60`,
      slot,
      ti: slot,
      t: slot + MIN,
      kind: 'ret',
      h: 60,
      px0,
      taus: TAUS,
      q: benchQuantiles(sigma1h, 60).map(r6),
      bq: benchQuantiles(sigma1h, 60).map(r6),
      aci: 0.1,
      model: 'test',
    };
    const d = { pdh: 0.001 + 0.03 * u(), pdl: 0.001 + 0.03 * u(), deq: 0.0005 + 0.02 * u() };
    const lv = { pdh: px0 * Math.exp(d.pdh), pdl: px0 * Math.exp(-d.pdl), deq: px0 * Math.exp(u() < 0.5 ? d.deq : -d.deq) };
    const sH = sigma1h * Math.sqrt(120 / 60);
    const p = { pdh: r4(2 * normalSf(d.pdh / sH)), pdl: r4(2 * normalSf(d.pdl / sH)), deq: r4(2 * normalSf(d.deq / sH)) };
    const touch: TouchForecast = { k: 'f', id: `${slot}-touch120`, slot, ti: slot, t: slot + MIN, kind: 'touch', h: 120, px0, lv, p, model: 'test' };
    fs.set(ret.id, ret);
    fs.set(touch.id, touch);
    const y = (q: number) => (u() < q ? 1 : 0) as 0 | 1;
    rs.set(touch.id, { k: 'r', id: touch.id, t: slot + 3 * 60 * MIN, hi: 0, lo: 0, yv: { pdh: y(p.pdh), pdl: y(p.pdl), deq: y(p.deq) } });
  }
  return { fs, rs, now: T0 + n * 15 * MIN + 3 * 60 * MIN };
}

describe('BSS dotknięć wobec dwóch baz: częstości poziomu i odległości (wzór odbicia ze stałą σ z 30 dni)', () => {
  it('prawdziwy proces = wzór odbicia: bssDist ≈ 0, a bssClim > 0 (sama częstość daje pozorną umiejętność)', () => {
    const { fs, rs, now } = reflectionLedger(2500);
    const s = buildSummary({ coin: 'BTC', now, head: { hash: 'h', lines: 1 }, forecasts: fs, resolutions: rs, aci: {}, ots: [] });
    const t = s.scores.touch;
    expect(t.pairs).toBe(7500);
    expect(t.pairsDist).toBe(7500);
    expect(t.bssClim).toBeGreaterThan(0.1);
    // Ta sama liczba pod starą nazwą (czytelnicy starszego formatu)
    expect(t.bss).toBe(t.bssClim);
    expect(Math.abs(t.bssDist!)).toBeLessThan(0.005);
    expect(t.brierDist).toBeGreaterThan(0);
    expect(t.brierDist).toBeLessThan(t.brierBase!);
    expect(isDeskLedgerSummary(s)).toBe(true);
  });

  it('prognoza dotknięć bez prognozy zwrotu 1 h w tym slocie: brak σ bazy, para poza bazą odległości (bssDist z pozostałych)', () => {
    const { fs, rs, now } = reflectionLedger(400);
    fs.delete(`${T0}-ret60`);
    const t = buildSummary({ coin: 'BTC', now, head: { hash: 'h', lines: 1 }, forecasts: fs, resolutions: rs, aci: {}, ots: [] }).scores.touch;
    expect(t.pairs).toBe(1200);
    expect(t.pairsDist).toBe(1197);
    expect(t.bssDist).not.toBeNull();
  });

  it('bez żadnej σ bazy: bssDist i brierDist null (nie zero), bssClim liczony', () => {
    const { fs, rs, now } = reflectionLedger(100);
    for (const id of [...fs.keys()]) if (id.endsWith('ret60')) fs.delete(id);
    const t = buildSummary({ coin: 'BTC', now, head: { hash: 'h', lines: 1 }, forecasts: fs, resolutions: rs, aci: {}, ots: [] }).scores.touch;
    expect(t.pairsDist).toBe(0);
    expect(t.brierDist).toBeNull();
    expect(t.bssDist).toBeNull();
    expect(t.bssClim).not.toBeNull();
  });

  it('walidacja strony: starsze podsumowanie bez pól bazy odległości przechodzi; pole złego typu odrzuca podsumowanie', () => {
    const { fs, rs, now } = reflectionLedger(50);
    const s = buildSummary({ coin: 'BTC', now, head: { hash: 'h', lines: 1 }, forecasts: fs, resolutions: rs, aci: {}, ots: [] });
    const { bssClim: _c, brierDist: _b, bssDist: _d, pairsDist: _p, ...oldTouch } = s.scores.touch;
    expect(isDeskLedgerSummary({ ...s, scores: { ...s.scores, touch: oldTouch } })).toBe(true);
    expect(isDeskLedgerSummary({ ...s, scores: { ...s.scores, touch: { ...s.scores.touch, bssDist: 'x' } } })).toBe(false);
  });
});
