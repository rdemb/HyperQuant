import { L2OrderbookLevel } from '../types/trading';
import { makeInnovation, mulberry32 } from './pathEngine';
import { tr } from '../i18n';

/**
 * Analizator planu transakcji (BTC-PERP, Hyperliquid) — czyste funkcje.
 * Ocenia plan tradera (wejście / stop / cel / horyzont); nie generuje sygnałów.
 *
 * Model ceny: log-cena z dryfem μ (domyślnie 0). Z modelem zmienności: σ kroków 5 min z sezonowego log-HAR
 * i innowacje z bootstrapu standaryzowanych reszt (FHS, grube ogony i skoki z danych); bez niego: stała σ i rozkład normalny.
 * Gdy wejście różni się od ceny rynku, ścieżka najpierw musi je dotknąć — wynik jest warunkowy na wypełnienie.
 * Źródła: Broadie, Glasserman, Kou (1997) „A continuity correction for discrete barrier options”;
 * Barone-Adesi, Giannopoulos, Vosper (1999) FHS; Corsi (2009) HAR; Parkinson (1980) jako zapas;
 * dokumentacja Hyperliquid (likwidacje, margines, opłaty).
 */

export type PlanDirection = 'LONG' | 'SHORT';

/** Opłata taker HL, tier 0 (perps 0.045%) — ZAŁOŻENIE konfigurowalne (wyższe tiery mają niższe opłaty). */
export const DEFAULT_TAKER_FEE = 0.00045;
/** Maks. dźwignia BTC na HL (tier 0–150M USDC notional, docs: trading/margin-tiers). */
export const BTC_MAX_LEVERAGE = 40;
/**
 * Wejście w granicy 1 bp od ceny rynku = zlecenie rynkowe (wypełnione od razu) — ta sama reguła w Monte Carlo i dzienniku.
 * Szersza odległość = zlecenie z limitem/stop: ścieżka musi najpierw dotknąć wejścia.
 */
export const MARKET_ENTRY_TOL = 1e-4;
/** Wersja modelu zapisywana w dzienniku trafności. */
export const PLAN_MODEL_VERSION = 'plan-fhs-har-v2';

export interface PlanBook {
  bids: L2OrderbookLevel[];
  asks: L2OrderbookLevel[];
}

export interface PlanInput {
  direction: PlanDirection;
  entry: number;
  stop: number;
  target: number;
  /** Nominał pozycji w USD */
  sizeUsd: number;
  horizonMin: number;
  leverage?: number;
  /** Odchylenie log-ceny na cały horyzont (np. z Parkinsona) */
  sigmaHorizon: number;
  /** Dryf log-ceny na horyzont (domyślnie 0 — model nie zakłada przewagi) */
  driftPerHorizon?: number;
  feeRateTaker?: number;
  book: PlanBook;
  /** Mnożnik wariancji dla zdarzeń makro w oknie (≥ 1) */
  eventMultiplier: number;
  /** Model zmienności: σ kroków (sezonowy HAR) i reszty FHS; brak = stała σ_h i rozkład normalny */
  vol?: { stepMin: number; stepSigmas: number[]; residuals: ArrayLike<number> | null };
  /** Bieżąca cena rynku — gdy różna od wejścia, plan zaczyna się od fazy wypełnienia (jak w dzienniku) */
  startPrice?: number;
}

/**
 * Wejście z modelem rynku — jedno źródło prawdy dla Analizatora i szybkiej karty: σ kroków i reszty FHS (gdy model gotowy)
 * oraz cena startowa (faza wypełnienia). Brak modelu lub ceny → pola pominięte (zapas: stała σ, natychmiastowe wejście).
 */
export function attachMarketModel(
  base: Omit<PlanInput, 'vol' | 'startPrice'>,
  market: { vol: PlanInput['vol'] | null; price: number }
): PlanInput {
  const out: PlanInput = { ...base };
  if (market.vol) out.vol = market.vol;
  if (Number.isFinite(market.price) && market.price > 0) out.startPrice = market.price;
  return out;
}

