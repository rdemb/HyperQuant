/**
 * Ensemble „model desku + rynek predykcyjny” — uogólniony pooling logarytmiczny:
 * logit p_e = a + b_m·logit(p_model) + b_k·logit(p_rynek). Wagi dopasowywane na rozstrzygniętych parach z dziennika
 * (regresja logistyczna z normalnym priorem w stronę równego poolingu b_m = b_k = ½, a = 0, i wagami obserwacji
 * zanikającymi w czasie). Suma b > 1 = „ekstremizacja” (Satopää i in. 2014), b_m ≈ 0 = model nic nie dodaje do rynku.
 * Tryb `market` — punkt odniesienia: rekalibracja samej ceny rynku (b_m = 0, prior a = 0, b_k = 1); różnica ensemble
 * vs rynek skalibrowany to wartość dodana modelu (sama rekalibracja usuwa np. błąd faworyt–outsider).
 * Genest & Zidek (1986) — pooling opinii; Ranjan & Gneiting (2010) — kombinacje prognoz prawdopodobieństwa.
 *
 * Dopasowanie deterministyczne (ten sam wynik w skanerze i w weryfikatorze): okno [now − 30 dni, now), pary w kolejności
 * podanej przez wywołującego, metoda Newtona z ograniczeniem kroku (|Δ| ≤ 1) i backtrackingiem na karanej funkcji celu;
 * brak zbieżności albo cel gorszy niż w priorze → prior.
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
/** Rekalibracja samego rynku — prior: cena rynku bez zmian */
export const REC_PRIOR: EnsWeights = { a: 0, bm: 0, bk: 1, n: 0 };
/** Okno dopasowania (dni przed chwilą wydania) */
export const ENS_WINDOW_DAYS = 30;

const DAY = 86_400_000;
const EPS = 1e-4;
export const logit = (p: number) => {
  const q = Math.min(1 - EPS, Math.max(EPS, p));
  return Math.log(q / (1 - q));
};
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
/** ln(1 + eᶻ) bez przepełnienia */
const softplus = (z: number) => (z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z)));

/** p ensemble z wag i dwóch prawdopodobieństw. */
export function poolProb(w: EnsWeights, pm: number, pk: number): number {
  return sigmoid(w.a + w.bm * logit(pm) + w.bk * logit(pk));
}

/** Rozwiązanie małego układu (eliminacja Gaussa z wyborem elementu głównego); null = osobliwy. */
function solve(A: number[][], b: number[]): number[] | null {
  const k = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= k; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((r, i) => r[k] / M[i][i]);
}

export interface EnsFitOptions {
  /** Okres półtrwania wagi obserwacji (dni) */
  halfLifeDays?: number;
  /** Odchylenie priora współczynników (siła ściągania do priora) */
  tau?: number;
  /** Poniżej tylu par — prior */
  minN?: number;
  iters?: number;
  /** full — model i rynek; market — rekalibracja samego rynku (b_m = 0) */
  mode?: 'full' | 'market';
}

/**
 * Dopasowanie wag na parach rozstrzygniętych w oknie [now − 30 dni, now). Za mało par, brak zbieżności albo cel nie
 * lepszy niż w priorze → prior z liczbą par.
 */
export function fitEnsemble(pairs: readonly EnsPair[], now: number, o: EnsFitOptions = {}): EnsWeights {
  const { halfLifeDays = 14, tau = 0.5, minN = 50, iters = 50, mode = 'full' } = o;
  const base = mode === 'market' ? REC_PRIOR : ENS_PRIOR;
  const from = now - ENS_WINDOW_DAYS * DAY;
  const use = pairs.filter((p) => p.t < now && p.t >= from && Number.isFinite(p.pm) && Number.isFinite(p.pk) && (p.y === 0 || p.y === 1));
  const n = use.length;
  const prior = { ...base, n };
  if (n < minN) return prior;
  // Parametry: full — [a, bm, bk]; market — [a, bk]
  const X = use.map((p) => (mode === 'market' ? [1, logit(p.pk)] : [1, logit(p.pm), logit(p.pk)]));
  const wt = use.map((p) => Math.pow(0.5, (now - p.t) / (halfLifeDays * DAY)));
  const b0 = mode === 'market' ? [base.a, base.bk] : [base.a, base.bm, base.bk];
  const k = b0.length;
  const lam = 1 / (tau * tau);
  const objective = (b: number[]) => {
    let j = 0;
    for (let i = 0; i < n; i++) {
      let z = 0;
      for (let c = 0; c < k; c++) z += b[c] * X[i][c];
      j += wt[i] * (softplus(z) - use[i].y * z);
    }
    for (let c = 0; c < k; c++) j += 0.5 * lam * (b[c] - b0[c]) ** 2;
    return j;
  };
  let beta = [...b0];
  let f = objective(beta);
  const fPrior = f;
  let converged = false;
  for (let it = 0; it < iters; it++) {
    const g = beta.map((b, c) => lam * (b - b0[c]));
    const H = b0.map((_, r) => b0.map((__, c) => (r === c ? lam : 0)));
    for (let i = 0; i < n; i++) {
      const x = X[i];
      let z = 0;
      for (let c = 0; c < k; c++) z += beta[c] * x[c];
      const mu = sigmoid(z);
      const r = wt[i] * (mu - use[i].y);
      const v = wt[i] * mu * (1 - mu);
      for (let a = 0; a < k; a++) {
        g[a] += r * x[a];
        for (let c = 0; c < k; c++) H[a][c] += v * x[a] * x[c];
      }
    }
    const step = solve(H, g);
    if (!step) break;
    // Ograniczenie kroku i backtracking: tylko kroki obniżające karany cel
    const big = Math.max(...step.map(Math.abs));
    let s = big > 1 ? 1 / big : 1;
    let next = beta;
    let fNext = f;
    for (let bt = 0; bt < 30; bt++) {
      const cand = beta.map((b, c) => b - s * step[c]);
      const fc = objective(cand);
      if (Number.isFinite(fc) && fc <= f) {
        next = cand;
        fNext = fc;
        break;
      }
      s /= 2;
    }
    const moved = Math.max(...next.map((b, c) => Math.abs(b - beta[c])));
    beta = next;
    const df = f - fNext;
    f = fNext;
    if (moved < 1e-9 || df < 1e-12 * Math.max(1, Math.abs(f))) {
      converged = true;
      break;
    }
  }
  if (!converged || !beta.every(Number.isFinite) || !(f <= fPrior)) return prior;
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  return mode === 'market' ? { a: r6(beta[0]), bm: 0, bk: r6(beta[1]), n } : { a: r6(beta[0]), bm: r6(beta[1]), bk: r6(beta[2]), n };
}
