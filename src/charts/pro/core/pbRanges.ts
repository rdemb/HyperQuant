import { wilson } from '../../../utils/auction';
import { tzOffsetMs, utcDayStart, utcWeekStart, zonedToUtc } from './sessions';

/**
 * Zakresy P/b w stylu Patricka Nilla, zmechanizowane przez HyperQuant (Nill nie publikuje dokładnych reguł rysowania):
 * na zamkniętych świecach 5m impuls do 16 świec o ruchu netto ≥ 4 ATR, po nim zakres ≥ 48 świec (4 h) z ≥ 3
 * naprzemiennymi dotknięciami krawędzi (20% szerokości) i kształtem P (po impulsie w górę) albo b (w dół), ważny 192
 * świece (16 h). Do tego pierwsze zamknięcie poza strefą i miejsca, w których metoda Nilla by weszła: A gra w zakresie,
 * B wybicie z potwierdzeniem, C fałszywe wybicie i powrót. Miejsca są bez celu i bez pozycji: to punkty do obserwacji,
 * nie sygnały. Poziomy profilu wolumenu poprzedniego tygodnia i doby, okno day tradingu, typowa godzina i wyścig do
 * bariery, którym legenda mierzy miejsca na historii świec.
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

export type Rule = 'A' | 'B' | 'C';

export interface Spot {
  rule: Rule;
  /** Indeks świecy, na której zamknięciu miejsce powstaje. */
  k: number;
  side: 1 | -1;
  /** Cena miejsca: krawędź gry w zakresie (A), zamknięcie potwierdzenia (B), krawędź powrotu (C). */
  px: number;
  /** R:R z celem i stopem metody (cel nie jest rysowany). */
  rr: number;
}

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
  spots: Spot[];
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

/** Cel metody: z impulsem krawędź + impuls, przeciw impulsowi początek impulsu. */
function target(side: 1 | -1, r: Pick<Range, 's' | 'origin' | 'imp' | 'hi' | 'lo'>): number {
  if (side === r.s) return side > 0 ? r.hi + r.imp : r.lo - r.imp;
  return r.origin;
}

/** Wejścia po zakresie: A przy krawędziach do wybicia, potem C (powrót w 2 świece) albo B (test krawędzi i zamknięcie za świecą wybicia). */
function spotsOf(b: readonly Bar5[], a: Float64Array, r: Range): void {
  const kv = r.kv!;
  const { hi, lo } = r;
  const w = hi - lo;
  const n = b.length;
  const last = Math.min(kv + LIFE, n - 1);
  let x: number | null = null;
  for (let j = kv + 1; j <= last; j++) {
    if (!next(b, j)) break;
    if (b[j].c > hi || b[j].c < lo) {
      x = j;
      break;
    }
  }
  r.x = x;
  r.end = x ?? last;
  // A: każde nowe wejście ceny w 10% szerokości od krawędzi, naprzemiennie dół i góra
  let prev = 0;
  for (let j = kv + 1; j <= (x === null ? last : x - 1); j++) {
    const atLo = b[j].l <= lo + 0.1 * w;
    const atHi = b[j].h >= hi - 0.1 * w;
    if (atLo === atHi) continue;
    const side: 1 | -1 = atLo ? 1 : -1;
    if (side === prev) continue;
    prev = side;
    r.spots.push({
      rule: 'A',
      k: j,
      side,
      px: side > 0 ? lo + 0.1 * w : hi - 0.1 * w,
      rr: 0.8 / 0.25,
    });
  }
  if (x === null || x + 2 >= n) return;
  const dirx: 1 | -1 = b[x].c > hi ? 1 : -1;
  const back = [x + 1, x + 2].filter((j) => lo <= b[j].c && b[j].c <= hi);
  if (back.length > 0) {
    const rb = back[0];
    const side: 1 | -1 = dirx > 0 ? -1 : 1;
    const edge = side > 0 ? lo : hi;
    let ext = side > 0 ? Infinity : -Infinity;
    for (let j = x; j <= rb; j++) ext = side > 0 ? Math.min(ext, b[j].l) : Math.max(ext, b[j].h);
    const stop = ext - side * 0.1 * a[rb];
    const risk = (edge - stop) * side;
    const rr = risk > 0 ? ((target(side, r) - edge) * side) / risk : -1;
    if (rr >= 3) r.spots.push({ rule: 'C', k: rb, side, px: edge, rr });
    return;
  }
  const side = dirx;
  let retest: number | null = null;
  for (let j = x + 1; j < Math.min(x + 17, n); j++) {
    const c = b[j].c;
    if (retest === null) {
      const test = side > 0 ? b[j].l <= hi + 0.1 * w && c >= hi : b[j].h >= lo - 0.1 * w && c <= lo;
      if (test) retest = j;
      else if ((side > 0 && c < hi) || (side < 0 && c > lo)) break;
    } else {
      if ((side > 0 && c > b[x].h) || (side < 0 && c < b[x].l)) {
        let ext = side > 0 ? Infinity : -Infinity;
        for (let i = x; i <= j; i++) ext = side > 0 ? Math.min(ext, b[i].l) : Math.max(ext, b[i].h);
        const stop = ext - side * 0.1 * a[j];
        const risk = (c - stop) * side;
        const rr = risk > 0 ? ((target(side, r) - c) * side) / risk : -1;
        if (rr >= 3) r.spots.push({ rule: 'B', k: j, side, px: c, rr });
        break;
      }
      if ((side > 0 && c < hi) || (side < 0 && c > lo)) break;
    }
  }
}

