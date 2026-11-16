import { type LvnLevel, areaBins, lvnLevels, profileOf, unitsBuilder, valueArea } from './lvnConfidence';
import { utcDayStart, utcWeekStart } from './sessions';

/**
 * Zakresy P/b w stylu Patricka Nilla, zmechanizowane przez HyperQuant (Nill nie publikuje dokładnych reguł rysowania):
 * na zamkniętych świecach 5m impuls do 16 świec o ruchu netto ≥ 4 ATR, po nim zakres ≥ 48 świec (4 h) z ≥ 3
 * naprzemiennymi dotknięciami krawędzi (20% szerokości) i kształtem P (po impulsie w górę) albo b (w dół), ważny 192
 * świece (16 h), do pierwszego zamknięcia poza strefą. Do tego poziomy profilu wolumenu poprzedniego tygodnia i doby
 * oraz typowa godzina. Opis struktury, bez miejsc wejścia: dawne miejsca metody (A, B, C) w sprawdzianie na 2026 r.
 * nie miały przewagi (plan 59, C1), więc ich nie liczymy.
 */

export interface Bar5 {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** Wolumen w USD (do profilu). */
  v: number;
}

export const TF_MS = 5 * 60_000;
const IMP_BARS = 16;
const IMP_ATR = 4;
const ATR_N = 96;
const MIN_BARS = 48;
export const LIFE = 192;
const EDGE = 0.2;

export interface Range {
  /** Ostatnia świeca impulsu; zakres zaczyna się na e + 1. */
  e: number;
  s: 1 | -1;
  origin: number;
  ext: number;
  imp: number;
  /** Świeca, na której zakres stał się ważny (3. dotknięcie po 48 świecach); null = w budowie. */
  kv: number | null;
  hi: number;
  lo: number;
  /** Pierwsze świece kolejnych dotknięć (1 góra, −1 dół) do kv albo do końca danych. */
  touches: { k: number; side: 1 | -1 }[];
  /** Pierwsze zamknięcie poza strefą po kv. */
  x: number | null;
  /** Ostatnia świeca życia zakresu (kv + 192 albo wybicie). */
  end: number;
}

/** Ciągłość: świeca k leży dokładnie 5 min po k − 1 (luka w danych przerywa zakres). */
const next = (b: readonly Bar5[], k: number) => k > 0 && b[k].t - b[k - 1].t === TF_MS;

/** ATR = średnia z 96 ostatnich prawdziwych zakresów (pierwsza świeca: h − l), NaN przed 96 świecami. */
export function atr(b: readonly Bar5[]): Float64Array {
  const n = b.length;
  const out = new Float64Array(n).fill(Number.NaN);
  const tr = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const pc = i > 0 ? b[i - 1].c : Number.NaN;
    tr[i] = Number.isFinite(pc) ? Math.max(b[i].h - b[i].l, Math.abs(b[i].h - pc), Math.abs(b[i].l - pc)) : b[i].h - b[i].l;
    sum += tr[i];
    if (i >= ATR_N) sum -= tr[i - ATR_N];
    if (i >= ATR_N - 1) out[i] = sum / ATR_N;
  }
  return out;
}

/** Impulsy: ruch netto w 16 świecach ≥ 4 ATR (ATR sprzed impulsu), koniec na skrajnym zamknięciu, następna świeca go nie przebija. */
function impulses(b: readonly Bar5[], a: Float64Array): { e: number; s: 1 | -1 }[] {
  const out: { e: number; s: 1 | -1 }[] = [];
  for (let k = IMP_BARS + 8; k < b.length - 1; k++) {
    let ok = true;
    for (let j = k - IMP_BARS + 1; j <= k + 1 && ok; j++) ok = next(b, j);
    if (!ok) continue;
    const net = b[k].c - b[k - IMP_BARS + 1].o;
    const atrK = a[k - IMP_BARS];
    let mx = -Infinity;
    let mn = Infinity;
    for (let j = 0; j < IMP_BARS; j++) {
      mx = Math.max(mx, b[k - j].c);
      mn = Math.min(mn, b[k - j].c);
    }
    const up = net >= IMP_ATR * atrK && b[k].c >= mx && b[k + 1].c <= b[k].c;
    const dn = net <= -IMP_ATR * atrK && b[k].c <= mn && b[k + 1].c >= b[k].c;
    if (up || dn) out.push({ e: k, s: up ? 1 : -1 });
  }
  return out;
}

