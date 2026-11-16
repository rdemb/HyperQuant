import { mulberry32 } from '../../../utils/pathEngine';

/**
 * LVN (węzły małego wolumenu) i LVA (obszary małego wolumenu) profilu z trwałością topologiczną, filtrem położenia
 * z bootstrapu i wartością p wobec szumu pomiaru (projekt Pioniera F-B1, runda 2 po przeglądzie #295).
 *
 * - **Kandydaci:** lokalne minima wygładzonego profilu (średnia 5 koszyków wyśrodkowana na koszyku, zera poza
 *   profilem) wewnątrz obszaru wartości, poniżej 50% wygładzonego POC.
 * - **Ranking:** trwałość topologiczna minimum, czyli jego głębokość wobec niższego z dwóch otaczających maksimów
 *   (maksimum po każdej stronie do pierwszego niższego koszyka albo brzegu profilu). Zostają najwyżej 3 najtrwalsze.
 * - **Głębokość względna** (statystyka testu): 1 − minimum / niższe z dwóch otaczających maksimów, od 0 do 1. Bez
 *   jednostek, więc porównywalna między profilami; stabilniejsza od głębokości w odchyleniach bootstrapu, bo pusta
 *   dolina ma w każdej replice to samo zero i odchylenie bliskie zeru (dzielenie przez prawie zero).
 * - **Dolina:** koszyki wokół minimum, w których wygładzony profil leży nie wyżej niż minimum + połowa trwałości.
 *   Dolina szersza niż max(5 koszyków, 0,25 ATR) to **obszar (LVA)**, węższa to **węzeł (LVN)**.
 * - **Filtr położenia (bootstrap, liczby nie pokazujemy):** 200 replik kołowego bootstrapu blokowego z blokami ok.
 *   15 minut (1m: 15 świec, 5m: 3); LVN przechodzi, gdy w co najmniej połowie replik LVN leży w ±1 koszyku (obszar:
 *   gdziekolwiek w dolinie). Bootstrap mierzy stałość miejsca, nie istotność doliny: pusta dolina zostaje w każdej
 *   replice, więc jego liczba nasyca się przy 100%.
 * - **Test (a), szum pomiaru:** rozkład zerowy głębokości względnej z SIM dopasowanego do profilu (ta sama liczba świec
 *   i koszyków, rozpiętość świecy i rozrzut wolumenu z danych, skupiska ok. 15 min w losowych cenach na płaskim
 *   profilu, 300 profili). p = (1 + liczba dolin zerowych o głębokości ≥ obserwowanej) / (1 + liczba dolin zerowych).
 *   Pokazujemy LVN z p ≤ 0,05, więc fałszywych jest najwyżej 5% (test kalibracji sprawdza to w każdej klasie).
 * - **Test (b), losowe ścieżki** o tej samej zmienności i rytmie wolumenu: w przygotowaniu.
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
 * LVN w koszykach: koszyk minimum, trwałość (0–1, w ułamku najwyższego koszyka wygładzonego profilu; do rankingu),
 * głębokość względna (0–1; statystyka testu), dolina [lo, hi] w koszykach i rodzaj: węzeł (linia) albo obszar (pasmo).
 */
