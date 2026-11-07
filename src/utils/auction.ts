/**
 * Kontekst aukcji (Auction Market Theory / Market Profile) dla BTC: poziomy sesji i empiryczne częstości z przedziałami
 * ufności. Sesja = Londyn albo Nowy Jork (spec §7.11, granice w `./sessionDay`), każda liczona osobno: IB = pierwsza
 * godzina sesji, poprzednia sesja = ta sama sesja dnia poprzedniego. Doba UTC zostaje tylko jako podsumowanie.
 *
 * Poziomy bieżącej sesji liczone są ze świec 1m; statystyki historyczne — ze świec 1h (Hyperliquid udostępnia ~5000
 * ostatnich, czyli ~208 dni), więc profil, „słabe” ekstrema i IB NY (świeca od 10:00 czasu NY) są tam przybliżeniem
 * (opis w panelu).
 */
import { valueArea } from '../charts/orderflow/footprint';
import type { RangeBar } from './volatility';
import { hourlyWindow, tradeSessionOn, type TradeSessionId } from './sessionDay';

export interface VBar extends RangeBar {
  /** Wolumen świecy (BTC) */
  volume: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Ekstremum „słabe”: co najmniej dwa okna z ekstremum w odległości ≤ 0,02% (płaskie zakończenie aukcji, bez ekscesu) */
export const POOR_EPS = 0.0002;
export const VA_PCT = 0.7;
/** Koszyk profilu (USD) */
export const PROFILE_STEP = 10;

export const dayStart = (t: number) => Math.floor(t / DAY) * DAY;

/** Świece w zapisie magazynu wykresu (pola jak w `Candle` z charts/pro/hl/parse) → `VBar`. */
export const toVBars = (list: readonly { t: number; o: number; h: number; l: number; c: number; v: number }[]): VBar[] =>
  list.map((c) => ({ time: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v }));

/** Koszyk profilu wolumenu ok. 0,01% ceny, okrągły (1, 2 albo 5 × 10^k): BTC 100 000 → 10 USD. */
export function profileStep(price: number): number {
  if (!(Number.isFinite(price) && price > 0)) return Number.NaN;
  const x = price * 1e-4;
  const p = 10 ** Math.floor(Math.log10(x));
  let best = p;
  for (const k of [1, 2, 5, 10]) if (Math.abs(Math.log((k * p) / x)) < Math.abs(Math.log(best / x))) best = k * p;
  return Number(best.toPrecision(12));
}

export interface Rate {
  k: number;
  n: number;
  ci: { p: number; lo: number; hi: number } | null;
}

/** Przedział Wilsona (95% dla z = 1.96) dla proporcji k/n; n = 0 → null. */
export function wilson(k: number, n: number, z = 1.96): { p: number; lo: number; hi: number } | null {
  if (!(n > 0)) return null;
  const ph = k / n;
  const z2 = z * z;
  const centre = ph + z2 / (2 * n);
  const margin = z * Math.sqrt((ph * (1 - ph)) / n + z2 / (4 * n * n));
  const den = 1 + z2 / n;
  // Granice dokładnie 0 / 1 dla k = 0 / k = n (bez błędu zaokrąglenia 0.9999…)
  return { p: ph, lo: k === 0 ? 0 : Math.max(0, (centre - margin) / den), hi: k === n ? 1 : Math.min(1, (centre + margin) / den) };
}

const rate = (k: number, n: number): Rate => ({ k, n, ci: wilson(k, n) });

/** Różnica proporcji k1/n1 − k2/n2 z przedziałem Newcombe'a (metoda 10: hybryda przedziałów Wilsona). */
export function newcombeDiff(k1: number, n1: number, k2: number, n2: number, z = 1.96): { d: number; lo: number; hi: number } | null {
  const a = wilson(k1, n1, z);
  const b = wilson(k2, n2, z);
  if (!a || !b) return null;
  const d = a.p - b.p;
  return { d, lo: d - Math.sqrt((a.p - a.lo) ** 2 + (b.hi - b.p) ** 2), hi: d + Math.sqrt((a.hi - a.p) ** 2 + (b.p - b.lo) ** 2) };
}

/** VWAP z ceny typowej (H+L+C)/3 ważonej wolumenem i ważone odchylenie standardowe (dwa przejścia); brak wolumenu → null. */
export function sessionVwap(bars: VBar[]): { vwap: number; sd: number; volume: number } | null {
  let v = 0;
  let pv = 0;
  for (const b of bars) {
    if (!(b.volume > 0)) continue;
    v += b.volume;
    pv += ((b.high + b.low + b.close) / 3) * b.volume;
  }
  if (!(v > 0)) return null;
  const vwap = pv / v;
  let s = 0;
  for (const b of bars) if (b.volume > 0) s += b.volume * ((b.high + b.low + b.close) / 3 - vwap) ** 2;
  return { vwap, sd: Math.sqrt(s / v), volume: v };
}

/**
 * Profil wolumenu: wolumen świecy rozłożony równomiernie w jej zakresie [low, high] na koszyki `step` USD; POC (środek
 * koszyka) i value area `pct` (od POC dokładany większy sąsiad). Brak wolumenu → null.
 */
export function profile(bars: VBar[], step = PROFILE_STEP, pct = VA_PCT): { poc: number; vah: number; val: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) {
    if (!(b.volume > 0)) continue;
    lo = Math.min(lo, b.low);
    hi = Math.max(hi, b.high);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const base = Math.floor(lo / step) * step;
  const n = Math.floor((hi - base) / step) + 1;
  const vol = new Float64Array(n);
  for (const b of bars) {
    if (!(b.volume > 0)) continue;
    const i0 = Math.floor((b.low - base) / step);
    const i1 = Math.min(n - 1, Math.floor((b.high - base) / step));
    const w = b.high - b.low;
    if (i1 === i0 || !(w > 0)) {
      vol[i0] += b.volume;
      continue;
    }
    for (let i = i0; i <= i1; i++) {
      const a = Math.max(b.low, base + i * step);
      const c = Math.min(b.high, base + (i + 1) * step);
      if (c > a) vol[i] += (b.volume * (c - a)) / w;
    }
  }
  const va = valueArea(vol, n, pct);
  if (!va) return null;
  return { poc: base + (va.poc + 0.5) * step, val: base + va.lo * step, vah: base + (va.hi + 1) * step };
}

/** Maksimum/minimum zakresu i liczba różnych okien `windowMs`, w których ekstremum wypadło w odległości ≤ eps. */
export function extremeTouches(bars: RangeBar[], windowMs: number, eps = POOR_EPS): { high: number; low: number; hiTouches: number; loTouches: number } | null {
  if (bars.length === 0) return null;
  let high = -Infinity;
  let low = Infinity;
  for (const b of bars) {
    high = Math.max(high, b.high);
    low = Math.min(low, b.low);
  }
  const hiW = new Set<number>();
  const loW = new Set<number>();
  for (const b of bars) {
    const w = Math.floor(b.time / windowMs);
    if (b.high >= high * (1 - eps)) hiW.add(w);
    if (b.low <= low * (1 + eps)) loW.add(w);
  }
  return { high, low, hiTouches: hiW.size, loTouches: loW.size };
}

/** Jednostka sesji w statystyce: Londyn, NY albo doba UTC (podsumowanie). */
export type SessionUnit = TradeSessionId | 'utc';

export interface Session {
  id: SessionUnit;
  /** Początek doby UTC, w której leży sesja */
  day: number;
  /** Początek okna sesji w świecach 1h (pierwsza świeca = IB) */
  start: number;
  open: number;
  high: number;
  low: number;
  close: number;
  ibHi: number;
  ibLo: number;
  poc: number;
  vah: number;
  val: number;
  poorHigh: boolean;
  poorLow: boolean;
  bars: VBar[];
}

/** Okno jednostki w świecach 1h dla doby UTC `day`: Londyn i NY wg `hourlyWindow`, doba UTC = 24 świece od 00:00. */
const unitWindow = (day: number, unit: SessionUnit) => (unit === 'utc' ? { start: day, end: day + DAY } : hourlyWindow(tradeSessionOn(day, unit)));

/**
 * Pełne sesje jednostki `unit` ze świec 1h (wszystkie świece okna, kolejno, bez luk) z poziomami; niepełne są pomijane.
 * IB = pierwsza świeca okna.
 */
export function sessionsFromHourly(bars: VBar[], unit: SessionUnit, step = PROFILE_STEP): Session[] {
  const byDay = new Map<number, VBar[]>();
  for (const b of bars) {
    const d = dayStart(b.time);
    const arr = byDay.get(d);
    if (arr) arr.push(b);
    else byDay.set(d, [b]);
  }
  const out: Session[] = [];
  for (const [d, all] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    const w = unitWindow(d, unit);
    const arr = all.filter((b) => b.time >= w.start && b.time < w.end).sort((a, b) => a.time - b.time);
    const n = Math.round((w.end - w.start) / HOUR);
    if (arr.length !== n || arr.some((b, i) => b.time !== w.start + i * HOUR)) continue;
    const p = profile(arr, step);
    const t = extremeTouches(arr, HOUR);
    if (!p || !t) continue;
    out.push({
      id: unit,
      day: d,
      start: w.start,
      open: arr[0].open,
      high: t.high,
      low: t.low,
      close: arr[n - 1].close,
      ibHi: arr[0].high,
      ibLo: arr[0].low,
      ...p,
      poorHigh: t.hiTouches >= 2,
      poorLow: t.loTouches >= 2,
      bars: arr,
    });
  }
  return out;
}

export type OpenLoc = 'above' | 'inside' | 'below';
const openLoc = (open: number, prev: Session): OpenLoc => (open > prev.vah ? 'above' : open < prev.val ? 'below' : 'inside');

/**
 * Reguła 80%: otwarcie poza VA poprzedniej sesji, potem dwie kolejne świece z zamknięciem w VA → czy cena dociera do
 * przeciwległej granicy VA w dalszej części sesji (od świecy po potwierdzeniu, bez podglądania). null = warunek
 * niespełniony albo brak czasu w sesji po potwierdzeniu.
 */
function rule80(prev: Session, bars: VBar[]): boolean | null {
  const loc = openLoc(bars[0].open, prev);
  if (loc === 'inside') return null;
  const inVa = (c: number) => c >= prev.val && c <= prev.vah;
  for (let i = 0; i + 1 < bars.length; i++) {
    if (!inVa(bars[i].close) || !inVa(bars[i + 1].close)) continue;
    const rest = bars.slice(i + 2);
    if (rest.length === 0) return null;
    return loc === 'above' ? rest.some((b) => b.low <= prev.val) : rest.some((b) => b.high >= prev.vah);
  }
  return null;
}

export interface AuctionStats {
  /** Sesje z poprzednikiem (pary tej samej sesji z kolejnych dni) */
  n: number;
  from: number | null;
  to: number | null;
  ib: { up: Rate; down: Rate; both: Rate; none: Rate };
  rule80: { above: Rate; below: Rate; all: Rate };
  poor: {
    high: { poor: Rate; strong: Rate; diff: ReturnType<typeof newcombeDiff> };
    low: { poor: Rate; strong: Rate; diff: ReturnType<typeof newcombeDiff> };
  };
  pdTouch: Record<OpenLoc, { pdh: Rate; pdl: Rate }>;
}

/**
 * Częstości z kolejnych pełnych sesji: tylko pary tej samej sesji z dnia poprzedniego i bieżącego (Londyn ← Londyn
 * wczoraj, NY ← NY wczoraj), bez luk.
 */
export function auctionStats(sessions: Session[]): AuctionStats {
  let n = 0;
  const c = { up: 0, down: 0, both: 0, none: 0 };
  const r80 = { above: [0, 0], below: [0, 0] };
  const poor = { high: { poor: [0, 0], strong: [0, 0] }, low: { poor: [0, 0], strong: [0, 0] } };
  const pd: Record<OpenLoc, { pdh: [number, number]; pdl: [number, number] }> = {
    above: { pdh: [0, 0], pdl: [0, 0] },
    inside: { pdh: [0, 0], pdl: [0, 0] },
    below: { pdh: [0, 0], pdl: [0, 0] },
  };
  let from: number | null = null;
  let to: number | null = null;
  for (let i = 1; i < sessions.length; i++) {
    const prev = sessions[i - 1];
    const s = sessions[i];
    if (s.id !== prev.id || s.day - prev.day !== DAY) continue;
    n++;
    from ??= s.day;
    to = s.day;
    const after = s.bars.slice(1);
    const up = after.some((b) => b.high > s.ibHi);
    const down = after.some((b) => b.low < s.ibLo);
    if (up) c.up++;
    if (down) c.down++;
    if (up && down) c.both++;
    if (!up && !down) c.none++;
    const r = rule80(prev, s.bars);
    const loc = openLoc(s.open, prev);
    if (r !== null && loc !== 'inside') {
      r80[loc][1]++;
      if (r) r80[loc][0]++;
    }
    const hiKey = prev.poorHigh ? 'poor' : 'strong';
    poor.high[hiKey][1]++;
    if (s.high > prev.high) poor.high[hiKey][0]++;
    const loKey = prev.poorLow ? 'poor' : 'strong';
    poor.low[loKey][1]++;
    if (s.low < prev.low) poor.low[loKey][0]++;
    pd[loc].pdh[1]++;
    pd[loc].pdl[1]++;
    if (s.high >= prev.high) pd[loc].pdh[0]++;
    if (s.low <= prev.low) pd[loc].pdl[0]++;
  }
  const pr = (x: number[]) => rate(x[0], x[1]);
  return {
    n,
    from,
    to,
    ib: { up: rate(c.up, n), down: rate(c.down, n), both: rate(c.both, n), none: rate(c.none, n) },
    rule80: { above: pr(r80.above), below: pr(r80.below), all: rate(r80.above[0] + r80.below[0], r80.above[1] + r80.below[1]) },
    poor: {
      high: { poor: pr(poor.high.poor), strong: pr(poor.high.strong), diff: newcombeDiff(poor.high.poor[0], poor.high.poor[1], poor.high.strong[0], poor.high.strong[1]) },
      low: { poor: pr(poor.low.poor), strong: pr(poor.low.strong), diff: newcombeDiff(poor.low.poor[0], poor.low.poor[1], poor.low.strong[0], poor.low.strong[1]) },
    },
    pdTouch: {
      above: { pdh: pr(pd.above.pdh), pdl: pr(pd.above.pdl) },
      inside: { pdh: pr(pd.inside.pdh), pdl: pr(pd.inside.pdl) },
      below: { pdh: pr(pd.below.pdh), pdl: pr(pd.below.pdl) },
    },
  };
}

export interface TodayState {
  /** Początek sesji */
  start: number;
  open: number;
  openLoc: OpenLoc;
  ibHi: number;
  ibLo: number;
  /** IB zamknięty (minęła pierwsza godzina sesji) */
  ibDone: boolean;
  ibBreak: { up: boolean; down: boolean };
  /** Reguła 80%: 'n/a' (otwarcie w VA), 'armed' (poza VA, bez powrotu), 'triggered' (powrót potwierdzony), 'done' (dotarła) */
  rule80: 'n/a' | 'armed' | 'triggered' | 'done';
  pdhTouched: boolean;
  pdlTouched: boolean;
  /** Przebicie ekstremum poprzedniej sesji (ściśle ponad / pod — jak w statystyce słabych szczytów) */
  pdhBroken: boolean;
  pdlBroken: boolean;
}

/**
 * Stan bieżącej sesji `win` względem poprzedniej (ta sama reguła co statystyki). `bars` = świece 1m tej sesji, rosnąco
 * (tak liczy kontekst aukcji). Świece 1h tylko z oknem zaczynającym się o pełnej godzinie (np. `hourlyWindow`) — przy
 * otwarciu o 13:30/14:30 okna godzinne sesji nie pokrywają się ze świecami 1h.
 * IB = pierwsza godzina od początku okna. Reguła 80% liczy tylko zamknięte okna godzinne liczone od otwarcia sesji
 * (koniec okna ≤ now; ostatnie okno kończy się z końcem sesji) — bez rozstrzygania na niedomkniętej świecy.
 */
export function todayState(prev: Session, bars: RangeBar[], now: number, win: { start: number; end: number }, hourMs = HOUR): TodayState | null {
  if (bars.length === 0) return null;
  const ibEnd = win.start + hourMs;
  const ib = bars.filter((b) => b.time < ibEnd);
  const after = bars.filter((b) => b.time >= ibEnd);
  if (ib.length === 0) return null;
  const ibHi = Math.max(...ib.map((b) => b.high));
  const ibLo = Math.min(...ib.map((b) => b.low));
  const loc = openLoc(bars[0].open, prev);
  // Reguła 80% na zamknięciach okien godzinnych sesji (spójnie ze statystyką z 1h)
  let r80: TodayState['rule80'] = loc === 'inside' ? 'n/a' : 'armed';
  if (loc !== 'inside') {
    const windowEnd = (w: number) => Math.min(win.start + (w + 1) * hourMs, win.end);
    const hours = new Map<number, RangeBar>();
    for (const b of bars) hours.set(Math.floor((b.time - win.start) / hourMs), b); // ostatnia świeca okna = zamknięcie okna
    const closes = [...hours.entries()]
      .filter(([w]) => windowEnd(w) <= now)
      .sort((a, b) => a[0] - b[0]);
    const inVa = (c: number) => c >= prev.val && c <= prev.vah;
    for (let i = 0; i + 1 < closes.length; i++) {
      if (!inVa(closes[i][1].close) || !inVa(closes[i + 1][1].close)) continue;
      const confirmedAt = windowEnd(closes[i + 1][0]);
      const rest = bars.filter((b) => b.time >= confirmedAt);
      r80 = (loc === 'above' ? rest.some((b) => b.low <= prev.val) : rest.some((b) => b.high >= prev.vah)) ? 'done' : 'triggered';
      break;
    }
  }
  return {
    start: win.start,
    open: bars[0].open,
    openLoc: loc,
    ibHi,
    ibLo,
    ibDone: now >= ibEnd,
    ibBreak: { up: after.some((b) => b.high > ibHi), down: after.some((b) => b.low < ibLo) },
    rule80: r80,
    pdhTouched: bars.some((b) => b.high >= prev.high),
    pdlTouched: bars.some((b) => b.low <= prev.low),
    pdhBroken: bars.some((b) => b.high > prev.high),
    pdlBroken: bars.some((b) => b.low < prev.low),
  };
}
