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

// ─────────────────────────────────────────────────────────────────────────────
// Sezonowość, log-HAR, innowacje FHS i model zmienności dla horyzontów planu
// Corsi (2009) HAR-RV; Andersen & Bollerslev (1997) sezonowość wewnątrzdobowa; Duan (1983) smearing;
// Patton (2011) QLIKE; Barone-Adesi, Giannopoulos & Vosper (1999) filtered historical simulation.
// ─────────────────────────────────────────────────────────────────────────────

const HOUR_MS = 3_600_000;
const FIVE_MIN_MS = 300_000;
/** Krok Monte Carlo (min) zasilanego modelem zmienności */
export const VOL_STEP_MIN = 5;

const utcHour = (ms: number) => new Date(ms).getUTCHours();
const meanOf = (xs: ArrayLike<number>, from = 0, to = xs.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += xs[i];
  return s / (to - from);
};

export interface SeasonalProfile {
  /** 24 współczynniki wariancji godzin UTC, średnia 1 */
  factors: number[];
  /** Liczba świec w każdej godzinie */
  counts: number[];
}

/**
 * Profil wariancji wg godziny UTC ze świec (Garman–Klass): f_h = (n_h·m_h + K·m) / ((n_h + K)·m),
 * czyli średnia godziny ściągnięta do średniej ogólnej (K obserwacji „a priori”), potem normalizacja do średniej 1.
 */
export function seasonalProfile(bars: RangeBar[], shrinkK: number = 20): SeasonalProfile {
  const sum = Array(24).fill(0);
  const counts = Array(24).fill(0);
  let total = 0;
  let n = 0;
  for (const b of bars) {
    if (!isValidBar(b)) continue;
    const v = garmanKlassVar(b);
    const h = utcHour(b.time);
    sum[h] += v;
    counts[h]++;
    total += v;
    n++;
  }
  if (n === 0 || !(total > 0)) return { factors: Array(24).fill(1), counts };
  const m = total / n;
  const raw = sum.map((s, h) => (s + shrinkK * m) / ((counts[h] + shrinkK) * m));
  const avg = meanOf(raw);
  return { factors: raw.map((f) => f / avg), counts };
}

/** QLIKE (Patton 2011): r/f − ln(r/f) − 1 — strata odporna na szum w zastępczej mierze realizacji. */
export function qlike(realized: number, forecast: number): number {
  const x = realized / forecast;
  return x - Math.log(x) - 1;
}

export interface HarModel {
  /** [b0, b1 (godzina), b2 (24 h), b3 (168 h)] */
  coef: [number, number, number, number];
  /** Korekta Duana: E[exp(ε)] dla prognozy 1-krokowej */
  smear: number;
  /**
   * Korekta Duana dla prognozy iterowanej h kroków (indeks h−1): średnia exp(y_{t+h} − ŷ_{t+h|t}) w próbie.
   * Iterowanie log-prognozy gubi nierówność Jensena z wcześniejszych błędów — przy szumie BTC ~10% wariancji na 12–24 h.
   */
  smearByH: number[];
  /** Liczba wierszy regresji */
  n: number;
  r2: number;
  /** Prognozy 1-krokowe na ostatnich 30% (model z pierwszych 70%) vs naiwna średnia GK z 24 h */
  oos: { qlikeHar: number; qlikeNaive: number; n: number } | null;
  /** Ostatnie 168 wartości y (najnowsza na końcu) — stan do prognozy */
  lastY: number[];
}

/** Rozwiązanie układu Ax = b eliminacją Gaussa z wyborem elementu głównego; osobliwy → null. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/** OLS celu na wierszach [1, y_t, D_t, W_t] w zakresie [from, to). */
function olsHar(rows: number[][], target: number[], from: number, to: number) {
  const XtX = Array.from({ length: 4 }, () => Array(4).fill(0));
  const Xty = Array(4).fill(0);
  for (let i = from; i < to; i++) {
    const x = rows[i];
    for (let a = 0; a < 4; a++) {
      Xty[a] += x[a] * target[i];
      for (let b = 0; b < 4; b++) XtX[a][b] += x[a] * x[b];
    }
  }
  const coef = solveLinear(XtX, Xty);
  if (!coef || !coef.every(Number.isFinite)) return null;
  let smear = 0;
  let sse = 0;
  for (let i = from; i < to; i++) {
    const e = target[i] - (coef[0] + coef[1] * rows[i][1] + coef[2] * rows[i][2] + coef[3] * rows[i][3]);
    smear += Math.exp(e);
    sse += e * e;
  }
  return { coef: coef as [number, number, number, number], smear: smear / (to - from), sse };
}

