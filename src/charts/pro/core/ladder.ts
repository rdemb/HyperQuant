import type { BookFrame } from './book';
import type { Side } from '../hl/parse';

/**
 * Drabina DOM na stałej siatce cen jednej agregacji: od najlepszego bidu w dół i od najlepszego asku w górę co krok,
 * także ceny bez zleceń. Hyperliquid podaje 20 niepustych poziomów na stronę, więc cena między najlepszym
 * a najdalszym widocznym poziomem bez wpisu jest pusta (0), a dalej — nieznana (NaN, poza zasięgiem migawki).
 * Kubełki jak w arkuszu Hyperliquid: bid b = ceny [b, b + krok), ask a = (a − krok, a].
 */

/** Transakcje z [from, to): czas, cena, wielkość, strona agresora (1 = kupujący zdejmuje aski, −1 = sprzedający bidy). */
export type TradeScan = (from: number, to: number, fn: (t: number, px: number, sz: number, side: Side) => void) => void;

export interface LadderRow {
  px: number;
  bid: boolean;
  /** Wielkość (jednostki rynku); 0 = pusta cena, NaN = poza widocznymi poziomami. */
  sz: number;
  /** Liczba zleceń na poziomie (NaN, gdy nieznana). */
  n: number;
}

/** Klucz poziomu strony (ta sama cena bywa bidem i askiem w różnych migawkach). */
export const levelKey = (bid: boolean, px: number) => `${bid ? 'b' : 'a'}${px}`;

/** Wielokrotność kroku zaokrąglona do jego miejsc dziesiętnych (0,1 × 3 = 0,3, a nie 0,30000000000000004). */
const times = (k: number, step: number) => {
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return Number((k * step).toFixed(dec));
};

/** Cena na siatce kroku. */
export const onGrid = (px: number, step: number) => times(Math.round(px / step), step);

/** Kubełek ceny transakcji albo zlecenia po stronie bidów (w dół) i asków (w górę). */
export function bucketOf(px: number, step: number, bid: boolean): number {
  const r = px / step;
  return times(bid ? Math.floor(r + 1e-9) : Math.ceil(r - 1e-9), step);
}

/** Wiersze drabiny: `perSide` cen asków (rosnąco od najlepszego) i bidów (malejąco od najlepszego). */
export function ladderRows(f: BookFrame, perSide: number): { asks: LadderRow[]; bids: LadderRow[] } {
  const step = f.step;
  const side = (bid: boolean): LadderRow[] => {
    const from = bid ? 0 : f.nBids;
    const to = bid ? f.nBids : f.px.length;
    if (to <= from) return [];
    const by = new Map<number, number>();
    for (let i = from; i < to; i++) by.set(onGrid(f.px[i], step), i);
    const best = f.px[from];
    const last = f.px[to - 1];
    const out: LadderRow[] = [];
    for (let k = 0; k < perSide; k++) {
      const px = onGrid(best + (bid ? -k : k) * step, step);
      const i = by.get(px);
      const far = bid ? px < last : px > last;
      out.push({ px, bid, sz: i !== undefined ? f.sz[i] : far ? Number.NaN : 0, n: i !== undefined ? f.n[i] : Number.NaN });
    }
    return out;
  };
  return { asks: side(false), bids: side(true) };
}

/** Wielkości poziomów migawki po kluczu strony i ceny (pamięć podręczna — migawki się nie zmieniają). */
const levelMaps = new WeakMap<BookFrame, Map<string, number>>();
export function levelsOf(f: BookFrame): Map<string, number> {
  let m = levelMaps.get(f);
  if (!m) {
    m = new Map();
    for (let i = 0; i < f.px.length; i++) m.set(levelKey(i < f.nBids, onGrid(f.px[i], f.step)), f.sz[i]);
    levelMaps.set(f, m);
  }
  return m;
}

/**
 * Historia wierszy do mini mapy ciepła: `cols` kolumn czasu w [from, to), dla każdego wiersza wielkość z migawki
 * obowiązującej w środku kolumny (NaN = brak migawki albo cena poza jej zasięgiem). Układ: wiersz × kolumna.
 */
export function heatHistory(frames: readonly BookFrame[], rows: readonly LadderRow[], from: number, to: number, cols: number, maxGapMs: number): Float32Array {
  const out = new Float32Array(rows.length * cols).fill(Number.NaN);
  if (frames.length === 0 || cols <= 0 || !(to > from)) return out;
  const dt = (to - from) / cols;
  let j = 0;
  for (let c = 0; c < cols; c++) {
    const t = from + (c + 0.5) * dt;
    while (j + 1 < frames.length && frames[j + 1].t <= t) j++;
    const f = frames[j];
    if (f.t > t || t - f.t > maxGapMs) continue;
    const lv = levelsOf(f);
    const lastBid = f.nBids > 0 ? f.px[f.nBids - 1] : Number.POSITIVE_INFINITY;
    const lastAsk = f.px.length > f.nBids ? f.px[f.px.length - 1] : Number.NEGATIVE_INFINITY;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const v = lv.get(levelKey(row.bid, row.px));
      if (v !== undefined) out[r * cols + c] = v;
      // Ta strona miała tę cenę w zasięgu, ale bez zleceń — pusto; wiersz innej strony (cena po drugiej stronie spreadu) też pusty
      else if (row.bid ? row.px >= lastBid : row.px <= lastAsk) out[r * cols + c] = 0;
    }
  }
  return out;
}

/** Wartość (USD) transakcji w [from, to) na wierszach: sprzedający agresor zdejmuje bidy, kupujący aski. */
export function tradedAt(scan: TradeScan, from: number, to: number, step: number): Map<string, number> {
  const m = new Map<string, number>();
  scan(from, to, (_t, px, sz, side) => {
    const bid = side === -1;
    const k = levelKey(bid, bucketOf(px, step, bid));
    m.set(k, (m.get(k) ?? 0) + px * sz);
  });
  return m;
}
