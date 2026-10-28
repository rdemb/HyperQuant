import { AB_BLOCK_DAYS, abBlocks, type AbRow } from '../../src/utils/abTest.ts';
import { Bocpd } from '../../src/utils/bocpd.ts';
import { ENS_PRIOR, REC_PRIOR, fitEnsemble, poolProb, type EnsPair, type EnsWeights } from '../../src/utils/ensemble.ts';
import { type RangeBar, type VolModel, buildVolModel, horizonStepSigmas } from '../../src/utils/volatility.ts';
import { forecastReturnQuantiles, runTouchMonteCarlo } from '../../src/utils/touchMc.ts';
import { aciStep, brier, crpsQuantiles, isotonic, kupiec, normInv, pitFromQuantiles, quantileAt, quantileAtExt, reliability, vennAbers } from '../../src/utils/forecastScore.ts';
import { mulberry32, seedFrom } from '../../src/utils/pathEngine.ts';
import { outcomeProbabilities } from '../../src/utils/hip4.ts';
import { horizonSigmas, stepFor } from '../../src/utils/hip4Model.ts';
import type { CatScores, CatTouchScores, DeskLedgerSummary, MktScores, RetScores, TouchLevel, TouchScores } from '../../src/utils/deskLedger.ts';
import {
  type Bar,
  CONE_Q,
  type ConeStep,
  FEATURES,
  type FeatureVec,
  type Levels,
  type SchrodiInput,
  type SchrodiModel,
  TOUCH_MAX_R,
  type TouchModel,
  features as catFeatures,
  modelEvents,
  scoreHead,
  stanceOf,
  touchCone,
  touchProb,
} from '../../src/utils/schrodi.ts';
import { normCdf } from '../../src/utils/stats.ts';
import { type CatTrust, type TrustHour, catTrust } from '../../src/utils/schrodiTrust.ts';
import { MACRO_EVENTS } from '../../src/data/macroCalendar.ts';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { InfoClient } from './liqDetect.ts';
import { canonicalJson } from './ledger.ts';
import type { MarketSnap } from './marketQuotes.ts';

/**
 * Prognozy desku do weryfikowalnego dziennika (pre-rejestracja co 15 min, rozstrzygnięcie ze świec 1m):
 *  - rozkład log-zwrotu BTC na 1 h i 4 h: 13 kwantyli z tego samego modelu co desk (sezonowy log-HAR + innowacje FHS,
 *    Monte Carlo 4000 ścieżek, martyngał ceny) oraz — zapisane od razu — kwantyle benchmarku (normalny, σ z 30 dni);
 *  - prawdopodobieństwa dotknięcia PDH / PDL / D-EQ w 2 h — ten sam silnik co pas „Zasięg 2h” na Desku;
 *  - Schrödi (kot pod wykresem): szansa dużego ruchu i wzrostu w 1 h, szanse dotknięcia poziomów aukcji i stożek
 *    zasięgu godziny — te same modele i kod co na stronie.
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
const r2 = (x: number) => Math.round(x * 100) / 100;
const r8 = (x: number) => Math.round(x * 1e8) / 1e8;

/** Czasy prognozy: slot 15 min (klucz), chwila wydania i początek horyzontu (pełna minuta po wydaniu — bez podglądania). */
export interface ForecastTimes {
  slot: number;
  /** Chwila wydania (po odczycie ceny) */
  ti: number;
  /** Początek horyzontu: pierwsza pełna minuta po wydaniu; rozstrzygnięcie liczone od tej chwili */
  t: number;
}

export interface RetForecast {
  k: 'f';
  id: string;
  slot: number;
  ti: number;
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
  /**
   * Wariant B (A/B wersji modelu): kwantyle A × `scale`, σ_B² = ½σ_A² + ½σ²_reżimu,h (BOCPD na odsezonowanych zwrotach
   * 5m). Brak = wersja główna (A). Wariant B nie zmienia ACI wersji A.
   */
  variant?: 'B';
  /** √(½ + ½·σ²_reżimu,h / σ_A²), σ²_reżimu,h = sigma5² · (h/5) · seas */
  scale?: number;
  regime?: Regime;
  /** σ_A: odchylenie log-zwrotu na horyzoncie z modelu A (√ sumy wariancji kroków) */
  sigmaA?: number;
  /** Średni współczynnik sezonowy godzin na krokach 5m horyzontu (profil modelu A) */
  seas?: number;
}

/**
 * Reżim zmienności z BOCPD: σ odsezonowanego zwrotu 5m reżimu (godzina o współczynniku 1), najbardziej prawdopodobna
 * długość (świece 5m, opisowo), P(zmiany w ostatnich 5 świecach)
 */
export interface Regime {
  sigma5: number;
  run: number;
  pChange: number;
}

export const MODEL_B = 'ledger-har-fhs-bocpd-v1';
/** Oczekiwana długość reżimu: doba świec 5m */
const BOCPD_HAZARD = 1 / 288;

/**
 * Reżim zmienności z log-zwrotów 5m (zamknięte, ciągłe świece, do 3 dni), odsezonowanych profilem godzinowym modelu A
 * (r / √f(godzina UTC świecy)) — inaczej zwykły rytm doby (otwarcie USA) wyglądałby jak zmiana reżimu. BOCPD (Adams &
 * MacKay 2007) z priorem Gamma na precyzję: średnia a priori wariancji = odporna wariancja okna (mediana r² / 0,4549,
 * nie mniej niż ¼ średniej r²). Świeca w toku pomijana; mniej niż 100 zwrotów albo ponad połowa zerowych → null.
 */
export function regimeFrom5m(bars: readonly RangeBar[], factors: readonly number[], now: number): Regime | null {
  const b = bars.filter((x) => x.time + 5 * MIN <= now).sort((x, y) => x.time - y.time).slice(-865);
  const r: number[] = [];
  for (let i = 1; i < b.length; i++) {
    if (b[i].time - b[i - 1].time !== 5 * MIN || !(b[i].close > 0) || !(b[i - 1].close > 0)) continue;
    const f = factors[new Date(b[i].time).getUTCHours()];
    r.push(Math.log(b[i].close / b[i - 1].close) / Math.sqrt(f > 0 ? f : 1));
  }
  if (r.length < 100 || r.filter((x) => x === 0).length * 2 > r.length) return null;
  const sq = r.map((x) => x * x).sort((x, y) => x - y);
  const mean = sq.reduce((s, x) => s + x, 0) / sq.length;
  const v0 = Math.max(1e-10, sq[sq.length >> 1] / 0.4549, 0.25 * mean);
  const det = new Bocpd({ hazard: BOCPD_HAZARD, alpha0: 2, beta0: v0, rMax: 600 });
  for (const x of r) det.update(x);
  const st = det.state();
  return { sigma5: Math.round(st.sigma * 1e8) / 1e8, run: st.mapRun, pChange: r4(st.pRecent5) };
}

