import { isotonic } from './forecastScore.ts';
import { FEATURES } from './schrodi.ts';
import { normCdf } from './stats.ts';

/**
 * Warstwa zaufania Schrödiego — wspólna dla skanera (podsumowanie), weryfikatora (przeliczenie z rekordów) i strony:
 *  - dowód przewagi na żywo: e-proces z zakładów na różnicy wyników Briera kota i prostej reguły (słaba hipoteza zerowa
 *    „kot nie jest lepszy”; Henzi i Ziegel 2022, Choe i Ramdas 2021). Nierówność Ville'a: bez przewagi kapitał
 *    kiedykolwiek przekroczy 20 z prawdopodobieństwem najwyżej 5%, także przy ciągłym podglądaniu;
 *  - alarm dryfu: e-detektor CUSUM (Shin, Ramdas, Rinaldo 2022) na tej samej różnicy, zakład przeciw kotu; fałszywy
 *    alarm średnio rzadziej niż raz na 1000 godzin;
 *  - rozkład CORP wyniku Briera (Dimitriadis, Gneiting, Jordan 2021): błąd kalibracji, wiedza kota i trudność rynku,
 *    dokładnie BS = MCB − DSC + UNC; koszyki kalibracji z pasmami Wilsona 90% i test Spiegelhaltera (1986);
 *  - rzadki rynek: cechy poza zakresem 0,5–99,5% z nauki modelu.
 * Oceniane tylko prognozy z pełnej godziny (rozłączne okna 1 h) wydane po rejestracji planu w dzienniku.
 */

const HOUR = 3_600_000;

/** Cechy sprawdzane pod kątem rzadkiego rynku (ruch, zmienność, wolumen) */
export const OOD_FEATURES = ['ret_15m', 'ret_1h', 'ret_4h', 'ret_1d', 'rv_1h', 'rv_1d', 'rng4h_rel', 'vol_z'] as const;
export type OodFeature = (typeof OOD_FEATURES)[number];

/** Plan oceny zaufania — prerejestrowany w dzienniku (rekord `k: 'p'`); zmiana planu = nowy identyfikator */
export const TRUST_DESIGN = {
  id: 'schrodi-trust-v1',
  question: 'Czy Schrödi trafia lepiej (wynik Briera) niż prosta reguła: duży ruch i kierunek wobec stałej częstości z nauki, dotknięcia wobec ruchu Browna?',
  hours: 'prognozy kota ze slotów o pełnej godzinie (rozłączne okna 1 h), slot nie wcześniej niż rejestracja planu, bez unieważnionych',
  baseline: {
    big: 0.483,
    up: 0.5045,
    source: 'częstość dużego ruchu i wzrostu na siatce 5 min 2022-01-01..2026-10-24 (dane nauki modelu)',
    touch: 'P = 2(1 − Φ(|d| / (rv_1d / √24))), ograniczone do [0,0001; 0,9999]',
  },
  delta: 'δ = Brier reguły − Brier kota; δmin, δmax = najmniejsze i największe możliwe δ przed wynikiem; dotknięcia: średnie po poziomach godziny',
  proof: {
    bets: [0.025, 0.05, 0.1, 0.2, 0.4],
    bet: 'kapitał_f ← kapitał_f · (1 + f · δ / |δmin|), mieszanka po f z równymi wagami',
    threshold: 20,
  },
  drift: {
    bets: [0.025, 0.05, 0.1, 0.2, 0.4],
    update: 'M_f ← max(M_f, 1) · (1 − f · δ / δmax), statystyka = średnia po f',
    alarm: 1000,
    clear: 'statystyka poniżej 1',
  },
  calibration: { bins: 10, band: 'Wilson 90% (dotknięcia: liczność = godziny w koszyku)', test: 'Spiegelhalter 1986 (duży ruch, kierunek)', decomposition: 'CORP z PAV' },
  display: 'szary kot przy alarmie dryfu którejkolwiek głowy; rzadki rynek tylko jako informacja, bez zmiany szans',
  ood: {
    quantiles: [0.005, 0.995],
    source: 'cechy na siatce 5 min 2022-01-01..2026-10-24',
    ranges: {
      ret_15m: [-101.692336, 99.554192],
      ret_1h: [-208.272383, 203.077091],
      ret_4h: [-414.412204, 395.776595],
      ret_1d: [-903.898434, 887.748423],
      rv_1h: [6.217578, 211.987733],
      rv_1d: [50.276546, 890.115568],
      rng4h_rel: [0.077083, 2.145896],
      vol_z: [-2.220425, 3.01555],
    } as Record<OodFeature, readonly [number, number]>,
  },
} as const;