/** Dotknięcia w świecach e + 1..k przy górze `hi` i dole `lo`: pierwsze świece kolejnych serii przy jednej krawędzi. */
function touchRuns(b: readonly Bar5[], e: number, k: number, hi: number, lo: number): { k: number; side: 1 | -1 }[] {
  const w = hi - lo;
  const out: { k: number; side: 1 | -1 }[] = [];
  for (let j = e + 1; j <= k; j++) {
    const top = b[j].h >= hi - EDGE * w;
    const bot = b[j].l <= lo + EDGE * w;
    if (top === bot) continue;
    const side = top ? 1 : -1;
    if (out.length === 0 || out[out.length - 1].side !== side) out.push({ k: j, side });
  }
  return out;
}

/** Pierwsze zamknięcie poza strefą po świecy ważności (do końca życia zakresu albo luki w danych) i koniec zakresu. */
function breakout(b: readonly Bar5[], r: Range): void {
  const kv = r.kv!;
  const last = Math.min(kv + LIFE, b.length - 1);
  let x: number | null = null;
  for (let j = kv + 1; j <= last; j++) {
    if (!next(b, j)) break;
    if (b[j].c > r.hi || b[j].c < r.lo) {
      x = j;
      break;
    }
  }
  r.x = x;
  r.end = x ?? last;
}

/**
 * Zakresy P/b ze świec zamkniętych (rosnąco, co 5 min): ważne zakresy (kolejny impuls dopiero po świecy ważności
 * poprzedniego) z wybiciem; na końcu najwyżej jeden zakres w budowie (bez kv), jeśli najnowszy
 * impuls nie złamał jeszcze kształtu.
 */
export function ranges(b: readonly Bar5[]): Range[] {
  const n = b.length;
  const a = atr(b);
  const out: Range[] = [];
  let nxt = -1;
  let forming: Range | null = null;
  for (const { e, s } of impulses(b, a)) {
    if (e < nxt) continue;
    let origin = s > 0 ? Infinity : -Infinity;
    let ext = s > 0 ? -Infinity : Infinity;
    for (let j = e - IMP_BARS + 1; j <= e; j++) {
      if (s > 0) {
        origin = Math.min(origin, b[j].l);
        ext = Math.max(ext, b[j].h);
      } else {
        origin = Math.max(origin, b[j].h);
        ext = Math.min(ext, b[j].l);
      }
    }
    const imp = Math.abs(ext - origin);
    let hi = -Infinity;
    let lo = Infinity;
    let kv: number | null = null;
    let broke = false;
    let k = e + 1;
    for (; k < Math.min(e + LIFE + 1, n); k++) {
      if (!next(b, k)) {
        broke = true;
        break;
      }
      hi = Math.max(hi, b[k].h);
      lo = Math.min(lo, b[k].l);
      // Kształt P: dół w górnej połowie impulsu, góra najwyżej pół impulsu nad szczytem (b lustrzanie)
      if (s > 0 && (lo < origin + 0.5 * imp || hi > ext + 0.5 * imp)) {
        broke = true;
        break;
      }
      if (s < 0 && (hi > origin - 0.5 * imp || lo < ext - 0.5 * imp)) {
        broke = true;
        break;
      }
      if (k - e >= MIN_BARS && touchRuns(b, e, k, hi, lo).length >= 3) {
        kv = k;
        break;
      }
    }
    if (kv === null) {
      // Dane skończyły się przed złamaniem kształtu i przed końcem życia: zakres może jeszcze powstać
      if (!broke && k === n && k <= e + LIFE && k > e + 1) {
        const touches = touchRuns(b, e, n - 1, hi, lo);
        forming = {
          e,
          s,
          origin,
          ext,
          imp,
          kv: null,
          hi,
          lo,
          touches,
          x: null,
          end: n - 1,
        };
      }
      continue;
    }
    const r: Range = {
      e,
      s,
      origin,
      ext,
      imp,
      kv,
      hi,
      lo,
      touches: touchRuns(b, e, kv, hi, lo),
      x: null,
      end: kv,
    };
    breakout(b, r);
    out.push(r);
    nxt = kv + 1;
    forming = null;
  }
  if (forming && forming.e >= nxt) out.push(forming);
  return out;
}

// ───────────────────────── profil wolumenu ─────────────────────────

export interface Levels {
  poc: number;
  vah: number;
  val: number;
  /**
   * Do 3 najtrwalszych LVN i LVA (malejąco po trwałości) z pewnością bootstrapową; rysowane tylko z pewnością od progu
   * z kalibracji SIM. null — bez LVN (profil bez LVN albo za mało świec do pewności).
   */
  lvn: LvnLevel[] | null;
}

const VA_SHARE = 0.7;

