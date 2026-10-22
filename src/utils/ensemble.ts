/**
 * Ensemble „model desku + rynek predykcyjny” — uogólniony pooling logarytmiczny:
 * logit p_e = a + b_m·logit(p_model) + b_k·logit(p_rynek). Wagi dopasowywane na rozstrzygniętych parach z dziennika
 * (regresja logistyczna IRLS z normalnym priorem w stronę równego poolingu b_m = b_k = ½, a = 0, i wagami obserwacji
 * zanikającymi w czasie). Suma b > 1 = „ekstremizacja” (Satopää i in. 2014), b_m ≈ 0 = model nic nie dodaje do rynku.
 * Genest & Zidek (1986) — pooling opinii; Ranjan & Gneiting (2010) — kombinacje prognoz prawdopodobieństwa.
 */

export interface EnsWeights {
  a: number;
  bm: number;
  bk: number;
  /** Liczba par użytych do dopasowania */
  n: number;
}

export interface EnsPair {
  /** p modelu i środek rynku z chwili wydania */
  pm: number;
  pk: number;
  y: 0 | 1;
  /** Czas rozstrzygnięcia — do dopasowania tylko pary rozstrzygnięte przed chwilą dopasowania */
  t: number;
}

/** Równy pooling logarytmiczny (przed zebraniem danych) */
export const ENS_PRIOR: EnsWeights = { a: 0, bm: 0.5, bk: 0.5, n: 0 };

const EPS = 1e-4;
export const logit = (p: number) => {
  const q = Math.min(1 - EPS, Math.max(EPS, p));
  return Math.log(q / (1 - q));
};
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** p ensemble z wag i dwóch prawdopodobieństw. */
export function poolProb(w: EnsWeights, pm: number, pk: number): number {
  return sigmoid(w.a + w.bm * logit(pm) + w.bk * logit(pk));
}

/** Rozwiązanie układu 3×3 (eliminacja Gaussa z wyborem elementu głównego); null = osobliwy. */
function solve3(A: number[][], b: number[]): number[] | null {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

export interface EnsFitOptions {
  /** Okres półtrwania wagi obserwacji (dni) */
  halfLifeDays?: number;
  /** Odchylenie priora współczynników (siła ściągania do równego poolingu) */
  tau?: number;
  /** Poniżej tylu par — prior */
  minN?: number;
  iters?: number;
}

/**
 * Dopasowanie wag na parach rozstrzygniętych przed `now` (deterministyczne: Newton/IRLS z priorem, start z priora).
 * Za mało par → prior z liczbą par.
 */
export function fitEnsemble(pairs: readonly EnsPair[], now: number, o: EnsFitOptions = {}): EnsWeights {
  const { halfLifeDays = 14, tau = 0.5, minN = 50, iters = 30 } = o;
  const use = pairs.filter((p) => p.t < now && Number.isFinite(p.pm) && Number.isFinite(p.pk));
  const n = use.length;
  if (n < minN) return { ...ENS_PRIOR, n };
  const prior = [ENS_PRIOR.a, ENS_PRIOR.bm, ENS_PRIOR.bk];
  const lam = 1 / (tau * tau);
  const X = use.map((p) => [1, logit(p.pm), logit(p.pk)]);
  const wt = use.map((p) => Math.pow(0.5, (now - p.t) / (halfLifeDays * 86_400_000)));
  let beta = [...prior];
  for (let it = 0; it < iters; it++) {
    const g = [0, 0, 0].map((_, j) => -lam * (beta[j] - prior[j]));
    const H = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? lam : 0)));
    for (let i = 0; i < n; i++) {
      const x = X[i];
      const mu = sigmoid(beta[0] * x[0] + beta[1] * x[1] + beta[2] * x[2]);
      const r = wt[i] * (use[i].y - mu);
      const v = wt[i] * mu * (1 - mu);
      for (let j = 0; j < 3; j++) {
        g[j] += r * x[j];
        for (let k = 0; k < 3; k++) H[j][k] += v * x[j] * x[k];
      }
    }
    const step = solve3(H, g);
    if (!step) break;
    beta = beta.map((b, j) => b + step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-9) break;
  }
  if (!beta.every(Number.isFinite)) return { ...ENS_PRIOR, n };
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  return { a: r6(beta[0]), bm: r6(beta[1]), bk: r6(beta[2]), n };
}
