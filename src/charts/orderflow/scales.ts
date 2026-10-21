/** Skale wykresu order flow: czas ↔ x, cena ↔ y, „ładne” podziałki i kubełki wyświetlania. */

/** Okno widoku: zakres czasu (ms) i ceny odwzorowany na prostokąt w pikselach CSS. */
export interface Frame {
  t0: number;
  t1: number;
  x0: number;
  x1: number;
  pMin: number;
  pMax: number;
  y0: number;
  y1: number;
}

export function timeToX(f: Frame, t: number): number {
  return f.x0 + ((t - f.t0) / (f.t1 - f.t0)) * (f.x1 - f.x0);
}

export function xToTime(f: Frame, x: number): number {
  return f.t0 + ((x - f.x0) / (f.x1 - f.x0)) * (f.t1 - f.t0);
}

export function priceToY(f: Frame, p: number): number {
  return f.y0 + ((f.pMax - p) / (f.pMax - f.pMin)) * (f.y1 - f.y0);
}

export function yToPrice(f: Frame, y: number): number {
  return f.pMax - ((y - f.y0) / (f.y1 - f.y0)) * (f.pMax - f.pMin);
}

const PRICE_STEPS = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];

/** Krok podziałki ceny z odstępem etykiet ≥ minGapPx. */
export function priceTickStep(spanUsd: number, heightPx: number, minGapPx: number): number {
  const minStep = (spanUsd / Math.max(1, heightPx)) * minGapPx;
  for (const s of PRICE_STEPS) if (s >= minStep) return s;
  return PRICE_STEPS[PRICE_STEPS.length - 1];
}

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const TIME_STEPS = [S, 2 * S, 5 * S, 10 * S, 15 * S, 30 * S, M, 2 * M, 5 * M, 10 * M, 15 * M, 30 * M, H, 2 * H, 3 * H, 6 * H, 12 * H, 24 * H];

/** Krok podziałki czasu (ms) z odstępem etykiet ≥ minGapPx. */
export function timeStep(spanMs: number, widthPx: number, minGapPx: number): number {
  const minStep = (spanMs / Math.max(1, widthPx)) * minGapPx;
  for (const s of TIME_STEPS) if (s >= minStep) return s;
  return TIME_STEPS[TIME_STEPS.length - 1];
}

const BUCKET_MULTS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

/** Kubełek wyświetlania (wielokrotność bazy), przy którym wiersz ma ≥ minRowPx. */
export function bucketFor(spanUsd: number, heightPx: number, minRowPx: number, base: number): number {
  const pxPerUsd = Math.max(1e-9, heightPx / Math.max(1e-9, spanUsd));
  for (const m of BUCKET_MULTS) if (base * m * pxPerUsd >= minRowPx) return base * m;
  return base * BUCKET_MULTS[BUCKET_MULTS.length - 1];
}
