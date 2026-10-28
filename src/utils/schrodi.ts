/**
 * Schrödi — kot desku: prognoza wielkości ruchu i kierunku BTC na 1 h ze świec Hyperliquid.
 * Moduł bez Reacta, wspólny dla strony i skanera (Node 24 — importy z rozszerzeniem .ts).
 *
 * Cechy liczone są dokładnie tak jak przy uczeniu (świece 1m, 5m, 1h i 1d, kalendarz FOMC/CPI/NFP); model to średnia
 * regresji logistycznej i drzew LightGBM z pliku `public/schrodi/model-v1.json`. Metoda i wyniki walidacji: docs/SCHRODI.md.
 * Chwila prognozy to zamknięcie ostatniej pełnej świecy 5m (`t` = jej początek, prognoza z `t + 5 min`).
 */

const MIN = 60_000;
const M5 = 5 * MIN;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Profil wolumenu: koszyk 5 pb w skali log, obszar wartości 70% */
const BIN = 0.0005;
const VA_SHARE = 0.7;

export interface Bar {
  /** Początek świecy (ms UTC) */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** Wolumen w BTC */
  v: number;
}

export const FEATURES = [
  'ret_15m', 'ret_1h', 'ret_4h', 'ret_1d', 'rv_1h', 'rv_1d', 'rng4h_rel', 'vol_z', 'dist_vwap', 'day_pos',
  'dist_pdh', 'dist_pdl', 'dist_poc', 'dist_vah', 'dist_val', 'above_va',
  'ny_hour', 'ldn_hour', 'dow', 'min_to_event', 'min_since_event', 'expiry_pre',
] as const;
export type Feature = (typeof FEATURES)[number];
export type FeatureVec = Record<Feature, number>;

/** Grupy cech do „Dlaczego?” */
export type Group = 'move' | 'vol' | 'auction' | 'clock';
export const GROUP_OF: Record<Feature, Group> = {
  ret_15m: 'move', ret_1h: 'move', ret_4h: 'move', ret_1d: 'move',
  rv_1h: 'vol', rv_1d: 'vol', rng4h_rel: 'vol', vol_z: 'vol',
  dist_vwap: 'auction', day_pos: 'auction', dist_pdh: 'auction', dist_pdl: 'auction', dist_poc: 'auction',
  dist_vah: 'auction', dist_val: 'auction', above_va: 'auction',
  ny_hour: 'clock', ldn_hour: 'clock', dow: 'clock', min_to_event: 'clock', min_since_event: 'clock', expiry_pre: 'clock',
};

export interface Levels {
  pdh: number;
  pdl: number;
  poc: number;
  vah: number;
  val: number;
  vwap: number;
}

export interface SchrodiInput {
  m1: Bar[];
  m5: Bar[];
  h1: Bar[];
  d1: Bar[];
  /** Czasy publikacji FOMC (decyzje), CPI i NFP w ms UTC, rosnąco */
  events: number[];
}

export interface FeatureResult {
  /** Początek świecy 5m, na której zamknięciu liczona jest prognoza */
  t: number;
  price: number;
  x: FeatureVec;
  levels: Levels | null;
  /** Mediana dziennego zakresu z 30 dni (pb) */
  d30: number;
  /** Próg „dużego ruchu”: mediana zakresu świec 1h z 30 dni (pb) */
  med1h: number;
}

const byTime = (bars: Bar[]) => {
  const m = new Map<number, Bar>();
  for (const b of bars) m.set(b.t, b);
  return m;
};

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}

/** Profil wolumenu dnia: POC, VAH, VAL (minuty w kolejności czasu, wolumen minuty równo od low do high). */
export function profile(bars: Bar[]): { poc: number; vah: number; val: number } {
  const lo = bars.map((b) => Math.floor(Math.log(b.l) / BIN));
  const hi = bars.map((b) => Math.floor(Math.log(b.h) / BIN));
  let base = Infinity;
  let top = -Infinity;
  for (let i = 0; i < bars.length; i++) {
    base = Math.min(base, lo[i]);
    top = Math.max(top, hi[i]);
  }
  const diff = new Float64Array(top - base + 2);
  for (let i = 0; i < bars.length; i++) {
    const w = bars[i].v / (hi[i] - lo[i] + 1);
    diff[lo[i] - base] += w;
    diff[hi[i] - base + 1] -= w;
  }
  const vp = new Float64Array(diff.length - 1);
  let run = 0;
  let tot = 0;
  let p = 0;
  for (let i = 0; i < vp.length; i++) {
    run += diff[i];
    vp[i] = run;
    tot += run;
    if (run > vp[p]) p = i;
  }
  let a = p;
  let b = p;
  let acc = vp[p];
  while (acc < VA_SHARE * tot) {
    const up = b + 1 < vp.length ? vp[b + 1] : -1;
    const dn = a - 1 >= 0 ? vp[a - 1] : -1;
    if (up >= dn) {
      b++;
      acc += up;
    } else {
      a--;
      acc += dn;
    }
  }
  const e = (i: number) => Math.exp((i + base) * BIN);
  return { poc: e(p + 0.5), vah: e(b + 1), val: e(a) };
}

