import { valueArea } from '../../orderflow/footprint';
import { rowIndex } from './footprintBar';
import { type IndicatorBar, addCandle } from './indicators';
import { DAY } from './time';

/**
 * Profil aukcji doby UTC (Market Profile) w trzech wymiarach na każdym wierszu ceny:
 * - wolumen: transakcje z taśmy dokładnie na swoich cenach, a wolumen świecy z API poza taśmą (świece sprzed nagrania,
 *   luki) rozłożony równo na jej zakres H–L;
 * - agresja: agresywne kupno i sprzedaż z taśmy (wolumen spoza taśmy jest bez podziału na strony);
 * - czas (TPO): doba dzielona na 30-minutowe okresy, wiersz dostaje każdy okres, którego zakres H–L go dotknął.
 * POC i value area 70% z wolumenu. Liczone ze świec wykresu (interwał dzielący 30 minut), więc profil jest widoczny
 * od pierwszej sekundy, a agresja wszędzie tam, gdzie jest taśma.
 */

export const TPO_PERIOD_MS = 30 * 60_000;
/** Pierwsza godzina doby UTC (00:00–01:00): dwa pierwsze okresy; warstwa Initial balance liczy osobno pierwszą godzinę sesji. */
export const TPO_IB_PERIODS = 2;
/** Najwięcej wierszy doby (ochrona przed bardzo małym krokiem na szerokim zakresie). */
const MAX_ROWS = 4000;

export interface TpoProfile {
  /** Początek doby UTC. */
  day: number;
  step: number;
  /** Indeks najniższego wiersza: wiersz r obejmuje ceny [(lo + r) × step, (lo + r + 1) × step). */
  lo: number;
  /** Okresy (indeksy od początku doby) w każdym wierszu, rosnąco: czas ceny. */
  rows: number[][];
  /** Wolumen wiersza (jednostki rynku): taśma na cenach transakcji plus reszta wolumenu świec oszacowana z ich zakresu. */
  vol: Float64Array;
  /** Agresywne kupno i sprzedaż wiersza z taśmy (część wolumenu objęta nagraniem). */
  buy: Float64Array;
  sell: Float64Array;
  total: number;
  /** Największy wolumen wiersza. */
  max: number;
  /** POC i value area 70% z wolumenu. */
  poc: number;
  vaLo: number;
  vaHi: number;
  /** Zakres pierwszej godziny doby UTC (ceny); null, gdy brak jej świec. */
  ib: { lo: number; hi: number } | null;
  /** Pierwsza i ostatnia świeca doby w tablicy wejściowej. */
  from: number;
  to: number;
  /** Po dobie są już świece następnej (profil ostateczny). */
  complete: boolean;
}

/** Czy TPO da się zbudować z interwału: świece muszą równo dzielić 30-minutowy okres. */
export const tpoInterval = (ms: number): boolean => ms > 0 && ms <= TPO_PERIOD_MS && TPO_PERIOD_MS % ms === 0;

const valid = (b: IndicatorBar) => b.candle.h >= b.candle.l && b.candle.l > 0;

/** Kolejne doby UTC w świecach (indeksy włącznie); doba jest zamknięta, gdy po niej są już świece następnej. */
export function tpoDays(bars: readonly IndicatorBar[]): { from: number; to: number; complete: boolean }[] {
  const out: { from: number; to: number; complete: boolean }[] = [];
  let a = 0;
  for (let i = 1; i <= bars.length; i++) {
    if (i < bars.length && Math.floor(bars[i].t / DAY) === Math.floor(bars[a].t / DAY)) continue;
    out.push({ from: a, to: i - 1, complete: i < bars.length });
    a = i;
  }
  return out;
}

