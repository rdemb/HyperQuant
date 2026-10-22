/**
 * Bayesowskie wykrywanie punktów zmiany online (BOCPD; Adams & MacKay 2007) dla zwrotów o średniej 0 i nieznanej
 * precyzji: prior Gamma(α₀, β₀) na precyzję, predykcja t-Studenta z 2α stopniami swobody i skalą √(β/α).
 * Stałe ryzyko zmiany (hazard) H; rozkład długości przebiegu obcięty do rMax (ogon scalany w ostatniej komórce).
 * Wynik: rozkład długości bieżącego reżimu, najbardziej prawdopodobna długość, P(zmiany w ostatnich k obserwacjach)
 * i σ reżimu (średnia a posteriori wariancji przy najbardziej prawdopodobnej długości).
 */

export interface BocpdOptions {
  /** Prawdopodobieństwo zmiany w każdej obserwacji (1 / oczekiwana długość reżimu) */
  hazard: number;
  alpha0: number;
  beta0: number;
  /** Najdłuższy śledzony przebieg (pamięć i czas O(rMax) na obserwację) */
  rMax: number;
}

export interface BocpdState {
  /** P(długość przebiegu = r), r = 0..rMax */
  probs: number[];
  /** Najbardziej prawdopodobna długość bieżącego reżimu */
  mapRun: number;
  /** P(długość = 0) — zmiana przy ostatniej obserwacji */
  pChange: number;
  /** P(długość < 5) — zmiana w ostatnich 5 obserwacjach */
  pRecent5: number;
  /** σ reżimu: √(β/(α − 1)) przy mapRun (średnia a posteriori wariancji) */
  sigma: number;
  /** Liczba przetworzonych obserwacji */
  n: number;
}

/** ln Γ(x) — przybliżenie Lanczosa (g = 7). */
function lnGamma(x: number): number {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** ln gęstości t-Studenta (ν, położenie 0, skala s) w x. */
function lnStudent(x: number, nu: number, s: number): number {
  const z = x / s;
  return lnGamma((nu + 1) / 2) - lnGamma(nu / 2) - 0.5 * Math.log(nu * Math.PI) - Math.log(s) - ((nu + 1) / 2) * Math.log(1 + (z * z) / nu);
}

export class Bocpd {
  private readonly o: BocpdOptions;
  /** ln P(r) */
  private logR: Float64Array;
  private alpha: Float64Array;
  private beta: Float64Array;
  private len = 1;
  private count = 0;

  constructor(o: BocpdOptions) {
    this.o = o;
    this.logR = new Float64Array(o.rMax + 1).fill(Number.NEGATIVE_INFINITY);
    this.alpha = new Float64Array(o.rMax + 1);
    this.beta = new Float64Array(o.rMax + 1);
    this.logR[0] = 0;
    this.alpha[0] = o.alpha0;
    this.beta[0] = o.beta0;
  }

  update(x: number): void {
    if (!Number.isFinite(x)) return;
    const { rMax, hazard, alpha0, beta0 } = this.o;
    const lh = Math.log(hazard);
    const l1h = Math.log1p(-hazard);
    const n = this.len;
    const newLen = Math.min(n + 1, rMax + 1);
    const nlR = new Float64Array(rMax + 1).fill(Number.NEGATIVE_INFINITY);
    const na = new Float64Array(rMax + 1);
    const nb = new Float64Array(rMax + 1);
    // Zmiana: suma po wszystkich przebiegach
    let cpMax = Number.NEGATIVE_INFINITY;
    const lp = new Float64Array(n);
    for (let r = 0; r < n; r++) {
      const a = this.alpha[r];
      const b = this.beta[r];
      lp[r] = this.logR[r] + lnStudent(x, 2 * a, Math.sqrt(b / a));
      cpMax = Math.max(cpMax, lp[r]);
    }
    let cpSum = 0;
    for (let r = 0; r < n; r++) cpSum += Math.exp(lp[r] - cpMax);
    nlR[0] = cpMax + Math.log(cpSum) + lh;
    na[0] = alpha0;
    nb[0] = beta0;
    // Wzrost: przebieg r → r + 1 (ogon obcięty — ostatnia komórka zbiera masę)
    for (let r = 0; r < n; r++) {
      const to = Math.min(r + 1, rMax);
      const v = lp[r] + l1h;
      const a1 = this.alpha[r] + 0.5;
      const b1 = this.beta[r] + (x * x) / 2;
      if (nlR[to] === Number.NEGATIVE_INFINITY) {
        nlR[to] = v;
        na[to] = a1;
        nb[to] = b1;
      } else {
        // Scalanie ogona: logsumexp i parametry z przebiegu o większej masie
        const m = Math.max(nlR[to], v);
        if (v > nlR[to]) {
          na[to] = a1;
          nb[to] = b1;
        }
        nlR[to] = m + Math.log(Math.exp(nlR[to] - m) + Math.exp(v - m));
      }
    }
    // Normalizacja
    let mx = Number.NEGATIVE_INFINITY;
    for (let r = 0; r < newLen; r++) mx = Math.max(mx, nlR[r]);
    let z = 0;
    for (let r = 0; r < newLen; r++) z += Math.exp(nlR[r] - mx);
    const lz = mx + Math.log(z);
    for (let r = 0; r < newLen; r++) nlR[r] -= lz;
    this.logR = nlR;
    this.alpha = na;
    this.beta = nb;
    this.len = newLen;
    this.count++;
  }

  state(): BocpdState {
    const probs = Array.from({ length: this.o.rMax + 1 }, (_, r) => (r < this.len ? Math.exp(this.logR[r]) : 0));
    let mapRun = 0;
    for (let r = 1; r < probs.length; r++) if (probs[r] > probs[mapRun]) mapRun = r;
    const a = this.alpha[mapRun];
    const b = this.beta[mapRun];
    return {
      probs,
      mapRun,
      pChange: probs[0],
      pRecent5: probs.slice(0, 5).reduce((s, p) => s + p, 0),
      sigma: a > 1 ? Math.sqrt(b / (a - 1)) : Math.sqrt(b / a),
      n: this.count,
    };
  }
}