/**
 * Zakresy P/b ze świec zamkniętych (rosnąco, co 5 min): ważne zakresy (kolejny impuls dopiero po świecy ważności
 * poprzedniego) z wybiciem i miejscami wejść; na końcu najwyżej jeden zakres w budowie (bez kv), jeśli najnowszy
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
          spots: [],
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
      spots: [],
    };
    spotsOf(b, a, r);
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
  lvn: number[];
}

const VA_SHARE = 0.7;

/**
 * Profil wolumenu: wolumen świecy rozłożony równo na koszyki (log-cena, `binBp` punktów bazowych) między jej minimum
 * a maksimum, obszar wartości 70% rozszerzany od POC o większego sąsiada, LVN = do 3 najgłębszych lokalnych minimów
 * wygładzonego profilu (okno 5 koszyków) wewnątrz obszaru wartości, poniżej 50% POC.
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
  const nb = top + 2;
  const diff = new Float64Array(nb + 1);
  for (let i = 0; i < n; i++) {
    const w = vol[i] / (i1[i] - i0[i] + 1);
    diff[i0[i]] += w;
    diff[i1[i] + 1] -= w;
  }
  const prof = new Float64Array(nb);
  let acc = 0;
  let tot = 0;
  let poc = 0;
  for (let k = 0; k < nb; k++) {
    acc += diff[k];
    prof[k] = acc;
    tot += acc;
    if (acc > prof[poc]) poc = k;
  }
  let a = poc;
  let z = poc;
  let s = prof[poc];
  while (s < VA_SHARE * tot) {
    const up = z + 1 < nb ? prof[z + 1] : -1;
    const dn = a - 1 >= 0 ? prof[a - 1] : -1;
    if (up >= dn) s += prof[++z];
    else s += prof[--a];
  }
  const edge = (k: number) => Math.exp(base + step * k);
  const mid = (k: number) => Math.sqrt(edge(k) * edge(k + 1));
  const lvn: number[] = [];
  if (withLvn) {
    // Średnia krocząca 5 koszyków wyśrodkowana na koszyku, zera poza profilem
    const sm = new Float64Array(nb);
    for (let k = 0; k < nb; k++) {
      let t = 0;
      for (let j = k - 2; j <= k + 2; j++) if (j >= 0 && j < nb) t += prof[j];
      sm[k] = t / 5;
    }
    const cand: number[] = [];
    for (let k = a + 2; k < z - 1; k++) if (sm[k] < sm[k - 1] && sm[k] <= sm[k + 1] && sm[k] < 0.5 * sm[poc]) cand.push(k);
    cand.sort((x, y) => sm[x] - sm[y]);
    for (const k of cand.slice(0, 3).sort((x, y) => x - y)) lvn.push(mid(k));
  }
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

function wallDate(tz: string, t: number): [number, number, number] {
  const d = new Date(t + tzOffsetMs(tz, t));
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

/** Okno day tradingu: dni robocze (UTC), zamknięcie świecy `tClose` od 08:00 Londynu do 14:00 Nowego Jorku. */
export function inDtWindow(tClose: number): boolean {
  const dow = new Date(tClose).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const [ly, lm, ld] = wallDate('Europe/London', tClose);
  const [ny, nm, nd] = wallDate('America/New_York', tClose);
  return zonedToUtc('Europe/London', ly, lm, ld, 8, 0) <= tClose && tClose < zonedToUtc('America/New_York', ny, nm, nd, 14, 0);
}

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

// ───────────────────────── pomiar miejsc ─────────────────────────

export type Outcome = 'hit' | 'miss' | 'none';

export const HORIZON_MS = 4 * HOUR;

/**
 * Wyścig do bariery po miejscu: czy cena przeszła `h` bp (typowa godzina) w stronę miejsca, zanim przeszła je przeciw,
 * do 4 h od zamknięcia świecy miejsca `t`; obie bariery w jednej świecy liczą się przeciw. null = jeszcze
 * nierozstrzygnięty albo luka w świecach. Bez przewagi trafień jest ok. 50%. To pomiar kierunku, nie wynik transakcji.
 */
export function resolve(e: { t: number; side: 1 | -1; px: number; h: number }, b: readonly Bar5[], now: number): Outcome | null {
  const up = e.px * (1 + (e.side * e.h) / 1e4);
  const dn = e.px * (1 - (e.side * e.h) / 1e4);
  const end = e.t + HORIZON_MS;
  let seen = e.t;
  for (const x of b) {
    if (x.t < e.t || x.t >= end) continue;
    if (x.t !== seen) return null;
    seen = x.t + TF_MS;
    const fav = e.side > 0 ? x.h >= up : x.l <= up;
    const adv = e.side > 0 ? x.l <= dn : x.h >= dn;
    if (adv) return 'miss';
    if (fav) return 'hit';
  }
  return seen >= end && now >= end ? 'none' : null;
}

export interface Score {
  /** Rozstrzygnięte trafienia i pudła (bez „none” i otwartych). */
  n: number;
  hits: number;
  /** 95% przedział Wilsona udziału trafień (null przy n = 0). */
  ci: { p: number; lo: number; hi: number } | null;
}

export function score(list: readonly (Outcome | null)[]): Score {
  let hits = 0;
  let n = 0;
  for (const r of list) {
    if (r === 'hit') hits++;
    if (r === 'hit' || r === 'miss') n++;
  }
  return { n, hits, ci: wilson(hits, n) };
}