const hourFmt = new Map<string, Intl.DateTimeFormat>();
function localHour(t: number, timeZone: string): number {
  let f = hourFmt.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' });
    hourFmt.set(timeZone, f);
  }
  return Number(f.formatToParts(t).find((p) => p.type === 'hour')?.value ?? NaN);
}

/** Mediana zakresu (pb) 720 pełnych świec 1h przed chwilą `at` (min. 360). */
export function bigMoveThreshold(h1: Bar[], at: number): number {
  const last = Math.floor(at / HOUR) * HOUR - HOUR;
  const m = byTime(h1);
  const r: number[] = [];
  for (let i = 0; i < 720; i++) {
    const b = m.get(last - i * HOUR);
    if (b && b.h > 0 && b.l > 0) r.push(Math.log(b.h / b.l) * 1e4);
  }
  return r.length >= 360 ? median(r) : NaN;
}

/** Ostatnia pełna świeca 5m przed chwilą `now`: jej początek. */
export const lastClosed5m = (now: number) => Math.floor(now / M5) * M5 - M5;

/** Cechy na zamknięciu świecy 5m o początku `t` (braki danych → NaN, tak jak przy uczeniu). */
export function features(inp: SchrodiInput, t: number): FeatureResult | null {
  const m5 = byTime(inp.m5);
  const cur = m5.get(t);
  if (!cur || !(cur.c > 0)) return null;
  const lc = (x: number) => {
    const b = m5.get(x);
    return b && b.c > 0 ? Math.log(b.c) : NaN;
  };
  const l0 = Math.log(cur.c);
  const x = {} as FeatureVec;
  x.ret_15m = (l0 - lc(t - 3 * M5)) * 1e4;
  x.ret_1h = (l0 - lc(t - 12 * M5)) * 1e4;
  x.ret_4h = (l0 - lc(t - 48 * M5)) * 1e4;
  x.ret_1d = (l0 - lc(t - 288 * M5)) * 1e4;
  const rv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const r = lc(t - i * M5) - lc(t - (i + 1) * M5);
      s += r * r;
    }
    return Math.sqrt(s) * 1e4;
  };
  x.rv_1h = rv(12);
  x.rv_1d = rv(288);

  const day = Math.floor(t / DAY) * DAY;
  const d1 = byTime(inp.d1);
  const ranges: number[] = [];
  for (let i = 1; i <= 30; i++) {
    const b = d1.get(day - i * DAY);
    if (b && b.h > 0 && b.l > 0) ranges.push(Math.log(b.h / b.l) * 1e4);
  }
  const d30 = ranges.length >= 20 ? median(ranges) : NaN;

  let hMax = -Infinity;
  let lMin = Infinity;
  let full = true;
  for (let i = 0; i < 48; i++) {
    const b = m5.get(t - i * M5);
    if (!b) {
      full = false;
      break;
    }
    hMax = Math.max(hMax, b.h);
    lMin = Math.min(lMin, b.l);
  }
  x.rng4h_rel = full ? ((Math.log(hMax) - Math.log(lMin)) * 1e4) / d30 : NaN;

  const lv = (b: Bar | undefined) => (b && b.v >= 0 && b.c > 0 ? Math.log1p(b.v * b.c) : NaN);
  const xs: number[] = [];
  for (let i = 0; i < 2016; i++) {
    const y = lv(m5.get(t - i * M5));
    if (Number.isFinite(y)) xs.push(y);
  }
  const xc = lv(cur);
  if (xs.length >= 1008 && Number.isFinite(xc)) {
    const mean = xs.reduce((s, y) => s + y, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, y) => s + (y - mean) * (y - mean), 0) / (xs.length - 1));
    x.vol_z = (xc - mean) / sd;
  } else x.vol_z = NaN;

  // Bieżący dzień UTC z minut do końca świecy 5m: VWAP, maksimum, minimum
  let pv = 0;
  let vv = 0;
  let dh = -Infinity;
  let dl = Infinity;
  let inBar = false;
  const prev: Bar[] = [];
  for (const b of inp.m1) {
    if (b.t >= day - DAY && b.t < day) {
      if (b.h > 0 && b.l > 0 && b.v >= 0) prev.push(b);
      continue;
    }
    if (b.t < day || b.t >= t + M5) continue;
    if (b.t >= t) inBar = true;
    pv += ((b.h + b.l + b.c) / 3) * b.v;
    vv += b.v;
    dh = Math.max(dh, b.h);
    dl = Math.min(dl, b.l);
  }
  const vwap = inBar && vv > 0 ? pv / vv : NaN;
  x.dist_vwap = ((l0 - Math.log(vwap)) * 1e4) / d30;
  x.day_pos = inBar && dh > dl ? (cur.c - dl) / (dh - dl) : NaN;

  let levels: Levels | null = null;
  if (prev.length >= 1300) {
    let pdh = -Infinity;
    let pdl = Infinity;
    for (const b of prev) {
      pdh = Math.max(pdh, b.h);
      pdl = Math.min(pdl, b.l);
    }
    levels = { pdh, pdl, ...profile(prev), vwap };
  }
  const dist = (lvl: number | undefined) => (lvl !== undefined ? ((l0 - Math.log(lvl)) * 1e4) / d30 : NaN);
  x.dist_pdh = dist(levels?.pdh);
  x.dist_pdl = dist(levels?.pdl);
  x.dist_poc = dist(levels?.poc);
  x.dist_vah = dist(levels?.vah);
  x.dist_val = dist(levels?.val);
  x.above_va = Number.isNaN(x.dist_vah) || Number.isNaN(x.dist_val) ? NaN : x.dist_vah > 0 ? 1 : x.dist_val < 0 ? -1 : 0;

  x.ny_hour = localHour(t, 'America/New_York');
  x.ldn_hour = localHour(t, 'Europe/London');
  const d = new Date(t);
  x.dow = (d.getUTCDay() + 6) % 7;
  const tc = t + M5;
  let next = Infinity;
  let last = -Infinity;
  for (const e of inp.events) {
    if (e >= tc) {
      next = Math.min(next, e);
    } else last = Math.max(last, e);
  }
  x.min_to_event = Math.min((next - tc) / MIN, 1440);
  x.min_since_event = Math.min((tc - last) / MIN, 240);
  x.expiry_pre = d.getUTCDay() === 5 && new Date(t + 7 * DAY).getUTCMonth() !== d.getUTCMonth() && d.getUTCHours() < 8 ? 1 : 0;

  return { t, price: cur.c, x, levels, d30, med1h: bigMoveThreshold(inp.h1, tc) };
}

