import type { Candle } from '../hl/parse';
import { intervalById } from '../core/time';
import { IndicatorInstance, Step, indicatorDef } from './registry';

/** Świeca wejścia: wystarczy świeca z API (ProBar, IndicatorBar). */
interface Bar {
  candle: Candle;
}

/** Świece interwału wskaźnika (seria rynku wczytywana przy pierwszym użyciu). */
export type CandlesOf = (tf: string) => readonly Candle[];

/** Wartości plotów instancji świeca po świecy wykresu (NaN = brak); długość tablicy bywa większa niż liczba świec (zapas). */
export interface IndicatorValues {
  out: Float64Array[];
}

/** Jedna instancja wskaźnika: wartości plotów świeca po świecy (NaN = brak). */
export class IndicatorRun implements IndicatorValues {
  out: Float64Array[];
  private step: Step;
  private readonly v: Float64Array;

  constructor(readonly x: IndicatorInstance) {
    const def = indicatorDef(x.id);
    this.step = def.create(x.params);
    this.v = new Float64Array(def.plots.length);
    this.out = def.plots.map(() => new Float64Array(0));
  }

  reset(): void {
    this.step = indicatorDef(this.x.id).create(this.x.params);
  }

  /** Świeca `i`: zatwierdzona (`keep`) albo podgląd bieżącej. */
  at(i: number, c: Candle, keep: boolean): void {
    if (i >= this.out[0].length) this.out = this.out.map((a) => grow(a, i + 1));
    this.step(c, keep, this.v);
    for (let k = 0; k < this.v.length; k++) this.out[k][i] = this.v[k];
  }
}

const grow = (a: Float64Array, min: number) => {
  const b = new Float64Array(Math.max(min, a.length * 2, 256));
  b.set(a);
  return b;
};

/**
 * Przeliczanie jednej listy świec: stan instancji jest zatwierdzony po przedostatniej (zamkniętej) świecy, a ostatnia,
 * trwająca świeca to podgląd bez zmiany stanu. Zmiana starszej świecy albo pierwszej świecy listy przelicza wszystko.
 */
class Pass {
  /** Świece z ostatniego przeliczenia: świeca z API po zmianie jest nowym obiektem, więc wystarcza porównanie referencji. */
  private seen: Candle[] = [];
  private committed = 0;

  constructor(private readonly runs: readonly IndicatorRun[]) {}

  get count(): number {
    return this.seen.length;
  }

  /** Przelicza zmienione świece; zwraca indeks pierwszej przeliczonej (liczba świec = bez zmian). */
  sync(n: number, at: (i: number) => Candle): number {
    const m = this.seen.length;
    let from = 0;
    if (n >= m) while (from < m && at(from) === this.seen[from]) from++;
    if (from === m && n === m) return n;
    let start = this.committed;
    if (from < start) {
      for (const r of this.runs) r.reset();
      start = 0;
    }
    for (let i = start; i < n; i++) {
      const c = at(i);
      for (const r of this.runs) r.at(i, c, i < n - 1);
      this.seen[i] = c;
    }
    this.seen.length = n;
    this.committed = Math.max(0, n - 1);
    return start;
  }
}

/** Indeks ostatniej świecy, która zaczęła się najpóźniej w chwili `t` (−1: żadna). */
function lastStartedBy(cs: readonly Candle[], t: number): number {
  let lo = 0;
  let hi = cs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cs[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * Wskaźnik liczony na świecach innego interwału. Parametr „Interwał”: świeca wykresu bierze wartość ostatniej świecy
 * interwału zamkniętej do jej końca, jak TradingView bez zaglądania w przyszłość (bieżąca świeca to podgląd). Stały
 * okres (pivoty): wartość okresu, w którym leży świeca wykresu — wzór sięga tylko po okresy zamknięte; bez świecy
 * tego okresu (doba jeszcze nie dotarła) wartości brak.
 */
class TfRun implements IndicatorValues {
  out: Float64Array[];
  private readonly run: IndicatorRun;
  private readonly pass: Pass;
  private readonly ms: number;
  private readonly fixed: boolean;
  /** Liczba świec wykresu z poprzedniego przeniesienia. */
  private n = 0;

  constructor(
    x: IndicatorInstance,
    readonly tf: string
  ) {
    this.run = new IndicatorRun(x);
    this.pass = new Pass([this.run]);
    this.ms = intervalById(tf).ms;
    this.fixed = indicatorDef(x.id).period !== undefined;
    this.out = this.run.out.map(() => new Float64Array(0));
  }

  /** Przenosi wartości na świece wykresu od `from` (albo od początku po zmianie świec interwału); zwraca indeks pierwszej zmienionej. */
  sync(bars: readonly Bar[], ms: number, from: number, candles: readonly Candle[]): number {
    const n = bars.length;
    const changed = this.pass.sync(candles.length, (j) => candles[j]) < candles.length;
    let i = changed ? 0 : Math.min(from, this.n);
    if (i >= n) {
      this.n = n;
      return n;
    }
    if (n > this.out[0].length) this.out = this.out.map((a) => grow(a, n));
    // Świeca interwału zamknięta do końca świecy wykresu zaczęła się najpóźniej w chwili t + ms − ms interwału
    const shift = this.fixed ? 0 : ms - this.ms;
    let j = lastStartedBy(candles, bars[i].candle.t + shift);
    let first = n;
    for (; i < n; i++) {
      const t = bars[i].candle.t;
      while (j + 1 < candles.length && candles[j + 1].t <= t + shift) j++;
      const ok = j >= 0 && (!this.fixed || t < candles[j].t + this.ms);
      for (let p = 0; p < this.out.length; p++) {
        const v = ok ? this.run.out[p][j] : Number.NaN;
        const a = this.out[p];
        if (first === n && (i >= this.n || !(a[i] === v || (Number.isNaN(a[i]) && Number.isNaN(v))))) first = i;
        a[i] = v;
      }
    }
    this.n = n;
    return first;
  }
}

/**
 * Przeliczanie wskaźników po świecach wykresu — transakcja na bieżącej świecy kosztuje O(1) na wskaźnik. Wskaźniki
 * z innego interwału liczą się na jego świecach (`candlesOf`), a ich wartości są przenoszone na świece wykresu.
 */
export class IndicatorEngine {
  /** Wartości instancji w kolejności listy. */
  runs: IndicatorValues[] = [];
  private chart = new Pass([]);
  private tfs: TfRun[] = [];

  /** Liczba przeliczonych świec wykresu. */
  get count(): number {
    return this.chart.count;
  }

  setInstances(list: readonly IndicatorInstance[]): void {
    const own: IndicatorRun[] = [];
    this.tfs = [];
    this.runs = list.map((x) => {
      const tf = indicatorDef(x.id).period ?? x.tf;
      if (tf) {
        const r = new TfRun(x, tf);
        this.tfs.push(r);
        return r;
      }
      const r = new IndicatorRun(x);
      own.push(r);
      return r;
    });
    this.chart = new Pass(own);
  }

  /** Przelicza zmienione świece (`ms` — interwał wykresu); zwraca indeks pierwszej zmienionej wartości (liczba świec = bez zmian). */
  sync(bars: readonly Bar[], ms = 0, candlesOf: CandlesOf = () => []): number {
    const from = this.chart.sync(bars.length, (i) => bars[i].candle);
    let start = from;
    for (const r of this.tfs) start = Math.min(start, r.sync(bars, ms, from, candlesOf(r.tf)));
    return start;
  }
}
