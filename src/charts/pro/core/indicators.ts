import { valueArea } from '../../orderflow/footprint';
import { niceStep } from '../../../utils/liqMap';
import type { LiqMap } from '../../../utils/liqMap';
import type { Candle } from '../hl/parse';
import { FootprintBar, rowIndex } from './footprintBar';
import { ResetMode, Session, periodStart, sessionsBetween } from './sessions';
import { DAY } from './time';

/**
 * Wskaźniki liczone z historii świec (widoczne od razu, bez czekania na taśmę): VWAP z pasmami odchylenia,
 * profil wolumenu z POC i value area, poziomy dnia, initial balance sesji i najsilniejsze
 * klastry likwidacji ze skanera. Czyste funkcje — bez wykresu i płótna.
 */

export interface IndicatorBar {
  t: number;
  candle: Candle;
  fp?: FootprintBar | null;
  complete?: boolean;
}

/** VWAP świecy: średnia ceny typowej (H+L+C)/3 ważona wolumenem od początku okresu i odchylenie standardowe ważone wolumenem. */
export interface VwapPoint {
  vwap: number;
  sd: number;
  /** Pierwszy punkt okresu (linia zaczyna się od nowa). */
  start: boolean;
}

/** VWAP z resetem na początku okresu (sesja, doba UTC, tydzień); null do pierwszej świecy z wolumenem. */
export function vwapSeries(bars: readonly IndicatorBar[], mode: ResetMode): (VwapPoint | null)[] {
  const out: (VwapPoint | null)[] = new Array(bars.length);
  let period = Number.NaN;
  // Sumy względem ceny odniesienia okresu — bez utraty precyzji przy kwadratach cen rzędu 10^10
  let ref = 0;
  let sv = 0;
  let sx = 0;
  let sxx = 0;
  let first = true;
  for (let i = 0; i < bars.length; i++) {
    const { t, candle: c } = bars[i];
    const p = periodStart(t, mode);
    if (p !== period) {
      period = p;
      ref = c.o;
      sv = sx = sxx = 0;
      first = true;
    }
    const x = (c.h + c.l + c.c) / 3 - ref;
    sv += c.v;
    sx += c.v * x;
    sxx += c.v * x * x;
    if (!(sv > 0)) {
      out[i] = null;
      continue;
    }
    const m = sx / sv;
    out[i] = { vwap: ref + m, sd: Math.sqrt(Math.max(0, sxx / sv - m * m)), start: first };
    first = false;
  }
  return out;
}

/** Interwał świec, z których liczymy VWAP okresu: doba i sesje z 1m, tydzień z 5m (API trzyma ok. 5000 świec, 1m to ok. 3,5 dnia). */
export function vwapSourceId(mode: ResetMode): string {
  return mode === 'week' ? '5m' : '1m';
}

/**
 * VWAP świec wykresu ze świec drobniejszych (`fine`, rosnąco): punkt świecy to VWAP drobnych świec okresu, które zaczęły się
 * przed jej końcem, więc VWAP i σ są te same na każdym interwale. Okres, którego początku drobne świece nie obejmują
 * (starsza historia), liczymy ze świec wykresu.
 */
export function vwapFrom(bars: readonly IndicatorBar[], fine: readonly Candle[], ms: number, mode: ResetMode): (VwapPoint | null)[] {
  const own = vwapSeries(bars, mode);
  if (fine.length === 0) return own;
  const pts = vwapSeries(
    fine.map((c) => ({ t: c.t, candle: c })),
    mode
  );
  const out: (VwapPoint | null)[] = new Array(bars.length);
  let j = -1;
  let period = Number.NaN;
  let started = false;
  for (let i = 0; i < bars.length; i++) {
    const t = bars[i].t;
    const p = periodStart(t, mode);
    if (p < fine[0].t) {
      out[i] = own[i];
      continue;
    }
    while (j + 1 < fine.length && fine[j + 1].t < t + ms) j++;
    if (p !== period) {
      period = p;
      started = false;
    }
    const pt = j >= 0 && periodStart(fine[j].t, mode) === p ? pts[j] : null;
    out[i] = pt ? { vwap: pt.vwap, sd: pt.sd, start: !started } : null;
    if (pt) started = true;
  }
  return out;
}