/**
 * Wariant B prognozy zwrotu: te same chwile i benchmark co A, kwantyle A przeskalowane do σ z mieszaniny model/reżim.
 * σ reżimu na horyzont: σ5² · Σ f(godzina kroku) po krokach 5m od `t` (ten sam profil, którym odsezonowano zwroty).
 * Zapisane σ_A i średni współczynnik `seas` pozwalają weryfikatorowi odtworzyć skalę bez modelu.
 */
export function makeRetForecastB(model: VolModel, a: RetForecast, reg: Regime): RetForecast {
  const sA2 = horizonStepSigmas(model, a.t, a.h).reduce((s, x) => s + x * x, 0);
  const steps = Math.round(a.h / 5);
  let fsum = 0;
  for (let k = 0; k < steps; k++) fsum += model.profile.factors[new Date(a.t + k * 5 * MIN).getUTCHours()];
  const sigmaA = r8(Math.sqrt(sA2));
  const seas = r6(fsum / steps);
  const regH2 = reg.sigma5 ** 2 * steps * seas;
  const scale = r6(Math.sqrt(0.5 + (0.5 * regH2) / Math.max(sigmaA ** 2, 1e-18)));
  return { ...a, id: `${a.id}b`, q: a.q.map((v) => r6(v * scale)), model: MODEL_B, variant: 'B', scale, regime: reg, sigmaA, seas };
}

export interface TouchForecast {
  k: 'f';
  id: string;
  slot: number;
  ti: number;
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
  /** Ceny źródłowe (zamknięcia świec 1m w t i t + h) — do niezależnej kontroli z danymi rynku */
  c0: number;
  c1: number;
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
  /** Maksimum i minimum świec 1m w oknie — do niezależnej kontroli */
  hi: number;
  lo: number;
  yv: Record<TouchLevel, 0 | 1>;
}

/**
 * Model vs rynek (HIP-4): aktywny 15-minutowy rynek binarny BTC („mark ≥ K w terminie”), zapisany 5–10 min przed terminem:
 * notowanie strony „Tak” i p modelu z tej samej chwili. Rozstrzygnięcie w t + h = termin.
 */
export interface MktForecast {
  k: 'f';
  id: string;
  slot: number;
  ti: number;
  t: number;
  kind: 'mkt';
  /** Minuty od początku horyzontu do terminu */
  h: number;
  outcome: number;
  K: number;
  expiry: number;
  src: 'mark' | 'trade' | 'pyth' | 'other';
  px0: number;
  /** Notowanie strony „Tak” w chwili wydania (null = brak arkusza) */
  bid: number | null;
  ask: number | null;
  /** USDC w zleceniach do ±5 pp od środka po obu stronach — do niezależnego przeliczenia płynności */
  depthBid: number | null;
  depthAsk: number | null;
  /** Arkusz płynny (spread ≤ 5 pp, ≥ 50 USDC w ±5 pp od środka po obu stronach) — ocena ścisła */
  liquid: boolean;
  /** P(cena w terminie ≥ K) z modelu, od chwili wydania */
  p: number;
  /**
   * Ensemble model + rynek (pooling logarytmiczny) z wag dopasowanych w chwili wydania na wcześniej rozstrzygniętych
   * pytaniach; null = brak notowania. Starsze rekordy bez pól ensemble.
   */
  pe?: number | null;
  ens?: EnsWeights;
  /** Punkt odniesienia: rekalibrowana sama cena rynku (a + b_k·logit środka) — ta sama procedura dopasowania */
  pr?: number | null;
  rec?: EnsWeights;
  model: string;
}

export interface MktResolution {
  k: 'r';
  id: string;
  t: number;
  /** Zamknięcie świecy 1m kończącej się w terminie (cena transakcji — rynek rozlicza po mark) */
  c1: number;
  y: 0 | 1;
  /** |c1 − K| ≤ 0,05% K: wynik niepewny (rynek rozlicza po mark w oknie z opisu, my ze świecy transakcji) — nie oceniany */
  near: 0 | 1;
}

/**
 * Schrödi: szansa wzrostu i dużego ruchu w 1 h z modelu `public/schrodi/model-v1.json` (ten sam plik i kod co kot na
 * stronie). Cechy na zamknięciu świecy 5m kończącej się z początkiem slotu; zapisane z 6 miejscami, a p policzone
 * z wersji zapisanej — każdy przeliczy p z rekordu i publicznego modelu (`mh` = SHA-256 kanonicznego JSON modelu).
 */
export interface CatForecast {
  k: 'f';
  id: string;
  slot: number;
  ti: number;
  t: number;
  kind: 'cat';
  h: number;
  /** Początek świecy 5m z cechami (jej koniec = początek slotu) */
  bar: number;
  /** Zamknięcie tej świecy */
  px0: number;
  /** Cechy w kolejności FEATURES (null = brak danych) */
  x: (number | null)[];
  pUp: number;
  pBig: number;
  /** Próg dużego ruchu: mediana zakresu 720 pełnych godzin przed slotem (bp, log) */
  thr: number;
  model: string;
  mh: string;
  /**
   * Szanse dotknięcia poziomów aukcji w oknie godziny (model `public/schrodi/touch-v1.json`, hash `th`): poziom, cena
   * (2 miejsca) i p z zapisanych cech, `thr` i ceny `px0`. Tylko poziomy w zakresie uczenia (do 3 median zakresu godziny).
   */
  tl?: { k: keyof Levels; px: number; p: number }[];
  /** Stożek zasięgu: odległość od `px0` (pb, log) w górę i w dół dotykana z szansą 80, 50 i 20% (null = poza zakresem) */
  cone?: ConeStep[];
  tmodel?: string;
  th?: string;
}

/** Rozstrzygnięcie kota: ceny w t i t + h, max/min świec 1m okna; wzrost = c1 > c0, duży ruch = ln(hi/lo) > próg. */
export interface CatResolution {
  k: 'r';
  id: string;
  t: number;
  c0: number;
  c1: number;
  hi: number;
  lo: number;
  yDir: 0 | 1;
  yBig: 0 | 1;
}

export type Forecast = RetForecast | TouchForecast | MktForecast | CatForecast;
export type Resolution = RetResolution | TouchResolution | MktResolution | CatResolution;
/** Jawny zapis pominiętego slotu (brak modelu, ceny, przerwa) — braki nie mogą znikać po cichu */
export interface SkipRecord {
  k: 's';
  slot: number;
  /** Ostatni pominięty slot zakresu (długa przerwa — jeden rekord zamiast tysięcy) */
  until?: number;
  reason: string;
}
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