/** Zdarzenia kalendarza, na których uczył się model: decyzje FOMC (bez protokołów), CPI i NFP. */
export function modelEvents(list: { id: string; kind: string; timeUtcMs: number }[]): number[] {
  return list
    .filter((e) => (e.kind === 'FOMC' && !e.id.startsWith('FOMC_MIN')) || e.kind === 'CPI' || e.kind === 'NFP')
    .map((e) => e.timeUtcMs)
    .sort((a, b) => a - b);
}

/* ───────────────────────────── Model ───────────────────────────── */

export interface LrModel {
  /** Cechy liczbowe (bez godziny NY, godziny Londynu i dnia tygodnia) */
  num: Feature[];
  mean: number[];
  std: number[];
  coef: number[];
  /** Efekt godziny NY (0–23) i dnia tygodnia (0 = poniedziałek) */
  hour: number[];
  dow: number[];
  b: number;
}

/** Drzewo LightGBM: węzły wewnętrzne 0…n−1, dziecko < 0 to liść ~dziecko; `m`: bit 0 = brak w lewo, bity 1–2 = typ braku (0 brak, 1 zero, 2 NaN). */
export interface Tree {
  f: number[];
  t: number[];
  m: number[];
  l: number[];
  r: number[];
  /** Wartość węzła wewnętrznego (do rozkładu wkładu cech) */
  iv: number[];
  lv: number[];
}

export interface HeadModel {
  lr: LrModel;
  gb: Tree[];
}

