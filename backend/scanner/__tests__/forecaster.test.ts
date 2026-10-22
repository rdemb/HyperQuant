import { describe, expect, it } from 'vitest';
import {
  TAUS,
  benchQuantiles,
  closeAt,
  parseCandles,
  resolveRet,
  resolveTouch,
  sigma1hFromHourly,
  slotOf,
  type RetForecast,
  type TouchForecast,
} from '../forecaster.ts';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);

/** Świece 1m od T0: ceny z funkcji minuty (high/low ± szerokość). */
function candles(n: number, px: (i: number) => number, wick = 5) {
  return Array.from({ length: n }, (_, i) => ({ time: T0 + i * MIN, open: px(i), high: px(i) + wick, low: px(i) - wick, close: px(i) }));
}

const ret = (over: Partial<RetForecast> = {}): RetForecast => ({
  k: 'f',
  id: `${T0}-ret60`,
  slot: T0,
  ti: T0 - 30_000,
  t: T0,
  kind: 'ret',
  h: 60,
  px0: 100_000,
  taus: TAUS,
  q: TAUS.map((t) => (t - 0.5) * 0.02),
  bq: TAUS.map((t) => (t - 0.5) * 0.03),
  aci: 0.1,
  model: 'test',
  ...over,
});

describe('pomocnicze', () => {
  it('slotOf: początek 15-minutowego slotu', () => {
    expect(slotOf(T0 + 14 * MIN + 59_000)).toBe(T0);
    expect(slotOf(T0 + 15 * MIN)).toBe(T0 + 15 * MIN);
  });
  it('parseCandles: pola t/o/h/l/c z API → RangeBar, rekordy z nieliczbami pomijane', () => {
    expect(parseCandles([{ t: 1, o: '1', h: '2', l: '0.5', c: '1.5' }, { t: 2, o: 'x' }])).toEqual([{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5 }]);
    expect(parseCandles(null)).toEqual([]);
  });
  it('closeAt: cena w chwili T = zamknięcie świecy kończącej się w T', () => {
    const c = candles(10, (i) => 100 + i);
    expect(closeAt(c, T0 + 5 * MIN)).toBe(104);
    expect(closeAt(c, T0 + 30 * MIN)).toBeNull();
  });
  it('sigma1hFromHourly: odchylenie standardowe godzinowych log-zwrotów', () => {
    const h = Array.from({ length: 101 }, (_, i) => ({ time: i * 3_600_000, open: 1, high: 1, low: 1, close: i % 2 ? 101 : 100 }));
    expect(sigma1hFromHourly(h)).toBeCloseTo(Math.log(1.01), 3);
  });
  it('benchQuantiles: −½σ_h² + σ_h·z_τ, σ_h = σ_1h·√(h/60)', () => {
    const q = benchQuantiles(0.01, 240);
    expect(q[TAUS.indexOf(0.5)]).toBeCloseTo(-0.5 * 0.02 ** 2, 9);
    expect(q[TAUS.length - 1]).toBeCloseTo(-0.5 * 0.02 ** 2 + 0.02 * 1.959964, 5);
  });
});

describe('rozstrzyganie', () => {
  it('prognoza zwrotu: y = ln(c(t+h)/c(t)), CRPS modelu i benchmarku, PIT, pokrycia 90/60% i ACI', () => {
    const c = candles(70, (i) => (i < 59 ? 100_000 : 100_500)); // świeca 59 kończy się w T0 + 60 min
    const r = resolveRet(ret(), c, T0 + 70 * MIN)!;
    // c(T0) = zamknięcie świecy kończącej się w T0 — brak (pierwsza świeca zaczyna się w T0) → potrzebna świeca T0−1m
    expect(r).toBeNull();
    const c2 = [{ time: T0 - MIN, open: 100_000, high: 100_000, low: 100_000, close: 100_000 }, ...c];
    const r2 = resolveRet(ret(), c2, T0 + 70 * MIN)!;
    expect(r2.y).toBeCloseTo(Math.log(100_500 / 100_000), 6); // zapis zaokrąglony do 1e-6
    expect(r2.crps).toBeGreaterThan(0);
    expect(r2.crpsB).toBeGreaterThan(0);
    expect(r2.in90).toBe(1);
    expect(r2.pit).toBeGreaterThan(0.5);
    expect(r2.k).toBe('r');
    expect(r2.id).toBe(ret().id);
  });

  it('prognoza dotknięć: pełne pokrycie świecami 1m wymagane; dotknięcia PDH/PDL/D-EQ z high/low', () => {
    const f: TouchForecast = {
      k: 'f',
      id: `${T0}-touch120`,
      slot: T0,
      ti: T0,
      t: T0,
      kind: 'touch',
      h: 120,
      px0: 100_000,
      lv: { pdh: 100_400, pdl: 99_000, deq: 99_700 },
      p: { pdh: 0.4, pdl: 0.1, deq: 0.5 },
      model: 'test',
    };
    expect(resolveTouch(f, candles(100, () => 100_000), T0 + 3 * 60 * MIN)).toBeNull(); // brak pełnych 2 h
    const path = candles(120, (i) => 100_000 + (i < 60 ? i * 7 : (120 - i) * 7 - 600));
    const r = resolveTouch(f, path, T0 + 3 * 60 * MIN)!;
    expect(r.yv).toEqual({ pdh: 1, pdl: 0, deq: 1 });
  });
});

