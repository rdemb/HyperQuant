import type { BookSnapshot, Fill, Side } from '../hl/parse';
import type { AggressorOrder } from './orders';

/**
 * Klasy zderzeń z adresów Hyperliquid (każda transakcja ma adres biorcy i makera), liczone dokładnie,
 * bez zgadywania z wielkości wydruków:
 * - duże zlecenie — jedno zlecenie agresora od progu, zebrane z wielu makerów,
 * - bitwa — duże zlecenie agresora, którego dużą część (od połowy progu) dał jeden maker,
 * - seria — wiele małych zleceń różnych biorców po tej samej stronie w krótkim oknie, razem od progu,
 * - ściana — jeden maker na jednej cenie wchłonął od progu z co najmniej trzech różnych zleceń agresora;
 *   ściana, która wchłonęła co najmniej 2 × więcej, niż cały poziom arkusza kiedykolwiek pokazywał, to góra lodowa
 *   (zlecenie odnawiane po każdym wypełnieniu — widać tylko jego wierzchołek).
 * Próg dobiera się sam do rynku: wysoki kwantyl wartości zleceń z ostatniej godziny.
 */

export type OrderClass = 'big' | 'clash';

/** Próg bez wystarczającej próbki (USD) i jego granice. */
export const DEFAULT_THRESHOLD_USD = 100_000;
const MIN_THRESHOLD_USD = 25_000;
const MAX_THRESHOLD_USD = 5_000_000;
/** Kwantyl wartości zleceń i najmniejsza próbka do progu automatycznego. */
const AUTO_Q = 0.985;
const AUTO_MIN_SAMPLES = 200;

/** Zaokrąglenie w górę do 1, 2 albo 5 × 10^k (czytelny próg). */
export function niceUp(v: number): number {
  if (!(v > 0)) return 0;
  const k = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (m * k >= v * (1 - 1e-12)) return m * k;
  return 10 * k;
}

/** Próg dużego zlecenia (USD) z wartości zleceń agresora; za mała próbka = próg domyślny. */
export function autoThreshold(orders: readonly AggressorOrder[]): number {
  if (orders.length < AUTO_MIN_SAMPLES) return DEFAULT_THRESHOLD_USD;
  const v = orders.map((o) => o.notional).sort((a, b) => a - b);
  const q = v[Math.min(v.length - 1, Math.floor(v.length * AUTO_Q))];
  return Math.min(MAX_THRESHOLD_USD, Math.max(MIN_THRESHOLD_USD, niceUp(q)));
}

/** Klasa zlecenia od progu `t` (USD); null = poniżej progu. */
export function classify(o: AggressorOrder, t: number): OrderClass | null {
  if (o.notional < t) return null;
  return o.topMakerUsd >= t / 2 ? 'clash' : 'big';
}

export interface Burst {
  /** Czas pierwszego i ostatniego zlecenia serii (ms). */
  from: number;
  to: number;
  side: Side;
  usd: number;
  sz: number;
  vwap: number;
  orders: number;
  takers: number;
}

/** Okno serii (ms), najmniej różnych biorców i największe pojedyncze zlecenie serii (ułamek progu). */
export const BURST_WINDOW_MS = 2000;
const BURST_MIN_TAKERS = 4;
const BURST_SMALL = 0.25;

/**
 * Serie: kolejne zlecenia jednej strony mniejsze niż ćwierć progu, każde najwyżej `BURST_WINDOW_MS` od pierwszego
 * zlecenia serii; seria liczy się od `BURST_MIN_TAKERS` różnych biorców i łącznej wartości od progu. Zlecenia rosnąco po czasie.
 */
