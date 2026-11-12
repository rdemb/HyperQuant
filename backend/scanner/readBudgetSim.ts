import { readFileSync } from 'node:fs';
import { buildLiqMap, type ScannedPosition } from '../../src/utils/liqMap.ts';
import { AddressBook } from './addressBook.ts';

/**
 * Model obciążenia skanu pozycji (symulacja bez sieci, do testów harmonogramu odczytów): rynek kont z pozycjami BTC
 * o rozkładzie wielkości z danych, konta handlujące co minutę (pole `users` transakcji) i budżet odczytów
 * `clearinghouseState` na minutę. Mierzy to, co skaner publikuje: `ageMin` mapy (`buildLiqMap`; `ntlP50` =
 * `ageNtlP50Min` w status.json) oraz kolejkę kont po transakcji bez odczytu (`dirty` w status.json).
 *
 * Rozkład wielkości: stały plik `readBudgetPositions.json` (50 największych pozycji i dekady od 1 mln USD z whales.json
 * repo danych, dekady poniżej 1 mln USD z założonego rozkładu przy liczbie i sumie z danych; 12.11.2026). W dekadzie
 * wielkości rozłożone równomiernie w kwantylach rozkładu o gęstości wykładniczej w logarytmie, z liczbą i sumą z pliku.
 * Odległość ceny likwidacji: 50 największych z danych, pozostałe losowo z udziałami z mapy (do 1% / 3% / 5% od ceny).
 *
 * Kto handluje (założenia oparte na taśmie 4–11.11: mediana 95–123 różnych kont na minutę, ok. 23% nie handlowało
 * w poprzednich 30 min): 77% transakcji to zbiór aktywnych kont (200 / skala, wybór z wagą √nominał), 11,5%
 * przypadkowy posiadacz pozycji, 11,5% nowy adres bez pozycji; drugą stroną każdej transakcji jest jeden animator rynku
 * bez pozycji. Pozycje między odczytami się nie zmieniają.
 *
 * Skala 1/`scale` (domyślnie 1/5): liczba pozycji, budżet i konta handlujące w tej samej proporcji, 50 największych —
 * co `scale`-ta. Generator liczb z ziarnem, więc wynik jest powtarzalny.
 *
 * Kalibracja (12.11.2026, dawny harmonogram z terminami 2/10/30 min przy 73 odczytach/min): na serwerze
 * `ageMin.ntlP50` 23,4 min, `p50` 347 min, `p90` 618 min; model tego harmonogramu przy 100 kontach handlujących na
 * minutę daje 44 / 617 / 1132 min (mediany z 24 h). Model jest więc ok. 1,8 raza bardziej pesymistyczny (przyczyna
 * niesprawdzona; możliwa: pozycje w modelu się nie zmieniają, a w rzeczywistości otwierane i zamykane dają świeże
 * odczyty) — test porównuje z tym samym harmonogramem w modelu (`calibration.modelAgeMin`), a nie z pomiarem.
 */

const MIN = 60_000;
const MIX = { active: 0.77, holders: 0.115, activeAccounts: 200 };

type AgeMin = { ntlP50: number; p50: number; p90: number };

export interface PositionsFixture {
  markPx: number;
  positions: number;
  /** Dekady bez 50 największych: przedział [lo, hi), liczba i suma nominału, USD */
  decades: { lo: number; hi: number; n: number; ntlUsd: number; src: 'data' | 'model' }[];
  /** 50 największych pozycji: [nominał USD, cena likwidacji albo null], malejąco */
  top: [number, number | null][];
  /** Pozycje z ceną likwidacji do 1% / 3% / 5% od ceny mark (narastająco) */
  liqWithin: { pct1: number; pct3: number; pct5: number };
  /** Stan przed zmianą: zmierzony na serwerze (`ageMin`) i ten sam harmonogram w modelu (`modelAgeMin`), min */
  calibration: { readsPerMin: number; tradersPerMin: number; ageMin: AgeMin; modelAgeMin: AgeMin };
}

export function loadPositionsFixture(): PositionsFixture {
  return JSON.parse(readFileSync(new URL('./readBudgetPositions.json', import.meta.url), 'utf8')) as PositionsFixture;
}

/** Harmonogram odczytów, który model wywołuje (domyślnie `AddressBook`; inna wersja do porównań). */
export interface SimBook {
  recordTrade(users: [string, string], ntlUsd: number, t: number): void;
  updatePosition(addr: string, pos: ScannedPosition | null, t: number): void;
  due(now: number, limit: number, markPx?: number): string[];
}

