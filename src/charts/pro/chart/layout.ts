/**
 * Dobór szczegółowości footprintu do zbliżenia: wysokość wiersza (USD) i poziom rysowania
 * (sama świeca, profil wolumenu w świecy, komórki z liczbami). Czyste funkcje — bez płótna.
 */

export type FootprintStyle = 'bidask' | 'delta' | 'volume';
export type Detail = 'candle' | 'profile' | 'cells';

/** Mnożniki ticku dla automatycznej wysokości wiersza (1, 2, 5, 10, 25, 50, 100, 200, 500, 1000…). */
const LADDER = [1, 2, 5, 10, 25, 50];

/** Najmniejszy wiersz z drabiny (wielokrotność ticku), którego wysokość na ekranie ≥ `minRowPx`. */
export function autoRowStep(pxPerUsd: number, tick: number, minRowPx: number): number {
  if (!(pxPerUsd > 0) || !(tick > 0)) return tick > 0 ? tick : 1;
  for (let scale = 1; scale <= 1e9; scale *= 100) {
    for (const m of LADDER) {
      const step = tick * m * scale;
      if (step * pxPerUsd >= minRowPx) return step;
    }
  }
  return tick * 1e9;
}

/** Minimalna wysokość wiersza z liczbami (px) i szerokość świecy dla komórek (px, zależnie od stylu). */
export const CELL_MIN_ROW_PX = 13;
export const PROFILE_MIN_ROW_PX = 3;
export const PROFILE_MIN_SPACING = 7;

export function cellMinSpacing(style: FootprintStyle): number {
  return style === 'bidask' ? 74 : 46;
}

/** Poziom rysowania dla odstępu świec i wysokości wiersza (px na ekranie). */
export function pickDetail(barSpacing: number, rowPx: number, style: FootprintStyle): Detail {
  if (barSpacing >= cellMinSpacing(style) && rowPx >= CELL_MIN_ROW_PX - 2) return 'cells';
  if (barSpacing >= PROFILE_MIN_SPACING && rowPx >= 1) return 'profile';
  return 'candle';
}

/** Rozmiar czcionki komórek (px) dla wysokości wiersza. */
export function cellFontPx(rowPx: number): number {
  return Math.max(9, Math.min(12, Math.floor(rowPx * 0.74)));
}