const sideOf = (d: PlanDirection) => (d === 'LONG' ? 1 : -1);
const isPos = (v: number) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Walidacja planu — błędy w języku interfejsu; pusta lista = plan poprawny. */
export function validatePlan(p: PlanInput, maxLeverage: number = BTC_MAX_LEVERAGE): string[] {
  const errors: string[] = [];
  if (!isPos(p.entry) || !isPos(p.stop) || !isPos(p.target)) {
    errors.push(tr('Podaj dodatnie liczby: wejście, stop i cel.', 'Enter positive numbers: entry, stop and target.'));
    return errors;
  }
  if (p.stop === p.entry) errors.push(tr('Stop równy wejściu — zerowa odległość, ryzyko nieokreślone.', 'Stop equals entry: zero distance, risk undefined.'));
  if (p.target === p.entry) errors.push(tr('Cel równy wejściu — zerowa odległość, brak zysku do oceny.', 'Target equals entry: zero distance, no profit to assess.'));
  if (p.direction === 'LONG') {
    if (p.stop > p.entry) errors.push(tr('Dla LONG stop musi być poniżej wejścia.', 'For a LONG the stop must be below entry.'));
    if (p.target < p.entry) errors.push(tr('Dla LONG cel musi być powyżej wejścia.', 'For a LONG the target must be above entry.'));
  } else {
    if (p.stop < p.entry) errors.push(tr('Dla SHORT stop musi być powyżej wejścia.', 'For a SHORT the stop must be above entry.'));
    if (p.target > p.entry) errors.push(tr('Dla SHORT cel musi być poniżej wejścia.', 'For a SHORT the target must be below entry.'));
  }
  if (!isPos(p.sizeUsd)) errors.push(tr('Wielkość pozycji musi być dodatnia.', 'Position size must be positive.'));
  if (!isPos(p.horizonMin)) errors.push(tr('Horyzont musi być dodatni.', 'Horizon must be positive.'));
  if (!isPos(p.sigmaHorizon)) errors.push(tr('Brak oszacowania zmienności (σ) — za mało świec.', 'No volatility estimate (σ), not enough candles.'));
  if (p.leverage !== undefined && (!Number.isFinite(p.leverage) || p.leverage < 1 || p.leverage > maxLeverage)) {
    errors.push(tr(`Dźwignia musi być w zakresie 1–${maxLeverage}× (limit BTC na Hyperliquid).`, `Leverage must be within 1–${maxLeverage}× (BTC limit on Hyperliquid).`));
  }
  return errors;
}

/** Odległości barier w log-cenie liczone „w kierunku zysku”: a = do stopu, b = do celu (obie > 0). */
function barrierDistances(direction: PlanDirection, entry: number, stop: number, target: number) {
  const s = sideOf(direction);
  return { a: s * Math.log(entry / stop), b: s * Math.log(target / entry), side: s };
}

/**
 * Formuła zamknięta: P(cel przed stopem) dla ruchu Browna z dryfem, bez limitu czasu.
 * W przestrzeni „zysku” X = side·ln(P/E): P(X dotknie +b przed −a) = (1 − e^{2μa/σ²}) / (e^{−2μb/σ²} − e^{2μa/σ²});
 * μ → 0 ⇒ a/(a+b). Dla shorta dryf zmienia znak.
 */
export function barrierHitProbability(p: {
  direction: PlanDirection;
  entry: number;
  stop: number;
  target: number;
  sigmaHorizon: number;
  driftPerHorizon?: number;
  eventMultiplier?: number;
}): { pTarget: number; pStop: number } {
  const { a, b, side } = barrierDistances(p.direction, p.entry, p.stop, p.target);
  const mu = side * (p.driftPerHorizon ?? 0);
  const s2 = p.sigmaHorizon * p.sigmaHorizon * Math.max(1, p.eventMultiplier ?? 1);
  const k = (2 * mu) / s2;
  let pTarget: number;
  // Granica μ → 0 (także ochrona przed utratą precyzji przy bardzo małym dryfie)
  if (!Number.isFinite(k) || Math.abs(k * (a + b)) < 1e-9) pTarget = a / (a + b);
  else pTarget = (1 - Math.exp(k * a)) / (Math.exp(-k * b) - Math.exp(k * a));
  pTarget = Math.min(1, Math.max(0, pTarget));
  return { pTarget, pStop: 1 - pTarget };
}

