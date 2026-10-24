import { IB_EXTENSIONS, initialBalances, volumeProfile, vwapSeries, type InitialBalance, type VolumeProfile, type VwapPoint } from '../../charts/pro/core/indicators';
import { sessionsBetween, utcDayStart, type SessionId } from '../../charts/pro/core/sessions';
import { mergeCandles, toIndicatorBars, type LessonSlice, type SliceCandle } from '../data';

/**
 * Model ryciny ćwiczenia: świece wycinka (na wąskim ekranie sklejone po k) i wskaźniki liczone funkcjami Wykresów.
 * Wszystko, co zależy od chwili zatrzymania, liczymy tylko z widocznych świec — rycina nie zdradza dalszego ciągu
 * (także zakresem osi ceny).
 */

export const MIN = 60_000;

/** Cena w pełnych dolarach w formacie języka ryciny (twarda spacja z pl-PL zamieniona na zwykłą). */
export const priceFormat = (locale: string) => (v: number) => Math.round(v).toLocaleString(locale).replace(/\u00a0/g, ' ');

export interface FigureLayers {
  vwap?: boolean;
  /** Pasma VWAP ±1σ i ±2σ. */
  bands?: boolean;
  /** Profil wolumenu dnia od północy UTC do chwili zatrzymania (POC, VAH, VAL). */
  profile?: boolean;
  /** Szczyt i dołek dnia poprzedniego (PDH, PDL). */
  levels?: boolean;
  /** Otwarcia Londynu i Nowego Jorku. */
  sessions?: boolean;
  /** Initial balance wybranej sesji (zakres jej pierwszej godziny) z rozszerzeniami. */
  ib?: SessionId;
  liq?: boolean;
  delta?: boolean;
  cvd?: boolean;
  oi?: boolean;
}

export interface FigureModel {
  tfMs: number;
  from: number;
  to: number;
  slots: number;
  /** Świece okna widoku. */
  candles: SliceCandle[];
  /** VWAP dla świec okna (ten sam indeks). */
  vwap: (VwapPoint | null)[];
  ib: InitialBalance | null;
  sessions: { id: SessionId; t: number }[];
  /** Pokrycie taśmą [od, do) w oknie. */
  tape: [number, number][];
  /** Wszystkie świece od północy UTC (profil dnia). */
  dayBars: ReturnType<typeof toIndicatorBars>;
  dayCandles: SliceCandle[];
}

export function figureModel(slice: LessonSlice, layers: FigureLayers, k: number): FigureModel {
  const baseMs = slice.tf * MIN;
  const tfMs = baseMs * k;
  const dayCandles = mergeCandles(slice.candles, k, baseMs);
  const dayBars = toIndicatorBars(dayCandles);
  const vwapAll = layers.vwap || layers.bands ? vwapSeries(dayBars, 'day') : dayBars.map(() => null);
  const first = dayCandles.findIndex((c) => c[0] >= slice.from);
  const candles = dayCandles.slice(first);
  const ibAll = layers.ib ? initialBalances(dayBars, tfMs) : [];
  const ib = ibAll.find((x) => x.session.id === layers.ib && x.session.start >= slice.from && x.session.start < slice.to) ?? null;
  const sessions = layers.sessions
    ? sessionsBetween(slice.from, slice.to)
        .filter((s) => s.id !== 'asia' && s.start >= slice.from && s.start < slice.to)
        .map((s) => ({ id: s.id, t: s.start }))
    : [];
  return {
    tfMs,
    from: slice.from,
    to: slice.to,
    slots: Math.round((slice.to - slice.from) / tfMs),
    candles,
    vwap: vwapAll.slice(first),
    ib,
    sessions,
    tape: slice.tape,
    dayBars,
    dayCandles,
  };
}

/** Liczba widocznych świec okna przy chwili zatrzymania `cursor` (tylko zamknięte świece). */
export function visibleCount(m: FigureModel, cursor: number): number {
  let n = 0;
  while (n < m.candles.length && m.candles[n][0] + m.tfMs <= cursor) n++;
  return n;
}

const PROFILE_STEPS = [5, 10, 20, 25, 50, 100, 250];

/** Profil dnia (doby UTC chwili zatrzymania) od jej północy do ostatniej widocznej świecy. */
export function dayProfile(m: FigureModel, cursor: number): VolumeProfile | null {
  const day = utcDayStart(cursor - 1);
  const a = m.dayCandles.findIndex((c) => c[0] >= day);
  let b = a - 1;
  while (b + 1 < m.dayCandles.length && m.dayCandles[b + 1][0] + m.tfMs <= cursor) b++;
  if (a < 0 || b < a) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = a; i <= b; i++) {
    lo = Math.min(lo, m.dayCandles[i][3]);
    hi = Math.max(hi, m.dayCandles[i][2]);
  }
  const step = PROFILE_STEPS.find((s) => (hi - lo) / s <= 70) ?? 500;
  return volumeProfile(m.dayBars, a, b, step);
}

/** Ceny POC, VAH i VAL profilu. */
export function profileLevels(p: VolumeProfile): { poc: number; vah: number; val: number } {
  return { poc: (p.lo + p.poc + 0.5) * p.step, vah: (p.lo + p.vaHi + 1) * p.step, val: (p.lo + p.vaLo) * p.step };
}

/** Poziomy IB z rozszerzeniami (1,5× i 2× zakresu). */
export function ibLines(ib: InitialBalance): { label: string; px: number }[] {
  const r = ib.hi - ib.lo;
  return [
    { label: 'IBH', px: ib.hi },
    { label: 'IBL', px: ib.lo },
    ...IB_EXTENSIONS.flatMap((x) => [
      { label: `IBH +${x * 100}%`, px: ib.hi + x * r },
      { label: `IBL −${x * 100}%`, px: ib.lo - x * r },
    ]),
  ];
}

/** Ładny krok siatki: około `n` linii w zakresie. */
export function niceStep(range: number, n: number): number {
  const raw = range / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((x) => x * mag).find((s) => s >= raw) ?? 10 * mag;
}

/** Etykiety bez nakładania: pozycje rozsunięte o co najmniej `gap`, w granicach [lo, hi]. */
export function spreadLabels<T extends { y: number }>(items: readonly T[], gap: number, lo: number, hi: number): (T & { ly: number })[] {
  const xs = [...items].sort((a, b) => a.y - b.y).map((it) => ({ ...it, ly: it.y }));
  for (let i = 1; i < xs.length; i++) xs[i].ly = Math.max(xs[i].ly, xs[i - 1].ly + gap);
  if (xs.length && xs[xs.length - 1].ly > hi) {
    xs[xs.length - 1].ly = hi;
    for (let i = xs.length - 2; i >= 0; i--) xs[i].ly = Math.min(xs[i].ly, xs[i + 1].ly - gap);
  }
  for (const it of xs) it.ly = Math.max(lo, it.ly);
  return xs;
}
