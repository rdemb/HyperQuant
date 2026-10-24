import type { Coverage } from './coverage';
import type { AggressorOrder } from './orders';

/**
 * Kto handluje: wejścia biorców (zlecenia agresora z taśmy) rozdzielone na dużych graczy i resztę rynku. Hyperliquid podaje
 * konto biorcy przy każdej transakcji, więc liczymy wartość wejść każdego konta w godzinie UTC; konto, które w tej godzinie
 * weszło za co najmniej próg rynku, jest w niej dużym graczem — także wtedy, gdy tnie zlecenie na wiele małych. Pokazujemy
 * tylko sumy, bez kont. W historii serwera konto ma numer ważny w obrębie godziny, więc w godzinie otwarcia strony jego
 * wejścia sprzed i po otwarciu liczą się osobno.
 */

const HOUR = 3_600_000;
const MIN = 60_000;

/** Próg dużego gracza: wartość wejść konta w godzinie UTC (USD); dobrany tak, że duzi to kilka–kilkanaście kont na godzinę. */
export const BIG_PLAYER_USD: Readonly<Record<string, number>> = { BTC: 1_000_000, ETH: 500_000, SOL: 250_000, HYPE: 250_000 };
export const bigPlayerUsd = (coin: string): number => BIG_PLAYER_USD[coin] ?? 250_000;

export interface PlayerSplit {
  /** Delta wejść dużych graczy i reszty (jednostki rynku). */
  big: number;
  rest: number;
  /** Wartość wejść dużych graczy i wszystkich wejść (USD). */
  bigUsd: number;
  usd: number;
  /** Udział dużych graczy w wartości wejść (%); null bez wejść. */
  bigShare: number | null;
}

/** Zlecenia agresora rosnąco po czasie (OrderLog). */
export interface OrderSource {
  range(from: number, to: number): AggressorOrder[];
  count(from: number, to: number): number;
}

// Na minutę godziny: delta dużych, delta reszty, wartość wejść dużych, wartość wszystkich wejść
const F = 4;

interface HourFlow {
  n: number;
  mins: Float64Array;
}

export class PlayerFlow {
  private readonly hours = new Map<number, HourFlow>();

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
    let big = 0;
    let rest = 0;
    let bigUsd = 0;
    let usd = 0;
    for (let h = Math.floor(t / HOUR) * HOUR; h < end; h += HOUR) {
      const m = this.hour(h).mins;
      const m0 = Math.max(0, Math.floor((t - h) / MIN));
      const m1 = Math.min(60, Math.ceil((end - h) / MIN));
      for (let i = m0; i < m1; i++) {
        big += m[i * F];
        rest += m[i * F + 1];
        bigUsd += m[i * F + 2];
        usd += m[i * F + 3];
      }
    }
    return { big, rest, bigUsd, usd, bigShare: usd > 0 ? (bigUsd / usd) * 100 : null };
  }

  prune(before: number): void {
    for (const h of this.hours.keys()) if (h + HOUR <= before) this.hours.delete(h);
  }

  /** Godzina policzona od nowa tylko po nowych zleceniach w niej (zamknięte godziny zostają w pamięci). */
  private hour(h: number): HourFlow {
    const n = this.orders.count(h, h + HOUR);
    const hit = this.hours.get(h);
    if (hit && hit.n === n) return hit;
    const list = this.orders.range(h, h + HOUR);
    const byTaker = new Map<string, number>();
    for (const o of list) byTaker.set(o.taker, (byTaker.get(o.taker) ?? 0) + o.notional);
    const mins = new Float64Array(60 * F);
    for (const o of list) {
      const i = Math.min(59, Math.floor((o.time - h) / MIN)) * F;
      // Zlecenie bez konta (brak pola users) zostaje w reszcie
      const isBig = o.taker !== '' && (byTaker.get(o.taker) ?? 0) >= this.thresholdUsd;
      const d = o.side * o.sz;
      mins[i + (isBig ? 0 : 1)] += d;
      if (isBig) mins[i + 2] += o.notional;
      mins[i + 3] += o.notional;
    }
    const f = { n, mins };
    this.hours.set(h, f);
    return f;
  }
}