export type PathOutcome = 'target' | 'stop' | 'none';

export interface HitTimePercentiles {
  p25: number;
  p50: number;
  p75: number;
}

export interface McResult {
  /** P(cel przed stopem | wypełnione) */
  pTarget: number;
  pStop: number;
  pNeither: number;
  /** P(wejście dotknięte w horyzoncie); 1 przy wejściu po cenie rynku */
  pFill: number;
  /** < 200 wypełnionych ścieżek: wynik warunkowy policzony przy natychmiastowym wejściu */
  fillRare: boolean;
  paths: number;
  steps: number;
  /** Długość kroku w minutach (1 przy stałej σ, 5 przy modelu zmienności) */
  stepMin: number;
  /** Metoda faktycznie użyta (zapisywana w dzienniku): plan-fhs-har-v2 | plan-har-normal-v2 | plan-gbm-fill-v2 */
  modelVersion: string;
  /** σ na horyzont po mnożniku zdarzeń */
  sigmaEff: number;
  timeToTarget: HitTimePercentiles | null;
  timeToStop: HitTimePercentiles | null;
  /** Średni wynik w R ścieżek bez rozstrzygnięcia (wyjście po cenie z końca horyzontu) */
  neitherMeanR: number;
  samples: {
    /** Czasy próbek w minutach od teraz */
    times: number[];
    /** Pasmo P10/P50/P90 ceny wypełnionych ścieżek (zatrzymane ścieżki trzymane na barierze) */
    band: { p10: number; p50: number; p90: number }[];
    /** Skumulowany odsetek wypełnionych ścieżek rozstrzygniętych do danej próbki */
    hitByTime: { target: number; stop: number }[];
    paths: { outcome: PathOutcome; points: { t: number; price: number }[] }[];
  };
}

