/**
 * Mikrostruktura jako mechanika — czyste funkcje z literatury zamiast heurystyk:
 *  - OFI na najlepszych kwotowaniach (Cont, Kukanov & Stoikov 2014) i regresja ΔP = α + β·OFI (wpływ, R²);
 *  - proces Hawkesa z jądrem wykładniczym (MLE, Nelder–Mead): współczynnik rozgałęzienia n = α/β — udział transakcji
 *    wywołanych przez wcześniejsze transakcje (endogeniczność; Filimonov & Sornette 2012, Hardiman i in. 2013);
 *  - mikrocena: średnia ważona ilościami (pierwsze przybliżenie) i empiryczna korekta wg nierównowagi (Stoikov 2018);
 *  - dodawanie / anulowanie / wykonanie przy poziomach (pulling / stacking) z kolejnych migawek arkusza;
 *  - absorpcja jako „wysiłek vs efekt”: reszta regresji ruchu ceny na podpisanym wolumenie agresora.
 */

export interface Quote {
  bid: number;
  bidSz: number;
  ask: number;
  askSz: number;
}

/** Zdarzenie OFI między dwiema migawkami najlepszych kwotowań (CKS 2014, równanie 2). */
export function ofiEvent(prev: Quote, cur: Quote): number {
  const bidPart = (cur.bid >= prev.bid ? cur.bidSz : 0) - (cur.bid <= prev.bid ? prev.bidSz : 0);
  const askPart = (cur.ask <= prev.ask ? cur.askSz : 0) - (cur.ask >= prev.ask ? prev.askSz : 0);
  return bidPart - askPart;
}

export interface OlsFit {
  alpha: number;
  beta: number;
  r2: number;
  n: number;
  /** Błąd standardowy β */
  seBeta: number;
}

/** Regresja liniowa y = α + β·x (MNK); brak zmienności x albo < 3 punkty → null. */
export function olsFit(xs: number[], ys: number[]): OlsFit | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (!(sxx > 0)) return null;
  const beta = sxy / sxx;
  const alpha = my - beta * mx;
  const sse = Math.max(0, syy - beta * sxy);
  const r2 = syy > 0 ? 1 - sse / syy : 1;
  const seBeta = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : Number.NaN;
  return { alpha, beta, r2, n, seBeta };
}

/** Metoda Neldera–Meada (minimalizacja bez gradientu). */
export function nelderMead(f: (x: number[]) => number, x0: number[], o: { maxIter?: number; tol?: number; step?: number[] } = {}): { x: number[]; fx: number; iter: number } {
  const n = x0.length;
  const maxIter = o.maxIter ?? 500 * n;
  const tol = o.tol ?? 1e-9;
  let simplex: { x: number[]; fx: number }[] = [{ x: x0.slice(), fx: f(x0) }];
  for (let i = 0; i < n; i++) {
    const x = x0.slice();
    x[i] += o.step?.[i] ?? 0.1 * Math.max(1, Math.abs(x0[i]));
    simplex.push({ x, fx: f(x) });
  }
  let iter = 0;
  for (; iter < maxIter; iter++) {
    simplex.sort((a, b) => a.fx - b.fx);
    if (Math.abs(simplex[n].fx - simplex[0].fx) <= tol * (Math.abs(simplex[0].fx) + tol)) break;
    const centroid = Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += simplex[i].x[j] / n;
    const worst = simplex[n];
    const at = (t: number) => centroid.map((c, j) => c + t * (worst.x[j] - c));
    const xr = at(-1);
    const fr = f(xr);
    if (fr < simplex[0].fx) {
      const xe = at(-2);
      const fe = f(xe);
      simplex[n] = fe < fr ? { x: xe, fx: fe } : { x: xr, fx: fr };
    } else if (fr < simplex[n - 1].fx) {
      simplex[n] = { x: xr, fx: fr };
    } else {
      const xc = fr < worst.fx ? at(-0.5) : at(0.5);
      const fc = f(xc);
      if (fc < Math.min(fr, worst.fx)) simplex[n] = { x: xc, fx: fc };
      else {
        const best = simplex[0].x;
        simplex = simplex.map((p, i) => {
          if (i === 0) return p;
          const x = p.x.map((v, j) => best[j] + 0.5 * (v - best[j]));
          return { x, fx: f(x) };
        });
      }
    }
  }
  simplex.sort((a, b) => a.fx - b.fx);
  return { x: simplex[0].x, fx: simplex[0].fx, iter };
}

/**
 * Log-wiarygodność procesu Hawkesa z jądrem α·e^{−βt} na [0, T] (czasy rosnąco, od 0):
 * Σ ln(μ + α·A_i) − μT − (α/β)·Σ(1 − e^{−β(T − t_i)}), A_i = e^{−β(t_i − t_{i−1})}(1 + A_{i−1}).
 */
