import { mulberry32 } from './pathEngine.ts';

/**
 * Przedział umiejętności miar dziennika prognoz (CRPSS, BSS) z bootstrapu blokowego po dobach UTC. Jedna definicja
 * losowania dla podsumowania skanera i niezależnego weryfikatora: każdy z nich sam liczy sumy dobowe z rekordów,
 * a tu jest tylko ustalona procedura losowania (generator, ziarno, liczba losowań, granice) — ta sama liczba z tych
 * samych sum. Umiejętność = 1 − Σ licznik / Σ mianownik (np. Σ CRPS modelu / Σ CRPS bazy).
 */
export const BOOT = {
  /** Ziarno generatora mulberry32 */
  seed: 20261111,
  reps: 1000,
  /** Granice: 25. i 975. wartość po posortowaniu rosnąco (indeksy od 0) */
  loIdx: 24,
  hiIdx: 974,
  /** Minimum dób z danymi dla przedziału */
  minDays: 7,
} as const;

export const DAY_MS = 86_400_000;
/** Doba UTC chwili (numer doby od 1970-01-01) */
export const dayOf = (t: number) => Math.floor(t / DAY_MS);

/** Powód braku: za mało dób (`min-days`) albo zerowy mianownik bazy (`no-base`) */
export type CiReason = 'min-days' | 'no-base';

export interface SkillCi {
  value: number | null;
  lo: number | null;
  hi: number | null;
  /** Doby z danymi */
  days: number;
  reason?: CiReason;
}

export interface DaySum {
  day: number;
  num: number;
  den: number;
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Dodanie składnika do sum doby (kolejność dodawania zostaje po stronie wywołującego). */
export function addDaySum(m: Map<number, DaySum>, t: number, num: number, den: number): void {
  const day = dayOf(t);
  const s = m.get(day);
  if (s) {
    s.num += num;
    s.den += den;
  } else m.set(day, { day, num, den });
}

/**
 * Umiejętność i jej przedział: doby rosnąco, w każdym z 1000 losowań tyle dób ze zwracaniem, ile jest dób, indeks
 * `floor(u × liczbaDób)`; granice 25. i 975. wartość. Poniżej 7 dób albo przy zerowym mianowniku w którymś losowaniu
 * przedział null z powodem. Wynik zaokrąglony do 4 miejsc.
 */
export function daySkillCi(sums: Iterable<DaySum>): SkillCi {
  const days = [...sums].sort((a, b) => a.day - b.day);
  const nd = days.length;
  let num = 0;
  let den = 0;
  for (const d of days) {
    num += d.num;
    den += d.den;
  }
  if (!(den > 0)) return { value: null, lo: null, hi: null, days: nd, reason: nd < BOOT.minDays ? 'min-days' : 'no-base' };
  const value = r4(1 - num / den);
  if (nd < BOOT.minDays) return { value, lo: null, hi: null, days: nd, reason: 'min-days' };
  const u = mulberry32(BOOT.seed);
  const stats = new Float64Array(BOOT.reps);
  for (let k = 0; k < BOOT.reps; k++) {
    let a = 0;
    let b = 0;
    for (let j = 0; j < nd; j++) {
      const d = days[Math.floor(u() * nd)];
      a += d.num;
      b += d.den;
    }
    if (!(b > 0)) return { value, lo: null, hi: null, days: nd, reason: 'no-base' };
    stats[k] = 1 - a / b;
  }
  stats.sort();
  return { value, lo: r4(stats[BOOT.loIdx]), hi: r4(stats[BOOT.hiIdx]), days: nd };
}