export interface SchrodiModel {
  version: string;
  trainedTo: string;
  features: Feature[];
  dir: HeadModel;
  big: HeadModel;
  /** Wyniki walidacji kroczącej (do karty „Jak trafiam”) */
  card: Record<string, unknown>;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

function lrScore(m: LrModel, x: FeatureVec): { z: number; contrib: Partial<Record<Feature, number>> } {
  const contrib: Partial<Record<Feature, number>> = {};
  let z = m.b;
  m.num.forEach((name, j) => {
    const v = x[name];
    const s = Number.isNaN(v) ? 0 : Math.max(-5, Math.min(5, (v - m.mean[j]) / m.std[j]));
    contrib[name] = m.coef[j] * s;
    z += contrib[name]!;
  });
  const hMean = m.hour.reduce((s, v) => s + v, 0) / m.hour.length;
  const dMean = m.dow.reduce((s, v) => s + v, 0) / m.dow.length;
  const h = m.hour[x.ny_hour] ?? 0;
  const dw = m.dow[x.dow] ?? 0;
  z += h + dw;
  contrib.ny_hour = h - hMean;
  contrib.dow = dw - dMean;
  return { z, contrib };
}

const ZERO = 1e-35;

/** Wynik drzewa i rozkład Saabasa (zmiana wartości węzła przypisana cesze podziału). */
function treeScore(tr: Tree, xv: number[], contrib: number[]): number {
  let node = 0;
  if (tr.f.length === 0) return tr.lv[0];
  for (;;) {
    let v = xv[tr.f[node]];
    const miss = tr.m[node] >> 1;
    if (Number.isNaN(v) && miss !== 2) v = 0;
    const isMissing = (miss === 1 && Math.abs(v) <= ZERO) || (miss === 2 && Number.isNaN(v));
    const left = isMissing ? (tr.m[node] & 1) === 1 : v <= tr.t[node];
    const child = left ? tr.l[node] : tr.r[node];
    const next = child < 0 ? tr.lv[~child] : tr.iv[child];
    contrib[tr.f[node]] += next - tr.iv[node];
    if (child < 0) return next;
    node = child;
  }
}

export interface HeadResult {
  p: number;
  pLr: number;
  pGb: number;
  /** Przybliżony wkład grup cech w p (punkty procentowe) */
  why: Record<Group, number>;
}

export function scoreHead(m: HeadModel, features: Feature[], x: FeatureVec): HeadResult {
  const { z, contrib } = lrScore(m.lr, x);
  const xv = features.map((f) => x[f]);
  const c = new Array<number>(features.length).fill(0);
  let raw = 0;
  for (const tr of m.gb) raw += treeScore(tr, xv, c);
  const pLr = sigmoid(z);
  const pGb = sigmoid(raw);
  const why: Record<Group, number> = { move: 0, vol: 0, auction: 0, clock: 0 };
  // Linearyzacja obu modeli w punkcie prognozy: dp ≈ p(1 − p) · dz, średnia dwóch modeli
  for (const [name, v] of Object.entries(contrib) as [Feature, number][]) why[GROUP_OF[name]] += 50 * pLr * (1 - pLr) * v;
  features.forEach((name, j) => (why[GROUP_OF[name]] += 50 * pGb * (1 - pGb) * c[j]));
  return { p: (pLr + pGb) / 2, pLr, pGb, why };
}

/** Strefa „Nie wiem”: szansa wzrostu od 47 do 53% */
export const UNSURE_LO = 0.47;
export const UNSURE_HI = 0.53;
export type Stance = 'long' | 'short' | 'unsure';
export const stanceOf = (pUp: number): Stance => (pUp > UNSURE_HI ? 'long' : pUp < UNSURE_LO ? 'short' : 'unsure');

export interface Forecast {
  version: string;
  t: number;
  price: number;
  /** Szansa wzrostu w 1 h */
  pUp: number;
  stance: Stance;
  /** Szansa, że zakres najbliższej godziny przekroczy medianę zakresu godziny z 30 dni */
  pBig: number;
  /** Ta mediana w USD przy bieżącej cenie */
  bigUsd: number;
  /** Mediana zakresu godziny z 30 dni (pb, log) — skala odległości modelu dotknięć */
  med1h: number;
  why: Record<Group, number>;
  levels: Levels | null;
  x: FeatureVec;
}

export function forecast(model: SchrodiModel, inp: SchrodiInput, t: number): Forecast | null {
  const fr = features(inp, t);
  if (!fr || !Number.isFinite(fr.d30)) return null;
  const dir = scoreHead(model.dir, model.features, fr.x);
  const big = scoreHead(model.big, model.features, fr.x);
  return {
    version: model.version,
    t,
    price: fr.price,
    pUp: dir.p,
    stance: stanceOf(dir.p),
    pBig: big.p,
    bigUsd: Number.isFinite(fr.med1h) ? fr.price * (Math.exp(fr.med1h / 1e4) - 1) : NaN,
    med1h: fr.med1h,
    why: dir.why,
    levels: fr.levels,
    x: fr.x,
  };
}

/* ─────────────────────────── Dotknięcia ceny ─────────────────────────── */

/**
 * Model dotknięć (`public/schrodi/touch-v1.json`): szansa, że cena odległa o `d` pb dotknięta zostanie w oknie godziny
 * kota. Uczony na losowych cenach („placebo”), bo poziomy aukcji nie przyciągają ceny bardziej niż zwykła cena
 * w tej samej odległości (atlas 2022 do 2026, docs/SCHRODI.md). Drzewa malejące z odległością (ograniczenie monotoniczne).
 */
export interface TouchModel {
  version: string;
  trainedTo: string;
  features: string[];
  gb: Tree[];
  card: Record<string, unknown>;
}

/** Zakres uczenia: do 3 median zakresu godziny od ceny */
export const TOUCH_MAX_R = 3;
const TOUCH_MIN_R = 0.01;

/**
 * Wektor cech dotknięcia jak przy uczeniu: odległość w medianach zakresu godziny i w σ godziny z realizowanej
 * zmienności doby, strona (+1 w górę), ruchy ze znakiem względem strony, zmienność i zegar kota.
 */
export function touchVector(x: FeatureVec, med1h: number, d: number): number[] {
  const side = Math.sign(d);
  const a = Math.abs(d);
  const sig = x.rv_1d / Math.sqrt(24);
  return [
    Math.log(a / med1h), Math.log(a / sig), side, x.ret_15m * side, x.ret_1h * side, x.ret_4h * side, x.ret_1d * side,
    x.rv_1h, x.rv_1d, x.rng4h_rel, x.vol_z, x.ny_hour, x.ldn_hour, x.dow, x.min_to_event, x.min_since_event, x.expiry_pre,
    x.rv_1h / med1h,
  ];
}

/** Szansa dotknięcia ceny odległej o `d` pb (log, + w górę) w godzinę; poza zakresem uczenia albo bez zmienności → NaN. */
export function touchProb(m: TouchModel, x: FeatureVec, med1h: number, d: number): number {
  const r = Math.abs(d) / med1h;
  if (!(r > 0) || r > TOUCH_MAX_R || !(x.rv_1d > 0)) return NaN;
  const v = touchVector(x, med1h, d);
  const scratch = new Array<number>(v.length).fill(0);
  let raw = 0;
  for (const tr of m.gb) raw += treeScore(tr, v, scratch);
  return sigmoid(raw);
}

/** Szanse stożka zasięgu */
export const CONE_Q = [0.8, 0.5, 0.2] as const;
export interface ConeStep {
  q: number;
  /** Odległość w górę i w dół (pb, log) dotykana z szansą q; null = poza zakresem uczenia */
  up: number | null;
  dn: number | null;
}

/**
 * Stożek zasięgu godziny: dla każdej szansy q najdalsza odległość w górę i w dół, którą model dotyka z szansą co najmniej q.
 * Bisekcja po log odległości (szansa nie rośnie z odległością), 40 kroków, wynik zaokrąglony do 0,01 pb.
 */
export function touchCone(m: TouchModel, x: FeatureVec, med1h: number): ConeStep[] {
  const edge = (q: number, side: 1 | -1): number | null => {
    let lo = Math.log(TOUCH_MIN_R);
    let hi = Math.log(TOUCH_MAX_R);
    const p = (lr: number) => touchProb(m, x, med1h, side * Math.exp(lr) * med1h);
    if (!(p(lo) >= q)) return null;
    if (p(hi) >= q) return null;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (p(mid) >= q) lo = mid;
      else hi = mid;
    }
    return Math.round(Math.exp(lo) * med1h * 100) / 100;
  };
  return CONE_Q.map((q) => ({ q, up: edge(q, 1), dn: edge(q, -1) }));
}