export interface VolumeProfile {
  /** Wysokość wiersza (USD); wiersz k obejmuje ceny [(lo + k)·step, (lo + k + 1)·step). */
  step: number;
  lo: number;
  vol: Float64Array;
  max: number;
  total: number;
  poc: number;
  vaLo: number;
  vaHi: number;
}

/** Najwięcej wierszy profilu (ochrona przed bardzo małym krokiem na szerokim zakresie). */
const MAX_PROFILE_ROWS = 4000;

/**
 * Profil wolumenu świec [from, to]: świeca w całości z taśmy oddaje wolumen dokładnie na cenach transakcji,
 * pozostałe rozkładają wolumen z API równomiernie na swój zakres H–L. Value area = 70% wolumenu wokół POC.
 */
export function volumeProfile(bars: readonly IndicatorBar[], from: number, to: number, step: number): VolumeProfile | null {
  const a = Math.max(0, from);
  const b = Math.min(bars.length - 1, to);
  if (b < a || !(step > 0)) return null;
  let minL = Number.POSITIVE_INFINITY;
  let maxH = Number.NEGATIVE_INFINITY;
  for (let i = a; i <= b; i++) {
    const c = bars[i].candle;
    if (c.l < minL) minL = c.l;
    if (c.h > maxH) maxH = c.h;
  }
  const lo = rowIndex(minL, step);
  const n = rowIndex(maxH, step) - lo + 1;
  if (!(n > 0) || n > MAX_PROFILE_ROWS) return null;
  const vol = new Float64Array(n);
  for (let i = a; i <= b; i++) {
    const bar = bars[i];
    const fp = bar.complete ? bar.fp : null;
    if (fp) addFootprint(vol, fp, step, lo, n);
    else addCandle(vol, bar.candle, step, lo, n);
  }
  let max = 0;
  let total = 0;
  for (let k = 0; k < n; k++) {
    total += vol[k];
    if (vol[k] > max) max = vol[k];
  }
  const va = valueArea(vol, n, 0.7);
  if (!va || !(total > 0)) return null;
  return { step, lo, vol, max, total, poc: va.poc, vaLo: va.lo, vaHi: va.hi };
}

/** POC, VAH i VAL profilu od początku okresu do danej świecy (ceny: środek wiersza POC, granice value area). */
export interface DevelopingLevels {
  poc: number;
  vah: number;
  val: number;
}

/**
 * Rozwijający się profil okresu [from, to]: po każdej świecy POC i value area 70% wszystkiego od początku okresu
 * (ta sama siatka wierszy i te same zasady co `volumeProfile`, więc na końcu okresu zgadza się z jego profilem).
 */
export function developingProfile(bars: readonly IndicatorBar[], from: number, to: number, step: number): (DevelopingLevels | null)[] {
  const a = Math.max(0, from);
  const b = Math.min(bars.length - 1, to);
  if (b < a || !(step > 0)) return [];
  let minL = Number.POSITIVE_INFINITY;
  let maxH = Number.NEGATIVE_INFINITY;
  for (let i = a; i <= b; i++) {
    const c = bars[i].candle;
    if (c.l < minL) minL = c.l;
    if (c.h > maxH) maxH = c.h;
  }
  const lo = rowIndex(minL, step);
  const n = rowIndex(maxH, step) - lo + 1;
  if (!(n > 0) || n > MAX_PROFILE_ROWS) return [];
  const vol = new Float64Array(n);
  const out: (DevelopingLevels | null)[] = [];
  for (let i = a; i <= b; i++) {
    const bar = bars[i];
    const fp = bar.complete ? bar.fp : null;
    if (fp) addFootprint(vol, fp, step, lo, n);
    else addCandle(vol, bar.candle, step, lo, n);
    const va = valueArea(vol, n, 0.7);
    out.push(va ? { poc: (lo + va.poc + 0.5) * step, vah: (lo + va.hi + 1) * step, val: (lo + va.lo) * step } : null);
  }
  return out;
}

