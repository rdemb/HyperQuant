import type { BookSnapshot } from '../hl/parse';

/**
 * Historia arkusza zleceń z kanału `l2Book`: migawki 20 poziomów na stronę w jednej agregacji ceny
 * (krok kubełka). Hyperliquid nie udostępnia historii arkusza, więc zapis zaczyna się od otwarcia strony.
 * Migawka obowiązuje do następnej — z tego powstaje mapa ciepła płynności w czasie.
 */

export interface BookFrame {
  /** Czas migawki (ms, zegar giełdy). */
  t: number;
  /** Krok kubełka ceny (USD). */
  step: number;
  /** Ceny poziomów: najpierw bidy (malejąco), potem aski (rosnąco). */
  px: Float64Array;
  /** Wielkości (BTC) w tej samej kolejności. */
  sz: Float64Array;
  nBids: number;
}

/** Krok agregacji migawki: najmniejsza różnica sąsiednich cen po jednej stronie, zaokrąglona do potęgi 10. */
export function bookStep(snap: BookSnapshot): number {
  let min = Number.POSITIVE_INFINITY;
  for (const side of [snap.bids, snap.asks]) {
    for (let i = 1; i < side.length; i++) {
      const d = Math.abs(side[i].px - side[i - 1].px);
      if (d > 0 && d < min) min = d;
    }
  }
  if (!Number.isFinite(min)) return Number.NaN;
  return 10 ** Math.round(Math.log10(min));
}

export function toFrame(snap: BookSnapshot, step: number): BookFrame {
  const n = snap.bids.length + snap.asks.length;
  const px = new Float64Array(n);
  const sz = new Float64Array(n);
  let k = 0;
  for (const l of snap.bids) {
    px[k] = l.px;
    sz[k++] = l.sz;
  }
  for (const l of snap.asks) {
    px[k] = l.px;
    sz[k++] = l.sz;
  }
  return { t: snap.time, step, px, sz, nBids: snap.bids.length };
}

/** Migawki jednej agregacji, rosnąco po czasie. */
export class BookHistory {
  private frames: BookFrame[] = [];
  /** Zmienia się z każdą nową migawką (klucz pamięci podręcznej rysowania). */
  version = 0;

  constructor(readonly step: number) {}

  get length(): number {
    return this.frames.length;
  }

  add(f: BookFrame): void {
    const arr = this.frames;
    const last = arr[arr.length - 1];
    if (last && f.t <= last.t) {
      if (f.t === last.t) arr[arr.length - 1] = f;
      else return; // starsza migawka po ponownym połączeniu — kolejność czasu zostaje
    } else arr.push(f);
    this.version++;
  }

  latest(): BookFrame | null {
    return this.frames[this.frames.length - 1] ?? null;
  }

  /** Migawki obowiązujące w [from, to): także ostatnia sprzed `from`. */
  range(from: number, to: number): BookFrame[] {
    const arr = this.frames;
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].t < from) lo = mid + 1;
      else hi = mid;
    }
    const start = Math.max(0, lo - 1);
    let end = lo;
    while (end < arr.length && arr[end].t < to) end++;
    return arr.slice(start, end);
  }

  prune(before: number): void {
    let i = 0;
    while (i < this.frames.length - 1 && this.frames[i + 1].t <= before) i++;
    if (i > 0) {
      this.frames = this.frames.slice(i);
      this.version++;
    }
  }
}

/**
 * Cyfry znaczące l2Book dla kroku ~10 USD (arkusz bliski) i ~100 USD (arkusz daleki) przy danej cenie:
 * 5 cyfr ceny (10 000–99 999) → 4 i 3, 6 cyfr → 5 i 4.
 */
export function bookSigFigs(price: number): { near: number; far: number } {
  const digits = Math.floor(Math.log10(price)) + 1;
  const near = Math.min(5, Math.max(2, digits - 1));
  return { near, far: Math.max(2, near - 1) };
}