/** Liczba horyzontów (godzin) z własną korektą Duana; dalej obowiązuje ostatnia (24 h horyzontu + przesunięcie startu). */
const SMEAR_HORIZONS = 48;

/**
 * Korekta Duana dla każdego horyzontu prognozy iterowanej: z każdego początku t (y znane do t) iterujemy ŷ_{t+h|t}
 * jak w `forecastHourlyVariances` i uśredniamy exp(y_{t+h} − ŷ_{t+h|t}). `pre` = sumy prefiksowe y.
 */
function iteratedSmear(y: number[], pre: Float64Array, coef: [number, number, number, number], H: number): number[] {
  const [b0, b1, b2, b3] = coef;
  const N = y.length;
  const sum = new Float64Array(H);
  const cnt = new Float64Array(H);
  const pred = new Float64Array(H);
  for (let t = 167; t < N - 1; t++) {
    let s24 = pre[t + 1] - pre[t - 23];
    let s168 = pre[t + 1] - pre[t - 167];
    let last = y[t];
    // Wartość szeregu pod indeksem j: obserwacja (j ≤ t) albo prognoza z tego początku
    const val = (j: number) => (j <= t ? y[j] : pred[j - t - 1]);
    for (let h = 1; h <= H && t + h < N; h++) {
      const yh = b0 + b1 * last + b2 * (s24 / 24) + b3 * (s168 / 168);
      pred[h - 1] = yh;
      sum[h - 1] += Math.exp(y[t + h] - yh);
      cnt[h - 1]++;
      s24 += yh - val(t + h - 24);
      s168 += yh - val(t + h - 168);
      last = yh;
    }
  }
  const out: number[] = [];
  for (let h = 0; h < H; h++) out.push(cnt[h] > 0 ? sum[h] / cnt[h] : out[h - 1] ?? 1);
  return out;
}

/** GK podłogowany na 1% mediany dodatnich wartości z `ref` (świeca bez zakresu nie staje się odstającą obserwacją ln 0). */
function floorGk(gk: number[], ref: number[]): number[] | null {
  const positive = ref.filter((v) => v > 0).sort((a, b) => a - b);
  if (positive.length === 0) return null;
  const floor = 0.01 * positive[Math.floor(positive.length / 2)];
  return gk.map((x) => Math.max(x, floor));
}

/** Wiersze regresji HAR [1, y_t, średnia 24, średnia 168] → y_{t+1} dla t = 167..N−2 i sumy prefiksowe y. */
function harRows(y: number[]): { rows: number[][]; target: number[]; pre: Float64Array } {
  const N = y.length;
  const pre = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) pre[i + 1] = pre[i] + y[i];
  const rows: number[][] = [];
  const target: number[] = [];
  for (let t = 167; t < N - 1; t++) {
    rows.push([1, y[t], (pre[t + 1] - pre[t - 23]) / 24, (pre[t + 1] - pre[t - 167]) / 168]);
    target.push(y[t + 1]);
  }
  return { rows, target, pre };
}

/**
 * Sezonowy log-HAR na godzinowych wariancjach Garman–Klass:
 * y_t = ln(GK_t / f_h(t)), y_{t+1} = b0 + b1·y_t + b2·średnia(y_{t−23..t}) + b3·średnia(y_{t−167..t}) + ε.
 * GK podłogowany na 1% mediany (świeca bez zakresu nie staje się odstającą obserwacją ln 0).
 * Mniej niż 500 wierszy regresji → null.
 */