/** Profil doby ze świec [from, to] na siatce wierszy `step`; null bez świec z zakresem. */
export function tpoDay(bars: readonly IndicatorBar[], from: number, to: number, step: number, complete: boolean): TpoProfile | null {
  if (!(step > 0)) return null;
  const day = Math.floor(bars[from].t / DAY) * DAY;
  // Zakres każdego okresu z jego świec
  const pLo = new Map<number, number>();
  const pHi = new Map<number, number>();
  for (let i = from; i <= to; i++) {
    if (!valid(bars[i])) continue;
    const c = bars[i].candle;
    const p = Math.floor((bars[i].t - day) / TPO_PERIOD_MS);
    pLo.set(p, Math.min(pLo.get(p) ?? c.l, c.l));
    pHi.set(p, Math.max(pHi.get(p) ?? c.h, c.h));
  }
  if (pLo.size === 0) return null;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const [p, l] of pLo) {
    lo = Math.min(lo, rowIndex(l, step));
    hi = Math.max(hi, rowIndex(pHi.get(p) as number, step));
  }
  const n = hi - lo + 1;
  if (n > MAX_ROWS) return null;
  const rows: number[][] = Array.from({ length: n }, () => []);
  const periods = [...pLo.keys()].sort((a, b) => a - b);
  for (const p of periods) {
    const a = rowIndex(pLo.get(p) as number, step) - lo;
    const b = rowIndex(pHi.get(p) as number, step) - lo;
    for (let r = a; r <= b; r++) rows[r].push(p);
  }
  // Wolumen i agresja wierszy
  const vol = new Float64Array(n);
  const buy = new Float64Array(n);
  const sell = new Float64Array(n);
  for (let i = from; i <= to; i++) {
    const bar = bars[i];
    if (!valid(bar)) continue;
    const fp = bar.fp ?? null;
    if (fp) {
      for (let j = 0; j < fp.buy.length; j++) {
        const k = rowIndex((fp.lo + j) * fp.tick, step) - lo;
        if (k < 0 || k >= n) continue;
        buy[k] += fp.buy[j];
        sell[k] += fp.sell[j];
        vol[k] += fp.buy[j] + fp.sell[j];
      }
    }
    // Część świecy poza taśmą (luka nagrania, świeca sprzed nagrania): reszta wolumenu z API równo na zakres H–L
    const rest = fp && bar.complete ? 0 : bar.candle.v - (fp ? fp.buyVol + fp.sellVol : 0);
    if (rest > 0) addCandle(vol, { ...bar.candle, v: rest }, step, lo, n);
  }
  let total = 0;
  let max = 0;
  for (let k = 0; k < n; k++) {
    total += vol[k];
    if (vol[k] > max) max = vol[k];
  }
  // Doba bez wolumenu (same zera z API): POC i value area z czasu
  const va = valueArea(vol, n) ??
    valueArea(
      rows.map((r) => r.length),
      n
    ) ?? { poc: 0, lo: 0, hi: 0 };
  const ibP = periods.filter((p) => p < TPO_IB_PERIODS);
  const ib =
    ibP.length > 0
      ? { lo: Math.min(...ibP.map((p) => pLo.get(p) as number)), hi: Math.max(...ibP.map((p) => pHi.get(p) as number)) }
      : null;
  return { day, step, lo, rows, vol, buy, sell, total, max, poc: va.poc, vaLo: va.lo, vaHi: va.hi, ib, from, to, complete };
}

/** Profile kolejnych dób UTC pokrytych świecami (rosnąco po czasie). */
export function tpoProfiles(bars: readonly IndicatorBar[], step: number): TpoProfile[] {
  const out: TpoProfile[] = [];
  if (!(step > 0)) return out;
  for (const d of tpoDays(bars)) {
    const p = tpoDay(bars, d.from, d.to, step, d.complete);
    if (p) out.push(p);
  }
  return out;
}

/** Cena środka wiersza POC. */
export const tpoPocPx = (p: TpoProfile): number => (p.lo + p.poc + 0.5) * p.step;

/**
 * Pojedyncze wydruki: wiersze z jednym okresem wewnątrz profilu (nie na skraju) — cena przeszła tamtędy raz,
 * bez akceptacji. Co najmniej dwa pojedyncze wiersze na skraju to ogon (odrzucenie ceny), zwracany osobno.
 */
export function tpoSingles(p: TpoProfile): { singles: boolean[]; tails: boolean[] } {
  const n = p.rows.length;
  const one = p.rows.map((r) => r.length === 1);
  const tails = new Array<boolean>(n).fill(false);
  // Ogon: co najmniej dwa pojedyncze wiersze na skraju
  let b = 0;
  while (b < n && one[b]) b++;
  let t = n - 1;
  while (t >= 0 && one[t]) t--;
  if (b >= 2) for (let r = 0; r < b; r++) tails[r] = true;
  if (n - 1 - t >= 2) for (let r = t + 1; r < n; r++) tails[r] = true;
  // Profil z jednego okresu (początek doby) nie ma jeszcze ogonów ani pojedynczych wydruków
  if (b === n) return { singles: new Array<boolean>(n).fill(false), tails: new Array<boolean>(n).fill(false) };
  return { singles: one.map((o, r) => o && r >= b && r <= t), tails };
}
