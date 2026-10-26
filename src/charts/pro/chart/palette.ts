/**
 * Paleta kolorów wykresów: „Neon” (domyślna — neonowa zieleń i fiolet na grafitowym tle) albo „Desk” (morska zieleń
 * i miedź na granatowym tle Desku). Jedna dla wszystkich wykresów, zapamiętana w tej przeglądarce; atrybut
 * `data-chart-palette` na <html> przełącza tokeny `of-*` w src/index.css. Bez zależności od biblioteki wykresów —
 * moduł ładuje się przy starcie strony (lekcje też używają tokenów `of-*`).
 */
export type ChartPalette = 'neon' | 'desk';

const PALETTE_KEY = 'hq.charts.palette.v1';

function savedPalette(): ChartPalette {
  try {
    return localStorage.getItem(PALETTE_KEY) === 'desk' ? 'desk' : 'neon';
  } catch {
    // Zablokowany localStorage: paleta domyślna
    return 'neon';
  }
}

export const PALETTE: ChartPalette = savedPalette();

if (typeof document !== 'undefined') document.documentElement.dataset.chartPalette = PALETTE;

/** Zmiana palety przeładowuje stronę: kolory płótna są liczone raz, przy ładowaniu modułów wykresu. */
export function setPalette(p: ChartPalette): void {
  if (p === PALETTE) return;
  try {
    localStorage.setItem(PALETTE_KEY, p);
  } catch {
    return;
  }
  window.location.reload();
}
