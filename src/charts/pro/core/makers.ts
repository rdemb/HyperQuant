import type { Fill } from '../hl/parse';

/**
 * Kto przyjmuje agresję: wypełnienia po stronie makera (każda transakcja Hyperliquid ma konto makera) rozdzielone na
 * animatorów rynku i resztę. Konto jest w świecy animatorem, gdy w 60 minutach do jej zamknięcia dawało płynność w co
 * najmniej połowie minut z taśmą z kontami i po obu stronach (każda co najmniej 20% jego wartości po stronie makera).
 * Okno nie sięga za zamknięcie świecy, więc zamknięta świeca się nie zmienia; w bieżącej świecy liczą się minuty, które
 * już minęły. W historii serwera konto ma numer ważny w obrębie doby UTC (pliki `idScope: 'day'`) albo godziny (starsze
 * pliki), więc okno przez przełom doby (w starszych plikach — godziny) liczy jedno konto jako dwa.
 * Pokazujemy tylko sumy, bez kont.
 */

const HOUR = 3_600_000;
const MIN = 60_000;
/** Najmniejszy udział minut okna z wypełnieniami makera i najmniejszy udział słabszej strony w jego wartości. */
export const MM_MINUTES = 0.5;
export const MM_SIDE = 0.2;

/** Konto w minucie: wartość kupiona i sprzedana jako maker (USD) i delta agresorów, których przyjęło (jednostki rynku). */
interface Entry {
  bid: number;
  ask: number;
  delta: number;
}

/** Konto w oknie: liczba minut z wypełnieniami i wartość po obu stronach w centach (sumy liczb całkowitych są dokładne). */
interface Acc {
  mins: number;
  bid: number;
  ask: number;
}

export interface MakerSplit {
  /** Delta agresorów przyjęta przez animatorów i przez resztę makerów (jednostki rynku); razem delta świecy. */
  mm: number;
  rest: number;
  /** Udział animatorów w wartości po stronie makera. */
  mmShare: number;
}

/** Makerzy jednej strony w oknie: liczba kont, wartość (USD) i największe konta malejąco. */
export interface MakerTop {
  n: number;
  usd: number;
  top: { key: string; usd: number }[];
}

