import { oneAccountScope } from './accountScope';
import type { Coverage } from './coverage';
import type { AggressorOrder } from './orders';
import { FIXED_USD_SCALE } from '../../../utils/marketCaps';

/**
 * Kto handluje: wejścia biorców (zlecenia agresora z taśmy) rozdzielone na dużych graczy i resztę rynku. Hyperliquid podaje
 * konto biorcy przy każdej transakcji, więc liczymy wartość wejść każdego konta w 60 minutach do zamknięcia świecy; konto,
 * które w tym oknie weszło za co najmniej próg rynku, jest w świecy dużym graczem — także wtedy, gdy tnie zlecenie na wiele
 * małych. Okno nie sięga za zamknięcie świecy, więc zamknięta świeca się nie zmienia; w bieżącej świecy liczą się wejścia
 * do teraz. Świeca dłuższa niż godzina to jej godziny UTC, każda z oknem równym tej godzinie. Pokazujemy tylko sumy, bez kont.
 * W historii serwera konto ma numer (ważny dobę UTC w plikach `idScope: 'day'`, godzinę w starszych), a na żywo adres,
 * więc okno przez przełom doby (w starszych plikach — godziny) albo przez chwilę otwarcia strony liczy jedno konto jako dwa:
 * takie okno nie jest pełne (`complete: false`), tak jak okno, którego taśma z kontami nie obejmuje w całości.
 */

const HOUR = 3_600_000;
const MIN = 60_000;

/** Próg dużego gracza na BTC: wartość wejść konta w 60 min (USD); dobrany tak, że duzi to kilka–kilkanaście kont na godzinę. */
const BIG_PLAYER_BTC_USD = 1_000_000;
/** Próg rynku: próg BTC razy skala progów rynku (`usdScale`; ETH 500 tys., SOL i HYPE 250 tys., inne według OI). */
export const bigPlayerUsd = (scale: number): number => BIG_PLAYER_BTC_USD * scale;
/** Progi rynków stałych (opis grupy „Kto handluje” w Tablicy liczb). */
export const BIG_PLAYER_USD: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(FIXED_USD_SCALE).map(([c, k]) => [c, bigPlayerUsd(k)])
);

export interface PlayerSplit {
  /** Delta wejść dużych graczy i reszty (jednostki rynku). */
  big: number;
  rest: number;
  /** Wartość wejść dużych graczy i wszystkich wejść (USD). */
  bigUsd: number;
  usd: number;
  /** Udział dużych graczy w wartości wejść (%); null bez wejść. */
  bigShare: number | null;
  /**
   * Okna klasy kont (60 min do zamknięcia świecy, dla świecy dłuższej niż godzina — jej godziny) w całości z taśmą z kontami
   * i w jednym zakresie numeracji kont; false — nagrywanie zaczęło się albo przerwało w oknie, albo okno przechodzi przez
   * przełom doby UTC (starsze pliki: godziny) albo chwilę otwarcia strony, gdzie jedno konto może mieć dwa identyfikatory.
   */
  complete: boolean;
}

/** Zlecenia agresora rosnąco po czasie (OrderLog). */
export interface OrderSource {
  range(from: number, to: number): AggressorOrder[];
  count(from: number, to: number): number;
}

interface Part {
  big: number;
  rest: number;
  bigUsd: number;
  usd: number;
  /** Konta okna w jednym zakresie numeracji. */
  oneScope: boolean;
}

/** Wartość wejść w centach: suma liczb całkowitych jest dokładna, więc przesunięte okno daje to samo co policzone od nowa. */
const cents = (o: AggressorOrder): number => Math.round(o.notional * 100);

export class PlayerFlow {
  /** Części zamkniętych świec: klucz `początek okna:początek:koniec`, `n` — liczba zleceń okna przy liczeniu. */
  private readonly parts = new Map<string, Part & { n: number; to: number }>();
  /** Sumy wejść kont (centy) w oknie [w0, w1) z `n` zleceniami; świece po kolei przesuwają je zamiast liczyć od nowa. */
  private win: { w0: number; w1: number; n: number; sums: Map<string, number> } | null = null;

