import { mulberry32 } from '../../../utils/pathEngine';

/**
 * LVN (węzły małego wolumenu) i LVA (obszary małego wolumenu) profilu z trwałością topologiczną i pewnością
 * bootstrapową (projekt Pioniera F-B1, poprawki z rundy 2).
 *
 * - **Kandydaci:** lokalne minima wygładzonego profilu (średnia 5 koszyków wyśrodkowana na koszyku, zera poza
 *   profilem) wewnątrz obszaru wartości, poniżej 50% wygładzonego POC.
 * - **Ranking:** trwałość topologiczna minimum, czyli jego głębokość wobec niższego z dwóch otaczających maksimów
 *   (maksimum po każdej stronie do pierwszego niższego koszyka albo brzegu profilu), w ułamku najwyższego koszyka
 *   wygładzonego profilu. Zostają najwyżej 3 najtrwalsze, a nie 3 najgłębsze.
 * - **Dolina:** koszyki wokół minimum, w których wygładzony profil leży nie wyżej niż minimum + połowa trwałości.
 *   Dolina szersza niż max(5 koszyków, 0,25 ATR) to **obszar (LVA)**, węższa to **węzeł (LVN)**.
 * - **Pewność:** profil to suma jednostek (świec: wiersze taśmy albo wolumen świecy rozłożony na zakres). 200 razy
 *   losujemy jednostki kołowym bootstrapem blokowym z blokami około 15 minut (1m — 15 świec, 5m — 3 świece; koło, żeby
 *   brzegi okresu nie były rzadziej losowane), liczymy profil na tej samej siatce koszyków, obszar wartości i LVN tą
 *   samą regułą. Pewność węzła = udział replik z LVN w ±1 koszyku, obszaru = udział replik z LVN gdziekolwiek w jego
 *   dolinie. Stałe ziarno: ten sam profil daje tę samą pewność przy każdym rysowaniu.
 * - **Próg pokazania** (`LVN_MIN_CONFIDENCE`) skalibrowany na SIM, nie na rynku: na płaskich profilach z szumem
 *   (błądzenie losowe odbijane w zakresie, więc profil oczekiwany jest płaski, a sąsiednie świece handlują przy
 *   podobnych cenach) próg przepuszcza najwyżej 5% fałszywych LVN; wynik kalibracji w `LVN_CALIBRATION` i w teście.
 */

/** Profil jako suma jednostek na stałej siatce `nb` koszyków: wpisy jednostki u to start[u] … start[u + 1] − 1. */
export interface ProfileUnits {
  nb: number;
  start: Int32Array;
  bin: Int32Array;
  vol: Float64Array;
}

export type LvnKind = 'node' | 'area';

/**
 * LVN w koszykach: koszyk minimum, trwałość (0–1, w ułamku najwyższego koszyka wygładzonego profilu), dolina [lo, hi]
 * w koszykach i rodzaj: węzeł (linia) albo obszar (pasmo).
 */
export interface LvnNode {
  bin: number;
  persistence: number;
  lo: number;
  hi: number;
  kind: LvnKind;
}

/** LVN z cenami: środek koszyka minimum i granice doliny (dół najniższego, góra najwyższego koszyka). */
export interface LvnPrice extends LvnNode {
  px: number;
  pxLo: number;
  pxHi: number;
}

/** LVN z pewnością bootstrapową (0–1). */
export interface LvnLevel extends LvnPrice {
  confidence: number;
}

export interface LvnOptions {
  /** Liczba replik bootstrapu. */
  replicas?: number;
  /** Długość bloku w jednostkach (kolejnych świecach); zob. `blockFor`. */
  block?: number;
  seed?: number;
}