import { buildSummary, retScores, touchScores, type Forecast, type Resolution } from '../forecaster.ts';
import { isDeskLedgerSummary } from '../../../src/utils/deskLedger.ts';

describe('wyniki i podsumowanie', () => {
  const rr = (pit: number, in90: 0 | 1, crps = 0.002, crpsB = 0.003) =>
    ({ k: 'r', id: 'x', t: 0, y: 0, crps, crpsB, pit, in90, in60: 1, inAci: in90 }) as const;

  it('retScores: CRPSS, histogram PIT, pokrycie 90% z testem Kupca', () => {
    const pairs = Array.from({ length: 100 }, (_, i) => ({ f: ret({ slot: T0 + i * 3_600_000 }), r: rr((i + 0.5) / 100, i < 90 ? 1 : 0) }));
    const s = retScores(pairs);
    expect(s.n).toBe(100);
    expect(s.crpss).toBeCloseTo(1 - 0.002 / 0.003, 9);
    expect(s.pitHist).toEqual(Array(10).fill(10));
    expect(s.cov90!.rate).toBeCloseTo(0.9, 9);
    // wszystkie prognozy w tym samym slocie co godzinę (slot % 60 min == 0) → podpróba rozłączna = całość
    expect(s.cov90!.nEff).toBe(100);
    expect(s.cov90!.kupiecP).toBeCloseTo(1, 6);
    expect(retScores([]).crps).toBeNull();
  });

  it('touchScores: Brier, BSS względem klimatologii, niemalejąca mapa kalibracji', () => {
    const f = (p: number): TouchForecast => ({ k: 'f', id: String(p), slot: 0, ti: 0, t: 0, kind: 'touch', h: 120, px0: 1, lv: { pdh: 2, pdl: 0.5, deq: 1.2 }, p: { pdh: p, pdl: p, deq: p }, model: 'x' });
    const r = (y: 0 | 1) => ({ k: 'r' as const, id: 'x', t: 0, yv: { pdh: y, pdl: y, deq: y } });
    const pairs = [
      ...Array.from({ length: 30 }, () => ({ f: f(0.1), r: r(0) })),
      ...Array.from({ length: 10 }, () => ({ f: f(0.9), r: r(1) })),
    ];
    const s = touchScores(pairs);
    expect(s.n).toBe(40);
    expect(s.brier).toBeCloseTo(0.01, 9);
    expect(s.bss).toBeGreaterThan(0.9);
    for (let i = 1; i < s.calibration.length; i++) expect(s.calibration[i][1]).toBeGreaterThanOrEqual(s.calibration[i - 1][1]);
  });

  it('buildSummary: najnowsze prognozy, oczekujące, Venn–Abers; dokument przechodzi walidację strony', () => {
    const fs = new Map<string, Forecast>();
    const rs = new Map<string, Resolution>();
    const a = ret({ id: 'a', t: T0 - 2 * 60 * MIN });
    const b = ret({ id: 'b', t: T0 });
    fs.set('a', a);
    fs.set('b', b);
    rs.set('a', rr(0.4, 1));
    const touch: TouchForecast = { k: 'f', id: 't', slot: T0, ti: T0, t: T0, kind: 'touch', h: 120, px0: 1, lv: { pdh: 2, pdl: 0.5, deq: 1.2 }, p: { pdh: 0.3, pdl: 0.2, deq: 0.6 }, model: 'x' };
    fs.set('t', touch);
    const s = buildSummary({ coin: 'BTC', now: T0 + MIN, head: { hash: 'h', lines: 4 }, forecasts: fs, resolutions: rs, aci: { 60: 0.08 }, ots: [] });
    expect(s.latest.ret.map((r) => r.t)).toEqual([T0]);
    expect(s.latest.ret[0].aci.alpha).toBe(0.1); // α zapisane przy wydaniu (oceniane)
    expect(s.latest.ret[0].aci.alphaNow).toBe(0.08);
    expect(s.pending).toBe(2);
    expect(s.latest.touch!.va.pdh!.p).toBe(0.3); // brak zbioru kalibracyjnego → bez zmian
    expect(s.scores.ret['60'].n).toBe(1);
    expect(isDeskLedgerSummary(s)).toBe(true);
  });
});