export interface LvnNode {
  bin: number;
  persistence: number;
  depth: number;
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

/** Wynik testów LVN: udział replik z LVN w tym miejscu (filtr, bez pokazywania) i p wobec szumu pomiaru (test a). */
export interface LvnTest {
  location: number;
  p: number;
}

/** LVN z cenami po testach. */
export interface LvnLevel extends LvnPrice, LvnTest {}

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
/** Filtr położenia: LVN w tym samym miejscu w co najmniej tylu replikach (reguła ustalona z góry, nie strojona). */
export const LVN_LOCATION_MIN = 0.5;
/** Próg testu (a): p ≤ 0,05. */
export const LVN_P_MAX = 0.05;
/** Profile SIM rozkładu zerowego testu (a) na jeden zestaw parametrów (pamiętany). */
export const LVN_NULL_PROFILES = 300;
const LVN_MAX = 3;

/**
 * Kalibracja testu (a) na SIM (test `lvnLocation.test.ts` liczy ją od nowa i porównuje; ziarna stałe): w każdej z 10
 * klas 200 płaskich profili z szumem (skupiska ok. 15 min w losowych cenach), `lvn` — fałszywe LVN i LVA (kandydaci),
 * `shown` — ile przeszło filtr położenia i p ≤ 0,05. Warunek: `shown / lvn` ≤ 5% w każdej klasie.
 */
export const LVN_CALIBRATION: { blockMin: number; profiles: number; classes: readonly { name: string; lvn: number; shown: number }[] } = {
  blockMin: 15,
  profiles: 200,
  classes: [
    { name: '120 × 1m', lvn: 122, shown: 0 },
    { name: '300 × 1m', lvn: 106, shown: 2 },
    { name: '120 × 5m', lvn: 87, shown: 0 },
    { name: '480 × 1m', lvn: 297, shown: 4 },
    { name: '96 × 5m', lvn: 303, shown: 2 },
    { name: '288 × 5m', lvn: 426, shown: 3 },
    { name: '1440 × 1m', lvn: 321, shown: 1 },
    { name: '96 × 15m', lvn: 490, shown: 17 },
    { name: '24 × 1h', lvn: 352, shown: 8 },
    { name: '2016 × 5m', lvn: 64, shown: 0 },
  ],
};

/** LVN pokazywane na wykresie i w legendzie: filtr położenia i p ≤ 0,05 (test a). */
export const shownLvn = <T extends LvnTest>(lvn: readonly T[]): T[] => lvn.filter((l) => l.location >= LVN_LOCATION_MIN && l.p <= LVN_P_MAX);

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
    // Głębokość względna: trwałość wobec niższego z otaczających maksimów (minimum + trwałość)
    const peak = sm[bin] + raw;
    return { bin, persistence: top > 0 ? raw / top : 0, depth: peak > 0 ? raw / peak : 0, lo, hi, kind: hi - lo + 1 > minAreaBins ? 'area' : 'node' };
  });
}

/** LVN z cenami na siatce: `mid` — środek koszyka, `edge` — dolna granica koszyka. */
export function lvnPrices(nodes: readonly LvnNode[], mid: (k: number) => number, edge: (k: number) => number): LvnPrice[] {
  return nodes.map((x) => ({ ...x, px: mid(x.bin), pxLo: edge(x.lo), pxHi: edge(x.hi + 1) }));
}

/** Czy LVN repliki `got` trafiają w LVN `x`: węzeł — w ±1 koszyku, obszar — gdziekolwiek w dolinie. */
const hit = (x: LvnNode, got: readonly LvnNode[]) => got.some((g) => (x.kind === 'area' ? g.bin >= x.lo && g.bin <= x.hi : Math.abs(g.bin - x.bin) <= 1));

/**
 * Położenie LVN `nodes` (filtr; na siatce `u`) z kołowego bootstrapu blokowego jednostek: w każdej replice tyle jednostek co
 * w profilu, blokami `block` kolejnych jednostek od losowego startu (po końcu dalej od początku), profil na tej samej
 * siatce, obszar wartości `share` i LVN regułą `lvnNodes`; wynik w kolejności `nodes`.
 */
