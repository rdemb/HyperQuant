/**
 * Warstwa wielorybów — format pliku `whales.json` współdzielony przez skaner i stronę (bez importów zewnętrznych;
 * uruchamiany także natywnie przez Node 24).
 *
 * Hyperliquid udostępnia publicznie pozycje i zlecenia oczekujące każdego konta. Skaner czyta je dla największych kont
 * z publicznego rankingu i dużych pozycji BTC z taśmy, a publikuje bez adresów: konto ma pseudonim ważny jedną dobę UTC
 * (skrót z sekretem znanym tylko serwerowi), więc pozycję da się połączyć z jej zleceniami, ale nie z portfelem.
 */

export const WHALES_VERSION = 1;

export interface WhalePosition {
  /** Pseudonim konta na dobę UTC */
  id: string;
  side: 'long' | 'short';
  /** Wartość pozycji po cenie mark, USD */
  usd: number;
  /** Wielkość (jednostki rynku) */
  sz: number;
  entry: number;
  /** Cena likwidacji; null = brak (np. pozycja zabezpieczona marżą krzyżową z zapasem) */
  liq: number | null;
  /** Dźwignia (krotność) */
  lev: number;
  /** Niezrealizowany wynik, USD */
  upnl: number;
  /** Czas odczytu (ms) */
  at: number;
}

export interface WhaleOrder {
  id: string;
  /** bid = kupno, ask = sprzedaż */
  side: 'bid' | 'ask';
  /** Cena limitu albo wyzwolenia (stop, take profit) */
  px: number;
  /** Wartość, USD */
  usd: number;
  kind: 'limit' | 'stop' | 'tp';
  /** Tylko zmniejsza pozycję (także TP/SL pozycji) */
  reduce: boolean;
  at: number;
}

export interface WhaleLayer {
  v: number;
  asOf: number;
  /** Konta odczytane w ostatnich 15 min / kandydaci */
  accounts: number;
  candidates: number;
  /** Progi publikacji (USD) dla rynku */
  minPositionUsd: Record<string, number>;
  minOrderUsd: Record<string, number>;
  markets: Record<string, { positions: WhalePosition[]; orders: WhaleOrder[] }>;
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function isPosition(p: unknown): p is WhalePosition {
  const x = p as Partial<WhalePosition> | null;
  return !!x && typeof x.id === 'string' && (x.side === 'long' || x.side === 'short') && fin(x.usd) && fin(x.sz) && fin(x.entry) && (x.liq === null || fin(x.liq)) && fin(x.lev) && fin(x.upnl) && fin(x.at);
}

function isOrder(o: unknown): o is WhaleOrder {
  const x = o as Partial<WhaleOrder> | null;
  return !!x && typeof x.id === 'string' && (x.side === 'bid' || x.side === 'ask') && fin(x.px) && fin(x.usd) && (x.kind === 'limit' || x.kind === 'stop' || x.kind === 'tp') && typeof x.reduce === 'boolean' && fin(x.at);
}

export function isWhaleLayer(x: unknown): x is WhaleLayer {
  const o = x as Partial<WhaleLayer> | null;
  if (!o || o.v !== WHALES_VERSION || !fin(o.asOf) || !fin(o.accounts) || !fin(o.candidates) || !o.markets || typeof o.markets !== 'object') return false;
  return Object.values(o.markets).every((m) => !!m && Array.isArray(m.positions) && m.positions.every(isPosition) && Array.isArray(m.orders) && m.orders.every(isOrder));
}

/** Zlecenia jednego konta po jednej stronie i jednego rodzaju: zakres cen, liczba i suma wartości. */
export interface WhaleOrderGroup {
  id: string;
  side: WhaleOrder['side'];
  kind: WhaleOrder['kind'];
  lo: number;
  hi: number;
  n: number;
  usd: number;
}

/** Łączy zlecenia tego samego konta, strony i rodzaju (np. drabinkę sprzedaży co kilka ticków); od największej sumy. */
export function groupWhaleOrders(orders: readonly WhaleOrder[]): WhaleOrderGroup[] {
  const by = new Map<string, WhaleOrderGroup>();
  for (const o of orders) {
    const key = `${o.id}|${o.side}|${o.kind}`;
    const g = by.get(key);
    if (g) {
      g.lo = Math.min(g.lo, o.px);
      g.hi = Math.max(g.hi, o.px);
      g.n++;
      g.usd += o.usd;
    } else by.set(key, { id: o.id, side: o.side, kind: o.kind, lo: o.px, hi: o.px, n: 1, usd: o.usd });
  }
  return [...by.values()].sort((a, b) => b.usd - a.usd);
}
