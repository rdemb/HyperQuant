import { fmtPrice, numLang } from '../../../ui/format';
import { hlTick } from '../core/footprintBar';

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

/** Minimalna wysokość wiersza z liczbami (px) i szerokość świecy dla komórek (px; każdy styl ma dwie kolumny liczb bid i ask). */
export const CELL_MIN_ROW_PX = 11;
export const CELL_MIN_SPACING = 48;
export const PROFILE_MIN_ROW_PX = 3;
export const PROFILE_MIN_SPACING = 7;

/** Poziom rysowania dla odstępu świec i wysokości wiersza (px na ekranie). */
export function pickDetail(barSpacing: number, rowPx: number): Detail {
  if (barSpacing >= CELL_MIN_SPACING && rowPx >= CELL_MIN_ROW_PX - 2) return 'cells';
  if (barSpacing >= PROFILE_MIN_SPACING && rowPx >= 1) return 'profile';
  return 'candle';
}

/**
 * Rozmiar czcionki komórek (px) dla wysokości wiersza i szerokości kolumny (`chars` znaków
 * czcionki o stałej szerokości 0,6 em z marginesem 1 px z każdej strony).
 */
export function cellFontPx(rowPx: number, colPx = Number.POSITIVE_INFINITY, chars = 3): number {
  return Math.max(9, Math.min(12, Math.floor(rowPx * 0.74), Math.floor((colPx - 2) / (chars * 0.6))));
}

/** Przybliżona szerokość obszaru wierszy footprintu (px) w świecy o odstępie `slot` — ten sam podział co przy rysowaniu. */
export function cellAreaPx(slot: number): number {
  return slot * 0.92 - Math.max(3, Math.min(6, slot * 0.085)) - 3;
}

/** Liczba miejsc po przecinku ceny wg ticku Hyperliquid (BTC przy 80 tys.: 0, ETH: 1, SOL: 2, HYPE: 3). */
export const priceDigits = (p: number) => Math.max(0, -Math.floor(Math.log10(hlTick(Math.abs(p)))));

/** Cena z dokładnością ticku rynku. */
export const fmtPx = (p: number) => numLang(fmtPrice(p, priceDigits(p)));

/**
 * Liczba w komórce footprintu: najwyżej trzy znaki, żeby para sprzedaż | kupno mieściła się
 * w świecy szerokiej na ~45 px (0,05 → „.05”, 1,24 → „1.2”, 37,6 → „38”, 1240 → „1K”).
 * Wartość dodatnia nigdy nie jest pokazana jako „0” — zero znaczy brak transakcji.
 */
export function fmtCell(v: number): string {
  if (!(v > 0)) return '0';
  const c = Math.round(v * 100);
  if (c < 100) return numLang(`.${String(c).padStart(2, '0')}`);
  const d = Math.round(v * 10);
  if (d < 100) return numLang((d / 10).toFixed(1));
  const n = Math.round(v);
  if (n < 1000) return String(n);
  return `${Math.round(v / 1000)}K`;
}