export function makeRetForecast(model: VolModel, tm: ForecastTimes, px0: number, h: number, sigma1h: number, aci: number): RetForecast {
  const steps = horizonStepSigmas(model, tm.t, h);
  const q = forecastReturnQuantiles(steps, model.residuals, TAUS, { seed: seedFrom(tm.slot / MIN, h) });
  return {
    k: 'f',
    id: `${tm.slot}-ret${h}`,
    slot: tm.slot,
    ti: tm.ti,
    t: tm.t,
    kind: 'ret',
    h,
    px0,
    taus: TAUS,
    q: q.map(r6),
    bq: benchQuantiles(sigma1h, h).map(r6),
    aci: r4(aci),
    model: MODEL_VERSION,
  };
}

export function makeTouchForecast(model: VolModel, tm: ForecastTimes, px0: number, pdh: number, pdl: number): TouchForecast {
  const t = tm.t;
  const deq = (pdh + pdl) / 2;
  const mc = runTouchMonteCarlo(px0, pdh, pdl, deq, 0, { stepSigmas: horizonStepSigmas(model, t, TOUCH_H), residuals: model.residuals, nowMs: t });
  // Poziom już przekroczony przy wydaniu (PDH ≤ cena, PDL ≥ cena) — dotknięcie jest pewne, więc nie jest prognozą
  const live = (crossed: boolean, prob: number) => (crossed ? null : r4(prob / 100));
  return {
    k: 'f',
    id: `${tm.slot}-touch${TOUCH_H}`,
    slot: tm.slot,
    ti: tm.ti,
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
  // Ogony poza siatką ekstrapolowane w skali normalnej; α ACI ≤ 0 → przedział nieskończony (zawsze pokrywa)
  const inRange = (lo: number, hi: number) => (y >= quantileAtExt(f.taus, f.q, lo) && y <= quantileAtExt(f.taus, f.q, hi) ? 1 : 0);
  return {
    k: 'r',
    id: f.id,
    t: now,
    c0,
    c1,
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
    hi,
    lo,
    yv: { pdh: hi >= f.lv.pdh ? 1 : 0, pdl: lo <= f.lv.pdl ? 1 : 0, deq: (deqBelow ? lo <= f.lv.deq : hi >= f.lv.deq) ? 1 : 0 },
  };
}

/**
 * Próg „blisko progu” rynku (względny, 5 bp) — tam rozbieżność mark (w oknie z opisu rynku) vs zamknięcie świecy transakcji
 * może zmienić wynik; zakres świecy 1m to zwykle 2–10 bp, więc pasmo jest celowo ostrożne.
 */
export const MKT_NEAR = 0.0005;

/**
 * Prognoza „model vs rynek”: p = P(S_termin ≥ K) z modelu od chwili wydania (horyzont dokładny co do sekundy,
 * 4000 ścieżek, wspólny silnik ze stroną) obok notowania rynku. Termin nie później niż początek horyzontu → null.
 */
export function makeMktForecast(
  model: VolModel,
  tm: ForecastTimes,
  px0: number,
  snap: MarketSnap,
  ens: EnsWeights = ENS_PRIOR,
  rec: EnsWeights = REC_PRIOR
): MktForecast | null {
  if (snap.expiry <= tm.t || !(px0 > 0) || !(snap.K > 0)) return null;
  const hInfo = (snap.expiry - tm.ti) / MIN;
  const [p] = outcomeProbabilities([{ kind: 'above', K: snap.K, horizonMin: hInfo }], px0, {
    stepSigmas: (h) => horizonSigmas(model, tm.ti, h),
    residuals: model.residuals,
    seed: seedFrom(tm.slot, snap.outcome),
    paths: 4000,
    innovSum: (h) => stepFor(h) / 5,
  });
  if (p === null || !Number.isFinite(p)) return null;
  const q = snap.quote;
  return {
    k: 'f',
    id: `${tm.slot}-mkt${snap.outcome}`,
    slot: tm.slot,
    ti: tm.ti,
    t: tm.t,
    kind: 'mkt',
    h: Math.round((snap.expiry - tm.t) / MIN),
    outcome: snap.outcome,
    K: snap.K,
    expiry: snap.expiry,
    src: snap.src,
    px0,
    bid: q ? q.bid : null,
    ask: q ? q.ask : null,
    depthBid: q ? r6(q.depthBid) : null,
    depthAsk: q ? r6(q.depthAsk) : null,
    liquid: !!q?.liquid,
    p: r4(p),
    pe: q && q.bid !== null && q.ask !== null ? r4(poolProb(ens, r4(p), (q.bid + q.ask) / 2)) : null,
    ens,
    pr: q && q.bid !== null && q.ask !== null ? r4(poolProb(rec, r4(p), (q.bid + q.ask) / 2)) : null,
    rec,
    model: MODEL_VERSION,
  };
}

/**
 * Pary do dopasowania wag ensemble: pytania z notowaniem o wąskim spreadzie (≤ 5 pp), rozstrzygnięte z dala od progu
 * przed chwilą `before` (tylko przeszłość względem wydania — bez zaglądania w przyszłość). Kolejność deterministyczna
 * (czas rozstrzygnięcia, id) — weryfikator odtwarza dopasowanie bit w bit.
 */
export function ensPairs(fs: Iterable<unknown>, res: ReadonlyMap<string, unknown>, before: number): EnsPair[] {
  const out: (EnsPair & { id: string })[] = [];
  for (const x of fs) {
    const f = x as MktForecast;
    if (f.kind !== 'mkt' || !tightQuote(f)) continue;
    const r = res.get(f.id) as MktResolution | undefined;
    if (!r || r.near !== 0 || !(r.t < before) || (r.y !== 0 && r.y !== 1)) continue;
    out.push({ pm: f.p, pk: (f.bid! + f.ask!) / 2, y: r.y, t: r.t, id: f.id });
  }
  out.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out.map(({ id: _id, ...p }) => p);
}

/** Rozstrzygnięcie: zamknięcie świecy 1m kończącej się w terminie (t + h) ≥ K; blisko progu oznaczone. */
export function resolveMkt(f: MktForecast, c1m: RangeBar[], now: number): MktResolution | null {
  const c1 = closeAt(c1m, f.t + f.h * MIN);
  if (c1 === null) return null;
  return { k: 'r', id: f.id, t: now, c1, y: c1 >= f.K ? 1 : 0, near: Math.abs(c1 - f.K) <= MKT_NEAR * f.K ? 1 : 0 };
}

export const CAT_H = 60;

export interface CatModel {
  model: SchrodiModel;
  /** SHA-256 kanonicznego JSON modelu */
  mh: string;
  /** Model dotknięć i jego hash; brak pliku → kot bez szans dotknięcia */
  touch?: { model: TouchModel; th: string } | null;
}

const sha = (o: unknown) => createHash('sha256').update(canonicalJson(o)).digest('hex');

/** Model kota z pliku strony; brak albo uszkodzony plik → null (dziennik wydaje resztę prognoz bez kota). */
export function loadCatModel(
  file: string | URL = new URL('../../public/schrodi/model-v1.json', import.meta.url),
  touchFile: string | URL = new URL('../../public/schrodi/touch-v1.json', import.meta.url)
): CatModel | null {
  try {
    const model = JSON.parse(readFileSync(file, 'utf8')) as SchrodiModel;
    if (!model?.dir || !model?.big || !Array.isArray(model.features)) return null;
    let touch: CatModel['touch'] = null;
    try {
      const tm = JSON.parse(readFileSync(touchFile, 'utf8')) as TouchModel;
      if (Array.isArray(tm?.gb) && Array.isArray(tm.features)) touch = { model: tm, th: sha(tm) };
    } catch {
      // bez modelu dotknięć kot wydaje tylko kierunek i duży ruch
    }
    return { model, mh: sha(model), touch };
  } catch {
    return null;
  }
}

/** Zdarzenia modelu z kalendarza desku (FOMC bez protokołów, CPI, NFP) */
export const CAT_EVENTS = modelEvents(MACRO_EVENTS);

/** Wektor cech do zapisu: 6 miejsc, braki i nieskończoności → null. */
export const catX = (x: FeatureVec): (number | null)[] => FEATURES.map((f) => (Number.isFinite(x[f]) ? r6(x[f]) : null));

const catVec = (x: readonly (number | null)[]) => Object.fromEntries(FEATURES.map((f, i) => [f, x[i] ?? Number.NaN])) as FeatureVec;

/** p z zapisanego wektora cech (null → NaN, jak brak przy uczeniu) */
export function catProbs(m: SchrodiModel, x: readonly (number | null)[]): { pUp: number; pBig: number } {
  const v = catVec(x);
  return { pUp: r4(scoreHead(m.dir, m.features, v).p), pBig: r4(scoreHead(m.big, m.features, v).p) };
}

const LEVEL_KEYS: (keyof Levels)[] = ['pdh', 'pdl', 'poc', 'vah', 'val', 'vwap'];

/**
 * Szanse dotknięcia i stożek z zapisanych wartości (cechy, próg = mediana zakresu godziny, cena `px0`, ceny poziomów
 * z 2 miejscami) — każdy przeliczy je z rekordu i publicznego modelu dotknięć.
 */
export function catTouch(
  tm: TouchModel,
  x: readonly (number | null)[],
  thr: number,
  px0: number,
  levels: Partial<Levels> | null
): { tl: NonNullable<CatForecast['tl']>; cone: ConeStep[] } {
  const v = catVec(x);
  const tl: NonNullable<CatForecast['tl']> = [];
  for (const k of LEVEL_KEYS) {
    const L = levels?.[k];
    if (L === undefined || !Number.isFinite(L) || !(L > 0)) continue;
    const px = r2(L);
    const d = Math.log(px / px0) * 1e4;
    if (!(Math.abs(d) > 0) || Math.abs(d) > TOUCH_MAX_R * thr) continue;
    const p = touchProb(tm, v, thr, d);
    if (Number.isFinite(p)) tl.push({ k, px, p: r4(p) });
  }
  return { tl, cone: touchCone(tm, v, thr) };
}

/** Świece `candleSnapshot` z wolumenem (dla cech kota) */
export function parseBars(raw: unknown): Bar[] {
  if (!Array.isArray(raw)) return [];
  const out: Bar[] = [];
  for (const c of raw as Record<string, unknown>[]) {
    const n = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v)));
    const b = { t: n(c?.t), o: n(c?.o), h: n(c?.h), l: n(c?.l), c: n(c?.c), v: n(c?.v) };
    if ([b.t, b.o, b.h, b.l, b.c, b.v].every(Number.isFinite)) out.push(b);
  }
  return out;
}

