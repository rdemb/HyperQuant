import { L2OrderbookLevel } from '../types/trading';

/**
 * Analizator planu transakcji (BTC-PERP, Hyperliquid) — czyste funkcje.
 * Ocenia plan tradera (wejście / stop / cel / horyzont); nie generuje sygnałów.
 *
 * Model ceny: ruch Browna w log-cenie z dryfem μ (domyślnie 0) i zmiennością σ na horyzont.
 * Źródła: Broadie, Glasserman, Kou (1997) „A continuity correction for discrete barrier options”;
 * Parkinson (1980) estymator zmienności high/low; dokumentacja Hyperliquid (likwidacje, margines, opłaty).
 */

export type PlanDirection = 'LONG' | 'SHORT';

/** Opłata taker HL, tier 0 (perps 0.045%) — ZAŁOŻENIE konfigurowalne (wyższe tiery mają niższe opłaty). */
export const DEFAULT_TAKER_FEE = 0.00045;
/** Maks. dźwignia BTC na HL (tier 0–150M USDC notional, docs: trading/margin-tiers). */
export const BTC_MAX_LEVERAGE = 40;
/** Wersja modelu zapisywana w dzienniku trafności. */
export const PLAN_MODEL_VERSION = 'plan-gbm-bgk-v1';

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
}

