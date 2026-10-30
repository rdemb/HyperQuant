/**
 * Klocki wskaźników liczone przyrostowo, z konwencjami Pine (`ta.*`) TradingView. Każdy ma `next(x, keep)`:
 * `keep = true` zatwierdza wartość zamkniętej świecy, `keep = false` liczy bieżącą świecę bez zmiany stanu (podgląd
 * po każdej transakcji). Koszt O(1) na świecę; NaN = brak wartości (rozbieg, jak `na` w Pine).
 */

/**
 * Średnia wygładzana z rozbiegiem średnią prostą: NaN do n-tej wartości, na niej średnia z n wartości, dalej
 * v = α·x + (1 − α)·v. RMA Wildera (`ta.rma`) ma α = 1/n, EMA (`ta.ema`) α = 2/(n + 1). Rozbieg EMA jak we
 * wbudowanej `ta.ema` (przykład `pine_ema` w dokumentacji startuje od pierwszej wartości; różnica znika po kilku n świecach).
 */
export class Smooth {
  private v = Number.NaN;
  private sum = 0;
  private count = 0;

  constructor(
    private readonly n: number,
    private readonly alpha: number
  ) {}

  next(x: number, keep: boolean): number {
    let v: number;
    if (this.count < this.n) {
      const sum = this.sum + x;
      const count = this.count + 1;
      v = count === this.n ? sum / this.n : Number.NaN;
      if (keep) {
        this.sum = sum;
        this.count = count;
      }
    } else v = this.alpha * x + (1 - this.alpha) * this.v;
    if (keep) this.v = v;
    return v;
  }
}

export const ema = (n: number) => new Smooth(n, 2 / (n + 1));
export const rma = (n: number) => new Smooth(n, 1 / n);

/**
 * Okno n ostatnich wartości: średnia (`ta.sma`) i odchylenie standardowe populacyjne, z dzielnikiem n (`ta.stdev`,
 * `biased = true`, jak w Bollingerze TradingView). Sumy względem ceny odniesienia, liczone od nowa co n zatwierdzeń —
 * bez utraty precyzji przy kwadratach cen rzędu 10^10 i bez narastania błędu zaokrągleń. NaN (`na` w Pine) jest
 * pomijane jak we wbudowanych funkcjach Pine: okno to n ostatnich liczb, a świeca z NaN dostaje wartość z nich.
 */
export class Window {
  mean = Number.NaN;
  sd = Number.NaN;
  private readonly buf: Float64Array;
  private head = 0;
  private count = 0;
  private ref = 0;
  private s = 0;
  private ss = 0;
  private since = 0;

  constructor(private readonly n: number) {
    this.buf = new Float64Array(n);
  }

  next(x: number, keep: boolean): void {
    if (Number.isNaN(x)) {
      this.set(this.count, this.ref, this.s, this.ss);
      return;
    }
    const n = this.n;
    const full = this.count === n;
    const ref = this.count === 0 ? x : this.ref;
    const d = x - ref;
    const o = full ? this.buf[this.head] - ref : 0;
    const s = this.s + d - o;
    const ss = this.ss + d * d - o * o;
    const count = full ? n : this.count + 1;
    this.set(count, ref, s, ss);
    if (!keep) return;
    this.buf[this.head] = x;
    this.head = (this.head + 1) % n;
    this.count = count;
    this.ref = ref;
    this.s = s;
    this.ss = ss;
    if (++this.since >= n) this.reanchor(x);
  }

  private set(count: number, ref: number, s: number, ss: number): void {
    if (count === this.n) {
      const m = s / this.n;
      this.mean = ref + m;
      this.sd = Math.sqrt(Math.max(0, ss / this.n - m * m));
    } else this.mean = this.sd = Number.NaN;
  }

  private reanchor(ref: number): void {
    this.ref = ref;
    this.s = this.ss = 0;
    for (let k = 0; k < this.count; k++) {
      const d = this.buf[k] - ref;
      this.s += d;
      this.ss += d * d;
    }
    this.since = 0;
  }
}

/**
 * Najwyższa (`ta.highest`, `sign = 1`) albo najniższa (`ta.lowest`, `sign = −1`) z n ostatnich wartości. Kolejka
 * monotoniczna n − 1 zatwierdzonych wartości: bieżąca świeca jest porównywana z jej czołem, więc podgląd nie zmienia stanu.
 */
export class Extreme {
  private readonly vals: number[] = [];
  private readonly idx: number[] = [];
  private head = 0;
  private i = 0;

  constructor(
    private readonly n: number,
    private readonly sign: 1 | -1
  ) {}

  next(x: number, keep: boolean): number {
    const better = (a: number, b: number) => (a - b) * this.sign > 0;
    const v = this.i + 1 < this.n ? Number.NaN : this.head < this.vals.length && better(this.vals[this.head], x) ? this.vals[this.head] : x;
    if (keep) {
      // Wartości słabsze od nowej już nigdy nie będą skrajne
      while (this.vals.length > this.head && !better(this.vals[this.vals.length - 1], x)) {
        this.vals.pop();
        this.idx.pop();
      }
      this.vals.push(x);
      this.idx.push(this.i);
      this.i++;
      // W kolejce zostaje n − 1 ostatnich świec (bieżąca dochodzi przy następnym wywołaniu)
      while (this.idx[this.head] <= this.i - this.n) this.head++;
      if (this.head > 1024) {
        this.vals.splice(0, this.head);
        this.idx.splice(0, this.head);
        this.head = 0;
      }
    }
    return v;
  }
}

/**
 * Średnia ważona liniowo n ostatnich wartości (`ta.wma`): najnowsza waga n, najstarsza 1, dzielnik n(n + 1)/2. Sumy
 * względem wartości odniesienia, liczone od nowa co n zatwierdzeń, jak w `Window`. NaN jest pomijane jak w `Window`.
 */
