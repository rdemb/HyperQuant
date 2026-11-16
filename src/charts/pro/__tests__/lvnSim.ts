import { mulberry32 } from '../../../utils/pathEngine';
import { LVA_MIN_BINS, LVN_BLOCK_MS, type LvnTest, type ProfileUnits, blockFor, lvnNodes, lvnTests, profileOf, shownLvn, unitCount, unitsBuilder, valueArea } from '../core/lvn';

/**
 * SIM do kalibracji testu (a) LVN (projekt Pioniera F-B1, runda 2): płaski profil z szumem. Cena świecy to błądzenie
 * losowe odbijane od brzegów zakresu [0, 1), więc profil oczekiwany jest płaski (każda dolina jest fałszywa), a
 * sąsiednie świece handlują przy podobnych cenach jak na rynku. Wolumen świecy z grubym ogonem (log-normalny).
 */

/** Liczba z rozkładu normalnego N(0, 1) (Box–Muller). */
export const normal = (rnd: () => number): number => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

export interface SimSpec {
  /** Liczba świec profilu. */
  n: number;
  /** Interwał świecy (blok bootstrapu ok. 15 min). */
  unitMs: number;
  /** Koszyki profilu. */
  bins: number;
  /** Krok ceny na świecę (w ułamku zakresu). */
  sigma: number;
  /** Szerokość świecy (w ułamku zakresu). */
  width: number;
  /** Rozrzut log-wolumenu świecy. */
  volSig: number;
  /**
   * `cluster` — hipoteza zerowa kalibracji: skupiska świec przy jednej cenie trwające średnio 15 min (długość
   * geometryczna), środki skupisk losowane jednostajnie w zakresie; zależność tylko w skali bloku, profil oczekiwany
   * płaski.
   */
  path: 'cluster';
}

/** Jednostki płaskiego profilu z szumem dla ziarna `seed`. */
export function simUnits(s: SimSpec, seed: number): ProfileUnits {
  const rnd = mulberry32(seed);
  const ub = unitsBuilder(s.bins);
  const stay = 1 - Math.min(1, s.unitMs / LVN_BLOCK_MS);
  let x = rnd();
  for (let i = 0; i < s.n; i++) {
    if (s.path === 'cluster' && i > 0 && rnd() >= stay) x = rnd();
    else if (i > 0) x += s.sigma * normal(rnd);
    // Odbicie od brzegów (także wielokrotne przy dużym kroku)
    while (x < 0 || x >= 1) x = x < 0 ? -x : 2 - x - 1e-12;
    const v = Math.exp(s.volSig * normal(rnd));
    const lo = Math.max(0, x - s.width / 2);
    const hi = Math.min(1 - 1e-12, x + s.width / 2);
    const k0 = Math.floor(lo * s.bins);
    const k1 = Math.floor(hi * s.bins);
    for (let k = k0; k <= k1; k++) ub.add(k, (v * (0.5 + rnd())) / (k1 - k0 + 1));
    ub.next();
  }
  return ub.done();
}

/** Testy fałszywych LVN profilu SIM: filtr położenia i p wobec szumu pomiaru, tą samą ścieżką co na wykresie. */
export function simTests(s: SimSpec, seed: number): LvnTest[] {
  const u = simUnits(s, seed);
  const prof = profileOf(u);
  const va = valueArea(prof, 0.7);
  if (!(va.total > 0) || unitCount(u) === 0) return [];
  const nodes = lvnNodes(prof, va.a, va.z, va.poc);
  return lvnTests(u, nodes, 0.7, LVA_MIN_BINS, blockFor(s.unitMs), { seed: seed + 7919 });
}

/**
 * Klasy profili do kalibracji (liczba świec, interwał, koszyki jak na wykresie): swingi 1m i 5m, sesje 1m i 5m, doby
 * 5m, 1m, 15m i 1h, tydzień 5m.
 */
const CLASSES: readonly Omit<SimSpec, 'path'>[] = [
  { n: 120, unitMs: 60_000, bins: 24, sigma: 0.04, width: 0.04, volSig: 1 },
  { n: 300, unitMs: 60_000, bins: 24, sigma: 0.03, width: 0.03, volSig: 1 },
  { n: 120, unitMs: 300_000, bins: 24, sigma: 0.05, width: 0.05, volSig: 1 },
  { n: 480, unitMs: 60_000, bins: 40, sigma: 0.02, width: 0.02, volSig: 1.2 },
  { n: 96, unitMs: 300_000, bins: 40, sigma: 0.07, width: 0.05, volSig: 1 },
  { n: 288, unitMs: 300_000, bins: 60, sigma: 0.045, width: 0.03, volSig: 1 },
  { n: 1440, unitMs: 60_000, bins: 60, sigma: 0.02, width: 0.015, volSig: 1.2 },
  { n: 96, unitMs: 900_000, bins: 60, sigma: 0.08, width: 0.06, volSig: 1 },
  { n: 24, unitMs: 3_600_000, bins: 40, sigma: 0.15, width: 0.1, volSig: 1 },
  { n: 2016, unitMs: 300_000, bins: 80, sigma: 0.035, width: 0.02, volSig: 1 },
];

/** Zestaw kalibracji testu (a) (hipoteza zerowa: skupiska do ok. 15 min na płaskim profilu). */
export const SIM_SPECS: readonly SimSpec[] = CLASSES.map((c) => ({ ...c, path: 'cluster' }));

/** Nazwa klasy: liczba świec i interwał, np. „120 × 1m”. */
export const className = (s: SimSpec): string => `${s.n} × ${s.unitMs >= 3_600_000 ? `${s.unitMs / 3_600_000}h` : `${s.unitMs / 60_000}m`}`;

/**
 * Kalibracja testu (a) na SIM: w każdej klasie `seeds` płaskich profili z szumem, `lvn` — kandydaci (wszystkie fałszywe),
 * `shown` — ile przeszło filtr położenia i p ≤ 0,05 (tak jak na wykresie).
 */
export function calibrate(specs: readonly SimSpec[], seeds: number): { name: string; lvn: number; shown: number }[] {
  return specs.map((s) => {
    const t: LvnTest[] = [];
    for (let seed = 1; seed <= seeds; seed++) t.push(...simTests(s, seed));
    return { name: className(s), lvn: t.length, shown: shownLvn(t).length };
  });
}