const sideOf = (d: PlanDirection) => (d === 'LONG' ? 1 : -1);
const isPos = (v: number) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Walidacja planu — błędy po polsku; pusta lista = plan poprawny. */
export function validatePlan(p: PlanInput, maxLeverage: number = BTC_MAX_LEVERAGE): string[] {
  const errors: string[] = [];
  if (!isPos(p.entry) || !isPos(p.stop) || !isPos(p.target)) {
    errors.push('Podaj dodatnie liczby: wejście, stop i cel.');
    return errors;
  }
  if (p.stop === p.entry) errors.push('Stop równy wejściu — zerowa odległość, ryzyko nieokreślone.');
  if (p.target === p.entry) errors.push('Cel równy wejściu — zerowa odległość, brak zysku do oceny.');
  if (p.direction === 'LONG') {
    if (p.stop > p.entry) errors.push('Dla LONG stop musi być poniżej wejścia.');
    if (p.target < p.entry) errors.push('Dla LONG cel musi być powyżej wejścia.');
  } else {
    if (p.stop < p.entry) errors.push('Dla SHORT stop musi być powyżej wejścia.');
    if (p.target > p.entry) errors.push('Dla SHORT cel musi być poniżej wejścia.');
  }
  if (!isPos(p.sizeUsd)) errors.push('Wielkość pozycji musi być dodatnia.');
  if (!isPos(p.horizonMin)) errors.push('Horyzont musi być dodatni.');
  if (!isPos(p.sigmaHorizon)) errors.push('Brak oszacowania zmienności (σ) — za mało świec.');
  if (p.leverage !== undefined && (!Number.isFinite(p.leverage) || p.leverage < 1 || p.leverage > maxLeverage)) {
    errors.push(`Dźwignia musi być w zakresie 1–${maxLeverage}× (limit BTC na Hyperliquid).`);
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

// Deterministyczny generator Mulberry32 — powtarzalne wyniki dla tego samego seeda
function mulberry32(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box–Muller z buforem drugiej wartości
function normalGen(u: () => number) {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    const r = Math.sqrt(-2 * Math.log(u() + 1e-300));
    const th = 2 * Math.PI * u();
    spare = r * Math.sin(th);
    return r * Math.cos(th);
  };
}

export type PathOutcome = 'target' | 'stop' | 'none';

export interface HitTimePercentiles {
  p25: number;
  p50: number;
  p75: number;
}

export interface McResult {
  pTarget: number;
  pStop: number;
  pNeither: number;
  paths: number;
  steps: number;
  /** σ na horyzont po mnożniku zdarzeń */
  sigmaEff: number;
  timeToTarget: HitTimePercentiles | null;
  timeToStop: HitTimePercentiles | null;
  /** Średni wynik w R ścieżek bez rozstrzygnięcia (wyjście po cenie z końca horyzontu) */
  neitherMeanR: number;
  samples: {
    /** Czasy próbek w minutach */
    times: number[];
    /** Pasmo P10/P50/P90 ceny wszystkich ścieżek (zatrzymane ścieżki trzymane na barierze) */
    band: { p10: number; p50: number; p90: number }[];
    /** Skumulowany odsetek ścieżek rozstrzygniętych do danej próbki */
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

/**
 * Monte Carlo z horyzontem: krok 1 min, σ_krok = σ_h·√mult/√kroki.
 * Korekta mostu Browna (Broadie–Glasserman–Kou 1997): gdy oba końce kroku leżą po tej samej stronie bariery,
 * ścieżka mogła ją przeciąć między nimi z p = exp(−2·d_i·d_{i+1}/(σ²Δt)), d = odległość log od bariery.
 * Gdy w jednym kroku możliwe są obie bariery (rzadkie), najpierw sprawdzany jest stop — ostrożnie.
 * Losowania mostu pochodzą z osobnego strumienia, więc ścieżki są identyczne z i bez korekty.
 */
export function simulateBarrierPaths(p: {
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
}): McResult {
  const nPaths = Math.max(1, Math.round(p.paths ?? 2000));
  const steps = Math.max(1, Math.round(p.horizonMin));
  const mult = Math.max(1, p.eventMultiplier ?? 1);
  const sigmaEff = p.sigmaHorizon * Math.sqrt(mult);
  const sigStep = sigmaEff / Math.sqrt(steps);
  const varStep = sigStep * sigStep;
  const { a, b, side } = barrierDistances(p.direction, p.entry, p.stop, p.target);
  // Proces w przestrzeni „zysku”: X = side·ln(P/E); cel na +b, stop na −a
  const muStep = (side * (p.driftPerHorizon ?? 0)) / steps;
  const bridge = p.bridge ?? true;
  const seed = p.seed ?? 1;
  const normal = normalGen(mulberry32(seed));
  const uBridge = mulberry32(seed ^ 0x9e3779b9);
  const riskDist = Math.abs(p.entry - p.stop);

  // Próbkowanie do wizualizacji: co 5 min (rzadziej dla długich horyzontów, ≤ ~72 próbek)
  const every = Math.max(5, Math.round(steps / 72));
  const times: number[] = [];
  for (let t = 0; t <= steps; t += every) times.push(t);
  if (times[times.length - 1] !== steps) times.push(steps);
  const bandCols = times.map(() => new Float64Array(nPaths));
  const nSample = Math.min(nPaths, Math.max(0, p.samplePaths ?? 18));
  // Kandydaci do wizualizacji: do nSample pierwszych ścieżek każdego wyniku; wybór proporcjonalny niżej
  const candidates: Record<PathOutcome, McResult['samples']['paths']> = { target: [], stop: [], none: [] };

  const toPrice = (x: number) => p.entry * Math.exp(side * x);
  const hitT: number[] = [];
  const hitS: number[] = [];
  let neitherR = 0;
  let neitherN = 0;

  for (let i = 0; i < nPaths; i++) {
    let x = 0;
    let outcome: PathOutcome = 'none';
    let hitStep = steps;
    let col = 1; // indeks następnej próbki (kolumna 0 = start)
    bandCols[0][i] = p.entry;
    // Punkty ścieżki zbieramy tylko, dopóki brakuje kandydatów któregoś wyniku
    const need = candidates.target.length < nSample || candidates.stop.length < nSample || candidates.none.length < nSample;
    const pts: { t: number; price: number }[] | null = need ? [{ t: 0, price: p.entry }] : null;

    for (let k = 1; k <= steps; k++) {
      const xn = x + muStep + sigStep * normal();
      if (xn <= -a) outcome = 'stop';
      else if (xn >= b) outcome = 'target';
      else if (bridge) {
        const pS = Math.exp((-2 * (x + a) * (xn + a)) / varStep);
        const pT = Math.exp((-2 * (b - x) * (b - xn)) / varStep);
        const u = uBridge();
        if (u < pS) outcome = 'stop';
        else if (u < pS + pT) outcome = 'target';
      }
      if (outcome !== 'none') {
        hitStep = k;
        break;
      }
      x = xn;
      while (col < times.length && times[col] === k) {
        const px = toPrice(x);
        bandCols[col][i] = px;
        if (pts) pts.push({ t: k, price: px });
        col++;
      }
    }

    // Ścieżka zatrzymana na barierze: dalsze próbki trzymają cenę bariery
    const endPrice = outcome === 'target' ? p.target : outcome === 'stop' ? p.stop : toPrice(x);
    for (; col < times.length; col++) bandCols[col][i] = endPrice;
    if (outcome === 'target') hitT.push(hitStep);
    else if (outcome === 'stop') hitS.push(hitStep);
    else {
      neitherR += (side * (endPrice - p.entry)) / riskDist;
      neitherN++;
    }
    if (pts && candidates[outcome].length < nSample) {
      if (outcome !== 'none') pts.push({ t: hitStep, price: endPrice });
      candidates[outcome].push({ outcome, points: pts });
    }
  }

  // Próbki proporcjonalne do udziału wyników (pierwsze ścieżki bywają niereprezentatywne przy 18 sztukach)
  const counts = { target: hitT.length, stop: hitS.length, none: neitherN };
  const quota = (o: PathOutcome) => Math.min(candidates[o].length, Math.round((nSample * counts[o]) / nPaths));
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
    c.sort();
    return { p10: percentile(c, 0.1), p50: percentile(c, 0.5), p90: percentile(c, 0.9) };
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
  const hitByTime = times.map((t) => ({ target: countLe(sortedT, t) / nPaths, stop: countLe(sortedS, t) / nPaths }));

  return {
    pTarget: hitT.length / nPaths,
    pStop: hitS.length / nPaths,
    pNeither: neitherN / nPaths,
    paths: nPaths,
    steps,
    sigmaEff,
    timeToTarget: timePercentiles(hitT),
    timeToStop: timePercentiles(hitS),
    neitherMeanR: neitherN > 0 ? neitherR / neitherN : 0,
    samples: { times, band, hitByTime, paths: samplePaths },
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