function addFootprint(vol: Float64Array, fp: FootprintBar, step: number, lo: number, n: number): void {
  for (let i = 0; i < fp.buy.length; i++) {
    const v = fp.buy[i] + fp.sell[i];
    if (v === 0) continue;
    const k = rowIndex((fp.lo + i) * fp.tick, step) - lo;
    if (k >= 0 && k < n) vol[k] += v;
  }
}

function addCandle(vol: Float64Array, c: Candle, step: number, lo: number, n: number): void {
  if (!(c.v > 0)) return;
  const k0 = Math.max(0, rowIndex(c.l, step) - lo);
  const k1 = Math.min(n - 1, rowIndex(c.h, step) - lo);
  const range = c.h - c.l;
  if (!(range > 0) || k0 === k1) {
    vol[k0] += c.v;
    return;
  }
  for (let k = k0; k <= k1; k++) {
    const rLo = (lo + k) * step;
    const overlap = Math.min(c.h, rLo + step) - Math.max(c.l, rLo);
    if (overlap > 0) vol[k] += (c.v * overlap) / range;
  }
}

/**
 * Poziomy dnia UTC z dziennych świec Hyperliquid: otwarcie dnia oraz szczyt i dołek poprzedniego dnia
 * (zamknięcia nie ma osobno — na rynku 24/7 to praktycznie otwarcie następnego dnia).
 */
export interface DayLevels {
  /** Początek dnia (ms, 00:00 UTC). */
  t: number;
  open: number;
  pdh: number;
  pdl: number;
}

/** Poziomy każdego dnia, dla którego jest świeca poprzedniego dnia; rosnąco po czasie. */
export function dayLevels(daily: readonly Candle[]): DayLevels[] {
  const out: DayLevels[] = [];
  for (let i = 1; i < daily.length; i++) {
    const p = daily[i - 1];
    const d = daily[i];
    if (d.t - p.t !== DAY) continue;
    out.push({ t: d.t, open: d.o, pdh: p.h, pdl: p.l });
  }
  return out;
}

/** Initial balance: zakres pierwszej godziny sesji. */
export interface InitialBalance {
  session: Session;
  /** Koniec okresu IB (ms). */
  end: number;
  hi: number;
  lo: number;
  /** Pierwsza godzina sesji już minęła (zakres ostateczny). */
  complete: boolean;
}

export const IB_MS = 3_600_000;

/** Mnożniki zakresu IB rysowane jako rozszerzenia nad szczytem i pod dołkiem (1,5× i 2× zakresu). */
export const IB_EXTENSIONS = [0.5, 1] as const;

/**
 * Initial balance każdej sesji w zakresie świec. Sesja liczy się tylko wtedy, gdy świece obejmują jej
 * początek (bez obciętego IB na początku historii); świeca należy do IB, gdy zaczyna się w jego trakcie.
 */
export function initialBalances(bars: readonly IndicatorBar[], intervalMs: number, ibMs = IB_MS): InitialBalance[] {
  if (bars.length === 0) return [];
  const first = bars[0].t;
  const lastEnd = bars[bars.length - 1].t + intervalMs;
  const out: InitialBalance[] = [];
  let i = 0;
  for (const s of sessionsBetween(first, lastEnd)) {
    if (s.start < first) continue;
    const end = s.start + ibMs;
    while (i < bars.length && bars[i].t < s.start) i++;
    let hi = Number.NEGATIVE_INFINITY;
    let lo = Number.POSITIVE_INFINITY;
    for (let j = i; j < bars.length && bars[j].t < end; j++) {
      const c = bars[j].candle;
      if (c.h > hi) hi = c.h;
      if (c.l < lo) lo = c.l;
    }
    if (hi >= lo) out.push({ session: s, end, hi, lo, complete: lastEnd >= end });
  }
  return out;
}

/** Klaster likwidacji: środek przedziału ceny i nominał (USD); longi likwidują się pod ceną, shorty nad nią. */
export interface LiqLevel {
  px: number;
  ntlUsd: number;
  side: 'long' | 'short';
}