export class MakerFlow {
  private readonly minutes = new Map<number, Map<string, Entry>>();
  /** Liczba wypełnień minuty (klucz pamięci podręcznej). */
  private readonly counts = new Map<number, number>();
  /** Podział świecy `od:do` z liczbą wypełnień okna i minut taśmy, przy których był liczony. */
  private readonly parts = new Map<string, { n: number; minutes: number; to: number; split: MakerSplit | null }>();
  /** Konta w oknie minut [w0, w1) z `n` wypełnieniami; świece po kolei przesuwają je zamiast liczyć od nowa. */
  private win: { w0: number; w1: number; n: number; acc: Map<string, Acc> } | null = null;

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
      this.counts.set(m0, (this.counts.get(m0) ?? 0) + 1);
    }
  }

  /**
   * Delta agresorów w [from, to) (świeca do godziny, `to` — jej zamknięcie) przyjęta przez animatorów i resztę; klasa konta
   * z 60 minut do `to`, `minutes` — liczba minut tego okna z taśmą z kontami do teraz. Null bez wypełnień z kontem makera.
   */
  split(from: number, to: number, minutes: number): MakerSplit | null {
    const w1 = Math.ceil(to / MIN) * MIN;
    const w0 = w1 - HOUR;
    const n = this.count(w0, w1);
    const key = `${from}:${to}`;
    const hit = this.parts.get(key);
    if (hit && hit.n === n && hit.minutes === minutes) return hit.split;
    const acc = this.window(w0, w1, n);
    const isMm = (k: string) => {
      const a = acc.get(k);
      return a !== undefined && minutes > 0 && a.mins >= MM_MINUTES * minutes && Math.min(a.bid, a.ask) >= MM_SIDE * (a.bid + a.ask);
    };
    let dMm = 0;
    let dRest = 0;
    let usdMm = 0;
    let usd = 0;
    for (let t = Math.floor(from / MIN) * MIN; t < to; t += MIN) {
      for (const [k, e] of this.minutes.get(t) ?? []) {
        const v = e.bid + e.ask;
        usd += v;
        if (isMm(k)) {
          dMm += e.delta;
          usdMm += v;
        } else dRest += e.delta;
      }
    }
    const split = usd > 0 ? { mm: dMm, rest: dRest, mmShare: usdMm / usd } : null;
    this.parts.set(key, { n, minutes, to, split });
    return split;
  }

  /**
   * Koncentracja w [from, to) (z dokładnością do minuty): bid = makerzy kupujący (przyjmują sprzedaż agresorów),
   * ask = sprzedający (przyjmują kupno). W historii serwera konto ma numer na dobę UTC (pliki `idScope: 'day'`) albo na
   * godzinę (starsze pliki), więc okno przez przełom doby (w starszych plikach — godziny) liczy jedno konto jako dwa.
   */
  top(from: number, to: number, k: number): { bid: MakerTop; ask: MakerTop } {
    const bid = new Map<string, number>();
    const ask = new Map<string, number>();
    for (let t = Math.floor(from / MIN) * MIN; t < to; t += MIN) {
      for (const [key, e] of this.minutes.get(t) ?? []) {
        if (e.bid > 0) bid.set(key, (bid.get(key) ?? 0) + e.bid);
        if (e.ask > 0) ask.set(key, (ask.get(key) ?? 0) + e.ask);
      }
    }
    const pack = (m: Map<string, number>): MakerTop => {
      let usd = 0;
      for (const v of m.values()) usd += v;
      const top = [...m.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, k)
        .map(([key, v]) => ({ key, usd: v }));
      return { n: m.size, usd, top };
    };
    return { bid: pack(bid), ask: pack(ask) };
  }

  prune(before: number): void {
    for (const t of this.minutes.keys())
      if (t + MIN <= before) {
        this.minutes.delete(t);
        this.counts.delete(t);
      }
    for (const [k, p] of this.parts) if (p.to <= before) this.parts.delete(k);
    if (this.win && this.win.w0 < before) this.win = null;
  }

  /** Liczba wypełnień w minutach [w0, w1). */
  private count(w0: number, w1: number): number {
    let n = 0;
    for (let t = w0; t < w1; t += MIN) n += this.counts.get(t) ?? 0;
    return n;
  }

  /** Konta w oknie [w0, w1): przesunięcie poprzedniego okna, gdy w nim nic się nie zmieniło, inaczej od nowa. */
  private window(w0: number, w1: number, n: number): Map<string, Acc> {
    const w = this.win;
    if (w && w0 >= w.w0 && w1 >= w.w1 && w0 <= w.w1 && this.count(w.w0, w.w1) === w.n) {
      for (let t = w.w1; t < w1; t += MIN) this.shift(w.acc, t, 1);
      for (let t = w.w0; t < w0; t += MIN) this.shift(w.acc, t, -1);
      w.w0 = w0;
      w.w1 = w1;
      w.n = n;
      return w.acc;
    }
    const acc = new Map<string, Acc>();
    for (let t = w0; t < w1; t += MIN) this.shift(acc, t, 1);
    this.win = { w0, w1, n, acc };
    return acc;
  }

  /** Dodaje (`sign` 1) albo odejmuje (−1) minutę `t` od kont okna. */
  private shift(acc: Map<string, Acc>, t: number, sign: 1 | -1): void {
    for (const [k, e] of this.minutes.get(t) ?? []) {
      let a = acc.get(k);
      if (!a) acc.set(k, (a = { mins: 0, bid: 0, ask: 0 }));
      a.mins += sign;
      a.bid += sign * Math.round(e.bid * 100);
      a.ask += sign * Math.round(e.ask * 100);
      if (a.mins === 0) acc.delete(k);
    }
  }
}
