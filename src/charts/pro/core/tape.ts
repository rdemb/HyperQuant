import type { Fill, Side } from '../hl/parse';

/**
 * Taśma transakcji w kawałkach minutowych (kolumny: czas, cena, wielkość, strona, tid), posortowana po
 * czasie w obrębie minuty. Duplikaty (ten sam tid w tej samej milisekundzie — np. powtórka po ponownej
 * subskrypcji albo wczytanie zapisu z innej karty) są odrzucane. Adresy i hashe nie trafiają na taśmę.
 */

export const MINUTE = 60_000;

export interface MinuteChunk {
  minute: number;
  t: number[];
  px: number[];
  sz: number[];
  side: Side[];
  tid: number[];
  /** Rośnie przy każdej zmianie zawartości (do unieważniania obliczeń pochodnych). */
  version: number;
}

export interface TradeRow {
  t: number;
  px: number;
  sz: number;
  side: Side;
  tid: number;
}

export function minuteOf(t: number): number {
  return Math.floor(t / MINUTE) * MINUTE;
}

export class Tape {
  private readonly chunks = new Map<number, MinuteChunk>();
  private seq = 0;
  count = 0;
  firstTime = Number.POSITIVE_INFINITY;
  lastTime = Number.NEGATIVE_INFINITY;
  /** Cena ostatniej (najnowszej) transakcji; NaN przed pierwszą. */
  lastPx = Number.NaN;

  /** Dokłada transakcje; zwraca przyjęte (bez duplikatów) i minuty, których zawartość się zmieniła. */
  insert<R extends Fill | TradeRow>(rows: readonly R[]): { accepted: R[]; touched: Set<number> } {
    const touched = new Set<number>();
    const accepted: R[] = [];
    for (const r of rows) {
      const t = 'time' in r ? r.time : r.t;
      if (this.insertOne(t, r.px, r.sz, r.side, r.tid)) {
        touched.add(minuteOf(t));
        accepted.push(r);
      }
    }
    touched.forEach((m) => {
      const c = this.chunks.get(m);
      if (c) c.version = ++this.seq;
    });
    return { accepted, touched };
  }

  private insertOne(t: number, px: number, sz: number, side: Side, tid: number): boolean {
    if (!(t > 0) || !(px > 0) || !(sz > 0)) return false;
    const m = minuteOf(t);
    let c = this.chunks.get(m);
    if (!c) {
      c = { minute: m, t: [], px: [], sz: [], side: [], tid: [], version: 0 };
      this.chunks.set(m, c);
    }
    // Pozycja wstawienia: za ostatnią transakcją o czasie ≤ t (kolejność przyjścia w obrębie bloku zachowana)
    let at = c.t.length;
    while (at > 0 && c.t[at - 1] > t) at--;
    // Duplikat może leżeć tylko wśród wpisów z tą samą milisekundą, bezpośrednio przed `at`
    for (let k = at - 1; k >= 0 && c.t[k] === t; k--) if (c.tid[k] === tid) return false;
    if (at === c.t.length) {
      c.t.push(t);
      c.px.push(px);
      c.sz.push(sz);
      c.side.push(side);
      c.tid.push(tid);
    } else {
      c.t.splice(at, 0, t);
      c.px.splice(at, 0, px);
      c.sz.splice(at, 0, sz);
      c.side.splice(at, 0, side);
      c.tid.splice(at, 0, tid);
    }
    this.count++;
    if (t < this.firstTime) this.firstTime = t;
    if (t >= this.lastTime) {
      this.lastTime = t;
      this.lastPx = px;
    }
    return true;
  }

  chunk(minute: number): MinuteChunk | undefined {
    return this.chunks.get(minute);
  }

  /** Transakcje z [from, to) w kolejności czasu. */
  forEach(from: number, to: number, fn: (t: number, px: number, sz: number, side: Side) => void): void {
    for (let m = minuteOf(from); m < to; m += MINUTE) {
      const c = this.chunks.get(m);
      if (!c) continue;
      const n = c.t.length;
      for (let i = 0; i < n; i++) {
        const t = c.t[i];
        if (t < from) continue;
        if (t >= to) break;
        fn(t, c.px[i], c.sz[i], c.side[i]);
      }
    }
  }

  /** Czy w [from, to) jest jakakolwiek transakcja. */
  hasAny(from: number, to: number): boolean {
    for (let m = minuteOf(from); m < to; m += MINUTE) {
      const c = this.chunks.get(m);
      if (c && c.t.length > 0 && c.t[c.t.length - 1] >= from && c.t[0] < to) return true;
    }
    return false;
  }

  /** Najwyższa wersja kawałków z [from, to) i liczba transakcji — podpis do pamięci podręcznej. */
  signature(from: number, to: number): string {
    let v = 0;
    let n = 0;
    for (let m = minuteOf(from); m < to; m += MINUTE) {
      const c = this.chunks.get(m);
      if (!c) continue;
      if (c.version > v) v = c.version;
      n += c.t.length;
    }
    return `${v}:${n}`;
  }

  minutes(): number[] {
    return [...this.chunks.keys()].sort((a, b) => a - b);
  }

  /** Usuwa kawałki starsze niż `before` (ms). */
  prune(before: number): void {
    const cut = minuteOf(before);
    let removed = 0;
    this.chunks.forEach((c, m) => {
      if (m < cut) {
        removed += c.t.length;
        this.chunks.delete(m);
      }
    });
    if (removed === 0) return;
    this.count -= removed;
    this.firstTime = Number.POSITIVE_INFINITY;
    this.chunks.forEach((c) => {
      if (c.t.length > 0 && c.t[0] < this.firstTime) this.firstTime = c.t[0];
    });
  }
}