export function fitSeasonalHar(bars: RangeBar[], profile: SeasonalProfile): HarModel | null {
  const valid = bars.filter(isValidBar).sort((a, b) => a.time - b.time);
  const gk = valid.map(garmanKlassVar);
  const v = floorGk(gk, gk);
  if (!v) return null;
  const y = v.map((x, i) => Math.log(x / profile.factors[utcHour(valid[i].time)]));
  const N = y.length;
  if (N - 168 < 500) return null;

  const { rows, target, pre } = harRows(y);
  const fit = olsHar(rows, target, 0, rows.length);
  if (!fit) return null;
  const tMean = meanOf(target);
  const sst = target.reduce((a, x) => a + (x - tMean) ** 2, 0);

  // Ocena poza próbą: model z pierwszych 70% wierszy, prognozy 1-krokowe na reszcie. Profil sezonowy i podłoga GK tylko
  // ze świec części uczącej (wiersze 0..split−1 sięgają świecy split+167): profil z całej próby widziałby część testową
  let oos: HarModel['oos'] = null;
  const split = Math.floor(rows.length * 0.7);
  const nTrain = split + 168;
  const pIn = seasonalProfile(valid.slice(0, nTrain));
  const vIn = floorGk(gk, gk.slice(0, nTrain));
  const ins = vIn ? harRows(vIn.map((x, i) => Math.log(x / pIn.factors[utcHour(valid[i].time)]))) : null;
  const fitIn = ins ? olsHar(ins.rows, ins.target, 0, split) : null;
  if (ins && vIn && fitIn && rows.length - split >= 50) {
    let qh = 0;
    let qn = 0;
    let cnt = 0;
    for (let i = split; i < rows.length; i++) {
      const t = i + 167; // indeks świecy y_t dla wiersza i
      const realized = gk[t + 1];
      if (!(realized > 0)) continue;
      const x = ins.rows[i];
      const yHat = fitIn.coef[0] + fitIn.coef[1] * x[1] + fitIn.coef[2] * x[2] + fitIn.coef[3] * x[3];
      const fHar = pIn.factors[utcHour(valid[t + 1].time)] * Math.exp(yHat) * fitIn.smear;
      const fNaive = meanOf(vIn, t - 23, t + 1);
      qh += qlike(realized, fHar);
      qn += qlike(realized, fNaive);
      cnt++;
    }
    if (cnt >= 50) oos = { qlikeHar: qh / cnt, qlikeNaive: qn / cnt, n: cnt };
  }

  return {
    coef: fit.coef,
    smear: fit.smear,
    smearByH: iteratedSmear(y, pre, fit.coef, SMEAR_HORIZONS),
    n: rows.length,
    r2: sst > 0 ? 1 - fit.sse / sst : 0,
    oos,
    lastY: y.slice(-168),
  };
}

/**
 * Prognoza iterowana wariancji godzin [firstHourStartMs + k·1h], k = 0..hours−1:
 * ŷ dopisywane do bufora y (średnie 24/168 przeliczane), wariancja = f_h·exp(ŷ)·smear_{k+1} (korekta Duana dla horyzontu).
 */
export function forecastHourlyVariances(m: HarModel, p: SeasonalProfile, firstHourStartMs: number, hours: number): number[] {
  const [b0, b1, b2, b3] = m.coef;
  const buf = [...m.lastY];
  let sum24 = meanOf(buf, buf.length - 24) * 24;
  let sum168 = meanOf(buf) * 168;
  const out: number[] = [];
  for (let k = 0; k < hours; k++) {
    const yt = buf[buf.length - 1];
    const yHat = b0 + b1 * yt + b2 * (sum24 / 24) + b3 * (sum168 / 168);
    sum24 += yHat - buf[buf.length - 24];
    sum168 += yHat - buf[buf.length - 168];
    buf.push(yHat);
    const smear = m.smearByH.length > 0 ? m.smearByH[Math.min(k, m.smearByH.length - 1)] : m.smear;
    out.push(p.factors[utcHour(firstHourStartMs + k * HOUR_MS)] * Math.exp(yHat) * smear);
  }
  return out;
}

/**
 * σ kroków od `startMs` przez `horizonMin` minut: wariancja kroku = Σ_h (wspólne minuty kroku i godziny h)/60 · hourVars[h].
 * Godziny poza zakresem tablicy przyjmują wartość skrajnej godziny.
 */
export function stepSigmas(hourVars: number[], firstHourStartMs: number, startMs: number, horizonMin: number, stepMin: number): number[] {
  const steps = Math.max(1, Math.round(horizonMin / stepMin));
  const stepMs = stepMin * 60_000;
  const last = hourVars.length - 1;
  const out: number[] = [];
  for (let k = 0; k < steps; k++) {
    let t = startMs + k * stepMs;
    const end = t + stepMs;
    let variance = 0;
    while (t < end) {
      const h = Math.floor((t - firstHourStartMs) / HOUR_MS);
      const hourEnd = firstHourStartMs + (h + 1) * HOUR_MS;
      const seg = Math.min(end, hourEnd) - t;
      variance += (seg / HOUR_MS) * hourVars[Math.min(last, Math.max(0, h))];
      t += seg;
    }
    out.push(Math.sqrt(variance));
  }
  return out;
}