export function bursts(orders: readonly AggressorOrder[], t: number): Burst[] {
  const out: Burst[] = [];
  for (const side of [1, -1] as const) {
    let cur: AggressorOrder[] = [];
    const close = () => {
      if (cur.length === 0) return;
      const takers = new Set(cur.map((o) => o.taker || `#${o.time}`)).size;
      const usd = cur.reduce((s, o) => s + o.notional, 0);
      if (takers >= BURST_MIN_TAKERS && usd >= t) {
        const sz = cur.reduce((s, o) => s + o.sz, 0);
        out.push({ from: cur[0].time, to: cur[cur.length - 1].time, side, usd, sz, vwap: usd / sz, orders: cur.length, takers });
      }
      cur = [];
    };
    for (const o of orders) {
      if (o.side !== side || o.notional >= t * BURST_SMALL) continue;
      if (cur.length > 0 && o.time - cur[0].time > BURST_WINDOW_MS) close();
      cur.push(o);
    }
    close();
  }
  return out.sort((a, b) => a.from - b.from);
}

export interface Wall {
  /** Pierwsze i ostatnie wchłonięte wypełnienie (ms). */
  from: number;
  to: number;
  px: number;
  /** Strona makera: 1 = bidy (wchłaniał sprzedaż agresorów), −1 = aski (wchłaniał kupno). */
  side: Side;
  usd: number;
  sz: number;
  /** Różne zlecenia agresora (biorca + chwila) wchłonięte przez ten poziom. */
  hits: number;
  /** Największa wielkość poziomu w dokładnym arkuszu od chwili przed pierwszym wypełnieniem; 0 = poziom niewidoczny. */
  shown: number;
  /** Wchłonięte co najmniej `ICEBERG_RATIO` × więcej niż `shown`, z wypełnieniami także po migawce, która pokazała poziom w trakcie. */
  iceberg: boolean;
}

interface Absorb extends Wall {
  maker: string;
  keys: Set<string>;
  /** Pierwsza migawka dokładnego arkusza po pierwszym wypełnieniu, w której poziom był widoczny (ms); +∞ = jeszcze żadna. */
  seen: number;
}

/** Ile razy więcej musi wchłonąć ściana niż największa widoczna wielkość poziomu, żeby była górą lodową. */
export const ICEBERG_RATIO = 2;

/**
 * Góra lodowa wymaga wypełnień po migawce, która w trakcie wchłaniania jeszcze pokazywała poziom: jedno przemiecenie
 * (albo kilka bloków przed następną migawką co ok. 5 s) bierze tylko to, co już stało w arkuszu — duża krotność
 * wynikałaby wtedy z nieaktualnej migawki sprzed postawienia zlecenia, a nie z odnawiania.
 */
const isIceberg = (a: { sz: number; shown: number; hits: number; to: number; seen: number }) =>
  a.hits >= WALL_MIN_HITS && a.to > a.seen && a.shown > 0 && a.sz >= ICEBERG_RATIO * a.shown;

/** Przerwa, po której wchłanianie na poziomie liczy się od nowa (ms), i najmniej trafień do ściany. */
export const WALL_GAP_MS = 30_000;
const WALL_MIN_HITS = 3;

/**
 * Ściany: suma wypełnień jednego makera na jednej cenie po jednej stronie, z przerwami najwyżej `WALL_GAP_MS`.
 * Adres makera zostaje w pamięci (klucz), wynik go nie zawiera.
 */
export class WallTracker {
  private readonly open = new Map<string, Absorb>();
  private closed: Absorb[] = [];
  /** Ostatni dokładny arkusz: wielkość na każdej cenie, osobno bidy i aski. */
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();

  /** Dokładny arkusz (bez agregacji): największa widoczna wielkość poziomów otwartych ścian. */
  observeBook(snap: BookSnapshot): void {
    this.bids = new Map(snap.bids.map((l) => [l.px, l.sz]));
    this.asks = new Map(snap.asks.map((l) => [l.px, l.sz]));
    this.open.forEach((a) => {
      const lv = this.level(a.side, a.px);
      a.shown = Math.max(a.shown, lv);
      if (lv > 0 && snap.time > a.from) a.seen = Math.min(a.seen, snap.time);
      a.iceberg = isIceberg(a);
    });
  }

  private level(side: Side, px: number): number {
    return (side === 1 ? this.bids : this.asks).get(px) ?? 0;
  }