import { makeTouchForecast } from '../forecaster.ts';
import { buildVolModel } from '../../../src/utils/volatility.ts';

describe('prognoza dotknięć — poziomy już przekroczone', () => {
  it('cena już za poziomem (np. pod PDL) → p = null (zdarzenie trywialne nie jest prognozowane ani oceniane)', () => {
    let s = 5;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const mk = (n: number, step: number, sig: number) => {
      let px = 100_000;
      return Array.from({ length: n }, (_, i) => {
        const o = px;
        const c = o * Math.exp(sig * (rnd() - 0.5) * 3.4);
        px = c;
        return { time: T0 - (n - i) * step, open: o, high: Math.max(o, c) * (1 + sig * rnd()), low: Math.min(o, c) * (1 - sig * rnd()), close: c };
      });
    };
    const model = buildVolModel(mk(1200, 3_600_000, 0.004), mk(2000, 300_000, 0.0015), T0)!;
    const f = makeTouchForecast(model, { slot: T0, t: T0, ti: T0 }, 82_000, 84_850, 82_613);
    expect(f.p.pdl).toBeNull();
    expect(f.p.pdh).not.toBeNull();
    const pairs = [{ f, r: { k: 'r' as const, id: f.id, t: 0, yv: { pdh: 0 as const, pdl: 1 as const, deq: 0 as const } } }];
    expect(touchScores(pairs).brier).toBeCloseTo(((f.p.pdh as number) ** 2 + (f.p.deq as number) ** 2) / 2, 9);
  });
});

describe('poprawki z recenzji: ACI, nakładanie, klimatologia poziomów, uczestnictwo', () => {
  const rr = (in90: 0 | 1) => ({ k: 'r', id: 'x', t: 0, y: 0, crps: 0.002, crpsB: 0.003, pit: 0.5, in90, in60: 1, inAci: in90 }) as const;

  it('ACI: α ≤ 0 → przedział nieskończony → pokrycie nawet przy skrajnym zwrocie', () => {
    const c = [{ time: T0 - MIN, open: 1, high: 1, low: 1, close: 100_000 }, ...candles(70, (i) => (i < 59 ? 100_000 : 130_000))];
    expect(resolveRet(ret({ aci: -0.05 }), c, T0 + 70 * MIN)!.inAci).toBe(1);
    expect(resolveRet(ret({ aci: 0.1 }), c, T0 + 70 * MIN)!.inAci).toBe(0);
  });

  it('test Kupca na rozłącznej podpróbie: prognozy 1 h co 15 min → co czwarta (nEff), opis pokrycia z całości', () => {
    const pairs = Array.from({ length: 80 }, (_, i) => ({ f: ret({ slot: T0 + i * 15 * MIN }), r: rr(i % 10 === 0 ? 0 : 1) }));
    const s = retScores(pairs);
    expect(s.cov90!.n).toBe(80);
    expect(s.cov90!.nEff).toBe(20);
  });

  it('BSS względem klimatologii poziomu: model podający częstość bazową każdego poziomu nie ma umiejętności', () => {
    const f = (p: { pdh: number; pdl: number; deq: number }): TouchForecast => ({
      k: 'f', id: 'x', slot: 0, ti: 0, t: 0, kind: 'touch', h: 120, px0: 1, lv: { pdh: 2, pdl: 0.5, deq: 1.2 }, p, model: 'x',
    });
    const pairs = Array.from({ length: 100 }, (_, i) => ({
      f: f({ pdh: 0.1, pdl: 0.3, deq: 0.6 }),
      r: { k: 'r' as const, id: 'x', t: 0, yv: { pdh: (i % 10 === 0 ? 1 : 0) as 0 | 1, pdl: (i % 10 < 3 ? 1 : 0) as 0 | 1, deq: (i % 10 < 6 ? 1 : 0) as 0 | 1 } },
    }));
    const s = touchScores(pairs);
    expect(s.pairs).toBe(300);
    expect(Math.abs(s.bss!)).toBeLessThan(1e-9);
  });

  it('uczestnictwo: sloty oczekiwane, wydane i pominięte (z powodem) w podsumowaniu', () => {
    const fs = new Map<string, Forecast>();
    const rs = new Map<string, Resolution>();
    fs.set('a', ret({ id: 'a', slot: T0, t: T0 + MIN }));
    const skips = [{ k: 's' as const, slot: T0 + 15 * MIN, reason: 'outage' }];
    const s = buildSummary({ coin: 'BTC', now: T0 + 31 * MIN, head: { hash: 'h', lines: 2 }, forecasts: fs, resolutions: rs, aci: {}, ots: [], skips });
    expect(s.participation).toMatchObject({ issued: 1, skipped: 1 });
    expect(s.participation.gaps).toEqual([{ slot: T0 + 15 * MIN, reason: 'outage' }]);
  });
});