export function lvnLocation(u: ProfileUnits, share: number, nodes: readonly LvnNode[], o: LvnOptions = {}): number[] {
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

/** Najmniej świec do testu: 20 i co najmniej 4 bloki (mniej — każda replika to prawie ten sam profil). */
export const minUnits = (block: number): number => Math.max(LVN_MIN_UNITS, 4 * block);

// ───────────────────────── test (a): szum pomiaru ─────────────────────────

/** Parametry SIM rozkładu zerowego: świece, koszyki, rozpiętość świecy w koszykach, rozrzut log-wolumenu, blok. */
export interface NullSpec {
  n: number;
  nb: number;
  span: number;
  volSig: number;
  block: number;
}

/** Liczba z rozkładu normalnego N(0, 1) (Box–Muller). */
const normal = (rnd: () => number) => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

/**
 * Parametry SIM z profilu: liczba świec i koszyków, mediana rozpiętości świecy w koszykach i odchylenie log-wolumenu
 * świec (zaokrąglone do 0,25), żeby podobne profile dzieliły jeden rozkład zerowy.
 */
export function nullSpec(u: ProfileUnits, block: number): NullSpec {
  const n = unitCount(u);
  const spans: number[] = [];
  const logs: number[] = [];
  for (let j = 0; j < n; j++) {
    let lo = Infinity;
    let hi = -Infinity;
    let v = 0;
    for (let e = u.start[j]; e < u.start[j + 1]; e++) {
      lo = Math.min(lo, u.bin[e]);
      hi = Math.max(hi, u.bin[e]);
      v += u.vol[e];
    }
    if (v > 0) {
      spans.push(hi - lo + 1);
      logs.push(Math.log(v));
    }
  }
  spans.sort((x, y) => x - y);
  const span = spans.length > 0 ? spans[spans.length >> 1] : 1;
  const mean = logs.reduce((t, x) => t + x, 0) / Math.max(1, logs.length);
  const sd = Math.sqrt(logs.reduce((t, x) => t + (x - mean) ** 2, 0) / Math.max(1, logs.length - 1));
  return { n, nb: u.nb, span: Math.max(1, Math.min(u.nb, span)), volSig: Math.round(sd * 4) / 4, block };
}

/**
 * Płaski profil z szumem (hipoteza zerowa testu a): skupiska świec trwające średnio `block` świec (długość
 * geometryczna) przy jednej cenie, środki skupisk jednostajnie w zakresie koszyków, świeca na `span` koszykach,
 * wolumen log-normalny.
 */
export function nullUnits(s: NullSpec, seed: number): ProfileUnits {
  const rnd = mulberry32(seed);
  const ub = unitsBuilder(s.nb);
  const stay = 1 - 1 / Math.max(1, s.block);
  let x = rnd() * s.nb;
  for (let i = 0; i < s.n; i++) {
    if (i > 0 && rnd() >= stay) x = rnd() * s.nb;
    const v = Math.exp(s.volSig * normal(rnd));
    const k0 = Math.max(0, Math.min(s.nb - s.span, Math.floor(x - s.span / 2)));
    const k1 = Math.min(s.nb - 1, k0 + s.span - 1);
    for (let k = k0; k <= k1; k++) ub.add(k, (v * (0.5 + rnd())) / (k1 - k0 + 1));
    ub.next();
  }
  return ub.done();
}

const nullMemo = new Map<string, Float64Array>();

/** Rosnące głębokości względne dolin z `LVN_NULL_PROFILES` profili SIM (pamiętane według parametrów, do 32 zestawów). */
export function nullDepths(s: NullSpec, share: number, minAreaBins: number): Float64Array {
  const key = `${s.n}|${s.nb}|${s.span}|${s.volSig}|${s.block}|${share}|${Math.round(minAreaBins)}`;
  const hit = nullMemo.get(key);
  if (hit) return hit;
  const out: number[] = [];
  const sm = new Float64Array(s.nb);
  for (let i = 0; i < LVN_NULL_PROFILES; i++) {
    const u = nullUnits(s, LVN_SEED + 7919 * (i + 1));
    const prof = profileOf(u);
    const va = valueArea(prof, share);
    if (!(va.total > 0)) continue;
    for (const x of lvnNodes(prof, va.a, va.z, va.poc, minAreaBins, sm)) out.push(x.depth);
  }
  const d = Float64Array.from(out).sort();
  if (nullMemo.size >= 32) nullMemo.delete(nullMemo.keys().next().value!);
  nullMemo.set(key, d);
  return d;
}

/** p = (1 + liczba dolin zerowych o głębokości ≥ `depth`) / (1 + liczba dolin zerowych); `sorted` rosnąco. */
export function pValue(depth: number, sorted: Float64Array): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (sorted[m] < depth - 1e-12) lo = m + 1;
    else hi = m;
  }
  return (1 + sorted.length - lo) / (1 + sorted.length);
}

/** Filtr położenia (bootstrap blokami `block`) i p testu (a) dla `nodes` profilu `u`, w kolejności `nodes`. */
export function lvnTests(u: ProfileUnits, nodes: readonly LvnNode[], share: number, minAreaBins: number, block: number, o: Omit<LvnOptions, 'block'> = {}): LvnTest[] {
  if (nodes.length === 0) return [];
  const location = lvnLocation(u, share, nodes, { ...o, block });
  const nul = nullDepths(nullSpec(u, block), share, minAreaBins);
  return nodes.map((x, i) => ({ location: location[i], p: pValue(x.depth, nul) }));
}

/**
 * LVN profilu po testach: kandydaci `lvnNodes` (obszar od `minAreaBins` koszyków), ceny z siatki, filtr położenia
 * (bootstrap blokami ok. 15 min świec interwału `unitMs`) i p wobec szumu pomiaru. Za mało świec (`minUnits`) — null.
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
  const tests = lvnTests(u, nodes, share, minAreaBins, block, o);
  return lvnPrices(nodes, grid.mid, grid.edge).map((x, i) => ({ ...x, ...tests[i] }));
}
