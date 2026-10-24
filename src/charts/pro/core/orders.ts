import { Fill, Side, isUsableHash } from '../hl/parse';

/**
 * Zlecenia agresora złożone z wypełnień taśmy. Hyperliquid podaje w każdej transakcji adresy obu stron
 * i hash transakcji, więc wypełnienia jednego zlecenia rynkowego (zamiatającego kilka poziomów arkusza)
 * łączymy dokładnie: ten sam adres biorcy i ten sam hash. Bez użytecznego hasha (np. wypełnienia TWAP)
 * łączymy wypełnienia tego samego biorcy z tej samej milisekundy. Adresy zostają tylko w pamięci strony
 * (podsumowanie portfela po kliknięciu bąbla, udział największego makera) — nigdy nie są zapisywane.
 */

export interface AggressorOrder {
  /** Czas pierwszego wypełnienia (ms). */
  time: number;
  side: Side;
  /** Wielkość (BTC). */
  sz: number;
  /** Wartość (USD). */
  notional: number;
  /** Średnia cena ważona wolumenem. */
  vwap: number;
  pxFirst: number;
  pxLast: number;
  fills: number;
  /** Liczba różnych cen, na których zlecenie się wykonało (poziomy arkusza zebrane jednym zleceniem). */
  levels: number;
  /** Adres biorcy ('' bez pola users). */
  taker: string;
  /** Liczba różnych makerów i wartość (USD) dostarczona przez największego z nich. */
  makers: number;
  topMakerUsd: number;
}

interface Open {
  key: string;
  order: AggressorOrder;
  prices: Set<number>;
  makers: Map<string, number>;
  lastAt: number;
}

/** Klucz zlecenia; null = wypełnienie bez biorcy (każde liczone osobno). */
export function orderKey(f: Fill): string | null {
  if (!f.taker) return null;
  return isUsableHash(f.hash) ? `${f.taker}|${f.hash}` : `${f.taker}|t${f.time}|${f.side}`;
}

export class OrderAggregator {
  private readonly open = new Map<string, Open>();

  /** @param holdMs po tylu ms bez nowego wypełnienia zlecenie uznajemy za zakończone. */
  constructor(private readonly holdMs = 1500) {}

  /** Dokłada wypełnienia (kolejność czasu) i zwraca zlecenia zakończone przed chwilą `now`. */
  push(fills: readonly Fill[], now: number): AggressorOrder[] {
    const done: AggressorOrder[] = [];
    for (const f of fills) {
      const key = orderKey(f);
      if (key === null) {
        done.push(single(f));
        continue;
      }
      const o = this.open.get(key);
      if (o && o.order.side === f.side) {
        const ord = o.order;
        ord.vwap = (ord.vwap * ord.sz + f.px * f.sz) / (ord.sz + f.sz);
        ord.sz += f.sz;
        ord.notional += f.px * f.sz;
        ord.pxLast = f.px;
        ord.fills++;
        o.prices.add(f.px);
        ord.levels = o.prices.size;
        const m = (o.makers.get(f.maker) ?? 0) + f.px * f.sz;
        o.makers.set(f.maker, m);
        ord.makers = o.makers.size;
        ord.topMakerUsd = Math.max(ord.topMakerUsd, m);
        o.lastAt = Math.max(o.lastAt, f.time);
      } else {
        if (o) done.push(o.order);
        this.open.set(key, { key, order: single(f), prices: new Set([f.px]), makers: new Map([[f.maker, f.px * f.sz]]), lastAt: f.time });
      }
    }
    done.push(...this.flush(now));
    return done;
  }

  /** Zamyka zlecenia bez wypełnień od `holdMs` (albo wszystkie przy `force`). */
  flush(now: number, force = false): AggressorOrder[] {
    const out: AggressorOrder[] = [];
    this.open.forEach((o, k) => {
      if (force || now - o.lastAt >= this.holdMs) {
        out.push(o.order);
        this.open.delete(k);
      }
    });
    return out.sort((a, b) => a.time - b.time);
  }

  /** Zlecenia jeszcze otwarte (podgląd na żywo). */
  pending(): AggressorOrder[] {
    return [...this.open.values()].map((o) => o.order);
  }
}

function single(f: Fill): AggressorOrder {
  const usd = f.px * f.sz;
  return { time: f.time, side: f.side, sz: f.sz, notional: usd, vwap: f.px, pxFirst: f.px, pxLast: f.px, fills: 1, levels: 1, taker: f.taker, makers: 1, topMakerUsd: usd };
}

/** Dziennik zakończonych zleceń agresora, rosnąco po czasie (zapytania o zakres przez wyszukiwanie binarne). */
export class OrderLog {
  private items: AggressorOrder[] = [];

  get length(): number {
    return this.items.length;
  }

  add(orders: readonly AggressorOrder[]): void {
    for (const o of orders) {
      const arr = this.items;
      if (arr.length === 0 || arr[arr.length - 1].time <= o.time) arr.push(o);
      else arr.splice(lowerBound(arr, o.time + 1), 0, o);
    }
  }

  /** Zlecenia z [from, to). */
  range(from: number, to: number): AggressorOrder[] {
    return this.items.slice(lowerBound(this.items, from), lowerBound(this.items, to));
  }

  /** `n` najnowszych, od najnowszego. */
  latest(n: number): AggressorOrder[] {
    return this.items.slice(-n).reverse();
  }

  prune(before: number): void {
    const i = lowerBound(this.items, before);
    if (i > 0) this.items = this.items.slice(i);
  }
}

/** Pierwszy indeks z czasem ≥ t. */
function lowerBound(arr: readonly AggressorOrder[], t: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