/** Prognoza kota w slocie: cechy na świecy 5m [slot − 5 min, slot); brak danych albo progu → null. */
export function makeCatForecast(cm: CatModel, inp: SchrodiInput, tm: ForecastTimes): CatForecast | null {
  const bar = tm.slot - 5 * MIN;
  const fr = catFeatures(inp, bar);
  if (!fr || !Number.isFinite(fr.d30) || !Number.isFinite(fr.med1h) || !(fr.price > 0)) return null;
  const x = catX(fr.x);
  return {
    k: 'f',
    id: `${tm.slot}-cat`,
    slot: tm.slot,
    ti: tm.ti,
    t: tm.t,
    kind: 'cat',
    h: CAT_H,
    bar,
    px0: fr.price,
    x,
    ...catProbs(cm.model, x),
    thr: r4(fr.med1h),
    model: cm.model.version,
    mh: cm.mh,
    ...(cm.touch ? { ...catTouch(cm.touch.model, x, r4(fr.med1h), fr.price, fr.levels), tmodel: cm.touch.model.version, th: cm.touch.th } : {}),
  };
}

export function resolveCat(f: CatForecast, c1m: RangeBar[], now: number): CatResolution | null {
  const c0 = closeAt(c1m, f.t);
  const c1 = closeAt(c1m, f.t + f.h * MIN);
  const win = c1m.filter((b) => b.time >= f.t && b.time + MIN <= f.t + f.h * MIN);
  if (c0 === null || c1 === null || win.length < f.h) return null;
  const hi = Math.max(...win.map((b) => b.high));
  const lo = Math.min(...win.map((b) => b.low));
  return { k: 'r', id: f.id, t: now, c0, c1, hi, lo, yDir: c1 > c0 ? 1 : 0, yBig: Math.log(hi / lo) * 1e4 > f.thr ? 1 : 0 };
}

/** Notowanie z wąskim spreadem (≤ 5 pp), także płytkie — poziom oceny „wąski spread” */
export const tightQuote = (f: MktForecast) => f.bid !== null && f.ask !== null && f.ask - f.bid <= 0.05 + 1e-12;
/** Notowanie płynne (spread i głębokość) — poziom oceny ścisły */
export const liquidQuote = (f: MktForecast) => f.liquid && f.bid !== null && f.ask !== null;

/**
 * Wyniki „model vs rynek” na tych samych pytaniach: notowania spełniające `accept` i rozstrzygnięcia z dala od progu.
 * Brier i log score obu (log: −ln p(wyniku), p ograniczone do [0,001; 0,999]); różnica Brier (model − rynek) z bootstrapem
 * percentylowym 90% parowanym (2000 losowań, stałe ziarno). Ujemna różnica = model trafniejszy (Brier) niż rynek.
 */