export const LVN_REPLICAS = 200;
export const LVN_SEED = 20261116;
/** Blok bootstrapu w czasie, niezależnie od interwału. */
export const LVN_BLOCK_MS = 15 * 60_000;
/** Dolina szersza niż max(5 koszyków, 0,25 ATR) to obszar (LVA). */
export const LVA_MIN_BINS = 5;
export const LVA_MIN_ATR = 0.25;
/** Profil z mniejszą liczbą świec nie ma LVN („—, za mało świec”): bootstrap z kilku świec nic nie mówi. */
export const LVN_MIN_UNITS = 20;
const LVN_MAX = 3;

/**
 * Kalibracja progu na SIM (test `lvnConfidence.test.ts` liczy ją od nowa i porównuje; ziarna stałe): `profiles`
 * płaskich profili z szumem (skupiska świec do ok. 15 min w losowych cenach, 10 klas po 200 profili), `lvn` — ile
 * fałszywych LVN i LVA dały, `pass` — ile miało pewność ≥ progu, `worst` — udział w najgorszej klasie. Próg to najniższy
 * z siatki 0,70 … 1 przy ≤ 5% w każdej klasie. `walk*` — to samo na błądzeniu losowym (ograniczenie metody, bez progu).
 */
export const LVN_CALIBRATION = { threshold: 1, blockMin: 15, profiles: 2000, lvn: 2568, pass: 34, worst: 8 / 213, walkLvn: 1166, walkPass: 25 } as const;
/** Próg pokazania: LVN o pewności poniżej to szum profilu (hipoteza zerowa F-B1), wartość z kalibracji na SIM. */
export const LVN_MIN_CONFIDENCE = LVN_CALIBRATION.threshold;

/** LVN pokazywane na wykresie i w legendzie: pewność co najmniej `LVN_MIN_CONFIDENCE`. */
export const confidentLvn = <T extends { confidence: number }>(lvn: readonly T[]): T[] => lvn.filter((l) => l.confidence >= LVN_MIN_CONFIDENCE);

/** Blok bootstrapu w świecach interwału `unitMs`: około 15 minut, najmniej 1 świeca. */
export const blockFor = (unitMs: number): number => Math.max(1, Math.round(LVN_BLOCK_MS / unitMs));

/** Najwęższa dolina obszaru w koszykach: max(5, 0,25 ATR / szerokość koszyka); bez ATR 5. */
export function areaBins(atr: number, binWidth: number): number {
  return atr > 0 && binWidth > 0 ? Math.max(LVA_MIN_BINS, (LVA_MIN_ATR * atr) / binWidth) : LVA_MIN_BINS;
}

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
 * 50% wygładzonego POC), najwyżej 3 najtrwalsze, malejąco po trwałości (przy równej głębszy, potem niższy koszyk), z
 * doliną (wygładzony profil ≤ minimum + połowa trwałości) i rodzajem: dolina szersza niż `minAreaBins` to obszar.
 */
export function lvnNodes(
  prof: ArrayLike<number>,
  a: number,
  z: number,
  poc: number,
  minAreaBins: number = LVA_MIN_BINS,
  sm: Float64Array = new Float64Array(prof.length)
): LvnNode[] {
  smooth(prof, sm);
  const nb = sm.length;
  let top = 0;
  for (let k = 0; k < nb; k++) top = Math.max(top, sm[k]);
  const cand: { bin: number; raw: number }[] = [];
  for (let k = a + 2; k < z - 1; k++) {
    if (sm[k] < sm[k - 1] && sm[k] <= sm[k + 1] && sm[k] < 0.5 * sm[poc]) cand.push({ bin: k, raw: persistenceAt(sm, k) });
  }
  cand.sort((x, y) => y.raw - x.raw || sm[x.bin] - sm[y.bin] || x.bin - y.bin);
  return cand.slice(0, LVN_MAX).map(({ bin, raw }) => {
    const level = sm[bin] + raw / 2;
    let lo = bin;
    while (lo > 0 && sm[lo - 1] <= level) lo--;
    let hi = bin;
    while (hi < nb - 1 && sm[hi + 1] <= level) hi++;
    return { bin, persistence: top > 0 ? raw / top : 0, lo, hi, kind: hi - lo + 1 > minAreaBins ? 'area' : 'node' };
  });
}

