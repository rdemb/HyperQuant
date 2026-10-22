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
    // ceny źródłowe zapisane do niezależnej kontroli ze świecami rynku
    expect(r2).toMatchObject({ c0: 100_000, c1: 100_500 });
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
    expect(r.hi).toBe(Math.max(...path.map((c) => c.high)));
    expect(r.lo).toBe(Math.min(...path.map((c) => c.low)));
  });
});

import { buildSummary, retScores, touchScores, type Forecast, type Resolution } from '../forecaster.ts';
import { isDeskLedgerSummary } from '../../../src/utils/deskLedger.ts';

describe('wyniki i podsumowanie', () => {
  const rr = (pit: number, in90: 0 | 1, crps = 0.002, crpsB = 0.003) =>
    ({ k: 'r', id: 'x', t: 0, c0: 1, c1: 1, y: 0, crps, crpsB, pit, in90, in60: 1, inAci: in90 }) as const;

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
    const r = (y: 0 | 1) => ({ k: 'r' as const, id: 'x', t: 0, hi: 0, lo: 0, yv: { pdh: y, pdl: y, deq: y } });
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
    // część „model vs rynek”: poprawna przechodzi, uszkodzona odrzuca podsumowanie, brak — starsze podsumowania przechodzą
    expect(s.market).toMatchObject({ scores: { n: 0 }, tight: { n: 0 }, latest: null });
    expect(isDeskLedgerSummary({ ...s, market: { scores: { n: 'x' }, latest: null } })).toBe(false);
    const { market: _m, ...old } = s;
    expect(isDeskLedgerSummary(old)).toBe(true);
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
    const pairs = [{ f, r: { k: 'r' as const, id: f.id, t: 0, hi: 0, lo: 0, yv: { pdh: 0 as const, pdl: 1 as const, deq: 0 as const } } }];
    expect(touchScores(pairs).brier).toBeCloseTo(((f.p.pdh as number) ** 2 + (f.p.deq as number) ** 2) / 2, 9);
  });
});

describe('poprawki z recenzji: ACI, nakładanie, klimatologia poziomów, uczestnictwo', () => {
  const rr = (in90: 0 | 1) => ({ k: 'r', id: 'x', t: 0, c0: 1, c1: 1, y: 0, crps: 0.002, crpsB: 0.003, pit: 0.5, in90, in60: 1, inAci: in90 }) as const;

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
      r: { k: 'r' as const, id: 'x', t: 0, hi: 0, lo: 0, yv: { pdh: (i % 10 === 0 ? 1 : 0) as 0 | 1, pdl: (i % 10 < 3 ? 1 : 0) as 0 | 1, deq: (i % 10 < 6 ? 1 : 0) as 0 | 1 } },
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

  it('uczestnictwo: rekord zakresowy na granicy okna liczony tak samo jak pojedyncze (okno od pierwszego pełnego slotu)', () => {
    const now = T0 + 30 * 24 * 60 * MIN + 7 * MIN; // okno zaczyna się 7 min po T0 → pierwszy slot w oknie: T0 + 15 min
    const sum = (skips: { k: 's'; slot: number; until?: number; reason: string }[]) =>
      buildSummary({ coin: 'BTC', now, head: { hash: 'h', lines: 1 }, forecasts: new Map(), resolutions: new Map(), aci: {}, ots: [], skips }).participation.skipped;
    const singles = [-2, -1, 0, 1, 2].map((k) => ({ k: 's' as const, slot: T0 + k * 15 * MIN, reason: 'outage' }));
    expect(sum(singles)).toBe(2);
    expect(sum([{ k: 's', slot: T0 - 30 * MIN, until: T0 + 30 * MIN, reason: 'outage' }])).toBe(2);
  });
});

import { ensPairs, makeMktForecast, mktScores, resolveMkt, type MktForecast, type MktResolution } from '../forecaster.ts';
import { ENS_PRIOR, REC_PRIOR, poolProb } from '../../../src/utils/ensemble.ts';
import type { RangeBar } from '../../../src/utils/volatility.ts';