  push(fills: readonly Fill[]): void {
    for (const f of fills) {
      if (!f.maker) continue;
      const side: Side = f.side === 1 ? -1 : 1;
      const key = `${f.maker}|${side}|${f.px}`;
      let a = this.open.get(key);
      if (a && f.time - a.to > WALL_GAP_MS) {
        this.closed.push(a);
        a = undefined;
      }
      if (!a) {
        // Wielkość poziomu tuż przed pierwszym wypełnieniem (ostatnia migawka arkusza)
        const shown = this.level(side, f.px);
        a = { maker: f.maker, from: f.time, to: f.time, px: f.px, side, usd: 0, sz: 0, hits: 0, shown, iceberg: false, keys: new Set(), seen: Number.POSITIVE_INFINITY };
        this.open.set(key, a);
      }
      a.to = Math.max(a.to, f.time);
      a.usd += f.px * f.sz;
      a.sz += f.sz;
      a.keys.add(f.taker ? `${f.taker}|${f.hash || f.time}` : `#${f.tid}`);
      a.hits = a.keys.size;
      a.iceberg = isIceberg(a);
    }
  }

  /** Ściany z wypełnień historii serwera (rosnąco po czasie), od razu zamknięte; bez dokładnego arkusza — bez gór lodowych. */
  pushHistory(fills: readonly Fill[]): void {
    const t = new WallTracker();
    t.push(fills);
    t.prune(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY);
    this.closed.push(...t.closed);
  }

  /** Ściany od progu `t` (USD), które zahaczają o [from, to). */
  walls(from: number, to: number, t: number): Wall[] {
    const out: Wall[] = [];
    const take = (a: Absorb) => {
      if (a.usd >= t && a.hits >= WALL_MIN_HITS && a.to >= from && a.from < to) {
        out.push({ from: a.from, to: a.to, px: a.px, side: a.side, usd: a.usd, sz: a.sz, hits: a.hits, shown: a.shown, iceberg: a.iceberg });
      }
    };
    for (const a of this.closed) take(a);
    this.open.forEach(take);
    return out.sort((p, q) => p.from - q.from);
  }

  /** Zamyka wchłanianie bez wypełnień od `WALL_GAP_MS` i zapomina starsze niż `before`. */
  prune(now: number, before: number): void {
    this.open.forEach((a, k) => {
      if (now - a.to > WALL_GAP_MS) {
        this.closed.push(a);
        this.open.delete(k);
      }
    });
    // Zostają tylko ściany (małe wchłanianie nie jest potrzebne po zamknięciu)
    this.closed = this.closed.filter((a) => a.to >= before && a.hits >= WALL_MIN_HITS && a.usd >= MIN_THRESHOLD_USD);
  }
}

export interface WalletSummary {
  /** Pseudonim konta na czas otwarcia strony („Konto 3”) — adresu nie pokazujemy. */
  label: string;
  orders: number;
  buySz: number;
  sellSz: number;
  buyUsd: number;
  sellUsd: number;
  largestUsd: number;
  first: number;
  last: number;
}

const aliases = new Map<string, string>();

/** Pseudonim konta biorcy: kolejny numer w kolejności pierwszego pokazania na tej stronie (adres zostaje tylko w pamięci). */
export function takerAlias(address: string): string {
  let a = aliases.get(address);
  if (!a) {
    a = `Konto ${aliases.size + 1}`;
    aliases.set(address, a);
  }
  return a;
}

/** Zlecenia agresora jednego adresu z pamięci strony. */
export function walletSummary(orders: readonly AggressorOrder[], address: string): WalletSummary | null {
  let n = 0;
  const s = { buySz: 0, sellSz: 0, buyUsd: 0, sellUsd: 0, largestUsd: 0, first: Number.POSITIVE_INFINITY, last: 0 };
  for (const o of orders) {
    if (o.taker !== address) continue;
    n++;
    if (o.side === 1) {
      s.buySz += o.sz;
      s.buyUsd += o.notional;
    } else {
      s.sellSz += o.sz;
      s.sellUsd += o.notional;
    }
    s.largestUsd = Math.max(s.largestUsd, o.notional);
    s.first = Math.min(s.first, o.time);
    s.last = Math.max(s.last, o.time);
  }
  return n > 0 && address ? { label: takerAlias(address), orders: n, ...s } : null;
}