export function hawkesLogLik(times: number[], mu: number, alpha: number, beta: number, T: number): number {
  let a = 0;
  let ll = 0;
  let comp = 0;
  for (let i = 0; i < times.length; i++) {
    if (i > 0) a = Math.exp(-beta * (times[i] - times[i - 1])) * (1 + a);
    const lam = mu + alpha * a;
    if (!(lam > 0)) return Number.NEGATIVE_INFINITY;
    ll += Math.log(lam);
    comp += beta > 0 ? 1 - Math.exp(-beta * (T - times[i])) : 0;
  }
  return ll - mu * T - (beta > 0 ? (alpha / beta) * comp : 0);
}

export interface HawkesFit {
  mu: number;
  alpha: number;
  beta: number;
  /** n = α/β: oczekiwana liczba zdarzeń „potomnych” na zdarzenie; udział endogenicznych zdarzeń w stanie stacjonarnym */
  branching: number;
  /** Półokres wygasania pobudzenia, w jednostkach czasu wejścia */
  halfLife: number;
  n: number;
  logLik: number;
}

/** MLE parametrów Hawkesa (parametryzacja logarytmiczna, warunek stacjonarności α < β); < 50 zdarzeń → null. */
export function fitHawkes(times: number[]): HawkesFit | null {
  if (times.length < 50) return null;
  const t0 = times[0];
  const ts = times.map((t) => t - t0);
  const T = ts[ts.length - 1] + 1e-9;
  const n = ts.length;
  const rate = n / T;
  const gaps = ts
    .slice(1)
    .map((t, i) => t - ts[i])
    .filter((g) => g > 0)
    .sort((a, b) => a - b);
  const beta0 = gaps.length ? 1 / Math.max(gaps[Math.floor(gaps.length / 2)], 1e-6) : 1;
  const neg = ([lm, la, lb]: number[]) => {
    const mu = Math.exp(lm);
    const alpha = Math.exp(la);
    const beta = Math.exp(lb);
    if (alpha >= beta * 0.999) return 1e12 + alpha / beta;
    const ll = hawkesLogLik(ts, mu, alpha, beta, T);
    return Number.isFinite(ll) ? -ll : 1e12;
  };
  const r = nelderMead(neg, [Math.log(rate * 0.5), Math.log(beta0 * 0.4), Math.log(beta0)], { maxIter: 2000, tol: 1e-10, step: [0.5, 0.5, 0.5] });
  const [mu, alpha, beta] = r.x.map(Math.exp);
  if (!(r.fx < 1e11)) return null;
  return { mu, alpha, beta, branching: alpha / beta, halfLife: Math.LN2 / beta, n, logLik: -r.fx };
}

/** Średnia ważona ilościami na najlepszych poziomach (pierwsze przybliżenie mikroceny). */
export function weightedMid(bid: number, bidSz: number, ask: number, askSz: number): number {
  const tot = bidSz + askSz;
  return tot > 0 ? (bid * askSz + ask * bidSz) / tot : (bid + ask) / 2;
}

/**
 * Empiryczna korekta mikroceny (Stoikov 2018, przybliżenie jednokrokowe): średnia przyszła zmiana mid w koszykach
 * nierównowagi I = bidSz/(bidSz + askSz) i R² tej predykcji. Mikrocena = mid + g(I).
 */
export function imbalanceAdjustment(samples: { imb: number; dmid: number }[], bins = 10): { g: (number | null)[]; n: number[]; r2: number | null } {
  const sum = Array<number>(bins).fill(0);
  const cnt = Array<number>(bins).fill(0);
  const bin = (x: number) => Math.min(bins - 1, Math.max(0, Math.floor(x * bins)));
  for (const s of samples) {
    if (!Number.isFinite(s.imb) || !Number.isFinite(s.dmid)) continue;
    sum[bin(s.imb)] += s.dmid;
    cnt[bin(s.imb)]++;
  }
  const g = sum.map((v, i) => (cnt[i] ? v / cnt[i] : null));
  const valid = samples.filter((s) => Number.isFinite(s.imb) && Number.isFinite(s.dmid));
  if (valid.length < 3) return { g, n: cnt, r2: null };
  const m = valid.reduce((a, s) => a + s.dmid, 0) / valid.length;
  let sst = 0;
  let sse = 0;
  for (const s of valid) {
    sst += (s.dmid - m) ** 2;
    sse += (s.dmid - (g[bin(s.imb)] ?? m)) ** 2;
  }
  return { g, n: cnt, r2: sst > 0 ? 1 - sse / sst : null };
}

export interface BookSide {
  px: number;
  sz: number;
}

export interface FlowParts {
  added: number;
  cancelled: number;
  executed: number;
}

