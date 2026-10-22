/**
 * Ocena i kalibracja prognoz — czyste funkcje bez importów (strona i skaner w Node 24).
 *
 *  - prognozy rozkładu (kwantyle zwrotu): pinball/quantile score, CRPS z siatki kwantyli (Gneiting & Raftery 2007:
 *    CRPS = 2∫₀¹ QS_τ dτ), PIT (Dawid 1984), test Kupca POF dla pokrycia przedziałów (Kupiec 1995),
 *    ACI — adaptacyjna kalibracja konformalna poziomu przedziału (Gibbs & Candès 2021);
 *  - prognozy zdarzeń (prawdopodobieństwa): Brier, diagram niezawodności, regresja izotoniczna (PAV) i
 *    indukcyjne predyktory Venna–Abersa (Vovk & Petej 2014) — przedział [p0, p1] i scalone p = p1 / (1 − p0 + p1).
 */

/** erfc z błędem względnym < 1.2e-7 (Numerical Recipes, przybliżenie Czebyszewa). */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
    );
  return x >= 0 ? r : 2 - r;
}

/** P(Z > z), Z ~ N(0, 1). */
export function normalSf(z: number): number {
  return 0.5 * erfc(z / Math.SQRT2);
}

/** Odwrotna dystrybuanta N(0, 1) — algorytm Acklama (błąd względny < 1.2e-9; krok Halleya pominięty, bo erfc ma ~1e-7). */
export function normInv(p: number): number {
  if (!(p > 0 && p < 1)) return p === 0 ? Number.NEGATIVE_INFINITY : p === 1 ? Number.POSITIVE_INFINITY : Number.NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let x: number;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pl) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  return x;
}

/** Strata kwantylowa (pinball) dla kwantyla q na poziomie τ i realizacji y. */
export function pinball(q: number, y: number, tau: number): number {
  return y >= q ? tau * (y - q) : (1 - tau) * (q - y);
}

/**
 * CRPS z siatki kwantyli: 2∫ QS_τ dτ metodą trapezów po τ z siatki (rosnąco). Siatka nie obejmuje skrajnych ogonów,
 * więc to CRPS obcięty do [τ₁, τ_K] — wystarczający do porównań modeli na tej samej siatce.
 */
export function crpsQuantiles(taus: number[], qs: number[], y: number): number {
  let s = 0;
  for (let i = 1; i < taus.length; i++) {
    const a = pinball(qs[i - 1], y, taus[i - 1]);
    const b = pinball(qs[i], y, taus[i]);
    s += ((a + b) / 2) * (taus[i] - taus[i - 1]);
  }
  return 2 * s;
}

/** Kwantyl na poziomie τ z siatki (interpolacja liniowa, poza siatką — skrajny kwantyl). */
export function quantileAt(taus: number[], qs: number[], tau: number): number {
  if (tau <= taus[0]) return qs[0];
  const last = taus.length - 1;
  if (tau >= taus[last]) return qs[last];
  let i = 1;
  while (taus[i] < tau) i++;
  const w = (tau - taus[i - 1]) / (taus[i] - taus[i - 1]);
  return qs[i - 1] + w * (qs[i] - qs[i - 1]);
}

/** PIT = F(y) z siatki kwantyli (interpolacja liniowa; poniżej/powyżej siatki — połowa skrajnego ogona). */
export function pitFromQuantiles(taus: number[], qs: number[], y: number): number {
  const last = qs.length - 1;
  if (y < qs[0]) return taus[0] / 2;
  if (y > qs[last]) return 1 - (1 - taus[last]) / 2;
  for (let i = 1; i <= last; i++) {
    if (y <= qs[i]) {
      const span = qs[i] - qs[i - 1];
      return span > 0 ? taus[i - 1] + ((y - qs[i - 1]) / span) * (taus[i] - taus[i - 1]) : taus[i];
    }
  }
  return taus[last];
}

/** Test Kupca (proporcja przekroczeń, POF): p-wartość χ²(1) dla x przekroczeń w n przy nominale p; n = 0 → null. */
export function kupiec(n: number, x: number, p: number): number | null {
  if (n <= 0) return null;
  const ph = x / n;
  const ll = (q: number) => (n - x) * (q < 1 ? Math.log(1 - q) : x === n ? 0 : Number.NEGATIVE_INFINITY) + (x > 0 ? x * Math.log(q) : 0);
  const lr = Math.max(0, -2 * (ll(p) - ll(ph)));
  // χ²(1): P(X > lr) = 2·P(Z > √lr); przycięte do [0, 1] (przybliżenie erfc)
  return Math.min(1, 2 * normalSf(Math.sqrt(lr)));
}

