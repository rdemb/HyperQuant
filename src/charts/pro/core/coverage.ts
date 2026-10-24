/**
 * Pokrycie taśmą: odcinki czasu (zegar serwera), w których subskrypcja transakcji była aktywna.
 * Świeca jest pełna tylko wtedy, gdy jeden odcinek obejmuje ją w całości — luka po zerwaniu połączenia
 * albo zamknięciu karty jest jawna, a nie zgadywana.
 */

export type Span = [start: number, end: number];

export class Coverage {
  /** Odcinki rozłączne, rosnąco; otwarty odcinek ma koniec = +∞. */
  private spans: Span[] = [];

  constructor(spans: readonly Span[] = []) {
    for (const [a, b] of spans) this.addSpan(a, b);
  }

  get isOpen(): boolean {
    const last = this.spans[this.spans.length - 1];
    return last !== undefined && last[1] === Number.POSITIVE_INFINITY;
  }

  /** Początek nagrywania (otwiera odcinek; ponowne otwarcie przy otwartym nic nie zmienia). */
  open(at: number): void {
    if (this.isOpen) return;
    this.addSpan(at, Number.POSITIVE_INFINITY);
  }

  /** Koniec nagrywania (domyka otwarty odcinek). */
  close(at: number): void {
    const last = this.spans[this.spans.length - 1];
    if (!last || last[1] !== Number.POSITIVE_INFINITY) return;
    if (at <= last[0]) this.spans.pop();
    else last[1] = at;
  }

  /** Dodaje odcinek (np. wczytany z zapisu), scalając nakładające się i stykające. */
  addSpan(start: number, end: number): void {
    if (!(end > start)) return;
    const out: Span[] = [];
    let s = start;
    let e = end;
    let placed = false;
    for (const sp of this.spans) {
      if (sp[1] < s) out.push(sp);
      else if (sp[0] > e) {
        if (!placed) {
          out.push([s, e]);
          placed = true;
        }
        out.push(sp);
      } else {
        s = Math.min(s, sp[0]);
        e = Math.max(e, sp[1]);
      }
    }
    if (!placed) out.push([s, e]);
    this.spans = out;
  }

  /** Czy [from, to) leży w całości w jednym odcinku. */
  covers(from: number, to: number): boolean {
    for (const [a, b] of this.spans) {
      if (a <= from && b >= to) return true;
      if (a > from) return false;
    }
    return false;
  }

  /** Łączny pokryty czas w [from, to) (ms). */
  coveredMs(from: number, to: number): number {
    let acc = 0;
    for (const [a, b] of this.spans) {
      const lo = Math.max(a, from);
      const hi = Math.min(b, to);
      if (hi > lo) acc += hi - lo;
    }
    return acc;
  }

  /** Najwcześniejszy pokryty moment (NaN gdy brak). */
  first(): number {
    return this.spans.length > 0 ? this.spans[0][0] : Number.NaN;
  }

  /** Odcinki do zapisu; otwarty odcinek domknięty chwilą `now`. */
  snapshot(now: number): Span[] {
    return this.spans.map(([a, b]) => [a, b === Number.POSITIVE_INFINITY ? now : b]);
  }

  /** Usuwa pokrycie sprzed `before`. */
  prune(before: number): void {
    this.spans = this.spans.filter(([, b]) => b > before).map(([a, b]) => [Math.max(a, before), b]);
  }

  list(): readonly Span[] {
    return this.spans;
  }
}
