import type { Candle } from '../hl/parse';
import { intervalById } from '../core/time';
import { FlowBar, FlowContext, IndicatorInstance, SeriesFn, Step, indicatorDef } from './registry';

/** Świeca wejścia: wystarczy świeca z API (ProBar, IndicatorBar); wskaźniki z taśmy biorą też footprint (ProBar). */
type Bar = FlowBar;

/** Bez danych spoza świec (testy, wykres bez rynku Hyperliquid): wskaźniki z taśmy i OI bez wartości. */
const NO_FLOW: FlowContext = { oiAt: () => null, book: () => [], exactBook: () => [], orders: () => [], orderCount: () => 0, identified: () => false, now: Number.POSITIVE_INFINITY };

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
 * Wskaźnik z danych spoza świec (taśma, otwarte pozycje, migawki arkusza): każda świeca liczona od nowa przy każdym
 * przeliczeniu, bo dane dochodzą też do starszych świec (historia taśmy i arkusza, odczyty OI) bez zmiany samej świecy.
 */
class FlowRun implements IndicatorValues {
  out: Float64Array[];
  from = 0;
  private readonly v: Float64Array;
  /** Wartości z `series` przed porównaniem z poprzednimi. */
  private next: Float64Array[];
  private readonly series: SeriesFn | null;
  /** Liczba świec i czas pierwszej z poprzedniego liczenia. */
  private n = 0;
  private t0 = Number.NaN;

  constructor(private readonly x: IndicatorInstance) {
    const def = indicatorDef(x.id);
    this.v = new Float64Array(def.plots.length);
    this.out = def.plots.map(() => new Float64Array(0));
    this.next = def.plots.map(() => new Float64Array(0));
    this.series = def.series?.(x.params) ?? null;
  }

