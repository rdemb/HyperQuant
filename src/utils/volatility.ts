/**
 * Silnik zmienności — czyste funkcje (bez sieci i stanu).
 *
 * Estymatory zakresowe: Parkinson (1980), Garman & Klass (1980), Rogers & Satchell (1991), Yang & Zhang (2000).
 * Skoki: wariancja dwupotęgowa (Barndorff-Nielsen & Shephard 2004) i test Lee & Mykland (2008).
 * Wszystkie wariancje są w log-zwrotach (ln P) na świecę albo na podany okres.
 */

export interface RangeBar {
  /** Początek świecy, ms UTC */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const finitePos = (v: number) => Number.isFinite(v) && v > 0;

/** Świeca nadaje się do estymacji: ceny dodatnie i skończone, otwarcie i zamknięcie w zakresie [low, high]. */
export function isValidBar(b: RangeBar): boolean {
  return (
    finitePos(b.open) &&
    finitePos(b.high) &&
    finitePos(b.low) &&
    finitePos(b.close) &&
    b.high >= Math.max(b.open, b.close) &&
    b.low <= Math.min(b.open, b.close)
  );
}

/** Parkinson: ln(H/L)² / (4 ln 2). */
export function parkinsonVar(b: RangeBar): number {
  return Math.log(b.high / b.low) ** 2 / (4 * Math.LN2);
}

/** Garman–Klass: ½·ln(H/L)² − (2 ln 2 − 1)·ln(C/O)² — nieujemny, bo |ln(C/O)| ≤ ln(H/L). */
export function garmanKlassVar(b: RangeBar): number {
  return 0.5 * Math.log(b.high / b.low) ** 2 - (2 * Math.LN2 - 1) * Math.log(b.close / b.open) ** 2;
}

/** Rogers–Satchell: ln(H/C)·ln(H/O) + ln(L/C)·ln(L/O) — niezależny od dryfu. */
export function rogersSatchellVar(b: RangeBar): number {
  return Math.log(b.high / b.close) * Math.log(b.high / b.open) + Math.log(b.low / b.close) * Math.log(b.low / b.open);
}

function sampleVariance(xs: number[]): number {
  const n = xs.length;
  const m = xs.reduce((a, x) => a + x, 0) / n;
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1);
}

/**
 * Yang–Zhang (2000), wariancja na świecę: V = Var(o) + k·Var(c) + (1−k)·średnia(RS),
 * o_i = ln(O_i/C_{i−1}) (luka), c_i = ln(C_i/O_i), k = 0.34 / (1.34 + (n+1)/(n−1)). Wymaga ≥ 2 świec.
 */
export function yangZhangVar(bars: RangeBar[]): number {
  const n = bars.length - 1;
  if (n < 2) return Number.NaN;
  const o: number[] = [];
  const c: number[] = [];
  let rs = 0;
  for (let i = 1; i < bars.length; i++) {
    o.push(Math.log(bars[i].open / bars[i - 1].close));
    c.push(Math.log(bars[i].close / bars[i].open));
    rs += rogersSatchellVar(bars[i]);
  }
  const k = 0.34 / (1.34 + (n + 1) / (n - 1));
  return sampleVariance(o) + k * sampleVariance(c) + (1 - k) * (rs / n);
}

export function logReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) out.push(Math.log(closes[i] / closes[i - 1]));
  return out;
}

/** Wariancja zrealizowana: Σ r². */
export function realizedVariance(r: number[]): number {
  return r.reduce((a, x) => a + x * x, 0);
}

/** Wariancja dwupotęgowa (BNS 2004): (π/2)·Σ_{i≥1} |r_i||r_{i−1}| · n/(n−1) — odporna na pojedyncze skoki. */
export function bipowerVariation(r: number[]): number {
  const n = r.length;
  if (n < 2) return 0;
  let s = 0;
  for (let i = 1; i < n; i++) s += Math.abs(r[i]) * Math.abs(r[i - 1]);
  return (Math.PI / 2) * s * (n / (n - 1));
}

export interface JumpShare {
  /** Σ max(RV−BV, 0) / Σ RV po pełnych dniach UTC */
  share: number;
  rv: number;
  bv: number;
  days: number;
}

/**
 * Udział skoków w wariancji: dzienne RV i BV ze zwrotów wewnątrz dnia UTC (pierwszy zwrot dnia = ln(C/O) pierwszej świecy).
 * Liczą się tylko dni z ≥ 90% oczekiwanych świec; brak takich dni → null.
 */
export function jumpShareByDay(bars: RangeBar[], barMs: number): JumpShare | null {
  const DAY = 86_400_000;
  const expected = DAY / barMs;
  const byDay = new Map<number, RangeBar[]>();
  for (const b of bars) {
    if (!isValidBar(b)) continue;
    const d = Math.floor(b.time / DAY);
    const arr = byDay.get(d);
    if (arr) arr.push(b);
    else byDay.set(d, [b]);
  }
  let rv = 0;
  let bv = 0;
  let jump = 0;
  let days = 0;
  for (const dayBars of byDay.values()) {
    if (dayBars.length < 0.9 * expected) continue;
    dayBars.sort((a, b) => a.time - b.time);
    const r = [Math.log(dayBars[0].close / dayBars[0].open), ...logReturns(dayBars.map((b) => b.close))];
    const dRv = realizedVariance(r);
    const dBv = bipowerVariation(r);
    rv += dRv;
    bv += dBv;
    jump += Math.max(dRv - dBv, 0);
    days++;
  }
  if (days === 0 || !(rv > 0)) return null;
  return { share: jump / rv, rv, bv, days };
}

/**
 * Test skoków Lee & Mykland (2008): L_i = r_i / σ̂_i, σ̂²_i = Σ_{j=i−K+2}^{i−1} |r_j||r_{j−1}| / (K−2).
 * Skok, gdy (|L_i| − C_n)/S_n > β* = −ln(−ln(1−α)); c = √(2/π),
 * C_n = √(2 ln n)/c − (ln π + ln ln n)/(2c√(2 ln n)), S_n = 1/(c√(2 ln n)). Zwraca indeksy w `r` (testowane i ≥ K).
 */
export function leeMyklandJumps(r: number[], window: number = 288, alpha: number = 0.01): number[] {
  const n = r.length;
  const K = window;
  if (n <= K || K < 3) return [];
  const c = Math.sqrt(2 / Math.PI);
  const l2n = Math.sqrt(2 * Math.log(n));
  const Cn = l2n / c - (Math.log(Math.PI) + Math.log(Math.log(n))) / (2 * c * l2n);
  const Sn = 1 / (c * l2n);
  const beta = -Math.log(-Math.log(1 - alpha));
  const prod = (j: number) => Math.abs(r[j]) * Math.abs(r[j - 1]);
  // Suma krocząca |r_j||r_{j−1}| dla j ∈ [i−K+2, i−1]
  let sum = 0;
  for (let j = 2; j <= K - 1; j++) sum += prod(j);
  const out: number[] = [];
  for (let i = K; i < n; i++) {
    if (i > K) sum += prod(i - 1) - prod(i - K + 1);
    const sig = Math.sqrt(sum / (K - 2));
    if (!(sig > 0)) continue;
    const L = r[i] / sig;
    if ((Math.abs(L) - Cn) / Sn > beta) out.push(i);
  }
  return out;
}