export interface SimOptions {
  /** Budżet odczytów pozycji na minutę w skali modelu (waga `clearinghouseState` = 2, więc budżet wag / 2 / skala) */
  readsPerMin: number;
  /** Różne konta handlujące w minucie, w skali modelu */
  tradersPerMin: number;
  /** Długość symulacji i rozgrzewka (bez pomiaru), min */
  minutes: number;
  warmupMin: number;
  scale?: number;
  seed?: number;
  book?: SimBook;
  /** Kto handluje: udział aktywnych kont i przypadkowych posiadaczy pozycji (reszta: nowe adresy), liczba aktywnych kont w skali rzeczywistej */
  mix?: { active: number; holders: number; activeAccounts: number };
}

interface Quantiles {
  p50: number;
  p90: number;
  n: number;
}

export interface SimResult {
  /** Po każdej minucie od końca rozgrzewki: `ageMin` mapy i kolejka kont po transakcji bez odczytu */
  ntlP50: number[];
  p50: number[];
  p90: number[];
  dirtyN: number[];
  dirtyWaitP90: number[];
  ntlP50Max: number;
  p50Median: number;
  p90Median: number;
  dirtyWaitP90Max: number;
  /** Czekanie od transakcji do odczytu konta z pozycją wg wielkości (≥ 1 mln, ≥ 100 tys., mniejsze), min */
  wait: { big: Quantiles; mid: Quantiles; small: Quantiles };
  /** Konta z pozycją, które handlowały i do końca nie zostały odczytane */
  stuck: number;
  /** Odczyty na minutę w skali rzeczywistej */
  readsPerMin: number;
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

/** Kwantyl z interpolacją (jak `ageMin` w `buildLiqMap`). */
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const median = (xs: readonly number[]) => quantile([...xs].sort((a, b) => a - b), 0.5);

/** `n` wielkości w [lo, hi) o średniej `mean`: kwantyle rozkładu z gęstością ∝ e^(θ·ln x), θ dobrane bisekcją. */
function decadeSizes(lo: number, hi: number, n: number, mean: number): number[] {
  if (n === 1) return [mean];
  const L = Math.log(hi / lo);
  const at = (theta: number) =>
    Array.from({ length: n }, (_, i) => {
      const u = (i + 0.5) / n;
      const y = Math.abs(theta) < 1e-9 ? u * L : Math.log1p(u * Math.expm1(theta * L)) / theta;
      return lo * Math.exp(y);
    });
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  let a = -50;
  let b = 50;
  for (let k = 0; k < 100; k++) {
    const m = (a + b) / 2;
    if (avg(at(m)) < mean) a = m;
    else b = m;
  }
  const xs = at((a + b) / 2);
  const f = mean / avg(xs);
  return xs.map((x) => x * f);
}

interface Acc {
  a: string;
  ntl: number;
  /** Odległość ceny likwidacji od ceny mark (ułamek); Infinity = brak ceny likwidacji */
  dist: number;
}

/** Konta modelu w skali 1/`scale` (wielkości z pliku, odległości ceny likwidacji z ziarnem). */
export function simWorld(f: PositionsFixture, scale: number, seed: number): Acc[] {
  const rand = rng(seed);
  const out: Acc[] = f.top
    .filter((_, i) => i % scale === Math.floor(scale / 2))
    .map(([usd, liq], i) => ({ a: `0xw${i}`, ntl: usd, dist: liq ? Math.abs(liq - f.markPx) / f.markPx : Infinity }));
  const [p1, p3, p5] = [f.liqWithin.pct1, f.liqWithin.pct3, f.liqWithin.pct5].map((x) => x / f.positions);
  let i = 0;
  for (const d of f.decades) {
    const n = Math.round(d.n / scale);
    if (n === 0) continue;
    for (const ntl of decadeSizes(d.lo, d.hi, n, d.ntlUsd / d.n)) {
      const u = rand();
      const dist = u < p1 ? 0.002 + rand() * 0.008 : u < p3 ? 0.01 + rand() * 0.02 : u < p5 ? 0.03 + rand() * 0.02 : 0.05 + rand() * 0.6;
      out.push({ a: `0xs${i++}`, ntl, dist });
    }
  }
  // Kolejność adresów w książce bez związku z wielkością (jak kolejność pojawiania się na taśmie)
  for (let k = out.length - 1; k > 0; k--) {
    const j = Math.floor(rand() * (k + 1));
    [out[k], out[j]] = [out[j], out[k]];
  }
  return out;
}

export function simulateReads(o: SimOptions): SimResult {
  const scale = o.scale ?? 5;
  const f = loadPositionsFixture();
  const PX = f.markPx;
  const accs = simWorld(f, scale, o.seed ?? 11);
  const rand = rng((o.seed ?? 11) + 7);
  const byA = new Map(accs.map((x) => [x.a, x]));
  const book: SimBook = o.book ?? new AddressBook(accs.length * 12);
  const MM = '0xmm';
  const pos = (x: Acc, t: number): ScannedPosition => ({ szi: x.ntl / PX, entryPx: PX, liqPx: Number.isFinite(x.dist) ? PX * (1 - x.dist) : null, scannedAt: t });
  // Stan po zasiewie: każda pozycja odczytana raz w ostatnich 6 h przed startem
  const seen = new Map<string, ScannedPosition>();
  for (const x of accs) {
    const t = -Math.floor(rand() * 360) * MIN;
    book.recordTrade([x.a, MM], 1, t);
    const p = pos(x, t);
    book.updatePosition(x.a, p, t);
    seen.set(x.a, p);
  }
  book.updatePosition(MM, null, 0);

  // Zbiór aktywnych kont (handlują prawie co minutę): wybór z wagą √nominał
  const cum: number[] = [];
  let acc = 0;
  for (const x of accs) cum.push((acc += Math.sqrt(x.ntl)));
  const pickW = () => {
    const v = rand() * acc;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (cum[m] < v) lo = m + 1;
      else hi = m;
    }
    return accs[lo].a;
  };
  const mix = o.mix ?? MIX;
  const active = [...new Set(Array.from({ length: Math.round(mix.activeAccounts / scale) }, pickW))];

