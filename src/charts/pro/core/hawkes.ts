/**
 * Endogeniczność taśmy: współczynnik rozgałęzienia n procesu Hawkesa z jądrem wykładniczym, λ(t) = μ + n·β·Σ e^{−β(t − tᵢ)},
 * dopasowany metodą największej wiarygodności w jednym oknie, z 95% przedziałem z profilu wiarygodności. n to oczekiwana
 * liczba zdarzeń wywołanych przez jedno zdarzenie, czyli w stanie stacjonarnym udział zdarzeń „z wnętrza” taśmy.
 *
 * Przy stałym β log-wiarygodność ℓ(μ, n) = Σ ln(μ + n·aᵢ) − μT − n·S jest wklęsła w (μ, n) (aᵢ = β·Σ_{j<i} e^{−β(tᵢ − tⱼ)},
 * S = Σ (1 − e^{−β(T − tᵢ)})), więc dla każdego β maksimum jest jedno i znajduje je metoda Newtona. Po β szukamy na siatce
 * logarytmicznej z dokładnieniem złotym podziałem — bez lokalnych maksimów, w które wpada sympleks na prawdziwej taśmie.
 * Przedział n: zbiór n z profilem ≥ ℓ* − χ²₁(0,95)/2, czyli suma po β przedziałów, w których wklęsły profil po μ
 * przekracza próg. Wynik zależy tylko od czasów zdarzeń w oknie (bez startu z poprzedniego okna).
 */

/** Spadek log-wiarygodności na granicy przedziału 95%: χ²₁(0,95)/2. */
const DROP = 3.841458820694124 / 2;
/** Górna granica n (proces stacjonarny: n < 1). */
export const N_MAX = 0.99;
/** Najmniej zdarzeń w oknie. */
export const MIN_EVENTS = 100;
/**
 * Zakres β (1/s): półokres wygasania pobudzenia od ok. 7 ms do 1/10 okna — wolniejsze pobudzenie nie różni się w oknie od
 * zmiany napływu z zewnątrz (μ), a zawyżałoby n. Siatka co ok. 1,5×.
 */
const LOG_BETA_HI = Math.log(1e2);
const SLOWEST = 0.1;
const GRID = Math.log(1.5);
/** Krok po β przy wyznaczaniu przedziału. */
const FINE = 0.1;

export interface Branching {
  n: number;
  /** 95% przedział z profilu wiarygodności. */
  lo: number;
  hi: number;
  /** Intensywność zdarzeń z zewnątrz (1/s) i szybkość wygasania pobudzenia (1/s). */
  mu: number;
  beta: number;
  events: number;
}

/** Jądro przy danym β: aᵢ do `a`, zwraca S. */
function kernel(ts: Float64Array, T: number, beta: number, a: Float64Array): number {
  let A = 0;
  let s = 0;
  for (let i = 0; i < ts.length; i++) {
    if (i > 0) A = Math.exp(-beta * (ts[i] - ts[i - 1])) * (1 + A);
    a[i] = beta * A;
    s += 1 - Math.exp(-beta * (T - ts[i]));
  }
  return s;
}

function logLik(a: Float64Array, N: number, s: number, T: number, mu: number, n: number): number {
  let ll = 0;
  for (let i = 0; i < N; i++) ll += Math.log(mu + n * a[i]);
  return ll - mu * T - n * s;
}

/** Najlepsze μ przy stałym n (wklęsłe w μ; Newton z zabezpieczeniem μ > 0); zwraca μ. */
function muAt(a: Float64Array, N: number, T: number, n: number, mu: number): number {
  for (let it = 0; it < 60; it++) {
    let g = -T;
    let h = 0;
    for (let i = 0; i < N; i++) {
      const r = 1 / (mu + n * a[i]);
      g += r;
      h += r * r;
    }
    const d = g / h;
    const next = mu + d > 0 ? mu + d : mu / 2;
    if (Math.abs(next - mu) <= 1e-10 * mu) return next;
    mu = next;
  }
  return mu;
}

