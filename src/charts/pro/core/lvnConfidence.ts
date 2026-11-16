import { mulberry32 } from '../../../utils/pathEngine';

/**
 * LVN (węzły małego wolumenu) profilu z trwałością topologiczną i pewnością bootstrapową (projekt Pioniera F-B1).
 *
 * - **Kandydaci:** lokalne minima wygładzonego profilu (średnia 5 koszyków wyśrodkowana na koszyku, zera poza
 *   profilem) wewnątrz obszaru wartości, poniżej 50% wygładzonego POC (ta sama reguła co wcześniej).
 * - **Ranking:** trwałość topologiczna minimum, czyli jego głębokość wobec niższego z dwóch otaczających maksimów
 *   (maksimum po każdej stronie do pierwszego niższego koszyka albo brzegu profilu), w ułamku najwyższego koszyka
 *   wygładzonego profilu. Zostają najwyżej 3 najtrwalsze, a nie 3 najgłębsze.
 * - **Pewność:** profil składa się z jednostek (świec: wiersze taśmy albo wolumen świecy rozłożony na zakres).
 *   200 razy losujemy jednostki ze zwracaniem blokami kolejnych jednostek (bootstrap blokowy), liczymy profil na tej
 *   samej siatce koszyków, obszar wartości i LVN tą samą regułą; pewność LVN = udział replik z LVN w ±1 koszyku.
 *   Stałe ziarno: ten sam profil daje tę samą pewność przy każdym rysowaniu.
 * - **Hipoteza zerowa:** LVN z pewnością poniżej 70% to szum profilu; warstwy go nie rysują, a legenda mówi, ile takich
 *   odrzuciła.
 */

/** Profil jako suma jednostek na stałej siatce `nb` koszyków: wpisy jednostki u to start[u] … start[u + 1] − 1. */
export interface ProfileUnits {
  nb: number;
  start: Int32Array;
  bin: Int32Array;
  vol: Float64Array;
}

/** LVN w koszykach: koszyk minimum i trwałość (0–1, w ułamku najwyższego koszyka wygładzonego profilu). */
export interface LvnNode {
  bin: number;
  persistence: number;
}

/** LVN z ceną (środek koszyka). */
export interface LvnPrice extends LvnNode {
  px: number;
}

/** LVN z pewnością bootstrapową (0–1). */
export interface LvnLevel extends LvnPrice {
  confidence: number;
}

/** LVN pokazywane na wykresie i w legendzie: pewność co najmniej `LVN_MIN_CONFIDENCE`. */
export const confidentLvn = <T extends { confidence: number }>(lvn: readonly T[]): T[] => lvn.filter((l) => l.confidence >= LVN_MIN_CONFIDENCE);

export interface LvnOptions {
  /** Liczba replik bootstrapu. */
  replicas?: number;
  /** Długość bloku w jednostkach (kolejnych świecach). */
  block?: number;
  seed?: number;
}

export const LVN_REPLICAS = 200;
/** Próg pokazania: LVN o pewności poniżej to szum profilu (hipoteza zerowa F-B1). */
export const LVN_MIN_CONFIDENCE = 0.7;
export const LVN_SEED = 20261116;
const LVN_MAX = 3;

/** Budowa jednostek profilu: `add` dopisuje wolumen do koszyka bieżącej jednostki, `next` ją zamyka. */
export function unitsBuilder(nb: number): { add: (bin: number, v: number) => void; next: () => void; done: () => ProfileUnits } {
  const start: number[] = [0];
  const bin: number[] = [];
  const vol: number[] = [];
  return {
    add: (k, v) => {
      // Kolejne wiersze tej samej jednostki w tym samym koszyku: jeden wpis
      const n = bin.length;
      if (n > start[start.length - 1] && bin[n - 1] === k) vol[n - 1] += v;
      else {
        bin.push(k);
        vol.push(v);
      }
    },
    next: () => {
      start.push(bin.length);
    },
    done: () => ({ nb, start: Int32Array.from(start), bin: Int32Array.from(bin), vol: Float64Array.from(vol) }),
  };
}

/** Liczba jednostek profilu. */
export const unitCount = (u: ProfileUnits): number => u.start.length - 1;

/** Profil wszystkich jednostek. */
export function profileOf(u: ProfileUnits): Float64Array {
  const prof = new Float64Array(u.nb);
  for (let e = 0; e < u.bin.length; e++) prof[u.bin[e]] += u.vol[e];
  return prof;
}

/**
 * POC (pierwszy koszyk z największym wolumenem) i obszar wartości [a, z]: od POC dokładany większy sąsiad (przy
 * równych górny), aż obejmie udział `share` wolumenu.
 */