/**
 * Innowacje FHS ze świec 5m: z_i = r_i / σ̂_i, r_i = ln(C_i/C_{i−1}),
 * σ̂²_i = f_h(i) · średnia(GK_j / f_h(j), j ∈ [i−window, i−1]); na końcu wyśrodkowane i znormalizowane do wariancji 1.
 */
export function fhsResiduals(bars5m: RangeBar[], p: SeasonalProfile, window: number = 288): Float64Array {
  const bars = bars5m.filter(isValidBar).sort((a, b) => a.time - b.time);
  const des = bars.map((b) => garmanKlassVar(b) / p.factors[utcHour(b.time)]);
  const z: number[] = [];
  let sum = 0;
  for (let j = 0; j < Math.min(window, des.length); j++) sum += des[j];
  for (let i = window; i < bars.length; i++) {
    if (i > window) sum += des[i - 1] - des[i - 1 - window];
    const sig2 = p.factors[utcHour(bars[i].time)] * (sum / window);
    if (sig2 > 0) z.push(Math.log(bars[i].close / bars[i - 1].close) / Math.sqrt(sig2));
  }
  if (z.length < 2) return new Float64Array(0);
  const m = meanOf(z);
  const sd = Math.sqrt(z.reduce((a, x) => a + (x - m) ** 2, 0) / (z.length - 1));
  return Float64Array.from(z, (x) => (x - m) / sd);
}

export interface VolModel {
  builtAt: number;
  profile: SeasonalProfile;
  har: HarModel;
  /** Standaryzowane innowacje FHS (5m) */
  residuals: Float64Array;
  jump: JumpShare | null;
  lmJumps: { count: number; days: number; maxAbsMovePct: number };
  hourlyBars: number;
  fiveMinBars: number;
  /** Początek pierwszej godziny bez pełnej świecy (zwykle bieżąca godzina) — start prognozy */
  nextHourStartMs: number;
}

const MIN_HOURLY = 1000;
const MIN_FIVE_MIN = 1500;

/**
 * Model zmienności ze świec 1h (profil + log-HAR) i 5m (FHS, udział skoków, Lee–Mykland na zwrotach bez sezonowości).
 * Świece w toku (początek + interwał > teraz) i nieważne są pomijane; za mało danych → null.
 */
export function buildVolModel(hourly: RangeBar[], fiveMin: RangeBar[], nowMs: number): VolModel | null {
  const h = hourly.filter((b) => isValidBar(b) && b.time + HOUR_MS <= nowMs).sort((a, b) => a.time - b.time);
  const f = fiveMin.filter((b) => isValidBar(b) && b.time + FIVE_MIN_MS <= nowMs).sort((a, b) => a.time - b.time);
  if (h.length < MIN_HOURLY || f.length < MIN_FIVE_MIN) return null;
  const profile = seasonalProfile(h);
  const har = fitSeasonalHar(h, profile);
  if (!har) return null;
  const residuals = fhsResiduals(f, profile);
  if (residuals.length < 500) return null;

  const r: number[] = [];
  for (let i = 1; i < f.length; i++) r.push(Math.log(f[i].close / f[i - 1].close));
  const rDes = r.map((x, i) => x / Math.sqrt(profile.factors[utcHour(f[i + 1].time)]));
  const jumps = leeMyklandJumps(rDes, 288, 0.01);
  const maxAbs = jumps.reduce((m, i) => Math.max(m, Math.abs(r[i])), 0);

  return {
    builtAt: nowMs,
    profile,
    har,
    residuals,
    jump: jumpShareByDay(f, FIVE_MIN_MS),
    lmJumps: {
      count: jumps.length,
      days: (f[f.length - 1].time - f[0].time + FIVE_MIN_MS) / 86_400_000,
      maxAbsMovePct: maxAbs * 100,
    },
    hourlyBars: h.length,
    fiveMinBars: f.length,
    nextHourStartMs: h[h.length - 1].time + HOUR_MS,
  };
}

/** σ kroków (domyślnie 5 min) na horyzont planu od chwili `nowMs` z prognozy HAR i profilu godzin. */
export function horizonStepSigmas(m: VolModel, nowMs: number, horizonMin: number, stepMin: number = VOL_STEP_MIN): number[] {
  const hours = Math.max(1, Math.ceil((nowMs + horizonMin * 60_000 - m.nextHourStartMs) / HOUR_MS) + 1);
  const hourVars = forecastHourlyVariances(m.har, m.profile, m.nextHourStartMs, hours);
  return stepSigmas(hourVars, m.nextHourStartMs, nowMs, horizonMin, stepMin);
}
