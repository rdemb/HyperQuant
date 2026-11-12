import type { ScannedPosition } from '../../src/utils/liqMap.ts';
import { AddressBook } from './addressBook.ts';

/**
 * Model obciążenia skanu pozycji (symulacja bez sieci, do testów harmonogramu odczytów): syntetyczny rynek kont z pozycjami
 * BTC, konta handlujące co minutę (pole `users` transakcji) i budżet odczytów `clearinghouseState` na minutę. Mierzy to,
 * co skaner publikuje w `status.json` jako `ageNtlP50Min`: medianę wieku odczytów pozycji ważoną nominałem (jak
 * `buildLiqMap`).
 *
 * Założenia (nie pomiar): nominały z rozkładu Pareto (α 1,2, od 1 tys. do 50 mln USD), więc kilka procent kont trzyma połowę
 * nominału; co minutę handluje `tradersPerMin` różnych kont: 70% kont z pozycją (wybór z wagą √nominał — większe
 * handlują częściej), 30% adresów bez pozycji (nowe albo bez BTC). Model skalowany (np. 6 tys. pozycji zamiast 30 tys.,
 * budżet i konta handlujące w tej samej proporcji), żeby test trwał sekundy. Generator liczb z ziarnem — wynik powtarzalny.
 */

const MIN = 60_000;
const PX = 100_000;

export interface SimOptions {
  /** Liczba kont z pozycją BTC */
  positions: number;
  /** Budżet odczytów pozycji na minutę (waga `clearinghouseState` = 2, więc budżet wag / 2) */
  readsPerMin: number;
  /** Różne konta handlujące w minucie */
  tradersPerMin: number;
  /** Długość symulacji i rozgrzewka (bez pomiaru), min */
  minutes: number;
  warmupMin: number;
  /** Wykładnik Pareto nominałów (mniejszy = nominał bardziej skupiony w dużych kontach); domyślnie 1,2 */
  alpha?: number;
  seed?: number;
}

export interface SimResult {
  /** ageNtlP50Min po każdej minucie od końca rozgrzewki */
  ntlP50: number[];
  max: number;
  median: number;
  reads: number;
}

/** Generator mulberry32 (deterministyczny). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mediana wieku odczytów ważona nominałem, w minutach (jak `ageMin.ntlP50` w `buildLiqMap`). */
export function ntlP50Age(positions: readonly ScannedPosition[], now: number): number {
  const w = positions.map((p) => [(now - p.scannedAt) / MIN, Math.abs(p.szi) * p.entryPx] as [number, number]).sort((a, b) => a[0] - b[0]);
  const total = w.reduce((s, [, x]) => s + x, 0);
  for (let i = 0, cum = 0; i < w.length; i++) {
    cum += w[i][1];
    if (cum >= total / 2) return w[i][0];
  }
  return 0;
}

export function simulateReads(o: SimOptions): SimResult {
  const rand = rng(o.seed ?? 1);
  const book = new AddressBook(o.positions * 10);
  const sizes = new Map<string, number>();
  const addrs: string[] = [];
  for (let i = 0; i < o.positions; i++) {
    const ntl = Math.min(50e6, 1000 / Math.pow(1 - rand(), 1 / (o.alpha ?? 1.2)));
    const a = `0xp${i}`;
    sizes.set(a, ntl / PX);
    addrs.push(a);
  }
  const cum: number[] = [];
  let acc = 0;
  for (const a of addrs) cum.push((acc += Math.sqrt(sizes.get(a)! * PX)));
  const pick = () => {
    const x = rand() * acc;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return addrs[lo];
  };
  const pos = (a: string, t: number): ScannedPosition | null => {
    const s = sizes.get(a);
    return s ? { szi: s, entryPx: PX, liqPx: PX * 0.5, scannedAt: t } : null;
  };
  // Stan po zasiewie: każda pozycja odczytana raz w ostatniej godzinie przed startem
  for (const a of addrs) {
    const t = -Math.floor(rand() * 60) * MIN;
    book.recordTrade([a, '0xseed'], 1, t);
    book.updatePosition(a, pos(a, t), t);
  }
  book.updatePosition('0xseed', null, 0);

  let fresh = 0;
  let reads = 0;
  const out: number[] = [];
  for (let m = 0; m < o.minutes; m++) {
    const t0 = m * MIN;
    for (let k = 0; k < o.tradersPerMin; k += 2) {
      const t = t0 + Math.floor((k / o.tradersPerMin) * MIN);
      const one = rand() < 0.7 ? pick() : `0xn${fresh++}`;
      const two = rand() < 0.7 ? pick() : `0xn${fresh++}`;
      book.recordTrade([one, two], 1000 + rand() * 50_000, t);
    }
    // Budżet minuty: trzy porcje (pętla skanu prosi o kolejne porcje w trakcie minuty)
    for (let s = 0; s < 3; s++) {
      const t = t0 + s * 20_000;
      const due = book.due(t, Math.round(o.readsPerMin / 3), undefined, { fill: true });
      for (const a of due) book.updatePosition(a, pos(a, t), t);
      reads += due.length;
    }
    if (m >= o.warmupMin) out.push(ntlP50Age(book.positions(), t0 + MIN));
  }
  const sorted = [...out].sort((a, b) => a - b);
  return { ntlP50: out, max: sorted.at(-1) ?? 0, median: sorted[sorted.length >> 1] ?? 0, reads };
}