/**
 * Najsilniejsze klastry likwidacji po każdej stronie ceny: kubełki skanera łączone w przedziały ~0,25% ceny,
 * `top` największych z nominałem ≥ minUsd.
 */
export function liqLevels(map: LiqMap, top = 3, minUsd = 1e6): LiqLevel[] {
  const bin = niceStep(map.markPx * 0.0025);
  const pick = (buckets: LiqMap['longs'], side: LiqLevel['side']): LiqLevel[] => {
    const byBin = new Map<number, number>();
    for (const b of buckets) {
      const k = Math.floor((b.px + map.stepUsd / 2) / bin);
      byBin.set(k, (byBin.get(k) ?? 0) + b.ntlUsd);
    }
    return [...byBin]
      .map(([k, ntlUsd]) => ({ px: (k + 0.5) * bin, ntlUsd, side }))
      .filter((l) => l.ntlUsd >= minUsd && (side === 'long' ? l.px < map.markPx : l.px > map.markPx))
      .sort((x, y) => y.ntlUsd - x.ntlUsd)
      .slice(0, top);
  };
  return [...pick(map.longs, 'long'), ...pick(map.shorts, 'short')];
}

/** Okres profilu (sesja albo doba UTC): pierwsza i ostatnia świeca. */
export interface PeriodRange {
  start: number;
  from: number;
  to: number;
  /** Po okresie są już świece następnego (profil ostateczny). */
  complete: boolean;
}

/** Kolejne okresy pokryte świecami, rosnąco po czasie. */
export function periodRanges(bars: readonly IndicatorBar[], mode: 'session' | 'day'): PeriodRange[] {
  const out: PeriodRange[] = [];
  let a = 0;
  for (let i = 1; i <= bars.length; i++) {
    const start = periodStart(bars[a].t, mode);
    if (i < bars.length && periodStart(bars[i].t, mode) === start) continue;
    out.push({ start, from: a, to: i - 1, complete: i < bars.length });
    a = i;
  }
  return out;
}

/**
 * Nagie POC: dla każdego zamkniętego okresu, czy żadna późniejsza świeca nie dotknęła jego POC.
 * Wystarczy najniższy dołek i najwyższy szczyt po okresie — kolejne świece rynku 24/7 łączą się ceną,
 * więc ich zakresy tworzą jeden przedział.
 */
export function nakedPocs(bars: readonly IndicatorBar[], periods: readonly { to: number; complete: boolean; pocPx: number }[]): boolean[] {
  const out = new Array<boolean>(periods.length).fill(false);
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  let j = bars.length - 1;
  for (let k = periods.length - 1; k >= 0; k--) {
    const p = periods[k];
    for (; j > p.to; j--) {
      const c = bars[j].candle;
      if (c.l < lo) lo = c.l;
      if (c.h > hi) hi = c.h;
    }
    out[k] = p.complete && !(lo <= p.pocPx && p.pocPx <= hi);
  }
  return out;
}

/** Które wskaźniki mają sens na danym interwale (sesje i IB wymagają świec wyrównanych do ich otwarć). */
export interface IndicatorScope {
  /** Okres głównego VWAP: doba UTC, a na świecach dziennych tydzień. */
  vwapAnchor: ResetMode;
  sessionVwap: boolean;
  ib: boolean;
  sessions: boolean;
  levels: boolean;
  /** Okres profili z nagimi POC: sesja do 30 min, doba do 4 h, wyżej brak. */
  periodProfile: 'session' | 'day' | null;
}

export function indicatorScope(intervalMs: number): IndicatorScope {
  const intraday = intervalMs <= 30 * 60_000;
  return {
    vwapAnchor: intervalMs >= DAY ? 'week' : 'day',
    sessionVwap: intraday,
    ib: intraday,
    sessions: intervalMs <= 3_600_000,
    levels: intervalMs < DAY,
    periodProfile: intraday ? 'session' : intervalMs <= 4 * 3_600_000 ? 'day' : null,
  };
}