/** Największe y z wierzchołkiem paraboli przez najlepszy punkt i jego sąsiadów (x rosnąco). */
function extreme(xs: readonly number[], ys: readonly number[]): number {
  let k = 0;
  for (let i = 1; i < ys.length; i++) if (ys[i] > ys[k]) k = i;
  if (k === 0 || k === ys.length - 1) return ys[k];
  const [x0, x1, x2] = [xs[k - 1], xs[k], xs[k + 1]];
  const [y0, y1, y2] = [ys[k - 1], ys[k], ys[k + 1]];
  // Postać Newtona: y = y1 + b·(x − x1) + c·(x − x1)·(x − x0)
  const d01 = (y1 - y0) / (x1 - x0);
  const d12 = (y2 - y1) / (x2 - x1);
  const c = (d12 - d01) / (x2 - x0);
  if (!(c < 0)) return y1;
  const b = d01 + c * (x1 - x0);
  return y1 - (b * b) / (4 * c);
}

/** Profil po μ przy stałych β i n: log-wiarygodność, jej pochodna po n (twierdzenie o obwiedni) i najlepsze μ. */
function profileAt(a: Float64Array, N: number, s: number, T: number, n: number, mu0: number): { mu: number; ll: number; d: number } {
  const mu = muAt(a, N, T, n, mu0);
  let ll = 0;
  let d = -s;
  for (let i = 0; i < N; i++) {
    const lam = mu + n * a[i];
    ll += Math.log(lam);
    d += a[i] / lam;
  }
  return { mu, ll: ll - mu * T - n * s, d };
}

/** Maksimum ℓ(μ, n) przy stałym β (Newton z rzutem n na [0, N_MAX] i połowieniem kroku). */
function fitAt(a: Float64Array, N: number, s: number, T: number, start: { mu: number; n: number }): { mu: number; n: number; ll: number } {
  let { mu, n } = start;
  let ll = logLik(a, N, s, T, mu, n);
  for (let it = 0; it < 100; it++) {
    let gm = -T;
    let gn = -s;
    let hmm = 0;
    let hmn = 0;
    let hnn = 0;
    for (let i = 0; i < N; i++) {
      const r = 1 / (mu + n * a[i]);
      const ra = r * a[i];
      gm += r;
      gn += ra;
      hmm += r * r;
      hmn += r * ra;
      hnn += ra * ra;
    }
    // Hesjan to −[hmm hmn; hmn hnn]; n na granicy z gradientem na zewnątrz — krok tylko w μ
    let dm: number;
    let dn: number;
    if ((n <= 0 && gn <= 0) || (n >= N_MAX && gn >= 0)) {
      dm = gm / hmm;
      dn = 0;
    } else {
      const det = hmm * hnn - hmn * hmn;
      dm = (gm * hnn - gn * hmn) / det;
      dn = (gn * hmm - gm * hmn) / det;
      if (!Number.isFinite(dm) || !Number.isFinite(dn)) {
        dm = gm / hmm;
        dn = 0;
      }
    }
    const dec = gm * dm + gn * dn;
    if (!(dec > 1e-12)) break;
    let t = 1;
    if (mu + dm <= 0) t = (0.9 * mu) / -dm;
    let accepted = false;
    for (let k = 0; k < 40; k++, t /= 2) {
      const m2 = mu + t * dm;
      const n2 = Math.min(N_MAX, Math.max(0, n + t * dn));
      const l2 = logLik(a, N, s, T, m2, n2);
      if (l2 >= ll) {
        accepted = l2 - ll > 1e-12 * Math.abs(ll);
        mu = m2;
        n = n2;
        ll = l2;
        break;
      }
    }
    if (!accepted) break;
  }
  return { mu, n, ll };
}

/**
 * n z przedziałem z czasów zdarzeń `ts` (sekundy od początku okna, rosnąco, bez powtórzeń) w oknie długości `T` sekund;
 * null przy mniej niż MIN_EVENTS zdarzeniach.
 */