export function mktScores(pairs: { f: MktForecast; r: MktResolution }[], accept: (f: MktForecast) => boolean = liquidQuote): MktScores {
  const near = pairs.filter((x) => x.r.near === 1).length;
  const illiquid = pairs.filter((x) => x.r.near === 0 && !accept(x.f)).length;
  const ok = pairs.filter((x) => x.r.near === 0 && accept(x.f));
  const n = ok.length;
  const ens = ensScores(ok);
  if (n === 0) return { n: 0, near, illiquid, brierModel: null, brierMarket: null, logModel: null, logMarket: null, diff: null, ...ens };
  const clamp = (p: number) => Math.min(0.999, Math.max(0.001, p));
  const dm: number[] = [];
  let bm = 0;
  let bk = 0;
  let lm = 0;
  let lk = 0;
  for (const { f, r } of ok) {
    const mid = (f.bid! + f.ask!) / 2;
    const a = (f.p - r.y) ** 2;
    const b = (mid - r.y) ** 2;
    bm += a;
    bk += b;
    dm.push(a - b);
    lm += -Math.log(r.y ? clamp(f.p) : 1 - clamp(f.p));
    lk += -Math.log(r.y ? clamp(mid) : 1 - clamp(mid));
  }
  const d = dm.reduce((s, x) => s + x, 0) / n;
  const u = mulberry32(seedFrom(n, 7));
  const reps = 2000;
  const means = new Float64Array(reps);
  for (let k = 0; k < reps; k++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += dm[Math.floor(u() * n)];
    means[k] = s / n;
  }
  means.sort();
  return {
    n,
    near,
    illiquid,
    brierModel: r6(bm / n),
    brierMarket: r6(bk / n),
    logModel: r4(lm / n),
    logMarket: r4(lk / n),
    diff: { d, lo: means[Math.floor(0.05 * (reps - 1))], hi: means[Math.ceil(0.95 * (reps - 1))] },
    ...ens,
  };
}

/** Różnica średnich z bootstrapem percentylowym 90% (2000 losowań, stałe ziarno). */
function bootDiff(dm: number[], seed: number): { d: number; lo: number; hi: number } {
  const n = dm.length;
  const d = dm.reduce((s, x) => s + x, 0) / n;
  const u = mulberry32(seedFrom(n, seed));
  const reps = 2000;
  const means = new Float64Array(reps);
  for (let k = 0; k < reps; k++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += dm[Math.floor(u() * n)];
    means[k] = s / n;
  }
  means.sort();
  return { d, lo: means[Math.floor(0.05 * (reps - 1))], hi: means[Math.ceil(0.95 * (reps - 1))] };
}

type EnsScoreFields = Pick<MktScores, 'nEns' | 'brierEns' | 'logEns' | 'diffEns' | 'brierModelE' | 'brierMarketE' | 'brierRec' | 'diffAdd'>;

/**
 * Wyniki ensemble na pytaniach z zapisanym p_e — model, rynek i rynek skalibrowany na tym samym podzbiorze (porównanie
 * jak z jak); różnice parowane: ensemble − rynek i ensemble − rynek skalibrowany (wartość dodana modelu).
 */
function ensScores(ok: { f: MktForecast; r: MktResolution }[]): EnsScoreFields {
  const withE = ok.filter((x) => typeof x.f.pe === 'number');
  const nEns = withE.length;
  if (nEns === 0) return { nEns: 0, brierEns: null, logEns: null, diffEns: null, brierModelE: null, brierMarketE: null, brierRec: null, diffAdd: null };
  const clamp = (p: number) => Math.min(0.999, Math.max(0.001, p));
  let be = 0;
  let le = 0;
  let bm = 0;
  let bk = 0;
  const dm: number[] = [];
  const withR = withE.filter((x) => typeof x.f.pr === 'number');
  for (const { f, r } of withE) {
    const pe = f.pe as number;
    const mid = (f.bid! + f.ask!) / 2;
    const a = (pe - r.y) ** 2;
    be += a;
    bm += (f.p - r.y) ** 2;
    bk += (mid - r.y) ** 2;
    le += -Math.log(r.y ? clamp(pe) : 1 - clamp(pe));
    dm.push(a - (mid - r.y) ** 2);
  }
  const dAdd = withR.map(({ f, r }) => ((f.pe as number) - r.y) ** 2 - ((f.pr as number) - r.y) ** 2);
  const br = withR.reduce((s, { f, r }) => s + ((f.pr as number) - r.y) ** 2, 0);
  return {
    nEns,
    brierEns: r6(be / nEns),
    logEns: r4(le / nEns),
    diffEns: bootDiff(dm, 11),
    brierModelE: r6(bm / nEns),
    brierMarketE: r6(bk / nEns),
    brierRec: withR.length ? r6(br / withR.length) : null,
    diffAdd: withR.length ? bootDiff(dAdd, 13) : null,
  };
}

/** Stan ACI po kolejnym rozstrzygnięciu przedziału 90% (chybienie obniża α → szerszy kolejny przedział). */
export const nextAci = (alpha: number, miss: boolean) => aciStep(alpha, ACI_ALPHA, miss, ACI_GAMMA);

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Wyniki prognoz zwrotu jednego horyzontu. Prognozy co 15 min z horyzontem h nakładają się (h/15-krotnie), więc ich
 * chybienia są skorelowane — odsetek pokrycia liczony jest z całości (opis), a test Kupca na podpróbie rozłącznej
 * (sloty będące wielokrotnością h), z efektywnym n.
 */
export function retScores(pairs: { f: RetForecast; r: RetResolution }[]): RetScores {
  const n = pairs.length;
  const crps = mean(pairs.map((p) => p.r.crps));
  const crpsB = mean(pairs.map((p) => p.r.crpsB));
  const hist = Array<number>(10).fill(0);
  for (const p of pairs) hist[Math.min(9, Math.floor(p.r.pit * 10))]++;
  const cov = (hit: (r: RetResolution) => number, nominalMiss: number) => {
    if (!n) return null;
    const indep = pairs.filter((p) => p.f.slot % (p.f.h * MIN) === 0);
    const missAll = pairs.filter((p) => !hit(p.r)).length;
    const missInd = indep.filter((p) => !hit(p.r)).length;
    return { rate: 1 - missAll / n, n, nEff: indep.length, kupiecP: indep.length ? kupiec(indep.length, missInd, nominalMiss) : null };
  };
  return {
    n,
    crps,
    crpsBench: crpsB,
    crpss: crps !== null && crpsB !== null && crpsB > 0 ? 1 - crps / crpsB : null,
    pitHist: hist,
    cov90: cov((r) => r.in90, 0.1),
    cov60: cov((r) => r.in60, 0.4),
    covAci: cov((r) => r.inAci, 0.1),
  };
}

/** Pary (p, wynik) z prognoz dotknięć — bez poziomów przekroczonych przy wydaniu (p = null). */
const touchPairsOf = (pairs: { f: TouchForecast; r: TouchResolution }[]) =>
  pairs.flatMap((p) => LEVELS.filter((l) => p.f.p[l] !== null && p.f.p[l] !== undefined).map((l) => ({ p: p.f.p[l] as number, y: p.r.yv[l] })));