export function valueArea(prof: ArrayLike<number>, share: number): { poc: number; a: number; z: number; total: number } {
  const nb = prof.length;
  let total = 0;
  let poc = 0;
  for (let k = 0; k < nb; k++) {
    total += prof[k];
    if (prof[k] > prof[poc]) poc = k;
  }
  let a = poc;
  let z = poc;
  let acc = prof[poc];
  while (acc < share * total && (a > 0 || z < nb - 1)) {
    const dn = a > 0 ? prof[a - 1] : -1;
    const up = z < nb - 1 ? prof[z + 1] : -1;
    if (up >= dn) acc += prof[++z];
    else acc += prof[--a];
  }
  return { poc, a, z, total };
}

function smooth(prof: ArrayLike<number>, out: Float64Array): Float64Array {
  const nb = prof.length;
  for (let k = 0; k < nb; k++) {
    let t = 0;
    for (let j = k - 2; j <= k + 2; j++) if (j >= 0 && j < nb) t += prof[j];
    out[k] = t / 5;
  }
  return out;
}

/**
 * Trwałość minimum w koszyku k (w jednostkach profilu): niższe z maksimów po obu stronach do pierwszego niższego
 * koszyka (po lewej także równego: z dwóch równych minimów starsze jest lewe) albo brzegu, minus wartość minimum.
 */
function persistenceAt(sm: Float64Array, k: number): number {
  const v = sm[k];
  let left = v;
  for (let j = k - 1; j >= 0 && sm[j] > v; j--) left = Math.max(left, sm[j]);
  let right = v;
  for (let j = k + 1; j < sm.length && sm[j] >= v; j++) right = Math.max(right, sm[j]);
  return Math.min(left, right) - v;
}

/**
 * LVN profilu w koszykach: kandydaci wewnątrz obszaru wartości [a, z] (lokalne minima wygładzonego profilu poniżej
 * 50% wygładzonego POC), najwyżej 3 najtrwalsze, malejąco po trwałości (przy równej głębszy, potem niższy koszyk).
 * Wspólne dla profilu okresów P/b i profilu swingu stref Effort.
 */
export function lvnNodes(prof: ArrayLike<number>, a: number, z: number, poc: number, sm: Float64Array = new Float64Array(prof.length)): LvnNode[] {
  smooth(prof, sm);
  let top = 0;
  for (let k = 0; k < sm.length; k++) top = Math.max(top, sm[k]);
  const cand: LvnNode[] = [];
  for (let k = a + 2; k < z - 1; k++) {
    if (sm[k] < sm[k - 1] && sm[k] <= sm[k + 1] && sm[k] < 0.5 * sm[poc]) cand.push({ bin: k, persistence: top > 0 ? persistenceAt(sm, k) / top : 0 });
  }
  cand.sort((x, y) => y.persistence - x.persistence || sm[x.bin] - sm[y.bin] || x.bin - y.bin);
  return cand.slice(0, LVN_MAX);
}

/**
 * Pewność LVN `bins` (koszyki na siatce `u`) z bootstrapu blokowego jednostek: w każdej replice tyle jednostek co
 * w profilu, losowanych blokami `block` kolejnych jednostek (start bloku jednostajnie), profil na tej samej siatce,
 * obszar wartości `share` i LVN regułą `lvnNodes`; wynik to udział replik z LVN w ±1 koszyku, w kolejności `bins`.
 */
export function lvnConfidence(u: ProfileUnits, share: number, bins: readonly number[], o: LvnOptions = {}): number[] {
  const R = o.replicas ?? LVN_REPLICAS;
  const n = unitCount(u);
  if (bins.length === 0 || n === 0 || R <= 0) return bins.map(() => 0);
  const L = Math.max(1, Math.min(n, Math.round(o.block ?? 1)));
  const rnd = mulberry32(o.seed ?? LVN_SEED);
  const prof = new Float64Array(u.nb);
  const sm = new Float64Array(u.nb);
  const hits = new Array<number>(bins.length).fill(0);
  const { start, bin, vol } = u;
  for (let r = 0; r < R; r++) {
    prof.fill(0);
    let taken = 0;
    while (taken < n) {
      const s = Math.floor(rnd() * (n - L + 1));
      for (let j = s; j < s + L && taken < n; j++, taken++) {
        for (let e = start[j]; e < start[j + 1]; e++) prof[bin[e]] += vol[e];
      }
    }
    const va = valueArea(prof, share);
    if (!(va.total > 0)) continue;
    const got = lvnNodes(prof, va.a, va.z, va.poc, sm);
    for (let i = 0; i < bins.length; i++) if (got.some((g) => Math.abs(g.bin - bins[i]) <= 1)) hits[i]++;
  }
  return hits.map((h) => h / R);
}