describe('model vs rynek (HIP-4, 15 min)', () => {
  const HOUR = 60 * MIN;
  function bars(n: number, stepMs: number, end: number, sigma: number, seed = 1): RangeBar[] {
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    let px = 100_000;
    return Array.from({ length: n }, (_, k) => {
      const t = end - (n - k) * stepMs;
      const o = px;
      const c = o * Math.exp(sigma * (rnd() - 0.5) * 3.4);
      px = c;
      return { time: t, open: o, high: Math.max(o, c) * (1 + sigma * rnd()), low: Math.min(o, c) * (1 - sigma * rnd()), close: c };
    });
  }
  const model = buildVolModel(bars(1200, HOUR, T0, 0.004), bars(2000, 5 * MIN, T0, 0.0015, 7), T0)!;
  const slot = T0;
  const expiry = slot + 15 * MIN;
  const ti = slot + 7 * MIN + 20_000;
  const tm = { slot, ti, t: slot + 8 * MIN };
  const snap = (K: number, quote: { bid: number; ask: number; liquid: boolean } | null = { bid: 0.45, ask: 0.5, liquid: true }) => ({
    outcome: 15711,
    K,
    expiry,
    src: 'mark' as const,
    px: 100_000,
    bookTime: ti - 1_000,
    quote: quote && { ...quote, mid: (quote.bid + quote.ask) / 2, spread: quote.ask - quote.bid, depthBid: 100, depthAsk: 100 },
  });

  it('prognoza: id, horyzont do terminu, notowanie rynku i p modelu malejące z progiem', () => {
    const lo = makeMktForecast(model, tm, 100_000, snap(99_950))!;
    const hi = makeMktForecast(model, tm, 100_000, snap(100_050))!;
    expect(lo).toMatchObject({ k: 'f', kind: 'mkt', id: `${slot}-mkt15711`, h: 7, K: 99_950, expiry, bid: 0.45, ask: 0.5, liquid: true, outcome: 15711 });
    expect(lo.p).toBeGreaterThan(0.5);
    expect(hi.p).toBeLessThan(0.5);
    expect(makeMktForecast(model, tm, 100_000, snap(100_000, null))).toMatchObject({ bid: null, ask: null, liquid: false });
    // termin nie później niż początek horyzontu → brak prognozy
    expect(makeMktForecast(model, { ...tm, t: expiry }, 100_000, snap(100_000))).toBeNull();
  });

  it('rozstrzygnięcie: zamknięcie minuty kończącej się w terminie ≥ próg; blisko progu (≤ 0,02%) oznaczone', () => {
    const f = makeMktForecast(model, tm, 100_000, snap(100_000))!;
    const c = (close: number) => [{ time: expiry - MIN, open: close, high: close, low: close, close }];
    expect(resolveMkt(f, c(100_100), expiry + 2 * MIN)).toMatchObject({ k: 'r', id: f.id, c1: 100_100, y: 1, near: 0 });
    expect(resolveMkt(f, c(99_000), expiry + 2 * MIN)).toMatchObject({ y: 0, near: 0 });
    expect(resolveMkt(f, c(100_010), expiry + 2 * MIN)).toMatchObject({ y: 1, near: 1 });
    expect(resolveMkt(f, [], expiry + 2 * MIN)).toBeNull();
  });

  it('wyniki: Brier i log score modelu i rynku na tych samych pytaniach (tylko płynne, bez bliskich progu), różnica z bootstrapem', () => {
    const f = (p: number, mid: number, liquid = true): MktForecast =>
      ({ k: 'f', id: String(Math.random()), slot, ti, t: tm.t, kind: 'mkt', h: 7, outcome: 1, K: 1, expiry, src: 'mark', px0: 1, bid: mid - 0.01, ask: mid + 0.01, liquid, p, model: 'x' }) as MktForecast;
    const r = (y: 0 | 1, near: 0 | 1 = 0): MktResolution => ({ k: 'r', id: 'x', t: 0, c1: 1, y, near });
    const pairs = [
      ...Array.from({ length: 40 }, (_, i) => ({ f: f(0.8, 0.6), r: r(i < 32 ? 1 : 0) })), // model trafniejszy
      { f: f(0.9, 0.9, false), r: r(1) }, // niepłynny — pominięty
      { f: f(0.5, 0.5), r: r(1, 1) }, // blisko progu — pominięty
    ];
    const s = mktScores(pairs);
    expect(s).toMatchObject({ n: 40, illiquid: 1, near: 1 });
    expect(s.brierModel!).toBeCloseTo((32 * 0.04 + 8 * 0.64) / 40, 9);
    expect(s.brierMarket!).toBeCloseTo((32 * 0.16 + 8 * 0.36) / 40, 9);
    expect(s.diff!.d).toBeCloseTo(s.brierModel! - s.brierMarket!, 12);
    expect(s.diff!.lo).toBeLessThanOrEqual(s.diff!.d);
    expect(s.diff!.hi).toBeGreaterThanOrEqual(s.diff!.d);
    expect(mktScores([])).toMatchObject({ n: 0, brierModel: null, diff: null });
  });

  it('ensemble i rynek skalibrowany: p_e i p_r z wag z chwili wydania (zapisane wagi); bez notowania — null', () => {
    const w = { a: 0.1, bm: 0.3, bk: 0.9, n: 120 };
    const rc = { a: -0.05, bm: 0, bk: 1.2, n: 120 };
    const f = makeMktForecast(model, tm, 100_000, snap(99_950), w, rc)!;
    expect(f.ens).toEqual(w);
    expect(f.rec).toEqual(rc);
    expect(f.pe).toBeCloseTo(poolProb(w, f.p, 0.475), 4);
    expect(f.pr).toBeCloseTo(poolProb(rc, f.p, 0.475), 4);
    expect(makeMktForecast(model, tm, 100_000, snap(99_950, null), w, rc)).toMatchObject({ pe: null, pr: null, ens: w, rec: rc });
    // Bez wag — priory (równy pooling, rynek bez zmian)
    const d = makeMktForecast(model, tm, 100_000, snap(99_950))!;
    expect(d.ens).toEqual(ENS_PRIOR);
    expect(d.rec).toEqual(REC_PRIOR);
  });

  it('pary do dopasowania: tylko wąski spread, z dala od progu, rozstrzygnięte przed chwilą wydania', () => {
    const mk = (id: string, bid: number | null, ask: number | null): MktForecast =>
      ({ k: 'f', id, slot, ti, t: tm.t, kind: 'mkt', h: 7, outcome: 1, K: 1, expiry, src: 'mark', px0: 1, bid, ask, liquid: true, p: 0.6, model: 'x' }) as MktForecast;
    const fs = [mk('a', 0.4, 0.44), mk('b', 0.3, 0.4), mk('c', 0.5, 0.52), mk('d', 0.5, 0.52), mk('e', null, null)];
    const rs = new Map<string, MktResolution>([
      ['a', { k: 'r', id: 'a', t: 1000, c1: 1, y: 1, near: 0 }],
      ['b', { k: 'r', id: 'b', t: 1000, c1: 1, y: 1, near: 0 }], // spread 10 pp
      ['c', { k: 'r', id: 'c', t: 1000, c1: 1, y: 0, near: 1 }], // blisko progu
      ['d', { k: 'r', id: 'd', t: 5000, c1: 1, y: 0, near: 0 }], // rozstrzygnięty po chwili wydania
    ]);
    const got = ensPairs(fs, rs, 2000);
    expect(got).toHaveLength(1);
    // Kolejność deterministyczna: czas rozstrzygnięcia, potem id
    const two = ensPairs([mk('z', 0.4, 0.44), mk('a2', 0.4, 0.44)], new Map([['z', { k: 'r', id: 'z', t: 1000, c1: 1, y: 1, near: 0 }], ['a2', { k: 'r', id: 'a2', t: 1000, c1: 1, y: 0, near: 0 }]]) as Map<string, MktResolution>, 2000);
    expect(two.map((x) => x.y)).toEqual([0, 1]);
    expect(got[0]).toMatchObject({ pm: 0.6, y: 1, t: 1000 });
    expect(got[0].pk).toBeCloseTo(0.42, 12);
  });

  it('wyniki ensemble na tych samych pytaniach co model, rynek i rynek skalibrowany; wartość dodana modelu', () => {
    const f = (p: number, mid: number, pe: number | null, pr: number | null): MktForecast =>
      ({ k: 'f', id: String(Math.random()), slot, ti, t: tm.t, kind: 'mkt', h: 7, outcome: 1, K: 1, expiry, src: 'mark', px0: 1, bid: mid - 0.01, ask: mid + 0.01, liquid: true, p, pe, pr, model: 'x' }) as MktForecast;
    const r = (y: 0 | 1): MktResolution => ({ k: 'r', id: 'x', t: 0, c1: 1, y, near: 0 });
    const pairs = [...Array.from({ length: 30 }, (_, i) => ({ f: f(0.8, 0.6, 0.7, 0.65), r: r(i < 24 ? 1 : 0) })), { f: f(0.9, 0.5, null, null), r: r(1) }];
    const s = mktScores(pairs);
    expect(s.n).toBe(31);
    expect(s.nEns).toBe(30);
    expect(s.brierEns!).toBeCloseTo((24 * 0.09 + 6 * 0.49) / 30, 9);
    // Model i rynek na tym samym podzbiorze 30 pytań (bez pytania bez p_e)
    expect(s.brierModelE!).toBeCloseTo((24 * 0.04 + 6 * 0.64) / 30, 9);
    expect(s.brierMarketE!).toBeCloseTo((24 * 0.16 + 6 * 0.36) / 30, 9);
    expect(s.brierRec!).toBeCloseTo((24 * 0.35 ** 2 + 6 * 0.65 ** 2) / 30, 9);
    expect(s.diffAdd!.d).toBeCloseTo(s.brierEns! - s.brierRec!, 12);
    expect(s.diffEns!.lo).toBeLessThanOrEqual(s.diffEns!.d);
    expect(mktScores([])).toMatchObject({ nEns: 0, brierEns: null, diffEns: null, diffAdd: null });
  });
});