const WILSON_Z = 1.6448536269514722;
const LOG10 = Math.log(10);
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const r3 = (v: number) => Math.round(v * 1e3) / 1e3;

/** Cechy poza zakresem z nauki; brak cechy (null, NaN) nie jest „poza zakresem”. */
export function oodKeys(get: (k: OodFeature) => number | null | undefined): OodFeature[] {
  return OOD_FEATURES.filter((k) => {
    const v = get(k);
    if (v === null || v === undefined || !Number.isFinite(v)) return false;
    const [lo, hi] = TRUST_DESIGN.ood.ranges[k];
    return v < lo || v > hi;
  });
}

/** Przedział Wilsona (domyślnie 90%) dla k sukcesów na n; n = 0 → null. */
export function wilson(k: number, n: number, z: number = WILSON_Z): [number, number] | null {
  if (!(n > 0)) return null;
  const ph = k / n;
  const den = 1 + (z * z) / n;
  const mid = (ph + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((ph * (1 - ph)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

/** Test kalibracji Spiegelhaltera: Z = Σ(y − p)(1 − 2p) / √Σ(1 − 2p)²p(1 − p), p dwustronne; brak danych → null. */
export function spiegelhalter(pp: readonly { p: number; y: 0 | 1 }[]): { z: number; p: number } | null {
  let num = 0;
  let v = 0;
  for (const { p, y } of pp) {
    num += (y - p) * (1 - 2 * p);
    v += (1 - 2 * p) ** 2 * p * (1 - p);
  }
  if (!(v > 0)) return null;
  const z = num / Math.sqrt(v);
  return { z, p: 2 * (1 - normCdf(Math.abs(z))) };
}

/**
 * Rozkład CORP wyniku Briera: prognozy przekalibrowane regresją izotoniczną (PAV, remisy p jako jeden blok) → MCB (błąd
 * kalibracji), DSC (rozdzielczość: ile kot wie ponad średnią) i UNC (trudność rynku); dokładnie BS = MCB − DSC + UNC.
 */
export function corp(pp: readonly { p: number; y: 0 | 1 }[]): { bs: number; mcb: number; dsc: number; unc: number } | null {
  const n = pp.length;
  if (n === 0) return null;
  const s = [...pp].sort((a, b) => a.p - b.p);
  const groups: { sum: number; n: number }[] = [];
  for (let i = 0; i < n; i++) {
    const g = groups[groups.length - 1];
    if (g && i > 0 && s[i].p === s[i - 1].p) {
      g.sum += s[i].y;
      g.n++;
    } else groups.push({ sum: s[i].y, n: 1 });
  }
  const fit = isotonic(
    groups.map((g) => g.sum / g.n),
    groups.map((g) => g.n)
  );
  let bs = 0;
  let bsc = 0;
  let ys = 0;
  let i = 0;
  groups.forEach((g, gi) => {
    for (let k = 0; k < g.n; k++, i++) {
      bs += (s[i].p - s[i].y) ** 2;
      bsc += (fit[gi] - s[i].y) ** 2;
      ys += s[i].y;
    }
  });
  const ybar = ys / n;
  const unc = ybar * (1 - ybar);
  return { bs: bs / n, mcb: (bs - bsc) / n, dsc: unc - bsc / n, unc };
}

/** Krok zakładu: δ (Brier reguły q − Brier kota p) i jego granice przed poznaniem wyniku */
export interface TrustStep {
  slot: number;
  d: number;
  lo: number;
  hi: number;
}

export function deltaStep(p: number, q: number, y: 0 | 1): { d: number; lo: number; hi: number } {
  const d1 = (q - 1) ** 2 - (p - 1) ** 2;
  const d0 = q * q - p * p;
  return { d: y === 1 ? d1 : d0, lo: Math.min(d0, d1), hi: Math.max(d0, d1) };
}

/** log10 średniej z exp(lnK[i]) — bez przepełnienia przy ogromnym kapitale */
function log10MeanExp(ln: readonly number[]): number {
  const m = Math.max(...ln);
  if (m === -Infinity) return -Infinity;
  let s = 0;
  for (const v of ln) s += Math.exp(v - m);
  return (m + Math.log(s / ln.length)) / LOG10;
}

/** Dowód przewagi: log10 kapitału mieszanki zakładów po każdym kroku (kapitał startowy 1 = log10 0). */
export function proofPath(steps: readonly TrustStep[]): number[] {
  const bets = TRUST_DESIGN.proof.bets;
  const ln = bets.map(() => 0);
  const out: number[] = [];
  for (const s of steps) {
    const z = s.lo < 0 ? s.d / -s.lo : 0;
    for (let k = 0; k < bets.length; k++) ln[k] += Math.log1p(bets[k] * z);
    out.push(log10MeanExp(ln));
  }
  return out;
}

/**
 * Detektor dryfu (zakład, że kot jest gorszy od reguły): log10 statystyki po ostatnim kroku, stan alarmu z histerezą
 * (alarm od statystyki ≥ 1000 do spadku poniżej 1), liczba epizodów i slot początku bieżącego alarmu.
 */
export function driftState(steps: readonly TrustStep[]): { lg: number; alarm: boolean; episodes: number; since: number | null } {
  const bets = TRUST_DESIGN.drift.bets;
  const thr = Math.log10(TRUST_DESIGN.drift.alarm);
  const ln = bets.map(() => -Infinity);
  let lg = 0;
  let alarm = false;
  let episodes = 0;
  let since: number | null = null;
  for (const s of steps) {
    const z = s.hi > 0 ? s.d / s.hi : 0;
    for (let k = 0; k < bets.length; k++) ln[k] = Math.max(ln[k], 0) + Math.log1p(-bets[k] * z);
    lg = log10MeanExp(ln);
    if (!alarm && lg >= thr) {
      alarm = true;
      episodes++;
      since = s.slot;
    } else if (alarm && lg < 0) {
      alarm = false;
      since = null;
    }
  }
  return { lg: steps.length ? lg : 0, alarm, episodes, since };
}

/** Pełna godzina kota w ocenie zaufania (z rekordu prognozy i jego rozstrzygnięcia) */
export interface TrustHour {
  slot: number;
  pUp: number;
  pBig: number;
  yDir: 0 | 1;
  yBig: 0 | 1;
  /** Cechy z rekordu (kolejność FEATURES) */
  x: readonly (number | null)[];
  /** Poziomy z szansą kota, ruchem Browna i wynikiem */
  touch: { p: number; q: number; y: 0 | 1 }[];
}

const RV_1D = FEATURES.indexOf('rv_1d');

/**
 * Godzina do oceny z zapisanych pól (jak w dzienniku): kierunek c1 > c0, duży ruch ln(hi/lo)·1e4 > próg, dotknięcie
 * poziomu nad ceną hi ≥ poziom, pod ceną lo ≤ poziom. Prognoza spoza pełnej godziny → null.
 */
export function trustHour(
  f: { slot: number; pUp: number; pBig: number; thr: number; px0: number; x: readonly (number | null)[]; tl?: readonly { px: number; p: number }[] },
  r: { c0: number; c1: number; hi: number; lo: number }
): TrustHour | null {
  if (f.slot % HOUR !== 0) return null;
  const rv = f.x[RV_1D];
  const touch: TrustHour['touch'] = [];
  if (rv !== null && rv !== undefined && rv > 0)
    for (const l of f.tl ?? []) {
      const q = 2 * (1 - normCdf(Math.abs(Math.log(l.px / f.px0) * 1e4) / (rv / Math.sqrt(24))));
      const y: 0 | 1 = l.px > f.px0 ? (r.hi >= l.px ? 1 : 0) : r.lo <= l.px ? 1 : 0;
      touch.push({ p: l.p, q: Math.min(1 - 1e-4, Math.max(1e-4, q)), y });
    }
  return { slot: f.slot, pUp: f.pUp, pBig: f.pBig, yDir: r.c1 > r.c0 ? 1 : 0, yBig: Math.log(r.hi / r.lo) * 1e4 > f.thr ? 1 : 0, x: f.x, touch };
}

/** Koszyk kalibracji z pasmem Wilsona 90% */
export interface TrustBin {
  lo: number;
  hi: number;
  n: number;
  meanP: number | null;
  freq: number | null;
  /** Pasmo Wilsona 90% częstości (dotknięcia: liczność = godziny w koszyku) */
  band: [number, number] | null;
}

export interface TrustHead {
  /** Godziny w ocenie */
  n: number;
  /** log10 kapitału (e-wartości) teraz; 0 = start, log10 20 ≈ 1,301 = dowód */
  lg: number;
  /** Najwyższe log10 E — przekroczenie 20 raz to dowód ważny przy każdym podglądaniu (Ville) */
  lgMax: number;
  /** Slot godziny, po której E pierwszy raz osiągnęło 20; null = jeszcze nie */
  proofAt: number | null;
  /** log10 E co `step` godzin (najwyżej 400 punktów, ostatni zawsze) */
  path: number[];
  step: number;
  brier: number | null;
  brierBase: number | null;
  corp: { mcb: number; dsc: number; unc: number } | null;
  /** Test Spiegelhaltera (dotknięcia: null — poziomy w tej samej godzinie są zależne) */
  spiegel: { z: number; p: number } | null;
  rel: TrustBin[];
  drift: { lg: number; alarm: boolean; episodes: number; since: number | null };
}

export interface CatTrust {
  /** Rejestracja planu w dzienniku; null = plan jeszcze niezapisany (ocena nie biegnie) */
  plan: { id: string; hash: string; at: number } | null;
  big: TrustHead;
  dir: TrustHead;
  touch: TrustHead;
  /** Godziny z rzadkim rynkiem (cechy poza zakresem z nauki): BSS dużego ruchu i kierunku wobec reguły */
  ood: { n: number; bssBig: number | null; bssDir: number | null };
}

export const TRUST_HEADS = ['big', 'dir', 'touch'] as const;
export type TrustHeadKey = (typeof TRUST_HEADS)[number];

/**
 * Stan dowodu głowy: brak; trwa (E przekroczyło 20 i nadal jest ≥ 20); osłabł (dowód z chwili przekroczenia zostaje
 * ważny dla godzin do niej, ale od tego czasu kot oddał przewagę — kapitał spadł poniżej 20).
 */
export const proofState = (h: TrustHead): 'none' | 'holding' | 'faded' =>
  h.proofAt === null ? 'none' : h.lg >= Math.log10(TRUST_DESIGN.proof.threshold) ? 'holding' : 'faded';

/** Głowy z alarmem dryfu — kot w szarym trybie, dopóki alarm nie zgaśnie */
export const driftAlarms = (t: CatTrust | null | undefined): TrustHeadKey[] => (t ? TRUST_HEADS.filter((k) => t[k].drift.alarm) : []);

const PATH_MAX = 400;

function head(steps: TrustStep[], pp: { p: number; y: 0 | 1; q: number; c: number }[], test: boolean): TrustHead {
  const path = proofPath(steps);
  const step = Math.max(1, Math.ceil(path.length / PATH_MAX));
  const pts: number[] = [];
  for (let i = step - 1; i < path.length; i += step) pts.push(r3(path[i]));
  if (path.length && (path.length - 1) % step !== step - 1) pts.push(r3(path[path.length - 1]));
  const thr = Math.log10(TRUST_DESIGN.proof.threshold);
  const hit = path.findIndex((v) => v >= thr);
  const bins = Array.from({ length: TRUST_DESIGN.calibration.bins }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, n: 0, sp: 0, sy: 0, cl: new Map<number, [number, number]>() }));
  for (const x of pp) {
    const b = bins[Math.min(9, Math.max(0, Math.floor(x.p * 10)))];
    b.n++;
    b.sp += x.p;
    b.sy += x.y;
    // Liczność do pasma: osobne godziny (klaster c) — częstość godziny jako średnia jej poziomów w koszyku
    const c = b.cl.get(x.c) ?? [0, 0];
    b.cl.set(x.c, [c[0] + x.y, c[1] + 1]);
  }
  const cp = corp(pp);
  const n = pp.length;
  return {
    n: steps.length,
    lg: path.length ? r4(path[path.length - 1]) : 0,
    lgMax: path.length ? r4(Math.max(0, ...path)) : 0,
    proofAt: hit >= 0 ? steps[hit].slot : null,
    path: pts,
    step,
    brier: n ? r4(pp.reduce((a, x) => a + (x.p - x.y) ** 2, 0) / n) : null,
    brierBase: n ? r4(pp.reduce((a, x) => a + (x.q - x.y) ** 2, 0) / n) : null,
    corp: cp ? { mcb: r4(cp.mcb), dsc: r4(cp.dsc), unc: r4(cp.unc) } : null,
    spiegel: test ? ((s) => (s ? { z: r4(s.z), p: r4(s.p) } : null))(spiegelhalter(pp)) : null,
    rel: bins.map((b) => {
      const hours = b.cl.size;
      const freq = b.n ? b.sy / b.n : null;
      const band = freq === null ? null : wilson(freq * hours, hours);
      return { lo: b.lo, hi: b.hi, n: b.n, meanP: b.n ? r4(b.sp / b.n) : null, freq: freq === null ? null : r4(freq), band: band ? [r4(band[0]), r4(band[1])] : null };
    }),
    drift: ((d) => ({ ...d, lg: r4(d.lg) }))(driftState(steps)),
  };
}

/** Ocena zaufania z godzin (dowolna kolejność; liczą się sloty ≥ rejestracja planu); bez planu — pusta ocena. */
export function catTrust(hours: readonly TrustHour[], plan: CatTrust['plan']): CatTrust {
  const hs = plan ? [...hours].filter((h) => h.slot >= plan.at).sort((a, b) => a.slot - b.slot) : [];
  const qb = TRUST_DESIGN.baseline.big;
  const qu = TRUST_DESIGN.baseline.up;
  const bigSteps = hs.map((h) => ({ slot: h.slot, ...deltaStep(h.pBig, qb, h.yBig) }));
  const dirSteps = hs.map((h) => ({ slot: h.slot, ...deltaStep(h.pUp, qu, h.yDir) }));
  const touchSteps: TrustStep[] = [];
  const touchPp: { p: number; y: 0 | 1; q: number; c: number }[] = [];
  for (const h of hs) {
    if (h.touch.length === 0) continue;
    let d = 0;
    let lo = 0;
    let hi = 0;
    for (const l of h.touch) {
      const s = deltaStep(l.p, l.q, l.y);
      d += s.d;
      lo += s.lo;
      hi += s.hi;
      touchPp.push({ p: l.p, y: l.y, q: l.q, c: h.slot });
    }
    const k = h.touch.length;
    touchSteps.push({ slot: h.slot, d: d / k, lo: lo / k, hi: hi / k });
  }
  const ood = hs.filter((h) => oodKeys((k) => h.x[FEATURES.indexOf(k)]).length > 0);
  const bss = (xs: { p: number; q: number; y: number }[]) => {
    const a = xs.reduce((s, x) => s + (x.p - x.y) ** 2, 0);
    const b = xs.reduce((s, x) => s + (x.q - x.y) ** 2, 0);
    return xs.length && b > 0 ? r4(1 - a / b) : null;
  };
  return {
    plan,
    big: head(bigSteps, hs.map((h) => ({ p: h.pBig, y: h.yBig, q: qb, c: h.slot })), true),
    dir: head(dirSteps, hs.map((h) => ({ p: h.pUp, y: h.yDir, q: qu, c: h.slot })), true),
    touch: head(touchSteps, touchPp, false),
    ood: {
      n: ood.length,
      bssBig: bss(ood.map((h) => ({ p: h.pBig, q: qb, y: h.yBig }))),
      bssDir: bss(ood.map((h) => ({ p: h.pUp, q: qu, y: h.yDir }))),
    },
  };
}
