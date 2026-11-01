import { type DayProfile, DayProfileBuilder } from '../../../utils/dayProfile';
import { valueArea } from '../../orderflow/footprint';
import { rowIndex } from './footprintBar';
import { type IndicatorBar, addCandle } from './indicators';
import type { OiLog } from './stats';
import { MINUTE, type Tape } from './tape';
import { DAY } from './time';

/**
 * Profil aukcji doby UTC (Market Profile) w trzech wymiarach na każdym wierszu ceny:
 * - wolumen: transakcje z taśmy dokładnie na swoich cenach, a wolumen świecy z API poza taśmą (świece sprzed nagrania,
 *   luki) rozłożony równo na jej zakres H–L;
 * - agresja: agresywne kupno i sprzedaż z taśmy (wolumen spoza taśmy jest bez podziału na strony);
 * - czas (TPO): doba dzielona na 30-minutowe okresy, wiersz dostaje każdy okres, którego zakres H–L go dotknął.
 * - pozycje: zmiana OI minut przypisana cenom (src/utils/dayProfile.ts), w czterech częściach.
 * POC i value area 70% z wolumenu. Liczone ze świec wykresu (interwał dzielący 30 minut), więc profil jest widoczny
 * od pierwszej sekundy, a agresja wszędzie tam, gdzie jest taśma. Doba zamknięta z profilem serwera bierze kupno, sprzedaż
 * i OI z jego pliku (7 dób nagrania), pozostałe — z taśmy w pamięci strony (ostatnia doba).
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
  /** Zmiana OI wiersza: rośnie przy przewadze kupna / sprzedaży minuty, spada przy przewadze kupna / sprzedaży. */
  ob: Float64Array;
  os: Float64Array;
  cb: Float64Array;
  cs: Float64Array;
  /** Udział wolumenu taśmy doby w minutach z odczytem OI (0 bez danych o pozycjach). */
  oiShare: number;
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

/**
 * Źródła doby poza świecami: `file` — profil zamkniętej doby z serwera (kupno, sprzedaż i OI zamiast footprintu świec,
 * reszta wolumenu świecy poza nagraniem z wolumenu minut pliku); `flow` — profil z taśmy w pamięci, z którego bierzemy
 * tylko OI (kupno i sprzedaż z footprintu świec).
 */
export interface TpoSources {
  file?: DayProfile | null;
  flow?: DayProfile | null;
  /** Interwał świec (minuty świecy w pliku). */
  ms?: number;
}

/** Profil doby z taśmy w pamięci i odczytów OI (stan na koniec minuty: ostatni odczyt nie starszy niż minuta). */
export function tapeDayProfile(tape: Tape, oi: OiLog, coin: string, day: number, tick: number): DayProfile | null {
  const b = new DayProfileBuilder(coin, day, tick);
  for (let m = day; m < day + DAY; m += MINUTE) {
    const c = tape.chunk(m);
    if (!c || c.t.length === 0) continue;
    const a = oi.atWithin(m - 1, MINUTE - 1);
    const e = oi.atWithin(m + MINUTE - 1, MINUTE - 1);
    b.addMinute(m, c.px, c.sz, c.side, a !== null && e !== null ? e - a : null);
  }
  return b.build();
}

/** Kolumny profilu `src` dodane do wierszy siatki `step` od `lo` (wiersze poza zakresem pominięte). */
function addRows(src: DayProfile, cols: readonly (keyof DayProfile & ('buy' | 'sell' | 'ob' | 'os' | 'cb' | 'cs'))[], out: Float64Array[], step: number, lo: number, n: number): void {
  for (let i = 0; i < src.buy.length; i++) {
    const k = rowIndex((src.lo + i) * src.tick, step) - lo;
    if (k < 0 || k >= n) continue;
    for (let c = 0; c < cols.length; c++) out[c][k] += src[cols[c]][i];
  }
}

/** Udział wolumenu taśmy profilu w minutach z odczytem OI. */
function oiShareOf(src: DayProfile): number {
  let v = 0;
  for (let i = 0; i < src.buy.length; i++) v += src.buy[i] + src.sell[i];
  return v > 0 ? Math.min(1, src.oiVol / v) : 0;
}

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
export function tpoDay(bars: readonly IndicatorBar[], from: number, to: number, step: number, complete: boolean, src: TpoSources = {}): TpoProfile | null {
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
  // Wolumen, agresja i pozycje wierszy
  const vol = new Float64Array(n);
  const buy = new Float64Array(n);
  const sell = new Float64Array(n);
  const ob = new Float64Array(n);
  const os = new Float64Array(n);
  const cb = new Float64Array(n);
  const cs = new Float64Array(n);
  const file = src.file ?? null;
  const flow = file ?? src.flow ?? null;
  if (flow) addRows(flow, ['ob', 'os', 'cb', 'cs'], [ob, os, cb, cs], step, lo, n);
  if (file) {
    addRows(file, ['buy', 'sell'], [buy, sell], step, lo, n);
    for (let k = 0; k < n; k++) vol[k] = buy[k] + sell[k];
  }
  for (let i = from; i <= to; i++) {
    const bar = bars[i];
    if (!valid(bar)) continue;
    if (file) {
      // Reszta wolumenu świecy poza nagraniem: wolumen API minus taśma minut świecy z pliku
      let taped = 0;
      const end = Math.min(day + DAY, bar.t + Math.max(MINUTE, src.ms ?? MINUTE));
      for (let t = Math.max(day, bar.t); t < end; t += MINUTE) taped += file.mv[Math.floor((t - day) / MINUTE)];
      const rest = bar.candle.v - taped;
      if (rest > 0) addCandle(vol, { ...bar.candle, v: rest }, step, lo, n);
      continue;
    }
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
  const oiShare = flow ? oiShareOf(flow) : 0;
  return { day, step, lo, rows, vol, buy, sell, ob, os, cb, cs, oiShare, total, max, poc: va.poc, vaLo: va.lo, vaHi: va.hi, ib, from, to, complete };
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
