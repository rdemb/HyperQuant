import type { BookFrame } from '../../charts/pro/core/book';

/**
 * Geometria heatmapy płynności w czasie (Order Flow): czas → x, cena → y, migawki arkusza jako kolumny, bąble zleceń
 * agresora i podziałki osi. Czysta logika: bez płótna, sieci i zegara — rysuje `LiquidityHeatmap`.
 */

/** Migawka obowiązuje do następnej, najwyżej tyle ms (luka w nagraniu zostaje pusta, jak na wykresie). */
export const FRAME_MAX_MS = 60_000;

export interface PriceWindow {
  lo: number;
  hi: number;
}

/** Okno ceny `rows` kroków wokół `center` (krok bliskiej agregacji arkusza); środek na siatce kroku. */
export function priceWindow(center: number, step: number, rows: number): PriceWindow {
  if (!(step > 0) || !(rows > 0) || !Number.isFinite(center)) return { lo: Number.NaN, hi: Number.NaN };
  const mid = Math.round(center / step) * step;
  return { lo: mid - (rows / 2) * step, hi: mid + (rows / 2) * step };
}

/** Kolumny migawek w oknie czasu [t0, t1] na szerokości `W` (px): od migawki do następnej, najwyżej FRAME_MAX_MS i do `now`. */
export function frameColumns(frames: readonly BookFrame[], t0: number, t1: number, W: number, now: number): { f: BookFrame; x0: number; x1: number }[] {
  if (!(t1 > t0) || !(W > 0)) return [];
  const X = (t: number) => ((t - t0) / (t1 - t0)) * W;
  const out: { f: BookFrame; x0: number; x1: number }[] = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const end = Math.min(frames[i + 1]?.t ?? now, f.t + FRAME_MAX_MS, now);
    if (end <= t0 || f.t >= t1) continue;
    const x0 = Math.max(0, Math.round(X(f.t)));
    const x1 = Math.min(W, Math.max(x0 + 1, Math.round(X(end))));
    if (x1 > x0) out.push({ f, x0, x1 });
  }
  return out;
}

/** Najlepszy bid i ask migawki (bidy malejąco, aski rosnąco); brak strony — NaN. */
export function bestQuotes(f: BookFrame): { bid: number; ask: number } {
  return { bid: f.nBids > 0 ? f.px[0] : Number.NaN, ask: f.px.length > f.nBids ? f.px[f.nBids] : Number.NaN };
}

/** Zakres cen migawki [najniższy bid, najwyższy ask]; pusta — null. */
export function frameSpan(f: BookFrame): [number, number] | null {
  if (f.px.length === 0) return null;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const p of f.px) {
    if (p < lo) lo = p;
    if (p > hi) hi = p;
  }
  return [lo, hi];
}

/**
 * Migawka dalekiej agregacji obowiązująca w chwili `t` (ostatnia nie późniejsza, najwyżej FRAME_MAX_MS wstecz) — tło heatmapy
 * poza zakresem bliskiej migawki. Wyszukiwanie binarne po czasie.
 */
export function frameAt(frames: readonly BookFrame[], t: number): BookFrame | null {
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (frames[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  const f = frames[lo - 1];
  return f && t - f.t <= FRAME_MAX_MS ? f : null;
}

/** Promień bąbla zlecenia (px): pole proporcjonalne do wartości względem `ref` (duże zlecenie okna), w granicach [min, max]. */
export function bubbleRadius(usd: number, ref: number, min = 1.5, max = 18): number {
  if (!(usd > 0) || !(ref > 0)) return min;
  return Math.max(min, Math.min(max, max * Math.sqrt(usd / ref)));
}

/** Wartość przy kwantylu `q` (0..1) próbki; pusta — NaN. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

const TIME_STEPS = [15_000, 30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000];

/** Podziałka osi czasu: pełne wielokrotności kroku tak, by było najwyżej `max` etykiet. */
export function timeTicks(t0: number, t1: number, max = 6): number[] {
  if (!(t1 > t0)) return [];
  const step = TIME_STEPS.find((s) => (t1 - t0) / s <= max) ?? TIME_STEPS[TIME_STEPS.length - 1];
  const out: number[] = [];
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) out.push(t);
  return out;
}

/** Podziałka osi ceny: co `every` kroków arkusza w oknie (etykiety nie częściej niż co ~28 px przy wysokości `H`). */
export function priceTicks(win: PriceWindow, step: number, H: number): number[] {
  if (!(win.hi > win.lo) || !(step > 0) || !(H > 0)) return [];
  const rows = (win.hi - win.lo) / step;
  const every = Math.max(1, Math.ceil((rows * 28) / H));
  const out: number[] = [];
  for (let p = Math.ceil(win.lo / (step * every)) * step * every; p <= win.hi; p += step * every) out.push(Math.round(p / step) * step);
  return out;
}