/**
 * Profil wolumenu: wolumen świecy rozłożony równo na koszyki (log-cena, `binBp` punktów bazowych) między jej minimum
 * a maksimum, obszar wartości 70% rozszerzany od POC o większego sąsiada, LVN (`lvnLevels`): do 3 najtrwalszych
 * lokalnych minimów wygładzonego profilu wewnątrz obszaru wartości, poniżej 50% POC; dolina szersza niż max(5 koszyków,
 * 0,25 średniego zakresu świecy) to LVA. Pewność z kołowego bootstrapu blokami ok. 15 min (świece 5m: 3 świece; profil
 * okresu jest ze świec, bez taśmy).
 */
export function profileLevels(lo: readonly number[], hi: readonly number[], vol: readonly number[], binBp: number, withLvn: boolean): Levels | null {
  const n = lo.length;
  if (n === 0) return null;
  let min = Infinity;
  for (const x of lo) min = Math.min(min, x);
  const base = Math.log(min);
  const step = binBp / 1e4;
  const i0 = new Int32Array(n);
  const i1 = new Int32Array(n);
  let top = 0;
  for (let i = 0; i < n; i++) {
    i0[i] = Math.floor((Math.log(lo[i]) - base) / step);
    i1[i] = Math.floor((Math.log(hi[i]) - base) / step);
    top = Math.max(top, i1[i]);
  }
  const ub = unitsBuilder(top + 2);
  for (let i = 0; i < n; i++) {
    const w = vol[i] / (i1[i] - i0[i] + 1);
    for (let k = i0[i]; k <= i1[i]; k++) ub.add(k, w);
    ub.next();
  }
  const units = ub.done();
  const prof = profileOf(units);
  const { poc, a, z } = valueArea(prof, VA_SHARE);
  const edge = (k: number) => Math.exp(base + step * k);
  const mid = (k: number) => Math.sqrt(edge(k) * edge(k + 1));
  let range = 0;
  for (let i = 0; i < n; i++) range += hi[i] - lo[i];
  const minArea = areaBins(range / n, mid(poc) * (Math.exp(step) - 1));
  const lvn = withLvn ? lvnLevels(units, prof, { poc, a, z }, VA_SHARE, { mid, edge }, minArea, TF_MS) : [];
  return { poc: mid(poc), vah: edge(z + 1), val: edge(a), lvn };
}

/** Profil świec z [from, to), gdy jest co najmniej 90% świec okresu. */
function periodLevels(b: readonly Bar5[], from: number, to: number, binBp: number, withLvn: boolean): Levels | null {
  const lo: number[] = [];
  const hi: number[] = [];
  const vol: number[] = [];
  for (const x of b) {
    if (x.t < from || x.t >= to) continue;
    lo.push(x.l);
    hi.push(x.h);
    vol.push(x.v);
  }
  if (lo.length < 0.9 * ((to - from) / TF_MS)) return null;
  return profileLevels(lo, hi, vol, binBp, withLvn);
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Poziomy poprzedniego tygodnia (od poniedziałku 00:00 UTC, koszyki 10 bp, z LVN) dla chwili `t`. */
export function weekLevels(b: readonly Bar5[], t: number): Levels | null {
  const w = utcWeekStart(t);
  return periodLevels(b, w - 7 * DAY, w, 10, true);
}

/** Poziomy poprzedniej doby UTC (koszyki 5 bp) dla chwili `t`. */
export function dayLevels(b: readonly Bar5[], t: number): Levels | null {
  const d = utcDayStart(t);
  return periodLevels(b, d - DAY, d, 5, false);
}

// ───────────────────────── zegar ─────────────────────────

/** Typowa godzina w bp: mediana zakresu (max − min) / otwarcie z 24 pełnych godzin UTC przed chwilą `t`, ze świec 5m. */
export function typicalHourBp(b: readonly Bar5[], t: number): number | null {
  const end = Math.floor(t / HOUR) * HOUR;
  const from = end - 24 * HOUR;
  const hours = new Map<number, { o: number; h: number; l: number; n: number }>();
  for (let i = b.length - 1; i >= 0 && b[i].t >= from; i--) {
    const x = b[i];
    if (x.t >= end) continue;
    const H = Math.floor(x.t / HOUR) * HOUR;
    const g = hours.get(H);
    if (!g) hours.set(H, { o: x.o, h: x.h, l: x.l, n: 1 });
    else {
      g.o = x.o;
      g.h = Math.max(g.h, x.h);
      g.l = Math.min(g.l, x.l);
      g.n++;
    }
  }
  const r = [...hours.values()].filter((g) => g.n === HOUR / TF_MS).map((g) => ((g.h - g.l) / g.o) * 1e4);
  if (r.length < 12) return null;
  r.sort((a, c) => a - c);
  const m = r.length >> 1;
  return r.length % 2 ? r[m] : (r[m - 1] + r[m]) / 2;
}
