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
  /** Wielkości (jednostki rynku) w tej samej kolejności. */
  sz: Float64Array;
  /** Liczba zleceń na poziomie (NaN, gdy API jej nie podało). */
  n: Float64Array;
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
  const cnt = new Float64Array(n);
  let k = 0;
  for (const l of [...snap.bids, ...snap.asks]) {
    px[k] = l.px;
    sz[k] = l.sz;
    cnt[k++] = l.n;
  }
  return { t: snap.time, step, px, sz, n: cnt, nBids: snap.bids.length };
}

/**
 * Duże zlecenie w arkuszu: poziom, na którym średnie zlecenie (wartość poziomu / liczba zleceń) jest od progu —
 * jedno albo kilka dużych zleceń, a nie tłum drobnych. Trwa, dopóki poziom może je mieścić (patrz `largeLots`);
 * `open` — jest w najnowszej migawce.
 */
export interface LargeLot {
  px: number;
  bid: boolean;
  from: number;
  to: number;
  open: boolean;
  /** Wartość poziomu (USD) i liczba zleceń w migawce z największym średnim zleceniem. */
  usd: number;
  orders: number;
}

/**
 * Próg dużego zlecenia w arkuszu z samego arkusza: kwantyl `q` średniego zlecenia poziomu (wartość / liczba zleceń)
 * ze wszystkich poziomów migawek, nie niżej niż `floorUsd`. Stały próg w USD nie przenosi się między rynkami
 * (pomiar 24.10: mediana średniego zlecenia BTC i ETH ok. 49 tys. USD, HYPE ok. 6 tys.). Bez migawek — `floorUsd`.
 */
export function lotThreshold(frames: readonly BookFrame[], floorUsd: number, q = 0.99): number {
  const xs: number[] = [];
  for (const f of frames) {
    for (let i = 0; i < f.px.length; i++) if (f.n[i] >= 1) xs.push((f.sz[i] * f.px[i]) / f.n[i]);
  }
  if (xs.length === 0) return floorUsd;
  xs.sort((a, b) => a - b);
  return Math.max(floorUsd, xs[Math.min(xs.length - 1, Math.floor(q * xs.length))]);
}

/** Ciągłość dużego zlecenia: poziom mieści co najmniej tyle jego wartości i nie traci tyle między migawkami. */
const LOT_HOLD = 0.75;
/** Cena poza widocznymi poziomami migawki (20 na stronę): zlecenie czeka najwyżej tyle ms na powrót ceny w zasięg. */
export const LOT_GAP_MS = 60_000;

/** Cena głębiej niż najdalszy widoczny poziom strony zlecenia (bidy malejąco, aski rosnąco). */
function beyond(f: BookFrame, l: LargeLot): boolean {
  if (l.bid) return f.nBids === 0 || l.px < f.px[f.nBids - 1];
  return f.px.length === f.nBids || l.px > f.px[f.px.length - 1];
}

/**
 * Duże zlecenia z kolejnych migawek jednej agregacji (rosnąco po czasie), w kolejności pojawienia się. Start: średnie
 * zlecenie poziomu od `minUsd`. Dołączenie drobnych zleceń obniża średnią, ale duże zlecenie nadal stoi, więc koniec
 * dopiero, gdy poziom nie mieści LOT_HOLD jego wartości, stracił tyle od poprzedniej migawki (zdjęte albo wypełnione)
 * albo zniknął z arkusza. Poza widocznymi poziomami zlecenie trwa bez przedłużania linii, najwyżej LOT_GAP_MS.
 */
export function largeLots(frames: readonly BookFrame[], minUsd: number): LargeLot[] {
  const live = new Map<string, { lot: LargeLot; size: number; prev: number }>();
  const out: LargeLot[] = [];
  for (const f of frames) {
    const seen = new Set<string>();
    for (let i = 0; i < f.px.length; i++) {
      const orders = f.n[i];
      const usd = f.sz[i] * f.px[i];
      const bid = i < f.nBids;
      const key = `${bid ? 'b' : 'a'}${f.px[i]}`;
      const cur = live.get(key);
      if (cur) {
        if (usd < LOT_HOLD * cur.size || usd < cur.prev - LOT_HOLD * cur.size) continue;
        seen.add(key);
        cur.lot.to = f.t;
        cur.prev = usd;
        if (orders >= 1 && usd / orders > cur.lot.usd / cur.lot.orders) {
          cur.lot.usd = usd;
          cur.lot.orders = orders;
        }
        continue;
      }
      if (!(orders >= 1) || usd / orders < minUsd) continue;
      seen.add(key);
      const lot: LargeLot = { px: f.px[i], bid, from: f.t, to: f.t, open: true, usd, orders };
      live.set(key, { lot, size: usd / orders, prev: usd });
      out.push(lot);
    }
    for (const [key, { lot }] of live) {
      if (seen.has(key)) continue;
      const far = beyond(f, lot);
      if (far && f.t - lot.to <= LOT_GAP_MS) continue;
      if (!far) lot.to = f.t;
      lot.open = false;
      live.delete(key);
    }
  }
  // Czekające poza zasięgiem nie są w najnowszej migawce
  const last = frames[frames.length - 1];
  for (const { lot } of live.values()) if (lot.to < last.t) lot.open = false;
  return out;
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

/** Cyfry znaczące l2Book (wspólne z rejestratorem historii na serwerze). */
export { bookSigFigs } from '../../../utils/tapeHistory';