function percentile(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Percentyle czasu dojścia; poniżej 20 ścieżek zwracamy null (za mało, by mówić o rozkładzie). */
function timePercentiles(times: number[]): HitTimePercentiles | null {
  if (times.length < 20) return null;
  const s = [...times].sort((x, y) => x - y);
  return { p25: percentile(s, 0.25), p50: percentile(s, 0.5), p75: percentile(s, 0.75) };
}

/** Minimalna liczba wypełnionych ścieżek, przy której wynik warunkowy liczymy z nich samych. */
const MIN_FILLED_PATHS = 200;

export interface BarrierSimParams {
  direction: PlanDirection;
  entry: number;
  stop: number;
  target: number;
  sigmaHorizon: number;
  horizonMin: number;
  driftPerHorizon?: number;
  eventMultiplier?: number;
  paths?: number;
  seed?: number;
  bridge?: boolean;
  samplePaths?: number;
  /** σ log-ceny kolejnych kroków (np. sezonowy HAR); brak = stała σ_h w krokach 1 min */
  stepSigmas?: number[];
  stepMin?: number;
  /** Standaryzowane reszty FHS (bootstrap); brak/null = N(0, 1) */
  residuals?: ArrayLike<number> | null;
  /** Bieżąca cena rynku: gdy różna od wejścia, ścieżka najpierw musi dotknąć wejścia (jak w dzienniku trafności) */
  startPrice?: number;
}

/**
 * Monte Carlo z horyzontem. Proces w log-cenie względem wejścia: w_k = w_{k−1} + μ_k + σ_k·z_k,
 * z z bootstrapu reszt FHS albo N(0, 1); σ_k ze stałej σ_h (kroki 1 min) lub z modelu zmienności (kroki 5 min).
 *
 * Faza wypełnienia (gdy cena startowa ≠ wejście): wypełnienie, gdy krok przetnie poziom wejścia albo — przy końcach po tej samej
 * stronie — z prawdopodobieństwem mostu exp(−2·|w_{k−1}|·|w_k|/σ_k²). W kroku wypełnienia od razu sprawdzane są bariery.
 * Wynik (cel/stop/żadne) jest warunkowy na wypełnienie — tak samo rozlicza dziennik.
 *
 * Wyścig barier: korekta mostu Browna (Broadie–Glasserman–Kou 1997) z lokalnym σ_k; gdy w jednym kroku możliwe są obie
 * bariery (rzadkie), najpierw sprawdzany jest stop — ostrożnie. Losowania mostu pochodzą z osobnego strumienia.
 */
export function simulateBarrierPaths(p: BarrierSimParams): McResult {
  const g0 =
    typeof p.startPrice === 'number' && Number.isFinite(p.startPrice) && p.startPrice > 0 ? Math.log(p.startPrice / p.entry) : 0;
  if (Math.abs(g0) <= MARKET_ENTRY_TOL) return runPaths(p, 0).result;
  const withFill = runPaths(p, g0);
  if (withFill.filled >= MIN_FILLED_PATHS) return withFill.result;
  // Za mało wypełnień, by mówić o rozkładzie warunkowym — liczymy przy natychmiastowym wejściu i mówimy to wprost
  const immediate = runPaths(p, 0).result;
  return { ...immediate, pFill: withFill.result.pFill, fillRare: true };
}

function runPaths(p: BarrierSimParams, g0: number): { result: McResult; filled: number } {
  const nPaths = Math.max(1, Math.round(p.paths ?? 2000));
  const mult = Math.max(1, p.eventMultiplier ?? 1);
  const custom = Array.isArray(p.stepSigmas) && p.stepSigmas.length > 0;
  const stepMin = custom ? p.stepMin ?? 5 : 1;
  const steps = custom ? p.stepSigmas!.length : Math.max(1, Math.round(p.horizonMin));
  const sig = custom
    ? p.stepSigmas!.map((s) => s * Math.sqrt(mult))
    : Array<number>(steps).fill((p.sigmaHorizon * Math.sqrt(mult)) / Math.sqrt(steps));
  const sigmaEff = custom ? Math.sqrt(sig.reduce((acc, s) => acc + s * s, 0)) : p.sigmaHorizon * Math.sqrt(mult);
  const { a, b, side } = barrierDistances(p.direction, p.entry, p.stop, p.target);
  const driftStep = (p.driftPerHorizon ?? 0) / steps;
  const bridge = p.bridge ?? true;
  const seed = p.seed ?? 1;
  const innov = makeInnovation(mulberry32(seed), p.residuals ?? null);
  const uBridge = mulberry32(seed ^ 0x9e3779b9);
  const riskDist = Math.abs(p.entry - p.stop);
  const needFill = g0 !== 0;

  // Próbkowanie do wizualizacji: co ≥ 5 min (rzadziej dla długich horyzontów, ≤ ~72 próbek); indeksy kroków
  const every = Math.max(Math.ceil(5 / stepMin), Math.round(steps / 72));
  const sampleSteps: number[] = [];
  for (let k = 0; k <= steps; k += every) sampleSteps.push(k);
  if (sampleSteps[sampleSteps.length - 1] !== steps) sampleSteps.push(steps);
  const times = sampleSteps.map((k) => k * stepMin);
  const bandCols = times.map(() => new Float64Array(nPaths));
  const row = new Float64Array(times.length);
  const nSample = Math.min(nPaths, Math.max(0, p.samplePaths ?? 18));
  const candidates: Record<PathOutcome, McResult['samples']['paths']> = { target: [], stop: [], none: [] };

  const toPrice = (w: number) => p.entry * Math.exp(w);
  const startPx = toPrice(g0);
  const hitT: number[] = [];
  const hitS: number[] = [];
  let neitherR = 0;
  let neitherN = 0;
  let filledN = 0;

  for (let i = 0; i < nPaths; i++) {
    let w = g0;
    let filled = !needFill;
    let outcome: PathOutcome = 'none';
    let hitStep = steps;
    let col = 1; // indeks następnej próbki (kolumna 0 = start)
    row[0] = startPx;
    const need = candidates.target.length < nSample || candidates.stop.length < nSample || candidates.none.length < nSample;
    const pts: { t: number; price: number }[] | null = need ? [{ t: 0, price: startPx }] : null;

    for (let k = 1; k <= steps; k++) {
      const s = sig[k - 1];
      const v = s * s;
      const wn = w + driftStep + s * innov();
      if (!filled) {
        let hit = w > 0 ? wn <= 0 : wn >= 0;
        if (!hit && bridge) hit = uBridge() < Math.exp((-2 * Math.abs(w) * Math.abs(wn)) / v);
        w = wn;
        if (hit) {
          filled = true;
          const x = side * w;
          if (x <= -a) outcome = 'stop';
          else if (x >= b) outcome = 'target';
        }
      } else {
        const x = side * w;
        const xn = side * wn;
        if (xn <= -a) outcome = 'stop';
        else if (xn >= b) outcome = 'target';
        else if (bridge) {
          const pS = Math.exp((-2 * (x + a) * (xn + a)) / v);
          const pT = Math.exp((-2 * (b - x) * (b - xn)) / v);
          const u = uBridge();
          if (u < pS) outcome = 'stop';
          else if (u < pS + pT) outcome = 'target';
        }
        w = wn;
      }
      if (outcome !== 'none') {
        hitStep = k;
        break;
      }
      while (col < sampleSteps.length && sampleSteps[col] === k) {
        const px = toPrice(w);
        row[col] = px;
        if (pts) pts.push({ t: times[col], price: px });
        col++;
      }
    }

    // Niewypełnione ścieżki nie wchodzą do wyniku warunkowego ani do pasma
    if (!filled) continue;
    const endPrice = outcome === 'target' ? p.target : outcome === 'stop' ? p.stop : toPrice(w);
    for (; col < sampleSteps.length; col++) row[col] = endPrice;
    for (let c = 0; c < times.length; c++) bandCols[c][filledN] = row[c];
    filledN++;
    if (outcome === 'target') hitT.push(hitStep * stepMin);
    else if (outcome === 'stop') hitS.push(hitStep * stepMin);
    else {
      neitherR += (side * (endPrice - p.entry)) / riskDist;
      neitherN++;
    }
    if (pts && candidates[outcome].length < nSample) {
      if (outcome !== 'none') pts.push({ t: hitStep * stepMin, price: endPrice });
      candidates[outcome].push({ outcome, points: pts });
    }
  }

  const F = Math.max(1, filledN);
  // Próbki proporcjonalne do udziału wyników (pierwsze ścieżki bywają niereprezentatywne przy 18 sztukach)
  const counts = { target: hitT.length, stop: hitS.length, none: neitherN };
  const quota = (o: PathOutcome) => Math.min(candidates[o].length, Math.round((nSample * counts[o]) / F));
  const samplePaths = [
    ...candidates.target.slice(0, quota('target')),
    ...candidates.stop.slice(0, quota('stop')),
    ...candidates.none.slice(0, quota('none')),
  ];
  // Dopełnienie do nSample (zaokrąglenia) ścieżkami najliczniejszego wyniku
  const order = (['none', 'stop', 'target'] as PathOutcome[]).sort((x, y) => counts[y] - counts[x]);
  for (const o of order) {
    for (const c of candidates[o]) {
      if (samplePaths.length >= nSample) break;
      if (!samplePaths.includes(c)) samplePaths.push(c);
    }
  }

  const band = bandCols.map((c) => {
    const s = c.subarray(0, filledN).sort();
    return { p10: percentile(s, 0.1), p50: percentile(s, 0.5), p90: percentile(s, 0.9) };
  });

  // Skumulowane rozstrzygnięcia do chwili t (do podpowiedzi na wykresie)
  const sortedT = [...hitT].sort((x, y) => x - y);
  const sortedS = [...hitS].sort((x, y) => x - y);
  const countLe = (arr: number[], t: number) => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (arr[m] <= t) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  const hitByTime = times.map((t) => ({ target: countLe(sortedT, t) / F, stop: countLe(sortedS, t) / F }));

  return {
    filled: filledN,
    result: {
      pTarget: hitT.length / F,
      pStop: hitS.length / F,
      pNeither: neitherN / F,
      pFill: filledN / nPaths,
      fillRare: false,
      modelVersion: custom ? (p.residuals && p.residuals.length > 0 ? 'plan-fhs-har-v2' : 'plan-har-normal-v2') : 'plan-gbm-fill-v2',
      paths: nPaths,
      steps,
      stepMin,
      sigmaEff,
      timeToTarget: timePercentiles(hitT),
      timeToStop: timePercentiles(hitS),
      neitherMeanR: neitherN > 0 ? neitherR / neitherN : 0,
      samples: { times, band, hitByTime, paths: samplePaths },
    },
  };
}

export interface BookWalk {
  mid: number;
  /** Średnia cena wypełnienia (VWAP) */
  vwap: number;
  /** Poślizg względem mid w bps — dodatni = koszt */
  slipBps: number;
  filledUsd: number;
  insufficientDepth: boolean;
  levelsUsed: number;
}

/**
 * Przejście po arkuszu L2: wypełnienie nominału `sizeUsd` zleceniem rynkowym.
 * Kupno zjada ask (od najlepszego), sprzedaż — bid. Gdy arkusz jest za płytki, VWAP dotyczy wypełnionej części
 * (poślizg to dolna granica) i `insufficientDepth = true`. Pusty arkusz → null.
 */
export function walkBook(book: PlanBook, side: 'buy' | 'sell', sizeUsd: number): BookWalk | null {
  const bestBid = book.bids[0]?.price;
  const bestAsk = book.asks[0]?.price;
  if (!isPos(bestBid) || !isPos(bestAsk) || !isPos(sizeUsd)) return null;
  const mid = (bestBid + bestAsk) / 2;
  const levels = side === 'buy' ? book.asks : book.bids;
  let remaining = sizeUsd;
  let usd = 0;
  let btc = 0;
  let used = 0;
  for (const l of levels) {
    if (remaining <= 0) break;
    const avail = l.price * l.sizeBtc;
    if (!(avail > 0)) continue;
    const take = Math.min(remaining, avail);
    usd += take;
    btc += take / l.price;
    remaining -= take;
    used++;
  }
  if (btc === 0) return null;
  const vwap = usd / btc;
  const sgn = side === 'buy' ? 1 : -1;
  return {
    mid,
    vwap,
    slipBps: (sgn * (vwap - mid) * 1e4) / mid,
    filledUsd: usd,
    insufficientDepth: remaining > 1e-9,
    levelsUsed: used,
  };
}

export interface LiquidationInfo {
  price: number;
  /** l = 1/MAINTENANCE_LEVERAGE = połowa depozytu początkowego przy maks. dźwigni */
  maintenanceRate: number;
  maxLeverage: number;
}

/**
 * Cena likwidacji pozycji isolated wg dokumentacji HL (trading/liquidations):
 * liq = price − side·margin_available/position_size/(1 − l·side), l = 1/MAINTENANCE_LEVERAGE,
 * margin_available (isolated) = isolated_margin − maintenance_margin_required,
 * maintenance margin = połowa initial margin przy max leverage (trading/margining).
 * Przybliżenie: depozyt = nominał/dźwignia przy wejściu, bez opłat i fundingu. Brak likwidacji → null.
 */
export function isolatedLiquidationPrice(
  direction: PlanDirection,
  entry: number,
  leverage: number,
  maxLeverage: number = BTC_MAX_LEVERAGE
): LiquidationInfo | null {
  if (!isPos(entry) || !isPos(leverage) || !isPos(maxLeverage)) return null;
  const side = sideOf(direction);
  const l = 1 / (2 * maxLeverage);
  // Na jednostkę pozycji (position_size = 1): isolated_margin = E/lev, maintenance = l·E
  const marginAvailable = entry / leverage - l * entry;
  const price = entry - (side * marginAvailable) / (1 - l * side);
  if (!(price > 0) || !Number.isFinite(price)) return null;
  return { price, maintenanceRate: l, maxLeverage };
}

export type LiquidationWarning = 'liq_before_stop' | 'stop_near_liq' | null;

/** Bufor: |liq − stop| ≥ k·E·σ_h; likwidacja po stronie stopu bliżej wejścia → „likwidacja przed stopem”. */
export function liquidationBufferWarning(
  direction: PlanDirection,
  stop: number,
  liqPrice: number,
  entry: number,
  sigmaHorizon: number,
  k: number = 1
): LiquidationWarning {
  const side = sideOf(direction);
  if (side * (liqPrice - stop) >= 0) return 'liq_before_stop';
  if (Math.abs(liqPrice - stop) < k * entry * sigmaHorizon) return 'stop_near_liq';
  return null;
}

/** Wielkość pozycji ze stałego ryzyka %: size = equity·r/(|E−S|/E + koszty jako ułamek nominału). */
export function sizeFromRisk(p: { equity: number; riskPct: number; entry: number; stop: number; costFrac: number }): number {
  const dist = Math.abs(p.entry - p.stop) / p.entry;
  const denom = dist + Math.max(0, p.costFrac);
  if (!isPos(p.equity) || !isPos(p.riskPct) || !(denom > 0)) return Number.NaN;
  return (p.equity * (p.riskPct / 100)) / denom;
}

/**
 * Wielkość ze stałego ryzyka z poślizgiem z arkusza (dwa przebiegi, bo poślizg zależy od wielkości).
 * Koszty: 2× opłata taker + poślizg wejścia + poślizg stopu (najgorszy przypadek — stop trafiony).
 */
export function sizeFromRiskWithBook(p: {
  equity: number;
  riskPct: number;
  direction: PlanDirection;
  entry: number;
  stop: number;
  feeRateTaker?: number;
  book: PlanBook;
}): number {
  const fee = 2 * (p.feeRateTaker ?? DEFAULT_TAKER_FEE);
  const base = { equity: p.equity, riskPct: p.riskPct, entry: p.entry, stop: p.stop };
  const size0 = sizeFromRisk({ ...base, costFrac: fee });
  if (!Number.isFinite(size0)) return size0;
  const long = p.direction === 'LONG';
  const inSlip = walkBook(p.book, long ? 'buy' : 'sell', size0)?.slipBps ?? 0;
  const outSlip = walkBook(p.book, long ? 'sell' : 'buy', size0)?.slipBps ?? 0;
  return sizeFromRisk({ ...base, costFrac: fee + (Math.max(0, inSlip) + Math.max(0, outSlip)) / 1e4 });
}

/** Dolna granica przedziału Wilsona dla częstości k/n (domyślnie 95%, z = 1.96). */
export function wilsonLowerBound(k: number, n: number, z: number = 1.96): number {
  if (n <= 0) return 0;
  const ph = k / n;
  const z2 = z * z;
  const centre = ph + z2 / (2 * n);
  const margin = z * Math.sqrt((ph * (1 - ph)) / n + z2 / (4 * n * n));
  return Math.max(0, (centre - margin) / (1 + z2 / n));
}

/** Ćwierć-Kelly: f = 0.25·max(0, p_L − (1 − p_L)/R). */
export function quarterKelly(pLower: number, R: number): number {
  if (!(R > 0)) return 0;
  return 0.25 * Math.max(0, pLower - (1 - pLower) / R);
}

export interface PlanCosts {
  riskUsd: number;
  /** Opłaty taker: wejście + wyjście */
  feeUsd: number;
  entrySlipUsd: number;
  /** Oczekiwany poślizg stopu = P(stop)·nominał·bps */
  stopSlipUsdExpected: number;
  totalUsd: number;
  totalR: number;
  /** false = brak arkusza L2 — poślizg nieznany i nie wliczony */
  slippageKnown: boolean;
}

export type PlanAnalysis =
  | {
      ok: true;
      R: number;
      closedForm: { pTarget: number; pStop: number };
      mc: McResult;
      entrySlip: BookWalk | null;
      /** Przybliżenie: stop jako zlecenie rynkowe po przeciwnej stronie BIEŻĄCEGO arkusza */
      stopSlip: BookWalk | null;
      costs: PlanCosts;
      /** EV w R przed kosztami: P_T·R − P_S·1 + P_N·(średni R ścieżek bez rozstrzygnięcia) */
      evRGross: number;
      evR: number;
      liquidation: (LiquidationInfo & { warning: LiquidationWarning }) | null;
      feeRateTaker: number;
    }
  | { ok: false; errors: string[] };

/**
 * Pełna ocena planu. Założenia: wejście i wyjście zleceniem rynkowym (taker) — konserwatywnie;
 * „żadne w horyzoncie” = wyjście po cenie z MC na końcu horyzontu (przy dryfie 0 średnio ≈ 0R).
 */
export function analyzePlan(
  input: PlanInput,
  opts: { paths?: number; seed?: number; maxLeverage?: number; bufferK?: number } = {}
): PlanAnalysis {
  const maxLev = opts.maxLeverage ?? BTC_MAX_LEVERAGE;
  const errors = validatePlan(input, maxLev);
  if (errors.length > 0) return { ok: false, errors };

  const { direction, entry, stop, target, sizeUsd } = input;
  const fee = input.feeRateTaker ?? DEFAULT_TAKER_FEE;
  const mult = Math.max(1, input.eventMultiplier || 1);
  const R = Math.abs(target - entry) / Math.abs(entry - stop);

  const closedForm = barrierHitProbability({ ...input, eventMultiplier: mult });
  const mc = simulateBarrierPaths({
    direction,
    entry,
    stop,
    target,
    sigmaHorizon: input.sigmaHorizon,
    horizonMin: input.horizonMin,
    driftPerHorizon: input.driftPerHorizon ?? 0,
    eventMultiplier: mult,
    paths: Math.max(2000, opts.paths ?? 2000),
    seed: opts.seed ?? 7,
    stepSigmas: input.vol?.stepSigmas,
    stepMin: input.vol?.stepMin,
    residuals: input.vol?.residuals ?? null,
    startPrice: input.startPrice,
  });

  const long = direction === 'LONG';
  const entrySlip = walkBook(input.book, long ? 'buy' : 'sell', sizeUsd);
  const stopSlip = walkBook(input.book, long ? 'sell' : 'buy', sizeUsd);
  const riskUsd = (sizeUsd * Math.abs(entry - stop)) / entry;
  const feeUsd = sizeUsd * fee * 2;
  const entrySlipUsd = entrySlip ? (sizeUsd * Math.max(0, entrySlip.slipBps)) / 1e4 : 0;
  const stopSlipUsdExpected = stopSlip ? (mc.pStop * sizeUsd * Math.max(0, stopSlip.slipBps)) / 1e4 : 0;
  const totalUsd = feeUsd + entrySlipUsd + stopSlipUsdExpected;
  const costs: PlanCosts = {
    riskUsd,
    feeUsd,
    entrySlipUsd,
    stopSlipUsdExpected,
    totalUsd,
    totalR: totalUsd / riskUsd,
    slippageKnown: entrySlip !== null && stopSlip !== null,
  };

  const evRGross = mc.pTarget * R - mc.pStop + mc.pNeither * mc.neitherMeanR;

  let liquidation: (LiquidationInfo & { warning: LiquidationWarning }) | null = null;
  if (input.leverage !== undefined) {
    const liq = isolatedLiquidationPrice(direction, entry, input.leverage, maxLev);
    if (liq) {
      const warning = liquidationBufferWarning(direction, stop, liq.price, entry, mc.sigmaEff, opts.bufferK ?? 1);
      liquidation = { ...liq, warning };
    }
  }

  return {
    ok: true,
    R,
    closedForm,
    mc,
    entrySlip,
    stopSlip,
    costs,
    evRGross,
    evR: evRGross - costs.totalR,
    liquidation,
    feeRateTaker: fee,
  };
}

/** Propozycja startowa poziomów: stop ±1.5σ, cel ±3σ horyzontu (do edycji — nie sygnał). */
export function proposeLevels(direction: PlanDirection, entry: number, sigmaHorizon: number): { stop: number; target: number } | null {
  if (!isPos(entry) || !isPos(sigmaHorizon)) return null;
  const s = sideOf(direction);
  return { stop: entry * Math.exp(-s * 1.5 * sigmaHorizon), target: entry * Math.exp(s * 3 * sigmaHorizon) };
}
