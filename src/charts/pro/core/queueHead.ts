import type { TradeScan } from './ladder';

/**
 * Czoło kolejki z kanału `bbo` Hyperliquid (najlepszy bid i ask z wielkością i liczbą zleceń, kilka razy na sekundę):
 * ubytek najlepszego poziomu między kolejnymi aktualizacjami rozłożony na transakcje na tej cenie (zjedzone) i resztę
 * (anulowane), a transakcje ponad ubytek to dolanie. Rozliczamy z opóźnieniem, żeby transakcje z tej samej chwili
 * zdążyły dojść strumieniem. Bilans netto w odstępie aktualizacji: zlecenie dołożone i zdjęte między nimi jest niewidoczne.
 */

/** Najlepszy poziom jednej strony: cena, wielkość, liczba zleceń. */
export interface HeadLevel {
  px: number;
  sz: number;
  n: number;
}

/** Czoło teraz: poziom, czas aktualizacji i od kiedy ta cena jest najlepsza. */
export interface HeadNow extends HeadLevel {
  t: number;
  since: number;
}

/** Przepływ przez czoło jednej strony (USD). */
export interface HeadFlow {
  eaten: number;
  pulled: number;
  refill: number;
}

/** Rozliczenie aktualizacji po tylu ms (transakcje z tej chwili są już na taśmie). */
export const HEAD_DELAY_MS = 2000;
/** Przerwa między aktualizacjami dłuższa niż tyle ms (zerwane połączenie) — bez rozliczenia tego odstępu. */
export const HEAD_GAP_MS = 10_000;
const KEEP_MS = 15 * 60_000;

interface Update {
  t: number;
  bid: HeadLevel | null;
  ask: HeadLevel | null;
}

interface Event extends HeadFlow {
  t: number;
  bid: boolean;
}

const sameOrNull = (a: HeadNow | null, b: HeadLevel | null, t: number): HeadNow | null =>
  b === null ? null : { ...b, t, since: a !== null && a.px === b.px ? a.since : t };

export class QueueHead {
  /** Najnowsze czoło (bez czekania na rozliczenie). */
  bid: HeadNow | null = null;
  ask: HeadNow | null = null;
  /** Pierwsza aktualizacja w tej sesji (+∞ przed nią) — „stoi od” nie sięga wcześniej. */
  first = Number.POSITIVE_INFINITY;
  /** Początek rozliczonego czasu (+∞ przed pierwszym rozliczeniem) i jego koniec. */
  from = Number.POSITIVE_INFINITY;
  to = 0;
  private queue: Update[] = [];
  private last: Update | null = null;
  private lastPush = 0;
  private events: Event[] = [];

  push(t: number, bid: HeadLevel | null, ask: HeadLevel | null): void {
    if (!(t > 0) || t < this.lastPush) return;
    if (this.first === Number.POSITIVE_INFINITY) this.first = t;
    // Po przerwie „stoi od” liczymy od nowa
    const gap = t - this.lastPush > HEAD_GAP_MS;
    this.lastPush = t;
    this.bid = sameOrNull(gap ? null : this.bid, bid, t);
    this.ask = sameOrNull(gap ? null : this.ask, ask, t);
    this.queue.push({ t, bid, ask });
  }

  /** Zerwane połączenie: czoło nieznane, odstęp przez przerwę bez rozliczenia (taśma też ma w nim lukę). */
  reset(): void {
    this.queue = [];
    this.last = null;
    this.lastPush = 0;
    this.bid = null;
    this.ask = null;
  }

  /** Rozlicza aktualizacje starsze niż `now − HEAD_DELAY_MS` z transakcjami z taśmy. */
  settle(now: number, scan: TradeScan): void {
    let i = 0;
    for (; i < this.queue.length && this.queue[i].t <= now - HEAD_DELAY_MS; i++) {
      const u = this.queue[i];
      const p = this.last;
      if (p && u.t - p.t <= HEAD_GAP_MS) {
        this.step(p.bid, u.bid, p.t, u.t, true, scan);
        this.step(p.ask, u.ask, p.t, u.t, false, scan);
        if (this.from === Number.POSITIVE_INFINITY) this.from = p.t;
        this.to = u.t;
      }
      this.last = u;
    }
    if (i > 0) this.queue.splice(0, i);
    const cut = now - KEEP_MS;
    let k = 0;
    while (k < this.events.length && this.events[k].t < cut) k++;
    if (k > 0) this.events.splice(0, k);
  }

  /** Suma przepływu przez czoło w [from, to) dla bidów i asków. */
  flow(from: number, to: number): { bid: HeadFlow; ask: HeadFlow } {
    const bid = { eaten: 0, pulled: 0, refill: 0 };
    const ask = { eaten: 0, pulled: 0, refill: 0 };
    for (const e of this.events) {
      if (e.t < from || e.t >= to) continue;
      const s = e.bid ? bid : ask;
      s.eaten += e.eaten;
      s.pulled += e.pulled;
      s.refill += e.refill;
    }
    return { bid, ask };
  }

  // Stare czoło `p` w chwili `a`, nowe `n` w chwili `b`: bid zdejmują sprzedający agresorzy, ask kupujący
  private step(p: HeadLevel | null, n: HeadLevel | null, a: number, b: number, bid: boolean, scan: TradeScan): void {
    if (!p || !n) return;
    // Nowe czoło przed starym: stary poziom stoi dalej poza czołem, nie wiemy, co się z nim dzieje
    if (bid ? n.px > p.px : n.px < p.px) return;
    const hit = bid ? -1 : 1;
    let traded = 0;
    scan(a + 1, b + 1, (_t, px, sz, side) => {
      if (side === hit && px === p.px) traded += sz;
    });
    const gone = p.sz - (n.px === p.px ? n.sz : 0);
    const pulled = Math.max(0, gone - traded);
    const refill = Math.max(0, traded - gone);
    if (traded === 0 && pulled === 0) return;
    this.events.push({ t: b, bid, eaten: traded * p.px, pulled: pulled * p.px, refill: refill * p.px });
  }
}