/**
 * Wyniki prognoz dotknięć + mapa kalibracji izotonicznej. Odniesienie BSS: klimatologia osobno dla każdego poziomu
 * (PDH, PDL i D-EQ mają różne częstości bazowe — wspólna stała dawałaby „umiejętność” modelowi bez wiedzy).
 */
export function touchScores(pairs: { f: TouchForecast; r: TouchResolution }[]): TouchScores {
  const pp = touchPairsOf(pairs);
  const bs = brier(pp);
  const levelBase = Object.fromEntries(
    LEVELS.map((l) => {
      const ys = pairs.filter((p) => p.f.p[l] !== null && p.f.p[l] !== undefined).map((p) => p.r.yv[l]);
      return [l, mean(ys)];
    })
  ) as Record<TouchLevel, number | null>;
  const basePairs = pairs.flatMap((p) => LEVELS.filter((l) => p.f.p[l] !== null && p.f.p[l] !== undefined && levelBase[l] !== null).map((l) => ({ p: levelBase[l] as number, y: p.r.yv[l] })));
  const bsBase = brier(basePairs);
  // Izotonicznie na grupach równych p (wagi = liczności) — ten sam p nie dostaje dwóch wartości
  const groups: { p: number; sum: number; n: number }[] = [];
  for (const x of [...pp].sort((a, b) => a.p - b.p)) {
    const g = groups[groups.length - 1];
    if (g && g.p === x.p) {
      g.sum += x.y;
      g.n++;
    } else groups.push({ p: x.p, sum: x.y, n: 1 });
  }
  const fit = isotonic(
    groups.map((g) => g.sum / g.n),
    groups.map((g) => g.n)
  );
  const steps: [number, number][] = [];
  groups.forEach((g, i) => {
    const last = steps[steps.length - 1];
    if (!last || last[1] !== r4(fit[i])) steps.push([r4(g.p), r4(fit[i])]);
  });
  // Najwyżej 200 punktów, równomiernie (z zachowaniem ostatniego — wysokie p nie mogą wypaść)
  const stride = Math.ceil(steps.length / 200);
  const map = steps.filter((_, i) => i % stride === 0 || i === steps.length - 1);
  return {
    n: pairs.length,
    pairs: pp.length,
    brier: bs,
    brierBase: bsBase,
    bss: bs !== null && bsBase !== null && bsBase > 0 ? 1 - bs / bsBase : null,
    reliability: reliability(pp, 10).map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, meanP: b.meanP, freq: b.freq })),
    calibration: map,
  };
}

/** AUC (Mann–Whitney, remisy ze średnią rangą); brak jednej z klas → null. */
export function auc(pp: { p: number; y: 0 | 1 }[]): number | null {
  const pos = pp.filter((x) => x.y === 1).length;
  const neg = pp.length - pos;
  if (!pos || !neg) return null;
  const s = [...pp].sort((a, b) => a.p - b.p);
  let rankSum = 0;
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j < s.length && s[j].p === s[i].p) j++;
    for (let k = i; k < j; k++) if (s[k].y === 1) rankSum += (i + j + 1) / 2;
    i = j;
  }
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

/** Brier, Brier klimatologii (częstość z tego samego okna), BSS, AUC i trafność progu 50%. */
function probScores(pp: { p: number; y: 0 | 1 }[]) {
  const bs = brier(pp);
  const base = mean(pp.map((x) => x.y));
  const bsBase = base === null ? null : brier(pp.map((x) => ({ p: base, y: x.y })));
  return {
    brier: bs,
    brierBase: bsBase,
    bss: bs !== null && bsBase !== null && bsBase > 0 ? 1 - bs / bsBase : null,
    auc: auc(pp),
    hit: pp.length ? pp.filter((x) => (x.p > 0.5 ? 1 : 0) === x.y).length / pp.length : null,
  };
}

/**
 * Wyniki kota. Prognozy co 15 min na 1 h nakładają się czterokrotnie, więc ich błędy są skorelowane — `nEff` to liczba
 * prognoz rozłącznych (sloty o pełnej godzinie). Kierunek dodatkowo w trzech stanach panelu (Long, Short, nie wiem).
 */
export function catScores(pairs: { f: CatForecast; r: CatResolution }[]): CatScores {
  const side = (s: 'long' | 'short') => {
    const xs = pairs.filter((p) => stanceOf(p.f.pUp) === s);
    return { n: xs.length, hit: xs.length ? xs.filter((p) => p.r.yDir === (s === 'long' ? 1 : 0)).length / xs.length : null };
  };
  const big = pairs.map((p) => ({ p: p.f.pBig, y: p.r.yBig }));
  return {
    n: pairs.length,
    nEff: pairs.filter((p) => p.f.slot % HOUR === 0).length,
    dir: {
      ...probScores(pairs.map((p) => ({ p: p.f.pUp, y: p.r.yDir }))),
      long: side('long'),
      short: side('short'),
      unsure: pairs.filter((p) => stanceOf(p.f.pUp) === 'unsure').length,
    },
    big: { ...probScores(big), reliability: reliability(big, 10).map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, meanP: b.meanP, freq: b.freq })) },
    touch: catTouchScores(pairs),
  };
}

/** Dotknięcie poziomu w oknie: nad ceną `px0` max okna ≥ poziom, pod ceną min okna ≤ poziom */
export const touchedLevel = (px: number, px0: number, r: Pick<CatResolution, 'hi' | 'lo'>): 0 | 1 => (px > px0 ? (r.hi >= px ? 1 : 0) : r.lo <= px ? 1 : 0);

/**
 * Szanse dotknięcia kota: Brier wobec ruchu Browna (P = 2(1 − Φ(|d| / σ)), σ godziny z realizowanej zmienności doby,
 * jak w teście), niezawodność, pokrycie stożka (odsetek godzin, w których granica została dotknięta, wobec q).
 */
