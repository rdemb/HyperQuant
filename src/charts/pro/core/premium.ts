import { deskMarketOf } from '../../../config/deskMarkets';
import { closedSpans } from '../../../utils/underlying';
import { quantile7 } from '../indicators/primitives';

/**
 * Premia Hyperliquid wobec spotu (Pionier, runda 3, R3-2, definicja poprawiona po weryfikacji dokumentacji HL): główna
 * seria to pole `premium` kanału activeAssetCtx, które według dokumentacji Hyperliquid jest liczone z cen wpływu dla
 * kwoty referencyjnej (20 000 USDC na BTC, 6 000 na innych rynkach): (max(impact_bid − oracle, 0) − max(oracle −
 * impact_ask, 0)) / oracle — ta sama wielkość, z której HL liczy finansowanie. Pomocniczo (mark − oracle) / oracle.
 * Oracle to ważona mediana cen spot z giełd scentralizowanych (co ok. 3 s), a na rynkach HIP-3 cena instrumentu
 * bazowego od wydawcy rynku. Serwer nagrywa w historii taśmy mark i OI, ale nie premii ani oracle, więc próbki są tylko
 * od otwarcia strony. Czysta logika: próbki, średnia świecy ważona czasem, szum odczytu i odczyt kierunku zmiany.
 */

/** Najdłużej ważny odczyt premii (ms): dłuższa przerwa w kanale to luka, nie stała premia. */
export const PREMIUM_MAX_AGE_MS = 60_000;

const MINUTE = 60_000;
/** Godzina minut (blok do wyboru spokojnych godzin) i najmniej zmian minutowych do oceny szumu. */
const HOUR_MINUTES = 60;
const MIN_PAIRS = 30;

/** Pole `premium` Hyperliquid (ułamek) w pb; null, gdy pola nie ma albo nie jest liczbą (brak odczytu, nie zero). */
export function hlPremiumBp(premium: number): number | null {
  return Number.isFinite(premium) ? premium * 1e4 : null;
}

/** Seria pomocnicza (mark − oracle) / oracle w pb; null, gdy mark albo oracle nie jest dodatnią liczbą. */
export function markOracleBp(mark: number, oracle: number): number | null {
  if (!(mark > 0) || !(oracle > 0)) return null;
  return ((mark - oracle) / oracle) * 1e4;
}

/** Krok ceny Hyperliquid (5 cyfr znaczących) w pb ceny: najmniejsza zmiana premii widoczna w odczycie. */
export function premiumStepBp(price: number): number | null {
  if (!(price > 0)) return null;
  return (10 ** (Math.floor(Math.log10(price)) - 4) / price) * 1e4;
}

/**
 * Czy oracle rynku w chwili `t` pochodzi z rynku bazowego. Rynek desku HIP-3 poza notowaniami rynku bazowego (weekend,
 * przerwa dzienna, święto NYSE) ma cenę platformy, więc premia wobec niej nie mówi nic o spocie. Krypto i rynki spoza
 * konfiguracji desku (bez znanego kalendarza) — true.
 */
export function oracleLive(coin: string, t: number): boolean {
  const m = deskMarketOf(coin);
  if (!m || m.underlying.calendar === 'crypto') return true;
  return closedSpans(m, t, t + 1).length === 0;
}

/** Próbki premii (pb) rosnąco po czasie; wartości ujemne i zero są odczytem. */
export class PremiumLog {
  private t: number[] = [];
  private v: number[] = [];

  push(time: number, bp: number): void {
    if (!Number.isFinite(bp) || !Number.isFinite(time)) return;
    const n = this.t.length;
    if (n > 0 && time <= this.t[n - 1]) {
      if (time === this.t[n - 1]) this.v[n - 1] = bp;
      return;
    }
    this.t.push(time);
    this.v.push(bp);
  }

  /** Chwile próbek, rosnąco. */
  times(): readonly number[] {
    return this.t;
  }

  /** Ostatnia próbka nie późniejsza niż `time` i nie starsza niż `maxAgeMs`; null — brak. */
  atWithin(time: number, maxAgeMs: number): number | null {
    const k = this.indexAt(time);
    return k >= 0 && time - this.t[k] <= maxAgeMs ? this.v[k] : null;
  }

  /**
   * Średnia premii w [from, to) ważona czasem: każdy odczyt trwa do następnego, ale najwyżej `maxAgeMs` (przerwa w
   * kanale to luka, nie pomija się jej stałą wartością). Liczy się tylko czas z odczytem; bez niego null.
   */
  meanWithin(from: number, to: number, maxAgeMs: number): number | null {
    if (!(to > from)) return null;
    const n = this.t.length;
    let i = Math.max(0, this.indexAt(from));
    let sum = 0;
    let w = 0;
    for (; i < n && this.t[i] < to; i++) {
      const a = Math.max(this.t[i], from);
      const z = Math.min(i + 1 < n ? this.t[i + 1] : Number.POSITIVE_INFINITY, this.t[i] + maxAgeMs, to);
      if (z > a) {
        sum += this.v[i] * (z - a);
        w += z - a;
      }
    }
    return w > 0 ? sum / w : null;
  }

