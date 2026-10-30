import type { Candle } from '../hl/parse';
import { IndicatorInstance, Step, indicatorDef } from './registry';

/** Świeca wejścia: wystarczy świeca z API (ProBar, IndicatorBar). */
interface Bar {
  candle: Candle;
}

/** Jedna instancja wskaźnika: wartości plotów świeca po świecy (NaN = brak). */
export class IndicatorRun {
  /** Wartości plotów; długość tablicy bywa większa niż liczba świec (zapas), ważne są pierwsze n. */
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
 * Przeliczanie wskaźników po świecach wykresu. Stan instancji jest zatwierdzony po przedostatniej (zamkniętej) świecy,
 * a ostatnia, trwająca świeca to podgląd bez zmiany stanu — transakcja na bieżącej świecy kosztuje O(1) na wskaźnik.
 * Zmiana starszej świecy albo pierwszej świecy serii (doczytana historia, inny interwał) przelicza wszystko od początku.
 */
export class IndicatorEngine {
  runs: IndicatorRun[] = [];
  /** Świece z ostatniego przeliczenia: świeca z API po zmianie jest nowym obiektem, więc wystarcza porównanie referencji. */
  private seen: Candle[] = [];
  private committed = 0;

  /** Liczba przeliczonych świec. */
  get count(): number {
    return this.seen.length;
  }

  setInstances(list: readonly IndicatorInstance[]): void {
    this.runs = list.map((x) => new IndicatorRun(x));
    this.seen = [];
    this.committed = 0;
  }

  /** Przelicza zmienione świece; zwraca indeks pierwszej przeliczonej (liczba świec = bez zmian). */
  sync(bars: readonly Bar[]): number {
    const n = bars.length;
    const m = this.seen.length;
    let from = 0;
    if (n >= m) while (from < m && bars[from].candle === this.seen[from]) from++;
    if (from === m && n === m) return n;
    let start = this.committed;
    if (from < start) {
      for (const r of this.runs) r.reset();
      start = 0;
    }
    for (let i = start; i < n; i++) {
      const c = bars[i].candle;
      for (const r of this.runs) r.at(i, c, i < n - 1);
      this.seen[i] = c;
    }
    this.seen.length = n;
    this.committed = Math.max(0, n - 1);
    return start;
  }
}