  /** `addressed` — czas, dla którego taśma ma konta biorców (strumień na żywo i historia serwera, bez zapisu przeglądarki). */
  constructor(
    private readonly orders: OrderSource,
    private readonly addressed: Coverage,
    readonly thresholdUsd: number
  ) {}

  /** Podział wejść w świecy [t, t + ms) (bieżąca do `now`); null, gdy w tym czasie nie ma taśmy z kontami. */
  split(t: number, ms: number, now: number): PlayerSplit | null {
    const end = Math.min(t + ms, now);
    if (!(end > t) || !(this.addressed.coveredMs(t, end) > 0)) return null;
    // Zlecenia do końca bieżącej minuty (zegar serwera bywa o włos za taśmą), nigdy po zamknięciu świecy
    const stop = Math.min(t + ms, Math.ceil(now / MIN) * MIN);
    let big = 0;
    let rest = 0;
    let bigUsd = 0;
    let usd = 0;
    let complete = true;
    for (let a = t; a < stop; ) {
      // Część w jednej godzinie UTC; okno klasy: 60 min do jej zamknięcia (świeca do godziny — zamknięcia świecy)
      const close = Math.min(Math.floor(a / HOUR) * HOUR + HOUR, t + ms);
      const b = Math.min(close, stop);
      const p = this.part(close - HOUR, a, b, close < now);
      big += p.big;
      rest += p.rest;
      bigUsd += p.bigUsd;
      usd += p.usd;
      complete &&= p.oneScope && this.addressed.covers(close - HOUR, Math.min(b, end));
      a = b;
    }
    return { big, rest, bigUsd, usd, bigShare: usd > 0 ? (bigUsd / usd) * 100 : null, complete };
  }

  prune(before: number): void {
    for (const [k, p] of this.parts) if (p.to <= before) this.parts.delete(k);
    if (this.win && this.win.w0 < before) this.win = null;
  }

  /** Wejścia z [a, b) z klasą konta z okna [w0, b); część zamknięta zostaje w pamięci do nowych zleceń w jej oknie. */
  private part(w0: number, a: number, b: number, closed: boolean): Part {
    const key = `${w0}:${a}:${b}`;
    const n = this.orders.count(w0, b);
    const hit = closed ? this.parts.get(key) : undefined;
    if (hit && hit.n === n) return hit;
    const sums = this.sums(w0, b);
    const limit = this.thresholdUsd * 100;
    const p: Part = { big: 0, rest: 0, bigUsd: 0, usd: 0, oneScope: oneAccountScope([this.orders.range(w0, b)]) };
    for (const o of this.orders.range(a, b)) {
      // Zlecenie bez konta (brak pola users) zostaje w reszcie
      const isBig = o.taker !== '' && (sums.get(o.taker) ?? 0) >= limit;
      const d = o.side * o.sz;
      if (isBig) {
        p.big += d;
        p.bigUsd += o.notional;
      } else p.rest += d;
      p.usd += o.notional;
    }
    if (closed) this.parts.set(key, { ...p, n, to: b });
    return p;
  }

  /** Sumy wejść kont w [w0, w1): przesunięcie poprzedniego okna, gdy w nim nic się nie zmieniło, inaczej od nowa. */
  private sums(w0: number, w1: number): Map<string, number> {
    const w = this.win;
    if (w && w0 >= w.w0 && w1 >= w.w1 && w0 <= w.w1 && this.orders.count(w.w0, w.w1) === w.n) {
      const add = (o: AggressorOrder, sign: number) => {
        if (o.taker === '') return;
        const v = (w.sums.get(o.taker) ?? 0) + sign * cents(o);
        if (v === 0) w.sums.delete(o.taker);
        else w.sums.set(o.taker, v);
      };
      for (const o of this.orders.range(w.w1, w1)) add(o, 1);
      for (const o of this.orders.range(w.w0, w0)) add(o, -1);
      w.w0 = w0;
      w.w1 = w1;
      w.n = this.orders.count(w0, w1);
      return w.sums;
    }
    const sums = new Map<string, number>();
    const list = this.orders.range(w0, w1);
    for (const o of list) if (o.taker !== '') sums.set(o.taker, (sums.get(o.taker) ?? 0) + cents(o));
    this.win = { w0, w1, n: list.length, sums };
    return sums;
  }
}
