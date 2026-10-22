import { type RangeBar, type VolModel, buildVolModel, horizonStepSigmas } from '../../src/utils/volatility.ts';
import { forecastReturnQuantiles, runTouchMonteCarlo } from '../../src/utils/touchMc.ts';
import { aciStep, brier, crpsQuantiles, isotonic, kupiec, normInv, pitFromQuantiles, quantileAt, reliability, vennAbers } from '../../src/utils/forecastScore.ts';
import { seedFrom } from '../../src/utils/pathEngine.ts';
import type { DeskLedgerSummary, RetScores, TouchLevel, TouchScores } from '../../src/utils/deskLedger.ts';
import type { InfoClient } from './liqDetect.ts';

/**
 * Prognozy desku do weryfikowalnego dziennika (pre-rejestracja co 15 min, rozstrzygnięcie ze świec 1m):
 *  - rozkład log-zwrotu BTC na 1 h i 4 h: 13 kwantyli z tego samego modelu co desk (sezonowy log-HAR + innowacje FHS,
 *    Monte Carlo 4000 ścieżek, martyngał ceny) oraz — zapisane od razu — kwantyle benchmarku (normalny, σ z 30 dni);
 *  - prawdopodobieństwa dotknięcia PDH / PDL / D-EQ w 2 h — ten sam silnik co pas „Zasięg 2h” na Desku.
 * Wyniki: CRPS (i umiejętność względem benchmarku), PIT, pokrycie przedziałów 60/90% z testem Kupca, ACI (Gibbs & Candès),
 * Brier, BSS, niezawodność i kalibracja Venna–Abersa dla prawdopodobieństw.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export const SLOT = 15 * MIN;
export const TAUS = [0.025, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.975];
export const RET_HORIZONS = [60, 240] as const;
export const TOUCH_H = 120;
export const MODEL_VERSION = 'ledger-har-fhs-v1';
/** ACI: nominalne α dla przedziału 90% i krok γ */
export const ACI_ALPHA = 0.1;
export const ACI_GAMMA = 0.005;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

export interface RetForecast {
  k: 'f';
  id: string;
  t: number;
  kind: 'ret';
  h: number;
  px0: number;
  taus: number[];
  /** Kwantyle log-zwrotu modelu */
  q: number[];
  /** Kwantyle benchmarku (normalny, σ z 30 dni) — zapisane przed rozstrzygnięciem */
  bq: number[];
  /** α_t ACI w chwili wydania (przedział [q(α/2), q(1−α/2)]) */
  aci: number;
  model: string;
}

export interface TouchForecast {
  k: 'f';
  id: string;
  t: number;
  kind: 'touch';
  h: number;
  px0: number;
  lv: Record<TouchLevel, number>;
  /** null = cena już za poziomem przy wydaniu (zdarzenie trywialne — nie jest prognozowane ani oceniane) */
  p: Record<TouchLevel, number | null>;
  model: string;
}

export interface RetResolution {
  k: 'r';
  id: string;
  t: number;
  y: number;
  crps: number;
  crpsB: number;
  pit: number;
  in90: 0 | 1;
  in60: 0 | 1;
  inAci: 0 | 1;
}

export interface TouchResolution {
  k: 'r';
  id: string;
  t: number;
  yv: Record<TouchLevel, 0 | 1>;
}

export type Forecast = RetForecast | TouchForecast;
export type Resolution = RetResolution | TouchResolution;
const LEVELS: TouchLevel[] = ['pdh', 'pdl', 'deq'];

export const slotOf = (t: number) => Math.floor(t / SLOT) * SLOT;

/** Świece `candleSnapshot` → RangeBar; rekordy z nieliczbami pomijane. */
export function parseCandles(raw: unknown): RangeBar[] {
  if (!Array.isArray(raw)) return [];
  const out: RangeBar[] = [];
  for (const c of raw as Record<string, unknown>[]) {
    const n = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v)));
    const b = { time: n(c?.t), open: n(c?.o), high: n(c?.h), low: n(c?.l), close: n(c?.c) };
    if ([b.time, b.open, b.high, b.low, b.close].every(Number.isFinite)) out.push(b);
  }
  return out;
}

/** Cena w chwili T = zamknięcie świecy 1m kończącej się w T; brak → null. */
export function closeAt(c1m: RangeBar[], t: number): number | null {
  const bar = c1m.find((b) => b.time === t - MIN);
  return bar && bar.close > 0 ? bar.close : null;
}