import { makeRetForecast, makeRetForecastB, regimeFrom5m } from '../forecaster.ts';
import { horizonStepSigmas } from '../../../src/utils/volatility.ts';

describe('A/B wersji modelu: wariant B z reżimem zmienności (BOCPD)', () => {
  const H = 60 * MIN;
  function series(n: number, end: number, sds: [number, number][]): RangeBar[] {
    let s = 9;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const g = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
    let px = 100_000;
    const out: RangeBar[] = [];
    let k = 0;
    for (const [cnt, sd] of sds)
      for (let i = 0; i < cnt; i++, k++) {
        const o = px;
        px = o * Math.exp(sd * g());
        out.push({ time: end - (n - k) * 5 * MIN, open: o, high: Math.max(o, px), low: Math.min(o, px), close: px });
      }
    return out;
  }
  const FLAT = Array(24).fill(1);
  it('reżim z BOCPD na zwrotach 5m: po skoku zmienności σ reżimu bliska nowej, krótki przebieg', () => {
    const bars = series(800, T0, [
      [760, 0.0012],
      [40, 0.005],
    ]);
    const r = regimeFrom5m(bars, FLAT, T0)!;
    expect(r.sigma5).toBeGreaterThan(0.003);
    expect(r.sigma5).toBeLessThan(0.008);
    expect(r.run).toBeLessThan(60);
    expect(regimeFrom5m(bars.slice(0, 10), FLAT, T0)).toBeNull();
  });
  it('reżim: świeca w toku pominięta (bez podglądania niezamkniętej ceny)', () => {
    const bars = series(800, T0, [[800, 0.0012]]);
    const last = bars[bars.length - 1];
    const forming = { time: T0, open: last.close, high: last.close * 1.05, low: last.close, close: last.close * 1.05 };
    expect(regimeFrom5m([...bars, forming], FLAT, T0 + 2 * MIN)).toEqual(regimeFrom5m(bars, FLAT, T0 + 2 * MIN));
  });
  it('reżim na zwrotach odsezonowanych profilem godzinowym: godzina o współczynniku 4 z 2× większymi zwrotami = brak zmiany', () => {
    const base = series(800, T0, [[800, 0.0012]]);
    const f = FLAT.map((_, h) => (h === 11 ? 4 : 1));
    // Te same zwroty, ale w godzinie 11 UTC dwa razy większe (sezonowość) — po odsezonowaniu identyczne jak bazowe
    const seasonal: RangeBar[] = [];
    let px = base[0].close;
    seasonal.push({ ...base[0] });
    for (let i = 1; i < base.length; i++) {
      const r = Math.log(base[i].close / base[i - 1].close) * (new Date(base[i].time).getUTCHours() === 11 ? 2 : 1);
      const o = px;
      px = o * Math.exp(r);
      seasonal.push({ time: base[i].time, open: o, high: Math.max(o, px), low: Math.min(o, px), close: px });
    }
    const flat = regimeFrom5m(base, FLAT, T0)!;
    const des = regimeFrom5m(seasonal, f, T0)!;
    expect(des.sigma5).toBeCloseTo(flat.sigma5, 7);
    expect(des.run).toBe(flat.run);
  });
  it('reżim: ponad połowa zwrotów zerowych (martwy rynek / dziury w danych) → null', () => {
    const bars = series(300, T0, [[300, 0.0012]]).map((b, i) => (i % 5 === 0 ? b : { ...b, open: 100_000, high: 100_000, low: 100_000, close: 100_000 }));
    expect(regimeFrom5m(bars, FLAT, T0)).toBeNull();
  });
  it('wariant B: te same chwile co A, kwantyle A × skala; σ reżimu na horyzont przez sumę współczynników godzin', () => {
    const model = buildVolModel(bars1h(), bars5m(), T0)!;
    const tm = { slot: T0, ti: T0 + 20_000, t: T0 + MIN };
    const a = makeRetForecast(model, tm, 100_000, 60, 0.004, 0.1);
    const reg = { sigma5: 0.003, run: 25, pChange: 0.02 };
    const b = makeRetForecastB(model, a, reg);
    const sA = Math.sqrt(horizonStepSigmas(model, tm.t, 60).reduce((s, x) => s + x * x, 0));
    let fsum = 0;
    for (let k = 0; k < 12; k++) fsum += model.profile.factors[new Date(tm.t + k * 5 * MIN).getUTCHours()];
    const want = Math.sqrt(0.5 + (0.5 * 0.003 ** 2 * fsum) / sA ** 2);
    expect(b).toMatchObject({ id: `${T0}-ret60b`, variant: 'B', slot: a.slot, ti: a.ti, t: a.t, h: 60, px0: a.px0, model: 'ledger-har-fhs-bocpd-v1' });
    // Skala liczona z zapisanych (zaokrąglonych) σ_A i seas — zgodność z dokładnym wzorem do zaokrągleń
    expect(b.scale).toBeCloseTo(want, 3);
    expect(b.sigmaA).toBeCloseTo(sA, 8);
    expect(b.seas).toBeCloseTo(fsum / 12, 6);
    // Zapisane σ pozwalają odtworzyć skalę bez modelu
    expect(Math.sqrt(0.5 + (0.5 * 0.003 ** 2 * 12 * b.seas!) / b.sigmaA! ** 2)).toBeCloseTo(b.scale!, 6);
    b.q.forEach((v, i) => expect(v).toBeCloseTo(a.q[i] * b.scale!, 5));
    expect(b.bq).toEqual(a.bq);
    expect(b.regime).toEqual(reg);
  });

  function bars1h(): RangeBar[] {
    return series(1200, T0, [[1200, 0.004]]).map((b, i) => ({ ...b, time: T0 - (1200 - i) * H }));
  }
  function bars5m(): RangeBar[] {
    return series(2000, T0, [[2000, 0.0015]]);
  }
});