export function catTouchScores(pairs: { f: CatForecast; r: CatResolution }[]): CatTouchScores {
  const rvIdx = FEATURES.indexOf('rv_1d');
  const pp: { p: number; y: 0 | 1 }[] = [];
  const bm: { p: number; y: 0 | 1 }[] = [];
  const withTouch = pairs.filter((x) => Array.isArray(x.f.tl));
  for (const { f, r } of withTouch) {
    const rv = f.x[rvIdx];
    for (const l of f.tl!) {
      const y = touchedLevel(l.px, f.px0, r);
      pp.push({ p: l.p, y });
      if (rv !== null && rv > 0) {
        const p = 2 * (1 - normCdf(Math.abs(Math.log(l.px / f.px0) * 1e4) / (rv / Math.sqrt(24))));
        bm.push({ p: Math.min(1 - 1e-4, Math.max(1e-4, p)), y });
      }
    }
  }
  const bs = brier(pp);
  const bsBm = bm.length === pp.length ? brier(bm) : null;
  const cone = CONE_Q.map((q, i) => {
    let n = 0;
    let up = 0;
    let dn = 0;
    for (const { f, r } of withTouch) {
      const s = f.cone?.[i];
      if (!s || s.up === null || s.dn === null) continue;
      n++;
      up += r.hi >= f.px0 * Math.exp(s.up / 1e4) ? 1 : 0;
      dn += r.lo <= f.px0 * Math.exp(-s.dn / 1e4) ? 1 : 0;
    }
    return { q, n, up: n ? up / n : null, dn: n ? dn / n : null };
  });
  return {
    n: pp.length,
    hours: withTouch.filter((x) => x.f.slot % HOUR === 0).length,
    brier: bs,
    brierBm: bsBm,
    bssBm: bs !== null && bsBm !== null && bsBm > 0 ? 1 - bs / bsBm : null,
    reliability: reliability(pp, 10).map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, meanP: b.meanP, freq: b.freq })),
    cone,
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
  skips?: SkipRecord[];
  /** Liczba pokwitowań OpenTimestamps głowy łańcucha z ostatnich 24 h */
  slotStamps?: number;
  /** Czas prerejestracji planu oceny A/B w dzienniku (null / brak = jeszcze nie) */
  abRegisteredAt?: number | null;
  /** Rozstrzygnięte pełne godziny kota z całego dziennika i rejestracja planu oceny zaufania (null / brak = jeszcze nie) */
  catHours?: TrustHour[];
  trustPlan?: CatTrust['plan'];
}