  /** Przelicza wszystkie świece; zwraca indeks pierwszej zmienionej wartości (doczytana historia z lewej zmienia wszystkie). */
  sync(bars: readonly Bar[], ms: number, ctx: FlowContext): number {
    const n = bars.length;
    if (n > this.out[0].length) this.out = this.out.map((a) => grow(a, n));
    const { flow } = indicatorDef(this.x.id);
    if (this.series) {
      if (n > this.next[0].length) this.next = this.next.map((a) => grow(a, n));
      this.series(bars, ms, ctx, this.next);
    }
    const t0 = n > 0 ? bars[0].candle.t : Number.NaN;
    let first = n < this.n || t0 !== this.t0 ? 0 : n;
    for (let i = 0; i < n; i++) {
      if (flow) flow(bars[i], ms, ctx, this.v);
      else for (let p = 0; p < this.v.length; p++) this.v[p] = this.next[p][i];
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
 * Wskaźnik z taśmy porównujący świecę z poprzednimi świecami z wartością (absorpcja). Świeca po zmianie jest nowym
 * obiektem, więc zmienione świece wskazuje porównanie referencji; przeliczane są one i świece, w których oknie leżą
 * (`span` następnych świec z wartością). Doczytana godzina taśmy, żywa świeca i historia z lewej (wartości przesunięte
 * o nowe świece) nie przeliczają całej historii — okno kosztuje O(span²).
 */
class SampleRun implements IndicatorValues {
  out: Float64Array[];
  from = 0;
  private readonly span: number;
  private readonly calc: (x: number, y: number, xs: Float64Array, ys: Float64Array, out: Float64Array) => void;
  private readonly v: Float64Array;
  private readonly xy = new Float64Array(2);
  /** Okno poprzednich par (najnowsza pierwsza). */
  private readonly wx: Float64Array;
  private readonly wy: Float64Array;
  /** Świece z ostatniego liczenia i ich pary (`ok` — świeca z wartością). */
  private seen: (Bar | undefined)[] = [];
  private xs = new Float64Array(0);
  private ys = new Float64Array(0);
  private ok = new Uint8Array(0);

  constructor(private readonly x: IndicatorInstance) {
    const def = indicatorDef(x.id);
    this.span = def.sample!.span(x.params);
    this.calc = def.sample!.create(x.params);
    this.v = new Float64Array(def.plots.length);
    this.wx = new Float64Array(this.span);
    this.wy = new Float64Array(this.span);
    this.out = def.plots.map(() => new Float64Array(0));
  }

  /** Przelicza zmienione świece i świece, w których oknie leżą; zwraca indeks pierwszej zmienionej wartości (liczba świec = bez zmian). */
  sync(bars: readonly Bar[]): number {
    const n = bars.length;
    // Historia z lewej: dotychczasowe świece zaczynają się od indeksu `shift`; inna zmiana początku — liczenie od zera
    let shift = 0;
    if (n > 0 && this.seen.length > 0 && bars[0].candle.t !== this.seen[0]!.candle.t) {
      shift = lastStartedBy(bars.map((b) => b.candle), this.seen[0]!.candle.t);
      if (shift <= 0 || bars[shift].candle.t !== this.seen[0]!.candle.t) this.seen = [];
    }
    this.reserve(this.seen.length + Math.max(0, shift), n);
    if (shift > 0 && this.seen.length > 0) {
      const m = this.seen.length;
      for (const a of [this.xs, this.ys, this.ok, ...this.out]) a.copyWithin(shift, 0, m);
      this.seen = [...new Array<undefined>(shift), ...this.seen];
    }
    if (n < this.seen.length) this.seen = [];
    const m = this.seen.length;
    const point = indicatorDef(this.x.id).sample!.point;
    let first = n;
    // Ile następnych świec z wartością ma w oknie zmienioną świecę
    let need = 0;
    for (let i = 0; i < n; i++) {
      const changed = i >= m || bars[i] !== this.seen[i];
      if (!changed && need === 0) continue;
      if (changed) {
        this.ok[i] = point(bars[i], this.xy) ? 1 : 0;
        this.xs[i] = this.xy[0];
        this.ys[i] = this.xy[1];
        this.seen[i] = bars[i];
        need = this.span;
      } else if (this.ok[i]) need--;
      let k = 0;
      if (this.ok[i]) {
        for (let j = i - 1; j >= 0 && k < this.span; j--) {
          if (!this.ok[j]) continue;
          this.wx[k] = this.xs[j];
          this.wy[k++] = this.ys[j];
        }
      }
      if (k === this.span) this.calc(this.xs[i], this.ys[i], this.wx, this.wy, this.v);
      else this.v.fill(Number.NaN);
      for (let p = 0; p < this.v.length; p++) {
        if (first === n && (i >= m || !Object.is(this.out[p][i], this.v[p]))) first = i;
        this.out[p][i] = this.v[p];
      }
    }
    this.seen.length = n;
    return (this.from = shift > 0 ? 0 : first);
  }

  /** Bufory na `n` świec (z zachowaniem `keep` pierwszych). */
  private reserve(keep: number, n: number): void {
    const size = Math.max(keep, n);
    if (size <= this.ok.length) return;
    const cap = Math.max(size, this.ok.length * 2, 256);
    const copy = <T extends Float64Array | Uint8Array>(a: T, b: T): T => (b.set(a), b);
    this.xs = copy(this.xs, new Float64Array(cap));
    this.ys = copy(this.ys, new Float64Array(cap));
    this.ok = copy(this.ok, new Uint8Array(cap));
    this.out = this.out.map((a) => copy(a, new Float64Array(cap)));
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
  private samples: SampleRun[] = [];

  /** Liczba przeliczonych świec wykresu. */
  get count(): number {
    return this.chart.count;
  }

  setInstances(list: readonly IndicatorInstance[]): void {
    this.own = [];
    this.tfs = [];
    this.windows = [];
    this.flows = [];
    this.samples = [];
    this.runs = list.map((x) => {
      const def = indicatorDef(x.id);
      // Stożek z dziennika: bez wartości świec, nigdy nie zgłasza zmiany
      if (def.forecast) return { out: [], from: Number.POSITIVE_INFINITY };
      if (def.sample) {
        const r = new SampleRun(x);
        this.samples.push(r);
        return r;
      }
      if (def.flow || def.series) {
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
    for (const r of this.samples) start = Math.min(start, r.sync(bars));
    return start;
  }
}
