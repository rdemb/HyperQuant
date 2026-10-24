import { valueArea } from '../../orderflow/footprint';
import type { IndicatorBar } from './indicators';
import { DAY } from './time';

/**
 * Profil czasowy dnia (TPO, Market Profile): doba UTC dzielona na 30-minutowe okresy oznaczone literami
 * A–X i a–x; każdy wiersz ceny dostaje literę każdego okresu, którego zakres H–L go dotknął. Liczone ze świec
 * wykresu (interwał dzielący 30 minut), więc profil jest widoczny od pierwszej sekundy.
 */

export const TPO_PERIOD_MS = 30 * 60_000;
export const TPO_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXabcdefghijklmnopqrstuvwx';
/** Initial balance: dwa pierwsze okresy (pierwsza godzina doby). */
export const TPO_IB_PERIODS = 2;

export interface TpoProfile {
  /** Początek doby UTC. */
  day: number;
  step: number;
  /** Indeks najniższego wiersza: wiersz r obejmuje ceny [(lo + r) × step, (lo + r + 1) × step). */
  lo: number;
  /** Okresy (indeksy liter) w każdym wierszu, rosnąco. */
  rows: number[][];
  poc: number;
  vaLo: number;
  vaHi: number;
  /** Zakres initial balance (ceny); null, gdy brak świec pierwszej godziny. */
  ib: { lo: number; hi: number } | null;
  /** Pierwsza i ostatnia świeca doby w tablicy wejściowej. */
  from: number;
  to: number;
  /** Po dobie są już świece następnej (profil ostateczny). */
  complete: boolean;
}

/** Czy TPO da się zbudować z interwału: świece muszą równo dzielić 30-minutowy okres. */
export const tpoInterval = (ms: number): boolean => ms > 0 && ms <= TPO_PERIOD_MS && TPO_PERIOD_MS % ms === 0;

function buildDay(bars: readonly IndicatorBar[], from: number, to: number, step: number, complete: boolean): TpoProfile | null {
  const day = Math.floor(bars[from].t / DAY) * DAY;
  // Zakres każdego okresu z jego świec
  const pLo = new Map<number, number>();
  const pHi = new Map<number, number>();
  for (let i = from; i <= to; i++) {
    const c = bars[i].candle;
    if (!(c.h >= c.l) || !(c.l > 0)) continue;
    const p = Math.floor((bars[i].t - day) / TPO_PERIOD_MS);
    pLo.set(p, Math.min(pLo.get(p) ?? c.l, c.l));
    pHi.set(p, Math.max(pHi.get(p) ?? c.h, c.h));
  }
  if (pLo.size === 0) return null;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const [p, l] of pLo) {
    lo = Math.min(lo, Math.floor(l / step));
    hi = Math.max(hi, Math.floor((pHi.get(p) as number) / step));
  }
  const rows: number[][] = Array.from({ length: hi - lo + 1 }, () => []);
  const periods = [...pLo.keys()].sort((a, b) => a - b);
  for (const p of periods) {
    const a = Math.floor((pLo.get(p) as number) / step) - lo;
    const b = Math.floor((pHi.get(p) as number) / step) - lo;
    for (let r = a; r <= b; r++) rows[r].push(p);
  }
  const counts = rows.map((r) => r.length);
  // POC: najwięcej liter; przy remisie wiersz bliższy środka profilu
  let poc = 0;
  const mid = (rows.length - 1) / 2;
  for (let r = 1; r < rows.length; r++) {
    if (counts[r] > counts[poc] || (counts[r] === counts[poc] && Math.abs(r - mid) < Math.abs(poc - mid))) poc = r;
  }
  const va = valueArea(counts, counts.length) ?? { lo: poc, hi: poc };
  const ibP = periods.filter((p) => p < TPO_IB_PERIODS);
  const ib =
    ibP.length > 0
      ? { lo: Math.min(...ibP.map((p) => pLo.get(p) as number)), hi: Math.max(...ibP.map((p) => pHi.get(p) as number)) }
      : null;
  return { day, step, lo, rows, poc, vaLo: va.lo, vaHi: va.hi, ib, from, to, complete };
}

/** Profile kolejnych dób UTC pokrytych świecami (rosnąco po czasie). */
export function tpoProfiles(bars: readonly IndicatorBar[], step: number): TpoProfile[] {
  const out: TpoProfile[] = [];
  if (!(step > 0)) return out;
  let a = 0;
  for (let i = 1; i <= bars.length; i++) {
    if (i < bars.length && Math.floor(bars[i].t / DAY) === Math.floor(bars[a].t / DAY)) continue;
    const p = buildDay(bars, a, i - 1, step, i < bars.length);
    if (p) out.push(p);
    a = i;
  }
  return out;
}

/** Cena środka wiersza POC. */
export const tpoPocPx = (p: TpoProfile): number => (p.lo + p.poc + 0.5) * p.step;

/**
 * Pojedyncze wydruki: wiersze z jedną literą wewnątrz profilu (nie na skraju) — cena przeszła tamtędy raz,
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
