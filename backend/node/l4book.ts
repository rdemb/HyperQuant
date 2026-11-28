/**
 * Arkusz na poziomie zleceń (L4) z `node_raw_book_diffs`: każde zlecenie z adresem właściciela, numerem i ceną, pełna
 * głębokość (publiczne `l2Book` daje 20 poziomów na stronę bez właścicieli). Z tego powstają: mapa ciepła pełnego arkusza,
 * ściany z właścicielem (pseudonim na stronie), wiarygodność ścian (zjedzone czy zdjęte — po numerze zlecenia) i miejsce
 * w kolejce. Stan początkowy z migawki L4 (`compute-l4-snapshots` noda), dalej różnice. Czysta logika, bez plików.
 */

export type BookSide = 'Bid' | 'Ask';

/** Różnica arkusza (schemat z dokumentacji noda): nowe zlecenie, zmiana wielkości albo zdjęcie. */
export interface RawBookDiff {
  user: string;
  oid: number;
  coin: string;
  side: BookSide;
  px: number;
  diff: { kind: 'new'; sz: number } | { kind: 'update'; origSz: number; newSz: number } | { kind: 'remove' };
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Rekord `node_raw_book_diffs` → różnica; zły kształt — null. */
export function parseRawBookDiff(x: unknown): RawBookDiff | null {
  if (!isRecord(x) || typeof x.user !== 'string' || typeof x.coin !== 'string' || (x.side !== 'Bid' && x.side !== 'Ask')) return null;
  const oid = Number(x.oid);
  const px = Number(x.px);
  if (!Number.isFinite(oid) || !(px > 0)) return null;
  const d = x.raw_book_diff;
  const base = { user: x.user, oid, coin: x.coin, side: x.side, px } as const;
  if (d === 'remove') return { ...base, diff: { kind: 'remove' } };
  if (isRecord(d) && isRecord(d.new) && Number(d.new.sz) > 0) return { ...base, diff: { kind: 'new', sz: Number(d.new.sz) } };
  if (isRecord(d) && isRecord(d.update) && Number(d.update.newSz) >= 0) {
    return { ...base, diff: { kind: 'update', origSz: Number(d.update.origSz), newSz: Number(d.update.newSz) } };
  }
  return null;
}

export interface L4Order {
  oid: number;
  user: string;
  side: BookSide;
  px: number;
  sz: number;
}

interface Level {
  sz: number;
  n: number;
}

/** Arkusz jednego rynku: zlecenia według numeru i poziomy (suma wielkości, liczba zleceń) aktualizowane przyrostowo. */
class CoinBook {
  readonly orders = new Map<number, L4Order>();
  readonly levels: Record<BookSide, Map<number, Level>> = { Bid: new Map(), Ask: new Map() };

  private addLevel(o: L4Order, sign: 1 | -1): void {
    const map = this.levels[o.side];
    const lv = map.get(o.px) ?? { sz: 0, n: 0 };
    lv.sz += sign * o.sz;
    lv.n += sign;
    if (lv.n <= 0 || lv.sz <= 1e-12) map.delete(o.px);
    else map.set(o.px, lv);
  }

  put(o: L4Order): void {
    const old = this.orders.get(o.oid);
    if (old) this.addLevel(old, -1);
    this.orders.set(o.oid, o);
    this.addLevel(o, 1);
  }

  remove(oid: number): L4Order | null {
    const old = this.orders.get(oid);
    if (!old) return null;
    this.orders.delete(oid);
    this.addLevel(old, -1);
    return old;
  }
}

export class L4Book {
  private readonly books = new Map<string, CoinBook>();

  private book(coin: string): CoinBook {
    let b = this.books.get(coin);
    if (!b) this.books.set(coin, (b = new CoinBook()));
    return b;
  }

  /**
   * Różnica do arkusza; zwraca zlecenie przed zmianą (zdjęte albo zmniejszone — do bilansu ścian) albo null. Zmiana
   * nieznanego zlecenia (stan sprzed migawki) dopisuje je z nową wielkością; wielkość 0 zdejmuje.
   */
  apply(d: RawBookDiff): L4Order | null {
    const b = this.book(d.coin);
    const prev = b.orders.get(d.oid) ?? null;
    if (d.diff.kind === 'remove') return b.remove(d.oid);
    const sz = d.diff.kind === 'new' ? d.diff.sz : d.diff.newSz;
    if (!(sz > 0)) return b.remove(d.oid);
    b.put({ oid: d.oid, user: d.user, side: d.side, px: d.px, sz });
    return prev ? { ...prev } : null;
  }

  /** Poziomy strony od najlepszego (bidy malejąco, aski rosnąco), najwyżej `depth`. */
  levels(coin: string, side: BookSide, depth = Number.POSITIVE_INFINITY): { px: number; sz: number; n: number }[] {
    const map = this.books.get(coin)?.levels[side];
    if (!map) return [];
    const prices = [...map.keys()].sort((a, b) => (side === 'Bid' ? b - a : a - b));
    return prices.slice(0, depth).map((px) => ({ px, ...map.get(px)! }));
  }

  /** `k` największych zleceń strony (ściany z właścicielem). */
  largest(coin: string, side: BookSide, k: number): L4Order[] {
    const b = this.books.get(coin);
    if (!b) return [];
    return [...b.orders.values()].filter((o) => o.side === side).sort((a, z) => z.sz - a.sz || a.oid - z.oid).slice(0, k);
  }

  /**
   * Miejsce zlecenia `oid` w kolejce swojej ceny: wielkość przed nim (zlecenia o niższym numerze — wcześniej złożone,
   * kolejność czasu w arkuszu Hyperliquid) i liczba zleceń przed nim. Nieznane zlecenie — null.
   */
  queueAhead(coin: string, oid: number): { sz: number; n: number } | null {
    const b = this.books.get(coin);
    const o = b?.orders.get(oid);
    if (!b || !o) return null;
    let sz = 0;
    let n = 0;
    for (const x of b.orders.values()) {
      if (x.side === o.side && x.px === o.px && x.oid < oid) {
        sz += x.sz;
        n++;
      }
    }
    return { sz, n };
  }

  size(coin: string): number {
    return this.books.get(coin)?.orders.size ?? 0;
  }
}