/** σ godzinowych log-zwrotów z ostatnich 30 dni (benchmark „bez modelu”). */
export function sigma1hFromHourly(hourly: RangeBar[]): number {
  const closes = hourly
    .slice(-721)
    .map((b) => b.close)
    .filter((c) => c > 0);
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1]));
  if (r.length < 2) return Number.NaN;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
}

export function benchQuantiles(sigma1h: number, hMin: number): number[] {
  const s = sigma1h * Math.sqrt(hMin / 60);
  return TAUS.map((t) => -0.5 * s * s + s * normInv(t));
}

export function makeRetForecast(model: VolModel, t: number, px0: number, h: number, sigma1h: number, aci: number): RetForecast {
  const steps = horizonStepSigmas(model, t, h);
  const q = forecastReturnQuantiles(steps, model.residuals, TAUS, { seed: seedFrom(t / MIN, h) });
  return { k: 'f', id: `${t}-ret${h}`, t, kind: 'ret', h, px0, taus: TAUS, q: q.map(r6), bq: benchQuantiles(sigma1h, h).map(r6), aci: r4(aci), model: MODEL_VERSION };
}

export function makeTouchForecast(model: VolModel, t: number, px0: number, pdh: number, pdl: number): TouchForecast {
  const deq = (pdh + pdl) / 2;
  const mc = runTouchMonteCarlo(px0, pdh, pdl, deq, 0, { stepSigmas: horizonStepSigmas(model, t, TOUCH_H), residuals: model.residuals, nowMs: t });
  // Poziom już przekroczony przy wydaniu (PDH ≤ cena, PDL ≥ cena) — dotknięcie jest pewne, więc nie jest prognozą
  const live = (crossed: boolean, prob: number) => (crossed ? null : r4(prob / 100));
  return {
    k: 'f',
    id: `${t}-touch${TOUCH_H}`,
    t,
    kind: 'touch',
    h: TOUCH_H,
    px0,
    lv: { pdh, pdl, deq: r6(deq) },
    p: { pdh: live(pdh <= px0, mc.probTouchPDH2h), pdl: live(pdl >= px0, mc.probTouchPDL2h), deq: r4(mc.probTouchDEQ2h / 100) },
    model: MODEL_VERSION,
  };
}

export function resolveRet(f: RetForecast, c1m: RangeBar[], now: number): RetResolution | null {
  const c0 = closeAt(c1m, f.t);
  const c1 = closeAt(c1m, f.t + f.h * MIN);
  if (c0 === null || c1 === null) return null;
  const y = Math.log(c1 / c0);
  const inRange = (lo: number, hi: number) => (y >= quantileAt(f.taus, f.q, lo) && y <= quantileAt(f.taus, f.q, hi) ? 1 : 0);
  return {
    k: 'r',
    id: f.id,
    t: now,
    y: r6(y),
    crps: r6(crpsQuantiles(f.taus, f.q, y)),
    crpsB: r6(crpsQuantiles(f.taus, f.bq, y)),
    pit: r4(pitFromQuantiles(f.taus, f.q, y)),
    in90: inRange(0.05, 0.95),
    in60: inRange(0.2, 0.8),
    inAci: inRange(f.aci / 2, 1 - f.aci / 2),
  };
}

export function resolveTouch(f: TouchForecast, c1m: RangeBar[], now: number): TouchResolution | null {
  const win = c1m.filter((b) => b.time >= f.t && b.time + MIN <= f.t + f.h * MIN);
  if (win.length < f.h) return null;
  const hi = Math.max(...win.map((b) => b.high));
  const lo = Math.min(...win.map((b) => b.low));
  const deqBelow = f.lv.deq <= f.px0;
  return {
    k: 'r',
    id: f.id,
    t: now,
    yv: { pdh: hi >= f.lv.pdh ? 1 : 0, pdl: lo <= f.lv.pdl ? 1 : 0, deq: (deqBelow ? lo <= f.lv.deq : hi >= f.lv.deq) ? 1 : 0 },
  };
}