/**
 * Dodane / anulowane / wykonane (BTC) przy poziomach w paśmie ±bandBps od mid między dwiema migawkami arkusza.
 * Na poziomie: Δ = ilość_teraz − ilość_wcześniej; wykonanie = transakcje biorców po tej cenie (kupno trafia w ask,
 * sprzedaż w bid); dodane = max(0, Δ + wykonanie), anulowane = max(0, −Δ − wykonanie).
 * Migawki publicznego API nie pokazują zdarzeń między nimi — to bilans netto, nie zapis każdego zlecenia.
 */
export function addCancel(
  prev: { bids: BookSide[]; asks: BookSide[] },
  cur: { bids: BookSide[]; asks: BookSide[] },
  trades: { px: number; sz: number; side: 'buy' | 'sell' }[],
  mid: number,
  bandBps: number
): { bid: FlowParts; ask: FlowParts } {
  const lo = mid * (1 - bandBps / 1e4);
  const hi = mid * (1 + bandBps / 1e4);
  const side = (p: BookSide[], c: BookSide[], hitBy: 'buy' | 'sell'): FlowParts => {
    const before = new Map(p.filter((l) => l.px >= lo && l.px <= hi).map((l) => [l.px, l.sz]));
    const after = new Map(c.filter((l) => l.px >= lo && l.px <= hi).map((l) => [l.px, l.sz]));
    const exec = new Map<number, number>();
    for (const t of trades) if (t.side === hitBy && t.px >= lo && t.px <= hi) exec.set(t.px, (exec.get(t.px) ?? 0) + t.sz);
    const out: FlowParts = { added: 0, cancelled: 0, executed: 0 };
    for (const px of new Set([...before.keys(), ...after.keys()])) {
      const d = (after.get(px) ?? 0) - (before.get(px) ?? 0);
      const e = exec.get(px) ?? 0;
      out.added += Math.max(0, d + e);
      out.cancelled += Math.max(0, -d - e);
      out.executed += e;
    }
    const r = (x: number) => Math.round(x * 1e8) / 1e8;
    return { added: r(out.added), cancelled: r(out.cancelled), executed: r(out.executed) };
  };
  return { bid: side(prev.bids, cur.bids, 'sell'), ask: side(prev.asks, cur.asks, 'buy') };
}

export interface AbsorptionEvent {
  t: number;
  /** buy = agresywne kupno pochłonięte przez pasywnych sprzedających; sell — odwrotnie */
  side: 'buy' | 'sell';
  signedVol: number;
  expected: number;
  realized: number;
  /** Reszta w odchyleniach standardowych (ujemna względem kierunku wysiłku) */
  score: number;
}

/**
 * Absorpcja = „wysiłek vs efekt”: ΔP = α + λ·V (V — podpisany wolumen agresora w interwale), dopasowanie odporne
 * (drugi przebieg bez reszt > 3σ). Zdarzenie: |V| ≥ z·σ_V i reszta przeciwna do kierunku wysiłku o ≥ 2σ reszt.
 */
export function absorption(intervals: { t: number; signedVol: number; dmid: number }[], z = 2): { lambda: number | null; r2: number | null; events: AbsorptionEvent[] } {
  const xs = intervals.map((i) => i.signedVol);
  const ys = intervals.map((i) => i.dmid);
  const first = olsFit(xs, ys);
  if (!first) return { lambda: null, r2: null, events: [] };
  const res1 = intervals.map((i) => i.dmid - first.alpha - first.beta * i.signedVol);
  const s1 = Math.sqrt(res1.reduce((a, r) => a + r * r, 0) / Math.max(1, res1.length - 2));
  const keep = intervals.filter((_, k) => Math.abs(res1[k]) <= 3 * s1);
  const fit =
    olsFit(
      keep.map((i) => i.signedVol),
      keep.map((i) => i.dmid)
    ) ?? first;
  const res = intervals.map((i) => i.dmid - fit.alpha - fit.beta * i.signedVol);
  const inl = keep.map((i) => i.dmid - fit.alpha - fit.beta * i.signedVol);
  const sRes = Math.sqrt(inl.reduce((a, r) => a + r * r, 0) / Math.max(1, inl.length - 2)) || 1e-12;
  const mV = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sV = Math.sqrt(xs.reduce((a, b) => a + (b - mV) ** 2, 0) / Math.max(1, xs.length - 1)) || 1e-12;
  const events: AbsorptionEvent[] = [];
  intervals.forEach((iv, k) => {
    if (Math.abs(iv.signedVol - mV) < z * sV) return;
    const dir = Math.sign(iv.signedVol);
    const score = (dir * res[k]) / sRes;
    if (score <= -2 && fit.beta * dir > 0) {
      events.push({ t: iv.t, side: dir > 0 ? 'buy' : 'sell', signedVol: iv.signedVol, expected: fit.alpha + fit.beta * iv.signedVol, realized: iv.dmid, score });
    }
  });
  return { lambda: fit.beta, r2: fit.r2, events };
}
