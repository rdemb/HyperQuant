import type { Candle } from '../hl/parse';
import { intervalById } from '../core/time';
import { FlowBar, FlowContext, IndicatorInstance, Step, indicatorDef } from './registry';

/** Świeca wejścia: wystarczy świeca z API (ProBar, IndicatorBar); wskaźniki z taśmy biorą też footprint (ProBar). */
type Bar = FlowBar;

/** Bez danych spoza świec (testy, wykres bez rynku Hyperliquid): wskaźniki z taśmy i OI bez wartości. */
const NO_FLOW: FlowContext = { oiAt: () => null, now: Number.POSITIVE_INFINITY };

/** Świece interwału wskaźnika (seria rynku wczytywana przy pierwszym użyciu). */
export type CandlesOf = (tf: string) => readonly Candle[];

/** Wartości plotów instancji świeca po świecy wykresu (NaN = brak); długość tablicy bywa większa niż liczba świec (zapas). */
export interface IndicatorValues {
  out: Float64Array[];
  /** Indeks pierwszej wartości zmienionej w ostatnim przeliczeniu (liczba świec = bez zmian). */
  from: number;
}

/** Jedna instancja wskaźnika: wartości plotów świeca po świecy (NaN = brak). */
export class IndicatorRun implements IndicatorValues {
  out: Float64Array[];
  from = 0;
  private step: Step;
  private readonly v: Float64Array;

  constructor(readonly x: IndicatorInstance) {
    const def = indicatorDef(x.id);
    this.step = def.create!(x.params);
    this.v = new Float64Array(def.plots.length);
    this.out = def.plots.map(() => new Float64Array(0));
  }

  reset(): void {
    this.step = indicatorDef(this.x.id).create!(this.x.params);
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
  from = 0;
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
      return (this.from = n);
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
    return (this.from = first);
  }
}

/** Rysunek na ostatnich świecach (kanał regresji): liczony od nowa z ostatnich `span` świec, wcześniejsze bez wartości. */
class WindowRun implements IndicatorValues {
  out: Float64Array[];
  from = 0;
  private readonly span: number;
  /** Początek okna i liczba świec z poprzedniego liczenia. */
  private start = 0;
  private n = 0;

  constructor(private readonly x: IndicatorInstance) {
    const def = indicatorDef(x.id);
    this.span = def.fit!.span(x.params);
    this.out = def.plots.map(() => new Float64Array(0));
  }

  /** Liczy okno po zmianie świec wykresu od `from`; zwraca indeks pierwszej zmienionej wartości. */
  sync(bars: readonly Bar[], from: number): number {
    const n = bars.length;
    if (from >= n && n === this.n) return (this.from = n);
    if (n > this.out[0].length) this.out = this.out.map((a) => grow(a, n));
    // Za mało świec: bez kanału; poprzednie okno poza nowym traci wartości
    const start = n >= this.span ? n - this.span : n;
    const clear = from === 0 ? 0 : Math.min(this.start, start);
    for (const a of this.out) a.fill(Number.NaN, clear, start);
    if (start < n) indicatorDef(this.x.id).fit!.run((j) => bars[n - 1 - j].candle, this.x.params, this.out, n - 1);
    this.start = start;
    this.n = n;
    return (this.from = clear);
  }
}

/**
 * Wskaźnik z danych spoza świec (taśma, otwarte pozycje): każda świeca liczona od nowa przy każdym przeliczeniu, bo
 * dane dochodzą też do starszych świec (historia taśmy, odczyty OI) bez zmiany samej świecy.
 */
class FlowRun implements IndicatorValues {
  out: Float64Array[];
  from = 0;
  private readonly v: Float64Array;
  /** Liczba świec i czas pierwszej z poprzedniego liczenia. */
  private n = 0;
  private t0 = Number.NaN;

  constructor(private readonly x: IndicatorInstance) {
    const def = indicatorDef(x.id);
    this.v = new Float64Array(def.plots.length);
    this.out = def.plots.map(() => new Float64Array(0));
  }

  /** Przelicza wszystkie świece; zwraca indeks pierwszej zmienionej wartości (doczytana historia z lewej zmienia wszystkie). */
  sync(bars: readonly Bar[], ms: number, ctx: FlowContext): number {
    const n = bars.length;
    if (n > this.out[0].length) this.out = this.out.map((a) => grow(a, n));
    const flow = indicatorDef(this.x.id).flow!;
    const t0 = n > 0 ? bars[0].candle.t : Number.NaN;
    let first = n < this.n || t0 !== this.t0 ? 0 : n;
    for (let i = 0; i < n; i++) {
      flow(bars[i], ms, ctx, this.v);
      for (let p = 0; p < this.v.length; p++) {
        if (first === n && (i >= this.n || !Object.is(this.out[p][i], this.v[p]))) first = i;
        this.out[p][i] = this.v[p];
      }
    }
    this.n = n;
    this.t0 = t0;
    return (this.from = first);
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
  private own: IndicatorRun[] = [];
  private tfs: TfRun[] = [];
  private windows: WindowRun[] = [];
  private flows: FlowRun[] = [];

  /** Liczba przeliczonych świec wykresu. */
  get count(): number {
    return this.chart.count;
  }

  setInstances(list: readonly IndicatorInstance[]): void {
    this.own = [];
    this.tfs = [];
    this.windows = [];
    this.flows = [];
    this.runs = list.map((x) => {
      const def = indicatorDef(x.id);
      if (def.flow) {
        const r = new FlowRun(x);
        this.flows.push(r);
        return r;
      }
      if (def.fit) {
        const r = new WindowRun(x);
        this.windows.push(r);
        return r;
      }
      const tf = def.period ?? x.tf;
      if (tf) {
        const r = new TfRun(x, tf);
        this.tfs.push(r);
        return r;
      }
      const r = new IndicatorRun(x);
      this.own.push(r);
      return r;
    });
    this.chart = new Pass(this.own);
  }

  /**
   * Przelicza zmienione świece (`ms` — interwał wykresu, `flow` — dane Hyperliquid spoza świec); zwraca indeks pierwszej
   * zmienionej wartości (liczba świec = bez zmian).
   */
  sync(bars: readonly Bar[], ms = 0, candlesOf: CandlesOf = () => [], flow: FlowContext = NO_FLOW): number {
    const from = this.chart.sync(bars.length, (i) => bars[i].candle);
    for (const r of this.own) r.from = from;
    let start = from;
    for (const r of this.tfs) start = Math.min(start, r.sync(bars, ms, from, candlesOf(r.tf)));
    for (const r of this.windows) start = Math.min(start, r.sync(bars, from));
    for (const r of this.flows) start = Math.min(start, r.sync(bars, ms, flow));
    return start;
  }
}