/** Stan ACI po kolejnym rozstrzygnięciu przedziału 90% (chybienie obniża α → szerszy kolejny przedział). */
export const nextAci = (alpha: number, miss: boolean) => aciStep(alpha, ACI_ALPHA, miss, ACI_GAMMA);

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Wyniki prognoz zwrotu jednego horyzontu z par (prognoza, rozstrzygnięcie). */
export function retScores(pairs: { f: RetForecast; r: RetResolution }[]): RetScores {
  const n = pairs.length;
  const crps = mean(pairs.map((p) => p.r.crps));
  const crpsB = mean(pairs.map((p) => p.r.crpsB));
  const hist = Array<number>(10).fill(0);
  for (const p of pairs) hist[Math.min(9, Math.floor(p.r.pit * 10))]++;
  const miss90 = pairs.filter((p) => !p.r.in90).length;
  const miss60 = pairs.filter((p) => !p.r.in60).length;
  const missAci = pairs.filter((p) => !p.r.inAci).length;
  return {
    n,
    crps,
    crpsBench: crpsB,
    crpss: crps !== null && crpsB !== null && crpsB > 0 ? 1 - crps / crpsB : null,
    pitHist: hist,
    cov90: n ? { rate: 1 - miss90 / n, kupiecP: kupiec(n, miss90, 0.1) } : null,
    cov60: n ? { rate: 1 - miss60 / n, kupiecP: kupiec(n, miss60, 0.4) } : null,
    covAci: n ? { rate: 1 - missAci / n, kupiecP: kupiec(n, missAci, 0.1) } : null,
  };
}

/** Wyniki prognoz dotknięć (wszystkie poziomy razem) + mapa kalibracji izotonicznej. */
const touchPairsOf = (pairs: { f: TouchForecast; r: TouchResolution }[]) =>
  pairs.flatMap((p) => LEVELS.filter((l) => p.f.p[l] !== null && p.f.p[l] !== undefined).map((l) => ({ p: p.f.p[l] as number, y: p.r.yv[l] })));

export function touchScores(pairs: { f: TouchForecast; r: TouchResolution }[]): TouchScores {
  const pp = touchPairsOf(pairs);
  const base = mean(pp.map((x) => x.y));
  const bs = brier(pp);
  const bsBase = base === null ? null : brier(pp.map((x) => ({ p: base, y: x.y })));
  const sorted = [...pp].sort((a, b) => a.p - b.p);
  const fit = isotonic(sorted.map((x) => x.y));
  const map: [number, number][] = [];
  sorted.forEach((x, i) => {
    const last = map[map.length - 1];
    if (!last || last[1] !== fit[i]) map.push([r4(x.p), r4(fit[i])]);
  });
  return {
    n: pairs.length,
    brier: bs,
    brierBase: bsBase,
    bss: bs !== null && bsBase !== null && bsBase > 0 ? 1 - bs / bsBase : null,
    reliability: reliability(pp, 10).map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, meanP: b.meanP, freq: b.freq })),
    calibration: map.slice(0, 200),
  };
}

export interface SummaryInput {
  coin: string;
  now: number;
  head: { hash: string; lines: number };
  forecasts: Map<string, Forecast>;
  resolutions: Map<string, Resolution>;
  aci: Record<number, number>;
  ots: DeskLedgerSummary['ots'];
}

