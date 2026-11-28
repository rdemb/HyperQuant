/**
 * Rekordy plików noda Hyperliquid (`~/hl/data/<rodzaj>/hourly/<data>/<godzina>`, JSON w linii). Schematy według
 * dokumentacji „L1 data schemas” (hyperliquid.gitbook.io) — do potwierdzenia na prawdziwych plikach pierwszego noda,
 * dlatego parsowanie jest obronne: nieznany kształt to rekord pominięty (null), nigdy wyjątek ani zgadnięta wartość.
 */

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): number => (typeof x === 'string' || typeof x === 'number' ? Number(x) : Number.NaN);
const str = (x: unknown): string | null => (typeof x === 'string' && x.length > 0 ? x : null);

/**
 * Zdarzenia z jednej linii pliku: pojedyncze zdarzenie albo blok (`--batch-by-block`, `--stream-with-block-info`:
 * `{ local_time, block_time, block_number, events: [...] }`). Zła linia — pusta lista.
 */
export function eventsOfLine(line: string): unknown[] {
  let x: unknown;
  try {
    x = JSON.parse(line);
  } catch {
    return [];
  }
  if (isRecord(x) && Array.isArray(x.events) && 'block_number' in x) return x.events;
  return x === null || x === undefined ? [] : [x];
}

export interface NodeFill {
  user: string;
  coin: string;
  px: number;
  sz: number;
  /** `B` — kupno, `A` — sprzedaż (jak w API) */
  side: 'B' | 'A';
  time: number;
  startPosition: number;
  /** Kierunek pozycji („Open Long”, „Close Short”…; likwidacje mają własny opis) */
  dir: string;
  closedPnl: number;
  hash: string;
  oid: number;
  /** Strona biorcy (agresor) */
  crossed: boolean;
  tid: number;
  twapId: number | null;
}

/** Wypełnienie z `node_fills`: para `[adres, obiekt]` (dokumentacja); zły kształt — null. */
export function parseFill(x: unknown): NodeFill | null {
  if (!Array.isArray(x) || x.length !== 2 || !isRecord(x[1])) return null;
  const user = str(x[0]);
  const f = x[1];
  const coin = str(f.coin);
  const px = num(f.px);
  const sz = num(f.sz);
  const time = num(f.time);
  const oid = num(f.oid);
  const tid = num(f.tid);
  if (!user || !coin || !(px > 0) || !(sz > 0) || !(time > 0) || (f.side !== 'B' && f.side !== 'A') || !Number.isFinite(oid) || !Number.isFinite(tid)) return null;
  const twap = num(f.twapId);
  return {
    user,
    coin,
    px,
    sz,
    side: f.side,
    time,
    startPosition: Number.isFinite(num(f.startPosition)) ? num(f.startPosition) : 0,
    dir: str(f.dir) ?? '',
    closedPnl: Number.isFinite(num(f.closedPnl)) ? num(f.closedPnl) : 0,
    hash: str(f.hash) ?? '',
    oid,
    crossed: f.crossed === true,
    tid,
    twapId: Number.isFinite(twap) ? twap : null,
  };
}

/** Pozycja po wypełnieniu (ze znakiem: plus — długa): pozycja przed + wielkość ze stroną. */
export const positionAfter = (f: NodeFill): number => f.startPosition + (f.side === 'B' ? f.sz : -f.sz);

export interface NodeLiquidation {
  time: number;
  hash: string;
  /** Adres likwidowanego konta, gdy rekord go podaje */
  user: string | null;
  /** Nominał zlikwidowanych pozycji (USD) */
  ntl: number;
  accountValue: number;
  leverageType: string;
  positions: { coin: string; szi: number }[];
}

/**
 * Likwidacja z `misc_events` (`{ time, hash, inner: { Liquidation: {...} } }`): także konta, których skaner nigdy nie
 * odpytywał — publiczne API takiego strumienia nie ma. Inne zdarzenia (finansowanie, wpłaty…) i zły kształt — null.
 */
export function parseLiquidation(x: unknown): NodeLiquidation | null {
  if (!isRecord(x) || !isRecord(x.inner) || !isRecord(x.inner.Liquidation)) return null;
  const l = x.inner.Liquidation;
  const time = typeof x.time === 'string' ? Date.parse(x.time) : num(x.time);
  const ntl = num(l.liquidatedNtlPos);
  const positions = (Array.isArray(l.liquidatedPositions) ? l.liquidatedPositions : [])
    .filter(isRecord)
    .map((p) => ({ coin: str(p.coin) ?? '', szi: num(p.szi) }))
    .filter((p) => p.coin !== '' && Number.isFinite(p.szi));
  if (!(time > 0) || !Number.isFinite(ntl) || positions.length === 0) return null;
  return {
    time,
    hash: str(x.hash) ?? '',
    user: str(l.liquidatedUser) ?? str(l.user),
    ntl,
    accountValue: Number.isFinite(num(l.accountValue)) ? num(l.accountValue) : Number.NaN,
    leverageType: str(l.leverageType) ?? '',
    positions,
  };
}
