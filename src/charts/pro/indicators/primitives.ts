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
 * bez utraty precyzji przy kwadratach cen rzędu 10^10 i bez narastania błędu zaokrągleń.
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
    const n = this.n;
    const full = this.count === n;
    const ref = this.count === 0 ? x : this.ref;
    const d = x - ref;
    const o = full ? this.buf[this.head] - ref : 0;
    const s = this.s + d - o;
    const ss = this.ss + d * d - o * o;
    const count = full ? n : this.count + 1;
    if (count === n) {
      const m = s / n;
      this.mean = ref + m;
      this.sd = Math.sqrt(Math.max(0, ss / n - m * m));
    } else this.mean = this.sd = Number.NaN;
    if (!keep) return;
    this.buf[this.head] = x;
    this.head = (this.head + 1) % n;
    this.count = count;
    this.ref = ref;
    this.s = s;
    this.ss = ss;
    if (++this.since >= n) this.reanchor(x);
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