/** Podsumowanie (30 dni) dla strony: najnowsze prognozy, wyniki, kalibracja Venna–Abersa najnowszych prawdopodobieństw. */
export function buildSummary(s: SummaryInput): DeskLedgerSummary {
  const from = s.now - 30 * DAY;
  const fs = [...s.forecasts.values()].filter((f) => f.t >= from).sort((a, b) => a.t - b.t);
  const retPairs = new Map<number, { f: RetForecast; r: RetResolution }[]>();
  const touchPairs: { f: TouchForecast; r: TouchResolution }[] = [];
  for (const f of fs) {
    const r = s.resolutions.get(f.id);
    if (!r) continue;
    if (f.kind === 'ret' && 'y' in r) retPairs.set(f.h, [...(retPairs.get(f.h) ?? []), { f, r }]);
    if (f.kind === 'touch' && 'yv' in r) touchPairs.push({ f, r });
  }
  const latestRet = RET_HORIZONS.map((h) => [...fs].reverse().find((f) => f.kind === 'ret' && f.h === h) as RetForecast | undefined).filter(
    (f): f is RetForecast => !!f
  );
  const latestTouch = [...fs].reverse().find((f) => f.kind === 'touch') as TouchForecast | undefined;
  const cal = touchPairsOf(touchPairs);
  const pending = fs.filter((f) => !s.resolutions.has(f.id)).length;
  const voided = fs.filter((f) => {
    const r = s.resolutions.get(f.id) as (Resolution & { void?: string }) | undefined;
    return !!r && typeof r.void === 'string';
  }).length;

  return {
    v: 1,
    coin: s.coin,
    asOf: s.now,
    model: MODEL_VERSION,
    head: s.head,
    pending,
    voided,
    latest: {
      ret: latestRet.map((f) => {
        const a = s.aci[f.h] ?? ACI_ALPHA;
        return {
          t: f.t,
          h: f.h,
          px0: f.px0,
          taus: f.taus,
          q: f.q,
          bq: f.bq,
          aci: { alpha: r4(a), lo: r6(quantileAt(f.taus, f.q, a / 2)), hi: r6(quantileAt(f.taus, f.q, 1 - a / 2)) },
        };
      }),
      touch: latestTouch
        ? {
            t: latestTouch.t,
            px0: latestTouch.px0,
            lv: latestTouch.lv,
            p: latestTouch.p,
            va: Object.fromEntries(
              LEVELS.map((l) => {
                const p = latestTouch.p[l];
                if (p === null) return [l, null];
                const v = vennAbers(cal, p);
                return [l, { p0: r4(v.p0), p1: r4(v.p1), p: r4(v.p) }];
              })
            ) as Record<TouchLevel, { p0: number; p1: number; p: number } | null>,
          }
        : null,
    },
    scores: {
      ret: Object.fromEntries(RET_HORIZONS.map((h) => [h, retScores(retPairs.get(h) ?? [])])) as Record<string, RetScores>,
      touch: touchScores(touchPairs),
    },
    ots: s.ots,
    method: 'hq-ledger-v1',
  };
}

/** Pomocniczo dla skanera: model zmienności ze świec 1h i 5m. */
export function volModelFrom(hourly: RangeBar[], fiveMin: RangeBar[], now: number): VolModel | null {
  return buildVolModel(hourly, fiveMin, now);
}

export interface ForecasterDeps {
  coin: string;
  rest: InfoClient;
}

/** Wagi `candleSnapshot`: 20 + 1 na 60 świec (szacunek z zapasem). */
const candleWeight = (n: number) => 20 + Math.ceil(n / 60);

/** Pobieranie danych z API do prognoz (świece) — w budżecie wag skanera. */
export class ForecastData {
  private readonly d: ForecasterDeps;
  model: VolModel | null = null;
  sigma1h = Number.NaN;
  modelAt = 0;
  levels: { pdh: number; pdl: number; day: number } | null = null;
  levelsAt = 0;

  constructor(d: ForecasterDeps) {
    this.d = d;
  }

  private async candles(interval: string, startTime: number, n: number): Promise<RangeBar[]> {
    return parseCandles(await this.d.rest.info({ type: 'candleSnapshot', req: { coin: this.d.coin, interval, startTime } }, candleWeight(n)));
  }

  /** Model zmienności i σ benchmarku — co godzinę (≈ 210 wag). */
  async refreshModel(now: number): Promise<void> {
    if (this.model && now - this.modelAt < HOUR) return;
    const [h, f] = [await this.candles('1h', now - 5000 * HOUR, 5000), await this.candles('5m', now - 5000 * 5 * MIN, 5000)];
    const m = buildVolModel(h, f, now);
    if (m) {
      this.model = m;
      this.sigma1h = sigma1hFromHourly(h.filter((b) => b.time + HOUR <= now));
      this.modelAt = now;
    }
  }

  /** PDH/PDL z poprzedniej dobowej świecy UTC — co 10 min. */
  async refreshLevels(now: number): Promise<void> {
    if (this.levels && now - this.levelsAt < 10 * MIN) return;
    const d = await this.candles('1d', now - 3 * DAY, 3);
    const today = Math.floor(now / DAY) * DAY;
    const prev = d.find((b) => b.time === today - DAY);
    if (prev && prev.high > prev.low) {
      this.levels = { pdh: prev.high, pdl: prev.low, day: prev.time };
      this.levelsAt = now;
    }
  }

  /** Świece 1m od `from` (do rozstrzygania). */
  minuteCandles(from: number, now: number): Promise<RangeBar[]> {
    return this.candles('1m', from - MIN, Math.ceil((now - from) / MIN) + 2);
  }
}
