import type { Fill } from '../hl/parse';

/**
 * Kto przyjmuje agresję: wypełnienia po stronie makera (każda transakcja Hyperliquid ma konto makera) rozdzielone na
 * animatorów rynku i resztę. Konto jest w godzinie UTC animatorem, gdy dawało płynność w co najmniej połowie jej minut
 * z taśmą z kontami i po obu stronach (każda co najmniej 20% jego wartości po stronie makera). W historii serwera konto ma
 * numer ważny w obrębie godziny, więc klasa też jest godzinowa; w bieżącej godzinie liczy się z minut, które już minęły.
 * Pokazujemy tylko sumy, bez kont.
 */

const HOUR = 3_600_000;
const MIN = 60_000;
/** Najmniejszy udział minut godziny z wypełnieniami makera i najmniejszy udział słabszej strony w jego wartości. */
export const MM_MINUTES = 0.5;
export const MM_SIDE = 0.2;

/** Konto w minucie: wartość kupiona i sprzedana jako maker (USD) i delta agresorów, których przyjęło (jednostki rynku). */
interface Entry {
  bid: number;
  ask: number;
  delta: number;
}

export interface MakerSplit {
  /** Delta agresorów przyjęta przez animatorów i przez resztę makerów (jednostki rynku); razem delta świecy. */
  mm: number;
  rest: number;
  /** Udział animatorów w wartości po stronie makera. */
  mmShare: number;
}

export class MakerFlow {
  private readonly minutes = new Map<number, Map<string, Entry>>();
  /** Liczba wypełnień godziny (klucz pamięci podręcznej klas). */
  private readonly fills = new Map<number, number>();
  private readonly classes = new Map<number, { n: number; minutes: number; mm: Set<string> }>();

  /** Wypełnienia z kontem makera (bez konta — pominięte). */
  add(list: readonly Fill[]): void {
    for (const f of list) {
      if (f.maker === '') continue;
      const m0 = Math.floor(f.time / MIN) * MIN;
      let m = this.minutes.get(m0);
      if (!m) this.minutes.set(m0, (m = new Map()));
      let e = m.get(f.maker);
      if (!e) m.set(f.maker, (e = { bid: 0, ask: 0, delta: 0 }));
      // Agresor kupuje — maker sprzedaje
      if (f.side > 0) e.ask += f.px * f.sz;
      else e.bid += f.px * f.sz;
      e.delta += f.side * f.sz;
      const h = Math.floor(f.time / HOUR) * HOUR;
      this.fills.set(h, (this.fills.get(h) ?? 0) + 1);
    }
  }

  /**
   * Delta agresorów w [from, to) (w jednej godzinie UTC) przyjęta przez animatorów i resztę; `minutes` — liczba minut
   * godziny z taśmą z kontami do teraz. Null bez wypełnień z kontem makera.
   */
  split(from: number, to: number, minutes: number): MakerSplit | null {
    const mm = this.mmOf(Math.floor(from / HOUR) * HOUR, minutes);
    let dMm = 0;
    let dRest = 0;
    let usdMm = 0;
    let usd = 0;
    for (let t = Math.floor(from / MIN) * MIN; t < to; t += MIN) {
      for (const [k, e] of this.minutes.get(t) ?? []) {
        const v = e.bid + e.ask;
        usd += v;
        if (mm.has(k)) {
          dMm += e.delta;
          usdMm += v;
        } else dRest += e.delta;
      }
    }
    return usd > 0 ? { mm: dMm, rest: dRest, mmShare: usdMm / usd } : null;
  }

  prune(before: number): void {
    for (const t of this.minutes.keys()) if (t + MIN <= before) this.minutes.delete(t);
    for (const h of this.fills.keys())
      if (h + HOUR <= before) {
        this.fills.delete(h);
        this.classes.delete(h);
      }
  }

  /** Animatorzy godziny `h` (liczeni od nowa tylko po nowych wypełnieniach albo minutach taśmy). */
  private mmOf(h: number, minutes: number): Set<string> {
    const n = this.fills.get(h) ?? 0;
    const hit = this.classes.get(h);
    if (hit && hit.n === n && hit.minutes === minutes) return hit.mm;
    const acc = new Map<string, { mins: number; bid: number; ask: number }>();
    for (let t = h; t < h + HOUR; t += MIN) {
      for (const [k, e] of this.minutes.get(t) ?? []) {
        let a = acc.get(k);
        if (!a) acc.set(k, (a = { mins: 0, bid: 0, ask: 0 }));
        a.mins++;
        a.bid += e.bid;
        a.ask += e.ask;
      }
    }
    const mm = new Set<string>();
    for (const [k, a] of acc) if (minutes > 0 && a.mins >= MM_MINUTES * minutes && Math.min(a.bid, a.ask) >= MM_SIDE * (a.bid + a.ask)) mm.add(k);
    this.classes.set(h, { n, minutes, mm });
    return mm;
  }
}