/** Podsumowanie (30 dni) dla strony: najnowsze prognozy, wyniki, kalibracja Venna–Abersa najnowszych prawdopodobieństw. */
export function buildSummary(s: SummaryInput): DeskLedgerSummary {
  const from = s.now - 30 * DAY;
  const fs = [...s.forecasts.values()].filter((f) => f.t >= from).sort((a, b) => a.t - b.t);
  const retPairs = new Map<number, { f: RetForecast; r: RetResolution }[]>();
  const touchPairs: { f: TouchForecast; r: TouchResolution }[] = [];
  const mktPairs: { f: MktForecast; r: MktResolution }[] = [];
  const catPairs: { f: CatForecast; r: CatResolution }[] = [];
  for (const f of fs) {
    const r = s.resolutions.get(f.id);
    if (!r) continue;
    if (f.kind === 'ret' && !f.variant && 'crps' in r) retPairs.set(f.h, [...(retPairs.get(f.h) ?? []), { f, r }]);
    if (f.kind === 'touch' && 'yv' in r) touchPairs.push({ f, r });
    if (f.kind === 'mkt' && 'near' in r) mktPairs.push({ f, r });
    if (f.kind === 'cat' && 'yBig' in r) catPairs.push({ f, r });
  }
  const latestMkt = [...fs].reverse().find((f): f is MktForecast => f.kind === 'mkt');
  const latestRet = RET_HORIZONS.map((h) => [...fs].reverse().find((f) => f.kind === 'ret' && !f.variant && f.h === h) as RetForecast | undefined).filter(
    (f): f is RetForecast => !!f
  );
  const latestTouch = [...fs].reverse().find((f) => f.kind === 'touch') as TouchForecast | undefined;
  const cal = touchPairsOf(touchPairs);
  // Liczniki wersji głównej — wariant B (A/B) ma własną sekcję
  const pending = fs.filter((f) => !(f.kind === 'ret' && f.variant) && !s.resolutions.has(f.id)).length;
  const voided = fs.filter((f) => {
    if (f.kind === 'ret' && f.variant) return false;
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
        // Przedział ACI tej prognozy — z α zapisanym przy wydaniu (ten, który będzie oceniany)
        const a = f.aci;
        const lo = quantileAtExt(f.taus, f.q, a / 2);
        const hi = quantileAtExt(f.taus, f.q, 1 - a / 2);
        return {
          t: f.t,
          h: f.h,
          px0: f.px0,
          taus: f.taus,
          q: f.q,
          bq: f.bq,
          aci: { alpha: r4(a), alphaNow: r4(s.aci[f.h] ?? ACI_ALPHA), lo: Number.isFinite(lo) ? r6(lo) : null, hi: Number.isFinite(hi) ? r6(hi) : null },
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
    slotStamps: s.slotStamps ?? 0,
    participation: participation(fs, s.skips ?? [], from),
    market: {
      scores: mktScores(mktPairs, liquidQuote),
      tight: mktScores(mktPairs, tightQuote),
      // Wagi ensemble z chwili podsumowania (do panelu na żywo) — te same zasady co przy wydaniu
      ensemble: (() => {
        const pairs = ensPairs(s.forecasts.values(), s.resolutions, s.now);
        const rec = fitEnsemble(pairs, s.now, { mode: 'market' });
        return { ...fitEnsemble(pairs, s.now), at: s.now, rec: { a: rec.a, bk: rec.bk } };
      })(),
      latest: latestMkt
        ? { t: latestMkt.t, expiry: latestMkt.expiry, K: latestMkt.K, p: latestMkt.p, bid: latestMkt.bid, ask: latestMkt.ask, liquid: latestMkt.liquid, pe: latestMkt.pe ?? null }
        : null,
    },
    ab: abSection(fs, s.resolutions, s.now, s.abRegisteredAt ?? null),
    cat: { ...catSection(fs, catPairs), trust: catTrust(s.catHours ?? [], s.trustPlan ?? null) },
    method: 'hq-ledger-v1',
  };
}

/**
 * A/B wersji modelu (1 h): pary A i B z tego samego slotu, oba rozstrzygnięte (bez unieważnionych); okres oceny w toku
 * i ostatni zakończony (bloki 14 dni od AB_EPOCH — patrz abTest.ts); najnowszy reżim i skala B.
 */
function abSection(fs: Forecast[], res: Map<string, Resolution>, now: number, registeredAt: number | null): NonNullable<DeskLedgerSummary['ab']> {
  const rows: AbRow[] = [];
  let latest: RetForecast | null = null;
  const byId = new Map(fs.map((f) => [f.id, f]));
  for (const f of fs) {
    if (f.kind !== 'ret' || f.variant !== 'B' || f.h !== 60) continue;
    latest = f;
    const a = byId.get(f.id.slice(0, -1));
    const ra = a ? res.get(a.id) : undefined;
    const rb = res.get(f.id);
    if (ra && rb && 'crps' in ra && 'crps' in rb) rows.push({ slot: f.slot, crpsA: ra.crps, crpsB: rb.crps });
  }
  return {
    h: 60,
    model: MODEL_B,
    blockDays: AB_BLOCK_DAYS,
    registeredAt,
    ...abBlocks(rows, now),
    latest: latest && latest.regime && latest.scale !== undefined ? { t: latest.t, scale: latest.scale, regime: latest.regime } : null,
  };
}

/** Kot: najnowsza prognoza, wyniki i udział — sloty z prognozami desku od pierwszej prognozy kota vs prognozy kota. */
function catSection(fs: Forecast[], pairs: { f: CatForecast; r: CatResolution }[]): NonNullable<DeskLedgerSummary['cat']> {
  const cats = fs.filter((f): f is CatForecast => f.kind === 'cat');
  const since = cats.length ? cats[0].t : null;
  const latest = cats[cats.length - 1];
  return {
    model: latest?.model ?? null,
    since,
    issued: cats.length,
    slots: since === null ? 0 : new Set(fs.filter((f) => f.kind === 'ret' && f.t >= since).map((f) => f.slot)).size,
    latest: latest ? { t: latest.t, px0: latest.px0, pUp: latest.pUp, pBig: latest.pBig, thr: latest.thr } : null,
    scores: catScores(pairs),
  };
}

/** Sloty wydane vs pominięte (jawne rekordy `skip`, także zakresowe) w oknie — braki widoczne, nie ukryte. */
function participation(fs: Forecast[], skips: SkipRecord[], from: number): DeskLedgerSummary['participation'] {
  const issued = new Set(fs.filter((f) => f.kind === 'ret').map((f) => f.slot));
  const recs = skips.filter((k) => (k.until ?? k.slot) >= from && !issued.has(k.slot)).sort((a, b) => a.slot - b.slot);
  // Pierwszy pełny slot w oknie (jak dla rekordów pojedynczych: slot ≥ from)
  const first = Math.ceil(from / SLOT) * SLOT;
  const count = recs.reduce((n, k) => n + (k.until !== undefined ? Math.floor((k.until - Math.max(k.slot, first)) / SLOT) + 1 : 1), 0);
  return {
    issued: issued.size,
    skipped: count,
    gaps: recs.slice(-10).map((k) => (k.until !== undefined ? { slot: k.slot, until: k.until, reason: k.reason } : { slot: k.slot, reason: k.reason })),
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
  /** Ostatnia próba budowy modelu — po nieudanej 10 min przerwy (świece 1h+5m ważą ~210 z budżetu skanu) */
  private modelTriedAt = Number.NEGATIVE_INFINITY;
  levels: { pdh: number; pdl: number; day: number } | null = null;
  levelsAt = 0;
  /** Reżim zmienności (BOCPD na świecach 5m z 3 dni) — liczony raz na slot, przed wydaniem prognoz slotu */
  regime: Regime | null = null;
  regimeAt = 0;
  private regimeSlot = Number.NEGATIVE_INFINITY;

  /** Model kota (null = brak pliku — dziennik bez kota) i dane wejściowe policzone w slocie */
  readonly cat: CatModel | null;
  catInput: { slot: number; inp: SchrodiInput } | null = null;
  private catSlot = Number.NEGATIVE_INFINITY;

  constructor(d: ForecasterDeps, cat: CatModel | null = loadCatModel()) {
    this.d = d;
    this.cat = cat;
  }

  private async candles(interval: string, startTime: number, n: number): Promise<RangeBar[]> {
    return parseCandles(await this.d.rest.info({ type: 'candleSnapshot', req: { coin: this.d.coin, interval, startTime } }, candleWeight(n)));
  }

  /** Model zmienności i σ benchmarku — co godzinę (≈ 210 wag). */
  async refreshModel(now: number): Promise<void> {
    if (this.model && now - this.modelAt < HOUR) return;
    if (now - this.modelTriedAt < 10 * MIN) return;
    this.modelTriedAt = now;
    const [h, f] = [await this.candles('1h', now - 5000 * HOUR, 5000), await this.candles('5m', now - 5000 * 5 * MIN, 5000)];
    const m = buildVolModel(h, f, now);
    if (m) {
      this.model = m;
      this.sigma1h = sigma1hFromHourly(h.filter((b) => b.time + HOUR <= now));
      this.modelAt = now;
    }
  }

  /** PDH/PDL z poprzedniej dobowej świecy UTC — co 10 min i od razu po zmianie doby. */
  async refreshLevels(now: number): Promise<void> {
    const today = Math.floor(now / DAY) * DAY;
    if (this.levels && now - this.levelsAt < 10 * MIN && this.levels.day === today - DAY) return;
    const d = await this.candles('1d', now - 3 * DAY, 3);
    const prev = d.find((b) => b.time === today - DAY);
    if (prev && prev.high > prev.low) {
      this.levels = { pdh: prev.high, pdl: prev.low, day: prev.time };
      this.levelsAt = now;
    }
  }

  /**
   * Reżim zmienności do wariantu B — raz na slot 15 min (świece 5m z 3 dni, ~35 wag), odsezonowany profilem bieżącego
   * modelu A. Nieudana próba nie jest ponawiana w tym slocie: dziennik wydaje B tylko z reżimem policzonym w slocie wydania.
   */
  async refreshRegime(now: number): Promise<void> {
    const slot = slotOf(now);
    if (this.regimeSlot === slot || !this.model) return;
    this.regimeSlot = slot;
    const r = regimeFrom5m(await this.candles('5m', now - 866 * 5 * MIN, 866), this.model.profile.factors, now);
    if (r) {
      this.regime = r;
      this.regimeAt = now;
    }
  }

  /**
   * Dane kota — raz na slot (≈ 180 wag): 1m od początku poprzedniej doby UTC (profil i VWAP), 5m z 7 dni (wolumen),
   * 1h z 30 dni (próg dużego ruchu), 1d z 35 dni (mediana zakresu dnia). Nieudana próba nie jest ponawiana w tym slocie.
   */
  async refreshCat(now: number): Promise<void> {
    const slot = slotOf(now);
    if (!this.cat || this.catSlot === slot) return;
    this.catSlot = slot;
    const bars = async (interval: string, startTime: number, n: number) =>
      parseBars(await this.d.rest.info({ type: 'candleSnapshot', req: { coin: this.d.coin, interval, startTime } }, candleWeight(n)));
    const from1m = Math.floor(now / DAY) * DAY - DAY;
    const m1 = await bars('1m', from1m, Math.ceil((now - from1m) / MIN) + 1);
    const m5 = await bars('5m', now - 2110 * 5 * MIN, 2110);
    const h1 = await bars('1h', now - 725 * HOUR, 725);
    const d1 = await bars('1d', now - 35 * DAY, 35);
    this.catInput = { slot, inp: { m1, m5, h1, d1, events: CAT_EVENTS } };
  }

  /** Świece 1m od `from` (do rozstrzygania). */
  /** API zwraca najwyżej 5000 świec — po dłuższej przerwie starsze prognozy zostaną unieważnione (void) */
  minuteCandles(from: number, now: number): Promise<RangeBar[]> {
    const n = Math.min(5000, Math.ceil((now - from) / MIN) + 2);
    return this.candles('1m', Math.max(from - MIN, now - n * MIN), n);
  }
}