export class Wma {
  private readonly buf: Float64Array;
  private head = 0;
  private count = 0;
  private ref = 0;
  /** Suma odchyleń od `ref` i suma ważona (najnowsza waga = liczba wartości w oknie). */
  private s = 0;
  private w = 0;
  private since = 0;

  constructor(private readonly n: number) {
    this.buf = new Float64Array(n);
  }

  next(x: number, keep: boolean): number {
    const n = this.n;
    if (Number.isNaN(x)) return this.count === n ? this.ref + this.w / ((n * (n + 1)) / 2) : Number.NaN;
    const full = this.count === n;
    const ref = this.count === 0 ? x : this.ref;
    const d = x - ref;
    // Pełne okno: każda starsza wartość traci 1 z wagi, najstarsza (waga 1) wypada
    const w = full ? this.w + n * d - this.s : this.w + (this.count + 1) * d;
    const s = this.s + d - (full ? this.buf[this.head] - ref : 0);
    const count = full ? n : this.count + 1;
    if (keep) {
      this.buf[this.head] = x;
      this.head = (this.head + 1) % n;
      this.count = count;
      this.ref = ref;
      this.s = s;
      this.w = w;
      if (++this.since >= n) this.reanchor(x);
    }
    return count === n ? ref + w / ((n * (n + 1)) / 2) : Number.NaN;
  }

  private reanchor(ref: number): void {
    this.ref = ref;
    this.s = this.w = 0;
    // Od najstarszej (waga 1) do najnowszej (waga count)
    const start = this.count === this.n ? this.head : 0;
    for (let k = 0; k < this.count; k++) {
      const d = this.buf[(start + k) % this.n] - ref;
      this.s += d;
      this.w += (k + 1) * d;
    }
    this.since = 0;
  }
}

/** Mediana pierwszych `n` liczb tablicy wyborem Hoare'a (średnio O(n)); kolejność liczb w tablicy się zmienia. */
export function medianInPlace(a: Float64Array, n: number): number {
  const m = n >> 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        const t = a[i];
        a[i++] = a[j];
        a[j--] = t;
      }
    }
    if (m <= j) hi = j;
    else if (m >= i) lo = i;
    else break;
  }
  if (n % 2 === 1) return a[m];
  // Parzysta liczba: druga środkowa to największa z liczb przed `m` (po wyborze wszystkie są ≤ a[m])
  let below = Number.NEGATIVE_INFINITY;
  for (let k = 0; k < m; k++) if (a[k] > below) below = a[k];
  return (below + a[m]) / 2;
}

/**
 * Prosta Theila–Sena (nachylenie = mediana nachyleń par, wyraz wolny = mediana reszt) i rozrzut reszt z MAD
 * (× 1,4826 — odchylenie standardowe przy rozkładzie normalnym): odporne na pojedyncze skrajne punkty, w przeciwieństwie
 * do zwykłej regresji. Bufory na okno do `n` punktów.
 */
export class RobustLine {
  private readonly slopes: Float64Array;
  private readonly res: Float64Array;

  constructor(n: number) {
    this.slopes = new Float64Array((n * (n - 1)) / 2);
    this.res = new Float64Array(n);
  }

  /** Dopasowanie do `n` punktów (x, y); null, gdy wszystkie x są równe. */
  fit(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number): { alpha: number; beta: number; scale: number } | null {
    let k = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (xs[j] !== xs[i]) this.slopes[k++] = (ys[j] - ys[i]) / (xs[j] - xs[i]);
    if (k === 0) return null;
    const beta = medianInPlace(this.slopes, k);
    for (let i = 0; i < n; i++) this.res[i] = ys[i] - beta * xs[i];
    const alpha = medianInPlace(this.res, n);
    // Mediana reszt to zero (z definicji wyrazu wolnego), więc MAD to mediana ich wartości bezwzględnych
    for (let i = 0; i < n; i++) this.res[i] = Math.abs(ys[i] - alpha - beta * xs[i]);
    return { alpha, beta, scale: 1.4826 * medianInPlace(this.res, n) };
  }
}

/** Regresja y = α + β·x (MNK) z ostatnich `n` par: sumy kroczące, wynik jak `olsFit` na tych parach. */
export class OlsWindow {
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private k = 0;
  count = 0;
  private sx = 0;
  private sy = 0;
  private sxx = 0;
  private sxy = 0;
  private syy = 0;

  constructor(readonly n: number) {
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
  }

  push(x: number, y: number): void {
    if (this.count === this.n) this.add(this.xs[this.k], this.ys[this.k], -1);
    else this.count++;
    this.xs[this.k] = x;
    this.ys[this.k] = y;
    this.add(x, y, 1);
    this.k = (this.k + 1) % this.n;
  }

  /** Dopasowanie z par w oknie; null, gdy x albo y się nie zmienia (R² nieokreślone). */
  fit(): { alpha: number; beta: number; r2: number } | null {
    const m = this.count;
    const cxx = this.sxx - (this.sx * this.sx) / m;
    const cxy = this.sxy - (this.sx * this.sy) / m;
    const cyy = this.syy - (this.sy * this.sy) / m;
    if (!(cxx > 0) || !(cyy > 0)) return null;
    const beta = cxy / cxx;
    return { alpha: (this.sy - beta * this.sx) / m, beta, r2: Math.min(1, (cxy * cxy) / (cxx * cyy)) };
  }

  private add(x: number, y: number, s: number): void {
    this.sx += s * x;
    this.sy += s * y;
    this.sxx += s * x * x;
    this.sxy += s * x * y;
    this.syy += s * y * y;
  }
}