/**
 * Krok ACI (Gibbs & Candès 2021): α_{t+1} = α_t + γ(α − err_t), err_t = 1 przy chybieniu przedziału.
 * Chybienie obniża α_t → kolejny przedział szerszy; seria trafień stopniowo go zwęża. Wynik przycięty do [0, 1].
 */
export function aciStep(alphaT: number, alpha: number, miss: boolean, gamma: number): number {
  return Math.min(1, Math.max(0, alphaT + gamma * (alpha - (miss ? 1 : 0))));
}

/** Regresja izotoniczna (PAV) — niemalejące dopasowanie ciągu y (w kolejności rosnącego predyktora), z wagami. */
export function isotonic(ys: number[], ws?: number[]): number[] {
  const val: number[] = [];
  const wt: number[] = [];
  const len: number[] = [];
  ys.forEach((y, i) => {
    val.push(y);
    wt.push(ws ? ws[i] : 1);
    len.push(1);
    while (val.length > 1 && val[val.length - 2] > val[val.length - 1]) {
      const w = wt[wt.length - 2] + wt[wt.length - 1];
      const v = (val[val.length - 2] * wt[wt.length - 2] + val[val.length - 1] * wt[wt.length - 1]) / w;
      const l = len[len.length - 2] + len[len.length - 1];
      val.splice(-2, 2, v);
      wt.splice(-2, 2, w);
      len.splice(-2, 2, l);
    }
  });
  const out: number[] = [];
  val.forEach((v, i) => {
    for (let k = 0; k < len[i]; k++) out.push(v);
  });
  return out;
}

export interface ProbPair {
  p: number;
  y: 0 | 1;
}

/**
 * Indukcyjny predyktor Venna–Abersa dla nowego p: dopasowanie izotoniczne zbioru kalibracyjnego z dołączonym (p, 0)
 * i (p, 1) → [p0, p1]; scalone p = p1 / (1 − p0 + p1). Pusty zbiór → p bez zmian.
 */
export function vennAbers(cal: ProbPair[], p: number): { p0: number; p1: number; p: number } {
  if (cal.length === 0) return { p0: p, p1: p, p };
  const fitAt = (label: 0 | 1) => {
    const pts = [...cal.map((c) => ({ p: c.p, y: c.y as number, test: false })), { p, y: label as number, test: true }];
    // Remisy po p: test na końcu grupy dla etykiety 1 i na początku dla 0 — bez wpływu na wynik dopasowania (wspólny blok)
    pts.sort((a, b) => a.p - b.p);
    // Grupowanie równych p (PAV na średnich z wagą liczności)
    const groups: { p: number; sum: number; n: number; hasTest: boolean }[] = [];
    for (const q of pts) {
      const g = groups[groups.length - 1];
      if (g && g.p === q.p) {
        g.sum += q.y;
        g.n++;
        g.hasTest ||= q.test;
      } else groups.push({ p: q.p, sum: q.y, n: 1, hasTest: q.test });
    }
    const fit = isotonic(
      groups.map((g) => g.sum / g.n),
      groups.map((g) => g.n)
    );
    // isotonic zwraca wartość na element wejścia (grupę)
    return fit[groups.findIndex((g) => g.hasTest)];
  };
  const p0 = fitAt(0);
  const p1 = fitAt(1);
  return { p0, p1, p: p1 / (1 - p0 + p1) };
}

/** Średni błąd kwadratowy prawdopodobieństw (Brier); brak par → null. */
export function brier(pairs: ProbPair[]): number | null {
  if (pairs.length === 0) return null;
  return pairs.reduce((a, c) => a + (c.p - c.y) ** 2, 0) / pairs.length;
}

/** Diagram niezawodności: koszyki równej szerokości po p; częstość null w pustym koszyku. */
export function reliability(pairs: ProbPair[], bins = 10): { lo: number; hi: number; n: number; meanP: number | null; freq: number | null }[] {
  const out = Array.from({ length: bins }, (_, i) => ({ lo: i / bins, hi: (i + 1) / bins, n: 0, sumP: 0, sumY: 0 }));
  for (const c of pairs) {
    const i = Math.min(bins - 1, Math.max(0, Math.floor(c.p * bins)));
    out[i].n++;
    out[i].sumP += c.p;
    out[i].sumY += c.y;
  }
  return out.map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, meanP: b.n ? b.sumP / b.n : null, freq: b.n ? b.sumY / b.n : null }));
}