  /** Adres → pierwsza transakcja od ostatniego odczytu */
  const dirtyAt = new Map<string, number>();
  const lat = { big: [] as number[], mid: [] as number[], small: [] as number[] };
  const cls = (n: number) => (n >= 1e6 ? 'big' : n >= 1e5 ? 'mid' : 'small');
  const r: Pick<SimResult, 'ntlP50' | 'p50' | 'p90' | 'dirtyN' | 'dirtyWaitP90'> = { ntlP50: [], p50: [], p90: [], dirtyN: [], dirtyWaitP90: [] };
  let fresh = 0;
  let reads = 0;
  let slot = 0;
  for (let m = 0; m < o.minutes; m++) {
    const t0 = m * MIN;
    // Minuta w trzech częściach po 20 s: transakcje części, potem porcja budżetu na jej końcu
    for (let s = 0; s < 3; s++, slot++) {
      for (let k = Math.ceil((s * o.tradersPerMin) / 3); k < ((s + 1) * o.tradersPerMin) / 3; k++) {
        const t = t0 + Math.floor((k / o.tradersPerMin) * MIN);
        const u = rand();
        const a = u < mix.active ? active[Math.floor(rand() * active.length)] : u < mix.active + mix.holders ? accs[Math.floor(rand() * accs.length)].a : `0xn${fresh++}`;
        book.recordTrade([a, MM], 1000 + rand() * 50_000, t);
        for (const x of [a, MM]) if (!dirtyAt.has(x)) dirtyAt.set(x, t);
      }
      const t = t0 + (s + 1) * 20_000;
      const lim = Math.floor(((slot + 1) * o.readsPerMin) / 3) - Math.floor((slot * o.readsPerMin) / 3);
      const due = book.due(t, lim, PX);
      for (const a of due) {
        const x = byA.get(a);
        const p = x ? pos(x, t) : null;
        book.updatePosition(a, p, t);
        if (p) seen.set(a, p);
        const d = dirtyAt.get(a);
        if (x && d !== undefined && m >= o.warmupMin) lat[cls(x.ntl)].push((t - d) / MIN);
        dirtyAt.delete(a);
      }
      reads += due.length;
    }
    if (m >= o.warmupMin) {
      const now = t0 + MIN;
      const map = buildLiqMap([...seen.values()], { coin: 'BTC', markPx: PX, oiBtc: 1, asOf: now, addresses: 0 });
      r.ntlP50.push(map.ageMin.ntlP50);
      r.p50.push(map.ageMin.p50);
      r.p90.push(map.ageMin.p90);
      const waits = [...dirtyAt.values()].map((d) => (now - d) / MIN).sort((x, y) => x - y);
      r.dirtyN.push(waits.length);
      r.dirtyWaitP90.push(quantile(waits, 0.9));
    }
  }
  const q = (xs: number[]): Quantiles => {
    const s = [...xs].sort((a, b) => a - b);
    return { p50: quantile(s, 0.5), p90: quantile(s, 0.9), n: s.length };
  };
  return {
    ...r,
    ntlP50Max: Math.max(0, ...r.ntlP50),
    p50Median: median(r.p50),
    p90Median: median(r.p90),
    dirtyWaitP90Max: Math.max(0, ...r.dirtyWaitP90),
    wait: { big: q(lat.big), mid: q(lat.mid), small: q(lat.small) },
    stuck: [...dirtyAt.keys()].filter((a) => byA.has(a)).length,
    readsPerMin: (reads / o.minutes) * scale,
  };
}