/** LVN z cenami na siatce: `mid` — środek koszyka, `edge` — dolna granica koszyka. */
export function lvnPrices(nodes: readonly LvnNode[], mid: (k: number) => number, edge: (k: number) => number): LvnPrice[] {
  return nodes.map((x) => ({ ...x, px: mid(x.bin), pxLo: edge(x.lo), pxHi: edge(x.hi + 1) }));
}

/** Czy LVN repliki `got` trafiają w LVN `x`: węzeł — w ±1 koszyku, obszar — gdziekolwiek w dolinie. */
const hit = (x: LvnNode, got: readonly LvnNode[]) => got.some((g) => (x.kind === 'area' ? g.bin >= x.lo && g.bin <= x.hi : Math.abs(g.bin - x.bin) <= 1));

/**
 * Pewność LVN `nodes` (na siatce `u`) z kołowego bootstrapu blokowego jednostek: w każdej replice tyle jednostek co
 * w profilu, blokami `block` kolejnych jednostek od losowego startu (po końcu dalej od początku), profil na tej samej
 * siatce, obszar wartości `share` i LVN regułą `lvnNodes`; wynik w kolejności `nodes`.
 */
export function lvnConfidence(u: ProfileUnits, share: number, nodes: readonly LvnNode[], o: LvnOptions = {}): number[] {
  const R = o.replicas ?? LVN_REPLICAS;
  const n = unitCount(u);
  if (nodes.length === 0 || n === 0 || R <= 0) return nodes.map(() => 0);
  const L = Math.max(1, Math.min(n, Math.round(o.block ?? 1)));
  const rnd = mulberry32(o.seed ?? LVN_SEED);
  const prof = new Float64Array(u.nb);
  const sm = new Float64Array(u.nb);
  const hits = new Array<number>(nodes.length).fill(0);
  const { start, bin, vol } = u;
  for (let r = 0; r < R; r++) {
    prof.fill(0);
    let taken = 0;
    while (taken < n) {
      let j = Math.floor(rnd() * n);
      for (let m = 0; m < L && taken < n; m++, taken++) {
        for (let e = start[j]; e < start[j + 1]; e++) prof[bin[e]] += vol[e];
        if (++j === n) j = 0;
      }
    }
    const va = valueArea(prof, share);
    if (!(va.total > 0)) continue;
    const got = lvnNodes(prof, va.a, va.z, va.poc, LVA_MIN_BINS, sm);
    for (let i = 0; i < nodes.length; i++) if (hit(nodes[i], got)) hits[i]++;
  }
  return hits.map((h) => h / R);
}

/** Najmniej świec do pewności: 20 i co najmniej 4 bloki (mniej — każda replika to prawie ten sam profil). */
export const minUnits = (block: number): number => Math.max(LVN_MIN_UNITS, 4 * block);

/**
 * LVN profilu z pewnością: kandydaci `lvnNodes` (obszar od `minAreaBins` koszyków), ceny z siatki i pewność z
 * bootstrapu blokami ok. 15 min dla świec interwału `unitMs`. Za mało świec (`minUnits`) — null (bez LVN, z powodem).
 */
export function lvnLevels(
  u: ProfileUnits,
  prof: ArrayLike<number>,
  va: { poc: number; a: number; z: number },
  share: number,
  grid: { mid: (k: number) => number; edge: (k: number) => number },
  minAreaBins: number,
  unitMs: number,
  o: Omit<LvnOptions, 'block'> = {}
): LvnLevel[] | null {
  const block = blockFor(unitMs);
  if (unitCount(u) < minUnits(block)) return null;
  const nodes = lvnNodes(prof, va.a, va.z, va.poc, minAreaBins);
  const conf = lvnConfidence(u, share, nodes, { ...o, block });
  return lvnPrices(nodes, grid.mid, grid.edge).map((x, i) => ({ ...x, confidence: conf[i] }));
}