export function fitBranching(ts: Float64Array, T: number): Branching | null {
  const N = ts.length;
  if (N < MIN_EVENTS) return null;
  const a = new Float64Array(N);
  const lbLo = Math.log(Math.LN2 / (SLOWEST * T));
  // Profil po β: siatka (start każdego punktu z poprzedniego), potem złoty podział między sąsiadami najlepszego
  const steps = Math.max(2, Math.ceil((LOG_BETA_HI - lbLo) / GRID));
  let start = { mu: (0.5 * N) / T, n: 0.5 };
  const grid: { lb: number; mu: number; n: number; ll: number }[] = [];
  for (let k = 0; k <= steps; k++) {
    const lb = lbLo + (k * (LOG_BETA_HI - lbLo)) / steps;
    const s = kernel(ts, T, Math.exp(lb), a);
    const f = fitAt(a, N, s, T, start);
    grid.push({ lb, ...f });
    start = f;
  }
  let kb = 0;
  for (let k = 1; k < grid.length; k++) if (grid[k].ll > grid[kb].ll) kb = k;
  const at = (lb: number, from: { mu: number; n: number }) => ({ lb, ...fitAt(a, N, kernel(ts, T, Math.exp(lb), a), T, from) });
  let best = grid[kb];
  let x0 = grid[Math.max(0, kb - 1)].lb;
  let x3 = grid[Math.min(grid.length - 1, kb + 1)].lb;
  const G = (Math.sqrt(5) - 1) / 2;
  let p1 = at(x3 - G * (x3 - x0), best);
  let p2 = at(x0 + G * (x3 - x0), best);
  while (x3 - x0 > 1e-3) {
    if (p1.ll >= p2.ll) {
      x3 = p2.lb;
      p2 = p1;
      p1 = at(x3 - G * (x3 - x0), p2);
    } else {
      x0 = p1.lb;
      p1 = p2;
      p2 = at(x0 + G * (x3 - x0), p1);
    }
  }
  for (const p of [p1, p2]) if (p.ll > best.ll) best = p;

  // Przedział: β co FINE w obie strony od najlepszego (ostatni krok na krańcu zakresu), dopóki maksimum przy β przekracza
  // próg; przy każdym β granice, w których wklęsły (w n) profil po μ spada do progu
  const cut = best.ll - DROP;
  const walk: { lb: number; lo: number; hi: number }[] = [];
  for (const dir of [-1, 1]) {
    let from: { mu: number; n: number } = best;
    const end = dir < 0 ? lbLo : LOG_BETA_HI;
    for (let lb = best.lb + (dir > 0 ? FINE : 0), last = dir > 0 && best.lb >= end - 1e-9; !last; lb += dir * FINE) {
      if ((end - lb) * dir <= 1e-9) {
        lb = end;
        last = true;
      }
      const s = kernel(ts, T, Math.exp(lb), a);
      const f = fitAt(a, N, s, T, from);
      if (f.ll < cut) break;
      from = f;
      const [lo, hi] = [0, N_MAX].map((edge) => {
        // Od krańca poza przedziałem Newton zbliża się do granicy monotonicznie (profil wklęsły)
        let x = edge;
        let p = profileAt(a, N, s, T, x, f.mu);
        for (let it = 0; it < 50 && p.ll < cut; it++) {
          const y = Math.min(Math.max(x + (cut - p.ll) / p.d, Math.min(x, f.n)), Math.max(x, f.n));
          const done = Math.abs(y - x) < 1e-5;
          x = y;
          if (done) break;
          p = profileAt(a, N, s, T, x, p.mu);
        }
        return x;
      });
      if (dir < 0) walk.unshift({ lb, lo, hi });
      else walk.push({ lb, lo, hi });
    }
  }
  // Skrajne granice po β z dokładnieniem parabolą przez sąsiednie kroki
  const lbs = walk.map((w) => w.lb);
  const lo = Math.max(0, -extreme(lbs, walk.map((w) => -w.lo)));
  const hi = Math.min(N_MAX, extreme(lbs, walk.map((w) => w.hi)));
  return { n: best.n, lo, hi, mu: best.mu, beta: Math.exp(best.lb), events: N };
}