  private indexAt(time: number): number {
    let lo = 0;
    let hi = this.t.length - 1;
    let k = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.t[mid] <= time) {
        k = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return k;
  }

  prune(before: number): void {
    // Zostawiamy ostatnią próbkę sprzed granicy — jest stanem na początku zachowanego okresu
    let i = 0;
    while (i + 1 < this.t.length && this.t[i + 1] <= before) i++;
    if (i > 0) {
      this.t = this.t.slice(i);
      this.v = this.v.slice(i);
    }
  }
}

/** Średnie premii kolejnych minut od `from` (pełne minuty do `to`, ostatnia może być w toku); NaN — minuta bez odczytu. */
export function premiumMinutes(log: Pick<PremiumLog, 'meanWithin'>, from: number, to: number, maxAgeMs = PREMIUM_MAX_AGE_MS): Float64Array {
  const n = Math.max(0, Math.ceil((to - from) / MINUTE));
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) out[k] = log.meanWithin(from + k * MINUTE, Math.min(from + (k + 1) * MINUTE, to), maxAgeMs) ?? Number.NaN;
  return out;
}

/** Mediana posortowanej tablicy. */
const median = (sorted: Float64Array) => quantile7(sorted, 0.5);

/**
 * Szum odczytu premii (pb): p90 |zmian minutowych| w spokojniejszej połowie godzin próby (godziny liczone od końca,
 * po 60 minut, ranking po medianie |zmian| godziny; godzina z mniej niż 30 zmianami nie wchodzi do rankingu), nie mniej
 * niż `floorBp` (krok ceny). Przy mniej niż dwóch godzinach — p90 z całej próby; przy mniej niż 30 zmianach — null.
 * Zmiana jest tylko między sąsiednimi minutami z odczytem.
 */
export function premiumNoiseBp(minutes: ArrayLike<number>, floorBp = 0): number | null {
  const blocks: number[][] = [];
  const all: number[] = [];
  const last = minutes.length - 1;
  for (let i = last; i >= 1; i--) {
    const d = Math.abs(minutes[i] - minutes[i - 1]);
    if (!Number.isFinite(d)) continue;
    const b = Math.floor((last - i) / HOUR_MINUTES);
    (blocks[b] ??= []).push(d);
    all.push(d);
  }
  if (all.length < MIN_PAIRS) return null;
  const full = blocks.filter((b) => b && b.length >= MIN_PAIRS).map((b) => Float64Array.from(b).sort());
  let pool: Float64Array;
  if (full.length >= 2) {
    const medians = Float64Array.from(full.map(median)).sort();
    const cut = median(medians);
    pool = Float64Array.from(full.filter((b) => median(b) <= cut).flatMap((b) => [...b])).sort();
  } else pool = Float64Array.from(all).sort();
  return Math.max(floorBp, quantile7(pool, 0.9));
}

/** Kierunek zmiany premii w oknie: zmiana nie większa niż szum odczytu to „płaska” (bez zmian). */
export type PremiumTrend = 'rising' | 'flat' | 'falling';

export interface PremiumRead {
  /** Premia ostatniej minuty (pb). */
  bp: number;
  /** Zmiana od minuty `windowMin` wcześniej (pb); null bez odczytu na początku okna. */
  changeBp: number | null;
  /** Szum odczytu (pb, `premiumNoiseBp`); null przy za krótkiej próbie. */
  noiseBp: number | null;
  /** null, gdy brak zmiany albo szumu. */
  trend: PremiumTrend | null;
  /** Położenie wobec pasma zwykłości: wyróżnienie tylko poza nim; null bez pasma. */
  side: 'above' | 'inside' | 'below' | null;
}

/**
 * Odczyt premii do paska ramy dnia (R3-2): kierunek zmiany w ostatnich `windowMin` minutach z progiem szumu odczytu
 * i położenie ostatniej minuty wobec pasma zwykłości (p10–p90). `minutes` — średnie minut rosnąco (`premiumMinutes`),
 * ostatnia to bieżąca minuta; z tej samej próby liczony jest szum. Bez odczytu w ostatniej minucie — null.
 */
export function premiumRead(
  minutes: ArrayLike<number>,
  opts: { windowMin: number; band?: { lo: number; hi: number } | null; floorBp?: number }
): PremiumRead | null {
  const last = minutes.length - 1;
  const bp = last >= 0 ? minutes[last] : Number.NaN;
  if (!Number.isFinite(bp)) return null;
  const k = last - opts.windowMin;
  const start = k >= 0 ? minutes[k] : Number.NaN;
  const changeBp = Number.isFinite(start) ? bp - start : null;
  const noiseBp = premiumNoiseBp(minutes, opts.floorBp ?? 0);
  const trend = changeBp === null || noiseBp === null ? null : Math.abs(changeBp) <= noiseBp ? 'flat' : changeBp > 0 ? 'rising' : 'falling';
  const band = opts.band;
  const side = !band || !Number.isFinite(band.lo) || !Number.isFinite(band.hi) ? null : bp > band.hi ? 'above' : bp < band.lo ? 'below' : 'inside';
  return { bp, changeBp, noiseBp, trend, side };
}