import { AB_EPOCH } from '../../../src/utils/abTest.ts';
import { isAb } from '../../../src/utils/deskLedger.ts';

describe('podsumowanie: sekcja A/B i liczniki wersji głównej', () => {
  const rr = (crps: number) => ({ k: 'r', id: 'x', t: 0, c0: 1, c1: 1, y: 0, crps, crpsB: 0.003, pit: 0.5, in90: 1, in60: 1, inAci: 1 }) as const;
  it('pary A/B od AB_EPOCH trafiają do okresu w toku; B nie liczy się do oczekujących ani unieważnionych', () => {
    const fs = new Map<string, Forecast>();
    const rs = new Map<string, Resolution>();
    for (let k = 0; k < 8; k++) {
      const slot = AB_EPOCH + k * 15 * MIN;
      const a = ret({ id: `${slot}-ret60`, slot, ti: slot + 20_000, t: slot + MIN });
      const b = { ...a, id: `${slot}-ret60b`, variant: 'B' as const, scale: 1.1, regime: { sigma5: 0.001, run: 30, pChange: 0.02 }, sigmaA: 0.004, seas: 1 };
      fs.set(a.id, a);
      fs.set(b.id, b);
      if (k < 6) {
        rs.set(a.id, rr(0.002));
        rs.set(b.id, rr(0.0019));
      }
    }
    // unieważnione rozstrzygnięcie wariantu B
    const last = `${AB_EPOCH + 7 * 15 * MIN}-ret60b`;
    rs.set(last, { k: 'r', id: last, t: 0, void: 'brak świec' } as unknown as Resolution);
    const s = buildSummary({ coin: 'BTC', now: AB_EPOCH + 3 * 3_600_000, head: { hash: 'h', lines: 1 }, forecasts: fs, resolutions: rs, aci: {}, ots: [], abRegisteredAt: AB_EPOCH - 3_600_000 });
    expect(s.pending).toBe(2);
    expect(s.voided).toBe(0);
    expect(s.ab!.current).toMatchObject({ start: AB_EPOCH, n: 6, diff: null });
    expect(s.ab!.current!.crpsB! - s.ab!.current!.crpsA!).toBeCloseTo(-0.0001, 8);
    expect(s.ab!.last).toBeNull();
    expect(s.ab!.latest!.scale).toBe(1.1);
    expect(s.scores.ret['60'].n).toBe(6);
    expect(isDeskLedgerSummary(s)).toBe(true);
    expect(isAb(s.ab)).toBe(true);
    expect(s.ab!.registeredAt).toBe(AB_EPOCH - 3_600_000);
    // uszkodzona sekcja A/B: podsumowanie nadal ważne (panel dziennika widoczny), odrzucona tylko karta A/B
    const broken = { ...s, ab: { ...s.ab, current: { n: 'x' } } };
    expect(isDeskLedgerSummary(broken)).toBe(true);
    expect(isAb(broken.ab)).toBe(false);
  });
});
